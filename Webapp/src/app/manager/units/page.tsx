'use client';

import { useState } from 'react';
import { Boxes, DoorOpen, Layers, LayoutGrid, Plus, Ruler, Tag, Warehouse, Wrench } from 'lucide-react';
import { AccessMethod, enumValues, UNIT_NUMBER_MESSAGE, UNIT_NUMBER_RE } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, UNIT_CATEGORY } from '@/shared/lib/labels';
import { availability, unitRate } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, IconTile, Modal, PageHeader, StatCard, inputCls } from '@/shared/ui';
import { SegmentBar } from '@/shared/ui/charts';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { UnitMap } from '@/features/facilities/unit-map';
import { CATEGORY_ICON } from '@/features/facilities/visuals';
import { Chip, ChipRow, PanelHeader } from '@/features/staff-ui';

/** Cộng một cột số của bảng tồn kho (chỉ để hiện thẻ tổng). */
const sumOf = <K extends string>(rows: Record<K, unknown>[], k: K) => rows.reduce((s, r) => s + (r[k] as number), 0);

export default function ManagerUnits() {
  const { db, run, toast } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const types = db.unitTypes.filter((t) => t.facilityId === fid);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ unitTypeId: '', unitNumber: '', floor: 1, accessMethod: 'PIN' as AccessMethod });
  const [showErr, setShowErr] = useState(false);
  // Cùng luật với BE (POST /units): mã ô chỉ chữ/số/"-", tầng -5..100.
  const errs: Record<string, string> = {};
  if (!form.unitTypeId) errs.unitTypeId = 'Chọn loại kho';
  if (!UNIT_NUMBER_RE.test(form.unitNumber.trim())) errs.unitNumber = UNIT_NUMBER_MESSAGE;
  if (!Number.isInteger(form.floor) || form.floor < -5 || form.floor > 100) errs.floor = 'Tầng từ -5 đến 100';
  const err = (k: string) => (showErr ? errs[k] : undefined);
  const save = () => {
    if (Object.keys(errs).length) { setShowErr(true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; }
    void run('addUnit', { ...form, unitNumber: form.unitNumber.trim() }, `Đã thêm kho ${form.unitNumber.trim().toUpperCase()}`, () => setOpen(false));
  };

  const rows = types.map((t) => {
    const us = db.units.filter((u) => u.unitTypeId === t._id && !u.isDeleted);
    const n = (s: string) => us.filter((u) => u.status === s).length;
    return { t, total: us.length, available: n('AVAILABLE'), reserved: n('RESERVED'), occupied: n('OCCUPIED') + n('PENDING_INSPECTION'), maintenance: n('MAINTENANCE'), sellable: availability(db, fid, t._id).available };
  });

  return (
    <>
      <PageHeader title="Quản lý kho" actions={<><FacilityPicker scope={scope} /><Button onClick={() => { setForm({ unitTypeId: types[0]?._id ?? '', unitNumber: '', floor: 1, accessMethod: 'PIN' }); setShowErr(false); setOpen(true); }}><Plus className="size-4" />Thêm kho</Button></>} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Tổng số ô" value={sumOf(rows, 'total')} icon={<Boxes className="size-5" />} sub={`${types.length} loại kho`} />
        <StatCard label="Trống" value={sumOf(rows, 'available')} icon={<DoorOpen className="size-5" />} tone="green" sub={`Có thể bán ${sumOf(rows, 'sellable')}`} />
        <StatCard label="Đang thuê" value={sumOf(rows, 'occupied')} icon={<Warehouse className="size-5" />} tone="blue" sub={`Đã giữ chỗ ${sumOf(rows, 'reserved')}`} />
        <StatCard label="Bảo trì" value={sumOf(rows, 'maintenance')} icon={<Wrench className="size-5" />} tone={sumOf(rows, 'maintenance') ? 'amber' : 'gray'} />
      </div>

      <Card className="mt-6">
        <PanelHeader icon={<Layers className="size-4" />} title="Tồn kho theo loại" count={rows.length} tip="“Có thể bán” = trống trừ các lượt giữ chỗ chưa phân kho." />
        {rows.length === 0 ? <EmptyState icon={<Layers className="size-6" />} title="Chi nhánh chưa có loại kho" /> : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {rows.map((r) => {
              const Icon = CATEGORY_ICON[r.t.category];
              return (
                <div key={r.t._id} className="rounded-xl p-4 ring-1 ring-inset ring-stone-200">
                  <div className="flex items-start gap-3">
                    <IconTile icon={<Icon className="size-5" />} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{r.t.name}</p>
                      <p className="text-xs text-stone-500">{UNIT_CATEGORY[r.t.category]}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xl font-semibold leading-none tabular-nums text-ink">{r.sellable}</p>
                      <p className="mt-1 text-[11px] text-stone-500">có thể bán</p>
                    </div>
                  </div>
                  <SegmentBar className="mt-3" segments={[
                    { key: 'occ', label: 'Đang thuê', value: r.occupied, tone: 'teal' },
                    { key: 'res', label: 'Đã giữ', value: r.reserved, tone: 'blue' },
                    { key: 'free', label: 'Trống', value: r.available, tone: 'green' },
                    { key: 'mt', label: 'Bảo trì', value: r.maintenance, tone: 'amber' },
                  ]} />
                  <ChipRow className="mt-3">
                    <Chip icon={<Tag />} tone="teal">{vnd(unitRate(r.t, 'MONTH'))} / tháng</Chip>
                    <Chip icon={<Ruler />}>{r.t.dimensions.widthM}×{r.t.dimensions.depthM} m</Chip>
                    <Chip icon={<Boxes />}>{r.total} ô</Chip>
                  </ChipRow>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <PanelHeader icon={<LayoutGrid className="size-4" />} title="Sơ đồ kho" tip="Lọc theo trạng thái ô; mỗi tầng một dãy." />
        <div className="p-4 sm:p-5"><UnitMap facilityId={fid} /></div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Thêm kho mới"
        footer={<Button onClick={save}><Plus className="size-4" />Lưu</Button>}>
        <div className="grid gap-4">
          <Field label="Loại kho" error={err('unitTypeId')}>
            <select className={inputCls} value={form.unitTypeId} onChange={(e) => setForm({ ...form, unitTypeId: e.target.value })}>{types.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mã kho" error={err('unitNumber')}><input className={inputCls} value={form.unitNumber} onChange={(e) => setForm({ ...form, unitNumber: e.target.value })} placeholder="M2-09" /></Field>
            <Field label="Tầng" tip="Âm = tầng hầm (-5 đến 100)." error={err('floor')}><input type="number" className={inputCls} value={form.floor} onChange={(e) => setForm({ ...form, floor: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Hình thức khoá">
            <select className={inputCls} value={form.accessMethod} onChange={(e) => setForm({ ...form, accessMethod: e.target.value as AccessMethod })}>
              {enumValues(AccessMethod).map((m) => <option key={m} value={m}>{ACCESS_METHOD[m]}</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
