/**
 * Quy tắc bồi thường hư hỏng / mất mát — là ĐIỀU KHOẢN (Điều 6 Điều khoản thuê kho), không phải cấu hình vận hành. Dùng chung BE,
 * Webapp, app để mọi nơi tính cùng một mức. Mỗi hồ sơ chốt mức trách nhiệm vào chính nó lúc duyệt → đổi hằng số về sau không hồi tố.
 */

/** Trần trách nhiệm một sự vụ = số tháng này × tiền thuê MỘT THÁNG của ô kho (giá niêm yết theo tháng của loại kho). */
export const CLAIM_CAP_MONTHS = 10;
/** Điều 6: "tối đa mười lần tiền thuê một tháng của ô kho đó, hoặc giá trị thiệt hại thực tế — lấy giá trị nhỏ hơn". */
export const claimLiabilityCap = (monthlyRent: number) => CLAIM_CAP_MONTHS * Math.max(0, Math.round(monthlyRent));

/** Thời hạn gửi yêu cầu, tính từ ngày xảy ra sự cố. */
export const CLAIM_WINDOW_DAYS = 30;

/**
 * Quản lý chi nhánh tự duyệt tối đa mức này cho một hồ sơ; lớn hơn phải Quản lý vận hành duyệt. Người duyệt cũng không được tự chi
 * hay tự xác nhận đã chuyển khoản — mỗi khoản bồi thường luôn qua tay hai người.
 */
export const CLAIM_FM_APPROVAL_LIMIT = 5_000_000;

/** Tổng khách yêu cầu. Server luôn tự tính từ items — client gửi lên gì cũng bị ghi đè. */
export const claimTotal = (items: { quantity: number; unitValue: number }[]) =>
  items.reduce((sum, it) => sum + it.quantity * it.unitValue, 0);

/** Mức trách nhiệm của một hợp đồng để HIỂN THỊ (server tính lại khi duyệt): theo giá thuê tháng của loại kho trong hợp đồng. */
export function claimCapOf(contract: { unitTypeId: string } | null | undefined, unitTypes: readonly { _id: string; rates: { MONTH: number } }[]): number | null {
  const ut = contract ? unitTypes.find((t) => t._id === contract.unitTypeId) : undefined;
  return ut ? claimLiabilityCap(ut.rates.MONTH) : null;
}
