'use client';

import { useState } from 'react';
import { BadgePercent, Banknote, Check, ClipboardCheck, HandCoins, PackageX, RotateCcw, X } from 'lucide-react';
import { abandonDaysOf, CLAIM_FM_APPROVAL_LIMIT, claimCapOf, inspectionDisputeDeadline, isClosedContract, OPEN_CONTRACT_STATUSES, type DamageClaim, type PaymentTransaction, type RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE, PAYMENT_TYPE } from '@/shared/lib/labels';
import { byId, effectivePolicy, facilityName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';
import { InspectionReport } from '@/features/contracts/inspection-report';
import { AbandonDialog, abandonFrom, noticeDelivered } from '@/features/contracts/abandon-dialog';

type Tab = 'claims' | 'rejected' | 'settle' | 'fees' | 'abandon' | 'payouts';

/**
 * Việc cần cấp trên của cả chuỗi: duyệt hồ sơ bồi thường vượt hạn mức quản lý chi nhánh; điều chỉnh biên bản trả kho / xoá nợ sau
 * quyết toán vượt hạn mức miễn giảm của chi nhánh; xác nhận đã chuyển khoản các khoản hoàn / bồi thường / trả lại sau thanh lý.
 * Người đã duyệt một hồ sơ bồi thường không được tự xác nhận khoản chi của chính hồ sơ đó.
 */
export default function OpsApprovals() {
  const { db, user, run } = useStore();
  const [tab, setTab] = useState<Tab>('claims');
  const [view, setView] = useState<DamageClaim | null>(null);
  const [decision, setDecision] = useState({ amount: 0, note: '' });
  const [payout, setPayout] = useState<PaymentTransaction | null>(null);
  const [payoutForm, setPayoutForm] = useState({ reference: '', toAccount: '' });
  const [adjust, setAdjust] = useState<RentalContract | null>(null);
  const [adjustForm, setAdjustForm] = useState({ amount: 0, reason: '' });
  const [writeOff, setWriteOff] = useState<RentalContract | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [waive, setWaive] = useState<RentalContract | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [abandon, setAbandon] = useState<RentalContract | null>(null);

  const capOf = (x: DamageClaim) => x.review?.liabilityCap ?? claimCapOf(byId(db.contracts, x.contractId), db.unitTypes, x.incidentAt) ?? 0;
  const maxApprove = (x: DamageClaim) => Math.min(x.claimedAmount, capOf(x));
  const claims = db.claims.filter((x) => x.status === 'UNDER_REVIEW')
    .sort((a, b) => Number(b.claimedAmount > CLAIM_FM_APPROVAL_LIMIT) - Number(a.claimedAmount > CLAIM_FM_APPROVAL_LIMIT) || a.createdAt.localeCompare(b.createdAt));
  // Hồ sơ đã từ chối trong 90 ngày gần đây — mở lại xem xét khi khách khiếu nại lại (vận hành mở được mọi hồ sơ).
  const rejected = db.claims.filter((x) => x.status === 'REJECTED' && (x.review?.reviewedAt ?? x.createdAt) >= addDays(todayISO(), -90))
    .sort((a, b) => (b.review?.reviewedAt ?? b.createdAt).localeCompare(a.review?.reviewedAt ?? a.createdAt));
  // Điều khoản hứa hoàn trong 7 ngày làm việc: khoản chờ chuyển quá 7 ngày gắn nhãn "Quá hạn" và lên đầu.
  const payoutLate = (p: PaymentTransaction) => p.createdAt < addDays(todayISO(), -7);
  const payouts = db.payments.filter((p) => p.direction === 'REFUND' && p.method === 'BANK_TRANSFER' && p.status === 'PENDING')
    .sort((a, b) => Number(payoutLate(b)) - Number(payoutLate(a)) || a.createdAt.localeCompare(b.createdAt));
  const claimOf = (p: PaymentTransaction) => db.claims.find((x) => x.settlement?.paymentId === p._id);
  // Khoản chi mình đã duyệt (bồi thường) hoặc tự điều chỉnh (hoàn sau khiếu nại) thì người khác xác nhận đã chuyển.
  const selfApproved = (p: PaymentTransaction) => !!user && (p.createdBy === user._id || claimOf(p)?.review?.reviewedBy === user._id
    || db.inspections.some((i) => (i.adjustments ?? []).some((a) => a.refundPaymentId === p._id && a.by === user._id)));
  const accountOf = (p: PaymentTransaction) => db.users.find((u) => u._id === p.customerId)?.customerProfile?.payoutAccount;
  const c = view ? db.claims.find((x) => x._id === view._id) ?? null : null;

  // Biên bản trả kho còn điều chỉnh được (khách khiếu nại đúng — Điều 9) và nợ sau quyết toán: phần vượt hạn mức miễn giảm của chi
  // nhánh do vận hành xử lý. Hợp đồng đang có khách khiếu nại (phiếu thanh toán còn mở) lên đầu.
  const T = todayISO();
  const myLimit = (facilityId: string) => effectivePolicy(db, facilityId)?.waiverLimits.find((w) => w.role === user?.role)?.maxAmount ?? 0;
  const moveOutInspection = (x: RentalContract) => db.inspections.find((i) => i.contractId === x._id && i.type === 'MOVE_OUT');
  const damageRoom = (x: RentalContract) => { const i = moveOutInspection(x); return i ? i.totalDamageFee - (i.adjustments ?? []).reduce((sum, a) => sum + a.amount, 0) : 0; };
  /** Khiếu nại của chính khách (phiếu thanh toán gắn hợp đồng) gửi trong hạn — điều kiện bắt buộc để điều chỉnh biên bản. */
  const disputeOf = (x: RentalContract) => {
    const i = moveOutInspection(x);
    return i ? db.tickets.find((t) => t.contractId === x._id && t.reporterId === x.customerId && t.category === 'BILLING' && t.createdAt >= i.performedAt && new Date(t.createdAt).getTime() < inspectionDisputeDeadline(i.performedAt)) : undefined;
  };
  const settle = db.contracts
    .filter((x) => isClosedContract(x.status) && (x.balance.outstanding > 0 || (x.status === 'CLOSED' && damageRoom(x) > 0 && (x.closedAt ?? '') >= addDays(T, -60))))
    .sort((a, b) => Number(!!disputeOf(b)) - Number(!!disputeOf(a)) || (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
  const adjustMax = (x: RentalContract) => Math.min(damageRoom(x), myLimit(x.facilityId));
  // Phí trễ hạn của hợp đồng đang mở (toàn chuỗi) — phần vượt hạn mức miễn giảm của quản lý chi nhánh lên đầu.
  const fmLimit = (facilityId: string) => effectivePolicy(db, facilityId)?.waiverLimits.find((w) => w.role === 'FACILITY_MANAGER')?.maxAmount ?? 0;
  const lateFee = (x: RentalContract) => x.delinquency?.lateFeesAccrued ?? 0;
  const fees = db.contracts.filter((x) => OPEN_CONTRACT_STATUSES.includes(x.status) && lateFee(x) > 0)
    .sort((a, b) => Number(lateFee(b) > fmLimit(b.facilityId)) - Number(lateFee(a) > fmLimit(a.facilityId)) || lateFee(b) - lateFee(a));
  // Đồ bỏ lại đã đủ điều kiện xử lý (thông báo cuối đã tới khách, quá hạn chót) — tiền thanh lý / chi phí lớn chỉ Vận hành xử lý.
  const abandonDays = (x: RentalContract) => abandonDaysOf(db.policies.find((p) => p._id === x.terms.policyId) ?? effectivePolicy(db, x.facilityId));
  const abandonable = db.contracts.filter((x) => x.status === 'LOCKED_OUT' && noticeDelivered(x) && (abandonFrom(x, abandonDays(x)) ?? '9999') <= T.slice(0, 10));

  return (
    <>
      <PageHeader title="Duyệt & chi"
        description={`Bồi thường trên ${vnd(CLAIM_FM_APPROVAL_LIMIT)}, điều chỉnh / xoá nợ vượt hạn mức chi nhánh, xác nhận chuyển khoản.`} />

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'claims', label: 'Bồi thường chờ duyệt', count: claims.length },
        { key: 'rejected', label: 'Bồi thường đã từ chối', count: rejected.length },
        { key: 'settle', label: 'Biên bản & nợ sau quyết toán', count: settle.length },
        { key: 'fees', label: 'Miễn phí trễ', count: fees.length },
        { key: 'abandon', label: 'Đồ bỏ lại', count: abandonable.length },
        { key: 'payouts', label: 'Chờ chuyển khoản', count: payouts.length },
      ]} />

      {tab === 'claims' ? (
        <Card className="mt-4">
          <Table rows={claims} rowKey={(x) => x._id} onRowClick={(x) => { setDecision({ amount: maxApprove(x), note: '' }); setView(x); }}
            empty={<EmptyState icon={<HandCoins className="size-6" />} title="Không có hồ sơ nào đang xác minh" />}
            columns={[
              { key: 'n', header: 'Hồ sơ', cell: (x) => <div><p className="font-mono text-xs">{x.claimNumber}</p><p className="text-xs text-stone-500">{facilityName(db, x.facilityId)}</p></div> },
              { key: 'k', header: 'Khách hàng', cell: (x) => <div><p>{userName(db, x.customerId)}</p><p className="text-xs text-stone-500">kho {unitLabel(db, x.unitId)} · {CLAIM_TYPE[x.type]}</p></div> },
              { key: 'a', header: 'Khách yêu cầu', className: 'tabular-nums', cell: (x) => vnd(x.claimedAmount) },
              { key: 'm', header: 'Mức trách nhiệm', className: 'tabular-nums', cell: (x) => vnd(capOf(x)) },
              { key: 'l', header: '', cell: (x) => (x.claimedAmount > CLAIM_FM_APPROVAL_LIMIT ? <Badge tone="amber">Vượt hạn mức chi nhánh</Badge> : <span className="text-xs text-stone-500">Chi nhánh tự duyệt được</span>) },
            ]} />
        </Card>
      ) : tab === 'rejected' ? (
        <Card className="mt-4">
          <Table rows={rejected} rowKey={(x) => x._id} onRowClick={setView}
            empty={<EmptyState icon={<HandCoins className="size-6" />} title="Không có hồ sơ bị từ chối trong 90 ngày" />}
            columns={[
              { key: 'n', header: 'Hồ sơ', cell: (x) => <div><p className="font-mono text-xs">{x.claimNumber}</p><p className="text-xs text-stone-500">{facilityName(db, x.facilityId)}</p></div> },
              { key: 'k', header: 'Khách hàng', cell: (x) => <div><p>{userName(db, x.customerId)}</p><p className="text-xs text-stone-500">kho {unitLabel(db, x.unitId)} · {CLAIM_TYPE[x.type]}</p></div> },
              { key: 'a', header: 'Khách yêu cầu', className: 'tabular-nums', cell: (x) => vnd(x.claimedAmount) },
              { key: 'd', header: 'Từ chối', cell: (x) => <div><p>{fmtDate(x.review?.reviewedAt)}</p><p className="text-xs text-stone-500">{x.review ? userName(db, x.review.reviewedBy) : '—'}</p></div> },
              { key: 'x', header: '', className: 'text-right', cell: (x) => (
                <div onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="secondary" onClick={() => void run('reviewClaim', { claimId: x._id }, 'Đã mở lại — hồ sơ chuyển sang xác minh')}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>
                </div>
              ) },
            ]} />
        </Card>
      ) : tab === 'fees' ? (
        <Card className="mt-4">
          <Table rows={fees} rowKey={(x) => x._id}
            empty={<EmptyState icon={<BadgePercent className="size-6" />} title="Không có hợp đồng nào đang chịu phí trễ" />}
            columns={[
              { key: 'k', header: 'Khách hàng', cell: (x) => <div><p>{userName(db, x.customerId)}</p><p className="text-xs text-stone-500">{facilityName(db, x.facilityId)} · kho {unitLabel(db, x.unitId)} · <span className="font-mono">{x.contractNumber}</span></p></div> },
              { key: 'q', header: 'Quá hạn', cell: (x) => `${x.delinquency?.daysOverdue ?? 0} ngày` },
              { key: 'f', header: 'Phí trễ', className: 'tabular-nums', cell: (x) => vnd(lateFee(x)) },
              { key: 'o', header: 'Dư nợ', className: 'tabular-nums', cell: (x) => vnd(x.balance.outstanding) },
              { key: 'l', header: '', cell: (x) => (lateFee(x) > fmLimit(x.facilityId) ? <Badge tone="amber">Vượt hạn mức chi nhánh</Badge> : null) },
              { key: 'x', header: '', className: 'text-right', cell: (x) => <Button size="sm" variant="secondary" onClick={() => { setWaiveReason(''); setWaive(x); }}><BadgePercent className="size-3.5" />Miễn phí trễ</Button> },
            ]} />
        </Card>
      ) : tab === 'abandon' ? (
        <Card className="mt-4">
          <Table rows={abandonable} rowKey={(x) => x._id}
            empty={<EmptyState icon={<PackageX className="size-6" />} title="Không có hợp đồng nào chờ xử lý đồ bỏ lại" />}
            columns={[
              { key: 'k', header: 'Khách hàng', cell: (x) => <div><p>{userName(db, x.customerId)}</p><p className="text-xs text-stone-500">{facilityName(db, x.facilityId)} · kho {unitLabel(db, x.unitId)} · <span className="font-mono">{x.contractNumber}</span></p></div> },
              { key: 'd', header: 'Xử lý từ', cell: (x) => fmtDate(abandonFrom(x, abandonDays(x))) },
              { key: 'o', header: 'Dư nợ', className: 'tabular-nums', cell: (x) => vnd(x.balance.outstanding) },
              { key: 'x', header: '', className: 'text-right', cell: (x) => <Button size="sm" variant="danger" onClick={() => setAbandon(x)}><PackageX className="size-3.5" />Xử lý hàng bỏ lại</Button> },
            ]} />
        </Card>
      ) : tab === 'settle' ? (
        <Card className="mt-4">
          <Table rows={settle} rowKey={(x) => x._id}
            empty={<EmptyState icon={<ClipboardCheck className="size-6" />} title="Không có hợp đồng nào cần điều chỉnh biên bản hay xoá nợ" />}
            columns={[
              { key: 'k', header: 'Khách hàng', cell: (x) => <div><p>{userName(db, x.customerId)}</p><p className="text-xs text-stone-500">{facilityName(db, x.facilityId)} · <span className="font-mono">{x.contractNumber}</span></p></div> },
              { key: 'd', header: 'Đóng hợp đồng', cell: (x) => fmtDate(x.closedAt) },
              { key: 'h', header: 'Hư hại còn điều chỉnh', className: 'tabular-nums', cell: (x) => (x.status === 'CLOSED' && damageRoom(x) > 0 ? vnd(damageRoom(x)) : '—') },
              { key: 'o', header: 'Nợ còn lại', className: 'tabular-nums', cell: (x) => <span className={x.balance.outstanding > 0 ? 'font-medium text-red-700' : ''}>{vnd(x.balance.outstanding)}</span> },
              { key: 't', header: '', cell: (x) => (disputeOf(x) ? <Badge tone="amber">Khách đang khiếu nại</Badge> : null) },
              { key: 'x', header: '', className: 'text-right', cell: (x) => (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {x.status === 'CLOSED' && damageRoom(x) > 0 && (disputeOf(x)
                    ? <Button size="sm" variant="secondary" onClick={() => { setAdjustForm({ amount: 0, reason: '' }); setAdjust(x); }}>Điều chỉnh biên bản</Button>
                    : <span className="text-xs text-stone-500">Chưa có khiếu nại trong hạn</span>)}
                  {x.balance.outstanding > 0 && <Button size="sm" variant="ghost" onClick={() => { setWriteOffReason(''); setWriteOff(x); }}>Xoá nợ</Button>}
                </div>
              ) },
            ]} />
        </Card>
      ) : (
        <Card className="mt-4">
          <Table rows={payouts} rowKey={(p) => p._id} empty={<EmptyState title="Không có khoản nào chờ chuyển" />} columns={[
            { key: 'k', header: 'Khách hàng', cell: (p) => <div><p>{userName(db, p.customerId)}</p><p className="text-xs text-stone-500">{PAYMENT_TYPE[p.type].label} · {facilityName(db, p.facilityId)} · {fmtDate(p.createdAt)}</p></div> },
            { key: 'a', header: 'Số tiền', className: 'tabular-nums', cell: (p) => <div>{vnd(p.amount)}{payoutLate(p) && <div className="mt-1"><Badge tone="red">Quá hạn</Badge></div>}</div> },
            { key: 't', header: 'Tài khoản nhận', cell: (p) => { const acc = accountOf(p); return acc ? <span className="text-sm">{acc.bankName} · <span className="font-mono">{acc.accountNumber}</span> · {acc.accountName}</span> : <span className="text-xs font-medium text-amber-700">Khách chưa khai — liên hệ khách</span>; } },
            { key: 'x', header: '', className: 'text-right', cell: (p) => (selfApproved(p)
              ? <span className="text-xs text-stone-500">Bạn lập / duyệt khoản này — người khác xác nhận</span>
              : <Button size="sm" onClick={() => { setPayout(p); setPayoutForm({ reference: '', toAccount: '' }); }}><Banknote className="size-3.5" />Xác nhận đã chuyển</Button>) },
          ]} />
        </Card>
      )}

      <Modal open={!!c} onClose={() => setView(null)} size="lg" title={`Hồ sơ ${c?.claimNumber ?? ''}`}
        description={c ? `${userName(db, c.customerId)} · ${facilityName(db, c.facilityId)} · kho ${unitLabel(db, c.unitId)}` : ''}>
        {c && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2"><StatusBadge map={CLAIM_STATUS} value={c.status} /></div>
            <KV items={[
              ['Ngày sự cố', fmtDate(c.incidentAt)], ['Khách yêu cầu', vnd(c.claimedAmount)],
              ['Mức trách nhiệm (Điều 6)', vnd(capOf(c))], ['Duyệt tối đa', vnd(maxApprove(c))],
            ]} />
            <p className="whitespace-pre-line text-sm text-stone-600">{c.description}</p>
            <Table rows={c.items} rowKey={(it) => `${it.name}-${it.quantity}-${it.unitValue}`} columns={[
              { key: 'n', header: 'Tài sản', cell: (it) => it.name },
              { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
              { key: 'v', header: 'Thành tiền', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.unitValue) },
            ]} />
            {c.status === 'REJECTED' && (
              <div className="space-y-3 border-t border-stone-100 pt-4">
                {c.review && <p className="whitespace-pre-line text-sm text-stone-600">Lý do từ chối ({fmtDate(c.review.reviewedAt)} · {userName(db, c.review.reviewedBy)}): {c.review.decisionNote}</p>}
                <Button size="sm" variant="secondary" onClick={() => void run('reviewClaim', { claimId: c._id }, 'Đã mở lại — hồ sơ chuyển sang xác minh', () => setDecision({ amount: maxApprove(c), note: '' }))}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>
              </div>
            )}
            {c.status === 'UNDER_REVIEW' && (
              <div className="space-y-3 border-t border-stone-100 pt-4">
                <Field label="Số tiền duyệt (VND)" hint={`Tối đa ${vnd(maxApprove(c))}`}>
                  <input type="number" min={0} max={maxApprove(c)} step={10_000} className={inputCls} value={decision.amount}
                    onChange={(e) => setDecision((d) => ({ ...d, amount: Math.max(0, Math.min(maxApprove(c), Number(e.target.value) || 0)) }))} />
                </Field>
                <Field label="Căn cứ quyết định" hint="Khách đọc được.">
                  <textarea className={inputCls} rows={3} value={decision.note} onChange={(e) => setDecision((d) => ({ ...d, note: e.target.value }))} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={decision.note.trim().length < 5 || decision.amount <= 0}
                    onClick={() => run('decideClaim', { claimId: c._id, approve: true, approvedAmount: decision.amount, note: decision.note }, `Đã duyệt ${vnd(decision.amount)} — chi nhánh chi tiền`, () => setView(null))}>
                    <Check className="size-4" />Duyệt {vnd(decision.amount)}
                  </Button>
                  <Button variant="danger" disabled={decision.note.trim().length < 5}
                    onClick={() => run('decideClaim', { claimId: c._id, approve: false, note: decision.note }, 'Đã từ chối hồ sơ', () => setView(null))}>
                    <X className="size-4" />Từ chối
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!adjust} onClose={() => setAdjust(null)} size="lg" title="Điều chỉnh biên bản trả kho"
        description={adjust ? `${userName(db, adjust.customerId)} · ${facilityName(db, adjust.facilityId)} · ${adjust.contractNumber}` : ''}
        footer={<Button disabled={!adjust || adjustForm.amount <= 0 || adjustForm.amount > adjustMax(adjust) || adjustForm.reason.trim().length < 5}
          onClick={() => adjust && void run('adjustDamage', { contractId: adjust._id, amount: adjustForm.amount, reason: adjustForm.reason.trim() }, (v) => `Đã điều chỉnh — giảm nợ ${vnd(v.debtCut)}, hoàn khách ${vnd(v.refund)}`, () => setAdjust(null))}>Xác nhận điều chỉnh</Button>}>
        {adjust && (() => {
          const insp = moveOutInspection(adjust);
          const ticket = disputeOf(adjust);
          return insp ? (
            <div className="space-y-4">
              {ticket && (
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200">
                  <p className="font-medium">Khách khiếu nại · {fmtDate(ticket.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-line">{ticket.description || ticket.subject}</p>
                </div>
              )}
              <InspectionReport inspection={insp} inspectorName={userName(db, insp.inspectorId)} />
              <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-700">
                Trừ vào nợ còn lại ({vnd(adjust.balance.outstanding)}) trước, trả thừa thì hoàn chuyển khoản. Còn điều chỉnh được {vnd(damageRoom(adjust))}; hạn mức của bạn {vnd(myLimit(adjust.facilityId))} tính trên tổng đã xoá nợ / điều chỉnh của hợp đồng.
              </p>
              <Field label="Giảm chi phí hư hại (VND)" hint={`Tối đa ${vnd(adjustMax(adjust))}`}>
                <input type="number" min={0} max={adjustMax(adjust)} step={10_000} className={inputCls} value={adjustForm.amount}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, amount: Math.max(0, Math.min(adjustMax(adjust), Number(e.target.value) || 0)) }))} />
              </Field>
              <Field label="Lý do" hint="Khách đọc được.">
                <textarea className={inputCls} rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
              </Field>
            </div>
          ) : <p className="text-sm text-stone-500">Không tìm thấy biên bản trả kho của hợp đồng này.</p>;
        })()}
      </Modal>

      <Modal open={!!writeOff} onClose={() => setWriteOff(null)} title="Xoá nợ sau quyết toán"
        description={writeOff ? `${userName(db, writeOff.customerId)} · ${facilityName(db, writeOff.facilityId)} · ${writeOff.contractNumber}` : ''}
        footer={<Button variant="danger" disabled={!writeOff || writeOffReason.trim().length < 5 || writeOff.balance.outstanding > myLimit(writeOff.facilityId)}
          onClick={() => writeOff && void run('writeOffDebt', { contractId: writeOff._id, reason: writeOffReason.trim() }, (v) => `Đã xoá nợ ${vnd(v)}`, () => setWriteOff(null))}>Xoá nợ {writeOff ? vnd(writeOff.balance.outstanding) : ''}</Button>}>
        {writeOff && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">Khách không phải trả {vnd(writeOff.balance.outstanding)} còn nợ. Hạn mức của bạn: {vnd(myLimit(writeOff.facilityId))}.</p>
            {writeOff.balance.outstanding > myLimit(writeOff.facilityId) && <p className="text-xs font-medium text-red-700">Khoản nợ vượt hạn mức của bạn — không xoá được.</p>}
            <Field label="Lý do" hint="Tối thiểu 5 ký tự — ghi vào nhật ký kiểm toán.">
              <textarea className={inputCls} rows={2} value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!waive} onClose={() => setWaive(null)} title="Miễn phí trễ hạn"
        description={waive ? `${userName(db, waive.customerId)} · ${facilityName(db, waive.facilityId)} · phí ${vnd(lateFee(waive))}` : ''}
        footer={<Button disabled={!waive || waiveReason.trim().length < 5 || lateFee(waive) > myLimit(waive.facilityId)}
          onClick={() => waive && void run('waiveLateFees', { contractId: waive._id, reason: waiveReason.trim() }, (v) => `Đã miễn ${vnd(v)}`, () => setWaive(null))}>Xác nhận miễn</Button>}>
        {waive && (
          <div className="space-y-3">
            {lateFee(waive) > myLimit(waive.facilityId) && <p className="text-xs font-medium text-red-700">Vượt hạn mức miễn giảm của bạn ({vnd(myLimit(waive.facilityId))}).</p>}
            <Field label="Lý do" hint="Tối thiểu 5 ký tự — ghi vào nhật ký kiểm toán.">
              <textarea className={inputCls} rows={2} value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <AbandonDialog contract={abandon} onClose={() => setAbandon(null)} />

      <Modal open={!!payout} onClose={() => setPayout(null)} title="Xác nhận đã chuyển khoản"
        description={payout ? `${userName(db, payout.customerId)} · ${vnd(payout.amount)} · ${PAYMENT_TYPE[payout.type].label}` : ''}
        footer={<Button disabled={payoutForm.reference.trim().length < 3 || (!!payout && !accountOf(payout) && payoutForm.toAccount.trim().length < 6)}
          onClick={() => payout && void run('confirmPayout', { paymentId: payout._id, reference: payoutForm.reference.trim(), toAccount: payoutForm.toAccount.trim() }, 'Đã ghi nhận chuyển khoản', () => setPayout(null))}>Xác nhận</Button>}>
        {payout && (
          <div className="space-y-3">
            <Field label="Mã giao dịch ngân hàng"><input className={inputCls} value={payoutForm.reference} onChange={(e) => setPayoutForm((f) => ({ ...f, reference: e.target.value }))} placeholder="FT26292xxxxx" /></Field>
            {!accountOf(payout) && (
              <Field label="Đã chuyển tới tài khoản" hint="Ngân hàng · số tài khoản · chủ tài khoản">
                <input className={inputCls} value={payoutForm.toAccount} onChange={(e) => setPayoutForm((f) => ({ ...f, toAccount: e.target.value }))} />
              </Field>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
