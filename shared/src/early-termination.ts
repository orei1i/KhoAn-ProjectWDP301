import { exitCommitment } from './duration';
import { earlyTerminationOf } from './policy-defaults';

/**
 * Xem trước TRẦN % hoàn tiền giữ chân nếu khách bàn giao kho vào ngày `date` (chưa gửi đăng ký trả kho) — cùng công thức với
 * server (`elapsedTermPct` + `earlyTerminationRefundPct` ở BE/src/features/policies/pricing.ts) và `earlyTerminationPreview` ở web.
 * Chỉ kỳ cam kết đang dở tại ngày đó và có ưu đãi thuê dài hạn mới bị giới hạn mức hoàn; không thì trả về null (hoàn đủ).
 * Bảng mức hoàn lấy theo chính sách ĐÃ CHỐT lúc cam kết (`policyId` của kỳ); không có trong danh sách thì dùng `fallback`.
 */
export function earlyTerminationPreviewOf(
  c: Parameters<typeof exitCommitment>[0],
  quote: Parameters<typeof exitCommitment>[1],
  policies: readonly { _id: string; earlyTermination?: { maxElapsedPct: number; depositRefundPct: number }[] }[] | null | undefined,
  fallback: { earlyTermination?: { maxElapsedPct: number; depositRefundPct: number }[] } | null | undefined,
  date: string,
): { elapsedPct: number; refundCapPct: number } | null {
  const seg = exitCommitment(c, quote, date);
  if (!seg || !(seg.discountAmount > 0)) return null;
  const policy = policies?.find((p) => p._id === seg.policyId) ?? fallback ?? {};
  const span = new Date(seg.endDate).getTime() - new Date(seg.startDate).getTime();
  const elapsed = span <= 0 ? 100 : Math.min(100, Math.max(0, ((new Date(date).getTime() - new Date(seg.startDate).getTime()) / span) * 100));
  const tier = [...earlyTerminationOf(policy)].sort((a, b) => a.maxElapsedPct - b.maxElapsedPct).find((t) => elapsed <= t.maxElapsedPct);
  return { elapsedPct: Math.round(elapsed), refundCapPct: tier?.depositRefundPct ?? 0 };
}
