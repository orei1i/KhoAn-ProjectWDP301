import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { ACCESS_REQUEST_MACHINE, AccessMethod, AccessRequestStatus, AccessRequestType, enumValues, type AccessRequest } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin } from '../../shared/db/plugins';
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
  decidedBy: refOpt('User'),
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: null, maxlength: 500 },
  completedAt: { type: Date, default: null },
  completedBy: refOpt('User'),
  newKeyTag: { type: String, default: null, maxlength: 40 },
  cancelReason: { type: String, default: null, maxlength: 500 },
  statusHistory: { type: [statusHistorySchema(enumValues(AccessRequestStatus))], default: [], validate: maxLen(10) },
}, { ...baseOptions, collection: 'accessRequests', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
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
