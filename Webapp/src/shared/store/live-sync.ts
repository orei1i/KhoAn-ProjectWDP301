/**
 * Góp ý 17/11 — "data chưa update realtime, còn cần F5 liên tục": web tự tải lại ảnh chụp /bootstrap ở nền (store.tsx). File này giữ
 * các hằng số nhịp tải và hàm GIỮ THAM CHIẾU: dữ liệu không đổi thì giữ nguyên object cũ, để lần tải nền không làm các trang vẽ lại /
 * khởi tạo lại form, hộp thoại đang mở.
 */

/** Khách: snapshot nhỏ (~80 KB) — tải mỗi 20 giây khi tab đang mở. */
export const LIVE_MS_CUSTOMER = 20_000;
/**
 * Nhân viên / quản lý / vận hành: snapshot cả chi nhánh lớn hơn nhiều (~750 KB với dữ liệu demo) — 45 giây để vừa chi phí Render free tier.
 * Dữ liệu không đổi thì trình duyệt chỉ nhận 304 (ETag của Express), không tải lại cả gói.
 */
export const LIVE_MS_STAFF = 45_000;
/** Nhịp kiểm (đến hạn thì tải): đếm từ lần tải gần nhất, kể cả lần tải sau thao tác của chính người dùng. */
export const LIVE_TICK_MS = 5_000;
/** Quay lại tab: tải ngay nếu lần tải gần nhất đã cũ hơn chừng này. */
export const LIVE_FOCUS_MIN_GAP_MS = 5_000;
/** Lỗi (mất mạng, 429, Render đang khởi động…): chờ lâu dần trước lần thử sau, không báo lỗi, không đăng xuất. */
export const LIVE_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000];

const jsonOf = new WeakMap<object, string>();
const json = (v: object) => {
  let s = jsonOf.get(v);
  if (s === undefined) { s = JSON.stringify(v); jsonOf.set(v, s); }
  return s;
};

/** Hai giá trị có cùng nội dung JSON (so hồ sơ `me`). */
export const sameJson = (a: object | null | undefined, b: object | null | undefined) => !!a && !!b && json(a) === json(b);

/** Một danh sách: phần tử nào không đổi (cùng _id, cùng nội dung) giữ object cũ; cả danh sách không đổi thì trả lại mảng cũ. */
function shareList<T>(prev: readonly T[] | undefined, next: readonly T[]): readonly T[] {
  if (!prev) return next;
  const old = new Map<unknown, T>();
  for (const x of prev) old.set((x as { _id?: unknown })?._id ?? x, x);
  let same = prev.length === next.length;
  const out = next.map((x, i) => {
    const o = old.get((x as { _id?: unknown })?._id ?? x);
    const keep = o !== undefined && typeof o === 'object' && o && typeof x === 'object' && x && json(o) === json(x) ? o : x;
    if (keep !== prev[i]) same = false;
    return keep;
  });
  return same ? prev : out;
}

/**
 * Ảnh chụp mới `next` ghép vào ảnh đang hiển thị `prev`: giữ tham chiếu mọi phần không đổi. Không có gì đổi → trả lại đúng `prev` (React bỏ
 * qua lần vẽ lại). Có đổi → object mới, nhưng các bản ghi không đổi vẫn là object cũ (useEffect / useMemo theo bản ghi không chạy lại).
 */
export function shareSnapshot<D extends object>(prev: D, next: D): D {
  let changed = false;
  const out = { ...next } as Record<string, unknown>;
  for (const [k, v] of Object.entries(next)) {
    const p = (prev as Record<string, unknown>)[k];
    const shared = Array.isArray(v) ? shareList(Array.isArray(p) ? p : undefined, v) : v;
    out[k] = shared;
    if (shared !== p) changed = true;
  }
  if (Object.keys(prev).length !== Object.keys(next).length) changed = true;
  return changed ? (out as D) : prev;
}
