'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, PackageSearch, Ruler } from 'lucide-react';
import { ACCESS_METHOD, inventoryOf, MONTH_ONLY_MESSAGE, openIntakeOf, PERIOD_UNIT, SWAP_LIABILITY, SWAP_METHOD, SWAP_NO_GOODS_TEXT, swapBlockedByIntakeText, swapMovableGoods, type RentalContract, type RentalPeriod, type SwapMethod, type UnitCategory } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { contractIntakeBatches, typeName } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { allPicks, GoodsPicker, SizeChangeMoney, type GoodsPicks } from '@/features/contracts/swap-extras';
import { Button, Field, cx, inputCls } from '@/shared/ui';
import { Callout } from '@/features/staff-ui';
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
  // Góp ý 17/11: thuê người chuyển — đồ đang gửi (món của đợt nhập đã xác nhận còn trong kho, kiện gửi kín); khách chọn món / số lượng, mặc định tất cả.
  const goods = swapMovableGoods(inventoryOf(contractIntakeBatches(db, c._id)).items);
  const [picks, setPicks] = useState<GoodsPicks>(() => allPicks(goods));
  const chosenItems = goods.filter((g) => picks[g.itemId]).map((g) => ({ itemId: g.itemId, quantity: Math.min(picks[g.itemId], g.inStorage) }));
  const deliveryOff = goods.length === 0;

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
  const pendingIntake = openIntakeOf(db.intakeBatches, c._id);
  const ready = !pendingIntake && !!unitId && reason.trim().length >= 5 && (!resize || (!!quote && agree)) && (method === 'SELF' || (!deliveryOff && chosenItems.length > 0));
  const submit = () => unitId && void run(
    'requestUnitSwap',
    { contractId: c._id, toUnitId: unitId, method, reason: reason.trim(), ...(resize && quote ? { acceptAppendix: agree, expected: { rate: quote.rate, deposit: quote.deposit } } : {}),
      ...(method === 'DELIVERY' ? { items: chosenItems } : {}) },
    (r) => `Đã gửi yêu cầu ${r.requestNumber} — chờ chi nhánh xét duyệt`, onDone,
  ).then((r) => { if (!r.ok && r.code === 'PRICE_CHANGED') setNonce((n) => n + 1); });

  return (
    <div className="space-y-4">
      {pendingIntake && <Callout tone="amber" icon={<PackageSearch />} title={swapBlockedByIntakeText(pendingIntake.code)} />}
      {types.length > 1 && (
        <Field label="Cỡ kho" tip="Giữ cỡ để đổi ô cùng loại (giá giữ nguyên), hoặc chọn cỡ khác — không phải làm hợp đồng mới.">
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
              {/* Góp ý 17/11: từng khoản — tiền thuê cũ → mới, chênh tiền giữ chân, chênh tiền thuê kỳ đã trả, tổng phải trả thêm / được hoàn. */}
              <SizeChangeMoney x={quote} />
              {quote.discountAmount > 0 && <p className="text-xs text-stone-500">Giá mới = giá niêm yết {vnd(quote.gross)} − ưu đãi {vnd(quote.discountAmount)}/{unit} (cùng bậc ưu đãi).</p>}
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-violet-950">
                <li>Đổi cỡ là sửa hợp đồng, không phải chấm dứt: thời hạn, kỳ cam kết, đồ đang gửi giữ nguyên, không tính như trả kho sớm.</li>
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
            Ô này khoá bằng <b>{ACCESS_METHOD[lock]}</b> (ô hiện tại: {ACCESS_METHOD[c.access.method]}). Đổi xong, chi nhánh cấp {ACCESS_METHOD[lock].toLowerCase()} mới cho bạn.
          </p>
        )}
      </Field>
      <Field label="Hình thức chuyển" tip={method === 'SELF' ? 'Sau khi được duyệt, bạn có 7 ngày để tự chuyển đồ sang ô mới.' : 'Chi nhánh hẹn ngày cử người chuyển giúp. Có phí thì trả sau khi duyệt, trước ngày chuyển.'}>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SWAP_METHOD) as SwapMethod[]).map((m) => {
            const off = m === 'DELIVERY' && deliveryOff;
            return (
              <button key={m} type="button" disabled={off} title={off ? SWAP_NO_GOODS_TEXT : undefined} onClick={() => setMethod(m)}
                className={cx('rounded-lg py-2 text-sm font-medium ring-1 ring-inset', method === m ? 'bg-ink text-white ring-ink' : off ? 'cursor-not-allowed text-stone-400 ring-stone-200' : 'ring-stone-300 hover:bg-stone-50')}>{SWAP_METHOD[m]}</button>
            );
          })}
        </div>
        {/* Góp ý 17/11: kho chưa có đồ đã nhập thì không có gì để chi nhánh chuyển — server cũng chặn 422 SWAP_NO_STORED_GOODS. */}
        {deliveryOff && <p className="mt-1.5 text-xs font-medium text-amber-800">{SWAP_METHOD.DELIVERY} chưa dùng được: {SWAP_NO_GOODS_TEXT}.</p>}
        <p className="mt-1.5 text-xs font-medium text-stone-700">{SWAP_LIABILITY[method]}</p>
      </Field>
      {method === 'DELIVERY' && !deliveryOff && <GoodsPicker goods={goods} picks={picks} onChange={setPicks} />}
      <Field label={resize ? 'Lý do muốn đổi cỡ kho' : 'Lý do muốn đổi ô'} tip="Tối thiểu 5 ký tự.">
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
      {/* Đợt 16 (B1): đổi ô luôn cấp phương tiện mở mới cho ô mới như lúc nhận kho. */}
      <p className="text-xs text-stone-500">Chuyển xong, bạn nhận mật khẩu hoặc chìa / thẻ mới của ô mới và trả lại chìa / thẻ ô cũ.</p>
      <div className="flex justify-end"><Button disabled={!ready} onClick={submit}>{resize ? 'Xác nhận phụ lục & gửi yêu cầu' : 'Gửi yêu cầu'}</Button></div>
    </div>
  );
}
