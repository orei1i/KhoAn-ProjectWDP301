'use client';

import { useState } from 'react';
import { Banknote, CalendarDays, Check, ConciergeBell, UserRound, Warehouse, X } from 'lucide-react';
import type { ServiceOrder } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { SERVICE_ORDER_STATUS } from '@/shared/lib/labels';
import { byId, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, IconTile, Modal, PageHeader, StatusBadge, Tabs } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { serviceIcon } from '@/features/facilities/visuals';
import { Callout, Meta, QueueRow } from '@/features/staff-ui';

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
        {rows.length === 0 ? <EmptyState icon={<ConciergeBell className="size-6" />} title="Không có đơn dịch vụ" /> : (
          <ul className="divide-y divide-stone-100">
            {rows.map((o) => {
              const c = byId(db.contracts, o.contractId);
              const rsv = bookingCode(o);
              const Icon = serviceIcon(byId(db.services, o.serviceId)?.code);
              const unpaid = !o.paymentId && o.status === 'REQUESTED';
              return (
                <QueueRow key={o._id}
                  lead={<IconTile icon={<Icon className="size-4" />} tone={SERVICE_ORDER_STATUS[o.status].tone} />}
                  title={`${o.serviceName} × ${o.quantity} ${o.unitLabel}`}
                  badges={<StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />}
                  meta={<>
                    <Meta mono>{o.orderNumber}</Meta>
                    <Meta icon={<UserRound />} className="font-medium text-stone-700">{userName(db, o.customerId)}</Meta>
                    {c ? <Meta icon={<Warehouse />}>Kho {unitLabel(db, c.unitId)}</Meta>
                      : rsv && <Meta icon={<Warehouse />} className="text-amber-700">Kèm đặt chỗ <span className="font-mono">{rsv}</span>{!o.paymentId && ' — thu khi nhận kho'}</Meta>}
                    <Meta icon={<CalendarDays />}>{fmtDate(o.preferredDate)}</Meta>
                    <Meta icon={<Banknote />} className="font-medium tabular-nums text-stone-700">{vnd(o.total)}</Meta>
                    {unpaid && <Badge tone="amber">Chưa thu</Badge>}
                    {o.note && <span className="basis-full text-stone-600">{o.note}</span>}
                  </>}
                  actions={o.status === 'REQUESTED' && (
                    <>
                      {o.paymentId && <Button size="sm" onClick={() => void run('completeServiceOrder', { orderId: o._id }, 'Đã xác nhận hoàn thành')}><Check className="size-3.5" />Hoàn thành</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setCancel(o)}><X className="size-3.5" />Huỷ</Button>
                    </>
                  )}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title={cancel?.paymentId ? 'Huỷ đơn và hoàn tiền?' : 'Huỷ đơn?'} description={cancel?.orderNumber}
        footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Giữ lại</Button><Button variant="danger" onClick={() => cancel && void run('cancelServiceOrder', { orderId: cancel._id, reason: 'Chi nhánh không thực hiện được' }, cancel.paymentId ? `Đã huỷ — hoàn ${vnd(cancel.total)}` : 'Đã huỷ đơn', () => setCancel(null))}>{cancel?.paymentId ? 'Huỷ & hoàn tiền' : 'Huỷ đơn'}</Button></>}>
        <div className="space-y-3 text-sm text-stone-600">
          {cancel?.paymentId && <Callout tone="green" icon={<Banknote />}>Khách được hoàn <b>đủ {vnd(cancel.total)}</b>.</Callout>}
          <p>Đơn đã huỷ không khôi phục được.</p>
        </div>
      </Modal>
    </>
  );
}
