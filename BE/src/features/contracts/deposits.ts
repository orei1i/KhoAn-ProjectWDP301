import type { ClientSession, Types } from 'mongoose';
import type { PaymentMethod } from '@ssm/shared';
import { PaymentModel, type PaymentHydrated } from '../../shared/db/models';
import { createPayment, refundMethodFor } from '../payments/payment.service';

/**
 * Đợt 16 (A3) — TIỀN GIỮ CHÂN của hợp đồng = các khoản DEPOSIT: khoản gốc lúc đặt (`deposit.paymentId`, gắn đặt chỗ) + các khoản nộp bù khi
 * đổi sang cỡ kho lớn hơn (gắn `contractId`). Hoàn (khi đổi cỡ, khi quyết toán) đi theo TỪNG khoản, khoản MỚI NHẤT trước; mỗi khoản tối đa
 * số còn lại của nó (amount − refundedAmount), nên hoàn qua cổng không bao giờ vượt giao dịch gốc của cổng.
 */
type ContractRef = { _id: Types.ObjectId; facilityId: Types.ObjectId; customerId: Types.ObjectId; deposit: { paymentId?: Types.ObjectId | null } };

const depositFilter = (c: ContractRef) => ({ type: 'DEPOSIT', direction: 'CHARGE', $or: [{ contractId: c._id }, ...(c.deposit.paymentId ? [{ _id: c.deposit.paymentId }] : [])] });

/** Mọi khoản DEPOSIT của hợp đồng (mọi trạng thái) — để nhận ra khoản hoàn nào là hoàn tiền giữ chân. */
export async function depositPaymentIds(c: ContractRef, session: ClientSession | null) {
  return (await PaymentModel.find(depositFilter(c), { _id: 1 }).session(session).lean()).map((p) => String(p._id));
}

/** Các khoản DEPOSIT ĐÃ THU còn hoàn được, mới nhất trước. */
export async function paidDeposits(c: ContractRef, session: ClientSession | null): Promise<PaymentHydrated[]> {
  const list = await PaymentModel.find({ ...depositFilter(c), status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }).session(session);
  const at = (p: PaymentHydrated) => (p.paidAt ?? p.createdAt ?? new Date(0)).getTime();
  return list.sort((a, b) => at(b) - at(a));
}

/**
 * Hoàn `amount` đồng tiền giữ chân theo từng khoản (mới nhất trước). `method`: 'ORIGINAL' = qua đúng phương thức của khoản đó (khách trả
 * online qua cổng → hoàn qua cổng; thu tại quầy → chuyển khoản chờ xác nhận); hoặc một phương thức cố định (quyết toán: chuyển khoản chờ xác
 * nhận). Phần vượt tổng số còn lại của các khoản (dữ liệu lệch) → chuyển khoản chờ xác nhận, trỏ khoản gốc. Ghi số đã hoàn + trạng thái
 * (Hoàn một phần / Đã hoàn) lên từng khoản. Trả các khoản hoàn vừa lập.
 */
export async function refundDeposits(
  c: ContractRef, amount: number, opts: { method: 'ORIGINAL' | PaymentMethod; by: Types.ObjectId | null; reason: string; keyPrefix?: string }, session: ClientSession,
) {
  const refunds: PaymentHydrated[] = [];
  if (amount <= 0) return refunds;
  const deps = await paidDeposits(c, session);
  let left = amount;
  for (const dep of deps) {
    if (left <= 0) break;
    const n = Math.min(left, Math.max(0, dep.amount - (dep.refundedAmount ?? 0)));
    if (n <= 0) continue;
    refunds.push(await createPayment({
      facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: n, status: 'SUCCEEDED',
      method: opts.method === 'ORIGINAL' ? refundMethodFor(dep) : opts.method, refundOf: dep._id, createdBy: opts.by,
      ...(opts.keyPrefix ? { idempotencyKey: `${opts.keyPrefix}-${dep._id}` } : {}),
    }, session));
    dep.refundedAmount = (dep.refundedAmount ?? 0) + n;
    const next = dep.refundedAmount >= dep.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    if (dep.status !== next) dep.transitionTo(next, { actor: 'SYSTEM', by: opts.by, reason: opts.reason });
    await dep.save({ session });
    left -= n;
  }
  if (left > 0) {
    refunds.push(await createPayment({
      facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: left, status: 'SUCCEEDED', method: 'BANK_TRANSFER',
      refundOf: c.deposit.paymentId ?? deps[deps.length - 1]?._id ?? null, createdBy: opts.by, ...(opts.keyPrefix ? { idempotencyKey: `${opts.keyPrefix}-over` } : {}),
    }, session));
  }
  return refunds;
}
