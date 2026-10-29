'use client';

import { useState } from 'react';
import { CalendarCheck, CalendarClock, CreditCard, PenLine, QrCode, Search, Warehouse } from 'lucide-react';
import type { Reservation } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { dueAtBooking, dueAtCheckIn, fmtEndOfDay, fmtHoldUntil, periodLabel, signingPreferenceOf } from '@ssm/shared';
import { CANCELLATION_REASON, RESERVATION_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, EmptyState, PageHeader, StatusBadge, Tabs, cx } from '@/shared/ui';
import { CATEGORY_ICON } from '@/features/facilities/visuals';
import { BookingServices, bookingServicesDueOf } from '@/features/reservations/booking-services';
import { CustomerCancelDialog } from '@/features/reservations/customer-cancel-dialog';
import { RescheduleDialog, canReschedule } from '@/features/reservations/reschedule-dialog';

type Tab = 'upcoming' | 'past';
/** Còn phải ký online — khách đã chọn ký giấy tại quầy thì không nhắc ký ở đây. */
const needsOnlineSign = (r: Reservation) => !r.signature && signingPreferenceOf(r) !== 'PAPER_AT_COUNTER';

export default function MyReservations() {
  const { db, user } = useStore();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [cancel, setCancel] = useState<Reservation | null>(null);
  const [moving, setMoving] = useState<Reservation | null>(null);
  if (!user) return null;
  const mine = db.reservations.filter((r) => r.customerId === user._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = mine.filter((r) => ['PENDING', 'CONFIRMED', 'ALLOCATED'].includes(r.status));
  const rows = tab === 'upcoming' ? live : mine.filter((r) => !live.includes(r));

  return (
    <>
      <PageHeader title="Đặt chỗ của tôi" actions={<ButtonLink href="/facilities"><Search className="size-4" />Đặt chỗ mới</ButtonLink>} />
      <Tabs tabs={[{ key: 'upcoming', label: 'Sắp tới', count: live.length }, { key: 'past', label: 'Lịch sử', count: mine.length - live.length }]} value={tab} onChange={setTab} />
      {rows.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon={<CalendarCheck className="size-6" />} title="Không có đặt chỗ" action={tab === 'upcoming' ? <ButtonLink href="/facilities" size="sm">Tìm kho</ButtonLink> : undefined} />
        </Card>
      ) : (
        <ul className="mt-4 grid gap-4">
          {rows.map((r) => {
            const isLive = live.includes(r);
            const [dd, mm, yyyy] = fmtDate(r.startDate).split('/');
            // Tiền thuê kỳ đầu (nếu chưa trả lúc đặt) + dịch vụ kèm chờ thu.
            // Đợt 15 (C1): trả khi nhận kho chưa trả — tiền giữ chân cũng trả khi nhận kho (hôm nay 0 ₫).
            const codUnpaid = r.status === 'PENDING' && !!r.payOnArrival;
            const atCheckIn = dueAtCheckIn(r.quote) + bookingServicesDueOf(db, r._id) + (codUnpaid ? dueAtBooking(r.quote) : 0);
            const cat = byId(db.unitTypes, r.unitTypeId)?.category;
            const Icon = cat ? CATEGORY_ICON[cat] : Warehouse;
            return (
              <li key={r._id} className={cx('overflow-hidden rounded-2xl border border-stone-200 shadow-card', isLive ? 'bg-white' : 'bg-stone-50/70')}>
                <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
                  <span className={cx('grid w-14 shrink-0 place-items-center rounded-xl py-2 ring-1 ring-inset', isLive ? 'bg-sky-50 text-sky-800 ring-sky-100' : 'bg-stone-100 text-stone-500 ring-stone-200')} aria-label={`Ngày nhận ${fmtDate(r.startDate)}`}>
                    <span className="text-xl font-bold leading-none tabular-nums">{dd}</span>
                    <span className="mt-0.5 text-[10px] font-semibold uppercase">Th{Number(mm)}/{yyyy?.slice(2)}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="size-4 text-brand-700" />
                      <p className="font-semibold">{typeName(db, r.unitTypeId)}</p>
                      <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                      <span className="font-mono text-xs text-stone-400">{r.code}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-stone-500">{facilityName(db, r.facilityId)} · kho {unitLabel(db, r.unitId)} · {periodLabel(r.quote.rentalPeriod, r.periods)}</p>
                    {r.cancellation && <p className="mt-1 text-xs text-stone-500">{CANCELLATION_REASON[r.cancellation.reason]}</p>}
                    {r.status === 'PENDING' && r.payAtCounter && (r.payOnArrival
                      ? <p className="mt-1 text-xs text-teal-700">Trả khi nhận kho · hôm nay 0 ₫{r.holdExpiresAt ? ` · giữ ô đến hết ngày ${fmtEndOfDay(r.holdExpiresAt)}` : ''}</p>
                      : <p className="mt-1 text-xs text-violet-700">Trả tại quầy{r.holdExpiresAt ? ` · giữ đến ${fmtHoldUntil(r.holdExpiresAt)}` : ''}</p>)}
                    <BookingServices reservation={r} compact className="mt-2" />
                  </div>
                  <dl className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-64">
                    <div className="rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-inset ring-stone-200">
                      <dt className="text-[11px] text-stone-500">Trả khi đặt</dt>
                      <dd className="text-sm font-semibold tabular-nums">{vnd(codUnpaid ? 0 : dueAtBooking(r.quote))}</dd>
                    </div>
                    <div className={cx('rounded-xl px-3 py-2 ring-1 ring-inset', isLive && atCheckIn > 0 ? 'bg-amber-50 ring-amber-200' : 'bg-stone-50 ring-stone-200')}>
                      <dt className="text-[11px] text-stone-500">{codUnpaid ? 'Trả khi nhận kho' : 'Trả thêm khi nhận kho'}</dt>
                      <dd className={cx('text-sm font-semibold tabular-nums', isLive && atCheckIn > 0 ? 'text-amber-800' : 'text-stone-400')}>{isLive && atCheckIn > 0 ? vnd(atCheckIn) : isLive ? 'Không' : '—'}</dd>
                    </div>
                  </dl>
                </div>
                {isLive && (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 bg-stone-50/70 px-4 py-3 sm:px-5">
                    <Button size="sm" variant="ghost" onClick={() => setCancel(r)}>Hủy</Button>
                    {canReschedule(r) && <Button size="sm" variant="secondary" onClick={() => setMoving(r)}><CalendarClock className="size-3.5" />Đổi ngày</Button>}
                    <ButtonLink href={`/booking/${r._id}`} size="sm" variant={r.status === 'PENDING' || needsOnlineSign(r) ? 'primary' : 'secondary'}>
                      {r.status === 'PENDING' ? (r.payAtCounter ? 'Chi tiết' : <><CreditCard className="size-3.5" />Thanh toán</>) : needsOnlineSign(r) ? <><PenLine className="size-3.5" />Ký hợp đồng</> : <><QrCode className="size-3.5" />Mã QR</>}
                    </ButtonLink>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CustomerCancelDialog reservation={cancel} onClose={() => setCancel(null)} />
      {/* Lấy bản mới nhất trong store để số lần đổi / chữ ký luôn đúng sau khi tải lại. */}
      <RescheduleDialog reservation={moving ? db.reservations.find((x) => x._id === moving._id) ?? null : null} onClose={() => setMoving(null)} />
    </>
  );
}
