'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { LogOut, MailWarning, Menu, Pencil, RefreshCw, ShieldAlert, UserCog, UserRoundPen, X } from 'lucide-react';
import { profileGaps } from '@ssm/shared';
import { AREAS, HOME, type Area } from '@/shared/lib/nav';
import { useStore } from '@/shared/store/store';
import { ROLE } from '@/shared/lib/labels';
import { facilityName } from '@/shared/lib/domain';
import { initials } from '@/shared/lib/format';
import { Badge, Button, ButtonLink, EmptyState, Skeleton, cx } from '@/shared/ui';
import { Logo } from '@/shared/layout/brand';
import { ProfileDialog } from '@/features/auth/profile-name';

export function AppShell({ area, children }: { area: Area; children: ReactNode }) {
  const { user, db, ready, syncing, logout, refresh, resendVerification, confirmVerification } = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const signOutTo = async (href: string) => { await logout(); router.push(href); };
  const [open, setOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const conf = AREAS[area];

  // Firebase chưa khôi phục xong phiên → chưa biết có đăng nhập hay không.
  // Hiện khung xám thay vì kết luận vội "chưa đăng nhập" rồi nhấp nháy sang giao diện thật.
  // Vừa đăng nhập xong mà hồ sơ / dữ liệu chưa tải về (Render có thể chậm vài giây) cũng vậy.
  if (!ready || (syncing && !user)) {
    return (
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 bg-ink p-4 lg:block">
          <Skeleton className="h-8 w-32 bg-white/10" />
          <div className="mt-8 grid gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 bg-white/10" />)}</div>
        </aside>
        <div className="flex-1 p-6">
          <Skeleton className="h-8 w-56" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="mt-6 h-72" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <EmptyState icon={<UserCog className="size-6" />} title="Bạn chưa đăng nhập" description="Chọn một tài khoản mẫu để xem khu vực này." action={<ButtonLink href={`/login?next=${encodeURIComponent(pathname)}`}>Đăng nhập</ButtonLink>} />
      </div>
    );
  }

  const allowed = conf.roles.includes(user.role);
  // Facility managers also get the staff tools; show both groups in one sidebar.
  const groups: Area[] = user.role === 'FACILITY_MANAGER' ? ['manager', 'staff'] : [area];
  const scoped = user.role === 'STAFF' || user.role === 'FACILITY_MANAGER';

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{AREAS[g].title}</p>
          <ul className="space-y-0.5">
            {AREAS[g].items.filter((it) => !it.roles || it.roles.includes(user.role)).map((it) => {
              const active = pathname === it.href || (it.href !== `/${g}` && pathname.startsWith(it.href + '/'));
              const Icon = it.icon;
              return (
                <li key={it.href}>
                  <Link href={it.href} onClick={() => setOpen(false)} className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', active ? 'bg-white/10 font-medium text-white' : 'text-stone-300 hover:bg-white/5 hover:text-white')}>
                    <Icon className="size-4 shrink-0" />
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {user.role === 'CUSTOMER' && (
        <ButtonLink href="/facilities" size="sm" className="mx-3">+ Thuê kho mới</ButtonLink>
      )}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-ink">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo dark />
        <button className="text-stone-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Đóng menu"><X className="size-5" /></button>
      </div>
      {nav}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials(user.fullName)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.fullName}</p>
            <p className="truncate text-xs text-stone-400">{ROLE[user.role].label}</p>
          </div>
          <button onClick={() => { setOpen(false); setNameOpen(true); }} title="Thông tin cá nhân" aria-label="Thông tin cá nhân" className="rounded-md p-1.5 text-stone-400 hover:bg-white/10 hover:text-white"><Pencil className="size-3.5" /></button>
        </div>
        {scoped && (
          <p className="mt-3 rounded-md bg-white/5 px-2 py-1.5 text-[11px] leading-snug text-stone-300">
            Phạm vi dữ liệu: {user.facilityIds.map((id) => facilityName(db, id)).join(', ')}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button onClick={() => void signOutTo('/login')} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-white/5 py-1.5 text-xs text-stone-200 hover:bg-white/10"><UserCog className="size-3.5" />Đổi tài khoản</button>
          <button onClick={() => void refresh()} title="Tải lại dữ liệu" className="rounded-md bg-white/5 px-2 text-stone-300 hover:bg-white/10"><RefreshCw className="size-3.5" /></button>
          <button onClick={() => void signOutTo('/')} title="Đăng xuất" className="rounded-md bg-white/5 px-2 text-stone-300 hover:bg-white/10"><LogOut className="size-3.5" /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Mở menu" className="text-stone-700"><Menu className="size-5" /></button>
        <Logo />
        <span className="ml-auto"><Badge tone={ROLE[user.role].tone}>{ROLE[user.role].label}</Badge></span>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {profileGaps(user).length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <UserRoundPen className="size-5 shrink-0" />
            <p className="flex-1">Tài khoản còn thiếu {profileGaps(user).join(', ')}. {user.role === 'CUSTOMER' ? 'Bổ sung để đặt kho, ký và gia hạn hợp đồng — các thông tin này được in vào hợp đồng.' : 'Cập nhật để thông tin hiển thị đúng.'}</p>
            <Button size="sm" onClick={() => setNameOpen(true)}>Cập nhật thông tin</Button>
          </div>
        )}
        {user.status === 'PENDING_VERIFICATION' && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <MailWarning className="size-5 shrink-0" />
            <p className="flex-1">Tài khoản chưa xác minh email ({user.email}). Bấm link trong email rồi nhấn “Tôi đã xác minh” để đặt kho.</p>
            <Button size="sm" variant="secondary" onClick={() => void resendVerification()}>Gửi lại email</Button>
            <Button size="sm" onClick={() => void confirmVerification()}>Tôi đã xác minh</Button>
          </div>
        )}
        {allowed ? children : (
          <EmptyState
            icon={<ShieldAlert className="size-6" />}
            title="Không có quyền truy cập"
            description={`Khu vực "${conf.title}" dành cho ${conf.roles.map((r) => ROLE[r].label).join(', ')}. Bạn đang đăng nhập với vai trò ${ROLE[user.role].label}.`}
            action={<ButtonLink href={HOME[user.role]}>Về trang của tôi</ButtonLink>}
          />
        )}
      </main>
      <ProfileDialog open={nameOpen} onClose={() => setNameOpen(false)} />
    </div>
  );
}
