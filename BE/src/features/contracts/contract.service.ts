import { Types, type ClientSession } from 'mongoose';
import { abandonDaysOf, appendixTitle, fmtDate, isClosedContract, buildRenewalAppendix, DAMAGE_STAFF_LIMIT, discountClawback, exitCommitment, inspectionDisputeDeadline, INSPECTION_DISPUTE_DAYS, settleDeposit, settlementNet, type SettlementInputs, MAX_MOVE_OUT_LEAD_DAYS, PERIOD_UNIT, statusBeforeMoveOut, TERMS_VERSION, unusedPrepaidRent, type AbandonedItemsDisposal, type InspectionLog, type PaymentMethod, type UnitStatus } from '@ssm/shared';
import { InspectionModel, PaymentModel, PolicyModel, RentalContractModel, ReservationModel, StorageUnitModel, TicketModel, UnitTypeModel, type UserHydrated } from '../../shared/db/models';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { climateEligible, earlyTerminationRefundPct, effectivePolicy, elapsedTermPct, quote, signedPolicy } from '../policies/pricing';
import { addDays, addPeriodsUTC, daysBetween, localDay, todayUTC, toDateOnly } from '../../shared/utils/dates';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment } from '../payments/payment.service';
import { releaseOpenSwapRequests } from '../swaps/unit-swap-request.service';
import { cancelOpenServiceOrders } from '../services/services.service';
import { cancelOpenAccessRequests } from '../access/access.service';
import { moveAccessToUnit } from './unit-access';
import { addNotice, deliverNotices } from './contract-notice.service';
import { applyLockout } from './lockout';
import { assertContractProfile } from '../users/user.service';
import { contractParties } from '../reservations/contract-document.service';
import { buildContractPdf } from './contract-pdf';

const loadContract = async (id: string, session?: ClientSession) => {
  const c = await RentalContractModel.findById(id).session(session ?? null);
  if (!c) throw NotFound('hợp đồng');
  return c;
};

// ---------------------------------------------------------------- extend (CUSTOMER owner)
type ContractDoc = Awaited<ReturnType<typeof loadContract>>;

/**
 * Hợp đồng tạo trước khi có `commitments`: dựng lại kỳ cam kết GỐC từ báo giá lúc đặt, để khi gia hạn hệ thống biết đâu là
 * kỳ gốc (giá cũ) và đâu là kỳ gia hạn (giá mới) — không thì cả quãng trước bị coi như "ngoài cam kết".
 */
async function ensureInitialCommitment(c: ContractDoc, session: ClientSession) {
  if (c.commitments?.length) return;
  const rsv = await ReservationModel.findById(c.reservationId, { quote: 1, periods: 1 }).session(session).lean();
  const initialEnd = c.renewals[0]?.previousEndDate ?? c.endDate;
  c.commitments = [{
    kind: 'INITIAL', startDate: c.startDate, endDate: initialEnd, periods: rsv?.periods ?? 1,
    gross: rsv ? rsv.quote.rate + rsv.quote.surchargeAmount : c.billing.rate, discountAmount: rsv?.quote.discountAmount ?? 0, rate: c.billing.rate,
    policyId: rsv?.quote.policyId ?? c.terms.policyId, at: c.startDate,
  }] as ContractDoc['commitments'];
}

/**
 * Báo giá cho một lần gia hạn — GIA HẠN LÀ MỘT CAM KẾT MỚI:
 *  - giá gốc là giá NIÊM YẾT HIỆN HÀNH của loại kho (+ phụ phí điều hòa nếu hợp đồng đang dùng), theo chính sách đang áp dụng;
 *  - ưu đãi thuê dài hạn tính theo số tháng GIA HẠN, không cộng dồn thời gian đã thuê (cam kết bao lâu thì giảm theo bấy lâu);
 *  - thuê tháng: KHÔNG trả trước, tiền thuê vẫn xuất hoá đơn từng tháng với giá mới; thuê ngày / tuần: trả trọn khi gia hạn;
 *  - bắt đầu từ ngày hết hạn hiện tại, hoặc từ kỳ chưa xuất hoá đơn nếu hợp đồng đã quá hạn (không phủ lại kỳ đã tính tiền);
 *  - tiền giữ chân giữ nguyên, không thu thêm.
 */
async function quoteExtension(c: ContractDoc, periods: number, session?: ClientSession) {
  const policy = await effectivePolicy(c.facilityId, session);
  const ut = await UnitTypeModel.findById(c.unitTypeId).session(session ?? null);
  if (!ut) throw NotFound('loại kho');
  const period = c.billing.rentalPeriod;
  const q = quote(ut, policy, period, periods, !!c.useAirConditioning && climateEligible(policy, ut.category));
  const from = c.billing.nextBillingDate.getTime() > c.endDate.getTime() ? c.billing.nextBillingDate : c.endDate;
  const newEnd = addPeriodsUTC(from, period, periods);
  // Tổng thời gian thuê tính thô từ số ngày để chặn vượt trần chính sách.
  const perDays = period === 'MONTH' ? 30 : period === 'WEEK' ? 7 : 1;
  if (daysBetween(c.startDate, newEnd) / perDays > policy.maxPeriods + 1) throw Unprocessable(`Tổng thời hạn vượt tối đa ${policy.maxPeriods} ${PERIOD_UNIT[period]}`);
  const gross = q.rate + q.surchargeAmount;
  return {
    policy, period, periods, from, newEnd, gross, discountAmount: q.discountAmount, rate: q.firstPeriodRent,
    currentRate: c.billing.rate,
    // Thuê ngày / tuần trả trọn tiền thuê cả kỳ gia hạn ngay; thuê tháng trả theo từng tháng.
    payNow: period === 'MONTH' ? 0 : q.firstPeriodRent * periods,
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
  const number = (c.commitments ?? []).filter((s) => s.appendix).length + 1;
  const clauses = buildRenewalAppendix({
    number, contractNumber: c.contractNumber, contractSignedAt: (rsv?.signature?.signedAt ?? c.terms.signedAt ?? c.startDate).toISOString(),
    ...parties, unitTypeName: ut?.name ?? '—', unitNumber: unit?.unitNumber ?? null,
    rentalPeriod: x.period, periods: x.periods, from: x.from.toISOString(), newEndDate: x.newEnd.toISOString(),
    gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, payNow: x.payNow, depositAmount: c.deposit.amount,
    gracePeriodDays: c.terms.gracePeriodDays, policyVersion: x.policy.version,
    policy: { earlyTermination: x.policy.earlyTermination, discounts: x.policy.discounts }, termsVersion: TERMS_VERSION,
  });
  return { number, title: appendixTitle(number), clauses, parties };
}

/** Xem trước giá gia hạn (khách chọn số kỳ → thấy giá mới, ưu đãi, hạn mới) kèm PHỤ LỤC sẽ xác nhận — không ghi gì. */
export async function extensionQuote(user: UserHydrated, id: string, periods: number) {
  const c = await loadContract(id);
  await assertCanAccess(user, c, 'contract.extend');
  const x = await quoteExtension(c, periods);
  const appendix = await renewalAppendixFor(c, x);
  return {
    rentalPeriod: x.period, periods, from: x.from, newEndDate: x.newEnd, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, currentRate: x.currentRate, payNow: x.payNow, policyVersion: x.policy.version,
    appendix: { number: appendix.number, title: appendix.title, clauses: appendix.clauses },
  };
}

export async function extendContract(user: UserHydrated, id: string, periods: number, method: PaymentMethod | undefined, acceptance: { accepted: boolean; ip: string | null; userAgent: string | null }) {
  assertContractProfile(user); // phụ lục ghi thông tin Bên B theo hồ sơ
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertCanAccess(user, c, 'contract.extend');
    if (c.status !== 'ACTIVE') throw Unprocessable('Chỉ gia hạn được hợp đồng đang hiệu lực');
    // Gia hạn là sửa đổi hợp đồng → chỉ có hiệu lực khi Bên B xác nhận phụ lục (không có "gia hạn ngầm").
    if (!acceptance.accepted) throw Unprocessable('Bạn cần đọc và xác nhận Phụ lục gia hạn trước khi gia hạn', 'APPENDIX_NOT_ACCEPTED');
    const x = await quoteExtension(c, periods, session);
    if (x.payNow > 0 && !method) throw Unprocessable('Chọn hình thức thanh toán tiền thuê của kỳ gia hạn', 'PAY_METHOD_REQUIRED');
    await ensureInitialCommitment(c, session);
    const appendix = await renewalAppendixFor(c, x, session);
    const now = new Date();

    const pay = x.payNow > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'RENEWAL', amount: x.payNow, status: 'SUCCEEDED', method: method!, period: { start: x.from, end: x.newEnd } }, session)
      : null;
    c.renewals.push({ previousEndDate: x.from, newEndDate: x.newEnd, periods, paymentId: pay?._id ?? null, at: new Date() });
    c.commitments = [...(c.commitments ?? []), {
      kind: 'RENEWAL', startDate: x.from, endDate: x.newEnd, periods, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, policyId: x.policy._id, at: now,
      // Nguyên văn phụ lục + dấu vết xác nhận điện tử của Bên B (ai, lúc nào, từ đâu) — chứng cứ giao kết.
      appendix: { number: appendix.number, title: appendix.title, acceptedAt: now, signerName: user.fullName, signedBy: user._id, termsVersion: TERMS_VERSION, ip: acceptance.ip, userAgent: acceptance.userAgent, clauses: appendix.clauses,
        lessorSignatory: { name: appendix.parties.lessorRepresentative, authorization: appendix.parties.lessorAuthorization } },
    }] as ContractDoc['commitments'];
    c.endDate = x.newEnd;
    await c.save({ session });
    await audit({ action: 'contract.extend', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { periods, from: x.from, endDate: x.newEnd, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate, paidNow: x.payNow, appendix: appendix.number } } }, session);
    return { contract: c, amount: x.payNow, rate: x.rate, discountAmount: x.discountAmount, newEndDate: x.newEnd, appendixNumber: appendix.number };
  });
}

/** PDF một phụ lục gia hạn đã xác nhận — chủ hợp đồng hoặc nhân viên / quản lý đúng chi nhánh. In đúng nguyên văn đã lưu. */
export async function appendixPdfFor(user: UserHydrated, id: string, number: number) {
  const c = await loadContract(id);
  await assertCanAccess(user, c, 'contract.appendix_pdf');
  const a = (c.commitments ?? []).map((s) => s.appendix).find((x) => x?.number === number);
  if (!a) throw NotFound('phụ lục');
  const parties = await contractParties(c.facilityId, c.customerId);
  const rep = a.lessorSignatory ?? { name: parties.lessorRepresentative, authorization: parties.lessorAuthorization }; // như lúc xác nhận
  const pdf = await buildContractPdf({
    code: c.contractNumber, contractNumber: c.contractNumber, facilityName: parties.facilityName, customerName: parties.customerName,
    lessorRepresentative: rep.name, lessorAuthorization: rep.authorization, title: a.title, subtitle: `Kèm theo Hợp đồng thuê kho số ${c.contractNumber}`,
    clauses: a.clauses.map((x) => ({ title: x.title, paragraphs: [...x.paragraphs], bullets: [...x.bullets] })),
    signature: { signedAt: a.acceptedAt, signerName: a.signerName, method: 'TYPED', image: null, onBehalf: false },
    signedHow: 'Xác nhận điện tử trên tài khoản', generatedAt: new Date(),
  });
  return { pdf, filename: `phu-luc-${String(number).padStart(2, '0')}-${c.contractNumber}.pdf` };
}

// ---------------------------------------------------------------- pay outstanding (CUSTOMER online, STAFF/FM at desk)
export async function payBalance(user: UserHydrated, id: string, method: PaymentMethod) {
  if (user.role === 'CUSTOMER' && method === 'CASH') throw Unprocessable('Thanh toán tiền mặt chỉ thực hiện tại quầy');
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertCanAccess(user, c, 'contract.pay_balance');
    if (c.balance.outstanding <= 0) throw Unprocessable('Hợp đồng không có công nợ');
    const amount = c.balance.outstanding;
    const now = new Date();

    const open = await PaymentModel.find({ contractId: c._id, direction: 'CHARGE', status: { $in: ['PENDING', 'FAILED'] } }).session(session);
    for (const p of open) {
      if (p.status === 'PENDING') {
        p.method = method;
        p.recordedBy = method === 'CASH' ? user._id : null;
        p.transitionTo('SUCCEEDED', { actor: 'SYSTEM', by: user._id });
        await p.save({ session });
      } else {
        // FAILED is terminal: settle it with a new charge for the same item
        await createPayment({
          facilityId: p.facilityId, customerId: p.customerId, contractId: c._id, type: p.type, amount: p.amount, status: 'SUCCEEDED', method,
          period: p.period ?? null, recordedBy: method === 'CASH' ? user._id : null, idempotencyKey: `retry-${p._id}`,
        }, session);
      }
    }

    c.balance = { outstanding: 0, lastPaymentAt: now };
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
    await audit({ action: 'payment.balance', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { amount, method } } }, session);
    return { contract: c, amount };
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
    // Cùng đường với job tự khoá: thu phí cố định khi khoá theo chính sách khách đã ký, gắn khoá chặn, thông báo khách.
    const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
    const notice = await applyLockout(c, policy, { role: user.role, by: user._id, reason: 'Khóa do quá hạn' }, session);
    await c.save({ session });
    return { c, notice };
  });
  await deliverNotices([notice]);
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
  await deliverNotices([notice]);
  return c;
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
    const newOutstanding = Math.max(0, target - paidNet - writtenOff);
    const debtCut = Math.max(0, c.balance.outstanding - newOutstanding);
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
    // 1) Giảm nợ còn lại: huỷ các khoản thu đang chờ, ghi miễn giảm, còn nợ thì lập lại một khoản phải thu.
    if (debtCut > 0) {
      await PaymentModel.updateMany({ contractId: c._id, direction: 'CHARGE', status: 'PENDING' }, { $set: { status: 'CANCELLED' }, $push: { statusHistory: { from: 'PENDING', to: 'CANCELLED', at: now, by: user._id, reason } } }, { session });
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'WAIVER', amount: debtCut, status: 'SUCCEEDED', method: 'INTERNAL', waiver: { approvedBy: user._id, reason } }, session);
      c.balance.outstanding -= debtCut;
      if (c.balance.outstanding > 0) {
        await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SETTLEMENT_DEBT', amount: c.balance.outstanding, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `settlement-debt-${c._id}-adj-${n}` }, session);
      }
    }
    // 2) Khách đã trả nhiều hơn quyết toán mới → hoàn phần chênh, chuyển khoản chờ người KHÁC người điều chỉnh xác nhận đã chuyển.
    let refund: Awaited<ReturnType<typeof createPayment>> | null = null;
    if (refundAmount > 0) {
      const refundOf = insp.depositSettlement?.damagePaymentId ?? c.deposit.paymentId ?? null;
      if (!refundOf) throw Unprocessable('Không tìm thấy khoản phí hư hại gốc để hoàn — liên hệ quản trị viên', 'NO_ORIGINAL_PAYMENT');
      refund = await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: refundAmount, status: 'SUCCEEDED', method: 'BANK_TRANSFER', refundOf, idempotencyKey: `damage-adj-${insp._id}-${n}` }, session);
      // Tiền giữ chân được hoàn thêm → cập nhật trạng thái cho khớp màn hình / báo cáo.
      c.deposit.refundedAmount = Math.min(c.deposit.amount, (c.deposit.refundedAmount ?? 0) + refundAmount);
      c.deposit.status = c.deposit.refundedAmount >= c.deposit.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }
    await c.save({ session });
    insp.adjustments = [...prev, { amount, reason: input.reason.trim(), by: user._id, at: now, refundPaymentId: refund?._id ?? null, debtCut, refund: refundAmount }];
    await insp.save({ session });
    await audit({ action: 'inspection.adjust', entityType: 'InspectionLog', entityId: insp._id, facilityId: c.facilityId, reason: input.reason, changes: { after: { amount, debtCut, refund: refundAmount } } }, session);
    return { contract: c, inspection: insp, debtCut, refund: refundAmount };
  });
}

type SettlementSnapshot = {
  depositHeld: number; deductions: number; shortfall?: number | null; prepaidRentRefund?: number | null; prepaidRentOffset?: number | null;
  earlyTermination?: unknown; priorOutstanding?: number | null; refundCap?: number | null; clawbackDue?: number | null;
};
/**
 * Đầu vào quyết toán của một biên bản. Biên bản mới lưu sẵn; biên bản cũ thì dựng lại được khi KHÔNG có giới hạn hoàn trả sớm
 * (tính ngược công nợ trước khi kiểm tra); có trả sớm mà thiếu dữ liệu → null (không tự tính lại được).
 */
function settlementInputsOf(insp: { totalDamageFee: number; depositSettlement?: SettlementSnapshot | null }): SettlementInputs | null {
  const ds = insp.depositSettlement;
  if (!ds) return null;
  const prepaidUnused = (ds.prepaidRentRefund ?? 0) + (ds.prepaidRentOffset ?? 0);
  if (ds.priorOutstanding !== null && ds.priorOutstanding !== undefined) {
    return { deposit: ds.depositHeld, damage: insp.totalDamageFee, priorOutstanding: ds.priorOutstanding, refundCap: ds.refundCap ?? null, clawbackDue: ds.clawbackDue ?? 0, prepaidUnused };
  }
  if (ds.earlyTermination) return null;
  const owedBeyondDeposit = (ds.shortfall ?? 0) + (ds.prepaidRentOffset ?? 0);
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
 * Trần phí đổi ô. Đổi ô CÙNG LOẠI không làm thay đổi giá thuê, nên khoản này chỉ là phí thao tác
 * (di dời, cấp lại chìa/mã) — mặc định 0. Quản lý chi nhánh mới được thu, và mọi lần thu đều vào
 * nhật ký kiểm toán kèm lý do.
 */
export const SWAP_FEE_MAX = 500_000;

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
export async function swapUnit(user: UserHydrated, id: string, input: { toUnitId: string; reason: string; keyTag?: string; fee?: number }) {
  const fee = Math.max(0, Math.trunc(input.fee ?? 0));
  if (fee > 0 && user.role !== 'FACILITY_MANAGER') throw Forbidden('Chỉ Quản lý chi nhánh được thu phí đổi ô', 'SWAP_FEE');
  if (fee > SWAP_FEE_MAX) throw Unprocessable(`Phí đổi ô tối đa ${SWAP_FEE_MAX.toLocaleString('vi-VN')} ₫`);

  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.swap_unit');
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

    // (2) nhả ô cũ về chờ kiểm tra — hỏng ở đây thì cả transaction rollback, ô mới tự nhả
    const fromUnit = await StorageUnitModel.findOneAndUpdate(
      { _id: fromUnitId, status: 'OCCUPIED', currentContractId: c._id },
      { $set: { status: 'PENDING_INSPECTION', currentContractId: null, overlockActive: false, statusChangedAt: now, statusReason: `Khách đã chuyển sang ô ${toUnit.unitNumber}` } },
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
    // Hình thức khoá đi theo Ô: ô mới khác khoá thì hợp đồng đổi theo và cấp phương tiện mới.
    const access = moveAccessToUnit(c, toUnit, user._id, input.keyTag);
    // Yêu cầu đổi ô khách gửi trước đó (nếu còn treo) không còn ý nghĩa — huỷ và nhả ô đang giữ cho nó.
    await releaseOpenSwapRequests(c._id, session, 'Chi nhánh đã đổi ô trực tiếp');
    // Ô mới khác khoá, hoặc cùng loại nhưng đã giao thẻ / chìa của ô mới → yêu cầu cấp lại của ô cũ không còn ý nghĩa.
    if (access.changed || (input.keyTag && c.access.method !== 'PIN')) await cancelOpenAccessRequests(c._id, 'Đã đổi ô và giao phương tiện mở kho mới — huỷ yêu cầu cấp lại, hoàn phí', session);
    if (fee > 0) c.balance.outstanding += fee;
    await c.save({ session }); // chỉ mục unique {unitId} trên hợp đồng đang mở là lớp chặn cuối cùng

    // (5) đặt chỗ gốc đi theo hợp đồng để lịch sử của khách không lệch ô
    await ReservationModel.updateOne({ _id: c.reservationId, status: 'CHECKED_IN' }, { $set: { unitId: toUnit._id } }, { session });

    await UnitTypeModel.updateOne({ _id: c.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });
    await audit({
      action: 'contract.swap_unit', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: input.reason,
      changes: { before: { unit: fromUnit.unitNumber }, after: { unit: toUnit.unitNumber, fee, rate: c.billing.rate, access: c.access.method, accessChanged: access.changed } },
    }, session);
    return { contract: c, fromUnit, toUnit, fee, pin: access.pin }; // mật khẩu mới (nếu có) trả về đúng một lần
  });
}

/** Danh sách ô còn trống cùng loại với hợp đồng — dùng cho ô chọn ở màn hình đổi ô. */
/** Danh sách ô trống cùng loại — dùng cho cả nhân viên đổi ngay (swapUnit) lẫn khách gửi yêu cầu đổi ô. */
export async function swapCandidates(user: UserHydrated, id: string) {
  const c = await loadContract(id);
  await assertCanAccess(user, c, 'contract.swap_unit');
  const items = await StorageUnitModel
    .find({ facilityId: c.facilityId, unitTypeId: c.unitTypeId, status: 'AVAILABLE', isDeleted: false, _id: { $ne: c.unitId } }, { unitNumber: 1, location: 1, status: 1, accessMethod: 1 })
    .sort({ 'location.floor': 1, unitNumber: 1 }).limit(200).lean();
  return { currentUnitId: c.unitId, currentAccessMethod: c.access.method, rate: c.billing.rate, items };
}

// ---------------------------------------------------------------- move-out request (CUSTOMER owner, STAFF/FM)
export async function requestMoveOut(user: UserHydrated, id: string, date: string) {
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertCanAccess(user, c, 'contract.move_out_request');
    if (user.role === 'CUSTOMER' && c.balance.outstanding > 0) throw Unprocessable('Vui lòng thanh toán công nợ trước khi đăng ký trả kho');
    const scheduledFor = toDateOnly(date);
    if (scheduledFor < todayUTC()) throw Unprocessable('Ngày trả kho không được ở quá khứ');
    // Không cho "đăng ký treo" hàng tháng: hẹn xa nhất MAX_MOVE_OUT_LEAD_DAYS ngày (tiền thuê vẫn tính đến ngày bàn giao thật).
    if (scheduledFor > addDays(todayUTC(), MAX_MOVE_OUT_LEAD_DAYS)) throw Unprocessable(`Chỉ hẹn trả kho trong vòng ${MAX_MOVE_OUT_LEAD_DAYS} ngày tới`, 'MOVE_OUT_TOO_FAR');
    c.transitionTo('MOVE_OUT_PENDING', { actor: user.role, by: user._id });
    c.moveOut = { requestedAt: new Date(), scheduledFor, returnedOn: null, completedAt: null, inspectionId: null };
    await c.save({ session });
    await audit({ action: 'contract.move_out_request', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { scheduledFor } } }, session);
    return c;
  });
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
export async function receiveUnit(user: UserHydrated, id: string) {
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'unit.receive');
    if (c.status !== 'MOVE_OUT_PENDING') throw Unprocessable('Khách chưa đăng ký trả kho');
    const unit = await StorageUnitModel.findOneAndUpdate(
      { _id: c.unitId, status: 'OCCUPIED', currentContractId: c._id },
      { $set: { status: 'PENDING_INSPECTION', overlockActive: false, statusChangedAt: new Date(), statusReason: 'Khách bàn giao chìa khóa' } },
      { new: true, session },
    );
    if (!unit) throw Conflict('Kho không ở trạng thái đang thuê', 'UNIT_STATE_MISMATCH');
    c.access.revokedAt = new Date();
    // Ngày khách THỰC TẾ bàn giao — mốc để quyết toán (trả sớm hay không, đã dùng bao lâu), không dùng ngày khách tự hẹn.
    c.moveOut = { requestedAt: c.moveOut?.requestedAt ?? new Date(), scheduledFor: c.moveOut?.scheduledFor ?? null, returnedOn: todayUTC(), completedAt: null, inspectionId: null };
    await c.save({ session });
    // Khách đã trả kho thì yêu cầu đổi ô còn treo (kể cả đã duyệt) không bao giờ thực hiện được nữa — huỷ để nhả ô đang giữ.
    await releaseOpenSwapRequests(c._id, session, 'Khách đã trả kho');
    await cancelOpenServiceOrders(c._id, session, 'Khách đã trả kho — đơn chưa thực hiện được hoàn tiền');
    await cancelOpenAccessRequests(c._id, 'Khách đã trả kho — huỷ yêu cầu cấp lại, hoàn phí', session);
    await audit({ action: 'unit.receive', entityType: 'StorageUnit', entityId: unit._id, facilityId: c.facilityId }, session);
    return { contract: c, unit };
  });
}

// ---------------------------------------------------------------- move-out inspection + deposit settlement (STAFF, FM)
export async function submitMoveOutInspection(user: UserHydrated, id: string, input: { checklist: InspectionLog['checklist']; damages: InspectionLog['damages']; notes?: string }) {
  return withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'inspection.move_out');
    const unit = await StorageUnitModel.findById(c.unitId).session(session);
    if (!unit || unit.status !== 'PENDING_INSPECTION') throw Unprocessable('Kho chưa ở trạng thái chờ kiểm tra — hãy xác nhận nhận lại kho trước');

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
      { startDate: iso(c.startDate), endDate: iso(c.endDate), commitments: (c.commitments ?? []).map((x) => ({ startDate: iso(x.startDate), endDate: iso(x.endDate), gross: x.gross, discountAmount: x.discountAmount, policyId: x.policyId ? String(x.policyId) : null })) },
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
      const claw = discountClawback({ rentalPeriod: 'MONTH', rate: seg.gross, surchargeAmount: 0, discountAmount: seg.discountAmount, discounts: policy.discounts, startDate: seg.startDate, moveOutDate: iso(returnedOn) });
      if (claw) { clawbackDue = claw.amount; usedPeriods = claw.usedPeriods; }
    }
    // Tiền thuê trả trước khi gia hạn cho các kỳ CHƯA bắt đầu tại ngày bàn giao: trả lại khách (trước đây mất trắng). Phần này
    // cấn trừ vào hư hại / công nợ vượt tiền giữ chân trước, còn lại mới hoàn tiền.
    const paidRenewals = c.renewals.filter((x) => x.paymentId);
    const renewalPays = paidRenewals.length
      ? await PaymentModel.find({ _id: { $in: paidRenewals.map((x) => x.paymentId) }, status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }).session(session)
      : [];
    const unused = unusedPrepaidRent(c.billing.rentalPeriod, paidRenewals.flatMap((x) => {
      const p = renewalPays.find((y) => String(y._id) === String(x.paymentId));
      return p ? [{ key: String(p._id), previousEndDate: x.previousEndDate.toISOString(), periods: x.periods, amount: p.amount }] : [];
    }), returnedOn.toISOString());

    // Quyết toán theo MỘT công thức dùng chung (shared/move-out-rules) — khi khách khiếu nại đúng, điều chỉnh tính lại y hệt
    // với mức hư hại mới. Chi phí hư hại + công nợ VƯỢT tiền giữ chân: không xoá, ghi thành khoản nợ còn lại sau quyết toán.
    const settled = settleDeposit({ deposit: c.deposit.amount, damage: damageFee, priorOutstanding, refundCap, clawbackDue, prepaidUnused: unused.total });
    const { refund: refundAmount, shortfall, clawback, prepaidOffset: prepaidRentOffset, prepaidRefund: prepaidRentRefund, deductions } = settled;
    if (earlyTermination && usedPeriods !== null) earlyTermination = { ...earlyTermination, discountClawback: clawback, usedPeriods };
    const outcome: InspectionLog['outcome'] = input.damages.some((d) => d.severity === 'SEVERE') ? 'MAINTENANCE_REQUIRED' : input.damages.length ? 'PASS_WITH_DAMAGE' : 'PASS';
    const now = new Date();

    if (refundAmount > 0 && !c.deposit.paymentId) throw Conflict('Hợp đồng thiếu tham chiếu khoản tiền giữ chân');
    const damagePay = damageFee > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'DAMAGE_FEE', amount: damageFee, status: 'SUCCEEDED', method: 'INTERNAL' }, session)
      : null;
    // Khoản thu hồi ưu đãi ghi sổ riêng (cấn trừ nội bộ vào tiền giữ chân) để khách và kế toán thấy rõ vì sao bị trừ.
    if (clawback > 0) await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'DISCOUNT_CLAWBACK', amount: clawback, status: 'SUCCEEDED', method: 'INTERNAL' }, session);
    const refundPay = refundAmount > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: refundAmount, status: 'SUCCEEDED', method: 'BANK_TRANSFER', refundOf: c.deposit.paymentId ?? null }, session)
      : null;

    let offsetLeft = prepaidRentOffset;
    for (const it of unused.items) {
      const p = renewalPays.find((y) => String(y._id) === it.key)!;
      const offset = Math.min(it.amount, offsetLeft);
      offsetLeft -= offset;
      // Phần cấn trừ vào hư hại / công nợ ghi sổ nội bộ (không có tiền ra); phần còn lại là tiền hoàn thật.
      if (offset > 0) await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: offset, status: 'SUCCEEDED', method: 'INTERNAL', refundOf: p._id }, session);
      if (it.amount - offset > 0) await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: it.amount - offset, status: 'SUCCEEDED', method: 'BANK_TRANSFER', refundOf: p._id }, session);
      p.refundedAmount = (p.refundedAmount ?? 0) + it.amount;
      p.transitionTo(p.refundedAmount >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED', { actor: 'SYSTEM', reason: `Trả kho — hoàn ${it.unusedPeriods} kỳ gia hạn chưa dùng` });
      await p.save({ session });
    }

    const inspectionId = new Types.ObjectId();
    const [inspection] = await InspectionModel.create([{
      _id: inspectionId, facilityId: c.facilityId, unitId: unit._id, contractId: c._id, type: 'MOVE_OUT', status: 'APPROVED',
      inspectorId: user._id, performedAt: now, checklist: input.checklist, damages: input.damages, outcome, notes: input.notes,
      depositSettlement: { depositHeld: c.deposit.amount, deductions, refundAmount, shortfall, prepaidRentRefund, prepaidRentOffset, priorOutstanding, refundCap, clawbackDue, refundPaymentId: refundPay?._id ?? null, damagePaymentId: damagePay?._id ?? null, approvedBy: user._id, approvedAt: now, earlyTermination },
    }], { session });

    // Biên bản đã lập: yêu cầu cấp lại thẻ / chìa còn treo (nếu có) không còn ý nghĩa — huỷ, hoàn phí.
    await cancelOpenAccessRequests(c._id, 'Đã trả kho — huỷ yêu cầu cấp lại, hoàn phí', session);

    // Outstanding charges are settled from the deposit
    await PaymentModel.updateMany({ contractId: c._id, direction: 'CHARGE', status: 'PENDING' }, { $set: { status: 'CANCELLED' }, $push: { statusHistory: { from: 'PENDING', to: 'CANCELLED', at: now, reason: 'Cấn trừ vào tiền cọc' } } }, { session });

    // Phần còn thiếu: một khoản phải thu riêng, chờ khách trả (online hoặc tại quầy) hay quản lý xoá nợ có lý do.
    if (shortfall > 0) {
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SETTLEMENT_DEBT', amount: shortfall, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `settlement-debt-${c._id}` }, session);
    }

    c.transitionTo('CLOSED', { actor: user.role, by: user._id });
    c.closedAt = now;
    c.moveOut = { requestedAt: c.moveOut?.requestedAt ?? now, scheduledFor: c.moveOut?.scheduledFor ?? null, returnedOn, completedAt: now, inspectionId };
    c.deposit.refundedAmount = refundAmount;
    c.deposit.status = refundAmount === c.deposit.amount ? 'REFUNDED' : refundAmount === 0 ? 'FORFEITED' : 'PARTIALLY_REFUNDED';
    c.balance.outstanding = shortfall;
    c.delinquency = null;
    await c.save({ session });

    const next: UnitStatus = outcome === 'MAINTENANCE_REQUIRED' ? 'MAINTENANCE' : 'AVAILABLE';
    unit.transitionTo(next, { actor: user.role, by: user._id, reason: next === 'MAINTENANCE' ? 'Hư hại sau trả kho' : undefined });
    unit.currentContractId = null;
    unit.overlockActive = false;
    await unit.save({ session });

    const r = await ReservationModel.findById(c.reservationId).session(session);
    if (r && r.status === 'CHECKED_IN') { r.transitionTo('COMPLETED', { actor: 'SYSTEM' }); await r.save({ session }); }

    await audit({ action: 'inspection.move_out', entityType: 'InspectionLog', entityId: inspectionId, facilityId: c.facilityId, changes: { after: { damageFee, refundAmount, outcome, discountClawback: clawback, shortfall, prepaidRentRefund, prepaidRentOffset } } }, session);
    return { inspection, contract: c };
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
  input: { items: { description: string; quantity: number }[]; disposalMethod: AbandonedItemsDisposal; notes?: string; proceeds: number; costs: number },
) {
  const { result, notice } = await withTxn(async (session) => {
    const c = await loadContract(id, session);
    await assertFacility(user, c.facilityId, 'contract.abandonment');
    if (c.status !== 'LOCKED_OUT') throw Unprocessable('Chỉ xử lý được hợp đồng đang bị khóa truy cập');
    const finalNoticeAt = c.delinquency?.finalNoticeAt;
    if (!finalNoticeAt) throw Unprocessable('Chưa gửi thông báo cuối cho khách — gửi thông báo cuối và chờ hết hạn chót mới được xử lý đồ bỏ lại', 'FINAL_NOTICE_REQUIRED');
    const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
    // Hạn chót đúng như đã ghi trong thông báo khách nhận được; thiếu bản ghi thông báo (dữ liệu cũ) thì tính lại từ mốc gửi.
    const sent = [...(c.notices ?? [])].reverse().find((n) => n.kind === 'FINAL_NOTICE' && n.at >= finalNoticeAt);
    const deadline = sent?.deadline ?? addDays(finalNoticeAt, abandonDaysOf(policy));
    if (todayUTC() < deadline) throw Unprocessable(`Chưa tới hạn chót trong thông báo cuối — chỉ xử lý được từ ngày ${fmtDate(deadline.toISOString())}`, 'ABANDON_TOO_EARLY');

    const unit = await StorageUnitModel.findById(c.unitId).session(session);
    if (!unit) throw NotFound('kho');

    // Quyết toán: tiền giữ chân → tiền thanh lý → trừ công nợ + chi phí xử lý.
    const debt = c.balance.outstanding;
    const owed = debt + input.costs;
    const depositApplied = Math.min(c.deposit.amount, owed);
    const depositRefund = c.deposit.amount - depositApplied;
    const proceedsApplied = Math.min(input.proceeds, owed - depositApplied);
    const proceedsPayout = input.proceeds - proceedsApplied;
    const shortfall = owed - depositApplied - proceedsApplied;
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
    const refundPay = depositRefund > 0
      ? await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: depositRefund, status: 'SUCCEEDED', method: 'BANK_TRANSFER', refundOf: c.deposit.paymentId ?? null }, session)
      : null;
    if (proceedsPayout > 0) {
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'LIQUIDATION_PAYOUT', amount: proceedsPayout, status: 'SUCCEEDED', method: 'BANK_TRANSFER' }, session);
    }
    if (shortfall > 0) {
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SETTLEMENT_DEBT', amount: shortfall, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `settlement-debt-${c._id}` }, session);
    }

    const inspectionId = new Types.ObjectId();
    const [inspection] = await InspectionModel.create([{
      _id: inspectionId, facilityId: c.facilityId, unitId: unit._id, contractId: c._id, type: 'ABANDONMENT', status: 'APPROVED',
      inspectorId: user._id, performedAt: now, outcome: 'PASS', notes: input.notes,
      abandonment: { items: input.items, disposalMethod: input.disposalMethod, proceeds: input.proceeds, costs: input.costs, finalNoticeAt },
      depositSettlement: {
        depositHeld: c.deposit.amount, deductions: depositApplied, refundAmount: depositRefund, shortfall, proceedsApplied, proceedsPayout,
        refundPaymentId: refundPay?._id ?? null, damagePaymentId: feePay?._id ?? null, approvedBy: user._id, approvedAt: now, earlyTermination: null,
      },
    }], { session });

    await releaseOpenSwapRequests(c._id, session, 'Hợp đồng đóng do hàng bỏ lại');
    await cancelOpenServiceOrders(c._id, session, 'Hợp đồng đóng do hàng bỏ lại — đơn chưa thực hiện được hoàn tiền');
    await cancelOpenAccessRequests(c._id, 'Hợp đồng đóng do hàng bỏ lại — huỷ yêu cầu cấp lại, hoàn phí', session);
    const daysSinceNotice = daysBetween(finalNoticeAt, todayUTC());
    c.transitionTo('ABANDONED', { actor: user.role, by: user._id, reason: `Đã thông báo cuối ${daysSinceNotice} ngày, khách không thanh toán / liên hệ` });
    c.closedAt = now;
    c.deposit.refundedAmount = depositRefund;
    c.deposit.status = depositRefund === c.deposit.amount ? 'REFUNDED' : depositRefund === 0 ? 'FORFEITED' : 'PARTIALLY_REFUNDED';
    c.balance.outstanding = shortfall;
    c.delinquency = null;
    const notice = addNotice(c, 'ABANDONED', {
      amountDue: debt, by: user._id,
      extra: { disposalMethod: input.disposalMethod, itemCount: input.items.length, depositApplied, proceeds: input.proceeds, costs: input.costs, refund: depositRefund + proceedsPayout, shortfall },
    });
    await c.save({ session });

    unit.transitionTo('PENDING_INSPECTION', { actor: user.role, by: user._id, reason: 'Xử lý hàng bỏ lại' });
    unit.transitionTo('AVAILABLE', { actor: user.role, by: user._id });
    unit.currentContractId = null;
    unit.overlockActive = false;
    await unit.save({ session });

    const r = await ReservationModel.findById(c.reservationId).session(session);
    if (r && r.status === 'CHECKED_IN') { r.transitionTo('COMPLETED', { actor: 'SYSTEM' }); await r.save({ session }); }

    await audit({
      action: 'contract.abandonment', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId,
      changes: { after: { daysSinceNotice, itemCount: input.items.length, disposalMethod: input.disposalMethod, debt, costs: input.costs, proceeds: input.proceeds, depositApplied, depositRefund, proceedsPayout, shortfall } },
    }, session);
    return { result: { inspection, contract: c }, notice };
  });
  await deliverNotices([notice]);
  return result;
}
