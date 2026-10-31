import type { ClientSession, Types } from 'mongoose';
import { vnd, type GatewayRefundAction } from '@ssm/shared';
import { GatewayOrderModel, PaymentModel, type UserHydrated } from '../../shared/db/models';
import { Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { env } from '../../shared/config/env';
import { assertFacility } from '../../shared/http/scope';
import { withTxn } from '../../shared/db/txn';
import { audit } from '../audit/audit.service';
import { mailCustomer } from '../contracts/contract-notice.service';
import { urgentGatewayTask } from './gateway-order.service';
import { newRequestId, refund as vnpRefund } from './vnpay.client';

/**
 * Đợt VNPAY — gửi yêu cầu hoàn qua cổng (outbox trên dòng PaymentTransaction do createPayment xếp hàng). Không gọi mạng trong transaction.
 * Chống hoàn hai lần:
 *  - giữ chỗ trần `order.refundedAmount` và chuyển dòng QUEUED → SENDING trong CÙNG một transaction, nên mỗi dòng chỉ được claim một lần, tổng không vượt `order.amount`;
 *  - đã gửi mà không rõ kết quả (timeout, lỗi mạng, sai chữ ký phản hồi, dòng SENDING quá 5 phút) → UNKNOWN, GIỮ trần, KHÔNG tự gửi lại: tài liệu không cam kết chống
 *    trùng theo RequestId. Chỉ người đã kiểm trên merchant VNPAY mới đưa dòng về hàng đợi (resolveGatewayRefund).
 */
const SENDING_STALE_MS = 5 * 60_000;
const BUSY_RETRY_MS = 10 * 60_000;
const MAX_BUSY_ATTEMPTS = 12;
const refundUnavailable = () => Unprocessable('Khoản hoàn này không ở trạng thái xử lý được bằng thao tác này', 'GATEWAY_REFUND_NOT_RESOLVABLE');

type Row = { _id: Types.ObjectId; amount: number; customerId: Types.ObjectId; facilityId: Types.ObjectId; contractId?: Types.ObjectId | null };
/** Ghi tiến trình hoàn, chỉ trên các dòng còn ở trạng thái `from`: phản hồi về muộn không ghi đè trạng thái đã đổi. */
const setRows = (ids: Types.ObjectId[], from: 'QUEUED' | 'SENDING', fields: Record<string, unknown>, session?: ClientSession) =>
  PaymentModel.updateMany({ _id: { $in: ids }, 'gatewayRefund.state': from }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`gatewayRefund.${k}`, v])) }, { session });
const releaseCap = (orderId: Types.ObjectId, sum: number, session?: ClientSession) =>
  GatewayOrderModel.updateOne({ _id: orderId, refundedAmount: { $gte: sum } }, { $inc: { refundedAmount: -sum } }, { session });

async function notifyFailure(o: { txnRef: string; facilityId: Types.ObjectId; customerId: Types.ObjectId; contractId?: Types.ObjectId | null }, sum: number, code: string, unknown: boolean) {
  await urgentGatewayTask(o, `Hoàn VNPAY lỗi — ${o.txnRef}`, `Hoàn ${vnd(sum)} của giao dịch ${o.txnRef}: mã ${code}. ${unknown ? 'Chưa rõ kết quả — kiểm trên merchant VNPAY trước khi xử lý.' : 'VNPAY không nhận yêu cầu — gửi lại hoặc chuyển sang chuyển khoản.'}`);
}

/** Một lượt gửi cho một order: gộp mọi dòng QUEUED thành một yêu cầu (huỷ đặt chỗ kho lớn sinh 2 dòng; gửi riêng thì yêu cầu thứ hai có thể dính mã 94). */
async function sendForOrder(orderId: Types.ObjectId, ids: Types.ObjectId[]) {
  const now = new Date();
  const requestId = newRequestId();
  const claim = await withTxn(async (session) => {
    if (await PaymentModel.exists({ 'provider.orderId': orderId, 'gatewayRefund.state': 'SENDING' }).session(session)) return null; // mỗi order chỉ một yêu cầu đang đi
    const rows = await PaymentModel.find({ _id: { $in: ids }, status: 'PENDING', method: 'VNPAY', 'gatewayRefund.state': 'QUEUED' }, { amount: 1, customerId: 1, facilityId: 1, contractId: 1 }).session(session).lean();
    if (!rows.length) return null;
    const rowIds = rows.map((r) => r._id);
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    const before = await GatewayOrderModel.findById(orderId).session(session);
    if (!before) return null;
    const held = await GatewayOrderModel.findOneAndUpdate(
      { _id: orderId, $expr: { $lte: [{ $add: ['$refundedAmount', sum] }, '$amount'] } },
      { $inc: { refundedAmount: sum } }, { session },
    );
    if (!held) {
      await setRows(rowIds, 'QUEUED', { state: 'REJECTED', responseCode: 'OVER_ORDER_AMOUNT', message: 'Tổng hoàn vượt số tiền giao dịch' }, session);
      return { over: true as const, rows, sum, order: before };
    }
    const type = sum === before.amount && before.refundedAmount === 0 ? '02' as const : '03' as const;
    await setRows(rowIds, 'QUEUED', { state: 'SENDING', requestId, type, sentAt: now }, session);
    return { over: false as const, rows, sum, type, order: before };
  });
  if (!claim) return { sent: 0 };
  const { rows, sum, order } = claim;
  const rowIds = rows.map((r: Row) => r._id);
  if (claim.over) {
    await notifyFailure(order, sum, 'OVER_ORDER_AMOUNT', false);
    return { sent: 0 };
  }

  // Ngoài transaction: chết ở đây thì dòng còn SENDING, lượt sau chuyển UNKNOWN, không gửi lại.
  const r = await vnpRefund({
    requestId, type: claim.type, txnRef: order.txnRef, amount: sum, transactionNo: order.gateway?.transactionNo ?? '', transactionDate: order.vnpCreateDate,
  });

  if (!r.ok) {
    await setRows(rowIds, 'SENDING', { state: 'UNKNOWN', responseCode: r.reason });
    await notifyFailure(order, sum, r.reason, true);
    return { sent: 1 };
  }
  const rejected = r.responseCode !== '00' || r.transactionStatus === '09'; // 09 = VNPAY báo yêu cầu hoàn bị từ chối
  if (r.responseCode === '00' && !rejected) {
    await withTxn(async (session) => {
      const docs = await PaymentModel.find({ _id: { $in: rowIds }, 'gatewayRefund.state': 'SENDING' }).session(session);
      for (const d of docs) {
        d.gatewayRefund!.state = 'DONE';
        d.gatewayRefund!.responseCode = r.responseCode;
        d.gatewayRefund!.transactionNo = r.transactionNo || null;
        d.gatewayRefund!.transactionStatus = r.transactionStatus || null;
        if (d.provider) d.provider.rawStatus = r.responseCode;
        d.transitionTo('SUCCEEDED', { actor: 'SYSTEM', reason: 'VNPAY đã nhận yêu cầu hoàn' });
        await d.save({ session });
      }
      await audit({ action: 'payment.gateway_refund', entityType: 'GatewayOrder', entityId: order._id, facilityId: order.facilityId, changes: { after: { txnRef: order.txnRef, amount: sum, type: claim.type } } }, session);
    });
    void mailCustomer(order.customerId, `KhoAn — Đã gửi yêu cầu hoàn ${vnd(sum)}`, [`KhoAn đã gửi yêu cầu hoàn ${vnd(sum)} (mã ${order.txnRef}) về phương thức bạn đã trả. Thời gian tiền về tuỳ ngân hàng.`]);
    return { sent: 1 };
  }
  // VNPAY đang xử lý một yêu cầu hoàn trước đó: chờ rồi thử lại, trả lại trần; quá nhiều lần thì chuyển người.
  if (r.responseCode === '94') {
    const docs = await PaymentModel.find({ _id: { $in: rowIds } }, { 'gatewayRefund.attempts': 1 }).lean();
    const attempts = Math.max(...docs.map((d) => d.gatewayRefund?.attempts ?? 0)) + 1;
    if (attempts <= MAX_BUSY_ATTEMPTS) {
      await setRows(rowIds, 'SENDING', { state: 'QUEUED', attempts, nextAttemptAt: new Date(Date.now() + BUSY_RETRY_MS), responseCode: '94' });
      await releaseCap(order._id, sum);
      return { sent: 1 };
    }
    await setRows(rowIds, 'SENDING', { attempts });
  }
  await setRows(rowIds, 'SENDING', { state: 'REJECTED', responseCode: r.responseCode, message: r.message.slice(0, 500) || null, transactionStatus: r.transactionStatus || null });
  await releaseCap(order._id, sum);
  await notifyFailure(order, sum, r.responseCode, false);
  void mailCustomer(order.customerId, `KhoAn — Khoản hoàn ${vnd(sum)} đang được xử lý`, [`Yêu cầu hoàn ${vnd(sum)} (mã ${order.txnRef}) đang được chi nhánh xử lý. KhoAn sẽ báo khi hoàn xong; cần gấp, vui lòng liên hệ chi nhánh.`]);
  return { sent: 1 };
}

/** Dòng SENDING quá 5 phút (server chết giữa chừng): không biết đã gửi chưa → UNKNOWN, giữ trần, chuyển người. */
async function expireStaleSending() {
  const stale = await PaymentModel.find({ 'gatewayRefund.state': 'SENDING', 'gatewayRefund.sentAt': { $lte: new Date(Date.now() - SENDING_STALE_MS) } }, { amount: 1, 'provider.orderId': 1 }).lean();
  for (const p of stale) {
    const moved = await PaymentModel.updateOne({ _id: p._id, 'gatewayRefund.state': 'SENDING' }, { $set: { 'gatewayRefund.state': 'UNKNOWN', 'gatewayRefund.responseCode': 'STALE_SENDING' } });
    if (!moved.modifiedCount || !p.provider?.orderId) continue;
    const o = await GatewayOrderModel.findById(p.provider.orderId);
    if (o) await notifyFailure(o, p.amount, 'STALE_SENDING', true);
  }
}

/** Job gateway-refunds, mỗi 60 giây. */
export async function drainGatewayRefunds() {
  if (env.paymentMode !== 'VNPAY') return { orders: 0, sent: 0 };
  await expireStaleSending();
  const due = await PaymentModel.find({ method: 'VNPAY', status: 'PENDING', 'gatewayRefund.state': 'QUEUED', 'gatewayRefund.nextAttemptAt': { $lte: new Date() } }, { 'provider.orderId': 1 }).limit(200).lean();
  const byOrder = new Map<string, { orderId: Types.ObjectId; ids: Types.ObjectId[] }>();
  for (const p of due) {
    const orderId = p.provider?.orderId;
    if (!orderId) continue;
    const k = String(orderId);
    if (!byOrder.has(k)) byOrder.set(k, { orderId, ids: [] });
    byOrder.get(k)!.ids.push(p._id);
  }
  let sent = 0;
  for (const { orderId, ids } of byOrder.values()) {
    try { sent += (await sendForOrder(orderId, ids)).sent; } catch (e) { console.error('[job:gateway-refunds]', String(orderId), e instanceof Error ? e.message : e); }
  }
  return { orders: byOrder.size, sent };
}

/**
 * POST /payments/:id/gateway-refund/resolve. RETRY: REJECTED, hoặc UNKNOWN khi người xử lý đã kiểm trên merchant VNPAY là chưa hoàn → về hàng đợi (lúc gửi lại giữ trần
 * mới). TO_BANK_TRANSFER: REJECTED / UNKNOWN → chuyển khoản, đi tiếp confirm-payout (hai người). MARK_DONE: chỉ OPS, chỉ UNKNOWN, ghi chú làm chứng từ.
 */
export async function resolveGatewayRefund(user: UserHydrated, id: string, input: { action: GatewayRefundAction; note: string }) {
  const note = input.note.trim();
  const p = await withTxn(async (session) => {
    const p = await PaymentModel.findById(id).session(session);
    if (!p) throw NotFound('khoản thanh toán');
    await assertFacility(user, p.facilityId, 'payment.gateway_refund_resolve');
    if (input.action === 'MARK_DONE' && user.role !== 'OPS_MANAGER') throw Forbidden('Chỉ Quản lý vận hành xác nhận khoản hoàn chưa rõ kết quả là đã xong');
    const gr = p.gatewayRefund;
    if (!gr || p.status !== 'PENDING') throw refundUnavailable();
    const orderId = p.provider?.orderId;
    const before = gr.state;
    const stamp = () => { gr.resolvedBy = user._id; gr.resolvedAt = new Date(); gr.note = note; };
    if (input.action === 'RETRY') {
      if (before !== 'REJECTED' && before !== 'UNKNOWN') throw refundUnavailable();
      // UNKNOWN đang giữ trần: đã kiểm là chưa hoàn nên trả lại, lúc gửi lại giữ trần mới.
      if (before === 'UNKNOWN' && orderId) await releaseCap(orderId, p.amount, session);
      gr.state = 'QUEUED';
      gr.attempts = 0;
      gr.nextAttemptAt = new Date();
    } else if (input.action === 'TO_BANK_TRANSFER') {
      if (before !== 'REJECTED' && before !== 'UNKNOWN') throw refundUnavailable();
      p.method = 'BANK_TRANSFER';
      gr.state = 'MOVED_TO_BANK';
    } else {
      if (before !== 'UNKNOWN') throw refundUnavailable();
      gr.state = 'DONE';
      p.transitionTo('SUCCEEDED', { actor: user.role, by: user._id, reason: note });
    }
    stamp();
    await p.save({ session });
    await audit({ action: 'payment.gateway_refund_resolve', entityType: 'PaymentTransaction', entityId: p._id, facilityId: p.facilityId, reason: note, changes: { before: { state: before }, after: { state: gr.state, action: input.action, amount: p.amount } } }, session);
    return p;
  });
  if (input.action === 'TO_BANK_TRANSFER') {
    void mailCustomer(p.customerId, `KhoAn — Khoản hoàn ${vnd(p.amount)} sẽ chuyển khoản`, ['Khoản hoàn không thực hiện được qua VNPAY nên chi nhánh sẽ chuyển khoản tới tài khoản nhận tiền bạn đã khai; chưa khai thì vui lòng khai trong tài khoản hoặc liên hệ chi nhánh.']);
  }
  return p;
}
