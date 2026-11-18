'use client';

import { useState } from 'react';
import { CalendarClock, CalendarDays, Check, Minus, PackageCheck, Plus, X } from 'lucide-react';
import {
  fmtDate, sizeChangeMoneyLines, SWAP_CUSTOMER_RESCHEDULE_MAX, SWAP_METHOD, SWAP_DELIVERY_CLAIM_DAYS, SWAP_SELF_MOVE_DAYS, swapCustomerReschedulesLeft, swapMoveItemLabel,
  swapMoveItemsCount, swapRescheduleCheck, swapRescheduleWindow, todayISO, type SizeChangeMoneyInput, type SwapGoodsLine, type SwapMoveItem, type UnitSwapRequest, SWAP_UNMOVED_REASON, type SwapUnmovedReason,
} from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { unitLabel } from '@/shared/lib/domain';
import { Button, Field, Modal, cx, inputCls } from '@/shared/ui';
import { PhotoLinks } from '@/shared/ui/photo-links';

/**
 * Góp ý 17/11 — các mảnh dùng chung cho đổi ô / đổi cỡ kho trên web: bảng tiền đổi cỡ (khách, quản lý), chọn đồ cần chuyển (khách), danh sách
 * đồ trong biên bản chuyển đồ, lịch sử dời ngày chuyển, nút khách đổi ngày chuyển.
 */

/** Tiền khi đổi cỡ kho, từng khoản (sizeChangeMoneyLines — cùng nguồn với app và email duyệt). `done`: số thật lúc đã đổi xong. */
export function SizeChangeMoney({ x, done = false, className }: { x: SizeChangeMoneyInput; done?: boolean; className?: string }) {
  return (
    <dl className={cx('space-y-1.5 text-sm', className)}>
      {sizeChangeMoneyLines(x, done).map((l) => (
        <div key={l.label} className={cx('flex justify-between gap-3', l.total && 'mt-1 border-t border-stone-200 pt-2')}>
          <dt className={l.total ? 'font-semibold text-ink' : 'text-stone-600'}>{l.label}</dt>
          <dd className="text-right tabular-nums">
            <span className={l.total ? 'text-base font-bold text-ink' : 'font-medium'}>{l.value}</span>
            {l.note && <span className="block text-xs font-normal text-stone-500">{l.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Lựa chọn đồ cần chuyển của khách: itemId → số lượng (không có = không chuyển). */
export type GoodsPicks = Record<string, number>;
export const allPicks = (goods: readonly SwapGoodsLine[]): GoodsPicks => Object.fromEntries(goods.map((g) => [g.itemId, g.inStorage]));

/** Khách chọn món / số lượng cần chi nhánh chuyển (mặc định tất cả). */
export function GoodsPicker({ goods, picks, onChange }: { goods: readonly SwapGoodsLine[]; picks: GoodsPicks; onChange: (p: GoodsPicks) => void }) {
  const set = (id: string, n: number | null) => {
    const next = { ...picks };
    if (n === null) delete next[id]; else next[id] = n;
    onChange(next);
  };
  const chosen = goods.filter((g) => picks[g.itemId]);
  const all = chosen.length === goods.length && goods.every((g) => picks[g.itemId] === g.inStorage);
  return (
    <div className="rounded-xl p-3 ring-1 ring-inset ring-stone-200">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Đồ cần chuyển <span className="font-normal text-stone-500">· {swapMoveItemsCount(chosen.map((g) => ({ quantity: picks[g.itemId] })))} món / kiện</span></p>
        <Button size="sm" variant="ghost" onClick={() => onChange(all ? {} : allPicks(goods))}>{all ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</Button>
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {goods.map((g) => {
          const n = picks[g.itemId] ?? 0;
          return (
            <li key={g.itemId} className={cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ring-1 ring-inset', n ? 'bg-brand-50 ring-brand-200' : 'ring-stone-200')}>
              <input type="checkbox" className="size-4 shrink-0 accent-brand-700" checked={n > 0} aria-label={`Chuyển ${g.name}`}
                onChange={(e) => set(g.itemId, e.target.checked ? g.inStorage : null)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{g.name}{g.sealed ? ' (gửi kín)' : ''}</span>
                <span className="block text-xs text-stone-500">Đợt {g.batchCode} · đang gửi {g.inStorage}</span>
              </span>
              {!g.sealed && g.inStorage > 1 && n > 0 && (
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label="Bớt một" disabled={n <= 1} onClick={() => set(g.itemId, n - 1)} className="grid size-7 place-items-center rounded-md ring-1 ring-inset ring-stone-300 disabled:opacity-40"><Minus className="size-3.5" /></button>
                  <span className="w-8 text-center tabular-nums">{n}</span>
                  <button type="button" aria-label="Thêm một" disabled={n >= g.inStorage} onClick={() => set(g.itemId, n + 1)} className="grid size-7 place-items-center rounded-md ring-1 ring-inset ring-stone-300 disabled:opacity-40"><Plus className="size-3.5" /></button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!chosen.length && <p className="mt-2 text-xs font-medium text-red-700">Chọn ít nhất một món cần chuyển.</p>}
    </div>
  );
}

/**
 * Danh sách đồ cần chuyển / đã chuyển (biên bản). Đã hoàn tất: dấu ✓ món đã chuyển, ✗ món chưa chuyển kèm lý do (`reason` = moveCheck.unmovedReason;
 * yêu cầu cũ không có lý do thì xem ghi chú của biên bản).
 */
export function MoveItemsList({ items, reason, className }: { items: readonly SwapMoveItem[]; reason?: SwapUnmovedReason | null; className?: string }) {
  const recorded = items.some((it) => it.moved != null);
  return (
    <ul className={cx('space-y-0.5 text-sm', className)}>
      {items.map((it) => (
        <li key={it.itemId} className="flex items-start gap-2">
          {recorded
            ? it.moved ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Đã chuyển" /> : <X className="mt-0.5 size-4 shrink-0 text-red-600" aria-label="Chưa chuyển" />
            : <span className="mt-2 size-1.5 shrink-0 rounded-full bg-stone-400" aria-hidden />}
          <span className="min-w-0">
            <span className={cx(recorded && !it.moved && 'text-stone-500 line-through')}>{swapMoveItemLabel(it)} <span className="text-xs text-stone-500">· đợt {it.batchCode}</span></span>
            {recorded && !it.moved && reason && <span className="ml-1 text-xs font-medium text-amber-700">· {SWAP_UNMOVED_REASON[reason]}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Lịch sử dời ngày chuyển (quản lý dời / khách tự đổi). `mine`: màn của khách — "Bạn đổi" thay cho "Khách đổi". */
export function ScheduleHistory({ s, className, mine = false }: { s: Pick<UnitSwapRequest, 'scheduleChanges'>; className?: string; mine?: boolean }) {
  const list = s.scheduleChanges ?? [];
  if (!list.length) return null;
  return (
    <ul className={cx('space-y-0.5 text-xs text-stone-600', className)}>
      {list.map((x, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0 text-stone-400" aria-hidden />
          <span>{x.byRole === 'CUSTOMER' ? (mine ? 'Bạn đổi' : 'Khách đổi') : 'Chi nhánh dời'} ngày chuyển {x.from ? fmtDate(x.from) : '—'} → <b className="font-medium text-ink">{fmtDate(x.to)}</b> · {fmtDate(x.at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Khách đổi ngày chi nhánh chuyển đồ (DELIVERY đã duyệt) trong khung swapRescheduleCheck. Không còn lượt / không hợp lệ → không hiện nút. */
export function SwapChangeDate({ s }: { s: UnitSwapRequest }) {
  const { run } = useStore();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState('');
  const today = todayISO();
  const win = swapRescheduleWindow(today);
  const left = swapCustomerReschedulesLeft(s);
  if (s.method !== 'DELIVERY' || s.status !== 'APPROVED' || left <= 0) return null;
  const check = day ? swapRescheduleCheck(s, `${day}T00:00:00.000Z`, today) : null;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setDay(''); setOpen(true); }}><CalendarDays className="size-3.5" />Đổi ngày chuyển</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Đổi ngày chi nhánh chuyển đồ"
        description={`Hiện hẹn ngày ${fmtDate(s.scheduledFor)} · còn đổi được ${left}/${SWAP_CUSTOMER_RESCHEDULE_MAX} lần`}
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>Đóng</Button>
          <Button disabled={!check?.ok} onClick={() => void run('rescheduleSwapDelivery', { swapRequestId: s._id, scheduledFor: `${day}T00:00:00.000Z` },
            (v) => `Đã đổi ngày chuyển sang ${fmtDate(v.scheduledFor)} — chi nhánh được báo qua email`, () => setOpen(false))}>Lưu ngày mới</Button>
        </>}>
        <Field label="Ngày chuyển mới" tip={`Từ ngày mai đến tối đa ${SWAP_SELF_MOVE_DAYS} ngày kể từ hôm nay. Phí, ô mới và đồ cần chuyển giữ nguyên.`}
          error={check && !check.ok ? check.message : undefined}>
          <input type="date" className={inputCls} min={win.min.slice(0, 10)} max={win.max.slice(0, 10)} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

/**
 * Chi tiết thêm của yêu cầu đổi ô đang mở (trang Kho đang thuê): ô mới + hình thức, từng khoản tiền đổi cỡ (mở rộng), đồ chi nhánh chuyển,
 * lịch sử dời ngày chuyển. Nút khách đổi ngày chuyển nằm ở SwapChangeDate.
 */
export function OpenSwapExtras({ s }: { s: UnitSwapRequest }) {
  const { db } = useStore();
  return (
    <>
      <span className="mt-0.5 block text-xs text-violet-900">Sang ô {unitLabel(db, s.toUnitId)} · {SWAP_METHOD[s.method]}</span>
      {s.sizeChange && (
        <details className="mt-1 text-xs text-violet-900" open>
          <summary className="cursor-pointer font-medium">Tiền khi đổi cỡ kho — từng khoản</summary>
          <SizeChangeMoney x={s.sizeChange} className="mt-1.5 rounded-lg bg-white/80 p-2.5 text-xs" />
        </details>
      )}
      {!!s.moveItems?.length && (
        <details className="mt-1 text-xs text-violet-900">
          <summary className="cursor-pointer font-medium">Đồ chi nhánh chuyển · {swapMoveItemsCount(s.moveItems)} món / kiện</summary>
          <MoveItemsList items={s.moveItems} reason={s.moveCheck?.unmovedReason} className="mt-1.5 text-xs" />
        </details>
      )}
      <ScheduleHistory s={s} className="mt-1" mine />
    </>
  );
}

/**
 * Biên bản chuyển đồ lần chi nhánh chuyển gần nhất (DELIVERY đã xong) trong SWAP_DELIVERY_CLAIM_DAYS ngày — khách xem số kiện, ảnh, ghi chú và
 * danh sách đồ đã / chưa chuyển (như màn đổi ô của app).
 */
export function SwapMoveRecord({ contractId }: { contractId: string }) {
  const { db } = useStore();
  const since = new Date(Date.now() - SWAP_DELIVERY_CLAIM_DAYS * 86_400_000).toISOString();
  const s = db.swapRequests
    .filter((x) => x.contractId === contractId && x.status === 'DONE' && x.method === 'DELIVERY' && x.moveCheck && (x.completedAt ?? '') >= since)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
  if (!s?.moveCheck) return null;
  return (
    <div className="rounded-xl bg-sky-50 px-3.5 py-3 text-sm text-sky-950 ring-1 ring-inset ring-sky-200">
      <p className="flex items-center gap-2 font-semibold"><PackageCheck className="size-4 shrink-0" />Biên bản chuyển đồ {s.requestNumber} · {fmtDate(s.completedAt)}</p>
      <p className="mt-0.5 text-xs">Chi nhánh chuyển {s.moveCheck.packages} kiện / món sang ô mới{s.moveCheck.note ? ` · Ghi chú: ${s.moveCheck.note}` : ''}</p>
      {!!s.moveItems?.length && <MoveItemsList items={s.moveItems} reason={s.moveCheck.unmovedReason} className="mt-2" />}
      {s.moveCheck.unmovedReason === 'NOT_YET' && <p className="mt-1 text-xs">Chi nhánh sẽ chuyển nốt các món chưa chuyển sang ô mới.</p>}
      {s.moveCheck.unmovedReason === 'NOT_FOUND' && <p className="mt-1 text-xs">Chi nhánh đang tìm các món chưa thấy — không tìm thấy thì chi nhánh báo bạn và xử lý bồi thường.</p>}
      <div className="mt-2"><PhotoLinks urls={s.moveCheck.photoUrls} /></div>
      <p className="mt-2 text-xs">Thấy hư hại / thiếu đồ do việc chuyển, gửi yêu cầu bồi thường trong {SWAP_DELIVERY_CLAIM_DAYS} ngày — chi nhánh đối chiếu biên bản này.</p>
    </div>
  );
}
