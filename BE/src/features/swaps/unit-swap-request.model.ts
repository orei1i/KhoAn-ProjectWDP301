import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { enumValues, OPEN_SWAP_STATUSES, RentalPeriod, SWAP_REQUEST_MACHINE, SwapMethod, SwapRequestStatus, type UnitSwapRequest } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin, historyCapPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type UnitSwapRequestDoc = UnitSwapRequest<OID, Date>;
interface Methods { transitionTo(to: SwapRequestStatus, ctx: TransitionCtx): void }
export type UnitSwapRequestModelType = Model<UnitSwapRequestDoc, {}, Methods>;
export type UnitSwapRequestHydrated = HydratedDocument<UnitSwapRequestDoc, Methods>;

const clauseSchema = new Schema({ title: { type: String, required: true }, paragraphs: { type: [String], default: [] }, bullets: { type: [String], default: [] } }, subOptions);
/** Đợt 15 (C3) — đổi cỡ kho: giá chốt lúc khách xác nhận phụ lục (gửi yêu cầu) + kết quả lúc hoàn tất. */
const sizeChangeSchema = new Schema({
  fromUnitTypeId: refReq('UnitType'), toUnitTypeId: refReq('UnitType'), rentalPeriod: enumOf(enumValues(RentalPeriod)),
  currentRate: money(), gross: money(), discountAmount: money(false), rate: money(),
  currentDeposit: money(false), deposit: money(false), depositDiff: { type: Number, required: true },
  useAirConditioning: { type: Boolean, default: false },
  estimate: { type: new Schema({ from: { type: Date, required: true }, rentDiff: { type: Number, required: true } }, subOptions), required: true },
  servicesCancelled: { type: Boolean, default: false },
  appendix: {
    type: new Schema({
      number: { type: Number, default: null }, title: { type: String, required: true, maxlength: 200 },
      acceptedAt: { type: Date, required: true }, signerName: { type: String, required: true, maxlength: 120 }, signedBy: refOpt('User'),
      termsVersion: { type: String, required: true }, ip: { type: String, default: null }, userAgent: { type: String, default: null, maxlength: 400 },
      clauses: { type: [clauseSchema], default: [] },
      lessorSignatory: { type: new Schema({ name: { type: String, default: null, maxlength: 120 }, authorization: { type: String, default: null, maxlength: 300 } }, subOptions), default: null },
    }, subOptions),
    required: true,
  },
  effectiveFrom: { type: Date, default: null }, rentDiff: { type: Number, default: null }, appendixNumber: { type: Number, default: null },
  paymentIds: { type: [Schema.Types.ObjectId], default: [] },
}, subOptions);

const schema = new Schema<UnitSwapRequestDoc, UnitSwapRequestModelType, Methods>({
  requestNumber: { type: String, required: true, immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  contractId: { ...refReq('RentalContract'), immutable: true },
  unitTypeId: { ...refReq('UnitType'), immutable: true }, // loại kho đang thuê lúc gửi
  // Đợt 15 (C3): loại kho của ô mới — khác unitTypeId là ĐỔI CỠ KHO (báo giá + phụ lục khách đã xác nhận ở sizeChange). Thiếu (dữ liệu cũ) = cùng loại.
  toUnitTypeId: { ...refOpt('UnitType'), immutable: true },
  sizeChange: { type: sizeChangeSchema, default: null },
  fromUnitId: { ...refReq('StorageUnit'), immutable: true },
  toUnitId: { ...refReq('StorageUnit'), immutable: true },
  method: { ...enumOf(enumValues(SwapMethod)), immutable: true },
  reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 500, immutable: true },
  status: enumOf(enumValues(SwapRequestStatus), 'SUBMITTED'),
  fee: { ...money(), default: 0 },
  facilityFault: { type: Boolean, default: null },
  scheduledFor: { type: Date, default: null },
  // Nhân viên được phân công chuyển đồ (DELIVERY). Tên lưu kèm để khách xem được mà không cần đọc bảng users.
  assignedStaffId: refOpt('User'),
  assignedStaffName: { type: String, default: null, maxlength: 100 },
  moveDeadline: { type: Date, default: null },
  decidedBy: refOpt('User'),
  decidedAt: { type: Date, default: null },
  rejectReason: { type: String, default: null, maxlength: 500 },
  completedAt: { type: Date, default: null },
  paymentId: refOpt('PaymentTransaction'),
  statusHistory: { type: [statusHistorySchema(enumValues(SwapRequestStatus))], default: [], validate: maxLen(20) },
}, { ...baseOptions, collection: 'unitSwapRequests', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(historyCapPlugin, { statusHistory: 20 }); // đầy thì giữ 20 mục mới nhất, không làm hỏng lệnh lưu
schema.plugin(appendOnlyPlugin, { allowUpdates: true }); // hồ sơ tài chính: cập nhật được, xóa thì không

schema.method('transitionTo', function (to: SwapRequestStatus, ctx: TransitionCtx) {
  applyTransition('UnitSwapRequest', this, SWAP_REQUEST_MACHINE, to, ctx);
});

schema.pre('validate', function () {
  if (this.isNew && !this.requestNumber) this.requestNumber = humanCode('SWP');
  if (this.isNew && this.statusHistory.length === 0) this.statusHistory.push({ from: null, to: this.status, at: new Date() });
  if (String(this.fromUnitId) === String(this.toUnitId)) this.invalidate('toUnitId', 'ô mới phải khác ô đang thuê');
  if (this.status === 'APPROVED' && this.method === 'SELF' && !this.moveDeadline) this.invalidate('moveDeadline', 'required when APPROVED + SELF');
  if (this.status === 'REJECTED' && !this.rejectReason) this.invalidate('rejectReason', 'required when REJECTED');
  if (this.status === 'DONE' && !this.completedAt) this.invalidate('completedAt', 'required when DONE');
});

schema.index({ requestNumber: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, createdAt: -1 });
schema.index({ contractId: 1, createdAt: -1 });
// Một hợp đồng chỉ được có đúng 1 yêu cầu đang mở tại một thời điểm (SUBMITTED hoặc APPROVED).
schema.index({ contractId: 1 }, { unique: true, partialFilterExpression: { status: { $in: [...OPEN_SWAP_STATUSES] } } });
schema.index({ status: 1, moveDeadline: 1 }, { partialFilterExpression: { status: 'APPROVED' } });

export const UnitSwapRequestModel = model<UnitSwapRequestDoc, UnitSwapRequestModelType>('UnitSwapRequest', schema);
