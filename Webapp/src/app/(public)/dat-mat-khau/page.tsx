'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Check, KeyRound, Mail, TriangleAlert } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { HOME } from '@/shared/lib/nav';
import { Button, Card, Field, inputCls } from '@/shared/ui';

const LABEL: Record<string, string> = {
  'google.com': 'Google',
  password: 'Email + mật khẩu',
  'facebook.com': 'Facebook',
};

function SetPasswordInner() {
  const { user, busy, providers, setPassword, logout } = useStore();
  const router = useRouter();
  const nextParam = useSearchParams().get('next');
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const hasPassword = providers.includes('password');
  const mismatch = confirm.length > 0 && password !== confirm;
  const dest = nextParam && nextParam.startsWith('/') ? nextParam : user ? HOME[user.role] : '/';

  // Đặt xong thì tự đi tiếp, không bắt bấm thêm.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.replace(dest), 1800);
    return () => clearTimeout(t);
  }, [done, dest, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    if (await setPassword(password)) { setPw(''); setConfirm(''); setDone(true); }
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <Card className="flex gap-3 border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <TriangleAlert className="size-5 shrink-0" />
          <div>
            <p>Bạn cần đăng nhập trước khi đặt mật khẩu.</p>
            <Link href="/login?next=/dat-mat-khau" className="mt-2 inline-block font-medium text-brand-700 hover:underline">Tới trang đăng nhập</Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <Card className="p-6 sm:p-8">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5" />
          {hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu cho tài khoản'}
        </p>
        <p className="mt-2 text-sm text-stone-500">
          {hasPassword
            ? 'Đổi mật khẩu dùng để đăng nhập bằng email.'
            : 'Bạn vừa đăng nhập bằng Google. Hãy đặt mật khẩu để hoàn tất tài khoản — từ đó vào được bằng cả email lẫn Google. Vẫn là một tài khoản duy nhất, không tạo tài khoản mới.'}
        </p>

        <div className="mt-5 rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-stone-200">
          <p className="flex items-center gap-2 font-medium"><Mail className="size-4 text-stone-400" />{user.email}</p>
          <p className="mt-2 text-xs text-stone-500">
            Đang đăng nhập được bằng: {providers.length ? providers.map((p) => LABEL[p] ?? p).join(' · ') : '—'}
          </p>
        </div>

        {done && (
          <div className="mt-5 flex gap-3 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <Check className="size-5 shrink-0" />
            <div>
              <p className="font-medium">{hasPassword ? 'Đã cập nhật mật khẩu.' : 'Xong.'}</p>
              <p className="mt-1">Từ giờ đăng nhập được bằng <strong>{user.email}</strong> và mật khẩu vừa đặt. Đang chuyển tiếp…</p>
            </div>
          </div>
        )}

        <form className="mt-6 grid gap-4" onSubmit={submit}>
          {/* trình quản lý mật khẩu cần thấy email để lưu đúng tài khoản */}
          <input type="email" value={user.email} readOnly hidden autoComplete="username" />
          <Field label={hasPassword ? 'Mật khẩu mới' : 'Mật khẩu'} hint="Ít nhất 6 ký tự">
            <input type="password" className={inputCls} required minLength={6} autoFocus value={password} onChange={(e) => { setPw(e.target.value); setDone(false); }} autoComplete="new-password" />
          </Field>
          <Field label="Nhập lại mật khẩu" hint={mismatch ? 'Hai lần nhập chưa khớp' : undefined}>
            <input type="password" className={inputCls} required minLength={6} value={confirm} onChange={(e) => { setConfirm(e.target.value); setDone(false); }} autoComplete="new-password" />
          </Field>
          <Button type="submit" size="lg" disabled={busy || mismatch || password.length < 6}>
            {hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}
          </Button>
        </form>

        <p className="mt-6 border-t border-stone-200 pt-5 text-xs text-stone-500">
          Phiên đăng nhập cũ thì Firebase yêu cầu xác thực lại — một cửa sổ Google hiện ra, xác nhận xong hệ thống tự đặt tiếp.
          {' '}Không muốn tiếp tục? <button type="button" className="text-brand-700 hover:underline" onClick={() => void logout()}>Đăng xuất</button>.
        </p>
      </Card>
    </main>
  );
}

export default function SetPasswordPage() {
  return <Suspense><SetPasswordInner /></Suspense>;
}
