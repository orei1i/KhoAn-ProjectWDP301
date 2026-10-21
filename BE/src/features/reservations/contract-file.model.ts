import { Schema, model } from 'mongoose';
import { PAPER_CONTRACT_MAX_BYTES, PAPER_CONTRACT_TYPES } from '@ssm/shared';
import { baseOptions, refReq, type OID } from '../../shared/db/schema-kit';

/**
 * Bản scan hợp đồng GIẤY khách ký tại quầy (PDF / JPG / PNG ≤ 5MB), nhân viên tải lên — lưu thẳng trong MongoDB (không cần dịch vụ
 * lưu trữ ngoài). Không gửi qua /bootstrap; tải về qua GET /reservations/:id/signed-file (khách chủ đặt chỗ / nhân viên chi nhánh).
 */
export interface ContractFileDoc {
  _id: OID;
  reservationId: OID; facilityId: OID; customerId: OID;
  fileName: string; contentType: string; size: number; sha256: string; data: Buffer;
  uploadedBy: OID; createdAt: Date; updatedAt: Date;
}

const schema = new Schema<ContractFileDoc>({
  reservationId: { ...refReq('Reservation'), immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  customerId: { ...refReq('User'), immutable: true },
  fileName: { type: String, required: true, trim: true, maxlength: 200 },
  contentType: { type: String, required: true, enum: [...PAPER_CONTRACT_TYPES] },
  size: { type: Number, required: true, min: 1, max: PAPER_CONTRACT_MAX_BYTES },
  sha256: { type: String, required: true },
  data: { type: Buffer, required: true },
  uploadedBy: { ...refReq('User'), immutable: true },
}, { ...baseOptions, collection: 'contractFiles' });

schema.index({ reservationId: 1 });

export const ContractFileModel = model<ContractFileDoc>('ContractFile', schema);
