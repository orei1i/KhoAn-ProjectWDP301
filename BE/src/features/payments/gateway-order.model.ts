import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { enumValues, GatewayOrderKind, GatewayOrderStatus, type GatewayOrder } from '@ssm/shared';
import { baseOptions, enumOf, maxLen, money, ObjectId, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin, historyCapPlugin } from '../../shared/db/plugins';

export type GatewayOrderDoc = GatewayOrder<OID, Date>;
export type GatewayOrderModelType = Model<GatewayOrderDoc>;
export type GatewayOrderHydrated = HydratedDocument<GatewayOrderDoc>;

/**
 * Đợt VNPAY — một lần khách sang cổng trả tiền. Không dùng PaymentTransaction PENDING làm khoản chờ vì payBalance và overdueFrom quét mọi khoản
 * CHARGE PENDING của hợp đồng. Trạng thái chỉ đổi bằng CAS findOneAndUpdate, trong cùng transaction với hiệu ứng (gateway-settle.service).
 * Dữ liệu cá nhân (payload, payUrl, clientIp) bị xoá 7 ngày sau khi kết thúc và khi ẩn danh hoá khách.
 */
const schema = new Schema<GatewayOrderDoc, GatewayOrderModelType>({
  provider: { type: String, enum: ['VNPAY'], default: 'VNPAY', immutable: true },
  txnRef: { type: String, required: true, immutable: true, maxlength: 40 },
  kind: { ...enumOf(enumValues(GatewayOrderKind)), immutable: true },
  targetKey: { type: String, required: true, immutable: true, maxlength: 120 },
  customerId: { ...refReq('User'), immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  reservationId: { ...refOpt('Reservation'), immutable: true },
  contractId: { ...refOpt('RentalContract'), immutable: true },
  amount: { ...money(), immutable: true },
  status: enumOf(enumValues(GatewayOrderStatus), 'PENDING'),
  client: { type: String, enum: ['WEB', 'APP'], default: 'WEB', immutable: true },
  vnpCreateDate: { type: String, required: true, immutable: true },
  expireAt: { type: Date, required: true },
  payUrl: { type: String, default: null },
  clientIp: { type: String, default: null },
  payload: { type: Schema.Types.Mixed, default: null },
  supersededBy: refOpt('GatewayOrder'),
  gateway: {
    type: new Schema({
      transactionNo: { type: String, default: null }, bankCode: { type: String, default: null }, cardType: { type: String, default: null }, payDate: { type: String, default: null },
      responseCode: { type: String, default: null }, transactionStatus: { type: String, default: null }, source: { type: String, enum: ['IPN', 'QUERYDR'], required: true }, confirmedAt: { type: Date, default: null },
    }, subOptions),
    default: null,
  },
  paymentIds: { type: [{ type: ObjectId, ref: 'PaymentTransaction' }], default: [] },
  result: { type: new Schema({ serviceOrderId: refOpt('ServiceOrder'), accessRequestId: refOpt('AccessRequest'), newEndDate: { type: Date, default: null } }, subOptions), default: null },
  unapplied: { type: new Schema({ code: { type: String, required: true }, message: { type: String, required: true, maxlength: 1000 }, at: { type: Date, required: true } }, subOptions), default: null },
  refundedAmount: money(false),
  lastCheckedAt: { type: Date, default: null },
  nextCheckAt: { type: Date, required: true },
  checkAttempts: { type: Number, default: 0 },
  applyFailures: { type: Number, default: 0 },
  amountMismatchAt: { type: Date, default: null },
  // QueryDr / IPN báo giao dịch đảo hoặc nghi gian lận: giữ PENDING, đã tạo việc khẩn một lần.
  reviewFlaggedAt: { type: Date, default: null },
  statusHistory: { type: [statusHistorySchema(enumValues(GatewayOrderStatus))], default: [], validate: maxLen(20) },
}, { ...baseOptions, collection: 'gatewayOrders' });

schema.plugin(actorStampPlugin);
schema.plugin(historyCapPlugin, { statusHistory: 20 });
schema.plugin(appendOnlyPlugin, { allowUpdates: true });

// Độ đúng không dựa vào các index này (production không tự đồng bộ): txnRef duy nhất do suy từ _id, chống trùng order bằng ghi chạm target.
schema.index({ txnRef: 1 }, { unique: true });
schema.index({ status: 1, nextCheckAt: 1 });
schema.index({ customerId: 1, targetKey: 1, status: 1 });
schema.index({ reservationId: 1, status: 1 });
schema.index({ contractId: 1, status: 1 });

export const GatewayOrderModel = model<GatewayOrderDoc, GatewayOrderModelType>('GatewayOrder', schema);
