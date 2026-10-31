import { Types, type ClientSession } from 'mongoose';
import type { GatewayOrderKind, GatewayStart } from '@ssm/shared';
import { GatewayOrderModel, RentalContractModel, ReservationModel, TicketModel, type GatewayOrderHydrated } from '../../shared/db/models';
import { AppError, Conflict } from '../../shared/core/errors';
import { env } from '../../shared/config/env';
import { withTxn } from '../../shared/db/txn';
import { notifyStaff } from '../notify/staff-notify';
import { buildPayUrl, ymdGmt7 } from './vnpay.client';

/**
 * Đợt VNPAY — mở lệnh thu. Domain service (đặt chỗ, hợp đồng, dịch vụ, thẻ) import file này; file này không import domain để tránh vòng.
 * Đường ghi nhận kết quả nằm ở gateway-settle.service, chỉ route và job import file đó.
 */
type Id = Types.ObjectId | string;

/** Sau expireAt còn chờ IPN / QueryDr thêm bao lâu trước khi coi là hết hạn. Job huỷ giữ chỗ cũng chờ đúng khoảng này. */
export const SETTLE_GRACE_MS = 10 * 60_000;
/** Còn dưới mức này thì không đưa khách sang cổng (không đủ thời gian trả), order cũ cũng không dùng lại. */
export const MIN_PAY_WINDOW_MS = 3 * 60_000;
const ORDER_TTL_MS = 15 * 60_000;
const FIRST_CHECK_MS = 5 * 60_000;

/** Khách trả online ở chế độ VNPAY: đi qua cổng. Nhân viên thu tại quầy và chế độ MOCK không bao giờ vào nhánh này. */
export const isGatewayFlow = (user: { role: string }) => user.role === 'CUSTOMER' && env.paymentMode === 'VNPAY';

export interface GatewayStartCtx { ip: string; client: 'WEB' | 'APP' }
export interface AppliedResult {
  paymentIds: Types.ObjectId[];
  result: { serviceOrderId?: Types.ObjectId; accessRequestId?: Types.ObjectId; newEndDate?: Date } | null;
}
export interface PayRun {
  order: GatewayOrderHydrated;
  session: ClientSession;
  /** Việc chạy SAU commit (email). withTxn có thể chạy lại callback nên settle xoá mảng mỗi lần chạy. */
  after: (() => Promise<unknown>)[];
  /** Hàm service ghi kết quả ở đây; phản hồi của hàm giữ nguyên hình dạng như chế độ MOCK. */
  applied?: AppliedResult;
}
/** Tham số cuối của 5 hàm thanh toán: `start` = lần chạy đầu từ route; `run` = lần áp từ settle, trong transaction của settle. */
export interface PayCtx { start?: GatewayStartCtx; run?: PayRun }

export const inTxnOf = (gw: PayCtx) => (gw.run
  ? <T>(fn: (s: ClientSession) => Promise<T>) => fn(gw.run!.session)
  : withTxn);

/** provider của dòng sổ thu qua cổng. Một lần trả có thể ghi nhiều dòng nên txnRef từng dòng có hậu tố; mã thật giữ ở order. */
export const gatewayProvider = (o: GatewayOrderHydrated, seq: number) => ({
  name: 'VNPAY', txnRef: `${o.txnRef}-${seq}`, orderId: o._id, transactionNo: o.gateway?.transactionNo ?? null, rawStatus: '00',
});
export type GatewayRowProvider = { name: string; txnRef: string | null; orderId: Types.ObjectId; transactionNo?: string | null; rawStatus: string };

/** IP khách cho vnp_IpAddr, lấy từ `req.ip` đã qua trust proxy. Rỗng thì 127.0.0.1. */
export const clientIpOf = (ip: string | undefined) => (ip ?? '').replace(/^::ffff:/, '') || '127.0.0.1';

/** Ngữ cảnh lần chạy đầu: app gửi header `x-client: app`, thiếu là WEB. */
export const gatewayStart = (req: { ip?: string; header(name: string): string | undefined }): GatewayStartCtx => ({
  ip: clientIpOf(req.ip), client: req.header('x-client')?.trim().toLowerCase() === 'app' ? 'APP' : 'WEB',
});

/** Ý định của khách, không tính khoá chống trùng và dấu vết xác nhận (hai lần bấm có thể khác hai trường đó). */
const intentOf = (payload: unknown) => {
  const { idempotencyKey: _k, acceptance: _a, ...rest } = JSON.parse(JSON.stringify(payload ?? {})) as Record<string, unknown>;
  return JSON.stringify(rest);
};

export interface OpenOrderInput {
  kind: GatewayOrderKind; targetKey: string; facilityId: Id; customerId: Id; reservationId?: Id | null; contractId?: Id | null;
  amount: number; payload: Record<string, unknown>; holdUntil?: Date | null;
}

/**
 * Mở (hoặc dùng lại) lệnh thu, trong transaction của lần chạy đầu. Ghi chạm target trước: hai lần bấm song song xung đột ghi, bên chạy lại thấy order
 * của bên kia. Order cùng số tiền, cùng ý định, còn trên 3 phút thì dùng lại; ngược lại order cũ thành SUPERSEDED (vẫn nhận được thành công muộn).
 */
export async function openGatewayOrder(i: OpenOrderInput, start: GatewayStartCtx | undefined, session: ClientSession): Promise<GatewayStart> {
  const now = new Date();
  const client = start ?? { ip: '127.0.0.1', client: 'WEB' as const };
  if (i.kind === 'DEPOSIT') await ReservationModel.updateOne({ _id: i.reservationId }, { $set: { updatedAt: now } }, { session });
  else await RentalContractModel.updateOne({ _id: i.contractId }, { $set: { updatedAt: now } }, { session });

  if (i.holdUntil && i.holdUntil.getTime() - now.getTime() < MIN_PAY_WINDOW_MS) {
    throw Conflict('Thời gian giữ chỗ còn quá ngắn để thanh toán online — đặt lại hoặc đến quầy chi nhánh', 'HOLD_ENDING_SOON');
  }

  const open = await GatewayOrderModel.find({ customerId: i.customerId, targetKey: i.targetKey, status: 'PENDING' }).session(session);
  const reusable = open.find((o) => o.amount === i.amount && o.expireAt.getTime() - now.getTime() > MIN_PAY_WINDOW_MS && !!o.payUrl && intentOf(o.payload) === intentOf(i.payload));
  if (reusable) {
    return { gateway: { orderId: String(reusable._id), txnRef: reusable.txnRef, payUrl: reusable.payUrl!, amount: reusable.amount, expiresAt: reusable.expireAt.toISOString(), kind: reusable.kind, reused: true } };
  }

  const _id = new Types.ObjectId();
  const txnRef = `KA${_id.toHexString()}`;
  for (const o of open) {
    await GatewayOrderModel.updateOne({ _id: o._id, status: 'PENDING' }, {
      $set: { status: 'SUPERSEDED', supersededBy: _id }, $push: { statusHistory: { from: 'PENDING', to: 'SUPERSEDED', at: now, reason: `Thay bằng ${txnRef}` } },
    }, { session });
  }
  // Order đã thất bại / hết hạn của cùng target cũng nối vào chuỗi: tiền về muộn cho order đó sau khi order mới đã trả thì được nhận ra là trùng.
  await GatewayOrderModel.updateMany({ customerId: i.customerId, targetKey: i.targetKey, status: { $in: ['FAILED', 'EXPIRED'] }, supersededBy: null }, { $set: { supersededBy: _id } }, { session });

  const expireAt = new Date(Math.min(now.getTime() + ORDER_TTL_MS, i.holdUntil?.getTime() ?? Number.POSITIVE_INFINITY));
  const vnpCreateDate = ymdGmt7(now);
  const payUrl = buildPayUrl({
    txnRef, amount: i.amount, orderInfo: `Thanh toan KhoAn ${txnRef}`, ip: client.ip,
    returnUrl: `${env.VNPAY_RETURN_URL}${client.client === 'APP' ? '/app' : ''}`, createDate: vnpCreateDate, expireDate: ymdGmt7(expireAt),
  });
  const [order] = await GatewayOrderModel.create([{
    _id, txnRef, kind: i.kind, targetKey: i.targetKey, customerId: i.customerId, facilityId: i.facilityId, reservationId: i.reservationId ?? null, contractId: i.contractId ?? null,
    amount: i.amount, status: 'PENDING', client: client.client, vnpCreateDate, expireAt, payUrl, clientIp: client.ip, payload: i.payload,
    nextCheckAt: new Date(now.getTime() + FIRST_CHECK_MS), statusHistory: [{ from: null, to: 'PENDING', at: now }],
  }], { session });
  return { gateway: { orderId: String(order._id), txnRef, payUrl, amount: order.amount, expiresAt: expireAt.toISOString(), kind: i.kind, reused: false } };
}

/** Việc khẩn nội bộ cho chi nhánh, không chứa dữ liệu cá nhân. Khách không thấy (bootstrap và /tickets của khách chỉ trả CUSTOMER_ISSUE). */
export async function urgentGatewayTask(o: { facilityId: Id; customerId: Id; contractId?: Id | null }, subject: string, description: string) {
  const now = new Date();
  await TicketModel.create([{
    kind: 'OPS_TASK', facilityId: o.facilityId, reporterId: o.customerId, contractId: o.contractId ?? null, category: 'BILLING', priority: 'URGENT', status: 'OPEN',
    subject, description, dueAt: new Date(now.getTime() + 24 * 3_600_000), messages: [], statusHistory: [{ from: null, to: 'OPEN', at: now, by: null, reason: 'Hệ thống' }],
  }]);
  void notifyStaff({ roles: ['FACILITY_MANAGER'], facilityId: o.facilityId }, `KhoAn — ${subject}`, [description]).catch((e) => console.error('[gateway-task]', e instanceof Error ? e.message : e));
}

export const purgedPayload = () => new AppError(409, 'PAYLOAD_PURGED', 'Giao dịch đã quá lâu, hệ thống không còn thông tin để thực hiện — tiền sẽ được hoàn lại');
