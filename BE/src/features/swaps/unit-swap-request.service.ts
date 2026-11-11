import { SETTLE_GRACE_MS } from '../payments/gateway-order.service';
import { Types, type ClientSession } from 'mongoose';
import { isValidPerformedBy, normalizePerformedBy, PERFORMED_BY_MESSAGE, type PaymentMethod, type SwapMethod } from '@ssm/shared';
import { GatewayOrderModel, PaymentModel,
  RentalContractModel, ReservationModel, StorageUnitModel, SWAP_STAFF_FIELDS, UnitSwapRequestModel, UnitTypeModel, type UnitSwapRequestHydrated, type UserHydrated,
} from '../../shared/db/models';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { assertOnlineGateway, counterPay, createPayment, refundMethodFor, requireTxnRef } from '../payments/payment.service';
import { gatewayProvider, inTxnOf, isGatewayFlow, openGatewayOrder, type PayCtx } from '../payments/gateway-order.service';
import { addDays, todayUTC } from '../../shared/utils/dates';
import { defaultSwapFee, isFreeSwap, SWAP_DECISION_DAYS, SWAP_DELIVERY_GRACE_DAYS, SWAP_FEE_MAX, SWAP_SELF_MOVE_DAYS } from './swap-rules';
import { moveAccessToUnit, oldUnitAccessReset } from '../contracts/unit-access';
import { assertContractProfile } from '../users/user.service';
import { humanCode } from '../../shared/db/schema-kit';
import { sizeChangeAppendixTitle, TERMS_VERSION } from '@ssm/shared';
import { applySizeChange, sizeChangeAppendixFor, sizeChangeQuote } from './size-change.service';
import { cancelOpenAccessRequests } from '../access/access.service';
import { mailCustomer } from '../contracts/contract-notice.service';
import { notifyStaff } from '../notify/staff-notify';
import { fmtDate, OPEN_INTAKE_BATCH_STATUSES, SWAP_METHOD, swapBlockedByIntakeText, vnd } from '@ssm/shared';
import { IntakeBatchModel } from '../intake/intake-batch.model';

/**
 * RV3: còn đợt nhập hàng CHƯA được nhân viên xác nhận (khách đã khai, chưa kiểm hàng cấm) thì chưa đổi ô — danh sách đồ trong ô chưa chốt,
 * chuyển đi rồi không biết đợt đó thuộc ô nào và đồ nào đã thật sự vào kho. Chặn cả lúc gửi, duyệt và hoàn tất yêu cầu đổi ô.
 */
async function assertNoOpenIntake(contractId: unknown, session: ClientSession) {
  const open = await IntakeBatchModel.findOne({ contractId, status: { $in: OPEN_INTAKE_BATCH_STATUSES } }, { code: 1 }).session(session).lean();
  if (open) throw new AppError(422, 'INTAKE_PENDING', swapBlockedByIntakeText(open.code), { intakeCode: open.code });
}

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
 *
 * Đợt 15 (C3): ô mới thuộc LOẠI kho khác (cùng chi nhánh) = ĐỔI CỠ KHO — khách phải xác nhận Phụ lục "Đổi cỡ kho" (`acceptAppendix`) và
 * gửi kèm báo giá đã xem (`expected` = giá thuê mới + tiền giữ chân mới; lệch → 409 PRICE_CHANGED). Giá chốt + nguyên văn phụ lục lưu ở
 * `sizeChange`; phụ lục có hiệu lực khi hoàn tất.
 */
export async function createSwapRequest(
  user: UserHydrated, contractId: string,
  input: { toUnitId: string; method: SwapMethod; reason: string; acceptAppendix?: boolean; expected?: { rate: number; deposit: number } },
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const created = await withTxn(async (session) => {
    const c = await loadContract(contractId, session);
    await assertCanAccess(user, c, 'swap_request.create');
    if (c.status !== 'ACTIVE') throw Unprocessable('Chỉ đổi ô cho hợp đồng đang hiệu lực');
    if (c.balance.outstanding > 0) throw Unprocessable('Hợp đồng còn công nợ — thu xong mới đổi ô');
    if (String(c.unitId) === String(input.toUnitId)) throw Unprocessable('Ô mới trùng với ô đang thuê');
    await assertNoOpenIntake(c._id, session);

    const existing = await UnitSwapRequestModel.findOne({ contractId: c._id, status: { $in: ['SUBMITTED', 'APPROVED'] } }).session(session);
    if (existing) throw Conflict('Hợp đồng đang có một yêu cầu đổi ô chưa xử lý xong', 'SWAP_ALREADY_OPEN');

    const id = new Types.ObjectId();
    const requestNumber = humanCode('SWP');
    const now = new Date();
    // Loại kho của ô khách chọn: khác loại đang thuê → đổi cỡ kho (báo giá + phụ lục), cùng loại → đổi ô như cũ.
    const target = await StorageUnitModel.findOne({ _id: input.toUnitId, facilityId: c.facilityId, isDeleted: false }, { unitTypeId: 1 }).session(session).lean();
    const toTypeId = target?.unitTypeId ?? c.unitTypeId;
    const resize = String(toTypeId) !== String(c.unitTypeId);
    let sizeChange: Record<string, unknown> | null = null;
    if (resize) {
      assertContractProfile(user); // phụ lục ghi thông tin Bên B theo hồ sơ
      if (!input.acceptAppendix) throw Unprocessable('Đổi sang loại kho khác là sửa đổi hợp đồng — bạn cần đọc và xác nhận Phụ lục đổi cỡ kho', 'APPENDIX_NOT_ACCEPTED');
      if (!input.expected) throw Unprocessable('Gửi kèm báo giá đổi cỡ kho đã xem (giá thuê mới, tiền giữ chân mới)', 'QUOTE_REQUIRED');
      const x = await sizeChangeQuote(c, toTypeId, todayUTC(), session);
      // Đợt VNPAY: chiều ngược của RESIZE_PENDING — đang có gia hạn chờ trả qua cổng (còn trong hạn + khoảng chờ đối soát) thì chưa đổi cỡ.
      if (await GatewayOrderModel.exists({ contractId: c._id, kind: 'EXTEND', status: 'PENDING', expireAt: { $gt: new Date(Date.now() - SETTLE_GRACE_MS) } }).session(session)) {
        throw Unprocessable('Đang chờ thanh toán gia hạn — hoàn tất hoặc đợi hết hạn rồi mới đổi cỡ', 'RENEWAL_PAYMENT_PENDING');
      }
      if (x.rate !== input.expected.rate || x.deposit !== input.expected.deposit) {
        throw new AppError(409, 'PRICE_CHANGED', 'Báo giá đổi cỡ kho đã thay đổi so với bản bạn đang xem — xem lại báo giá mới rồi xác nhận', { rate: x.rate, deposit: x.deposit });
      }
      const appendix = await sizeChangeAppendixFor(c, x, { requestNumber, toUnitId: input.toUnitId }, session);
      // Đợt 16 (A4): ghi chạm hợp đồng trong CÙNG giao dịch — gia hạn đồng thời (ghi hợp đồng) xung đột ghi, bên chạy lại thấy bên kia:
      // gia hạn sau thì bị chặn RESIZE_PENDING.
      await RentalContractModel.updateOne({ _id: c._id }, { $set: { updatedAt: now } }, { session });
      sizeChange = {
        fromUnitTypeId: c.unitTypeId, toUnitTypeId: toTypeId, rentalPeriod: x.period, currentRate: x.currentRate, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate,
        currentDeposit: x.currentDeposit, deposit: x.deposit, depositDiff: x.depositDiff, useAirConditioning: x.useAc,
        estimate: { from: x.at, rentDiff: x.proration.total }, servicesCancelled: x.servicesCancelled,
        // Nguyên văn phụ lục + dấu vết xác nhận điện tử của Bên B (ai, lúc nào, từ đâu); số thứ tự cấp khi phụ lục có hiệu lực.
        appendix: {
          number: null, title: sizeChangeAppendixTitle(null), acceptedAt: now, signerName: user.fullName, signedBy: user._id, termsVersion: TERMS_VERSION,
          ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, clauses: appendix.clauses,
          lessorSignatory: { name: appendix.parties.lessorRepresentative, authorization: appendix.parties.lessorAuthorization },
        },
      };
    }
    const toUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: input.toUnitId, facilityId: c.facilityId, unitTypeId: toTypeId, status: 'AVAILABLE', isDeleted: false },
      { $set: { status: 'RESERVED', currentSwapRequestId: id, statusChangedAt: now, statusReason: resize ? 'Giữ cho yêu cầu đổi cỡ kho đang chờ duyệt' : 'Giữ cho yêu cầu đổi ô đang chờ duyệt' } },
      { new: true, session },
    );
    if (!toUnit) throw Conflict('Ô kho đã chọn không còn trống', 'UNIT_NOT_AVAILABLE');
    await UnitTypeModel.updateOne({ _id: toTypeId }, { $inc: { inventoryVersion: 1 } }, { session });

    const [req] = await UnitSwapRequestModel.create([{
      _id: id, requestNumber, facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, unitTypeId: c.unitTypeId, toUnitTypeId: toTypeId,
      fromUnitId: c.unitId, toUnitId: toUnit._id, method: input.method, reason: input.reason, status: 'SUBMITTED', sizeChange,
    }], { session });
    await audit({ action: 'swap_request.create', entityType: 'UnitSwapRequest', entityId: id, facilityId: c.facilityId, changes: { after: {
      requestNumber: req.requestNumber, toUnit: toUnit.unitNumber, method: input.method,
      ...(sizeChange ? { sizeChange: { toUnitTypeId: toTypeId, rate: sizeChange.rate, deposit: sizeChange.deposit, estimate: sizeChange.estimate } } : {}),
    } } }, session);
    return { req, contractNumber: c.contractNumber, fromUnit: await unitNo(c.unitId, session), toUnit: toUnit.unitNumber, resize };
  });
  // Đợt 16 (C8): báo quản lý chi nhánh có yêu cầu đổi ô / đổi cỡ mới (sau commit, không chặn phản hồi).
  const { req } = created;
  void notifyStaff({ roles: ['FACILITY_MANAGER'], facilityId: req.facilityId }, `KhoAn — Yêu cầu ${created.resize ? 'đổi cỡ kho' : 'đổi ô'} mới ${req.requestNumber}`, [
    `Khách ${user.fullName} gửi yêu cầu ${created.resize ? 'đổi cỡ kho' : 'đổi ô'} ${req.requestNumber} cho hợp đồng ${created.contractNumber}: ô ${created.fromUnit} → ô ${created.toUnit} (${SWAP_METHOD[req.method].toLowerCase()}).`,
    `Lý do: ${req.reason}`,
    `Xét trong ${SWAP_DECISION_DAYS} ngày ở mục Đổi ô của chi nhánh — quá hạn yêu cầu tự hết hạn.`,
  ]);
  return req;
}

/** Mã ô (hiển thị trong email). */
async function unitNo(id: unknown, session?: ClientSession) {
  return (await StorageUnitModel.findById(id, { unitNumber: 1 }).session(session ?? null).lean())?.unitNumber ?? '—';
}

/** Đợt 16 (C8): email khách khi yêu cầu đổi ô / đổi cỡ được duyệt / bị từ chối / tự hết hạn — gửi sau commit, không chặn phản hồi. */
function mailSwapDecision(req: { customerId: unknown; requestNumber: string; method: SwapMethod; sizeChange?: unknown; fee?: number; feePrepay?: boolean; moveDeadline?: Date | null; scheduledFor?: Date | null; rejectReason?: string | null; feeRefundPaymentId?: unknown }, kind: 'APPROVED' | 'REJECTED' | 'EXPIRED', toUnit: string) {
  const what = req.sizeChange ? 'đổi cỡ kho' : 'đổi ô';
  const moveDay = req.scheduledFor ? fmtDate(req.scheduledFor.toISOString()) : '—';
  const lines = kind === 'APPROVED'
    ? [
      `Yêu cầu ${what} ${req.requestNumber} sang ô ${toUnit} đã được duyệt${!req.fee ? ' — miễn phí' : req.feePrepay ? ` — phí thuê người chuyển ${vnd(req.fee)}` : ` — phí ${vnd(req.fee)} cộng vào khoản phải thanh toán`}.`,
      req.method === 'SELF'
        ? `Bạn tự chuyển đồ trước ${req.moveDeadline ? fmtDate(req.moveDeadline.toISOString()) : 'hạn trong tài khoản'}; xong thì báo nhân viên tại quầy để nhận phương tiện mở kho MỚI của ô mới (mật khẩu mới xem trong tài khoản, hoặc chìa / thẻ mới) và trả lại chìa / thẻ ô cũ.`
        : `Chi nhánh chuyển đồ ngày ${moveDay}. Xong việc bạn nhận phương tiện mở kho mới của ô mới.`,
      ...(req.feePrepay && req.fee ? [`Vui lòng trả phí ${vnd(req.fee)} trong tài khoản (Kho đang thuê) hoặc tại quầy trước ngày ${moveDay}: chưa trả thì chi nhánh chưa chuyển đồ được. Huỷ yêu cầu hoặc quá hạn thì phí được hoàn đủ.`] : []),
    ]
    : kind === 'REJECTED'
      ? [`Yêu cầu ${what} ${req.requestNumber} không được duyệt. Lý do: ${req.rejectReason ?? '—'}.`, 'Ô bạn chọn đã được nhả. Bạn có thể gửi yêu cầu khác trong tài khoản.']
      : [
        `Yêu cầu ${what} ${req.requestNumber} đã hết hạn (chi nhánh chưa xét hoặc chưa chuyển xong đúng hạn) — ô đang giữ cho yêu cầu đã được nhả.`,
        ...(req.feeRefundPaymentId && req.fee ? [`Phí đã trả ${vnd(req.fee)} được hoàn đủ theo hình thức bạn đã thanh toán, tối đa 7 ngày làm việc.`] : []),
        'Bạn có thể gửi lại yêu cầu trong tài khoản; cần hỗ trợ, vui lòng liên hệ chi nhánh.',
      ];
  const head = kind === 'APPROVED' ? 'đã được duyệt' : kind === 'REJECTED' ? 'không được duyệt' : 'đã hết hạn';
  void mailCustomer(req.customerId, `KhoAn — Yêu cầu ${what} ${req.requestNumber} ${head}`, lines);
}

// ---------------------------------------------------------------- duyệt / từ chối (FACILITY_MANAGER)
export async function decideSwapRequest(user: UserHydrated, id: string, input: {
  approve: boolean; facilityFault?: boolean; fee?: number; scheduledFor?: string; rejectReason?: string;
}) {
  const req = await withTxn(async (session) => {
    const req = await UnitSwapRequestModel.findById(id).session(session);
    if (!req) throw NotFound('yêu cầu đổi ô');
    await assertFacility(user, req.facilityId, 'swap_request.decide');
    if (req.status !== 'SUBMITTED') throw Unprocessable('Yêu cầu đã được xử lý');

    if (input.approve) await assertNoOpenIntake(req.contractId, session);
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

    // Quản lý chia việc chuyển đồ ngoài hệ thống: lúc duyệt chỉ cần ngày hẹn; người thực hiện ghi lúc hoàn tất.
    if (req.method === 'DELIVERY' && !input.scheduledFor) throw Unprocessable('Thuê người chuyển thì cần hẹn ngày chi nhánh cử người chuyển');

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
      req.feePrepay = fee > 0; // thuê người chuyển có phí: trả trước khi chuyển (paySwapFee); chưa trả thì chưa hoàn tất được
    }
    req.transitionTo('APPROVED', { actor: user.role, by: user._id, reason: facilityFault ? 'Lỗi từ chi nhánh — miễn phí' : undefined });
    await req.save({ session });
    await audit({
      action: 'swap_request.approve', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId,
      changes: { after: { fee, facilityFault, method: req.method, moveDeadline: req.moveDeadline, scheduledFor: req.scheduledFor, feePrepay: req.feePrepay } },
    }, session);
    return req;
  });
  mailSwapDecision(req, req.status === 'APPROVED' ? 'APPROVED' : 'REJECTED', await unitNo(req.toUnitId));
  return req;
}

// ---------------------------------------------------------------- trả trước phí thuê người chuyển (CUSTOMER chủ yêu cầu; STAFF, FM thu tại quầy)
/**
 * Yêu cầu DELIVERY có phí đã duyệt (`feePrepay`): khách trả online (MOCK thành công ngay; VNPAY: 202 như 5 luồng khác, settle chạy lại chính hàm này với `gw.run`) hoặc nhân
 * viên / quản lý thu tại quầy (`recordedBy`, không phải tiền mặt thì bắt buộc mã giao dịch như pay-balance). Giữ `type: 'PENALTY'` như khoản phí lúc hoàn tất: báo cáo không đổi.
 * Chống trùng: ghi chạm CAS trên yêu cầu (status APPROVED, paymentId null) TRƯỚC khi ghi sổ; hai lượt song song xung đột ghi, bên chạy lại thấy đã trả → trả lại kết quả cũ.
 * Tiền đã vào mà yêu cầu không còn APPROVED / đã có người trả → lỗi nghiệp vụ → settle ghi PAID_UNAPPLIED và tự hoàn toàn phần.
 */
export async function paySwapFee(user: UserHydrated, id: string, input: { method: PaymentMethod; txnRef?: string; expectedFee?: number }, gw: PayCtx = {}) {
  if (user.role === 'CUSTOMER' && input.method === 'CASH') throw Unprocessable('Thanh toán tiền mặt chỉ thực hiện tại quầy');
  if (!gw.run) assertOnlineGateway(user, input.method);
  const counter = user.role === 'CUSTOMER' ? null : counterPay(user, input.method, requireTxnRef(input.method, input.txnRef));
  return inTxnOf(gw)(async (session) => {
    const req = await load(id, session);
    await assertCanAccess(user, req, 'swap_request.pay_fee');
    if (req.status !== 'APPROVED') throw Conflict('Yêu cầu đổi ô không còn chờ chuyển — không thu phí nữa', 'SWAP_NOT_APPROVED');
    if (!req.feePrepay || req.fee <= 0) throw Unprocessable('Yêu cầu này không cần trả trước phí', 'SWAP_FEE_NOT_REQUIRED');
    if (req.paymentId) {
      if (gw.run) throw Conflict('Phí đổi ô đã được thanh toán', 'ALREADY_PAID');
      return { request: req, amount: req.fee, paymentIds: [req.paymentId], replayed: true };
    }
    const c = await loadContract(String(req.contractId), session);
    if (c.status !== 'ACTIVE') throw Unprocessable('Hợp đồng không còn ở trạng thái đang hiệu lực (nợ quá hạn, đang trả kho hoặc đã đóng) — chưa trả phí đổi ô được', 'CONTRACT_NOT_ACTIVE');
    if (input.expectedFee !== undefined && input.expectedFee !== req.fee) {
      throw new AppError(409, 'PRICE_CHANGED', `Phí đổi ô là ${vnd(req.fee)} (bạn đang xem ${vnd(input.expectedFee)}) — kiểm tra lại rồi bấm thanh toán`, { fee: req.fee, expectedFee: input.expectedFee });
    }
    // Đợt VNPAY: lần chạy đầu dừng ở đây, chưa thu.
    if (!gw.run && isGatewayFlow(user)) {
      return openGatewayOrder({
        kind: 'SWAP_FEE', targetKey: `SWAP_FEE:${req._id}`, facilityId: req.facilityId, customerId: req.customerId, contractId: req.contractId, amount: req.fee,
        payload: { swapRequestId: String(req._id), expectedFee: req.fee },
      }, gw.start, session);
    }
    const claimed = await UnitSwapRequestModel.findOneAndUpdate({ _id: req._id, status: 'APPROVED', paymentId: null }, { $set: { updatedAt: new Date() } }, { new: true, session });
    if (!claimed) throw Conflict('Phí đổi ô đã được thanh toán', 'ALREADY_PAID');
    const pay = await createPayment({
      facilityId: req.facilityId, customerId: req.customerId, contractId: req.contractId, type: 'PENALTY', amount: req.fee, status: 'SUCCEEDED', method: input.method,
      ...(counter ?? {}), idempotencyKey: `swap-fee-${req._id}`, ...(gw.run ? { gateway: gatewayProvider(gw.run.order, 1) } : {}),
    }, session);
    claimed.paymentId = pay._id;
    await claimed.save({ session });
    await audit({ action: 'swap_request.pay_fee', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId, changes: { after: { fee: req.fee, method: input.method, atCounter: !!counter, txnRef: counter?.txnRef ?? null } } }, session);
    if (gw.run) gw.run.applied = { paymentIds: [pay._id], result: null };
    return { request: claimed, amount: req.fee, paymentIds: [pay._id], replayed: false };
  });
}

/** Yêu cầu kết thúc mà chưa chuyển (huỷ, hết hạn, đóng hợp đồng): phí đã trả trước hoàn đủ, theo khoản gốc (qua cổng thì vào hàng đợi hoàn). Trả số đã hoàn. Gọi TRONG transaction. */
async function refundPrepaidFee(req: UnitSwapRequestHydrated, session: ClientSession, reason: string) {
  if (!req.paymentId) return 0;
  const paid = await PaymentModel.findById(req.paymentId).session(session);
  if (!paid || paid.status !== 'SUCCEEDED') return 0;
  const refund = await createPayment({
    facilityId: req.facilityId, customerId: req.customerId, contractId: req.contractId, type: 'REFUND', amount: paid.amount, status: 'SUCCEEDED', method: refundMethodFor(paid), refundOf: paid._id,
    idempotencyKey: `swap-fee-refund-${req._id}`,
  }, session);
  paid.refundedAmount = paid.amount;
  paid.transitionTo('REFUNDED', { actor: 'SYSTEM', reason });
  await paid.save({ session });
  req.feeRefundPaymentId = refund._id;
  return paid.amount;
}

// ---------------------------------------------------------------- dời ngày chuyển (FACILITY_MANAGER, khi đã duyệt)
/** Dời ngày hẹn của yêu cầu DELIVERY đang APPROVED, không phải huỷ rồi gửi lại. Phí đã trả giữ nguyên. */
export async function rescheduleSwapDelivery(user: UserHydrated, id: string, input: { scheduledFor: string }) {
  const req = await withTxn(async (session) => {
    const r = await load(id, session);
    await assertFacility(user, r.facilityId, 'swap_request.reschedule');
    if (r.method !== 'DELIVERY') throw Unprocessable('Chỉ dời ngày cho yêu cầu "Thuê người chuyển"');
    if (r.status !== 'APPROVED') throw Unprocessable('Chỉ dời ngày khi yêu cầu đã duyệt và chưa hoàn tất');
    const to = new Date(input.scheduledFor);
    if (to < todayUTC()) throw Unprocessable('Ngày chuyển không được ở trong quá khứ');
    const before = { scheduledFor: r.scheduledFor };
    r.scheduledFor = to;
    await r.save({ session });
    await audit({ action: 'swap_request.reschedule', entityType: 'UnitSwapRequest', entityId: r._id, facilityId: r.facilityId, changes: { before, after: { scheduledFor: to } } }, session);
    return r;
  });
  void mailCustomer(req.customerId, `KhoAn — Yêu cầu đổi ô ${req.requestNumber} dời ngày chuyển`, [`Chi nhánh dời ngày chuyển đồ sang ${fmtDate(req.scheduledFor!.toISOString())}.`]);
  return req;
}

// ---------------------------------------------------------------- hoàn tất (STAFF, FACILITY_MANAGER)
/**
 * Xác nhận khách đã chuyển đồ xong — lúc này mới THẬT SỰ đổi ô: chiếm ô mới (đã giữ từ lúc duyệt),
 * nhả ô cũ về chờ kiểm tra, hợp đồng trỏ sang ô mới, thu phí (nếu có). Cùng bốn bất biến với
 * contract.service.swapUnit (chiếm mới trước, nhả cũ sau, CAS, $inc inventoryVersion).
 * Phí trả trước (`feePrepay`): chưa trả → 422 SWAP_FEE_UNPAID; đã trả thì không tạo thêm công nợ. Yêu cầu cũ không có cờ: phí thành công nợ như trước.
 * Thuê người chuyển: bắt buộc ghi người thực hiện (`performedBy`), kể cả phí 0.
 */
export async function completeSwapRequest(user: UserHydrated, id: string, input: { keyTag?: string; oldAccessReset?: boolean; performedBy?: string; moveCheck?: { packages: number; photoUrls: string[]; note?: string } } = {}) {
  return withTxn(async (session) => {
    const req = await UnitSwapRequestModel.findById(id).session(session);
    if (!req) throw NotFound('yêu cầu đổi ô');
    await assertFacility(user, req.facilityId, 'swap_request.complete');
    if (req.status !== 'APPROVED') throw Unprocessable('Chỉ hoàn tất yêu cầu đã được duyệt');

    const c = await RentalContractModel.findById(req.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    if (c.status !== 'ACTIVE') throw Unprocessable('Hợp đồng không còn ở trạng thái đang hiệu lực (nợ quá hạn, đang trả kho hoặc đã đóng) — không đổi ô được; hãy huỷ yêu cầu này để nhả ô đang giữ', 'CONTRACT_NOT_ACTIVE');
    await assertNoOpenIntake(c._id, session);
    const prepaid = req.feePrepay && req.fee > 0;
    if (prepaid) {
      const paid = req.paymentId ? await PaymentModel.exists({ _id: req.paymentId, status: 'SUCCEEDED' }).session(session) : null;
      if (!paid) throw Unprocessable(`Khách chưa trả phí thuê người chuyển ${vnd(req.fee)} — thu xong mới hoàn tất được`, 'SWAP_FEE_UNPAID');
    }
    const delivery = req.method === 'DELIVERY';
    if (delivery && !isValidPerformedBy(input.performedBy)) throw Unprocessable(PERFORMED_BY_MESSAGE, 'PERFORMED_BY_REQUIRED');
    // RV3: chi nhánh chuyển đồ thì phải có biên bản chuyển đồ (số kiện + ít nhất 1 ảnh) — căn cứ khi khách báo hư hại / mất mát.
    if (delivery && (!input.moveCheck || input.moveCheck.packages < 1 || !input.moveCheck.photoUrls.length)) {
      throw Unprocessable('Chi nhánh chuyển đồ — ghi số kiện đã chuyển và chụp ít nhất 1 ảnh đồ tại ô mới', 'MOVE_CHECK_REQUIRED');
    }
    const performedBy = delivery ? normalizePerformedBy(input.performedBy) : null;
    const now = new Date();

    const toUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: req.toUnitId, status: 'RESERVED', currentSwapRequestId: req._id },
      { $set: { status: 'OCCUPIED', currentSwapRequestId: null, currentContractId: c._id, statusChangedAt: now, statusReason: `Đổi ô cho ${c.contractNumber}` } },
      { new: true, session },
    );
    if (!toUnit) throw Conflict('Ô kho không còn ở trạng thái giữ chỗ mong đợi — liên hệ quản lý', 'UNIT_STATE_MISMATCH');

    // Đợt 16 (B1): ô cũ chờ ghi nhận thu chìa / thẻ cũ hoặc đặt lại ổ khoá (accessReset) mới mở cho thuê lại.
    const fromUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: req.fromUnitId, status: 'OCCUPIED', currentContractId: c._id },
      { $set: { status: 'PENDING_INSPECTION', currentContractId: null, overlockActive: false, statusChangedAt: now, statusReason: `Khách đã chuyển sang ô ${toUnit.unitNumber}`,
        accessReset: oldUnitAccessReset(c, now, input.oldAccessReset ? { by: user._id, byName: user.fullName } : null) } },
      { new: true, session },
    );
    if (!fromUnit) throw Conflict('Ô kho đang thuê không ở trạng thái mong đợi — liên hệ quản lý', 'UNIT_STATE_MISMATCH');

    // Đợt 15 (C3): đổi cỡ kho — giá mới từ hôm nay, phần chênh tiền thuê / tiền giữ chân, ràng buộc theo cỡ, phụ lục (trước phí thao tác).
    const sized = req.sizeChange ? await applySizeChange(c, req, user, session) : null;

    // Phí trả trước đã thu từ lúc trả; còn lại thành công nợ lúc hoàn tất như cũ.
    const feePayment = req.fee > 0 && !prepaid
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'PENALTY', amount: req.fee, status: 'PENDING', method: 'INTERNAL' }, session)
      : null;
    const feePaymentId = feePayment?._id ?? req.paymentId ?? null;

    c.unitId = toUnit._id;
    c.unitSwaps = [...(c.unitSwaps ?? []), { fromUnitId: fromUnit._id, toUnitId: toUnit._id, reason: req.reason, fee: req.fee, paymentId: feePaymentId, at: now, by: user._id }];
    if (feePayment) c.balance.outstanding += req.fee;
    // Đợt 16 (B1): đổi ô luôn cấp phương tiện mở MỚI như nhận kho (mật khẩu mới / bắt buộc mã chìa, số thẻ mới).
    const access = moveAccessToUnit(c, toUnit, user._id, input.keyTag);
    await c.save({ session });
    // Đã giao phương tiện mở của ô mới → yêu cầu cấp lại của ô cũ không còn ý nghĩa.
    await cancelOpenAccessRequests(c._id, 'Đã đổi ô và giao phương tiện mở kho mới — huỷ yêu cầu cấp lại, hoàn phí', session);

    // Đặt chỗ gốc đi theo hợp đồng để lịch sử của khách không lệch ô (giống contract.service.swapUnit).
    // Đổi cỡ kho: đặt chỗ gốc vẫn ghi loại kho lúc đặt (lịch sử), chỉ ô đi theo hợp đồng (chỉ mục ô của đặt chỗ đang nhận kho).
    await ReservationModel.updateOne({ _id: c.reservationId, status: 'CHECKED_IN' }, { $set: { unitId: toUnit._id } }, { session });
    await UnitTypeModel.updateMany({ _id: { $in: [req.unitTypeId, c.unitTypeId] } }, { $inc: { inventoryVersion: 1 } }, { session });

    req.completedAt = now;
    req.paymentId = feePaymentId;
    if (performedBy) req.performedBy = performedBy;
    if (delivery && input.moveCheck) req.set('moveCheck', { packages: input.moveCheck.packages, photoUrls: input.moveCheck.photoUrls, note: input.moveCheck.note?.trim() || null, at: now });
    req.transitionTo('DONE', { actor: user.role, by: user._id });
    await req.save({ session });

    await audit({
      action: 'swap_request.complete', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId,
      changes: { before: { unit: fromUnit.unitNumber, ...(sized ? { unitTypeId: sized.fromUnitTypeId } : {}) }, after: { unit: toUnit.unitNumber, fee: req.fee, feePrepaid: !!prepaid, ...(performedBy ? { performedBy } : {}), accessReissued: true, access: c.access.method, oldAccessReset: !!input.oldAccessReset,
        ...(sized ? { unitTypeId: c.unitTypeId, rate: sized.rate, deposit: sized.deposit, rentDiff: sized.rentDiff, depositDiff: sized.depositDiff, appendix: sized.appendixNumber } : {}) } },
    }, session);
    // Mật khẩu mới (nếu có) trả về đúng một lần; sizeChange: phần chênh tiền thuê / tiền giữ chân + các khoản vừa lập (biên lai / chờ chuyển).
    return { request: req, contract: c, fromUnit, toUnit, accessChanged: access.changed, pin: access.pin,
      sizeChange: sized ? { rentDiff: sized.rentDiff, depositDiff: sized.depositDiff, rate: sized.rate, deposit: sized.deposit, appendixNumber: sized.appendixNumber, paymentIds: sized.paymentIds } : null };
  });
}

// ---------------------------------------------------------------- khách tự rút (CUSTOMER, khi còn SUBMITTED)
export async function cancelSwapRequest(user: UserHydrated, id: string) {
  const req = await withTxn(async (session) => {
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
    await UnitTypeModel.updateOne({ _id: req.toUnitTypeId ?? req.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session }); // loại của ô đang giữ
    const refunded = await refundPrepaidFee(req, session, 'Huỷ yêu cầu đổi ô — hoàn đủ phí');
    req.transitionTo('CANCELLED', { actor: user.role, by: user._id, reason: user.role === 'CUSTOMER' ? 'Khách rút yêu cầu' : 'Chi nhánh huỷ' });
    await req.save({ session });
    await audit({ action: 'swap_request.cancel', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId, changes: { after: { feeRefund: refunded } } }, session);
    return req;
  });
  if (req.feeRefundPaymentId) {
    void mailCustomer(req.customerId, `KhoAn — Yêu cầu đổi ô ${req.requestNumber} đã huỷ, hoàn phí ${vnd(req.fee)}`, [
      `Yêu cầu đổi ô ${req.requestNumber} đã huỷ. Phí đã trả ${vnd(req.fee)} được hoàn đủ theo hình thức bạn đã thanh toán, tối đa 7 ngày làm việc.`,
    ]);
  }
  return req;
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
    await UnitTypeModel.updateOne({ _id: req.toUnitTypeId ?? req.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session }); // loại của ô đang giữ
    const refunded = await refundPrepaidFee(req, session, `Huỷ yêu cầu đổi ô — ${reason}`);
    req.transitionTo('CANCELLED', { actor: 'SYSTEM', reason });
    await req.save({ session });
    await audit({ action: 'swap_request.cancel', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId, reason, changes: { after: { feeRefund: refunded } } }, session);
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
      const expired = await withTxn(async (session) => {
        const req = await UnitSwapRequestModel.findById(_id).session(session);
        if (!req || (req.status !== 'APPROVED' && req.status !== 'SUBMITTED')) return null;
        const undecided = req.status === 'SUBMITTED';
        await StorageUnitModel.updateOne(
          { _id: req.toUnitId, status: 'RESERVED', currentSwapRequestId: req._id },
          { $set: { status: 'AVAILABLE', currentSwapRequestId: null, statusChangedAt: new Date(), statusReason: undecided ? 'Yêu cầu đổi ô quá hạn duyệt' : 'Yêu cầu đổi ô quá hạn thực hiện' } },
          { session },
        );
        // Như các chỗ nhả ô khác: tăng inventoryVersion của loại kho có ô vừa nhả (khách đang xem danh mục thấy chỗ trống mới).
        await UnitTypeModel.updateOne({ _id: req.toUnitTypeId ?? req.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });
        const refunded = await refundPrepaidFee(req, session, 'Yêu cầu đổi ô hết hạn — hoàn đủ phí');
        req.transitionTo('EXPIRED', { actor: 'SYSTEM', reason: undecided ? `Chi nhánh chưa xét trong ${SWAP_DECISION_DAYS} ngày` : undefined });
        await req.save({ session });
        await audit({ action: 'swap_request.expire', entityType: 'UnitSwapRequest', entityId: req._id, facilityId: req.facilityId, changes: { after: { feeRefund: refunded } } }, session);
        return req;
      });
      if (expired) mailSwapDecision(expired, 'EXPIRED', await unitNo(expired.toUnitId)); // C8
    } catch (e) { console.error('swap-expiry', _id, e); }
  }
  if (stale.length) console.log(`[job:swap-expiry] hết hạn ${stale.length} yêu cầu`);
}

// ---------------------------------------------------------------- truy vấn
export async function listSwapRequestsForContract(user: UserHydrated, contractId: string) {
  const c = await loadContract(contractId);
  await assertCanAccess(user, c, 'swap_request.read');
  // Người thực hiện, người được phân công khai báo select: false: chỉ nhân sự mới xin.
  return UnitSwapRequestModel.find({ contractId }).select(user.role === 'CUSTOMER' ? {} : SWAP_STAFF_FIELDS).sort({ createdAt: -1 });
}

export async function getSwapRequest(user: UserHydrated, id: string) {
  const req = await UnitSwapRequestModel.findById(id).select(SWAP_STAFF_FIELDS);
  if (!req) throw NotFound('yêu cầu đổi ô');
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
    UnitSwapRequestModel.find(q).select(SWAP_STAFF_FIELDS).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('customerId', 'fullName phone').populate('fromUnitId', 'unitNumber').populate('toUnitId', 'unitNumber'),
    UnitSwapRequestModel.countDocuments(q),
  ]);
  return { items, total, page, limit };
}
