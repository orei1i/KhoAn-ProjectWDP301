'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Clock3, Menu, Phone, X } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { HOME } from '@/shared/lib/nav';
import { PHOTO_CREDIT } from '@/shared/lib/images';
import { ButtonLink, cx } from '@/shared/ui';
import { Logo } from '@/shared/layout/brand';

const LINKS = [
  { href: '/facilities', label: 'Tìm kho' },
  { href: '/#sizes', label: 'Kích thước & giá' },
  { href: '/#how', label: 'Cách thuê' },
  { href: '/dieu-khoan', label: 'Điều khoản' },
];

export function PublicHeader() {
  const { user } = useStore();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  const active = (href: string) => !href.includes('#') && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-1 text-sm md:flex" aria-label="Điều hướng chính">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={cx('rounded-lg px-3 py-1.5 transition-colors', active(l.href) ? 'bg-brand-50 font-medium text-brand-800' : 'text-stone-600 hover:bg-stone-100 hover:text-ink')}>{l.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <ButtonLink href={HOME[user.role]} size="sm">Vào bảng điều khiển</ButtonLink>
          ) : (
            <>
              <span className="hidden sm:inline-flex"><ButtonLink href="/login" variant="ghost" size="sm">Đăng nhập</ButtonLink></span>
              <ButtonLink href="/facilities" size="sm">Thuê kho</ButtonLink>
            </>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Đóng menu' : 'Mở menu'}
            className="grid size-9 place-items-center rounded-lg text-stone-700 hover:bg-stone-100 md:hidden">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-stone-200 bg-white px-4 py-3 md:hidden" aria-label="Điều hướng chính">
          <ul className="grid gap-1 text-sm">
            {LINKS.map((l) => (
              <li key={l.href}><Link href={l.href} onClick={() => setOpen(false)} className={cx('block rounded-lg px-3 py-2.5', active(l.href) ? 'bg-brand-50 font-medium text-brand-800' : 'text-stone-700 hover:bg-stone-100')}>{l.label}</Link></li>
            ))}
            {!user && <li><Link href="/login" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 font-medium text-brand-700 hover:bg-stone-100">Đăng nhập / Tạo tài khoản</Link></li>}
          </ul>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-20 border-t border-stone-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-stone-500">Kho tự quản: đặt online, ký hợp đồng điện tử, quét QR nhận kho.</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Khám phá</p>
          <ul className="mt-3 grid gap-2 text-sm">
            {LINKS.slice(0, 3).map((l) => <li key={l.href}><Link href={l.href} className="text-stone-600 hover:text-brand-700">{l.label}</Link></li>)}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Liên hệ</p>
          <ul className="mt-3 grid gap-2 text-sm text-stone-600">
            <li className="flex items-center gap-2"><Phone className="size-4 text-brand-700" />Hotline 1900 0000</li>
            <li className="flex items-center gap-2"><Clock3 className="size-4 text-brand-700" />Mở cửa 7:00–21:00 hằng ngày</li>
            <li className="flex gap-3 pt-1">
              <Link href="/dieu-khoan" className="hover:text-brand-700">Điều khoản</Link>
              <Link href="/bao-mat" className="hover:text-brand-700">Bảo mật</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-stone-100">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-xs text-stone-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} KhoAn Self Storage — bản mô phỏng giao diện (WDP301).</p>
          <p>{PHOTO_CREDIT}</p>
        </div>
      </div>
    </footer>
  );
}
