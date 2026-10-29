'use client';

import { useState } from 'react';
import { ConciergeBell, Eye, EyeOff, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import type { ServiceOffering } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { FACILITY_STATUS } from '@/shared/lib/labels';
import { vnd } from '@/shared/lib/format';
import { Badge, Button, Card, Disclosure, EmptyState, Field, IconTile, Modal, PageHeader, cx, inputCls } from '@/shared/ui';
import { serviceIcon } from '@/features/facilities/visuals';
import { Meta, PanelHeader, QueueRow } from '@/features/staff-ui';

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
      <PageHeader title="Dịch vụ thêm" description="Mỗi chi nhánh tự đặt giá; đơn đã đặt giữ giá đã chốt."
        actions={
          <>
            <select className={cx(inputCls, 'w-auto min-w-56')} aria-label="Chi nhánh" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              {facilities.map((f) => <option key={f._id} value={f._id}>{f.name} · {FACILITY_STATUS[f.status].label}</option>)}
            </select>
            <Button onClick={() => setForm({ ...EMPTY })} disabled={!facility}><Plus className="size-4" />Thêm dịch vụ</Button>
          </>
        } />

      <Card>
        <PanelHeader icon={<ConciergeBell className="size-4" />} title={`Dịch vụ của ${facility?.name ?? '—'}`} count={mine.length} />
        {mine.length === 0 ? <EmptyState icon={<ConciergeBell className="size-6" />} title="Chi nhánh chưa có dịch vụ thêm" description="Bấm “Thêm dịch vụ” để tạo dịch vụ đầu tiên." /> : (
          <ul className="divide-y divide-stone-100">
            {mine.map((s) => {
              const Icon = serviceIcon(s.code);
              return (
                <QueueRow key={s._id} className={s.isActive ? undefined : 'bg-stone-50/60'}
                  lead={<IconTile icon={<Icon className="size-4" />} tone={s.isActive ? 'teal' : 'gray'} />}
                  title={s.name}
                  badges={s.isActive ? <Badge tone="green" dot>Đang bán</Badge> : <Badge dot>Đã ẩn</Badge>}
                  meta={<>
                    <Meta mono>{s.code}</Meta>
                    {s.description && <Meta>{s.description}</Meta>}
                  </>}
                  actions={<>
                    <span className="mr-1 whitespace-nowrap text-sm font-semibold tabular-nums text-ink">{vnd(s.price)} <span className="text-xs font-normal text-stone-500">/ {s.unitLabel}</span></span>
                    <Button size="sm" variant="ghost" aria-label="Sửa" onClick={() => edit(s)}><Pencil className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" aria-label={s.isActive ? 'Ẩn' : 'Hiện'} onClick={() => void run('updateServiceOffering', { serviceId: s._id, isActive: !s.isActive }, s.isActive ? 'Đã ẩn dịch vụ' : 'Đã hiện dịch vụ')}>{s.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</Button>
                    <Button size="sm" variant="ghost" aria-label="Xoá" onClick={() => { if (window.confirm(`Xoá dịch vụ ${s.name}? Đơn đã đặt vẫn giữ nguyên.`)) void run('deleteServiceOffering', { serviceId: s._id }, 'Đã xoá dịch vụ'); }}><Trash2 className="size-3.5 text-red-600" /></Button>
                  </>}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Disclosure className="mt-6 shadow-card" icon={<Scale className="size-4" />} title="So sánh giá giữa các chi nhánh" meta={`${codes.length} dịch vụ · ${facilities.length} chi nhánh`}>
        <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
          <span>“—”: chi nhánh không có dịch vụ đó</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" aria-hidden />Giá thấp nhất</span>
          <span className="line-through">Đang ẩn</span>
        </p>
        <div className="-mx-4 -mb-4 overflow-x-auto rounded-b-xl border-t border-stone-100">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5 font-medium">Dịch vụ</th>
              {facilities.map((f) => <th key={f._id} className="px-4 py-2.5 font-medium">{f.name}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-stone-100">
              {codes.map((code) => {
                const sample = db.services.find((s) => s.code === code && !s.isDeleted)!;
                const Icon = serviceIcon(code);
                const prices = facilities.map((f) => db.services.find((x) => x.facilityId === f._id && x.code === code && !x.isDeleted)).filter((x) => x?.isActive).map((x) => x!.price);
                const min = prices.length > 1 ? Math.min(...prices) : null;
                return (
                  <tr key={code}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <IconTile icon={<Icon className="size-4" />} size="sm" tone="gray" />
                        <div className="min-w-0"><p className="font-medium">{sample.name}</p><p className="text-xs text-stone-500">{code} · {sample.unitLabel}</p></div>
                      </div>
                    </td>
                    {facilities.map((f) => {
                      const s = db.services.find((x) => x.facilityId === f._id && x.code === code && !x.isDeleted);
                      const low = !!s && s.isActive && min !== null && s.price === min;
                      return (
                        <td key={f._id} className={cx('whitespace-nowrap px-4 py-3 tabular-nums', !s && 'text-stone-400', s && !s.isActive && 'text-stone-400 line-through', low && 'font-semibold text-emerald-700')}>
                          {low && <span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-500 align-middle" aria-hidden />}{s ? vnd(s.price) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Disclosure>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?._id ? 'Sửa dịch vụ' : 'Thêm dịch vụ'} description={facility ? `Chi nhánh ${facility.name}` : ''}
        footer={<Button disabled={!valid} onClick={save}>Lưu</Button>}>
        {form && (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <Field label="Tên dịch vụ"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Vận chuyển nội thành" /></Field>
              <Field label="Mã" tip="Duy nhất trong chi nhánh; không sửa được sau khi tạo."><input className={inputCls} value={form.code} disabled={!!form._id} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MOVE-CITY" /></Field>
            </div>
            <Field label="Mô tả"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Đơn giá (₫)"><input className={cx(inputCls, 'tabular-nums')} inputMode="numeric" value={new Intl.NumberFormat('vi-VN').format(form.price)} onChange={(e) => setForm({ ...form, price: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
              <Field label="Đơn vị tính" tip="lần, thùng, giờ, chuyến, tháng..."><input className={inputCls} value={form.unitLabel} onChange={(e) => setForm({ ...form, unitLabel: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
