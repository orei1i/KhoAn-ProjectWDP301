import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../shared/config/env';

/**
 * Giao thức VNPAY (Pay 2.1.0, QueryDr, Refund). File DUY NHẤT đọc VNPAY_HASH_SECRET, không import domain, không log tham số.
 * Kiểm chứng với sandbox thật mà sai chỗ nào thì sửa ở đây trước, không rải ra nơi khác.
 */
const VERSION = '2.1.0';
const QUERY_TIMEOUT_MS = 8_000;
const REFUND_TIMEOUT_MS = 15_000;

const hmac = (data: string) => createHmac('sha512', env.VNPAY_HASH_SECRET ?? '').update(data, 'utf-8').digest('hex');

/** yyyyMMddHHmmss theo GMT+7 (VNPAY luôn dùng giờ Việt Nam, không phụ thuộc múi giờ máy chủ). */
export function ymdGmt7(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// urlencode kiểu PHP theo tài liệu VNPAY: khoảng trắng thành '+'.
const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
const canonical = (params: Record<string, string>) => Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');

/** Chữ ký của một bộ tham số `vnp_*` (đã bỏ vnp_SecureHash): sắp tăng theo tên, nối &, HMAC-SHA512. */
export const signQuery = (params: Record<string, string>) => hmac(canonical(params));

function sameHash(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Kiểm chữ ký bộ tham số VNPAY gửi về (IPN). Chỉ nhận khoá bắt đầu `vnp_`, bỏ vnp_SecureHash và vnp_SecureHashType; giá trị không phải string
 * (tham số lặp, tham số lồng) coi như sai chữ ký.
 */
export function verifyQuery(query: Record<string, unknown>): boolean {
  const sig = query.vnp_SecureHash;
  if (typeof sig !== 'string') return false;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('vnp_') || k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') continue;
    if (typeof v !== 'string') return false;
    params[k] = v;
  }
  return sameHash(signQuery(params), sig);
}

export interface PayUrlInput {
  txnRef: string; amount: number; orderInfo: string; ip: string; returnUrl: string; createDate: string; expireDate: string;
}

/** URL chuyển khách sang trang thanh toán. Không gửi vnp_BankCode để khách chọn ở VNPAY. */
export function buildPayUrl(i: PayUrlInput): string {
  const params: Record<string, string> = {
    vnp_Version: VERSION, vnp_Command: 'pay', vnp_TmnCode: env.VNPAY_TMN_CODE ?? '', vnp_Amount: String(i.amount * 100), vnp_CreateDate: i.createDate,
    vnp_CurrCode: 'VND', vnp_IpAddr: i.ip, vnp_Locale: 'vn', vnp_OrderInfo: i.orderInfo, vnp_OrderType: 'other', vnp_ReturnUrl: i.returnUrl,
    vnp_ExpireDate: i.expireDate, vnp_TxnRef: i.txnRef,
  };
  return `${env.VNPAY_PAY_URL}?${canonical(params)}&vnp_SecureHash=${signQuery(params)}`;
}

export const newRequestId = () => randomBytes(12).toString('hex');

/** Phản hồi API đã kiểm chữ ký; `ok: false` = không kết luận được gì (lỗi mạng, timeout, sai chữ ký). */
export type VnpReply =
  | { ok: false; reason: 'NETWORK' | 'BAD_SIGNATURE' }
  | { ok: true; responseCode: string; message: string; tmnCode: string; txnRef: string; amount: string; bankCode: string; payDate: string; transactionNo: string; transactionStatus: string };

const field = (d: Record<string, unknown>, k: string) => (d[k] === undefined || d[k] === null ? '' : String(d[k]));

async function post(body: Record<string, string>, timeoutMs: number, signedFields: string[]): Promise<VnpReply> {
  let data: Record<string, unknown>;
  try {
    const res = await fetch(env.VNPAY_API_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    data = await res.json() as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { ok: false, reason: 'NETWORK' };
  } catch {
    return { ok: false, reason: 'NETWORK' };
  }
  // Kiểm chữ ký phản hồi TRƯỚC khi đọc bất kỳ trường nào.
  const sig = data.vnp_SecureHash;
  if (typeof sig !== 'string' || !sameHash(hmac(signedFields.map((f) => field(data, `vnp_${f}`)).join('|')), sig)) return { ok: false, reason: 'BAD_SIGNATURE' };
  return {
    ok: true, responseCode: field(data, 'vnp_ResponseCode'), message: field(data, 'vnp_Message'), tmnCode: field(data, 'vnp_TmnCode'), txnRef: field(data, 'vnp_TxnRef'),
    amount: field(data, 'vnp_Amount'), bankCode: field(data, 'vnp_BankCode'), payDate: field(data, 'vnp_PayDate'), transactionNo: field(data, 'vnp_TransactionNo'), transactionStatus: field(data, 'vnp_TransactionStatus'),
  };
}

const QUERYDR_SIGNED = ['ResponseId', 'Command', 'ResponseCode', 'Message', 'TmnCode', 'TxnRef', 'Amount', 'BankCode', 'PayDate', 'TransactionNo', 'TransactionType', 'TransactionStatus', 'OrderInfo', 'PromotionCode', 'PromotionAmount'];
const REFUND_SIGNED = ['ResponseId', 'Command', 'ResponseCode', 'Message', 'TmnCode', 'TxnRef', 'Amount', 'BankCode', 'PayDate', 'TransactionNo', 'TransactionType', 'TransactionStatus', 'OrderInfo'];

/** Truy vấn kết quả một giao dịch. `transactionDate` = vnp_CreateDate lúc pay. */
export async function queryDr(i: { txnRef: string; transactionDate: string }): Promise<VnpReply> {
  const requestId = newRequestId();
  const createDate = ymdGmt7(new Date());
  const ip = env.VNPAY_SERVER_IP;
  const orderInfo = `Truy van ${i.txnRef}`;
  const tmn = env.VNPAY_TMN_CODE ?? '';
  const hash = hmac([requestId, VERSION, 'querydr', tmn, i.txnRef, i.transactionDate, createDate, ip, orderInfo].join('|'));
  return post({
    vnp_RequestId: requestId, vnp_Version: VERSION, vnp_Command: 'querydr', vnp_TmnCode: tmn, vnp_TxnRef: i.txnRef, vnp_OrderInfo: orderInfo,
    vnp_TransactionDate: i.transactionDate, vnp_CreateDate: createDate, vnp_IpAddr: ip, vnp_SecureHash: hash,
  }, QUERY_TIMEOUT_MS, QUERYDR_SIGNED);
}

/** Yêu cầu hoàn. Gọi NGOÀI transaction; timeout hay sai chữ ký nghĩa là KHÔNG RÕ kết quả, người gọi không được tự gửi lại. */
export async function refund(i: { requestId: string; type: '02' | '03'; txnRef: string; amount: number; transactionNo: string; transactionDate: string }): Promise<VnpReply> {
  const createDate = ymdGmt7(new Date());
  const ip = env.VNPAY_SERVER_IP;
  const orderInfo = `Hoan tien ${i.txnRef}`;
  const createBy = 'KHOAN_SYSTEM';
  const tmn = env.VNPAY_TMN_CODE ?? '';
  const amount = String(i.amount * 100);
  const hash = hmac([i.requestId, VERSION, 'refund', tmn, i.type, i.txnRef, amount, i.transactionNo, i.transactionDate, createBy, createDate, ip, orderInfo].join('|'));
  return post({
    vnp_RequestId: i.requestId, vnp_Version: VERSION, vnp_Command: 'refund', vnp_TmnCode: tmn, vnp_TransactionType: i.type, vnp_TxnRef: i.txnRef, vnp_Amount: amount,
    vnp_OrderInfo: orderInfo, vnp_TransactionNo: i.transactionNo, vnp_TransactionDate: i.transactionDate, vnp_CreateBy: createBy, vnp_CreateDate: createDate, vnp_IpAddr: ip, vnp_SecureHash: hash,
  }, REFUND_TIMEOUT_MS, REFUND_SIGNED);
}
