import type { Types } from 'mongoose';
import type { RentalContractHydrated, StorageUnitDoc } from '../../shared/db/models';
import { encryptSecret } from '../../shared/crypto/secret-box';
import { Unprocessable } from '../../shared/core/errors';
import { sha256, sixDigitPin } from '../payments/payment.service';

/**
 * Hợp đồng vừa chuyển sang ô `unit` (đổi ô cùng loại hay đổi cỡ, tại quầy hay qua yêu cầu). Hình thức khoá thuộc về TỪNG Ô — hai ô cùng loại
 * có thể khác khoá — nên hợp đồng mang đúng hình thức khoá của ô mới.
 *
 * Đợt 16 (B1): đổi ô LUÔN cấp phương tiện mở MỚI, làm như nhận kho cho ô mới (khác trước: cùng hình thức khoá thì giữ PIN / chìa cũ):
 *  - ô mật khẩu → sinh mật khẩu ban đầu mới (trả về đúng một lần, khách xem lại trong tài khoản như lúc nhận kho);
 *  - ô chìa / thẻ → BẮT BUỘC nhập mã chìa / số thẻ vừa giao (thiếu → 422 KEYTAG_REQUIRED).
 * Cờ "báo mất" (và xác nhận đã khoá thẻ cũ) thuộc về thẻ / chìa của ô cũ — xoá. Ô cũ phải được ghi nhận thu chìa / thẻ hoặc đặt lại ổ
 * khoá (oldUnitAccessReset) mới mở cho thuê lại.
 */
export function moveAccessToUnit(c: RentalContractHydrated, unit: Pick<StorageUnitDoc, 'accessMethod' | 'unitNumber'>, by: Types.ObjectId, keyTag?: string): { changed: boolean; pin?: string } {
  const tag = keyTag?.trim() || '';
  if (unit.accessMethod !== 'PIN' && !tag) {
    throw Unprocessable(`Ô ${unit.unitNumber} dùng ${unit.accessMethod === 'RFID_CARD' ? 'thẻ' : 'chìa'} — nhập mã chìa / số thẻ MỚI đã giao cho khách`, 'KEYTAG_REQUIRED');
  }
  const changed = c.access.method !== unit.accessMethod;
  const pin = unit.accessMethod === 'PIN' ? sixDigitPin() : undefined;
  c.access.method = unit.accessMethod;
  c.access.keyTag = pin ? null : tag;
  c.access.credentialHash = pin ? sha256(pin) : null;
  c.access.credentialEnc = pin ? encryptSecret(pin) : null;
  c.access.issuedAt = new Date();
  c.access.issuedBy = by;
  c.set('access.lostReportedAt', null);
  c.set('access.lostBlockedAt', null);
  c.set('access.lostBlockedBy', null);
  c.set('access.lostBlockedByName', null);
  return { changed, pin };
}

/**
 * Đợt 16 (B1): việc của Ô CŨ khi khách chuyển đi — ghi vào `accessReset` trong cùng lệnh nhả ô (PENDING_INSPECTION). Gọi TRƯỚC
 * moveAccessToUnit (còn hình thức khoá / số thẻ cũ của hợp đồng). `done` = nhân viên đã thu chìa / thẻ cũ hoặc đã đặt lại ổ khoá ngay lúc đổi.
 */
export function oldUnitAccessReset(c: Pick<RentalContractHydrated, '_id' | 'contractNumber' | 'access'>, now: Date, done?: { by: Types.ObjectId; byName: string } | null) {
  return {
    contractId: c._id, contractNumber: c.contractNumber ?? null, method: c.access.method, keyTag: c.access.method === 'PIN' ? null : c.access.keyTag ?? null,
    requiredAt: now, doneAt: done ? now : null, doneBy: done?.by ?? null, doneByName: done?.byName ?? null,
    note: done ? 'Ghi nhận ngay khi đổi ô' : null,
  };
}

/** Câu việc cần làm với ô cũ theo hình thức khoá (giao diện, email, lỗi). */
export const accessResetTask = (method: string, keyTag?: string | null) =>
  method === 'PIN' ? 'đặt lại ổ khoá mật khẩu' : `thu ${method === 'RFID_CARD' ? 'thẻ' : 'chìa'} cũ${keyTag ? ` ${keyTag}` : ''}`;
