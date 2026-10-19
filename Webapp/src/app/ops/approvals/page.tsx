'use client';

import { useState } from 'react';
import { Banknote, Check, ClipboardCheck, HandCoins, X } from 'lucide-react';
import { CLAIM_FM_APPROVAL_LIMIT, claimCapOf, isClosedContract, type DamageClaim, type PaymentTransaction, type RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE, PAYMENT_TYPE } from '@/shared/lib/labels';
import { byId, effectivePolicy, facilityName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';
import { InspectionReport } from '@/features/contracts/inspection-report';

type Tab = 'claims' | 'settle' | 'payouts';

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

  // Biên bản trả kho còn điều chỉnh được (khách khiếu nại đúng — Điều 9) và nợ sau quyết toán: phần vượt hạn mức miễn giảm của chi
  // nhánh do vận hành xử lý. Hợp đồng đang có khách khiếu nại (phiếu thanh toán còn mở) lên đầu.
  const T = todayISO();
  const myLimit = (facilityId: string) => effectivePolicy(db, facilityId)?.waiverLimits.find((w) => w.role === user?.role)?.maxAmount ?? 0;
  const moveOutInspection = (x: RentalContract) => db.inspections.find((i) => i.contractId === x._id && i.type === 'MOVE_OUT');
  const damageRoom = (x: RentalContract) => { const i = moveOutInspection(x); return i ? i.totalDamageFee - (i.adjustments ?? []).reduce((sum, a) => sum + a.amount, 0) : 0; };
  const disputeOf = (x: RentalContract) => db.tickets.find((t) => t.contractId === x._id && t.category === 'BILLING' && t.status !== 'RESOLVED' && t.status !== 'CLOSED');
  const settle = db.contracts
    .filter((x) => isClosedContract(x.status) && (x.balance.outstanding > 0 || (x.status === 'CLOSED' && damageRoom(x) > 0 && (x.closedAt ?? '') >= addDays(T, -60))))
    .sort((a, b) => Number(!!disputeOf(b)) - Number(!!disputeOf(a)) || (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
  const adjustMax = (x: RentalContract) => Math.min(damageRoom(x), myLimit(x.facilityId));

  return (
    <>
      <PageHeader title="Duyệt & chi"
        description={`Hồ sơ bồi thường trên ${vnd(CLAIM_FM_APPROVAL_LIMIT)} cần Quản lý vận hành duyệt (tối đa 10 lần giá thuê tháng của ô kho theo Điều 6). Điều chỉnh biên bản trả kho và xoá nợ vượt hạn mức miễn giảm của chi nhánh xử lý ở đây. Khoản tiền ra bằng chuyển khoản chỉ ghi "đã chi" khi có người xác nhận kèm mã giao dịch.`} />

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'claims', label: 'Bồi thường chờ duyệt', count: claims.length },
        { key: 'settle', label: 'Biên bản & nợ sau quyết toán', count: settle.length },
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
                  {x.status === 'CLOSED' && damageRoom(x) > 0 && <Button size="sm" variant="secondary" onClick={() => { setAdjustForm({ amount: 0, reason: '' }); setAdjust(x); }}>Điều chỉnh biên bản</Button>}
                  {x.balance.outstanding > 0 && <Button size="sm" variant="ghost" onClick={() => { setWriteOffReason(''); setWriteOff(x); }}>Xoá nợ</Button>}
                </div>
              ) },
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
                Phần giảm trừ vào nợ còn lại ({vnd(adjust.balance.outstanding)}) trước, phần dư hoàn khách bằng chuyển khoản — xác nhận ở tab Chờ chuyển khoản. Còn điều chỉnh được {vnd(damageRoom(adjust))}; hạn mức miễn giảm của bạn {vnd(myLimit(adjust.facilityId))} mỗi lần.
              </p>
              <Field label="Giảm chi phí hư hại (VND)" hint={`Tối đa ${vnd(adjustMax(adjust))}`}>
                <input type="number" min={0} max={adjustMax(adjust)} step={10_000} className={inputCls} value={adjustForm.amount}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, amount: Math.max(0, Math.min(adjustMax(adjust), Number(e.target.value) || 0)) }))} />
              </Field>
              <Field label="Lý do" hint="Ghi rõ căn cứ — khách đọc được và ghi vào nhật ký.">
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
            <p className="text-sm text-stone-600">Khách không phải trả khoản {vnd(writeOff.balance.outstanding)} còn nợ sau quyết toán nữa. Hạn mức miễn giảm của bạn: {vnd(myLimit(writeOff.facilityId))}.</p>
            {writeOff.balance.outstanding > myLimit(writeOff.facilityId) && <p className="text-xs font-medium text-red-700">Khoản nợ vượt hạn mức của bạn — không xoá được.</p>}
            <Field label="Lý do" hint="Tối thiểu 5 ký tự — ghi vào nhật ký kiểm toán.">
              <textarea className={inputCls} rows={2} value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} />
            </Field>
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
