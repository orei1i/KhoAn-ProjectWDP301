import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { enumValues, PrivacyRequestStatus, PrivacyRequestType, type PrivacyRequest } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, refOpt, refReq, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin } from '../../shared/db/plugins';

/**
 * Yêu cầu thực hiện quyền của chủ thể dữ liệu (Nghị định 13/2023/NĐ-CP): xem / nhận bản sao, chỉnh sửa, xoá, rút lại đồng ý, phản đối.
 * Khách gửi trong tài khoản (kể cả khi không còn hợp đồng nào); Quản trị viên xử lý và trả lời trước `dueAt` (72 giờ).
 */
export type PrivacyRequestDoc = PrivacyRequest<OID, Date>;
export type PrivacyRequestModelType = Model<PrivacyRequestDoc>;
export type PrivacyRequestHydrated = HydratedDocument<PrivacyRequestDoc>;

const schema = new Schema<PrivacyRequestDoc, PrivacyRequestModelType>({
  requestNumber: { type: String, required: true, immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  type: { ...enumOf(enumValues(PrivacyRequestType)), immutable: true },
  note: { type: String, default: null, maxlength: 2000 },
  status: enumOf(enumValues(PrivacyRequestStatus), 'OPEN'),
  dueAt: { type: Date, required: true },
  response: { type: String, default: null, maxlength: 2000 },
  handledBy: refOpt('User'),
  handledAt: { type: Date, default: null },
}, { ...baseOptions, collection: 'privacyRequests' });

schema.plugin(actorStampPlugin);
schema.pre('validate', function () {
  if (this.isNew && !this.requestNumber) this.requestNumber = humanCode('PRV');
  if (this.status !== 'OPEN' && !this.handledAt) this.invalidate('handledAt', 'required once handled');
});
schema.index({ requestNumber: 1 }, { unique: true });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ status: 1, dueAt: 1 });

export const PrivacyRequestModel = model<PrivacyRequestDoc, PrivacyRequestModelType>('PrivacyRequest', schema);
