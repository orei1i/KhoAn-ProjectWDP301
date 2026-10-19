'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useStore } from '@/shared/store/store';

/**
 * Cổng chặn: tài khoản đăng nhập bằng Google mà chưa có mật khẩu thì bị giữ lại ở /dat-mat-khau
 * cho tới khi đặt xong. Đặt trong RootLayout nên áp cho mọi trang, kể cả khi gõ thẳng URL.
 *
 * Chỉ chạy sau khi providers đã nạp (mảng rỗng nghĩa là chưa biết) để không đá nhầm người dùng
 * trong lúc Firebase còn đang khôi phục phiên.
 */
const ALLOWED = ['/dat-mat-khau', '/quen-mat-khau', '/xu-ly-tai-khoan'];

export function RequirePassword() {
  const { user, providers, ready } = useStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !user || providers.length === 0) return;
    if (providers.includes('password')) return;
    if (ALLOWED.some((p) => pathname.startsWith(p))) return;
    router.replace('/dat-mat-khau');
  }, [ready, user, providers, pathname, router]);

  return null;
}
