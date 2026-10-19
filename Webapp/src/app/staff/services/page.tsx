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

  return (
    <>
      <PageHeader title="Dịch vụ yêu cầu" description="Đơn dịch vụ thêm khách đã đặt và thanh toán. Thực hiện xong thì xác nhận; không thực hiện được thì huỷ để hoàn đủ tiền cho khách." actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[{ key: 'open', label: 'Chờ thực hiện', count: open.length }, { key: 'all', label: 'Tất cả', count: all.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={rows} rowKey={(o) => o._id} empty={<EmptyState title="Không có đơn dịch vụ" />} columns={[
          { key: 'n', header: 'Mã đơn', cell: (o) => <span className="font-mono text-xs">{o.orderNumber}</span> },
          { key: 'c', header: 'Khách / kho', cell: (o) => { const c = byId(db.contracts, o.contractId); return <div><p className="font-medium">{userName(db, o.customerId)}</p><p className="text-xs text-stone-500">Kho {c ? unitLabel(db, c.unitId) : '—'}</p></div>; } },
          { key: 's', header: 'Dịch vụ', cell: (o) => <div><p>{o.serviceName} × {o.quantity} {o.unitLabel}</p>{o.note && <p className="text-xs text-stone-500">{o.note}</p>}</div> },
          { key: 'd', header: 'Ngày mong muốn', cell: (o) => fmtDate(o.preferredDate) },
          { key: 't', header: 'Đã thu', className: 'tabular-nums', cell: (o) => vnd(o.total) },
          { key: 'st', header: 'Trạng thái', cell: (o) => <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} /> },
          { key: 'a', header: '', className: 'text-right', cell: (o) => o.status === 'REQUESTED' && (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" onClick={() => void run('completeServiceOrder', { orderId: o._id }, 'Đã xác nhận hoàn thành')}><Check className="size-3.5" />Hoàn thành</Button>
              <Button size="sm" variant="ghost" onClick={() => setCancel(o)}><X className="size-3.5" />Huỷ</Button>
            </div>
          ) },
        ]} />
      </Card>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Huỷ đơn và hoàn tiền?" description={cancel?.orderNumber}
        footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Giữ lại</Button><Button variant="danger" onClick={() => cancel && void run('cancelServiceOrder', { orderId: cancel._id, reason: 'Chi nhánh không thực hiện được' }, `Đã huỷ — hoàn ${vnd(cancel.total)}`, () => setCancel(null))}>Huỷ & hoàn tiền</Button></>}>
        <p className="text-sm text-stone-600">Khách được hoàn <b>đủ {vnd(cancel?.total ?? 0)}</b>. Đơn chuyển sang “Đã huỷ” và không khôi phục được.</p>
      </Modal>
    </>
  );
}
