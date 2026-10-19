import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Mở trang Swagger của server đang chạy local.
 * Cố ý KHÔNG import config/env — file đó bắt buộc phải có MONGODB_URI/FIREBASE_* và sẽ exit(1);
 * ở đây chỉ cần PORT, nên đọc thẳng từ .env.
 *
 * Không gộp vào `npm run api` vì tsx watch khởi động lại mỗi lần sửa file — sẽ mở tab mới liên tục.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT) || 4000;
const url = `http://localhost:${port}/api/docs`;

const cmd = process.platform === 'win32' ? `start "" "${url}"`
  : process.platform === 'darwin' ? `open "${url}"`
  : `xdg-open "${url}"`;

exec(cmd, (err) => {
  if (err) console.log(`Không mở được trình duyệt. Mở tay: ${url}`);
  else console.log(`Đã mở ${url}`);
});
