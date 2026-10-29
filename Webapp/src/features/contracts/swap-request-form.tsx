'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Ruler } from 'lucide-react';
import { ACCESS_METHOD, MONTH_ONLY_MESSAGE, PERIOD_UNIT, SWAP_METHOD, type RentalContract, type RentalPeriod, type SwapMethod, type UnitCategory } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { typeName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, Field, cx, inputCls } from '@/shared/ui';
import { FloorPlanPicker, type FloorPlanUnit } from '@/features/facilities/floor-plan-picker';
import { AppendixText } from '@/features/contracts/extension-quote';

/** Loại kho của chi nhánh trong bước chọn cỡ (GET /contracts/:id/swap-candidates → unitTypes). */
interface CandidateType { _id: string; name: string; category: UnitCategory; areaM2: number; current: boolean; available: number; allowed: boolean }
/** Báo giá đổi cỡ kho (GET /contracts/:id/resize-quote) — đợt 15, C3. */
export interface ResizeQuote {
  toUnitType: { _id: string; name: string; category: UnitCategory; areaM2: number };
  rentalPeriod: RentalPeriod; currentRate: number; gross: number; discountAmount: number; rate: number;
  currentDeposit: number; deposit: number; depositDiff: number;
  estimate: { from: string; rentDiff: number };
  servicesCancelled: boolean; acDropped: boolean;
  appendix: { number: number; title: string; clauses: { title: string; paragraphs: string[]; bullets: string[] }[] };
}

/** "+ thu thêm X" / "− hoàn X" / "không đổi" — phần chênh tiền thuê, tiền giữ chân. */
const diffText = (n: number, more: string, back: string) => (n > 0 ? `${more} ${vnd(n)}` : n < 0 ? `${back} ${vnd(-n)}` : 'không đổi');

/**
 * Gửi yêu cầu đổi ô — cùng loại (giá giữ nguyên) hoặc ĐỔI CỠ KHO sang loại khác cùng chi nhánh (đợt 15, C3): khách thấy loại cũ → mới,
 * giá thuê mới (cùng bậc ưu đãi), phần chênh kỳ đã trả tính theo ngày, tiền giữ chân mới và nộp thêm / được hoàn, rồi đọc + xác nhận
 * Phụ lục "Đổi cỡ kho" trước khi gửi. Giá chốt theo báo giá đã xem (server từ chối nếu đã đổi — PRICE_CHANGED → tải lại).
 */
export function SwapRequestForm({ c, onDone }: { c: RentalContract; onDone: () => void }) {
  const { db, run } = useStore();
  const [types, setTypes] = useState<CandidateType[]>([]);
  const [typeId, setTypeId] = useState(c.unitTypeId);
  const [units, setUnits] = useState<FloorPlanUnit[] | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [method, setMethod] = useState<SwapMethod>('SELF');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<ResizeQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [agree, setAgree] = useState(false);
  const [nonce, setNonce] = useState(0);
  const resize = typeId !== c.unitTypeId;

  // Ô trống của loại đang chọn (+ danh sách loại kho của chi nhánh ở lần tải đầu).
  useEffect(() => {
    let alive = true;
    setUnits(null); setUnitId(null);
    api.get<{ items: FloorPlanUnit[]; unitTypes?: CandidateType[] }>(`/contracts/${c._id}/swap-candidates${typeId !== c.unitTypeId ? `?unitTypeId=${typeId}` : ''}`)
      .then((d) => { if (!alive) return; setUnits(d.items); if (d.unitTypes?.length) setTypes(d.unitTypes); })
      .catch(() => alive && setUnits([]));
    return () => { alive = false; };
  }, [c._id, c.unitTypeId, typeId]);

  // Báo giá đổi cỡ: tải lại khi đổi loại / chọn ô (phụ lục in số ô) / server báo giá đã đổi. Đổi báo giá thì phải xác nhận lại phụ lục.
  useEffect(() => {
    setAgree(false); setQuote(null); setQuoteErr('');
    if (!resize) return;
    let alive = true;
    api.get<ResizeQuote>(`/contracts/${c._id}/resize-quote?unitTypeId=${typeId}${unitId ? `&toUnitId=${unitId}` : ''}`)
      .then((q) => alive && setQuote(q))
      .catch((e) => alive && setQuoteErr(e instanceof Error ? e.message : 'Không tính được giá đổi cỡ kho'));
    return () => { alive = false; };
  }, [c._id, typeId, unitId, resize, nonce]);

  const unit = PERIOD_UNIT[c.billing.rentalPeriod];
  const lock = units?.find((u) => u._id === unitId)?.accessMethod;
  const ready = !!unitId && reason.trim().length >= 5 && (!resize || (!!quote && agree));
  const submit = () => unitId && void run(
    'requestUnitSwap',
    { contractId: c._id, toUnitId: unitId, method, reason: reason.trim(), ...(resize && quote ? { acceptAppendix: agree, expected: { rate: quote.rate, deposit: quote.deposit } } : {}) },
    (r) => `Đã gửi yêu cầu ${r.requestNumber} — chờ chi nhánh xét duyệt`, onDone,
  ).then((r) => { if (!r.ok && r.code === 'PRICE_CHANGED') setNonce((n) => n + 1); });

  return (
    <div className="space-y-4">
      {types.length > 1 && (
        <Field label="Cỡ kho" hint="Giữ cỡ hiện tại để đổi sang ô khác cùng loại (giá giữ nguyên), hoặc chọn kho lớn hơn / nhỏ hơn — đổi cỡ không phải làm hợp đồng mới.">
          <div className="grid gap-2 sm:grid-cols-2">
            {types.map((t) => {
              const off = !t.current && (!t.allowed || t.available === 0);
              return (
                <button key={t._id} type="button" disabled={off} onClick={() => setTypeId(t._id)} title={!t.allowed ? MONTH_ONLY_MESSAGE : undefined}
                  className={cx('rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset', typeId === t._id ? 'bg-ink text-white ring-ink' : off ? 'cursor-not-allowed text-stone-400 ring-stone-200' : 'ring-stone-300 hover:bg-stone-50')}>
                  <span className="font-medium">{t.current ? `Giữ cỡ hiện tại · ${t.name}` : t.name}</span>
                  <span className={cx('block text-xs', typeId === t._id ? 'text-white/80' : 'text-stone-500')}>
                    <Ruler className="mr-1 inline size-3" />{t.areaM2} m² · {!t.allowed ? 'chỉ thuê theo tháng' : `còn ${t.available} ô trống`}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {resize && (
        <div className="space-y-2 rounded-xl bg-violet-50 p-3.5 text-sm ring-1 ring-inset ring-violet-200">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-violet-950">Đổi cỡ kho: {typeName(db, c.unitTypeId)} <ArrowRight className="size-4" /> {typeName(db, typeId)}</p>
          {quoteErr ? <p className="text-red-700">{quoteErr}</p> : !quote ? <p className="text-stone-500">Đang tính giá đổi cỡ…</p> : (
            <>
              <dl className="space-y-1">
                <div className="flex justify-between gap-3"><dt className="text-stone-600">Tiền thuê</dt><dd className="text-right tabular-nums">{vnd(quote.currentRate)} → <b>{vnd(quote.rate)}/{unit}</b>{quote.discountAmount > 0 && <span className="block text-xs text-stone-500">giá niêm yết {vnd(quote.gross)} − ưu đãi {vnd(quote.discountAmount)} (cùng bậc ưu đãi)</span>}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-stone-600">Phần chênh kỳ đã trả (theo ngày)</dt><dd className="text-right tabular-nums font-medium">{diffText(quote.estimate.rentDiff, 'thu thêm', 'hoàn')}<span className="block text-xs font-normal text-stone-500">ước tính nếu đổi ngày {fmtDate(quote.estimate.from)} — tính lại theo ngày chuyển xong</span></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-stone-600">Tiền giữ chân</dt><dd className="text-right tabular-nums">{vnd(quote.currentDeposit)} → <b>{vnd(quote.deposit)}</b><span className="block text-xs text-stone-500">{diffText(quote.depositDiff, 'nộp thêm', 'được hoàn')}</span></dd></div>
              </dl>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-violet-950">
                <li>Đổi cỡ là sửa đổi hợp đồng, không phải chấm dứt: thời hạn, kỳ cam kết, đồ đang gửi giữ nguyên; không bị giới hạn mức hoàn hay thu lại ưu đãi vì việc đổi cỡ.</li>
                <li>Khoản thu thêm cộng vào công nợ khi đổi xong; khoản hoàn trả theo cách bạn đã thanh toán.</li>
                {quote.servicesCancelled && <li>Kho mới không có dịch vụ thêm — đơn dịch vụ chưa làm sẽ được huỷ và hoàn tiền.</li>}
                {quote.acDropped && <li>Kho mới không có điều hòa — thôi tính phụ phí điều hòa.</li>}
              </ul>
            </>
          )}
        </div>
      )}

      <Field label={resize ? 'Chọn ô mới (loại mới) trên sơ đồ' : 'Chọn ô mới trên sơ đồ'}>
        {units === null ? <p className="text-sm text-stone-500">Đang tải sơ đồ…</p> : <FloorPlanPicker items={units} value={unitId} onChange={setUnitId} />}
        {/* Hình thức khoá thuộc về từng ô: chọn ô khác khoá thì báo trước để khách không bất ngờ. */}
        {lock && lock !== c.access.method && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
            Ô này khoá bằng <b>{ACCESS_METHOD[lock]}</b>, khác ô bạn đang thuê ({ACCESS_METHOD[c.access.method]}). Khi đổi xong, {ACCESS_METHOD[c.access.method].toLowerCase()} cũ hết hiệu lực và chi nhánh cấp {ACCESS_METHOD[lock].toLowerCase()} mới cho bạn.
          </p>
        )}
      </Field>
      <Field label="Hình thức chuyển">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SWAP_METHOD) as SwapMethod[]).map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={cx('rounded-lg py-2 text-sm font-medium ring-1 ring-inset', method === m ? 'bg-ink text-white ring-ink' : 'ring-stone-300 hover:bg-stone-50')}>{SWAP_METHOD[m]}</button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-stone-500">{method === 'SELF' ? 'Sau khi được duyệt, bạn có 7 ngày để tự chuyển đồ sang ô mới.' : 'Chi nhánh sẽ liên hệ hẹn ngày cử người chuyển giúp bạn.'}</p>
      </Field>
      <Field label={resize ? 'Lý do muốn đổi cỡ kho' : 'Lý do muốn đổi ô'} hint="Tối thiểu 5 ký tự.">
        <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={resize ? 'VD: Cần kho rộng hơn để chứa thêm đồ.' : 'VD: Muốn đổi sang ô gần cửa ra vào hơn để dễ chở đồ.'} />
      </Field>
      {resize && quote && (
        <div>
          <p className="text-sm font-semibold">Phụ lục hợp đồng bạn sẽ xác nhận</p>
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg p-3 ring-1 ring-inset ring-stone-200"><AppendixText title={quote.appendix.title} clauses={quote.appendix.clauses} /></div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>Tôi đã đọc và đồng ý toàn bộ nội dung <b>{quote.appendix.title}</b> (có hiệu lực khi chi nhánh xác nhận tôi đã chuyển xong). Việc xác nhận này trên tài khoản của tôi có giá trị như chữ ký của tôi trên phụ lục.</span>
          </label>
        </div>
      )}
      <p className="text-xs text-stone-500">Phí đổi ô (nếu có) báo khi duyệt — miễn phí lần đổi đầu tiên hoặc do lỗi chi nhánh.</p>
      <div className="flex justify-end"><Button disabled={!ready} onClick={submit}>{resize ? 'Xác nhận phụ lục & gửi yêu cầu' : 'Gửi yêu cầu'}</Button></div>
    </div>
  );
}
