import type { PaymentStatus, RentalPeriod } from './enums';
import { addDays, fmtDate, localMidnightMs, paymentDueDate, todayISO, vnd } from './format';
import { dueAtBooking } from './payment-schedule';

/**
 * Quy tắc thu tiền thuê THUẦN (không đụng DB) — một nguồn cho job billing ở BE, cổng khách (Webapp + app) và báo cáo, để số tiền /
 * ngày khách thấy trên màn hình đúng là số / ngày hệ thống sẽ thu. Nhận cả Date (BE) lẫn chuỗi ISO (client).
 */
type Iso = string | Date;
const ms = (d: Iso) => new Date(d).getTime();

/**
 * Hoàn khi KHÁCH huỷ đặt chỗ: % theo bậc giờ còn lại tới 00:00 giờ chi nhánh của ngày nhận — CHỈ áp cho tiền giữ chân (khoản phạt huỷ
 * đã thoả thuận). Tiền thuê kỳ đầu kho cỡ lớn trả trước lúc đặt luôn hoàn đủ: khách chưa nhận kho thì chưa dùng dịch vụ.
 * Một công thức cho server (số thật) và web / app (báo trước khi khách bấm huỷ).
 *
 * Đặt chỗ đã đổi ngày nhận kho: tính theo ngày SỚM NHẤT từng có (ngày gốc, ngày hiện tại và mọi ngày từng dời tới trong
 * `scheduleChanges`) — sát ngày rồi dời ra xa để huỷ được hoàn 100% thì không được.
 */
export function cancellationRefundOf(
  r: { status: string; depositPaymentId?: unknown; startDate: Iso; originalStartDate?: Iso | null;
    scheduleChanges?: readonly { to: Iso }[] | null; quote: Parameters<typeof dueAtBooking>[0] },
  tiers: readonly { minHoursBeforeStart: number; depositRefundPct: number }[],
  now: Iso = new Date(),
): { pct: number; amount: number; depositRefund: number; prepaidRentRefund: number } {
  if (r.status === 'PENDING' || !r.depositPaymentId) return { pct: 0, amount: 0, depositRefund: 0, prepaidRentRefund: 0 };
  const dates = [r.startDate, ...(r.originalStartDate ? [r.originalStartDate] : []), ...(r.scheduleChanges ?? []).map((c) => c.to)];
  const anchor = Math.min(...dates.map(ms));
  const hours = (localMidnightMs(new Date(anchor)) - ms(now)) / 3_600_000;
  const tier = [...tiers].sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart).find((t) => hours >= t.minHoursBeforeStart);
  const pct = tier?.depositRefundPct ?? 0;
  const depositRefund = Math.round((r.quote.depositAmount * pct) / 100);
  const prepaidRentRefund = dueAtBooking(r.quote) - r.quote.depositAmount; // tiền thuê kỳ đầu trả trước (kho cỡ lớn), không có thì 0
  return { pct, amount: depositRefund + prepaidRentRefund, depositRefund, prepaidRentRefund };
}

/**
 * Kỳ bắt đầu từ `start` đã được khách trả trước qua gia hạn (RENEWAL có paymentId) chưa.
 *
 * Gia hạn thu tiền ngay cho các kỳ sau `previousEndDate` và đẩy `endDate` ra xa; nếu job billing vẫn xuất
 * hoá đơn RENT cho đúng các kỳ đó thì khách bị thu hai lần. Gia hạn tự động (auto-renew) có paymentId = null
 * nên không tính là trả trước — kỳ đó vẫn phải xuất hoá đơn bình thường.
 */
export function coveredByPaidRenewal(
  renewals: readonly { previousEndDate: Iso; newEndDate: Iso; paymentId?: unknown }[],
  start: Iso,
): boolean {
  const t = ms(start);
  return renewals.some((r) => !!r.paymentId && ms(r.previousEndDate) <= t && t < ms(r.newEndDate));
}

/**
 * Tiền thuê của kỳ bắt đầu từ `start`. Hợp đồng có các KỲ CAM KẾT (`commitments`): trong kỳ nào tính giá của kỳ đó (đã trừ ưu đãi
 * của chính kỳ đó); ngoài mọi kỳ cam kết — hết hạn mà không gia hạn — tính giá CHƯA ưu đãi của kỳ gần nhất, vì không còn cam kết
 * thì không còn ưu đãi. Hợp đồng cũ chưa có `commitments` giữ nguyên `billing.rate`.
 */
export function rentForPeriod(
  c: { billing: { rate: number }; commitments?: readonly { startDate: Iso; endDate: Iso; gross: number; rate: number }[] | null },
  start: Iso,
): number {
  const list = c.commitments ?? [];
  if (!list.length) return c.billing.rate;
  const t = ms(start);
  const seg = list.find((s) => ms(s.startDate) <= t && t < ms(s.endDate));
  if (seg) return seg.rate;
  return [...list].sort((a, b) => ms(b.endDate) - ms(a.endDate))[0].gross;
}

/**
 * Hạn chót trả khoản ĐANG NỢ trước khi bị tính phí trễ — đúng điều kiện của job billing ở BE (jobs/index.ts):
 *   days = max(0, daysBetween(billing.paidThrough, today) − 1); tính phí trễ khi days > terms.gracePeriodDays
 * ⇒ ngày cuối cùng chưa bị tính phí = paidThrough + gracePeriodDays + 1, tức `paymentDueDate` của kỳ đầu tiên CHƯA trả
 * (paidThrough + 1). KHÔNG dùng nextBillingDate: job xuất hoá đơn xong là đẩy nó sang kỳ sau ngay.
 */
export const lateFeeDeadline = (c: { billing: { paidThrough: string }; terms: { gracePeriodDays: number } }) =>
  paymentDueDate(addDays(c.billing.paidThrough, 1), c.terms.gracePeriodDays);

type DueContract = {
  billing: { rate: number; nextBillingDate: string; paidThrough: string };
  balance: { outstanding: number };
  terms: { gracePeriodDays: number };
  commitments?: readonly { startDate: string; endDate: string; gross: number; rate: number }[] | null;
  renewals?: readonly { previousEndDate: string; newEndDate: string; paymentId?: unknown }[] | null;
};

export interface BillingDue {
  /** Đang có khoản chưa trả (balance.outstanding > 0). */
  owing: boolean;
  outstanding: number;
  /** Hạn chót trước khi bị tính phí trễ: đang nợ → của khoản đang nợ (theo paidThrough); không nợ → của kỳ tới. */
  deadline: string;
  /** Đang nợ và đã qua hạn chót — phí trễ đã (hoặc sắp) được tính. */
  late: boolean;
  /** Kỳ tới: ngày xuất hoá đơn và số sẽ thu — giá theo kỳ cam kết chứa kỳ đó, như job; 0 nếu đã trả trước khi gia hạn. */
  next: { date: string; amount: number; prepaid: boolean };
}

/** Khách phải trả gì, trước ngày nào — cho màn của KHÁCH (web + app), cùng công thức với job billing. */
export function billingDue(c: DueContract, today: string = todayISO()): BillingDue {
  const owing = c.balance.outstanding > 0;
  const date = c.billing.nextBillingDate;
  const prepaid = coveredByPaidRenewal(c.renewals ?? [], date);
  const deadline = owing ? lateFeeDeadline(c) : paymentDueDate(date, c.terms.gracePeriodDays);
  return {
    owing, outstanding: Math.max(0, c.balance.outstanding), deadline,
    late: owing && ms(today) > ms(deadline),
    next: { date, amount: prepaid ? 0 : rentForPeriod(c, date), prepaid },
  };
}

/** Số sẽ thu ở kỳ tới, dạng chữ. */
export const nextChargeText = (d: BillingDue) => (d.next.prepaid ? 'đã trả trước khi gia hạn' : vnd(d.next.amount));

/** Dòng "Cần thanh toán" khi đang nợ — web và app nói cùng một câu. */
export const owingText = (d: BillingDue) =>
  `${vnd(d.outstanding)} — ${d.late ? `đã quá hạn từ ngày ${fmtDate(addDays(d.deadline, 1))}` : `hạn chót ${fmtDate(d.deadline)}, quá hạn bị tính phí trễ`}`;

/**
 * Các dòng thanh toán trên thẻ hợp đồng của khách. Đang nợ: số đang nợ + hạn chót trước khi bị tính phí trễ, rồi mới đến kỳ tới.
 * Không nợ: kỳ tới (đúng số sẽ thu) + hạn trả của kỳ đó; kỳ tới đã trả trước khi gia hạn thì không có hạn trả.
 */
export function billingDueRows(d: BillingDue): [string, string][] {
  const next: [string, string] = ['Kỳ thanh toán tới', `${fmtDate(d.next.date)} · ${nextChargeText(d)}`];
  if (d.owing) return [['Cần thanh toán', owingText(d)], next];
  return d.next.prepaid ? [next] : [next, ['Hạn trả tiền kỳ tới', `${fmtDate(d.deadline)} — quá hạn bị tính phí trễ`]];
}

// ---------- Báo cáo (Webapp + BE dùng chung định nghĩa) ----------

/**
 * Số kỳ trong MỘT tháng bình quân (365 ngày / 12 ≈ 30,42 ngày ≈ 4,35 tuần) — quy đổi giá theo kỳ ra giá THÁNG cho doanh thu định
 * kỳ (MRR): hợp đồng 100.000 ₫/ngày đóng góp ~3 tr/tháng, không phải 100.000 ₫ như khi cộng thẳng `billing.rate`.
 */
export const PERIODS_PER_MONTH: Record<RentalPeriod, number> = { DAY: 365 / 12, WEEK: 365 / 12 / 7, MONTH: 1 };
/** Giá một kỳ quy đổi ra tháng (chưa làm tròn — cộng xong mới làm tròn tổng). */
export const monthlyEquivalent = (rate: number, period: RentalPeriod) => rate * (PERIODS_PER_MONTH[period] ?? 1);

/**
 * Khoản tính vào THỰC THU: thành công, kể cả khoản về sau bị hoàn một phần / toàn bộ — khoản gốc vẫn là doanh thu gộp, phần hoàn
 * là một dòng REFUND riêng trừ ra. Bỏ khoản gốc đã hoàn mà vẫn trừ dòng hoàn thì bị trừ hai lần (có thể ra số âm).
 */
export const COLLECTED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

/**
 * Tuổi nợ — MỘT định nghĩa "quá hạn" cho bảng tuổi nợ, ô "Công nợ quá hạn" và báo cáo phải thu ở BE: hợp đồng còn nợ VÀ đã quá ân
 * hạn (`delinquency.daysOverdue` ≥ 1 — job billing chỉ ghi khi hết ân hạn). Hoá đơn kỳ mới chưa đến hạn không phải nợ quá hạn.
 * `max` null = không giới hạn trên.
 */
export const AGING_BUCKETS: readonly { key: 'd1_7' | 'd8_15' | 'd16_30' | 'd30p'; label: string; min: number; max: number | null }[] = [
  { key: 'd1_7', label: '1–7 ngày', min: 1, max: 7 },
  { key: 'd8_15', label: '8–15 ngày', min: 8, max: 15 },
  { key: 'd16_30', label: '16–30 ngày', min: 16, max: 30 },
  { key: 'd30p', label: 'Trên 30 ngày', min: 31, max: null },
];

/** Số ngày quá hạn của khoản nợ (0 = không nợ, hoặc nợ nhưng chưa quá ân hạn). */
export const pastDueDays = (c: { balance: { outstanding: number }; delinquency?: { daysOverdue?: number | null } | null }) =>
  c.balance.outstanding > 0 ? Math.max(0, c.delinquency?.daysOverdue ?? 0) : 0;
