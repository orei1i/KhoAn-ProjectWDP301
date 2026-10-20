import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { enumValues, FACILITY_SCOPED_ROLES, Role, STAFF_SHIFTS, UserStatus, type User } from '@ssm/shared';
import { baseOptions, enumOf, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, softDeletePlugin } from '../../shared/db/plugins';

export type UserDoc = User<OID, Date>;
interface Methods { softDelete(by?: string): Promise<unknown> }
export type UserModelType = Model<UserDoc, {}, Methods>;
export type UserHydrated = HydratedDocument<UserDoc, Methods>;

const schema = new Schema<UserDoc, UserModelType, Methods>({
  firebaseUid: { type: String, default: null, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  phone: { type: String, default: null, trim: true, match: /^\+?\d{9,15}$/ },
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  role: enumOf(enumValues(Role), 'CUSTOMER'),
  facilityIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Facility' }], default: [] },
  status: enumOf(enumValues(UserStatus), 'PENDING_VERIFICATION'),
  tokenVersion: { type: Number, default: 0, min: 0 },
  lastLoginAt: { type: Date, default: null },
  // Bằng chứng khách chấp thuận Điều khoản + Chính sách bảo mật lúc tạo tài khoản.
  // KHÔNG đặt required: tài khoản có trước tính năng này vẫn phải save() được khi đổi vai trò/trạng thái.
  // Ràng buộc bắt buộc nằm ở tầng API (auth.routes.ts). immutable vì bằng chứng đã ghi thì không sửa.
  consent: {
    type: new Schema({
      termsVersion: { type: String, required: true, maxlength: 20 },
      privacyVersion: { type: String, required: true, maxlength: 20 },
      acceptedAt: { type: Date, required: true },
      method: { type: String, enum: ['SIGNUP_FORM', 'GOOGLE'], required: true },
    }, subOptions),
    default: null,
    immutable: true,
  },
  // Chỉ Quản lý chi nhánh: giấy uỷ quyền ký hợp đồng thay Bên A (số, ngày) — in vào hợp đồng / phụ lục của chi nhánh.
  authorization: {
    type: new Schema({ number: { type: String, required: true, trim: true, maxlength: 60 }, issuedOn: { type: Date, required: true } }, subOptions),
    default: null,
  },
  customerProfile: {
    type: new Schema({
      idType: { type: String, enum: ['CCCD', 'PASSPORT'] },
      idNumberLast4: { type: String, match: /^[A-Za-z0-9]{4}$/ },
      address: { type: String, maxlength: 300 },
      emergencyContact: { type: new Schema({ name: String, phone: String }, subOptions) },
      // Tài khoản nhận tiền hoàn (khách tự khai) — chỉ dùng để chuyển khoản hoàn tiền giữ chân / tiền thanh lý còn dư.
      payoutAccount: {
        type: new Schema({
          bankName: { type: String, required: true, trim: true, maxlength: 80 }, accountNumber: { type: String, required: true, match: /^\d{6,20}$/ },
          accountName: { type: String, required: true, trim: true, maxlength: 100 },
        }, subOptions),
        default: null,
      },
    }, subOptions),
    default: null,
  },
  // Ca làm việc cố định — chỉ STAFF mới có (bắt buộc), enum loại trừ UNKNOWN (nhân viên phải chốt 1 ca cụ thể).
  shift: { type: String, enum: [...STAFF_SHIFTS, null], default: null },
}, { ...baseOptions, collection: 'users' });

schema.plugin(actorStampPlugin);
schema.plugin(softDeletePlugin);

// RBAC invariant: chỉ STAFF / FACILITY_MANAGER có phạm vi chi nhánh.
// FACILITY_MANAGER quản lý ĐÚNG MỘT chi nhánh — một kho một quản lý, không kiêm nhiệm.
schema.pre('validate', function () {
  const scoped = FACILITY_SCOPED_ROLES.includes(this.role);
  if (scoped && this.facilityIds.length === 0) this.invalidate('facilityIds', `${this.role} requires >= 1 facilityId`);
  if (this.role === 'FACILITY_MANAGER' && this.facilityIds.length !== 1) this.invalidate('facilityIds', 'FACILITY_MANAGER phải quản lý đúng 1 chi nhánh');
  if (!scoped && this.facilityIds.length > 0) this.invalidate('facilityIds', `${this.role} must not be facility-scoped`);
  if (this.role !== 'CUSTOMER' && this.customerProfile) this.invalidate('customerProfile', 'customers only');
  if (this.role !== 'FACILITY_MANAGER' && this.authorization) this.invalidate('authorization', 'facility managers only');
  // Nhân viên chia theo ca (nhận kho theo hàng đợi đúng ca) — bắt buộc 1 ca cụ thể; vai trò khác không có ca.
  if (this.role === 'STAFF' && !this.shift) this.invalidate('shift', 'STAFF requires a fixed shift');
  if (this.role !== 'STAFF' && this.shift) this.invalidate('shift', `${this.role} must not have a shift`);
  if (!this.isNew && (this.isModified('role') || this.isModified('facilityIds') || this.isModified('status'))) this.tokenVersion += 1;
});

schema.index({ firebaseUid: 1 }, { unique: true, partialFilterExpression: { firebaseUid: { $type: 'string' } } });
schema.index({ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
schema.index({ phone: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, phone: { $type: 'string' } } });
schema.index({ role: 1, facilityIds: 1, status: 1 });

export const UserModel = model<UserDoc, UserModelType>('User', schema);

/**
 * Trường người dùng Quản trị viên được nhận (bootstrap ADMIN, GET/PATCH /users) — liệt kê đúng những gì trang Người dùng & phân quyền
 * và Nhật ký dùng: họ tên, email, vai trò, chi nhánh, trạng thái, lần đăng nhập; `shift` + `authorization` (số / ngày giấy uỷ quyền
 * của Quản lý chi nhánh) vì form sửa tài khoản hiển thị và sửa được; `tokenVersion` để báo số lần bị thu hồi phiên.
 * KHÔNG gửi `customerProfile` (giấy tờ tuỳ thân, địa chỉ, người liên hệ khẩn cấp, tài khoản nhận tiền), số điện thoại, firebaseUid,
 * consent — trang admin không dùng; Chính sách bảo mật: tài khoản nhận tiền chỉ Quản lý chi nhánh / vận hành xem khi có khoản chờ chuyển.
 * Dạng danh sách cho phép (không phải loại trừ) để trường cá nhân thêm sau này không tự lọt sang admin.
 */
export const ADMIN_USER_FIELDS = {
  fullName: 1, email: 1, role: 1, facilityIds: 1, status: 1, lastLoginAt: 1, shift: 1, authorization: 1, tokenVersion: 1,
  isDeleted: 1, createdAt: 1, updatedAt: 1,
} as const;
