import { Schema, model } from 'mongoose';
import { enumValues, UnitCategory, type UnitType } from '@ssm/shared';
import { baseOptions, enumOf, money, refReq, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, softDeletePlugin } from '../../shared/db/plugins';

export type UnitTypeDoc = UnitType<OID, Date>;
const dim = { type: Number, required: true, min: 0.3, max: 30 };

const schema = new Schema<UnitTypeDoc>({
  facilityId: { ...refReq('Facility'), immutable: true },
  code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  category: enumOf(enumValues(UnitCategory)),
  description: { type: String, maxlength: 2000 },
  dimensions: { type: new Schema({ widthM: dim, depthM: dim, heightM: dim }, subOptions), required: true },
  areaM2: { type: Number, required: true, min: 0 },
  // indoor/outdoor chung cho cả loại (VD XL drive-up luôn ngoài trời). Hình thức khoá nằm ở từng ô
  // vật lý (StorageUnit); điều hòa là add-on khách tự bật lúc đặt (Reservation.useAirConditioning).
  features: {
    type: new Schema({ indoor: { type: Boolean, default: true } }, subOptions),
    default: () => ({}),
  },
  // Khách tự chọn chu kỳ lúc đặt — loại kho niêm yết sẵn cả 3 giá, không cố định theo một chu kỳ.
  // Đây là giá GỐC (không dùng điều hòa); khách bật add-on điều hòa thì cộng phụ phí CLIMATE của chính sách.
  rates: {
    type: new Schema({ DAY: money(), WEEK: money(), MONTH: money() }, subOptions),
    required: true,
  },
  depositOverride: { ...money(false), default: null },
  minPeriods: { type: Number, default: 1, min: 1, max: 365 },
  imageUrls: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
  inventoryVersion: { type: Number, default: 0, min: 0 },
}, { ...baseOptions, collection: 'unitTypes' });

schema.plugin(actorStampPlugin);
schema.plugin(softDeletePlugin);

schema.pre('validate', function () {
  const { widthM, depthM } = this.dimensions ?? {};
  if (widthM && depthM) this.areaM2 = Math.round(widthM * depthM * 100) / 100;
});

schema.index({ facilityId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ facilityId: 1, isActive: 1, category: 1 });
schema.index({ isActive: 1, category: 1 });

export const UnitTypeModel = model<UnitTypeDoc>('UnitType', schema);
