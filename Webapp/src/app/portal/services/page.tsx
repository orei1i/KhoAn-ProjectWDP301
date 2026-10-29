'use client';

import { useState } from 'react';
import { ClipboardList, PackagePlus, Warehouse } from 'lucide-react';
import type { ServiceOffering, ServiceOrder } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { SERVICE_ORDER_STATUS } from '@/shared/lib/labels';
import { facilityName, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { serviceIcon } from '@/features/facilities/visuals';
import { MockGateway, type GatewayOrder } from '@/features/payments/mock-gateway';

export default function MyServices() {
  const { db, user, run } = useStore();
  const [contractId, setContractId] = useState('');
  const [order, setOrder] = useState<ServiceOffering | null>(null);
  const [cancel, setCancel] = useState<ServiceOrder | null>(null);
  const [form, setForm] = useState({ quantity: 1, date: addDays(todayISO(), 2).slice(0, 10), note: '' });
  // Cổng thanh toán (giả lập): đơn dịch vụ thêm trả ngay khi đặt.
  const [gateway, setGateway] = useState<GatewayOrder | null>(null);
  if (!user) return null;

  // Chỉ hợp đồng đang hiệu lực, không có công nợ mới đặt được dịch vụ (khớp luật BE).
  const contracts = db.contracts.filter((c) => c.customerId === user._id && c.status === 'ACTIVE');
  const contract = contracts.find((c) => c._id === contractId) ?? contracts[0];
  const offerings = contract ? db.services.filter((s) => s.facilityId === contract.facilityId && s.isActive && !s.isDeleted).sort((a, b) => a.price - b.price) : [];
  const orders = db.serviceOrders.filter((o) => o.customerId === user._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = order ? order.price * form.quantity : 0;

  return (
    <>
      <PageHeader title="Dịch vụ thêm" description="Thanh toán ngay khi đặt, huỷ trước khi thực hiện được hoàn đủ tiền." />

      {contracts.length === 0 ? (
        <Card><EmptyState icon={<Warehouse className="size-6" />} title="Chưa có kho đang thuê" description="Dịch vụ thêm dành cho khách đã nhận kho (hợp đồng đang hiệu lực, không có công nợ)." action={<ButtonLink href="/facilities">Tìm kho</ButtonLink>} /></Card>
      ) : (
        <>
          {contracts.length > 1 && (
            <div className="mb-4 max-w-sm">
              <Field label="Áp dụng cho kho">
                <select className={inputCls} value={contract?._id} onChange={(e) => setContractId(e.target.value)}>
                  {contracts.map((c) => <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {facilityName(db, c.facilityId)}</option>)}
                </select>
              </Field>
            </div>
          )}
          <Card>
            <CardHeader title={`Dịch vụ tại ${facilityName(db, contract!.facilityId)}`} description={`Kho ${unitLabel(db, contract!.unitId)}`} />
            {offerings.length === 0 ? <EmptyState icon={<PackagePlus className="size-6" />} title="Chi nhánh chưa có dịch vụ thêm" /> : (
              <ul className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {offerings.map((s) => {
                  const Icon = serviceIcon(s.code);
                  return (
                    <li key={s._id} className="group flex flex-col rounded-2xl bg-white p-4 ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:shadow-lift">
                      <div className="flex items-start gap-3">
                        <IconTile icon={<Icon className="size-5" />} />
                        <div className="min-w-0">
                          <p className="font-semibold leading-snug">{s.name}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-stone-500" title={s.description}>{s.description}</p>
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                        <p className="text-sm"><b className="text-lg tabular-nums text-brand-700">{vnd(s.price)}</b><span className="text-stone-500"> / {s.unitLabel}</span></p>
                        <Button size="sm" onClick={() => { setForm({ quantity: 1, date: addDays(todayISO(), 2).slice(0, 10), note: '' }); setOrder(s); }}><PackagePlus className="size-3.5" />Đặt</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      <Card className="mt-6">
        <CardHeader title="Đơn dịch vụ của tôi" />
        <Table rows={orders} rowKey={(o) => o._id} empty={<EmptyState icon={<ClipboardList className="size-6" />} title="Chưa có đơn dịch vụ" />} columns={[
          { key: 'n', header: 'Mã đơn', cell: (o) => <span className="font-mono text-xs">{o.orderNumber}</span> },
          { key: 's', header: 'Dịch vụ', cell: (o) => <div><p className="font-medium">{o.serviceName} × {o.quantity} {o.unitLabel}</p><p className="text-xs text-stone-500">{facilityName(db, o.facilityId)}{o.reservationId ? ` · kèm đặt chỗ ${db.reservations.find((r) => r._id === String(o.reservationId))?.code ?? ''}` : ''}{o.note ? ` · ${o.note}` : ''}</p></div> },
          { key: 'd', header: 'Ngày mong muốn', cell: (o) => fmtDate(o.preferredDate) },
          { key: 't', header: 'Tổng', className: 'tabular-nums', cell: (o) => vnd(o.total) },
          // Đơn kèm đặt chỗ chưa có phiếu thu: thu khi nhận kho; huỷ thì không có gì để hoàn.
          { key: 'st', header: 'Trạng thái', cell: (o) => <div>{o.status === 'REQUESTED' && !o.paymentId ? <Badge tone="amber" dot>Thu khi nhận kho</Badge> : <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />}{o.status === 'CANCELLED' && o.paymentId && <p className="mt-1 text-xs text-stone-500">Đã hoàn {vnd(o.total)}</p>}</div> },
          { key: 'a', header: '', className: 'text-right', cell: (o) => o.status === 'REQUESTED' && <Button size="sm" variant="ghost" onClick={() => setCancel(o)}>Huỷ</Button> },
        ]} />
      </Card>

      <Modal open={!!order} onClose={() => setOrder(null)} title={order ? `Đặt: ${order.name}` : ''} description={order ? `${vnd(order.price)} / ${order.unitLabel}` : ''}
        footer={<Button onClick={() => contract && order && setGateway({
          facilityId: contract.facilityId, code: contract.contractNumber, purpose: `Dịch vụ ${order.name} × ${form.quantity} ${order.unitLabel}`, amount: total,
          pay: (m) => run('orderService', { contractId: contract._id, serviceId: order._id, quantity: form.quantity, preferredDate: form.date, note: form.note, method: m }, `Đã đặt và thanh toán ${vnd(total)}`),
          back: { label: 'Về dịch vụ thêm' },
        })}>Thanh toán {vnd(total)}</Button>}>
        {order && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Số lượng (${order.unitLabel})`}><input type="number" min={1} max={99} className={inputCls} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1))) })} /></Field>
              <Field label="Ngày mong muốn"><input type="date" className={inputCls} min={todayISO().slice(0, 10)} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            </div>
            <Field label="Ghi chú cho nhân viên" hint="Không bắt buộc"><input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="VD: giao thùng buổi sáng, gọi trước khi đến" /></Field>
            <div className={cx('flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-inset ring-brand-100')}>Tổng cộng <b className="text-lg tabular-nums">{vnd(total)}</b></div>
          </div>
        )}
      </Modal>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Huỷ đơn dịch vụ?" description={cancel?.orderNumber}
        footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Giữ lại</Button><Button variant="danger" onClick={() => cancel && void run('cancelServiceOrder', { orderId: cancel._id }, cancel.paymentId ? `Đã huỷ — hoàn ${vnd(cancel.total)}` : 'Đã huỷ đơn dịch vụ', () => setCancel(null))}>Xác nhận huỷ</Button></>}>
        <p className="text-sm text-stone-600">{cancel?.paymentId ? <>Bạn được hoàn <b>đủ {vnd(cancel.total)}</b>, trong tối đa 7 ngày làm việc.</> : 'Đơn chưa thanh toán — huỷ không mất phí.'}</p>
      </Modal>
      <MockGateway order={gateway} onClose={(paid) => { setGateway(null); if (paid) setOrder(null); }} />
    </>
  );
}
