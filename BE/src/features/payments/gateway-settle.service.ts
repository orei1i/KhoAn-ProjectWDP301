import type { ClientSession, Types } from 'mongoose';
import { GATEWAY_ORDER_MACHINE, GATEWAY_TXN_REF_RE, InvalidTransitionError, vnd, type GatewayOrderKind, type GatewayOrderStatus, type GatewayOrderView, type GatewayRefundState } from '@ssm/shared';
import { GatewayOrderModel, PaymentModel, RentalContractModel, ReservationModel, UserModel, type GatewayOrderHydrated, type UserHydrated } from '../../shared/db/models';
import { AppError, Conflict, NotFound } from '../../shared/core/errors';
import { env } from '../../shared/config/env';
import { runAsSystem } from '../../shared/core/request-context';
import { withTxn } from '../../shared/db/txn';
import { audit } from '../audit/audit.service';
import { mailCustomer } from '../contracts/contract-notice.service';
import { extendContract, payBalance } from '../contracts/contract.service';
import { createAccessRequest } from '../access/access.service';
import { payDeposit } from '../reservations/reservation.service';
import { orderService } from '../services/services.service';
import { createPayment } from './payment.service';
import { gatewayProvider, purgedPayload, SETTLE_GRACE_MS, urgentGatewayTask, type PayRun } from './gateway-order.service';
import { queryDr, verifyQuery } from './vnpay.client';

/**
 * Đợt VNPAY — ghi nhận kết quả từ cổng. Chỉ 2 nguồn được ghi nhận thành công: IPN có chữ ký hợp lệ, QueryDr có chữ ký phản hồi hợp lệ, cả hai đều khớp
 * số tiền và TmnCode. Return URL không đi qua đây.
 *
 * Chống hiệu ứng hai lần: CAS trên `status` của order TRONG CÙNG transaction với hiệu ứng. Hai đường đồng thời cùng ghi một order: một bên WriteConflict, driver
 * chạy lại callback, lần chạy lại không khớp CAS nên trả ALREADY. Hiệu ứng lỗi thì CAS cũng rollback. Chỉ route và job import file này (domain import
 * gateway-order.service).
 */
export type SettleOutcome = 'APPLIED' | 'UNAPPLIED' | 'ALREADY';
export interface GatewayEvidence {
  transactionNo?: string | null; bankCode?: string | null; cardType?: string | null; payDate?: string | null; responseCode?: string | null; transactionStatus?: string | null;
}
type Source = 'IPN' | 'QUERYDR';

/** Trạng thái còn nhận được thành công: suy từ máy trạng thái, IPN có thể gọi lại tới 50 phút và tiền đã vào thì phải ghi nhận. */
const CAN_BE_PAID = (Object.keys(GATEWAY_ORDER_MACHINE) as GatewayOrderStatus[]).filter((s) => 'PAID' in GATEWAY_ORDER_MACHINE[s]);
const QUERY_THROTTLE_MS = 15_000;
const RECHECK_MS = 5 * 60_000;
const REVIEW_RECHECK_MS = 60 * 60_000;
/** QueryDr không kết luận được sau chừng này thì chuyển người đối soát. */
const QUERY_GIVE_UP_MS = 24 * 3_600_000;
const MAX_APPLY_FAILURES = 5;

const isBusinessError = (e: unknown): e is AppError | InvalidTransitionError => (e instanceof AppError && e.status < 500) || e instanceof InvalidTransitionError;
const logErr = (where: string) => (e: unknown) => console.error(`[${where}]`, e instanceof Error ? e.message : e);

// ---------------------------------------------------------------- áp hiệu ứng: chạy lại CHÍNH hàm service của luồng đó
const requireOwner = async (o: GatewayOrderHydrated, session: ClientSession): Promise<UserHydrated> => {
  const user = await UserModel.findById(o.customerId).session(session);
  if (!user) throw NotFound('tài khoản khách của giao dịch');
  return user;
};
const payloadOf = (o: GatewayOrderHydrated) => {
  if (!o.payload) throw purgedPayload();
  return o.payload;
};
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

const APPLY: Record<GatewayOrderKind, (o: GatewayOrderHydrated, run: PayRun) => Promise<unknown>> = {
  DEPOSIT: async (o, run) => {
    const p = payloadOf(o);
    return payDeposit(await requireOwner(o, run.session), String(o.reservationId), 'VNPAY', { codAck: p.codAck === true }, { run });
  },
  BALANCE: async (o, run) => {
    const p = payloadOf(o);
    // Luôn đối chiếu theo số tiền của order: số dư đã đổi trong lúc khách ở VNPAY là BALANCE_CHANGED.
    return payBalance(await requireOwner(o, run.session), String(o.contractId), 'VNPAY', undefined, { expectedAmount: o.amount, idempotencyKey: str(p.idempotencyKey) }, { run });
  },
  EXTEND: async (o, run) => {
    const p = payloadOf(o);
    const a = (p.acceptance ?? {}) as { ip?: string | null; userAgent?: string | null };
    return extendContract(await requireOwner(o, run.session), String(o.contractId), Number(p.periods), 'VNPAY', { accepted: true, ip: a.ip ?? null, userAgent: a.userAgent ?? null }, p.expected as Parameters<typeof extendContract>[5], str(p.idempotencyKey), { run });
  },
  SERVICE: async (o, run) => {
    const p = payloadOf(o);
    return orderService(await requireOwner(o, run.session), {
      contractId: String(o.contractId), serviceId: String(p.serviceId), quantity: Number(p.quantity), preferredDate: str(p.preferredDate), note: str(p.note), method: 'VNPAY',
      expectedTotal: o.amount, idempotencyKey: str(p.idempotencyKey),
    }, { run });
  },
  ACCESS_FEE: async (o, run) => {
    const p = payloadOf(o);
    return createAccessRequest(await requireOwner(o, run.session), { contractId: String(o.contractId), reason: str(p.reason), method: 'VNPAY', expectedFee: o.amount, idempotencyKey: str(p.idempotencyKey) }, { run });
  },
};

/**
 * Chốt cuối khi khách mở hai tab: trong chuỗi order thay thế nhau (nối bằng supersededBy, kể cả order đã thất bại / hết hạn) đã có order khác trả rồi thì order này
 * trùng → hoàn. Chủ yếu cho SERVICE vì các kind khác đã có kiểm tra nghiệp vụ. Target đã được ghi chạm trước khi gọi nên hai order cùng chuỗi trả đồng thời
 * sẽ xung đột ghi, bên chạy lại đọc được kết quả của bên kia.
 */
async function assertNotDuplicateOfChain(o: GatewayOrderHydrated, session: ClientSession) {
  const all = await GatewayOrderModel.find({ customerId: o.customerId, targetKey: o.targetKey }, { supersededBy: 1, status: 1 }).session(session).lean();
  const inChain = new Set([String(o._id)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const x of all) {
      const self = String(x._id), next = x.supersededBy ? String(x.supersededBy) : null;
      if (!next) continue;
      if (inChain.has(self) !== inChain.has(next)) { inChain.add(self); inChain.add(next); grew = true; }
    }
  }
  if (all.some((x) => String(x._id) !== String(o._id) && inChain.has(String(x._id)) && x.status === 'PAID')) throw Conflict('Đã có giao dịch khác trả khoản này', 'ALREADY_PAID');
}

const touchTarget = (o: GatewayOrderHydrated, session: ClientSession) => (o.reservationId
  ? ReservationModel.updateOne({ _id: o.reservationId }, { $set: { updatedAt: new Date() } }, { session })
  : RentalContractModel.updateOne({ _id: o.contractId }, { $set: { updatedAt: new Date() } }, { session }));

/** CAS từ một trạng thái còn nhận được thành công sang `to`, ghi bằng chứng + lịch sử. Không khớp (đã có đường khác ghi nhận) → null. */
async function casPaid(txnRef: string, to: 'PAID' | 'PAID_UNAPPLIED', proof: GatewayEvidence, source: Source, session: ClientSession, extra: Record<string, unknown> = {}) {
  const prev = await GatewayOrderModel.findOne({ txnRef, status: { $in: CAN_BE_PAID } }, { status: 1 }).session(session).lean();
  if (!prev) return null;
  const now = new Date();
  return GatewayOrderModel.findOneAndUpdate(
    { txnRef, status: prev.status },
    { $set: { status: to, gateway: { ...proof, source, confirmedAt: now }, ...extra }, $push: { statusHistory: { from: prev.status, to, at: now, reason: source } } },
    { new: true, session },
  );
}

/**
 * Tiền đã vào mà không thực hiện được: order PAID_UNAPPLIED, ghi sổ một khoản GATEWAY_UNAPPLIED (đã hoàn) và một khoản REFUND xếp hàng cùng số tiền, email khách.
 * Không nuốt tiền im lặng, không dùng khoản đó vào việc khác khách không đồng ý.
 */
async function settleUnapplied(txnRef: string, proof: GatewayEvidence, source: Source, err: { code: string; message: string }): Promise<SettleOutcome> {
  const o = await withTxn(async (session) => {
    const now = new Date();
    const order = await casPaid(txnRef, 'PAID_UNAPPLIED', proof, source, session, { unapplied: { code: err.code, message: err.message.slice(0, 1000), at: now } });
    if (!order) return null;
    const refs = { facilityId: order.facilityId, customerId: order.customerId, contractId: order.contractId, reservationId: order.reservationId };
    const row = await createPayment({ ...refs, type: 'GATEWAY_UNAPPLIED', amount: order.amount, status: 'SUCCEEDED', method: 'VNPAY', gateway: gatewayProvider(order, 1), idempotencyKey: `gw-unapplied-${order._id}` }, session);
    await createPayment({ ...refs, type: 'REFUND', amount: order.amount, status: 'SUCCEEDED', method: 'VNPAY', refundOf: row._id, idempotencyKey: `gw-unapplied-refund-${order._id}` }, session); // createPayment xếp hàng hoàn qua cổng
    row.refundedAmount = order.amount;
    row.transitionTo('REFUNDED', { actor: 'SYSTEM', reason: err.code });
    await row.save({ session });
    await GatewayOrderModel.updateOne({ _id: order._id }, { $set: { paymentIds: [row._id] } }, { session });
    await audit({ action: 'payment.gateway_unapplied', entityType: 'GatewayOrder', entityId: order._id, facilityId: order.facilityId, reason: err.code, changes: { after: { txnRef, amount: order.amount, source, kind: order.kind, code: err.code } } }, session);
    return order;
  });
  if (!o) return 'ALREADY';
  void mailCustomer(o.customerId, `KhoAn — Đã nhận ${vnd(o.amount)} nhưng chưa thực hiện được, đang hoàn tiền`, [
    `KhoAn đã nhận ${vnd(o.amount)} qua VNPAY (mã ${txnRef}) nhưng không thực hiện được: ${err.message}.`,
    'Số tiền đang được hoàn về phương thức bạn đã trả, tối đa 7 ngày làm việc theo Điều khoản. Bạn không cần làm gì thêm; nếu vẫn cần dịch vụ, vui lòng thực hiện lại với thông tin mới.',
  ]);
  return 'UNAPPLIED';
}

/** Bằng chứng thành công đã kiểm (chữ ký, số tiền, TmnCode): áp hiệu ứng. Lỗi nghiệp vụ → tự hoàn. Lỗi hạ tầng → ném, VNPAY gọi lại / job thử lại. */
export async function settleSuccess(txnRef: string, proof: GatewayEvidence, source: Source): Promise<SettleOutcome> {
  return runAsSystem(async () => {
    const after: (() => Promise<unknown>)[] = [];
    try {
      const out = await withTxn(async (session): Promise<SettleOutcome> => {
        after.length = 0; // withTxn có thể chạy lại callback
        const o = await casPaid(txnRef, 'PAID', proof, source, session);
        if (!o) return 'ALREADY';
        await touchTarget(o, session);
        await assertNotDuplicateOfChain(o, session);
        const run: PayRun = { order: o, session, after };
        await APPLY[o.kind](o, run);
        await GatewayOrderModel.updateOne({ _id: o._id }, { $set: { paymentIds: run.applied?.paymentIds ?? [], result: run.applied?.result ?? null } }, { session });
        await audit({ action: 'payment.gateway_paid', entityType: 'GatewayOrder', entityId: o._id, facilityId: o.facilityId, changes: { after: { txnRef, amount: o.amount, source, kind: o.kind } } }, session);
        return 'APPLIED';
      });
      for (const f of after) void f().catch(logErr('gateway-after'));
      return out;
    } catch (e) {
      if (isBusinessError(e)) return settleUnapplied(txnRef, proof, source, e);
      await GatewayOrderModel.updateOne({ txnRef }, { $inc: { applyFailures: 1 } });
      throw e;
    }
  });
}

/** Báo thất bại có bằng chứng: PENDING → FAILED. Không đụng đặt chỗ hay hợp đồng (ô vẫn giữ tới holdExpiresAt, khách thử lại được). */
export async function settleFailure(txnRef: string, proof: GatewayEvidence, source: Source) {
  const now = new Date();
  await GatewayOrderModel.updateOne({ txnRef, status: 'PENDING' }, {
    $set: { status: 'FAILED', gateway: { ...proof, source, confirmedAt: null } }, $push: { statusHistory: { from: 'PENDING', to: 'FAILED', at: now, reason: `${source} ${proof.responseCode ?? ''}/${proof.transactionStatus ?? ''}` } },
  });
}

/** Số tiền phía VNPAY khác order: một lần duy nhất ghi mốc, audit, việc khẩn. Không đổi trạng thái, không ghi nhận. */
async function flagAmountMismatch(o: GatewayOrderHydrated, reported: string, source: Source) {
  const now = new Date();
  const first = await GatewayOrderModel.updateOne({ _id: o._id, amountMismatchAt: null }, { $set: { amountMismatchAt: now } });
  if (!first.modifiedCount) return;
  await audit({ action: 'payment.gateway_amount_mismatch', result: 'DENIED', entityType: 'GatewayOrder', entityId: o._id, facilityId: o.facilityId, changes: { after: { txnRef: o.txnRef, expected: o.amount * 100, reported, source } } });
  await urgentGatewayTask(o, `Sai số tiền VNPAY — ${o.txnRef}`, `Giao dịch ${o.txnRef}: KhoAn tạo ${vnd(o.amount)}, ${source} báo vnp_Amount = ${reported.slice(0, 20)}. Không ghi nhận. Kiểm trên merchant VNPAY.`);
}

/** Giao dịch đảo (đã trừ tiền, VNPAY chưa thành công) hoặc nghi gian lận: giữ PENDING, không áp, việc khẩn một lần. */
async function flagForReview(o: GatewayOrderHydrated, status: string, source: Source) {
  const first = await GatewayOrderModel.updateOne({ _id: o._id, reviewFlaggedAt: null }, { $set: { reviewFlaggedAt: new Date() } });
  if (!first.modifiedCount) return;
  await audit({ action: 'payment.gateway_review', entityType: 'GatewayOrder', entityId: o._id, facilityId: o.facilityId, changes: { after: { txnRef: o.txnRef, transactionStatus: status, source } } });
  await urgentGatewayTask(o, `Giao dịch VNPAY cần kiểm tra — ${o.txnRef}`, `Giao dịch ${o.txnRef} (${vnd(o.amount)}): ${source} báo trạng thái ${status} (04 = giao dịch đảo, đã trừ tiền; 07 = nghi gian lận). Chưa ghi nhận. Kiểm trên merchant VNPAY.`);
}

// ---------------------------------------------------------------- IPN
const REVIEW_STATUSES = ['04', '07'];
const rsp = (RspCode: string, Message: string) => ({ RspCode, Message });

/** GET /payments/vnpay/ipn. Luôn trả { RspCode, Message } theo thứ tự tài liệu VNPAY: chữ ký → tìm → số tiền → trạng thái → cập nhật. Không log nguyên query. */
export async function handleIpn(query: Record<string, unknown>): Promise<{ RspCode: string; Message: string }> {
  const out = await ipnStep(query);
  const ref = typeof query.vnp_TxnRef === 'string' && GATEWAY_TXN_REF_RE.test(query.vnp_TxnRef) ? query.vnp_TxnRef : '(mã lạ)';
  console.log(`[vnpay-ipn] ${ref} ${out.RspCode}`);
  return out;
}

function ipnStep(query: Record<string, unknown>): Promise<{ RspCode: string; Message: string }> {
  return runAsSystem(async () => {
    if (env.paymentMode !== 'VNPAY') return rsp('99', 'Gateway disabled');
    try {
      if (!verifyQuery(query) || query.vnp_TmnCode !== env.VNPAY_TMN_CODE) return rsp('97', 'Invalid signature');
      const txnRef = typeof query.vnp_TxnRef === 'string' ? query.vnp_TxnRef : '';
      const order = await GatewayOrderModel.findOne({ txnRef });
      if (!order) return rsp('01', 'Order not found');
      const amount = typeof query.vnp_Amount === 'string' ? query.vnp_Amount : '';
      if (!/^\d+$/.test(amount) || Number(amount) !== order.amount * 100) {
        await flagAmountMismatch(order, amount, 'IPN');
        return rsp('04', 'Invalid amount');
      }
      const code = String(query.vnp_ResponseCode ?? ''), status = String(query.vnp_TransactionStatus ?? '');
      const success = code === '00' && status === '00';
      if (order.status === 'PAID' || order.status === 'PAID_UNAPPLIED' || (!success && order.status !== 'PENDING')) return rsp('02', 'Order already confirmed');
      const proof: GatewayEvidence = {
        transactionNo: query.vnp_TransactionNo as string ?? null, bankCode: query.vnp_BankCode as string ?? null, cardType: query.vnp_CardType as string ?? null,
        payDate: query.vnp_PayDate as string ?? null, responseCode: code, transactionStatus: status,
      };
      if (success) {
        const out = await settleSuccess(txnRef, proof, 'IPN');
        return out === 'ALREADY' ? rsp('02', 'Order already confirmed') : rsp('00', 'Confirm Success');
      }
      // Đã trừ tiền nhưng chưa chắc thành công (04, 07): không phải thất bại — giữ PENDING, chuyển người kiểm như QueryDr.
      if (REVIEW_STATUSES.includes(status) || code === '07') await flagForReview(order, status || code, 'IPN');
      else await settleFailure(txnRef, proof, 'IPN');
      return rsp('00', 'Confirm Success');
    } catch (e) {
      logErr('vnpay-ipn')(e);
      return rsp('99', 'Unknown error');
    }
  });
}

// ---------------------------------------------------------------- QueryDr
const expiryDue = (o: GatewayOrderHydrated, now: number) => now > o.expireAt.getTime() + SETTLE_GRACE_MS;

async function casExpired(o: GatewayOrderHydrated, reason: string) {
  const r = await GatewayOrderModel.updateOne({ _id: o._id, status: 'PENDING' }, { $set: { status: 'EXPIRED' }, $push: { statusHistory: { from: 'PENDING', to: 'EXPIRED', at: new Date(), reason } } });
  return r.modifiedCount > 0;
}

/**
 * Hỏi VNPAY về một order. Không có `force`: tối đa một lần mỗi 15 giây (nguyên tử trên lastCheckedAt). Lỗi mạng, sai chữ ký, mã không kết luận được: không đổi gì.
 * Không bao giờ ném lỗi — người gọi là poll của khách, job, và bước đối soát trước khi nhân viên thu.
 */
export async function checkOrder(order: GatewayOrderHydrated, opts: { force?: boolean } = {}) {
  if (env.paymentMode !== 'VNPAY') return;
  await runAsSystem(async () => {
    const nowDate = new Date();
    const now = nowDate.getTime();
    const claimed = await GatewayOrderModel.findOneAndUpdate(
      { _id: order._id, status: { $in: ['PENDING', 'SUPERSEDED'] }, ...(opts.force ? {} : { $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lte: new Date(now - QUERY_THROTTLE_MS) } }] }) },
      { $set: { lastCheckedAt: nowDate, nextCheckAt: new Date(now + RECHECK_MS) } }, { new: true },
    );
    if (!claimed) return;
    const inconclusive = async () => {
      await GatewayOrderModel.updateOne({ _id: claimed._id }, { $inc: { checkAttempts: 1 } });
      if (now > claimed.expireAt.getTime() + QUERY_GIVE_UP_MS && await casExpired(claimed, 'Không đối soát được quá 24 giờ')) {
        await urgentGatewayTask(claimed, `Không đối soát được VNPAY — ${claimed.txnRef}`, `Giao dịch ${claimed.txnRef} (${vnd(claimed.amount)}): QueryDr không kết luận được quá 24 giờ. Kiểm trên merchant VNPAY; nếu đã trừ tiền, IPN hoặc lần đối soát sau vẫn ghi nhận được.`);
      }
    };
    const r = await queryDr({ txnRef: claimed.txnRef, transactionDate: claimed.vnpCreateDate });
    if (!r.ok || r.tmnCode !== env.VNPAY_TMN_CODE || r.txnRef !== claimed.txnRef) return inconclusive();
    const proof: GatewayEvidence = { transactionNo: r.transactionNo || null, bankCode: r.bankCode || null, payDate: r.payDate || null, responseCode: r.responseCode, transactionStatus: r.transactionStatus };
    if (r.responseCode === '94') return; // trùng yêu cầu: bỏ qua lượt này
    if (r.responseCode === '91') { // không tìm thấy: chưa trả
      if (expiryDue(claimed, now)) await casExpired(claimed, 'QueryDr 91');
      return;
    }
    if (r.responseCode !== '00') return inconclusive();
    switch (r.transactionStatus) {
      case '00':
        if (!/^\d+$/.test(r.amount) || Number(r.amount) !== claimed.amount * 100) return flagAmountMismatch(claimed, r.amount, 'QUERYDR');
        if (claimed.applyFailures >= MAX_APPLY_FAILURES) {
          if (await settleUnapplied(claimed.txnRef, proof, 'QUERYDR', { code: 'APPLY_ERROR', message: 'Lỗi hệ thống khi thực hiện giao dịch' }) === 'ALREADY') return;
          await urgentGatewayTask(claimed, `Không áp được giao dịch VNPAY — ${claimed.txnRef}`, `Giao dịch ${claimed.txnRef} (${vnd(claimed.amount)}): lỗi hệ thống ${claimed.applyFailures} lần khi áp. Đã chuyển sang tự hoàn. Xem log lỗi.`);
          return;
        }
        try { await settleSuccess(claimed.txnRef, proof, 'QUERYDR'); } catch (e) { logErr('gateway-check')(e); }
        return;
      case '01':
        if (expiryDue(claimed, now)) await casExpired(claimed, 'QueryDr 00/01');
        return;
      case '02':
        await settleFailure(claimed.txnRef, proof, 'QUERYDR');
        return;
      case '04': case '07':
        await flagForReview(claimed, r.transactionStatus, 'QUERYDR');
        await GatewayOrderModel.updateOne({ _id: claimed._id }, { $set: { nextCheckAt: new Date(now + REVIEW_RECHECK_MS) } });
        return;
      default:
        return inconclusive();
    }
  }).catch(logErr('gateway-check'));
}

/**
 * Trước khi nhân viên thu tại quầy và trước khi khách bấm trả lại: hỏi VNPAY các order PENDING của target, lỗi thì bỏ qua. Không lọt được thì lần áp sẽ bắt bằng
 * ALREADY_PAID và tự hoàn. `force`: nhân viên sắp thu tiền thì luôn hỏi, không theo nhịp 15 giây.
 */
export async function settleOpenOrders(target: { reservationId?: string | Types.ObjectId; contractId?: string | Types.ObjectId; kind?: GatewayOrderKind }, opts: { force?: boolean } = {}) {
  if (env.paymentMode !== 'VNPAY') return;
  const { kind, ...ref } = target;
  const open = await GatewayOrderModel.find({ ...ref, ...(kind ? { kind } : {}), status: 'PENDING' }).limit(10);
  await Promise.all(open.map((o) => checkOrder(o, opts)));
}

/** Job gateway-reconcile: order PENDING đến lượt kiểm, cộng order SUPERSEDED chưa quá expireAt + 10 phút (khách có thể đã trả ở tab cũ). */
export async function reconcileGatewayOrders() {
  if (env.paymentMode !== 'VNPAY') return { checked: 0 };
  const now = new Date();
  const due = await GatewayOrderModel.find({
    nextCheckAt: { $lte: now },
    $or: [{ status: 'PENDING' }, { status: 'SUPERSEDED', expireAt: { $gt: new Date(now.getTime() - SETTLE_GRACE_MS) } }],
  }).sort({ nextCheckAt: 1 }).limit(50);
  for (const o of due) await checkOrder(o, { force: true });
  return { checked: due.length };
}

// ---------------------------------------------------------------- xem kết quả
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Tình trạng hoàn gộp từ các khoản REFUND của order. Khách không thấy REJECTED / UNKNOWN (đang được xử lý). */
async function refundSummary(o: GatewayOrderHydrated, forCustomer: boolean): Promise<GatewayOrderView['refund']> {
  const rows = await PaymentModel.find({ 'provider.orderId': o._id, type: 'REFUND' }, { amount: 1, status: 1, gatewayRefund: 1 }).lean();
  if (!rows.length) return null;
  const order: GatewayRefundState[] = ['REJECTED', 'UNKNOWN', 'SENDING', 'QUEUED', 'MOVED_TO_BANK', 'DONE'];
  const states = rows.map((r) => r.gatewayRefund?.state ?? 'DONE');
  const worst = order.find((s) => states.includes(s)) ?? 'DONE';
  // confirm-payout giữ nguyên state MOVED_TO_BANK, chỉ đổi status của dòng thành SUCCEEDED.
  const transferred = worst === 'MOVED_TO_BANK' && rows.every((r) => r.gatewayRefund?.state !== 'MOVED_TO_BANK' || r.status === 'SUCCEEDED');
  return { state: forCustomer && (worst === 'REJECTED' || worst === 'UNKNOWN') ? 'SENDING' : worst, amount: rows.reduce((s, r) => s + r.amount, 0), transferred };
}

export async function orderView(o: GatewayOrderHydrated, viewer: UserHydrated): Promise<GatewayOrderView> {
  const owner = viewer.role === 'CUSTOMER' && String(o.customerId) === String(viewer._id);
  const paid = o.status === 'PAID' || o.status === 'PAID_UNAPPLIED';
  const r = o.result;
  return {
    _id: String(o._id), txnRef: o.txnRef, kind: o.kind, status: o.status, amount: o.amount,
    createdAt: iso(o.get('createdAt') as Date)!, expireAt: o.expireAt.toISOString(), reservationId: o.reservationId ? String(o.reservationId) : null, contractId: o.contractId ? String(o.contractId) : null,
    payUrl: owner && o.status === 'PENDING' && o.expireAt.getTime() > Date.now() ? o.payUrl ?? null : null,
    paymentIds: o.paymentIds.map(String),
    result: r ? { ...(r.serviceOrderId ? { serviceOrderId: String(r.serviceOrderId) } : {}), ...(r.accessRequestId ? { accessRequestId: String(r.accessRequestId) } : {}), ...(r.newEndDate ? { newEndDate: r.newEndDate.toISOString() } : {}) } : null,
    transactionNo: paid ? o.gateway?.transactionNo ?? null : null, paidAt: paid ? iso(o.gateway?.confirmedAt) : null,
    unapplied: o.unapplied ? { code: o.unapplied.code, message: o.unapplied.message } : null,
    refund: await refundSummary(o, viewer.role === 'CUSTOMER'),
  };
}

/** GET /payments/gateway-orders/:txnRef. Không thấy hoặc không có quyền đều 404 (không lộ tồn tại). Chỉ khi khách chủ order xem, order còn PENDING mới hỏi VNPAY. */
export async function viewGatewayOrder(user: UserHydrated, txnRef: string) {
  let o = await GatewayOrderModel.findOne({ txnRef });
  const allowed = !!o && (user.role === 'OPS_MANAGER'
    || (user.role === 'CUSTOMER' ? String(o.customerId) === String(user._id) : user.facilityIds.some((f) => String(f) === String(o!.facilityId))));
  if (!o || !allowed) throw NotFound('giao dịch');
  if (user.role === 'CUSTOMER' && o.status === 'PENDING') {
    await checkOrder(o);
    o = (await GatewayOrderModel.findById(o._id))!;
  }
  return orderView(o, user);
}
