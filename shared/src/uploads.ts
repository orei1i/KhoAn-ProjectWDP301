/**
 * ẢNH CHỨNG CỨ tải lên từ máy (RV3) — dùng chung BE (kiểm), Webapp và app (nén ảnh trước khi gửi).
 * Ảnh hư hại / mất mát khi báo bồi thường, ảnh đồ khách để lại và hư hại khi trả kho, ảnh hiện trạng khi xử lý hàng bỏ lại.
 */
export const EVIDENCE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type EvidencePhotoType = (typeof EVIDENCE_PHOTO_TYPES)[number];
/** Dung lượng tối đa một ảnh SAU khi nén ở máy người dùng. */
export const EVIDENCE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
/** Cạnh dài tối đa khi nén ảnh ở máy (px) — đủ rõ để xem vết hư hại, nhẹ để gửi qua mạng di động. */
export const EVIDENCE_PHOTO_MAX_EDGE = 1600;
/** Số ảnh tối đa mỗi lần báo bồi thường. */
export const CLAIM_PHOTOS_MAX = 10;
/** Link ảnh tải lên qua KhoAn (để hiện ảnh thu nhỏ thay vì chỉ một đường link). */
export const isUploadedPhotoUrl = (url: string) => /\/api\/uploads\/photos\/[A-Za-z0-9_-]{32}$/.test(url);
