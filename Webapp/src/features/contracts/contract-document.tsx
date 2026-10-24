'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ContractClause, ContractSignature, Reservation } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { fmtDateTime } from '@/shared/lib/format';

interface ContractView { clauses: ContractClause[]; templateVersion: number; signed: boolean; contractNumber: string | null }

/**
 * Bản hợp đồng thuê kho dựng từ đặt chỗ + chính sách đã chốt lúc đặt. Hợp đồng chính thức (có số)
 * chỉ phát sinh khi nhận kho, nhưng nội dung ràng buộc là đúng bản này — khách ký xác nhận ở đây.
 * Nội dung do SERVER dựng (GET /reservations/:id/contract) từ mẫu hợp đồng đang áp dụng — cùng nguồn với mobile và PDF;
 * hợp đồng đã ký trả đúng nguyên văn lúc ký.
 */
export function ContractDocument({ reservation: r }: { reservation: Reservation }) {
  const [view, setView] = useState<ContractView | null>(null);
  const [error, setError] = useState('');
  const signedAt = r.signature?.signedAt ?? '';
  useEffect(() => {
    let alive = true;
    setView(null); setError('');
    api.get<ContractView>(`/reservations/${r._id}/contract`).then((v) => alive && setView(v)).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [r._id, signedAt, r.depositPaymentId]);

  return (
    <article className="max-h-96 space-y-4 overflow-y-auto rounded-lg bg-stone-50 p-5 text-sm leading-relaxed text-stone-700 ring-1 ring-inset ring-stone-200">
      <header className="text-center">
        <h3 className="text-base font-bold uppercase tracking-wide text-ink">Hợp đồng thuê kho</h3>
        <p className="text-xs text-stone-500">Mã đặt chỗ {r.code} · {view?.contractNumber ? `số hợp đồng ${view.contractNumber}` : 'số hợp đồng được cấp khi nhận kho'}</p>
      </header>
      {error && <p className="text-red-700">Không tải được nội dung hợp đồng: {error}</p>}
      {!view && !error && <p className="text-stone-500">Đang tải nội dung hợp đồng…</p>}
      {view?.clauses.map((c, i) => (
        <section key={`${i}-${c.title}`}>
          <h4 className="font-semibold text-ink">{c.title}</h4>
          {c.paragraphs.map((p, k) => <p key={k}>{p}</p>)}
          {c.bullets.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{c.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>}
        </section>
      ))}
      <p><Link href="/dieu-khoan" target="_blank" className="font-medium text-brand-700 hover:underline">Xem Điều khoản thuê kho đầy đủ</Link></p>
    </article>
  );
}

const SIGN_METHOD: Record<string, string> = { DRAWN: 'ký tay', TYPED: 'ký bằng họ tên', PAPER: 'Ký giấy tại quầy' };

/** Dòng tóm tắt người ký / thời điểm ký, kèm ảnh chữ ký vẽ tay nếu có. */
export function SignatureInfo({ signature: s }: { signature: ContractSignature }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
      {s.image && <img src={s.image} alt="Chữ ký" className="h-14 rounded bg-white px-2 ring-1 ring-emerald-200" />}
      <div>
        <p className="font-semibold">Đã ký hợp đồng — {s.signerName}</p>
        <p className="text-xs">{fmtDateTime(s.signedAt)} · {SIGN_METHOD[s.method] ?? s.method}{s.onBehalf && s.method !== 'PAPER' ? ' · nhân viên thao tác tại quầy' : ''}</p>
      </div>
    </div>
  );
}
