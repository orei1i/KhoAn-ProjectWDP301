'use client';

/**
 * Khối giao diện cho các trang QUẢN LÝ (quản lý chi nhánh, vận hành chuỗi, quản trị): bổ sung cho `@/features/staff-ui`
 * (Callout, Chip, QueueRow, PanelHeader, Fact…) — cùng token màu, IconTile, InfoTip — để bảng điều khiển, hàng đợi duyệt
 * và trang cấu hình nhìn nhanh, ít chữ. Chỉ trình bày: không gọi API, không giữ state nghiệp vụ.
 */

import type { ReactNode } from 'react';
import { Building2, HardHat, Network, Search, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import type { Role } from '@ssm/shared';
import { ROLE, type Tone } from '@/shared/lib/labels';
import { Badge, IconTile, InfoTip, Progress, TONE_DOT, cx, inputCls } from '@/shared/ui';
import { Avatar } from '@/features/staff-ui';

// ---------- Vai trò ----------
/** Vai trò → icon (huy hiệu vai trò, bộ lọc người dùng). */
export const ROLE_ICON: Record<Role, LucideIcon> = {
  CUSTOMER: UserRound, STAFF: HardHat, FACILITY_MANAGER: Building2, OPS_MANAGER: Network, ADMIN: ShieldCheck,
};

/** Huy hiệu vai trò có icon, màu theo `ROLE[role].tone`. */
export function RoleBadge({ role }: { role: Role }) {
  const Icon = ROLE_ICON[role];
  return <Badge tone={ROLE[role].tone}><Icon className="size-3" aria-hidden />{ROLE[role].label}</Badge>;
}

// ---------- Người ----------
/** Chữ cái đầu + tên + dòng phụ (email, vai trò…). */
export function PersonCell({ name, sub, tone = 'teal', size = 'sm', className }: { name: string; sub?: ReactNode; tone?: Tone; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span className={cx('flex min-w-0 items-center gap-2.5', className)}>
      <Avatar name={name} tone={tone} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{name}</span>
        {sub && <span className="block truncate text-xs text-stone-500">{sub}</span>}
      </span>
    </span>
  );
}

// ---------- Tìm kiếm ----------
export function SearchInput({ value, onChange, placeholder = 'Tìm…', label, className }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden />
      <input className={cx(inputCls, 'pl-9')} placeholder={placeholder} aria-label={label ?? placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ---------- Mục trong hộp thoại ----------
/** Một mục có tiêu đề nhỏ (icon + chữ + (i)) trong hộp chi tiết — thay cho tiêu đề `h4` trần và đoạn mô tả dài. */
export function Section({ icon, title, tip, aside, className, children }: { icon?: ReactNode; title: ReactNode; tip?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx('space-y-2.5', className)}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {icon && <span className="text-stone-400 [&>svg]:size-4" aria-hidden>{icon}</span>}
        <h4 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-ink">{title}{tip && <InfoTip align="start">{tip}</InfoTip>}</h4>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Khối chữ do người dùng nhập (mô tả của khách, khiếu nại…) — giữ xuống dòng. */
export function TextBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('whitespace-pre-line rounded-xl bg-stone-50 px-4 py-3 text-sm leading-relaxed text-stone-700 ring-1 ring-inset ring-stone-200', className)}>{children}</div>;
}

// ---------- Dòng thời gian ----------
/** Lịch sử trạng thái dạng dòng thời gian dọc (chấm màu + nội dung + thời điểm / ghi chú). */
export function Timeline({ items, className }: { items: { at: ReactNode; title: ReactNode; note?: ReactNode; tone?: Tone }[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ol className={cx('relative ml-1 space-y-3 border-l border-stone-200 pl-4', className)}>
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span className={cx('absolute -left-[21.5px] top-1.5 size-2.5 rounded-full ring-2 ring-white', TONE_DOT[it.tone ?? 'gray'])} aria-hidden />
          <p className="text-sm text-ink">{it.title}</p>
          <p className="text-xs text-stone-500">{it.at}{it.note && <> · {it.note}</>}</p>
        </li>
      ))}
    </ol>
  );
}

// ---------- Thanh đo ----------
/** Một dòng có thanh tiến độ (lấp đầy theo loại kho, chỉ tiêu…): icon, nhãn, số bên phải, thanh màu. */
export function MeterRow({ icon, label, sub, value, tone = 'teal', right, className }: { icon?: ReactNode; label: ReactNode; sub?: ReactNode; value: number; tone?: Tone; right?: ReactNode; className?: string }) {
  return (
    <li className={cx('flex items-center gap-3 px-4 py-3 sm:px-5', className)}>
      {icon && <IconTile icon={icon} size="sm" tone={tone} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="truncate font-medium text-ink">{label}</span>
          {right && <span className="shrink-0 text-xs tabular-nums text-stone-600">{right}</span>}
        </div>
        <Progress value={value} tone={tone} className="mt-1.5" />
        {sub && <p className="mt-1 text-xs text-stone-500">{sub}</p>}
      </div>
    </li>
  );
}
