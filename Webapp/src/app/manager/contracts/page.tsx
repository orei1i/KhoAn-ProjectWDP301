'use client';

import { useState } from 'react';
import { ArrowLeftRight, Banknote, BadgePercent, Lock, Megaphone, PackageX, Plus, Trash2 } from 'lucide-react';
import type { AbandonedItemsDisposal, RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { isClosedContract, lastDayOf, OPEN_CONTRACT_STATUSES, PERIOD_UNIT, paymentsOfContract } from '@ssm/shared';
import { ContractNotices } from '@/features/contracts/contract-notices';
import { InspectionReport } from '@/features/contracts/inspection-report';
import { CustomerIdentityDialog } from '@/features/auth/customer-identity-dialog';
import type { PaymentTransaction } from '@ssm/shared';
import { ACCESS_METHOD, CONTRACT_STATUS, DEPOSIT_STATUS, DISPOSAL_METHOD, PAYMENT_STATUS, PAYMENT_TYPE } from '@/shared/lib/labels';
import { effectivePolicy, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, daysBetween, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

type Tab = 'overdue' | 'expiring' | 'moveout' | 'returned' | 'debt' | 'payout' | 'all';
type AbandonItem = { description: string; quantity: number };

export default function Contracts() {
  const { db, user, run } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const policy = effectivePolicy(db, fid);
  const [tab, setTab] = useState<Tab>('overdue');
  const [view, setView] = useState<RentalContract | null>(null);
  const [waive, setWaive] = useState<RentalContract | null>(null);
  const [reason, setReason] = useState('');
  const [swap, setSwap] = useState<RentalContract | null>(null);
  const [swapForm, setSwapForm] = useState({ toUnitId: '', reason: '', keyTag: '', fee: 0 });
  const [abandon, setAbandon] = useState<RentalContract | null>(null);
  const [abandonItems, setAbandonItems] = useState<AbandonItem[]>([]);
  const [disposalMethod, setDisposalMethod] = useState<AbandonedItemsDisposal>('DISCARD');
  const [abandonNotes, setAbandonNotes] = useState('');
  const [abandonMoney, setAbandonMoney] = useState({ proceeds: 0, costs: 0 });
  const [notify, setNotify] = useState<RentalContract | null>(null);
  const [notifyNote, setNotifyNote] = useState('');
  const [payout, setPayout] = useState<PaymentTransaction | null>(null);
  const [payoutForm, setPayoutForm] = useState({ reference: '', toAccount: '' });
  const [identityOf, setIdentityOf] = useState<RentalContract | null>(null);
  const [adjust, setAdjust] = useState<RentalContract | null>(null);
  const [adjustForm, setAdjustForm] = useState({ amount: 0, reason: '' });
  const T = todayISO();

  const open = db.contracts.filter((c) => c.facilityId === fid && OPEN_CONTRACT_STATUSES.includes(c.status));
  /** Hợp đồng đã đóng nhưng hư hại + công nợ vượt tiền giữ chân — khách còn nợ, chờ thu hoặc xoá nợ. */
  const settlementDebts = db.contracts.filter((c) => c.facilityId === fid && isClosedContract(c.status) && c.balance.outstanding > 0);
  /** Khoá tay đúng mốc ghi trong hợp đồng khách đã ký ("quá N ngày bị khoá"), không khoá sớm sau thời gian ân hạn. */
  const canLock = (x: RentalContract) => x.status === 'DELINQUENT' && (x.delinquency?.daysOverdue ?? 0) > x.terms.lockoutAfterDays;
  const writeOff = (x: RentalContract) => {
    const why = window.prompt(`Xoá khoản nợ ${vnd(x.balance.outstanding)} của ${userName(db, x.customerId)} (hợp đồng ${x.contractNumber})?\nNhập lý do (tối thiểu 5 ký tự) — được ghi vào nhật ký:`);
    if (why && why.trim().length >= 5) void run('writeOffDebt', { contractId: x._id, reason: why.trim() }, (v) => `Đã xoá nợ ${vnd(v)}`);
  };
  /** Biên bản trả kho và phần chi phí hư hại còn điều chỉnh được (khách khiếu nại đúng — Điều 9). */
  const moveOutInspection = (x: RentalContract) => db.inspections.find((i) => i.contractId === x._id && i.type === 'MOVE_OUT');
  const damageRoom = (x: RentalContract) => { const i = moveOutInspection(x); return i ? i.totalDamageFee - (i.adjustments ?? []).reduce((s, a) => s + a.amount, 0) : 0; };
  const groups: Record<Tab, RentalContract[]> = {
    overdue: open.filter((c) => c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT').sort((a, b) => (b.delinquency?.daysOverdue ?? 0) - (a.delinquency?.daysOverdue ?? 0)),
    expiring: open.filter((c) => c.status === 'ACTIVE' && c.endDate <= addDays(T, 30) && !c.autoRenew).sort((a, b) => a.endDate.localeCompare(b.endDate)),
    moveout: open.filter((c) => c.status === 'MOVE_OUT_PENDING'),
    returned: db.contracts.filter((c) => c.facilityId === fid && c.status === 'CLOSED' && (c.closedAt ?? '') >= addDays(T, -30)).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')),
    debt: settlementDebts,
    payout: [],
    all: open,
  };
  /** Khoản HOÀN bằng chuyển khoản đang chờ chuyển của chi nhánh — chuyển xong thì xác nhận kèm mã giao dịch. */
  const payouts = db.payments.filter((p) => p.facilityId === fid && p.direction === 'REFUND' && p.method === 'BANK_TRANSFER' && p.status === 'PENDING').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const c = view ? db.contracts.find((x) => x._id === view._id) ?? null : null;
  // Gồm cả khoản thu lúc đặt chỗ (tiền giữ chân, tiền thuê kỳ đầu của kho cỡ lớn) — các khoản này chỉ gắn với đặt chỗ.
  const cPayments = c ? paymentsOfContract(db.payments, c).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8) : [];

  /** Đổi ô chỉ trong CÙNG loại kho — cùng loại thì cùng giá, hợp đồng không phải định giá lại. */
  const swapCandidates = swap
    ? db.units.filter((u) => u.facilityId === swap.facilityId && u.unitTypeId === swap.unitTypeId && u.status === 'AVAILABLE' && !u.isDeleted)
      .sort((a, b) => a.location.floor - b.location.floor || a.unitNumber.localeCompare(b.unitNumber))
    : [];
  const openSwap = (x: RentalContract) => { setSwapForm({ toUnitId: '', reason: '', keyTag: '', fee: 0 }); setSwap(x); };
  const canSwap = (x: RentalContract) => x.status === 'ACTIVE' && x.balance.outstanding === 0;

  const lockedOutDays = (x: RentalContract) => (x.delinquency?.lockedOutAt ? daysBetween(x.delinquency.lockedOutAt, T) : 0);
  /**
   * Điều 7 Điều khoản: đang khoá → gửi THÔNG BÁO CUỐI → chỉ xử lý đồ bỏ lại từ hạn chót ghi trong thông báo đó
   * (abandonAfterLockedOutDays ngày kể từ thông báo cuối). Hạn chót lấy đúng bản khách đã nhận.
   */
  const finalDeadline = (x: RentalContract) => {
    const at = x.delinquency?.finalNoticeAt;
    if (!at) return null;
    const n = [...(x.notices ?? [])].reverse().find((k) => k.kind === 'FINAL_NOTICE' && k.at >= at);
    return (n?.deadline ?? addDays(at, policy.abandonAfterLockedOutDays)).slice(0, 10);
  };
  const canFinalNotice = (x: RentalContract) => x.status === 'LOCKED_OUT' && !x.delinquency?.finalNoticeAt;
  const canAbandon = (x: RentalContract) => x.status === 'LOCKED_OUT' && !!finalDeadline(x) && T.slice(0, 10) >= finalDeadline(x)!;
  const openAbandon = (x: RentalContract) => { setAbandonItems([{ description: '', quantity: 1 }]); setDisposalMethod('DISCARD'); setAbandonNotes(''); setAbandonMoney({ proceeds: 0, costs: 0 }); setAbandon(x); };
  /** Xem trước quyết toán — cùng công thức với server: tiền giữ chân rồi tiền thanh lý trừ công nợ + chi phí. */
  const settle = (x: RentalContract) => {
    const owed = x.balance.outstanding + abandonMoney.costs;
    const depositApplied = Math.min(x.deposit.amount, owed);
    const proceedsApplied = Math.min(abandonMoney.proceeds, owed - depositApplied);
    return { owed, depositApplied, refund: x.deposit.amount - depositApplied + abandonMoney.proceeds - proceedsApplied, shortfall: owed - depositApplied - proceedsApplied };
  };

  return (
    <>
      <PageHeader title="Hợp đồng & công nợ" description={`Ân hạn ${policy.gracePeriodDays} ngày rồi tính phí trễ · khóa truy cập khi quá hạn trên ${policy.lockoutAfterDays} ngày, đúng như hợp đồng khách đã ký.`} actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[
        { key: 'overdue', label: 'Quá hạn', count: groups.overdue.length }, { key: 'expiring', label: 'Sắp hết hạn (30 ngày)', count: groups.expiring.length },
        { key: 'moveout', label: 'Chờ trả kho', count: groups.moveout.length }, { key: 'returned', label: 'Vừa trả kho (30 ngày)', count: groups.returned.length }, { key: 'debt', label: 'Nợ sau quyết toán', count: groups.debt.length }, { key: 'payout', label: 'Chờ hoàn tiền', count: payouts.length }, { key: 'all', label: 'Tất cả đang mở', count: groups.all.length },
      ]} value={tab} onChange={setTab} />
      {tab === 'payout' ? (
        <Card className="mt-4">
          <Table rows={payouts} rowKey={(p) => p._id} empty={<EmptyState title="Không có khoản hoàn nào chờ chuyển" />} columns={[
            { key: 'k', header: 'Khách hàng', cell: (p) => <div><p>{userName(db, p.customerId)}</p><p className="text-xs text-stone-500">{PAYMENT_TYPE[p.type].label} · {fmtDate(p.createdAt)}</p></div> },
            { key: 'a', header: 'Số tiền', className: 'tabular-nums', cell: (p) => vnd(p.amount) },
            { key: 't', header: 'Tài khoản nhận', cell: (p) => { const acc = db.users.find((u) => u._id === p.customerId)?.customerProfile?.payoutAccount; return acc ? <span className="text-sm">{acc.bankName} · <span className="font-mono">{acc.accountNumber}</span> · {acc.accountName}</span> : <span className="text-xs font-medium text-amber-700">Khách chưa khai — liên hệ khách</span>; } },
            { key: 'x', header: '', className: 'text-right', cell: (p) => (db.claims.find((x) => x.settlement?.paymentId === p._id)?.review?.reviewedBy === user?._id
              // Bồi thường: người đã duyệt hồ sơ không tự xác nhận khoản chi của chính hồ sơ đó.
              ? <span className="text-xs text-stone-500">Bạn đã duyệt hồ sơ bồi thường này — người khác xác nhận</span>
              : <Button size="sm" onClick={() => { setPayout(p); setPayoutForm({ reference: '', toAccount: '' }); }}><Banknote className="size-3.5" />Xác nhận đã chuyển</Button>) },
          ]} />
        </Card>
      ) : (
      <Card className="mt-4">
        <Table rows={groups[tab]} rowKey={(x) => x._id} onRowClick={setView} empty={<EmptyState title="Không có hợp đồng" />} columns={[
          { key: 'u', header: 'Kho', cell: (x) => <div><p className="font-semibold">{unitLabel(db, x.unitId)}</p><p className="text-xs text-stone-500">{typeName(db, x.unitTypeId)}</p></div> },
          { key: 'k', header: 'Khách hàng', cell: (x) => <div><p>{userName(db, x.customerId)}</p><p className="font-mono text-[11px] text-stone-500">{x.contractNumber}</p></div> },
          { key: 'e', header: 'Hết hạn', cell: (x) => <div><p>Hết ngày {fmtDate(lastDayOf(x.endDate))}</p><p className="text-xs text-stone-500">{x.autoRenew ? 'Tự gia hạn' : 'Không tự gia hạn'}</p></div> },
          { key: 'r', header: 'Giá thuê', className: 'tabular-nums', cell: (x) => `${vnd(x.billing.rate)}/${PERIOD_UNIT[x.billing.rentalPeriod]}` },
          { key: 'o', header: 'Công nợ', className: 'tabular-nums', cell: (x) => (
            <div>
              <p className={cx(x.balance.outstanding > 0 && 'font-medium text-red-700')}>{vnd(x.balance.outstanding)}</p>
              {x.delinquency && <p className="text-xs text-stone-500">quá hạn {x.delinquency.daysOverdue} ngày</p>}
              {x.status === 'LOCKED_OUT' && (x.delinquency?.finalNoticeAt
                ? <p className={cx('text-xs', canAbandon(x) ? 'font-medium text-red-700' : 'text-stone-500')}>thông báo cuối {fmtDate(x.delinquency.finalNoticeAt)} · xử lý từ {fmtDate(finalDeadline(x))}</p>
                : <p className="text-xs font-medium text-amber-700">khóa {lockedOutDays(x)} ngày · chưa gửi thông báo cuối</p>)}
            </div>
          ) },
          { key: 's', header: 'Trạng thái', cell: (x) => <StatusBadge map={CONTRACT_STATUS} value={x.status} /> },
          { key: 'a', header: '', className: 'text-right', cell: (x) => (
            <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {canLock(x) && <Button size="sm" variant="danger" onClick={() => run('lockout', { contractId: x._id }, `Đã khóa truy cập kho ${unitLabel(db, x.unitId)}`)}><Lock className="size-3.5" />Khóa</Button>}
              {x.balance.outstanding > 0 && <Button size="sm" variant="secondary" onClick={() => run('payBalance', { contractId: x._id, method: 'CASH' }, (v) => `Đã thu ${vnd(v)} tại quầy`)}><Banknote className="size-3.5" />Thu tại quầy</Button>}
              {isClosedContract(x.status) && x.balance.outstanding > 0 && <Button size="sm" variant="ghost" onClick={() => writeOff(x)}>Xoá nợ</Button>}
              {x.status === 'CLOSED' && damageRoom(x) > 0 && <Button size="sm" variant="ghost" onClick={() => { setAdjustForm({ amount: 0, reason: '' }); setAdjust(x); }}>Điều chỉnh biên bản</Button>}
              {canFinalNotice(x) && <Button size="sm" variant="danger" onClick={() => { setNotify(x); setNotifyNote(''); }}><Megaphone className="size-3.5" />Gửi thông báo cuối</Button>}
              {canSwap(x) && <Button size="sm" variant="secondary" onClick={() => openSwap(x)}><ArrowLeftRight className="size-3.5" />Đổi ô</Button>}
              {(x.delinquency?.lateFeesAccrued ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={() => { setWaive(x); setReason(''); }}><BadgePercent className="size-3.5" />Miễn phí trễ</Button>}
              {canAbandon(x) && <Button size="sm" variant="danger" onClick={() => openAbandon(x)}><PackageX className="size-3.5" />Xử lý hàng bỏ lại</Button>}
            </div>
          ) },
        ]} />
      </Card>
      )}

      <Modal open={!!c} onClose={() => setView(null)} size="lg" title={`Hợp đồng ${c?.contractNumber ?? ''}`} description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)}` : ''}>
        {c && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge map={CONTRACT_STATUS} value={c.status} /><StatusBadge map={DEPOSIT_STATUS} value={c.deposit.status} />
              {OPEN_CONTRACT_STATUSES.includes(c.status) && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setIdentityOf(c)}>Sửa họ tên / giấy tờ khách</Button>}</div>
            <KV items={[
              ['Thời hạn', `${fmtDate(c.startDate)} → hết ngày ${fmtDate(lastDayOf(c.endDate))}`], ['Giá thuê', `${vnd(c.billing.rate)}/${PERIOD_UNIT[c.billing.rentalPeriod]}`],
              ['Đã thanh toán đến', fmtDate(c.billing.paidThrough)], ['Kỳ tới', fmtDate(c.billing.nextBillingDate)],
              ['Tiền giữ chân', vnd(c.deposit.amount)], ['Truy cập', `${ACCESS_METHOD[c.access.method]}${c.access.suspendedAt ? ' · đang tạm khóa' : ''}`],
              ['Chính sách', `v${c.terms.policyVersion} · ân hạn ${c.terms.gracePeriodDays} ngày`], ['Gia hạn', `${c.renewals.length} lần`],
              ['Đổi ô', `${c.unitSwaps?.length ?? 0} lần`],
            ]} />
            <div>
              <h4 className="mb-2 text-sm font-semibold">Thanh toán gần đây</h4>
              <Table rows={cPayments} rowKey={(p) => p._id} columns={[
                { key: 'd', header: 'Ngày', cell: (p) => fmtDate(p.paidAt ?? p.createdAt) },
                { key: 't', header: 'Khoản', cell: (p) => PAYMENT_TYPE[p.type].label },
                { key: 'a', header: 'Số tiền', className: 'text-right tabular-nums', cell: (p) => vnd(p.amount) },
                { key: 's', header: 'Trạng thái', cell: (p) => <StatusBadge map={PAYMENT_STATUS} value={p.status} /> },
              ]} />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold">Thông báo đã gửi khách</h4>
              <ContractNotices contract={c} empty="Chưa gửi thông báo công nợ nào." />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold">Lịch sử trạng thái</h4>
              <ol className="space-y-1 text-sm">
                {c.statusHistory.map((h, i) => <li key={i} className="flex gap-2"><span className="w-24 shrink-0 text-xs text-stone-500">{fmtDate(h.at)}</span>{h.from ? `${CONTRACT_STATUS[h.from].label} → ` : ''}{CONTRACT_STATUS[h.to].label}{h.reason && <span className="text-stone-500"> · {h.reason}</span>}</li>)}
              </ol>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!waive} onClose={() => setWaive(null)} title="Miễn phí trễ hạn" description={waive ? `${unitLabel(db, waive.unitId)} · phí ${vnd(waive.delinquency?.lateFeesAccrued ?? 0)}` : ''}
        footer={<Button disabled={reason.trim().length < 5} onClick={() => waive && void run('waiveLateFees', { contractId: waive._id, reason }, (v) => `Đã miễn ${vnd(v)}`, () => setWaive(null))}>Xác nhận miễn</Button>}>
        <Field label="Lý do (ghi vào nhật ký kiểm toán)" hint={`Hạn mức của Quản lý chi nhánh: ${vnd(policy.waiverLimits.find((w) => w.role === 'FACILITY_MANAGER')?.maxAmount ?? 0)} / lần`}>
          <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={!!swap} onClose={() => setSwap(null)} size="lg"
        title="Đổi ô kho" description={swap ? `${userName(db, swap.customerId)} · đang thuê ${unitLabel(db, swap.unitId)} (${typeName(db, swap.unitTypeId)})` : ''}
        footer={
          <Button disabled={!swapForm.toUnitId || swapForm.reason.trim().length < 5}
            onClick={() => swap && void run('swapUnit', { contractId: swap._id, toUnitId: swapForm.toUnitId, reason: swapForm.reason, keyTag: swapForm.keyTag, fee: swapForm.fee },
              (u) => `Đã chuyển sang ô ${u.unitNumber} — giá thuê giữ nguyên`, () => setSwap(null))}>
            Xác nhận đổi ô
          </Button>
        }>
        {swap && (
          <div className="space-y-4">
            <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900 ring-1 ring-brand-200">
              Chỉ đổi được sang ô <b>cùng loại</b>. Giá thuê <b>{vnd(swap.billing.rate)}/{PERIOD_UNIT[swap.billing.rentalPeriod]}</b> và tiền giữ chân <b>{vnd(swap.deposit.amount)}</b> giữ nguyên theo hợp đồng đã ký.
              Ô cũ chuyển sang <b>chờ kiểm tra</b> sau khi đổi.
            </div>

            {swapCandidates.length === 0 ? (
              <EmptyState title="Không còn ô trống cùng loại" description="Chi nhánh này đã kín loại kho đó. Chờ có ô trả hoặc thương lượng đổi sang loại khác qua hợp đồng mới." />
            ) : (
              <Field label={`Ô kho mới (${swapCandidates.length} ô trống cùng loại)`}>
                <select className={inputCls} value={swapForm.toUnitId} onChange={(e) => setSwapForm((f) => ({ ...f, toUnitId: e.target.value }))}>
                  <option value="">— Chọn ô —</option>
                  {swapCandidates.map((u) => <option key={u._id} value={u._id}>{u.unitNumber} · tầng {u.location.floor}{u.location.zone ? ` · khu ${u.location.zone}` : ''} · {ACCESS_METHOD[u.accessMethod]}{u.accessMethod !== swap?.access.method ? ' (khác khoá ô cũ)' : ''}</option>)}
                </select>
              </Field>
            )}

            <Field label="Lý do đổi ô" hint="Ghi vào hợp đồng và nhật ký kiểm toán — tối thiểu 5 ký tự">
              <textarea className={inputCls} rows={2} value={swapForm.reason} onChange={(e) => setSwapForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="VD: khách xin đổi sang ô gần lối ra, ô cũ ẩm sau mưa…" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nhãn chìa khóa / thẻ mới" hint="Bỏ trống nếu giữ nguyên khóa cũ">
                <input className={inputCls} value={swapForm.keyTag} onChange={(e) => setSwapForm((f) => ({ ...f, keyTag: e.target.value }))} placeholder="VD: K-217" />
              </Field>
              <Field label="Phí thao tác (VND)" hint="Cùng loại nên không tính lại giá. Khoản này chỉ là phí di dời / cấp lại khóa, tối đa 500.000 ₫ — để 0 nếu miễn.">
                <input type="number" min={0} max={500_000} step={10_000} className={inputCls} value={swapForm.fee}
                  onChange={(e) => setSwapForm((f) => ({ ...f, fee: Math.max(0, Number(e.target.value) || 0) }))} />
              </Field>
            </div>

            {swapForm.fee > 0 && <p className="text-sm text-amber-800">Phí {vnd(swapForm.fee)} sẽ được cộng vào công nợ của hợp đồng, khách thanh toán ở kỳ tới hoặc tại quầy.</p>}

            {(swap.unitSwaps?.length ?? 0) > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Đã đổi ô {swap.unitSwaps!.length} lần</h4>
                <ol className="space-y-1 text-sm text-stone-600">
                  {swap.unitSwaps!.map((s, i) => (
                    <li key={i} className="flex flex-wrap gap-2">
                      <span className="w-24 shrink-0 text-xs text-stone-500">{fmtDate(s.at)}</span>
                      {unitLabel(db, s.fromUnitId)} → {unitLabel(db, s.toUnitId)}
                      <span className="text-stone-500">· {s.reason}{s.fee > 0 ? ` · phí ${vnd(s.fee)}` : ''}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </Modal>

      <CustomerIdentityDialog target={identityOf ? { kind: 'contracts', id: identityOf._id } : null} customer={identityOf ? db.users.find((u) => u._id === identityOf.customerId) ?? null : null} onClose={() => setIdentityOf(null)} />

      <Modal open={!!adjust} onClose={() => setAdjust(null)} size="lg" title="Điều chỉnh biên bản trả kho" description={adjust ? `${userName(db, adjust.customerId)} · ${adjust.contractNumber}` : ''}
        footer={<Button disabled={!adjust || adjustForm.amount <= 0 || adjustForm.amount > damageRoom(adjust) || adjustForm.reason.trim().length < 5}
          onClick={() => adjust && void run('adjustDamage', { contractId: adjust._id, amount: adjustForm.amount, reason: adjustForm.reason.trim() }, (v) => `Đã điều chỉnh — giảm nợ ${vnd(v.debtCut)}, hoàn khách ${vnd(v.refund)}`, () => setAdjust(null))}>Xác nhận điều chỉnh</Button>}>
        {adjust && (() => {
          const insp = moveOutInspection(adjust);
          return insp ? (
            <div className="space-y-4">
              <InspectionReport inspection={insp} inspectorName={userName(db, insp.inspectorId)} />
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                Dùng khi khách khiếu nại biên bản và khiếu nại đúng. Phần giảm trừ vào nợ còn lại ({vnd(adjust.balance.outstanding)}) trước, phần dư hoàn khách bằng chuyển khoản — xác nhận ở mục Chờ hoàn tiền. Còn điều chỉnh được tối đa {vnd(damageRoom(adjust))}, trong hạn mức miễn giảm của bạn.
              </p>
              <Field label="Giảm chi phí hư hại (VND)">
                <input type="number" min={0} max={damageRoom(adjust)} step={10_000} className={inputCls} value={adjustForm.amount}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, amount: Math.max(0, Math.min(damageRoom(adjust), Number(e.target.value) || 0)) }))} />
              </Field>
              <Field label="Lý do" hint="Ghi rõ căn cứ (VD: đối chiếu ảnh lúc nhận kho, vết trầy có sẵn) — khách đọc được và ghi vào nhật ký.">
                <textarea className={inputCls} rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
              </Field>
            </div>
          ) : null;
        })()}
      </Modal>

      <Modal open={!!payout} onClose={() => setPayout(null)} title="Xác nhận đã chuyển khoản hoàn" description={payout ? `${userName(db, payout.customerId)} · ${vnd(payout.amount)} · ${PAYMENT_TYPE[payout.type].label}` : ''}
        footer={<Button disabled={payoutForm.reference.trim().length < 3 || (!!payout && !db.users.find((u) => u._id === payout.customerId)?.customerProfile?.payoutAccount && payoutForm.toAccount.trim().length < 6)}
          onClick={() => payout && void run('confirmPayout', { paymentId: payout._id, reference: payoutForm.reference.trim(), toAccount: payoutForm.toAccount.trim() }, 'Đã ghi nhận chuyển khoản hoàn', () => setPayout(null))}>Xác nhận</Button>}>
        {payout && (
          <div className="grid gap-4 text-sm">
            <p className="text-stone-600">Chỉ xác nhận SAU KHI đã chuyển tiền thật. Khách thấy khoản này chuyển từ "Chờ chuyển khoản" sang "Đã thanh toán" kèm mã giao dịch.</p>
            <Field label="Mã giao dịch ngân hàng"><input className={inputCls} value={payoutForm.reference} onChange={(e) => setPayoutForm((f) => ({ ...f, reference: e.target.value }))} placeholder="FT26292xxxxx" /></Field>
            {!db.users.find((u) => u._id === payout.customerId)?.customerProfile?.payoutAccount && (
              <Field label="Đã chuyển tới tài khoản" hint="Khách chưa khai tài khoản trong hệ thống — ghi ngân hàng · số tài khoản · chủ tài khoản đã chuyển tới"><input className={inputCls} value={payoutForm.toAccount} onChange={(e) => setPayoutForm((f) => ({ ...f, toAccount: e.target.value }))} /></Field>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!notify} onClose={() => setNotify(null)} title="Gửi thông báo cuối"
        description={notify ? `${userName(db, notify.customerId)} · kho ${unitLabel(db, notify.unitId)} · đã khóa ${lockedOutDays(notify)} ngày` : ''}
        footer={<Button variant="danger" onClick={() => notify && void run('sendFinalNotice', { contractId: notify._id, note: notifyNote }, 'Đã gửi thông báo cuối cho khách', () => setNotify(null))}>Gửi thông báo cuối</Button>}>
        {notify && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-amber-50 p-3 text-amber-950 ring-1 ring-amber-200">
              Khách nhận email và thấy trong tài khoản: dư nợ <b>{vnd(notify.balance.outstanding)}</b>, hạn chót thanh toán hoặc liên hệ là hết ngày <b>{fmtDate(addDays(T, policy.abandonAfterLockedOutDays - 1))}</b>.
              Từ ngày <b>{fmtDate(addDays(T, policy.abandonAfterLockedOutDays))}</b> chi nhánh mới được mở kho, kiểm kê và xử lý đồ bỏ lại (Điều 7 Điều khoản). Mỗi đợt nợ chỉ gửi một lần.
            </div>
            <Field label="Ghi chú (tuỳ chọn)" hint="In trong thông báo gửi khách và nhật ký — VD đã gọi điện lúc …, đã gửi thư bảo đảm số …">
              <textarea className={inputCls} rows={2} maxLength={500} value={notifyNote} onChange={(e) => setNotifyNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!abandon} onClose={() => setAbandon(null)} size="lg"
        title="Xử lý hàng bỏ lại" description={abandon ? `${userName(db, abandon.customerId)} · kho ${unitLabel(db, abandon.unitId)} · thông báo cuối ${fmtDate(abandon.delinquency?.finalNoticeAt)}` : ''}
        footer={
          <Button variant="danger" disabled={abandonItems.length === 0 || abandonItems.some((it) => !it.description.trim())}
            onClick={() => abandon && void run('processAbandonment', { contractId: abandon._id, items: abandonItems, disposalMethod, notes: abandonNotes, proceeds: abandonMoney.proceeds, costs: abandonMoney.costs },
              'Đã xử lý hàng bỏ lại — hợp đồng đóng, ô kho đã giải phóng', () => setAbandon(null))}>
            Xác nhận xử lý
          </Button>
        }>
        {abandon && (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
              Đã gửi thông báo cuối ngày {fmtDate(abandon.delinquency?.finalNoticeAt)} và đã tới ngày được xử lý ({fmtDate(finalDeadline(abandon))}) mà khách vẫn không thanh toán / liên hệ.
              Kiểm kê có biên bản, chụp ảnh; xác nhận sẽ quyết toán, đóng hợp đồng và giải phóng ô kho — không thể hoàn tác.
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Danh sách vật dụng</h4>
                <Button size="sm" variant="secondary" onClick={() => setAbandonItems((arr) => [...arr, { description: '', quantity: 1 }])}><Plus className="size-3.5" />Thêm</Button>
              </div>
              <div className="space-y-2">
                {abandonItems.map((it, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_100px_auto]">
                    <input className={inputCls} placeholder="Mô tả vật dụng" value={it.description}
                      onChange={(e) => setAbandonItems((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    <input className={inputCls} type="number" min={1} step={1} placeholder="SL" value={it.quantity}
                      onChange={(e) => setAbandonItems((arr) => arr.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) } : x)))} />
                    <Button variant="ghost" size="sm" onClick={() => setAbandonItems((arr) => arr.filter((_, j) => j !== i))} aria-label="Xóa"><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </div>
            </div>

            <Field label="Phương án xử lý">
              <select className={inputCls} value={disposalMethod} onChange={(e) => setDisposalMethod(e.target.value as AbandonedItemsDisposal)}>
                {(Object.keys(DISPOSAL_METHOD) as AbandonedItemsDisposal[]).map((k) => <option key={k} value={k}>{DISPOSAL_METHOD[k]}</option>)}
              </select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tiền thu được khi thanh lý (VND)" hint="0 nếu quyên tặng / tiêu huỷ">
                <input type="number" min={0} step={10_000} className={inputCls} value={abandonMoney.proceeds}
                  onChange={(e) => setAbandonMoney((m) => ({ ...m, proceeds: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
              </Field>
              <Field label="Chi phí kiểm kê, vận chuyển, thanh lý (VND)">
                <input type="number" min={0} step={10_000} className={inputCls} value={abandonMoney.costs}
                  onChange={(e) => setAbandonMoney((m) => ({ ...m, costs: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
              </Field>
            </div>

            {(() => {
              const s = settle(abandon);
              return (
                <KV items={[
                  ['Công nợ + chi phí', vnd(s.owed)], ['Trừ vào tiền giữ chân', `${vnd(s.depositApplied)} / ${vnd(abandon.deposit.amount)}`],
                  ['Trả lại khách', vnd(s.refund)], ['Khách còn nợ', s.shortfall > 0 ? vnd(s.shortfall) : 'Không'],
                ]} />
              );
            })()}

            <Field label="Ghi chú" hint="Không bắt buộc">
              <textarea className={inputCls} rows={2} value={abandonNotes} onChange={(e) => setAbandonNotes(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
