'use client';

import { useState } from 'react';
import { Boxes, Building2, MapPin, PackageOpen, Pencil, Phone, Plus, ScrollText, Trash2, TriangleAlert } from 'lucide-react';
import type { Facility, FacilityStatus } from '@ssm/shared';
import { FACILITY_CODE_MESSAGE, FACILITY_CODE_RE, PHONE_MESSAGE, isValidPhone } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import type { FacilityOpenItems } from '@/shared/api/actions';
import { FACILITY_STATUS } from '@/shared/lib/labels';
import { effectivePolicy, facilityStats } from '@/shared/lib/domain';
import { pct } from '@/shared/lib/format';
import { facilityPhoto } from '@/shared/lib/images';
import { Button, ButtonLink, Card, EmptyState, Field, Modal, PageHeader, Progress, StatusBadge, inputCls } from '@/shared/ui';
import { Callout, Chip, ChipRow, Segmented } from '@/features/staff-ui';
import { PersonCell, Section } from '@/features/backoffice-ui';

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
  // Đợt 17 (D10): ngừng hoạt động khi còn việc — đồ khách để lại thì chặn hẳn; khoản hoàn / hồ sơ / nợ còn mở thì hiện danh sách, xác nhận rồi gửi lại.
  const [openItems, setOpenItems] = useState<FacilityOpenItems | null>(null);
  const [leftovers, setLeftovers] = useState<number | null>(null);
  const errs = form && showErr ? facilityErrors(form) : {};
  const open = (f: typeof EMPTY | null) => { setShowErr(false); setOpenItems(null); setLeftovers(null); setForm(f); };
  const save = async (acknowledgeOpenItems = false) => {
    if (!form) return;
    if (Object.keys(facilityErrors(form)).length) { setShowErr(true); toast('Vui lòng sửa các mục báo đỏ trước khi lưu', 'error'); return; }
    const res = await run('saveFacility', { ...form, acknowledgeOpenItems }, 'Đã lưu chi nhánh', () => open(null));
    if (res.ok) return;
    setOpenItems(res.code === 'FACILITY_HAS_OPEN_ITEMS' ? res.details as FacilityOpenItems : null);
    setLeftovers(res.code === 'FACILITY_HAS_LEFTOVER' ? (res.details as { leftovers: number }).leftovers : null);
  };
  const edit = (f: Facility) => open({ _id: f._id, name: f.name, code: f.code, status: f.status, line1: f.address.line1, district: f.address.district, city: f.address.city || DEFAULT_CITY, phone: f.contact.phone });

  // ---- Chỉ để trình bày.
  const list = db.facilities.filter((f) => !f.isDeleted);

  return (
    <>
      <PageHeader title="Chi nhánh" description="Chi nhánh mới cần thêm loại kho và ô kho trước khi nhận đặt chỗ." actions={<Button onClick={() => open({ ...EMPTY })}><Plus className="size-4" />Thêm chi nhánh</Button>} />
      {list.length === 0 ? <Card><EmptyState icon={<Building2 className="size-6" />} title="Chưa có chi nhánh" /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((f) => {
            const s = facilityStats(db, f._id);
            const p = effectivePolicy(db, f._id);
            const managers = db.users.filter((u) => u.role === 'FACILITY_MANAGER' && u.facilityIds.includes(f._id));
            return (
              <Card key={f._id} className="flex flex-col overflow-hidden">
                <button type="button" onClick={() => edit(f)} className="group block text-left" aria-label={`Sửa chi nhánh ${f.name}`}>
                  <span className="relative block">
                    <img src={facilityPhoto(f)} alt="" loading="lazy" decoding="async" className="h-28 w-full object-cover transition-opacity group-hover:opacity-90" />
                    <span className="absolute left-3 top-3"><StatusBadge map={FACILITY_STATUS} value={f.status} /></span>
                  </span>
                  <span className="block px-4 pb-2 pt-3">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate font-semibold text-ink group-hover:text-brand-800">{f.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-stone-500">{f.code}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-stone-500"><MapPin className="size-3.5 shrink-0 text-stone-400" aria-hidden /><span className="truncate">{f.address.line1}, {f.address.district}</span></span>
                  </span>
                </button>
                <div className="space-y-3 px-4 pb-4">
                  <div>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-stone-600">Lấp đầy · {s.total} kho</span>
                      <span className="font-semibold tabular-nums text-ink">{pct(s.occupancy)}</span>
                    </div>
                    <Progress value={s.occupancy} tone={s.occupancy >= 0.9 ? 'red' : s.occupancy >= 0.75 ? 'amber' : 'teal'} className="mt-1.5" />
                  </div>
                  <ChipRow>
                    <Chip icon={<ScrollText />} tone={p.scope === 'FACILITY' ? 'violet' : 'gray'}>Chính sách {p.scope === 'FACILITY' ? 'riêng' : 'toàn chuỗi'} v{p.version}</Chip>
                    {f.contact.phone && <Chip icon={<Phone />}>{f.contact.phone}</Chip>}
                  </ChipRow>
                  <div className="space-y-2">
                    {managers.length
                      ? managers.map((u) => <PersonCell key={u._id} name={u.fullName} sub="Quản lý chi nhánh" />)
                      : <p className="text-xs text-stone-400">Chưa có quản lý chi nhánh</p>}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-stone-100 px-4 py-3">
                  <Button size="sm" variant="ghost" onClick={() => edit(f)}><Pencil className="size-3.5" />Sửa</Button>
                  <ButtonLink href={`/ops/inventory?facility=${f._id}`} size="sm" variant="secondary"><Boxes className="size-3.5" />Loại kho & ô</ButtonLink>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?._id ? 'Sửa chi nhánh' : 'Thêm chi nhánh'}
        footer={form && (
          <>
            {form._id && (
              <Button variant="danger" onClick={() => { if (window.confirm(`Xoá chi nhánh ${form.name}? Chỉ xoá được khi chưa có ô kho/đặt chỗ/hợp đồng nào.`)) void run('deleteFacility', { facilityId: form._id! }, 'Đã xoá chi nhánh', () => setForm(null)); }}><Trash2 className="size-4" />Xoá</Button>
            )}
            {openItems
              ? <Button variant="danger" onClick={() => void save(true)}><TriangleAlert className="size-4" />Vẫn ngừng hoạt động</Button>
              : <Button onClick={() => void save()}>Lưu</Button>}
          </>
        )}>
        {form && (
          <div className="space-y-6">
            <Section icon={<Building2 />} title="Thông tin">
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <Field label="Tên chi nhánh" error={errs.name}><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Mã" tip="Không sửa được sau khi tạo." error={errs.code}><input className={inputCls} value={form.code} disabled={!!form._id} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="HCM-GV-01" /></Field>
              </div>
              <Field label="Điện thoại" error={errs.phone}><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            </Section>
            <Section icon={<MapPin />} title="Địa chỉ">
              <Field label="Số nhà, tên đường" error={errs.line1}><input className={inputCls} value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} placeholder="VD 123 Nguyễn Văn Linh" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quận / Huyện" error={errs.district}><input className={inputCls} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="VD Quận 7" /></Field>
                <Field label="Tỉnh / Thành phố" error={errs.city}><input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
              </div>
            </Section>
            <Section icon={<ScrollText />} title="Trạng thái" tip="Chỉ chi nhánh đang hoạt động nhận đặt chỗ mới. Còn hợp đồng / đặt chỗ đang mở thì không ngừng hoạt động được.">
              <Segmented<FacilityStatus> label="Trạng thái" value={form.status} onChange={(v) => { setForm({ ...form, status: v }); setOpenItems(null); setLeftovers(null); }}
                options={(Object.keys(FACILITY_STATUS) as FacilityStatus[]).map((k) => ({ value: k, label: FACILITY_STATUS[k].label, tone: FACILITY_STATUS[k].tone }))} />
              {leftovers !== null && (
                <Callout tone="red" icon={<PackageOpen />} title={`Chi nhánh còn giữ đồ khách để lại của ${leftovers} hợp đồng`}>Xử lý xong ở mục Đồ đang giữ rồi mới ngừng hoạt động được.</Callout>
              )}
              {openItems && (
                <Callout tone="amber" icon={<TriangleAlert />} title="Chi nhánh còn việc chưa xong">
                  <ul className="list-disc pl-4">
                    <li>{openItems.pendingRefunds} khoản hoàn chờ chuyển</li>
                    <li>{openItems.openClaims} hồ sơ bồi thường đang mở</li>
                    <li>{openItems.settlementDebts} hợp đồng còn nợ sau quyết toán</li>
                  </ul>
                  <p className="mt-1.5">Bấm “Vẫn ngừng hoạt động” nếu đã xem và chấp nhận theo dõi tiếp các việc này.</p>
                </Callout>
              )}
            </Section>
          </div>
        )}
      </Modal>
    </>
  );
}
