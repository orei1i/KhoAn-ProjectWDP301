'use client';

import { useState } from 'react';
import type { Reservation, ServiceOrder } from '@ssm/shared';
import { bookingServicesDue } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import type { DB } from '@/shared/lib/mock-data';
import { SERVICE_ORDER_STATUS } from '@/shared/lib/labels';
import { vnd } from '@/shared/lib/format';
import { Badge, Button, Modal, StatusBadge, cx } from '@/shared/ui';

const OPEN_RESERVATION = ['PENDING', 'CONFIRMED', 'ALLOCATED'];

/** Đơn dịch vụ khách chọn KÈM lúc đặt kho (đơn riêng ngoài hợp đồng thuê). */
export const bookingOrders = (db: DB, reservationId: string) => db.serviceOrders.filter((o) => String(o.reservationId ?? '') === reservationId);

/** Tiền dịch vụ kèm còn phải trả khi nhận kho. */
export const bookingServicesDueOf = (db: DB, reservationId: string) => bookingServicesDue(db.serviceOrders, reservationId);

/** Chờ thu khi nhận kho = chưa có phiếu thu. */
const awaitingPay = (o: ServiceOrder) => o.status === 'REQUESTED' && !o.paymentId;

/** Danh sách đơn dịch vụ kèm của một đặt chỗ; huỷ được khi chưa nhận kho. `compact`: dạng gọn trong bảng. */
export function BookingServices({ reservation: r, compact = false, className }: { reservation: Reservation; compact?: boolean; className?: string }) {
  const { db, run } = useStore();
  const [cancel, setCancel] = useState<ServiceOrder | null>(null);
  const orders = bookingOrders(db, r._id);
  if (orders.length === 0) return null;
  const canCancel = (o: ServiceOrder) => OPEN_RESERVATION.includes(r.status) && o.status === 'REQUESTED';
  const status = (o: ServiceOrder) => (awaitingPay(o) ? <Badge tone="amber" dot>Thu khi nhận kho</Badge> : <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />);

  return (
    <div className={className}>
      {compact ? (
        <ul className="space-y-1">
          {orders.map((o) => (
            <li key={o._id} className={cx('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', o.status === 'CANCELLED' ? 'text-stone-400' : 'text-stone-600')}>
              <span>+ {o.serviceName} × {o.quantity} · <span className="tabular-nums">{vnd(o.total)}</span></span>
              {status(o)}
              {canCancel(o) && <button type="button" onClick={() => setCancel(o)} className="font-medium text-red-700 hover:underline">Huỷ</button>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-stone-100">
          {orders.map((o) => (
            <li key={o._id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className={cx('font-medium', o.status === 'CANCELLED' && 'text-stone-400 line-through')}>{o.serviceName} × {o.quantity} {o.unitLabel}</p>
                <p className="text-xs text-stone-500">{o.orderNumber}{o.note ? ` · ${o.note}` : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums font-medium">{vnd(o.total)}</span>
                {status(o)}
                {canCancel(o) && <Button size="sm" variant="ghost" onClick={() => setCancel(o)}>Huỷ</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Huỷ dịch vụ kèm?" description={cancel ? `${cancel.serviceName} × ${cancel.quantity}` : ''}
        footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Giữ lại</Button><Button variant="danger" onClick={() => cancel && void run('cancelServiceOrder', { orderId: cancel._id }, 'Đã huỷ dịch vụ kèm', () => setCancel(null))}>Xác nhận huỷ</Button></>}>
        <p className="text-sm text-stone-600">{cancel && cancel.paymentId ? <>Bạn được hoàn đủ <b>{vnd(cancel.total)}</b>.</> : 'Đơn chưa thanh toán — huỷ không mất phí.'}</p>
      </Modal>
    </div>
  );
}
