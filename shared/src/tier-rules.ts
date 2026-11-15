import type { RentalPeriod, UnitCategory } from './enums';

/**
 * Quy tắc "tiền giữ chân" theo CỠ KHO — MỘT nguồn cho BE (tính báo giá), web và app (hiện lịch thanh toán)
 * để mọi nơi nói cùng một con số.
 *
 * - Kho thường (Locker, S, M): tiền giữ chân = 1 kỳ tiền thuê, trả khi đặt chỗ; tiền thuê kỳ đầu trả THÊM khi nhận kho.
 * - Kho cỡ lớn (L, XL): tiền giữ chân tối thiểu 2 kỳ tiền thuê, và tiền thuê kỳ đầu thu CÙNG LÚC đặt chỗ
 *   (khách trả một lần, đến nhận kho không phải trả thêm).
 *
 * "Kỳ" là chu kỳ khách chọn lúc đặt (ngày / tuần / tháng): thuê theo tháng thì giữ chân 2 tháng tiền thuê.
 */
export interface TierTerms {
  /** Tiền giữ chân = bấy nhiêu kỳ tiền thuê (≥ 1). */
  depositPeriods: number;
  /** true: tiền thuê kỳ đầu thu cùng lúc đặt chỗ. */
  firstPeriodAtBooking: boolean;
}

export const STANDARD_TIER_TERMS: TierTerms = { depositPeriods: 1, firstPeriodAtBooking: false };
export const LARGE_TIER_TERMS: TierTerms = { depositPeriods: 2, firstPeriodAtBooking: true };

const BY_CATEGORY: Partial<Record<UnitCategory, TierTerms>> = { LARGE: LARGE_TIER_TERMS, XL: LARGE_TIER_TERMS };

export const tierTermsOf = (category: UnitCategory): TierTerms => BY_CATEGORY[category] ?? STANDARD_TIER_TERMS;

/**
 * Tiền giữ chân của một báo giá — một hàm cho BE (báo giá thật) và web (xem trước). Nguồn: tiền riêng của loại kho
 * (`depositOverride`), hoặc chính sách chi nhánh (N kỳ tiền thuê / số tiền cố định). Kho cỡ lớn luôn TỐI THIỂU
 * `depositPeriods` kỳ tiền thuê như Điều 3 — tiền riêng hay số cố định thấp hơn mức đó được nâng lên.
 */
export function depositOf(input: { category: UnitCategory; gross: number; override?: number | null; policy: { mode: 'PERIODS_OF_RENT' | 'FIXED'; value: number }; period?: RentalPeriod }): { amount: number; periods: number } {
  const tier = tierTermsOf(input.category);
  // Đợt 15 (C2): thuê theo NGÀY giữ chân tối thiểu DAILY_DEPOSIT_MIN_DAYS ngày tiền thuê (sàn như kho cỡ lớn); tuần / tháng giữ như cũ.
  const minPeriods = depositMinPeriodsOf(input.category, input.period);
  const rentPeriods = input.policy.mode === 'PERIODS_OF_RENT' ? Math.max(input.policy.value, minPeriods) : 1;
  const base = input.override ?? (input.policy.mode === 'FIXED' ? input.policy.value * tier.depositPeriods : Math.round(input.gross * rentPeriods));
  const floor = minPeriods > 1 ? Math.round(input.gross * minPeriods) : 0;
  if (floor > base) return { amount: floor, periods: minPeriods };
  return { amount: base, periods: input.override == null && input.policy.mode === 'PERIODS_OF_RENT' ? rentPeriods : 1 };
}

// ---------- Đợt 15 (C2) — thuê theo ngày ----------
/**
 * Thuê theo NGÀY: tiền giữ chân tối thiểu bấy nhiêu ngày tiền thuê (Điều 3) — thuê vài ngày mà giữ chân 1 ngày thì không đủ bảo đảm
 * hư hại / quá hạn không trả kho. Thuê theo tuần giữ 1 tuần như cũ, theo tháng theo chính sách.
 */
export const DAILY_DEPOSIT_MIN_DAYS = 7;
/**
 * Đặt trước tối đa bấy nhiêu ngày (ngày nhận kho ≤ hôm nay + 7) — MỌI chu kỳ thuê (ngày / tuần / tháng), đặt online và đặt tại quầy.
 * Trước đây 14 ngày (thuê ngày) / 90 ngày (tuần, tháng): giữ ô hàng tháng chờ khách thì mất doanh thu.
 */
export const BOOKING_MAX_LEAD_DAYS = 7;
/** @deprecated Giữ tên cũ cho mã đang dùng — nay bằng BOOKING_MAX_LEAD_DAYS cho mọi chu kỳ. */
export const DAILY_MAX_LEAD_DAYS = BOOKING_MAX_LEAD_DAYS;
/** Đặt trước tối đa bao nhiêu ngày với chu kỳ thuê này — một hàm cho BE (chặn) và web / app (giới hạn ô chọn ngày). Nay mọi chu kỳ như nhau. */
export const maxLeadDaysOf = (_period?: RentalPeriod | null): number => BOOKING_MAX_LEAD_DAYS;
/** Câu báo khi ngày nhận quá xa (BE 422 BOOKING_LEAD_LIMIT, web / app dưới ô chọn ngày). */
export const BOOKING_LEAD_MESSAGE = `Chỉ đặt trước tối đa ${BOOKING_MAX_LEAD_DAYS} ngày`;
/** @deprecated Dùng BOOKING_LEAD_MESSAGE. */
export const DAILY_LEAD_MESSAGE = BOOKING_LEAD_MESSAGE;
/** Số kỳ tiền thuê tối thiểu của tiền giữ chân: kho cỡ lớn 2 kỳ, thuê theo ngày 7 ngày, còn lại 1 kỳ. */
export const depositMinPeriodsOf = (category: UnitCategory, period?: RentalPeriod | null): number =>
  Math.max(tierTermsOf(category).depositPeriods, period === 'DAY' ? DAILY_DEPOSIT_MIN_DAYS : 1);
/** Câu ngắn cho báo giá / lịch thanh toán: "Thuê theo ngày: tiền giữ chân tối thiểu 7 ngày tiền thuê". */
export const DAILY_DEPOSIT_NOTE = `Thuê theo ngày: tiền giữ chân tối thiểu ${DAILY_DEPOSIT_MIN_DAYS} ngày tiền thuê`;

/**
 * Chu kỳ thuê theo CỠ KHO: kho nhỏ (Locker, S, M) thuê được theo ngày / tuần / tháng; kho cỡ lớn (L, XL) CHỈ thuê theo tháng —
 * dọn một kho lớn tốn công, không hợp với thuê vài ngày. BE chặn khi đặt chỗ; web và app làm mờ lựa chọn ngày / tuần.
 */
export const isMonthOnly = (category: UnitCategory): boolean => category === 'LARGE' || category === 'XL';
export const allowsRentalPeriod = (category: UnitCategory, period: RentalPeriod): boolean => period === 'MONTH' || !isMonthOnly(category);
export const MONTH_ONLY_MESSAGE = 'Kho cỡ lớn (L, XL) chỉ cho thuê theo tháng';
