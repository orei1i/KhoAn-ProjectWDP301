import { Types, type ClientSession } from 'mongoose';
import type { SwapMethod } from '@ssm/shared';
import {
  RentalContractModel, ReservationModel, StorageUnitModel, UnitSwapRequestModel, UnitTypeModel, UserModel, type UserHydrated,
} from '../../shared/db/models';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment } from '../payments/payment.service';
import { addDays } from '../../shared/utils/dates';
import { defaultSwapFee, isFreeSwap, SWAP_DECISION_DAYS, SWAP_DELIVERY_GRACE_DAYS, SWAP_FEE_MAX, SWAP_SELF_MOVE_DAYS } from './swap-rules';
import { moveAccessToUnit } from '../contracts/unit-access';
import { cancelOpenAccessRequests } from '../access/access.service';

const loadContract = async (id: string, session?: ClientSession) => {
  const c = await RentalContractModel.findById(id).session(session ?? null);
  if (!c) throw NotFound('hợp đồng');
  return c;
};
const load = async (id: string, session?: ClientSession) => {
  const r = await UnitSwapRequestModel.findById(id).session(session ?? null);
  if (!r) throw NotFound('yêu cầu đổi ô');
  return r;
};

// ---------------------------------------------------------------- gửi yêu cầu (CUSTOMER chủ hợp đồng)
/**
 * Ô mới bị giữ (RESERVED) ngay khi gửi yêu cầu — chưa cần FM duyệt — để không ai khác lấy mất ô
 * khách vừa chọn trong lúc chờ xét duyệt. Nếu FM từ chối thì nhả lại; nếu duyệt thì giữ tiếp tới khi
 * hoàn tất hoặc hết hạn 7 ngày (tự chuyển).
 */
export async function createSwapRequest(user: UserHydrated, contractId: string, input: { toUnitId: string; method: SwapMethod; reason: string }) {
  return withTxn(async (session) => {
    const c = await loadContract(contractId, session);
    await assertCanAccess(user, c, 'swap_request.create');
    if (c.status !== 'ACTIVE') throw Unprocessable('Chỉ đổi ô cho hợp đồng đang hiệu lực');
    if (c.balance.outstanding > 0) throw Unprocessable('Hợp đồng còn công nợ — thu xong mới đổi ô');
    if (String(c.unitId) === String(input.toUnitId)) throw Unprocessable('Ô mới trùng với ô đang thuê');

    const existing = await UnitSwapRequestModel.findOne({ contractId: c._id, status: { $in: ['SUBMITTED', 'APPROVED'] } }).session(session);
    if (existing) throw Conflict('Hợp đồng đang có một yêu cầu đổi ô chưa xử lý xong', 'SWAP_ALREADY_OPEN');

    const id = new Types.ObjectId();
    const now = new Date();
    const toUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: input.toUnitId, facilityId: c.facilityId, unitTypeId: c.unitTypeId, status: 'AVAILABLE', isDeleted: false },
      { $set: { status: 'RESERVED', currentSwapRequestId: id, statusChangedAt: now, statusReason: 'Giữ cho yêu cầu đổi ô đang chờ duyệt' } },
      { new: true, session },
    );
    if (!toUnit) throw Conflict('Ô kho đã chọn không còn trống hoặc không cùng loại với ô đang thuê', 'UNIT_NOT_AVAILABLE');
    await UnitTypeModel.updateOne({ _id: c.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });

    const [req] = await UnitSwapRequestModel.create([{
      _id: id, facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, unitTypeId: c.unitTypeId,
      fromUnitId: c.unitId, toUnitId: toUnit._id, method: input.method, reason: input.reason, status: 'SUBMITTED',
    }], { session });
    await audit({ action: 'swap_request.create', entityType: 'UnitSwapRequest', entityId: id, facilityId: c.facilityId, changes: { after: { requestNumber: req.requestNumber, toUnit: toUnit.unitNumber, method: input.method } } }, session);
    return req;
  });
}

/** Người chuyển phải là NHÂN VIÊN đang hoạt động của đúng chi nhánh đó — không phân công chéo chi nhánh hay tài khoản bị khoá. */
async function loadMover(staffId: string, facilityId: Types.ObjectId, session: ClientSession) {
  const staff = await UserModel.findById(staffId, { fullName: 1, role: 1, status: 1, facilityIds: 1 }).session(session);
  if (!staff || staff.role !== 'STAFF' || staff.status !== 'ACTIVE' || !staff.facilityIds.some((f) => String(f) === String(facilityId))) {
    throw Unprocessable('Người chuyển phải là nhân viên đang hoạt động của chi nhánh này', 'INVALID_MOVER');
  }
  // Ghi chạm vào hồ sơ nhân viên trong CÙNG giao dịch: admin khoá / chuyển chi nhánh người này cùng lúc thì hai giao dịch xung đột ghi,
  // một bên phải chạy lại và thấy trạng thái mới — không có lúc việc vừa giao cho người vừa bị khoá.
  await UserModel.updateOne({ _id: staff._id, status: 'ACTIVE' }, { $set: { updatedAt: new Date() } }, { session });
  return staff;
}

// ---------------------------------------------------------------- duyệt / từ chối (FACILITY_MANAGER)
export async function decideSwapRequest(user: UserHydrated, id: string, input: {
  approve: boolean; facilityFault?: boolean; fee?: number; scheduledFor?: string; assignedStaffId?: string; rejectReason?: string;
}) {
  return withTxn(async (session) => {
    const req = await UnitSwapRequestModel.findById(id).session(session);
    if (!req) throw NotFound('yêu cầu đổi ô');
    await assertFacility(user, req.facilityId, 'swap_request.decide');
    if (req.status !== 'SUBMITTED') throw Unprocessable('Yêu cầu đã được xử lý');

    if (!input.approve) {
      if (!input.rejectReason) throw Unprocessable('Cần ghi lý do từ chối');
      await StorageUnitModel.updateOne(
        { _id: req.toUnitId, status: 'RESERVED', currentSwapRequestId: req._id },
        { $set: { status: 'AVAILABLE', currentSwapRequestId: null, statusChangedAt: new Date(), statusReason: 'Yêu cầu đổi ô bị từ chối' } },
        { session },
      );
      req.rejectReason = input.rejectReason;
      req.transitionTo('REJECTED', { actor: user.role, by: user._id, reason: input.rejectReason });
      await req.save({ session });
      await audit({ action: 'swap_request.reject', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId, reason: input.rejectReason }, session);
      return req;
    }

    if (req.method === 'DELIVERY' && !input.scheduledFor) throw Unprocessable('Thuê người chuyển thì cần hẹn ngày chi nhánh cử người chuyển');
    if (req.method === 'DELIVERY' && !input.assignedStaffId) throw Unprocessable('Thuê người chuyển thì cần phân công nhân viên chuyển', 'MOVER_REQUIRED');
    const mover = req.method === 'DELIVERY' ? await loadMover(input.assignedStaffId!, req.facilityId, session) : null;

    // "Lần đầu" đếm theo mọi lần đổi đã ghi trên hợp đồng (theo yêu cầu lẫn chi nhánh đổi tại quầy) — cùng cách đếm với swapUnit.
    const contract = await RentalContractModel.findById(req.contractId, { unitSwaps: 1 }).session(session).lean();
    const facilityFault = input.facilityFault ?? false;
    const isFirstSwap = (contract?.unitSwaps ?? []).length === 0;
    const defaultFee = defaultSwapFee({ facilityFault, isFirstSwap, method: req.method });
    // Lần đổi đầu / lỗi chi nhánh: miễn phí như đã hứa với khách — phí FM nhập (nếu có) không được áp.
    const fee = isFreeSwap({ facilityFault, isFirstSwap }) ? 0 : Math.max(0, Math.trunc(input.fee ?? defaultFee));
    if (fee > SWAP_FEE_MAX) throw Unprocessable(`Phí đổi ô tối đa ${SWAP_FEE_MAX.toLocaleString('vi-VN')} ₫`);

    req.facilityFault = facilityFault;
    req.fee = fee;
    req.decidedBy = user._id;
    req.decidedAt = new Date();
    if (req.method === 'SELF') req.moveDeadline = addDays(new Date(), SWAP_SELF_MOVE_DAYS);
    else {
      req.scheduledFor = new Date(input.scheduledFor!);
      req.assignedStaffId = mover!._id;
      req.assignedStaffName = mover!.fullName;
    }
    req.transitionTo('APPROVED', { actor: user.role, by: user._id, reason: facilityFault ? 'Lỗi từ chi nhánh — miễn phí' : undefined });
    await req.save({ session });
    await audit({
      action: 'swap_request.approve', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId,
      changes: { after: { fee, facilityFault, method: req.method, moveDeadline: req.moveDeadline, scheduledFor: req.scheduledFor, mover: req.assignedStaffName } },
    }, session);
    return req;
  });
}

// ---------------------------------------------------------------- đổi người / ngày chuyển (FACILITY_MANAGER, khi đã duyệt)
/** Sắp xếp lại nhân viên chuyển đồ (nghỉ ốm, đổi ca…) hoặc dời ngày hẹn — chỉ với yêu cầu DELIVERY đang APPROVED. */
export async function assignSwapMover(user: UserHydrated, id: string, input: { assignedStaffId: string; scheduledFor?: string }) {
  return withTxn(async (session) => {
    const req = await load(id, session);
    await assertFacility(user, req.facilityId, 'swap_request.assign');
    if (req.method !== 'DELIVERY') throw Unprocessable('Chỉ phân công người chuyển cho yêu cầu "Thuê người chuyển"');
    if (req.status !== 'APPROVED') throw Unprocessable('Chỉ đổi người chuyển khi yêu cầu đã duyệt và chưa hoàn tất');
    const mover = await loadMover(input.assignedStaffId, req.facilityId, session);
    const before = { mover: req.assignedStaffName, scheduledFor: req.scheduledFor };
    req.assignedStaffId = mover._id;
    req.assignedStaffName = mover.fullName;
    if (input.scheduledFor) req.scheduledFor = new Date(input.scheduledFor);
    await req.save({ session });
    await audit({ action: 'swap_request.assign', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId, changes: { before, after: { mover: mover.fullName, scheduledFor: req.scheduledFor } } }, session);
    return req;
  });
}

// ---------------------------------------------------------------- hoàn tất (STAFF, FACILITY_MANAGER)
/**
 * Xác nhận khách đã chuyển đồ xong — lúc này mới THẬT SỰ đổi ô: chiếm ô mới (đã giữ từ lúc duyệt),
 * nhả ô cũ về chờ kiểm tra, hợp đồng trỏ sang ô mới, thu phí (nếu có). Cùng bốn bất biến với
 * contract.service.swapUnit (chiếm mới trước, nhả cũ sau, CAS, $inc inventoryVersion).
 */
export async function completeSwapRequest(user: UserHydrated, id: string, input: { keyTag?: string } = {}) {
  return withTxn(async (session) => {
    const req = await UnitSwapRequestModel.findById(id).session(session);
    if (!req) throw NotFound('yêu cầu đổi ô');
    await assertFacility(user, req.facilityId, 'swap_request.complete');
    if (req.status !== 'APPROVED') throw Unprocessable('Chỉ hoàn tất yêu cầu đã được duyệt');

    const c = await RentalContractModel.findById(req.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    if (c.status !== 'ACTIVE') throw Unprocessable('Hợp đồng không còn ở trạng thái đang hiệu lực (nợ quá hạn, đang trả kho hoặc đã đóng) — không đổi ô được; hãy huỷ yêu cầu này để nhả ô đang giữ', 'CONTRACT_NOT_ACTIVE');
    const now = new Date();

    const toUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: req.toUnitId, status: 'RESERVED', currentSwapRequestId: req._id },
      { $set: { status: 'OCCUPIED', currentSwapRequestId: null, currentContractId: c._id, statusChangedAt: now, statusReason: `Đổi ô cho ${c.contractNumber}` } },
      { new: true, session },
    );
    if (!toUnit) throw Conflict('Ô kho không còn ở trạng thái giữ chỗ mong đợi — liên hệ quản lý', 'UNIT_STATE_MISMATCH');

    const fromUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: req.fromUnitId, status: 'OCCUPIED', currentContractId: c._id },
      { $set: { status: 'PENDING_INSPECTION', currentContractId: null, overlockActive: false, statusChangedAt: now, statusReason: `Khách đã chuyển sang ô ${toUnit.unitNumber}` } },
      { new: true, session },
    );
    if (!fromUnit) throw Conflict('Ô kho đang thuê không ở trạng thái mong đợi — liên hệ quản lý', 'UNIT_STATE_MISMATCH');

    const feePayment = req.fee > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'PENALTY', amount: req.fee, status: 'PENDING', method: 'INTERNAL' }, session)
      : null;

    c.unitId = toUnit._id;
    c.unitSwaps = [...(c.unitSwaps ?? []), { fromUnitId: fromUnit._id, toUnitId: toUnit._id, reason: req.reason, fee: req.fee, paymentId: feePayment?._id ?? null, at: now, by: user._id }];
    if (req.fee > 0) c.balance.outstanding += req.fee;
    // Hình thức khoá đi theo Ô: ô mới khác khoá thì hợp đồng đổi theo và cấp phương tiện mới.
    const access = moveAccessToUnit(c, toUnit, user._id, input.keyTag);
    await c.save({ session });
    // Ô mới khác khoá, hoặc cùng loại nhưng đã giao thẻ / chìa của ô mới → yêu cầu cấp lại của ô cũ không còn ý nghĩa.
    if (access.changed || (input.keyTag && c.access.method !== 'PIN')) await cancelOpenAccessRequests(c._id, 'Đã đổi ô và giao phương tiện mở kho mới — huỷ yêu cầu cấp lại, hoàn phí', session);

    // Đặt chỗ gốc đi theo hợp đồng để lịch sử của khách không lệch ô (giống contract.service.swapUnit).
    await ReservationModel.updateOne({ _id: c.reservationId, status: 'CHECKED_IN' }, { $set: { unitId: toUnit._id } }, { session });
    await UnitTypeModel.updateOne({ _id: c.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });

    req.completedAt = now;
    req.paymentId = feePayment?._id ?? null;
    req.transitionTo('DONE', { actor: user.role, by: user._id });
    await req.save({ session });

    await audit({
      action: 'swap_request.complete', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId,
      changes: { before: { unit: fromUnit.unitNumber }, after: { unit: toUnit.unitNumber, fee: req.fee } },
    }, session);
    return { request: req, contract: c, fromUnit, toUnit, accessChanged: access.changed, pin: access.pin }; // mật khẩu mới (nếu có) trả về đúng một lần
  });
}

// ---------------------------------------------------------------- khách tự rút (CUSTOMER, khi còn SUBMITTED)
export async function cancelSwapRequest(user: UserHydrated, id: string) {
  return withTxn(async (session) => {
    const req = await load(id, session);
    await assertCanAccess(user, req, 'swap_request.cancel');
    // Đã duyệt nhưng CHƯA chuyển vẫn huỷ được (khách đổi ý, hoặc quản lý huỷ vì không thực hiện được) — nếu không, ô đích
    // bị giữ vô thời hạn. Khách chỉ huỷ yêu cầu của mình; quản lý chỉ trong chi nhánh mình (assertCanAccess ở trên).
    if (req.status !== 'SUBMITTED' && req.status !== 'APPROVED') throw Unprocessable('Chỉ huỷ được yêu cầu đang chờ duyệt hoặc đã duyệt nhưng chưa chuyển');
    await StorageUnitModel.updateOne(
      { _id: req.toUnitId, status: 'RESERVED', currentSwapRequestId: req._id },
      { $set: { status: 'AVAILABLE', currentSwapRequestId: null, statusChangedAt: new Date(), statusReason: user.role === 'CUSTOMER' ? 'Khách đã rút yêu cầu đổi ô' : 'Chi nhánh huỷ yêu cầu đổi ô' } },
      { session },
    );
    await UnitTypeModel.updateOne({ _id: req.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });
    req.transitionTo('CANCELLED', { actor: user.role, by: user._id, reason: user.role === 'CUSTOMER' ? 'Khách rút yêu cầu' : 'Chi nhánh huỷ' });
    await req.save({ session });
    await audit({ action: 'swap_request.cancel', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId }, session);
    return req;
  });
}

// ---------------------------------------------------------------- job nền: hết hạn 7 ngày tự chuyển
/**
 * Hợp đồng không còn đổi ô được nữa (khách đã trả kho, hợp đồng đóng, hoặc chi nhánh đã đổi ô trực tiếp): huỷ mọi yêu cầu
 * đổi ô còn treo của nó và nhả ô đang giữ. Gọi TRONG transaction của thao tác làm hợp đồng đổi trạng thái.
 */
export async function releaseOpenSwapRequests(contractId: Types.ObjectId, session: ClientSession, reason: string) {
  const open = await UnitSwapRequestModel.find({ contractId, status: { $in: ['SUBMITTED', 'APPROVED'] } }).session(session);
  for (const req of open) {
    await StorageUnitModel.updateOne(
      { _id: req.toUnitId, status: 'RESERVED', currentSwapRequestId: req._id },
      { $set: { status: 'AVAILABLE', currentSwapRequestId: null, statusChangedAt: new Date(), statusReason: `Huỷ yêu cầu đổi ô — ${reason}` } },
      { session },
    );
    await UnitTypeModel.updateOne({ _id: req.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });
    req.transitionTo('CANCELLED', { actor: 'SYSTEM', reason });
    await req.save({ session });
    await audit({ action: 'swap_request.cancel', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId, reason }, session);
  }
  return open.length;
}

export async function expireSwapRequests() {
  const now = new Date();
  // Tự chuyển: quá hạn 7 ngày. Thuê người chuyển: quá ngày hẹn chuyển thêm vài ngày mà vẫn chưa xác nhận xong → coi như
  // không thực hiện; trước đây loại này không bao giờ hết hạn nên ô đích bị giữ mãi.
  // Chờ duyệt quá SWAP_DECISION_DAYS ngày (vd quản lý nghỉ / bỏ sót) cũng hết hạn — ô đích đang giữ cho yêu cầu được nhả.
  const stale = await UnitSwapRequestModel.find({ $or: [
    { status: 'APPROVED', method: 'SELF', moveDeadline: { $lte: now } },
    { status: 'APPROVED', method: 'DELIVERY', scheduledFor: { $lte: addDays(now, -SWAP_DELIVERY_GRACE_DAYS) } },
    { status: 'SUBMITTED', createdAt: { $lte: addDays(now, -SWAP_DECISION_DAYS) } },
  ] }, { _id: 1 }).limit(100).lean();
  for (const { _id } of stale) {
    try {
      await withTxn(async (session) => {
        const req = await UnitSwapRequestModel.findById(_id).session(session);
        if (!req || (req.status !== 'APPROVED' && req.status !== 'SUBMITTED')) return;
        const undecided = req.status === 'SUBMITTED';
        await StorageUnitModel.updateOne(
          { _id: req.toUnitId, status: 'RESERVED', currentSwapRequestId: req._id },
          { $set: { status: 'AVAILABLE', currentSwapRequestId: null, statusChangedAt: new Date(), statusReason: undecided ? 'Yêu cầu đổi ô quá hạn duyệt' : 'Yêu cầu đổi ô quá hạn thực hiện' } },
          { session },
        );
        req.transitionTo('EXPIRED', { actor: 'SYSTEM', reason: undecided ? `Chi nhánh chưa xét trong ${SWAP_DECISION_DAYS} ngày` : undefined });
        await req.save({ session });
        await audit({ action: 'swap_request.expire', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId }, session);
      });
    } catch (e) { console.error('swap-expiry', _id, e); }
  }
  if (stale.length) console.log(`[job:swap-expiry] hết hạn ${stale.length} yêu cầu`);
}

// ---------------------------------------------------------------- truy vấn
export async function listSwapRequestsForContract(user: UserHydrated, contractId: string) {
  const c = await loadContract(contractId);
  await assertCanAccess(user, c, 'swap_request.read');
  return UnitSwapRequestModel.find({ contractId }).sort({ createdAt: -1 });
}

export async function getSwapRequest(user: UserHydrated, id: string) {
  const req = await load(id);
  await assertFacility(user, req.facilityId, 'swap_request.read');
  return req;
}

export interface SwapQueueFilter { facilityId?: string; status?: string }
export async function listSwapRequestsQueue(user: UserHydrated, filter: SwapQueueFilter, page: number, limit: number) {
  const q: Record<string, unknown> = {};
  if (filter.facilityId) { await assertFacility(user, filter.facilityId, 'swap_request.read'); q.facilityId = filter.facilityId; }
  else if (user.role === 'STAFF' || user.role === 'FACILITY_MANAGER') q.facilityId = { $in: user.facilityIds };
  if (filter.status) q.status = filter.status;
  const [items, total] = await Promise.all([
    UnitSwapRequestModel.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('customerId', 'fullName phone').populate('fromUnitId', 'unitNumber').populate('toUnitId', 'unitNumber'),
    UnitSwapRequestModel.countDocuments(q),
  ]);
  return { items, total, page, limit };
}
