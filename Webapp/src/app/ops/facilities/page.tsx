'use client';

import { useState } from 'react';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import type { Facility, FacilityStatus } from '@ssm/shared';
import { FACILITY_CODE_MESSAGE, FACILITY_CODE_RE, PHONE_MESSAGE, isValidPhone } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { FACILITY_STATUS } from '@/shared/lib/labels';
import { effectivePolicy, facilityStats } from '@/shared/lib/domain';
import { pct } from '@/shared/lib/format';
import { Button, ButtonLink, Card, Field, Modal, PageHeader, StatusBadge, Table, inputCls } from '@/shared/ui';

const DEFAULT_CITY = 'TP. Hồ Chí Minh';
const EMPTY = { _id: undefined as string | undefined, name: '', code: '', status: 'UNDER_CONSTRUCTION' as FacilityStatus, line1: '', district: '', city: DEFAULT_CITY, phone: '' };

/** Cùng luật với BE (facilityBody) — báo lỗi ngay dưới từng ô trước khi gửi lên server. */
function facilityErrors(f: typeof EMPTY) {
  const e: Partial<Record<'name' | 'code' | 'line1' | 'district' | 'city' | 'phone', string>> = {};
  if (f.name.trim().length < 3) e.name = 'Tên chi nhánh tối thiểu 3 ký tự';
  if (!f._id && !FACILITY_CODE_RE.test(f.code.trim())) e.code = FACILITY_CODE_MESSAGE;
  if (f.line1.trim().length < 3) e.line1 = 'Số nhà, tên đường tối thiểu 3 ký tự';
  if (f.district.trim().length < 2) e.district = 'Nhập quận / huyện (tối thiểu 2 ký tự)';
  if (f.city.trim().length < 2) e.city = 'Nhập tỉnh / thành phố (tối thiểu 2 ký tự)';
  if (!isValidPhone(f.phone.trim())) e.phone = PHONE_MESSAGE;
  return e;
}

export default function OpsFacilities() {
  const { db, run, toast } = useStore();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [showErr, setShowErr] = useState(false);
  const errs = form && showErr ? facilityErrors(form) : {};
  const open = (f: typeof EMPTY | null) => { setShowErr(false); setForm(f); };
  const save = () => {
    if (!form) return;
    if (Object.keys(facilityErrors(form)).length) { setShowErr(true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; }
    void run('saveFacility', form, 'Đã lưu chi nhánh', () => setForm(null));
  };
  const edit = (f: Facility) => open({ _id: f._id, name: f.name, code: f.code, status: f.status, line1: f.address.line1, district: f.address.district, city: f.address.city || DEFAULT_CITY, phone: f.contact.phone });

  return (
    <>
      <PageHeader title="Chi nhánh" description="Chi nhánh mới cần thêm loại kho và ô kho trước khi nhận đặt chỗ." actions={<Button onClick={() => open({ ...EMPTY })}><Plus className="size-4" />Thêm chi nhánh</Button>} />
      <Card>
        <Table rows={db.facilities.filter((f) => !f.isDeleted)} rowKey={(f) => f._id} onRowClick={edit} columns={[
          { key: 'c', header: 'Mã', cell: (f) => <span className="font-mono text-xs">{f.code}</span> },
          { key: 'n', header: 'Tên', cell: (f) => <div><p className="font-medium">{f.name}</p><p className="text-xs text-stone-500">{f.address.line1}, {f.address.district}</p></div> },
          { key: 's', header: 'Trạng thái', cell: (f) => <StatusBadge map={FACILITY_STATUS} value={f.status} /> },
          { key: 'u', header: 'Số kho', className: 'text-right tabular-nums', cell: (f) => facilityStats(db, f._id).total },
          { key: 'o', header: 'Lấp đầy', className: 'text-right tabular-nums', cell: (f) => pct(facilityStats(db, f._id).occupancy) },
          { key: 'p', header: 'Chính sách', cell: (f) => { const p = effectivePolicy(db, f._id); return <span className="text-xs">{p.scope === 'FACILITY' ? 'Riêng' : 'Toàn chuỗi'} v{p.version}</span>; } },
          { key: 'm', header: 'Quản lý', cell: (f) => <span className="text-xs">{db.users.filter((u) => u.role === 'FACILITY_MANAGER' && u.facilityIds.includes(f._id)).map((u) => u.fullName).join(', ') || '—'}</span> },
          { key: 'i', header: '', className: 'text-right', cell: (f) => <div onClick={(e) => e.stopPropagation()}><ButtonLink href={`/ops/inventory?facility=${f._id}`} size="sm" variant="secondary"><Boxes className="size-3.5" />Loại kho & ô</ButtonLink></div> },
        ]} />
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?._id ? 'Sửa chi nhánh' : 'Thêm chi nhánh'}
        footer={form && (
          <>
            {form._id && (
              <Button variant="danger" onClick={() => { if (window.confirm(`Xoá chi nhánh ${form.name}? Chỉ xoá được khi chưa có ô kho/đặt chỗ/hợp đồng nào.`)) void run('deleteFacility', { facilityId: form._id! }, 'Đã xoá chi nhánh', () => setForm(null)); }}><Trash2 className="size-4" />Xoá</Button>
            )}
            <Button onClick={save}>Lưu</Button>
          </>
        )}>
        {form && (
          <div className="grid gap-4">
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <Field label="Tên chi nhánh" error={errs.name}><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Mã" error={errs.code}><input className={inputCls} value={form.code} disabled={!!form._id} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="HCM-GV-01" /></Field>
            </div>
            <Field label="Số nhà, tên đường" error={errs.line1}><input className={inputCls} value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} placeholder="VD 123 Nguyễn Văn Linh" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quận / Huyện" error={errs.district}><input className={inputCls} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="VD Quận 7" /></Field>
              <Field label="Tỉnh / Thành phố" error={errs.city}><input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            </div>
            <Field label="Điện thoại" error={errs.phone}><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Trạng thái" hint="Chỉ chi nhánh đang hoạt động nhận đặt chỗ mới. Còn hợp đồng / đặt chỗ đang mở thì không ngừng hoạt động được.">
              <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FacilityStatus })}>
                {Object.entries(FACILITY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
