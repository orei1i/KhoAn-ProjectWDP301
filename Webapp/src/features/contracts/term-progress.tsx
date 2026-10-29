import { daysBetween, lastDayOf, todayISO } from '@ssm/shared';
import { fmtDate } from '@/shared/lib/format';
import { cx } from '@/shared/ui';

/**
 * Thanh thời hạn hợp đồng: đã dùng bao nhiêu phần thời hạn, còn bao nhiêu ngày (ngày kết thúc là mốc 00:00 sau ngày cuối).
 * Sắp hết hạn (≤ 7 ngày) thì chuyển màu vàng để khách để ý gia hạn hoặc trả kho.
 */
export function TermProgress({ start, end, className }: { start: string; end: string; className?: string }) {
  const today = todayISO();
  const total = Math.max(1, daysBetween(start, end));
  const used = Math.min(total, Math.max(0, daysBetween(start, today)));
  const left = Math.max(0, daysBetween(today, end));
  const soon = left <= 7;
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className={cx('font-medium', soon ? 'text-amber-700' : 'text-stone-600')}>{left > 0 ? `Còn ${left} ngày` : 'Đã hết hạn'}</span>
        <span className="text-stone-400">đến hết {fmtDate(lastDayOf(end))}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/70" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-label="Thời hạn đã dùng">
        <div className={cx('h-full rounded-full', soon ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${(used / total) * 100}%` }} />
      </div>
    </div>
  );
}
