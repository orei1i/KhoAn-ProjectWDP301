import { addDays, addPeriods, todayISO } from './format';
import { DAILY_MAX_LEAD_DAYS } from './tier-rules';

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
  | 'RESCHEDULE_STATE' | 'RESCHEDULE_PAST' | 'RESCHEDULE_SAME' | 'RESCHEDULE_TOO_LATE' | 'RESCHEDULE_LIMIT' | 'RESCHEDULE_LOCKED' | 'RESCHEDULE_COD';

type Iso = string | Date;
/** Một lần đổi ngày (đủ để tính quy tắc) — `earlyArrival`: nhân viên dời về hôm nay vì khách đến sớm tại quầy (đợt 15, B1). */
export interface ScheduleChangeLike { from: Iso; to: Iso; earlyArrival?: boolean | null }
export interface ReschedulableReservation {
  status: string;
  startDate: Iso;
  originalStartDate?: Iso | null;
  scheduleChanges?: readonly ScheduleChangeLike[] | null;
  /** Đợt 15 (C1): đặt chỗ "trả khi nhận kho" — chưa trả thì không đổi ngày (huỷ miễn phí rồi đặt lại), trừ "khách đến sớm" tại quầy. */
  payOnArrival?: boolean | null;
  /** Đợt 15 (C2): thuê theo ngày chỉ đặt / dời trước tối đa DAILY_MAX_LEAD_DAYS ngày. */
  quote?: { rentalPeriod?: string } | null;
}
/** Đặt chỗ "trả khi nhận kho" chưa trả tiền giữ chân (PENDING) — ô vẫn được giữ tới hết ngày nhận. */
export const isUnpaidCod = (r: Pick<ReschedulableReservation, 'status' | 'payOnArrival'>) => r.status === 'PENDING' && !!r.payOnArrival;
/** Đặt chỗ còn ở giai đoạn đổi ngày được (đã trả giữ chân, chưa nhận kho) — hoặc COD chưa trả (chỉ dời về hôm nay khi khách đến sớm). */
const schedulable = (r: Pick<ReschedulableReservation, 'status' | 'payOnArrival'>) => RESCHEDULE_STATUSES.includes(r.status) || isUnpaidCod(r);

const DAY = 86_400_000;
/** Chuẩn hoá về ngày date-only (00:00Z) dạng ISO; nhận 'YYYY-MM-DD', ISO đầy đủ hoặc Date. Sai định dạng → null. */
export function toDateOnlyISO(d: Iso): string | null {
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toISOString().slice(0, 10)}T00:00:00.000Z`;
}
const ms = (d: Iso) => new Date(toDateOnlyISO(d) ?? NaN).getTime();

const lastChange = (r: Pick<ReschedulableReservation, 'scheduleChanges'>) => {
  const list = r.scheduleChanges ?? [];
  return list.length ? list[list.length - 1] : null;
};

/**
 * Đợt 15 (B1) — lần đổi này có phải "khách đến sớm" không: NHÂN VIÊN / quản lý (không phải khách tự đổi) dời ngày nhận về đúng HÔM NAY,
 * sớm hơn ngày nhận hiện tại (nút "Nhận kho từ hôm nay" ở màn nhận kho). Đánh dấu `earlyArrival` trên lần đổi đó.
 */
export const isEarlyArrivalMove = (r: Pick<ReschedulableReservation, 'startDate'>, newDate: Iso, byRole: string, today: Iso = todayISO()) =>
  byRole !== 'CUSTOMER' && ms(newDate) === ms(today) && ms(newDate) < ms(r.startDate);

/**
 * Đợt 15 (B1): lần đổi GẦN NHẤT là "khách đến sớm" và đặt chỗ còn chưa nhận kho → ngày nhận TRƯỚC lần đổi đó (date-only ISO) — ngày để
 * "Trả về ngày cũ" và để tính hạn không đến. Không phải thì null.
 */
export function earlyArrivalFrom(r: ReschedulableReservation): string | null {
  const last = lastChange(r);
  if (!last?.earlyArrival || !schedulable(r)) return null;
  return toDateOnlyISO(last.from);
}

/** Khách / nhân viên đổi lại ĐÚNG ngày trước lần "khách đến sớm" (B1) — được phép dù đã tới ngày nhận mới (bỏ qua RESCHEDULE_LOCKED). */
export const isEarlyArrivalRevert = (r: ReschedulableReservation, newDate: Iso) => {
  const from = earlyArrivalFrom(r);
  return !!from && ms(newDate) === ms(from);
};

/**
 * Các ngày nhận dùng làm MỐC HOÀN khi huỷ (lấy ngày sớm nhất): ngày gốc, ngày hiện tại, mọi ngày từng dời tới — TRỪ ngày do nhân viên dời
 * về hôm nay vì khách đến sớm (B1): mốc vẫn là ngày nhận trước lần đổi đó, khách đến sớm rồi không nhận kho không bị mất quyền lợi hoàn.
 */
export function refundAnchorDates(r: ReschedulableReservation): Iso[] {
  const changes = r.scheduleChanges ?? [];
  const last = lastChange(r);
  const dates: Iso[] = [];
  if (!last?.earlyArrival) dates.push(r.startDate);
  if (r.originalStartDate) dates.push(r.originalStartDate);
  if (changes[0]) dates.push(changes[0].from); // ngày gốc (dữ liệu thiếu originalStartDate)
  // `from` của mỗi lần đổi là ngày gốc hoặc `to` của lần trước — đã có trong danh sách (trừ ngày khách đến sớm, cố ý bỏ).
  for (const c of changes) if (!c.earlyArrival) dates.push(c.to);
  return dates.length ? dates : [r.startDate];
}

/** Ngày nhận dùng để tính hạn "không đến nhận kho" (job no-show): sau lần "khách đến sớm" (B1) tính theo ngày nhận trước lần đổi đó. */
export const noShowAnchorOf = (r: ReschedulableReservation): string => earlyArrivalFrom(r) ?? (toDateOnlyISO(r.startDate) as string);

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
/** Dời trước tối đa bao nhiêu ngày kể từ hôm nay: thuê theo ngày 14 (C2), còn lại 90. */
const maxAdvanceOf = (r: Pick<ReschedulableReservation, 'quote'>) => (r.quote?.rentalPeriod === 'DAY' ? DAILY_MAX_LEAD_DAYS : RESCHEDULE_MAX_ADVANCE_DAYS);

export function rescheduleWindow(r: ReschedulableReservation, today: Iso = todayISO()): { min: string; max: string } {
  const min = toDateOnlyISO(today) as string;
  const start = toDateOnlyISO(r.startDate) as string;
  if (ms(min) >= ms(start)) return { min, max: start };
  const byOriginal = addDays(originalStartOf(r), RESCHEDULE_MAX_DELAY_DAYS);
  const byToday = addDays(min, maxAdvanceOf(r));
  return { min, max: ms(byOriginal) < ms(byToday) ? byOriginal : byToday };
}

/** Có đổi ngày nhận kho sang `newDate` được không — BE dùng để chặn (422 + code), UI dùng để ẩn / báo lỗi trước khi gọi API. */
export function rescheduleCheck(
  r: ReschedulableReservation, newDate: Iso, today: Iso = todayISO(), opts: { byRole?: string } = {},
): { ok: true } | { ok: false; code: RescheduleCode; message: string } {
  const fail = (code: RescheduleCode, message: string) => ({ ok: false as const, code, message });
  // Đợt 15 (C1): "trả khi nhận kho" chưa trả — không đổi ngày (huỷ miễn phí rồi đặt lại). Ngoại lệ: nhân viên "Nhận kho từ hôm nay" khi khách
  // đến sớm tại quầy, và "Trả về ngày cũ" sau lần đó; hai trường hợp này kiểm tiếp như đặt chỗ đã trả.
  // (Không sao chép `r` — BE truyền document mongoose, spread làm mất các trường.)
  const cod = isUnpaidCod(r);
  if (cod && !isEarlyArrivalMove(r, newDate, opts.byRole ?? 'CUSTOMER', today) && !isEarlyArrivalRevert(r, newDate)) {
    return fail('RESCHEDULE_COD', 'Đặt chỗ trả khi nhận kho không đổi ngày được — huỷ (miễn phí) rồi đặt lại');
  }
  if (!cod && !RESCHEDULE_STATUSES.includes(r.status)) return fail('RESCHEDULE_STATE', 'Chỉ đổi được ngày khi đã trả tiền giữ chân và chưa nhận kho');
  // Trả về ngày cũ sau lần khách đến sớm (B1) không bị chặn bởi số lần đổi — lần đổi sớm do nhân viên làm tại quầy, không để khách mắc kẹt.
  if (rescheduleChangesLeft(r) <= 0 && !isEarlyArrivalRevert(r, newDate)) return fail('RESCHEDULE_LIMIT', `Đã đổi ngày tối đa ${RESCHEDULE_MAX_CHANGES} lần`);
  const next = ms(newDate);
  const now = ms(today);
  const start = ms(r.startDate);
  if (Number.isNaN(next)) return fail('RESCHEDULE_PAST', 'Ngày nhận kho mới không hợp lệ');
  if (next < now) return fail('RESCHEDULE_PAST', 'Ngày nhận kho mới không được ở quá khứ');
  if (next === start) return fail('RESCHEDULE_SAME', 'Ngày mới trùng ngày nhận kho hiện tại');
  // "Trả về ngày cũ" sau lần khách đến sớm (B1): đổi lại đúng ngày trước lần đó vẫn được, dù hôm nay đã là ngày nhận mới.
  if (next > start && now >= start && !isEarlyArrivalRevert(r, newDate)) return fail('RESCHEDULE_LOCKED', 'Đã tới ngày nhận kho — chỉ dời sớm hơn được, không dời muộn hơn');
  if (next > ms(addDays(originalStartOf(r), RESCHEDULE_MAX_DELAY_DAYS))) {
    return fail('RESCHEDULE_TOO_LATE', `Chỉ dời muộn tối đa ${RESCHEDULE_MAX_DELAY_DAYS} ngày so với ngày nhận kho ban đầu`);
  }
  if (next > now + maxAdvanceOf(r) * DAY) return fail('RESCHEDULE_TOO_LATE', r.quote?.rentalPeriod === 'DAY' ? `Thuê theo ngày chỉ đặt trước tối đa ${DAILY_MAX_LEAD_DAYS} ngày` : `Chỉ nhận đặt trước tối đa ${RESCHEDULE_MAX_ADVANCE_DAYS} ngày`);
  return { ok: true };
}
