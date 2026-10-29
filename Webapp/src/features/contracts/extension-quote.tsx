'use client';

import { useCallback, useEffect, useState } from 'react';
import { extensionPaymentText, lastDayOf, PERIOD_UNIT, type ExtensionQuote } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { newKey } from '@/shared/api/actions';
import { fmtDate, vnd } from '@/shared/lib/format';

/**
 * Báo giá gia hạn lấy từ server mỗi khi khách đổi số kỳ — gia hạn là cam kết mới nên giá và ưu đãi tính lại, không dùng giá cũ.
 * `reload()`: tải lại khi server báo giá đã đổi (PRICE_CHANGED) lúc bấm gia hạn.
 * `idemKey`: khoá chống gửi trùng gắn với báo giá đang xem — bấm lại cùng báo giá thì server trả kết quả lần trước; báo giá mới thì khoá mới.
 */
export function useExtensionQuote(contractId: string | undefined, periods: number) {
  const [state, setState] = useState<{ key: string; quote: ExtensionQuote | null; error: string; idemKey: string }>({ key: '', quote: null, error: '', idemKey: '' });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const key = contractId ? `${contractId}:${periods}` : '';
  useEffect(() => {
    if (!contractId) return;
    let alive = true;
    api.get<ExtensionQuote>(`/contracts/${contractId}/extension-quote?periods=${periods}`)
      .then((quote) => alive && setState({ key: `${contractId}:${periods}`, quote, error: '', idemKey: newKey() }))
      .catch((e) => alive && setState({ key: `${contractId}:${periods}`, quote: null, error: e instanceof Error ? e.message : 'Không tính được giá gia hạn', idemKey: '' }));
    return () => { alive = false; };
  }, [contractId, periods, nonce]);
  return { ...(state.key === key ? state : { key, quote: null, error: '', idemKey: '' }), reload };
}

/** Nội dung một phụ lục (bản xem trước lúc gia hạn, hoặc bản đã xác nhận) — cùng cách trình bày với hợp đồng. */
export function AppendixText({ title, clauses }: { title: string; clauses: { title: string; paragraphs: string[]; bullets: string[] }[] }) {
  return (
    <div className="space-y-3 text-xs leading-relaxed text-stone-700">
      <p className="text-center text-sm font-semibold uppercase text-ink">{title}</p>
      {clauses.map((c) => (
        <div key={c.title}>
          <p className="font-semibold text-ink">{c.title}</p>
          {c.paragraphs.map((p, i) => <p key={i} className="mt-1">{p}</p>)}
          {c.bullets.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-4">{c.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}

export function ExtensionQuoteSummary({ quote, error, accepted, onAccept, graceDays }: { quote: ExtensionQuote | null; error: string; accepted: boolean; onAccept: (v: boolean) => void; graceDays?: number }) {
  if (error) return <p className="mt-3 text-sm text-red-700">{error}</p>;
  if (!quote) return <p className="mt-3 text-sm text-stone-500">Đang tính giá gia hạn…</p>;
  const unit = PERIOD_UNIT[quote.rentalPeriod];
  const monthly = quote.rentalPeriod === 'MONTH';
  return (
    <>
    <div className="mt-3 space-y-1.5 rounded-lg bg-stone-50 p-3 text-sm ring-1 ring-inset ring-stone-200">
      <p className="flex justify-between"><span className="text-stone-600">Kỳ gia hạn</span><b>{fmtDate(quote.from)} → hết ngày {fmtDate(lastDayOf(quote.newEndDate))}</b></p>
      <p className="flex justify-between"><span className="text-stone-600">Giá niêm yết hiện hành</span><span className="tabular-nums">{vnd(quote.gross)}/{unit}</span></p>
      <p className="flex justify-between"><span className="text-stone-600">Ưu đãi theo thời gian gia hạn</span><span className="tabular-nums">{quote.discountAmount > 0 ? `−${vnd(quote.discountAmount)}/${unit}` : 'không có'}</span></p>
      <p className="flex justify-between border-t border-stone-200 pt-1.5 font-semibold"><span>Tiền thuê trong kỳ gia hạn</span><span className="tabular-nums">{vnd(quote.rate)}/{unit}</span></p>
      {/* Thuê tháng: trả ngay tháng đầu của kỳ gia hạn, các tháng sau theo hoá đơn từng tháng; ngày / tuần: trả trọn ngay. */}
      {quote.payNow > 0 && <p className="rounded-md bg-amber-50 px-2.5 py-2 font-medium text-amber-950 ring-1 ring-inset ring-amber-200">{extensionPaymentText({ ...quote, gracePeriodDays: graceDays })}</p>}
      <p className="text-xs leading-relaxed text-stone-500">
        Ưu đãi tính theo số {unit} gia hạn, không cộng dồn thời gian đã thuê. Hiện bạn trả {vnd(quote.currentRate)}/{unit}.
        {monthly ? ' Tiền giữ chân giữ nguyên. Trả kho trước khi hết kỳ gia hạn thì bị thu hồi ưu đãi của kỳ này.' : ` Trả kho sớm không hoàn các ${unit} chưa dùng.`}
      </p>
    </div>
    {quote.appendix && (
      <>
        <p className="mt-4 text-sm font-semibold">Phụ lục hợp đồng bạn sẽ xác nhận</p>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg p-3 ring-1 ring-inset ring-stone-200"><AppendixText title={quote.appendix.title} clauses={quote.appendix.clauses} /></div>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={accepted} onChange={(e) => onAccept(e.target.checked)} />
          <span>Tôi đã đọc và đồng ý toàn bộ nội dung <b>{quote.appendix.title}</b>. Việc xác nhận này trên tài khoản của tôi có giá trị như chữ ký của tôi trên phụ lục.</span>
        </label>
      </>
    )}
    </>
  );
}
