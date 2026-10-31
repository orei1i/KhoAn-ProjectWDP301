import { Types, type ClientSession } from 'mongoose';
import {
  canDeclareIntake, compensatedByItem, contractHoldsGoods, fmtDate, fmtDateTime, inStorageQty, INTAKE_CANCEL_REASON_MIN, INTAKE_CHECK_ITEMS, INTAKE_CONTRACT_STATUSES, INTAKE_DECLARED_EXPIRY_DAYS,
  INTAKE_EXPIRED_REASON, INTAKE_ITEM_CONDITION, INTAKE_SEALED_CHECK_ITEMS, LESSOR, intakeCategoriesFor, intakeCategoryAllowed, inventoryOf, localMidnightMs, SEALED_PACKAGE_KIND,
  SEALED_PLEDGE_VERSION, sealedPackageName, sealedPackageValues, UNIT_CATEGORY, vnd, intakeItemsValue, type IntakeBatchItem, type IntakeCheckKey, type IntakeItemCondition,
  type SealedCheckKey, type SealedPackageKind, type UnitCategory,
} from '@ssm/shared';
import { DamageClaimModel, IntakeBatchModel, RentalContractModel, UnitTypeModel, type IntakeBatchHydrated, type UserHydrated } from '../../shared/db/models';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { withTxn } from '../../shared/db/txn';
import { audit } from '../audit/audit.service';
import { mailCustomer } from '../contracts/contract-notice.service';
import { addDays, todayUTC, toDateOnly } from '../../shared/utils/dates';
import { buildContractPdf } from '../contracts/contract-pdf';
import { contractParties } from '../reservations/contract-document.service';
import type { IntakeBatchDoc } from './intake-batch.model';

/**
 * NHẬP HÀNG nhiều đợt (đợt 14). Nhận kho chỉ còn đối chiếu giấy tờ, ký, thu tiền, giao chìa / thẻ / PIN; mỗi lần khách mang đồ vào là
 * một ĐỢT NHẬP: khách khai danh sách (DECLARED) → nhân viên chi nhánh kiểm hàng cấm (đủ INTAKE_CHECK_ITEMS) và xác nhận danh sách thực tế
 * (CONFIRMED) hoặc từ chối khi có hàng cấm (REJECTED). Nhân viên tạo thay khách tại quầy thì khai + xác nhận một bước.
 *
 * Đợt 15: nhân viên KHÔNG sửa tên / giá trị khách khai (A3), xác nhận / từ chối kèm mốc phiên bản đợt nhập (A4), mỗi món có lịch sử ra
 * khỏi kho — khách lấy ra, trả khi trả kho, thanh lý (A7), đợt khai mà không mang đến bị huỷ (A8).
 */

/** Một khách khai tối đa bấy nhiêu đợt CHƯA được xác nhận cho một hợp đồng — chặn khai tràn hàng chờ của chi nhánh. */
export const INTAKE_MAX_OPEN_PER_CONTRACT = 5;

export interface IntakeItemInput { _id?: string; name: string; category?: string | null; quantity: number; estValue: number; condition?: IntakeItemCondition; note?: string | null }
export interface GoodsCheckInput { confirmed: string[]; note?: string | null }
/** Đợt 16 (D2): khai GỬI KÍN — số kiện, loại kiện, niêm phong, mô tả chung, tổng giá trị khai (tuỳ chọn). */
export interface SealedInput { packageCount: number; packageKind: SealedPackageKind; hasSeal: boolean; description?: string | null; declaredValue?: number | null }
type DocItem = IntakeBatchDoc['items'][number];

const newItemId = () => new Types.ObjectId().toHexString();

/** D2: các dòng "Kiện 1..N" của đợt gửi kín — giá trị mỗi kiện = tổng giá trị khai ÷ số kiện (sealedPackageValues), 0 nếu không khai. */
function sealedItems(s: SealedInput): DocItem[] {
  const values = sealedPackageValues(s.declaredValue ?? null, s.packageCount);
  return values.map((v, i) => ({ _id: newItemId(), name: sealedPackageName(i + 1), category: null, quantity: 1, estValue: v, condition: 'GOOD' as const, note: null }));
}
const sealedDoc = (s: SealedInput) => ({
  packageCount: s.packageCount, packageKind: s.packageKind, hasSeal: s.hasSeal, description: s.description?.trim() || null,
  declaredValue: s.declaredValue && s.declaredValue > 0 ? Math.trunc(s.declaredValue) : null, pledge: null,
});

/** Cỡ kho (category của loại kho đang thuê — sau đổi cỡ là loại mới) của hợp đồng — quyết định danh sách nhóm đồ (D1). */
async function sizeOf(c: { unitTypeId?: unknown }, session?: ClientSession): Promise<UnitCategory | null> {
  if (!c.unitTypeId) return null;
  const t = await UnitTypeModel.findById(c.unitTypeId, { category: 1 }).session(session ?? null).lean();
  return (t?.category as UnitCategory | undefined) ?? null;
}

/**
 * D1: nhóm của các dòng MỚI phải thuộc danh sách của cỡ kho (422 INTAKE_CATEGORY_NOT_ALLOWED, details { index, category, allowed }). Dòng cũ
 * giữ nguyên nhóm (`keep(it)` = true — dữ liệu cũ nhóm tự do vẫn hợp lệ, A3 khoá phần khách khai).
 */
function assertCategories(items: readonly Pick<DocItem, 'name' | 'category'>[], size: UnitCategory | null, keep: (it: Pick<DocItem, 'name' | 'category'>, idx: number) => boolean = () => false) {
  items.forEach((it, idx) => {
    if (keep(it, idx) || intakeCategoryAllowed(size, it.category)) return;
    const allowed = intakeCategoriesFor(size);
    throw new AppError(422, 'INTAKE_CATEGORY_NOT_ALLOWED', `Dòng ${idx + 1} "${it.name}": nhóm "${it.category}" không có trong danh sách của ${size === 'LOCKER' ? 'tủ locker' : size ? `kho cỡ ${UNIT_CATEGORY[size].toLowerCase()}` : 'cỡ kho này'} — chọn một nhóm trong danh sách`, { index: idx, category: it.category, allowed });
  });
}

/** Chuẩn hoá danh sách đồ client gửi: giữ mã dòng cũ nếu trùng một dòng đang có (sửa dòng), còn lại sinh mã mới (thêm dòng). */
function normalizeItems(input: IntakeItemInput[], existing: readonly Pick<IntakeBatchItem, '_id'>[] = []): DocItem[] {
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

/**
 * A3 — danh sách THỰC TẾ khi nhân viên xác nhận đợt KHÁCH khai: dòng khách khai (giữ `_id`) chỉ được sửa số lượng thực tế, tình trạng,
 * ghi chú; đổi tên / giá trị → 422 INTAKE_LOCKED_FIELD (món khác thì thêm dòng mới). Dòng không có trong bản khai = nhân viên THÊM tại quầy
 * (`addedByStaff`, giá trị do khách nói tại quầy). Dòng khách khai mà không gửi lại = khách không mang món đó đến (bản khai vẫn lưu).
 */
function staffActualItems(input: IntakeItemInput[], declared: readonly DocItem[]): DocItem[] {
  const byId = new Map(declared.map((i) => [i._id, i]));
  const used = new Set<string>();
  return input.map((it, idx) => {
    const d = it._id && !used.has(it._id) ? byId.get(it._id) : undefined;
    if (!d) return { _id: newItemId(), name: it.name.trim(), category: it.category?.trim() || null, quantity: it.quantity, estValue: it.estValue, condition: it.condition ?? 'GOOD', note: it.note?.trim() || null, addedByStaff: true };
    used.add(d._id);
    const field = it.name.trim() !== d.name ? 'name' : it.estValue !== d.estValue ? 'estValue' : null;
    if (field) {
      throw new AppError(422, 'INTAKE_LOCKED_FIELD', `Dòng ${idx + 1} "${d.name}": tên và giá trị do khách khai — nhân viên chỉ sửa số lượng thực tế, tình trạng, ghi chú (món khác thì thêm dòng mới)`, { itemId: d._id, field });
    }
    return { _id: d._id, name: d.name, category: d.category ?? null, quantity: it.quantity, estValue: d.estValue, condition: it.condition ?? d.condition, note: it.note?.trim() || null };
  });
}

const plain = (i: DocItem) => ({ _id: i._id, name: i.name, category: i.category ?? null, quantity: i.quantity, estValue: i.estValue, condition: i.condition, note: i.note ?? null, ...(i.addedByStaff ? { addedByStaff: true } : {}) });
const sameList = (a: readonly DocItem[], b: readonly DocItem[]) => JSON.stringify(a.map(plain)) === JSON.stringify(b.map(plain));

/**
 * Kiểm hàng cấm đủ mọi nhóm (Điều 4) — thiếu nhóm nào thì không xác nhận được (có hàng cấm → từ chối đợt nhập). Đợt 16 (D2): đợt GỬI KÍN —
 * nhân viên không mở kiện, chỉ quan sát bên ngoài (INTAKE_SEALED_CHECK_ITEMS); cam kết không gửi hàng cấm là bản giấy khách ký tại quầy.
 */
function assertGoodsCheck(g: GoodsCheckInput | undefined | null, sealed = false): { confirmed: (IntakeCheckKey | SealedCheckKey)[]; note: string | null } {
  const list: readonly { key: IntakeCheckKey | SealedCheckKey; label: string }[] = sealed ? INTAKE_SEALED_CHECK_ITEMS : INTAKE_CHECK_ITEMS;
  const missing = list.filter((i) => !g?.confirmed?.includes(i.key));
  if (missing.length) {
    throw Unprocessable(sealed
      ? `Gửi kín — chưa kiểm bên ngoài: ${missing.map((i) => i.label.replace(/^Không (có )?/, '')).join('; ')} — có dấu hiệu bất thường thì từ chối đợt nhập`
      : `Chưa kiểm hàng cấm: ${missing.map((i) => i.label.replace(/^Không có /, '')).join('; ')} — có hàng cấm thì từ chối đợt nhập`, 'GOODS_CHECK_REQUIRED');
  }
  return { confirmed: list.map((i) => i.key), note: g?.note?.trim() || null };
}

/** D2: nhân viên tick "Khách đã ký bản cam kết giấy" (ai, lúc nào, phiên bản mẫu) — thiếu → 422 SEALED_PLEDGE_REQUIRED. */
function sealedPledge(user: UserHydrated, signed: boolean | undefined, now: Date) {
  if (signed !== true) throw Unprocessable('Gửi kín: in bản cam kết, cho khách ký giấy tại quầy rồi tick "Khách đã ký bản cam kết giấy" mới xác nhận được', 'SEALED_PLEDGE_REQUIRED');
  return { version: SEALED_PLEDGE_VERSION, confirmedAt: now, confirmedBy: user._id, confirmedByName: user.fullName };
}

/**
 * A4 — nhân viên gửi kèm `updatedAt` của đợt nhập lúc mở màn hình; khách sửa đợt (PATCH) sau đó thì mốc đổi → 409 INTAKE_CHANGED, nhân viên
 * tải lại và kiểm lại (tránh xác nhận nhầm dòng khách vừa thêm). Client cũ không gửi thì nhận như trước.
 */
function assertUnchanged(b: IntakeBatchHydrated, expectedUpdatedAt?: string | null) {
  if (!expectedUpdatedAt) return;
  const t = new Date(expectedUpdatedAt).getTime();
  if (Number.isNaN(t) || !b.updatedAt || t !== new Date(b.updatedAt).getTime()) {
    throw Conflict('Khách vừa sửa đợt nhập — tải lại và kiểm tra lại danh sách trước khi xác nhận / từ chối', 'INTAKE_CHANGED');
  }
}

const loadContract = async (id: string, session?: ClientSession) => {
  const c = await RentalContractModel.findById(id, { facilityId: 1, customerId: 1, status: 1, contractNumber: 1, access: 1, moveOut: 1, unitTypeId: 1, unitId: 1 }).session(session ?? null);
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
const staffRole = (u: UserHydrated) => u.role === 'STAFF' || u.role === 'FACILITY_MANAGER';

// ---------------------------------------------------------------- khai đợt nhập (CUSTOMER chủ hợp đồng; STAFF / FM thay khách tại quầy)
export async function declareIntake(user: UserHydrated, contractId: string, input: {
  items?: IntakeItemInput[] | null; sealed?: SealedInput | null; pledgeSigned?: boolean; expectedDate?: string | null; onBehalf?: boolean; goodsCheck?: GoodsCheckInput | null; staffNote?: string | null;
}) {
  const staffSide = staffRole(user);
  if (staffSide && input.onBehalf !== true) throw Unprocessable('Nhân viên tạo đợt nhập thay khách tại quầy — gửi kèm onBehalf: true và kết quả kiểm hàng', 'ON_BEHALF_REQUIRED');
  if (!staffSide && input.onBehalf) throw Forbidden('Chỉ nhân viên chi nhánh tạo đợt nhập thay khách', 'ON_BEHALF_FORBIDDEN');
  const sealed = input.sealed ?? null;
  if (!sealed && !input.items?.length) throw Unprocessable('Khai ít nhất một món đồ, hoặc chọn gửi kín theo kiện', 'INTAKE_ITEMS_REQUIRED');
  // Thay khách: kiểm hàng cấm ngay (khai + xác nhận một bước) — kiểm trước khi mở giao dịch. Gửi kín (D2): kiểm bên ngoài + bản cam kết giấy;
  // chưa tick "khách đã ký" thì chỉ ĐĂNG KÝ đợt (DECLARED, có mã để in bản cam kết) — in, cho khách ký rồi xác nhận như đợt khách tự khai.
  const sealedPending = staffSide && !!sealed && input.pledgeSigned !== true;
  const confirmNow = staffSide && !sealedPending;
  const check = confirmNow ? assertGoodsCheck(input.goodsCheck, !!sealed) : null;
  const now = new Date();
  const pledge = confirmNow && sealed ? sealedPledge(user, input.pledgeSigned, now) : null;
  return withTxn(async (session) => {
    const c = await loadContract(contractId, session);
    await assertCanAccess(user, c, 'intake.declare');
    assertContractOpen(c);
    if (!staffSide) {
      const open = await IntakeBatchModel.countDocuments({ contractId: c._id, status: 'DECLARED' }).session(session);
      if (open >= INTAKE_MAX_OPEN_PER_CONTRACT) throw Unprocessable(`Hợp đồng đang có ${open} đợt nhập chờ xác nhận — đợi chi nhánh xác nhận rồi khai thêm`, 'INTAKE_TOO_MANY_OPEN');
    }
    const items = sealed ? sealedItems(sealed) : normalizeItems(input.items ?? []);
    // D1: đợt MỚI — nhóm phải thuộc danh sách của cỡ kho đang thuê.
    if (!sealed) assertCategories(items, await sizeOf(c, session));
    const [b] = await IntakeBatchModel.create([{
      contractId: c._id, facilityId: c.facilityId, customerId: c.customerId, status: confirmNow ? 'CONFIRMED' : 'DECLARED',
      items, declaredAt: now, declaredBy: user._id, onBehalf: staffSide,
      expectedDate: input.expectedDate ? toDateOnly(input.expectedDate) : null,
      ...(sealed ? { sealed: { ...sealedDoc(sealed), pledge } } : {}),
      ...(confirmNow ? { confirmedAt: now, confirmedBy: user._id, goodsCheck: check, staffNote: input.staffNote?.trim() || null } : {}),
      statusHistory: sealedPending ? [{ from: null, to: 'DECLARED', at: now, by: user._id, reason: 'Nhân viên đăng ký gửi kín tại quầy — chờ in và ký bản cam kết giấy' }]
        : confirmNow
        ? [{ from: null, to: 'DECLARED', at: now, by: user._id }, { from: 'DECLARED', to: 'CONFIRMED', at: now, by: user._id, reason: sealed ? 'Nhân viên khai gửi kín thay khách tại quầy — đã kiểm bên ngoài, khách ký bản cam kết giấy' : 'Nhân viên khai và xác nhận thay khách tại quầy' }]
        : [{ from: null, to: 'DECLARED', at: now, by: user._id }],
    }], { session });
    await audit({
      action: confirmNow ? 'intake.create_on_behalf' : staffSide ? 'intake.declare_on_behalf' : 'intake.declare', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId,
      changes: { after: { code: b.code, contract: c.contractNumber, items: items.length, totalValue: intakeItemsValue(items), ...(sealed ? { sealed: { packages: sealed.packageCount, kind: sealed.packageKind, hasSeal: sealed.hasSeal, declaredValue: b.sealed?.declaredValue ?? null, pledge: !!pledge } } : {}) } },
    }, session);
    return b;
  });
}

// ---------------------------------------------------------------- khách sửa / huỷ đợt còn chờ (CUSTOMER chủ hợp đồng; STAFF / FM huỷ kèm lý do)
export async function updateDeclaredIntake(user: UserHydrated, id: string, input: { items?: IntakeItemInput[]; sealed?: SealedInput; expectedDate?: string | null }, contractId?: string) {
  return withTxn(async (session) => {
    const b = await loadBatch(id, session);
    if (contractId && String(b.contractId) !== contractId) throw NotFound('đợt nhập hàng');
    await assertCanAccess(user, b, 'intake.update');
    assertDeclared(b);
    // D2: đợt gửi kín sửa thông tin kiện (sinh lại Kiện 1..N), không sửa danh sách từng món; đợt thường thì ngược lại.
    if (b.sealed && input.items) throw Unprocessable('Đợt gửi kín không kê khai từng món — sửa số kiện / loại kiện / giá trị khai', 'SEALED_ITEMS_LOCKED');
    if (!b.sealed && input.sealed) throw Unprocessable('Đợt này đã khai chi tiết từng món — muốn gửi kín thì huỷ và khai đợt mới', 'INTAKE_NOT_SEALED');
    if (input.sealed) { b.sealed = { ...sealedDoc(input.sealed) }; b.items = sealedItems(input.sealed); }
    if (input.items) {
      const before = new Map(b.items.map((i) => [i._id, i.category ?? null]));
      b.items = normalizeItems(input.items, b.items);
      // D1: dòng mới / đổi nhóm phải thuộc danh sách của cỡ kho; dòng cũ giữ nguyên nhóm (kể cả nhóm tự do của dữ liệu cũ).
      const c = await loadContract(String(b.contractId), session);
      assertCategories(b.items, await sizeOf(c, session), (it) => before.has((it as DocItem)._id) && before.get((it as DocItem)._id) === (it.category ?? null));
    }
    if (input.expectedDate !== undefined) b.expectedDate = input.expectedDate ? toDateOnly(input.expectedDate) : null;
    await b.save({ session });
    await audit({ action: 'intake.update', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, changes: { after: { items: b.items.length, totalValue: intakeItemsValue(b.items) } } }, session);
    return b;
  });
}

/** Email báo khách đợt nhập đã huỷ — không nhắc tới "hàng cấm" (huỷ vì không mang đến / quá hạn, khác với từ chối nhập). */
const batchSummary = (b: { items: readonly DocItem[]; sealed?: { packageCount: number } | null }) =>
  b.sealed ? `${b.sealed.packageCount} kiện gửi kín` : `${b.items.length} món, ước tính ${vnd(intakeItemsValue(b.items))}`;
const mailCancelled = (b: { customerId: unknown; code: string; items: readonly DocItem[]; sealed?: { packageCount: number } | null }, reason: string) => void mailCustomer(b.customerId, `KhoAn — Đợt nhập hàng ${b.code} đã huỷ`, [
  `Đợt nhập hàng ${b.code} (${batchSummary(b)}) đã huỷ: ${reason}.`,
  'Khi mang đồ đến kho, bạn khai một đợt nhập mới trong tài khoản (hoặc nhờ nhân viên khai tại quầy). Cần hỗ trợ, vui lòng liên hệ chi nhánh.',
]);

/**
 * Huỷ đợt còn chờ (DECLARED): khách tự huỷ (lý do tuỳ chọn); nhân viên / quản lý chi nhánh huỷ khi khách khai mà không mang đồ đến — BẮT
 * BUỘC lý do (≥ INTAKE_CANCEL_REASON_MIN ký tự, thiếu → 422 INTAKE_CANCEL_REASON_REQUIRED), đúng chi nhánh, email báo khách.
 */
export async function cancelIntake(user: UserHydrated, id: string, reason?: string, contractId?: string) {
  const staffSide = staffRole(user);
  const why = reason?.trim() || '';
  if (staffSide && why.length < INTAKE_CANCEL_REASON_MIN) {
    throw Unprocessable(`Ghi lý do huỷ đợt nhập (ít nhất ${INTAKE_CANCEL_REASON_MIN} ký tự) — khách nhận được lý do qua email`, 'INTAKE_CANCEL_REASON_REQUIRED');
  }
  const b = await withTxn(async (session) => {
    const b = await loadBatch(id, session);
    if (contractId && String(b.contractId) !== contractId) throw NotFound('đợt nhập hàng');
    await assertCanAccess(user, b, 'intake.cancel');
    assertDeclared(b);
    if (why) b.cancelReason = why;
    b.transitionTo('CANCELLED', { actor: user.role, by: user._id, reason: why || 'Khách huỷ đợt nhập' });
    await b.save({ session });
    await audit({ action: 'intake.cancel', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason: why || null, changes: { after: { by: staffSide ? 'STAFF' : 'CUSTOMER' } } }, session);
    return b;
  });
  if (staffSide) mailCancelled(b, why);
  return b;
}

// ---------------------------------------------------------------- nhân viên xác nhận / từ chối (STAFF, FM chi nhánh)
export async function confirmIntake(user: UserHydrated, id: string, input: { goodsCheck: GoodsCheckInput; items?: IntakeItemInput[]; staffNote?: string | null; expectedUpdatedAt?: string | null; pledgeSigned?: boolean }) {
  const { b, contractNumber } = await withTxn(async (session) => {
    const b = await loadBatch(id, session);
    await assertFacility(user, b.facilityId, 'intake.confirm');
    assertDeclared(b);
    assertUnchanged(b, input.expectedUpdatedAt);
    const check = assertGoodsCheck(input.goodsCheck, !!b.sealed);
    const c = await loadContract(String(b.contractId), session);
    assertContractOpen(c);
    const now = new Date();
    if (b.sealed) {
      // D2: không mở kiện, không sửa danh sách kiện; bắt buộc bản cam kết giấy khách đã ký tại quầy.
      if (input.items) throw Unprocessable('Đợt gửi kín: không sửa danh sách kiện khi xác nhận — số kiện thực tế khác thì huỷ đợt (ghi lý do) và tạo đợt mới tại quầy', 'SEALED_ITEMS_LOCKED');
      b.set('sealed.pledge', sealedPledge(user, input.pledgeSigned, now));
    } else if (input.items) {
      // Danh sách THỰC TẾ nhân viên kiểm (A3: không sửa tên / giá trị khách khai) — giữ bản khách khai ban đầu làm chứng cứ nếu có thay đổi.
      const actual = staffActualItems(input.items, b.items);
      // D1: dòng nhân viên THÊM phải đúng nhóm của cỡ kho; dòng khách khai giữ nguyên nhóm (A3).
      assertCategories(actual, await sizeOf(c, session), (it) => !(it as DocItem).addedByStaff);
      if (!sameList(actual, b.items)) {
        b.declaredItems = b.items.map((i) => ({ _id: i._id, name: i.name, category: i.category ?? null, quantity: i.quantity, estValue: i.estValue, condition: i.condition, note: i.note ?? null }));
        b.items = actual;
      }
    }
    b.goodsCheck = check;
    b.staffNote = input.staffNote?.trim() || null;
    b.confirmedAt = now;
    b.confirmedBy = user._id;
    b.transitionTo('CONFIRMED', { actor: user.role, by: user._id, reason: 'Đã kiểm hàng cấm, xác nhận danh sách đồ' });
    await b.save({ session });
    await audit({
      action: 'intake.confirm', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId,
      changes: { after: { code: b.code, items: b.items.length, totalValue: intakeItemsValue(b.items), edited: !!b.declaredItems?.length, addedByStaff: b.items.filter((i) => i.addedByStaff).length, ...(b.sealed ? { sealed: true, pledgeVersion: b.sealed.pledge?.version ?? null } : {}) } },
    }, session);
    return { b, contractNumber: c.contractNumber };
  });
  if (b.sealed) {
    const s = b.sealed;
    void mailCustomer(b.customerId, `KhoAn — Đã nhập kho đợt gửi kín ${b.code}`, [
      `Chi nhánh đã xác nhận nhập kho đợt gửi kín ${b.code} (hợp đồng ${contractNumber}) lúc ${fmtDateTime(b.confirmedAt!.toISOString())}: ${s.packageCount} ${SEALED_PACKAGE_KIND[s.packageKind].toLowerCase()} (${b.items.map((i) => i.name).join(', ')}), ${s.hasSeal ? 'có niêm phong' : 'không niêm phong'}${s.description ? ` — ${s.description}` : ''}.`,
      s.declaredValue ? `Tổng giá trị khai: ${vnd(s.declaredValue)} (mỗi kiện ${vnd(Math.floor(s.declaredValue / s.packageCount))}).` : 'Bạn không khai giá trị — khi cần bồi thường phải có chứng cứ về giá trị.',
      'Nhân viên không mở kiện, chỉ kiểm bên ngoài; bạn đã ký bản cam kết không gửi hàng cấm. Bồi thường theo kiện: chỉ khi kiện bị mất hoặc hư hại bên ngoài do lỗi kho; kiện còn nguyên niêm phong thì không nhận khiếu nại thiếu đồ bên trong.',
    ]);
    return b;
  }
  // A3: gửi khách danh sách ĐÃ XÁC NHẬN (lỗi gửi mail không làm hỏng thao tác đã xong — mailCustomer tự nuốt lỗi).
  void mailCustomer(b.customerId, `KhoAn — Đã nhập kho đợt ${b.code}`, [
    `Chi nhánh đã xác nhận nhập kho đợt ${b.code} (hợp đồng ${contractNumber}) lúc ${fmtDateTime(b.confirmedAt!.toISOString())}. Danh sách đã xác nhận:`,
    ...b.items.map((it, i) => `${i + 1}. ${it.name} — SL ${it.quantity} — ${INTAKE_ITEM_CONDITION[it.condition].label} — giá trị khai ${vnd(it.estValue)}/cái${it.addedByStaff ? ' (nhân viên ghi thêm tại quầy)' : ''}`),
    `Tổng giá trị khai: ${vnd(intakeItemsValue(b.items))}.`,
    'Nhân viên chỉ đối chiếu số lượng và tình trạng bên ngoài; KhoAn không kiểm định, không định giá. Giá trị do bạn tự khai là mức trần bồi thường. Danh sách chưa đúng, vui lòng liên hệ chi nhánh ngay.',
  ]);
  return b;
}

export async function rejectIntake(user: UserHydrated, id: string, reason: string, expectedUpdatedAt?: string | null) {
  const b = await withTxn(async (session) => {
    const b = await loadBatch(id, session);
    await assertFacility(user, b.facilityId, 'intake.reject');
    assertDeclared(b);
    assertUnchanged(b, expectedUpdatedAt);
    b.rejectReason = reason.trim();
    b.transitionTo('REJECTED', { actor: user.role, by: user._id, reason: reason.trim() });
    await b.save({ session });
    await audit({ action: 'intake.reject', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason: reason.trim() }, session);
    return b;
  });
  // Báo khách lý do (lỗi gửi không làm hỏng thao tác đã xong).
  void mailCustomer(b.customerId, `KhoAn — Đợt nhập hàng ${b.code} không được nhận`, [
    `Chi nhánh không nhận đợt nhập hàng ${b.code} (${batchSummary(b)}).`,
    `Lý do: ${b.rejectReason}`,
    'Hàng thuộc danh mục cấm tại Điều 4 Điều khoản thuê kho không được đưa vào kho. Vui lòng liên hệ chi nhánh nếu cần hỗ trợ.',
  ]);
  return b;
}

/** Đợt 17 (D7): số đã bồi thường của từng món (dòng hồ sơ PAID của hợp đồng). */
const paidQtyByItem = async (contractId: Types.ObjectId, session: ClientSession) =>
  compensatedByItem(await DamageClaimModel.find({ contractId, status: 'PAID' }, { status: 1, 'items.intakeItemId': 1, 'items.quantity': 1 }).session(session).lean());

// ---------------------------------------------------------------- khách lấy đồ ra (A7: CUSTOMER chủ hợp đồng, STAFF / FM chi nhánh)
/**
 * Ghi "khách lấy đồ ra" cho một món của đợt đã xác nhận: chỉ khi hợp đồng còn giữ đồ (chưa bàn giao lại kho / chưa đóng — khác → 422
 * ALREADY_RETURNED), số lượng ≤ số đang gửi (vượt → 422 WITHDRAW_OVER_STOCK, details.max). Ngày ghi = hôm nay (ngày VN). Ghi nhật ký.
 */
export async function withdrawIntakeItem(user: UserHydrated, batchId: string, itemId: string, input: { quantity: number; note?: string | null }) {
  return withTxn(async (session) => {
    const b = await loadBatch(batchId, session);
    await assertCanAccess(user, b, 'intake.withdraw');
    if (b.status !== 'CONFIRMED') throw Unprocessable('Chỉ ghi lấy đồ ra với đợt nhập đã xác nhận', 'INTAKE_NOT_CONFIRMED');
    const c = await loadContract(String(b.contractId), session);
    if (!contractHoldsGoods(c)) throw Unprocessable('Kho đã bàn giao lại / hợp đồng đã đóng — không ghi lấy đồ ra nữa', 'ALREADY_RETURNED');
    const it = b.items.find((x) => x._id === itemId);
    if (!it) throw NotFound('món đồ trong đợt nhập');
    // Đợt 17 (D7): phần đã bồi thường (hồ sơ PAID) không còn đang gửi — không ghi lấy ra được.
    const left = inStorageQty({ quantity: it.quantity, removals: it.removals, compensated: (await paidQtyByItem(c._id, session)).get(it._id) ?? 0 });
    if (input.quantity > left) {
      throw new AppError(422, 'WITHDRAW_OVER_STOCK', left > 0 ? `"${it.name}": chỉ còn ${left} cái đang gửi` : `"${it.name}": không còn cái nào đang gửi`, { itemId, max: left });
    }
    it.removals = [...(it.removals ?? []), { kind: 'WITHDRAWN', quantity: input.quantity, at: todayUTC(), by: user._id, note: input.note?.trim() || null }];
    await b.save({ session });
    await audit({
      action: 'intake.withdraw', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason: input.note?.trim() || null,
      changes: { after: { contract: c.contractNumber, itemId, name: it.name, quantity: input.quantity, left: left - input.quantity, by: staffRole(user) ? 'STAFF' : 'CUSTOMER' } },
    }, session);
    return b;
  });
}

/**
 * A7 — đồ còn lại của MỌI món đã xác nhận ra khỏi kho cùng lúc: trả kho (RETURNED, lúc ghi nhận khách bàn giao lại kho) hoặc thanh lý hàng
 * bỏ lại (DISPOSED). Món đã hết (đã lấy ra / đã ghi) bỏ qua — gọi lại nhiều lần vô hại. Đợt 17 (D7): phần đã bồi thường không ghi "đã trả" / "thanh lý".
 * Gọi trong transaction của thao tác.
 */
export async function markGoodsRemoved(contractId: Types.ObjectId, kind: 'RETURNED' | 'DISPOSED', at: Date, by: Types.ObjectId | null, note: string, session: ClientSession) {
  const batches = await IntakeBatchModel.find({ contractId, status: 'CONFIRMED' }).session(session);
  const paid = batches.length ? await paidQtyByItem(contractId, session) : new Map<string, number>();
  for (const b of batches) {
    let moved = 0;
    for (const it of b.items) {
      const left = inStorageQty({ quantity: it.quantity, removals: it.removals, compensated: paid.get(it._id) ?? 0 });
      if (left <= 0) continue;
      it.removals = [...(it.removals ?? []), { kind, quantity: left, at, by, note }];
      moved += left;
    }
    if (!moved) continue;
    await b.save({ session });
    await audit({ action: kind === 'RETURNED' ? 'intake.return' : 'intake.dispose', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason: note, changes: { after: { code: b.code, quantity: moved } } }, session);
  }
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

/** "Đồ đang gửi" của hợp đồng = mọi dòng của các đợt CONFIRMED + số đang gửi, lịch sử ra kho, số đã bồi thường; tổng giá trị đang gửi. */
export async function contractInventory(user: UserHydrated, contractId: string) {
  const c = await loadContract(contractId);
  await assertCanAccess(user, c, 'contract.inventory');
  return inventoryFor(c._id);
}
export async function inventoryFor(contractId: Types.ObjectId | string, session?: ClientSession) {
  const [batches, claims] = await Promise.all([
    IntakeBatchModel.find({ contractId, status: 'CONFIRMED' }, { code: 1, status: 1, items: 1, confirmedAt: 1, sealed: 1 }).session(session ?? null).lean(),
    DamageClaimModel.find({ contractId, status: 'PAID' }, { status: 1, 'items.intakeItemId': 1, 'items.quantity': 1 }).session(session ?? null).lean(),
  ]);
  return inventoryOf(batches, claims);
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

/**
 * JOB (A8): đợt DECLARED quá ngày hẹn mang đến (không hẹn thì ngày khai) + INTAKE_DECLARED_EXPIRY_DAYS ngày mà chưa được xác nhận → tự huỷ
 * (lý do "Quá hạn mang hàng đến"), email báo khách. Mỗi lượt tối đa 500 đợt; chạy lại vô hại.
 */
export async function expireDeclaredIntakes() {
  const cutoff = addDays(todayUTC(), -INTAKE_DECLARED_EXPIRY_DAYS); // mốc < cutoff ⇔ đã quá mốc + N ngày
  const stale = await IntakeBatchModel.find({
    status: 'DECLARED',
    $or: [{ expectedDate: { $ne: null, $lt: cutoff } }, { expectedDate: null, declaredAt: { $lt: new Date(localMidnightMs(cutoff)) } }],
  }, { _id: 1 }).limit(500).lean();
  let n = 0;
  for (const { _id } of stale) {
    const done = await withTxn(async (session) => {
      const b = await IntakeBatchModel.findById(_id).session(session);
      if (!b || b.status !== 'DECLARED') return null;
      b.cancelReason = INTAKE_EXPIRED_REASON;
      b.transitionTo('CANCELLED', { actor: 'SYSTEM', reason: INTAKE_EXPIRED_REASON });
      await b.save({ session });
      await audit({ action: 'intake.expire', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, reason: INTAKE_EXPIRED_REASON, changes: { after: { auto: true, expectedDate: b.expectedDate ? fmtDate(b.expectedDate.toISOString()) : null } } }, session);
      return b;
    }).catch((e) => { console.error('intake-expiry', _id, e); return null; });
    if (done) { n++; mailCancelled(done, INTAKE_EXPIRED_REASON); }
  }
  if (n) console.log(`[job:intake-expiry] cancelled ${n}`);
  return n;
}

// ---------------------------------------------------------------- bản cam kết gửi kín (D2)
/**
 * Đợt 16 (D2): bản IN cam kết gửi kín để khách ký GIẤY tại quầy (không ký online) — như bản in hợp đồng giấy: thông tin chi nhánh / khách /
 * hợp đồng / ô, mã đợt nhập, số kiện, loại kiện, niêm phong, tổng giá trị khai, danh mục hàng cấm, nội dung cam kết + giới hạn bồi thường
 * theo kiện, chỗ ký hai bên. Chỉ đợt gửi kín còn chờ / đã xác nhận, nhân viên / quản lý đúng chi nhánh.
 */
export async function sealedPledgePdf(user: UserHydrated, id: string) {
  const b = await IntakeBatchModel.findById(id).lean();
  if (!b) throw NotFound('đợt nhập hàng');
  await assertFacility(user, b.facilityId, 'intake.sealed_pledge');
  if (!b.sealed) throw Unprocessable('Đợt này không phải gửi kín — không có bản cam kết', 'INTAKE_NOT_SEALED');
  if (b.status !== 'DECLARED' && b.status !== 'CONFIRMED') throw Unprocessable('Đợt nhập đã huỷ / bị từ chối', 'INTAKE_NOT_DECLARED');
  const c = await RentalContractModel.findById(b.contractId, { contractNumber: 1, unitId: 1, facilityId: 1, customerId: 1 }).populate<{ unitId: { unitNumber: string } | null }>('unitId', 'unitNumber').lean();
  const p = await contractParties(b.facilityId, b.customerId);
  const s = b.sealed;
  const per = s.declaredValue ? Math.floor(s.declaredValue / s.packageCount) : null;
  const clauses = [
    { title: 'Thông tin đợt gửi kín', bullets: [] as string[], paragraphs: [
      `Bên cho thuê (Bên A): ${LESSOR.legalName} — chi nhánh ${p.facilityName}${p.facilityAddress ? `, ${p.facilityAddress}` : ''}.`,
      `Bên thuê (Bên B): ${p.customerName}${p.customerPhone ? ` — SĐT ${p.customerPhone}` : ''}.`,
      `Hợp đồng ${c?.contractNumber ?? '—'} · ô kho ${c?.unitId?.unitNumber ?? '—'} · mã đợt nhập ${b.code}.`,
      `Số kiện: ${s.packageCount} (${b.items.map((i) => i.name).join(', ')}) · loại kiện: ${SEALED_PACKAGE_KIND[s.packageKind]} · ${s.hasSeal ? 'CÓ niêm phong' : 'KHÔNG niêm phong'}.`,
      ...(s.description ? [`Mô tả chung (Bên B tự ghi): ${s.description}`] : []),
      s.declaredValue ? `Tổng giá trị Bên B tự khai: ${vnd(s.declaredValue)} — giá trị mỗi kiện ${vnd(per!)} (tổng ÷ số kiện).` : 'Bên B KHÔNG khai giá trị các kiện.',
    ] },
    { title: 'Danh mục hàng cấm gửi (Điều 4 Điều khoản thuê kho)', paragraphs: [], bullets: INTAKE_CHECK_ITEMS.map((i) => i.label.replace(/^Không có /, '').replace(/^./, (x) => x.toUpperCase()) + '.') },
    { title: 'Nội dung cam kết của Bên B', bullets: [], paragraphs: [
      'Bên B chọn gửi kín, không kê khai chi tiết đồ bên trong các kiện. Nhân viên KhoAn không mở kiện, chỉ quan sát bên ngoài (mùi, rò rỉ, tiếng động, khối lượng bất thường) và có quyền từ chối nhận kiện có dấu hiệu bất thường.',
      'Bên B cam kết trong các kiện KHÔNG có hàng hoá thuộc danh mục cấm nêu trên, là chủ sở hữu hợp pháp (hoặc được uỷ quyền) đối với toàn bộ đồ bên trong, và chịu hoàn toàn trách nhiệm trước pháp luật cũng như mọi chi phí, thiệt hại phát sinh nếu cam kết này sai sự thật (Điều 4, Điều 10).',
    ] },
    { title: 'Giới hạn bồi thường theo kiện (Điều 6)', bullets: [], paragraphs: [
      'KhoAn bồi thường theo KIỆN, chỉ khi kiện bị mất hoặc bị hư hại bên ngoài do lỗi của kho.',
      per !== null ? `Mức bồi thường tối đa mỗi kiện là ${vnd(per)} (tổng giá trị khai ÷ số kiện).` : 'Bên B không khai giá trị: khi yêu cầu bồi thường, Bên B phải cung cấp chứng cứ về giá trị (hoá đơn, ảnh…).',
      'Mọi trường hợp không vượt mức trần chung: mười (10) lần tiền thuê một tháng của ô kho cho mỗi sự cố. Kiện còn nguyên niêm phong thì KhoAn không nhận khiếu nại thiếu đồ bên trong.',
      'Ngày ký: ........ / ........ / ............',
    ] },
  ];
  const pdf = await buildContractPdf({
    code: b.code, contractNumber: c?.contractNumber ?? null, facilityName: p.facilityName, customerName: p.customerName, clauses,
    title: 'Bản cam kết gửi kín', subtitle: `Mã đợt nhập ${b.code} · Hợp đồng ${c?.contractNumber ?? '—'} · Mẫu cam kết ${SEALED_PLEDGE_VERSION}`,
    lessorRepresentative: p.lessorRepresentative, lessorAuthorization: p.lessorAuthorization, signature: null, generatedAt: new Date(), printForSigning: true,
  });
  await audit({ action: 'intake.sealed_pledge_print', entityType: 'IntakeBatch', entityId: b._id, facilityId: b.facilityId, changes: { after: { code: b.code, version: SEALED_PLEDGE_VERSION } } });
  return { pdf, filename: `cam-ket-gui-kin-${b.code}.pdf` };
}
