import { Schema, model } from 'mongoose';
import { enumValues, Role, UnitCategory, type BusinessPolicy } from '@ssm/shared';
import { baseOptions, money, refOpt, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin } from '../../shared/db/plugins';

export type PolicyDoc = BusinessPolicy<OID, Date>;
const int = (min: number, max = 1e9) => ({ type: Number, required: true, min, max, validate: Number.isInteger, immutable: true });
const rule = <T>(s: Schema<T>) => ({ type: [s], default: [], immutable: true });

const schema = new Schema<PolicyDoc>({
  scope: { type: String, enum: ['GLOBAL', 'FACILITY'], required: true, immutable: true },
  facilityId: { ...refOpt('Facility'), immutable: true },
  version: int(1),
  isActive: { type: Boolean, default: false }, // the only mutable business field
  effectiveFrom: { type: Date, required: true, immutable: true },
  deposit: {
    type: new Schema({ mode: { type: String, enum: ['PERIODS_OF_RENT', 'FIXED'], required: true }, value: { type: Number, required: true, min: 0 } }, subOptions),
    required: true, immutable: true,
  },
  reservationHoldMinutes: int(5, 1440),
  allocationLeadDays: int(0, 60),
  noShowAfterHours: int(1, 168),
  gracePeriodDays: int(0, 60),
  lockoutAfterDays: int(1, 180),
  abandonAfterLockedOutDays: int(1, 365),
  // Phí cấp lại mật khẩu/thẻ/chìa. Không bắt buộc: chính sách cũ chưa có thì dùng DEFAULT_ACCESS_FEES (xem accessFeeOf).
  accessFees: { type: new Schema({ PIN_RESET: money(), CARD_REISSUE: money(), KEY_REISSUE: money() }, subOptions), immutable: true, default: undefined },
  lateFees: rule(new Schema({
    afterDays: { type: Number, required: true, min: 0 }, kind: { type: String, enum: ['FIXED', 'PERCENT_OF_RENT'], required: true },
    value: { type: Number, required: true, min: 0 }, recurringEveryDays: { type: Number, default: null, min: 1 },
  }, subOptions)),
  cancellation: rule(new Schema({
    minHoursBeforeStart: { type: Number, required: true, min: 0 }, depositRefundPct: { type: Number, required: true, min: 0, max: 100 },
  }, subOptions)),
  earlyTermination: rule(new Schema({
    maxElapsedPct: { type: Number, required: true, min: 0, max: 100 }, depositRefundPct: { type: Number, required: true, min: 0, max: 100 },
  }, subOptions)),
  minPeriods: int(1, 60),
  maxPeriods: int(1, 365),
  surcharges: rule(new Schema({
    code: { type: String, required: true }, label: { type: String, required: true },
    kind: { type: String, enum: ['FIXED', 'PERCENT'], required: true }, value: { type: Number, required: true, min: 0 },
    categories: { type: [{ type: String, enum: enumValues(UnitCategory) }], default: [] },
  }, subOptions)),
  discounts: rule(new Schema({
    code: { type: String, required: true }, kind: { type: String, enum: ['FIXED', 'PERCENT'], required: true },
    value: { type: Number, required: true, min: 0 }, minPeriods: { type: Number, default: 1, min: 1 },
    validFrom: { type: Date, default: null }, validTo: { type: Date, default: null },
    requiresApprovalRole: { type: String, enum: enumValues(Role), default: null },
  }, subOptions)),
  waiverLimits: rule(new Schema({ role: { type: String, enum: enumValues(Role), required: true }, maxAmount: money() }, subOptions)),
}, { ...baseOptions, collection: 'businessPolicies' });

schema.plugin(actorStampPlugin);
schema.plugin(appendOnlyPlugin, { allowUpdates: true });

schema.pre('validate', function () {
  if (this.scope === 'FACILITY' && !this.facilityId) this.invalidate('facilityId', 'required for FACILITY scope');
  if (this.scope === 'GLOBAL' && this.facilityId) this.invalidate('facilityId', 'must be null for GLOBAL scope');
  if (this.lockoutAfterDays <= this.gracePeriodDays) this.invalidate('lockoutAfterDays', 'must exceed gracePeriodDays');
  if (this.maxPeriods < this.minPeriods) this.invalidate('maxPeriods', 'must be >= minPeriods');
  if (this.isNew) this.lateFees.sort((a, b) => a.afterDays - b.afterDays);
});

schema.index({ scope: 1, facilityId: 1, version: 1 }, { unique: true });
schema.index({ scope: 1, facilityId: 1, isActive: 1, effectiveFrom: -1 });

export const PolicyModel = model<PolicyDoc>('BusinessPolicy', schema);
