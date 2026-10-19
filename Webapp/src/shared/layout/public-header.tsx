'use client';

import Link from 'next/link';
import { useStore } from '@/shared/store/store';
import { HOME } from '@/shared/lib/nav';
import { ButtonLink } from '@/shared/ui';
import { Logo } from '@/shared/layout/brand';

export function PublicHeader() {
  const { user } = useStore();
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-5 text-sm text-stone-600 md:flex">
          <Link href="/facilities" className="hover:text-ink">Tìm kho</Link>
          <Link href="/#sizes" className="hover:text-ink">Kích thước & giá</Link>
          <Link href="/#how" className="hover:text-ink">Cách thuê</Link>
          <Link href="/dieu-khoan" className="hover:text-ink">Điều khoản</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <ButtonLink href={HOME[user.role]} size="sm">Vào bảng điều khiển</ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">Đăng nhập</ButtonLink>
              <ButtonLink href="/facilities" size="sm">Thuê kho</ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-20 border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} KhoAn Self Storage — bản mô phỏng giao diện (WDP301).</p>
        <p>Hotline 1900 0000 · Mở cửa 7:00–21:00 hằng ngày</p>
      </div>
    </footer>
  );
}
