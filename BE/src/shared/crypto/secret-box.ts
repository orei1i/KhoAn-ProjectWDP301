import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Mã hoá hai chiều (AES-256-GCM) cho dữ liệu khách phải XEM LẠI được — hiện chỉ có mật khẩu mở kho (PIN).
 * Khác với băm một chiều: chủ hợp đồng cần thấy lại PIN trong app. Bản mã chỉ nằm trong DB (select:false, không
 * bao giờ ra bootstrap) và chỉ giải mã ở GET /contracts/:id/access cho đúng chủ hợp đồng.
 *
 * Khoá suy từ ACCESS_CODE_SECRET; chưa đặt thì suy từ FIREBASE_PRIVATE_KEY (luôn có và ổn định giữa các lần deploy).
 * Đổi khoá thì các PIN đã mã hoá không giải được — khách chỉ cần xin đặt lại mật khẩu.
 */
const key = () => createHash('sha256').update(`ssm:access-code:v1:${env.ACCESS_CODE_SECRET ?? env.FIREBASE_PRIVATE_KEY}`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

/** null nếu bản mã hỏng hoặc sai khoá — không bao giờ ném lỗi ra ngoài. */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const [v, iv, tag, data] = blob.split('.');
    if (v !== 'v1' || !iv || !tag || !data) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
