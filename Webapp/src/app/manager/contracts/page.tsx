'use client';

import { useState } from 'react';
import { ArrowLeftRight, Banknote, BadgePercent, Lock, Megaphone, MessageSquareWarning, PackageX, PhoneCall } from 'lucide-react';
import type { ManualDeliveryChannel, RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { abandonDaysOf, canDisputeInspection, MANUAL_DELIVERY_CHANNEL, defaultSwapFee, inspectionDisputeDeadline, isClosedContract, isFreeSwap, lastDayOf, OPEN_CONTRACT_STATUSES, PERIOD_UNIT, paymentsOfContract, SWAP_FEE_MAX } from '@ssm/shared';
import { ContractNotices } from '@/features/contracts/contract-notices';
import { InspectionReport } from '@/features/contracts/inspection-report';
import { AbandonDialog, abandonFrom, finalNoticeOf, noticeDelivered } from '@/features/contracts/abandon-dialog';
import { CustomerIdentityDialog } from '@/features/auth/customer-identity-dialog';
import type { PaymentTransaction } from '@ssm/shared';
import { ACCESS_METHOD, CONTRACT_STATUS, DEPOSIT_STATUS, PAYMENT_STATUS, PAYMENT_TYPE } from '@/shared/lib/labels';
import { effectivePolicy, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, daysBetween, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { CounterCollectDialog } from '@/features/payments/counter-collect';
import { ReceiptButton, hasReceipt } from '@/features/payments/receipt-button';

type Tab = 'overdue' | 'expiring' | 'expired' | 'moveout' | 'returned' | 'debt' | 'payout' | 'all';

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
  const [swapForm, setSwapForm] = useState({ toUnitId: '', reason: '', keyTag: '', fee: 0, facilityFault: false });
  const [abandon, setAbandon] = useState<RentalContract | null>(null);
  // Thông báo cuối không gửi được email → ghi nhận đã báo khách bằng kênh khác.
  const [delivery, setDelivery] = useState<RentalContract | null>(null);
  const [deliveryForm, setDeliveryForm] = useState<{ channel: ManualDeliveryChannel; note: string; at: string }>({ channel: 'PHONE', note: '', at: '' });
  const [notify, setNotify] = useState<RentalContract | null>(null);
  const [notifyNote, setNotifyNote] = useState('');
  const [payout, setPayout] = useState<PaymentTransaction | null>(null);
  const [payoutForm, setPayoutForm] = useState({ reference: '', toAccount: '' });
  const [identityOf, setIdentityOf] = useState<RentalContract | null>(null);
  const [adjust, setAdjust] = useState<RentalContract | null>(null);
  const [adjustForm, setAdjustForm] = useState({ amount: 0, reason: '' });
  const [collect, setCollect] = useState<RentalContract | null>(null);
  // Khách đến quầy khiếu nại biên bản trả kho — quản lý ghi nhận thay (phiếu đứng tên khách).
  const [dispute, setDispute] = useState<RentalContract | null>(null);
  const [disputeText, setDisputeText] = useState('');
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
  /** Khiếu nại của chính khách (phiếu thanh toán gắn hợp đồng) gửi trong hạn — điều kiện bắt buộc để điều chỉnh. */
  const disputeOf = (x: RentalContract) => {
    const i = moveOutInspection(x);
    return i ? db.tickets.find((t) => t.contractId === x._id && t.reporterId === x.customerId && t.category === 'BILLING' && t.createdAt >= i.performedAt && new Date(t.createdAt).getTime() < inspectionDisputeDeadline(i.performedAt)) : undefined;
  };
  /** Còn trong hạn khiếu nại biên bản (7 ngày, Điều 9) mà khách chưa khiếu nại → ghi nhận khiếu nại tại quầy được. */
  const canRecordDispute = (x: RentalContract) => { const i = moveOutInspection(x); return x.status === 'CLOSED' && !!i && canDisputeInspection(i.performedAt) && !disputeOf(x); };
  /** Chính sách KHÁCH ĐÃ KÝ (chốt trong hợp đồng) — không lấy bản chi nhánh mới phát hành sau đó; không tìm thấy thì dùng bản hiệu lực. */
  const signedPolicy = (x: RentalContract) => db.policies.find((p) => p._id === x.terms.policyId) ?? effectivePolicy(db, x.facilityId);
  const lockFee = (x: RentalContract) => signedPolicy(x).lateFees.find((f) => f.kind === 'FIXED')?.value ?? 0;
  const lock = (x: RentalContract) => {
    const fee = lockFee(x);
    if (!window.confirm(`Khoá truy cập kho ${unitLabel(db, x.unitId)} của ${userName(db, x.customerId)}?

• ${fee > 0 ? `Ghi thêm phí khoá ${vnd(fee)} vào công nợ (chính sách khách đã ký v${signedPolicy(x).version}).` : 'Không có phí khoá theo chính sách khách đã ký.'}
• Gửi email báo khoá cho khách.`)) return;
    void run('lockout', { contractId: x._id }, `Đã khóa truy cập kho ${unitLabel(db, x.unitId)}`);
  };
  const myLimit = policy.waiverLimits.find((w) => w.role === user?.role)?.maxAmount ?? 0;
  const adjustMax = (x: RentalContract) => Math.min(damageRoom(x), myLimit);
  /** Khoản chi mình đã duyệt (bồi thường) hoặc tự điều chỉnh (hoàn sau khiếu nại) thì người khác xác nhận đã chuyển. */
  const selfApprovedPayout = (p: PaymentTransaction) => p.createdBy === user?._id || db.claims.find((x) => x.settlement?.paymentId === p._id)?.review?.reviewedBy === user?._id
    || db.inspections.some((i) => (i.adjustments ?? []).some((a) => a.refundPaymentId === p._id && a.by === user?._id));
  // Khách chưa khai tài khoản nhận tiền: người xác nhận phải tự nhập tài khoản → chỉ Vận hành được xác nhận.
  const payoutAccountOf = (p: PaymentTransaction) => db.users.find((u) => u._id === p.customerId)?.customerProfile?.payoutAccount;
  const isFM = user?.role === 'FACILITY_MANAGER';
  const groups: Record<Tab, RentalContract[]> = {
    overdue: open.filter((c) => c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT').sort((a, b) => (b.delinquency?.daysOverdue ?? 0) - (a.delinquency?.daysOverdue ?? 0)),
    // Sắp hết hạn: còn hạn (ngày cuối ≥ hôm nay) trong 30 ngày tới; đã qua ngày cuối mà chưa gia hạn / trả kho thì tách riêng.
    expiring: open.filter((c) => c.status === 'ACTIVE' && c.endDate > T && c.endDate <= addDays(T, 30) && !c.autoRenew).sort((a, b) => a.endDate.localeCompare(b.endDate)),
    expired: open.filter((c) => c.status !== 'MOVE_OUT_PENDING' && c.endDate <= T).sort((a, b) => a.endDate.localeCompare(b.endDate)),
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
  /** Biểu phí chung với yêu cầu đổi ô (Điều 8): lần đổi đầu của hợp đồng / lỗi chi nhánh miễn phí; còn lại điền sẵn phí thao tác. */
  const swapFeeOf = (x: RentalContract, facilityFault: boolean) => defaultSwapFee({ facilityFault, isFirstSwap: (x.unitSwaps ?? []).length === 0, method: 'SELF' });
  const swapFree = (x: RentalContract, facilityFault: boolean) => isFreeSwap({ facilityFault, isFirstSwap: (x.unitSwaps ?? []).length === 0 });
  const openSwap = (x: RentalContract) => { setSwapForm({ toUnitId: '', reason: '', keyTag: '', fee: swapFeeOf(x, false), facilityFault: false }); setSwap(x); };
  const canSwap = (x: RentalContract) => x.status === 'ACTIVE' && x.balance.outstanding === 0;

  const lockedOutDays = (x: RentalContract) => (x.delinquency?.lockedOutAt ? daysBetween(x.delinquency.lockedOutAt, T) : 0);
  /**
   * Điều 7 Điều khoản: đang khoá → gửi THÔNG BÁO CUỐI → chỉ xử lý đồ bỏ lại từ hạn chót ghi trong thông báo đó
   * (abandonAfterLockedOutDays ngày kể từ thông báo cuối). Hạn chót lấy đúng bản khách đã nhận.
   */
  const finalDeadline = (x: RentalContract) => abandonFrom(x, abandonDaysOf(signedPolicy(x)));
  const canFinalNotice = (x: RentalContract) => x.status === 'LOCKED_OUT' && !x.delinquency?.finalNoticeAt;
  /** Email thông báo cuối không tới được khách → quản lý ghi nhận đã báo bằng kênh khác mới được xử lý đồ bỏ lại. */
  const canRecordDelivery = (x: RentalContract) => x.status === 'LOCKED_OUT' && !!finalNoticeOf(x) && !noticeDelivered(x);
  const canAbandon = (x: RentalContract) => x.status === 'LOCKED_OUT' && !!finalDeadline(x) && T.slice(0, 10) >= finalDeadline(x)! && noticeDelivered(x);

  return (
    <>
      <PageHeader title="Hợp đồng & công nợ" actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[
        { key: 'overdue', label: 'Quá hạn', count: groups.overdue.length }, { key: 'expiring', label: 'Sắp hết hạn (30 ngày)', count: groups.expiring.length },
        { key: 'expired', label: 'Quá hạn chưa gia hạn', count: groups.expired.length },
        { key: 'moveout', label: 'Chờ trả kho', count: groups.moveout.length }, { key: 'returned', label: 'Vừa trả kho (30 ngày)', count: groups.returned.length }, { key: 'debt', label: 'Nợ sau quyết toán', count: groups.debt.length }, { key: 'payout', label: 'Chờ hoàn tiền', count: payouts.length }, { key: 'all', label: 'Tất cả đang mở', count: groups.all.length },
      ]} value={tab} onChange={setTab} />
      {tab === 'payout' ? (
        <Card className="mt-4">
          <Table rows={payouts} rowKey={(p) => p._id} empty={<EmptyState title="Không có khoản hoàn nào chờ chuyển" />} columns={[
            { key: 'k', header: 'Khách hàng', cell: (p) => <div><p>{userName(db, p.customerId)}</p><p className="text-xs text-stone-500">{PAYMENT_TYPE[p.type].label} · {fmtDate(p.createdAt)}</p></div> },
            { key: 'a', header: 'Số tiền', className: 'tabular-nums', cell: (p) => vnd(p.amount) },
            { key: 't', header: 'Tài khoản nhận', cell: (p) => { const acc = payoutAccountOf(p); return acc ? <span className="text-sm">{acc.bankName} · <span className="font-mono">{acc.accountNumber}</span> · {acc.accountName}</span> : <span className="text-xs font-medium text-amber-700">Khách chưa khai — liên hệ khách</span>; } },
            { key: 'x', header: '', className: 'text-right', cell: (p) => (selfApprovedPayout(p)
              // Người lập / duyệt / điều chỉnh không tự xác nhận khoản chi của chính mình.
              ? <span className="text-xs text-stone-500">Bạn lập / duyệt khoản này — người khác xác nhận</span>
              : isFM && !payoutAccountOf(p) ? <span className="text-xs text-stone-500">Vận hành xác nhận</span>
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
              {canRecordDelivery(x) && <p className="text-xs font-medium text-amber-700">thông báo cuối chưa tới khách</p>}
            </div>
          ) },
          { key: 's', header: 'Trạng thái', cell: (x) => <StatusBadge map={CONTRACT_STATUS} value={x.status} /> },
          { key: 'a', header: '', className: 'text-right', cell: (x) => (
            <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {canLock(x) && <Button size="sm" variant="danger" onClick={() => lock(x)}><Lock className="size-3.5" />Khóa</Button>}
              {x.balance.outstanding > 0 && <Button size="sm" variant="secondary" onClick={() => setCollect(x)}><Banknote className="size-3.5" />Thu tại quầy</Button>}
              {isClosedContract(x.status) && x.balance.outstanding > 0 && <Button size="sm" variant="ghost" onClick={() => writeOff(x)}>Xoá nợ</Button>}
              {x.status === 'CLOSED' && damageRoom(x) > 0 && disputeOf(x) && <Button size="sm" variant="ghost" onClick={() => { setAdjustForm({ amount: 0, reason: '' }); setAdjust(x); }}>Điều chỉnh biên bản</Button>}
              {canRecordDispute(x) && <Button size="sm" variant="ghost" onClick={() => { setDisputeText(''); setDispute(x); }}><MessageSquareWarning className="size-3.5" />Ghi nhận khiếu nại tại quầy</Button>}
              {canFinalNotice(x) && <Button size="sm" variant="danger" onClick={() => { setNotify(x); setNotifyNote(''); }}><Megaphone className="size-3.5" />Gửi thông báo cuối</Button>}
              {canRecordDelivery(x) && <Button size="sm" variant="secondary" onClick={() => { setDeliveryForm({ channel: 'PHONE', note: '', at: T.slice(0, 10) }); setDelivery(x); }}><PhoneCall className="size-3.5" />Ghi nhận đã báo khách</Button>}
              {canSwap(x) && <Button size="sm" variant="secondary" onClick={() => openSwap(x)}><ArrowLeftRight className="size-3.5" />Đổi ô</Button>}
              {(x.delinquency?.lateFeesAccrued ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={() => { setWaive(x); setReason(''); }}><BadgePercent className="size-3.5" />Miễn phí trễ</Button>}
              {canAbandon(x) && <Button size="sm" variant="danger" onClick={() => setAbandon(x)}><PackageX className="size-3.5" />Xử lý hàng bỏ lại</Button>}
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
                { key: 'r', header: '', className: 'text-right', cell: (p) => (hasReceipt(p) ? <ReceiptButton paymentId={p._id} print variant="ghost" label="Biên lai" /> : null) },
              ]} />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold">Thông báo đã gửi khách</h4>
              <ContractNotices contract={c} empty="Chưa gửi thông báo nào." />
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
            onClick={() => swap && void run('swapUnit', { contractId: swap._id, toUnitId: swapForm.toUnitId, reason: swapForm.reason, keyTag: swapForm.keyTag, fee: swapFree(swap, swapForm.facilityFault) ? 0 : swapForm.fee, facilityFault: swapForm.facilityFault },
              (u) => `Đã chuyển sang ô ${u.unitNumber} — giá thuê giữ nguyên`, () => setSwap(null))}>
            Xác nhận đổi ô
          </Button>
        }>
        {swap && (
          <div className="space-y-4">
            <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900 ring-1 ring-brand-200">
              Chỉ đổi sang ô <b>cùng loại</b>; giá thuê <b>{vnd(swap.billing.rate)}/{PERIOD_UNIT[swap.billing.rentalPeriod]}</b> và tiền giữ chân <b>{vnd(swap.deposit.amount)}</b> giữ nguyên.
            </div>

            {swapCandidates.length === 0 ? (
              <EmptyState title="Không còn ô trống cùng loại" />
            ) : (
              <Field label={`Ô kho mới (${swapCandidates.length} ô trống cùng loại)`}>
                <select className={inputCls} value={swapForm.toUnitId} onChange={(e) => setSwapForm((f) => ({ ...f, toUnitId: e.target.value }))}>
                  <option value="">— Chọn ô —</option>
                  {swapCandidates.map((u) => <option key={u._id} value={u._id}>{u.unitNumber} · tầng {u.location.floor}{u.location.zone ? ` · khu ${u.location.zone}` : ''} · {ACCESS_METHOD[u.accessMethod]}{u.accessMethod !== swap?.access.method ? ' (khác khoá ô cũ)' : ''}</option>)}
                </select>
              </Field>
            )}

            <Field label="Lý do đổi ô">
              <textarea className={inputCls} rows={2} value={swapForm.reason} onChange={(e) => setSwapForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="VD: khách xin đổi sang ô gần lối ra, ô cũ ẩm sau mưa…" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nhãn chìa khóa / thẻ mới" hint="Bỏ trống nếu giữ nguyên khóa cũ">
                <input className={inputCls} value={swapForm.keyTag} onChange={(e) => setSwapForm((f) => ({ ...f, keyTag: e.target.value }))} placeholder="VD: K-217" />
              </Field>
              {swapFree(swap, swapForm.facilityFault) ? (
                <p className="self-end rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Miễn phí — {swapForm.facilityFault ? 'đổi do lỗi từ chi nhánh' : 'lần đổi ô đầu tiên của hợp đồng'} (Điều 8).</p>
              ) : (
                <Field label="Phí thao tác (VND)" hint={`Tối đa ${vnd(SWAP_FEE_MAX)}; 0 nếu miễn.`}>
                  <input type="number" min={0} max={SWAP_FEE_MAX} step={10_000} className={inputCls} value={swapForm.fee}
                    onChange={(e) => setSwapForm((f) => ({ ...f, fee: Math.max(0, Math.min(SWAP_FEE_MAX, Number(e.target.value) || 0)) }))} />
                </Field>
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="checkbox" className="size-4" checked={swapForm.facilityFault} onChange={(e) => setSwapForm((f) => ({ ...f, facilityFault: e.target.checked, fee: swapFeeOf(swap, e.target.checked) }))} />
              Đổi do lỗi từ chi nhánh (ô hư hỏng, mất an ninh…) — miễn phí
            </label>

            {!swapFree(swap, swapForm.facilityFault) && swapForm.fee > 0 && <p className="text-sm text-amber-800">Phí {vnd(swapForm.fee)} cộng vào công nợ của hợp đồng.</p>}

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
        footer={<Button disabled={!adjust || adjustForm.amount <= 0 || adjustForm.amount > adjustMax(adjust) || adjustForm.reason.trim().length < 5}
          onClick={() => adjust && void run('adjustDamage', { contractId: adjust._id, amount: adjustForm.amount, reason: adjustForm.reason.trim() }, (v) => `Đã điều chỉnh — giảm nợ ${vnd(v.debtCut)}, hoàn khách ${vnd(v.refund)}`, () => setAdjust(null))}>Xác nhận điều chỉnh</Button>}>
        {adjust && (() => {
          const insp = moveOutInspection(adjust);
          return insp ? (
            <div className="space-y-4">
              {disputeOf(adjust) && (
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200">
                  <p className="font-medium">Khách khiếu nại · {fmtDate(disputeOf(adjust)!.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-line">{disputeOf(adjust)!.description || disputeOf(adjust)!.subject}</p>
                </div>
              )}
              <InspectionReport inspection={insp} inspectorName={userName(db, insp.inspectorId)} />
              <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-700">
                Trừ vào nợ còn lại ({vnd(adjust.balance.outstanding)}) trước, trả thừa thì hoàn chuyển khoản. Hạn mức {vnd(myLimit)} tính trên tổng đã xoá nợ / điều chỉnh của hợp đồng.
              </p>
              <Field label="Giảm chi phí hư hại (VND)">
                <input type="number" min={0} max={adjustMax(adjust)} step={10_000} className={inputCls} value={adjustForm.amount}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, amount: Math.max(0, Math.min(adjustMax(adjust), Number(e.target.value) || 0)) }))} />
              </Field>
              <Field label="Lý do" hint="Khách đọc được.">
                <textarea className={inputCls} rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
              </Field>
            </div>
          ) : null;
        })()}
      </Modal>

      <Modal open={!!payout} onClose={() => setPayout(null)} title="Xác nhận đã chuyển khoản hoàn" description={payout ? `${userName(db, payout.customerId)} · ${vnd(payout.amount)} · ${PAYMENT_TYPE[payout.type].label}` : ''}
        footer={<Button disabled={payoutForm.reference.trim().length < 3 || (!!payout && !payoutAccountOf(payout) && payoutForm.toAccount.trim().length < 6)}
          onClick={() => payout && void run('confirmPayout', { paymentId: payout._id, reference: payoutForm.reference.trim(), toAccount: payoutForm.toAccount.trim() }, 'Đã ghi nhận chuyển khoản hoàn', () => setPayout(null))}>Xác nhận</Button>}>
        {payout && (
          <div className="grid gap-4 text-sm">
            <p className="text-stone-600">Chỉ xác nhận SAU KHI đã chuyển tiền thật.</p>
            <Field label="Mã giao dịch ngân hàng"><input className={inputCls} value={payoutForm.reference} onChange={(e) => setPayoutForm((f) => ({ ...f, reference: e.target.value }))} placeholder="FT26292xxxxx" /></Field>
            {!payoutAccountOf(payout) && (
              <Field label="Đã chuyển tới tài khoản" hint="Ngân hàng · số tài khoản · chủ tài khoản"><input className={inputCls} value={payoutForm.toAccount} onChange={(e) => setPayoutForm((f) => ({ ...f, toAccount: e.target.value }))} /></Field>
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
              Khách nhận email và thấy trong tài khoản: dư nợ <b>{vnd(notify.balance.outstanding)}</b>, hạn chót thanh toán hoặc liên hệ là hết ngày <b>{fmtDate(addDays(T, abandonDaysOf(signedPolicy(notify)) - 1))}</b>.
              Từ <b>{fmtDate(addDays(T, abandonDaysOf(signedPolicy(notify))))}</b> chi nhánh được xử lý đồ bỏ lại (Điều 7). Mỗi đợt nợ chỉ gửi một lần.
            </div>
            <Field label="Ghi chú (tuỳ chọn)" hint="Khách đọc được.">
              <textarea className={inputCls} rows={2} maxLength={500} value={notifyNote} onChange={(e) => setNotifyNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!delivery} onClose={() => setDelivery(null)} title="Ghi nhận đã báo khách"
        description={delivery ? `${userName(db, delivery.customerId)} · kho ${unitLabel(db, delivery.unitId)} · thông báo cuối ${fmtDate(delivery.delinquency?.finalNoticeAt)}` : ''}
        footer={<Button disabled={!delivery || deliveryForm.note.trim().length < 5}
          onClick={() => delivery && void run('recordFinalNoticeDelivery', { contractId: delivery._id, channel: deliveryForm.channel, note: deliveryForm.note, at: deliveryForm.at && deliveryForm.at !== T.slice(0, 10) ? `${deliveryForm.at}T00:00:00.000Z` : undefined },
            'Đã ghi nhận đã báo khách', () => setDelivery(null))}>Ghi nhận</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kênh">
            <select className={inputCls} value={deliveryForm.channel} onChange={(e) => setDeliveryForm((f) => ({ ...f, channel: e.target.value as ManualDeliveryChannel }))}>
              {(Object.keys(MANUAL_DELIVERY_CHANNEL) as ManualDeliveryChannel[]).map((k) => <option key={k} value={k}>{MANUAL_DELIVERY_CHANNEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Ngày báo">
            <input type="date" className={inputCls} max={T.slice(0, 10)} value={deliveryForm.at} onChange={(e) => setDeliveryForm((f) => ({ ...f, at: e.target.value }))} />
          </Field>
          <Field label="Ghi chú" className="sm:col-span-2">
            <textarea className={inputCls} rows={2} maxLength={500} value={deliveryForm.note} onChange={(e) => setDeliveryForm((f) => ({ ...f, note: e.target.value }))} placeholder="VD: gọi 0901…, khách xác nhận đã nghe nội dung" />
          </Field>
        </div>
      </Modal>

      <CounterCollectDialog contract={collect} onClose={() => setCollect(null)} />

      <Modal open={!!dispute} onClose={() => setDispute(null)} title="Ghi nhận khiếu nại tại quầy"
        description={dispute ? `${userName(db, dispute.customerId)} · ${dispute.contractNumber}` : ''}
        footer={<Button disabled={!dispute || disputeText.trim().length < 10}
          onClick={() => dispute && void run('createTicket', {
            facilityId: dispute.facilityId, kind: 'CUSTOMER_ISSUE', category: 'BILLING', priority: 'HIGH',
            subject: `Khiếu nại biên bản trả kho ${dispute.contractNumber} (tại quầy)`, description: disputeText.trim(), contractId: dispute._id, onBehalfOfCustomer: true,
          }, 'Đã ghi nhận khiếu nại của khách', () => setDispute(null))}>Ghi nhận</Button>}>
        {dispute && (() => {
          const insp = moveOutInspection(dispute);
          return (
            <Field label="Nội dung khách khiếu nại" hint={insp ? `Hạn khiếu nại: hết ngày ${fmtDate(new Date(inspectionDisputeDeadline(insp.performedAt) - 1).toISOString())}` : undefined}>
              <textarea className={inputCls} rows={3} maxLength={5000} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} />
            </Field>
          );
        })()}
      </Modal>

      <AbandonDialog contract={abandon} onClose={() => setAbandon(null)} />
    </>
  );
}
