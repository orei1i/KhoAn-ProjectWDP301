/**
 * Tra toạ độ [lng, lat] từ địa chỉ thường bằng OpenStreetMap Nominatim — Ops chỉ gõ địa chỉ, không phải nhập kinh/vĩ độ.
 *
 * Không bao giờ throw và không chặn nghiệp vụ: mọi lỗi (mất mạng, quá 4 giây, bị chặn, không tìm thấy địa chỉ,
 * số không hợp lệ) đều trả null để caller giữ toạ độ cũ / dùng toạ độ mặc định. Đây là lời gọi mạng nên
 * KHÔNG gọi trong transaction DB — tra xong rồi mới mở transaction.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 4_000;
// Nominatim yêu cầu User-Agent nhận diện được ứng dụng (usage policy).
const USER_AGENT = 'KhoAn-SelfStorage/1.0 (student project)';

export interface AddressParts {
  line1: string;
  district?: string;
  city?: string;
}

const toNumber = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;

export async function geocodeAddress(parts: AddressParts): Promise<[lng: number, lat: number] | null> {
  try {
    const q = [parts.line1, parts.district, parts.city].map((s) => s?.trim()).filter(Boolean).join(', ');
    if (!q) return null;

    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'vn', q }).toString();

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'vi' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('[geocode]', `Nominatim trả ${res.status}`);
      return null;
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as { lon?: unknown; lat?: unknown } | null;
    const lng = toNumber(first?.lon);
    const lat = toNumber(first?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    return [lng, lat];
  } catch (e) {
    console.warn('[geocode]', e instanceof Error ? e.message : e);
    return null;
  }
}
