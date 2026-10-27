'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { HOME } from '@/shared/lib/nav';
import { ROLE } from '@/shared/lib/labels';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/features/legal/legal-content';
import { Badge, Button, Card, Field, Skeleton, cx, inputCls } from '@/shared/ui';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function LoginInner() {
  const { user, busy, syncing, firebaseReady, providers, loginEmail, loginGoogle, register, markGoogleConsent, logout } = useStore();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  // "Tiếp tục với Google" có thể tạo tài khoản mới ngay — bắt buộc tick đồng ý trước khi bấm (server từ chối hồ sơ mới thiếu đồng ý).
  const [agreeGoogle, setAgreeGoogle] = useState(false);

  // Firebase sign-in resolves before the profile sync finishes; navigate once the profile is loaded.
  useEffect(() => {
    if (!user || !waiting) return;
    const dest = next && next.startsWith('/') ? next : HOME[user.role];

    // Chưa có mật khẩu (tài khoản Google mới) → bắt buộc đặt trước khi đi tiếp.
    // RequirePassword trong RootLayout cũng chặn lại nếu ai đó gõ thẳng URL khác.
    if (!providers.includes('password')) {
      router.replace(`/dat-mat-khau?next=${encodeURIComponent(dest)}`);
      return;
    }
    router.replace(dest);
  }, [user, waiting, providers, next, router]);

  // Đồng bộ hồ sơ thất bại (store đã báo lỗi và đăng xuất) → bỏ màn chờ, hiện lại form.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (syncing) { wasSyncing.current = true; return; }
    if (wasSyncing.current && waiting && !user) setWaiting(false);
    wasSyncing.current = false;
  }, [syncing, waiting, user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = mode === 'login' ? await loginEmail(email, password) : await register(fullName, email, password, phone);
    if (ok) setWaiting(true);
  };

  if (!firebaseReady) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <Card className="flex gap-3 border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <TriangleAlert className="size-5 shrink-0" />
          <p>Chưa cấu hình Firebase. Chép <code>Webapp/.env.local.example</code> thành <code>.env.local</code>, điền <code>NEXT_PUBLIC_FIREBASE_*</code> rồi khởi động lại <code>npm run web</code>.</p>
        </Card>
      </main>
    );
  }

  // Firebase đã nhận mật khẩu, đang đồng bộ hồ sơ + tải dữ liệu — không để form đứng yên như bị treo.
  if ((waiting || syncing) && !user) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <Card className="p-6">
          <p className="flex items-center gap-2 text-sm font-medium text-stone-700"><Loader2 className="size-4 animate-spin" />Đang đăng nhập và tải dữ liệu tài khoản…</p>
          <div className="mt-5 grid gap-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="mt-2 grid grid-cols-2 gap-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          </div>
          <p className="mt-5 text-xs text-stone-500">Lần đầu trong ngày máy chủ có thể cần 30–60 giây để khởi động.</p>
        </Card>
      </main>
    );
  }

  if (user && !waiting) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <Card className="p-6">
          <p className="text-sm text-stone-500">Đang đăng nhập với</p>
          <p className="mt-1 text-lg font-semibold">{user.fullName} <Badge tone={ROLE[user.role].tone}>{ROLE[user.role].label}</Badge></p>
          <p className="text-sm text-stone-500">{user.email}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => router.push(HOME[user.role])}>Vào bảng điều khiển <ArrowRight className="size-4" /></Button>
            <Button variant="secondary" onClick={() => void logout()}>Đăng xuất</Button>
          </div>
          {!providers.includes('password') && (
            <div className="mt-5 rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-stone-200">
              <p className="font-medium">Tài khoản chưa có mật khẩu.</p>
              <p className="mt-1 text-stone-600">Cần đặt mật khẩu để hoàn tất tài khoản — sau đó vào được bằng cả email lẫn Google.</p>
              <Link href="/dat-mat-khau" className="mt-2 inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                <KeyRound className="size-4" />Đặt mật khẩu
              </Link>
            </div>
          )}
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <Card className="p-6 sm:p-8">
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1 text-sm font-medium">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cx('flex-1 rounded-md py-2', mode === m ? 'bg-white shadow-sm' : 'text-stone-500')}>
              {m === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          ))}
        </div>

        <label className="mt-6 flex cursor-pointer gap-2.5 text-xs leading-relaxed text-stone-700">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agreeGoogle} onChange={(e) => setAgreeGoogle(e.target.checked)} />
          <span>
            Tôi đồng ý với <Link href="/dieu-khoan" target="_blank" className="font-medium text-brand-700 hover:underline">Điều khoản thuê kho (v{TERMS_VERSION})</Link> và
            cho KhoAn xử lý dữ liệu cá nhân theo <Link href="/bao-mat" target="_blank" className="font-medium text-brand-700 hover:underline">Chính sách bảo mật (v{PRIVACY_VERSION})</Link>
          </span>
        </label>
        <Button variant="secondary" size="lg" className="mt-3 w-full" disabled={busy || !agreeGoogle} title={agreeGoogle ? undefined : 'Tick đồng ý Điều khoản và Chính sách bảo mật trước'}
          onClick={async () => { markGoogleConsent(); if (await loginGoogle()) setWaiting(true); }}>
          <GoogleIcon /> Tiếp tục với Google
        </Button>
        <div className="my-6 flex items-center gap-3 text-xs text-stone-400"><span className="h-px flex-1 bg-stone-200" />hoặc dùng email<span className="h-px flex-1 bg-stone-200" /></div>

        <form className="grid gap-4" onSubmit={submit}>
          {mode === 'register' && (
            <>
              <Field label="Họ tên (đúng như trên giấy tờ)"><input className={inputCls} required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" /></Field>
              <Field label="Số điện thoại">
                <input className={inputCls} required inputMode="tel" pattern="[+0-9 .()\-]{9,30}" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="0901 234 567" />
              </Field>
            </>
          )}
          <Field label="Email"><input type="email" className={inputCls} required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
          <Field label="Mật khẩu" hint={mode === 'register' ? 'Ít nhất 6 ký tự. Sau khi đăng ký, xác minh email để đặt kho.' : undefined}>
            <input type="password" className={inputCls} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Field>
          {mode === 'register' && (
            <div className="space-y-2.5">
              <label className="flex cursor-pointer gap-2.5 text-xs leading-relaxed text-stone-700">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span>Tôi đã đọc và đồng ý với <Link href="/dieu-khoan" target="_blank" className="font-medium text-brand-700 hover:underline">Điều khoản thuê kho (v{TERMS_VERSION})</Link></span>
              </label>
              <label className="flex cursor-pointer gap-2.5 text-xs leading-relaxed text-stone-700">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
                <span>Tôi đồng ý cho KhoAn xử lý dữ liệu cá nhân theo <Link href="/bao-mat" target="_blank" className="font-medium text-brand-700 hover:underline">Chính sách bảo mật (v{PRIVACY_VERSION})</Link></span>
              </label>
            </div>
          )}
          <Button type="submit" size="lg" disabled={busy || (mode === 'register' && (!agreeTerms || !agreePrivacy))}>{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</Button>
          {mode === 'login' && (
            <Link href={email ? `/quen-mat-khau?email=${encodeURIComponent(email)}` : '/quen-mat-khau'} className="text-left text-sm text-brand-700 hover:underline">
              Quên mật khẩu?
            </Link>
          )}
        </form>
        <p className="mt-6 text-xs text-stone-500">
          Tài khoản nhân viên và quản lý do Quản trị hệ thống cấp — dùng link đặt mật khẩu trong email được gửi.
          {' '}Đã đăng nhập bằng Google và muốn thêm mật khẩu? <Link href="/dat-mat-khau" className="text-brand-700 hover:underline">Đặt mật khẩu</Link>.
        </p>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
