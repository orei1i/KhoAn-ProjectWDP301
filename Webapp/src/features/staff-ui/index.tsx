'use client';

/**
 * Bộ khối giao diện cho các trang NHÂN VIÊN (quầy, kho): nhìn nhanh, ít chữ, màu theo trạng thái.
 * Chỉ trình bày — không gọi API, không giữ state nghiệp vụ. Dựa trên cùng token màu / IconTile / InfoTip của `@/shared/ui`
 * để trang nhân viên cùng "ngôn ngữ" với trang khách đã thiết kế lại.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Tone } from '@/shared/lib/labels';
import { initials } from '@/shared/lib/format';
import { IconTile, InfoTip, cx } from '@/shared/ui';

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
  ink: 'bg-ink text-white', gray: 'bg-stone-200 text-stone-800', green: 'bg-emerald-600 text-white', blue: 'bg-sky-600 text-white',
  amber: 'bg-amber-500 text-white', red: 'bg-red-600 text-white', violet: 'bg-violet-600 text-white', teal: 'bg-brand-700 text-white',
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
      <h3 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-ink">
        <span className="truncate">{title}</span>
        {count !== undefined && <Count n={count} tone={tone} />}
        {tip && <InfoTip align="start">{tip}</InfoTip>}
      </h3>
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
  todo: 'bg-white text-stone-400 ring-1 ring-inset ring-stone-300',
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
          <span className={cx('mt-1.5 line-clamp-2 px-0.5 text-[11px] font-medium leading-tight sm:text-xs', s.state === 'todo' ? 'text-stone-400' : s.state === 'blocked' ? 'text-amber-800' : 'text-ink', s.state === 'current' && 'font-semibold')}>{s.label}</span>
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
        <h4 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-ink">{title}{tip && <InfoTip align="start">{tip}</InfoTip>}</h4>
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
  gray: 'bg-white text-ink shadow-sm ring-1 ring-stone-200', green: 'bg-emerald-600 text-white shadow-sm', blue: 'bg-sky-600 text-white shadow-sm',
  amber: 'bg-amber-600 text-white shadow-sm', red: 'bg-red-600 text-white shadow-sm', violet: 'bg-violet-600 text-white shadow-sm', teal: 'bg-brand-700 text-white shadow-sm',
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
          className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors [&>svg]:size-3.5', value === o.key ? 'bg-ink text-white ring-ink' : 'bg-white text-stone-600 ring-stone-300 hover:bg-stone-50')}>
          {o.icon}{o.label}
          {o.count !== undefined && <span className={cx('rounded-full px-1.5 tabular-nums', value === o.key ? 'bg-white/20' : 'bg-stone-100')}>{o.count}</span>}
        </button>
      ))}
    </div>
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
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
