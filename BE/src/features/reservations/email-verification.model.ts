import { Schema, model } from 'mongoose';
import { baseOptions, refReq, type OID } from '../../shared/db/schema-kit';

/**
 * Mã xác minh EMAIL khi nhân viên tạo tài khoản cho khách mới tại quầy (POST /reservations/walk-in/email-otp): mã 6 số gửi tới email
 * khách khai, khách đọc lại cho nhân viên nhập — chứng minh email đúng của khách trước khi hệ thống gửi thông báo hợp đồng tới đó.
 * Một bản ghi cho mỗi email (gửi lại thì ghi đè), chỉ lưu sha256 của mã; dùng xong thì xoá. Bản ghi hết hạn tự dọn sau 1 ngày.
 *
 * Cùng cơ chế cho mã OTP khi khách ký biên bản trả kho tại quầy (`purpose: 'MOVE_OUT'`, POST /contracts/:id/move-out/otp): mã gửi tới
 * email tài khoản chủ hợp đồng, gắn với `contractId`. Mỗi lần chỉ dùng được cho đúng mục đích của nó: mã tạo tài khoản tại quầy (email chưa
 * có tài khoản) và mã trả kho (email của khách đã có tài khoản) không thay được cho nhau. Bản ghi cũ thiếu `purpose` = WALK_IN.
 */
export interface EmailVerificationDoc {
  _id: OID;
  emailLower: string; codeHash: string; expiresAt: Date; attempts: number;
  requestedBy: OID; lastSentAt: Date; createdAt: Date; updatedAt: Date;
  purpose?: 'WALK_IN' | 'MOVE_OUT'; contractId?: OID | null;
}

const schema = new Schema<EmailVerificationDoc>({
  emailLower: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0 },
  requestedBy: refReq('User'),
  lastSentAt: { type: Date, required: true },
  purpose: { type: String, enum: ['WALK_IN', 'MOVE_OUT'], default: 'WALK_IN' },
  contractId: { type: Schema.Types.ObjectId, ref: 'RentalContract', default: null },
}, { ...baseOptions, collection: 'emailVerifications' });

schema.index({ emailLower: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const EmailVerificationModel = model<EmailVerificationDoc>('EmailVerification', schema);
