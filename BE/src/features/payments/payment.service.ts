import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Types } from 'mongoose';
import { OUTBOUND_PAYMENT_TYPES, type PaymentMethod, type PaymentStatus, type PaymentType } from '@ssm/shared';
import { DamageClaimModel, PaymentModel, UserModel, type PaymentHydrated, type UserHydrated } from '../../shared/db/models';
import { Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertFacility } from '../../shared/http/scope';
import { withTxn } from '../../shared/db/txn';
import { audit } from '../audit/audit.service';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 16) => randomBytes(bytes).toString('base64url');
export const sixDigitPin = () => String(100000 + (randomBytes(4).readUInt32BE() % 900000));

type Id = Types.ObjectId | string;
export interface NewPayment {
  facilityId: Id; customerId: Id; contractId?: Id | null; reservationId?: Id | null;
  type: PaymentType; amount: number; status: PaymentStatus; method: PaymentMethod;
  period?: { start: Date; end: Date } | null; refundOf?: Id | null; recordedBy?: Id | null;
  waiver?: { approvedBy: Id; reason: string } | null; idempotencyKey?: string;
}

/** Phương thức thanh toán online: hoàn tiền đi ngược về đúng cổng đó (cổng xử lý, coi như xong ngay). */
const GATEWAY_METHODS: readonly PaymentMethod[] = ['VNPAY', 'MOMO', 'CARD'];
/** Hoàn một khoản đã thu: thu qua cổng online → hoàn qua chính cổng đó; tiền mặt / chuyển khoản → hoàn bằng chuyển khoản (chờ chuyển). */
export const refundMethodFor = (original: PaymentMethod): PaymentMethod => (GATEWAY_METHODS.includes(original) ? original : 'BANK_TRANSFER');
/** Khoản tiền RA bằng chuyển khoản ngân hàng — phải có người chuyển thật rồi xác nhận, không tự coi là đã trả. */
const isPayout = (p: Pick<NewPayment, 'type' | 'method'>) => (p.type === 'REFUND' || p.type === 'LIQUIDATION_PAYOUT' || p.type === 'COMPENSATION') && p.method === 'BANK_TRANSFER';

/**
 * Creates one payment row. With MOCK_PAYMENTS the gateway reference is simulated.
 * Khoản HOÀN bằng chuyển khoản (REFUND / LIQUIDATION_PAYOUT, method BANK_TRANSFER) luôn được tạo ở trạng thái PENDING = "chờ chuyển":
 * quản lý chuyển tiền tới tài khoản khách khai rồi xác nhận kèm mã giao dịch (confirmPayout) — tránh ghi "đã hoàn" khi tiền chưa đi.
 */
export async function createPayment(p: NewPayment, session: ClientSession): Promise<PaymentHydrated> {
  const now = new Date();
  if (isPayout(p) && p.status === 'SUCCEEDED') p = { ...p, status: 'PENDING' };
  const [doc] = await PaymentModel.create([{
    ...p,
    direction: OUTBOUND_PAYMENT_TYPES.includes(p.type) ? 'REFUND' : 'CHARGE',
    currency: 'VND',
    idempotencyKey: p.idempotencyKey ?? `srv-${randomUUID()}`,
    provider: p.method === 'CASH' || p.method === 'INTERNAL' ? null : { name: p.method, txnRef: `${p.method}-${randomToken(9)}`, rawStatus: 'MOCK' },
    paidAt: p.status === 'SUCCEEDED' ? now : null,
    statusHistory: [{ from: null, to: p.status, at: now }],
  }], { session });
  return doc;
}

/**
 * Xác nhận ĐÃ CHUYỂN KHOẢN một khoản hoàn đang chờ (FM đúng chi nhánh / OPS): ghi mã giao dịch ngân hàng và tài khoản nhận, chuyển
 * PENDING → SUCCEEDED. Tài khoản nhận lấy từ hồ sơ khách (khách tự khai); khách chưa khai thì phải nhập tài khoản đã chuyển tới.
 */
export async function confirmPayout(user: UserHydrated, id: string, input: { reference: string; toAccount?: string }) {
  return withTxn(async (session) => {
    const p = await PaymentModel.findById(id).session(session);
    if (!p) throw NotFound('khoản thanh toán');
    await assertFacility(user, p.facilityId, 'payment.payout');
    if (p.direction !== 'REFUND' || p.method !== 'BANK_TRANSFER' || p.status !== 'PENDING') throw Unprocessable('Chỉ xác nhận được khoản hoàn bằng chuyển khoản đang chờ chuyển', 'NOT_PENDING_PAYOUT');
    // Chi bồi thường bằng chuyển khoản: người đã DUYỆT hồ sơ không được tự xác nhận đã chuyển (hai người cho mỗi khoản chi).
    const claim = p.type === 'COMPENSATION' ? await DamageClaimModel.findOne({ 'settlement.paymentId': p._id }).session(session) : null;
    if (claim && String(claim.review?.reviewedBy) === String(user._id)) throw Forbidden('Người duyệt hồ sơ bồi thường không tự xác nhận đã chuyển — nhờ quản lý khác hoặc Quản lý vận hành', 'SAME_APPROVER');
    const customer = await UserModel.findById(p.customerId, { customerProfile: 1 }).session(session).lean();
    const acc = customer?.customerProfile?.payoutAccount;
    const toAccount = input.toAccount?.trim() || (acc ? `${acc.bankName} · ${acc.accountNumber} · ${acc.accountName}` : '');
    if (!toAccount) throw Unprocessable('Khách chưa khai tài khoản nhận tiền — nhập tài khoản đã chuyển tới', 'PAYOUT_ACCOUNT_REQUIRED');
    p.transitionTo('SUCCEEDED', { actor: user.role, by: user._id, reason: `Đã chuyển khoản — mã ${input.reference.trim()}` });
    p.payout = { reference: input.reference.trim(), toAccount, confirmedBy: user._id, confirmedAt: new Date() };
    await p.save({ session });
    if (claim?.settlement) {
      claim.settlement.paidAt = new Date();
      claim.transitionTo('PAID', { actor: user.role, by: user._id, reason: `Đã chuyển khoản — mã ${input.reference.trim()}` });
      await claim.save({ session });
    }
    await audit({ action: 'payment.payout', entityType: 'PaymentTransaction', entityId: p._id, facilityId: p.facilityId, changes: { after: { amount: p.amount, reference: input.reference.trim() } } }, session);
    return p;
  });
}
