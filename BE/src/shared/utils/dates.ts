const TZ = 'Asia/Ho_Chi_Minh';
const DAY = 86_400_000;

/** Date-only convention: facility-local calendar day stored as 00:00Z. */
export function todayUTC(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${ymd}T00:00:00.000Z`);
}
/** Ngày theo giờ chi nhánh của một thời điểm bất kỳ, theo quy ước date-only (00:00Z). */
export function localDay(at: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  return new Date(`${ymd}T00:00:00.000Z`);
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export function addMonthsUTC(d: Date, months: number): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), last));
  return r;
}
/** Cộng n chu kỳ thuê vào một ngày. NGÀY = +n ngày, TUẦN = +7n ngày, THÁNG = +n tháng. */
export function addPeriodsUTC(d: Date, period: 'DAY' | 'WEEK' | 'MONTH', n: number): Date {
  return period === 'MONTH' ? addMonthsUTC(d, n) : addDays(d, period === 'WEEK' ? 7 * n : n);
}
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);
/** Normalise "2026-09-11" or any ISO string to the date-only convention. */
export const toDateOnly = (v: string | Date) => new Date(`${new Date(v).toISOString().slice(0, 10)}T00:00:00.000Z`);
