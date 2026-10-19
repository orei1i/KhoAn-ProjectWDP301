import { Schema, model } from 'mongoose';
import type { ServiceOffering } from '@ssm/shared';
import { baseOptions, money, refReq, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, softDeletePlugin } from '../../shared/db/plugins';

export type ServiceOfferingDoc = ServiceOffering<OID, Date>;

/** Danh mục dịch vụ thêm của MỘT chi nhánh — mỗi chi nhánh tự đặt giá (Quản lý vận hành thiết lập). */
const schema = new Schema<ServiceOfferingDoc>({
  facilityId: { ...refReq('Facility'), immutable: true },
  code: { type: String, required: true, uppercase: true, trim: true, maxlength: 30, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, maxlength: 1000 },
  price: money(),
  unitLabel: { type: String, required: true, trim: true, maxlength: 20, default: 'lần' },
  isActive: { type: Boolean, default: true },
}, { ...baseOptions, collection: 'serviceOfferings' });

schema.plugin(actorStampPlugin);
schema.plugin(softDeletePlugin);

schema.index({ facilityId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ facilityId: 1, isActive: 1 });

export const ServiceOfferingModel = model<ServiceOfferingDoc>('ServiceOffering', schema);
