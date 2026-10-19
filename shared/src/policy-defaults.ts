import type { AccessRequestType } from './enums';
import type { BusinessPolicy } from './entities';

/**
 * Chính sách tạo TRƯỚC khi có hai trường này (trong DB đang chạy, hoặc dữ liệu cũ chưa seed lại) không
 * mang `earlyTermination` / `abandonAfterLockedOutDays`. Chính sách là bản ghi bất biến nên không sửa tại chỗ —
 * mọi nơi đọc đi qua các hàm dưới đây để luôn có giá trị hợp lệ thay vì `undefined` làm sập trang hoặc
 * (ở BE) vô tình hoàn 0% cọc / cho xử lý hàng bỏ lại ngay lập tức.
 */
export const DEFAULT_EARLY_TERMINATION: BusinessPolicy['earlyTermination'] = [
  // Càng gần hết hạn càng được hoàn nhiều: bỏ ngang ngay từ đầu kỳ hạn thì mất tiền giữ chân, đi gần hết kỳ hạn thì hoàn đủ.
  { maxElapsedPct: 25, depositRefundPct: 0 },
  { maxElapsedPct: 50, depositRefundPct: 50 },
  { maxElapsedPct: 100, depositRefundPct: 100 },
];
/** Số ngày phải chờ KỂ TỪ THÔNG BÁO CUỐI (không phải từ lúc khoá) trước khi được xử lý đồ bỏ lại. Tên trường giữ nguyên để khỏi đổi dữ liệu. */
export const DEFAULT_ABANDON_AFTER_LOCKED_OUT_DAYS = 30;

/** Phí cấp lại mã/thẻ/chìa mặc định: đặt lại mật khẩu miễn phí, làm lại thẻ 50.000đ, cấp lại chìa miễn phí (Ops chỉnh được ở trang Chính sách). */
export const DEFAULT_ACCESS_FEES: Record<AccessRequestType, number> = { PIN_RESET: 0, CARD_REISSUE: 50_000, KEY_REISSUE: 0 };

type WithNewFields = Partial<Pick<BusinessPolicy, 'earlyTermination' | 'abandonAfterLockedOutDays' | 'accessFees'>>;

/** Phí cấp lại theo loại yêu cầu; thiếu (chính sách cũ) → mặc định. */
export const accessFeeOf = (p: WithNewFields, type: AccessRequestType): number => p.accessFees?.[type] ?? DEFAULT_ACCESS_FEES[type];

/** Bậc hoàn cọc trả sớm của chính sách; thiếu hoặc rỗng → bậc mặc định 0/50/100 theo % kỳ hạn đã dùng (càng gần hết hạn càng hoàn nhiều). */
export const earlyTerminationOf = (p: WithNewFields) => (p.earlyTermination?.length ? p.earlyTermination : DEFAULT_EARLY_TERMINATION);

/** Số ngày LOCKED_OUT trước khi được xử lý hàng bỏ lại; thiếu → 30 ngày. */
export const abandonDaysOf = (p: WithNewFields) => p.abandonAfterLockedOutDays ?? DEFAULT_ABANDON_AFTER_LOCKED_OUT_DAYS;

/** Bản sao có đủ hai trường — dùng ở nơi nhận chính sách dạng object thuần (JSON từ API, `.lean()`), KHÔNG dùng cho document mongoose. */
export function withPolicyDefaults<P extends WithNewFields>(p: P): P & Required<WithNewFields> {
  return { ...p, earlyTermination: earlyTerminationOf(p), abandonAfterLockedOutDays: abandonDaysOf(p), accessFees: { ...DEFAULT_ACCESS_FEES, ...p.accessFees } };
}
