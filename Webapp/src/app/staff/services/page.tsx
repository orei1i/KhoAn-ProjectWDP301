'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ServiceOrder } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { SERVICE_ORDER_STATUS } from '@/shared/lib/labels';
import { byId, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, Modal, PageHeader, StatusBadge, Table, Tabs } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

type Tab = 'open' | 'all';

export default function StaffServices() {
  const { db, run } = useStore();
  const scope = useFacilityScope();
  const [tab, setTab] = useState<Tab>('open');
  const [cancel, setCancel] = useState<ServiceOrder | null>(null);
  const all = db.serviceOrders.filter((o) => scope.facilityIds.includes(o.facilityId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = all.filter((o) => o.status === 'REQUESTED');
  const rows = tab === 'open' ? open.sort((a, b) => (a.preferredDate ?? '').localeCompare(b.preferredDate ?? '')) : all;
  // Đơn chọn kèm lúc đặt kho: chưa thu tiền cho tới khi nhận kho — chưa được xác nhận đã làm.
  const bookingCode = (o: ServiceOrder) => (o.reservationId ? byId(db.reservations, o.reservationId)?.code ?? '—' : null);

  return (
    <>
      <PageHeader title="Dịch vụ yêu cầu" description="Làm xong thì xác nhận; không làm được thì huỷ, hoàn đủ tiền đã thu." actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[{ key: 'open', label: 'Chờ thực hiện', count: open.length }, { key: 'all', label: 'Tất cả', count: all.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={rows} rowKey={(o) => o._id} empty={<EmptyState title="Không có đơn dịch vụ" />} columns={[
          { key: 'n', header: 'Mã đơn', cell: (o) => <span className="font-mono text-xs">{o.orderNumber}</span> },
          { key: 'c', header: 'Khách / kho', cell: (o) => {
            const c = byId(db.contracts, o.contractId);
            const rsv = bookingCode(o);
            return (
              <div>
                <p className="font-medium">{userName(db, o.customerId)}</p>
                {c ? <p className="text-xs text-stone-500">Kho {unitLabel(db, c.unitId)}</p>
                  : rsv && <p className="text-xs text-amber-700">Kèm đặt chỗ <span className="font-mono">{rsv}</span>{!o.paymentId && ' — thu khi nhận kho'}</p>}
              </div>
            );
          } },
          { key: 's', header: 'Dịch vụ', cell: (o) => <div><p>{o.serviceName} × {o.quantity} {o.unitLabel}</p>{o.note && <p className="text-xs text-stone-500">{o.note}</p>}</div> },
          { key: 'd', header: 'Ngày mong muốn', cell: (o) => fmtDate(o.preferredDate) },
          { key: 't', header: 'Tiền', className: 'tabular-nums', cell: (o) => <div><p>{vnd(o.total)}</p>{!o.paymentId && o.status === 'REQUESTED' && <p className="text-xs text-amber-700">Chưa thu</p>}</div> },
          { key: 'st', header: 'Trạng thái', cell: (o) => <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} /> },
          { key: 'a', header: '', className: 'text-right', cell: (o) => o.status === 'REQUESTED' && (
            <div className="flex justify-end gap-1.5">
              {o.paymentId && <Button size="sm" onClick={() => void run('completeServiceOrder', { orderId: o._id }, 'Đã xác nhận hoàn thành')}><Check className="size-3.5" />Hoàn thành</Button>}
              <Button size="sm" variant="ghost" onClick={() => setCancel(o)}><X className="size-3.5" />Huỷ</Button>
            </div>
          ) },
        ]} />
      </Card>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title={cancel?.paymentId ? 'Huỷ đơn và hoàn tiền?' : 'Huỷ đơn?'} description={cancel?.orderNumber}
        footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Giữ lại</Button><Button variant="danger" onClick={() => cancel && void run('cancelServiceOrder', { orderId: cancel._id, reason: 'Chi nhánh không thực hiện được' }, cancel.paymentId ? `Đã huỷ — hoàn ${vnd(cancel.total)}` : 'Đã huỷ đơn', () => setCancel(null))}>{cancel?.paymentId ? 'Huỷ & hoàn tiền' : 'Huỷ đơn'}</Button></>}>
        <p className="text-sm text-stone-600">{cancel?.paymentId && <>Khách được hoàn <b>đủ {vnd(cancel.total)}</b>. </>}Đơn đã huỷ không khôi phục được.</p>
      </Modal>
    </>
  );
}
