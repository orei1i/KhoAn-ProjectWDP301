import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { enumValues, SERVICE_ORDER_MACHINE, ServiceOrderStatus, type ServiceOrder } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin, historyCapPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type ServiceOrderDoc = ServiceOrder<OID, Date>;
interface Methods { transitionTo(to: ServiceOrderStatus, ctx: TransitionCtx): void }
export type ServiceOrderModelType = Model<ServiceOrderDoc, {}, Methods>;
export type ServiceOrderHydrated = HydratedDocument<ServiceOrderDoc, Methods>;

const schema = new Schema<ServiceOrderDoc, ServiceOrderModelType, Methods>({
  orderNumber: { type: String, required: true, immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  // Đặt sau khi thuê: gắn hợp đồng ngay. Chọn KÈM lúc đặt kho: gắn đặt chỗ (reservationId), tới khi nhận kho mới gắn hợp đồng.
  contractId: refOpt('RentalContract'),
  reservationId: { ...refOpt('Reservation'), immutable: true },
  serviceId: { ...refReq('ServiceOffering'), immutable: true },
  // Chốt tên/giá lúc đặt — đổi danh mục sau này không làm lệch đơn đã thanh toán.
  serviceName: { type: String, required: true, immutable: true },
  unitPrice: { ...money(), immutable: true },
  unitLabel: { type: String, required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, max: 99, validate: Number.isInteger, immutable: true },
  total: { ...money(), immutable: true },
  preferredDate: { type: Date, default: null },
  note: { type: String, maxlength: 500 },
  status: enumOf(enumValues(ServiceOrderStatus), 'REQUESTED'),
  paymentId: refOpt('PaymentTransaction'),
  refundPaymentId: refOpt('PaymentTransaction'),
  // Đợt 16 (C4): huỷ do trả kho / xử lý hàng bỏ lại → tiền hoàn đi vào quyết toán (cấn nợ trước, còn lại mới chi).
  refundAtSettlement: { type: Boolean, default: false },
  // Đợt 16 (C6): Idempotency-Key lúc đặt — gửi lại cùng khoá trả đúng đơn đã tạo (kiểm trong transaction, không dựa vào chỉ mục).
  idempotencyKey: { type: String, default: null, maxlength: 100 },
  completedAt: { type: Date, default: null },
  completedBy: refOpt('User'),
  cancelReason: { type: String, default: null, maxlength: 500 },
  statusHistory: { type: [statusHistorySchema(enumValues(ServiceOrderStatus))], default: [], validate: maxLen(10) },
}, { ...baseOptions, collection: 'serviceOrders', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(historyCapPlugin, { statusHistory: 10 }); // đầy thì giữ 10 mục mới nhất, không làm hỏng lệnh lưu
schema.plugin(appendOnlyPlugin, { allowUpdates: true }); // hồ sơ tài chính: cập nhật được, xoá thì không

schema.method('transitionTo', function (to: ServiceOrderStatus, ctx: TransitionCtx) {
  applyTransition('ServiceOrder', this, SERVICE_ORDER_MACHINE, to, ctx);
});

schema.pre('validate', function () {
  if (this.isNew && !this.orderNumber) this.orderNumber = humanCode('SVC');
  if (this.isNew && this.statusHistory.length === 0) this.statusHistory.push({ from: null, to: this.status, at: new Date() });
  if (this.total !== this.unitPrice * this.quantity) this.invalidate('total', 'phải bằng đơn giá × số lượng');
  if (this.status === 'DONE' && !this.completedAt) this.invalidate('completedAt', 'required when DONE');
  if (!this.contractId && !this.reservationId) this.invalidate('contractId', 'cần hợp đồng hoặc đặt chỗ');
});

schema.index({ orderNumber: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, createdAt: -1 });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ contractId: 1, createdAt: -1 });
schema.index({ reservationId: 1 }, { partialFilterExpression: { reservationId: { $type: 'objectId' } } });

export const ServiceOrderModel = model<ServiceOrderDoc, ServiceOrderModelType>('ServiceOrder', schema);
