import type { RequestHandler } from 'express';
import { AppError } from '../core/errors';

/**
 * Giới hạn tần suất gọi API — cửa sổ cố định, đếm trong bộ nhớ của tiến trình (BE chạy MỘT instance; nhiều instance thì cần kho đếm
 * dùng chung như Redis). `key: 'ip'` theo địa chỉ IP thật (app đặt trust proxy), `'user'` theo tài khoản đã đăng nhập — hồ sơ
 * (sau authenticate) hoặc Firebase uid (sau verifyFirebase); chưa xác định được tài khoản thì theo IP. Đếm theo tài khoản để nhiều
 * người chung một mạng (NAT của trường, quán cà phê) không chặn lẫn nhau. Vượt ngưỡng → 429 RATE_LIMITED kèm header Retry-After.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: 'ip' | 'user'; name?: string }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const name = opts.name ?? Math.random().toString(36).slice(2);
  // Dọn các khoá đã hết hạn để Map không phình mãi.
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k); }, Math.max(opts.windowMs, 60_000)).unref();
  return (req, res, next) => {
    const account = req.auth?.user ? `u:${String(req.auth.user._id)}` : req.firebase?.uid ? `f:${req.firebase.uid}` : null;
    const who = opts.key === 'user' && account ? account : `ip:${req.ip ?? 'unknown'}`;
    const k = `${name}:${who}`;
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + opts.windowMs }; hits.set(k, h); }
    h.count += 1;
    if (h.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
      throw new AppError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh — vui lòng thử lại sau ít phút');
    }
    next();
  };
}
