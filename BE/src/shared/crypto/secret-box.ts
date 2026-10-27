import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Mã hoá hai chiều (AES-256-GCM) cho dữ liệu khách phải XEM LẠI được — hiện chỉ có mật khẩu mở kho (PIN).
 * Khác với băm một chiều: chủ hợp đồng cần thấy lại PIN trong app. Bản mã chỉ nằm trong DB (select:false, không
 * bao giờ ra bootstrap) và chỉ giải mã ở GET /contracts/:id/access cho đúng chủ hợp đồng.
 *
 * Khoá suy từ ACCESS_CODE_SECRET (nên đặt ở production); chưa đặt thì suy từ FIREBASE_PRIVATE_KEY.
 * Chuyển khoá an toàn: PIN mã hoá TRƯỚC khi có ACCESS_CODE_SECRET (khoá suy từ FIREBASE_PRIVATE_KEY, đang nằm trên Atlas) vẫn đọc được —
 * giải mã thử khoá mới, sai thì thử khoá cũ; mã hoá mới luôn bằng khoá mới.
 */
const derive = (secret: string) => createHash('sha256').update(`ssm:access-code:v1:${secret}`).digest();
const key = () => derive(env.ACCESS_CODE_SECRET ?? env.FIREBASE_PRIVATE_KEY);
/** Khoá để đọc: khoá hiện hành, rồi khoá cũ suy từ FIREBASE_PRIVATE_KEY (khi đã có ACCESS_CODE_SECRET). */
const readKeys = () => (env.ACCESS_CODE_SECRET ? [key(), derive(env.FIREBASE_PRIVATE_KEY)] : [key()]);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

/** null nếu bản mã hỏng hoặc sai khoá — không bao giờ ném lỗi ra ngoài. */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  for (const k of readKeys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch { /* sai khoá → thử khoá kế */ }
  }
  return null;
}
