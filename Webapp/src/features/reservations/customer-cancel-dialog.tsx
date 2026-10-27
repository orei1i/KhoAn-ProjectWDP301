'use client';

import type { Reservation } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { cancellationRefund } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Button, Modal } from '@/shared/ui';
import { bookingOrders } from '@/features/reservations/booking-services';

/**
 * Khách tự huỷ đặt chỗ / huỷ giữ chỗ: hỏi xác nhận kèm % và số tiền được hoàn theo chính sách huỷ (cùng công thức với server).
 * Dùng chung cho "Đặt chỗ của tôi" và trang đặt chỗ — hai nơi cùng một hộp thoại.
 */
export function CustomerCancelDialog({ reservation, onClose }: { reservation: Reservation | null; onClose: () => void }) {
  const { db, run, busy } = useStore();
  const r = reservation;
  const refund = r ? cancellationRefund(db, r) : null;
  const hold = r?.status === 'PENDING'; // chưa thanh toán — chỉ nhả ô kho đang giữ, không có khoản hoàn
  const services = r ? bookingOrders(db, r._id).length > 0 : false;
  const confirm = () => r && void run('cancelReservation', { reservationId: r._id, reason: 'CUSTOMER_REQUEST' },
    (v) => (hold ? 'Đã hủy giữ chỗ' : `Đã hủy — hoàn ${vnd(v)}`), onClose);
  return (
    <Modal open={!!r} onClose={onClose} title={hold ? 'Hủy giữ chỗ?' : 'Hủy đặt chỗ?'} description={r?.code}
      footer={<><Button variant="secondary" onClick={onClose}>Giữ lại</Button><Button variant="danger" disabled={busy} onClick={confirm}>Xác nhận hủy</Button></>}>
      <p className="text-sm text-stone-600">
        {hold
          ? 'Bạn chưa thanh toán nên không phát sinh khoản hoàn — ô kho đang giữ sẽ được nhả cho khách khác.'
          : <>Theo chính sách hủy, bạn được hoàn <b>{refund?.pct}%</b> số tiền đã trả khi đặt chỗ: <b>{vnd(refund?.amount ?? 0)}</b>, trong tối đa 7 ngày làm việc.</>}
        {services ? ' Dịch vụ kèm tự huỷ.' : ''}
      </p>
    </Modal>
  );
}
