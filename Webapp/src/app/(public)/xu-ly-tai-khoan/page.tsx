'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { applyActionCode, confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from 'firebase/auth';
import { Check, KeyRound, Loader2, MailCheck, TriangleAlert } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { HOME } from '@/shared/lib/nav';
import { authErrorMessage, firebaseAuth, firebaseConfigured } from '@/shared/api/firebase';
import { Button, Card, Field, inputCls } from '@/shared/ui';

/**
 * Trang xử lý các link Firebase gửi qua email (đặt lại mật khẩu, xác minh email).
 *
 * Mặc định Firebase trỏ link về <project>.firebaseapp.com/__/auth/action — giao diện của Google.
 * Trỏ về đây thay thế: Firebase Console → Authentication → Templates → biểu tượng bút chì → Action URL
 *     https://wdp-301-webapp.vercel.app/xu-ly-tai-khoan
 * Firebase vẫn gắn sẵn ?mode=...&oobCode=...&apiKey=... vào URL đó.
 */

type Phase = 'checking' | 'form' | 'done' | 'error';

function ActionInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, confirmVerification } = useStore();

  const mode = params.get('mode') ?? '';
  const oobCode = params.get('oobCode') ?? '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = useCallback((m: string) => { setMessage(m); setPhase('error'); }, []);

  // Kiểm tra mã ngay khi vào trang: mã hỏng/hết hạn thì báo luôn, đừng để người dùng gõ xong mới biết.
  useEffect(() => {
    if (!firebaseConfigured) return fail('Chưa cấu hình Firebase.');
    if (!oobCode) return fail('Link không hợp lệ — thiếu mã xác thực. Hãy mở lại link trong email.');

    let alive = true;
    (async () => {
      try {
        if (mode === 'resetPassword') {
          const mail = await verifyPasswordResetCode(firebaseAuth(), oobCode);
          if (!alive) return;
          setEmail(mail);
          setPhase('form');
        } else if (mode === 'verifyEmail') {
          await applyActionCode(firebaseAuth(), oobCode);
          if (!alive) return;
          setMessage('Email đã được xác minh.');
          setPhase('done');
        } else {
          fail(`Loại yêu cầu không được hỗ trợ (${mode || 'trống'}).`);
        }
      } catch (e) {
        if (!alive) return;
        const code = (e as { code?: string })?.code ?? '';
        if (code === 'auth/expired-action-code') fail('Link đã hết hạn. Hãy yêu cầu gửi lại email.');
        else if (code === 'auth/invalid-action-code') fail('Link không còn hiệu lực — có thể bạn đã dùng nó rồi, hoặc đã yêu cầu một link mới hơn.');
        else fail(authErrorMessage(e));
      }
    })();
    return () => { alive = false; };
  }, [mode, oobCode, fail]);

  // Xác minh email xong mà đang đăng nhập thì làm mới token để hồ sơ hết trạng thái chờ.
  useEffect(() => {
    if (phase === 'done' && mode === 'verifyEmail' && user) void confirmVerification();
  }, [phase, mode, user, confirmVerification]);

  // Đặt lại mật khẩu xong là đăng nhập luôn → khi hồ sơ về thì đưa thẳng vào khu vực của họ.
  useEffect(() => {
    if (phase === 'done' && mode === 'resetPassword' && user) router.replace(HOME[user.role]);
  }, [phase, mode, user, router]);

  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    try {
      await confirmPasswordReset(firebaseAuth(), oobCode, password);
      setMessage('Đã đổi mật khẩu.');
      setPhase('done');
      // Đăng nhập luôn bằng mật khẩu mới; hỏng thì thôi, người dùng vẫn tự đăng nhập được.
      await signInWithEmailAndPassword(firebaseAuth(), email, password).catch(() => {});
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/weak-password') setMessage('Mật khẩu quá ngắn — cần ít nhất 6 ký tự.');
      else fail(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <Card className="p-6 sm:p-8">
        {phase === 'checking' && (
          <p className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />Đang kiểm tra link…</p>
        )}

        {phase === 'error' && (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-orange-700"><TriangleAlert className="size-5" />Không dùng được link này</p>
            <p className="mt-3 text-sm text-stone-600">{message}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/quen-mat-khau"><Button>Gửi lại link đặt lại mật khẩu</Button></Link>
              <Link href="/login"><Button variant="secondary">Về trang đăng nhập</Button></Link>
            </div>
          </>
        )}

        {phase === 'form' && (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="size-5" />Đặt lại mật khẩu</p>
            <p className="mt-2 text-sm text-stone-500">Cho tài khoản <strong className="text-ink">{email}</strong></p>
            <form className="mt-6 grid gap-4" onSubmit={submit}>
              <input type="email" value={email} readOnly hidden autoComplete="username" />
              <Field label="Mật khẩu mới" hint="Ít nhất 6 ký tự">
                <input type="password" className={inputCls} required minLength={6} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Nhập lại mật khẩu" hint={mismatch ? 'Hai lần nhập chưa khớp' : undefined}>
                <input type="password" className={inputCls} required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </Field>
              {message && <p className="text-sm text-orange-700">{message}</p>}
              <Button type="submit" size="lg" disabled={busy || mismatch || password.length < 6}>Đặt lại mật khẩu</Button>
            </form>
          </>
        )}

        {phase === 'done' && (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-emerald-700">
              {mode === 'verifyEmail' ? <MailCheck className="size-5" /> : <Check className="size-5" />}{message}
            </p>
            <p className="mt-3 text-sm text-stone-600">
              {mode === 'resetPassword'
                ? 'Đang đăng nhập bằng mật khẩu mới…'
                : 'Tài khoản của bạn đã sẵn sàng đặt kho.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={user ? HOME[user.role] : '/login'}><Button>{user ? 'Vào bảng điều khiển' : 'Đăng nhập'}</Button></Link>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}

export default function AccountActionPage() {
  return <Suspense><ActionInner /></Suspense>;
}
