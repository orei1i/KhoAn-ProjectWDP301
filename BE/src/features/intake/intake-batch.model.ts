import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import {
  enumValues, INTAKE_BATCH_MACHINE, INTAKE_CATEGORY_MAX, INTAKE_CHECK_ITEMS, INTAKE_ITEM_NAME_MAX, INTAKE_ITEM_NAME_MIN, INTAKE_MAX_ITEMS, INTAKE_NOTE_MAX,
  INTAKE_QTY_MAX, INTAKE_VALUE_MAX, IntakeBatchStatus, IntakeItemCondition, IntakeRemovalKind, OPEN_INTAKE_BATCH_STATUSES, type IntakeBatch,
} from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, money, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, appendOnlyPlugin, historyCapPlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

/**
 * Đợt NHẬP HÀNG (đợt 14) — collection `intakeBatches`. Khách khai danh sách đồ mỗi lần mang vào kho, nhân viên chi nhánh kiểm hàng cấm
 * và xác nhận danh sách thực tế. Các đợt CONFIRMED của một hợp đồng là "đồ đang gửi" — căn cứ khi xét bồi thường (Điều 6).
 */
export type IntakeBatchDoc = IntakeBatch<OID, Date>;
interface Methods { transitionTo(to: IntakeBatchStatus, ctx: TransitionCtx): void }
export type IntakeBatchModelType = Model<IntakeBatchDoc, {}, Methods>;
export type IntakeBatchHydrated = HydratedDocument<IntakeBatchDoc, Methods>;

/** Đợt 15 (A7): một lần đồ ra khỏi kho — `at` là NGÀY Việt Nam (date-only 00:00Z). */
const removalSchema = new Schema({
  kind: enumOf(enumValues(IntakeRemovalKind)),
  quantity: { type: Number, required: true, min: 1, max: INTAKE_QTY_MAX, validate: Number.isInteger },
  at: { type: Date, required: true },
  by: refOpt('User'),
  note: { type: String, default: null, maxlength: INTAKE_NOTE_MAX },
}, { ...subOptions, _id: false });

/** Một dòng đồ. `_id` là chuỗi 24 hex do server sinh (như người được uỷ quyền) — hồ sơ bồi thường trỏ tới bằng chuỗi này. */
const itemSchema = new Schema({
  _id: { type: String, required: true, maxlength: 40 },
  name: { type: String, required: true, trim: true, minlength: INTAKE_ITEM_NAME_MIN, maxlength: INTAKE_ITEM_NAME_MAX },
  category: { type: String, default: null, trim: true, maxlength: INTAKE_CATEGORY_MAX },
  quantity: { type: Number, required: true, min: 1, max: INTAKE_QTY_MAX, validate: Number.isInteger },
  estValue: { ...money(), max: INTAKE_VALUE_MAX },
  condition: enumOf(enumValues(IntakeItemCondition)),
  note: { type: String, default: null, maxlength: INTAKE_NOTE_MAX },
  // Đợt 15 — KHÔNG đặt default: tài liệu cũ giữ nguyên (thiếu = chưa ra kho lần nào / dòng khách khai).
  addedByStaff: { type: Boolean },
  removals: { type: [removalSchema], default: undefined },
}, { ...subOptions, _id: false });

const schema = new Schema<IntakeBatchDoc, IntakeBatchModelType, Methods>({
  code: { type: String, required: true, immutable: true },
  contractId: { ...refReq('RentalContract'), immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  status: enumOf(enumValues(IntakeBatchStatus), 'DECLARED'),
  items: { type: [itemSchema], default: [], validate: maxLen(INTAKE_MAX_ITEMS) },
  // Bản khách khai ban đầu — chỉ lưu khi nhân viên sửa danh sách lúc xác nhận.
  declaredItems: { type: [itemSchema], default: undefined },
  declaredAt: { type: Date, required: true, immutable: true },
  declaredBy: { ...refReq('User'), immutable: true },
  onBehalf: { type: Boolean, default: false }, // không đặt immutable: mongoose + strict 'throw' báo lỗi khi lưu lại tài liệu đã nạp
  expectedDate: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
  confirmedBy: refOpt('User'),
  goodsCheck: {
    type: new Schema({
      confirmed: { type: [String], enum: INTAKE_CHECK_ITEMS.map((i) => i.key), default: [] },
      note: { type: String, default: null, maxlength: 500 },
    }, subOptions),
    default: null,
  },
  rejectReason: { type: String, default: null, maxlength: 500 },
  cancelReason: { type: String, maxlength: 500 }, // đợt 15: nhân viên huỷ / hệ thống tự huỷ (không default — tài liệu cũ giữ nguyên)
  staffNote: { type: String, default: null, maxlength: 500 },
  statusHistory: { type: [statusHistorySchema(enumValues(IntakeBatchStatus))], default: [], validate: maxLen(10) },
}, { ...baseOptions, collection: 'intakeBatches', optimisticConcurrency: true });

schema.plugin(actorStampPlugin);
schema.plugin(historyCapPlugin, { statusHistory: 10 });
schema.plugin(appendOnlyPlugin, { allowUpdates: true }); // chứng cứ đồ đã gửi: cập nhật được, không xoá

schema.method('transitionTo', function (to: IntakeBatchStatus, ctx: TransitionCtx) {
  applyTransition('IntakeBatch', this, INTAKE_BATCH_MACHINE, to, ctx);
});

schema.pre('validate', function () {
  if (this.isNew && !this.code) this.code = humanCode('IN');
  if (this.isNew && this.statusHistory.length === 0) this.statusHistory.push({ from: null, to: this.status, at: new Date() });
  if (this.items.length === 0) this.invalidate('items', 'phải khai ít nhất một món đồ');
  if (new Set(this.items.map((i) => i._id)).size !== this.items.length) this.invalidate('items', 'mã dòng bị trùng');
  if (this.status === 'CONFIRMED' && (!this.confirmedAt || !this.goodsCheck)) this.invalidate('confirmedAt', 'required when CONFIRMED');
  if (this.status === 'REJECTED' && !this.rejectReason) this.invalidate('rejectReason', 'required when REJECTED');
  // Không ra kho nhiều hơn số đã nhập.
  for (const it of this.items) {
    const out = (it.removals ?? []).reduce((s, r) => s + r.quantity, 0);
    if (out > it.quantity) this.invalidate('items', `"${it.name}": số đã ra khỏi kho (${out}) vượt số đã nhập (${it.quantity})`);
  }
});

schema.index({ code: 1 }, { unique: true });
schema.index({ contractId: 1, status: 1, createdAt: -1 });
schema.index({ facilityId: 1, status: 1, declaredAt: -1 });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ facilityId: 1, declaredAt: -1 }, { partialFilterExpression: { status: { $in: [...OPEN_INTAKE_BATCH_STATUSES] } } });

export const IntakeBatchModel = model<IntakeBatchDoc, IntakeBatchModelType>('IntakeBatch', schema);
