import type { Types } from 'mongoose';
import type { RentalContractHydrated, StorageUnitDoc } from '../../shared/db/models';
import { encryptSecret } from '../../shared/crypto/secret-box';
import { sha256, sixDigitPin } from '../payments/payment.service';

/**
 * Hợp đồng vừa chuyển sang ô `unit` (đổi ô). Hình thức khoá thuộc về TỪNG Ô — hai ô cùng loại có thể khác khoá —
 * nên hợp đồng phải mang đúng hình thức khoá của ô mới; nếu không khách vẫn thấy mật khẩu của ô cũ trong khi ô mới
 * dùng chìa, và nhân viên không mở hộ được vì hệ thống tưởng là ô mật khẩu.
 *
 *  - Cùng hình thức: giữ nguyên phương tiện đang có; chỉ ghi nhãn chìa/thẻ mới nếu nhân viên nhập.
 *  - Khác hình thức: phương tiện cũ hết hiệu lực. Sang ô mật khẩu → sinh mật khẩu mới (trả về đúng một lần, khách
 *    xem lại được trong tài khoản). Sang ô thẻ/chìa → ghi nhãn nhân viên vừa giao.
 */
export function moveAccessToUnit(c: RentalContractHydrated, unit: Pick<StorageUnitDoc, 'accessMethod'>, by: Types.ObjectId, keyTag?: string): { changed: boolean; pin?: string } {
  const now = new Date();
  if (c.access.method === unit.accessMethod) {
    if (keyTag !== undefined && unit.accessMethod !== 'PIN') {
      c.access.keyTag = keyTag || null;
      c.access.issuedAt = now;
      c.access.issuedBy = by;
    }
    return { changed: false };
  }
  const pin = unit.accessMethod === 'PIN' ? sixDigitPin() : undefined;
  c.access.method = unit.accessMethod;
  c.access.keyTag = pin ? null : keyTag || null;
  c.access.credentialHash = pin ? sha256(pin) : null;
  c.access.credentialEnc = pin ? encryptSecret(pin) : null;
  c.access.issuedAt = now;
  c.access.issuedBy = by;
  c.set('access.lostReportedAt', null); // báo mất gắn với thẻ/chìa của ô cũ
  return { changed: true, pin };
}
