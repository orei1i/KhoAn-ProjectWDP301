'use client';

import type { ReactNode } from 'react';
import type { Tone } from '@/shared/lib/labels';
import { TONE_DOT, cx } from '@/shared/ui';

/** Lightweight HTML bar charts (no chart lib). Single-series bars use the brand hue;
 *  multi-series stacks use the first categorical slots (blue, orange, aqua), which validate as a set. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'] as const;

interface Datum { label: string; value: number }

export function BarChart({ data, format, height = 180, color = '#0e8570' }: { data: Datum[]; format: (v: number) => string; height?: number; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  return (
    <div>
      <div className="flex items-end gap-[2px] border-b border-stone-300" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center">
            <div className="w-full max-w-12 rounded-t-[4px] transition-opacity group-hover:opacity-80" style={{ height: `${(d.value / max) * 100}%`, background: color, minHeight: d.value > 0 ? 2 : 0 }} />
            {d === peak && <span className="pointer-events-none absolute -top-5 text-[11px] font-medium text-stone-600 group-hover:hidden">{format(d.value)}</span>}
            <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white shadow group-hover:block">{d.label}: {format(d.value)}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {data.map((d) => <span key={d.label} className="flex-1 text-center text-[11px] text-stone-500">{d.label}</span>)}
      </div>
    </div>
  );
}

export function StackedBarChart({ data, series, format, height = 200 }: {
  data: { label: string; parts: Record<string, number> }[];
  series: { key: string; label: string }[];
  format: (v: number) => string;
  height?: number;
}) {
  const totals = data.map((d) => series.reduce((s, x) => s + Math.max(0, d.parts[x.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-stone-600">
        {series.map((s, i) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: SERIES_COLORS[i] }} />{s.label}</span>)}
      </div>
      <div className="flex items-end gap-[2px] border-b border-stone-300" style={{ height }}>
        {data.map((d, di) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center">
            <div className="flex w-full max-w-12 flex-col-reverse gap-[2px]" style={{ height: `${(totals[di] / max) * 100}%` }}>
              {series.map((s, i) => {
                const v = Math.max(0, d.parts[s.key] ?? 0);
                if (!v) return null;
                const isTop = series.slice(i + 1).every((n) => !(d.parts[n.key] > 0));
                return <div key={s.key} className={isTop ? 'rounded-t-[4px]' : ''} style={{ flexGrow: v, flexBasis: 0, background: SERIES_COLORS[i] }} />;
              })}
            </div>
            <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden min-w-40 rounded-md bg-ink px-2.5 py-1.5 text-xs text-white shadow group-hover:block">
              <p className="mb-1 font-medium">{d.label} · {format(totals[di])}</p>
              {series.map((s, i) => <p key={s.key} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: SERIES_COLORS[i] }} />{s.label}: {format(d.parts[s.key] ?? 0)}</p>)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {data.map((d) => <span key={d.label} className="flex-1 text-center text-[11px] text-stone-500">{d.label}</span>)}
      </div>
    </div>
  );
}

/**
 * Thanh ngang xếp hạng (cơ cấu thu, tuổi nợ, doanh thu theo chi nhánh…): mỗi dòng nhãn + số + thanh.
 * Độ dài thanh = value / `max` (mặc định giá trị lớn nhất); giá trị âm vẽ bằng 0.
 */
export function BarList({ data, format, max, tone = 'teal', className }: {
  data: { key: string; label: ReactNode; value: number; sub?: ReactNode; icon?: ReactNode; tone?: Tone }[];
  format: (v: number) => string; max?: number; tone?: Tone; className?: string;
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className={cx('space-y-3', className)}>
      {data.map((d) => {
        const w = top > 0 ? Math.min(100, Math.max(0, (d.value / top) * 100)) : 0;
        return (
          <li key={d.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-stone-700">
                {d.icon && <span className="shrink-0 text-stone-400 [&>svg]:size-3.5" aria-hidden>{d.icon}</span>}
                <span className="truncate">{d.label}</span>
              </span>
              <span className="shrink-0 text-right font-medium tabular-nums text-ink">
                {format(d.value)}{d.sub && <span className="ml-1.5 text-xs font-normal text-stone-500">{d.sub}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100">
              <div className={cx('h-full rounded-full', TONE_DOT[d.tone ?? tone])} style={{ width: `${w}%`, minWidth: d.value > 0 ? 4 : 0 }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Màu thanh tình trạng ô kho: khác nhau cả sắc lẫn độ đậm (đang thuê đậm, trống nhạt) để không lẫn đang thuê với trống. */
export const UNIT_BAR = {
  occupied: 'bg-brand-700', reserved: 'bg-blue-500', available: 'bg-emerald-300', pending: 'bg-violet-500', maintenance: 'bg-amber-500',
} as const;

/** Nền + chữ của ô tình trạng (StatusCells), cùng bảng màu với UNIT_BAR. */
export const UNIT_CELL = {
  occupied: 'bg-brand-700 text-white', reserved: 'bg-blue-500 text-white', available: 'bg-emerald-200 text-emerald-950',
  pending: 'bg-violet-500 text-white', maintenance: 'bg-amber-400 text-amber-950',
} as const;

/** Mỗi trạng thái một ô riêng, số và nhãn nằm ngay trong ô — đọc được ngay, không cần chú thích màu.
 *  Ô bằng 0 để nhạt cho mắt dừng ở các ô có số. */
export function StatusCells({ items, className }: {
  items: { key: string; label: string; value: number; cls: string }[];
  className?: string;
}) {
  return (
    <ul className={cx('grid gap-1.5', className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((s) => (
        <li key={s.key} className={cx('rounded-lg px-1 py-2 text-center', s.value > 0 ? s.cls : 'bg-stone-100 text-stone-400')}>
          <p className="text-lg font-semibold leading-none tabular-nums">{s.value}</p>
          <p className="mt-1 text-[11px] font-medium leading-tight">{s.label}</p>
        </li>
      ))}
    </ul>
  );
}
