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

/** Một bậc hoàn tiền giữ chân khi trả kho sớm (policy.earlyTermination). */
export interface EarlyExitTier { maxElapsedPct: number; depositRefundPct: number }

/**
 * Đợt 15 (F6) — câu nói rõ lúc ĐẶT KHO (lịch thanh toán + câu khách tick) cho báo giá có ưu đãi cam kết thuê dài hạn: trả kho trước X%
 * thời hạn thì hoàn Y% tiền giữ chân (đúng các bậc của chính sách) và thu lại phần ưu đãi đã hưởng. Bậc hoàn đủ (100%) không cần nêu.
 */
export function earlyExitText(tiers: readonly EarlyExitTier[]): string {
  const sorted = [...earlyTerminationOf({ earlyTermination: [...tiers] })].sort((a, b) => a.maxElapsedPct - b.maxElapsedPct);
  const steps = sorted.filter((t) => t.depositRefundPct < 100 && t.maxElapsedPct < 100)
    .map((t) => `trước ${t.maxElapsedPct}% thời hạn: hoàn ${t.depositRefundPct}% tiền giữ chân`);
  const caps = steps.length ? steps.join('; ') : 'sớm: hoàn tiền giữ chân theo bậc của chính sách';
  return `Trả kho ${caps} — và thu lại phần ưu đãi thuê dài hạn đã hưởng vượt mức của số tháng thực dùng.`;
}
