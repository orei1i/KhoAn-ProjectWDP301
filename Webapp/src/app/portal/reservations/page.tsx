'use client';

import { useState } from 'react';
import type { Reservation } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { dueAtBooking, dueAtCheckIn, periodLabel, signingPreferenceOf } from '@ssm/shared';
import { CANCELLATION_REASON, RESERVATION_STATUS } from '@/shared/lib/labels';
import { facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, EmptyState, PageHeader, StatusBadge, Table, Tabs } from '@/shared/ui';
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
      <PageHeader title="Đặt chỗ của tôi" actions={<ButtonLink href="/facilities">Đặt chỗ mới</ButtonLink>} />
      <Tabs tabs={[{ key: 'upcoming', label: 'Sắp tới', count: live.length }, { key: 'past', label: 'Lịch sử', count: mine.length - live.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={rows} rowKey={(r) => r._id} empty={<EmptyState title="Không có đặt chỗ" />} columns={[
          { key: 'code', header: 'Mã', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: 'what', header: 'Kho', cell: (r) => <div><p className="font-medium">{typeName(db, r.unitTypeId)}</p><p className="text-xs text-stone-500">{facilityName(db, r.facilityId)} · {unitLabel(db, r.unitId)}</p><BookingServices reservation={r} compact className="mt-1.5" /></div> },
          { key: 'date', header: 'Ngày nhận', cell: (r) => <div><p>{fmtDate(r.startDate)}</p><p className="text-xs text-stone-500">{periodLabel(r.quote.rentalPeriod, r.periods)}</p></div> },
          { key: 'deposit', header: 'Trả khi đặt', cell: (r) => vnd(dueAtBooking(r.quote)), className: 'tabular-nums' },
          // Tiền thuê kỳ đầu (nếu chưa trả lúc đặt) + dịch vụ kèm chờ thu.
          { key: 'atCheckIn', header: 'Trả thêm khi nhận kho', cell: (r) => { const due = dueAtCheckIn(r.quote) + bookingServicesDueOf(db, r._id); return live.includes(r) && due > 0 ? <span className="font-medium text-amber-800">{vnd(due)}</span> : <span className="text-stone-400">{live.includes(r) ? 'Không' : '—'}</span>; }, className: 'tabular-nums' },
          { key: 'status', header: 'Trạng thái', cell: (r) => <div><StatusBadge map={RESERVATION_STATUS} value={r.status} />{r.cancellation && <p className="mt-1 text-xs text-stone-500">{CANCELLATION_REASON[r.cancellation.reason]}</p>}</div> },
          { key: 'act', header: '', className: 'text-right', cell: (r) => (
            <div className="flex justify-end gap-2">
              {live.includes(r) && <ButtonLink href={`/booking/${r._id}`} size="sm" variant={r.status === 'PENDING' || needsOnlineSign(r) ? 'primary' : 'secondary'}>{r.status === 'PENDING' ? 'Thanh toán' : needsOnlineSign(r) ? 'Ký hợp đồng' : 'Mã QR'}</ButtonLink>}
              {live.includes(r) && canReschedule(r) && <Button size="sm" variant="ghost" onClick={() => setMoving(r)}>Đổi ngày</Button>}
              {live.includes(r) && <Button size="sm" variant="ghost" onClick={() => setCancel(r)}>Hủy</Button>}
            </div>
          ) },
        ]} />
      </Card>

      <CustomerCancelDialog reservation={cancel} onClose={() => setCancel(null)} />
      {/* Lấy bản mới nhất trong store để số lần đổi / chữ ký luôn đúng sau khi tải lại. */}
      <RescheduleDialog reservation={moving ? db.reservations.find((x) => x._id === moving._id) ?? null : null} onClose={() => setMoving(null)} />
    </>
  );
}
