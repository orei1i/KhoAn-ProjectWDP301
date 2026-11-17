import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Types, type ClientSession } from 'mongoose';
import { COUNTER_PURPOSE, dueAtCheckIn, vnd, type CounterOrderRow, type CounterOrderStart, type CounterPurpose } from '@ssm/shared';
import {
  FacilityModel, GatewayOrderModel, PaymentModel, RentalContractModel, ReservationModel, ServiceOrderModel, UnitSwapRequestModel, UserModel,
  type GatewayOrderHydrated, type UserHydrated,
} from '../../shared/db/models';
import { AppError, Conflict, NotFound, Unprocessable } from '../../shared/core/errors';
import { env } from '../../shared/config/env';
import { withTxn } from '../../shared/db/txn';
import { assertFacility } from '../../shared/http/scope';
import { audit } from '../audit/audit.service';
import { createPayment, gatewayNotConfigured } from './payment.service';
import { gatewayProvider, MIN_PAY_WINDOW_MS, type GatewayStartCtx } from './gateway-order.service';
import { buildPayUrl, ymdGmt7 } from './vnpay.client';

/**
 * Góp ý 17/11 — THU VNPAY TẠI QUẦY. Nhân viên chỉ còn hai hình thức: tiền mặt, hoặc VNPAY qua cổng thật (không gõ tay mã giao dịch).
 *
 * Luồng: (1) nhân viên bấm "Thanh toán qua VNPAY" → POST /payments/counter-orders: server tự tính số tiền của ĐÚNG bước đó (trừ đặt chỗ tại quầy — số nhân
 * viên đang thu, kiểm lại lúc đặt), mở lệnh `GatewayOrder` kind COUNTER kèm `counter.purpose`, trả payUrl (trang VNPAY; chế độ MOCK: trang giả lập của Webapp).
 * (2) Khách trả (tab mới trên máy quầy hoặc quét QR bằng điện thoại). IPN / QueryDr / trang giả lập → settleSuccess chỉ CAS lệnh sang PAID, KHÔNG ghi sổ.
 * (3) Màn quầy poll GET /payments/gateway-orders/:txnRef, thấy PAID thì nhân viên gửi thao tác (nhận kho / thu giữ chân / đặt chỗ / thu công nợ) với
 * `payMethod: 'VNPAY', gatewayTxnRef`. Hàm của thao tác gọi `consumeCounterOrder` TRONG transaction của nó: lệnh phải PAID, đúng việc, đúng đích (đặt chỗ / hợp
 * đồng / lượt đặt), đúng chi nhánh, đúng khách, đúng số tiền, chưa dùng, chưa trả lại → CAS `counter.consumedAt` rồi ghi dòng sổ VNPAY (người thu + provider của
 * lệnh). Thao tác lỗi thì CAS rollback cùng — lệnh vẫn PAID, chưa dùng.
 *
 * Tiền không mất: lệnh đã PAID mà chưa dùng (nhân viên đóng màn, đổi sang tiền mặt, số tiền đổi…) (a) được DÙNG LẠI khi bấm VNPAY lại cho cùng việc, cùng số
 * tiền (màn quầy thấy ngay "Đã thu qua VNPAY"); (b) nằm trong hàng "VNPAY tại quầy đã thu, chưa ghi nhận" (GET /payments/counter-orders) — quản lý trả lại khách
 * (POST …/release): ghi sổ GATEWAY_UNAPPLIED (đã hoàn) + khoản HOÀN chuyển khoản chờ người khác xác nhận đã chuyển. Một lệnh chỉ dùng một lần (CAS +
 * chỉ mục duy nhất provider.txnRef của dòng sổ); VNPAY không cho trả hai lần cùng vnp_TxnRef; hai lệnh cùng việc đều được trả thì chỉ một lệnh được dùng,
 * lệnh kia vào hàng chờ trả lại.
 */
type Id = Types.ObjectId | string;
const ORDER_TTL_MS = 15 * 60_000;
const FIRST_CHECK_MS = 5 * 60_000;
const WALK_IN_MAX = 2_000_000_000;

export interface CounterOrderInput {
  purpose: CounterPurpose;
  reservationId?: string; contractId?: string; swapRequestId?: string;
  /** Chỉ WALK_IN: chi nhánh, khoá lượt đặt (Idempotency-Key của lượt), số tiền đang thu, khách đã có tài khoản (nếu có). */
  facilityId?: string; walkInKey?: string; amount?: number; customerId?: string;
}

interface Target {
  purpose: CounterPurpose; targetKey: string; facilityId: Types.ObjectId; customerId: Types.ObjectId | null;
  reservationId: Types.ObjectId | null; contractId: Types.ObjectId | null; amount: number; holdUntil: Date | null;
}

const nothingDue = () => Unprocessable('Không có khoản nào cần thu ở bước này', 'NOTHING_TO_COLLECT');

/** Khoá đích của một việc thu tại quầy — thao tác thu dựng lại đúng khoá này khi dùng lệnh. */
export const counterTargetKey = {
  CHECK_IN: (reservationId: Id) => `COUNTER:CHECK_IN:${reservationId}`,
  HOLD_DEPOSIT: (reservationId: Id) => `COUNTER:HOLD_DEPOSIT:${reservationId}`,
  WALK_IN: (facilityId: Id, walkInKey: string) => `COUNTER:WALK_IN:${facilityId}:${walkInKey}`,
  BALANCE: (contractId: Id) => `COUNTER:BALANCE:${contractId}`,
  SWAP_FEE: (swapRequestId: Id) => `COUNTER:SWAP_FEE:${swapRequestId}`,
};

/** Số tiền nhận kho = tiền thuê còn thu (dueAtCheckIn) + mọi đơn dịch vụ kèm còn mở chưa trả — đúng như checkIn thu. */
export async function checkInDue(r: { _id: Types.ObjectId; quote: Parameters<typeof dueAtCheckIn>[0] }, session?: ClientSession) {
  const open = await ServiceOrderModel.find({ reservationId: r._id, status: 'REQUESTED', paymentId: null }, { total: 1 }).session(session ?? null).lean();
  return dueAtCheckIn(r.quote) + open.reduce((s, o) => s + o.total, 0);
}

async function resolveTarget(user: UserHydrated, i: CounterOrderInput, session: ClientSession): Promise<Target> {
  const base = { purpose: i.purpose, holdUntil: null as Date | null };
  switch (i.purpose) {
    case 'CHECK_IN': case 'HOLD_DEPOSIT': {
      if (!i.reservationId) throw Unprocessable('Thiếu đặt chỗ', 'TARGET_REQUIRED');
      const r = await ReservationModel.findById(i.reservationId).session(session);
      if (!r) throw NotFound('đặt chỗ');
      await assertFacility(user, r.facilityId, 'payment.counter_order');
      const ref = { facilityId: r.facilityId, customerId: r.customerId, reservationId: r._id, contractId: null };
      if (i.purpose === 'CHECK_IN') {
        if (r.status !== 'ALLOCATED' || r.contractId) throw Unprocessable('Đặt chỗ không ở bước nhận kho', 'NOT_AT_CHECK_IN');
        if (!r.signature) throw Unprocessable('Khách chưa ký hợp đồng — ký trước rồi mới thu tiền nhận kho', 'CONTRACT_NOT_SIGNED');
        const amount = await checkInDue(r, session);
        if (amount <= 0) throw nothingDue();
        return { ...base, ...ref, targetKey: counterTargetKey.CHECK_IN(r._id), amount };
      }
      if (r.status !== 'PENDING' || !r.payAtCounter) throw Unprocessable('Chỉ thu tại quầy cho đặt chỗ đang giữ chỗ, đã chọn trả tại quầy', 'NOT_PAY_AT_COUNTER');
      if (r.holdExpiresAt && r.holdExpiresAt < new Date()) throw Unprocessable('Đã hết thời gian giữ chỗ — đặt chỗ sẽ tự huỷ, đặt lại cho khách tại quầy', 'HOLD_EXPIRED');
      // Trả khi nhận kho (C1): tiền chỉ thu sau khi khách đã ký — không để khách trả VNPAY trước khi ký.
      if (r.payOnArrival && !r.signature) throw Unprocessable('Khách chưa ký hợp đồng — in hợp đồng cho khách ký giấy, lưu bản đã ký rồi mới thu tiền giữ chân', 'CONTRACT_NOT_SIGNED');
      const rows = await PaymentModel.find({ reservationId: r._id, type: { $in: ['DEPOSIT', 'PREPAID_RENT'] }, status: 'PENDING' }, { amount: 1 }).session(session).lean();
      const amount = rows.reduce((s, p) => s + p.amount, 0);
      if (amount <= 0) throw nothingDue();
      return { ...base, ...ref, targetKey: counterTargetKey.HOLD_DEPOSIT(r._id), amount, holdUntil: r.holdExpiresAt ?? null };
    }
    case 'BALANCE': {
      if (!i.contractId) throw Unprocessable('Thiếu hợp đồng', 'TARGET_REQUIRED');
      const c = await RentalContractModel.findById(i.contractId).session(session);
      if (!c) throw NotFound('hợp đồng');
      await assertFacility(user, c.facilityId, 'payment.counter_order');
      if (c.balance.outstanding <= 0) throw Unprocessable('Hợp đồng không có công nợ', 'NOTHING_TO_COLLECT');
      return { ...base, targetKey: counterTargetKey.BALANCE(c._id), facilityId: c.facilityId, customerId: c.customerId, reservationId: null, contractId: c._id, amount: c.balance.outstanding };
    }
    case 'SWAP_FEE': {
      if (!i.swapRequestId) throw Unprocessable('Thiếu yêu cầu đổi ô', 'TARGET_REQUIRED');
      const s = await UnitSwapRequestModel.findById(i.swapRequestId).session(session);
      if (!s) throw NotFound('yêu cầu đổi ô');
      await assertFacility(user, s.facilityId, 'payment.counter_order');
      if (s.status !== 'APPROVED' || !s.feePrepay || s.fee <= 0 || s.paymentId) throw Unprocessable('Yêu cầu đổi ô này không còn phí cần thu', 'NOTHING_TO_COLLECT');
      return { ...base, targetKey: counterTargetKey.SWAP_FEE(s._id), facilityId: s.facilityId, customerId: s.customerId, reservationId: null, contractId: s.contractId, amount: s.fee };
    }
    case 'WALK_IN': {
      if (!i.facilityId || !i.walkInKey) throw Unprocessable('Thiếu chi nhánh hoặc mã lượt đặt', 'TARGET_REQUIRED');
      await assertFacility(user, i.facilityId, 'payment.counter_order');
      const amount = i.amount ?? 0;
      if (!Number.isInteger(amount) || amount <= 0 || amount > WALK_IN_MAX) throw nothingDue();
      let customerId: Types.ObjectId | null = null;
      if (i.customerId) {
        const u = await UserModel.findById(i.customerId, { role: 1 }).session(session).lean();
        if (!u || u.role !== 'CUSTOMER') throw NotFound('khách hàng');
        customerId = u._id;
      }
      return { ...base, targetKey: counterTargetKey.WALK_IN(i.facilityId, i.walkInKey), facilityId: new Types.ObjectId(i.facilityId), customerId, reservationId: null, contractId: null, amount };
    }
    default: throw Unprocessable('Việc thu không hợp lệ', 'BAD_PURPOSE');
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const startView = (o: GatewayOrderHydrated, reused: boolean): CounterOrderStart => ({
  txnRef: o.txnRef, amount: o.amount, status: o.status, expiresAt: o.expireAt.toISOString(), purpose: o.counter!.purpose, reused,
  payUrl: o.status === 'PENDING' && o.expireAt.getTime() > Date.now() ? o.payUrl ?? null : null,
  transactionNo: o.gateway?.transactionNo ?? null, paidAt: o.status === 'PAID' ? iso(o.gateway?.confirmedAt) : null,
});

// ---------------------------------------------------------------- trang thanh toán giả lập (chỉ MOCK_PAYMENTS)
const mockKey = () => createHash('sha256').update(`ssm:mock-gateway:v1:${env.ACCESS_CODE_SECRET ?? env.FIREBASE_PRIVATE_KEY}`).digest();
/** Chữ ký của link trang giả lập — chỉ người có link (màn quầy / mã QR) mở được, không đoán được từ txnRef. */
export const mockSig = (txnRef: string) => createHmac('sha256', mockKey()).update(txnRef).digest('base64url').slice(0, 32);
export function assertMockSig(txnRef: string, sig: string) {
  const want = Buffer.from(mockSig(txnRef)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw NotFound('giao dịch');
}
/** Mã giao dịch "phía cổng" của lần trả giả lập — 8 số như VNPAY, tiền tố MOCK để không nhầm với giao dịch thật. */
export const mockTransactionNo = () => `MOCK${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;

/**
 * POST /payments/counter-orders. Cùng việc + cùng số tiền: lệnh đã PAID chưa dùng → trả lại luôn (khách đã trả); lệnh PENDING còn trên 3 phút → dùng lại link.
 * Ngược lại các lệnh PENDING cũ của việc này thành SUPERSEDED (vẫn nhận được tiền muộn — khi đó vào hàng chờ trả lại) rồi mở lệnh mới.
 */
export async function openCounterOrder(user: UserHydrated, input: CounterOrderInput, start: GatewayStartCtx): Promise<CounterOrderStart> {
  if (env.paymentMode === 'OFF') throw gatewayNotConfigured();
  return withTxn(async (session) => {
    const t = await resolveTarget(user, input, session);
    const now = new Date();
    // Ghi chạm đích trước: hai lần bấm song song xung đột ghi, lần chạy lại thấy lệnh của lần kia.
    if (t.reservationId) await ReservationModel.updateOne({ _id: t.reservationId }, { $set: { updatedAt: now } }, { session });
    else if (t.contractId) await RentalContractModel.updateOne({ _id: t.contractId }, { $set: { updatedAt: now } }, { session });
    if (t.holdUntil && t.holdUntil.getTime() - now.getTime() < MIN_PAY_WINDOW_MS) {
      throw Conflict('Thời gian giữ chỗ còn quá ngắn để khách trả qua VNPAY — thu tiền mặt', 'HOLD_ENDING_SOON');
    }
    const same = await GatewayOrderModel.find({ kind: 'COUNTER', targetKey: t.targetKey, status: { $in: ['PENDING', 'PAID'] } }).sort({ _id: -1 }).session(session);
    const unused = (o: GatewayOrderHydrated) => !o.counter?.consumedAt && !o.counter?.released;
    const paid = same.find((o) => o.status === 'PAID' && unused(o) && o.amount === t.amount && (!t.customerId || !o.customerId || String(o.customerId) === String(t.customerId)));
    if (paid) return startView(paid, true);
    const live = same.find((o) => o.status === 'PENDING' && o.amount === t.amount && !!o.payUrl && o.expireAt.getTime() - now.getTime() > MIN_PAY_WINDOW_MS
      && (!t.customerId || !o.customerId || String(o.customerId) === String(t.customerId)));
    if (live) return startView(live, true);

    const _id = new Types.ObjectId();
    const txnRef = `KA${_id.toHexString()}`;
    for (const o of same.filter((x) => x.status === 'PENDING')) {
      await GatewayOrderModel.updateOne({ _id: o._id, status: 'PENDING' }, {
        $set: { status: 'SUPERSEDED', supersededBy: _id }, $push: { statusHistory: { from: 'PENDING', to: 'SUPERSEDED', at: now, reason: `Thay bằng ${txnRef}` } },
      }, { session });
    }
    const expireAt = new Date(Math.min(now.getTime() + ORDER_TTL_MS, t.holdUntil?.getTime() ?? Number.POSITIVE_INFINITY));
    const vnpCreateDate = ymdGmt7(now);
    const payUrl = env.paymentMode === 'VNPAY'
      ? buildPayUrl({ txnRef, amount: t.amount, orderInfo: `Thanh toan KhoAn ${txnRef}`, ip: start.ip, returnUrl: `${env.VNPAY_RETURN_URL}/counter`, createDate: vnpCreateDate, expireDate: ymdGmt7(expireAt) })
      : `/payment/mock?ref=${txnRef}&sig=${mockSig(txnRef)}`;
    const [order] = await GatewayOrderModel.create([{
      _id, txnRef, kind: 'COUNTER', targetKey: t.targetKey, customerId: t.customerId, facilityId: t.facilityId, reservationId: t.reservationId, contractId: t.contractId,
      amount: t.amount, status: 'PENDING', client: 'WEB', vnpCreateDate, expireAt, payUrl, clientIp: start.ip, payload: null,
      counter: { purpose: t.purpose, openedBy: user._id, consumedAt: null, consumedBy: null, consumedFor: null, released: null },
      nextCheckAt: new Date(now.getTime() + FIRST_CHECK_MS), statusHistory: [{ from: null, to: 'PENDING', at: now, by: user._id }],
    }], { session });
    await audit({ action: 'payment.counter_order', entityType: 'GatewayOrder', entityId: _id, facilityId: t.facilityId, changes: { after: { txnRef, amount: t.amount, purpose: t.purpose } } }, session);
    return startView(order, false);
  });
}

// ---------------------------------------------------------------- dùng lệnh trong thao tác thu
export interface CounterUse {
  txnRef: string; purpose: CounterPurpose; targetKey: string; facilityId: Id;
  /** Khách của thao tác — lệnh đã gắn khách khác → từ chối; lệnh chưa gắn (đặt chỗ tại quầy cho khách mới) → gắn khách này. */
  customerId: Id;
  /** Số tiền thao tác thu — phải khớp đúng số tiền khách đã trả. */
  amount: number;
  consumedFor: string;
}
const mismatch = (what: string) => Unprocessable(`Lệnh VNPAY ${what} — bấm "Thanh toán qua VNPAY" ở đúng bước này để tạo lệnh mới`, 'GATEWAY_ORDER_MISMATCH');

/**
 * Dùng lệnh VNPAY tại quầy TRONG transaction của thao tác thu. Lỗi: 404 GATEWAY_ORDER_NOT_FOUND · 422 GATEWAY_ORDER_MISMATCH (khác việc / đích / chi nhánh /
 * khách) · 409 GATEWAY_NOT_PAID (khách chưa trả xong / lệnh hỏng) · 409 GATEWAY_AMOUNT_MISMATCH (số khách đã trả ≠ số phải thu, details { orderAmount, due })
 * · 409 GATEWAY_ORDER_USED (đã dùng) · 409 GATEWAY_ORDER_RELEASED (đã trả lại khách).
 */
export async function consumeCounterOrder(staff: UserHydrated, u: CounterUse, session: ClientSession): Promise<GatewayOrderHydrated> {
  const o = await GatewayOrderModel.findOne({ txnRef: u.txnRef }).session(session);
  if (!o || o.kind !== 'COUNTER' || !o.counter) throw new AppError(404, 'GATEWAY_ORDER_NOT_FOUND', 'Không tìm thấy lệnh VNPAY tại quầy này — bấm "Thanh toán qua VNPAY" để tạo lệnh mới');
  if (String(o.facilityId) !== String(u.facilityId)) throw mismatch('thuộc chi nhánh khác');
  if (o.counter.purpose !== u.purpose || o.targetKey !== u.targetKey) throw mismatch('được tạo cho việc khác');
  if (o.customerId && String(o.customerId) !== String(u.customerId)) throw mismatch('của khách khác');
  if (o.counter.released) throw Conflict('Khoản VNPAY này đã được trả lại cho khách — tạo lệnh mới hoặc thu tiền mặt', 'GATEWAY_ORDER_RELEASED');
  if (o.counter.consumedAt) throw Conflict('Lệnh VNPAY này đã được dùng cho một lần thu khác', 'GATEWAY_ORDER_USED');
  if (o.status !== 'PAID') {
    throw Conflict(o.status === 'PENDING' ? 'Khách chưa thanh toán xong trên VNPAY — chờ màn hình báo "Đã thu qua VNPAY"' : 'Lệnh VNPAY đã thất bại / hết hạn — bấm "Tạo lại link" hoặc thu tiền mặt', 'GATEWAY_NOT_PAID');
  }
  if (o.amount !== u.amount) {
    throw new AppError(409, 'GATEWAY_AMOUNT_MISMATCH', `Khách đã trả ${vnd(o.amount)} qua VNPAY nhưng số phải thu bây giờ là ${vnd(u.amount)} — khoản đã trả nằm trong hàng "VNPAY tại quầy chưa ghi nhận" để quản lý trả lại; tạo lệnh mới đúng số tiền`, { orderAmount: o.amount, due: u.amount });
  }
  const used = await GatewayOrderModel.findOneAndUpdate(
    { _id: o._id, status: 'PAID', 'counter.consumedAt': null, 'counter.released': null, ...(o.customerId ? {} : { customerId: null }) },
    { $set: { 'counter.consumedAt': new Date(), 'counter.consumedBy': staff._id, 'counter.consumedFor': u.consumedFor.slice(0, 200), ...(o.customerId ? {} : { customerId: u.customerId }) } },
    { new: true, session },
  );
  if (!used) throw Conflict('Lệnh VNPAY này đã được dùng cho một lần thu khác', 'GATEWAY_ORDER_USED');
  return used;
}

/** Ghi các dòng sổ vừa thu vào lệnh (để xem lại / in biên lai). Gọi trong cùng transaction sau khi ghi sổ. */
export async function linkCounterPayments(order: GatewayOrderHydrated, paymentIds: Types.ObjectId[], session: ClientSession) {
  await GatewayOrderModel.updateOne({ _id: order._id }, { $set: { paymentIds } }, { session });
}

/**
 * Cách thu của một thao tác tại quầy: tiền mặt, hoặc VNPAY đã dùng lệnh. `row()` → các trường của MỘT dòng sổ mới (người thu + provider lệnh, số thứ tự dòng
 * tăng dần để provider.txnRef không trùng); `provider()` → provider cho dòng PENDING được chuyển sang đã thu.
 */
export class CounterCollect {
  private seq = 0;
  constructor(readonly method: 'CASH' | 'VNPAY', readonly staffId: Types.ObjectId, readonly order: GatewayOrderHydrated | null) {}
  row() {
    this.seq += 1;
    return { method: this.method, recordedBy: this.staffId, createdBy: this.staffId, ...(this.order ? { gateway: gatewayProvider(this.order, this.seq) } : {}) };
  }
  provider() {
    this.seq += 1;
    return this.order ? gatewayProvider(this.order, this.seq) : null;
  }
  /** Ghi vào audit thay cho txnRef gõ tay trước đây. */
  get ref() { return this.order?.txnRef ?? null; }
}

/** Chỉ tiền mặt hoặc VNPAY (kèm lệnh) — chặn mọi hình thức cũ (chuyển khoản / thẻ / VNPAY gõ tay) ở thao tác thu MỚI tại quầy. */
export function assertCounterMethod(method: string | undefined, gatewayTxnRef?: string | null): asserts method is 'CASH' | 'VNPAY' {
  if (method !== 'CASH' && method !== 'VNPAY') throw Unprocessable('Thu tại quầy chỉ nhận tiền mặt hoặc VNPAY', 'METHOD_NOT_AVAILABLE');
  if (method === 'VNPAY' && !gatewayTxnRef) throw Unprocessable('Thu VNPAY tại quầy: bấm "Thanh toán qua VNPAY", chờ khách trả xong rồi mới xác nhận', 'GATEWAY_TXN_REF_REQUIRED');
}

// ---------------------------------------------------------------- hàng "VNPAY tại quầy đã thu, chưa ghi nhận"
const unusedPaid = { kind: 'COUNTER', status: 'PAID', 'counter.consumedAt': null, 'counter.released': null } as const;

/** GET /payments/counter-orders — nhân sự chi nhánh (OPS: mọi chi nhánh, lọc được). Mới nhất trước. */
export async function listUnusedCounterOrders(user: UserHydrated, facilityId?: string): Promise<CounterOrderRow[]> {
  const scope = user.role === 'OPS_MANAGER' ? (facilityId ? { facilityId } : {}) : { facilityId: facilityId && user.facilityIds.some((f) => String(f) === facilityId) ? facilityId : { $in: user.facilityIds } };
  const rows = await GatewayOrderModel.find({ ...unusedPaid, ...scope }).sort({ 'gateway.confirmedAt': -1 }).limit(100).lean();
  const ids = (k: 'reservationId' | 'contractId' | 'customerId') => [...new Set(rows.map((o) => o[k]).filter(Boolean).map(String))];
  const staffIds = [...new Set(rows.map((o) => o.counter?.openedBy).filter(Boolean).map(String))];
  const [rs, cs, us] = await Promise.all([
    ReservationModel.find({ _id: { $in: ids('reservationId') } }, { code: 1 }).lean(),
    RentalContractModel.find({ _id: { $in: ids('contractId') } }, { contractNumber: 1 }).lean(),
    UserModel.find({ _id: { $in: [...ids('customerId'), ...staffIds] } }, { fullName: 1 }).lean(),
  ]);
  const name = (id: unknown) => us.find((x) => String(x._id) === String(id))?.fullName ?? null;
  return rows.map((o) => {
    const code = rs.find((x) => String(x._id) === String(o.reservationId))?.code ?? cs.find((x) => String(x._id) === String(o.contractId))?.contractNumber ?? null;
    return {
      txnRef: o.txnRef, amount: o.amount, purpose: o.counter!.purpose, facilityId: String(o.facilityId), customerId: o.customerId ? String(o.customerId) : null,
      reservationId: o.reservationId ? String(o.reservationId) : null, contractId: o.contractId ? String(o.contractId) : null,
      openedBy: o.counter?.openedBy ? String(o.counter.openedBy) : null, openedByName: name(o.counter?.openedBy),
      createdAt: (o.createdAt as Date).toISOString(), paidAt: iso(o.gateway?.confirmedAt), transactionNo: o.gateway?.transactionNo ?? null,
      label: [COUNTER_PURPOSE[o.counter!.purpose], code, name(o.customerId) ?? (o.customerId ? null : 'khách mới (chưa tạo tài khoản)')].filter(Boolean).join(' · '),
      refundable: !!o.customerId && !!(o.reservationId || o.contractId),
    };
  });
}

/**
 * POST /payments/counter-orders/:txnRef/release (Quản lý chi nhánh / vận hành) — trả lại khách khoản VNPAY tại quầy đã thu mà không thao tác nào dùng.
 * Lệnh → PAID_UNAPPLIED. Có khách + đặt chỗ / hợp đồng: ghi sổ GATEWAY_UNAPPLIED (đã hoàn, không phải doanh thu) + khoản HOÀN chuyển khoản PENDING (người khác
 * xác nhận đã chuyển — confirm-payout, SAME_APPROVER). Không có (đặt chỗ tại quầy cho khách mới bị bỏ dở): chỉ ghi chú cách đã hoàn ngoài hệ thống.
 */
export async function releaseCounterOrder(user: UserHydrated, txnRef: string, note: string) {
  const out = await withTxn(async (session) => {
    const o = await GatewayOrderModel.findOne({ txnRef }).session(session);
    if (!o || o.kind !== 'COUNTER' || !o.counter) throw NotFound('lệnh VNPAY tại quầy');
    await assertFacility(user, o.facilityId, 'payment.counter_release');
    if (o.status !== 'PAID' || o.counter.consumedAt || o.counter.released) throw Conflict('Chỉ trả lại khoản VNPAY tại quầy đã thu mà chưa được dùng', 'NOT_RELEASABLE');
    const now = new Date();
    const claimed = await GatewayOrderModel.findOneAndUpdate({ _id: o._id, ...unusedPaid }, {
      $set: { status: 'PAID_UNAPPLIED', unapplied: { code: 'COUNTER_RELEASED', message: note, at: now }, 'counter.released': { at: now, by: user._id, note, refundPaymentId: null } },
      $push: { statusHistory: { from: 'PAID', to: 'PAID_UNAPPLIED', at: now, by: user._id, reason: note.slice(0, 200) } },
    }, { new: true, session });
    if (!claimed) throw Conflict('Khoản này vừa được dùng hoặc đã trả lại', 'NOT_RELEASABLE');
    let refundId: Types.ObjectId | null = null;
    if (o.customerId && (o.reservationId || o.contractId)) {
      const refs = { facilityId: o.facilityId, customerId: o.customerId, contractId: o.contractId ?? null, reservationId: o.reservationId ?? null };
      const row = await createPayment({ ...refs, type: 'GATEWAY_UNAPPLIED', amount: o.amount, status: 'SUCCEEDED', method: 'VNPAY', recordedBy: o.counter.openedBy, createdBy: o.counter.openedBy, gateway: gatewayProvider(o, 1), idempotencyKey: `counter-unapplied-${o._id}` }, session);
      // Thu tại quầy hoàn bằng chuyển khoản (như refundMethodFor với khoản có người thu) — PENDING tới khi người khác xác nhận đã chuyển.
      const refund = await createPayment({ ...refs, type: 'REFUND', amount: o.amount, status: 'SUCCEEDED', method: 'BANK_TRANSFER', refundOf: row._id, createdBy: user._id, idempotencyKey: `counter-release-${o._id}` }, session);
      row.refundedAmount = o.amount;
      row.transitionTo('REFUNDED', { actor: 'SYSTEM', by: user._id, reason: 'Trả lại khoản VNPAY tại quầy chưa dùng' });
      await row.save({ session });
      refundId = refund._id;
      await GatewayOrderModel.updateOne({ _id: o._id }, { $set: { paymentIds: [row._id], 'counter.released.refundPaymentId': refund._id } }, { session });
    }
    await audit({ action: 'payment.counter_release', entityType: 'GatewayOrder', entityId: o._id, facilityId: o.facilityId, reason: note, changes: { after: { txnRef, amount: o.amount, purpose: o.counter.purpose, refundPaymentId: refundId ? String(refundId) : null } } }, session);
    return { txnRef, amount: o.amount, refundPaymentId: refundId ? String(refundId) : null };
  });
  return out;
}

/** Trang giả lập: số tiền + việc + chi nhánh của lệnh (không lộ khách). */
export async function mockOrderInfo(txnRef: string, sig: string) {
  if (env.paymentMode !== 'MOCK') throw NotFound('giao dịch');
  assertMockSig(txnRef, sig);
  const o = await GatewayOrderModel.findOne({ txnRef, kind: 'COUNTER' }).lean();
  if (!o) throw NotFound('giao dịch');
  const f = await FacilityModel.findById(o.facilityId, { name: 1 }).lean();
  return {
    txnRef, amount: o.amount, purpose: o.counter!.purpose, purposeLabel: COUNTER_PURPOSE[o.counter!.purpose], facility: f?.name ?? '', status: o.status,
    expiresAt: o.expireAt.toISOString(), transactionNo: o.gateway?.transactionNo ?? null,
  };
}
