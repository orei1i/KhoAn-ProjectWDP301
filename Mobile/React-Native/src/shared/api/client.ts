import Constants from 'expo-constants';
import type { GatewayStart } from '@ssm/shared';
import { firebaseAuth, firebaseConfigured } from './firebase';

/**
 * Địa chỉ API.
 *
 * Trên điện thoại `localhost` trỏ về chính cái điện thoại, không phải máy chạy BE — đây là lỗi
 * tốn thời gian nhất khi mới chạy app. Thứ tự tìm:
 *
 *  1. EXPO_PUBLIC_API_URL trong Mobile/React-Native/.env  → khi deploy hoặc trỏ sang Railway
 *  2. Suy ra từ địa chỉ máy đang chạy Metro (Expo cho biết qua hostUri, ví dụ 192.168.1.5:8081)
 *     → cắm điện thoại thật vào cùng Wi-Fi là chạy, không phải sửa gì
 *  3. localhost — chỉ đúng khi mở bằng expo web
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:4000/api`;

  return 'http://localhost:4000/api';
}

export const API_URL = resolveApiUrl();
// Log này hiện ở terminal đang chạy `expo start` — cách nhanh nhất để biết điện thoại đang gọi vào đâu.
console.log(`[SSM] API_URL = ${API_URL}`);

/**
 * fetch của React Native mặc định KHÔNG có timeout: BE không với tới được (firewall chặn, sai Wi-Fi, sai IP)
 * thì lời gọi treo cả phút, màn hình chỉ thấy spinner quay mãi mà không có lỗi nào để đọc.
 */
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Thao tác ghi chậm hơn bình thường (ký hợp đồng, gửi OTP qua email — server chờ mail tối đa vài giây) dùng thời gian chờ dài hơn,
 * để không báo lỗi khi server thật ra vẫn đang xử lý xong.
 */
export const SLOW_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

/** Lỗi mạng / quá thời gian chờ: không biết server đã xử lý hay chưa — thao tác ghi phải tải lại để xem trạng thái thật. */
export const isNetworkError = (e: unknown) => e instanceof ApiError && e.code === 'NETWORK';

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const current = firebaseConfigured ? firebaseAuth().currentUser : null;
  const token = current ? await current.getIdToken() : null; // SDK tự cache và làm mới mỗi giờ
  let res: Response;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'x-client': 'app', // BE chọn Return URL của app cho lệnh thu VNPAY; thiếu header là WEB
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e) {
    const timedOut = (e as { name?: string })?.name === 'AbortError';
    console.warn(`[SSM] ${method} ${path} → ${timedOut ? 'quá thời gian chờ' : 'không kết nối được'} (${API_URL})`);
    throw new ApiError(0, 'NETWORK', timedOut
      ? `API ${API_URL} không phản hồi sau ${timeoutMs / 1000}s. Kiểm tra BE đang chạy, điện thoại cùng Wi-Fi với máy tính và firewall không chặn cổng 4000.`
      : `Không kết nối được API (${API_URL}). Kiểm tra BE đã chạy và điện thoại cùng mạng Wi-Fi với máy tính.`);
  } finally {
    clearTimeout(timer);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  // Đợt VNPAY: 202 = chưa có hiệu ứng nào, khách phải sang VNPAY trả. Ném lỗi riêng để màn gọi không coi là đã xong (store.run trả nguyên về cho cổng).
  if (res.status === 202 && (data as GatewayStart | null)?.gateway) throw new ApiError(202, 'GATEWAY_REDIRECT', '', (data as GatewayStart).gateway);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Lỗi máy chủ (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>, timeoutMs?: number) => request<T>('POST', path, body, headers, timeoutMs),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
