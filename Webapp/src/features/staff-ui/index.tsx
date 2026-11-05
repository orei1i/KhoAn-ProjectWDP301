'use client';

/**
 * Bộ khối giao diện cho các trang NHÂN VIÊN (quầy, kho): nhìn nhanh, ít chữ, màu theo trạng thái.
 * Chỉ trình bày — không gọi API, không giữ state nghiệp vụ. Dựa trên cùng token màu / IconTile / InfoTip của `@/shared/ui`
 * để trang nhân viên cùng "ngôn ngữ" với trang khách đã thiết kế lại.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { Tone } from '@/shared/lib/labels';
import { initials } from '@/shared/lib/format';
import { Button, IconTile, InfoTip, cx, inputCls } from '@/shared/ui';

// ---------- Tông màu ----------
const SOFT: Record<Tone, string> = {
  gray: 'bg-stone-50 text-stone-800 ring-stone-200',
  green: 'bg-emerald-50 text-emerald-950 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-950 ring-sky-200',
  amber: 'bg-amber-50 text-amber-950 ring-amber-200',
  red: 'bg-red-50 text-red-900 ring-red-200',
  violet: 'bg-violet-50 text-violet-950 ring-violet-200',
  teal: 'bg-brand-50 text-brand-900 ring-brand-200',
};
const ICON_TEXT: Record<Tone, string> = {
  gray: 'text-stone-500', green: 'text-emerald-600', blue: 'text-sky-600', amber: 'text-amber-600', red: 'text-red-600', violet: 'text-violet-600', teal: 'text-brand-600',
};
const CHIP: Record<Tone, string> = {
  gray: 'bg-white text-stone-700 ring-stone-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  teal: 'bg-brand-50 text-brand-800 ring-brand-200',
};
const COUNT: Record<Tone, string> = {
  gray: 'bg-stone-200 text-stone-700', green: 'bg-emerald-100 text-emerald-800', blue: 'bg-sky-100 text-sky-800', amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-800', violet: 'bg-violet-100 text-violet-800', teal: 'bg-brand-100 text-brand-800',
};
const SOLID: Record<Tone | 'ink', string> = {
  ink: 'bg-ink text-white', gray: 'bg-stone-200 text-stone-800', green: 'bg-emerald-700 text-white', blue: 'bg-sky-700 text-white',
  amber: 'bg-amber-400 text-ink', red: 'bg-red-600 text-white', violet: 'bg-violet-600 text-white', teal: 'bg-brand-700 text-white',
};

// ---------- Callout ----------
/** Khối nhắc có màu (cảnh báo, chặn, thành công, thông tin) — tiêu đề ngắn, chi tiết phụ một dòng, hành động bên phải. */
export function Callout({ tone = 'amber', icon, title, children, action, className }: {
  tone?: Tone; icon?: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-sm ring-1 ring-inset', SOFT[tone], className)}>
      {icon && <span className={cx('mt-0.5 shrink-0 [&>svg]:size-4', ICON_TEXT[tone])} aria-hidden>{icon}</span>}
      <div className="min-w-0 flex-1 basis-52">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className={cx('leading-relaxed', title ? 'mt-0.5 opacity-90' : '')}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

// ---------- Chip ----------
/** Viên thông tin nhỏ có icon (khách, SĐT, ngày nhận, ca…) — thay cho bảng "nhãn: giá trị" dài. */
export function Chip({ icon, tone = 'gray', mono, title, className, children }: {
  icon?: ReactNode; tone?: Tone; mono?: boolean; title?: string; className?: string; children: ReactNode;
}) {
  return (
    <span title={title} className={cx('inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', CHIP[tone], className)}>
      {icon && <span className="shrink-0 opacity-75 [&>svg]:size-3.5" aria-hidden>{icon}</span>}
      <span className={cx('truncate', mono && 'font-mono')}>{children}</span>
    </span>
  );
}
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap items-center gap-1.5', className)}>{children}</div>;
}

/** Một mẩu thông tin phụ trong dòng danh sách (icon nhỏ + chữ xám). */
export function Meta({ icon, mono, className, children }: { icon?: ReactNode; mono?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1', mono && 'font-mono', className)}>
      {icon && <span className="shrink-0 text-stone-400 [&>svg]:size-3.5" aria-hidden>{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Số đếm nhỏ cạnh tiêu đề. */
export function Count({ n, tone = 'gray' }: { n: number; tone?: Tone }) {
  return <span className={cx('inline-grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums', n ? COUNT[tone] : 'bg-stone-100 text-stone-500')}>{n}</span>;
}

// ---------- Ô kho / người ----------
const TAG_SIZE = { sm: 'h-8 min-w-8 rounded-lg px-1.5 text-[11px]', md: 'h-10 min-w-10 rounded-xl px-2 text-xs', lg: 'h-12 min-w-12 rounded-xl px-2.5 text-sm' } as const;
/** Ô vuông đậm ghi số ô kho (giống thẻ "kho đang thuê" bên khách) — nhìn số ô là nhận ra lượt. */
export function UnitTag({ label, tone = 'ink', size = 'md', badge, className }: { label: string; tone?: Tone | 'ink'; size?: keyof typeof TAG_SIZE; badge?: ReactNode; className?: string }) {
  return (
    <span className={cx('relative inline-grid shrink-0 place-items-center font-bold tabular-nums leading-none', TAG_SIZE[size], SOLID[tone], label.length > 6 && 'text-[10px]', className)}>
      {label}
      {badge && <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-md bg-brand-500 text-white ring-2 ring-white [&>svg]:size-3" aria-hidden>{badge}</span>}
    </span>
  );
}

const AV_SIZE = { sm: 'size-8 text-[11px]', md: 'size-10 text-xs', lg: 'size-12 text-sm' } as const;
const AV_TONE: Record<Tone, string> = {
  gray: 'bg-stone-200 text-stone-700', green: 'bg-emerald-100 text-emerald-800', blue: 'bg-sky-100 text-sky-800', amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-800', violet: 'bg-violet-100 text-violet-800', teal: 'bg-brand-100 text-brand-800',
};
/** Vòng tròn chữ cái đầu tên khách. */
export function Avatar({ name, tone = 'teal', size = 'md', className }: { name: string; tone?: Tone; size?: keyof typeof AV_SIZE; className?: string }) {
  return <span className={cx('grid shrink-0 place-items-center rounded-full font-semibold', AV_SIZE[size], AV_TONE[tone], className)} aria-hidden>{initials(name || '?')}</span>;
}

// ---------- Tiêu đề khối ----------
/** Đầu thẻ: icon màu + tiêu đề + số đếm + (i) giải thích + hành động. Thay cho tiêu đề kèm dòng mô tả dài. */
export function PanelHeader({ icon, tone = 'teal', title, count, tip, action, className }: {
  icon?: ReactNode; tone?: Tone; title: ReactNode; count?: number; tip?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-100 px-4 py-3 sm:px-5', className)}>
      {icon && <IconTile icon={icon} tone={tone} size="sm" />}
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-ink">
        <span className="truncate">{title}</span>
        {count !== undefined && <Count n={count} tone={tone} />}
        {tip && <InfoTip align="start">{tip}</InfoTip>}
      </h2>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** Tiêu đề nhóm nhỏ trong một thẻ danh sách (VD "Chờ thu tiền tại quầy"). */
export function SubHeading({ icon, title, count, tone = 'gray', tip, className }: { icon?: ReactNode; title: ReactNode; count?: number; tone?: Tone; tip?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2 px-4 pb-1.5 pt-4 text-xs font-semibold uppercase tracking-wide text-stone-500 sm:px-5', className)}>
      {icon && <span className={cx('[&>svg]:size-3.5', ICON_TEXT[tone])} aria-hidden>{icon}</span>}
      <span>{title}</span>
      {count !== undefined && <Count n={count} tone={tone} />}
      {tip && <InfoTip align="start">{tip}</InfoTip>}
    </div>
  );
}

// ---------- Bước ----------
export type StepState = 'done' | 'current' | 'todo' | 'blocked';
const DOT: Record<StepState, string> = {
  done: 'bg-emerald-600 text-white',
  current: 'bg-brand-700 text-white ring-4 ring-brand-100',
  todo: 'bg-white text-stone-500 ring-1 ring-inset ring-stone-300',
  blocked: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300',
};
const STATE_SR: Record<StepState, string> = { done: 'đã xong', current: 'đang làm', todo: 'chưa tới', blocked: 'đang bị chặn' };

/** Vòng tròn số bước (xong thì dấu ✓). */
export function StepDot({ n, state = 'current', size = 'md' }: { n: ReactNode; state?: StepState; size?: 'sm' | 'md' }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-full font-bold transition-colors', size === 'sm' ? 'size-6 text-xs' : 'size-8 text-sm', DOT[state])}>
      {state === 'done' ? <Check className={size === 'sm' ? 'size-3.5' : 'size-4'} /> : n}
    </span>
  );
}

/** Thanh tiến trình ngang của một quy trình (icon từng bước, nối bằng vạch). Gọn để đặt đầu thẻ. */
export function StepTrack({ steps, className }: { steps: { label: string; icon: ReactNode; state: StepState }[]; className?: string }) {
  return (
    <ol className={cx('flex items-start', className)} aria-label="Tiến trình">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
          {i > 0 && <span className={cx('absolute right-[calc(50%+1.25rem)] top-4 h-0.5 w-[calc(100%-2.5rem)] -translate-y-1/2 rounded-full', s.state === 'todo' ? 'bg-stone-200' : 'bg-emerald-400')} aria-hidden />}
          <span className={cx('relative grid size-8 place-items-center rounded-full [&>svg]:size-4', DOT[s.state])}>
            {s.state === 'done' ? <Check /> : s.icon}
          </span>
          <span className={cx('mt-1.5 line-clamp-2 px-0.5 text-[11px] font-medium leading-tight sm:text-xs', s.state === 'todo' ? 'text-stone-500' : s.state === 'blocked' ? 'text-amber-800' : 'text-ink', s.state === 'current' && 'font-semibold')}>{s.label}</span>
          <span className="sr-only"> — {STATE_SR[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Một bước có số thứ tự NẰM TRONG thẻ (form dài chia bước): số, icon, tiêu đề, (i) giải thích, phần phải.
 * `done` hiện dấu ✓ khi bước đã đủ — chỉ để nhìn, không chặn gì.
 */
export function StepBlock({ n, title, icon, tip, state = 'current', aside, id, className, children }: {
  n: ReactNode; title: ReactNode; icon?: ReactNode; tip?: ReactNode; state?: StepState; aside?: ReactNode; id?: string; className?: string; children: ReactNode;
}) {
  return (
    <section id={id} className={cx('scroll-mt-24', className)}>
      <header className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <StepDot n={n} state={state} size="sm" />
        {icon && <span className="text-stone-400 [&>svg]:size-4" aria-hidden>{icon}</span>}
        <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-ink">{title}{tip && <InfoTip align="start">{tip}</InfoTip>}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Một bước dạng THẺ RIÊNG (quy trình nhiều thẻ, như đặt chỗ tại quầy). */
export function StepCard({ n, title, icon, tip, state = 'current', aside, id, className, bodyClassName, children }: {
  n: ReactNode; title: ReactNode; icon?: ReactNode; tip?: ReactNode; state?: StepState; aside?: ReactNode; id?: string; className?: string; bodyClassName?: string; children: ReactNode;
}) {
  return (
    <section id={id} className={cx('scroll-mt-24 rounded-xl border border-stone-200 bg-white shadow-card', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-100 px-4 py-3 sm:px-5">
        <StepDot n={n} state={state} />
        {icon && <span className="text-stone-400 [&>svg]:size-4" aria-hidden>{icon}</span>}
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold leading-tight text-ink">{title}{tip && <InfoTip align="start">{tip}</InfoTip>}</h2>
        {aside}
      </header>
      <div className={cx('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

// ---------- Sổ tiền ----------
/** Bảng tiền gọn: mỗi dòng nhãn + số tiền; giải thích dài đưa vào (i). */
export function Ledger({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx('divide-y divide-stone-200/80 rounded-xl bg-stone-50 px-4 py-0.5 text-sm ring-1 ring-inset ring-stone-200', className)}>{children}</dl>;
}
const LEDGER_TONE = { default: '', good: 'text-emerald-700', bad: 'text-red-700', warn: 'text-amber-800', muted: 'text-stone-500' } as const;
export function LedgerRow({ label, value, tip, tone = 'default', total, icon }: {
  label: ReactNode; value: ReactNode; tip?: ReactNode; tone?: keyof typeof LEDGER_TONE; total?: boolean; icon?: ReactNode;
}) {
  return (
    <div className={cx('flex items-center justify-between gap-4 py-2', total && 'py-2.5')}>
      <dt className={cx('flex min-w-0 items-center gap-1.5', total ? 'font-semibold text-ink' : 'text-stone-600', tone !== 'default' && LEDGER_TONE[tone])}>
        {icon && <span className="shrink-0 opacity-70 [&>svg]:size-3.5" aria-hidden>{icon}</span>}
        <span className="min-w-0">{label}</span>
        {tip && <InfoTip align="start">{tip}</InfoTip>}
      </dt>
      <dd className={cx('shrink-0 text-right tabular-nums', total ? 'text-base font-bold text-ink' : 'font-medium text-ink', tone !== 'default' && LEDGER_TONE[tone])}>{value}</dd>
    </div>
  );
}

// ---------- Thanh hành động ----------
/**
 * Thanh nút chính dính đáy màn hình khi cuộn qua một form dài — nút xác nhận luôn trong tầm mắt.
 * Đặt ở CUỐI phần thân thẻ có padding `p-4 sm:p-5` (lề âm khớp đúng lề đó).
 */
export function ActionBar({ children, note, className }: { children: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={cx('sticky bottom-0 z-20 -mx-4 -mb-4 mt-5 rounded-b-xl border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:px-5', className)}>
      {note && <div className="mb-2">{note}</div>}
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

// ---------- Chọn nhanh ----------
const SEG_ON: Record<Tone, string> = {
  gray: 'bg-white text-ink shadow-sm ring-1 ring-stone-200', green: 'bg-emerald-700 text-white shadow-sm', blue: 'bg-sky-700 text-white shadow-sm',
  amber: 'bg-amber-700 text-white shadow-sm', red: 'bg-red-600 text-white shadow-sm', violet: 'bg-violet-600 text-white shadow-sm', teal: 'bg-brand-700 text-white shadow-sm',
};
/** Nhóm nút chọn một (Tốt / Hư hại / Thiếu, Có / Không…) — mỗi lựa chọn có màu riêng khi được chọn. */
export function Segmented<V extends string | boolean>({ options, value, onChange, label, className }: {
  options: { value: V; label: string; icon?: ReactNode; tone?: Tone }[]; value: V | null; onChange: (v: V) => void; label?: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex flex-wrap gap-0.5 rounded-lg bg-stone-100 p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors [&>svg]:size-3.5', on ? SEG_ON[o.tone ?? 'gray'] : 'text-stone-600 hover:bg-white/70 hover:text-ink')}>
            {o.icon}{o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Bộ lọc dạng viên tròn (ca làm, trạng thái…). */
export function PillFilter<K extends string>({ options, value, onChange, className }: {
  options: { key: K; label: string; icon?: ReactNode; count?: number }[]; value: K; onChange: (k: K) => void; className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors [&>svg]:size-4', value === o.key ? 'bg-ink text-white ring-ink' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50')}>
          {o.icon}{o.label}
          {o.count !== undefined && (o.count === 0
            ? <span className={cx('px-0.5 text-xs tabular-nums', value === o.key ? 'text-white/50' : 'text-stone-300')}>0</span>
            : <span className={cx('rounded-full px-1.5 text-xs font-semibold tabular-nums', value === o.key ? 'bg-white/20' : 'bg-stone-200 text-ink')}>{o.count}</span>)}
        </button>
      ))}
    </div>
  );
}

// ---------- Category ----------
export interface CategoryOption<K extends string = string> { key: K; label: string; icon: ReactNode; count: number; urgent?: boolean }
export interface CategoryGroup<K extends string = string> { title: string; options: CategoryOption<K>[] }

/**
 * Trang có nhiều nhóm việc: từ `lg` là cột trái chia nhóm (mỗi mục một dòng: icon, nhãn, số việc), dưới `lg` là một `<select>` có `optgroup`.
 * Số 0 mờ hẳn, số > 0 nổi rõ; `urgent` dùng màu đỏ. `children` là nội dung của mục đang chọn, nằm ở cột phải.
 */
export function CategoryLayout<K extends string>({ groups, value, onChange, label = 'Chọn nhóm việc', children }: {
  groups: CategoryGroup<K>[]; value: K; onChange: (k: K) => void; label?: string; children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start lg:gap-5">
      <label className="block lg:hidden">
        <span className="sr-only">{label}</span>
        <select className={cx(inputCls, 'py-2.5 font-medium')} value={value} onChange={(e) => onChange(e.target.value as K)}>
          {groups.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.options.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <nav aria-label={label} className="hidden rounded-xl border border-stone-200 bg-white p-2 shadow-card lg:sticky lg:top-6 lg:block lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        {groups.map((g) => (
          <div key={g.title} className="pb-1 [&+&]:mt-1 [&+&]:border-t [&+&]:border-stone-100 [&+&]:pt-1">
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">{g.title}</p>
            <ul className="space-y-0.5">
              {g.options.map((o) => {
                const on = o.key === value;
                const hot = !!o.urgent && o.count > 0;
                return (
                  <li key={o.key}>
                    <button type="button" aria-current={on ? 'true' : undefined} onClick={() => onChange(o.key)}
                      className={cx('relative flex w-full items-center gap-2.5 rounded-lg py-2 pl-3 pr-2 text-left text-sm leading-snug transition-colors', on ? 'bg-brand-50 font-semibold text-brand-900 before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-brand-600' : o.count > 0 ? 'font-medium text-ink hover:bg-stone-100' : 'text-stone-500 hover:bg-stone-100')}>
                      <span className={cx('shrink-0 [&>svg]:size-4', hot ? 'text-red-600' : on ? 'text-brand-700' : 'text-stone-400')} aria-hidden>{o.icon}</span>
                      <span className="min-w-0 flex-1">{o.label}</span>
                      {o.count === 0
                        ? <span className="shrink-0 px-1.5 text-xs font-normal tabular-nums text-stone-300">0</span>
                        : <span className={cx('grid min-w-6 shrink-0 place-items-center rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums', hot ? 'bg-red-600 text-white' : on ? 'bg-brand-700 text-white' : 'bg-stone-200 text-ink')}>{o.count}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---------- Thêm thao tác ----------
export interface MoreAction { label: ReactNode; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }
type MenuPos = { left: number; top?: number; bottom?: number };
const MENU_WIDTH = 256;

/**
 * Nút "Thêm" mở danh sách các thao tác phụ của một dòng; không có mục nào thì không hiện gì, chỉ có đúng một mục thì hiện thẳng nút đó. Truyền được `cond && {...}` như JSX.
 * Danh sách vẽ vào `document.body` (fixed), nên không bị cắt bởi `overflow` của thẻ hay bảng bao ngoài, và không dính gì tới vùng bấm của dòng.
 * Đóng khi bấm ra ngoài, Esc, cuộn trang, đổi cỡ cửa sổ.
 */
export function MoreActions({ items, label = 'Thêm' }: { items: (MoreAction | false | null | undefined)[]; label?: string }) {
  const list = items.filter((x): x is MoreAction => !!x);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const isOpen = pos !== null;

  useEffect(() => {
    if (!isOpen) return;
    const inside = (t: EventTarget | null) => t instanceof Node && (!!menu.current?.contains(t) || !!trigger.current?.contains(t));
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) setPos(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPos(null); trigger.current?.focus({ preventScroll: true }); } };
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && menu.current?.contains(e.target))) setPos(null); };
    const onResize = () => setPos(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen]);

  if (list.length === 0) return null;
  // Một thao tác thì không cần menu: bấm một lần là xong.
  if (list.length === 1) {
    const only = list[0];
    return (
      <Button size="sm" variant={only.danger ? 'dangerOutline' : 'secondary'} disabled={only.disabled} onClick={(e) => { e.stopPropagation(); only.onClick(); }}>
        {only.icon}{only.label}
      </Button>
    );
  }

  const toggle = () => {
    if (isOpen || !trigger.current) { setPos(null); return; }
    const r = trigger.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, vw - MENU_WIDTH - 8));
    const roomBelow = window.innerHeight - r.bottom;
    // Mỗi mục khoảng 40px; không đủ chỗ phía dưới mà phía trên rộng hơn thì mở lên trên.
    setPos(roomBelow < list.length * 40 + 16 && r.top > roomBelow ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') { setPos(null); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (all.length === 0) return;
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
    all[next].focus();
  };

  return (
    <>
      <Button ref={trigger} size="sm" variant="secondary" aria-haspopup="menu" aria-expanded={isOpen} onClick={(e) => { e.stopPropagation(); toggle(); }}>
        {label}<ChevronDown className={cx('size-3.5 transition-transform', isOpen && 'rotate-180')} aria-hidden />
      </Button>
      {pos && createPortal(
        <div ref={menu} role="menu" onKeyDown={onMenuKey} onClick={(e) => e.stopPropagation()} style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_WIDTH }}
          className="fixed z-[45] max-h-[calc(100vh-1rem)] overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-lift">
          {list.map((it, i) => (
            <button key={i} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setPos(null); trigger.current?.focus({ preventScroll: true }); it.onClick(); }}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0', it.danger ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : 'text-stone-700 hover:bg-stone-100 focus-visible:bg-stone-100')}>
              {it.icon}<span className="min-w-0">{it.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Ô tick dạng thẻ (xác nhận đã nhận tiền, khách đã đọc…) — sáng màu khi đã tick. */
export function CheckLine({ checked, onChange, disabled, children, className }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex gap-2.5 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset transition-colors', disabled ? 'cursor-not-allowed text-stone-400 ring-stone-200' : checked ? 'cursor-pointer bg-brand-50 text-brand-950 ring-brand-300' : 'cursor-pointer bg-white text-stone-700 ring-stone-200 hover:bg-stone-50', className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-700" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

// ---------- Danh sách ----------
/**
 * Một dòng hàng đợi gọn: phần đầu (ô kho / icon / chữ cái), tiêu đề + huy hiệu, dòng phụ, nút bên phải.
 * `onSelect` / `href`: cả phần chữ bấm được; nút ở `actions` nằm NGOÀI vùng bấm đó (không lồng nút).
 */
export function QueueRow({ lead, title, badges, meta, actions, onSelect, href, active, className }: {
  lead?: ReactNode; title: ReactNode; badges?: ReactNode; meta?: ReactNode; actions?: ReactNode;
  onSelect?: () => void; href?: string; active?: boolean; className?: string;
}) {
  const body = (
    <>
      {lead}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 [&>span]:max-w-full [&>span]:whitespace-normal">
          <p className="min-w-0 truncate text-sm font-medium text-ink">{title}</p>
          {badges}
        </div>
        {meta && <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">{meta}</div>}
      </div>
    </>
  );
  const mainCls = 'flex min-w-0 flex-1 basis-56 items-center gap-3 text-left';
  return (
    <li className={cx('relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors sm:px-5', active ? 'bg-brand-50/70 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-brand-600' : (onSelect || href) && 'hover:bg-stone-50', className)}>
      {onSelect ? <button type="button" onClick={onSelect} aria-current={active || undefined} className={mainCls}>{body}</button>
        : href ? <Link href={href} className={mainCls}>{body}</Link>
          : <div className={mainCls}>{body}</div>}
      {actions && <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
    </li>
  );
}

// ---------- Lối tắt ----------
/** Ô lối tắt tới một quy trình: icon màu + nhãn ngắn + số việc đang chờ (nếu có). */
export function QuickTile({ href, icon, label, count, tone = 'teal', tip }: { href: string; icon: ReactNode; label: string; count?: number; tone?: Tone; tip?: string }) {
  return (
    <Link href={href} title={tip} className="group flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 text-sm font-medium text-stone-700 ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:text-ink hover:shadow-lift">
      <IconTile icon={icon} tone={tone} />
      <span className="min-w-0 flex-1 leading-tight">{label}</span>
      {!!count && <span className="grid min-w-6 place-items-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white">{count}</span>}
    </Link>
  );
}

// ---------- Thông tin có icon ----------
/** Một ô thông tin có icon (dùng trong hộp xác nhận, tóm tắt). */
export function Fact({ icon, label, children, tone = 'gray' }: { icon: ReactNode; label: string; children: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <IconTile icon={icon} size="sm" tone={tone} />
      <div className="min-w-0">
        <dt className="text-xs text-stone-500">{label}</dt>
        <dd className="truncate text-sm font-medium text-ink">{children}</dd>
      </div>
    </div>
  );
}
export function FactGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx('grid grid-cols-1 gap-3 sm:grid-cols-2', className)}>{children}</dl>;
}
