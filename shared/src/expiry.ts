import { addDays, daysBetween, fmtDate, vnd, vnDayOf } from './format';

/**
 * QUY TẮC HẾT HẠN (Điều khoản 1.24) — một nguồn cho BE (job, quyết toán), web và app.
 *
 * Hết thời hạn (`endDate`, mốc NỬA MỞ: 00:00 ngày đầu tiên ngoài thời hạn) mà chưa gia hạn, chưa bàn giao:
 *  - KHÔNG tính thêm tiền thuê; ân hạn `graceDays` ngày (ra vào bình thường, gia hạn được — tính từ endDate — hoặc trả kho);
 *  - hết ân hạn (`lockFrom`) → khoá quyền ra vào, hợp đồng EXPIRED, giữ đồ `holdDays` ngày (tới `holdUntil`, ngày ĐẦU TIÊN được xử lý đồ),
 *    lấy đồ tại quầy qua luồng trả kho, không gia hạn được nữa;
 *  - PHÍ LƯU GIỮ `dailyFee`/ngày từ endDate tới ngày bàn giao (hoặc ngày xử lý đồ) — không phải tiền thuê, không xuất hoá đơn kỳ, trừ vào
 *    tiền giữ chân khi quyết toán.
 * Hợp đồng ký trước 1.24 (không có `expiry`) giữ quy định cũ — hết hạn vẫn tính tiền thuê — cho tới lần gia hạn đầu tiên.
 */
export const EXPIRY_RULE_SINCE = '1.24';
export const DEFAULT_EXPIRY_GRACE_DAYS = 5;
export const DEFAULT_EXPIRY_HOLD_DAYS = 14;
/** Giới hạn chính sách (Quản lý vận hành chỉnh ở trang Chính sách). */
export const EXPIRY_GRACE_RANGE = { min: 0, max: 30 } as const;
export const EXPIRY_HOLD_RANGE = { min: 1, max: 90 } as const;

/** Phiên bản Điều khoản `v` ≥ `min` (so từng số: 1.24 > 1.3). Thiếu phiên bản → false. */
export function termsAtLeast(v: string | null | undefined, min: string): boolean {
  if (!v) return false;
  const pa = v.split('.').map((n) => Number(n) || 0);
  const pb = min.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

type When = string | Date;
type ExpiryLike = {
  rule?: string | null; graceDays?: number | null; holdDays?: number | null; dailyFee?: number | null;
  lockFrom?: When | null; lockedAt?: When | null; holdUntil?: When | null;
} | null | undefined;

const iso = (d: When) => new Date(d).toISOString();
/** Ngày (theo giờ Việt Nam) dạng date-only 00:00Z — cùng cách lưu endDate / holdUntil. */
const dayOf = (t?: When | null) => `${vnDayOf(t ?? new Date())}T00:00:00.000Z`;

/** Hợp đồng theo quy tắc hết hạn mới (có `expiry`). */
export const usesGraceHold = (c: { expiry?: { rule?: string | null } | null }) => c.expiry?.rule === 'GRACE_HOLD';

/** Ngày khoá: ngày đã báo khách trong thông báo EXPIRY_GRACE (`lockFrom`), chưa báo thì endDate + ân hạn. ISO date-only. */
export function expiryLockFrom(c: { endDate: When; expiry?: ExpiryLike }): string {
  if (c.expiry?.lockFrom) return iso(c.expiry.lockFrom);
  return addDays(iso(c.endDate), c.expiry?.graceDays ?? DEFAULT_EXPIRY_GRACE_DAYS);
}

/** Ngày đầu tiên được xử lý đồ: đã khoá → `holdUntil`; chưa khoá → ngày khoá + số ngày giữ đồ (ước tính). */
export function expiryHoldUntil(c: { endDate: When; expiry?: ExpiryLike }): string {
  if (c.expiry?.holdUntil) return iso(c.expiry.holdUntil);
  return addDays(expiryLockFrom(c), c.expiry?.holdDays ?? DEFAULT_EXPIRY_HOLD_DAYS);
}

/**
 * Giai đoạn của hợp đồng theo quy tắc hết hạn: còn thời hạn / ân hạn / đã khoá (đang giữ đồ) / quá hạn giữ đồ. null = hợp đồng cũ (không
 * có `expiry`) hoặc đã kết thúc. Chưa tới lượt job khoá mà đã qua ngày khoá vẫn tính là LOCKED (không gia hạn được nữa).
 */
export type ExpiryPhase = 'IN_TERM' | 'GRACE' | 'LOCKED' | 'HOLD_OVER';
export function expiryPhaseOf(c: { status: string; endDate: When; expiry?: ExpiryLike }, today?: When): ExpiryPhase | null {
  if (!usesGraceHold(c) || c.status === 'CLOSED' || c.status === 'ABANDONED') return null;
  const t = dayOf(today);
  if (c.expiry?.lockedAt || c.status === 'EXPIRED') return t >= expiryHoldUntil(c) ? 'HOLD_OVER' : 'LOCKED';
  if (t < iso(c.endDate)) return 'IN_TERM';
  return t < expiryLockFrom(c) ? 'GRACE' : 'LOCKED';
}

/**
 * Phí lưu giữ tính đến hết ngày `through` (ngày bàn giao / ngày xử lý đồ, tính cả ngày đó): từ endDate, `days = through ≥ endDate ?
 * daysBetween(endDate, through) + 1 : 0`. Hợp đồng cũ → 0.
 */
export function storageFeeOf(c: { endDate: When; expiry?: ExpiryLike }, through: When): { days: number; perDay: number; amount: number } {
  if (!usesGraceHold(c)) return { days: 0, perDay: 0, amount: 0 };
  const perDay = Math.max(0, Math.round(c.expiry?.dailyFee ?? 0));
  const end = iso(c.endDate);
  const stop = dayOf(through);
  const days = stop >= end ? daysBetween(end, stop) + 1 : 0;
  return { days, perDay, amount: days * perDay };
}

/**
 * Phí lưu giữ mỗi ngày (chốt vào hợp đồng): giá thuê THEO NGÀY niêm yết của loại kho (gồm phụ phí điều hòa nếu hợp đồng dùng, không ưu đãi,
 * không phí gói bảo vệ); loại kho chỉ thuê theo tháng (L / XL — không niêm yết giá ngày, truyền `dayGross` null) → giá tháng ÷ 30, làm tròn
 * lên tới 1.000 ₫.
 */
export function storageDailyFee(i: { dayGross: number | null | undefined; monthGross: number }): number {
  if (i.dayGross && i.dayGross > 0) return Math.round(i.dayGross);
  return Math.ceil(i.monthGross / 30 / 1000) * 1000;
}

/** Ngày cuối cùng khách còn lấy được đồ (hết ngày này) = holdUntil − 1. */
export const expiryHoldLastDay = (c: { endDate: When; expiry?: ExpiryLike }) => addDays(expiryHoldUntil(c), -1);

/** Một nhãn ngắn cho bảng hợp đồng / thẻ kho: "Ân hạn đến 23/11", "Đã khoá — giữ đồ đến 07/12", "Quá hạn giữ đồ". */
export function expiryChip(c: { status: string; endDate: When; expiry?: ExpiryLike }, today?: When): { label: string; tone: 'amber' | 'red' | 'gray' } | null {
  const phase = expiryPhaseOf(c, today);
  const short = (d: string) => fmtDate(d).slice(0, 5);
  if (phase === 'GRACE') return { label: `Ân hạn đến ${short(addDays(expiryLockFrom(c), -1))}`, tone: 'amber' };
  if (phase === 'LOCKED') return { label: `Đã khoá — giữ đồ đến ${short(expiryHoldLastDay(c))}`, tone: 'red' };
  if (phase === 'HOLD_OVER') return { label: 'Quá hạn giữ đồ', tone: 'red' };
  return null;
}

/**
 * Cảnh báo hết hạn cho KHÁCH (web + app cùng câu, như delinquencyAlert): trong ân hạn → hạn gia hạn / trả kho, ngày khoá, phí lưu giữ; đã
 * khoá → lấy đồ tại quầy trước hạn, phí tạm tính; quá hạn giữ đồ → chi nhánh được xử lý đồ. null khi còn thời hạn / hợp đồng cũ / đã bàn giao.
 */
export function expiryAlert(
  c: { status: string; endDate: When; expiry?: ExpiryLike; access?: { revokedAt?: When | null } | null },
  today?: When,
): { tone: 'amber' | 'red'; title: string; text: string } | null {
  if (c.access?.revokedAt) return null;
  const phase = expiryPhaseOf(c, today);
  if (!phase || phase === 'IN_TERM') return null;
  const end = iso(c.endDate);
  const fee = vnd(c.expiry?.dailyFee ?? 0);
  if (phase === 'GRACE') {
    const lock = expiryLockFrom(c);
    return {
      tone: 'amber', title: 'Hợp đồng đã hết hạn — đang trong ân hạn',
      text: `Thời hạn thuê kết thúc hết ngày ${fmtDate(addDays(end, -1))}; không tính thêm tiền thuê. Gia hạn (tính từ ngày ${fmtDate(end)}) hoặc đăng ký trả kho và bàn giao trước ngày ${fmtDate(lock)} — từ ngày đó quyền ra vào bị khoá. Nếu không gia hạn, phí lưu giữ ${fee}/ngày tính từ ngày ${fmtDate(end)} tới ngày bàn giao, trừ vào tiền giữ chân.`,
    };
  }
  const so = storageFeeOf(c, today ?? new Date());
  if (phase === 'LOCKED') {
    return {
      tone: 'red', title: 'Hết hạn — đã khoá quyền ra vào',
      text: `Hợp đồng hết hạn mà chưa gia hạn hay trả kho nên quyền ra vào đã bị khoá và không gia hạn được nữa. Đồ được giữ đến hết ngày ${fmtDate(expiryHoldLastDay(c))}: mang giấy tờ tùy thân đến quầy chi nhánh để lấy đồ và làm thủ tục trả kho. Phí lưu giữ tạm tính đến hôm nay: ${so.days} ngày × ${fee} = ${vnd(so.amount)}, trừ vào tiền giữ chân khi quyết toán. Từ ngày ${fmtDate(expiryHoldUntil(c))}, chi nhánh được mở kho, kiểm kê và xử lý đồ.`,
    };
  }
  return {
    tone: 'red', title: 'THÔNG BÁO CUỐI — đã quá hạn giữ đồ',
    text: `Hạn giữ đồ đã hết ngày ${fmtDate(expiryHoldLastDay(c))}. Chi nhánh được mở kho, kiểm kê và xử lý đồ theo quy định về hàng bỏ lại; tiền giữ chân và tiền thanh lý trừ công nợ, phí lưu giữ (${vnd(so.amount)} tới hôm nay) và chi phí. Liên hệ chi nhánh ngay nếu bạn vẫn muốn lấy đồ.`,
  };
}
