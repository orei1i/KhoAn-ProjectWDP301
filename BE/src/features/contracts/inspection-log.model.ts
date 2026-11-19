import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { AbandonedItemsDisposal, enumValues, INSPECTION_MACHINE, InspectionOutcome, InspectionStatus, InspectionType, ItemCondition, moveOutFeeTotal, MOVE_OUT_OTHER_FEES_MAX, type InspectionLog } from '@ssm/shared';
import { baseOptions, enumOf, maxLen, money, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin, historyCapPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type InspectionDoc = InspectionLog<OID, Date>;
interface Methods { transitionTo(to: InspectionStatus, ctx: TransitionCtx): void }
export type InspectionModelType = Model<InspectionDoc, {}, Methods>;
export type InspectionHydrated = HydratedDocument<InspectionDoc, Methods>;

const settlementPreviewSchema = new Schema({
  depositHeld: money(), damageFee: money(), priorOutstanding: money(), deductions: money(), refundAmount: money(), shortfall: money(),
  prepaidRentRefund: money(), prepaidRentOffset: money(), creditRefund: money(), creditOffset: money(),
  // Điều khoản 1.24: phí lưu giữ sau khi hết hạn (bản duyệt trước đó không có → 0).
  storageFee: money(false), storageDays: { type: Number, default: 0, min: 0 },
  earlyTermination: {
    type: new Schema({
      elapsedPct: { type: Number, required: true, min: 0, max: 100 }, refundCapPct: { type: Number, required: true, min: 0, max: 100 },
      discountClawback: money(false), usedPeriods: { type: Number, default: null },
    }, subOptions),
    default: null,
  },
}, subOptions);

const schema = new Schema<InspectionDoc, InspectionModelType, Methods>({
  facilityId: { ...refReq('Facility'), immutable: true },
  unitId: { ...refReq('StorageUnit'), immutable: true },
  contractId: { ...refOpt('RentalContract'), immutable: true },
  type: { ...enumOf(enumValues(InspectionType)), immutable: true },
  status: enumOf(enumValues(InspectionStatus), 'DRAFT'),
  inspectorId: refReq('User'),
  performedAt: { type: Date, required: true, default: Date.now },
  checklist: {
    // Biên bản trả kho mới: chỉ đánh dấu "đã kiểm" (checked), hư hại ghi ở damages. Biên bản cũ có condition từng mục — vẫn đọc được.
    type: [new Schema({ item: { type: String, required: true }, condition: { type: String, enum: enumValues(ItemCondition), default: null }, checked: { type: Boolean, default: null }, note: String }, subOptions)],
    default: [], validate: maxLen(100),
  },
  damages: {
    type: [new Schema({
      description: { type: String, required: true, maxlength: 500 },
      severity: { type: String, enum: ['MINOR', 'MODERATE', 'SEVERE'], required: true },
      cost: money(), photoUrls: { type: [String], default: [] },
    }, subOptions)],
    default: [], validate: maxLen(50),
  },
  // Đợt 17: phí khác Quản lý chi nhánh ghi khi duyệt biên bản trả kho (vệ sinh, thay khoá…).
  otherFees: {
    type: [new Schema({ label: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 }, amount: money() }, subOptions)],
    default: [], validate: maxLen(MOVE_OUT_OTHER_FEES_MAX),
  },
  photoUrls: { type: [String], default: [], validate: maxLen(50) },
  outcome: { type: String, enum: enumValues(InspectionOutcome), default: null },
  totalDamageFee: money(false),
  // Điều chỉnh sau khiếu nại của khách (Điều 9): tổng không vượt totalDamageFee — kiểm ở service.
  adjustments: {
    type: [new Schema({
      amount: money(), reason: { type: String, required: true, minlength: 5, maxlength: 500 },
      by: refReq('User'), at: { type: Date, required: true }, refundPaymentId: refOpt('PaymentTransaction'),
      debtCut: money(false), refund: money(false), // tác động tiền thật: giảm nợ / hoàn khách
    }, subOptions)],
    default: [],
  },
  depositSettlement: {
    type: new Schema({
      depositHeld: money(), deductions: money(), refundAmount: money(), shortfall: money(false), prepaidRentRefund: money(false), prepaidRentOffset: money(false),
      // Đầu vào để tính lại quyết toán khi khách khiếu nại đúng (null ở biên bản cũ).
      priorOutstanding: { type: Number, default: null, min: 0 }, refundCap: { type: Number, default: null, min: 0 }, clawbackDue: { type: Number, default: null, min: 0 },
      proceedsApplied: money(false), proceedsPayout: money(false), // xử lý đồ bỏ lại: tiền thanh lý bù nợ / trả lại khách
      creditRefund: money(false), creditOffset: money(false), // đợt 16 (C4): tiền dịch vụ / phí cấp lại bị huỷ — hoàn khách / cấn nợ
      // Điều khoản 1.24: phí lưu giữ (từ ngày hết hạn tới ngày bàn giao / xử lý đồ) đã trừ vào quyết toán + khoản STORAGE_FEE.
      storageFee: money(false), storageDays: { type: Number, default: 0, min: 0 }, storageFeePaymentId: refOpt('PaymentTransaction'),
      refundPaymentId: refOpt('PaymentTransaction'), damagePaymentId: refOpt('PaymentTransaction'),
      approvedBy: refOpt('User'), approvedAt: { type: Date, default: null },
      earlyTermination: {
        type: new Schema({
          elapsedPct: { type: Number, required: true, min: 0, max: 100 }, refundCapPct: { type: Number, required: true, min: 0, max: 100 },
          // Ưu đãi thuê dài hạn bị thu hồi vì mới dùng `usedPeriods` kỳ (đã trừ vào tiền giữ chân).
          discountClawback: { ...money(false) }, usedPeriods: { type: Number, default: null },
        }, subOptions),
        default: null,
      },
    }, subOptions),
    default: null,
  },
  abandonment: {
    type: new Schema({
      items: {
        type: [new Schema({ description: { type: String, required: true, maxlength: 300 }, quantity: { type: Number, required: true, min: 1 } }, subOptions)],
        default: [], validate: maxLen(200),
      },
      disposalMethod: enumOf(enumValues(AbandonedItemsDisposal)),
      proceeds: money(false), costs: money(false), // tiền thu được khi thanh lý; chi phí kiểm kê / vận chuyển / thanh lý
      finalNoticeAt: { type: Date, default: null }, // thông báo cuối đã gửi trước khi xử lý
      photoUrls: { type: [String], default: [], validate: maxLen(20) }, // ảnh hiện trạng / kiểm kê khi mở kho
    }, subOptions),
    default: null,
  },
  // Biên bản trả kho: khách có để lại đồ trong ô không (có thì mô tả + ảnh; chi nhánh giữ LEFTOVER_HOLD_DAYS ngày).
  leftItems: {
    type: new Schema({
      present: { type: Boolean, required: true },
      description: { type: String, default: null, maxlength: 1000 },
      photoUrls: { type: [String], default: [], validate: maxLen(10) },
    }, subOptions),
    default: null,
  },
  notes: { type: String, maxlength: 2000 },
  // Đợt 17 — duyệt biên bản trả kho: gửi / trả lại (lý do) / duyệt + quyết toán xem trước lúc duyệt.
  review: {
    type: new Schema({
      submittedAt: { type: Date, default: null }, submittedBy: refOpt('User'),
      returnNote: { type: String, default: null, maxlength: 500 }, returnedAt: { type: Date, default: null }, returnedBy: refOpt('User'),
      approvedAt: { type: Date, default: null }, approvedBy: refOpt('User'),
      settlementPreview: { type: settlementPreviewSchema, default: null },
    }, subOptions),
    default: null,
  },
  statusHistory: { type: [statusHistorySchema(enumValues(InspectionStatus))], default: [], validate: maxLen(50) },
}, { ...baseOptions, collection: 'inspectionLogs', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(historyCapPlugin, { statusHistory: 50 }); // trả lại / gửi lại nhiều lần không làm hỏng lệnh lưu
schema.plugin(appendOnlyPlugin, { allowUpdates: true });

/** Đợt 17: biên bản trả kho đi theo INSPECTION_MACHINE (gửi → trả lại / duyệt → khách xác nhận), ghi statusHistory như hợp đồng. */
schema.method('transitionTo', function (to: InspectionStatus, ctx: TransitionCtx) {
  applyTransition('InspectionLog', this, INSPECTION_MACHINE, to, ctx);
});

schema.pre('validate', function () {
  // Tổng tiền trừ vào quyết toán = phí sửa chữa các hư hại + phí khác (quản lý ghi khi duyệt).
  this.totalDamageFee = moveOutFeeTotal(this);
  if ((this.type === 'MOVE_OUT' || this.type === 'ABANDONMENT') && !this.contractId) this.invalidate('contractId', `${this.type} requires contract`);
  if (this.type === 'ABANDONMENT' && !this.abandonment?.items.length) this.invalidate('abandonment', 'requires at least one item');
  if (this.status !== 'DRAFT' && !this.outcome) this.invalidate('outcome', 'required once submitted');
  const ds = this.depositSettlement;
  if (ds && ds.deductions + ds.refundAmount !== ds.depositHeld) this.invalidate('depositSettlement', 'deductions + refund must equal deposit held');
  if (this.type === 'MOVE_OUT' && this.status === 'APPROVED' && !ds?.approvedBy) this.invalidate('depositSettlement', 'approved move-out needs settlement');
  if (this.status === 'FM_APPROVED' && (!this.review?.approvedBy || !this.review.settlementPreview)) this.invalidate('review', 'FM-approved move-out needs approver + settlement preview');
  if ((this.status === 'SUBMITTED' || this.status === 'RETURNED' || this.status === 'FM_APPROVED') && this.type !== 'MOVE_OUT') this.invalidate('status', 'review flow is for MOVE_OUT reports only');
  if (this.type === 'ABANDONMENT' && this.status === 'APPROVED' && !ds?.approvedBy) this.invalidate('depositSettlement', 'approved abandonment needs settlement');
});

schema.index({ facilityId: 1, performedAt: -1 });
schema.index({ facilityId: 1, status: 1, performedAt: -1 });
schema.index({ unitId: 1, performedAt: -1 });
schema.index({ contractId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: { $in: ['MOVE_OUT', 'ABANDONMENT'] }, contractId: { $type: 'objectId' } } });

export const InspectionModel = model<InspectionDoc, InspectionModelType>('InspectionLog', schema);
