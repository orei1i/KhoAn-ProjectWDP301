import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Types } from 'mongoose';
import { OUTBOUND_PAYMENT_TYPES, type PaymentMethod, type PaymentStatus, type PaymentType } from '@ssm/shared';
import { DamageClaimModel, InspectionModel, PaymentModel, UserModel, type PaymentHydrated, type UserHydrated } from '../../shared/db/models';
import { AppError, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { env } from '../../shared/config/env';
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
  /** Mã giao dịch nhân viên nhập khi thu tại quầy không bằng tiền mặt (chuyển khoản / chuẩn chi thẻ / VNPay-MoMo) — lưu provider.txnRef. */
  txnRef?: string | null;
  /** Người dùng thao tác tạo ra khoản này — với khoản CHI, người này không được tự xác nhận đã chuyển (SAME_APPROVER). */
  createdBy?: Id | null;
}

/** Mã giao dịch hợp lệ: 4–64 ký tự sau khi bỏ khoảng trắng hai đầu. */
const TXN_REF_MIN = 4;
const TXN_REF_MAX = 64;
/**
 * Thu tại quầy không bằng tiền mặt phải có chứng từ: mã giao dịch chuyển khoản / mã chuẩn chi thẻ / mã VNPay-MoMo (C1).
 * Tiền mặt không cần (người thu ký nhận qua recordedBy + chốt ca). Trả về mã đã chuẩn hoá, hoặc null với tiền mặt.
 */
export function requireTxnRef(method: PaymentMethod, txnRef?: string | null): string | null {
  if (method === 'CASH' || method === 'INTERNAL') return null;
  const ref = txnRef?.trim() ?? '';
  if (ref.length < TXN_REF_MIN || ref.length > TXN_REF_MAX) {
    throw Unprocessable(`Thu bằng ${method === 'CARD' ? 'thẻ' : method === 'BANK_TRANSFER' ? 'chuyển khoản' : 'ví điện tử'} — nhập mã giao dịch (${TXN_REF_MIN}–${TXN_REF_MAX} ký tự) làm chứng từ`, 'TXN_REF_REQUIRED');
  }
  return ref;
}

/** Các trường của một khoản NHÂN VIÊN thu tại quầy: người thu (mọi hình thức) + mã giao dịch (đã kiểm bằng requireTxnRef). */
export const counterPay = (staff: { _id: Types.ObjectId }, method: PaymentMethod, txnRef?: string | null) =>
  ({ method, recordedBy: staff._id, txnRef: method === 'CASH' ? null : txnRef ?? null, createdBy: staff._id });

/** Phương thức thanh toán online: hoàn tiền đi ngược về đúng cổng đó (cổng xử lý, coi như xong ngay). */
const GATEWAY_METHODS: readonly PaymentMethod[] = ['VNPAY', 'MOMO', 'CARD'];

/**
 * Thanh toán online của KHÁCH hiện là GIẢ LẬP (MOCK_PAYMENTS=true, mặc định — bản demo: "trả" là thành công ngay). Đặt MOCK_PAYMENTS=false
 * khi chưa nối cổng thanh toán thật → mọi thanh toán online của khách (giữ chân, công nợ, gia hạn có thu tiền, dịch vụ, phí cấp lại thẻ)
 * trả 501 GATEWAY_NOT_CONFIGURED; nhân viên thu tại quầy không đổi.
 */
export const gatewayNotConfigured = () => new AppError(501, 'GATEWAY_NOT_CONFIGURED', 'Thanh toán online chưa được kết nối cổng thanh toán — vui lòng thanh toán tại quầy chi nhánh');
export function assertOnlineGateway(user: { role: string }) {
  if (user.role === 'CUSTOMER' && !env.MOCK_PAYMENTS) throw gatewayNotConfigured();
}
/** Khoản do NHÂN VIÊN thu tại quầy (mọi hình thức: tiền mặt, chuyển khoản, quẹt thẻ, VNPay-MoMo quét mã tại quầy). */
export const isCounterPayment = (p: { recordedBy?: unknown; provider?: { counterRef?: string | null } | null }) => !!p.recordedBy || !!p.provider?.counterRef;
/**
 * Hoàn một khoản đã thu — theo KHOẢN GỐC: chỉ khoản khách tự trả online qua cổng (VNPAY / MOMO / CARD, không qua quầy) mới hoàn qua
 * chính cổng đó (coi như xong ngay). Khoản thu tại quầy (kể cả quẹt thẻ / quét mã tại quầy — KhoAn không có giao dịch cổng để hoàn
 * ngược) và tiền mặt / chuyển khoản → hoàn bằng chuyển khoản, chờ người KHÁC xác nhận đã chuyển (confirmPayout).
 */
export const refundMethodFor = (original: { method: PaymentMethod; recordedBy?: unknown; provider?: { counterRef?: string | null } | null }): PaymentMethod =>
  (GATEWAY_METHODS.includes(original.method) && !isCounterPayment(original) ? original.method : 'BANK_TRANSFER');
/** Ẩn số tài khoản khách nhận tiền hoàn (payout.toAccount) với nhân viên quầy — chỉ người xác nhận chi (FM / OPS) cần. */
export const paymentProjectionFor = (role: string): Record<string, 0> => (role === 'STAFF' ? { 'payout.toAccount': 0 } : {});
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
  const { txnRef, ...rest } = p;
  const [doc] = await PaymentModel.create([{
    ...rest,
    direction: OUTBOUND_PAYMENT_TYPES.includes(p.type) ? 'REFUND' : 'CHARGE',
    currency: 'VND',
    idempotencyKey: p.idempotencyKey ?? `srv-${randomUUID()}`,
    // Thu tại quầy: mã giao dịch do nhân viên nhập lưu ở counterRef, KHÔNG ở txnRef — một lần chuyển khoản có thể trả cho nhiều khoản,
    // còn txnRef nằm trong chỉ mục unique của mã cổng thanh toán. Còn lại: mã giả lập của cổng thanh toán.
    provider: p.method === 'CASH' || p.method === 'INTERNAL' ? null
      : txnRef ? { name: p.method, txnRef: null, counterRef: txnRef }
        : { name: p.method, txnRef: `${p.method}-${randomToken(9)}`, rawStatus: 'MOCK' },
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
    // Người tạo ra khoản chi (createdBy — actorStampPlugin ghi người thao tác: lập biên bản trả kho, xử lý đồ bỏ lại, huỷ đặt chỗ…) không tự
    // xác nhận đã chuyển — hai người cho mỗi khoản chi. Chi bồi thường đã tách quyền theo người DUYỆT hồ sơ (bên dưới) — người duyệt có thể
    // lập lệnh rồi người khác xác nhận; áp thêm quy tắc người lập lệnh sẽ khoá cứng hồ sơ do Quản lý vận hành duyệt.
    if (p.type !== 'COMPENSATION' && p.createdBy && String(p.createdBy) === String(user._id)) throw Forbidden('Bạn đã lập khoản chi này — nhờ quản lý khác hoặc Quản lý vận hành xác nhận đã chuyển', 'SAME_APPROVER');
    // Khoản hoàn do điều chỉnh biên bản trả kho: người điều chỉnh không tự xác nhận đã chuyển.
    const adj = p.type === 'REFUND' ? await InspectionModel.findOne({ 'adjustments.refundPaymentId': p._id }, { adjustments: 1 }).session(session).lean() : null;
    const adjustedBy = adj?.adjustments?.find((a) => String(a.refundPaymentId) === String(p._id))?.by;
    if (adjustedBy && String(adjustedBy) === String(user._id)) throw Forbidden('Người điều chỉnh biên bản không tự xác nhận khoản hoàn — nhờ quản lý khác hoặc Quản lý vận hành', 'SAME_APPROVER');
    const customer = await UserModel.findById(p.customerId, { customerProfile: 1 }).session(session).lean();
    const acc = customer?.customerProfile?.payoutAccount;
    // Khách đã khai tài khoản thì chỉ chuyển tới đúng tài khoản đó — không ghi tài khoản khác.
    if (acc && input.toAccount?.trim()) throw Unprocessable('Khách đã khai tài khoản nhận tiền — chỉ chuyển tới đúng tài khoản đó', 'PAYOUT_ACCOUNT_FIXED');
    // Khách CHƯA khai tài khoản: người xác nhận phải tự nhập tài khoản đã chuyển tới — rủi ro chuyển nhầm / chuyển cho người khác, nên
    // chỉ Quản lý vận hành (hoặc quản trị) làm; Quản lý chi nhánh chuyển yêu cầu lên (D2).
    if (!acc && user.role === 'FACILITY_MANAGER') throw Forbidden('Khách chưa khai tài khoản nhận tiền — chỉ Quản lý vận hành xác nhận khoản chuyển tới tài khoản tự nhập', 'PAYOUT_ACCOUNT_OPS');
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
