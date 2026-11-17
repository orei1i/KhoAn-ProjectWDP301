import { addDays, CLAIM_WINDOW_DAYS, isClosedContract, todayISO, type RentalContract } from '@ssm/shared';

/**
 * Hạn gửi yêu cầu bồi thường của một hợp đồng — khớp createClaim ở BE (claim.service.ts): hợp đồng còn mở thì gửi được; đã trả kho
 * (CLOSED) thì còn nhận trong CLAIM_WINDOW_DAYS ngày kể từ ngày đóng; ABANDONED (đồ bỏ lại đã thanh lý) không nhận.
 * `until`: ngày cuối còn nhận (date-only 00:00Z) — chỉ có với hợp đồng đã đóng.
 */
export function claimWindow(c: Pick<RentalContract, 'status' | 'closedAt'>, today = todayISO()): { canFile: boolean; until: string | null } {
  if (c.status === 'ABANDONED') return { canFile: false, until: null };
  if (c.status !== 'CLOSED' || !c.closedAt) return { canFile: true, until: null };
  const until = addDays(`${c.closedAt.slice(0, 10)}T00:00:00.000Z`, CLAIM_WINDOW_DAYS);
  return { canFile: today <= until, until };
}

/** Hợp đồng đã kết thúc còn gửi được yêu cầu hỗ trợ: đóng trong 30 ngày, hoặc còn nợ sau quyết toán — như trang Hỗ trợ và BE. */
export const canOpenTicket = (c: Pick<RentalContract, 'status' | 'closedAt' | 'balance'>, today = todayISO()) =>
  !isClosedContract(c.status) || (c.closedAt ?? '') >= addDays(today, -30) || c.balance.outstanding > 0;
