'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, MailCheck, TriangleAlert } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { Button, Card, Field, inputCls } from '@/shared/ui';

const RESEND_SECONDS = 60;

function ForgotInner() {
  const { busy, firebaseReady, resetPassword } = useStore();
  const prefill = useSearchParams().get('email') ?? '';
  const [email, setEmail] = useState(prefill);
  const [sent, setSent] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (await resetPassword(email)) { setSent(true); setLeft(RESEND_SECONDS); }
  };

  if (!firebaseReady) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <Card className="flex gap-3 border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <TriangleAlert className="size-5 shrink-0" />
          <p>Chưa cấu hình Firebase nên không gửi được email.</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-ink"><ArrowLeft className="size-4" />Quay lại đăng nhập</Link>

      <Card className="mt-4 p-6 sm:p-8">
        {sent ? (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold"><MailCheck className="size-5 text-brand-700" />Kiểm tra hộp thư</p>
            <p className="mt-3 text-sm text-stone-600">
              Nếu <strong>{email}</strong> có tài khoản, chúng tôi đã gửi một email kèm link đặt lại mật khẩu. Link có hiệu lực trong 1 giờ.
            </p>
            <ul className="mt-4 grid gap-1.5 text-sm text-stone-500">
              <li>· Không thấy thư? Xem thêm mục <strong>Spam</strong> hoặc <strong>Quảng cáo</strong>.</li>
              <li>· Người gửi là <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">noreply@…firebaseapp.com</code>.</li>
            </ul>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={busy || left > 0} onClick={() => void send()}>
                {left > 0 ? `Gửi lại sau ${left}s` : 'Gửi lại email'}
              </Button>
              <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => { setSent(false); setLeft(0); }}>
                Dùng email khác
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Quên mật khẩu</h1>
            <p className="mt-2 text-sm text-stone-500">Nhập email đã đăng ký. Chúng tôi gửi cho bạn một link để đặt lại mật khẩu.</p>
            <form className="mt-6 grid gap-4" onSubmit={send}>
              <Field label="Email">
                <input type="email" className={inputCls} required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </Field>
              <Button type="submit" size="lg" disabled={busy || email.trim().length === 0}>Gửi link đặt lại</Button>
            </form>
            <p className="mt-5 text-xs text-stone-500">
              Tài khoản đăng nhập bằng Google chưa đặt mật khẩu thì không nhận được email này — hãy đăng nhập bằng Google rồi đặt mật khẩu ở trang tiếp theo.
            </p>
          </>
        )}
      </Card>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return <Suspense><ForgotInner /></Suspense>;
}
