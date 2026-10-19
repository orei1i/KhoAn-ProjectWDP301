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
  MOCK_PAYMENTS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
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
  // Khoá mã hoá mật khẩu mở kho (AES-GCM) để chủ hợp đồng xem lại được. Bỏ trống = suy từ FIREBASE_PRIVATE_KEY.
  ACCESS_CODE_SECRET: z.string().min(16).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment:\n' + parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  AUTH_DEV_BYPASS: parsed.data.AUTH_DEV_BYPASS && parsed.data.NODE_ENV !== 'production',
  isProd: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};
