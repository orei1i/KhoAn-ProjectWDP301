'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Banknote, Boxes, Building2, Construction, Eye, EyeOff, Layers, LayoutGrid, Lock, Pencil, Plus, Ruler, ScrollText, Tag, Trash2 } from 'lucide-react';
import { AccessMethod, enumValues, RATE_MAX, RATE_MIN, RATES_ORDER_MESSAGE, ratesOrdered, UNIT_NUMBER_MESSAGE, UNIT_NUMBER_RE, UnitCategory, type RentalPeriod, type StorageUnit, type UnitStatus, type UnitType } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, FACILITY_STATUS, RENTAL_PERIOD, UNIT_CATEGORY, UNIT_STATUS } from '@/shared/lib/labels';
import { typeName } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { CATEGORY_ICON } from '@/features/facilities/visuals';
import { Callout, CheckLine, Chip, ChipRow, PanelHeader, UnitTag } from '@/features/staff-ui';
import { Section } from '@/features/backoffice-ui';

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
  // Đợt 17 (D12): server báo ô đã có lịch sử mà snapshot chưa thấy (đặt chỗ / hợp đồng ngoài dữ liệu đang tải) → khoá ô mã từ đó.
  const [codeLocked, setCodeLocked] = useState<string[]>([]);
  // Lỗi chỉ hiện sau lần bấm Lưu đầu tiên — mở form trống ra chưa bị báo đỏ ngay.
  const [showErr, setShowErr] = useState({ type: false, bulk: false, unit: false });
  const flag = (k: 'type' | 'bulk' | 'unit', v: boolean) => setShowErr((s) => ({ ...s, [k]: v }));

  const facility = facilities.find((f) => f._id === facilityId);
  const types = db.unitTypes.filter((t) => t.facilityId === facilityId && !t.isDeleted);
  const units = db.units.filter((u) => u.facilityId === facilityId && !u.isDeleted)
    .filter((u) => unitFilter === 'ALL' || u.unitTypeId === unitFilter)
    .sort((a, b) => a.location.floor - b.location.floor || a.unitNumber.localeCompare(b.unitNumber));
  const unitCount = (t: UnitType) => db.units.filter((u) => u.unitTypeId === t._id && !u.isDeleted).length;
  // Đợt 17 (B4): loại kho đang có ô giữ chỗ / đang thuê / chờ kiểm tra — kích thước, trong nhà / ngoài trời đã vào hợp đồng và báo giá của khách. Server vẫn chặn (422 UNIT_TYPE_IN_USE).
  const typeInUse = !!typeForm?._id && db.units.some((u) => u.unitTypeId === typeForm._id && !u.isDeleted && ['RESERVED', 'OCCUPIED', 'PENDING_INSPECTION'].includes(u.status));
  // Đợt 17 (D12): mã ô đã in vào hợp đồng, biên bản, email — ô đã có đặt chỗ / hợp đồng (kể cả đã đổi sang ô khác) không đổi mã. Server vẫn chặn (422 UNIT_HAS_HISTORY).
  const unitHasHistory = (unitId: string) => codeLocked.includes(unitId) || db.reservations.some((r) => r.unitId === unitId)
    || db.contracts.some((c) => c.unitId === unitId || (c.unitSwaps ?? []).some((s) => s.fromUnitId === unitId || s.toUnitId === unitId));
  const unitLocked = !!unitForm && unitHasHistory(unitForm.unitId);
  const saveUnit = async () => {
    if (!unitForm) return;
    if (Object.keys(unitErrors).length) { flag('unit', true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; }
    const res = await run('updateUnit', { ...unitForm, unitNumber: unitForm.unitNumber.trim(), zone: unitForm.zone.trim() }, 'Đã cập nhật ô kho', () => setUnitForm(null));
    if (!res.ok && res.code === 'UNIT_HAS_HISTORY') {
      // Giữ các ô khác đang sửa, trả mã về như cũ và khoá lại.
      const original = db.units.find((u) => u._id === unitForm.unitId)?.unitNumber ?? unitForm.unitNumber;
      setCodeLocked((c) => [...c, unitForm.unitId]);
      setUnitForm({ ...unitForm, unitNumber: original });
    }
  };

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
            <select className={cx(inputCls, 'w-auto min-w-56')} aria-label="Chi nhánh" value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setUnitFilter('ALL'); }}>
              {facilities.map((f) => <option key={f._id} value={f._id}>{f.name} · {FACILITY_STATUS[f.status].label}</option>)}
            </select>
            <Button onClick={() => { flag('type', false); setTypeForm({ ...EMPTY_TYPE }); }} disabled={!facility}><Plus className="size-4" />Thêm loại kho</Button>
          </>
        } />

      {!facility ? <Card><EmptyState icon={<Building2 className="size-6" />} title="Chưa có chi nhánh" description="Tạo chi nhánh ở mục Chi nhánh trước." /></Card> : (
        <>
          {facility.status !== 'ACTIVE' && (
            <Callout tone="amber" icon={<Construction />} className="mb-4" title={`Chi nhánh đang “${FACILITY_STATUS[facility.status].label}” nên chưa nhận đặt chỗ.`}>
              Thêm đủ loại kho và ô kho rồi chuyển sang “Đang hoạt động” ở mục Chi nhánh.
            </Callout>
          )}

          <Card>
            <PanelHeader icon={<Layers className="size-4" />} title="Loại tủ/phòng thuê" count={types.length} tip="Mã và nhóm cỡ không sửa được sau khi tạo."
              action={<Button size="sm" variant="secondary" onClick={() => openBulk()} disabled={types.length === 0}><Plus className="size-3.5" />Thêm ô kho</Button>} />
            {types.length === 0 ? <EmptyState icon={<Layers className="size-6" />} title="Chi nhánh chưa có loại kho" description="Bấm “Thêm loại kho” để tạo loại tủ/phòng đầu tiên." /> : (
              <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
                {types.map((t) => {
                  const Icon = CATEGORY_ICON[t.category];
                  return (
                    <div key={t._id} className={cx('flex flex-col rounded-xl p-4 ring-1 ring-inset ring-stone-200', !t.isActive && 'bg-stone-50/70')}>
                      <div className="flex items-start gap-3">
                        <IconTile icon={<Icon className="size-5" />} tone={t.isActive ? 'teal' : 'gray'} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-ink">{t.name}</p>
                          <p className="font-mono text-[11px] text-stone-500">{t.code}</p>
                        </div>
                        {t.isActive ? <Badge tone="green" dot>Đang bán</Badge> : <Badge dot>Đã ẩn</Badge>}
                      </div>
                      <ChipRow className="mt-3">
                        <Chip tone="teal">{UNIT_CATEGORY[t.category]}</Chip>
                        <Chip icon={<Ruler />}>{t.dimensions.widthM}×{t.dimensions.depthM}×{t.dimensions.heightM} m · {t.areaM2} m²</Chip>
                        <Chip icon={<Boxes />}>{unitCount(t)} ô</Chip>
                      </ChipRow>
                      <dl className="mb-3 mt-3 grid grid-cols-3 gap-2 text-center">
                        {PERIODS.map((p) => (
                          <div key={p} className="rounded-lg bg-white px-1 py-1.5 ring-1 ring-inset ring-stone-200">
                            <dt className="text-[11px] text-stone-500">{RENTAL_PERIOD[p]}</dt>
                            <dd className="text-xs font-semibold tabular-nums text-ink">{vnd(t.rates[p])}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="mt-auto flex flex-wrap justify-end gap-1.5 border-t border-stone-100 pt-3">
                        <Button size="sm" variant="secondary" onClick={() => openBulk(t)}><Plus className="size-3.5" />Ô</Button>
                        <Button size="sm" variant="ghost" onClick={() => editType(t)} aria-label="Sửa"><Pencil className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" aria-label={t.isActive ? 'Ẩn' : 'Hiện'} onClick={() => void run('updateUnitType', { unitTypeId: t._id, isActive: !t.isActive }, t.isActive ? 'Đã ẩn loại kho' : 'Đã hiện loại kho')}>
                          {t.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" aria-label="Xoá" onClick={() => { if (window.confirm(`Xoá loại kho ${t.name}? Chỉ xoá được khi chưa có ô nào và chưa từng có đặt chỗ.`)) void run('deleteUnitType', { unitTypeId: t._id }, 'Đã xoá loại kho'); }}><Trash2 className="size-3.5 text-red-600" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="mt-6">
            <PanelHeader icon={<LayoutGrid className="size-4" />} title="Ô kho vật lý" count={units.length} tip="Chỉ sửa / xoá được ô đang Trống hoặc Bảo trì."
              action={
                <select className={cx(inputCls, 'w-auto min-w-44')} aria-label="Lọc theo loại kho" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
                  <option value="ALL">Tất cả loại kho</option>
                  {types.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
              } />
            {units.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-stone-100 px-4 py-2.5 sm:px-5">
                {(Object.keys(UNIT_STATUS) as UnitStatus[]).map((s) => {
                  const n = units.filter((u) => u.status === s).length;
                  return n ? <Badge key={s} tone={UNIT_STATUS[s].tone} dot>{UNIT_STATUS[s].label} · {n}</Badge> : null;
                })}
              </div>
            )}
            <Table rows={units} rowKey={(u) => u._id} empty={<EmptyState icon={<LayoutGrid className="size-6" />} title="Chưa có ô kho" description="Thêm ô ở thẻ loại kho phía trên (nút “Ô”)." />} columns={[
              { key: 'n', header: 'Mã ô', cell: (u) => <UnitTag label={u.unitNumber} size="sm" tone={u.status === 'MAINTENANCE' ? 'amber' : u.status === 'AVAILABLE' ? 'green' : 'ink'} /> },
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
          <div className="space-y-6">
            <Section icon={<Tag />} title="Thông tin" tip="Mã và nhóm cỡ không sửa được sau khi tạo.">
              <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px]">
                <Field label="Tên loại kho" error={te('name')}><input className={inputCls} value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} placeholder="Phòng M" /></Field>
                <Field label="Mã" tip="Duy nhất trong chi nhánh." error={te('code')}><input className={inputCls} value={typeForm.code} disabled={!!typeForm._id} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })} placeholder="M-2x3" /></Field>
                <Field label="Nhóm cỡ">
                  <select className={inputCls} value={typeForm.category} disabled={!!typeForm._id} onChange={(e) => setTypeForm({ ...typeForm, category: e.target.value as UnitCategory })}>
                    {enumValues(UnitCategory).map((c) => <option key={c} value={c}>{UNIT_CATEGORY[c]}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Mô tả"><textarea className={inputCls} rows={2} value={typeForm.description} onChange={(e) => setTypeForm({ ...typeForm, description: e.target.value })} placeholder="Phù hợp đồ đạc căn hộ 1–2 phòng ngủ…" /></Field>
            </Section>
            <Section icon={<Ruler />} title="Kích thước">
              {typeInUse && <Callout tone="amber" icon={<Lock />} title="Không đổi được kích thước, trong nhà / ngoài trời">Loại kho đang có ô giữ chỗ, đang thuê hoặc chờ kiểm tra. Cần thông số mới thì tạo loại kho mới. Giá vẫn sửa được.</Callout>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([['widthM', 'Rộng (m)'], ['depthM', 'Sâu (m)'], ['heightM', 'Cao (m)']] as const).map(([k, label]) => (
                  <Field key={k} label={label} error={te(k)}><input type="number" min={0.3} max={30} step={0.1} disabled={typeInUse} className={inputCls} value={typeForm[k]} onChange={(e) => setTypeForm({ ...typeForm, [k]: Number(e.target.value) })} /></Field>
                ))}
                <Field label="Diện tích"><p className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold tabular-nums text-brand-800 ring-1 ring-inset ring-brand-200">{area} m²</p></Field>
              </div>
            </Section>
            <Section icon={<Banknote />} title="Giá thuê" tip={`Khách tự chọn chu kỳ lúc đặt. ${RATES_ORDER_MESSAGE}.`}>
              <div className="grid gap-3 sm:grid-cols-3">
                {PERIODS.map((p) => (
                  <Field key={p} label={`Giá theo ${RENTAL_PERIOD[p].toLowerCase()} (₫)`} error={te(`rate${p}`)}>
                    <input className={cx(inputCls, 'tabular-nums')} inputMode="numeric" value={new Intl.NumberFormat('vi-VN').format(typeForm.rates[p])}
                      onChange={(e) => setTypeForm({ ...typeForm, rates: { ...typeForm.rates, [p]: Number(e.target.value.replace(/\D/g, '')) || 0 } })} />
                  </Field>
                ))}
              </div>
              {te('rates') && <p role="alert" className="text-xs font-medium text-red-600">{te('rates')}</p>}
            </Section>
            <Section icon={<ScrollText />} title="Điều kiện thuê">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Thuê tối thiểu (số chu kỳ)" error={te('minPeriods')}><input type="number" min={1} max={365} className={inputCls} value={typeForm.minPeriods} onChange={(e) => setTypeForm({ ...typeForm, minPeriods: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                <Field label="Tiền giữ chân cố định (₫)" tip="Để trống: tính theo chính sách chi nhánh." error={te('depositOverride')}><input className={inputCls} inputMode="numeric" value={typeForm.depositOverride} onChange={(e) => setTypeForm({ ...typeForm, depositOverride: e.target.value })} /></Field>
              </div>
              <CheckLine checked={typeForm.indoor} disabled={typeInUse} onChange={(v) => setTypeForm({ ...typeForm, indoor: v })}>Trong nhà (không phải kiểu drive-up ngoài trời)</CheckLine>
            </Section>
          </div>
        )}
      </Modal>

      <Modal open={!!bulk} onClose={() => setBulk(null)} size="lg" title="Thêm ô kho"
        footer={<Button onClick={() => { if (!bulk) return; if (!bulkValid) { flag('bulk', true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; } void run('addUnitsBulk', { ...bulk, prefix: bulk.prefix.trim(), zone: bulk.zone.trim() }, (n) => `Đã thêm ${n} ô kho`, () => setBulk(null)); }}><Plus className="size-4" />Tạo ô</Button>}>
        {bulk && (
          <div className="grid gap-4">
            <Field label="Loại kho" error={be('unitTypeId')}>
              <select className={inputCls} value={bulk.unitTypeId} onChange={(e) => setBulk({ ...bulk, unitTypeId: e.target.value })}>{types.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tiền tố mã" tip="VD M2-" error={be('prefix')}><input className={inputCls} value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} placeholder="M2-" /></Field>
              <Field label="Bắt đầu từ số" error={be('start')}><input type="number" min={0} className={inputCls} value={bulk.start} onChange={(e) => setBulk({ ...bulk, start: Math.max(0, Number(e.target.value) || 0) })} /></Field>
              <Field label="Số lượng ô" tip="Tối đa 200 ô một lần." error={be('count')}><input type="number" min={1} max={200} className={inputCls} value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
            </div>
            {bulkValid && (
              <Callout tone="teal" icon={<Boxes />} title={<>Sẽ tạo: <span className="font-mono">{bulkName(bulk.start)}</span>{bulk.count > 1 && <> … <span className="font-mono">{bulkName(bulk.start + bulk.count - 1)}</span></>}</>}>
                {bulk.count} ô
              </Callout>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tầng" tip="Âm = tầng hầm." error={be('floor')}><input type="number" className={inputCls} value={bulk.floor} onChange={(e) => setBulk({ ...bulk, floor: Number(e.target.value) })} /></Field>
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
        footer={<Button onClick={() => void saveUnit()}>Lưu</Button>}>
        {unitForm && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mã ô" hint={unitLocked ? 'Ô đã có đặt chỗ / hợp đồng — không đổi mã.' : undefined} error={ue('unitNumber')}><input className={inputCls} disabled={unitLocked} value={unitForm.unitNumber} onChange={(e) => setUnitForm({ ...unitForm, unitNumber: e.target.value })} /></Field>
              <Field label="Tầng" tip="Âm = tầng hầm." error={ue('floor')}><input type="number" className={inputCls} value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: Number(e.target.value) })} /></Field>
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
