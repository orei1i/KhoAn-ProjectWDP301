'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CircleCheck, Clock, Timer } from 'lucide-react';
import type { PaymentMethod } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { PAYMENT_METHOD, RESERVATION_STATUS } from '@/shared/lib/labels';
import { PERIOD_UNIT, dueAtBooking, lastDayOf, periodLabel } from '@ssm/shared';
import { byId, cancellationRefund, facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, minutesLeft, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, EmptyState, KV, StatusBadge, cx } from '@/shared/ui';
import { FakeQr } from '@/features/reservations/qr';
import { ContractSignForm } from '@/features/contracts/contract-sign-form';
import { SignatureInfo } from '@/features/contracts/contract-document';
import { ContractFileActions } from '@/features/contracts/contract-file-actions';
import { PaymentSchedule } from '@/features/payments/payment-schedule';

const METHODS: PaymentMethod[] = ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'];

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const { db, user, run } = useStore();
  const r = byId(db.reservations, id);
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(t); }, []);

  if (!r || !user || (user.role === 'CUSTOMER' && r.customerId !== user._id)) {
    return <main className="mx-auto max-w-3xl p-8"><EmptyState title="Không tìm thấy đặt chỗ" description="Có thể bạn chưa đăng nhập đúng tài khoản." action={<ButtonLink href="/portal/reservations">Đặt chỗ của tôi</ButtonLink>} /></main>;
  }
  const left = minutesLeft(r.holdExpiresAt);
  const refund = cancellationRefund(db, r);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Đặt chỗ {r.code}</h1>
        <StatusBadge map={RESERVATION_STATUS} value={r.status} />
      </div>

      <Card className="mt-6 p-5">
        <KV items={[
          ['Chi nhánh', facilityName(db, r.facilityId)], ['Loại kho', typeName(db, r.unitTypeId)],
          ['Ngày nhận kho', fmtDate(r.startDate)], ['Thời hạn', `${periodLabel(r.quote.rentalPeriod, r.periods)} (đến hết ngày ${fmtDate(lastDayOf(r.endDate))})`],
          [`Tiền thuê / ${PERIOD_UNIT[r.quote.rentalPeriod]}`, vnd(r.quote.firstPeriodRent)], ['Tiền giữ chân (trả khi đặt chỗ)', vnd(r.quote.depositAmount)],
          ...(r.quote.firstPeriodAtBooking ? [[`Tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu (trả khi đặt chỗ)`, vnd(r.quote.firstPeriodRent)] as [string, string]] : []),
        ]} />
      </Card>
      {(r.status === 'PENDING' || r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && <PaymentSchedule quotes={[r.quote]} className="mt-4" paid={r.status !== 'PENDING'} />}

      {r.status === 'PENDING' && (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Thanh toán giữ chỗ</h2>
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', left <= 5 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}>
              <Timer className="size-3.5" />Giữ chỗ còn {left} phút
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {METHODS.map((m) => (
              <button key={m} onClick={() => setMethod(m)} className={cx('rounded-lg px-3 py-3 text-sm font-medium ring-1 ring-inset', method === m ? 'bg-brand-50 text-brand-900 ring-brand-600' : 'ring-stone-300 hover:bg-stone-50')}>{PAYMENT_METHOD[m]}</button>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => run('cancelReservation', { reservationId: r._id, reason: 'CUSTOMER_REQUEST' }, 'Đã hủy giữ chỗ')}>Hủy giữ chỗ</Button>
            <Button onClick={() => void run('payDeposit', { reservationId: r._id, method }, 'Thanh toán thành công', (v) => setQrPayload(v.qrPayload))}>Thanh toán {vnd(dueAtBooking(r.quote))}</Button>
          </div>
          <p className="mt-3 text-xs text-stone-500">Thanh toán đang ở chế độ giả lập (MOCK_PAYMENTS): server ghi nhận thành công ngay qua cổng {PAYMENT_METHOD[method]}.</p>
        </Card>
      )}

      {(r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Bước 2 — Ký hợp đồng</h2>
            {r.signature ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Đã ký</span> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Chưa ký — cần ký trước khi nhận kho</span>}
          </div>
          <div className="mt-4">{r.signature ? <><SignatureInfo signature={r.signature} /><ContractFileActions reservation={r} /></> : <ContractSignForm reservation={r} />}</div>
        </Card>
      )}

      {(r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && (
        <Card className="mt-4 grid gap-6 p-5 sm:grid-cols-[auto_1fr]">
          <div className="mx-auto text-center"><FakeQr value={qrPayload ?? r.code} /><p className="mt-2 font-mono text-xs text-stone-500">{r.code}</p></div>
          <div>
            <p className="flex items-center gap-2 font-semibold text-emerald-700"><CircleCheck className="size-5" />Đặt chỗ đã được xác nhận</p>
            <p className="mt-2 text-sm text-stone-600">Đưa mã QR này cho nhân viên tại quầy vào ngày <b>{fmtDate(r.startDate)}</b>. Nhân viên sẽ xác minh và bàn giao chìa khóa / mã PIN.{!r.signature && ' Bạn cần ký hợp đồng ở trên trước khi nhận kho.'}</p>
            <p className="mt-3 text-sm">Kho được phân: <b>{r.unitId ? unitLabel(db, r.unitId) : 'Chi nhánh sẽ phân kho trước ngày nhận'}</b></p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500"><Clock className="size-3.5" />Nếu hủy bây giờ: hoàn {refund.pct}% số tiền đã trả khi đặt chỗ ({vnd(refund.amount)})</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href="/portal/reservations" variant="secondary">Đặt chỗ của tôi</ButtonLink>
              <Button variant="ghost" onClick={() => run('cancelReservation', { reservationId: r._id, reason: 'CUSTOMER_REQUEST' }, (v) => `Đã hủy — hoàn ${vnd(v)}`)}>Hủy đặt chỗ</Button>
            </div>
          </div>
        </Card>
      )}

      {(r.status === 'CANCELLED' || r.status === 'CHECKED_IN' || r.status === 'COMPLETED') && (
        <Card className="mt-4 p-5 text-sm text-stone-600">
          {r.status === 'CANCELLED' ? `Đặt chỗ đã hủy. Số tiền hoàn: ${vnd(r.cancellation?.refundAmount ?? 0)}.` : 'Bạn đã nhận kho. Quản lý hợp đồng trong mục Kho đang thuê.'}
          <div className="mt-3"><ButtonLink href="/portal" variant="secondary" size="sm">Về trang tổng quan</ButtonLink></div>
        </Card>
      )}
    </main>
  );
}
