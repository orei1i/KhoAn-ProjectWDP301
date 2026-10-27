import type { UnitSwapRequest } from '@ssm/shared';
import { OPEN_SWAP_STATUSES, addDays, todayISO } from '@ssm/shared';

/** Yêu cầu đổi ô vừa kết thúc (từ chối / hết hạn / huỷ) còn hiện kèm lý do trong chừng này ngày. */
const SWAP_RECENT_DAYS = 7;
const ENDED_SWAP_STATUSES: readonly string[] = ['REJECTED', 'EXPIRED', 'CANCELLED'];
/** Lúc yêu cầu đổi ô chuyển sang trạng thái hiện tại (mục lịch sử cuối cùng tới trạng thái đó). */
export const swapEndedAt = (s: UnitSwapRequest) => [...s.statusHistory].reverse().find((h) => h.to === s.status)?.at ?? s.updatedAt;

/**
 * Yêu cầu đổi ô của một hợp đồng: yêu cầu đang mở (chờ duyệt / đã duyệt chờ chuyển), hoặc — khi không còn yêu cầu mở — yêu cầu
 * vừa kết thúc gần đây để khách biết vì sao. Dùng chung cho dòng trạng thái ở màn Hợp đồng và màn Đổi ô.
 */
export function contractSwaps(swaps: UnitSwapRequest[], contractId: string | undefined) {
  const openSwap = swaps.find((s) => s.contractId === contractId && (OPEN_SWAP_STATUSES as readonly string[]).includes(s.status));
  const recentSwap = openSwap ? undefined : swaps
    .filter((s) => s.contractId === contractId && ENDED_SWAP_STATUSES.includes(s.status) && swapEndedAt(s) >= addDays(todayISO(), -SWAP_RECENT_DAYS))
    .sort((a, b) => swapEndedAt(b).localeCompare(swapEndedAt(a)))[0];
  return { openSwap, recentSwap };
}
