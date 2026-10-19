import { Schema, model } from 'mongoose';
import { TEMPLATE_LIMITS, type ContractTemplate } from '@ssm/shared';
import { baseOptions, refOpt, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin } from '../../shared/db/plugins';

export type ContractTemplateDoc = ContractTemplate<OID, Date>;

const line = { type: String, maxlength: TEMPLATE_LIMITS.lineMax };

/**
 * Mẫu hợp đồng do Quản lý vận hành phát hành. BẤT BIẾN và có phiên bản như chính sách: sửa = phát hành bản mới, bản cũ
 * chuyển sang không dùng. Hợp đồng đã ký không trỏ về đây mà lưu nguyên văn lúc ký (reservation.signature.clauses).
 */
const schema = new Schema<ContractTemplateDoc>({
  scope: { type: String, enum: ['GLOBAL', 'FACILITY'], required: true, immutable: true },
  facilityId: { ...refOpt('Facility'), immutable: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  isActive: { type: Boolean, default: true },
  clauses: {
    type: [new Schema({
      key: { type: String, required: true, maxlength: 40 },
      title: { type: String, required: true, maxlength: TEMPLATE_LIMITS.titleMax },
      numbered: { type: Boolean, default: true },
      paragraphs: { type: [line], default: [] },
      bullets: { type: [line], default: [] },
    }, subOptions)],
    required: true, immutable: true,
  },
  note: { type: String, default: null, maxlength: 500 },
  effectiveFrom: { type: Date, required: true },
}, { ...baseOptions, collection: 'contractTemplates' });

schema.plugin(actorStampPlugin);

schema.pre('validate', function () {
  if ((this.scope === 'FACILITY') !== !!this.facilityId) this.invalidate('facilityId', 'FACILITY scope <-> facilityId');
});

schema.index({ scope: 1, facilityId: 1, version: -1 }, { unique: true });
schema.index({ scope: 1, facilityId: 1, isActive: 1 });

export const ContractTemplateModel = model<ContractTemplateDoc>('ContractTemplate', schema);
