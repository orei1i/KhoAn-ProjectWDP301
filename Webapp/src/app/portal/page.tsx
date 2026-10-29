'use client';

import Link from 'next/link';
import { ArrowRight, CalendarCheck, CalendarClock, CreditCard, LifeBuoy, PackagePlus, QrCode, Search, TriangleAlert, Wallet, Warehouse } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { billingDue, fmtHoldUntil, nextChargeText, OPEN_CONTRACT_STATUSES, PERIOD_UNIT } from '@ssm/shared';
import { CONTRACT_STATUS, RESERVATION_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, relativeDay, vnd } from '@/shared/lib/format';
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, StatCard, StatusBadge, cx } from '@/shared/ui';
import { CATEGORY_ICON } from '@/features/facilities/visuals';
import { TermProgress } from '@/features/contracts/term-progress';

/** Lối tắt hay dùng — icon + vài chữ. */
const QUICK = [
  { href: '/facilities', label: 'Thuê thêm kho', icon: Search },
  { href: '/portal/payments', label: 'Thanh toán', icon: Wallet },
  { href: '/portal/services', label: 'Dịch vụ thêm', icon: PackagePlus },
  { href: '/portal/tickets', label: 'Hỗ trợ', icon: LifeBuoy },
];

export default function PortalHome() {
  const { db, user } = useStore();
  if (!user) return null;
  const contracts = db.contracts.filter((c) => c.customerId === user._id && OPEN_CONTRACT_STATUSES.includes(c.status));
  const upcoming = db.reservations.filter((r) => r.customerId === user._id && ['PENDING', 'CONFIRMED', 'ALLOCATED'].includes(r.status)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const debt = contracts.reduce((s, c) => s + c.balance.outstanding, 0);
  // Hạn chót tính như job billing (theo paidThrough + ân hạn) — không theo nextBillingDate, vì xuất hoá đơn xong job đã đẩy nó sang kỳ sau.
  const dues = contracts.map((c) => ({ c, d: billingDue(c) }));
  const owing = dues.filter((x) => x.d.owing).sort((a, b) => a.d.deadline.localeCompare(b.d.deadline));
  const late = owing.some((x) => x.d.late);
  const firstDue = owing[0];
  const nextBill = dues.filter((x) => x.c.status === 'ACTIVE' && !x.d.owing).sort((a, b) => a.d.next.date.localeCompare(b.d.next.date))[0];

  return (
    <>
      <PageHeader title={`Xin chào, ${user.fullName.split(' ').at(-1)}`} description="Kho, đặt chỗ và các khoản cần thanh toán của bạn." actions={<ButtonLink href="/facilities"><Search className="size-4" />Thuê thêm kho</ButtonLink>} />

      {debt > 0 && (
        <div className={cx('mb-6 flex flex-wrap items-center gap-4 rounded-2xl p-4 ring-1 ring-inset', late || !firstDue ? 'bg-red-50 ring-red-200' : 'bg-amber-50 ring-amber-200')}>
          <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', late || !firstDue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}><TriangleAlert className="size-5" /></span>
          <p className={cx('min-w-0 flex-1 text-sm', late || !firstDue ? 'text-red-900' : 'text-amber-900')}>
            {late || !firstDue
              ? <>Bạn có công nợ quá hạn <b>{vnd(debt)}</b>. Quá thời gian ân hạn bị tính phí trễ; quá hạn vượt ngưỡng khoá kho thì quyền ra vào bị tạm khoá.</>
              : <>Bạn có khoản chưa thanh toán <b>{vnd(debt)}</b> — hạn chót <b>{fmtDate(firstDue.d.deadline)}</b>, quá hạn bị tính phí trễ.</>}
          </p>
          <ButtonLink href="/portal/units" size="sm" variant={late || !firstDue ? 'danger' : 'primary'}>Thanh toán ngay</ButtonLink>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Kho đang thuê" value={contracts.length} icon={<Warehouse className="size-5" />} href="/portal/units" />
        <StatCard label="Đặt chỗ sắp tới" value={upcoming.length} icon={<CalendarCheck className="size-5" />} tone="blue" href="/portal/reservations" />
        <StatCard label="Công nợ" value={vnd(debt)} icon={<CreditCard className="size-5" />} tone={debt ? (late ? 'red' : 'amber') : 'green'} sub={debt ? undefined : 'Không có khoản nợ'} href="/portal/payments" />
        {firstDue ? (
          <StatCard label="Hạn chót thanh toán" value={fmtDate(firstDue.d.deadline)} sub={`${vnd(firstDue.d.outstanding)} · ${firstDue.d.late ? 'đã quá hạn' : 'quá hạn bị tính phí trễ'}`} tone={firstDue.d.late ? 'red' : 'amber'} icon={<CalendarClock className="size-5" />} />
        ) : (
          <StatCard label="Kỳ thanh toán tới" value={nextBill ? fmtDate(nextBill.d.next.date) : '—'} sub={nextBill ? (nextBill.d.next.prepaid ? nextChargeText(nextBill.d) : `${nextChargeText(nextBill.d)} · hạn trả ${fmtDate(nextBill.d.deadline)}`) : undefined} tone="violet" icon={<CalendarClock className="size-5" />} />
        )}
      </div>

      <nav aria-label="Lối tắt" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {QUICK.map((q) => (
          <Link key={q.href} href={q.href} className="group flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-stone-700 ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:text-ink hover:shadow-lift">
            <span className="grid size-9 place-items-center rounded-lg bg-stone-100 text-stone-600 transition-colors group-hover:bg-brand-50 group-hover:text-brand-700"><q.icon className="size-4" /></span>
            {q.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Đặt chỗ sắp tới" actions={<Link href="/portal/reservations" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Xem tất cả <ArrowRight className="size-3.5" /></Link>} />
          {upcoming.length === 0 ? <EmptyState icon={<CalendarCheck className="size-6" />} title="Chưa có đặt chỗ" action={<ButtonLink href="/facilities" size="sm">Tìm kho</ButtonLink>} /> : (
            <ul className="divide-y divide-stone-100">
              {upcoming.map((r) => {
                const [dd, mm] = fmtDate(r.startDate).split('/');
                return (
                  <li key={r._id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <span className="grid w-12 shrink-0 place-items-center rounded-xl bg-sky-50 py-1.5 text-sky-800 ring-1 ring-inset ring-sky-100">
                      <span className="text-lg font-bold leading-none tabular-nums">{dd}</span>
                      <span className="text-[10px] font-semibold uppercase">Th{Number(mm)}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)}</p>
                      <p className="text-xs text-stone-500">{r.code} · nhận {relativeDay(r.startDate).toLowerCase()} · kho {unitLabel(db, r.unitId)}</p>
                      {r.status === 'PENDING' && r.payAtCounter && r.holdExpiresAt && <p className="text-xs text-violet-700">Trả tại quầy · giữ ô đến {fmtHoldUntil(r.holdExpiresAt)}</p>}
                    </div>
                    <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                    <ButtonLink href={`/booking/${r._id}`} variant={r.status === 'PENDING' ? 'primary' : 'secondary'} size="sm">
                      {r.status === 'PENDING' ? (r.payAtCounter ? 'Chi tiết' : 'Thanh toán') : <><QrCode className="size-3.5" />Mã QR</>}
                    </ButtonLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Kho đang thuê" actions={<Link href="/portal/units" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Quản lý <ArrowRight className="size-3.5" /></Link>} />
          {contracts.length === 0 ? <EmptyState icon={<Warehouse className="size-6" />} title="Bạn chưa thuê kho nào" action={<ButtonLink href="/facilities" size="sm">Tìm kho</ButtonLink>} /> : (
            <ul className="divide-y divide-stone-100">
              {contracts.map((c) => {
                const cat = byId(db.unitTypes, c.unitTypeId)?.category;
                const Icon = cat ? CATEGORY_ICON[cat] : Warehouse;
                return (
                  <li key={c._id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-ink text-xs font-bold text-white">
                      {unitLabel(db, c.unitId)}
                      <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-md bg-brand-500 ring-2 ring-white"><Icon className="size-3" /></span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{typeName(db, c.unitTypeId)} · {facilityName(db, c.facilityId)}</p>
                        <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                      </div>
                      <p className="text-xs text-stone-500">{vnd(c.billing.rate)}/{PERIOD_UNIT[c.billing.rentalPeriod]}</p>
                      <TermProgress start={c.startDate} end={c.endDate} className="mt-1.5" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
