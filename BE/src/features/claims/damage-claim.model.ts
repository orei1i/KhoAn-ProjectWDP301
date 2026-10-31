import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { CLAIM_MACHINE, ClaimItemFlag, ClaimStatus, ClaimType, enumValues, ID_TYPES, IntakeItemCondition, OPEN_CLAIM_STATUSES, PaymentMethod, SEALED_PACKAGE_STATE, type DamageClaim, type SealedPackageState } from '@ssm/shared';

const SEALED_PACKAGE_STATES = Object.keys(SEALED_PACKAGE_STATE) as SealedPackageState[];
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin, historyCapPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type DamageClaimDoc = DamageClaim<OID, Date>;
interface Methods { transitionTo(to: ClaimStatus, ctx: TransitionCtx): void }
export type DamageClaimModelType = Model<DamageClaimDoc, {}, Methods>;
export type DamageClaimHydrated = HydratedDocument<DamageClaimDoc, Methods>;

const schema = new Schema<DamageClaimDoc, DamageClaimModelType, Methods>({
  claimNumber: { type: String, required: true, immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  contractId: { ...refReq('RentalContract'), immutable: true },
  unitId: { ...refReq('StorageUnit'), immutable: true },
  ticketId: { ...refOpt('SupportTicket'), immutable: true },
  type: { ...enumOf(enumValues(ClaimType)), immutable: true },
  status: enumOf(enumValues(ClaimStatus), 'SUBMITTED'),
  // Nội dung khách khai báo là bằng chứng: ghi một lần, không sửa. Sai thì rút hồ sơ và gửi lại.
  incidentAt: { type: Date, required: true, immutable: true },
  description: { type: String, required: true, minlength: 10, maxlength: 5000, immutable: true },
  items: {
    type: [new Schema({
      name: { type: String, required: true, trim: true, maxlength: 200 },
      quantity: { type: Number, required: true, min: 1, max: 999, validate: Number.isInteger },
      unitValue: money(),
      note: { type: String, maxlength: 500 },
      // Đợt 14: món đồ trong danh sách đồ đang gửi (IntakeBatchItem._id) / cờ đồ ngoài danh sách. Không đặt default — hồ sơ cũ giữ nguyên.
      intakeItemId: { type: String, maxlength: 40 },
      undeclared: { type: Boolean },
      // Đợt 15 (A5, A9) — server tự gắn lúc lập hồ sơ, không default (hồ sơ cũ giữ nguyên).
      flag: { type: String, enum: [...enumValues(ClaimItemFlag), null] },
      batchCode: { type: String, maxlength: 40 },
      intakeConfirmedAt: { type: Date },
      intakeCondition: { type: String, enum: [...enumValues(IntakeItemCondition), null] },
      matchedItem: {
        type: new Schema({ intakeItemId: { type: String, required: true, maxlength: 40 }, name: { type: String, required: true, maxlength: 200 }, estValue: money() }, subOptions),
        default: undefined,
      },
      // Đợt 16 (D2): kiện gửi kín — tình trạng kiện khách khai + cờ server gắn. Không default (hồ sơ cũ giữ nguyên).
      packageState: { type: String, enum: [...SEALED_PACKAGE_STATES, null] },
      sealedPackage: { type: Boolean },
    }, subOptions)],
    // KHÔNG dùng `immutable` cho mảng: mongoose coi mảng mặc định / mảng nạp lại là "đã gán" khi lưu và (strict: 'throw') ném lỗi
    // ở MỌI lần cập nhật hồ sơ (xác minh, duyệt, chi). Tính bất biến được giữ bằng pre('validate') bên dưới.
    default: [], validate: maxLen(50),
  },
  claimedAmount: { ...money(), immutable: true }, // server tự tính từ items, không nhận từ client
  photoUrls: { type: [String], default: [], validate: maxLen(20) }, // bất biến: xem pre('validate')
  review: {
    type: new Schema({
      reviewedBy: refReq('User'),
      reviewedAt: { type: Date, required: true },
      approvedAmount: money(false),
      liabilityCap: money(),
      decisionNote: { type: String, required: true, minlength: 5, maxlength: 2000 },
    }, subOptions),
    default: null,
  },
  settlement: {
    type: new Schema({
      paymentId: refReq('PaymentTransaction'),
      paidAt: { type: Date, default: null }, // chuyển khoản: null tới khi xác nhận đã chuyển
      method: enumOf(enumValues(PaymentMethod)),
      // Đợt 15 (A6): chi TIỀN MẶT — người nhận đã đối chiếu giấy tờ bản gốc tại quầy (không default: hồ sơ cũ / chuyển khoản không có).
      recipient: {
        type: new Schema({
          name: { type: String, required: true, maxlength: 120 },
          idType: { type: String, enum: [...ID_TYPES], required: true },
          idNumberLast4: { type: String, required: true, maxlength: 4 },
          at: { type: Date, required: true },
          by: refReq('User'),
        }, subOptions),
        default: undefined,
      },
    }, subOptions),
    // KHÔNG đặt immutable: mongoose chặn mọi thay đổi sau khi doc tồn tại, mà khoản chi chỉ ghi ở
    // bước cuối. PAID là trạng thái cuối trong CLAIM_MACHINE nên không có đường nào ghi đè nó.
    default: null,
  },
  statusHistory: { type: [statusHistorySchema(enumValues(ClaimStatus))], default: [], validate: maxLen(30) },
}, { ...baseOptions, collection: 'damageClaims', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(historyCapPlugin, { statusHistory: 30 }); // đầy thì giữ 30 mục mới nhất, không làm hỏng lệnh lưu
schema.plugin(appendOnlyPlugin, { allowUpdates: true }); // hồ sơ tài chính: cập nhật được, xóa thì không

schema.method('transitionTo', function (to: ClaimStatus, ctx: TransitionCtx) {
  applyTransition('DamageClaim', this, CLAIM_MACHINE, to, ctx);
});

schema.pre('validate', function () {
  // Hạng mục và ảnh khai báo không được sửa sau khi gửi (thay cho `immutable` trên mảng — xem ghi chú ở trên).
  if (!this.isNew && (this.isDirectModified('items') || this.isDirectModified('photoUrls'))) this.invalidate('items', 'Không được sửa hạng mục / ảnh sau khi đã gửi yêu cầu bồi thường');
  if (this.isNew && !this.claimNumber) this.claimNumber = humanCode('CLM');
  if (this.isNew && this.statusHistory.length === 0) this.statusHistory.push({ from: null, to: this.status, at: new Date() });
  if (this.items.length === 0) this.invalidate('items', 'phải khai báo ít nhất một hạng mục');

  const total = this.items.reduce((s, it) => s + it.quantity * it.unitValue, 0);
  if (this.isNew) this.claimedAmount = total;
  else if (this.claimedAmount !== total) this.invalidate('claimedAmount', 'không khớp tổng các hạng mục');

  const s = this.status;
  if (['APPROVED', 'REJECTED', 'PAID'].includes(s) && !this.review) this.invalidate('review', `required when ${s}`);
  if (s === 'PAID' && !this.settlement?.paidAt) this.invalidate('settlement', 'required when PAID');
  if (this.review) {
    if (this.review.approvedAmount > this.review.liabilityCap) this.invalidate('review.approvedAmount', 'vượt hạn mức trách nhiệm');
    if (this.review.approvedAmount > this.claimedAmount) this.invalidate('review.approvedAmount', 'vượt số tiền khách yêu cầu');
    if (s === 'APPROVED' && this.review.approvedAmount <= 0) this.invalidate('review.approvedAmount', 'duyệt thì số tiền phải > 0');
    if (s === 'REJECTED' && this.review.approvedAmount !== 0) this.invalidate('review.approvedAmount', 'từ chối thì số tiền phải = 0');
  }
});

schema.index({ claimNumber: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, createdAt: -1 });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ contractId: 1, status: 1 });
schema.index({ contractId: 1, createdAt: -1 }, { partialFilterExpression: { status: { $in: [...OPEN_CLAIM_STATUSES] } } });

export const DamageClaimModel = model<DamageClaimDoc, DamageClaimModelType>('DamageClaim', schema);
