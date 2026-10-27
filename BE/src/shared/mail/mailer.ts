import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Gửi email. Có hai kênh, ưu tiên theo thứ tự:
 *  1. Relay HTTPS (MAIL_RELAY_URL + MAIL_RELAY_SECRET): BE gọi một Google Apps Script chạy dưới tài khoản Gmail,
 *     script này gửi thư. Dùng khi nơi chạy BE chặn cổng SMTP ra ngoài (Railway gói Free/Hobby) — chỉ cần cổng 443.
 *     Mã script: ./gmail-relay.gs
 *  2. SMTP trực tiếp (Gmail: smtp.gmail.com:465 + Mật khẩu ứng dụng) — dùng khi chạy trên máy hoặc host cho phép SMTP.
 * Chưa cấu hình kênh nào thì KHÔNG báo lỗi hệ thống — hành động chính (ký hợp đồng...) vẫn thành công, chỉ là
 * email không được gửi.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

let transport: Transporter | null | undefined;

const relayConfigured = () => !!(env.MAIL_RELAY_URL && env.MAIL_RELAY_SECRET);
const smtpConfigured = () => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
export const mailConfigured = () => relayConfigured() || smtpConfigured();

function getTransport() {
  if (transport !== undefined) return transport;
  transport = smtpConfigured()
    ? createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, connectionTimeout: 8_000, socketTimeout: 12_000 })
    : null;
  return transport;
}

export const mailFrom = () => env.MAIL_FROM ?? `KhoAn <${env.SMTP_USER}>`;

/** Apps Script trả 302 sang script.googleusercontent.com rồi mới có kết quả — fetch tự theo chuyển hướng. */
async function sendViaRelay(m: MailMessage) {
  const res = await fetch(env.MAIL_RELAY_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.MAIL_RELAY_SECRET, name: 'KhoAn', to: m.to, subject: m.subject, text: m.text, html: m.html,
      attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, mimeType: a.contentType, base64: a.content.toString('base64') })),
    }),
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(`relay: ${body?.error ?? `HTTP ${res.status}`}`);
}

export type MailResult = { sent: true } | { sent: false; reason: 'NOT_CONFIGURED' | 'FAILED' | 'BLOCKED' | 'TIMEOUT'; detail?: string };

const blockedDomains = () => (env.MAIL_BLOCKED_DOMAINS === 'none' ? [] : env.MAIL_BLOCKED_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean));
/** Địa chỉ thuộc tên miền bị chặn (tài khoản demo / seed) — không gửi thư thật tới đó. */
export const isBlockedAddress = (to: string) => blockedDomains().some((d) => to.toLowerCase().endsWith(`@${d}`));

/**
 * `timeoutMs`: chờ tối đa bấy nhiêu rồi trả `TIMEOUT` (thư vẫn có thể tới sau) — dùng cho thao tác mà người dùng đang đứng chờ kết quả
 * gửi (mã OTP), để phản hồi không treo theo kênh gửi chậm.
 */
export async function sendMail(message: MailMessage, opts: { timeoutMs?: number } = {}): Promise<MailResult> {
  if (isBlockedAddress(message.to)) return { sent: false, reason: 'BLOCKED' };
  if (!mailConfigured()) return { sent: false, reason: 'NOT_CONFIGURED' };
  const attempt = (async (): Promise<MailResult> => {
    try {
      if (relayConfigured()) await sendViaRelay(message);
      else await getTransport()!.sendMail({ from: mailFrom(), ...message });
      return { sent: true };
    } catch (e) {
      console.error('[mail]', e instanceof Error ? e.message : e);
      return { sent: false, reason: 'FAILED', detail: e instanceof Error ? e.message : String(e) };
    }
  })();
  if (!opts.timeoutMs) return attempt;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<MailResult>((resolve) => { timer = setTimeout(() => resolve({ sent: false, reason: 'TIMEOUT' }), opts.timeoutMs); });
  try { return await Promise.race([attempt, timeout]); } finally { clearTimeout(timer); }
}

/** Tên miền của tài khoản demo / dữ liệu seed — không có hộp thư thật. */
export const DEMO_MAIL_DOMAIN = 'khoan.dev';

/**
 * Được trả mã OTP về cho người dùng (`demoCode`) thay vì chỉ gửi qua email không? Chỉ khi thư KHÔNG gửi được và:
 *  - production: địa chỉ thuộc tên miền demo (@khoan.dev — tài khoản demo không có hộp thư thật). Địa chỉ thật thì KHÔNG BAO GIỜ trả mã,
 *    kể cả khi quản trị lỡ thêm tên miền đó vào MAIL_BLOCKED_DOMAINS;
 *  - ngoài production: địa chỉ bị chặn gửi hoặc chưa cấu hình kênh gửi thư (máy dev).
 */
export function allowDemoCode(to: string, result: MailResult, isProd = env.isProd): boolean {
  if (result.sent) return false;
  const demoAddress = to.toLowerCase().endsWith(`@${DEMO_MAIL_DOMAIN}`);
  if (isProd) return result.reason === 'BLOCKED' && demoAddress;
  return result.reason === 'BLOCKED' || result.reason === 'NOT_CONFIGURED';
}
