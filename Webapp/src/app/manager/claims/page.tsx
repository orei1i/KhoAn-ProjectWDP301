'use client';

import { useState } from 'react';
import { Banknote, Check, HandCoins, Search, X } from 'lucide-react';
import type { DamageClaim } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE } from '@/shared/lib/labels';
import { CLAIM_LIABILITY_CAP, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

type Tab = 'new' | 'review' | 'approved' | 'done';

const TAB_STATUS: Record<Tab, DamageClaim['status'][]> = {
  new: ['SUBMITTED'],
  review: ['UNDER_REVIEW'],
  approved: ['APPROVED'],
  done: ['PAID', 'REJECTED', 'WITHDRAWN'],
};

export default function ManagerClaims() {
  const { db, run } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const [tab, setTab] = useState<Tab>('new');
  const [view, setView] = useState<DamageClaim | null>(null);
  const [decision, setDecision] = useState({ amount: 0, note: '' });
  const [payMethod, setPayMethod] = useState<'BANK_TRANSFER' | 'CASH'>('BANK_TRANSFER');

  const all = db.claims.filter((c) => c.facilityId === fid);
  const rows = all.filter((c) => TAB_STATUS[tab].includes(c.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const c = view ? db.claims.find((x) => x._id === view._id) ?? null : null;

  const openClaim = (x: DamageClaim) => {
    setDecision({ amount: x.review?.approvedAmount || Math.min(x.claimedAmount, CLAIM_LIABILITY_CAP), note: '' });
    setView(x);
  };
  const cap = (x: DamageClaim) => Math.min(x.claimedAmount, CLAIM_LIABILITY_CAP);
  const decisionValid = c ? decision.note.trim().length >= 5 : false;

  return (
    <>
      <PageHeader
        title="Bồi thường hư hỏng & mất mát"
        description={`Mức trách nhiệm tối đa ${vnd(CLAIM_LIABILITY_CAP)} cho mỗi sự vụ theo Điều khoản dịch vụ. Số tiền duyệt được chốt cùng mức trách nhiệm vào hồ sơ, đổi điều khoản về sau không hồi tố.`}
        actions={<FacilityPicker scope={scope} />}
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
              ['Trần duyệt được', vnd(cap(c))],
            ]} />

            <div>
              <h4 className="mb-1 text-sm font-semibold">Khách mô tả</h4>
              <p className="whitespace-pre-line text-sm text-stone-600">{c.description}</p>
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
                <p>Phải tiếp nhận và xác minh hiện trường trước khi duyệt chi. Từ chối thẳng cũng được, nhưng phải ghi rõ căn cứ.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => run('reviewClaim', { claimId: c._id }, 'Đã chuyển sang xác minh')}><Search className="size-3.5" />Tiếp nhận xác minh</Button>
                </div>
              </div>
            )}

            {(c.status === 'UNDER_REVIEW' || c.status === 'SUBMITTED') && (
              <div className="space-y-3 border-t border-stone-100 pt-4">
                <h4 className="text-sm font-semibold">Quyết định</h4>
                {c.status === 'UNDER_REVIEW' && (
                  <Field label="Số tiền duyệt (VND)" hint={`Tối đa ${vnd(cap(c))} — không vượt số khách yêu cầu và không vượt mức trách nhiệm ${vnd(CLAIM_LIABILITY_CAP)}`}>
                    <input type="number" min={0} max={cap(c)} step={10_000} className={inputCls} value={decision.amount}
                      onChange={(e) => setDecision((d) => ({ ...d, amount: Math.max(0, Math.min(cap(c), Number(e.target.value) || 0)) }))} />
                  </Field>
                )}
                <Field label="Căn cứ quyết định" hint="Khách đọc được nội dung này. Tối thiểu 5 ký tự.">
                  <textarea className={inputCls} rows={3} value={decision.note} onChange={(e) => setDecision((d) => ({ ...d, note: e.target.value }))}
                    placeholder="VD: Đã đối chiếu camera 12/9, xác nhận trần thấm do lỗi bảo trì của kho. Duyệt 80% giá trị khai báo theo mức khấu hao." />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {c.status === 'UNDER_REVIEW' && (
                    <Button disabled={!decisionValid || decision.amount <= 0}
                      onClick={() => run('decideClaim', { claimId: c._id, approve: true, approvedAmount: decision.amount, note: decision.note }, `Đã duyệt ${vnd(decision.amount)} — chuyển sang chờ chi`)}>
                      <Check className="size-4" />Duyệt {vnd(decision.amount)}
                    </Button>
                  )}
                  <Button variant="danger" disabled={!decisionValid}
                    onClick={() => run('decideClaim', { claimId: c._id, approve: false, note: decision.note }, 'Đã từ chối hồ sơ')}>
                    <X className="size-4" />Từ chối
                  </Button>
                </div>
              </div>
            )}

            {c.status === 'APPROVED' && (
              <div className="space-y-3 border-t border-stone-100 pt-4">
                <h4 className="text-sm font-semibold">Chi tiền bồi thường</h4>
                <Field label="Hình thức chi">
                  <select className={inputCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'BANK_TRANSFER' | 'CASH')}>
                    <option value="BANK_TRANSFER">Chuyển khoản</option>
                    <option value="CASH">Tiền mặt tại quầy</option>
                  </select>
                </Field>
                <Button onClick={() => run('payClaim', { claimId: c._id, method: payMethod }, (v) => `Đã chi ${vnd(v)} cho khách`, () => setView(null))}>
                  <Banknote className="size-4" />Chi {vnd(c.review?.approvedAmount ?? 0)}
                </Button>
                <p className="text-xs text-stone-500">Khoản chi ghi vào sổ thanh toán dưới dạng chiều tiền ra, trừ vào doanh thu thuần của chi nhánh trong báo cáo.</p>
              </div>
            )}

            {c.settlement && (
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
    </>
  );
}
