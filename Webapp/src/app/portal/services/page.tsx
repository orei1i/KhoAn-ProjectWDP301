'use client';

import { useState } from 'react';
import { PackagePlus } from 'lucide-react';
import type { PaymentMethod, ServiceOffering, ServiceOrder } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { SERVICE_ORDER_STATUS } from '@/shared/lib/labels';
import { facilityName, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, CardHeader, EmptyState, Field, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { PayMethodPicker } from '@/features/payments/pay-method';

export default function MyServices() {
  const { db, user, run } = useStore();
  const [contractId, setContractId] = useState('');
  const [order, setOrder] = useState<ServiceOffering | null>(null);
  const [cancel, setCancel] = useState<ServiceOrder | null>(null);
  const [form, setForm] = useState({ quantity: 1, date: addDays(todayISO(), 2).slice(0, 10), note: '' });
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');
  if (!user) return null;

  // Chỉ hợp đồng đang hiệu lực, không có công nợ mới đặt được dịch vụ (khớp luật BE).
  const contracts = db.contracts.filter((c) => c.customerId === user._id && c.status === 'ACTIVE');
  const contract = contracts.find((c) => c._id === contractId) ?? contracts[0];
  const offerings = contract ? db.services.filter((s) => s.facilityId === contract.facilityId && s.isActive && !s.isDeleted).sort((a, b) => a.price - b.price) : [];
  const orders = db.serviceOrders.filter((o) => o.customerId === user._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = order ? order.price * form.quantity : 0;

  return (
    <>
      <PageHeader title="Dịch vụ thêm" description="Đóng gói, vận chuyển, vệ sinh... đặt thêm cho kho đang thuê. Giá theo từng chi nhánh, thanh toán ngay khi đặt, huỷ trước khi thực hiện được hoàn đủ tiền." />

      {contracts.length === 0 ? (
        <Card><EmptyState title="Chưa có kho đang thuê" description="Dịch vụ thêm dành cho khách đã nhận kho (hợp đồng đang hiệu lực, không có công nợ)." action={<ButtonLink href="/facilities">Tìm kho</ButtonLink>} /></Card>
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
            {offerings.length === 0 ? <EmptyState title="Chi nhánh chưa có dịch vụ thêm" /> : (
              <ul className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {offerings.map((s) => (
                  <li key={s._id} className="flex flex-col rounded-xl p-4 ring-1 ring-stone-200">
                    <p className="font-semibold">{s.name}</p>
                    <p className="mt-1 flex-1 text-sm text-stone-600">{s.description}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-sm"><b className="tabular-nums">{vnd(s.price)}</b><span className="text-stone-500"> / {s.unitLabel}</span></p>
                      <Button size="sm" onClick={() => { setForm({ quantity: 1, date: addDays(todayISO(), 2).slice(0, 10), note: '' }); setOrder(s); }}><PackagePlus className="size-3.5" />Đặt</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Card className="mt-6">
        <CardHeader title="Đơn dịch vụ của tôi" />
        <Table rows={orders} rowKey={(o) => o._id} empty={<EmptyState title="Chưa có đơn dịch vụ" />} columns={[
          { key: 'n', header: 'Mã đơn', cell: (o) => <span className="font-mono text-xs">{o.orderNumber}</span> },
          { key: 's', header: 'Dịch vụ', cell: (o) => <div><p className="font-medium">{o.serviceName} × {o.quantity} {o.unitLabel}</p><p className="text-xs text-stone-500">{facilityName(db, o.facilityId)}{o.note ? ` · ${o.note}` : ''}</p></div> },
          { key: 'd', header: 'Ngày mong muốn', cell: (o) => fmtDate(o.preferredDate) },
          { key: 't', header: 'Tổng', className: 'tabular-nums', cell: (o) => vnd(o.total) },
          { key: 'st', header: 'Trạng thái', cell: (o) => <div><StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />{o.status === 'CANCELLED' && <p className="mt-1 text-xs text-stone-500">Đã hoàn {vnd(o.total)}</p>}</div> },
          { key: 'a', header: '', className: 'text-right', cell: (o) => o.status === 'REQUESTED' && <Button size="sm" variant="ghost" onClick={() => setCancel(o)}>Huỷ</Button> },
        ]} />
      </Card>

      <Modal open={!!order} onClose={() => setOrder(null)} title={order ? `Đặt: ${order.name}` : ''} description={order ? `${vnd(order.price)} / ${order.unitLabel}` : ''}
        footer={<Button onClick={() => contract && order && void run('orderService', { contractId: contract._id, serviceId: order._id, quantity: form.quantity, preferredDate: form.date, note: form.note, method }, `Đã đặt và thanh toán ${vnd(total)}`, () => setOrder(null))}>Thanh toán {vnd(total)}</Button>}>
        {order && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Số lượng (${order.unitLabel})`}><input type="number" min={1} max={99} className={inputCls} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1))) })} /></Field>
              <Field label="Ngày mong muốn"><input type="date" className={inputCls} min={todayISO().slice(0, 10)} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            </div>
            <Field label="Ghi chú cho nhân viên" hint="Không bắt buộc"><input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="VD: giao thùng buổi sáng, gọi trước khi đến" /></Field>
            <div className={cx('rounded-lg bg-stone-50 p-3 text-sm')}>Tổng cộng: <b className="tabular-nums">{vnd(total)}</b></div>
            <PayMethodPicker value={method} onChange={setMethod} />
          </div>
        )}
      </Modal>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Huỷ đơn dịch vụ?" description={cancel?.orderNumber}
        footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Giữ lại</Button><Button variant="danger" onClick={() => cancel && void run('cancelServiceOrder', { orderId: cancel._id }, `Đã huỷ — hoàn ${vnd(cancel.total)}`, () => setCancel(null))}>Xác nhận huỷ</Button></>}>
        <p className="text-sm text-stone-600">Đơn chưa được thực hiện nên bạn được hoàn <b>đủ {vnd(cancel?.total ?? 0)}</b> về tài khoản trong 3–5 ngày làm việc.</p>
      </Modal>
    </>
  );
}
