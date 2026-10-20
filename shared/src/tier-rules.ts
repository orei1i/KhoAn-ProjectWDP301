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
export function depositOf(input: { category: UnitCategory; gross: number; override?: number | null; policy: { mode: 'PERIODS_OF_RENT' | 'FIXED'; value: number } }): { amount: number; periods: number } {
  const tier = tierTermsOf(input.category);
  const rentPeriods = input.policy.mode === 'PERIODS_OF_RENT' ? Math.max(input.policy.value, tier.depositPeriods) : 1;
  const base = input.override ?? (input.policy.mode === 'FIXED' ? input.policy.value * tier.depositPeriods : Math.round(input.gross * rentPeriods));
  const floor = tier.depositPeriods > 1 ? Math.round(input.gross * tier.depositPeriods) : 0;
  if (floor > base) return { amount: floor, periods: tier.depositPeriods };
  return { amount: base, periods: input.override == null && input.policy.mode === 'PERIODS_OF_RENT' ? rentPeriods : 1 };
}

/**
 * Chu kỳ thuê theo CỠ KHO: kho nhỏ (Locker, S, M) thuê được theo ngày / tuần / tháng; kho cỡ lớn (L, XL) CHỈ thuê theo tháng —
 * dọn một kho lớn tốn công, không hợp với thuê vài ngày. BE chặn khi đặt chỗ; web và app làm mờ lựa chọn ngày / tuần.
 */
export const isMonthOnly = (category: UnitCategory): boolean => category === 'LARGE' || category === 'XL';
export const allowsRentalPeriod = (category: UnitCategory, period: RentalPeriod): boolean => period === 'MONTH' || !isMonthOnly(category);
export const MONTH_ONLY_MESSAGE = 'Kho cỡ lớn (L, XL) chỉ cho thuê theo tháng';
