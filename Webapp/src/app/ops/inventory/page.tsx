'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { AccessMethod, enumValues, RATE_MAX, RATE_MIN, RATES_ORDER_MESSAGE, ratesOrdered, UNIT_NUMBER_MESSAGE, UNIT_NUMBER_RE, UnitCategory, type RentalPeriod, type StorageUnit, type UnitType } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, FACILITY_STATUS, RENTAL_PERIOD, UNIT_CATEGORY, UNIT_STATUS } from '@/shared/lib/labels';
import { typeName } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';

const PERIODS: RentalPeriod[] = ['DAY', 'WEEK', 'MONTH'];
const EDITABLE: StorageUnit['status'][] = ['AVAILABLE', 'MAINTENANCE'];

const EMPTY_TYPE = {
  _id: undefined as string | undefined, code: '', name: '', category: 'SMALL' as UnitCategory, description: '',
  widthM: 1.5, depthM: 2, heightM: 2.4, indoor: true, rates: { DAY: 60_000, WEEK: 350_000, MONTH: 990_000 } as Record<RentalPeriod, number>,
  minPeriods: 1, depositOverride: '' as string,
};
const EMPTY_BULK = { unitTypeId: '', prefix: '', start: 1, count: 1, floor: 1, zone: '', accessMethod: 'PIN' as AccessMethod };

function InventoryInner() {
  const { db, run, toast } = useStore();
  const sp = useSearchParams();
  const facilities = db.facilities.filter((f) => !f.isDeleted);
  const [facilityId, setFacilityId] = useState(() => {
    const preset = sp.get('facility');
    return facilities.some((f) => f._id === preset) ? preset! : facilities[0]?._id ?? '';
  });
  const [typeForm, setTypeForm] = useState<typeof EMPTY_TYPE | null>(null);
  const [bulk, setBulk] = useState<typeof EMPTY_BULK | null>(null);
  const [unitForm, setUnitForm] = useState<{ unitId: string; unitNumber: string; floor: number; zone: string; accessMethod: AccessMethod } | null>(null);
  const [unitFilter, setUnitFilter] = useState('ALL');
  // Lỗi chỉ hiện sau lần bấm Lưu đầu tiên — mở form trống ra chưa bị báo đỏ ngay.
  const [showErr, setShowErr] = useState({ type: false, bulk: false, unit: false });
  const flag = (k: 'type' | 'bulk' | 'unit', v: boolean) => setShowErr((s) => ({ ...s, [k]: v }));

  const facility = facilities.find((f) => f._id === facilityId);
  const types = db.unitTypes.filter((t) => t.facilityId === facilityId && !t.isDeleted);
  const units = db.units.filter((u) => u.facilityId === facilityId && !u.isDeleted)
    .filter((u) => unitFilter === 'ALL' || u.unitTypeId === unitFilter)
    .sort((a, b) => a.location.floor - b.location.floor || a.unitNumber.localeCompare(b.unitNumber));
  const unitCount = (t: UnitType) => db.units.filter((u) => u.unitTypeId === t._id && !u.isDeleted).length;

  const editType = (t: UnitType) => { flag('type', false); setTypeForm({
    _id: t._id, code: t.code, name: t.name, category: t.category, description: t.description ?? '',
    widthM: t.dimensions.widthM, depthM: t.dimensions.depthM, heightM: t.dimensions.heightM, indoor: t.features.indoor,
    rates: { ...t.rates }, minPeriods: t.minPeriods, depositOverride: t.depositOverride == null ? '' : String(t.depositOverride),
  }); };
  const saveType = () => {
    if (!typeForm || !facility) return;
    if (Object.keys(typeErrors).length) { flag('type', true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; }
    const deposit = typeForm.depositOverride.trim() === '' ? null : Math.round(Number(typeForm.depositOverride.replace(/\D/g, '')));
    const shared = {
      name: typeForm.name, description: typeForm.description, widthM: typeForm.widthM, depthM: typeForm.depthM, heightM: typeForm.heightM,
      indoor: typeForm.indoor, rates: typeForm.rates, minPeriods: typeForm.minPeriods, depositOverride: deposit,
    };
    if (typeForm._id) void run('updateUnitType', { unitTypeId: typeForm._id, ...shared }, 'Đã cập nhật loại kho', () => setTypeForm(null));
    else void run('createUnitType', { facilityId: facility._id, code: typeForm.code, category: typeForm.category, ...shared }, 'Đã thêm loại kho', () => setTypeForm(null));
  };
  // Cùng luật với BE (unitTypeBody) — báo lỗi ngay dưới từng ô.
  const typeErrors: Record<string, string> = {};
  if (typeForm) {
    if (typeForm.name.trim().length < 2) typeErrors.name = 'Tên tối thiểu 2 ký tự';
    if (!typeForm._id && !/^[A-Za-z0-9.-]{2,20}$/.test(typeForm.code.trim())) typeErrors.code = 'Mã 2–20 ký tự: chữ, số, ".", "-"';
    for (const [k, label] of [['widthM', 'Rộng'], ['depthM', 'Sâu'], ['heightM', 'Cao']] as const) {
      if (!(typeForm[k] >= 0.3 && typeForm[k] <= 30)) typeErrors[k] = `${label} từ 0,3 đến 30 m`;
    }
    for (const p of PERIODS) if (!(typeForm.rates[p] >= RATE_MIN && typeForm.rates[p] <= RATE_MAX)) typeErrors[`rate${p}`] = `Từ ${vnd(RATE_MIN)} đến ${vnd(RATE_MAX)}`;
    if (!PERIODS.some((p) => typeErrors[`rate${p}`]) && !ratesOrdered(typeForm.rates)) typeErrors.rates = RATES_ORDER_MESSAGE;
    if (!(Number.isInteger(typeForm.minPeriods) && typeForm.minPeriods >= 1 && typeForm.minPeriods <= 365)) typeErrors.minPeriods = 'Từ 1 đến 365 chu kỳ';
    const dep = typeForm.depositOverride.trim();
    if (dep !== '' && !/^[\d.,\s]+$/.test(dep)) typeErrors.depositOverride = 'Chỉ nhập số tiền (₫), hoặc để trống';
  }
  const te = (k: string) => (showErr.type ? typeErrors[k] : undefined);

  const openBulk = (t?: UnitType) => { flag('bulk', false); setBulk({ ...EMPTY_BULK, unitTypeId: t?._id ?? types[0]?._id ?? '', prefix: t ? `${t.code.split('-')[0]}-` : '' }); };
  const bulkWidth = bulk ? Math.max(2, String(bulk.start + bulk.count - 1).length) : 2;
  const bulkName = (n: number) => `${bulk!.prefix.toUpperCase()}${String(n).padStart(bulkWidth, '0')}`;
  const bulkErrors: Record<string, string> = {};
  if (bulk) {
    if (!bulk.unitTypeId) bulkErrors.unitTypeId = 'Chọn loại kho';
    if (!/^[A-Za-z0-9-]{1,12}$/.test(bulk.prefix.trim())) bulkErrors.prefix = 'Tiền tố 1–12 ký tự: chữ, số, "-" (VD M2-)';
    if (!Number.isInteger(bulk.start) || bulk.start < 0 || bulk.start > 9999) bulkErrors.start = 'Từ 0 đến 9999';
    if (!Number.isInteger(bulk.count) || bulk.count < 1 || bulk.count > 200) bulkErrors.count = 'Từ 1 đến 200 ô';
    if (!Number.isInteger(bulk.floor) || bulk.floor < -5 || bulk.floor > 100) bulkErrors.floor = 'Tầng từ -5 đến 100';
    if (bulk.zone.trim().length > 50) bulkErrors.zone = 'Tối đa 50 ký tự';
    if (!bulkErrors.prefix && !bulkErrors.start && !bulkErrors.count && bulkName(bulk.start + bulk.count - 1).length > 20) bulkErrors.prefix = 'Mã ô sẽ dài quá 20 ký tự — rút ngắn tiền tố';
  }
  const bulkValid = !!bulk && Object.keys(bulkErrors).length === 0;
  const be = (k: string) => (showErr.bulk ? bulkErrors[k] : undefined);
  const unitErrors: Record<string, string> = {};
  if (unitForm) {
    if (!UNIT_NUMBER_RE.test(unitForm.unitNumber.trim())) unitErrors.unitNumber = UNIT_NUMBER_MESSAGE;
    if (!Number.isInteger(unitForm.floor) || unitForm.floor < -5 || unitForm.floor > 100) unitErrors.floor = 'Tầng từ -5 đến 100';
    if (unitForm.zone.trim().length > 50) unitErrors.zone = 'Tối đa 50 ký tự';
  }
  const ue = (k: string) => (showErr.unit ? unitErrors[k] : undefined);

  const area = typeForm ? Math.round(typeForm.widthM * typeForm.depthM * 100) / 100 : 0;

  return (
    <>
      <PageHeader title="Loại kho & ô kho"
        actions={
          <>
            <select className={cx(inputCls, 'w-auto min-w-56')} value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setUnitFilter('ALL'); }}>
              {facilities.map((f) => <option key={f._id} value={f._id}>{f.name} · {FACILITY_STATUS[f.status].label}</option>)}
            </select>
            <Button onClick={() => { flag('type', false); setTypeForm({ ...EMPTY_TYPE }); }} disabled={!facility}><Plus className="size-4" />Thêm loại kho</Button>
          </>
        } />

      {!facility ? <Card><EmptyState title="Chưa có chi nhánh" description="Tạo chi nhánh ở mục Chi nhánh trước." /></Card> : (
        <>
          {facility.status !== 'ACTIVE' && (
            <Card className="mb-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Chi nhánh đang ở trạng thái “{FACILITY_STATUS[facility.status].label}” nên chưa nhận đặt chỗ. Thêm đủ loại kho và ô kho rồi chuyển sang “Đang hoạt động” ở mục Chi nhánh.
            </Card>
          )}

          <Card>
            <CardHeader title="Loại tủ/phòng thuê" description="Mã và nhóm cỡ không sửa được sau khi tạo."
              actions={<Button size="sm" variant="secondary" onClick={() => openBulk()} disabled={types.length === 0}><Plus className="size-3.5" />Thêm ô kho</Button>} />
            <Table rows={types} rowKey={(t) => t._id} empty={<EmptyState title="Chi nhánh chưa có loại kho" description="Bấm “Thêm loại kho” để tạo loại tủ/phòng đầu tiên." />} columns={[
              { key: 'n', header: 'Loại kho', cell: (t) => <div><p className="font-medium">{t.name}</p><p className="text-xs text-stone-500">{t.code} · {UNIT_CATEGORY[t.category]} · {t.dimensions.widthM}×{t.dimensions.depthM}×{t.dimensions.heightM} m ({t.areaM2} m²)</p></div> },
              { key: 'r', header: 'Giá ngày / tuần / tháng', className: 'tabular-nums text-xs', cell: (t) => `${vnd(t.rates.DAY)} / ${vnd(t.rates.WEEK)} / ${vnd(t.rates.MONTH)}` },
              { key: 'u', header: 'Số ô', className: 'text-right tabular-nums', cell: (t) => unitCount(t) },
              { key: 's', header: 'Trạng thái', cell: (t) => (t.isActive ? <Badge tone="green">Đang bán</Badge> : <Badge>Đã ẩn</Badge>) },
              { key: 'a', header: '', className: 'text-right', cell: (t) => (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => openBulk(t)}><Plus className="size-3.5" />Ô</Button>
                  <Button size="sm" variant="ghost" onClick={() => editType(t)} aria-label="Sửa"><Pencil className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={t.isActive ? 'Ẩn' : 'Hiện'} onClick={() => void run('updateUnitType', { unitTypeId: t._id, isActive: !t.isActive }, t.isActive ? 'Đã ẩn loại kho' : 'Đã hiện loại kho')}>
                    {t.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Xoá" onClick={() => { if (window.confirm(`Xoá loại kho ${t.name}? Chỉ xoá được khi chưa có ô nào và chưa từng có đặt chỗ.`)) void run('deleteUnitType', { unitTypeId: t._id }, 'Đã xoá loại kho'); }}><Trash2 className="size-3.5 text-red-600" /></Button>
                </div>
              ) },
            ]} />
          </Card>

          <Card className="mt-6">
            <CardHeader title="Ô kho vật lý" description={`${units.length} ô${unitFilter === 'ALL' ? '' : ` thuộc ${typeName(db, unitFilter)}`} · chỉ sửa/xoá được ô đang Trống hoặc Bảo trì`}
              actions={
                <select className={cx(inputCls, 'w-auto min-w-44')} value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
                  <option value="ALL">Tất cả loại kho</option>
                  {types.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
              } />
            <Table rows={units} rowKey={(u) => u._id} empty={<EmptyState title="Chưa có ô kho" description="Thêm ô ở bảng loại kho phía trên (nút “Ô”)." />} columns={[
              { key: 'n', header: 'Mã ô', cell: (u) => <span className="font-semibold">{u.unitNumber}</span> },
              { key: 't', header: 'Loại kho', cell: (u) => typeName(db, u.unitTypeId) },
              { key: 'f', header: 'Tầng', className: 'tabular-nums', cell: (u) => (u.location.floor < 0 ? 'Hầm' : u.location.floor) },
              { key: 'z', header: 'Khu', cell: (u) => u.location.zone ?? '—' },
              { key: 'k', header: 'Khoá', cell: (u) => ACCESS_METHOD[u.accessMethod] },
              { key: 's', header: 'Trạng thái', cell: (u) => <StatusBadge map={UNIT_STATUS} value={u.status} /> },
              { key: 'a', header: '', className: 'text-right', cell: (u) => EDITABLE.includes(u.status) && !u.currentContractId && !u.currentReservationId && (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" aria-label="Sửa" onClick={() => { flag('unit', false); setUnitForm({ unitId: u._id, unitNumber: u.unitNumber, floor: u.location.floor, zone: u.location.zone ?? '', accessMethod: u.accessMethod }); }}><Pencil className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Xoá" onClick={() => { if (window.confirm(`Xoá ô ${u.unitNumber}? Ô đã từng có đặt chỗ/hợp đồng sẽ không xoá được.`)) void run('deleteUnit', { unitId: u._id }, `Đã xoá ô ${u.unitNumber}`); }}><Trash2 className="size-3.5 text-red-600" /></Button>
                </div>
              ) },
            ]} />
          </Card>
        </>
      )}

      <Modal open={!!typeForm} onClose={() => setTypeForm(null)} size="lg" title={typeForm?._id ? 'Sửa loại kho' : 'Thêm loại kho'} description={facility ? `Chi nhánh ${facility.name}` : ''}
        footer={<Button onClick={saveType}>Lưu</Button>}>
        {typeForm && (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px]">
              <Field label="Tên loại kho" error={te('name')}><input className={inputCls} value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} placeholder="Phòng M" /></Field>
              <Field label="Mã" hint="Duy nhất trong chi nhánh" error={te('code')}><input className={inputCls} value={typeForm.code} disabled={!!typeForm._id} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })} placeholder="M-2x3" /></Field>
              <Field label="Nhóm cỡ">
                <select className={inputCls} value={typeForm.category} disabled={!!typeForm._id} onChange={(e) => setTypeForm({ ...typeForm, category: e.target.value as UnitCategory })}>
                  {enumValues(UnitCategory).map((c) => <option key={c} value={c}>{UNIT_CATEGORY[c]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Mô tả"><textarea className={inputCls} rows={2} value={typeForm.description} onChange={(e) => setTypeForm({ ...typeForm, description: e.target.value })} placeholder="Phù hợp đồ đạc căn hộ 1–2 phòng ngủ…" /></Field>
            <div className="grid gap-3 sm:grid-cols-4">
              {([['widthM', 'Rộng (m)'], ['depthM', 'Sâu (m)'], ['heightM', 'Cao (m)']] as const).map(([k, label]) => (
                <Field key={k} label={label} error={te(k)}><input type="number" min={0.3} max={30} step={0.1} className={inputCls} value={typeForm[k]} onChange={(e) => setTypeForm({ ...typeForm, [k]: Number(e.target.value) })} /></Field>
              ))}
              <Field label="Diện tích"><p className="rounded-lg bg-stone-50 px-3 py-2 text-sm tabular-nums ring-1 ring-inset ring-stone-200">{area} m²</p></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {PERIODS.map((p) => (
                <Field key={p} label={`Giá theo ${RENTAL_PERIOD[p].toLowerCase()} (₫)`} error={te(`rate${p}`)}>
                  <input className={cx(inputCls, 'tabular-nums')} inputMode="numeric" value={new Intl.NumberFormat('vi-VN').format(typeForm.rates[p])}
                    onChange={(e) => setTypeForm({ ...typeForm, rates: { ...typeForm.rates, [p]: Number(e.target.value.replace(/\D/g, '')) || 0 } })} />
                </Field>
              ))}
            </div>
            {te('rates') && <p role="alert" className="-mt-2 text-xs font-medium text-red-600">{te('rates')}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Thuê tối thiểu (số chu kỳ)" error={te('minPeriods')}><input type="number" min={1} max={365} className={inputCls} value={typeForm.minPeriods} onChange={(e) => setTypeForm({ ...typeForm, minPeriods: Math.max(1, Number(e.target.value) || 1) })} /></Field>
              <Field label="Tiền giữ chân cố định (₫)" hint="Để trống: tính theo chính sách chi nhánh" error={te('depositOverride')}><input className={inputCls} inputMode="numeric" value={typeForm.depositOverride} onChange={(e) => setTypeForm({ ...typeForm, depositOverride: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={typeForm.indoor} onChange={(e) => setTypeForm({ ...typeForm, indoor: e.target.checked })} />Trong nhà (không phải kiểu drive-up ngoài trời)</label>
          </div>
        )}
      </Modal>

      <Modal open={!!bulk} onClose={() => setBulk(null)} size="lg" title="Thêm ô kho"
        footer={<Button onClick={() => { if (!bulk) return; if (!bulkValid) { flag('bulk', true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; } void run('addUnitsBulk', { ...bulk, prefix: bulk.prefix.trim(), zone: bulk.zone.trim() }, (n) => `Đã thêm ${n} ô kho`, () => setBulk(null)); }}>Tạo ô</Button>}>
        {bulk && (
          <div className="grid gap-4">
            <Field label="Loại kho" error={be('unitTypeId')}>
              <select className={inputCls} value={bulk.unitTypeId} onChange={(e) => setBulk({ ...bulk, unitTypeId: e.target.value })}>{types.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tiền tố mã" hint="VD M2-" error={be('prefix')}><input className={inputCls} value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} placeholder="M2-" /></Field>
              <Field label="Bắt đầu từ số" error={be('start')}><input type="number" min={0} className={inputCls} value={bulk.start} onChange={(e) => setBulk({ ...bulk, start: Math.max(0, Number(e.target.value) || 0) })} /></Field>
              <Field label="Số lượng ô" hint="Tối đa 200" error={be('count')}><input type="number" min={1} max={200} className={inputCls} value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
            </div>
            {bulkValid && <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm ring-1 ring-inset ring-stone-200">Sẽ tạo: <b>{bulkName(bulk.start)}</b>{bulk.count > 1 && <> … <b>{bulkName(bulk.start + bulk.count - 1)}</b></>} ({bulk.count} ô)</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tầng" hint="Âm = tầng hầm" error={be('floor')}><input type="number" className={inputCls} value={bulk.floor} onChange={(e) => setBulk({ ...bulk, floor: Number(e.target.value) })} /></Field>
              <Field label="Khu" error={be('zone')}><input className={inputCls} value={bulk.zone} onChange={(e) => setBulk({ ...bulk, zone: e.target.value })} placeholder="Khu A" /></Field>
              <Field label="Hình thức khoá">
                <select className={inputCls} value={bulk.accessMethod} onChange={(e) => setBulk({ ...bulk, accessMethod: e.target.value as AccessMethod })}>
                  {enumValues(AccessMethod).map((m) => <option key={m} value={m}>{ACCESS_METHOD[m]}</option>)}
                </select>
              </Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!unitForm} onClose={() => setUnitForm(null)} title="Sửa ô kho"
        footer={<Button onClick={() => { if (!unitForm) return; if (Object.keys(unitErrors).length) { flag('unit', true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; } void run('updateUnit', { ...unitForm, unitNumber: unitForm.unitNumber.trim(), zone: unitForm.zone.trim() }, 'Đã cập nhật ô kho', () => setUnitForm(null)); }}>Lưu</Button>}>
        {unitForm && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mã ô" error={ue('unitNumber')}><input className={inputCls} value={unitForm.unitNumber} onChange={(e) => setUnitForm({ ...unitForm, unitNumber: e.target.value })} /></Field>
              <Field label="Tầng" error={ue('floor')}><input type="number" className={inputCls} value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Khu" error={ue('zone')}><input className={inputCls} value={unitForm.zone} onChange={(e) => setUnitForm({ ...unitForm, zone: e.target.value })} /></Field>
            <Field label="Hình thức khoá">
              <select className={inputCls} value={unitForm.accessMethod} onChange={(e) => setUnitForm({ ...unitForm, accessMethod: e.target.value as AccessMethod })}>
                {enumValues(AccessMethod).map((m) => <option key={m} value={m}>{ACCESS_METHOD[m]}</option>)}
              </select>
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function OpsInventory() {
  return <Suspense><InventoryInner /></Suspense>;
}
