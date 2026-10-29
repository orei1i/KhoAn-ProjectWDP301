'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Building2, CalendarDays, CalendarRange, Check, CircleCheck, CircleX, Clock, CreditCard, PenLine, QrCode, SearchX, ShieldCheck, Store, Timer, Wallet, Warehouse } from 'lucide-react';
import type { Reservation } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { RESERVATION_STATUS } from '@/shared/lib/labels';
import { PERIOD_UNIT, SIGNING_PREFERENCE, counterHoldText, dueAtBooking, dueAtCheckIn, fmtHoldUntil, lastDayOf, periodLabel, signingPreferenceOf } from '@ssm/shared';
import { byId, cancellationRefund, facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, minutesLeft, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, EmptyState, IconTile, StatusBadge, cx } from '@/shared/ui';
import { MockGateway, type GatewayOrder } from '@/features/payments/mock-gateway';
import { CheckInQr } from '@/features/reservations/qr';
import { ContractSignForm } from '@/features/contracts/contract-sign-form';
import { SignatureInfo } from '@/features/contracts/contract-document';
import { ContractFileActions } from '@/features/contracts/contract-file-actions';
import { PaymentSchedule } from '@/features/payments/payment-schedule';
import { BookingServices, bookingOrders, bookingServicesDueOf } from '@/features/reservations/booking-services';
import { RescheduleDialog, canReschedule } from '@/features/reservations/reschedule-dialog';
import { CustomerCancelDialog } from '@/features/reservations/customer-cancel-dialog';

type StepState = 'done' | 'current' | 'todo';
/** Thanh tiến trình 3 bước của một đặt chỗ: giữ chỗ → ký hợp đồng → nhận kho. */
function Progress({ steps }: { steps: { label: string; icon: ReactNode; state: StepState }[] }) {
  return (
    <ol className="mt-6 grid grid-cols-3 gap-2">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-col items-center text-center">
          {i > 0 && <span className={cx('absolute right-[calc(50%+1.25rem)] top-5 h-0.5 w-[calc(100%-2rem)] -translate-y-1/2', s.state === 'todo' ? 'bg-stone-200' : 'bg-emerald-400')} aria-hidden />}
          <span className={cx('relative grid size-10 place-items-center rounded-full ring-4 ring-stone-50 transition-colors',
            s.state === 'done' ? 'bg-emerald-600 text-white' : s.state === 'current' ? 'bg-brand-700 text-white shadow-lift' : 'bg-white text-stone-400 ring-stone-50 outline outline-1 outline-stone-200')}>
            {s.state === 'done' ? <Check className="size-5" /> : s.icon}
          </span>
          <span className={cx('mt-2 text-xs font-medium leading-tight sm:text-sm', s.state === 'todo' ? 'text-stone-400' : 'text-ink')}>{s.label}</span>
          <span className="sr-only">{s.state === 'done' ? ' — đã xong' : s.state === 'current' ? ' — đang ở bước này' : ''}</span>
        </li>
      ))}
    </ol>
  );
}

/** Một dòng thông tin có icon (thay bảng chữ dài). */
function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <IconTile icon={icon} size="sm" tone="gray" />
      <div className="min-w-0">
        <dt className="text-xs text-stone-500">{label}</dt>
        <dd className="font-medium text-ink">{children}</dd>
      </div>
    </div>
  );
}

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const { db, user, run } = useStore();
  const r = byId(db.reservations, id);
  const [gateway, setGateway] = useState<GatewayOrder | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  // Đang trả tiền giữ chỗ: refresh() đổi trạng thái sang CONFIRMED TRƯỚC khi payload về — chặn CheckInQr tự cấp mã
  // lúc đó, nếu không mã cấp lại sẽ vô hiệu hoá token payDeposit vừa phát.
  const [paying, setPaying] = useState(false);
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(t); }, []);

  if (!r || !user || (user.role === 'CUSTOMER' && r.customerId !== user._id)) {
    return <main className="mx-auto max-w-3xl p-8"><EmptyState icon={<SearchX className="size-6" />} title="Không tìm thấy đặt chỗ" description="Có thể bạn chưa đăng nhập đúng tài khoản." action={<ButtonLink href="/portal/reservations">Đặt chỗ của tôi</ButtonLink>} /></main>;
  }
  const left = minutesLeft(r.holdExpiresAt);
  const refund = cancellationRefund(db, r);
  const live = r.status === 'PENDING' || r.status === 'CONFIRMED' || r.status === 'ALLOCATED';
  const hasServices = bookingOrders(db, r._id).length > 0;
  const servicesDue = bookingServicesDueOf(db, r._id);
  const rentDue = dueAtCheckIn(r.quote);
  // Khách chọn ký giấy tại quầy: chưa ký không phải việc còn thiếu — chỉ nhắc mang giấy tờ khi đến nhận kho.
  const paper = !r.signature && signingPreferenceOf(r) === 'PAPER_AT_COUNTER';
  // Giữ chỗ, trả tại quầy: ô giữ tới holdExpiresAt (dài hơn giữ chỗ online), khách vẫn trả online sớm được qua cổng thanh toán.
  const counter = r.status === 'PENDING' && !!r.payAtCounter;
  const payOnline = (x: Reservation) => setGateway({
    facilityId: x.facilityId, code: x.code, amount: dueAtBooking(x.quote),
    purpose: x.quote.firstPeriodAtBooking ? `Tiền giữ chân + tiền thuê ${PERIOD_UNIT[x.quote.rentalPeriod]} đầu` : 'Tiền giữ chân',
    lines: x.quote.firstPeriodAtBooking ? [{ label: 'Tiền giữ chân', amount: x.quote.depositAmount }, { label: `Tiền thuê ${PERIOD_UNIT[x.quote.rentalPeriod]} đầu`, amount: x.quote.firstPeriodRent }] : undefined,
    pay: (m) => { setPaying(true); return run('payDeposit', { reservationId: x._id, method: m }, undefined, (v) => setQrPayload(v.qrPayload)).finally(() => setPaying(false)); },
    back: { label: 'Về đặt chỗ' },
  });

  const confirmed = r.status === 'CONFIRMED' || r.status === 'ALLOCATED';
  const received = r.status === 'CHECKED_IN' || r.status === 'COMPLETED';
  const progress: { label: string; icon: ReactNode; state: StepState }[] = [
    { label: counter ? 'Giữ chỗ, trả tại quầy' : 'Thanh toán giữ chỗ', icon: <Wallet className="size-5" />, state: r.status === 'PENDING' ? 'current' : 'done' },
    { label: paper ? 'Ký tại quầy' : 'Ký hợp đồng', icon: <PenLine className="size-5" />, state: r.signature || received ? 'done' : confirmed && !paper ? 'current' : 'todo' },
    { label: 'Nhận kho', icon: <QrCode className="size-5" />, state: received ? 'done' : confirmed && (r.signature || paper) ? 'current' : 'todo' },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Đặt chỗ <span className="font-mono">{r.code}</span></h1>
        <StatusBadge map={RESERVATION_STATUS} value={r.status} />
      </div>
      <p className="mt-1 text-sm text-stone-500">{typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)}</p>
      {r.status !== 'CANCELLED' && <Progress steps={progress} />}

      <Card className="mt-6 p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Fact icon={<Building2 className="size-4" />} label="Chi nhánh">{facilityName(db, r.facilityId)}</Fact>
          <Fact icon={<Warehouse className="size-4" />} label="Loại kho">{typeName(db, r.unitTypeId)}</Fact>
          <Fact icon={<CalendarDays className="size-4" />} label="Ngày nhận kho">{fmtDate(r.startDate)}</Fact>
          <Fact icon={<CalendarRange className="size-4" />} label="Thời hạn">{periodLabel(r.quote.rentalPeriod, r.periods)} <span className="font-normal text-stone-500">(đến hết ngày {fmtDate(lastDayOf(r.endDate))})</span></Fact>
          <Fact icon={<CreditCard className="size-4" />} label={`Tiền thuê / ${PERIOD_UNIT[r.quote.rentalPeriod]}`}><span className="tabular-nums">{vnd(r.quote.firstPeriodRent)}</span></Fact>
          <Fact icon={<ShieldCheck className="size-4" />} label="Tiền giữ chân (trả khi đặt chỗ)"><span className="tabular-nums">{vnd(r.quote.depositAmount)}</span></Fact>
          {r.quote.firstPeriodAtBooking && <Fact icon={<Wallet className="size-4" />} label={`Tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu (trả khi đặt chỗ)`}><span className="tabular-nums">{vnd(r.quote.firstPeriodRent)}</span></Fact>}
        </dl>
      </Card>

      {r.status === 'PENDING' && (
        <Card className="mt-4 overflow-hidden">
          <div className={cx('flex flex-wrap items-center justify-between gap-3 px-5 py-4', counter ? 'bg-violet-50' : 'bg-brand-50')}>
            <div>
              <h2 className="font-semibold">{counter ? 'Giữ chỗ, trả tại quầy' : 'Thanh toán giữ chỗ'}</h2>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-ink">{vnd(dueAtBooking(r.quote))}</p>
            </div>
            {counter ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-200"><Store className="size-3.5" />Giữ ô đến {r.holdExpiresAt ? fmtHoldUntil(r.holdExpiresAt) : '—'}</span>
            ) : (
              <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset', left <= 5 ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-white text-amber-800 ring-amber-200')}>
                <Timer className="size-3.5" />Giữ chỗ còn {left} phút
              </span>
            )}
          </div>
          <div className="p-5">
            {counter ? (
              <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-950 ring-1 ring-inset ring-violet-200">
                {r.holdExpiresAt ? counterHoldText(r.holdExpiresAt) : 'Mang CCCD đến quầy thanh toán và ký hợp đồng'} — số tiền <b className="tabular-nums">{vnd(dueAtBooking(r.quote))}</b>. Quá hạn chưa trả thì đặt chỗ tự huỷ.
              </p>
            ) : (
              <p className="text-sm text-stone-600">Trả <b className="tabular-nums">{vnd(dueAtBooking(r.quote))}</b> qua cổng thanh toán để giữ kho.</p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setCancelling(true)}>Hủy giữ chỗ</Button>
              <Button variant={counter ? 'secondary' : 'primary'} size="lg" disabled={paying} onClick={() => payOnline(r)}><CreditCard className="size-4" />{counter ? 'Thanh toán online' : 'Thanh toán'} {vnd(dueAtBooking(r.quote))}</Button>
            </div>
          </div>
        </Card>
      )}

      {live && <PaymentSchedule quotes={[r.quote]} className="mt-4" paid={r.status !== 'PENDING'} />}

      {hasServices && (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Dịch vụ kèm</h2>
            <span className="text-xs text-stone-500">Đơn riêng, ngoài hợp đồng thuê</span>
          </div>
          <BookingServices reservation={r} className="mt-2" />
          {live && servicesDue > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
              Trả thêm khi nhận kho: <b className="tabular-nums">{vnd(rentDue + servicesDue)}</b>
              {rentDue > 0 && <span className="text-xs"> (tiền thuê {vnd(rentDue)} + dịch vụ kèm {vnd(servicesDue)})</span>}
            </p>
          )}
        </Card>
      )}

      {confirmed && (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold"><PenLine className="size-4 text-brand-700" />Bước 2 — Ký hợp đồng</h2>
            {r.signature ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Đã ký</span> : paper ? <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800">{SIGNING_PREFERENCE.PAPER_AT_COUNTER.label}</span> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Chưa ký — cần ký trước khi nhận kho</span>}
          </div>
          <div className="mt-4">{r.signature ? <><SignatureInfo signature={r.signature} /><ContractFileActions reservation={r} /></> : <ContractSignForm reservation={r} />}</div>
        </Card>
      )}

      {confirmed && (
        <Card className="mt-4 overflow-hidden">
          <div className="flex items-center gap-2 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800"><CircleCheck className="size-5" />Đặt chỗ đã được xác nhận</div>
          <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr]">
            <CheckInQr reservationId={r._id} code={r.code} initialPayload={qrPayload} expiresAt={r.checkIn?.qrExpiresAt} hold={paying} />
            <div>
              <p className="text-sm text-stone-600">Đưa mã QR này cho nhân viên tại quầy vào ngày <b>{fmtDate(r.startDate)}</b>. Nhân viên sẽ xác minh và bàn giao chìa khóa / mã PIN.{!r.signature && (paper ? ' Bạn sẽ ký hợp đồng giấy tại quầy — mang CCCD/hộ chiếu.' : ' Bạn cần ký hợp đồng ở trên trước khi nhận kho.')}</p>
              <p className="mt-1 text-xs text-stone-500">Không quét được thì đọc mã đặt chỗ <span className="font-mono">{r.code}</span> cho nhân viên.</p>
              <p className="mt-3 flex items-center gap-2 text-sm"><Warehouse className="size-4 text-brand-700" />Kho được phân: <b>{r.unitId ? unitLabel(db, r.unitId) : 'Chi nhánh sẽ phân kho trước ngày nhận'}</b></p>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-stone-500"><Clock className="mt-0.5 size-3.5 shrink-0" />Nếu hủy bây giờ: hoàn {vnd(refund.amount)} (tiền giữ chân {refund.pct}%{refund.prepaidRentRefund > 0 ? ' + đủ tiền thuê trả trước' : ''}){hasServices ? ', dịch vụ kèm tự huỷ' : ''}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ButtonLink href="/portal/reservations" variant="secondary">Đặt chỗ của tôi</ButtonLink>
                {canReschedule(r) && <Button variant="secondary" onClick={() => setMoving(true)}>Đổi ngày nhận kho</Button>}
                <Button variant="ghost" onClick={() => setCancelling(true)}>Hủy đặt chỗ</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {(r.status === 'CANCELLED' || received) && (
        <Card className="mt-4 flex flex-wrap items-center gap-4 p-5 text-sm text-stone-600">
          <IconTile icon={r.status === 'CANCELLED' ? <CircleX className="size-5" /> : <CircleCheck className="size-5" />} tone={r.status === 'CANCELLED' ? 'red' : 'green'} />
          <p className="min-w-0 flex-1">{r.status === 'CANCELLED' ? `Đặt chỗ đã hủy. Số tiền hoàn: ${vnd(r.cancellation?.refundAmount ?? 0)}.` : 'Bạn đã nhận kho. Quản lý hợp đồng trong mục Kho đang thuê.'}</p>
          <ButtonLink href="/portal" variant="secondary" size="sm">Về trang tổng quan</ButtonLink>
        </Card>
      )}
      <RescheduleDialog reservation={moving ? r : null} onClose={() => setMoving(false)} />
      <CustomerCancelDialog reservation={cancelling ? r : null} onClose={() => setCancelling(false)} />
      <MockGateway order={gateway} onClose={() => setGateway(null)} />
    </main>
  );
}
