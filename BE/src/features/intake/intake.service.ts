import { Types, type ClientSession } from 'mongoose';
import { canDeclareIntake, INTAKE_CHECK_ITEMS, INTAKE_CONTRACT_STATUSES, inventoryOf, vnd, intakeItemsValue, type IntakeBatchItem, type IntakeCheckKey, type IntakeItemCondition } from '@ssm/shared';
import { IntakeBatchModel, RentalContractModel, type IntakeBatchHydrated, type UserHydrated } from '../../shared/db/models';
import { Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { withTxn } from '../../shared/db/txn';
import { audit } from '../audit/audit.service';
import { mailCustomer } from '../contracts/contract-notice.service';
import { toDateOnly } from '../../shared/utils/dates';

/**
 * NHẬP HÀNG nhiều đợt (đợt 14). Nhận kho chỉ còn đối chiếu giấy tờ, ký, thu tiền, giao chìa / thẻ / PIN; mỗi lần khách mang đồ vào là
 * một ĐỢT NHẬP: khách khai danh sách (DECLARED) → nhân viên chi nhánh kiểm hàng cấm (đủ INTAKE_CHECK_ITEMS) và xác nhận danh sách thực tế
 * (CONFIRMED) hoặc từ chối khi có hàng cấm (REJECTED). Nhân viên tạo thay khách tại quầy thì khai + xác nhận một bước.
 */

/** Một khách khai tối đa bấy nhiêu đợt CHƯA được xác nhận cho một hợp đồng — chặn khai tràn hàng chờ của chi nhánh. */
export const INTAKE_MAX_OPEN_PER_CONTRACT = 5;

export interface IntakeItemInput { _id?: string; name: string; category?: string | null; quantity: number; estValue: number; condition?: IntakeItemCondition; note?: string | null }
export interface GoodsCheckInput { confirmed: string[]; note?: string | null }

const newItemId = () => new Types.ObjectId().toHexString();

/** Chuẩn hoá danh sách đồ client gửi: giữ mã dòng cũ nếu trùng một dòng đang có (sửa dòng), còn lại sinh mã mới (thêm dòng). */
function normalizeItems(input: IntakeItemInput[], existing: readonly IntakeBatchItem[] = []): IntakeBatchItem[] {
  const known = new Set(existing.map((i) => i._id));
  const used = new Set<string>();
  return input.map((it) => {
    const keep = it._id && known.has(it._id) && !used.has(it._id) ? it._id : newItemId();
    used.add(keep);
    return {
      _id: keep, name: it.name.trim(), category: it.category?.trim() || null, quantity: it.quantity, estValue: it.estValue,
      condition: it.condition ?? 'GOOD', note: it.note?.trim() || null,
    };
  });
}

/** Kiểm hàng cấm đủ mọi nhóm (Điều 4) — thiếu nhóm nào thì không xác nhận được (có hàng cấm → từ chối đợt nhập). */
function assertGoodsCheck(g: GoodsCheckInput | undefined | null): { confirmed: IntakeCheckKey[]; note: string | null } {
  const missing = INTAKE_CHECK_ITEMS.filter((i) => !g?.confirmed?.includes(i.key));
  if (missing.length) {
    throw Unprocessable(`Chưa kiểm hàng cấm: ${missing.map((i) => i.label.replace(/^Không có /, '')).join('; ')} — có hàng cấm thì từ chối đợt nhập`, 'GOODS_CHECK_REQUIRED');
  }
  return { confirmed: INTAKE_CHECK_ITEMS.map((i) => i.key), note: g?.note?.trim() || null };
}

const loadContract = async (id: string, session?: ClientSession) => {
  const c = await RentalContractModel.findById(id, { facilityId: 1, customerId: 1, status: 1, contractNumber: 1 }).session(session ?? null);
  if (!c) throw NotFound('hợp đồng');
  return c;
};
const loadBatch = async (id: string, session?: ClientSession) => {
  const b = await IntakeBatchModel.findById(id).session(session ?? null);
  if (!b) throw NotFound('đợt nhập hàng');
  return b;
};
const assertContractOpen = (c: { status: Parameters<typeof canDeclareIntake>[0]['status'] }) => {
  if (!canDeclareIntake(c)) throw Unprocessable(`Hợp đồng không ở trạng thái nhận hàng vào kho (chỉ khi ${INTAKE_CONTRACT_STATUSES.join(' / ')}, chưa bị khoá)`, 'CONTRACT_NOT_ACTIVE');
};
const assertDeclared = (b: IntakeBatchHydrated) => {
  if (b.status !== 'DECLARED') throw Unprocessable('Đợt nhập không còn ở trạng thái chờ xác nhận', 'INTAKE_NOT_DECLARED');
};

// ---------------------------------------------------------------- khai đợt nhập (CUSTOMER chủ hợp đồng; STAFF / FM thay khách tại quầy)
export async function declareIntake(user: UserHydrated, contractId: string, input: {
  items: IntakeItemInput[]; expectedDate?: string | null; onBehalf?: boolean; goodsCheck?: GoodsCheckInput | null; staffNote?: string | null;
}) {
  const staffSide = user.role === 'STAFF' || user.role === 'FACILITY_MANAGER';
  if (staffSide && input.onBehalf !== true) throw Unprocessable('Nhân viên tạo đợt nhập thay khách tại quầy — gửi kèm onBehalf: true và kết quả kiểm hàng', 'ON_BEHALF_REQUIRED');
  if (!staffSide && input.onBehalf) throw Forbidden('Chỉ nhân viên chi nhánh tạo đợt nhập thay khách', 'ON_BEHALF_FORBIDDEN');
  // Thay khách: kiểm hàng cấm ngay (khai + xác nhận một bước) — kiểm trước khi mở giao dịch.
  const check = staffSide ? assertGoodsCheck(input.goodsCheck) : null;
  return withTxn(async (session) => {
    const c = await loadContract(contractId, session);
    await assertCanAccess(user, c, 'intake.declare');
    assertContractOpen(c);
    if (!staffSide) {
      const open = await IntakeBatchModel.countDocuments({ contractId: c._id, status: 'DECLARED' }).session(session);
      if (open >= INTAKE_MAX_OPEN_PER_CONTRACT) throw Unprocessable(`Hợp đồng đang có ${open} đợt nhập chờ xác nhận — đợi chi nhánh xác nhận rồi khai thêm`, 'INTAKE_TOO_MANY_OPEN');
    }
    const now = new Date();
    const items = normalizeItems(input.items);
    const [b] = await IntakeBatchModel.create([{
      contractId: c._id, facilityId: c.facilityId, customerId: c.customerId, status: staffSide ? 'CONFIRMED' : 'DECLARED',
      items, declaredAt: now, declaredBy: user._id, onBehalf: staffSide,
      expectedDate: input.expectedDate ? toDateOnly(input.expectedDate) : null,
      ...(staffSide ? { confirmedAt: now, confirmedBy: user._id, goodsCheck: check, staffNote: input.staffNote?.trim() || null } : {}),
      statusHistory: staffSide
        ? [{ from: null, to: 'DECLARED', at: now, by: user._id }, { from: 'DECLARED', to: 'CONFIRMED', at: now, by: user._id, reason: 'Nhân viên khai và xác nhận thay khách tại quầy' }]
        : [{ from: null, to: 'DECLARED', at: now, by: user._id }],
    }], { session });
    await audit({
      action: staffSide ? 'intake.create_on_behalf' : 'intake.declare', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId,
      changes: { after: { code: b.code, contract: c.contractNumber, items: items.length, totalValue: intakeItemsValue(items) } },
    }, session);
    return b;
  });
}

// ---------------------------------------------------------------- khách sửa / huỷ đợt còn chờ (CUSTOMER chủ hợp đồng)
export async function updateDeclaredIntake(user: UserHydrated, id: string, input: { items?: IntakeItemInput[]; expectedDate?: string | null }, contractId?: string) {
  return withTxn(async (session) => {
    const b = await loadBatch(id, session);
    if (contractId && String(b.contractId) !== contractId) throw NotFound('đợt nhập hàng');
    await assertCanAccess(user, b, 'intake.update');
    assertDeclared(b);
    if (input.items) b.items = normalizeItems(input.items, b.items);
    if (input.expectedDate !== undefined) b.expectedDate = input.expectedDate ? toDateOnly(input.expectedDate) : null;
    await b.save({ session });
    await audit({ action: 'intake.update', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, changes: { after: { items: b.items.length, totalValue: intakeItemsValue(b.items) } } }, session);
    return b;
  });
}

export async function cancelIntake(user: UserHydrated, id: string, reason?: string, contractId?: string) {
  return withTxn(async (session) => {
    const b = await loadBatch(id, session);
    if (contractId && String(b.contractId) !== contractId) throw NotFound('đợt nhập hàng');
    await assertCanAccess(user, b, 'intake.cancel');
    assertDeclared(b);
    b.transitionTo('CANCELLED', { actor: user.role, by: user._id, reason: reason?.trim() || 'Khách huỷ đợt nhập' });
    await b.save({ session });
    await audit({ action: 'intake.cancel', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason: reason?.trim() || null }, session);
    return b;
  });
}

// ---------------------------------------------------------------- nhân viên xác nhận / từ chối (STAFF, FM chi nhánh)
export async function confirmIntake(user: UserHydrated, id: string, input: { goodsCheck: GoodsCheckInput; items?: IntakeItemInput[]; staffNote?: string | null }) {
  return withTxn(async (session) => {
    const b = await loadBatch(id, session);
    await assertFacility(user, b.facilityId, 'intake.confirm');
    assertDeclared(b);
    const check = assertGoodsCheck(input.goodsCheck);
    const c = await loadContract(String(b.contractId), session);
    assertContractOpen(c);
    const now = new Date();
    if (input.items) {
      // Danh sách THỰC TẾ nhân viên kiểm — giữ bản khách khai ban đầu làm chứng cứ.
      const actual = normalizeItems(input.items, b.items);
      b.declaredItems = b.items.map((i) => ({ _id: i._id, name: i.name, category: i.category ?? null, quantity: i.quantity, estValue: i.estValue, condition: i.condition, note: i.note ?? null }));
      b.items = actual;
    }
    b.goodsCheck = check;
    b.staffNote = input.staffNote?.trim() || null;
    b.confirmedAt = now;
    b.confirmedBy = user._id;
    b.transitionTo('CONFIRMED', { actor: user.role, by: user._id, reason: 'Đã kiểm hàng cấm, xác nhận danh sách đồ' });
    await b.save({ session });
    await audit({
      action: 'intake.confirm', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId,
      changes: { after: { code: b.code, items: b.items.length, totalValue: intakeItemsValue(b.items), edited: !!input.items } },
    }, session);
    return b;
  });
}

export async function rejectIntake(user: UserHydrated, id: string, reason: string) {
  const b = await withTxn(async (session) => {
    const b = await loadBatch(id, session);
    await assertFacility(user, b.facilityId, 'intake.reject');
    assertDeclared(b);
    b.rejectReason = reason.trim();
    b.transitionTo('REJECTED', { actor: user.role, by: user._id, reason: reason.trim() });
    await b.save({ session });
    await audit({ action: 'intake.reject', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason: reason.trim() }, session);
    return b;
  });
  // Báo khách lý do (lỗi gửi không làm hỏng thao tác đã xong).
  void mailCustomer(b.customerId, `KhoAn — Đợt nhập hàng ${b.code} không được nhận`, [
    `Chi nhánh không nhận đợt nhập hàng ${b.code} (${b.items.length} món, ước tính ${vnd(intakeItemsValue(b.items))}).`,
    `Lý do: ${b.rejectReason}`,
    'Hàng thuộc danh mục cấm tại Điều 4 Điều khoản thuê kho không được đưa vào kho. Vui lòng liên hệ chi nhánh nếu cần hỗ trợ.',
  ]);
  return b;
}

// ---------------------------------------------------------------- xem
export async function getIntakeBatch(user: UserHydrated, id: string) {
  const b = await IntakeBatchModel.findById(id).lean();
  if (!b) throw NotFound('đợt nhập hàng');
  await assertCanAccess(user, b, 'intake.read');
  return b;
}

/** Các đợt nhập của một hợp đồng (mới nhất trước). */
export async function intakeBatchesOfContract(user: UserHydrated, contractId: string) {
  const c = await loadContract(contractId);
  await assertCanAccess(user, c, 'intake.read');
  return IntakeBatchModel.find({ contractId: c._id }).sort({ createdAt: -1 }).limit(200).lean();
}

/** "Đồ đang gửi" của hợp đồng = mọi dòng của các đợt CONFIRMED + tổng giá trị. */
export async function contractInventory(user: UserHydrated, contractId: string) {
  const c = await loadContract(contractId);
  await assertCanAccess(user, c, 'contract.inventory');
  return inventoryFor(c._id);
}
export async function inventoryFor(contractId: Types.ObjectId | string, session?: ClientSession) {
  const batches = await IntakeBatchModel.find({ contractId, status: 'CONFIRMED' }, { code: 1, status: 1, items: 1, confirmedAt: 1 }).session(session ?? null).lean();
  return inventoryOf(batches);
}

/** Hợp đồng đã bàn giao lại kho / xử lý đồ bỏ lại: các đợt nhập còn chờ không còn ý nghĩa — hệ thống tự huỷ. */
export async function cancelOpenIntakes(contractId: Types.ObjectId, reason: string, session: ClientSession) {
  const open = await IntakeBatchModel.find({ contractId, status: 'DECLARED' }).session(session);
  for (const b of open) {
    b.transitionTo('CANCELLED', { actor: 'SYSTEM', reason });
    await b.save({ session });
    await audit({ action: 'intake.cancel', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason, changes: { after: { auto: true } } }, session);
  }
}
