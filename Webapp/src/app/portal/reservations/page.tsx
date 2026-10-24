'use client';

import { useState } from 'react';
import type { Reservation } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { dueAtBooking, dueAtCheckIn, periodLabel } from '@ssm/shared';
import { CANCELLATION_REASON, RESERVATION_STATUS } from '@/shared/lib/labels';
import { cancellationRefund, facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, EmptyState, Modal, PageHeader, StatusBadge, Table, Tabs } from '@/shared/ui';
import { BookingServices, bookingOrders, bookingServicesDueOf } from '@/features/reservations/booking-services';

type Tab = 'upcoming' | 'past';

export default function MyReservations() {
  const { db, user, run } = useStore();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [cancel, setCancel] = useState<Reservation | null>(null);
  if (!user) return null;
  const mine = db.reservations.filter((r) => r.customerId === user._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = mine.filter((r) => ['PENDING', 'CONFIRMED', 'ALLOCATED'].includes(r.status));
  const rows = tab === 'upcoming' ? live : mine.filter((r) => !live.includes(r));
  const refund = cancel ? cancellationRefund(db, cancel) : null;

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
              {live.includes(r) && <ButtonLink href={`/booking/${r._id}`} size="sm" variant={r.status === 'PENDING' || !r.signature ? 'primary' : 'secondary'}>{r.status === 'PENDING' ? 'Thanh toán' : !r.signature ? 'Ký hợp đồng' : 'Mã QR'}</ButtonLink>}
              {live.includes(r) && <Button size="sm" variant="ghost" onClick={() => setCancel(r)}>Hủy</Button>}
            </div>
          ) },
        ]} />
      </Card>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Hủy đặt chỗ?" description={cancel?.code}
        footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Giữ lại</Button><Button variant="danger" onClick={() => cancel && void run('cancelReservation', { reservationId: cancel._id, reason: 'CUSTOMER_REQUEST' }, (v) => `Đã hủy — hoàn ${vnd(v)}`, () => setCancel(null))}>Xác nhận hủy</Button></>}>
        <p className="text-sm text-stone-600">Theo chính sách hủy, bạn được hoàn <b>{refund?.pct}%</b> số tiền đã trả khi đặt chỗ: <b>{vnd(refund?.amount ?? 0)}</b>, trong tối đa 7 ngày làm việc.{cancel && bookingOrders(db, cancel._id).length > 0 ? ' Dịch vụ kèm tự huỷ.' : ''}</p>
      </Modal>
    </>
  );
}
