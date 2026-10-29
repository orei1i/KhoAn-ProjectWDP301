'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, HandCoins, History, LifeBuoy, Plus, Scale, TriangleAlert } from 'lucide-react';
import type { ClaimItem, ClaimType, DamageClaim } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE } from '@/shared/lib/labels';
import { claimCapOf, claimHoldEnd, fmtDate as fmtDay, inventoryOf } from '@ssm/shared';
import { byId, CLAIM_WINDOW_DAYS, claimTotal, contractIntakeBatches, typeName, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Button, Card, Disclosure, EmptyState, Field, IconTile, KV, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { PhotoLinks, PhotoLinksField, parsePhotoLinks } from '@/shared/ui/photo-links';
import { ProfileDialog } from '@/features/auth/profile-name';
import { ClaimItemTag, ClaimItemsEditor, claimItemsError, claimedElsewhereOf, initialClaimItems } from '@/features/claims/claim-items-editor';

export default function MyClaims() {
  const { db, user, run } = useStore();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DamageClaim | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [form, setForm] = useState({
    contractId: '',
    type: 'DAMAGE' as ClaimType,
    incidentAt: todayISO().slice(0, 10),
    description: '',
    items: [] as ClaimItem[],
    photos: '',
  });

  if (!user) return null;

  // Chỉ hợp đồng còn mở, hoặc vừa kết thúc trong hạn khiếu nại, mới gửi được yêu cầu.
  // ABANDONED (hàng bỏ lại, đã thanh lý) không có quy trình khiếu nại — loại hẳn, không tính hạn khiếu nại.
  const eligible = db.contracts.filter((c) =>
    c.customerId === user._id && c.status !== 'ABANDONED' && (c.status !== 'CLOSED' || (c.closedAt ?? '') >= addDays(todayISO(), -CLAIM_WINDOW_DAYS)));
  const claims = db.claims.filter((c) => c.customerId === user._id);
  const total = claimTotal(form.items);
  const cap = claimCapOf(byId(db.contracts, form.contractId), db.unitTypes, `${form.incidentAt}T00:00:00.000Z`); // Điều 6: 10 × tiền thuê tháng theo hợp đồng
  const photos = parsePhotoLinks(form.photos);
  // Đồ đang gửi của hợp đồng đang chọn (các đợt nhập đã xác nhận) — chọn hạng mục từ đây, đồ ngoài danh sách có nhãn riêng.
  const inventoryFor = (contractId: string) => (contractId ? inventoryOf(contractIntakeBatches(db, contractId)).items : []);
  const inventory = inventoryFor(form.contractId);
  // Ngày sự cố tối đa = min(hôm nay, ngày trả kho) — KhoAn chỉ chịu trách nhiệm trong thời gian thuê (A2).
  const holdEnd = (() => { const c = byId(db.contracts, form.contractId); return c ? claimHoldEnd(c) : null; })();
  const maxIncident = [todayISO().slice(0, 10), holdEnd ?? '9999-12-31'].sort()[0];
  const ctx = { incidentDay: form.incidentAt, claimedElsewhere: claimedElsewhereOf(db.claims, form.contractId) };
  const itemsErr = claimItemsError(form.items, inventory, ctx);
  const dateErr = form.incidentAt > maxIncident ? (holdEnd && holdEnd < todayISO().slice(0, 10) ? `Sự cố sau ngày trả kho ${fmtDay(holdEnd)} — KhoAn chỉ chịu trách nhiệm trong thời gian thuê` : 'Ngày sự cố không được ở tương lai') : null;
  const valid = form.contractId && form.description.trim().length >= 10 && total > 0 && photos.ok && !itemsErr && !dateErr;

  const dayFor = (id: string) => { const c = byId(db.contracts, id); return [todayISO().slice(0, 10), (c && claimHoldEnd(c)) ?? '9999-12-31'].sort()[0]; };
  const reset = () => { const id = eligible[0]?._id ?? ''; setForm({ contractId: id, type: 'DAMAGE', incidentAt: dayFor(id), description: '', items: initialClaimItems(inventoryFor(id)), photos: '' }); };
  const current = view ? db.claims.find((c) => c._id === view._id) ?? null : null;

  return (
    <>
      <PageHeader
        title="Yêu cầu bồi thường"
        actions={eligible.length > 0 && <Button onClick={() => { reset(); setOpen(true); }}><Plus className="size-4" />Gửi yêu cầu</Button>}
      />
      {/* Hai quy định chính — dạng thẻ icon thay cho đoạn mô tả dài. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-stone-200">
          <IconTile icon={<CalendarClock className="size-5" />} tone="blue" />
          <p className="text-sm text-stone-700"><b className="text-ink">Hạn gửi {CLAIM_WINDOW_DAYS} ngày</b> kể từ khi xảy ra sự cố.</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-stone-200">
          <IconTile icon={<Scale className="size-5" />} tone="violet" />
          <p className="text-sm text-stone-700"><b className="text-ink">Bồi thường tối đa 10 lần tiền thuê một tháng</b> của ô kho (hoặc thiệt hại thực tế, lấy số nhỏ hơn) mỗi sự vụ.</p>
        </div>
      </div>

      {eligible.length === 0 && (
        <Card className="mb-4 flex items-center gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert className="size-5 shrink-0" />
          <p>Bạn không có hợp đồng thuê kho đang hiệu lực hoặc vừa kết thúc trong {CLAIM_WINDOW_DAYS} ngày nên chưa gửi được yêu cầu bồi thường.</p>
        </Card>
      )}

      <Card>
        <Table rows={claims} rowKey={(c) => c._id} onRowClick={setView}
          empty={<EmptyState icon={<HandCoins className="size-6" />} title="Chưa có yêu cầu nào" action={eligible.length > 0 ? <Button size="sm" onClick={() => { reset(); setOpen(true); }}><Plus className="size-4" />Gửi yêu cầu</Button> : undefined} />}
          columns={[
            { key: 'n', header: 'Mã hồ sơ', cell: (c) => <div><p className="font-mono text-xs">{c.claimNumber}</p><p className="text-xs text-stone-500">{fmtDate(c.createdAt)}</p></div> },
            { key: 'u', header: 'Kho', cell: (c) => <div><p>{unitLabel(db, c.unitId)}</p><p className="text-xs text-stone-500">{CLAIM_TYPE[c.type]}</p></div> },
            { key: 'a', header: 'Yêu cầu', className: 'tabular-nums', cell: (c) => vnd(c.claimedAmount) },
            { key: 'd', header: 'Được duyệt', className: 'tabular-nums', cell: (c) => (c.review ? <span className={cx(c.review.approvedAmount > 0 ? 'font-medium text-emerald-700' : 'text-stone-500')}>{vnd(c.review.approvedAmount)}</span> : '—') },
            { key: 's', header: 'Trạng thái', cell: (c) => <StatusBadge map={CLAIM_STATUS} value={c.status} /> },
          ]} />
      </Card>

      {/* ---- gửi yêu cầu ---- */}
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Gửi yêu cầu bồi thường"
        description={`Tổng khai báo hiện tại: ${vnd(total)}`}
        footer={<Button disabled={!valid} onClick={() => void run('createClaim', {
          // Gửi ngày thuần YYYY-MM-DD (ngày theo giờ Việt Nam khách chọn) — BE so theo NGÀY, không theo giờ UTC.
          contractId: form.contractId, type: form.type, incidentAt: form.incidentAt,
          description: form.description, items: form.items, photoUrls: photos.urls,
        }, (c) => `Đã gửi hồ sơ ${c.claimNumber} — chi nhánh sẽ liên hệ xác minh`, () => setOpen(false))}>Gửi yêu cầu</Button>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hợp đồng / kho">
              <select className={inputCls} value={form.contractId} onChange={(e) => { const id = e.target.value; setForm((f) => ({ ...f, contractId: id, incidentAt: [f.incidentAt, dayFor(id)].sort()[0], items: initialClaimItems(inventoryFor(id)) })); }}>
                <option value="">— Chọn kho —</option>
                {eligible.map((c) => <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {typeName(db, c.unitTypeId)}</option>)}
              </select>
            </Field>
            <Field label="Loại sự cố">
              <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ClaimType }))}>
                <option value="DAMAGE">{CLAIM_TYPE.DAMAGE}</option>
                <option value="LOSS">{CLAIM_TYPE.LOSS}</option>
              </select>
            </Field>
          </div>

          <Field label="Thời điểm xảy ra / phát hiện" error={dateErr ?? undefined}
            hint={holdEnd ? `Kho đã trả ngày ${fmtDay(holdEnd)} — chỉ nhận sự cố đến ngày này, trong ${CLAIM_WINDOW_DAYS} ngày` : `Không nhận yêu cầu quá ${CLAIM_WINDOW_DAYS} ngày kể từ ngày này`}>
            <input type="date" className={inputCls} max={maxIncident} min={addDays(todayISO(), -CLAIM_WINDOW_DAYS).slice(0, 10)}
              value={form.incidentAt} onChange={(e) => setForm((f) => ({ ...f, incidentAt: e.target.value }))} />
          </Field>

          <Field label="Diễn biến sự việc" hint="Tối thiểu 10 ký tự.">
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="VD: Ngày 12/9 tôi mở kho thì thấy trần thấm nước, hai thùng sách bị ướt và mốc." />
          </Field>

          <PhotoLinksField value={form.photos} onChange={(v) => setForm((f) => ({ ...f, photos: v }))} />

          <div>
            <ClaimItemsEditor items={form.items} onChange={(items) => setForm((f) => ({ ...f, items }))} inventory={inventory} ctx={ctx} />
            {itemsErr && form.items.length > 0 && <p className="mt-1 text-xs text-red-600">{itemsErr}</p>}
            <p className="mt-2 text-sm">Tổng khai báo: <b className={cx(cap !== null && total > cap && 'text-amber-700')}>{vnd(total)}</b>{cap !== null && <span className="text-stone-500"> · mức trách nhiệm của ô kho này {vnd(cap)}</span>}</p>
            {cap !== null && total > cap && (
              <p className="mt-1 text-xs text-amber-700">
                Vượt mức trách nhiệm tối đa {vnd(cap)} — số tiền duyệt không quá mức này.
              </p>
            )}
          </div>
        </div>
      </Modal>

      {/* ---- chi tiết ---- */}
      <Modal open={!!current} onClose={() => setView(null)} size="lg" title={`Hồ sơ ${current?.claimNumber ?? ''}`}
        description={current ? `${CLAIM_TYPE[current.type]} · kho ${unitLabel(db, current.unitId)}` : ''}
        footer={current && (current.status === 'SUBMITTED' || current.status === 'UNDER_REVIEW')
          ? <Button variant="secondary" onClick={() => void run('withdrawClaim', { claimId: current._id }, 'Đã rút hồ sơ', () => setView(null))}>Rút hồ sơ</Button>
          : undefined}>
        {current && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2"><StatusBadge map={CLAIM_STATUS} value={current.status} /></div>
            <KV items={[
              ['Ngày sự cố', fmtDate(current.incidentAt)],
              ['Ngày gửi', fmtDate(current.createdAt)],
              ['Tổng khai báo', vnd(current.claimedAmount)],
              ['Được duyệt', current.review ? vnd(current.review.approvedAmount) : 'Chưa có'],
            ]} />
            <div>
              <h4 className="mb-1 text-sm font-semibold">Diễn biến</h4>
              <p className="whitespace-pre-line text-sm text-stone-600">{current.description}</p>
            </div>
            {current.photoUrls?.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Ảnh chứng cứ</h4>
                <PhotoLinks urls={current.photoUrls} />
              </div>
            )}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Hạng mục</h4>
              <Table rows={current.items} rowKey={(it) => `${it.name}-${it.quantity}-${it.unitValue}`} columns={[
                { key: 'n', header: 'Tài sản', cell: (it) => <span className="inline-flex flex-wrap items-center gap-1.5">{it.name}<ClaimItemTag item={it} /></span> },
                { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
                { key: 'v', header: 'Thành tiền', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.unitValue) },
              ]} />
            </div>
            {current.review && (
              <div className="rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-stone-200">
                <p className="font-medium">Kết quả xét duyệt · {fmtDate(current.review.reviewedAt)}</p>
                <p className="mt-1 whitespace-pre-line text-stone-600">{current.review.decisionNote}</p>
                <p className="mt-2">Số tiền duyệt: <b>{vnd(current.review.approvedAmount)}</b> <span className="text-stone-500">(mức trách nhiệm tối đa {vnd(current.review.liabilityCap)})</span></p>
              </div>
            )}
            {current.settlement && (current.settlement.paidAt
              ? <p className="text-sm text-emerald-700">Đã chi {fmtDate(current.settlement.paidAt)} qua {current.settlement.method === 'CASH' ? 'tiền mặt tại quầy' : 'chuyển khoản'}.</p>
              : <p className="text-sm text-amber-700">Đã lập lệnh chuyển khoản — {user.customerProfile?.payoutAccount ? 'KhoAn chuyển tới tài khoản nhận tiền bạn đã khai và xác nhận kèm mã giao dịch.' : <>bạn chưa khai tài khoản nhận tiền: khai ở mục Thông tin cá nhân (biểu tượng bút cạnh tên bạn), hoặc chi nhánh sẽ liên hệ bạn.<Button size="sm" variant="secondary" className="ml-2" onClick={() => { setView(null); setProfileOpen(true); }}>Khai tài khoản nhận tiền</Button></>}</p>
            )}
            <Disclosure icon={<History className="size-4" />} title="Lịch sử xử lý" meta={`${current.statusHistory.length} bước`}>
              <ol className="space-y-1 text-sm">
                {current.statusHistory.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-24 shrink-0 text-xs text-stone-500">{fmtDate(h.at)}</span>
                    {h.from ? `${CLAIM_STATUS[h.from].label} → ` : ''}{CLAIM_STATUS[h.to].label}
                    {h.reason && <span className="text-stone-500"> · {h.reason}</span>}
                  </li>
                ))}
              </ol>
            </Disclosure>
          </div>
        )}
      </Modal>

      <p className="mt-4 flex items-center gap-2 text-xs text-stone-500">
        <LifeBuoy className="size-4 shrink-0 text-stone-400" />
        <span>Cần chi nhánh xử lý ngay (khóa hỏng, thấm dột…)? <Link href="/portal/tickets" className="text-brand-700 underline">Gửi yêu cầu hỗ trợ</Link>.</span>
      </p>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
