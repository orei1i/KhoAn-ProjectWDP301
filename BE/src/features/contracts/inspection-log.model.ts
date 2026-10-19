import { Schema, model } from 'mongoose';
import { AbandonedItemsDisposal, enumValues, InspectionOutcome, InspectionStatus, InspectionType, ItemCondition, type InspectionLog } from '@ssm/shared';
import { baseOptions, enumOf, maxLen, money, refOpt, refReq, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin } from '../../shared/db/plugins';

export type InspectionDoc = InspectionLog<OID, Date>;

const schema = new Schema<InspectionDoc>({
  facilityId: { ...refReq('Facility'), immutable: true },
  unitId: { ...refReq('StorageUnit'), immutable: true },
  contractId: { ...refOpt('RentalContract'), immutable: true },
  type: { ...enumOf(enumValues(InspectionType)), immutable: true },
  status: enumOf(enumValues(InspectionStatus), 'DRAFT'),
  inspectorId: refReq('User'),
  performedAt: { type: Date, required: true, default: Date.now },
  checklist: {
    type: [new Schema({ item: { type: String, required: true }, condition: enumOf(enumValues(ItemCondition)), note: String }, subOptions)],
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
  photoUrls: { type: [String], default: [], validate: maxLen(50) },
  outcome: { type: String, enum: enumValues(InspectionOutcome), default: null },
  totalDamageFee: money(false),
  // Điều chỉnh sau khiếu nại của khách (Điều 9): tổng không vượt totalDamageFee — kiểm ở service.
  adjustments: {
    type: [new Schema({
      amount: money(), reason: { type: String, required: true, minlength: 5, maxlength: 500 },
      by: refReq('User'), at: { type: Date, required: true }, refundPaymentId: refOpt('PaymentTransaction'),
    }, subOptions)],
    default: [],
  },
  depositSettlement: {
    type: new Schema({
      depositHeld: money(), deductions: money(), refundAmount: money(), shortfall: money(false), prepaidRentRefund: money(false), prepaidRentOffset: money(false),
      proceedsApplied: money(false), proceedsPayout: money(false), // xử lý đồ bỏ lại: tiền thanh lý bù nợ / trả lại khách
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
    }, subOptions),
    default: null,
  },
  notes: { type: String, maxlength: 2000 },
}, { ...baseOptions, collection: 'inspectionLogs', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(appendOnlyPlugin, { allowUpdates: true });

schema.pre('validate', function () {
  this.totalDamageFee = this.damages.reduce((sum, d) => sum + d.cost, 0);
  if ((this.type === 'MOVE_OUT' || this.type === 'ABANDONMENT') && !this.contractId) this.invalidate('contractId', `${this.type} requires contract`);
  if (this.type === 'ABANDONMENT' && !this.abandonment?.items.length) this.invalidate('abandonment', 'requires at least one item');
  if (this.status !== 'DRAFT' && !this.outcome) this.invalidate('outcome', 'required once submitted');
  const ds = this.depositSettlement;
  if (ds && ds.deductions + ds.refundAmount !== ds.depositHeld) this.invalidate('depositSettlement', 'deductions + refund must equal deposit held');
  if (this.type === 'MOVE_OUT' && this.status === 'APPROVED' && !ds?.approvedBy) this.invalidate('depositSettlement', 'approved move-out needs settlement');
  if (this.type === 'ABANDONMENT' && this.status === 'APPROVED' && !ds?.approvedBy) this.invalidate('depositSettlement', 'approved abandonment needs settlement');
});

schema.index({ facilityId: 1, performedAt: -1 });
schema.index({ facilityId: 1, status: 1, performedAt: -1 });
schema.index({ unitId: 1, performedAt: -1 });
schema.index({ contractId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: { $in: ['MOVE_OUT', 'ABANDONMENT'] }, contractId: { $type: 'objectId' } } });

export const InspectionModel = model<InspectionDoc>('InspectionLog', schema);
