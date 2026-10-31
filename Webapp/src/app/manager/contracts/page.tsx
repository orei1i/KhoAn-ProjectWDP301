'use client';

import { useState } from 'react';
import {
  ArrowLeftRight, BadgePercent, Banknote, CalendarCheck, CalendarClock, CalendarDays, CalendarRange, CalendarX, CreditCard, FileText, History, Hourglass, Info, KeyRound,
  Landmark, Lock, Mail, Megaphone, MessageSquareWarning, PackageOpen, PackageX, PhoneCall, Receipt, Repeat, ScrollText, ShieldAlert, Tag, TriangleAlert, Undo2, UserRoundPen, Wallet, Warehouse,
} from 'lucide-react';
import type { ManualDeliveryChannel, RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { abandonDaysOf, canDisputeInspection, MANUAL_DELIVERY_CHANNEL, defaultSwapFee, inspectionDisputeDeadline, isClosedContract, isFreeSwap, lastDayOf, OPEN_CONTRACT_STATUSES, PERIOD_UNIT, paymentsOfContract, SWAP_FEE_MAX } from '@ssm/shared';
import { ContractNotices } from '@/features/contracts/contract-notices';
import { InspectionReport } from '@/features/contracts/inspection-report';
import { AbandonDialog, abandonFrom, finalNoticeOf, noticeDelivered } from '@/features/contracts/abandon-dialog';
import { CustomerIdentityDialog } from '@/features/auth/customer-identity-dialog';
import { IdCheckUnlock } from '@/features/contracts/id-check-unlock';
import type { PaymentTransaction } from '@ssm/shared';
import { ACCESS_METHOD, CONTRACT_STATUS, DEPOSIT_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, type Tone } from '@/shared/lib/labels';
import { effectivePolicy, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, daysBetween, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, Disclosure, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, Table, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { CounterCollectDialog } from '@/features/payments/counter-collect';
import { ReceiptButton, hasReceipt } from '@/features/payments/receipt-button';
import { GatewayRefundQueue, gatewayRefundsToResolve } from '@/features/payments/gateway-refund-queue';
import { Callout, CheckLine, Fact, FactGrid, Meta, PillFilter, QueueRow, UnitTag } from '@/features/staff-ui';
import { NewAccessFields } from '@/features/access/unit-access-fields';
import { Section, Timeline } from '@/features/backoffice-ui';

/** Màu ô kho theo trạng thái hợp đồng (chỉ để trình bày). */
const unitTone = (s: RentalContract['status']): Tone | 'ink' =>
  s === 'LOCKED_OUT' || s === 'ABANDONED' ? 'red' : s === 'DELINQUENT' ? 'amber' : s === 'MOVE_OUT_PENDING' ? 'violet' : s === 'CLOSED' ? 'gray' : 'ink';

type Tab = 'overdue' | 'expiring' | 'expired' | 'moveout' | 'returned' | 'debt' | 'payout' | 'gatewayRefund' | 'all';

export default function Contracts() {
  const { db, user, run, paymentMode } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const policy = effectivePolicy(db, fid);
  const [tab, setTab] = useState<Tab>('overdue');
  const [view, setView] = useState<RentalContract | null>(null);
  const [waive, setWaive] = useState<RentalContract | null>(null);
  const [reason, setReason] = useState('');
  const [swap, setSwap] = useState<RentalContract | null>(null);
  // Đợt 16 (B1): oldReset = đã thu chìa / thẻ cũ / đặt lại ổ khoá ô cũ ngay lúc đổi; tried = hiện lỗi thiếu mã chìa / thẻ mới.
  const [swapForm, setSwapForm] = useState({ toUnitId: '', reason: '', keyTag: '', fee: 0, facilityFault: false, oldReset: false, tried: false });
  const [abandon, setAbandon] = useState<RentalContract | null>(null);
  // Thông báo cuối không gửi được email → ghi nhận đã báo khách bằng kênh khác.
  const [delivery, setDelivery] = useState<RentalContract | null>(null);
  const [deliveryForm, setDeliveryForm] = useState<{ channel: ManualDeliveryChannel; note: string; at: string }>({ channel: 'PHONE', note: '', at: '' });
  // Đợt 17 (A2): kết quả ghi nhận — hạn mới để báo khách. `deadline` = ngày đầu được xử lý đồ; hạn chót của khách là hết ngày hôm trước.
  const [deliveryDone, setDeliveryDone] = useState<{ deadline: string; changed: boolean; who: string } | null>(null);
  const [notify, setNotify] = useState<RentalContract | null>(null);
  const [notifyNote, setNotifyNote] = useState('');
  const [payout, setPayout] = useState<PaymentTransaction | null>(null);
  const [payoutForm, setPayoutForm] = useState({ reference: '', toAccount: '' });
  // Đợt VNPAY: 403 SAME_APPROVER của khoản hoàn cổng vừa chuyển sang chuyển khoản — giữ câu báo trong hộp, không chỉ toast.
  const [payoutError, setPayoutError] = useState('');
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
  /**
   * Khoá tay đúng mốc ghi trong hợp đồng khách đã ký ("quá N ngày bị khoá") VÀ từ ngày khoá đã báo khách trong thông báo hết ân hạn
   * (delinquency.lockFrom — server chặn LOCKOUT_TOO_EARLY như nhau). Chưa tới ngày đó thì chỉ hiện "Khoá từ dd/mm".
   */
  const lockFromOf = (x: RentalContract) => (x.status === 'DELINQUENT' ? x.delinquency?.lockFrom ?? null : null);
  const canLock = (x: RentalContract) => {
    const from = lockFromOf(x);
    return !!from && T >= from && (x.delinquency?.daysOverdue ?? 0) > x.terms.lockoutAfterDays;
  };
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
  /** Theo đúng BE (confirmPayout): chi bồi thường chỉ chặn người DUYỆT hồ sơ; khoản chi khác chặn người lập lệnh; khoản hoàn do điều
   *  chỉnh biên bản chặn người điều chỉnh — những trường hợp đó người khác xác nhận đã chuyển. */
  const movedByMe = (p: PaymentTransaction) => !!user && p.gatewayRefund?.resolvedBy === user._id; // Đợt VNPAY: người bấm "Chuyển sang chuyển khoản"
  const selfApprovedPayout = (p: PaymentTransaction) => !!user && (p.type === 'COMPENSATION'
    ? db.claims.find((x) => x.settlement?.paymentId === p._id)?.review?.reviewedBy === user._id
    : p.createdBy === user._id || movedByMe(p)
      || (p.type === 'REFUND' && db.inspections.some((i) => (i.adjustments ?? []).some((a) => a.refundPaymentId === p._id && a.by === user._id))));
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
    gatewayRefund: [],
    all: open,
  };
  /** Khoản HOÀN bằng chuyển khoản đang chờ chuyển của chi nhánh — chuyển xong thì xác nhận kèm mã giao dịch. */
  const payouts = db.payments.filter((p) => p.facilityId === fid && p.direction === 'REFUND' && p.method === 'BANK_TRANSFER' && p.status === 'PENDING').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const gatewayRefunds = gatewayRefundsToResolve(db.payments.filter((p) => p.facilityId === fid));
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
  const openSwap = (x: RentalContract) => { setSwapForm({ toUnitId: '', reason: '', keyTag: '', fee: swapFeeOf(x, false), facilityFault: false, oldReset: false, tried: false }); setSwap(x); };
  const swapTarget = swapForm.toUnitId ? db.units.find((u) => u._id === swapForm.toUnitId) : undefined;
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
      <PillFilter value={tab} onChange={setTab} options={[
        { key: 'overdue', label: 'Quá hạn', icon: <TriangleAlert />, count: groups.overdue.length },
        { key: 'expiring', label: 'Sắp hết hạn (30 ngày)', icon: <CalendarClock />, count: groups.expiring.length },
        { key: 'expired', label: 'Quá hạn chưa gia hạn', icon: <CalendarX />, count: groups.expired.length },
        { key: 'moveout', label: 'Chờ trả kho', icon: <PackageOpen />, count: groups.moveout.length },
        { key: 'returned', label: 'Vừa trả kho (30 ngày)', icon: <Undo2 />, count: groups.returned.length },
        { key: 'debt', label: 'Nợ sau quyết toán', icon: <Banknote />, count: groups.debt.length },
        { key: 'payout', label: 'Chờ hoàn tiền', icon: <Landmark />, count: payouts.length },
        ...(paymentMode === 'VNPAY' || gatewayRefunds.length > 0 ? [{ key: 'gatewayRefund' as const, label: 'Hoàn qua VNPAY cần xử lý', icon: <Undo2 />, count: gatewayRefunds.length }] : []),
        { key: 'all', label: 'Tất cả đang mở', icon: <FileText />, count: groups.all.length },
      ]} />
      {tab === 'gatewayRefund' ? (
        <Card className="mt-4"><GatewayRefundQueue rows={gatewayRefunds} /></Card>
      ) : tab === 'payout' ? (
        <Card className="mt-4">
          {payouts.length === 0 ? <EmptyState icon={<Landmark className="size-6" />} title="Không có khoản hoàn nào chờ chuyển" /> : (
            <ul className="divide-y divide-stone-100">
              {payouts.map((p) => {
                const acc = payoutAccountOf(p);
                return (
                  <QueueRow key={p._id}
                    lead={<IconTile icon={<Landmark className="size-4" />} tone="violet" />}
                    title={userName(db, p.customerId)}
                    badges={<><Badge tone={PAYMENT_TYPE[p.type].tone}>{PAYMENT_TYPE[p.type].label}</Badge><span className="text-sm font-semibold tabular-nums text-ink">{vnd(p.amount)}</span></>}
                    meta={<>
                      <Meta icon={<CalendarDays />}>{fmtDate(p.createdAt)}</Meta>
                      {acc
                        ? <Meta icon={<CreditCard />}>{acc.bankName} · <span className="font-mono">{acc.accountNumber}</span> · {acc.accountName}</Meta>
                        : <Meta icon={<TriangleAlert />} className="font-medium text-amber-700">Khách chưa khai — liên hệ khách</Meta>}
                    </>}
                    actions={selfApprovedPayout(p)
                      // Người lập / duyệt / điều chỉnh không tự xác nhận khoản chi của chính mình.
                      ? <span className="text-xs text-stone-500">{movedByMe(p) ? 'Bạn đã chuyển khoản hoàn này sang chuyển khoản — người khác xác nhận' : 'Bạn lập / duyệt khoản này — người khác xác nhận'}</span>
                      : isFM && !payoutAccountOf(p) ? <span className="text-xs text-stone-500">Vận hành xác nhận</span>
                      : <Button size="sm" onClick={() => { setPayout(p); setPayoutForm({ reference: '', toAccount: '' }); setPayoutError(''); }}><Banknote className="size-3.5" />Xác nhận đã chuyển</Button>}
                  />
                );
              })}
            </ul>
          )}
        </Card>
      ) : (
      <Card className="mt-4">
        {groups[tab].length === 0 ? <EmptyState icon={<FileText className="size-6" />} title="Không có hợp đồng" /> : (
          <ul className="divide-y divide-stone-100">
            {groups[tab].map((x) => (
              <QueueRow key={x._id} onSelect={() => setView(x)}
                lead={<UnitTag label={unitLabel(db, x.unitId)} tone={unitTone(x.status)} />}
                title={userName(db, x.customerId)}
                badges={<StatusBadge map={CONTRACT_STATUS} value={x.status} />}
                meta={<>
                  <Meta mono>{x.contractNumber}</Meta>
                  <Meta icon={<Warehouse />}>{typeName(db, x.unitTypeId)}</Meta>
                  <Meta icon={<CalendarDays />}>Hết ngày {fmtDate(lastDayOf(x.endDate))}</Meta>
                  {x.autoRenew && <Meta icon={<Repeat />}>Tự gia hạn</Meta>}
                  <Meta icon={<Tag />}>{vnd(x.billing.rate)}/{PERIOD_UNIT[x.billing.rentalPeriod]}</Meta>
                  {x.balance.outstanding > 0 && <Meta icon={<Banknote />} className="font-medium text-red-700">Nợ {vnd(x.balance.outstanding)}</Meta>}
                  {x.delinquency && <Meta icon={<Hourglass />}>quá hạn {x.delinquency.daysOverdue} ngày</Meta>}
                  {x.status === 'LOCKED_OUT' && (x.delinquency?.finalNoticeAt
                    ? <Meta icon={<Megaphone />} className={canAbandon(x) ? 'font-medium text-red-700' : undefined}>thông báo cuối {fmtDate(x.delinquency.finalNoticeAt)} · xử lý từ {fmtDate(finalDeadline(x))}</Meta>
                    : <Meta icon={<Lock />} className="font-medium text-amber-700">khóa {lockedOutDays(x)} ngày · chưa gửi thông báo cuối</Meta>)}
                  {canRecordDelivery(x) && <Meta icon={<PhoneCall />} className="font-medium text-amber-700">thông báo cuối chưa tới khách</Meta>}
                </>}
                actions={<>
                  {canLock(x) ? <Button size="sm" variant="danger" onClick={() => lock(x)}><Lock className="size-3.5" />Khóa</Button>
                    : lockFromOf(x) && T < lockFromOf(x)! && <span className="self-center text-xs text-stone-500">Khoá từ {fmtDate(lockFromOf(x)!).slice(0, 5)}</span>}
                  {x.balance.outstanding > 0 && <Button size="sm" variant="secondary" onClick={() => setCollect(x)}><Banknote className="size-3.5" />Thu tại quầy</Button>}
                  {isClosedContract(x.status) && x.balance.outstanding > 0 && <Button size="sm" variant="ghost" onClick={() => writeOff(x)}>Xoá nợ</Button>}
                  {x.status === 'CLOSED' && damageRoom(x) > 0 && disputeOf(x) && <Button size="sm" variant="ghost" onClick={() => { setAdjustForm({ amount: 0, reason: '' }); setAdjust(x); }}>Điều chỉnh biên bản</Button>}
                  {canRecordDispute(x) && <Button size="sm" variant="ghost" onClick={() => { setDisputeText(''); setDispute(x); }}><MessageSquareWarning className="size-3.5" />Ghi nhận khiếu nại tại quầy</Button>}
                  {canFinalNotice(x) && <Button size="sm" variant="danger" onClick={() => { setNotify(x); setNotifyNote(''); }}><Megaphone className="size-3.5" />Gửi thông báo cuối</Button>}
                  {canRecordDelivery(x) && <Button size="sm" variant="secondary" onClick={() => { setDeliveryForm({ channel: 'PHONE', note: '', at: T.slice(0, 10) }); setDelivery(x); }}><PhoneCall className="size-3.5" />Ghi nhận đã báo khách</Button>}
                  {canSwap(x) && <Button size="sm" variant="secondary" onClick={() => openSwap(x)}><ArrowLeftRight className="size-3.5" />Đổi ô</Button>}
                  {(x.delinquency?.lateFeesAccrued ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={() => { setWaive(x); setReason(''); }}><BadgePercent className="size-3.5" />Miễn phí trễ</Button>}
                  {canAbandon(x) && <Button size="sm" variant="danger" onClick={() => setAbandon(x)}><PackageX className="size-3.5" />Xử lý hàng bỏ lại</Button>}
                  <IdCheckUnlock kind="contracts" target={x} label={`hợp đồng ${x.contractNumber}`} />
                </>}
              />
            ))}
          </ul>
        )}
      </Card>
      )}

      <Modal open={!!c} onClose={() => setView(null)} size="lg" title={`Hợp đồng ${c?.contractNumber ?? ''}`} description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)}` : ''}>
        {c && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <UnitTag label={unitLabel(db, c.unitId)} tone={unitTone(c.status)} size="sm" />
              <StatusBadge map={CONTRACT_STATUS} value={c.status} /><StatusBadge map={DEPOSIT_STATUS} value={c.deposit.status} />
              {OPEN_CONTRACT_STATUSES.includes(c.status) && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setIdentityOf(c)}><UserRoundPen className="size-3.5" />Sửa họ tên / giấy tờ khách</Button>}
            </div>
            <IdCheckUnlock kind="contracts" target={c} label={`hợp đồng ${c.contractNumber}`} />
            {c.balance.outstanding > 0 && (
              <Callout tone="red" icon={<Banknote />} title={`Còn nợ ${vnd(c.balance.outstanding)}`}>
                {c.delinquency ? `Quá hạn ${c.delinquency.daysOverdue} ngày` : undefined}
              </Callout>
            )}
            <FactGrid>
              <Fact icon={<CalendarRange className="size-4" />} label="Thời hạn">{fmtDate(c.startDate)} → hết ngày {fmtDate(lastDayOf(c.endDate))}</Fact>
              <Fact icon={<Tag className="size-4" />} label="Giá thuê" tone="teal">{vnd(c.billing.rate)}/{PERIOD_UNIT[c.billing.rentalPeriod]}</Fact>
              <Fact icon={<CalendarCheck className="size-4" />} label="Đã thanh toán đến" tone="green">{fmtDate(c.billing.paidThrough)}</Fact>
              <Fact icon={<CalendarClock className="size-4" />} label="Kỳ tới" tone="blue">{fmtDate(c.billing.nextBillingDate)}</Fact>
              <Fact icon={<Wallet className="size-4" />} label="Tiền giữ chân">{vnd(c.deposit.amount)}</Fact>
              <Fact icon={<KeyRound className="size-4" />} label="Truy cập" tone={c.access.suspendedAt ? 'red' : 'gray'}>{ACCESS_METHOD[c.access.method]}{c.access.suspendedAt ? ' · đang tạm khóa' : ''}</Fact>
              <Fact icon={<ScrollText className="size-4" />} label="Chính sách">v{c.terms.policyVersion} · ân hạn {c.terms.gracePeriodDays} ngày</Fact>
              <Fact icon={<Repeat className="size-4" />} label="Gia hạn · đổi ô">{c.renewals.length} lần gia hạn · {c.unitSwaps?.length ?? 0} lần đổi ô</Fact>
            </FactGrid>
            <Section icon={<Receipt />} title="Thanh toán gần đây">
              <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-stone-200">
                <Table rows={cPayments} rowKey={(p) => p._id} empty={<EmptyState compact icon={<Receipt className="size-5" />} title="Chưa có khoản thanh toán" />} columns={[
                  { key: 'd', header: 'Ngày', cell: (p) => fmtDate(p.paidAt ?? p.createdAt) },
                  { key: 't', header: 'Khoản', cell: (p) => PAYMENT_TYPE[p.type].label },
                  { key: 'a', header: 'Số tiền', className: 'text-right tabular-nums', cell: (p) => vnd(p.amount) },
                  { key: 's', header: 'Trạng thái', cell: (p) => <StatusBadge map={PAYMENT_STATUS} value={p.status} /> },
                  { key: 'r', header: '', className: 'text-right', cell: (p) => (hasReceipt(p) ? <ReceiptButton paymentId={p._id} print variant="ghost" label="Biên lai" /> : null) },
                ]} />
              </div>
            </Section>
            <Disclosure icon={<Mail className="size-4" />} title="Thông báo đã gửi khách">
              <ContractNotices contract={c} empty="Chưa gửi thông báo nào." />
            </Disclosure>
            <Disclosure icon={<History className="size-4" />} title="Lịch sử trạng thái" meta={`${c.statusHistory.length} bước`}>
              <Timeline items={c.statusHistory.map((h) => ({
                at: fmtDate(h.at),
                title: <>{h.from ? `${CONTRACT_STATUS[h.from].label} → ` : ''}{CONTRACT_STATUS[h.to].label}</>,
                note: h.reason || undefined,
                tone: CONTRACT_STATUS[h.to].tone,
              }))} />
            </Disclosure>
          </div>
        )}
      </Modal>

      <Modal open={!!waive} onClose={() => setWaive(null)} title="Miễn phí trễ hạn" description={waive ? `${unitLabel(db, waive.unitId)} · phí ${vnd(waive.delinquency?.lateFeesAccrued ?? 0)}` : ''}
        footer={<Button disabled={reason.trim().length < 5} onClick={() => waive && void run('waiveLateFees', { contractId: waive._id, reason }, (v) => `Đã miễn ${vnd(v)}`, () => setWaive(null))}>Xác nhận miễn</Button>}>
        <div className="space-y-4">
          <FactGrid>
            <Fact icon={<BadgePercent className="size-4" />} label="Phí trễ đang tính" tone="amber">{vnd(waive?.delinquency?.lateFeesAccrued ?? 0)}</Fact>
            <Fact icon={<Info className="size-4" />} label="Hạn mức Quản lý chi nhánh / lần" tone="teal">{vnd(policy.waiverLimits.find((w) => w.role === 'FACILITY_MANAGER')?.maxAmount ?? 0)}</Fact>
          </FactGrid>
          <Field label="Lý do (ghi vào nhật ký kiểm toán)">
            <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!swap} onClose={() => setSwap(null)} size="lg"
        title="Đổi ô kho" description={swap ? `${userName(db, swap.customerId)} · đang thuê ${unitLabel(db, swap.unitId)} (${typeName(db, swap.unitTypeId)})` : ''}
        footer={
          <Button disabled={!swapForm.toUnitId || swapForm.reason.trim().length < 5}
            onClick={() => {
              if (!swap) return;
              if (swapTarget && swapTarget.accessMethod !== 'PIN' && !swapForm.keyTag.trim()) { setSwapForm((f) => ({ ...f, tried: true })); return; }
              void run('swapUnit', { contractId: swap._id, toUnitId: swapForm.toUnitId, reason: swapForm.reason, keyTag: swapForm.keyTag, fee: swapFree(swap, swapForm.facilityFault) ? 0 : swapForm.fee, facilityFault: swapForm.facilityFault, oldAccessReset: swapForm.oldReset },
                (r) => `Đã chuyển sang ô ${r.toUnit.unitNumber} — giá thuê giữ nguyên${r.pin ? ` · mật khẩu mới ${r.pin} (khách xem trong tài khoản)` : ''}`, () => setSwap(null));
            }}>
            Xác nhận đổi ô
          </Button>
        }>
        {swap && (
          <div className="space-y-4">
            <Callout tone="teal" icon={<ArrowLeftRight />}>
              Chỉ đổi sang ô <b>cùng loại</b>; giá thuê <b>{vnd(swap.billing.rate)}/{PERIOD_UNIT[swap.billing.rentalPeriod]}</b> và tiền giữ chân <b>{vnd(swap.deposit.amount)}</b> giữ nguyên.
              Đổi sang cỡ kho khác: khách gửi yêu cầu đổi ô và chọn loại mới (có báo giá + phụ lục đổi cỡ kho).
            </Callout>

            {swapCandidates.length === 0 ? (
              <EmptyState compact icon={<Warehouse className="size-5" />} title="Không còn ô trống cùng loại" />
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
              <div className="sm:col-span-2">
                <NewAccessFields oldMethod={swap.access.method} oldKeyTag={swap.access.keyTag} newMethod={swapTarget?.accessMethod} keyTag={swapForm.keyTag}
                  onKeyTag={(keyTag) => setSwapForm((f) => ({ ...f, keyTag }))} oldReset={swapForm.oldReset} onOldReset={(oldReset) => setSwapForm((f) => ({ ...f, oldReset }))} showError={swapForm.tried} />
              </div>
              {swapFree(swap, swapForm.facilityFault) ? (
                <Callout tone="green" icon={<BadgePercent />} className="self-end">Miễn phí — {swapForm.facilityFault ? 'đổi do lỗi từ chi nhánh' : 'lần đổi ô đầu tiên của hợp đồng'} (Điều 8).</Callout>
              ) : (
                <Field label="Phí thao tác (VND)" hint={`Tối đa ${vnd(SWAP_FEE_MAX)}; 0 nếu miễn.`}>
                  <input type="number" min={0} max={SWAP_FEE_MAX} step={10_000} className={inputCls} value={swapForm.fee}
                    onChange={(e) => setSwapForm((f) => ({ ...f, fee: Math.max(0, Math.min(SWAP_FEE_MAX, Number(e.target.value) || 0)) }))} />
                </Field>
              )}
            </div>
            <CheckLine checked={swapForm.facilityFault} onChange={(v) => setSwapForm((f) => ({ ...f, facilityFault: v, fee: swapFeeOf(swap, v) }))}>
              Đổi do lỗi từ chi nhánh (ô hư hỏng, mất an ninh…) — miễn phí
            </CheckLine>

            {!swapFree(swap, swapForm.facilityFault) && swapForm.fee > 0 && <Callout tone="amber" icon={<Banknote />}>Phí {vnd(swapForm.fee)} cộng vào công nợ của hợp đồng.</Callout>}

            {(swap.unitSwaps?.length ?? 0) > 0 && (
              <Disclosure icon={<History className="size-4" />} title={`Đã đổi ô ${swap.unitSwaps!.length} lần`}>
                <Timeline items={swap.unitSwaps!.map((s) => ({
                  at: fmtDate(s.at),
                  title: `${unitLabel(db, s.fromUnitId)} → ${unitLabel(db, s.toUnitId)}`,
                  note: `${s.reason}${s.fee > 0 ? ` · phí ${vnd(s.fee)}` : ''}`,
                  tone: 'blue' as const,
                }))} />
              </Disclosure>
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
                <Callout tone="amber" icon={<MessageSquareWarning />} title={`Khách khiếu nại · ${fmtDate(disputeOf(adjust)!.createdAt)}`}>
                  <p className="whitespace-pre-line">{disputeOf(adjust)!.description || disputeOf(adjust)!.subject}</p>
                </Callout>
              )}
              <InspectionReport inspection={insp} inspectorName={userName(db, insp.inspectorId)} contract={adjust} handoverByName={userName(db, adjust.moveOut?.handover?.by)} />
              <Callout tone="gray" icon={<Info />}>
                Trừ vào nợ còn lại ({vnd(adjust.balance.outstanding)}) trước, trả thừa thì hoàn chuyển khoản. Hạn mức {vnd(myLimit)} tính trên tổng đã xoá nợ / điều chỉnh của hợp đồng.
              </Callout>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_1fr]">
                <Field label="Giảm chi phí hư hại (VND)">
                  <input type="number" min={0} max={adjustMax(adjust)} step={10_000} className={inputCls} value={adjustForm.amount}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, amount: Math.max(0, Math.min(adjustMax(adjust), Number(e.target.value) || 0)) }))} />
                </Field>
                <Field label="Lý do" tip="Khách đọc được.">
                  <textarea className={inputCls} rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
                </Field>
              </div>
            </div>
          ) : null;
        })()}
      </Modal>

      <Modal open={!!payout} onClose={() => setPayout(null)} title="Xác nhận đã chuyển khoản hoàn" description={payout ? `${userName(db, payout.customerId)} · ${vnd(payout.amount)} · ${PAYMENT_TYPE[payout.type].label}` : ''}
        footer={<Button disabled={payoutForm.reference.trim().length < 3 || (!!payout && !payoutAccountOf(payout) && payoutForm.toAccount.trim().length < 6)}
          onClick={() => payout && void run('confirmPayout', { paymentId: payout._id, reference: payoutForm.reference.trim(), toAccount: payoutForm.toAccount.trim() }, 'Đã ghi nhận chuyển khoản hoàn', () => setPayout(null))
            .then((r) => setPayoutError(!r.ok && r.code === 'SAME_APPROVER' && payout.gatewayRefund ? r.error : ''))}>Xác nhận</Button>}>
        {payout && (
          <div className="grid gap-4 text-sm">
            {payoutError && <Callout tone="red" icon={<ShieldAlert />} title="Cần người khác xác nhận">{payoutError}</Callout>}
            <Callout tone="amber" icon={<TriangleAlert />}>Chỉ xác nhận SAU KHI đã chuyển tiền thật.</Callout>
            <FactGrid>
              <Fact icon={<Banknote className="size-4" />} label="Số tiền" tone="violet">{vnd(payout.amount)}</Fact>
              <Fact icon={<CreditCard className="size-4" />} label="Tài khoản nhận" tone={payoutAccountOf(payout) ? 'gray' : 'amber'}>
                {payoutAccountOf(payout) ? `${payoutAccountOf(payout)!.bankName} · ${payoutAccountOf(payout)!.accountNumber}` : 'Khách chưa khai'}
              </Fact>
            </FactGrid>
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
            <FactGrid>
              <Fact icon={<Banknote className="size-4" />} label="Dư nợ" tone="red">{vnd(notify.balance.outstanding)}</Fact>
              <Fact icon={<CalendarClock className="size-4" />} label="Hạn chót thanh toán / liên hệ" tone="amber">Hết ngày {fmtDate(addDays(T, abandonDaysOf(signedPolicy(notify)) - 1))}</Fact>
            </FactGrid>
            <Callout tone="amber" icon={<Megaphone />}>
              Khách nhận email và thấy trong tài khoản: dư nợ <b>{vnd(notify.balance.outstanding)}</b>, hạn chót thanh toán hoặc liên hệ là hết ngày <b>{fmtDate(addDays(T, abandonDaysOf(signedPolicy(notify)) - 1))}</b>.
              Từ <b>{fmtDate(addDays(T, abandonDaysOf(signedPolicy(notify))))}</b> chi nhánh được xử lý đồ bỏ lại (Điều 7). Mỗi đợt nợ chỉ gửi một lần.
            </Callout>
            <Field label="Ghi chú (tuỳ chọn)" tip="Khách đọc được.">
              <textarea className={inputCls} rows={2} maxLength={500} value={notifyNote} onChange={(e) => setNotifyNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!delivery} onClose={() => setDelivery(null)} title="Ghi nhận đã báo khách"
        description={delivery ? `${userName(db, delivery.customerId)} · kho ${unitLabel(db, delivery.unitId)} · thông báo cuối ${fmtDate(delivery.delinquency?.finalNoticeAt)}` : ''}
        footer={<Button disabled={!delivery || deliveryForm.note.trim().length < 5}
          onClick={() => delivery && void run('recordFinalNoticeDelivery', { contractId: delivery._id, channel: deliveryForm.channel, note: deliveryForm.note, at: deliveryForm.at && deliveryForm.at !== T.slice(0, 10) ? `${deliveryForm.at}T00:00:00.000Z` : undefined },
            'Đã ghi nhận đã báo khách', (v) => { setDeliveryDone({ deadline: v.deadline, changed: v.deadlineChanged, who: userName(db, delivery.customerId) }); setDelivery(null); })}>Ghi nhận</Button>}>
        <div className="space-y-4">
          <Callout tone="blue" icon={<PhoneCall />} title="Email thông báo cuối chưa tới khách — ghi nhận đã báo bằng kênh khác.">
            {delivery && (() => {
              // Cùng quy tắc với server: max(hạn cũ, hôm nay + số ngày chờ theo chính sách đã ký), tính từ NGÀY GHI NHẬN — ngày báo khai bên dưới không làm đổi hạn.
              const fresh = addDays(T, abandonDaysOf(signedPolicy(delivery))).slice(0, 10);
              const old = finalDeadline(delivery);
              const next = old && old > fresh ? old : fresh;
              return <>Hạn xử lý đồ sẽ tính lại từ hôm nay, đủ {abandonDaysOf(signedPolicy(delivery))} ngày chờ: chi nhánh được xử lý đồ từ ngày <b>{fmtDate(next)}</b> (không sớm hơn hạn cũ). Báo khách ngày này.</>;
            })()}
          </Callout>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kênh">
              <select className={inputCls} value={deliveryForm.channel} onChange={(e) => setDeliveryForm((f) => ({ ...f, channel: e.target.value as ManualDeliveryChannel }))}>
                {(Object.keys(MANUAL_DELIVERY_CHANNEL) as ManualDeliveryChannel[]).map((k) => <option key={k} value={k}>{MANUAL_DELIVERY_CHANNEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Ngày báo" tip="Chỉ để lưu thông tin — hạn tính từ ngày ghi nhận.">
              <input type="date" className={inputCls} max={T.slice(0, 10)} value={deliveryForm.at} onChange={(e) => setDeliveryForm((f) => ({ ...f, at: e.target.value }))} />
            </Field>
            <Field label="Ghi chú" className="sm:col-span-2">
              <textarea className={inputCls} rows={2} maxLength={500} value={deliveryForm.note} onChange={(e) => setDeliveryForm((f) => ({ ...f, note: e.target.value }))} placeholder="VD: gọi 0901…, khách xác nhận đã nghe nội dung" />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal open={!!deliveryDone} onClose={() => setDeliveryDone(null)} title="Đã ghi nhận đã báo khách" description={deliveryDone?.who}
        footer={<Button onClick={() => setDeliveryDone(null)}>Đã hiểu</Button>}>
        {deliveryDone && (
          <Callout tone={deliveryDone.changed ? 'amber' : 'blue'} icon={<CalendarClock />} title={`Hạn xử lý đồ ${deliveryDone.changed ? 'mới' : 'giữ nguyên'}: ${fmtDate(deliveryDone.deadline)}`}>
            Từ ngày <b>{fmtDate(deliveryDone.deadline)}</b> chi nhánh được xử lý đồ bỏ lại. Báo khách: hạn chót thanh toán hoặc liên hệ là hết ngày <b>{fmtDate(addDays(deliveryDone.deadline, -1))}</b>. Hạn này cũng hiện trong tài khoản của khách.
          </Callout>
        )}
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
