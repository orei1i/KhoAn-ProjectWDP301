import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { CancellationReason, CheckInShift, enumValues, RentalPeriod, RESERVATION_MACHINE, ReservationStatus, SignatureMethod, type PriceQuote, type Reservation } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';
import { addPeriodsUTC } from '../../shared/utils/dates';

export type ReservationDoc = Reservation<OID, Date>;
interface Methods { transitionTo(to: ReservationStatus, ctx: TransitionCtx): void }
export type ReservationModelType = Model<ReservationDoc, {}, Methods>;
export type ReservationHydrated = HydratedDocument<ReservationDoc, Methods>;

const quoteSchema = new Schema<PriceQuote<OID>>({
  currency: { type: String, enum: ['VND', 'USD'], required: true },
  rentalPeriod: enumOf(enumValues(RentalPeriod)),
  rate: money(), depositAmount: money(), discountAmount: money(), surchargeAmount: money(),
  appliedRuleCodes: { type: [String], default: [] },
  firstPeriodRent: money(), totalDueAtBooking: money(),
  // Báo giá cũ không có hai trường này: giữ chân = 1 kỳ, tiền thuê kỳ đầu trả khi nhận kho.
  depositPeriods: { type: Number, default: 1, min: 1, max: 12 },
  firstPeriodAtBooking: { type: Boolean, default: false },
  // Số kỳ tiền thuê thu trước khi dùng kho: thuê tháng = 1, thuê ngày / tuần = cả thời hạn. Báo giá cũ không có = 1.
  prepaidPeriods: { type: Number, default: 1, min: 1, max: 400 },
  policyId: refReq('BusinessPolicy'),
  policyVersion: { type: Number, required: true, min: 1 },
}, subOptions);

const schema = new Schema<ReservationDoc, ReservationModelType, Methods>({
  code: { type: String, required: true, immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  unitTypeId: { ...refReq('UnitType'), immutable: true },
  unitId: refOpt('StorageUnit'),
  status: enumOf(enumValues(ReservationStatus), 'PENDING'),
  startDate: { type: Date, required: true },
  periods: { type: Number, required: true, min: 1, max: 365, validate: Number.isInteger },
  endDate: { type: Date, required: true },
  // Khách chọn ngay lúc đặt — "Chưa rõ giờ" (UNKNOWN) là lựa chọn hợp lệ, không phải giá trị thiếu.
  preferredCheckInShift: enumOf(enumValues(CheckInShift), 'UNKNOWN'),
  // Add-on điều hòa khách tự chọn lúc đặt — không phải thuộc tính của ô. false với loại kho không hợp lệ.
  useAirConditioning: { type: Boolean, default: false },
  quote: { type: quoteSchema, required: true, immutable: true },
  holdExpiresAt: { type: Date, default: null },
  depositPaymentId: refOpt('PaymentTransaction'),
  allocation: { type: new Schema({ allocatedAt: { type: Date, required: true }, allocatedBy: refOpt('User') }, subOptions), default: null },
  checkIn: {
    type: new Schema({
      qrTokenHash: { type: String, default: null }, // sha256 of the one-time QR token
      qrExpiresAt: { type: Date, default: null },
      checkedInAt: { type: Date, default: null },
      checkedInBy: refOpt('User'),
    }, subOptions),
    default: null,
  },
  cancellation: {
    type: new Schema({
      reason: enumOf(enumValues(CancellationReason)),
      note: { type: String, maxlength: 500 },
      cancelledAt: { type: Date, required: true },
      cancelledBy: refOpt('User'),
      refundAmount: money(),
    }, subOptions),
    default: null,
  },
  contractId: refOpt('RentalContract'),
  source: { type: String, enum: ['WEB', 'MOBILE', 'WALK_IN'], required: true },
  idempotencyKey: { type: String, default: null, maxlength: 100 },
  // Không đặt required: dữ liệu tạo trước khi có tính năng này vẫn phải save() được khi đổi trạng thái.
  // Ràng buộc bắt buộc nằm ở tầng API (zod) — mọi đặt chỗ mới đều có.
  consent: {
    type: new Schema({
      termsVersion: { type: String, required: true, maxlength: 20 },
      privacyVersion: { type: String, required: true, maxlength: 20 },
      acceptedAt: { type: Date, required: true },
      // Lúc khách xác nhận đã được báo trước lịch thanh toán (tiền giữ chân hôm nay + tiền thuê kỳ đầu: khi nhận kho, hoặc cùng lúc đặt với kho cỡ lớn). null với dữ liệu cũ.
      paymentScheduleAckAt: { type: Date, default: null },
      ip: { type: String, default: null, maxlength: 64 },
      userAgent: { type: String, default: null, maxlength: 300 },
    }, subOptions),
    default: null,
    immutable: true, // bằng chứng đã ghi thì không sửa
  },
  // Chữ ký xác nhận hợp đồng — khách ký sau khi trả cọc, trước khi nhận kho. Đã ký thì không sửa.
  signature: {
    type: new Schema({
      signedAt: { type: Date, required: true },
      signerName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
      method: enumOf(enumValues(SignatureMethod)),
      image: { type: String, default: null, maxlength: 80_000 },
      termsVersion: { type: String, required: true, maxlength: 20 },
      policyVersion: { type: Number, required: true, min: 1 },
      signedBy: refOpt('User'),
      onBehalf: { type: Boolean, default: false },
      emailedAt: { type: Date, default: null },
      // Nguyên văn điều khoản lúc ký + phiên bản mẫu — hợp đồng đã ký không đổi theo mẫu / mã nguồn về sau.
      clauses: {
        type: [new Schema({ title: { type: String, required: true }, paragraphs: { type: [String], default: [] }, bullets: { type: [String], default: [] } }, subOptions)],
        default: undefined,
      },
      templateVersion: { type: Number, default: null },
      // Đại diện Bên A (quản lý chi nhánh + giấy uỷ quyền) lúc ký — PDF đã ký luôn in đúng người này.
      lessorSignatory: { type: new Schema({ name: { type: String, default: null, maxlength: 120 }, authorization: { type: String, default: null, maxlength: 300 } }, subOptions), default: null },
      emailedTo: { type: String, default: null, maxlength: 120 },
    }, subOptions),
    default: null,
  },
  statusHistory: { type: [statusHistorySchema(enumValues(ReservationStatus))], default: [], validate: maxLen(30) },
}, {
  ...baseOptions, collection: 'reservations', optimisticConcurrency: true,
  toJSON: { versionKey: false, virtuals: true, transform: (_doc, ret) => { if (ret.checkIn) delete ret.checkIn.qrTokenHash; return ret; } },
});

schema.plugin(actorStampPlugin);
schema.plugin(appendOnlyPlugin, { allowUpdates: true });

schema.method('transitionTo', function (to: ReservationStatus, ctx: TransitionCtx) {
  applyTransition('Reservation', this, RESERVATION_MACHINE, to, ctx);
});

schema.pre('validate', function () {
  if (this.isNew && !this.code) this.code = humanCode('RSV');
  if (this.isNew && this.statusHistory.length === 0) this.statusHistory.push({ from: null, to: this.status, at: new Date() });
  if (this.startDate && (this.isModified('startDate') || this.isModified('periods'))) {
    this.endDate = addPeriodsUTC(this.startDate, this.quote.rentalPeriod, this.periods);
  }
  const s = this.status;
  if (['ALLOCATED', 'CHECKED_IN', 'COMPLETED'].includes(s) && !this.unitId) this.invalidate('unitId', `required when ${s}`);
  if (s === 'PENDING' && !this.holdExpiresAt) this.invalidate('holdExpiresAt', 'required while PENDING');
  if (s !== 'PENDING') this.holdExpiresAt = null;
  if (s === 'CANCELLED' && !this.cancellation) this.invalidate('cancellation', 'required when CANCELLED');
  if (['CHECKED_IN', 'COMPLETED'].includes(s) && !this.contractId) this.invalidate('contractId', `required when ${s}`);
});

schema.index({ code: 1 }, { unique: true });
schema.index({ facilityId: 1, unitTypeId: 1, status: 1, startDate: 1, endDate: 1 });
schema.index({ facilityId: 1, status: 1, startDate: 1 });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ unitId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['ALLOCATED', 'CHECKED_IN'] } } });
schema.index({ holdExpiresAt: 1 }, { partialFilterExpression: { status: 'PENDING' } });
schema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

export const ReservationModel = model<ReservationDoc, ReservationModelType>('Reservation', schema);
