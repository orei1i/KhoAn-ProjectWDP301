/**
 * Quy tắc phí đổi ô kho theo yêu cầu (A1b).
 *
 * Các con số ở đây là quy tắc vận hành cố định trong code (không nằm trong BusinessPolicy) —
 * cùng cách CLAIM_LIABILITY_CAP nằm trong claim-rules.ts: đổi phí là quyết định sản phẩm cần
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
/** Thuê người chuyển: quá ngày hẹn chuyển bấy nhiêu ngày mà chưa xác nhận xong thì yêu cầu hết hạn, ô đích được nhả. */
export const SWAP_DELIVERY_GRACE_DAYS = 3;

/** Phí mặc định hệ thống đề xuất khi FM mở màn duyệt — FM có thể sửa trong trần SWAP_FEE_MAX. */
export function defaultSwapFee(input: { facilityFault: boolean; isFirstSwap: boolean; method: 'SELF' | 'DELIVERY' }): number {
  if (input.facilityFault || input.isFirstSwap) return 0;
  return SWAP_FEE_DEFAULT + (input.method === 'DELIVERY' ? DELIVERY_FEE_DEFAULT : 0);
}
