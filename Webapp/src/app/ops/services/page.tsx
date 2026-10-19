'use client';

import { useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ServiceOffering } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { FACILITY_STATUS } from '@/shared/lib/labels';
import { vnd } from '@/shared/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, PageHeader, Table, cx, inputCls } from '@/shared/ui';

const EMPTY = { _id: undefined as string | undefined, code: '', name: '', description: '', price: 0, unitLabel: 'lần' };

export default function OpsServices() {
  const { db, run } = useStore();
  const facilities = db.facilities.filter((f) => !f.isDeleted);
  const [facilityId, setFacilityId] = useState(facilities.find((f) => f.status === 'ACTIVE')?._id ?? facilities[0]?._id ?? '');
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const facility = facilities.find((f) => f._id === facilityId);
  const mine = db.services.filter((s) => s.facilityId === facilityId && !s.isDeleted).sort((a, b) => a.name.localeCompare(b.name));
  // Ma trận so giá: mỗi dịch vụ (theo mã) một hàng, mỗi chi nhánh một cột.
  const codes = [...new Set(db.services.filter((s) => !s.isDeleted).map((s) => s.code))].sort();
  const edit = (s: ServiceOffering) => setForm({ _id: s._id, code: s.code, name: s.name, description: s.description ?? '', price: s.price, unitLabel: s.unitLabel });
  const valid = !!form && form.name.trim().length >= 2 && form.price >= 1_000 && form.unitLabel.trim().length >= 1 && (!!form._id || /^[A-Za-z0-9-]{2,30}$/.test(form.code));
  const save = () => {
    if (!form || !facility) return;
    const body = { name: form.name, description: form.description, price: form.price, unitLabel: form.unitLabel };
    if (form._id) void run('updateServiceOffering', { serviceId: form._id, ...body }, 'Đã cập nhật dịch vụ', () => setForm(null));
    else void run('createServiceOffering', { facilityId: facility._id, code: form.code, ...body }, 'Đã thêm dịch vụ', () => setForm(null));
  };

  return (
    <>
      <PageHeader title="Dịch vụ thêm" description="Danh mục dịch vụ khách đặt thêm sau khi thuê (đóng gói, vận chuyển, vệ sinh...). Mỗi chi nhánh tự đặt giá; đơn đã đặt giữ nguyên giá đã chốt."
        actions={
          <>
            <select className={cx(inputCls, 'w-auto min-w-56')} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              {facilities.map((f) => <option key={f._id} value={f._id}>{f.name} · {FACILITY_STATUS[f.status].label}</option>)}
            </select>
            <Button onClick={() => setForm({ ...EMPTY })} disabled={!facility}><Plus className="size-4" />Thêm dịch vụ</Button>
          </>
        } />

      <Card>
        <CardHeader title={`Dịch vụ của ${facility?.name ?? '—'}`} />
        <Table rows={mine} rowKey={(s) => s._id} empty={<EmptyState title="Chi nhánh chưa có dịch vụ thêm" description="Bấm “Thêm dịch vụ” để tạo dịch vụ đầu tiên." />} columns={[
          { key: 'n', header: 'Dịch vụ', cell: (s) => <div><p className="font-medium">{s.name}</p><p className="text-xs text-stone-500">{s.code}{s.description ? ` · ${s.description}` : ''}</p></div> },
          { key: 'p', header: 'Giá', className: 'tabular-nums', cell: (s) => <span>{vnd(s.price)} <span className="text-stone-500">/ {s.unitLabel}</span></span> },
          { key: 's', header: 'Trạng thái', cell: (s) => (s.isActive ? <Badge tone="green">Đang bán</Badge> : <Badge>Đã ẩn</Badge>) },
          { key: 'a', header: '', className: 'text-right', cell: (s) => (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" aria-label="Sửa" onClick={() => edit(s)}><Pencil className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" aria-label={s.isActive ? 'Ẩn' : 'Hiện'} onClick={() => void run('updateServiceOffering', { serviceId: s._id, isActive: !s.isActive }, s.isActive ? 'Đã ẩn dịch vụ' : 'Đã hiện dịch vụ')}>{s.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</Button>
              <Button size="sm" variant="ghost" aria-label="Xoá" onClick={() => { if (window.confirm(`Xoá dịch vụ ${s.name}? Đơn đã đặt vẫn giữ nguyên.`)) void run('deleteServiceOffering', { serviceId: s._id }, 'Đã xoá dịch vụ'); }}><Trash2 className="size-3.5 text-red-600" /></Button>
            </div>
          ) },
        ]} />
      </Card>

      <Card className="mt-6">
        <CardHeader title="So sánh giá giữa các chi nhánh" description="Giá đang bán; “—” nghĩa là chi nhánh không cung cấp dịch vụ đó." />
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5 font-medium">Dịch vụ</th>
              {facilities.map((f) => <th key={f._id} className="px-4 py-2.5 font-medium">{f.name}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-stone-100">
              {codes.map((code) => {
                const sample = db.services.find((s) => s.code === code && !s.isDeleted)!;
                return (
                  <tr key={code}>
                    <td className="px-4 py-3"><p className="font-medium">{sample.name}</p><p className="text-xs text-stone-500">{code} · {sample.unitLabel}</p></td>
                    {facilities.map((f) => {
                      const s = db.services.find((x) => x.facilityId === f._id && x.code === code && !x.isDeleted);
                      return <td key={f._id} className={cx('px-4 py-3 tabular-nums', !s && 'text-stone-400', s && !s.isActive && 'text-stone-400 line-through')}>{s ? vnd(s.price) : '—'}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?._id ? 'Sửa dịch vụ' : 'Thêm dịch vụ'} description={facility ? `Chi nhánh ${facility.name}` : ''}
        footer={<Button disabled={!valid} onClick={save}>Lưu</Button>}>
        {form && (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <Field label="Tên dịch vụ"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Vận chuyển nội thành" /></Field>
              <Field label="Mã" hint="Duy nhất trong chi nhánh"><input className={inputCls} value={form.code} disabled={!!form._id} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MOVE-CITY" /></Field>
            </div>
            <Field label="Mô tả"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Đơn giá (₫)"><input className={cx(inputCls, 'tabular-nums')} inputMode="numeric" value={new Intl.NumberFormat('vi-VN').format(form.price)} onChange={(e) => setForm({ ...form, price: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
              <Field label="Đơn vị tính" hint="lần, thùng, giờ, chuyến, tháng..."><input className={inputCls} value={form.unitLabel} onChange={(e) => setForm({ ...form, unitLabel: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
