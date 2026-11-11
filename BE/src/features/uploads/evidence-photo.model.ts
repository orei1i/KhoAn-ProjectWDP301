import { Schema, model } from 'mongoose';
import { EVIDENCE_PHOTO_MAX_BYTES, EVIDENCE_PHOTO_TYPES } from '@ssm/shared';
import { baseOptions, refReq, type OID } from '../../shared/db/schema-kit';

/**
 * ẢNH CHỨNG CỨ tải lên từ máy (RV3 — thay cho việc dán link ảnh): ảnh hư hại / mất mát khi khách báo bồi thường, ảnh đồ khách để lại và
 * hư hại khi trả kho, ảnh hiện trạng… Lưu thẳng trong MongoDB như bản scan hợp đồng giấy (không cần dịch vụ lưu trữ ngoài). Ảnh được
 * nén ở máy người dùng trước khi gửi (≤ EVIDENCE_PHOTO_MAX_BYTES).
 *
 * `token`: chuỗi ngẫu nhiên 24 byte — URL ảnh là /api/uploads/photos/<token> (link "khó đoán", không cần đăng nhập để thẻ <img> và app
 * hiển thị được). Chỉ ai được xem hồ sơ chứa link mới biết link.
 */
export interface EvidencePhotoDoc {
  _id: OID;
  token: string; contentType: string; size: number; sha256: string; data: Buffer;
  uploadedBy: OID; createdAt: Date; updatedAt: Date;
}

const schema = new Schema<EvidencePhotoDoc>({
  token: { type: String, required: true, immutable: true },
  contentType: { type: String, required: true, enum: [...EVIDENCE_PHOTO_TYPES] },
  size: { type: Number, required: true, min: 1, max: EVIDENCE_PHOTO_MAX_BYTES },
  sha256: { type: String, required: true },
  data: { type: Buffer, required: true },
  uploadedBy: { ...refReq('User'), immutable: true },
}, { ...baseOptions, collection: 'evidencePhotos' });

schema.index({ token: 1 }, { unique: true });
schema.index({ uploadedBy: 1, createdAt: -1 });

export const EvidencePhotoModel = model<EvidencePhotoDoc>('EvidencePhoto', schema);
