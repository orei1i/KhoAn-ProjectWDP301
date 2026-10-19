import { Schema, model, type Model } from 'mongoose';
import { AccessMethod, enumValues, UNIT_MACHINE, UnitStatus, type StorageUnit } from '@ssm/shared';
import { baseOptions, enumOf, refOpt, refReq, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, softDeletePlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type StorageUnitDoc = StorageUnit<OID, Date>;
interface Methods { transitionTo(to: UnitStatus, ctx: TransitionCtx): void; softDelete(by?: string): Promise<unknown> }
export type StorageUnitModelType = Model<StorageUnitDoc, {}, Methods>;

const schema = new Schema<StorageUnitDoc, StorageUnitModelType, Methods>({
  facilityId: { ...refReq('Facility'), immutable: true },
  unitTypeId: refReq('UnitType'),
  unitNumber: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
  location: {
    type: new Schema({ building: String, floor: { type: Number, required: true, min: -5, max: 100 }, zone: String, aisle: String }, subOptions),
    required: true,
  },
  // Hình thức khoá là thuộc tính CỦA TỪNG Ô (khác nhau trong cùng một loại kho) — khách lọc/chọn ngay
  // trên sơ đồ lúc đặt. Điều hòa KHÔNG ở đây nữa — mọi ô của loại kho hợp lệ đều sẵn có máy lạnh về
  // cơ sở vật chất, dùng hay không là add-on khách chọn lúc đặt (Reservation.useAirConditioning).
  accessMethod: enumOf(enumValues(AccessMethod), 'PIN'),
  status: enumOf(enumValues(UnitStatus), 'AVAILABLE'),
  statusChangedAt: { type: Date, default: Date.now },
  statusReason: { type: String, default: null, maxlength: 500 },
  currentReservationId: refOpt('Reservation'),
  currentContractId: refOpt('RentalContract'),
  currentSwapRequestId: refOpt('UnitSwapRequest'),
  overlockActive: { type: Boolean, default: false },
  notes: { type: String, maxlength: 1000 },
}, { ...baseOptions, collection: 'storageUnits', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(softDeletePlugin);

schema.method('transitionTo', function (to: UnitStatus, ctx: TransitionCtx) {
  applyTransition('StorageUnit', this, UNIT_MACHINE, to, ctx);
  this.statusReason = ctx.reason ?? null;
});

// Status <-> pointer invariants (checked on save(); CAS updateOne paths set the same fields explicitly)
schema.pre('validate', function () {
  if (this.isModified('status')) this.statusChangedAt = new Date();
  const s = this.status;
  // RESERVED giữ chỗ vì một trong hai lý do: đặt chỗ khách chọn ô (currentReservationId), hoặc
  // đang chờ khách chuyển đồ sau khi yêu cầu đổi ô được duyệt (currentSwapRequestId).
  if (s === 'RESERVED' && !this.currentReservationId && !this.currentSwapRequestId) {
    this.invalidate('currentReservationId', 'required when RESERVED (or currentSwapRequestId)');
  }
  // OCCUPIED luôn phải có hợp đồng. PENDING_INSPECTION thì KHÔNG bắt buộc: khi đổi ô kho, ô cũ được
  // trả về chờ kiểm tra trong khi hợp đồng đã chuyển sang ô mới — lúc đó ô cũ không còn hợp đồng nào.
  if (s === 'OCCUPIED' && !this.currentContractId) this.invalidate('currentContractId', 'required when OCCUPIED');
  if (s === 'AVAILABLE' && (this.currentReservationId || this.currentContractId || this.currentSwapRequestId)) {
    this.invalidate('status', 'AVAILABLE unit must not hold reservation/contract/swap-request');
  }
  if (this.overlockActive && s !== 'OCCUPIED') this.invalidate('overlockActive', 'overlock only valid on OCCUPIED');
});

schema.index({ facilityId: 1, unitNumber: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ facilityId: 1, unitTypeId: 1, status: 1, 'location.floor': 1, unitNumber: 1 });
schema.index({ facilityId: 1, status: 1 });
schema.index({ currentContractId: 1 }, { partialFilterExpression: { currentContractId: { $type: 'objectId' } } });

export const StorageUnitModel = model<StorageUnitDoc, StorageUnitModelType>('StorageUnit', schema);
