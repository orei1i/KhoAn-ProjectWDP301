import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { AccessMethod, CONTRACT_MACHINE, ContractNoticeKind, ContractStatus, DepositStatus, enumValues, INTAKE_CHECK_ITEMS, NoticeEmailStatus, MAX_AUTHORIZED_PERSONS, OPEN_CONTRACT_STATUSES, RentalPeriod, type RentalContract } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type RentalContractDoc = RentalContract<OID, Date>;
interface Methods { transitionTo(to: ContractStatus, ctx: TransitionCtx): void }
export type RentalContractModelType = Model<RentalContractDoc, {}, Methods>;
export type RentalContractHydrated = HydratedDocument<RentalContractDoc, Methods>;

const schema = new Schema<RentalContractDoc, RentalContractModelType, Methods>({
  contractNumber: { type: String, required: true, immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  // CỐ Ý không immutable: đổi ô kho cùng loại (contract.service → swapUnit) ghi lại trường này.
  // Mọi lần đổi đều để dấu vết ở unitSwaps[] bên dưới — không có đường nào đổi ô mà không ghi lịch sử.
  unitId: refReq('StorageUnit'),
  unitTypeId: { ...refReq('UnitType'), immutable: true }, // chỉ đổi ô trong cùng loại → giá hợp đồng không đổi
  reservationId: { ...refReq('Reservation'), immutable: true },
  status: enumOf(enumValues(ContractStatus), 'ACTIVE'),
  startDate: { type: Date, required: true, immutable: true },
  endDate: { type: Date, required: true },
  autoRenew: { type: Boolean, default: false },
  // Chốt từ Reservation.useAirConditioning lúc nhận kho — hiện cho nhân viên biết hợp đồng có tính phí điều hòa hay không.
  useAirConditioning: { type: Boolean, default: false },
  billing: {
    type: new Schema({
      currency: { type: String, enum: ['VND', 'USD'], required: true },
      rentalPeriod: enumOf(enumValues(RentalPeriod), 'MONTH'),
      rate: money(),
      nextBillingDate: { type: Date, required: true },
      paidThrough: { type: Date, required: true },
    }, subOptions),
    required: true,
  },
  deposit: {
    type: new Schema({
      amount: money(), status: enumOf(enumValues(DepositStatus), 'HELD'),
      paymentId: refOpt('PaymentTransaction'), refundedAmount: money(false),
    }, subOptions),
    required: true,
  },
  balance: { type: new Schema({ outstanding: money(false), lastPaymentAt: { type: Date, default: null } }, subOptions), default: () => ({}) },
  delinquency: {
    type: new Schema({
      since: { type: Date, required: true }, daysOverdue: { type: Number, required: true, min: 0 },
      lateFeesAccrued: money(false), lockedOutAt: { type: Date, default: null },
      // Mốc THÔNG BÁO CUỐI của đợt nợ này — chỉ được xử lý đồ bỏ lại sau abandonAfterLockedOutDays ngày kể từ đây.
      finalNoticeAt: { type: Date, default: null },
    }, subOptions),
    default: null,
  },
  access: {
    type: new Schema({
      method: enumOf(enumValues(AccessMethod)),
      keyTag: { type: String, default: null },
      credentialHash: { type: String, default: null, select: false },
      // PIN mã hoá AES-GCM để chủ hợp đồng xem lại (GET /contracts/:id/access). select:false → không bao giờ ra bootstrap/list.
      credentialEnc: { type: String, default: null, select: false },
      issuedAt: { type: Date, default: null }, issuedBy: refOpt('User'),
      suspendedAt: { type: Date, default: null }, revokedAt: { type: Date, default: null },
      // Khách báo mất thẻ / chìa (có yêu cầu cấp lại đang mở) — thẻ cũ coi như vô hiệu cho tới khi bàn giao thẻ mới.
      lostReportedAt: { type: Date, default: null },
      // Nhật ký nhân viên mở kho HỘ khách bằng chìa tổng / thẻ tổng — khách xem được, không sửa xoá.
      assistedOpens: {
        type: [new Schema({ at: { type: Date, required: true }, by: refReq('User'), byName: { type: String, required: true, maxlength: 100 }, reason: { type: String, required: true, maxlength: 300 }, forName: { type: String, default: null, maxlength: 100 } }, subOptions)],
        default: [],
      },
    }, subOptions),
    required: true,
  },
  terms: {
    type: new Schema({
      policyId: refReq('BusinessPolicy'), policyVersion: { type: Number, required: true },
      gracePeriodDays: { type: Number, required: true, min: 0 }, lockoutAfterDays: { type: Number, required: true, min: 0 },
      signedAt: { type: Date, required: true }, signatureRef: String, signerName: { type: String, default: null },
    }, subOptions),
    required: true, immutable: true,
  },
  // Đối chiếu giấy tờ tùy thân bản gốc của khách lúc bàn giao kho (chỉ 4 số cuối — không lưu số đầy đủ).
  identity: {
    type: new Schema({
      idType: { type: String, enum: ['CCCD', 'PASSPORT'], required: true }, idNumberLast4: { type: String, required: true, match: /^[A-Z0-9]{4}$/ },
      verifiedAt: { type: Date, required: true }, verifiedBy: refReq('User'), verifiedByName: { type: String, required: true, maxlength: 120 },
    }, subOptions),
    default: null,
  },
  // Kiểm tra hàng hoá khách mang vào lúc nhận kho (Điều 4): các nhóm hàng cấm nhân viên đã xác nhận KHÔNG có.
  intakeCheck: {
    type: new Schema({
      checkedAt: { type: Date, required: true }, checkedBy: refReq('User'),
      items: { type: [String], enum: INTAKE_CHECK_ITEMS.map((i) => i.key), default: [] },
      note: { type: String, default: null, maxlength: 500 },
      photoUrls: { type: [String], default: [], validate: maxLen(10) },
    }, subOptions),
    default: null,
  },
  // Thông báo công nợ đã gửi khách (email + trong tài khoản) — chứng cứ "đã báo trước" theo Điều 7 Điều khoản. Chỉ thêm, không sửa; giữ 200 bản gần nhất (bản đã gửi còn trong email / nhật ký).
  notices: {
    type: [new Schema({
      _id: { type: Schema.Types.ObjectId, required: true },
      kind: enumOf(enumValues(ContractNoticeKind)), at: { type: Date, required: true },
      amountDue: money(), deadline: { type: Date, default: null },
      note: { type: String, default: null, maxlength: 500 }, by: refOpt('User'),
      email: {
        type: new Schema({ status: enumOf(enumValues(NoticeEmailStatus)), to: { type: String, default: null }, at: { type: Date, default: null } }, subOptions),
        required: true,
      },
      // Nhắc hết hạn (EXPIRY_30 / EXPIRY_7): ngày hết hạn được nhắc — chống gửi trùng cho cùng một mốc.
      endDate: { type: Date, default: null },
      // Email không tới được khách: quản lý ghi nhận đã báo bằng kênh khác (điện thoại / thư bảo đảm / trực tiếp).
      manualDelivery: {
        type: new Schema({
          channel: { type: String, enum: ['PHONE', 'REGISTERED_MAIL', 'IN_PERSON'], required: true },
          note: { type: String, required: true, maxlength: 500 }, at: { type: Date, required: true }, by: refReq('User'),
        }, subOptions),
        default: null,
      },
    }, subOptions)],
    default: [], validate: maxLen(200),
  },
  // Người được chủ hợp đồng uỷ quyền ra vào / lấy đồ — nhân viên đối chiếu tại quầy. Tối đa 3.
  authorizedPersons: {
    type: [new Schema({
      _id: { type: String, required: true },
      fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
      phone: { type: String, required: true, maxlength: 20 },
      idNumberLast4: { type: String, required: true, match: /^\d{4}$/ },
      relationship: { type: String, default: null, maxlength: 60 },
      addedAt: { type: Date, required: true },
    }, { ...subOptions, _id: false })],
    default: [], validate: maxLen(MAX_AUTHORIZED_PERSONS),
  },
  renewals: {
    type: [new Schema({
      previousEndDate: { type: Date, required: true }, newEndDate: { type: Date, required: true },
      periods: { type: Number, required: true, min: 1 }, paymentId: refOpt('PaymentTransaction'), at: { type: Date, default: Date.now },
    }, subOptions)],
    default: [], validate: maxLen(120),
  },
  // Các kỳ cam kết nối tiếp nhau (kỳ gốc + từng lần gia hạn), mỗi kỳ một giá — xem RentalContract.commitments trong @ssm/shared.
  commitments: {
    type: [new Schema({
      kind: { type: String, enum: ['INITIAL', 'RENEWAL'], required: true },
      startDate: { type: Date, required: true }, endDate: { type: Date, required: true },
      periods: { type: Number, required: true, min: 1 },
      gross: money(), discountAmount: money(false), rate: money(),
      policyId: refOpt('BusinessPolicy'), at: { type: Date, default: Date.now },
      // Phụ lục gia hạn khách đã xác nhận điện tử — lưu NGUYÊN VĂN lúc xác nhận, cùng dấu vết (ai, lúc nào, từ đâu).
      appendix: {
        type: new Schema({
          number: { type: Number, required: true, min: 1 }, title: { type: String, required: true, maxlength: 200 },
          acceptedAt: { type: Date, required: true }, signerName: { type: String, required: true, maxlength: 120 }, signedBy: refOpt('User'),
          termsVersion: { type: String, required: true }, ip: { type: String, default: null }, userAgent: { type: String, default: null, maxlength: 400 },
          clauses: { type: [new Schema({ title: { type: String, required: true }, paragraphs: { type: [String], default: [] }, bullets: { type: [String], default: [] } }, subOptions)], default: [] },
          lessorSignatory: { type: new Schema({ name: { type: String, default: null, maxlength: 120 }, authorization: { type: String, default: null, maxlength: 300 } }, subOptions), default: null }, // đại diện Bên A lúc xác nhận phụ lục
        }, subOptions),
        default: null,
      },
    }, subOptions)],
    default: [], validate: maxLen(120),
  },
  unitSwaps: {
    type: [new Schema({
      fromUnitId: refReq('StorageUnit'), toUnitId: refReq('StorageUnit'),
      reason: { type: String, required: true, maxlength: 500 },
      fee: money(false), paymentId: refOpt('PaymentTransaction'),
      at: { type: Date, default: Date.now }, by: refOpt('User'),
    }, subOptions)],
    default: [], validate: maxLen(20),
  },
  moveOut: {
    type: new Schema({
      requestedAt: { type: Date, required: true }, scheduledFor: { type: Date, default: null }, returnedOn: { type: Date, default: null },
      completedAt: { type: Date, default: null }, inspectionId: refOpt('InspectionLog'),
      // Nhân viên / quản lý đăng ký trả kho THAY khách: lý do bắt buộc (khách tự đăng ký thì null) + người bấm.
      reason: { type: String, default: null, maxlength: 300 }, requestedBy: refOpt('User'),
      // Xác nhận bàn giao lúc nhận lại kho: khách ký tay trên màn hình (ảnh PNG — không gửi ra bootstrap / danh sách) hoặc Quản lý
      // chi nhánh xác nhận khi khách vắng mặt (kèm lý do).
      handover: {
        type: new Schema({
          method: { type: String, enum: ['CUSTOMER_SIGNATURE', 'MANAGER_CONFIRM'], required: true },
          at: { type: Date, required: true }, by: refReq('User'),
          signerName: { type: String, default: null, maxlength: 120 }, image: { type: String, default: null, maxlength: 80_000 },
          reason: { type: String, default: null, maxlength: 300 },
        }, subOptions),
        default: null,
      },
    }, subOptions),
    default: null,
  },
  // Đồ khách để lại sau khi trả kho: giữ LEFTOVER_HOLD_DAYS ngày (ô ở MAINTENANCE) rồi khách lấy / chi nhánh xử lý (Điều 9).
  leftover: {
    type: new Schema({
      description: { type: String, required: true, maxlength: 1000 },
      photoUrls: { type: [String], default: [], validate: maxLen(10) },
      holdUntil: { type: Date, required: true },
      status: { type: String, enum: ['HELD', 'PICKED_UP', 'DISPOSED'], required: true },
      recordedAt: { type: Date, default: null }, resolvedAt: { type: Date, default: null }, resolvedBy: refOpt('User'),
      fee: { type: Number, default: null, min: 0 }, note: { type: String, default: null, maxlength: 500 },
      feePaymentId: refOpt('PaymentTransaction'),
    }, subOptions),
    default: null,
  },
  closedAt: { type: Date, default: null },
  statusHistory: { type: [statusHistorySchema(enumValues(ContractStatus))], default: [], validate: maxLen(100) },
}, { ...baseOptions, collection: 'rentalContracts', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(appendOnlyPlugin, { allowUpdates: true });

/** Giới hạn lịch sử trạng thái lưu trên hợp đồng (đủ cho vài năm nợ / trả xen kẽ); bản đầy đủ nằm ở nhật ký kiểm toán. */
const STATUS_HISTORY_MAX = 100;
schema.method('transitionTo', function (to: ContractStatus, ctx: TransitionCtx) {
  applyTransition('RentalContract', this, CONTRACT_MACHINE, to, ctx);
  // Hợp đồng thuê lâu, hay trả trễ (mỗi tháng ACTIVE→DELINQUENT→ACTIVE) sẽ chạm giới hạn — vượt là ValidationError, kẹt luôn
  // việc thu nợ / trả kho. Giữ mục đầu tiên (lúc tạo) và các mục gần nhất.
  if (this.statusHistory.length > STATUS_HISTORY_MAX) this.statusHistory.splice(1, this.statusHistory.length - STATUS_HISTORY_MAX);
});

schema.pre('validate', function () {
  if (this.isNew && !this.contractNumber) this.contractNumber = humanCode('CTR');
  if (this.endDate <= this.startDate) this.invalidate('endDate', 'must be after startDate');
  const s = this.status;
  if ((s === 'DELINQUENT' || s === 'LOCKED_OUT') && !this.delinquency) this.invalidate('delinquency', `required when ${s}`);
  if (s === 'LOCKED_OUT' && !this.delinquency?.lockedOutAt) this.invalidate('delinquency.lockedOutAt', 'required when LOCKED_OUT');
  if (s === 'MOVE_OUT_PENDING' && !this.moveOut) this.invalidate('moveOut', 'required when MOVE_OUT_PENDING');
  if ((s === 'CLOSED' || s === 'ABANDONED') && !this.closedAt) this.invalidate('closedAt', `required when ${s}`);
  if (this.deposit.refundedAmount > this.deposit.amount) this.invalidate('deposit.refundedAmount', 'exceeds deposit');
});

schema.index({ contractNumber: 1 }, { unique: true });
schema.index({ reservationId: 1 }, { unique: true });
schema.index({ unitId: 1 }, { unique: true, partialFilterExpression: { status: { $in: [...OPEN_CONTRACT_STATUSES] } } });
schema.index({ facilityId: 1, status: 1, 'billing.nextBillingDate': 1 });
schema.index({ facilityId: 1, status: 1, endDate: 1 });
schema.index({ customerId: 1, status: 1 });
schema.index({ status: 1, 'billing.paidThrough': 1 });
schema.index({ 'leftover.status': 1, facilityId: 1 }, { partialFilterExpression: { 'leftover.status': 'HELD' } });

export const RentalContractModel = model<RentalContractDoc, RentalContractModelType>('RentalContract', schema);
