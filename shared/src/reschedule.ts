import { addDays, addPeriods, todayISO } from './format';

/**
 * Đổi ngày nhận kho — quy tắc THUẦN dùng chung cho BE (POST /reservations/:id/reschedule), web và app (nút "Đổi ngày nhận kho",
 * date picker). Ô đã bị giữ riêng cho khách từ lúc đặt nên dời ngày không đụng tồn kho; số kỳ, giá, báo giá, chính sách giữ nguyên.
 */

/** Tối đa bấy nhiêu lần đổi ngày cho một đặt chỗ (tính cả nhân viên đổi). */
export const RESCHEDULE_MAX_CHANGES = 3;
/** Ngày mới không muộn hơn NGÀY BẮT ĐẦU GỐC (lúc đặt) quá bấy nhiêu ngày. */
export const RESCHEDULE_MAX_DELAY_DAYS = 30;
/** Như giới hạn đặt trước: ngày mới không quá bấy nhiêu ngày kể từ hôm nay. */
export const RESCHEDULE_MAX_ADVANCE_DAYS = 90;
/** Chỉ đổi được khi đã trả giữ chân và chưa nhận kho. */
export const RESCHEDULE_STATUSES: readonly string[] = ['CONFIRMED', 'ALLOCATED'];

export type RescheduleCode =
  | 'RESCHEDULE_STATE' | 'RESCHEDULE_PAST' | 'RESCHEDULE_SAME' | 'RESCHEDULE_TOO_LATE' | 'RESCHEDULE_LIMIT' | 'RESCHEDULE_LOCKED';

type Iso = string | Date;
export interface ReschedulableReservation {
  status: string;
  startDate: Iso;
  originalStartDate?: Iso | null;
  scheduleChanges?: readonly unknown[] | null;
}

const DAY = 86_400_000;
/** Chuẩn hoá về ngày date-only (00:00Z) dạng ISO; nhận 'YYYY-MM-DD', ISO đầy đủ hoặc Date. Sai định dạng → null. */
export function toDateOnlyISO(d: Iso): string | null {
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toISOString().slice(0, 10)}T00:00:00.000Z`;
}
const ms = (d: Iso) => new Date(toDateOnlyISO(d) ?? NaN).getTime();

/** Số lần còn được đổi ngày. */
export const rescheduleChangesLeft = (r: Pick<ReschedulableReservation, 'scheduleChanges'>) =>
  Math.max(0, RESCHEDULE_MAX_CHANGES - (r.scheduleChanges?.length ?? 0));

/** Ngày bắt đầu gốc (lúc đặt) — mốc tính giới hạn dời muộn. */
export const originalStartOf = (r: Pick<ReschedulableReservation, 'startDate' | 'originalStartDate'>) =>
  toDateOnlyISO(r.originalStartDate ?? r.startDate) as string;

/** Ngày kết thúc mới nếu dời ngày bắt đầu sang `newDate`: giữ nguyên số kỳ và chu kỳ thuê. */
export const rescheduledEndDate = (r: { periods: number; quote: { rentalPeriod: 'DAY' | 'WEEK' | 'MONTH' } }, newDate: Iso) =>
  addPeriods(toDateOnlyISO(newDate) as string, r.quote.rentalPeriod, r.periods);

/**
 * Khoảng ngày được chọn cho date picker (ISO date-only, gồm cả hai đầu). `min` = hôm nay. Trước ngày nhận kho: `max` = sớm hơn của
 * (ngày gốc + 30) và (hôm nay + 90). Từ ngày nhận kho trở đi chỉ được dời SỚM hơn nên `max` = ngày bắt đầu hiện tại (có thể < min
 * → không còn ngày nào hợp lệ).
 */
export function rescheduleWindow(r: ReschedulableReservation, today: Iso = todayISO()): { min: string; max: string } {
  const min = toDateOnlyISO(today) as string;
  const start = toDateOnlyISO(r.startDate) as string;
  if (ms(min) >= ms(start)) return { min, max: start };
  const byOriginal = addDays(originalStartOf(r), RESCHEDULE_MAX_DELAY_DAYS);
  const byToday = addDays(min, RESCHEDULE_MAX_ADVANCE_DAYS);
  return { min, max: ms(byOriginal) < ms(byToday) ? byOriginal : byToday };
}

/** Có đổi ngày nhận kho sang `newDate` được không — BE dùng để chặn (422 + code), UI dùng để ẩn / báo lỗi trước khi gọi API. */
export function rescheduleCheck(
  r: ReschedulableReservation, newDate: Iso, today: Iso = todayISO(),
): { ok: true } | { ok: false; code: RescheduleCode; message: string } {
  const fail = (code: RescheduleCode, message: string) => ({ ok: false as const, code, message });
  if (!RESCHEDULE_STATUSES.includes(r.status)) return fail('RESCHEDULE_STATE', 'Chỉ đổi được ngày khi đã trả tiền giữ chân và chưa nhận kho');
  if (rescheduleChangesLeft(r) <= 0) return fail('RESCHEDULE_LIMIT', `Đã đổi ngày tối đa ${RESCHEDULE_MAX_CHANGES} lần`);
  const next = ms(newDate);
  const now = ms(today);
  const start = ms(r.startDate);
  if (Number.isNaN(next)) return fail('RESCHEDULE_PAST', 'Ngày nhận kho mới không hợp lệ');
  if (next < now) return fail('RESCHEDULE_PAST', 'Ngày nhận kho mới không được ở quá khứ');
  if (next === start) return fail('RESCHEDULE_SAME', 'Ngày mới trùng ngày nhận kho hiện tại');
  if (next > start && now >= start) return fail('RESCHEDULE_LOCKED', 'Đã tới ngày nhận kho — chỉ dời sớm hơn được, không dời muộn hơn');
  if (next > ms(addDays(originalStartOf(r), RESCHEDULE_MAX_DELAY_DAYS))) {
    return fail('RESCHEDULE_TOO_LATE', `Chỉ dời muộn tối đa ${RESCHEDULE_MAX_DELAY_DAYS} ngày so với ngày nhận kho ban đầu`);
  }
  if (next > now + RESCHEDULE_MAX_ADVANCE_DAYS * DAY) return fail('RESCHEDULE_TOO_LATE', `Chỉ nhận đặt trước tối đa ${RESCHEDULE_MAX_ADVANCE_DAYS} ngày`);
  return { ok: true };
}
