import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { ACCESS_REQUEST_MACHINE, AccessMethod, AccessRequestStatus, AccessRequestType, enumValues, type AccessRequest } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin, historyCapPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type AccessRequestDoc = AccessRequest<OID, Date>;
interface Methods { transitionTo(to: AccessRequestStatus, ctx: TransitionCtx): void }
export type AccessRequestModelType = Model<AccessRequestDoc, {}, Methods>;
export type AccessRequestHydrated = HydratedDocument<AccessRequestDoc, Methods>;

const schema = new Schema<AccessRequestDoc, AccessRequestModelType, Methods>({
  requestNumber: { type: String, required: true, immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  contractId: { ...refReq('RentalContract'), immutable: true },
  unitId: { ...refReq('StorageUnit'), immutable: true },
  type: { ...enumOf(enumValues(AccessRequestType)), immutable: true },
  accessMethod: { ...enumOf(enumValues(AccessMethod)), immutable: true },
  reason: { type: String, maxlength: 300 },
  // Chốt phí lúc gửi — đổi chính sách sau đó không làm lệch yêu cầu đã thanh toán.
  fee: { ...money(), immutable: true },
  status: enumOf(enumValues(AccessRequestStatus), 'REQUESTED'),
  paymentId: refOpt('PaymentTransaction'),
  refundPaymentId: refOpt('PaymentTransaction'),
  // Đợt 16 (C4): huỷ do trả kho / xử lý hàng bỏ lại → phí hoàn đi vào quyết toán (cấn nợ trước, còn lại mới chi).
  refundAtSettlement: { type: Boolean, default: false },
  // Đợt 16 (C6): Idempotency-Key lúc gửi — gửi lại cùng khoá trả đúng yêu cầu đã tạo (kiểm trong transaction).
  idempotencyKey: { type: String, default: null, maxlength: 100 },
  decidedBy: refOpt('User'),
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: null, maxlength: 500 },
  completedAt: { type: Date, default: null },
  completedBy: refOpt('User'),
  newKeyTag: { type: String, default: null, maxlength: 40 },
  // Người nhận thẻ / chìa mới tại quầy (đã đối chiếu giấy tờ bản gốc với hồ sơ) — chỉ lưu loại giấy tờ, không lưu số.
  handedTo: {
    type: new Schema({
      presenter: { type: String, enum: ['CUSTOMER', 'AUTHORIZED'], required: true }, name: { type: String, required: true, maxlength: 120 },
      idType: { type: String, enum: ['CCCD', 'PASSPORT'], required: true }, authorizedPersonId: { type: String, default: null, maxlength: 60 },
    }, subOptions),
    default: null,
  },
  cancelReason: { type: String, default: null, maxlength: 500 },
  // Đợt 16 (B2): báo mất — số thẻ / mã chìa cũ, việc "Vô hiệu thẻ …" (phiếu OPS_TASK), ai xác nhận đã khoá thẻ cũ, lúc nào.
  oldKeyTag: { type: String, default: null, maxlength: 50 },
  blockTaskId: refOpt('SupportTicket'),
  oldBlockedAt: { type: Date, default: null },
  oldBlockedBy: refOpt('User'),
  oldBlockedByName: { type: String, default: null, maxlength: 100 },
  statusHistory: { type: [statusHistorySchema(enumValues(AccessRequestStatus))], default: [], validate: maxLen(10) },
}, { ...baseOptions, collection: 'accessRequests', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(historyCapPlugin, { statusHistory: 10 }); // đầy thì giữ 10 mục mới nhất, không làm hỏng lệnh lưu
schema.plugin(appendOnlyPlugin, { allowUpdates: true }); // hồ sơ có tiền: cập nhật được, xoá thì không

schema.method('transitionTo', function (to: AccessRequestStatus, ctx: TransitionCtx) {
  applyTransition('AccessRequest', this, ACCESS_REQUEST_MACHINE, to, ctx);
});

schema.pre('validate', function () {
  if (this.isNew && !this.requestNumber) this.requestNumber = humanCode('ACC');
  if (this.isNew && this.statusHistory.length === 0) this.statusHistory.push({ from: null, to: this.status, at: new Date() });
  if (this.status === 'DONE' && !this.completedAt) this.invalidate('completedAt', 'required when DONE');
  if (this.status === 'REJECTED' && !this.decisionNote) this.invalidate('decisionNote', 'required when REJECTED');
});

schema.index({ requestNumber: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, createdAt: -1 });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ contractId: 1, status: 1 });

export const AccessRequestModel = model<AccessRequestDoc, AccessRequestModelType>('AccessRequest', schema);
