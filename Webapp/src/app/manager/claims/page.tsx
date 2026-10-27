'use client';

import { useState } from 'react';
import { Banknote, Check, HandCoins, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { CLAIM_COUNTED_STATUSES, CLAIM_FM_APPROVAL_LIMIT, claimCapOf, claimNeedsOps, sameIncident, type ClaimItem, type ClaimType, type DamageClaim } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE } from '@/shared/lib/labels';
import { byId, CLAIM_WINDOW_DAYS, claimTotal, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { PhotoLinks, PhotoLinksField, parsePhotoLinks } from '@/shared/ui/photo-links';

type Tab = 'new' | 'review' | 'approved' | 'done';
const EMPTY_ITEM: ClaimItem = { name: '', quantity: 1, unitValue: 0 };
const newForm = () => ({ contractId: '', type: 'DAMAGE' as ClaimType, incidentAt: todayISO().slice(0, 10), description: '', items: [{ ...EMPTY_ITEM }] as ClaimItem[], photos: '' });

const TAB_STATUS: Record<Tab, DamageClaim['status'][]> = {
  new: ['SUBMITTED'],
  review: ['UNDER_REVIEW'],
  approved: ['APPROVED'],
  done: ['PAID', 'REJECTED', 'WITHDRAWN'],
};

export default function ManagerClaims() {
  const { db, user, run } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const [tab, setTab] = useState<Tab>('new');
  const [view, setView] = useState<DamageClaim | null>(null);
  const [decision, setDecision] = useState({ amount: 0, note: '' });
  const [payMethod, setPayMethod] = useState<'BANK_TRANSFER' | 'CASH'>('BANK_TRANSFER');
  // Lập hồ sơ hộ khách tại quầy — hồ sơ đứng tên khách của hợp đồng.
  const [filing, setFiling] = useState(false);
  const [form, setForm] = useState(newForm);

  const all = db.claims.filter((c) => c.facilityId === fid);
  const rows = all.filter((c) => TAB_STATUS[tab].includes(c.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const c = view ? db.claims.find((x) => x._id === view._id) ?? null : null;

  // Điều 6: mức trách nhiệm = 10 × giá thuê tháng của ô kho (đã duyệt thì lấy mức chốt trong hồ sơ).
  const liability = (x: DamageClaim) => x.review?.liabilityCap ?? claimCapOf(byId(db.contracts, x.contractId), db.unitTypes, x.incidentAt) ?? 0;
  // Một SỰ VỤ = các hồ sơ cùng hợp đồng, cùng ngày sự cố (hoặc cùng phiếu sự cố) — tách hồ sơ không lách được hạn mức.
  const incidentClaimed = (x: DamageClaim) => x.claimedAmount + db.claims
    .filter((o) => o._id !== x._id && (CLAIM_COUNTED_STATUSES as readonly string[]).includes(o.status) && sameIncident(o, x))
    .reduce((s, o) => s + o.claimedAmount, 0);
  const opsOnly = (x: DamageClaim) => user?.role === 'FACILITY_MANAGER' && claimNeedsOps(incidentClaimed(x), liability(x));
  const cap = (x: DamageClaim) => Math.min(x.claimedAmount, liability(x));
  const openClaim = (x: DamageClaim) => {
    setDecision({ amount: x.review?.approvedAmount || Math.min(cap(x), CLAIM_FM_APPROVAL_LIMIT), note: '' });
    setView(x);
  };
  const decisionValid = c ? decision.note.trim().length >= 5 : false;
  const overMyLimit = user?.role === 'FACILITY_MANAGER' && decision.amount > CLAIM_FM_APPROVAL_LIMIT;
  const iApproved = !!c && !!user && c.review?.reviewedBy === user._id;
  const iCreated = !!c && !!user && c.statusHistory[0]?.by === user._id; // lập hộ khách thì không tự duyệt
  const transferPending = !!c?.settlement && !c.settlement.paidAt;
  // BE tự kiểm: hồ sơ do vận hành quyết / khoản lớn thì chỉ vận hành mở lại — bị từ chối thì run() hiện lỗi của BE.
  const reopen = (x: DamageClaim) => void run('reviewClaim', { claimId: x._id }, 'Đã mở lại — hồ sơ chuyển sang xác minh');

  // Hợp đồng còn mở, hoặc đã đóng (trừ thanh lý hàng bỏ lại) trong vòng 30 ngày — cùng điều kiện khách tự gửi.
  const eligible = db.contracts.filter((x) => x.facilityId === fid && x.status !== 'ABANDONED' && (x.status !== 'CLOSED' || (x.closedAt ?? '') >= addDays(todayISO(), -CLAIM_WINDOW_DAYS)))
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
  const fc = byId(db.contracts, form.contractId);
  const formTotal = claimTotal(form.items);
  const formCap = claimCapOf(fc, db.unitTypes, `${form.incidentAt}T00:00:00.000Z`);
  // Ngày sự cố: không trước ngày bắt đầu thuê, không quá 30 ngày, không ở tương lai (như BE).
  const minIncident = [addDays(todayISO(), -CLAIM_WINDOW_DAYS).slice(0, 10), fc?.startDate.slice(0, 10) ?? ''].sort().pop()!;
  const formPhotos = parsePhotoLinks(form.photos);
  const formValid = !!fc && form.description.trim().length >= 10 && formTotal > 0 && formPhotos.ok && form.incidentAt >= minIncident && form.incidentAt <= todayISO().slice(0, 10)
    && form.items.every((it) => it.name.trim() && it.quantity > 0 && it.unitValue >= 0);
  const setItem = (i: number, patch: Partial<ClaimItem>) => setForm((f) => ({ ...f, items: f.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }));

  return (
    <>
      <PageHeader
        title="Bồi thường hư hỏng & mất mát"
        description={`Tối đa 10 tháng tiền thuê của ô (Điều 6). Quản lý chi nhánh duyệt tới ${vnd(CLAIM_FM_APPROVAL_LIMIT)}; người duyệt không tự chi.`}
        actions={<><FacilityPicker scope={scope} /><Button onClick={() => { setForm(newForm()); setFiling(true); }}><Plus className="size-4" />Lập hồ sơ hộ khách</Button></>}
      />

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'new', label: 'Chờ tiếp nhận', count: all.filter((x) => x.status === 'SUBMITTED').length },
        { key: 'review', label: 'Đang xác minh', count: all.filter((x) => x.status === 'UNDER_REVIEW').length },
        { key: 'approved', label: 'Đã duyệt, chờ chi', count: all.filter((x) => x.status === 'APPROVED').length },
        { key: 'done', label: 'Đã kết thúc', count: all.filter((x) => TAB_STATUS.done.includes(x.status)).length },
      ]} />

      <Card className="mt-4">
        <Table rows={rows} rowKey={(x) => x._id} onRowClick={openClaim}
          empty={<EmptyState icon={<HandCoins className="size-6" />} title="Không có hồ sơ trong mục này" />}
          columns={[
            { key: 'n', header: 'Hồ sơ', cell: (x) => <div><p className="font-mono text-xs">{x.claimNumber}</p><p className="text-xs text-stone-500">{fmtDate(x.createdAt)}</p></div> },
            { key: 'k', header: 'Khách hàng', cell: (x) => <div><p>{userName(db, x.customerId)}</p><p className="text-xs text-stone-500">kho {unitLabel(db, x.unitId)}</p></div> },
            { key: 't', header: 'Loại', cell: (x) => <Badge tone={x.type === 'LOSS' ? 'red' : 'amber'}>{CLAIM_TYPE[x.type]}</Badge> },
            { key: 'a', header: 'Khách yêu cầu', className: 'tabular-nums', cell: (x) => vnd(x.claimedAmount) },
            { key: 'd', header: 'Duyệt', className: 'tabular-nums', cell: (x) => (x.review ? vnd(x.review.approvedAmount) : '—') },
            { key: 's', header: 'Trạng thái', cell: (x) => <StatusBadge map={CLAIM_STATUS} value={x.status} /> },
            { key: 'go', header: '', className: 'text-right', cell: (x) => (
              <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                {x.status === 'SUBMITTED' && <Button size="sm" variant="secondary" onClick={() => run('reviewClaim', { claimId: x._id }, 'Đã tiếp nhận — hồ sơ chuyển sang xác minh')}><Search className="size-3.5" />Tiếp nhận</Button>}
                {x.status === 'APPROVED' && <Button size="sm" onClick={() => openClaim(x)}><Banknote className="size-3.5" />Chi tiền</Button>}
                {x.status === 'REJECTED' && <Button size="sm" variant="ghost" onClick={() => reopen(x)}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>}
              </div>
            ) },
          ]} />
      </Card>

      <Modal open={!!c} onClose={() => setView(null)} size="lg" title={`Hồ sơ ${c?.claimNumber ?? ''}`}
        description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · ${CLAIM_TYPE[c.type]}` : ''}>
        {c && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2"><StatusBadge map={CLAIM_STATUS} value={c.status} /></div>
            <KV items={[
              ['Ngày sự cố', fmtDate(c.incidentAt)],
              ['Ngày gửi', fmtDate(c.createdAt)],
              ['Khách yêu cầu', vnd(c.claimedAmount)],
              ['Mức trách nhiệm (Điều 6)', vnd(liability(c))],
              ['Trần duyệt được', vnd(cap(c))],
            ]} />

            <div>
              <h4 className="mb-1 text-sm font-semibold">Khách mô tả</h4>
              <p className="whitespace-pre-line text-sm text-stone-600">{c.description}</p>
              {c.photoUrls?.length > 0 && <div className="mt-2"><PhotoLinks urls={c.photoUrls} /></div>}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Hạng mục khai báo</h4>
              <Table rows={c.items} rowKey={(it) => `${it.name}-${it.quantity}-${it.unitValue}`} columns={[
                { key: 'n', header: 'Tài sản', cell: (it) => <div><p>{it.name}</p>{it.note && <p className="text-xs text-stone-500">{it.note}</p>}</div> },
                { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
                { key: 'u', header: 'Đơn giá', className: 'text-right tabular-nums', cell: (it) => vnd(it.unitValue) },
                { key: 'v', header: 'Thành tiền', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.unitValue) },
              ]} />
            </div>

            {c.review && (
              <div className="rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-stone-200">
                <p className="font-medium">Đã quyết định {fmtDate(c.review.reviewedAt)} · {userName(db, c.review.reviewedBy)}</p>
                <p className="mt-1 whitespace-pre-line text-stone-600">{c.review.decisionNote}</p>
                <p className="mt-2">Duyệt <b>{vnd(c.review.approvedAmount)}</b> <span className="text-stone-500">/ mức trách nhiệm {vnd(c.review.liabilityCap)}</span></p>
              </div>
            )}

            {/* ---- hành động theo trạng thái ---- */}
            {c.status === 'SUBMITTED' && (
              <div className="rounded-lg bg-brand-50 p-4 text-sm ring-1 ring-brand-200">
                <p>Tiếp nhận và xác minh hiện trường trước khi duyệt chi.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => run('reviewClaim', { claimId: c._id }, 'Đã chuyển sang xác minh')}><Search className="size-3.5" />Tiếp nhận xác minh</Button>
                </div>
              </div>
            )}

            {(c.status === 'UNDER_REVIEW' || c.status === 'SUBMITTED') && opsOnly(c) && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                Giá trị xét {vnd(Math.min(incidentClaimed(c), liability(c)))} — trên {vnd(CLAIM_FM_APPROVAL_LIMIT)}, Quản lý vận hành duyệt.
              </p>
            )}

            {(c.status === 'UNDER_REVIEW' || c.status === 'SUBMITTED') && !opsOnly(c) && (
              <div className="space-y-3 border-t border-stone-100 pt-4">
                <h4 className="text-sm font-semibold">Quyết định</h4>
                {c.status === 'UNDER_REVIEW' && (
                  <Field label="Số tiền duyệt (VND)" hint={`Tối đa ${vnd(cap(c))}.`}>
                    <input type="number" min={0} max={cap(c)} step={10_000} className={inputCls} value={decision.amount}
                      onChange={(e) => setDecision((d) => ({ ...d, amount: Math.max(0, Math.min(cap(c), Number(e.target.value) || 0)) }))} />
                  </Field>
                )}
                <Field label="Căn cứ quyết định" hint="Khách đọc được.">
                  <textarea className={inputCls} rows={3} value={decision.note} onChange={(e) => setDecision((d) => ({ ...d, note: e.target.value }))}
                    placeholder="VD: Đã kiểm tra hiện trường 12/9, trần thấm do lỗi bảo trì của kho. Duyệt 80% giá trị khai báo theo khấu hao." />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {c.status === 'UNDER_REVIEW' && (
                    <Button disabled={!decisionValid || decision.amount <= 0 || overMyLimit || iCreated}
                      onClick={() => run('decideClaim', { claimId: c._id, approve: true, approvedAmount: decision.amount, note: decision.note }, `Đã duyệt ${vnd(decision.amount)} — chuyển sang chờ chi`)}>
                      <Check className="size-4" />Duyệt {vnd(decision.amount)}
                    </Button>
                  )}
                  <Button variant="danger" disabled={!decisionValid}
                    onClick={() => run('decideClaim', { claimId: c._id, approve: false, note: decision.note }, 'Đã từ chối hồ sơ')}>
                    <X className="size-4" />Từ chối
                  </Button>
                </div>
                {iCreated && <p className="text-xs text-amber-700">Bạn lập hồ sơ này — người khác duyệt.</p>}
                {overMyLimit && (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                    Trên {vnd(CLAIM_FM_APPROVAL_LIMIT)} cần Quản lý vận hành duyệt; bạn vẫn duyệt được mức thấp hơn hoặc từ chối.
                  </p>
                )}
              </div>
            )}

            {c.status === 'REJECTED' && (
              <div className="border-t border-stone-100 pt-4">
                <Button size="sm" variant="secondary" onClick={() => reopen(c)}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>
              </div>
            )}

            {c.status === 'APPROVED' && transferPending && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                Đã lập lệnh chuyển khoản {vnd(c.review?.approvedAmount ?? 0)} — chờ xác nhận đã chuyển.
                {iApproved && ' Người khác phải xác nhận.'}
              </p>
            )}

            {c.status === 'APPROVED' && !transferPending && (
              <div className="space-y-3 border-t border-stone-100 pt-4">
                <h4 className="text-sm font-semibold">Chi tiền bồi thường</h4>
                <Field label="Hình thức chi">
                  <select className={inputCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'BANK_TRANSFER' | 'CASH')}>
                    <option value="BANK_TRANSFER">Chuyển khoản</option>
                    <option value="CASH">Tiền mặt tại quầy</option>
                  </select>
                </Field>
                <Button disabled={payMethod === 'CASH' && iApproved}
                  onClick={() => run('payClaim', { claimId: c._id, method: payMethod }, (v) => (v.pending ? `Đã lập lệnh chuyển khoản ${vnd(v.amount)} — chờ xác nhận đã chuyển` : `Đã chi ${vnd(v.amount)} cho khách`), () => setView(null))}>
                  <Banknote className="size-4" />{payMethod === 'CASH' ? `Chi ${vnd(c.review?.approvedAmount ?? 0)} tiền mặt` : `Lập lệnh chuyển khoản ${vnd(c.review?.approvedAmount ?? 0)}`}
                </Button>
                {payMethod === 'CASH' && iApproved && <p className="text-xs text-amber-700">Bạn đã duyệt — tiền mặt do người khác chi.</p>}
              </div>
            )}

            {c.settlement?.paidAt && (
              <p className="text-sm text-emerald-700">
                Đã chi {fmtDate(c.settlement.paidAt)} qua {c.settlement.method === 'CASH' ? 'tiền mặt tại quầy' : 'chuyển khoản'}.
              </p>
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold">Lịch sử xử lý</h4>
              <ol className="space-y-1 text-sm">
                {c.statusHistory.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-24 shrink-0 text-xs text-stone-500">{fmtDate(h.at)}</span>
                    {h.from ? `${CLAIM_STATUS[h.from].label} → ` : ''}{CLAIM_STATUS[h.to].label}
                    {h.by && <span className="text-stone-500"> · {userName(db, h.by)}</span>}
                    {h.reason && <span className="text-stone-500"> · {h.reason}</span>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={filing} onClose={() => setFiling(false)} size="lg" title="Lập hồ sơ bồi thường hộ khách" description={`Tổng khai báo: ${vnd(formTotal)}`}
        footer={<Button disabled={!formValid} onClick={() => void run('createClaim', {
          // Ngày thuần YYYY-MM-DD theo giờ Việt Nam — BE so theo NGÀY.
          contractId: form.contractId, type: form.type, incidentAt: form.incidentAt, description: form.description.trim(), items: form.items, photoUrls: formPhotos.urls,
        }, (x) => `Đã lập hồ sơ ${x.claimNumber}`, () => setFiling(false))}>Lập hồ sơ</Button>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hợp đồng / kho">
              <select className={inputCls} value={form.contractId} onChange={(e) => setForm((f) => ({ ...f, contractId: e.target.value }))}>
                <option value="">— Chọn hợp đồng —</option>
                {eligible.map((x) => <option key={x._id} value={x._id}>{unitLabel(db, x.unitId)} · {userName(db, x.customerId)} · {typeName(db, x.unitTypeId)}{x.status === 'CLOSED' ? ' · đã đóng' : ''}</option>)}
              </select>
            </Field>
            <Field label="Loại sự cố">
              <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ClaimType }))}>
                <option value="DAMAGE">{CLAIM_TYPE.DAMAGE}</option>
                <option value="LOSS">{CLAIM_TYPE.LOSS}</option>
              </select>
            </Field>
          </div>
          <Field label="Ngày xảy ra / phát hiện">
            <input type="date" className={inputCls} max={todayISO().slice(0, 10)} min={minIncident}
              value={form.incidentAt} onChange={(e) => setForm((f) => ({ ...f, incidentAt: e.target.value }))} />
          </Field>
          <Field label="Diễn biến" hint="Tối thiểu 10 ký tự.">
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <PhotoLinksField value={form.photos} onChange={(v) => setForm((f) => ({ ...f, photos: v }))} />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-stone-700">Hạng mục thiệt hại</p>
              <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))}><Plus className="size-3.5" />Thêm dòng</Button>
            </div>
            <div className="space-y-2">
              {form.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_72px_140px_32px] items-center gap-2">
                  <input className={inputCls} placeholder="Tên tài sản" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
                  <input type="number" min={1} max={999} className={inputCls} value={it.quantity} onChange={(e) => setItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
                  <input type="number" min={0} step={10_000} className={inputCls} placeholder="Giá trị / cái" value={it.unitValue} onChange={(e) => setItem(i, { unitValue: Math.max(0, Number(e.target.value) || 0) })} />
                  <button type="button" aria-label="Xóa dòng" disabled={form.items.length === 1}
                    onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, k) => k !== i) }))}
                    className="grid size-8 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-600 disabled:opacity-30"><Trash2 className="size-4" /></button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-sm">Tổng khai báo: <b className={cx(formCap !== null && formTotal > formCap && 'text-amber-700')}>{vnd(formTotal)}</b>{formCap !== null && <span className="text-stone-500"> · mức trách nhiệm {vnd(formCap)}</span>}</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
