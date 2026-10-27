import { existsSync } from 'node:fs';
import { z } from 'zod';

// Node >= 20.12 can load .env natively; no dotenv dependency.
if (existsSync('.env')) process.loadEnvFile('.env');

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  MONGODB_URI: z.string().startsWith('mongodb', 'MONGODB_URI must be a mongodb:// or mongodb+srv:// URI'),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).transform((k) => k.replace(/\\n/g, '\n')),
  AUTH_DEV_BYPASS: bool,
  SEED_PASSWORD: z.string().min(8).default('Demo@12345'),
  // Thanh toán online của khách là GIẢ LẬP (chưa nối cổng thanh toán thật). false → các endpoint thanh toán online của khách trả 501
  // GATEWAY_NOT_CONFIGURED; thu tại quầy không đổi.
  MOCK_PAYMENTS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Seed xoá sạch database — chạy khi NODE_ENV=production chỉ khi đặt SEED_CONFIRM=yes (xác nhận rõ ràng).
  SEED_CONFIRM: z.string().optional(),
  // Web API key của Firebase (Console → Project settings → General → Web app → apiKey).
  // Key này vốn public — nó nằm trong bundle trình duyệt của Webapp. Có key thì trang /api hiện ô đăng nhập lấy token.
  FIREBASE_WEB_API_KEY: z.string().optional(),
  // Gửi email hợp đồng PDF cho khách. Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<gmail>, SMTP_PASS=<Mật khẩu ứng dụng 16 ký tự>.
  // Bỏ trống thì hệ thống vẫn chạy bình thường, chỉ không gửi được email (khách vẫn tải được PDF).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // Tên miền KHÔNG BAO GIỜ gửi thư tới (cách nhau dấu phẩy) — địa chỉ của tài khoản demo / dữ liệu seed, để hệ thống không gửi
  // thư thật tới người lạ. Mặc định chặn khoan.dev (tài khoản demo). Đặt chuỗi "none" để tắt.
  MAIL_BLOCKED_DOMAINS: z.string().default('khoan.dev'),
  // Kênh gửi email thay cho SMTP khi host chặn cổng SMTP (Railway Free/Hobby): URL + khoá của Google Apps Script
  // relay (src/shared/mail/gmail-relay.gs). Có đủ hai biến này thì ưu tiên dùng kênh này.
  MAIL_RELAY_URL: z.string().url().optional(),
  MAIL_RELAY_SECRET: z.string().min(8).optional(),
  // Khoá mã hoá mật khẩu mở kho (AES-GCM) để chủ hợp đồng xem lại được + ký link biên lai. BẮT BUỘC khi NODE_ENV=production; dev bỏ
  // trống thì suy từ FIREBASE_PRIVATE_KEY. Bản mã cũ (khoá suy từ FIREBASE_PRIVATE_KEY) vẫn đọc được — xem secret-box.ts.
  ACCESS_CODE_SECRET: z.string().min(16).optional(),
});

/** MONGODB_URI trỏ vào máy cục bộ — mọi host trong chuỗi kết nối đều là localhost / 127.0.0.1 / ::1 (mongodb+srv luôn là máy xa). */
export function isLocalMongoUri(uri: string): boolean {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  if (!m) return false;
  const hosts = m[1].split(',').map((h) => h.trim().toLowerCase().replace(/^\[(.*)\](?::\d+)?$/, '$1').replace(/:\d+$/, ''));
  return hosts.length > 0 && hosts.every((h) => h === 'localhost' || h === '127.0.0.1' || h === '::1');
}

/**
 * AUTH_DEV_BYPASS (header x-dev-user thay cho token) chỉ có hiệu lực khi KHÔNG production VÀ database là mongod cục bộ — lỡ bật trên
 * máy chủ thật hoặc trỏ vào Atlas thì bỏ qua kèm cảnh báo, không bao giờ mở cửa sau trên dữ liệu thật.
 */
export function resolveDevBypass(e: { AUTH_DEV_BYPASS: boolean; NODE_ENV: string; MONGODB_URI: string }): { on: boolean; warning: string | null } {
  if (!e.AUTH_DEV_BYPASS) return { on: false, warning: null };
  if (e.NODE_ENV === 'production') return { on: false, warning: 'AUTH_DEV_BYPASS bị bỏ qua: NODE_ENV=production' };
  if (!isLocalMongoUri(e.MONGODB_URI)) return { on: false, warning: 'AUTH_DEV_BYPASS bị bỏ qua: MONGODB_URI không trỏ vào mongod cục bộ (localhost / 127.0.0.1)' };
  return { on: true, warning: null };
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment:\n' + parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
// Production nên có khoá riêng cho mật khẩu mở kho / link biên lai — không dùng chung khoá Firebase. Thiếu thì vẫn chạy bằng khoá cũ
// (suy từ FIREBASE_PRIVATE_KEY) và cảnh báo, để deploy chưa kịp thêm biến không làm sập API.
if (parsed.data.NODE_ENV === 'production' && !parsed.data.ACCESS_CODE_SECRET) {
  console.warn('⚠  ACCESS_CODE_SECRET chưa đặt — đang dùng khoá suy từ FIREBASE_PRIVATE_KEY. Thêm biến này (chuỗi ngẫu nhiên ≥ 16 ký tự, VD `openssl rand -hex 32`) và không đổi về sau.');
}
const devBypass = resolveDevBypass(parsed.data);
if (devBypass.warning) console.warn(`⚠  ${devBypass.warning}`);

export const env = {
  ...parsed.data,
  AUTH_DEV_BYPASS: devBypass.on,
  isProd: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};
