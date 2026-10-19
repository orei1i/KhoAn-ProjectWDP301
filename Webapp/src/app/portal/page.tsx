'use client';

import Link from 'next/link';
import { CalendarCheck, CreditCard, QrCode, TriangleAlert, Warehouse } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { lastDayOf, OPEN_CONTRACT_STATUSES, PERIOD_UNIT, paymentDueDate } from '@ssm/shared';
import { CONTRACT_STATUS, RESERVATION_STATUS } from '@/shared/lib/labels';
import { facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, relativeDay, vnd } from '@/shared/lib/format';
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, Stat, StatusBadge } from '@/shared/ui';

export default function PortalHome() {
  const { db, user } = useStore();
  if (!user) return null;
  const contracts = db.contracts.filter((c) => c.customerId === user._id && OPEN_CONTRACT_STATUSES.includes(c.status));
  const upcoming = db.reservations.filter((r) => r.customerId === user._id && ['PENDING', 'CONFIRMED', 'ALLOCATED'].includes(r.status)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const debt = contracts.reduce((s, c) => s + c.balance.outstanding, 0);
  const nextBill = contracts.filter((c) => c.status === 'ACTIVE').sort((a, b) => a.billing.nextBillingDate.localeCompare(b.billing.nextBillingDate))[0];

  return (
    <>
      <PageHeader title={`Xin chào, ${user.fullName.split(' ').at(-1)}`} description="Tổng quan kho đang thuê, đặt chỗ và thanh toán của bạn." actions={<ButtonLink href="/facilities">Thuê thêm kho</ButtonLink>} />

      {debt > 0 && (
        <Card className="mb-6 flex flex-wrap items-center gap-4 border-amber-200 bg-amber-50 p-4">
          <TriangleAlert className="size-5 text-amber-700" />
          <p className="flex-1 text-sm text-amber-900">Bạn có công nợ quá hạn <b>{vnd(debt)}</b>. Sau thời gian ân hạn, truy cập kho có thể bị tạm khóa.</p>
          <ButtonLink href="/portal/units" size="sm">Thanh toán ngay</ButtonLink>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Kho đang thuê" value={contracts.length} icon={<Warehouse className="size-4" />} />
        <Stat label="Đặt chỗ sắp tới" value={upcoming.length} icon={<CalendarCheck className="size-4" />} tone="blue" />
        <Stat label="Công nợ" value={vnd(debt)} icon={<CreditCard className="size-4" />} tone={debt ? 'amber' : 'green'} />
        <Stat label="Kỳ thanh toán tới" value={nextBill ? fmtDate(nextBill.billing.nextBillingDate) : '—'} sub={nextBill ? `${vnd(nextBill.billing.rate)} · trả trước ${fmtDate(paymentDueDate(nextBill.billing.nextBillingDate, nextBill.terms.gracePeriodDays))}` : undefined} tone="violet" icon={<CreditCard className="size-4" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Đặt chỗ sắp tới" actions={<Link href="/portal/reservations" className="text-xs font-medium text-brand-700">Xem tất cả</Link>} />
          {upcoming.length === 0 ? <EmptyState title="Chưa có đặt chỗ" action={<ButtonLink href="/facilities" size="sm">Tìm kho</ButtonLink>} /> : (
            <ul className="divide-y divide-stone-100">
              {upcoming.map((r) => (
                <li key={r._id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)}</p>
                    <p className="text-xs text-stone-500">{r.code} · nhận {fmtDate(r.startDate)} ({relativeDay(r.startDate)}) · kho {unitLabel(db, r.unitId)}</p>
                  </div>
                  <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                  <ButtonLink href={`/booking/${r._id}`} variant={r.status === 'PENDING' ? 'primary' : 'secondary'} size="sm">
                    {r.status === 'PENDING' ? 'Thanh toán' : <><QrCode className="size-3.5" />Mã QR</>}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Kho đang thuê" actions={<Link href="/portal/units" className="text-xs font-medium text-brand-700">Quản lý</Link>} />
          {contracts.length === 0 ? <EmptyState title="Bạn chưa thuê kho nào" /> : (
            <ul className="divide-y divide-stone-100">
              {contracts.map((c) => (
                <li key={c._id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span className="grid size-10 place-items-center rounded-lg bg-ink text-xs font-semibold text-white">{unitLabel(db, c.unitId)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{typeName(db, c.unitTypeId)} · {facilityName(db, c.facilityId)}</p>
                    <p className="text-xs text-stone-500">Đến hết ngày {fmtDate(lastDayOf(c.endDate))} · {vnd(c.billing.rate)}/{PERIOD_UNIT[c.billing.rentalPeriod]}</p>
                  </div>
                  <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
