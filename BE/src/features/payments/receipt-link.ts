import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../shared/config/env';
import { AppError, Forbidden } from '../../shared/core/errors';
import { UserModel, type UserHydrated } from '../../shared/db/models';
import { assertReceiptAvailable } from './receipt-pdf';

/**
 * LINK TẢI BIÊN LAI NGẮN HẠN cho ứng dụng di động: app không có thư viện tải / lưu file, nên xin một URL ký HMAC (sống 5 phút) rồi mở
 * bằng trình duyệt của máy (Linking) — trình duyệt tải PDF mà không cần token đăng nhập. URL gắn với MỘT khoản và MỘT người dùng: lúc
 * mở, server kiểm tra lại người đó còn hoạt động và vẫn có quyền xem biên lai này (như GET /payments/:id/receipt.pdf).
 * Không lưu gì vào DB; khoá suy từ ACCESS_CODE_SECRET (chưa đặt thì FIREBASE_PRIVATE_KEY) như secret-box.
 */
export const RECEIPT_LINK_TTL_MS = 5 * 60_000;

const key = () => createHash('sha256').update(`ssm:receipt-link:v1:${env.ACCESS_CODE_SECRET ?? env.FIREBASE_PRIVATE_KEY}`).digest();
const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url');

/** Khách xin link tải biên lai của CHÍNH MÌNH — chỉ cấp cho khoản có biên lai (cùng điều kiện với tải trực tiếp). */
export async function createReceiptLink(user: UserHydrated, paymentId: string) {
  await assertReceiptAvailable(user, paymentId);
  const exp = Date.now() + RECEIPT_LINK_TTL_MS;
  const payload = `${paymentId}.${String(user._id)}.${exp}`;
  const token = `${payload}.${sign(payload)}`;
  return { path: `/payments/receipt-link/${token}`, expiresAt: new Date(exp).toISOString() };
}

const invalid = () => new AppError(403, 'LINK_INVALID', 'Link tải biên lai không hợp lệ — mở lại từ ứng dụng');

/** Kiểm tra link: chữ ký đúng, còn hạn, người xin link còn hoạt động. Trả người dùng + mã khoản để dựng PDF với đúng quyền của họ. */
export async function verifyReceiptLink(token: string): Promise<{ user: UserHydrated; paymentId: string }> {
  const parts = token.split('.');
  if (parts.length !== 4) throw invalid();
  const [paymentId, userId, expRaw, sig] = parts;
  if (!Types.ObjectId.isValid(paymentId) || !Types.ObjectId.isValid(userId) || !/^\d{10,16}$/.test(expRaw)) throw invalid();
  const want = Buffer.from(sign(`${paymentId}.${userId}.${expRaw}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw invalid();
  if (Date.now() > Number(expRaw)) throw new AppError(410, 'LINK_EXPIRED', 'Link tải biên lai đã hết hạn (5 phút) — bấm tải lại trong ứng dụng');
  const user = await UserModel.findById(userId);
  if (!user) throw invalid();
  if (user.status === 'SUSPENDED') throw Forbidden('Tài khoản đang bị tạm khóa', 'ACCOUNT_SUSPENDED');
  return { user, paymentId };
}
