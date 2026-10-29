'use client';

import Link from 'next/link';
import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, Info, X } from 'lucide-react';
import type { Tone } from '@/shared/lib/labels';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Button ----------
const BTN = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
  secondary: 'bg-white text-ink ring-1 ring-inset ring-stone-300 hover:bg-stone-100',
  ghost: 'text-stone-700 hover:bg-stone-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  subtle: 'bg-brand-50 text-brand-800 hover:bg-brand-100',
} as const;
const SIZE = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' } as const;
type BtnProps = { variant?: keyof typeof BTN; size?: keyof typeof SIZE };

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & BtnProps) {
  return (
    <button
      {...rest}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50', BTN[variant], SIZE[size], className)}
    />
  );
}

export function ButtonLink({ href, variant = 'primary', size = 'md', className, children }: BtnProps & { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx('inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition active:scale-[0.98]', BTN[variant], SIZE[size], className)}>
      {children}
    </Link>
  );
}

// ---------- Card ----------
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-stone-200 bg-white shadow-card', className)}>{children}</div>;
}
export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-stone-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Badge ----------
const TONE: Record<Tone, string> = {
  gray: 'bg-stone-100 text-stone-700 ring-stone-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  teal: 'bg-brand-50 text-brand-800 ring-brand-200',
};
export const TONE_DOT: Record<Tone, string> = {
  gray: 'bg-stone-400', green: 'bg-emerald-500', blue: 'bg-sky-500', amber: 'bg-amber-500', red: 'bg-red-500', violet: 'bg-violet-500', teal: 'bg-brand-500',
};
export function Badge({ tone = 'gray', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE[tone])}>
      {dot && <span className={cx('size-1.5 rounded-full', TONE_DOT[tone])} />}
      {children}
    </span>
  );
}
export function StatusBadge<K extends string>({ map, value }: { map: Record<K, { label: string; tone: Tone }>; value: K }) {
  const v = map[value];
  return <Badge tone={v?.tone} dot>{v?.label ?? value}</Badge>;
}

// ---------- Page header ----------
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-stone-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Stat ----------
export function Stat({ label, value, sub, icon, tone = 'teal' }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
        {icon && <span className={cx('grid size-8 place-items-center rounded-lg', TONE[tone], 'ring-0')}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone-500">{sub}</p>}
    </Card>
  );
}

// ---------- Progress ----------
export function Progress({ value, tone = 'teal', className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-stone-100', className)}>
      <div className={cx('h-full rounded-full', TONE_DOT[tone])} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

// ---------- Empty ----------
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-700 ring-8 ring-brand-50/40">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-stone-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Icon tile ----------
const TILE: Record<Tone, string> = {
  gray: 'bg-stone-100 text-stone-600', green: 'bg-emerald-50 text-emerald-700', blue: 'bg-sky-50 text-sky-700', amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700', violet: 'bg-violet-50 text-violet-700', teal: 'bg-brand-50 text-brand-700',
};
const TILE_SIZE = { sm: 'size-8 rounded-lg', md: 'size-10 rounded-xl', lg: 'size-12 rounded-2xl' } as const;
/** Ô vuông màu chứa icon — dùng cho thẻ số liệu, mục tiện ích, trạng thái trống. */
export function IconTile({ icon, tone = 'teal', size = 'md', className }: { icon: ReactNode; tone?: Tone; size?: keyof typeof TILE_SIZE; className?: string }) {
  return <span className={cx('grid shrink-0 place-items-center', TILE[tone], TILE_SIZE[size], className)} aria-hidden>{icon}</span>;
}

// ---------- Stat card ----------
const ACCENT: Record<Tone, string> = {
  gray: 'before:bg-stone-300', green: 'before:bg-emerald-500', blue: 'before:bg-sky-500', amber: 'before:bg-amber-500',
  red: 'before:bg-red-500', violet: 'before:bg-violet-500', teal: 'before:bg-brand-500',
};
/**
 * Thẻ số liệu có icon và vạch màu theo trạng thái — bản "nhìn là hiểu" của `Stat`. Truyền `href` để cả thẻ bấm được.
 * (`Stat` cũ giữ nguyên cho các trang nội bộ.)
 */
export function StatCard({ label, value, sub, icon, tone = 'teal', href, className }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: Tone; href?: string; className?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-3">
        <IconTile icon={icon} tone={tone} />
        <p className="min-w-0 flex-1 text-sm font-medium leading-tight text-stone-600">{label}</p>
        {href && <ArrowUpRight className="size-4 shrink-0 text-stone-300 transition group-hover:text-stone-600" />}
      </div>
      <p className="mt-3 truncate text-2xl font-semibold tracking-tight tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs leading-snug text-stone-500">{sub}</p>}
    </>
  );
  const cls = cx('relative block overflow-hidden rounded-2xl border border-stone-200 bg-white p-4 shadow-card before:absolute before:inset-x-0 before:top-0 before:h-1', ACCENT[tone], className);
  return href
    ? <Link href={href} className={cx(cls, 'group transition hover:-translate-y-0.5 hover:shadow-lift')}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

// ---------- Section heading ----------
/** Tiêu đề khu vực trên trang công khai: dòng nhỏ phía trên (eyebrow), tiêu đề, một câu mô tả ngắn và hành động bên phải. */
export function SectionHeading({ eyebrow, title, description, action, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{eyebrow}</p>}
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h2>
        {description && <p className="mt-2 text-sm leading-relaxed text-stone-500 sm:text-base">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------- Disclosure ----------
/**
 * Khối thu gọn cho nội dung dài (chính sách huỷ, lịch sử xử lý, thông báo, phụ lục…): mặc định chỉ hiện một dòng tiêu đề.
 * Dùng `<details>` nên bàn phím và trình đọc màn hình dùng được sẵn; nội dung vẫn nằm trong trang (không mất thông tin).
 */
export function Disclosure({ title, icon, meta, defaultOpen = false, variant = 'card', className, children }: {
  title: ReactNode; icon?: ReactNode; meta?: ReactNode; defaultOpen?: boolean;
  /** `card`: khung trắng có viền; `plain`: không khung, dùng trong thẻ khác. */
  variant?: 'card' | 'plain'; className?: string; children: ReactNode;
}) {
  return (
    <details open={defaultOpen || undefined} className={cx(variant === 'card' ? 'rounded-xl bg-white ring-1 ring-inset ring-stone-200' : '', className)}>
      <summary className={cx('flex cursor-pointer list-none items-center gap-2.5 text-sm font-medium text-ink transition-colors', variant === 'card' ? 'rounded-xl px-4 py-3 hover:bg-stone-50' : 'rounded-lg py-1.5 hover:text-brand-800')}>
        {icon && <span className="shrink-0 text-stone-500" aria-hidden>{icon}</span>}
        <span className="min-w-0 flex-1">{title}</span>
        {meta && <span className="shrink-0 text-xs font-normal text-stone-500">{meta}</span>}
        <ChevronDown className="size-4 shrink-0 text-stone-400 transition-transform [details[open]>summary>&]:rotate-180" aria-hidden />
      </summary>
      <div className={variant === 'card' ? 'px-4 pb-4 pt-1' : 'pt-2'}>{children}</div>
    </details>
  );
}

// ---------- Info tip ----------
/**
 * Biểu tượng (i) — rê chuột hoặc bấm/Tab vào để xem giải thích ngắn. Dùng thay cho dòng chữ phụ dài dưới mỗi mục.
 * Không đặt bên trong một nút bấm khác (nút lồng nút không hợp lệ).
 */
export function InfoTip({ children, label = 'Giải thích', align = 'center', className }: { children: ReactNode; label?: string; align?: 'center' | 'start' | 'end'; className?: string }) {
  const id = useId();
  return (
    <span className={cx('group/tip relative inline-flex align-middle', className)}>
      <span tabIndex={0} role="button" aria-label={label} aria-describedby={id}
        className="grid size-5 cursor-help place-items-center rounded-full text-stone-400 transition-colors hover:text-stone-700 focus-visible:text-stone-700">
        <Info className="size-3.5" />
      </span>
      <span id={id} role="tooltip"
        className={cx('pointer-events-none invisible absolute bottom-full z-40 mb-2 w-64 max-w-[78vw] rounded-lg bg-ink px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white opacity-0 shadow-lg transition group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100',
          align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'start' ? 'left-0' : 'right-0')}>
        {children}
      </span>
    </span>
  );
}

// ---------- Form ----------
/** Khối xám nhấp nháy thay cho nội dung đang tải. Giữ đúng chỗ để trang không nhảy khi có dữ liệu. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-stone-200/80', className)} aria-hidden />;
}

export const inputCls = 'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink ring-1 ring-inset ring-stone-300 placeholder:text-stone-400 focus:ring-2 focus:ring-brand-600 disabled:bg-stone-50';
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-stone-700">{label}</span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs font-medium text-red-600">{error}</span> : hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

// ---------- Tabs ----------
export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cx('inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', value === t.key ? 'bg-ink text-white' : 'text-stone-600 hover:bg-stone-200/60')}
        >
          {t.label}
          {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-xs tabular-nums', value === t.key ? 'bg-white/20' : 'bg-stone-200')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Table ----------
export interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; className?: string }
export function Table<T>({ rows, columns, rowKey, empty, onRowClick }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; empty?: ReactNode; onRowClick?: (row: T) => void }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Không có dữ liệu" />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            {columns.map((c) => <th key={c.key} className={cx('px-4 py-2.5 font-medium', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx('align-middle', onRowClick && 'cursor-pointer hover:bg-stone-50')}>
              {columns.map((c) => <td key={c.key} className={cx('px-4 py-3', c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Modal ----------
/** `stacked`: hộp mở CHỒNG lên một hộp khác (VD cổng thanh toán mở từ hộp gia hạn) — nằm trên, Esc chỉ đóng hộp này. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', stacked = false }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg'; stacked?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stacked) e.stopPropagation(); // bắt ở pha capture → hộp bên dưới không nhận Esc
      onClose();
    };
    window.addEventListener('keydown', onKey, stacked);
    return () => window.removeEventListener('keydown', onKey, stacked);
  }, [open, onClose, stacked]);
  if (!open) return null;
  return (
    <div className={cx('fixed inset-0 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4', stacked ? 'z-[60]' : 'z-50')} onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()} className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-stone-500">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Đóng"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Key/value ----------
export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-stone-500">{k}</dt>
          <dd className="mt-0.5 truncate font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
