import { Schema, model } from 'mongoose';
import { enumValues, FacilityStatus, type Facility } from '@ssm/shared';
import { baseOptions, enumOf, refOpt, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, softDeletePlugin } from '../../shared/db/plugins';

export type FacilityDoc = Facility<OID, Date>;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const pointSchema = new Schema({
  type: { type: String, enum: ['Point'], required: true, default: 'Point' },
  coordinates: {
    type: [Number], required: true,
    validate: { validator: (c: number[]) => c.length === 2 && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90, message: 'coordinates must be [lng, lat]' },
  },
}, subOptions);

const hoursSchema = new Schema({
  dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
  open: { type: String, required: true, match: HHMM },
  close: { type: String, required: true, match: HHMM },
}, subOptions);

const schema = new Schema<FacilityDoc>({
  code: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z0-9-]{3,20}$/, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 150 },
  status: enumOf(enumValues(FacilityStatus), 'UNDER_CONSTRUCTION'),
  address: {
    type: new Schema({
      line1: { type: String, required: true }, ward: String,
      district: { type: String, required: true }, city: { type: String, required: true },
      country: { type: String, required: true, default: 'VN' },
    }, subOptions),
    required: true,
  },
  location: { type: pointSchema, required: true },
  timezone: { type: String, required: true, default: 'Asia/Ho_Chi_Minh' },
  currency: { type: String, enum: ['VND', 'USD'], required: true, default: 'VND' },
  operatingHours: { type: [hoursSchema], default: [] },
  accessHours: { type: new Schema({ open: { type: String, match: HHMM }, close: { type: String, match: HHMM } }, subOptions), default: null },
  contact: { type: new Schema({ phone: { type: String, required: true }, email: String }, subOptions), required: true },
  amenities: { type: [String], default: [] },
  imageUrls: { type: [String], default: [] },
  policyId: refOpt('BusinessPolicy'),
}, { ...baseOptions, collection: 'facilities' });

schema.plugin(actorStampPlugin);
schema.plugin(softDeletePlugin);

schema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ location: '2dsphere' });
schema.index({ status: 1, 'address.city': 1, 'address.district': 1 });

export const FacilityModel = model<FacilityDoc>('Facility', schema);
