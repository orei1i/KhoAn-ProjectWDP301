/**
 * Quy tắc phí đổi ô kho theo yêu cầu (A1b) — dùng chung server và màn duyệt của chi nhánh.
 *
 * Các con số ở đây là quy tắc vận hành cố định trong code (không nằm trong BusinessPolicy) —
 * cùng cách mức trách nhiệm bồi thường nằm trong claim-rules: đổi phí là quyết định sản phẩm cần
 * phát hành có chủ đích, không phải cấu hình Quản lý vận hành sửa được bất cứ lúc nào.
 *
 * - Đổi do LỖI CƠ SỞ (FM xác nhận lúc duyệt) → luôn miễn phí.
 * - LẦN ĐẦU khách đổi ô trên một hợp đồng → miễn phí (thiện chí).
 * - Từ lần thứ 2, không phải lỗi cơ sở → phí thao tác cố định.
 * - Chọn thuê người chuyển → cộng thêm phí chuyển đồ.
 * - FM được sửa phí trong trần SWAP_FEE_MAX (bao gồm cả phí chuyển đồ nếu có) kèm lý do.
 */
export const SWAP_FEE_DEFAULT = 150_000;
export const DELIVERY_FEE_DEFAULT = 300_000;
export const SWAP_FEE_MAX = 1_000_000;

/** Khách tự chuyển có 7 ngày kể từ lúc được duyệt để lên chuyển đồ; quá hạn thì yêu cầu tự hủy. */
export const SWAP_SELF_MOVE_DAYS = 7;
/** Chi nhánh không duyệt / từ chối trong bấy nhiêu ngày thì yêu cầu tự hết hạn — ô đích không bị giữ vô thời hạn. */
export const SWAP_DECISION_DAYS = 7;
/** Thuê người chuyển: quá ngày hẹn chuyển bấy nhiêu ngày mà chưa xác nhận xong thì yêu cầu hết hạn, ô đích được nhả. */
export const SWAP_DELIVERY_GRACE_DAYS = 3;

/** Đổi do lỗi chi nhánh hoặc lần đổi đầu tiên của hợp đồng: miễn phí — đúng lời hứa trên màn hình khách, FM không đặt phí khác. */
export const isFreeSwap = (input: { facilityFault: boolean; isFirstSwap: boolean }) => input.facilityFault || input.isFirstSwap;

/**
 * RV3 — AI CHỊU HƯ HẠI / MẤT MÁT KHI CHUYỂN ĐỒ ĐỔI Ô (giống cách các kho tự quản và dịch vụ chuyển đồ đang làm):
 *  - Tự chuyển: khách tự vận chuyển → khách tự chịu rủi ro trong lúc chuyển; KhoAn chỉ chịu phần do kho gây ra (Điều 6).
 *  - Thuê người chuyển: chi nhánh cử người → trước khi bàn giao, nhân viên ĐẾM SỐ KIỆN + CHỤP ẢNH (biên bản chuyển đồ, khách xem được).
 *    Hư hại / mất mát trong lúc chi nhánh chuyển do KhoAn chịu: khách gửi yêu cầu bồi thường như thường lệ, chi nhánh đối chiếu biên bản
 *    chuyển đồ; mức bồi thường theo Điều 6 (thiệt hại thực tế, tối đa CLAIM_CAP_MONTHS lần tiền thuê một tháng).
 */
export const SWAP_LIABILITY: Record<'SELF' | 'DELIVERY', string> = {
  SELF: 'Bạn tự chuyển đồ: hư hại / mất mát trong lúc bạn tự chuyển do bạn tự chịu. KhoAn chỉ chịu trách nhiệm phần do kho gây ra.',
  DELIVERY: 'Chi nhánh cử người chuyển: nhân viên đếm số kiện và chụp ảnh khi chuyển (bạn xem được trong tài khoản). Hư hại / mất mát trong lúc chi nhánh chuyển do KhoAn chịu — gửi yêu cầu bồi thường, chi nhánh đối chiếu biên bản chuyển đồ.',
};
/** Báo hư hại / mất mát trong vòng bấy nhiêu ngày sau khi chi nhánh chuyển đồ thì coi là có thể do việc chuyển — chi nhánh đối chiếu biên bản. */
export const SWAP_DELIVERY_CLAIM_DAYS = 7;
/**
 * Lần CHI NHÁNH chuyển đồ (DELIVERY, đã xong) của hợp đồng mà ngày sự cố rơi vào [ngày chuyển, ngày chuyển + SWAP_DELIVERY_CLAIM_DAYS] —
 * màn xét bồi thường nhắc người duyệt: trách nhiệm của KhoAn, đối chiếu biên bản chuyển đồ (số kiện, ảnh).
 */
export function deliveryMoveFor<S extends { contractId: string; method: string; status: string; completedAt?: string | null }>(swaps: readonly S[], contractId: string, incidentAt: string): S | null {
  const day = incidentAt.slice(0, 10);
  return swaps.find((s) => {
    if (s.contractId !== contractId || s.method !== 'DELIVERY' || s.status !== 'DONE' || !s.completedAt) return false;
    const from = s.completedAt.slice(0, 10);
    const to = new Date(new Date(`${from}T00:00:00Z`).getTime() + SWAP_DELIVERY_CLAIM_DAYS * 86_400_000).toISOString().slice(0, 10);
    return from <= day && day <= to;
  }) ?? null;
}
/** Số kiện / món tối đa ghi trong biên bản chuyển đồ. */
export const MOVE_CHECK_PACKAGES_MAX = 999;

/** Phí mặc định hệ thống đề xuất khi FM mở màn duyệt — ngoài trường hợp miễn phí, FM có thể sửa trong trần SWAP_FEE_MAX. */
export function defaultSwapFee(input: { facilityFault: boolean; isFirstSwap: boolean; method: 'SELF' | 'DELIVERY' }): number {
  if (isFreeSwap(input)) return 0;
  return SWAP_FEE_DEFAULT + (input.method === 'DELIVERY' ? DELIVERY_FEE_DEFAULT : 0);
}
