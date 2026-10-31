import { Types, type ClientSession } from 'mongoose';
import { abandonDaysOf, allowsRentalPeriod, contractAppendices, nextAppendixNumber, commitmentClawback, CLAIM_FM_APPROVAL_LIMIT, isFreeSwap, LEFTOVER_HOLD_DAYS, SWAP_FEE_MAX, appendixTitle, fmtDate, vnd, type ManualDeliveryChannel, isClosedContract, buildRenewalAppendix, DAMAGE_STAFF_LIMIT, discountClawback, exitCommitment, inspectionDisputeDeadline, INSPECTION_DISPUTE_DAYS, settleDeposit, settlementNet, type SettlementInputs, MAX_MOVE_OUT_LEAD_DAYS, PERIOD_UNIT, statusBeforeMoveOut, TERMS_VERSION, unusedRenewalRefunds, maskIdLast4Clauses, type AbandonedItemsDisposal, type InspectionLog, type PaymentMethod, type UnitStatus } from '@ssm/shared';
import { AccessRequestModel, InspectionModel, PaymentModel, PolicyModel, RentalContractModel, ReservationModel, ServiceOrderModel, StorageUnitModel, TicketModel, UnitSwapRequestModel, UnitTypeModel, type PaymentHydrated, type UserHydrated } from '../../shared/db/models';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { climateEligible, earlyTerminationRefundPct, effectivePolicy, elapsedTermPct, quote, signedPolicy } from '../policies/pricing';
import { addDays, addPeriodsUTC, daysBetween, localDay, todayUTC, toDateOnly } from '../../shared/utils/dates';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { assertOnlineGateway, counterPay, createPayment, refundMethodFor, requireTxnRef, sha256 } from '../payments/payment.service';
import { gatewayProvider, inTxnOf, isGatewayFlow, openGatewayOrder, type PayCtx } from '../payments/gateway-order.service';
import { refundDeposits } from './deposits';
import { isValidPngDataUrl } from '../../shared/utils/png';
import { releaseOpenSwapRequests } from '../swaps/unit-swap-request.service';
import { cancelOpenServiceOrders } from '../services/services.service';
import { cancelOpenAccessRequests, closeOpenLostTasks } from '../access/access.service';
import { cancelOpenIntakes, markGoodsRemoved } from '../intake/intake.service';
import { accessResetOutcome, accessResetPending, accessResetTask, ensureAccessReset, moveAccessToUnit, oldUnitAccessReset } from './unit-access';
import { addNotice, deliverNoticesSoon, mailCustomer } from './contract-notice.service';
import { applyLockout, lockoutFrom } from './lockout';
import { assertContractProfile } from '../users/user.service';
import { contractParties } from '../reservations/contract-document.service';
import { buildContractPdf } from './contract-pdf';
import { ensureInitialCommitment } from './commitments';

const loadContract = async (id: string, session?: ClientSession) => {
  const c = await RentalContractModel.findById(id).session(session ?? null);
  if (!c) throw NotFound('hợp đồng');
  return c;
};

// ---------------------------------------------------------------- extend (CUSTOMER owner)
type ContractDoc = Awaited<ReturnType<typeof loadContract>>;

/**
 * Báo giá cho một lần gia hạn — GIA HẠN LÀ MỘT CAM KẾT MỚI:
 *  - giá gốc là giá NIÊM YẾT HIỆN HÀNH của loại kho (+ phụ phí điều hòa nếu hợp đồng đang dùng), theo chính sách đang áp dụng;
 *  - ưu đãi thuê dài hạn tính theo số tháng GIA HẠN, không cộng dồn thời gian đã thuê (cam kết bao lâu thì giảm theo bấy lâu);
 *  - thuê tháng: trả NGAY tiền thuê THÁNG ĐẦU của kỳ gia hạn (đợt 14), các tháng sau xuất hoá đơn từng tháng với giá mới;
 *    thuê ngày / tuần: trả trọn khi gia hạn;
 *  - bắt đầu từ ngày hết hạn hiện tại, hoặc từ kỳ chưa xuất hoá đơn nếu hợp đồng đã quá hạn (không phủ lại kỳ đã tính tiền);
 *  - tiền giữ chân giữ nguyên, không thu thêm.
 */
async function quoteExtension(c: ContractDoc, periods: number, session?: ClientSession) {
  // Đợt 16 (A4): đang chờ đổi cỡ kho (yêu cầu đổi sang loại khác đang chờ duyệt / đã duyệt) thì không gia hạn — giá, tiền giữ chân và phụ
  // lục gia hạn sẽ đổi theo loại mới khi hoàn tất đổi cỡ.
  if (await UnitSwapRequestModel.exists({ contractId: c._id, status: { $in: ['SUBMITTED', 'APPROVED'] }, sizeChange: { $ne: null } }).session(session ?? null)) {
    throw Unprocessable('Đang chờ đổi cỡ kho — hoàn tất hoặc huỷ yêu cầu đổi cỡ trước khi gia hạn', 'RESIZE_PENDING');
  }
  const policy = await effectivePolicy(c.facilityId, session);
  const ut = await UnitTypeModel.findById(c.unitTypeId).session(session ?? null);
  if (!ut) throw NotFound('loại kho');
  const period = c.billing.rentalPeriod;
  const q = quote(ut, policy, period, periods, !!c.useAirConditioning && climateEligible(policy, ut.category));
  const from = c.billing.nextBillingDate.getTime() > c.endDate.getTime() ? c.billing.nextBillingDate : c.endDate;
  const newEnd = addPeriodsUTC(from, period, periods);
  // Trần thời hạn áp cho TỪNG lần gia hạn (mỗi lần gia hạn là một cam kết mới) — không cộng dồn thời gian đã thuê.
  if (periods > policy.maxPeriods) throw Unprocessable(`Mỗi lần gia hạn tối đa ${policy.maxPeriods} ${PERIOD_UNIT[period]}`, 'EXTENSION_TOO_LONG');
  const gross = q.rate + q.surchargeAmount;
  return {
    policy, period, periods, from, newEnd, gross, discountAmount: q.discountAmount, rate: q.firstPeriodRent,
    currentRate: c.billing.rate,
    // Thuê ngày / tuần trả trọn tiền thuê cả kỳ gia hạn ngay; thuê tháng trả ngay tháng đầu (theo giá gia hạn), các tháng sau như thường.
    payNow: period === 'MONTH' ? q.firstPeriodRent : q.firstPeriodRent * periods,
    // Khoản trả ngay bao phủ tới hết ngày trước mốc này: thuê tháng = hết tháng đầu; thuê ngày / tuần = hết kỳ gia hạn.
    prepaidUntil: period === 'MONTH' ? addPeriodsUTC(from, period, 1) : newEnd,
  };
}

/**
 * PHỤ LỤC GIA HẠN cho lần gia hạn đang báo giá — văn bản khách phải đọc và xác nhận trước khi gia hạn có hiệu lực (Điều 403,
 * 421 BLDS 2015: sửa đổi thời hạn / giá của hợp đồng phải được hai bên thoả thuận, theo hình thức của hợp đồng gốc — ở đây là
 * phương thức điện tử). Bản xem trước và bản lưu dùng CÙNG hàm này nên khách xác nhận đúng nguyên văn mình đã đọc.
 */
async function renewalAppendixFor(c: ContractDoc, x: Awaited<ReturnType<typeof quoteExtension>>, session?: ClientSession) {
  const [parties, ut, unit, rsv] = await Promise.all([
    contractParties(c.facilityId, c.customerId),
    UnitTypeModel.findById(c.unitTypeId, { name: 1 }).session(session ?? null).lean(),
    StorageUnitModel.findById(c.unitId, { unitNumber: 1 }).session(session ?? null).lean(),
    ReservationModel.findById(c.reservationId, { 'signature.signedAt': 1 }).session(session ?? null).lean(),
  ]);
  // Số thứ tự chung cho mọi phụ lục của hợp đồng (gia hạn + đổi cỡ kho, đợt 15 C3).
  const number = nextAppendixNumber(c);
  const clauses = buildRenewalAppendix({
    number, contractNumber: c.contractNumber, contractSignedAt: (rsv?.signature?.signedAt ?? c.terms.signedAt ?? c.startDate).toISOString(),
    ...parties, unitTypeName: ut?.name ?? '—', unitNumber: unit?.unitNumber ?? null,
    rentalPeriod: x.period, periods: x.periods, from: x.from.toISOString(), newEndDate: x.newEnd.toISOString(),
    gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, payNow: x.payNow, depositAmount: c.deposit.amount,
    gracePeriodDays: c.terms.gracePeriodDays, policyVersion: x.policy.version,
    policy: { earlyTermination: x.policy.earlyTermination, discounts: x.policy.discounts }, termsVersion: TERMS_VERSION,
  });
  return { number, title: appendixTitle(number), clauses, parties, hash: appendixHash(clauses) };
}

/** Đợt 16 (C2): dấu nội dung phụ lục khách đã xem (gồm giá, điều khoản trả sớm, bậc ưu đãi, phiên bản chính sách / Điều khoản) — client gửi lại khi gia hạn. */
const appendixHash = (clauses: unknown) => sha256(JSON.stringify(clauses)).slice(0, 32);

/** Xem trước giá gia hạn (khách chọn số kỳ → thấy giá mới, ưu đãi, hạn mới) kèm PHỤ LỤC sẽ xác nhận — không ghi gì. */
export async function extensionQuote(user: UserHydrated, id: string, periods: number) {
  const c = await loadContract(id);
  await assertCanAccess(user, c, 'contract.extend');
  const x = await quoteExtension(c, periods);
  const appendix = await renewalAppendixFor(c, x);
  return {
    rentalPeriod: x.period, periods, from: x.from, newEndDate: x.newEnd, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, currentRate: x.currentRate, payNow: x.payNow, policyVersion: x.policy.version,
    // Đợt 14: ân hạn các tháng sau + mốc hết phần trả ngay (thuê tháng: hết tháng đầu) — cho lịch thanh toán gia hạn (extensionPaymentSteps).
    gracePeriodDays: c.terms.gracePeriodDays, prepaidUntil: x.prepaidUntil,
    appendix: { number: appendix.number, title: appendix.title, clauses: appendix.clauses },
    appendixHash: appendix.hash,
  };
}

/** Kết quả trả về của một lần gia hạn — dựng lại được từ lần gia hạn đã lưu (gửi lại cùng Idempotency-Key). */
function extendResult(c: ContractDoc, renewalIndex: number) {
  const rn = c.renewals[renewalIndex];
  const cm = (c.commitments ?? []).find((x) => x.kind === 'RENEWAL' && x.startDate.getTime() === rn.previousEndDate.getTime() && x.endDate.getTime() === rn.newEndDate.getTime());
  return { amount: 0, rate: cm?.rate ?? c.billing.rate, discountAmount: cm?.discountAmount ?? 0, newEndDate: rn.newEndDate, appendixNumber: cm?.appendix?.number ?? null };
}
const sameDay = (a: Date, iso: string) => !Number.isNaN(new Date(iso).getTime()) && a.toISOString().slice(0, 10) === new Date(iso).toISOString().slice(0, 10);

export async function extendContract(user: UserHydrated, id: string, periods: number, method: PaymentMethod | undefined, acceptance: { accepted: boolean; ip: string | null; userAgent: string | null }, expected: { rate: number; payNow: number; from: string; newEndDate: string; policyVersion?: number; appendixHash?: string }, idempotencyKey?: string, gw: PayCtx = {}) {
  if (!gw.run) assertContractProfile(user); // phụ lục ghi thông tin Bên B theo hồ sơ (khi áp từ cổng: khách đã qua kiểm tra này lúc xác nhận)
  return inTxnOf(gw)(async (session) => {
    const c = await loadContract(id, session);
    await assertCanAccess(user, c, 'contract.extend');
    // Bấm / gửi lại cùng Idempotency-Key (mạng chập chờn, bấm hai lần) → trả đúng kết quả lần trước, không gia hạn thêm lần nữa.
    const done = idempotencyKey ? c.renewals.findIndex((rn) => rn.idempotencyKey === idempotencyKey) : -1;
    if (done >= 0) {
      if (gw.run) throw Conflict('Lần gia hạn này đã được thực hiện', 'ALREADY_PAID');
      const prev = extendResult(c, done);
      const paid = c.renewals[done].paymentId ? await PaymentModel.findById(c.renewals[done].paymentId, { amount: 1 }).session(session).lean() : null;
      return { contract: c, ...prev, amount: paid?.amount ?? 0, replayed: true };
    }
    if (c.status !== 'ACTIVE') throw Unprocessable('Chỉ gia hạn được hợp đồng đang hiệu lực');
    // Gia hạn là sửa đổi hợp đồng → chỉ có hiệu lực khi Bên B xác nhận phụ lục (không có "gia hạn ngầm").
    if (!acceptance.accepted) throw Unprocessable('Bạn cần đọc và xác nhận Phụ lục gia hạn trước khi gia hạn', 'APPENDIX_NOT_ACCEPTED');
    const x = await quoteExtension(c, periods, session);
    // Gia hạn đúng báo giá khách đã xem: báo giá tính lại trong giao dịch phải khớp `rate` + `payNow` + mốc `from` / `newEndDate`. Mốc
    // lệch nghĩa là hợp đồng vừa được gia hạn (gửi trùng, hai thiết bị) → không gia hạn chồng lần nữa theo báo giá cũ.
    if (x.rate !== expected.rate || x.payNow !== expected.payNow || !sameDay(x.from, expected.from) || !sameDay(x.newEnd, expected.newEndDate)) {
      const extended = !sameDay(x.from, expected.from);
      throw new AppError(409, 'PRICE_CHANGED', extended
        ? 'Hợp đồng vừa được gia hạn — báo giá bạn đang xem đã cũ. Tải lại hợp đồng để xem hạn mới trước khi gia hạn thêm'
        : 'Báo giá gia hạn đã thay đổi so với bản bạn đang xem — xem lại báo giá mới rồi xác nhận',
      { rate: x.rate, payNow: x.payNow, from: x.from, newEndDate: x.newEnd });
    }
    if (x.payNow > 0 && !method) throw Unprocessable('Chọn hình thức thanh toán tiền thuê của kỳ gia hạn', 'PAY_METHOD_REQUIRED');
    if (x.payNow > 0 && method === 'CASH') throw Unprocessable('Thanh toán tiền mặt chỉ thực hiện tại quầy — chọn VNPay, MoMo, thẻ hoặc chuyển khoản', 'PAY_METHOD_REQUIRED');
    // Gia hạn thu tiền online ngay (thuê tháng: tháng đầu; ngày / tuần: trọn kỳ) — không có cổng thì không nhận.
    if (x.payNow > 0 && !gw.run) assertOnlineGateway(user, method);
    await ensureInitialCommitment(c, session);
    const appendix = await renewalAppendixFor(c, x, session);
    // Đợt 16 (C2): phụ lục phải đúng bản khách đã đọc — đổi phiên bản chính sách hay bất kỳ nội dung nào (điều khoản trả sớm, bậc ưu đãi,
    // Điều khoản…), không chỉ giá → 409 APPENDIX_CHANGED để khách đọc lại. Client cũ không gửi thì bỏ qua.
    if ((expected.policyVersion !== undefined && expected.policyVersion !== x.policy.version) || (expected.appendixHash && expected.appendixHash !== appendix.hash)) {
      throw new AppError(409, 'APPENDIX_CHANGED', 'Phụ lục gia hạn đã thay đổi so với bản bạn đang xem (chính sách / điều khoản) — đọc lại phụ lục mới rồi xác nhận',
        { policyVersion: x.policy.version, appendixHash: appendix.hash });
    }
    // Đợt VNPAY: lần chạy đầu dừng ở đây (hợp đồng chưa lưu nên ensureInitialCommitment phía trên chưa ghi gì). Lưu dấu phụ lục tính lại để lúc tiền vào đối chiếu
    // đúng bản khách đã đọc, kể cả client cũ không gửi appendixHash.
    if (!gw.run && isGatewayFlow(user) && x.payNow > 0) {
      return openGatewayOrder({
        kind: 'EXTEND', targetKey: `EXTEND:${c._id}`, facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, amount: x.payNow,
        payload: { periods, expected: { rate: expected.rate, payNow: expected.payNow, from: expected.from, newEndDate: expected.newEndDate, policyVersion: x.policy.version, appendixHash: appendix.hash }, acceptance: { ip: acceptance.ip, userAgent: acceptance.userAgent }, idempotencyKey: idempotencyKey ?? null },
      }, gw.start, session);
    }
    const now = new Date();

    // Kỳ của khoản RENEWAL: thuê tháng = tháng đầu của kỳ gia hạn [from, from + 1 tháng − 1 ngày] (job billing không xuất lại tháng này
    // nhưng vẫn xuất các tháng sau); thuê ngày / tuần giữ như cũ (trả trọn cả kỳ).
    const pay = x.payNow > 0
      ? await createPayment({
        facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'RENEWAL', amount: x.payNow, status: 'SUCCEEDED', method: method!,
        period: { start: x.from, end: x.period === 'MONTH' ? addDays(x.prepaidUntil, -1) : x.newEnd },
        ...(gw.run ? { gateway: gatewayProvider(gw.run.order, 1) } : {}),
      }, session)
      : null;
    c.renewals.push({ previousEndDate: x.from, newEndDate: x.newEnd, periods, paymentId: pay?._id ?? null, prepaidUntil: pay ? x.prepaidUntil : null, at: new Date(), idempotencyKey: idempotencyKey ?? null });
    c.commitments = [...(c.commitments ?? []), {
      kind: 'RENEWAL', startDate: x.from, endDate: x.newEnd, periods, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, policyId: x.policy._id, at: now,
      // Nguyên văn phụ lục + dấu vết xác nhận điện tử của Bên B (ai, lúc nào, từ đâu) — chứng cứ giao kết.
      appendix: { number: appendix.number, title: appendix.title, acceptedAt: gw.run?.order.get('createdAt') ?? now, signerName: user.fullName, signedBy: user._id, termsVersion: TERMS_VERSION, ip: acceptance.ip, userAgent: acceptance.userAgent, clauses: appendix.clauses,
        lessorSignatory: { name: appendix.parties.lessorRepresentative, authorization: appendix.parties.lessorAuthorization } },
    }] as ContractDoc['commitments'];
    c.endDate = x.newEnd;
    await c.save({ session });
    await audit({ action: 'contract.extend', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { periods, from: x.from, endDate: x.newEnd, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, paidNow: x.payNow, appendix: appendix.number } } }, session);
    if (gw.run) gw.run.applied = { paymentIds: pay ? [pay._id] : [], result: { newEndDate: x.newEnd } };
    return { contract: c, amount: x.payNow, rate: x.rate, discountAmount: x.discountAmount, newEndDate: x.newEnd, appendixNumber: appendix.number };
  });
}

/** PDF một phụ lục đã xác nhận (gia hạn / đổi cỡ kho) — chủ hợp đồng hoặc nhân viên / quản lý đúng chi nhánh. In đúng nguyên văn đã lưu. */
export async function appendixPdfFor(user: UserHydrated, id: string, number: number) {
  const c = await loadContract(id);
  await assertCanAccess(user, c, 'contract.appendix_pdf');
  const a = contractAppendices(c).find((x) => x.number === number);
  if (!a) throw NotFound('phụ lục');
  const parties = await contractParties(c.facilityId, c.customerId);
  const rep = a.lessorSignatory ?? { name: parties.lessorRepresentative, authorization: parties.lessorAuthorization }; // như lúc xác nhận
  const pdf = await buildContractPdf({
    code: c.contractNumber, contractNumber: c.contractNumber, facilityName: parties.facilityName, customerName: parties.customerName,
    lessorRepresentative: rep.name, lessorAuthorization: rep.authorization, title: a.title, subtitle: `Kèm theo Hợp đồng thuê kho số ${c.contractNumber}`,
    // Nhân viên quầy: che 4 số cuối giấy tờ Bên B (phải nhập từ bản gốc khi đối chiếu) — quản lý / vận hành / khách xem đủ.
    clauses: (user.role === 'STAFF' ? maskIdLast4Clauses(a.clauses) : a.clauses).map((x) => ({ title: x.title, paragraphs: [...x.paragraphs], bullets: [...x.bullets] })),
    signature: { signedAt: a.acceptedAt, signerName: a.signerName, method: 'TYPED', image: null, onBehalf: false },
    signedHow: 'Xác nhận điện tử trên tài khoản', generatedAt: new Date(),
  });
  return { pdf, filename: `phu-luc-${String(number).padStart(2, '0')}-${c.contractNumber}.pdf` };
}

// ---------------------------------------------------------------- pay outstanding (CUSTOMER online, STAFF/FM at desk)
/**
 * Đợt 15 (B5): `expectedAmount` = số dư khách / nhân viên đang thấy trên màn hình — khác số dư hiện tại (job vừa tính phí trễ, xuất hoá
 * đơn kỳ mới…) → 409 BALANCE_CHANGED kèm số mới, không thu; thiếu (client cũ) thì thu đúng số dư hiện tại như trước. `idempotencyKey`:
 * gửi lại đúng key của lần trả gần nhất (mạng chập chờn, bấm hai lần) → trả lại kết quả lần đó (replayed), không thu lần hai.
 */
export async function payBalance(user: UserHydrated, id: string, method: PaymentMethod, txnRef?: string, opts: { expectedAmount?: number; idempotencyKey?: string } = {}, gw: PayCtx = {}) {
  if (user.role === 'CUSTOMER' && method === 'CASH') throw Unprocessable('Thanh toán tiền mặt chỉ thực hiện tại quầy');
  if (!gw.run) assertOnlineGateway(user, method);
  // Nhân viên thu tại quầy: ghi người thu cho MỌI hình thức, không phải tiền mặt thì bắt buộc mã giao dịch làm chứng từ (C1).
  const counter = user.role === 'CUSTOMER' ? null : counterPay(user, method, requireTxnRef(method, txnRef));
  return inTxnOf(gw)(async (session) => {
    const c = await loadContract(id, session);
    await assertCanAccess(user, c, 'contract.pay_balance');
    const key = opts.idempotencyKey?.trim() || null;
    const last = c.balance.lastPayment;
    if (key && last?.key === key) {
      if (gw.run) throw Conflict('Khoản này đã được thanh toán', 'ALREADY_PAID');
      return { contract: c, amount: last.amount, paymentIds: [...last.paymentIds], replayed: true };
    }
    if (c.balance.outstanding <= 0) throw Unprocessable('Hợp đồng không có công nợ');
    const amount = c.balance.outstanding;
    if (opts.expectedAmount !== undefined && opts.expectedAmount !== amount) {
      throw new AppError(409, 'BALANCE_CHANGED', `Số tiền cần thanh toán đã đổi thành ${vnd(amount)} (bạn đang xem ${vnd(opts.expectedAmount)}) — kiểm tra lại rồi bấm thanh toán`, { outstanding: amount, expectedAmount: opts.expectedAmount });
    }
    // Đợt VNPAY: lần chạy đầu dừng ở đây, chưa thu. `expectedAmount` lưu đúng số này nên lúc tiền vào mà số dư đã đổi thì là BALANCE_CHANGED.
    if (!gw.run && isGatewayFlow(user)) {
      return openGatewayOrder({
        kind: 'BALANCE', targetKey: `BALANCE:${c._id}`, facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, amount,
        payload: { expectedAmount: amount, idempotencyKey: key },
      }, gw.start, session);
    }
    const now = new Date();

    const open = await PaymentModel.find({ contractId: c._id, direction: 'CHARGE', status: { $in: ['PENDING', 'FAILED'] } }).session(session);
    const paymentIds: Types.ObjectId[] = [];
    let seq = 0;
    for (const p of open) {
      seq += 1;
      if (p.status === 'PENDING') {
        p.method = method;
        p.recordedBy = counter ? user._id : null;
        if (counter) p.provider = counter.txnRef ? { name: method, txnRef: null, counterRef: counter.txnRef } : null;
        if (gw.run) p.provider = gatewayProvider(gw.run.order, seq);
        p.transitionTo('SUCCEEDED', { actor: 'SYSTEM', by: user._id });
        await p.save({ session });
        paymentIds.push(p._id);
      } else {
        // FAILED is terminal: settle it with a new charge for the same item
        const np = await createPayment({
          facilityId: p.facilityId, customerId: p.customerId, contractId: c._id, type: p.type, amount: p.amount, status: 'SUCCEEDED', method,
          period: p.period ?? null, ...(counter ?? {}), idempotencyKey: `retry-${p._id}`, ...(gw.run ? { gateway: gatewayProvider(gw.run.order, seq) } : {}),
        }, session);
        paymentIds.push(np._id);
      }
    }

    c.balance = { outstanding: 0, lastPaymentAt: now, lastPayment: key ? { key, amount, paymentIds, at: now } : c.balance.lastPayment ?? null };
    c.delinquency = null;
    // Hợp đồng ĐÃ ĐÓNG chỉ còn khoản nợ sau quyết toán: thu tiền, không đụng tới kỳ thuê / quyền truy cập / ô kho
    // (ô đó có thể đã cho người khác thuê).
    if (!isClosedContract(c.status)) {
      c.billing.paidThrough = addDays(c.billing.nextBillingDate, -1);
      c.access.suspendedAt = null;
      if (c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT') c.transitionTo('ACTIVE', { actor: 'SYSTEM', by: user._id, reason: 'Đã thanh toán đủ công nợ' });
    }
    await c.save({ session });
    await StorageUnitModel.updateOne({ _id: c.unitId, currentContractId: c._id }, { $set: { overlockActive: false } }, { session });
    await audit({ action: 'payment.balance', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { amount, method, txnRef: counter?.txnRef ?? null, expectedAmount: opts.expectedAmount ?? null, idempotent: !!key } } }, session);
    if (gw.run) gw.run.applied = { paymentIds, result: null };
    // paymentIds: các khoản vừa thu — để in biên lai (GET /payments/:id/receipt.pdf).
    return { contract: c, amount, paymentIds, replayed: false };
  });
}

// ---------------------------------------------------------------- lockout (FACILITY_MANAGER)
export async function lockout(user: UserHydrated, id: string) {
  const { c, notice } = await withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.lockout');
    if (c.status !== 'DELINQUENT') throw Unprocessable('Chỉ khoá truy cập hợp đồng đang quá hạn thanh toán', 'NOT_DELINQUENT');
    // Hợp đồng khách đã ký ghi "quá {lockoutAfterDays} ngày bị khoá truy cập" — khoá tay cũng phải theo đúng mốc đó,
    // không được khoá sớm ngay sau thời gian ân hạn.
    if ((c.delinquency?.daysOverdue ?? 0) <= c.terms.lockoutAfterDays) throw Unprocessable(`Theo hợp đồng, chỉ khóa truy cập khi quá hạn hơn ${c.terms.lockoutAfterDays} ngày (hiện ${c.delinquency?.daysOverdue ?? 0} ngày)`, 'LOCKOUT_TOO_EARLY');
    // Như job: chỉ khoá từ ngày khoá đã ghi trong thông báo hết ân hạn gửi khách (≥ LOCKOUT_MIN_NOTICE_DAYS ngày sau khi báo).
    const lockDay = lockoutFrom(c);
    if (!lockDay) throw Unprocessable('Khách chưa nhận thông báo hết ân hạn của đợt nợ này — hệ thống sẽ gửi ở lượt tính tiền kế tiếp, kèm ngày khoá', 'LOCKOUT_TOO_EARLY');
    if (todayUTC() < lockDay) throw Unprocessable(`Thông báo gửi khách ghi ngày khoá ${fmtDate(lockDay.toISOString())} — chỉ khoá từ ngày đó`, 'LOCKOUT_TOO_EARLY');
    // Cùng đường với job tự khoá: thu phí cố định khi khoá theo chính sách khách đã ký, gắn khoá chặn, thông báo khách.
    const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
    const notice = await applyLockout(c, policy, { role: user.role, by: user._id, reason: 'Khóa do quá hạn' }, session);
    await c.save({ session });
    return { c, notice };
  });
  await deliverNoticesSoon([notice]);
  return c;
}

// ---------------------------------------------------------------- final notice (FACILITY_MANAGER)
/**
 * THÔNG BÁO CUỐI trước khi xử lý đồ bỏ lại (Điều 7 Điều khoản): chỉ gửi khi hợp đồng đang bị khoá, mỗi đợt nợ một lần. Ghi mốc
 * `delinquency.finalNoticeAt` + hạn chót (sau `abandonAfterLockedOutDays` ngày) — trước hạn chót không xử lý được đồ trong kho.
 * Khách trả đủ nợ thì đợt nợ kết thúc (delinquency = null), lần nợ sau phải gửi lại từ đầu. `note`: VD đã gọi điện / gửi thư bảo đảm số …
 */
export async function sendFinalNotice(user: UserHydrated, id: string, input: { note?: string }) {
  const { c, notice } = await withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.final_notice');
    if (c.status !== 'LOCKED_OUT' || !c.delinquency?.lockedOutAt) throw Unprocessable('Chỉ gửi thông báo cuối cho hợp đồng đang bị khoá quyền ra vào', 'NOT_LOCKED_OUT');
    if (c.delinquency.finalNoticeAt) throw Conflict(`Đã gửi thông báo cuối ngày ${fmtDate(c.delinquency.finalNoticeAt.toISOString())} — chờ hết hạn chót rồi mới xử lý đồ bỏ lại`, 'FINAL_NOTICE_SENT');
    // Số ngày chờ theo chính sách khách đã ký (in trong hợp đồng), không theo bản mới phát hành sau đó.
    const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
    const deadline = addDays(todayUTC(), abandonDaysOf(policy)); // từ ngày này mới được xử lý đồ bỏ lại
    c.delinquency.finalNoticeAt = new Date();
    const notice = addNotice(c, 'FINAL_NOTICE', { amountDue: c.balance.outstanding, deadline, note: input.note, by: user._id });
    await c.save({ session });
    await audit({ action: 'contract.final_notice', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: input.note, changes: { after: { amountDue: c.balance.outstanding, deadline } } }, session);
    return { c, notice };
  });
  await deliverNoticesSoon([notice]);
  return c;
}

// ---------------------------------------------------------------- ghi nhận đã báo thông báo cuối bằng kênh khác (FACILITY_MANAGER)
/**
 * Email thông báo cuối không tới được khách (khách chưa xác minh email, gửi lỗi…): quản lý báo khách qua điện thoại / thư bảo đảm /
 * trực tiếp rồi ghi nhận vào thông báo cuối mới nhất (kênh, ghi chú, thời điểm, người ghi) — điều kiện để được xử lý đồ bỏ lại (A5).
 *
 * Đợt 17 (A2): khách chỉ thực sự biết từ lúc được báo → email CHƯA gửi thành công và CHƯA có ghi nhận trước đó thì hạn xử lý đồ tính lại:
 * max(hạn cũ, hôm nay + số ngày chờ theo chính sách đã ký). Tính từ NGÀY GHI NHẬN, không từ `at` (`at` chỉ lưu thông tin — khai lùi không rút ngắn
 * được hạn của khách). Ghi nhận lại, hoặc email đã SENT: không dời thêm. Hệ thống không có đường gửi lại email thông báo cuối (deliverNotices chỉ
 * chạy một lần sau commit), nên không có nhánh "gửi lại thành công" phải áp quy tắc này.
 */
export async function recordFinalNoticeDelivery(user: UserHydrated, id: string, input: { channel: ManualDeliveryChannel; note: string; at?: string }) {
  const out = await withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.final_notice_delivery');
    const notices = c.notices ?? [];
    let idx = -1;
    for (let i = notices.length - 1; i >= 0; i--) if (notices[i].kind === 'FINAL_NOTICE') { idx = i; break; }
    if (idx < 0) throw Unprocessable('Hợp đồng chưa có thông báo cuối để ghi nhận', 'FINAL_NOTICE_REQUIRED');
    const n = notices[idx];
    const at = input.at ? new Date(input.at) : new Date();
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000 || at.getTime() < n.at.getTime() - 60_000) {
      throw Unprocessable(`Thời điểm báo khách phải sau lúc lập thông báo cuối (${fmtDate(n.at.toISOString())}) và không ở tương lai`, 'INVALID_DELIVERY_TIME');
    }
    const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
    const waitDays = abandonDaysOf(policy);
    const previousDeadline = n.deadline ?? addDays(localDay(c.delinquency?.finalNoticeAt ?? n.at), waitDays);
    const firstNews = n.email?.status !== 'SENT' && !n.manualDelivery;
    const fromToday = addDays(todayUTC(), waitDays);
    const deadline = firstNews && fromToday > previousDeadline ? fromToday : previousDeadline;
    const deadlineChanged = deadline.getTime() !== previousDeadline.getTime();
    const manualDelivery = { channel: input.channel, note: input.note.trim(), at, by: user._id };
    c.set(`notices.${idx}.manualDelivery`, manualDelivery);
    if (deadlineChanged) c.set(`notices.${idx}.deadline`, deadline);
    await c.save({ session });
    await audit({ action: 'contract.final_notice_delivery', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: input.note,
      changes: { before: { deadline: previousDeadline }, after: { noticeId: String(n._id), channel: input.channel, at, deadline, deadlineChanged } } }, session);
    return { contract: c, notice: c.notices![idx], deadline, previousDeadline, deadlineChanged };
  });
  // Báo khách hạn mới (sau commit, không chặn phản hồi): hiện trong tài khoản theo notice.deadline; gửi được email thì gửi.
  if (out.deadlineChanged) {
    void mailCustomer(out.contract.customerId, `KhoAn — Hạn xử lý đồ mới của hợp đồng ${out.contract.contractNumber}`, [
      `Chi nhánh đã báo bạn về THÔNG BÁO CUỐI của hợp đồng ${out.contract.contractNumber}. Hạn được tính lại từ ngày ghi nhận đã báo.`,
      `Hạn chót thanh toán hoặc liên hệ chi nhánh: hết ngày ${fmtDate(addDays(out.deadline, -1).toISOString())}. Từ ngày ${fmtDate(out.deadline.toISOString())}, nếu bạn chưa thanh toán hay liên hệ, chi nhánh được mở kho, kiểm kê và thanh lý đồ trong kho.`,
    ]);
  }
  return out;
}

// ---------------------------------------------------------------- waive late fees (FM / OPS within policy limit)
export async function waiveLateFees(user: UserHydrated, id: string, reason: string) {
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'payment.waiver');
    const fees = await PaymentModel.find({ contractId: c._id, type: 'LATE_FEE', status: 'PENDING' }).session(session);
    const total = fees.reduce((s, p) => s + p.amount, 0);
    if (!total) throw Unprocessable('Không có phí trễ hạn để miễn');
    const policy = await effectivePolicy(c.facilityId, session);
    const limit = policy.waiverLimits.find((w) => w.role === user.role)?.maxAmount ?? 0;
    if (total > limit) throw Forbidden(`Vượt hạn mức miễn giảm của bạn (${limit.toLocaleString('vi-VN')} ₫)`, 'WAIVER_LIMIT');

    for (const f of fees) { f.transitionTo('CANCELLED', { actor: 'SYSTEM', by: user._id, reason: 'Miễn phí trễ hạn' }); await f.save({ session }); }
    await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'WAIVER', amount: total, status: 'SUCCEEDED', method: 'INTERNAL', waiver: { approvedBy: user._id, reason } }, session);
    c.balance.outstanding = Math.max(0, c.balance.outstanding - total);
    if (c.delinquency) c.delinquency.lateFeesAccrued = 0;
    await c.save({ session });
    await audit({ action: 'payment.waiver', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason, changes: { after: { amount: total } } }, session);
    return { contract: c, amount: total };
  });
}

// ---------------------------------------------------------------- xoá nợ còn lại sau quyết toán (FM / OPS trong hạn mức)
/**
 * Hợp đồng đã đóng mà chi phí hư hại + công nợ vượt tiền giữ chân thì khách còn nợ phần chênh. Không thu được (khách
 * mất liên lạc, số tiền nhỏ…) thì quản lý xoá nợ — bắt buộc ghi lý do, trong hạn mức miễn giảm của vai trò, có nhật ký.
 */
export async function writeOffDebt(user: UserHydrated, id: string, reason: string) {
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'payment.write_off');
    if (!isClosedContract(c.status)) throw Unprocessable('Chỉ xoá nợ còn lại của hợp đồng đã đóng — hợp đồng đang mở thì thu nợ hoặc miễn phí trễ hạn');
    const amount = c.balance.outstanding;
    if (amount <= 0) throw Unprocessable('Hợp đồng không còn nợ');
    // Hạn mức áp trên TỔNG đã miễn giảm của hợp đồng sau khi đóng (xoá nợ + điều chỉnh biên bản) — không chia nhỏ để lách được.
    const limit = await waiverLimitOf(user, c.facilityId, session);
    const forgiven = await forgivenSinceClose(c, session);
    if (forgiven + amount > limit) throw Forbidden(`Vượt hạn mức miễn giảm của bạn (${limit.toLocaleString('vi-VN')} ₫${forgiven ? `, đã miễn giảm ${forgiven.toLocaleString('vi-VN')} ₫ trên hợp đồng này` : ''}) — cần cấp cao hơn duyệt`, 'WAIVER_LIMIT');

    const now = new Date();
    await PaymentModel.updateMany({ contractId: c._id, direction: 'CHARGE', status: 'PENDING' }, { $set: { status: 'CANCELLED' }, $push: { statusHistory: { from: 'PENDING', to: 'CANCELLED', at: now, by: user._id, reason: 'Xoá nợ sau quyết toán' } } }, { session });
    await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'WAIVER', amount, status: 'SUCCEEDED', method: 'INTERNAL', waiver: { approvedBy: user._id, reason } }, session);
    c.balance.outstanding = 0;
    await c.save({ session });
    await audit({ action: 'payment.write_off', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason, changes: { after: { amount } } }, session);
    return { contract: c, amount };
  });
}

// ---------------------------------------------------------------- điều chỉnh biên bản trả kho (FACILITY_MANAGER, OPS_MANAGER)
/**
 * Khách khiếu nại biên bản trả kho (Điều 9, phiếu BILLING trong 7 ngày) và chi nhánh xác nhận khiếu nại đúng → giảm chi phí hư hại,
 * TÍNH LẠI quyết toán với mức hư hại mới rồi đối chiếu tiền đã chuyển: giảm nợ còn lại trước; khách đã trả thừa thì hoàn chuyển khoản
 * (chờ người khác xác nhận). Tổng các lần điều chỉnh không vượt chi phí hư hại; hạn mức miễn giảm tính trên tổng xoá nợ + điều chỉnh.
 */
export async function adjustDamage(user: UserHydrated, id: string, input: { amount: number; reason: string }) {
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'inspection.adjust');
    if (c.status !== 'CLOSED') throw Unprocessable('Chỉ điều chỉnh biên bản của hợp đồng đã trả kho', 'NOT_CLOSED');
    const insp = await InspectionModel.findOne({ contractId: c._id, type: 'MOVE_OUT' }).sort({ performedAt: -1 }).session(session);
    if (!insp || insp.totalDamageFee <= 0) throw Unprocessable('Biên bản trả kho không có chi phí hư hại để điều chỉnh');
    // Chỉ điều chỉnh khi khách ĐÃ khiếu nại trong hạn (Điều 9): phiếu thanh toán của chính khách, gắn hợp đồng, gửi trước hạn chót.
    const dispute = await TicketModel.exists({
      contractId: c._id, reporterId: c.customerId, category: 'BILLING',
      createdAt: { $gte: insp.performedAt, $lt: new Date(inspectionDisputeDeadline(insp.performedAt)) },
    }).session(session);
    if (!dispute) throw Unprocessable(`Chỉ điều chỉnh khi khách đã khiếu nại biên bản trong hạn ${INSPECTION_DISPUTE_DAYS} ngày`, 'NO_DISPUTE');

    const prev = insp.adjustments ?? [];
    const room = insp.totalDamageFee - prev.reduce((s, a) => s + a.amount, 0);
    const amount = Math.trunc(input.amount);
    if (amount <= 0 || amount > room) throw Unprocessable(`Số tiền điều chỉnh từ 1 ₫ đến ${room.toLocaleString('vi-VN')} ₫ (chi phí hư hại còn lại trong biên bản)`, 'OVER_DAMAGE');
    const inputs = settlementInputsOf(insp);
    if (!inputs) throw Unprocessable('Biên bản lập trước khi lưu dữ liệu quyết toán chi tiết (có giới hạn hoàn khi trả sớm) — không tự tính lại được, liên hệ quản trị viên', 'LEGACY_SETTLEMENT');

    // Tính lại quyết toán với mức hư hại mới (trần hoàn trả sớm, thu hồi ưu đãi, tiền thuê trả trước cấn trừ… y như lúc trả kho), rồi
    // đối chiếu với tiền đã THẬT SỰ chuyển từ lúc quyết toán: khách trả nợ sau quyết toán − KhoAn đã hoàn (kể cả đang chờ chuyển).
    // Phần nợ đã được xoá chỉ bù vào phần giảm, không biến thành tiền hoàn.
    const target = settlementNet(settleDeposit({ ...inputs, damage: room - amount }));
    const pays = await PaymentModel.find({ contractId: c._id, createdAt: { $gte: insp.performedAt } }, { type: 1, amount: 1, status: 1, method: 1 }).session(session).lean();
    const total = (f: (p: (typeof pays)[number]) => boolean) => pays.filter(f).reduce((s, p) => s + p.amount, 0);
    const paidNet = total((p) => p.type === 'SETTLEMENT_DEBT' && p.status === 'SUCCEEDED')
      - total((p) => p.type === 'REFUND' && p.method !== 'INTERNAL' && (p.status === 'PENDING' || p.status === 'SUCCEEDED'));
    const writtenOff = Math.max(0, total((p) => p.type === 'WAIVER' && p.status === 'SUCCEEDED') - prev.reduce((s, a) => s + (a.debtCut ?? 0), 0));
    const refundAmount = Math.max(0, paidNet - target);
    // CHỈ phần nợ của quyết toán (SETTLEMENT_DEBT đang chờ) được tính lại / giảm. Các khoản nợ khác sau trả kho — phí xử lý đồ để lại
    // (DISPOSAL_FEE)… — không thuộc biên bản hư hại: không huỷ, không miễn ngầm (E).
    const settlementOpen = Math.min(c.balance.outstanding, total((p) => p.type === 'SETTLEMENT_DEBT' && p.status === 'PENDING'));
    const newSettlementOutstanding = Math.max(0, target - paidNet - writtenOff);
    const debtCut = Math.max(0, settlementOpen - newSettlementOutstanding);
    if (debtCut + refundAmount === 0) {
      throw Unprocessable('Giảm chi phí hư hại này không làm thay đổi quyết toán (VD tiền giữ chân đã chạm giới hạn hoàn khi trả sớm, hoặc phần nợ tương ứng đã được xoá)', 'NO_EFFECT');
    }
    // Hạn mức miễn giảm áp trên TỔNG đã miễn giảm của hợp đồng (xoá nợ + các lần điều chỉnh), không phải từng lần.
    const limit = await waiverLimitOf(user, c.facilityId, session);
    const forgiven = await forgivenSinceClose(c, session);
    if (forgiven + debtCut + refundAmount > limit) {
      throw Forbidden(`Vượt hạn mức miễn giảm của bạn (${limit.toLocaleString('vi-VN')} ₫${forgiven ? `, đã miễn giảm ${forgiven.toLocaleString('vi-VN')} ₫ trên hợp đồng này` : ''}) — chuyển Quản lý vận hành`, 'WAIVER_LIMIT');
    }

    const now = new Date();
    const n = prev.length + 1;
    const reason = `Điều chỉnh biên bản trả kho: ${input.reason.trim()}`;
    // 1) Giảm nợ quyết toán: huỷ các khoản nợ quyết toán đang chờ, ghi miễn giảm phần giảm, còn nợ quyết toán thì lập lại một khoản
    //    SETTLEMENT_DEBT. Khoản nợ khác (DISPOSAL_FEE…) giữ nguyên.
    if (debtCut > 0) {
      await PaymentModel.updateMany({ contractId: c._id, type: 'SETTLEMENT_DEBT', status: 'PENDING' }, { $set: { status: 'CANCELLED' }, $push: { statusHistory: { from: 'PENDING', to: 'CANCELLED', at: now, by: user._id, reason } } }, { session });
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'WAIVER', amount: debtCut, status: 'SUCCEEDED', method: 'INTERNAL', waiver: { approvedBy: user._id, reason } }, session);
      c.balance.outstanding -= debtCut;
      if (settlementOpen - debtCut > 0) {
        await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SETTLEMENT_DEBT', amount: settlementOpen - debtCut, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `settlement-debt-${c._id}-adj-${n}` }, session);
      }
    }
    // 2) Khách đã trả nhiều hơn quyết toán mới → hoàn phần chênh, chuyển khoản chờ người KHÁC người điều chỉnh xác nhận đã chuyển.
    let refund: Awaited<ReturnType<typeof createPayment>> | null = null;
    if (refundAmount > 0) {
      const refundOf = insp.depositSettlement?.damagePaymentId ?? c.deposit.paymentId ?? null;
      if (!refundOf) throw Unprocessable('Không tìm thấy khoản phí hư hại gốc để hoàn — liên hệ quản trị viên', 'NO_ORIGINAL_PAYMENT');
      refund = await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: refundAmount, status: 'SUCCEEDED', method: 'BANK_TRANSFER', refundOf, idempotencyKey: `damage-adj-${insp._id}-${n}` }, session);
      // Tiền giữ chân được hoàn thêm → cập nhật trạng thái cho khớp màn hình / báo cáo. Đợt 15 (F5): khoản hoàn là chuyển khoản chờ
      // người khác xác nhận → "Đang hoàn (chờ chuyển)" cho tới khi confirmPayout (khi đó Đã hoàn / Hoàn một phần).
      c.deposit.refundedAmount = Math.min(c.deposit.amount, (c.deposit.refundedAmount ?? 0) + refundAmount);
      c.deposit.status = refund.status === 'PENDING' ? 'REFUND_PENDING' : c.deposit.refundedAmount >= c.deposit.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }
    await c.save({ session });
    insp.adjustments = [...prev, { amount, reason: input.reason.trim(), by: user._id, at: now, refundPaymentId: refund?._id ?? null, debtCut, refund: refundAmount }];
    await insp.save({ session });
    await audit({ action: 'inspection.adjust', entityType: 'InspectionLog', entityId: insp._id, facilityId: c.facilityId, reason: input.reason, changes: { after: { amount, debtCut, refund: refundAmount } } }, session);
    return { contract: c, inspection: insp, debtCut, refund: refundAmount };
  });
}

type SettlementSnapshot = {
  depositHeld: number; deductions: number; shortfall?: number | null; prepaidRentRefund?: number | null; prepaidRentOffset?: number | null; creditRefund?: number | null; creditOffset?: number | null;
  earlyTermination?: unknown; priorOutstanding?: number | null; refundCap?: number | null; clawbackDue?: number | null;
};
/**
 * Đầu vào quyết toán của một biên bản. Biên bản mới lưu sẵn; biên bản cũ thì dựng lại được khi KHÔNG có giới hạn hoàn trả sớm
 * (tính ngược công nợ trước khi kiểm tra); có trả sớm mà thiếu dữ liệu → null (không tự tính lại được).
 */
function settlementInputsOf(insp: { totalDamageFee: number; depositSettlement?: SettlementSnapshot | null }): SettlementInputs | null {
  const ds = insp.depositSettlement;
  if (!ds) return null;
  // Đợt 16 (C4): tiền dịch vụ / phí cấp lại hoàn trong quyết toán tính như tiền gia hạn chưa dùng (cấn phần thiếu trước).
  const prepaidUnused = (ds.prepaidRentRefund ?? 0) + (ds.prepaidRentOffset ?? 0) + (ds.creditRefund ?? 0) + (ds.creditOffset ?? 0);
  if (ds.priorOutstanding !== null && ds.priorOutstanding !== undefined) {
    return { deposit: ds.depositHeld, damage: insp.totalDamageFee, priorOutstanding: ds.priorOutstanding, refundCap: ds.refundCap ?? null, clawbackDue: ds.clawbackDue ?? 0, prepaidUnused };
  }
  if (ds.earlyTermination) return null;
  const owedBeyondDeposit = (ds.shortfall ?? 0) + (ds.prepaidRentOffset ?? 0) + (ds.creditOffset ?? 0);
  const owed = owedBeyondDeposit > 0 ? ds.depositHeld + owedBeyondDeposit : ds.deductions;
  return { deposit: ds.depositHeld, damage: insp.totalDamageFee, priorOutstanding: Math.max(0, owed - insp.totalDamageFee), refundCap: null, clawbackDue: 0, prepaidUnused };
}

async function waiverLimitOf(user: UserHydrated, facilityId: Types.ObjectId, session: ClientSession) {
  const policy = await effectivePolicy(facilityId, session);
  return policy.waiverLimits.find((w) => w.role === user.role)?.maxAmount ?? 0;
}

/** Tổng đã miễn giảm SAU khi đóng hợp đồng: xoá nợ + giảm nợ / hoàn tiền do điều chỉnh biên bản. */
async function forgivenSinceClose(c: { _id: Types.ObjectId; closedAt?: Date | null }, session: ClientSession) {
  const [waived, insp] = await Promise.all([
    PaymentModel.find({ contractId: c._id, type: 'WAIVER', status: 'SUCCEEDED', createdAt: { $gte: c.closedAt ?? new Date(0) } }, { amount: 1 }).session(session).lean(),
    InspectionModel.findOne({ contractId: c._id, type: 'MOVE_OUT' }, { adjustments: 1 }).sort({ performedAt: -1 }).session(session).lean(),
  ]);
  return waived.reduce((s, p) => s + p.amount, 0) + (insp?.adjustments ?? []).reduce((s, a) => s + (a.refund ?? 0), 0);
}

// ---------------------------------------------------------------- swap unit, same type (STAFF, FACILITY_MANAGER)
/**
 * Phí đổi ô tại quầy theo CÙNG biểu phí với yêu cầu đổi ô của khách (Điều 8): lần đổi đầu của hợp đồng hoặc đổi do lỗi chi nhánh thì
 * miễn phí, còn lại tối đa SWAP_FEE_MAX (shared). Đổi ô CÙNG LOẠI không làm thay đổi giá thuê, nên khoản này chỉ là phí thao tác
 * (di dời, cấp lại chìa/mã) — mặc định 0. Quản lý chi nhánh mới được thu, và mọi lần thu đều vào nhật ký kiểm toán kèm lý do.
 */
export { SWAP_FEE_MAX } from '@ssm/shared';

/**
 * Đổi ô kho cùng loại.
 *
 * Bốn bất biến, sai một cái là hỏng dữ liệu:
 *  1. CÙNG unitTypeId  → giá thuê và tiền cọc đã chốt trong hợp đồng KHÔNG được tính lại.
 *  2. Chiếm ô mới TRƯỚC, nhả ô cũ SAU, trong cùng một transaction. Làm ngược lại thì ô cũ có thể bị
 *     người khác lấy mất trong lúc ô mới chiếm không thành công → khách mất cả hai ô.
 *  3. Lấy ô mới bằng compare-and-swap trên `status: 'AVAILABLE'` → hai người cùng nhắm một ô thì chỉ
 *     một người khớp filter, người kia nhận 409.
 *  4. $inc inventoryVersion để hai giao dịch trên cùng loại kho ghi đè nhau → WriteConflict → driver
 *     retry cả callback (xem services/txn.ts).
 */
export async function swapUnit(user: UserHydrated, id: string, input: { toUnitId: string; reason: string; keyTag?: string; fee?: number; facilityFault?: boolean; oldAccessReset?: boolean }) {
  const asked = Math.max(0, Math.trunc(input.fee ?? 0));
  if (asked > 0 && user.role !== 'FACILITY_MANAGER') throw Forbidden('Chỉ Quản lý chi nhánh được thu phí đổi ô', 'SWAP_FEE');
  if (asked > SWAP_FEE_MAX) throw Unprocessable(`Phí đổi ô tối đa ${SWAP_FEE_MAX.toLocaleString('vi-VN')} ₫`);

  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.swap_unit');
    // "Lần đầu" đếm theo mọi lần đổi đã ghi trên hợp đồng (tại quầy lẫn theo yêu cầu) — hai đường dùng chung một cách đếm.
    const fee = isFreeSwap({ facilityFault: !!input.facilityFault, isFirstSwap: (c.unitSwaps ?? []).length === 0 }) ? 0 : asked;
    if (c.status !== 'ACTIVE') throw Unprocessable('Chỉ đổi ô cho hợp đồng đang hiệu lực');
    if (c.balance.outstanding > 0) throw Unprocessable('Hợp đồng còn công nợ — thu xong mới đổi ô');
    if (String(c.unitId) === String(input.toUnitId)) throw Unprocessable('Ô mới trùng với ô đang thuê');

    await UnitTypeModel.updateOne({ _id: c.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });

    const now = new Date();
    const fromUnitId = c.unitId;

    // (1) chiếm ô mới — đúng chi nhánh, đúng loại, và phải đang trống
    const toUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: input.toUnitId, facilityId: c.facilityId, unitTypeId: c.unitTypeId, status: 'AVAILABLE', isDeleted: false },
      { $set: { status: 'OCCUPIED', currentContractId: c._id, currentReservationId: null, statusChangedAt: now, statusReason: `Đổi ô cho ${c.contractNumber}` } },
      { new: true, session },
    );
    if (!toUnit) throw Conflict('Ô kho đã chọn không còn trống hoặc không cùng loại với ô đang thuê', 'UNIT_NOT_AVAILABLE');

    // (2) nhả ô cũ về chờ kiểm tra — hỏng ở đây thì cả transaction rollback, ô mới tự nhả. Đợt 16 (B1): ô cũ chờ ghi nhận thu chìa / thẻ cũ
    // hoặc đặt lại ổ khoá (accessReset) mới mở cho thuê lại — nhân viên tick ngay lúc đổi (oldAccessReset) hoặc ghi nhận sau ở trang Kho.
    const fromUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: fromUnitId, status: 'OCCUPIED', currentContractId: c._id },
      { $set: { status: 'PENDING_INSPECTION', currentContractId: null, overlockActive: false, statusChangedAt: now, statusReason: `Khách đã chuyển sang ô ${toUnit.unitNumber}`,
        accessReset: oldUnitAccessReset(c, now, input.oldAccessReset ? { by: user._id, byName: user.fullName } : null) } },
      { new: true, session },
    );
    if (!fromUnit) throw Conflict('Ô kho đang thuê không ở trạng thái mong đợi — liên hệ quản lý', 'UNIT_STATE_MISMATCH');

    // (3) phí thao tác (nếu có): cộng vào công nợ, KHÔNG đụng vào giá thuê
    const feePayment = fee > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'PENALTY', amount: fee, status: 'PENDING', method: 'INTERNAL' }, session)
      : null;

    // (4) hợp đồng trỏ sang ô mới; billing.rate và deposit giữ nguyên
    c.unitId = toUnit._id;
    c.unitSwaps = [...(c.unitSwaps ?? []), { fromUnitId, toUnitId: toUnit._id, reason: input.reason, fee, paymentId: feePayment?._id ?? null, at: now, by: user._id }];
    // Đợt 16 (B1): đổi ô luôn cấp phương tiện mở MỚI như nhận kho (mật khẩu mới / bắt buộc mã chìa, số thẻ mới).
    const access = moveAccessToUnit(c, toUnit, user._id, input.keyTag);
    // Yêu cầu đổi ô khách gửi trước đó (nếu còn treo) không còn ý nghĩa — huỷ và nhả ô đang giữ cho nó.
    await releaseOpenSwapRequests(c._id, session, 'Chi nhánh đã đổi ô trực tiếp');
    // Đã giao phương tiện mở của ô mới → yêu cầu cấp lại của ô cũ không còn ý nghĩa.
    await cancelOpenAccessRequests(c._id, 'Đã đổi ô và giao phương tiện mở kho mới — huỷ yêu cầu cấp lại, hoàn phí', session);
    if (fee > 0) c.balance.outstanding += fee;
    await c.save({ session }); // chỉ mục unique {unitId} trên hợp đồng đang mở là lớp chặn cuối cùng

    // (5) đặt chỗ gốc đi theo hợp đồng để lịch sử của khách không lệch ô
    await ReservationModel.updateOne({ _id: c.reservationId, status: 'CHECKED_IN' }, { $set: { unitId: toUnit._id } }, { session });

    await UnitTypeModel.updateOne({ _id: c.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });
    await audit({
      action: 'contract.swap_unit', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: input.reason,
      changes: { before: { unit: fromUnit.unitNumber }, after: { unit: toUnit.unitNumber, fee, facilityFault: !!input.facilityFault, rate: c.billing.rate, access: c.access.method, accessChanged: access.changed, accessReissued: true, keyTag: c.access.keyTag ?? null, oldAccessReset: !!input.oldAccessReset } },
    }, session);
    return { contract: c, fromUnit, toUnit, fee, pin: access.pin }; // mật khẩu mới (nếu có) trả về đúng một lần
  });
}

/**
 * Danh sách ô trống cùng loại — dùng cho cả nhân viên đổi ngay (swapUnit) lẫn khách gửi yêu cầu đổi ô. Đợt 15 (C3): `unitTypeId` = ô
 * trống của LOẠI khác cùng chi nhánh (đổi cỡ kho); `unitTypes` = các loại đang cho thuê ở chi nhánh + số ô trống + có đổi sang được
 * không (kho cỡ lớn chỉ thuê theo tháng) — cho bước chọn cỡ kho.
 */
export async function swapCandidates(user: UserHydrated, id: string, unitTypeId?: string) {
  const c = await loadContract(id);
  await assertCanAccess(user, c, 'contract.swap_unit');
  const typeId = unitTypeId ?? String(c.unitTypeId);
  const [items, types, free] = await Promise.all([
    StorageUnitModel
      .find({ facilityId: c.facilityId, unitTypeId: typeId, status: 'AVAILABLE', isDeleted: false, _id: { $ne: c.unitId } }, { unitNumber: 1, location: 1, status: 1, accessMethod: 1 })
      .sort({ 'location.floor': 1, unitNumber: 1 }).limit(200).lean(),
    UnitTypeModel.find({ facilityId: c.facilityId, isActive: true }, { name: 1, category: 1, areaM2: 1 }).sort({ areaM2: 1 }).lean(),
    StorageUnitModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { facilityId: c.facilityId, status: 'AVAILABLE', isDeleted: false } }, { $group: { _id: '$unitTypeId', n: { $sum: 1 } } },
    ]),
  ]);
  const unitTypes = types.map((t) => ({
    _id: t._id, name: t.name, category: t.category, areaM2: t.areaM2, current: String(t._id) === String(c.unitTypeId),
    available: free.find((f) => String(f._id) === String(t._id))?.n ?? 0, allowed: allowsRentalPeriod(t.category, c.billing.rentalPeriod),
  }));
  return { currentUnitId: c.unitId, currentUnitTypeId: c.unitTypeId, currentAccessMethod: c.access.method, rate: c.billing.rate, unitTypeId: typeId, items, unitTypes };
}

// ---------------------------------------------------------------- move-out request (CUSTOMER owner, STAFF/FM)
export async function requestMoveOut(user: UserHydrated, id: string, date: string, reason?: string) {
  // Nhân viên / quản lý đăng ký THAY khách: bắt buộc ghi lý do (khách yêu cầu tại quầy / qua điện thoại…) — lưu, ghi nhật ký và báo
  // khách qua email, để không ai tự đóng hợp đồng của khách mà khách không biết (B1).
  const byStaff = user.role !== 'CUSTOMER';
  const why = reason?.trim() ?? '';
  if (byStaff && (why.length < 5 || why.length > 300)) throw Unprocessable('Đăng ký trả kho thay khách — ghi lý do (5–300 ký tự), VD khách yêu cầu tại quầy lúc …', 'MOVE_OUT_REASON_REQUIRED');
  const c = await withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertCanAccess(user, c, 'contract.move_out_request');
    if (user.role === 'CUSTOMER' && c.balance.outstanding > 0) throw Unprocessable('Vui lòng thanh toán công nợ trước khi đăng ký trả kho');
    // Đợt 17 (D3): Điều 9 — hợp đồng đang nợ / bị khoá thì trả kho do Quản lý chi nhánh làm (máy trạng thái giữ nguyên, báo lỗi rõ ràng trước khi tới đó).
    if (user.role === 'STAFF' && (c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT')) throw Forbidden('Hợp đồng đang nợ quá hạn / bị khoá — việc trả kho do Quản lý chi nhánh làm', 'MOVE_OUT_FM_ONLY');
    const scheduledFor = toDateOnly(date);
    if (scheduledFor < todayUTC()) throw Unprocessable('Ngày trả kho không được ở quá khứ');
    // Không cho "đăng ký treo" hàng tháng: hẹn xa nhất MAX_MOVE_OUT_LEAD_DAYS ngày (tiền thuê vẫn tính đến ngày bàn giao thật).
    if (scheduledFor > addDays(todayUTC(), MAX_MOVE_OUT_LEAD_DAYS)) throw Unprocessable(`Chỉ hẹn trả kho trong vòng ${MAX_MOVE_OUT_LEAD_DAYS} ngày tới`, 'MOVE_OUT_TOO_FAR');
    c.transitionTo('MOVE_OUT_PENDING', { actor: user.role, by: user._id, reason: byStaff ? why : undefined });
    c.moveOut = { requestedAt: new Date(), scheduledFor, returnedOn: null, completedAt: null, inspectionId: null, reason: byStaff ? why : null, requestedBy: user._id, handover: null };
    await c.save({ session });
    await audit({ action: 'contract.move_out_request', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: byStaff ? why : null, changes: { after: { scheduledFor, onBehalf: byStaff } } }, session);
    return c;
  });
  // Email báo khách gửi SAU commit, không chờ (mailCustomer không bao giờ ném lỗi — chỉ ghi log).
  if (byStaff) {
    void mailCustomer(c.customerId, `KhoAn — Đăng ký trả kho hợp đồng ${c.contractNumber}`, [
      `Chi nhánh đã đăng ký trả kho thay bạn cho hợp đồng ${c.contractNumber}, hẹn bàn giao ngày ${fmtDate(c.moveOut!.scheduledFor!.toISOString())}.`,
      `Lý do ghi nhận: ${why}`,
      'Nếu bạn KHÔNG yêu cầu trả kho, hãy rút đăng ký trên trang web KhoAn (mục Kho đang thuê) hoặc ứng dụng KhoAn (tab Kho của tôi) hoặc liên hệ ngay chi nhánh. Tiền thuê vẫn được tính cho tới ngày bạn thực tế bàn giao kho.',
    ]);
  }
  return c;
}

// ---------------------------------------------------------------- rút đăng ký trả kho (CUSTOMER chủ hợp đồng, STAFF/FM)
/**
 * Khách đổi ý, tiếp tục thuê. Chỉ rút được khi CHƯA bàn giao kho (nhân viên chưa bấm nhận lại) — đã bàn giao thì
 * quyền truy cập đã thu hồi và ô đang chờ kiểm tra, phải quyết toán cho xong. Hợp đồng về lại ACTIVE; tiền thuê
 * vốn vẫn được tính suốt thời gian chờ trả nên không có kỳ nào bị bỏ sót.
 */
export async function cancelMoveOut(user: UserHydrated, id: string) {
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertCanAccess(user, c, 'contract.move_out_cancel');
    if (c.status !== 'MOVE_OUT_PENDING') throw Unprocessable('Hợp đồng không có đăng ký trả kho nào đang chờ');
    if (c.access.revokedAt || c.moveOut?.returnedOn) throw Unprocessable('Kho đã được bàn giao lại cho chi nhánh — không rút đăng ký trả kho được nữa', 'ALREADY_RETURNED');
    const before = { scheduledFor: c.moveOut?.scheduledFor ?? null };
    // Đăng ký lúc đang nợ / bị khoá (quản lý đăng ký hộ) thì rút xong vẫn là nợ / bị khoá — không "xoá nợ" bằng cách rút đăng ký.
    c.transitionTo(statusBeforeMoveOut(c), { actor: user.role, by: user._id, reason: 'Rút đăng ký trả kho' });
    c.moveOut = null;
    await c.save({ session });
    await audit({ action: 'contract.move_out_cancel', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { before } }, session);
    return c;
  });
}

// ---------------------------------------------------------------- keys returned (STAFF, FM)
/** `accessReset` (đợt 17 A1): đã thu chìa / thẻ hoặc đã đặt lại ổ khoá ngay lúc nhận lại kho — cùng ý nghĩa `oldAccessReset` khi đổi ô. Không tick thì ghi nhận sau ở POST /units/:id/access-reset. */
export type HandoverInput = (
  | { method: 'CUSTOMER_SIGNATURE'; signerName: string; image: string }
  | { method: 'MANAGER_CONFIRM'; reason: string }
) & { accessReset?: boolean };

/**
 * Nhận lại kho: bắt buộc xác nhận bàn giao (B2) — khách có mặt ký tay trên màn hình (ảnh PNG), hoặc khách vắng mặt (bỏ đi / gửi
 * chìa) thì CHỈ Quản lý chi nhánh xác nhận kèm lý do. Nhân viên không tự "nhận lại kho" của khách khi không có khách.
 */
export async function receiveUnit(user: UserHydrated, id: string, handover: HandoverInput) {
  if (handover.method === 'MANAGER_CONFIRM' && user.role !== 'FACILITY_MANAGER') {
    throw Forbidden('Khách vắng mặt — chỉ Quản lý chi nhánh xác nhận nhận lại kho', 'HANDOVER_FM_ONLY');
  }
  // Ảnh PNG thật (đúng chữ ký file, đọc được kích thước) — không nhận chuỗi base64 bất kỳ.
  if (handover.method === 'CUSTOMER_SIGNATURE' && !isValidPngDataUrl(handover.image)) throw Unprocessable('Ảnh chữ ký không hợp lệ — ký lại trên màn hình', 'SIGNATURE_INVALID');
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'unit.receive');
    if (c.status !== 'MOVE_OUT_PENDING') throw Unprocessable('Khách chưa đăng ký trả kho');
    const now = new Date();
    // Đợt 17 (A1): mọi đường khách rời ô đều ghi accessReset; hợp đồng vẫn giữ hình thức khoá / số thẻ của ô này (không cấp phương tiện mới).
    const unit = await StorageUnitModel.findOneAndUpdate(
      { _id: c.unitId, status: 'OCCUPIED', currentContractId: c._id },
      { $set: { status: 'PENDING_INSPECTION', overlockActive: false, statusChangedAt: now, statusReason: 'Khách bàn giao lại kho',
        accessReset: oldUnitAccessReset(c, now, handover.accessReset ? { by: user._id, byName: user.fullName } : null, 'Ghi nhận ngay khi nhận lại kho') } },
      { new: true, session },
    );
    if (!unit) throw Conflict('Kho không ở trạng thái đang thuê', 'UNIT_STATE_MISMATCH');
    c.access.revokedAt = now;
    // Ngày khách THỰC TẾ bàn giao — mốc để quyết toán (trả sớm hay không, đã dùng bao lâu), không dùng ngày khách tự hẹn.
    c.set('moveOut.returnedOn', todayUTC());
    c.set('moveOut.handover', handover.method === 'CUSTOMER_SIGNATURE'
      ? { method: handover.method, at: now, by: user._id, signerName: handover.signerName.trim(), image: handover.image, reason: null }
      : { method: handover.method, at: now, by: user._id, signerName: null, image: null, reason: handover.reason.trim() });
    await c.save({ session });
    // Khách đã trả kho thì yêu cầu đổi ô còn treo (kể cả đã duyệt) không bao giờ thực hiện được nữa — huỷ để nhả ô đang giữ.
    await releaseOpenSwapRequests(c._id, session, 'Khách đã trả kho');
    // Đợt 16 (C4): tiền đơn dịch vụ / phí cấp lại bị huỷ hoàn trong quyết toán (biên bản trả kho) — cấn công nợ, phần thiếu trước.
    await cancelOpenServiceOrders(c._id, session, 'Khách đã trả kho — đơn chưa thực hiện được hoàn tiền (trong quyết toán)', { atSettlement: true });
    await cancelOpenAccessRequests(c._id, 'Khách đã trả kho — huỷ yêu cầu cấp lại, hoàn phí (trong quyết toán)', session, undefined, { atSettlement: true });
    await closeOpenLostTasks(c._id, 'Khách đã trả kho — việc thu chìa / thẻ, đặt lại khoá theo dõi ở ô kho', user._id, session); // đợt 17 (D8)
    await cancelOpenIntakes(c._id, 'Khách đã trả kho — đợt nhập chưa xác nhận tự huỷ', session);
    // A7: khách bàn giao lại kho → mọi món đồ còn đang gửi ghi "trả khi trả kho" (ngày bàn giao).
    await markGoodsRemoved(c._id, 'RETURNED', todayUTC(), user._id, 'Khách bàn giao lại kho', session);
    await audit({
      action: 'unit.receive', entityType: 'StorageUnit', entityId: unit._id, facilityId: c.facilityId,
      reason: handover.method === 'MANAGER_CONFIRM' ? handover.reason : null,
      changes: { after: { contract: c.contractNumber, handover: handover.method, signerName: handover.method === 'CUSTOMER_SIGNATURE' ? handover.signerName : null, accessReset: !!handover.accessReset } },
    }, session);
    const view = c.toObject();
    if (view.moveOut?.handover) view.moveOut.handover.image = null; // ảnh chữ ký chỉ lưu, không trả ra
    return { contract: view, unit, ...accessResetOutcome(unit) };
  });
}

// ---------------------------------------------------------------- move-out inspection + deposit settlement (STAFF, FM)
export interface LeftItemsInput { present: boolean; description?: string; photoUrls?: string[] }

/**
 * Tiền thuê đã trả trước khi gia hạn (RENEWAL) cho các kỳ CHƯA bắt đầu tại ngày `returnedOn` (unusedPrepaidRent — đợt 15 B9: chỉ kỳ bắt
 * đầu SAU ngày bàn giao). Dùng chung cho biên bản trả kho và xử lý hàng bỏ lại (F4). Đợt 16 (A1): là số khách THỰC TRẢ cho các kỳ đó —
 * phần RENEWAL còn lại (trừ phần đã hoàn khi đổi sang cỡ nhỏ hơn) + phần SIZE_CHANGE thu thêm (đổi sang cỡ lớn hơn) thuộc các kỳ đó
 * (unusedRenewalRefunds), tách theo từng khoản. Khoản SIZE_CHANGE còn chờ thu cũng tính: nó nằm trong công nợ và được cấn trừ khi quyết toán.
 */
async function unusedRenewalRent(c: ContractDoc, returnedOn: Date, session: ClientSession) {
  const paidRenewals = c.renewals.filter((x) => x.paymentId);
  const pays = await PaymentModel.find({
    $or: [{ _id: { $in: paidRenewals.map((x) => x.paymentId) }, status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }, { contractId: c._id, type: 'SIZE_CHANGE', status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'PENDING'] } }],
  }).sort({ createdAt: -1 }).session(session);
  const unused = unusedRenewalRefunds({
    period: c.billing.rentalPeriod, returnedOn, contract: c,
    // Đợt 14: gia hạn tháng chỉ trả trước tháng đầu (prepaidUntil) — số kỳ trả trước tính theo mốc đó, không theo số tháng gia hạn.
    renewals: paidRenewals.flatMap((x) => {
      const p = pays.find((y) => String(y._id) === String(x.paymentId));
      return p ? [{ key: String(p._id), previousEndDate: x.previousEndDate, periods: x.periods, amount: p.amount, refundedAmount: p.refundedAmount ?? 0, prepaidUntil: x.prepaidUntil ?? null }] : [];
    }),
    sizeCharges: pays.filter((p) => p.type === 'SIZE_CHANGE').map((p) => ({ key: String(p._id), amount: p.amount, refundedAmount: p.refundedAmount ?? 0 })),
  });
  return { unused, pays };
}

/** Khoản đã thu được hoàn thêm `n` đồng: ghi số đã hoàn (không vượt số đã thu) + Hoàn một phần / Đã hoàn. Khoản chờ thu thì không đổi. */
async function markRefunded(p: PaymentHydrated, n: number, reason: string, session: ClientSession) {
  if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIALLY_REFUNDED') return;
  p.refundedAmount = Math.min(p.amount, (p.refundedAmount ?? 0) + n);
  const next = p.refundedAmount >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  if (p.status !== next) p.transitionTo(next, { actor: 'SYSTEM', reason });
  await p.save({ session });
}

/**
 * Ghi sổ phần tiền thuê gia hạn trả trước chưa dùng: `offset` đồng cấn trừ vào nợ (REFUND nội bộ), phần còn lại hoàn thật theo khoản gốc
 * (qua cổng đã trả, hoặc chuyển khoản chờ xác nhận); khoản gốc ghi số đã hoàn. Đợt 16 (A1): theo TỪNG khoản (RENEWAL / SIZE_CHANGE), mỗi
 * khoản tối đa số còn lại của nó.
 */
async function refundUnusedRenewals(c: ContractDoc, x: Awaited<ReturnType<typeof unusedRenewalRent>>, offset: number, by: Types.ObjectId, why: string, session: ClientSession) {
  let offsetLeft = offset;
  for (const it of x.unused.items) {
    const p = x.pays.find((y) => String(y._id) === it.key)!;
    const off = Math.min(it.amount, offsetLeft);
    offsetLeft -= off;
    // Phần cấn trừ vào hư hại / công nợ ghi sổ nội bộ (không có tiền ra); phần còn lại là tiền hoàn thật.
    if (off > 0) await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: off, status: 'SUCCEEDED', method: 'INTERNAL', refundOf: p._id }, session);
    // Hoàn theo KHOẢN GỐC (refundMethodFor): khách trả online qua cổng → hoàn qua cổng; trả tại quầy → chuyển khoản chờ xác nhận.
    if (it.amount - off > 0) await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: it.amount - off, status: 'SUCCEEDED', method: refundMethodFor(p), refundOf: p._id, createdBy: by }, session);
    await markRefunded(p, it.amount, p.type === 'SIZE_CHANGE' ? `${why} — hoàn phần chênh đổi cỡ của kỳ gia hạn chưa dùng` : `${why} — hoàn ${it.unusedPeriods} kỳ gia hạn chưa dùng`, session);
  }
}

/**
 * Đợt 16 (C4) — tiền đơn dịch vụ / phí cấp lại thẻ, chìa bị huỷ khi trả kho / xử lý hàng bỏ lại (`refundAtSettlement`, chưa hoàn): như tiền
 * gia hạn trả trước chưa dùng (F4 đợt 15) — cấn vào công nợ & phần thiếu trước (REFUND nội bộ), chỉ chi phần dư (theo khoản gốc).
 */
async function settlementCredits(c: ContractDoc, session: ClientSession) {
  const open = { contractId: c._id, status: 'CANCELLED', refundAtSettlement: true, refundPaymentId: null };
  const [orders, requests] = await Promise.all([ServiceOrderModel.find(open).session(session), AccessRequestModel.find(open).session(session)]);
  const docs = [...orders.map((o) => ({ doc: o, due: o.total })), ...requests.map((o) => ({ doc: o, due: o.fee }))];
  const pays = await PaymentModel.find({ _id: { $in: docs.map((x) => x.doc.paymentId).filter(Boolean) }, status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }).session(session);
  const items = docs.flatMap((x) => {
    const pay = pays.find((p) => String(p._id) === String(x.doc.paymentId));
    const amount = pay ? Math.min(x.due, pay.amount - (pay.refundedAmount ?? 0)) : 0;
    return pay && amount > 0 ? [{ doc: x.doc, pay, amount }] : [];
  });
  return { total: items.reduce((s, x) => s + x.amount, 0), items };
}

/** Ghi sổ tiền dịch vụ / phí cấp lại bị huỷ: `offset` đồng cấn nội bộ vào nợ, còn lại hoàn theo khoản gốc; đơn / yêu cầu ghi khoản hoàn. */
async function refundCredits(c: ContractDoc, x: Awaited<ReturnType<typeof settlementCredits>>, offset: number, by: Types.ObjectId, why: string, session: ClientSession) {
  let offsetLeft = offset;
  for (const it of x.items) {
    const off = Math.min(it.amount, offsetLeft);
    offsetLeft -= off;
    const base = { facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND' as const, status: 'SUCCEEDED' as const, refundOf: it.pay._id };
    const internal = off > 0 ? await createPayment({ ...base, amount: off, method: 'INTERNAL' }, session) : null;
    const paid = it.amount - off > 0 ? await createPayment({ ...base, amount: it.amount - off, method: refundMethodFor(it.pay), createdBy: by }, session) : null;
    await markRefunded(it.pay, it.amount, why, session);
    it.doc.refundPaymentId = (paid ?? internal)!._id;
    await it.doc.save({ session });
  }
}

/**
 * Đợt 15 (F5) — trạng thái tiền giữ chân sau quyết toán (trả kho / xử lý hàng bỏ lại): có hoàn bằng chuyển khoản đang chờ → REFUND_PENDING
 * ("Đang hoàn — chờ chuyển", confirmPayout chuyển thành Đã hoàn / Hoàn một phần); không hoàn đồng nào vì đã dùng trả nợ / hư hại / phí →
 * APPLIED ("Đã cấn trừ") — không gọi là "Không hoàn". Số đã hoàn ghi lên TỪNG khoản giữ chân ở refundDeposits (đợt 16 A3).
 */
function settleDepositStatus(c: ContractDoc, refundAmount: number, refunds: { status: string }[]) {
  c.deposit.refundedAmount = refundAmount;
  c.deposit.status = refundAmount <= 0 ? 'APPLIED'
    : refunds.some((x) => x.status === 'PENDING') ? 'REFUND_PENDING'
      : refundAmount >= c.deposit.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

/**
 * Đợt 15 (C3) — tiền giữ chân BỔ SUNG khi đổi sang cỡ kho lớn hơn mà khách CHƯA nộp (khoản DEPOSIT của hợp đồng còn chờ): chưa thật sự
 * giữ, nên quyết toán không cấn trừ / hoàn phần này và cũng không coi là nợ của khách — huỷ khoản đó, trừ khỏi tiền giữ chân và công nợ
 * trước khi quyết toán (biên bản ghi đúng số tiền giữ chân thật sự đang giữ).
 */
async function excludeUnpaidDepositTopUp(c: ContractDoc, session: ClientSession) {
  const open = await PaymentModel.find({ contractId: c._id, type: 'DEPOSIT', direction: 'CHARGE', status: 'PENDING' }).session(session);
  const topUp = open.reduce((s, p) => s + p.amount, 0);
  if (!topUp) return 0;
  for (const p of open) { p.transitionTo('CANCELLED', { actor: 'SYSTEM', reason: 'Tiền giữ chân bổ sung (đổi cỡ kho) chưa nộp — huỷ khi quyết toán' }); await p.save({ session }); }
  c.deposit.amount = Math.max(0, c.deposit.amount - topUp);
  c.balance.outstanding = Math.max(0, c.balance.outstanding - topUp);
  return topUp;
}

export async function submitMoveOutInspection(user: UserHydrated, id: string, input: { checklist: InspectionLog['checklist']; damages: InspectionLog['damages']; notes?: string; leftItems: LeftItemsInput }) {
  const left = input.leftItems.present
    ? { present: true, description: input.leftItems.description?.trim() ?? '', photoUrls: input.leftItems.photoUrls ?? [] }
    : { present: false, description: null, photoUrls: [] as string[] };
  if (left.present && (!left.description || left.description.length < 3 || !left.photoUrls.length)) {
    throw Unprocessable('Khách để lại đồ — mô tả đồ để lại và chụp ít nhất 1 ảnh', 'LEFT_ITEMS_DETAIL_REQUIRED');
  }
  const done = await withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'inspection.move_out');
    const unit = await StorageUnitModel.findById(c.unitId).session(session);
    // Đợt 17 (A1): ô đã lập biên bản xong có thể vẫn ở chờ kiểm tra (chờ thu chìa / đặt lại khoá) nhưng đã nhả hợp đồng — không lập biên bản lần hai.
    if (!unit || unit.status !== 'PENDING_INSPECTION' || String(unit.currentContractId) !== String(c._id)) throw Unprocessable('Kho chưa ở trạng thái chờ kiểm tra — hãy xác nhận nhận lại kho trước');

    await excludeUnpaidDepositTopUp(c, session); // đợt 15 (C3)
    // Yêu cầu cấp lại thẻ / chìa còn treo (nếu có) không còn ý nghĩa — huỷ, phí hoàn trong quyết toán (đợt 16 C4).
    await cancelOpenAccessRequests(c._id, 'Đã trả kho — huỷ yêu cầu cấp lại, hoàn phí (trong quyết toán)', session, undefined, { atSettlement: true });
    await closeOpenLostTasks(c._id, 'Đã trả kho — việc thu chìa / thẻ, đặt lại khoá theo dõi ở ô kho', user._id, session); // đợt 17 (D8) — bàn giao trước khi có bước này
    const damageFee = input.damages.reduce((s, d) => s + d.cost, 0);
    // Kiểm soát hai cấp: chi phí hư hại lớn do Quản lý chi nhánh lập biên bản, nhân viên không tự trừ tiền giữ chân / ghi nợ khách.
    if (user.role === 'STAFF' && damageFee > DAMAGE_STAFF_LIMIT) {
      throw Forbidden(`Chi phí hư hại trên ${DAMAGE_STAFF_LIMIT.toLocaleString('vi-VN')} ₫ cần Quản lý chi nhánh lập biên bản`, 'DAMAGE_NEEDS_FM');
    }
    const priorOutstanding = c.balance.outstanding;

    // Trả kho SỚM (trước endDate của kỳ hạn hiện tại) bị áp trần hoàn cọc theo % thời gian đã dùng —
    // trả đúng/quá hạn là move-out bình thường, không bị phạt thêm. Mốc xét là ngày khách THỰC TẾ bàn giao kho
    // (returnedOn, ghi lúc nhân viên nhận lại), KHÔNG phải ngày khách tự hẹn — hẹn ngày hết hạn rồi trả ngay hôm sau
    // vẫn là trả sớm. Hợp đồng cũ chưa có returnedOn thì lấy ngày thu hồi quyền truy cập.
    // CHỈ áp cho hợp đồng có cam kết thời hạn (được giảm giá thuê dài hạn): hợp đồng ngắn / theo ngày / theo tuần không được
    // ưu đãi gì nên trả sớm vẫn hoàn đủ tiền giữ chân (sau hư hại, công nợ).
    let earlyTermination: NonNullable<InspectionLog['depositSettlement']>['earlyTermination'] = null;
    let refundCap: number | null = null;
    let clawbackDue = 0;
    let usedPeriods: number | null = null;
    const returnedOn = c.moveOut?.returnedOn ?? (c.access.revokedAt ? localDay(c.access.revokedAt) : todayUTC());
    const rsv = await ReservationModel.findById(c.reservationId, { quote: 1 }).session(session).lean();
    // Kỳ cam kết khách đang "phá" khi trả kho hôm nay: kỳ gốc hoặc một lần gia hạn (mỗi lần gia hạn là cam kết mới, giá và ưu đãi
    // riêng). Đã hết hạn mà không gia hạn → không trong kỳ nào → không bị giới hạn mức hoàn, không thu hồi ưu đãi.
    const iso = (d: Date) => d.toISOString();
    const seg = exitCommitment(
      { startDate: iso(c.startDate), endDate: iso(c.endDate), commitments: (c.commitments ?? []).map((x) => ({ startDate: iso(x.startDate), endDate: iso(x.endDate), gross: x.gross, discountAmount: x.discountAmount, policyId: x.policyId ? String(x.policyId) : null,
        repricings: (x.repricings ?? []).map((r) => ({ from: iso(r.from), gross: r.gross, discountAmount: r.discountAmount, rate: r.rate })) })) },
      rsv ? { rentalPeriod: rsv.quote.rentalPeriod, rate: rsv.quote.rate, surchargeAmount: rsv.quote.surchargeAmount, discountAmount: rsv.quote.discountAmount, policyId: String(rsv.quote.policyId) } : null,
      iso(returnedOn),
    );
    if (seg && seg.discountAmount > 0 && c.billing.rentalPeriod === 'MONTH') {
      // Chính sách ĐÃ CHỐT lúc cam kết (lúc đặt với kỳ gốc, lúc gia hạn với kỳ gia hạn) — không lấy bản đang áp dụng, nếu không
      // Quản lý vận hành đổi bảng giữa chừng là khách bị quyết toán khác với điều đã thoả thuận.
      const policy = (seg.policyId ? await PolicyModel.findById(seg.policyId).session(session) : null) ?? await effectivePolicy(c.facilityId, session);
      const elapsedPct = elapsedTermPct(new Date(seg.startDate), new Date(seg.endDate), returnedOn);
      const refundCapPct = earlyTerminationRefundPct(policy, elapsedPct);
      refundCap = Math.round((c.deposit.amount * refundCapPct) / 100);
      earlyTermination = { elapsedPct: Math.round(elapsedPct), refundCapPct };
      // Thu hồi ưu đãi thuê dài hạn của CHÍNH kỳ cam kết đó: trả sớm thì chỉ được mức giảm của số tháng thực dùng trong kỳ.
      // Trừ vào phần tiền giữ chân còn lại (không truy thu vượt quá).
      // Kỳ đã đổi cỡ kho (đợt 15 C3): tính từng tháng theo giá / ưu đãi thực tế trước và sau ngày đổi (commitmentClawback).
      const claw = commitmentClawback(seg, policy.discounts, iso(returnedOn));
      if (claw) { clawbackDue = claw.amount; usedPeriods = claw.usedPeriods; }
    }
    // Tiền thuê trả trước khi gia hạn cho các kỳ CHƯA bắt đầu tại ngày bàn giao: trả lại khách (trước đây mất trắng). Phần này
    // cấn trừ vào hư hại / công nợ vượt tiền giữ chân trước, còn lại mới hoàn tiền.
    const prepaid = await unusedRenewalRent(c, returnedOn, session);
    const unused = prepaid.unused;
    // Đợt 16 (C4): tiền đơn dịch vụ / phí cấp lại bị huỷ khi trả kho — như tiền gia hạn chưa dùng: cấn phần thiếu trước, còn lại hoàn.
    const credits = await settlementCredits(c, session);

    // Quyết toán theo MỘT công thức dùng chung (shared/move-out-rules) — khi khách khiếu nại đúng, điều chỉnh tính lại y hệt
    // với mức hư hại mới. Chi phí hư hại + công nợ VƯỢT tiền giữ chân: không xoá, ghi thành khoản nợ còn lại sau quyết toán.
    const settled = settleDeposit({ deposit: c.deposit.amount, damage: damageFee, priorOutstanding, refundCap, clawbackDue, prepaidUnused: unused.total + credits.total });
    const { refund: refundAmount, shortfall, clawback, deductions } = settled;
    // Phần cấn trừ / hoàn chia: tiền gia hạn chưa dùng trước, rồi tiền dịch vụ / phí cấp lại.
    const prepaidRentOffset = Math.min(unused.total, settled.prepaidOffset);
    const prepaidRentRefund = unused.total - prepaidRentOffset;
    const creditOffset = settled.prepaidOffset - prepaidRentOffset;
    const creditRefund = credits.total - creditOffset;
    if (earlyTermination && usedPeriods !== null) earlyTermination = { ...earlyTermination, discountClawback: clawback, usedPeriods };
    const outcome: InspectionLog['outcome'] = input.damages.some((d) => d.severity === 'SEVERE') ? 'MAINTENANCE_REQUIRED' : input.damages.length ? 'PASS_WITH_DAMAGE' : 'PASS';
    const now = new Date();

    if (refundAmount > 0 && !c.deposit.paymentId) throw Conflict('Hợp đồng thiếu tham chiếu khoản tiền giữ chân');
    const damagePay = damageFee > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'DAMAGE_FEE', amount: damageFee, status: 'SUCCEEDED', method: 'INTERNAL' }, session)
      : null;
    // Khoản thu hồi ưu đãi ghi sổ riêng (cấn trừ nội bộ vào tiền giữ chân) để khách và kế toán thấy rõ vì sao bị trừ.
    if (clawback > 0) await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'DISCOUNT_CLAWBACK', amount: clawback, status: 'SUCCEEDED', method: 'INTERNAL' }, session);
    // Đợt 16 (A3): hoàn theo TỪNG khoản giữ chân (gốc + nộp bù khi đổi cỡ), khoản mới nhất trước, mỗi khoản tối đa số còn lại — chuyển
    // khoản chờ xác nhận như trước (F5).
    const refunds = await refundDeposits(c, refundAmount, { method: 'BANK_TRANSFER', by: user._id, reason: 'Quyết toán tiền giữ chân khi trả kho' }, session);

    await refundUnusedRenewals(c, prepaid, prepaidRentOffset, user._id, 'Trả kho', session);
    await refundCredits(c, credits, creditOffset, user._id, 'Trả kho — hoàn đơn dịch vụ / phí cấp lại đã huỷ', session);

    const inspectionId = new Types.ObjectId();
    const [inspection] = await InspectionModel.create([{
      _id: inspectionId, facilityId: c.facilityId, unitId: unit._id, contractId: c._id, type: 'MOVE_OUT', status: 'APPROVED',
      inspectorId: user._id, performedAt: now, checklist: input.checklist, damages: input.damages, outcome, notes: input.notes, leftItems: left,
      depositSettlement: { depositHeld: c.deposit.amount, deductions, refundAmount, shortfall, prepaidRentRefund, prepaidRentOffset, creditRefund, creditOffset, priorOutstanding, refundCap, clawbackDue, refundPaymentId: refunds[0]?._id ?? null, damagePaymentId: damagePay?._id ?? null, approvedBy: user._id, approvedAt: now, earlyTermination },
    }], { session });

    // Outstanding charges are settled from the deposit
    await PaymentModel.updateMany({ contractId: c._id, direction: 'CHARGE', status: 'PENDING' }, { $set: { status: 'CANCELLED' }, $push: { statusHistory: { from: 'PENDING', to: 'CANCELLED', at: now, reason: 'Cấn trừ vào tiền giữ chân' } } }, { session });

    // Phần còn thiếu: một khoản phải thu riêng, chờ khách trả (online hoặc tại quầy) hay quản lý xoá nợ có lý do.
    if (shortfall > 0) {
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SETTLEMENT_DEBT', amount: shortfall, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `settlement-debt-${c._id}` }, session);
    }

    c.transitionTo('CLOSED', { actor: user.role, by: user._id });
    c.closedAt = now;
    // Giữ nguyên lý do / xác nhận bàn giao đã ghi — chỉ bổ sung các mốc của biên bản.
    if (!c.moveOut) c.moveOut = { requestedAt: now, scheduledFor: null, returnedOn, completedAt: now, inspectionId };
    else { c.set('moveOut.returnedOn', returnedOn); c.set('moveOut.completedAt', now); c.set('moveOut.inspectionId', inspectionId); }
    // A7: hợp đồng cũ chưa ghi trả đồ lúc nhận lại kho — ghi bổ sung theo ngày bàn giao (đã ghi rồi thì không thêm gì).
    await markGoodsRemoved(c._id, 'RETURNED', returnedOn, user._id, 'Khách bàn giao lại kho', session);
    // Đồ khách để lại: giữ LEFTOVER_HOLD_DAYS ngày (B3), ô chưa cho thuê lại trong thời gian giữ.
    const holdUntil = left.present ? addDays(todayUTC(), LEFTOVER_HOLD_DAYS) : null;
    c.leftover = left.present ? { description: left.description!, photoUrls: left.photoUrls, holdUntil: holdUntil!, status: 'HELD', recordedAt: now, resolvedAt: null, resolvedBy: null, fee: null, note: null, feePaymentId: null } : null;
    settleDepositStatus(c, refundAmount, refunds); // F5
    c.balance.outstanding = shortfall;
    c.delinquency = null;
    await c.save({ session });

    // Đợt 17 (A1): sạch nhưng chưa ghi nhận thu chìa / thẻ, đặt lại khoá → ô ở lại chờ kiểm tra, đã nhả hợp đồng; ghi nhận rồi nhân viên chủ động mở cho
    // thuê (như đường đổi ô). Hư hại / đồ để lại → bảo trì như cũ, mở cho thuê về sau cũng bị chốt ACCESS_RESET_REQUIRED.
    ensureAccessReset(unit, c, now);
    const resetLeft = accessResetPending(unit);
    const next: UnitStatus = outcome === 'MAINTENANCE_REQUIRED' || left.present ? 'MAINTENANCE' : resetLeft ? 'PENDING_INSPECTION' : 'AVAILABLE';
    const holdNote = holdUntil ? `Giữ đồ khách để lại đến ${fmtDate(holdUntil.toISOString()).slice(0, 5)}` : null;
    const reason = outcome === 'MAINTENANCE_REQUIRED' ? ['Hư hại sau trả kho', holdNote].filter(Boolean).join('; ') : holdNote ?? undefined;
    if (next === 'PENDING_INSPECTION') unit.statusReason = `Chờ ${accessResetTask(unit.accessReset!.method, unit.accessReset!.keyTag)}`;
    else unit.transitionTo(next, { actor: user.role, by: user._id, reason: next === 'MAINTENANCE' ? reason : undefined });
    unit.currentContractId = null;
    unit.overlockActive = false;
    await unit.save({ session });

    const r = await ReservationModel.findById(c.reservationId).session(session);
    if (r && r.status === 'CHECKED_IN') { r.transitionTo('COMPLETED', { actor: 'SYSTEM' }); await r.save({ session }); }

    await audit({ action: 'inspection.move_out', entityType: 'InspectionLog', entityId: inspectionId, facilityId: c.facilityId, changes: { after: { damageFee, refundAmount, outcome, discountClawback: clawback, shortfall, prepaidRentRefund, prepaidRentOffset, creditRefund, creditOffset, leftItems: left.present, holdUntil, unitStatus: next, accessResetPending: resetLeft } } }, session);
    return { inspection, contract: c, holdUntil, unit };
  });
  if (done.holdUntil) {
    void mailCustomer(done.contract.customerId, `KhoAn — Đồ bạn để lại trong kho (hợp đồng ${done.contract.contractNumber})`, [
      `Khi kiểm tra ô kho sau khi bạn trả kho (hợp đồng ${done.contract.contractNumber}), chi nhánh ghi nhận đồ bạn còn để lại: ${left.description}.`,
      `Chi nhánh giữ đồ này ${LEFTOVER_HOLD_DAYS} ngày, đến ngày ${fmtDate(done.holdUntil.toISOString())} — vui lòng đến chi nhánh nhận lại trong thời gian này.`,
      'Quá thời hạn trên, chi nhánh được xử lý số đồ này và tính chi phí xử lý theo Điều 9 Điều khoản thuê kho (cộng vào khoản bạn còn nợ).',
    ]);
  }
  // Đợt 17 (A1): cho biết ô đã mở cho thuê chưa / còn thiếu việc thu chìa, thẻ hay đặt lại khoá không.
  return { inspection: done.inspection, contract: done.contract, unitStatus: done.unit.status, ...accessResetOutcome(done.unit) };
}

// ---------------------------------------------------------------- đồ khách để lại sau trả kho (STAFF, FM)
/**
 * Kết thúc việc giữ đồ khách để lại (B3): khách đến lấy (PICKED_UP — bất cứ lúc nào, nhân viên hoặc quản lý) hoặc quá hạn giữ thì
 * Quản lý chi nhánh xử lý (DISPOSED — chỉ từ ngày holdUntil, kèm phí ≥ 0). Phí > 0 thành khoản DISPOSAL_FEE khách còn nợ sau quyết
 * toán (như nợ quyết toán: chặn đặt kho mới, thu tại quầy / online, quản lý xoá nợ được trong hạn mức). Xong thì ô về AVAILABLE; đợt 17 (A1): chưa ghi nhận thu
 * chìa / thẻ, đặt lại khoá thì ô ở lại Bảo trì (statusReason nêu việc còn thiếu), ghi nhận rồi nhân viên chủ động mở cho thuê.
 */
export async function resolveLeftover(user: UserHydrated, id: string, input: { outcome: 'PICKED_UP' | 'DISPOSED'; fee?: number; note?: string }) {
  if (input.outcome === 'DISPOSED' && user.role !== 'FACILITY_MANAGER' && user.role !== 'OPS_MANAGER') throw Forbidden('Chỉ Quản lý chi nhánh xử lý đồ khách để lại', 'DISPOSE_FM_ONLY');
  // Phí xử lý lớn (trên ngưỡng duyệt của chi nhánh — cùng ngưỡng bồi thường / xử lý hàng bỏ lại) do Quản lý vận hành lập (E).
  if (input.outcome === 'DISPOSED' && (input.fee ?? 0) > CLAIM_FM_APPROVAL_LIMIT && user.role !== 'OPS_MANAGER') {
    throw Forbidden(`Phí xử lý trên ${vnd(CLAIM_FM_APPROVAL_LIMIT)} — chuyển Quản lý vận hành xử lý`, 'DISPOSAL_LIMIT');
  }
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.leftover');
    if (c.leftover?.status !== 'HELD') throw Unprocessable('Hợp đồng không có đồ khách để lại đang giữ', 'NO_LEFTOVER');
    const today = todayUTC();
    if (input.outcome === 'DISPOSED' && today < c.leftover.holdUntil) {
      throw Unprocessable(`Đang trong thời hạn giữ đồ cho khách — chỉ xử lý được từ ngày ${fmtDate(c.leftover.holdUntil.toISOString())}`, 'LEFTOVER_HOLD');
    }
    const fee = input.outcome === 'DISPOSED' ? Math.max(0, Math.trunc(input.fee ?? 0)) : 0;
    const now = new Date();
    const feePay = fee > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'DISPOSAL_FEE', amount: fee, status: 'PENDING', method: 'BANK_TRANSFER', createdBy: user._id, idempotencyKey: `leftover-fee-${c._id}` }, session)
      : null;
    if (fee > 0) c.balance.outstanding += fee;
    c.set('leftover.status', input.outcome);
    c.set('leftover.resolvedAt', now);
    c.set('leftover.resolvedBy', user._id);
    c.set('leftover.fee', input.outcome === 'DISPOSED' ? fee : null);
    c.set('leftover.note', input.note?.trim() || null);
    c.set('leftover.feePaymentId', feePay?._id ?? null);
    await c.save({ session });
    // Ô đang giữ đồ cho khách → trả về cho thuê; nếu ô còn hư hại cần sửa (biên bản MAINTENANCE_REQUIRED) thì vẫn bảo trì.
    const insp = c.moveOut?.inspectionId ? await InspectionModel.findById(c.moveOut.inspectionId, { outcome: 1 }).session(session).lean() : null;
    const unit = await StorageUnitModel.findById(c.unitId).session(session);
    if (unit && unit.status === 'MAINTENANCE' && !unit.currentContractId) {
      ensureAccessReset(unit, c, now);
      if (insp?.outcome === 'MAINTENANCE_REQUIRED') unit.statusReason = 'Hư hại sau trả kho';
      else if (accessResetPending(unit)) unit.statusReason = `Chờ ${accessResetTask(unit.accessReset!.method, unit.accessReset!.keyTag)}`;
      else unit.transitionTo('AVAILABLE', { actor: user.role, by: user._id });
      await unit.save({ session });
    }
    await audit({
      action: 'contract.leftover_resolve', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: input.note ?? null,
      changes: { after: { outcome: input.outcome, fee, unit: unit?.unitNumber ?? null, unitStatus: unit?.status ?? null } },
    }, session);
    return { contract: c, unit, fee, paymentId: feePay?._id ?? null, ...(unit ? accessResetOutcome(unit) : { accessResetPending: false, accessResetTask: null }) };
  });
}

/**
 * Xử lý đồ đạc bỏ lại (FM) — theo Điều 7 Điều khoản: hợp đồng đang bị khoá, ĐÃ gửi thông báo cuối và đã tới hạn chót trong thông báo
 * đó (`abandonAfterLockedOutDays` ngày kể từ thông báo cuối) mà khách vẫn không thanh toán / liên hệ. Kiểm kê vật dụng, chọn phương án
 * (thanh lý / quyên tặng / tiêu huỷ), ghi tiền thu được khi thanh lý và chi phí xử lý. Quyết toán: tiền giữ chân rồi tới tiền thanh lý
 * dùng trừ công nợ + chi phí; phần còn dư trả lại khách, phần còn thiếu thành nợ sau quyết toán (chặn đặt kho mới, quản lý xoá nợ
 * được trong hạn mức). Đóng hợp đồng, giải phóng ô và báo kết quả cho khách.
 */
export async function processAbandonment(
  user: UserHydrated,
  id: string,
  input: { items: { description: string; quantity: number }[]; disposalMethod: AbandonedItemsDisposal; notes?: string; proceeds: number; costs: number; photoUrls: string[]; accessReset?: boolean },
) {
  if (!input.photoUrls?.length) throw Unprocessable('Chụp ảnh hiện trạng / kiểm kê khi mở kho (ít nhất 1 ảnh)', 'PHOTOS_REQUIRED');
  // Tiền thanh lý hoặc chi phí lớn: Quản lý vận hành lập (cùng ngưỡng duyệt bồi thường) — tách quyền với chi nhánh (D3).
  if ((input.proceeds > CLAIM_FM_APPROVAL_LIMIT || input.costs > CLAIM_FM_APPROVAL_LIMIT) && user.role !== 'OPS_MANAGER') {
    throw Forbidden(`Tiền thanh lý hoặc chi phí trên ${vnd(CLAIM_FM_APPROVAL_LIMIT)} — chuyển Quản lý vận hành lập biên bản xử lý`, 'ABANDON_LIMIT');
  }
  const { result, notice } = await withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.abandonment');
    if (c.status !== 'LOCKED_OUT') throw Unprocessable('Chỉ xử lý được hợp đồng đang bị khóa truy cập');
    const finalNoticeAt = c.delinquency?.finalNoticeAt;
    if (!finalNoticeAt) throw Unprocessable('Chưa gửi thông báo cuối cho khách — gửi thông báo cuối và chờ hết hạn chót mới được xử lý đồ bỏ lại', 'FINAL_NOTICE_REQUIRED');
    const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
    // Hạn chót đúng như đã ghi trong thông báo khách nhận được; thiếu bản ghi thông báo (dữ liệu cũ) thì tính lại từ mốc gửi.
    const sent = [...(c.notices ?? [])].reverse().find((n) => n.kind === 'FINAL_NOTICE' && n.at >= finalNoticeAt);
    // Thông báo cuối phải ĐÃ TỚI khách (A5): email gửi thành công, hoặc quản lý đã ghi nhận báo bằng kênh khác.
    if (sent && sent.email?.status !== 'SENT' && !sent.manualDelivery) {
      throw Unprocessable('Thông báo cuối chưa tới được khách (email không gửi được) — báo khách qua điện thoại / thư bảo đảm / trực tiếp rồi ghi nhận trước khi xử lý đồ', 'NOTICE_NOT_DELIVERED');
    }
    const deadline = sent?.deadline ?? addDays(finalNoticeAt, abandonDaysOf(policy));
    if (todayUTC() < deadline) throw Unprocessable(`Chưa tới hạn chót trong thông báo cuối — chỉ xử lý được từ ngày ${fmtDate(deadline.toISOString())}`, 'ABANDON_TOO_EARLY');

    const unit = await StorageUnitModel.findById(c.unitId).session(session);
    if (!unit) throw NotFound('kho');
    await excludeUnpaidDepositTopUp(c, session); // đợt 15 (C3)
    // Đợt 16 (C4): đơn dịch vụ / yêu cầu cấp lại còn mở bị huỷ — tiền hoàn đi vào quyết toán bên dưới (cấn nợ trước, còn lại trả khách).
    await cancelOpenServiceOrders(c._id, session, 'Hợp đồng đóng do hàng bỏ lại — đơn chưa thực hiện được hoàn tiền (trong quyết toán)', { atSettlement: true });
    await cancelOpenAccessRequests(c._id, 'Hợp đồng đóng do hàng bỏ lại — huỷ yêu cầu cấp lại, hoàn phí (trong quyết toán)', session, undefined, { atSettlement: true });
    await closeOpenLostTasks(c._id, 'Hợp đồng đóng do hàng bỏ lại — việc thu chìa / thẻ, đặt lại khoá theo dõi ở ô kho', user._id, session); // đợt 17 (D8)

    // Quyết toán: tiền giữ chân → tiền thuê gia hạn trả trước chưa dùng (F4) → tiền thanh lý → trừ công nợ + chi phí xử lý. Phần dư của
    // tiền giữ chân / tiền thuê trả trước / tiền thanh lý trả lại khách; còn thiếu thành nợ sau quyết toán.
    const debt = c.balance.outstanding;
    const owed = debt + input.costs;
    const depositApplied = Math.min(c.deposit.amount, owed);
    const depositRefund = c.deposit.amount - depositApplied;
    const prepaid = await unusedRenewalRent(c, todayUTC(), session);
    const prepaidRentOffset = Math.min(prepaid.unused.total, owed - depositApplied);
    const prepaidRentRefund = prepaid.unused.total - prepaidRentOffset;
    // Đợt 16 (C4): tiền đơn dịch vụ / phí cấp lại vừa huỷ — cấn nợ còn lại trước tiền thanh lý, phần dư trả lại khách.
    const credits = await settlementCredits(c, session);
    const creditOffset = Math.min(credits.total, owed - depositApplied - prepaidRentOffset);
    const creditRefund = credits.total - creditOffset;
    const proceedsApplied = Math.min(input.proceeds, owed - depositApplied - prepaidRentOffset - creditOffset);
    const proceedsPayout = input.proceeds - proceedsApplied;
    const shortfall = owed - depositApplied - prepaidRentOffset - creditOffset - proceedsApplied;
    if (depositRefund > 0 && !c.deposit.paymentId) throw Conflict('Hợp đồng thiếu tham chiếu khoản tiền giữ chân');

    const now = new Date();
    // Công nợ cũ được cấn trừ trong quyết toán; phần không đủ bù chuyển thành một khoản nợ sau quyết toán bên dưới.
    await PaymentModel.updateMany(
      { contractId: c._id, direction: 'CHARGE', status: 'PENDING' },
      { $set: { status: 'CANCELLED' }, $push: { statusHistory: { from: 'PENDING', to: 'CANCELLED', at: now, reason: 'Quyết toán khi xử lý đồ bỏ lại — cấn trừ tiền giữ chân / tiền thanh lý' } } },
      { session },
    );
    const feePay = input.costs > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'DISPOSAL_FEE', amount: input.costs, status: 'SUCCEEDED', method: 'INTERNAL' }, session)
      : null;
    // Đợt 16 (A3): hoàn theo từng khoản giữ chân (mới nhất trước, tối đa số còn lại) — chuyển khoản chờ xác nhận như trước.
    const refunds = await refundDeposits(c, depositRefund, { method: 'BANK_TRANSFER', by: user._id, reason: 'Quyết toán tiền giữ chân khi xử lý hàng bỏ lại' }, session);
    if (proceedsPayout > 0) {
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'LIQUIDATION_PAYOUT', amount: proceedsPayout, status: 'SUCCEEDED', method: 'BANK_TRANSFER', createdBy: user._id }, session);
    }
    await refundUnusedRenewals(c, prepaid, prepaidRentOffset, user._id, 'Xử lý hàng bỏ lại', session);
    await refundCredits(c, credits, creditOffset, user._id, 'Xử lý hàng bỏ lại — hoàn đơn dịch vụ / phí cấp lại đã huỷ', session);
    if (shortfall > 0) {
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SETTLEMENT_DEBT', amount: shortfall, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `settlement-debt-${c._id}` }, session);
    }

    const inspectionId = new Types.ObjectId();
    const [inspection] = await InspectionModel.create([{
      _id: inspectionId, facilityId: c.facilityId, unitId: unit._id, contractId: c._id, type: 'ABANDONMENT', status: 'APPROVED',
      inspectorId: user._id, performedAt: now, outcome: 'PASS', notes: input.notes,
      abandonment: { items: input.items, disposalMethod: input.disposalMethod, proceeds: input.proceeds, costs: input.costs, finalNoticeAt, photoUrls: input.photoUrls },
      depositSettlement: {
        depositHeld: c.deposit.amount, deductions: depositApplied, refundAmount: depositRefund, shortfall, proceedsApplied, proceedsPayout, prepaidRentRefund, prepaidRentOffset, creditRefund, creditOffset,
        refundPaymentId: refunds[0]?._id ?? null, damagePaymentId: feePay?._id ?? null, approvedBy: user._id, approvedAt: now, earlyTermination: null,
      },
    }], { session });

    await releaseOpenSwapRequests(c._id, session, 'Hợp đồng đóng do hàng bỏ lại');
    await cancelOpenIntakes(c._id, 'Hợp đồng đóng do hàng bỏ lại — đợt nhập chưa xác nhận tự huỷ', session);
    // A7: đồ đã xác nhận còn trong kho → ghi "thanh lý" (đối chiếu với biên bản kiểm kê).
    await markGoodsRemoved(c._id, 'DISPOSED', todayUTC(), user._id, `Xử lý hàng bỏ lại (${input.disposalMethod})`, session);
    const daysSinceNotice = daysBetween(finalNoticeAt, todayUTC());
    c.transitionTo('ABANDONED', { actor: user.role, by: user._id, reason: `Đã thông báo cuối ${daysSinceNotice} ngày, khách không thanh toán / liên hệ` });
    c.closedAt = now;
    settleDepositStatus(c, depositRefund, refunds); // F5
    c.balance.outstanding = shortfall;
    c.delinquency = null;
    const notice = addNotice(c, 'ABANDONED', {
      amountDue: debt, by: user._id,
      extra: { disposalMethod: input.disposalMethod, itemCount: input.items.length, depositApplied, proceeds: input.proceeds, costs: input.costs, refund: depositRefund + prepaidRentRefund + creditRefund + proceedsPayout, shortfall },
    });
    await c.save({ session });

    // Đợt 17 (A1): khách bỏ đi vẫn còn giữ chìa / thẻ / mật khẩu → chưa ghi nhận thu hoặc đặt lại khoá thì ô dừng ở chờ kiểm tra, xong rồi mới AVAILABLE.
    unit.transitionTo('PENDING_INSPECTION', { actor: user.role, by: user._id, reason: 'Xử lý hàng bỏ lại' });
    unit.set('accessReset', oldUnitAccessReset(c, now, input.accessReset ? { by: user._id, byName: user.fullName } : null, 'Ghi nhận ngay khi xử lý hàng bỏ lại'));
    if (accessResetPending(unit)) unit.statusReason = `Chờ ${accessResetTask(unit.accessReset!.method, unit.accessReset!.keyTag)}`;
    else unit.transitionTo('AVAILABLE', { actor: user.role, by: user._id });
    unit.currentContractId = null;
    unit.overlockActive = false;
    await unit.save({ session });

    const r = await ReservationModel.findById(c.reservationId).session(session);
    if (r && r.status === 'CHECKED_IN') { r.transitionTo('COMPLETED', { actor: 'SYSTEM' }); await r.save({ session }); }

    await audit({
      action: 'contract.abandonment', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId,
      changes: { after: { daysSinceNotice, itemCount: input.items.length, photos: input.photoUrls.length, disposalMethod: input.disposalMethod, debt, costs: input.costs, proceeds: input.proceeds, depositApplied, depositRefund, prepaidRentOffset, prepaidRentRefund, creditOffset, creditRefund, proceedsPayout, shortfall, unitStatus: unit.status, accessResetPending: accessResetPending(unit) } },
    }, session);
    return { result: { inspection, contract: c, unitStatus: unit.status, ...accessResetOutcome(unit) }, notice };
  });
  await deliverNoticesSoon([notice]);
  return result;
}
