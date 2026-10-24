'use client';

import { useEffect, useState } from 'react';
import { FileSignature, Mail } from 'lucide-react';
import type { Reservation } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { userName } from '@/shared/lib/domain';
import { fmtDateTime } from '@/shared/lib/format';
import { Button, Field, cx, inputCls } from '@/shared/ui';
import { ContractDocument } from './contract-document';
import { SignaturePad } from './signature-pad';

/** Gửi lại mã sau bấy nhiêu giây (khớp OTP_COOLDOWN của BE). */
const RESEND_SECONDS = 60;
type OnlineMethod = 'DRAWN' | 'TYPED';
interface SentOtp { sentTo: string; expiresAt: string; demoCode?: string }

/**
 * Bước ký hợp đồng (sau khi trả tiền giữ chân, trước khi nhận kho). CHỈ khách ký, trên tài khoản của chính họ —
 * server từ chối nhân viên/quản lý. Ký online cần mã OTP gửi qua email.
 */
export function ContractSignForm({ reservation: r }: { reservation: Reservation }) {
  const { db, run, busy } = useStore();
  const [method, setMethod] = useState<OnlineMethod>('DRAWN');
  const [name, setName] = useState(() => userName(db, r.customerId).replace('—', ''));
  const [image, setImage] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [sent, setSent] = useState<SentOtp | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);

  const ready = name.trim().length >= 2 && agree && (method === 'TYPED' || !!image);
  const valid = ready && !!sent && /^\d{6}$/.test(otp);

  const sendOtp = () => void run('requestSignOtp', { reservationId: r._id }, (v) => `Đã gửi mã tới ${v.sentTo}`, (v) => {
    setSent(v); setOtp(''); setOtpError('');
    setResendAt(Date.now() + RESEND_SECONDS * 1000); setNow(Date.now());
  });

  const sign = async () => {
    setOtpError('');
    const res = await run('signContract', { reservationId: r._id, signerName: name.trim(), method, image: method === 'DRAWN' ? image : null, otp }, 'Đã ký hợp đồng');
    // Sai / hết hạn / bị khoá: xoá ô nhập, hiện lỗi ngay dưới ô để khách nhập lại hoặc gửi mã mới.
    if (!res.ok) { setOtp(''); setOtpError(res.error); }
  };

  return (
    <div className="space-y-4">
      <ContractDocument reservation={r} />

      <div className="flex gap-1 rounded-lg bg-stone-100 p-1 text-sm">
        {([['DRAWN', 'Ký tay'], ['TYPED', 'Gõ họ tên']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMethod(k)} className={cx('flex-1 rounded-md px-3 py-1.5 font-medium', method === k ? 'bg-white shadow-sm' : 'text-stone-500 hover:text-stone-900')}>{label}</button>
        ))}
      </div>

      {method === 'DRAWN' && <SignaturePad onChange={setImage} />}
      <Field label={method === 'DRAWN' ? 'Họ tên người ký' : 'Gõ đầy đủ họ tên để ký'}>
        <input className={cx(inputCls, method === 'TYPED' && 'font-serif text-lg italic')} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <label className="flex cursor-pointer gap-2.5 text-sm leading-relaxed text-stone-700">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>Tôi đã đọc và đồng ý toàn bộ nội dung hợp đồng trên.</span>
      </label>

      {/* ---- mã xác nhận qua email */}
      <div className="rounded-lg bg-stone-50 p-4 ring-1 ring-inset ring-stone-200">
        {!sent ? (
          <Button variant="secondary" className="w-full" disabled={!ready || busy} onClick={sendOtp}><Mail className="size-4" />Gửi mã xác nhận</Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">Mã 6 số đã gửi tới <b>{sent.sentTo}</b>, hiệu lực đến {fmtDateTime(sent.expiresAt)}.</p>
            {sent.demoCode && <p className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">Mã thử nghiệm: <b className="font-mono tracking-widest">{sent.demoCode}</b></p>}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Mã xác nhận" error={otpError || undefined} className="w-40">
                <input className={cx(inputCls, 'text-center font-mono text-lg tracking-[0.4em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
                  value={otp} onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }} />
              </Field>
              <Button variant="ghost" size="sm" disabled={wait > 0 || busy} onClick={sendOtp}>{wait > 0 ? `Gửi lại sau ${wait}s` : 'Gửi lại mã'}</Button>
            </div>
          </div>
        )}
      </div>

      <Button className="w-full" disabled={!valid || busy} onClick={() => void sign()}>
        <FileSignature className="size-4" />Ký & xác nhận hợp đồng
      </Button>
    </div>
  );
}
