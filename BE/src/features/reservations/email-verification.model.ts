import { Schema, model } from 'mongoose';
import { baseOptions, refReq, type OID } from '../../shared/db/schema-kit';

/**
 * Mã xác minh EMAIL khi nhân viên tạo tài khoản cho khách mới tại quầy (POST /reservations/walk-in/email-otp): mã 6 số gửi tới email
 * khách khai, khách đọc lại cho nhân viên nhập — chứng minh email đúng của khách trước khi hệ thống gửi thông báo hợp đồng tới đó.
 * Một bản ghi cho mỗi email (gửi lại thì ghi đè), chỉ lưu sha256 của mã; dùng xong thì xoá. Bản ghi hết hạn tự dọn sau 1 ngày.
 */
export interface EmailVerificationDoc {
  _id: OID;
  emailLower: string; codeHash: string; expiresAt: Date; attempts: number;
  requestedBy: OID; lastSentAt: Date; createdAt: Date; updatedAt: Date;
}

const schema = new Schema<EmailVerificationDoc>({
  emailLower: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0 },
  requestedBy: refReq('User'),
  lastSentAt: { type: Date, required: true },
}, { ...baseOptions, collection: 'emailVerifications' });

schema.index({ emailLower: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const EmailVerificationModel = model<EmailVerificationDoc>('EmailVerification', schema);
