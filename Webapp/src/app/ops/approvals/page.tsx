'use client';

import { useState } from 'react';
import { Banknote, Check, HandCoins, X } from 'lucide-react';
import { CLAIM_FM_APPROVAL_LIMIT, claimCapOf, type DamageClaim, type PaymentTransaction } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE, PAYMENT_TYPE } from '@/shared/lib/labels';
import { byId, facilityName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';

type Tab = 'claims' | 'payouts';

/**
 * Việc cần cấp trên của cả chuỗi: duyệt hồ sơ bồi thường vượt hạn mức quản lý chi nhánh, và xác nhận đã chuyển khoản các khoản
 * hoàn / bồi thường / trả lại sau thanh lý. Người đã duyệt một hồ sơ bồi thường không được tự xác nhận khoản chi của chính hồ sơ đó.
 */
export default function OpsApprovals() {
  const { db, user, run } = useStore();
  const [tab, setTab] = useState<Tab>('claims');
  const [view, setView] = useState<DamageClaim | null>(null);
  const [decision, setDecision] = useState({ amount: 0, note: '' });
  const [payout, setPayout] = useState<PaymentTransaction | null>(null);
  const [payoutForm, setPayoutForm] = useState({ reference: '', toAccount: '' });

  const capOf = (x: DamageClaim) => x.review?.liabilityCap ?? claimCapOf(byId(db.contracts, x.contractId), db.unitTypes) ?? 0;
  const maxApprove = (x: DamageClaim) => Math.min(x.claimedAmount, capOf(x));
  const claims = db.claims.filter((x) => x.status === 'UNDER_REVIEW')
    .sort((a, b) => Number(b.claimedAmount > CLAIM_FM_APPROVAL_LIMIT) - Number(a.claimedAmount > CLAIM_FM_APPROVAL_LIMIT) || a.createdAt.localeCompare(b.createdAt));
  const payouts = db.payments.filter((p) => p.direction === 'REFUND' && p.method === 'BANK_TRANSFER' && p.status === 'PENDING')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const claimOf = (p: PaymentTransaction) => db.claims.find((x) => x.settlement?.paymentId === p._id);
  const selfApproved = (p: PaymentTransaction) => !!user && claimOf(p)?.review?.reviewedBy === user._id;
  const accountOf = (p: PaymentTransaction) => db.users.find((u) => u._id === p.customerId)?.customerProfile?.payoutAccount;
  const c = view ? db.claims.find((x) => x._id === view._id) ?? null : null;

  return (
    <>
      <PageHeader title="Duyệt & chi"
        description={`Hồ sơ bồi thường trên ${vnd(CLAIM_FM_APPROVAL_LIMIT)} cần Quản lý vận hành duyệt (mức tối đa 10 lần giá thuê tháng của ô kho theo Điều 6). Các khoản tiền ra bằng chuyển khoản chỉ ghi "đã chi" khi có người xác nhận kèm mã giao dịch.`} />

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'claims', label: 'Bồi thường chờ duyệt', count: claims.length },
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
      ) : (
        <Card className="mt-4">
          <Table rows={payouts} rowKey={(p) => p._id} empty={<EmptyState title="Không có khoản nào chờ chuyển" />} columns={[
            { key: 'k', header: 'Khách hàng', cell: (p) => <div><p>{userName(db, p.customerId)}</p><p className="text-xs text-stone-500">{PAYMENT_TYPE[p.type].label} · {facilityName(db, p.facilityId)} · {fmtDate(p.createdAt)}</p></div> },
            { key: 'a', header: 'Số tiền', className: 'tabular-nums', cell: (p) => vnd(p.amount) },
            { key: 't', header: 'Tài khoản nhận', cell: (p) => { const acc = accountOf(p); return acc ? <span className="text-sm">{acc.bankName} · <span className="font-mono">{acc.accountNumber}</span> · {acc.accountName}</span> : <span className="text-xs font-medium text-amber-700">Khách chưa khai — liên hệ khách</span>; } },
            { key: 'x', header: '', className: 'text-right', cell: (p) => (selfApproved(p)
              ? <span className="text-xs text-stone-500">Bạn đã duyệt hồ sơ này — người khác xác nhận</span>
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
            {c.status === 'UNDER_REVIEW' && (
              <div className="space-y-3 border-t border-stone-100 pt-4">
                <Field label="Số tiền duyệt (VND)" hint={`Tối đa ${vnd(maxApprove(c))}`}>
                  <input type="number" min={0} max={maxApprove(c)} step={10_000} className={inputCls} value={decision.amount}
                    onChange={(e) => setDecision((d) => ({ ...d, amount: Math.max(0, Math.min(maxApprove(c), Number(e.target.value) || 0)) }))} />
                </Field>
                <Field label="Căn cứ quyết định" hint="Khách đọc được nội dung này. Tối thiểu 5 ký tự.">
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

      <Modal open={!!payout} onClose={() => setPayout(null)} title="Xác nhận đã chuyển khoản"
        description={payout ? `${userName(db, payout.customerId)} · ${vnd(payout.amount)} · ${PAYMENT_TYPE[payout.type].label}` : ''}
        footer={<Button disabled={payoutForm.reference.trim().length < 3 || (!!payout && !accountOf(payout) && payoutForm.toAccount.trim().length < 6)}
          onClick={() => payout && void run('confirmPayout', { paymentId: payout._id, reference: payoutForm.reference.trim(), toAccount: payoutForm.toAccount.trim() }, 'Đã ghi nhận chuyển khoản', () => setPayout(null))}>Xác nhận</Button>}>
        {payout && (
          <div className="space-y-3">
            <Field label="Mã giao dịch ngân hàng"><input className={inputCls} value={payoutForm.reference} onChange={(e) => setPayoutForm((f) => ({ ...f, reference: e.target.value }))} placeholder="FT26292xxxxx" /></Field>
            {!accountOf(payout) && (
              <Field label="Đã chuyển tới tài khoản" hint="Khách chưa khai tài khoản — ghi ngân hàng · số tài khoản · chủ tài khoản đã chuyển tới">
                <input className={inputCls} value={payoutForm.toAccount} onChange={(e) => setPayoutForm((f) => ({ ...f, toAccount: e.target.value }))} />
              </Field>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
