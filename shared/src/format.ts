const TZ = 'Asia/Ho_Chi_Minh';
const DAY = 86_400_000;

const nf = new Intl.NumberFormat('vi-VN');
export const vnd = (n: number) => `${nf.format(Math.round(n))} ₫`;
export const compactVnd = (n: number) => {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2).replace('.', ',')} tỷ`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} tr`;
  return vnd(n);
};
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits).replace('.', ',')}%`;

/**
 * Thời điểm THẬT của 00:00 giờ chi nhánh trong một ngày date-only. Ngày date-only được lưu là 00:00Z, tức 07:00 sáng giờ
 * Việt Nam — nên mọi phép tính "còn bao nhiêu giờ trước ngày nhận" phải lùi 7 tiếng, nếu không khách được lợi 7 tiếng so với
 * lời văn hợp đồng. Việt Nam không đổi giờ mùa nên độ lệch cố định.
 */
export const FACILITY_UTC_OFFSET_HOURS = 7;
export const localMidnightMs = (dateOnly: string | Date) => new Date(dateOnly).getTime() - FACILITY_UTC_OFFSET_HOURS * 3_600_000;

/** Date-only values are stored as the facility-local calendar day at 00:00Z. */
export function todayISO(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return `${ymd}T00:00:00.000Z`;
}
export const addDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * DAY).toISOString();
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), last));
  return r.toISOString();
}
/** Cộng n chu kỳ thuê vào một ngày ISO. NGÀY = +n ngày, TUẦN = +7n ngày, THÁNG = +n tháng. */
export const addPeriods = (iso: string, period: 'DAY' | 'WEEK' | 'MONTH', n: number) =>
  period === 'MONTH' ? addMonths(iso, n) : addDays(iso, period === 'WEEK' ? 7 * n : n);

/**
 * Hạn chót trả tiền một kỳ: hoá đơn xuất vào đầu kỳ (`periodStart`), khách có thêm `graceDays` ngày ân hạn —
 * quá ngày này mới bị tính phí trễ. Khớp đúng điều kiện của job tính nợ quá hạn ở BE (`days > gracePeriodDays`).
 */
export const paymentDueDate = (periodStart: string, graceDays: number) => addDays(periodStart, graceDays);

export const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY);
/**
 * Khoá tháng "YYYY-MM" theo GIỜ VIỆT NAM — khớp `$dateToString(timezone: 'Asia/Ho_Chi_Minh')` của báo cáo ở BE. Ngày thuần (00:00Z)
 * vẫn ra đúng tháng; mốc thời gian (VD paidAt lúc 03:00 sáng 01/10 giờ VN = 20:00Z 30/09) không bị lùi về tháng trước như khi cắt
 * chuỗi UTC.
 */
export const monthKey = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso.slice(0, 7) : new Date(t + FACILITY_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 7);
};

// Theo giờ Việt Nam: ngày thuần (lưu 00:00 UTC) vẫn ra đúng ngày, mốc thời gian lúc 00:00–07:00 giờ VN không bị lùi một ngày.
const dFmt = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
const dtFmt = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const fmtDate = (iso?: string | null) => (iso ? dFmt.format(new Date(iso)) : '—');
export const fmtDateTime = (iso?: string | null) => (iso ? dtFmt.format(new Date(iso)) : '—');
export const fmtMonth = (key: string) => `T${Number(key.slice(5, 7))}/${key.slice(2, 4)}`;

export function relativeDay(iso: string): string {
  const d = daysBetween(todayISO(), iso);
  if (d === 0) return 'Hôm nay';
  if (d === 1) return 'Ngày mai';
  if (d === -1) return 'Hôm qua';
  return d > 0 ? `${d} ngày nữa` : `${-d} ngày trước`;
}

export function minutesLeft(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}

export const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(-2).map((p) => p[0]).join('').toUpperCase();
