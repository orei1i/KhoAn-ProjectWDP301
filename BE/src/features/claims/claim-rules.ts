/**
 * Quy tắc bồi thường hư hỏng / mất mát (A2).
 *
 * Các con số ở đây là ĐIỀU KHOẢN, không phải cấu hình vận hành — chúng phải khớp với bản Điều khoản
 * dịch vụ khách đã bấm đồng ý (Webapp/src/features/legal/legal-content.ts). Vì vậy chúng nằm trong code và đi kèm một
 * lần phát hành, thay vì nằm trong BusinessPolicy để quản lý sửa được bất cứ lúc nào.
 *
 * Mỗi hồ sơ chốt (snapshot) hạn mức vào chính nó khi duyệt → sửa hằng số này không hồi tố hồ sơ cũ.
 */

/** Hạn mức trách nhiệm tối đa cho MỘT sự vụ, mỗi hợp đồng. */
export const CLAIM_LIABILITY_CAP = 20_000_000;

/** Thời hạn gửi yêu cầu, tính từ ngày xảy ra sự cố. Quá hạn thì không nhận. */
export const CLAIM_WINDOW_DAYS = 30;

/** Số hồ sơ đang mở tối đa trên một hợp đồng. Chặn gửi trùng, không phải chặn quyền khiếu nại. */
export const MAX_OPEN_CLAIMS_PER_CONTRACT = 3;

/** Tổng khách yêu cầu. Luôn tính ở server từ items — client gửi lên gì cũng bị ghi đè. */
export const claimTotal = (items: { quantity: number; unitValue: number }[]) =>
  items.reduce((sum, it) => sum + it.quantity * it.unitValue, 0);
