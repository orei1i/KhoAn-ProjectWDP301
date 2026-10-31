import type { RentalPeriod } from './enums';
import { addDays, addPeriods } from './format';

/**
 * Mốc kết thúc (endDate, newEndDate, ngày thu kỳ kế tiếp) lưu kiểu NỬA MỞ [bắt đầu, kết thúc): 00:00 ngày kết thúc là lúc bắt đầu
 * tính kỳ kế tiếp. Văn bản và màn hình cho người đọc in NGÀY CUỐI CÙNG được dùng kho (= mốc kết thúc − 1 ngày) với lời "đến hết
 * ngày …" — khớp đúng mốc tính tiền, không ai hiểu nhầm là được trả kho trong chính ngày kết thúc mà không phát sinh kỳ mới.
 */
export const lastDayOf = (end: string) => addDays(end, -1);

/** Hạn chót bàn giao kho để KHÔNG phát sinh tiền thuê kỳ mới: hết ngày trước ngày thu kỳ kế tiếp. */
export const handoverDeadline = (c: { billing: { nextBillingDate: string } }) => lastDayOf(c.billing.nextBillingDate);

/** Đăng ký trả kho trước tối đa bao nhiêu ngày — tránh "đăng ký treo" kéo dài hàng tháng. */
export const MAX_MOVE_OUT_LEAD_DAYS = 30;

/**
 * Ưu đãi thuê dài hạn tính theo SỐ THÁNG (`minPeriods` = số tháng tối thiểu). Chỉ chu kỳ THÁNG mới được hưởng —
 * thuê theo ngày/tuần không có ưu đãi. Một nguồn duy nhất cho BE (báo giá), web, app và dữ liệu mẫu.
 */
export interface DiscountTier {
  code: string;
  kind: 'FIXED' | 'PERCENT';
  value: number;
  minPeriods: number;
  validFrom?: string | Date | null;
  validTo?: string | Date | null;
  requiresApprovalRole?: string | null;
}

/** Bậc cho mức giảm NHIỀU NHẤT trong các bậc khách đủ điều kiện (bậc cao hơn đặt 0% cũng không làm mất ưu đãi bậc thấp). */
export function pickDiscount<T extends DiscountTier>(
  discounts: readonly T[], period: RentalPeriod, periods: number, gross: number, now = new Date(),
): { tier: T; amount: number } | null {
  if (period !== 'MONTH') return null;
  let best: { tier: T; amount: number } | null = null;
  for (const d of discounts) {
    if (periods < d.minPeriods || d.requiresApprovalRole) continue;
    if (d.validFrom && new Date(d.validFrom) > now) continue;
    if (d.validTo && new Date(d.validTo) < now) continue;
    const amount = Math.min(gross, d.kind === 'PERCENT' ? Math.round((gross * d.value) / 100) : d.value);
    if (amount > 0 && (!best || amount > best.amount)) best = { tier: d, amount };
  }
  return best;
}

/**
 * THU HỒI ƯU ĐÃI khi trả kho sớm. Khách được giảm giá vì CAM KẾT thuê dài (VD 12 tháng −20%); trả kho khi mới dùng ít
 * tháng hơn thì chỉ được hưởng mức giảm của số tháng THỰC DÙNG (VD 2 tháng → 0%, 4 tháng → mức của bậc 3 tháng).
 * Phần chênh mỗi tháng × số tháng đã dùng bị thu hồi, trừ vào tiền giữ chân lúc quyết toán. Một nguồn cho BE và bản xem trước.
 *
 * `usedPeriods` = số kỳ đã bắt đầu tính đến ngày trả kho (kỳ đang dùng dở tính trọn, tối thiểu 1).
 */
/**
 * Hợp đồng có CAM KẾT THỜI HẠN hay không: chỉ khi khách được giảm giá vì thuê dài hạn (thuê theo tháng, đủ bậc ưu đãi).
 * Giới hạn mức hoàn tiền giữ chân khi trả kho sớm là cái giá của việc phá cam kết đó — hợp đồng ngắn / theo ngày / theo tuần
 * không được giảm gì và đã trả đủ tiền từng kỳ, nên trả sớm KHÔNG bị giới hạn mức hoàn.
 */
export const hasTermCommitment = (q?: { rentalPeriod: RentalPeriod; discountAmount: number } | null) => !!q && q.rentalPeriod === 'MONTH' && q.discountAmount > 0;

export function discountClawback(i: {
  rentalPeriod: RentalPeriod; rate: number; surchargeAmount: number; discountAmount: number;
  discounts: readonly DiscountTier[]; startDate: string; moveOutDate: string;
}): { usedPeriods: number; entitledPerPeriod: number; amount: number } | null {
  if (i.rentalPeriod !== 'MONTH' || !(i.discountAmount > 0)) return null;
  let usedPeriods = 1;
  while (usedPeriods < 120 && addPeriods(i.startDate, 'MONTH', usedPeriods) < i.moveOutDate) usedPeriods++;
  const gross = i.rate + i.surchargeAmount;
  // Bậc giảm xét theo thời điểm đặt (startDate) — ưu đãi hết hạn về sau không làm khách bị thu hồi oan.
  const entitledPerPeriod = Math.min(i.discountAmount, pickDiscount(i.discounts, 'MONTH', usedPeriods, gross, new Date(i.startDate))?.amount ?? 0);
  const amount = (i.discountAmount - entitledPerPeriod) * usedPeriods;
  return amount > 0 ? { usedPeriods, entitledPerPeriod, amount } : null;
}

/** Bản xem trước thu hồi ưu đãi cho một hợp đồng nếu trả kho vào `moveOutDate` (null: không trả sớm / không có ưu đãi / thiếu dữ liệu). */
/**
 * Mốc bắt đầu của một lần GIA HẠN: bình thường là ngày hết hạn hiện tại; nếu hợp đồng đã quá hạn và hệ thống đã xuất hoá đơn
 * cho các kỳ sau ngày hết hạn (khách vẫn giữ kho) thì bắt đầu từ kỳ CHƯA xuất hoá đơn — nếu không khách trả hai lần cho kỳ đó.
 */
export const renewalStart = (c: { endDate: string; billing: { nextBillingDate: string } }) => (c.billing.nextBillingDate > c.endDate ? c.billing.nextBillingDate : c.endDate);

/**
 * Số kỳ khoản RENEWAL của một lần gia hạn đã trả trước: tính từ `previousEndDate` tới `prepaidUntil` (đợt 14 — thuê tháng trả tháng đầu
 * = 1 kỳ); dữ liệu cũ không có `prepaidUntil` = cả `periods` kỳ của lần gia hạn.
 */
export function renewalPrepaidPeriods(r: { previousEndDate: string; periods: number; prepaidUntil?: string | null }, period: RentalPeriod): number {
  if (!r.prepaidUntil) return r.periods;
  const until = new Date(r.prepaidUntil).getTime();
  let n = 0;
  while (n < r.periods && new Date(addPeriods(r.previousEndDate, period, n)).getTime() < until) n++;
  return n;
}

/**
 * Tiền thuê khách đã TRẢ TRƯỚC khi gia hạn cho các kỳ CHƯA bắt đầu tại ngày bàn giao kho — hoàn lại khi trả kho (Điều khoản chỉ
 * không hoàn tiền của kỳ đang sử dụng). Chỉ áp cho thuê theo THÁNG; thuê ngày / tuần đã thoả thuận không hoàn kỳ chưa dùng.
 * Đợt 15 (B9): chỉ hoàn kỳ bắt đầu SAU ngày bàn giao — bàn giao TRƯỚC ngày bắt đầu kỳ đó; bàn giao đúng ngày bắt đầu kỳ thì kỳ đó đã
 * được dùng, không hoàn (khớp Phụ lục gia hạn và cách tính kỳ thường: bàn giao trước ngày thu kỳ kế tiếp mới không phát sinh kỳ mới).
 * `periods` = số kỳ khoản trả trước bao phủ — có `prepaidUntil` (đợt 14: gia hạn tháng
 * chỉ trả trước tháng đầu) thì tính lại theo mốc đó (renewalPrepaidPeriods), nên truyền kèm `prepaidUntil` của lần gia hạn.
 */
export function unusedPrepaidRent(
  period: RentalPeriod,
  renewals: readonly { key: string; previousEndDate: string; periods: number; amount: number; prepaidUntil?: string | null }[],
  returnedOn: string,
): { total: number; items: { key: string; unusedPeriods: number; amount: number }[] } {
  if (period !== 'MONTH') return { total: 0, items: [] };
  const items = renewals.map((r) => {
    const covered = renewalPrepaidPeriods(r, period);
    let unusedPeriods = 0;
    for (let i = 0; i < covered; i++) if (new Date(addPeriods(r.previousEndDate, period, i)).getTime() > new Date(returnedOn).getTime()) unusedPeriods++;
    return { key: r.key, unusedPeriods, amount: covered > 0 ? Math.round((r.amount * unusedPeriods) / covered) : 0 };
  }).filter((x) => x.amount > 0);
  return { total: items.reduce((s, x) => s + x.amount, 0), items };
}

/** Báo giá một lần gia hạn (GET /contracts/:id/extension-quote) — gia hạn là cam kết mới, xem contract.service.quoteExtension. */
export interface ExtensionQuote {
  rentalPeriod: RentalPeriod; periods: number; from: string; newEndDate: string;
  /** Giá niêm yết hiện hành mỗi kỳ (gồm phụ phí điều hòa nếu có), ưu đãi theo số tháng gia hạn, và tiền thuê mỗi kỳ sau ưu đãi. */
  gross: number; discountAmount: number; rate: number;
  /** Tiền thuê mỗi kỳ khách đang trả hiện nay. */
  currentRate: number;
  /**
   * Phải trả ngay khi gia hạn: thuê tháng = tiền thuê THÁNG ĐẦU của kỳ gia hạn (= rate; đợt 14 — các tháng sau xuất hoá đơn từng tháng);
   * thuê ngày / tuần = trọn kỳ gia hạn.
   */
  payNow: number;
  /** Ân hạn trả tiền các tháng sau (ngày, theo hợp đồng) — cho dòng "hạn trả …" của lịch thanh toán gia hạn. */
  gracePeriodDays?: number;
  /** Phụ lục gia hạn khách sẽ xác nhận (bản xem trước, đúng nguyên văn sẽ được lưu). */
  appendix?: { number: number; title: string; clauses: { title: string; paragraphs: string[]; bullets: string[] }[] };
  /** Phiên bản chính sách dựng phụ lục + dấu nội dung phụ lục (đợt 16 C2) — gửi lại trong `expected` khi gia hạn (lệch → 409 APPENDIX_CHANGED). */
  policyVersion?: number;
  appendixHash?: string;
}

/** Giá một kỳ cam kết tại một ngày — đợt 15 (C3): sau các lần ĐỔI CỠ KHO (`repricings`, mỗi lần áp từ ngày `from`). */
export interface SegmentPrice { gross: number; discountAmount: number; rate: number }
export type PricedSegment = { gross: number; rate?: number; discountAmount?: number; repricings?: readonly { from: string | Date; gross: number; discountAmount: number; rate: number }[] | null };

/** Giá áp tại ngày `at` của một kỳ cam kết: lần đổi cỡ gần nhất có hiệu lực từ trước / đúng ngày đó; không có thì giá gốc của kỳ. */
export function priceAt(seg: PricedSegment, at: string | Date): SegmentPrice {
  const discountAmount = seg.discountAmount ?? (seg.rate !== undefined ? seg.gross - seg.rate : 0);
  let p: SegmentPrice = { gross: seg.gross, discountAmount, rate: seg.rate ?? seg.gross - discountAmount };
  let best = -Infinity;
  const t = new Date(at).getTime();
  for (const r of seg.repricings ?? []) {
    const f = new Date(r.from).getTime();
    if (f <= t && f >= best) { best = f; p = { gross: r.gross, discountAmount: r.discountAmount, rate: r.rate }; }
  }
  return p;
}

/** Một kỳ cam kết của hợp đồng (kỳ gốc hoặc một lần gia hạn) — xem RentalContract.commitments. */
export interface CommitmentLike { startDate: string; endDate: string; gross: number; discountAmount: number; rate?: number; policyId?: string | null; repricings?: PricedSegment['repricings'] }
type QuoteForExit = { rentalPeriod: RentalPeriod; rate: number; surchargeAmount: number; discountAmount: number; policyId?: string | null };

/**
 * Kỳ cam kết mà ngày `date` rơi vào — tức kỳ khách đang "phá" nếu trả kho hôm đó. null = không trong kỳ cam kết nào
 * (đã hết hạn mà không gia hạn) → trả kho không bị giới hạn mức hoàn, không thu hồi ưu đãi.
 * Hợp đồng cũ chưa có `commitments`: coi cả hợp đồng là một kỳ theo báo giá lúc đặt.
 */
export function exitCommitment(
  c: { startDate: string; endDate: string; commitments?: readonly CommitmentLike[] | null },
  quote: QuoteForExit | null | undefined,
  date: string,
): CommitmentLike | null {
  if (c.commitments?.length) return c.commitments.find((s) => s.startDate <= date && date < s.endDate) ?? null;
  if (!quote || date >= c.endDate) return null;
  return { startDate: c.startDate, endDate: c.endDate, gross: quote.rate + quote.surchargeAmount, discountAmount: quote.rentalPeriod === 'MONTH' ? quote.discountAmount : 0, policyId: quote.policyId ?? null };
}

/** Thu hồi ưu đãi nếu trả kho vào `moveOutDate` — tính trên KỲ CAM KẾT đang dở, theo bảng ưu đãi của chính sách lúc cam kết. */
export function contractClawback(
  c: { startDate: string; endDate: string; commitments?: readonly CommitmentLike[] | null },
  quote: QuoteForExit | null | undefined,
  policies: readonly { _id: string; discounts: readonly DiscountTier[] }[] | null | undefined,
  moveOutDate: string,
) {
  const seg = exitCommitment(c, quote, moveOutDate);
  if (!seg || !(seg.discountAmount > 0)) return null;
  const discounts = policies?.find((p) => p._id === seg.policyId)?.discounts;
  if (!discounts) return null;
  const claw = commitmentClawback(seg, discounts, moveOutDate);
  return claw ? { ...claw, discountPerPeriod: priceAt(seg, moveOutDate).discountAmount } : null;
}

/**
 * Thu hồi ưu đãi của MỘT kỳ cam kết nếu trả kho vào `moveOutDate`. Kỳ đã đổi cỡ kho (đợt 15 C3 — `repricings`): tính TỪNG THÁNG đã dùng
 * theo giá / ưu đãi thực tế của tháng đó (trước và sau ngày đổi), mức được hưởng theo số tháng thực dùng của cả kỳ; không đổi cỡ thì
 * đúng như discountClawback.
 */
export function commitmentClawback(seg: CommitmentLike, discounts: readonly DiscountTier[], moveOutDate: string): { usedPeriods: number; entitledPerPeriod: number; amount: number } | null {
  if (!seg.repricings?.length) return discountClawback({ rentalPeriod: 'MONTH', rate: seg.gross, surchargeAmount: 0, discountAmount: seg.discountAmount, discounts, startDate: seg.startDate, moveOutDate });
  let usedPeriods = 1;
  while (usedPeriods < 120 && addPeriods(seg.startDate, 'MONTH', usedPeriods) < moveOutDate) usedPeriods++;
  let amount = 0;
  let entitledPerPeriod = 0;
  for (let k = 0; k < usedPeriods; k++) {
    const p = priceAt(seg, addPeriods(seg.startDate, 'MONTH', k));
    // Bậc xét theo thời điểm cam kết (startDate) — như discountClawback.
    entitledPerPeriod = Math.min(p.discountAmount, pickDiscount(discounts, 'MONTH', usedPeriods, p.gross, new Date(seg.startDate))?.amount ?? 0);
    amount += p.discountAmount - entitledPerPeriod;
  }
  return amount > 0 ? { usedPeriods, entitledPerPeriod, amount } : null;
}

/** % giảm cao nhất khách được hưởng khi thuê `months` tháng (chỉ tính bậc theo %) — dùng cho nhãn "Tiết kiệm x%". */
export const discountPctFor = (discounts: readonly DiscountTier[], months: number, now = new Date()) =>
  pickDiscount(discounts.filter((d) => d.kind === 'PERCENT'), 'MONTH', months, 100, now)?.amount ?? 0;

// ---------- Bộ chọn "Bạn sẽ gửi trong bao lâu?" (web + app dùng chung) ----------
export type DurationKey = 'SHORT' | 'M1' | 'M2' | 'M3' | 'M6' | 'Y1';
export const DURATION_CHOICES: readonly { key: DurationKey; label: string; months: number | null }[] = [
  { key: 'SHORT', label: 'Dưới 1 tháng', months: null },
  { key: 'M1', label: '1 tháng', months: 1 },
  { key: 'M2', label: '2 tháng', months: 2 },
  { key: 'M3', label: '3 tháng', months: 3 },
  { key: 'M6', label: '6 tháng', months: 6 },
  { key: 'Y1', label: '1+ năm', months: 12 },
];

/** Nút nào đang được chọn theo (chu kỳ, số chu kỳ); null = số tháng tuỳ ý (4, 5, 7–11 tháng) không trùng nút nào. */
export function durationKeyOf(period: RentalPeriod, periods: number): DurationKey | null {
  if (period !== 'MONTH') return 'SHORT';
  if (periods >= 12) return 'Y1';
  return DURATION_CHOICES.find((c) => c.months === periods)?.key ?? null;
}

/** Bấm một nút thì đặt chu kỳ/số chu kỳ nào. "Dưới 1 tháng" mặc định 2 tuần (giữ nguyên nếu đang ở ngày/tuần). */
export function applyDurationChoice(key: DurationKey, current: { period: RentalPeriod; periods: number }): { period: RentalPeriod; periods: number } {
  const c = DURATION_CHOICES.find((x) => x.key === key)!;
  if (c.months === null) return current.period === 'MONTH' ? { period: 'WEEK', periods: 2 } : current;
  return { period: 'MONTH', periods: key === 'Y1' && current.period === 'MONTH' && current.periods >= 12 ? current.periods : c.months };
}
