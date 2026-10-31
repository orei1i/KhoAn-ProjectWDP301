'use client';

import { useState } from 'react';
import {
  ArrowRight, BadgePercent, Banknote, Building2, CalendarClock, CalendarDays, CalendarX, Check, ClipboardCheck, CreditCard, FileText, Hammer, HandCoins, Hourglass, Info,
  Landmark, ListChecks, MessageSquareText, MessageSquareWarning, Package, PackageX, RotateCcw, Scale, ShieldAlert, ShieldCheck, Timer, TriangleAlert, Undo2, UserRound, Warehouse, X,
  type LucideIcon,
} from 'lucide-react';
import { abandonDaysOf, CLAIM_FM_APPROVAL_LIMIT, LEFTOVER_FEE_MAX, claimCapOf, inspectionDisputeDeadline, isClosedContract, OPEN_CONTRACT_STATUSES, type DamageClaim, type PaymentTransaction, type RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE, PAYMENT_TYPE, type Tone } from '@/shared/lib/labels';
import { byId, claimOpsOnly, effectivePolicy, facilityName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, Table, inputCls } from '@/shared/ui';
import { InspectionReport } from '@/features/contracts/inspection-report';
import { AbandonDialog, abandonFrom, noticeDelivered } from '@/features/contracts/abandon-dialog';
import { PhotoLinks } from '@/shared/ui/photo-links';
import { ClaimItemTag, SealedPackagesWarning } from '@/features/claims/claim-items-editor';
import { Callout, Chip, ChipRow, Fact, FactGrid, Meta, PanelHeader, PillFilter, QueueRow, UnitTag } from '@/features/staff-ui';
import { Section, TextBlock } from '@/features/backoffice-ui';
import { GatewayRefundQueue, gatewayRefundsToResolve } from '@/features/payments/gateway-refund-queue';

type Tab = 'claims' | 'rejected' | 'settle' | 'fees' | 'abandon' | 'leftover' | 'payouts' | 'gatewayRefunds';

/**
 * Việc cần cấp trên của cả chuỗi: duyệt hồ sơ bồi thường vượt hạn mức quản lý chi nhánh; điều chỉnh biên bản trả kho / xoá nợ sau
 * quyết toán vượt hạn mức miễn giảm của chi nhánh; xác nhận đã chuyển khoản các khoản hoàn / bồi thường / trả lại sau thanh lý.
 * Người đã duyệt một hồ sơ bồi thường không được tự xác nhận khoản chi của chính hồ sơ đó.
 */
export default function OpsApprovals() {
  const { db, user, run, paymentMode } = useStore();
  const [tab, setTab] = useState<Tab>('claims');
  const [view, setView] = useState<DamageClaim | null>(null);
  const [decision, setDecision] = useState({ amount: 0, note: '' });
  const [payout, setPayout] = useState<PaymentTransaction | null>(null);
  const [payoutForm, setPayoutForm] = useState({ reference: '', toAccount: '' });
  // Đợt VNPAY: 403 SAME_APPROVER của khoản hoàn cổng vừa chuyển sang chuyển khoản — giữ câu báo trong hộp, không chỉ toast.
  const [payoutError, setPayoutError] = useState('');
  const [adjust, setAdjust] = useState<RentalContract | null>(null);
  const [adjustForm, setAdjustForm] = useState({ amount: 0, reason: '' });
  const [writeOff, setWriteOff] = useState<RentalContract | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [waive, setWaive] = useState<RentalContract | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [abandon, setAbandon] = useState<RentalContract | null>(null);
  const [dispose, setDispose] = useState<RentalContract | null>(null);
  const [disposeForm, setDisposeForm] = useState({ fee: 0, note: '' });
  // Đợt 17 (C1): mở lại / duyệt mà số lượng vượt số còn đòi được (422 CLAIM_OVER_DECLARED) — giữ câu báo ngay trong hồ sơ, không chỉ toast.
  const [overDeclared, setOverDeclared] = useState<{ claimId: string; message: string } | null>(null);

  const capOf = (x: DamageClaim) => x.review?.liabilityCap ?? claimCapOf(byId(db.contracts, x.contractId), db.unitTypes, x.incidentAt) ?? 0;
  const maxApprove = (x: DamageClaim) => Math.min(x.claimedAmount, capOf(x));
  // Vượt hạn mức chi nhánh: cùng quy tắc với BE / trang quản lý — giá trị xét của cả sự vụ (tối đa bằng mức trách nhiệm).
  const overLimit = (x: DamageClaim) => claimOpsOnly(db, x);
  const claims = db.claims.filter((x) => x.status === 'UNDER_REVIEW')
    .sort((a, b) => Number(overLimit(b)) - Number(overLimit(a)) || a.createdAt.localeCompare(b.createdAt));
  // Hồ sơ đã từ chối trong 90 ngày gần đây — mở lại xem xét khi khách khiếu nại lại (vận hành mở được mọi hồ sơ).
  const rejected = db.claims.filter((x) => x.status === 'REJECTED' && (x.review?.reviewedAt ?? x.createdAt) >= addDays(todayISO(), -90))
    .sort((a, b) => (b.review?.reviewedAt ?? b.createdAt).localeCompare(a.review?.reviewedAt ?? a.createdAt));
  // Điều khoản hứa hoàn trong 7 ngày làm việc: khoản chờ chuyển quá 7 ngày gắn nhãn "Quá hạn" và lên đầu.
  const payoutLate = (p: PaymentTransaction) => p.createdAt < addDays(todayISO(), -7);
  const payouts = db.payments.filter((p) => p.direction === 'REFUND' && p.method === 'BANK_TRANSFER' && p.status === 'PENDING')
    .sort((a, b) => Number(payoutLate(b)) - Number(payoutLate(a)) || a.createdAt.localeCompare(b.createdAt));
  const gatewayRefunds = gatewayRefundsToResolve(db.payments);
  const claimOf = (p: PaymentTransaction) => db.claims.find((x) => x.settlement?.paymentId === p._id);
  /** Đợt VNPAY: người bấm "Chuyển sang chuyển khoản" không tự xác nhận đã chuyển. */
  const movedByMe = (p: PaymentTransaction) => !!user && p.gatewayRefund?.resolvedBy === user._id;
  // Theo đúng BE (confirmPayout): chi bồi thường chỉ chặn người DUYỆT hồ sơ; khoản chi khác chặn người lập lệnh; khoản hoàn do điều
  // chỉnh biên bản chặn người điều chỉnh — những trường hợp đó người khác xác nhận đã chuyển.
  const selfApproved = (p: PaymentTransaction) => !!user && (p.type === 'COMPENSATION'
    ? claimOf(p)?.review?.reviewedBy === user._id
    : p.createdBy === user._id || movedByMe(p)
      || (p.type === 'REFUND' && db.inspections.some((i) => (i.adjustments ?? []).some((a) => a.refundPaymentId === p._id && a.by === user._id))));
  const accountOf = (p: PaymentTransaction) => db.users.find((u) => u._id === p.customerId)?.customerProfile?.payoutAccount;
  const c = view ? db.claims.find((x) => x._id === view._id) ?? null : null;
  const reopenClaim = async (x: DamageClaim, onOk?: () => void) => {
    const res = await run('reviewClaim', { claimId: x._id }, 'Đã mở lại — hồ sơ chuyển sang xác minh', onOk);
    if (!res.ok && res.code === 'CLAIM_OVER_DECLARED') { setOverDeclared({ claimId: x._id, message: res.error }); setView(x); } else setOverDeclared(null);
  };
  const approveClaim = async (x: DamageClaim) => {
    const res = await run('decideClaim', { claimId: x._id, approve: true, approvedAmount: decision.amount, note: decision.note }, `Đã duyệt ${vnd(decision.amount)} — chi nhánh chi tiền`, () => setView(null));
    setOverDeclared(!res.ok && res.code === 'CLAIM_OVER_DECLARED' ? { claimId: x._id, message: res.error } : null);
  };

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
  // Đồ khách để lại sau trả kho đã hết hạn giữ — phí xử lý trên ngưỡng duyệt của chi nhánh chỉ Vận hành lập (chi nhánh bị chặn DISPOSAL_LIMIT).
  const leftoverDue = (x: RentalContract) => !!x.leftover && T.slice(0, 10) >= x.leftover.holdUntil.slice(0, 10);
  const leftovers = db.contracts.filter((x) => x.leftover?.status === 'HELD' && leftoverDue(x))
    .sort((a, b) => a.leftover!.holdUntil.localeCompare(b.leftover!.holdUntil));

  // ---- Chỉ để trình bày (không đổi dữ liệu / luồng): mỗi nhóm việc một icon, màu và giải thích ngắn cho bộ lọc + đầu thẻ.
  const SECTIONS: Record<Tab, { label: string; Icon: LucideIcon; tone: Tone; count: number; tip: string }> = {
    claims: { label: 'Bồi thường chờ duyệt', Icon: HandCoins, tone: 'violet', count: claims.length, tip: `Hồ sơ đang xác minh. Sự vụ vượt hạn mức chi nhánh (${vnd(CLAIM_FM_APPROVAL_LIMIT)}) lên đầu — chỉ Vận hành duyệt.` },
    rejected: { label: 'Bồi thường đã từ chối', Icon: RotateCcw, tone: 'gray', count: rejected.length, tip: 'Hồ sơ bị từ chối trong 90 ngày gần đây — mở lại xem xét khi khách khiếu nại lại.' },
    settle: { label: 'Biên bản & nợ sau quyết toán', Icon: ClipboardCheck, tone: 'amber', count: settle.length, tip: 'Điều chỉnh biên bản trả kho (khách khiếu nại trong hạn) và xoá nợ sau quyết toán vượt hạn mức chi nhánh. Hợp đồng đang có khiếu nại lên đầu.' },
    fees: { label: 'Miễn phí trễ', Icon: BadgePercent, tone: 'amber', count: fees.length, tip: 'Phí trễ hạn của hợp đồng đang mở trong toàn chuỗi — phần vượt hạn mức miễn giảm của quản lý chi nhánh lên đầu.' },
    abandon: { label: 'Đồ bỏ lại', Icon: PackageX, tone: 'red', count: abandonable.length, tip: 'Thông báo cuối đã tới khách và đã quá hạn chót — đủ điều kiện xử lý đồ bỏ lại.' },
    leftover: { label: 'Đồ để lại quá hạn giữ', Icon: Package, tone: 'amber', count: leftovers.length, tip: `Đồ khách để lại sau trả kho đã hết hạn giữ. Chi nhánh tự xử lý khi phí không quá ${vnd(CLAIM_FM_APPROVAL_LIMIT)}; phí cao hơn do Vận hành xử lý tại đây.` },
    payouts: { label: 'Chờ chuyển khoản', Icon: Landmark, tone: 'blue', count: payouts.length, tip: 'Khoản hoàn / bồi thường / trả lại chờ chuyển khoản. Quá 7 ngày gắn nhãn “Quá hạn” và lên đầu.' },
    gatewayRefunds: { label: 'Hoàn qua VNPAY cần xử lý', Icon: Undo2, tone: 'red', count: gatewayRefunds.length, tip: 'Khoản hoàn qua VNPAY bị từ chối hoặc chưa rõ kết quả. Hệ thống không tự gửi lại khoản chưa rõ kết quả, tránh hoàn hai lần.' },
  };
  const sec = SECTIONS[tab];
  const arrow = <ArrowRight className="size-4 text-stone-300" aria-hidden />;

  return (
    <>
      <PageHeader title="Duyệt & chi"
        description={(
          <span className="mt-1 flex flex-wrap gap-1.5">
            <Chip icon={<HandCoins />} tone="violet">Bồi thường trên {vnd(CLAIM_FM_APPROVAL_LIMIT)}</Chip>
            <Chip icon={<ClipboardCheck />} tone="amber">Điều chỉnh / xoá nợ vượt hạn mức chi nhánh</Chip>
            <Chip icon={<Landmark />} tone="blue">Xác nhận chuyển khoản</Chip>
          </span>
        )} />

      <PillFilter value={tab} onChange={setTab} options={(Object.keys(SECTIONS) as Tab[]).filter((k) => k !== 'gatewayRefunds' || paymentMode === 'VNPAY' || gatewayRefunds.length > 0).map((k) => {
        const S = SECTIONS[k];
        return { key: k, label: S.label, icon: <S.Icon />, count: S.count };
      })} />

      <Card className="mt-4">
        <PanelHeader icon={<sec.Icon className="size-4" />} tone={sec.tone} title={sec.label} count={sec.count} tip={sec.tip} />
        {tab === 'claims' ? (
          claims.length === 0 ? <EmptyState icon={<HandCoins className="size-6" />} title="Không có hồ sơ nào đang xác minh" /> : (
            <ul className="divide-y divide-stone-100">
              {claims.map((x) => (
                <QueueRow key={x._id} onSelect={() => { setDecision({ amount: maxApprove(x), note: '' }); setView(x); }}
                  lead={<IconTile icon={x.type === 'LOSS' ? <PackageX className="size-4" /> : <Hammer className="size-4" />} tone={x.type === 'LOSS' ? 'red' : 'amber'} />}
                  title={userName(db, x.customerId)}
                  badges={overLimit(x) ? <Badge tone="amber" dot>Vượt hạn mức chi nhánh</Badge> : <Badge>Chi nhánh tự duyệt được</Badge>}
                  meta={<>
                    <Meta mono>{x.claimNumber}</Meta>
                    <Meta icon={<Building2 />}>{facilityName(db, x.facilityId)}</Meta>
                    <Meta icon={<Warehouse />}>Kho {unitLabel(db, x.unitId)} · {CLAIM_TYPE[x.type]}</Meta>
                    <Meta icon={<HandCoins />}>Yêu cầu <b className="font-semibold text-stone-700">{vnd(x.claimedAmount)}</b></Meta>
                    <Meta icon={<Scale />}>Trách nhiệm {vnd(capOf(x))}</Meta>
                  </>}
                  actions={arrow}
                />
              ))}
            </ul>
          )
        ) : tab === 'rejected' ? (
          rejected.length === 0 ? <EmptyState icon={<HandCoins className="size-6" />} title="Không có hồ sơ bị từ chối trong 90 ngày" /> : (
            <ul className="divide-y divide-stone-100">
              {rejected.map((x) => (
                <QueueRow key={x._id} onSelect={() => setView(x)}
                  lead={<IconTile icon={<X className="size-4" />} tone="gray" />}
                  title={userName(db, x.customerId)}
                  badges={<Badge tone="red" dot>Từ chối {fmtDate(x.review?.reviewedAt)}</Badge>}
                  meta={<>
                    <Meta mono>{x.claimNumber}</Meta>
                    <Meta icon={<Building2 />}>{facilityName(db, x.facilityId)}</Meta>
                    <Meta icon={<Warehouse />}>Kho {unitLabel(db, x.unitId)} · {CLAIM_TYPE[x.type]}</Meta>
                    <Meta icon={<HandCoins />}>Yêu cầu {vnd(x.claimedAmount)}</Meta>
                    <Meta icon={<UserRound />}>{x.review ? userName(db, x.review.reviewedBy) : '—'}</Meta>
                  </>}
                  actions={<Button size="sm" variant="secondary" onClick={() => void reopenClaim(x)}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>}
                />
              ))}
            </ul>
          )
        ) : tab === 'fees' ? (
          fees.length === 0 ? <EmptyState icon={<BadgePercent className="size-6" />} title="Không có hợp đồng nào đang chịu phí trễ" /> : (
            <ul className="divide-y divide-stone-100">
              {fees.map((x) => (
                <QueueRow key={x._id}
                  lead={<UnitTag label={unitLabel(db, x.unitId)} tone={lateFee(x) > fmLimit(x.facilityId) ? 'amber' : 'ink'} />}
                  title={userName(db, x.customerId)}
                  badges={lateFee(x) > fmLimit(x.facilityId) ? <Badge tone="amber" dot>Vượt hạn mức chi nhánh</Badge> : null}
                  meta={<>
                    <Meta icon={<Building2 />}>{facilityName(db, x.facilityId)}</Meta>
                    <Meta mono>{x.contractNumber}</Meta>
                    <Meta icon={<Hourglass />}>Quá hạn {x.delinquency?.daysOverdue ?? 0} ngày</Meta>
                    <Meta icon={<Banknote />}>Dư nợ {vnd(x.balance.outstanding)}</Meta>
                  </>}
                  actions={<>
                    <Chip icon={<BadgePercent />} tone="amber">Phí trễ {vnd(lateFee(x))}</Chip>
                    <Button size="sm" variant="secondary" onClick={() => { setWaiveReason(''); setWaive(x); }}><BadgePercent className="size-3.5" />Miễn phí trễ</Button>
                  </>}
                />
              ))}
            </ul>
          )
        ) : tab === 'abandon' ? (
          abandonable.length === 0 ? <EmptyState icon={<PackageX className="size-6" />} title="Không có hợp đồng nào chờ xử lý đồ bỏ lại" /> : (
            <ul className="divide-y divide-stone-100">
              {abandonable.map((x) => (
                <QueueRow key={x._id}
                  lead={<UnitTag label={unitLabel(db, x.unitId)} tone="red" />}
                  title={userName(db, x.customerId)}
                  meta={<>
                    <Meta icon={<Building2 />}>{facilityName(db, x.facilityId)}</Meta>
                    <Meta mono>{x.contractNumber}</Meta>
                    <Meta icon={<CalendarClock />}>Xử lý từ {fmtDate(abandonFrom(x, abandonDays(x)))}</Meta>
                    <Meta icon={<Banknote />} className={x.balance.outstanding > 0 ? 'font-medium text-red-700' : undefined}>Dư nợ {vnd(x.balance.outstanding)}</Meta>
                  </>}
                  actions={<Button size="sm" variant="danger" onClick={() => setAbandon(x)}><PackageX className="size-3.5" />Xử lý hàng bỏ lại</Button>}
                />
              ))}
            </ul>
          )
        ) : tab === 'leftover' ? (
          leftovers.length === 0 ? <EmptyState icon={<Package className="size-6" />} title="Không có đồ để lại nào quá hạn giữ" /> : (
            <ul className="divide-y divide-stone-100">
              {leftovers.map((x) => (
                <QueueRow key={x._id}
                  lead={<UnitTag label={unitLabel(db, x.unitId)} tone="amber" />}
                  title={userName(db, x.customerId)}
                  badges={<Badge tone="red" dot>Hết hạn giữ {fmtDate(x.leftover!.holdUntil)}</Badge>}
                  meta={<>
                    <Meta icon={<Building2 />}>{facilityName(db, x.facilityId)}</Meta>
                    <Meta mono>{x.contractNumber}</Meta>
                    <Meta icon={<Package />}>{x.leftover!.description}</Meta>
                    <PhotoLinks urls={x.leftover!.photoUrls} />
                  </>}
                  actions={<>
                    <Button size="sm" variant="secondary" onClick={() => { if (window.confirm(`Khách ${userName(db, x.customerId)} đã lấy hết đồ để lại ở kho ${unitLabel(db, x.unitId)}?`)) void run('resolveLeftover', { contractId: x._id, outcome: 'PICKED_UP' }, (v) => (v.accessResetPending ? `Đã ghi nhận khách lấy đồ — còn việc: ${v.accessResetTask}, chi nhánh ghi nhận ở trang Kho` : 'Đã ghi nhận khách lấy đồ — ô kho trống lại')); }}><Package className="size-3.5" />Khách đã lấy</Button>
                    <Button size="sm" variant="danger" onClick={() => { setDisposeForm({ fee: 0, note: '' }); setDispose(x); }}>Xử lý</Button>
                  </>}
                />
              ))}
            </ul>
          )
        ) : tab === 'settle' ? (
          settle.length === 0 ? <EmptyState icon={<ClipboardCheck className="size-6" />} title="Không có hợp đồng nào cần điều chỉnh biên bản hay xoá nợ" /> : (
            <ul className="divide-y divide-stone-100">
              {settle.map((x) => (
                <QueueRow key={x._id}
                  lead={<IconTile icon={<ClipboardCheck className="size-4" />} tone={disputeOf(x) ? 'amber' : 'gray'} />}
                  title={userName(db, x.customerId)}
                  badges={disputeOf(x) ? <Badge tone="amber" dot>Khách đang khiếu nại</Badge> : null}
                  meta={<>
                    <Meta icon={<Building2 />}>{facilityName(db, x.facilityId)}</Meta>
                    <Meta mono>{x.contractNumber}</Meta>
                    <Meta icon={<CalendarDays />}>Đóng {fmtDate(x.closedAt)}</Meta>
                    {x.status === 'CLOSED' && damageRoom(x) > 0 && <Meta icon={<Hammer />}>Hư hại còn điều chỉnh {vnd(damageRoom(x))}</Meta>}
                    <Meta icon={<Banknote />} className={x.balance.outstanding > 0 ? 'font-medium text-red-700' : undefined}>Nợ còn lại {vnd(x.balance.outstanding)}</Meta>
                  </>}
                  actions={<>
                    {x.status === 'CLOSED' && damageRoom(x) > 0 && (disputeOf(x)
                      ? <Button size="sm" variant="secondary" onClick={() => { setAdjustForm({ amount: 0, reason: '' }); setAdjust(x); }}>Điều chỉnh biên bản</Button>
                      : <span className="text-xs text-stone-500">Chưa có khiếu nại trong hạn</span>)}
                    {x.balance.outstanding > 0 && <Button size="sm" variant="ghost" onClick={() => { setWriteOffReason(''); setWriteOff(x); }}>Xoá nợ</Button>}
                  </>}
                />
              ))}
            </ul>
          )
        ) : tab === 'gatewayRefunds' ? (
          <GatewayRefundQueue rows={gatewayRefunds} showFacility />
        ) : (
          payouts.length === 0 ? <EmptyState icon={<Landmark className="size-6" />} title="Không có khoản nào chờ chuyển" /> : (
            <ul className="divide-y divide-stone-100">
              {payouts.map((p) => {
                const acc = accountOf(p);
                return (
                  <QueueRow key={p._id}
                    lead={<IconTile icon={<Landmark className="size-4" />} tone={payoutLate(p) ? 'red' : 'blue'} />}
                    title={userName(db, p.customerId)}
                    badges={<>
                      <Badge tone={PAYMENT_TYPE[p.type].tone}>{PAYMENT_TYPE[p.type].label}</Badge>
                      <span className="text-sm font-semibold tabular-nums text-ink">{vnd(p.amount)}</span>
                      {payoutLate(p) && <Badge tone="red" dot>Quá hạn</Badge>}
                    </>}
                    meta={<>
                      <Meta icon={<Building2 />}>{facilityName(db, p.facilityId)}</Meta>
                      <Meta icon={<CalendarDays />}>{fmtDate(p.createdAt)}</Meta>
                      {acc
                        ? <Meta icon={<CreditCard />}>{acc.bankName} · <span className="font-mono">{acc.accountNumber}</span> · {acc.accountName}</Meta>
                        : <Meta icon={<TriangleAlert />} className="font-medium text-amber-700">Khách chưa khai — liên hệ khách</Meta>}
                    </>}
                    actions={selfApproved(p)
                      ? <span className="text-xs text-stone-500">{movedByMe(p) ? 'Bạn đã chuyển khoản hoàn này sang chuyển khoản — người khác xác nhận' : 'Bạn lập / duyệt khoản này — người khác xác nhận'}</span>
                      : <Button size="sm" onClick={() => { setPayout(p); setPayoutForm({ reference: '', toAccount: '' }); setPayoutError(''); }}><Banknote className="size-3.5" />Xác nhận đã chuyển</Button>}
                  />
                );
              })}
            </ul>
          )
        )}
      </Card>

      <Modal open={!!c} onClose={() => setView(null)} size="lg" title={`Hồ sơ ${c?.claimNumber ?? ''}`}
        description={c ? `${userName(db, c.customerId)} · ${facilityName(db, c.facilityId)} · kho ${unitLabel(db, c.unitId)}` : ''}>
        {c && (
          <div className="space-y-5">
            <ChipRow>
              <StatusBadge map={CLAIM_STATUS} value={c.status} />
              <Chip icon={<Building2 />}>{facilityName(db, c.facilityId)}</Chip>
              <Chip icon={<Warehouse />}>Kho {unitLabel(db, c.unitId)}</Chip>
              <Chip icon={c.type === 'LOSS' ? <PackageX /> : <Hammer />} tone={c.type === 'LOSS' ? 'red' : 'amber'}>{CLAIM_TYPE[c.type]}</Chip>
              {c.status === 'UNDER_REVIEW' && overLimit(c) && <Chip icon={<ShieldAlert />} tone="amber">Vượt hạn mức chi nhánh</Chip>}
            </ChipRow>
            <FactGrid>
              <Fact icon={<CalendarX className="size-4" />} label="Ngày sự cố">{fmtDate(c.incidentAt)}</Fact>
              <Fact icon={<HandCoins className="size-4" />} label="Khách yêu cầu" tone="amber">{vnd(c.claimedAmount)}</Fact>
              <Fact icon={<Scale className="size-4" />} label="Mức trách nhiệm (Điều 6)" tone="blue">{vnd(capOf(c))}</Fact>
              <Fact icon={<ShieldCheck className="size-4" />} label="Duyệt tối đa" tone="teal">{vnd(maxApprove(c))}</Fact>
            </FactGrid>
            <Section icon={<MessageSquareText />} title="Khách mô tả">
              <TextBlock>{c.description}</TextBlock>
              <PhotoLinks urls={c.photoUrls} />
            </Section>
            <Section icon={<ListChecks />} title="Hạng mục khai báo">
              <SealedPackagesWarning claimId={c._id} />
              {overDeclared?.claimId === c._id && <Callout tone="red" icon={<ShieldAlert />} title="Số lượng vượt số còn đòi được">{overDeclared.message}. Hồ sơ không đổi — xem lại với khách hoặc từ chối.</Callout>}
              <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-stone-200">
                <Table rows={c.items} rowKey={(it) => `${it.name}-${it.quantity}-${it.unitValue}`} columns={[
                  { key: 'n', header: 'Tài sản', cell: (it) => <span className="inline-flex flex-wrap items-center gap-1.5">{it.name}<ClaimItemTag item={it} /></span> },
                  { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
                  { key: 'v', header: 'Thành tiền', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.unitValue) },
                ]} />
              </div>
            </Section>
            {c.status === 'REJECTED' && (
              <Callout tone="red" icon={<X />} title={c.review ? `Lý do từ chối (${fmtDate(c.review.reviewedAt)} · ${userName(db, c.review.reviewedBy)})` : 'Đã từ chối'}
                action={<Button size="sm" variant="secondary" onClick={() => void reopenClaim(c, () => setDecision({ amount: maxApprove(c), note: '' }))}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>}>
                {c.review && <p className="whitespace-pre-line">{c.review.decisionNote}</p>}
              </Callout>
            )}
            {c.status === 'UNDER_REVIEW' && (
              <Section icon={<ClipboardCheck />} title="Quyết định" className="border-t border-stone-100 pt-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_1fr]">
                  <Field label="Số tiền duyệt (VND)" hint={`Tối đa ${vnd(maxApprove(c))}`}>
                    <input type="number" min={0} max={maxApprove(c)} step={10_000} className={inputCls} value={decision.amount}
                      onChange={(e) => setDecision((d) => ({ ...d, amount: Math.max(0, Math.min(maxApprove(c), Number(e.target.value) || 0)) }))} />
                  </Field>
                  <Field label="Căn cứ quyết định" tip="Khách đọc được.">
                    <textarea className={inputCls} rows={3} value={decision.note} onChange={(e) => setDecision((d) => ({ ...d, note: e.target.value }))} />
                  </Field>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="danger" disabled={decision.note.trim().length < 5}
                    onClick={() => run('decideClaim', { claimId: c._id, approve: false, note: decision.note }, 'Đã từ chối hồ sơ', () => setView(null))}>
                    <X className="size-4" />Từ chối
                  </Button>
                  <Button disabled={decision.note.trim().length < 5 || decision.amount <= 0}
                    onClick={() => void approveClaim(c)}>
                    <Check className="size-4" />Duyệt {vnd(decision.amount)}
                  </Button>
                </div>
              </Section>
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
                <Callout tone="amber" icon={<MessageSquareWarning />} title={`Khách khiếu nại · ${fmtDate(ticket.createdAt)}`}>
                  <p className="whitespace-pre-line">{ticket.description || ticket.subject}</p>
                </Callout>
              )}
              <InspectionReport inspection={insp} inspectorName={userName(db, insp.inspectorId)} contract={adjust} handoverByName={userName(db, adjust.moveOut?.handover?.by)} />
              <FactGrid className="lg:grid-cols-3">
                <Fact icon={<Banknote className="size-4" />} label="Nợ còn lại" tone={adjust.balance.outstanding > 0 ? 'red' : 'gray'}>{vnd(adjust.balance.outstanding)}</Fact>
                <Fact icon={<Hammer className="size-4" />} label="Còn điều chỉnh được" tone="amber">{vnd(damageRoom(adjust))}</Fact>
                <Fact icon={<ShieldCheck className="size-4" />} label="Hạn mức của bạn" tone="teal">{vnd(myLimit(adjust.facilityId))}</Fact>
              </FactGrid>
              <Callout tone="gray" icon={<Info />}>
                Trừ vào nợ còn lại trước, trả thừa thì hoàn chuyển khoản. Hạn mức tính trên tổng đã xoá nợ / điều chỉnh của hợp đồng.
              </Callout>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_1fr]">
                <Field label="Giảm chi phí hư hại (VND)" hint={`Tối đa ${vnd(adjustMax(adjust))}`}>
                  <input type="number" min={0} max={adjustMax(adjust)} step={10_000} className={inputCls} value={adjustForm.amount}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, amount: Math.max(0, Math.min(adjustMax(adjust), Number(e.target.value) || 0)) }))} />
                </Field>
                <Field label="Lý do" tip="Khách đọc được.">
                  <textarea className={inputCls} rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
                </Field>
              </div>
            </div>
          ) : <EmptyState compact icon={<FileText className="size-5" />} title="Không tìm thấy biên bản trả kho của hợp đồng này." />;
        })()}
      </Modal>

      <Modal open={!!writeOff} onClose={() => setWriteOff(null)} title="Xoá nợ sau quyết toán"
        description={writeOff ? `${userName(db, writeOff.customerId)} · ${facilityName(db, writeOff.facilityId)} · ${writeOff.contractNumber}` : ''}
        footer={<Button variant="danger" disabled={!writeOff || writeOffReason.trim().length < 5 || writeOff.balance.outstanding > myLimit(writeOff.facilityId)}
          onClick={() => writeOff && void run('writeOffDebt', { contractId: writeOff._id, reason: writeOffReason.trim() }, (v) => `Đã xoá nợ ${vnd(v)}`, () => setWriteOff(null))}>Xoá nợ {writeOff ? vnd(writeOff.balance.outstanding) : ''}</Button>}>
        {writeOff && (
          <div className="space-y-4">
            <FactGrid>
              <Fact icon={<Banknote className="size-4" />} label="Khách không phải trả" tone="red">{vnd(writeOff.balance.outstanding)}</Fact>
              <Fact icon={<ShieldCheck className="size-4" />} label="Hạn mức của bạn" tone="teal">{vnd(myLimit(writeOff.facilityId))}</Fact>
            </FactGrid>
            {writeOff.balance.outstanding > myLimit(writeOff.facilityId) && <Callout tone="red" icon={<ShieldAlert />}>Khoản nợ vượt hạn mức của bạn — không xoá được.</Callout>}
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
          <div className="space-y-4">
            <FactGrid>
              <Fact icon={<BadgePercent className="size-4" />} label="Phí trễ đang tính" tone="amber">{vnd(lateFee(waive))}</Fact>
              <Fact icon={<ShieldCheck className="size-4" />} label="Hạn mức miễn giảm của bạn" tone="teal">{vnd(myLimit(waive.facilityId))}</Fact>
            </FactGrid>
            {lateFee(waive) > myLimit(waive.facilityId) && <Callout tone="red" icon={<ShieldAlert />}>Vượt hạn mức miễn giảm của bạn ({vnd(myLimit(waive.facilityId))}).</Callout>}
            <Field label="Lý do" hint="Tối thiểu 5 ký tự — ghi vào nhật ký kiểm toán.">
              <textarea className={inputCls} rows={2} value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <AbandonDialog contract={abandon} onClose={() => setAbandon(null)} />

      <Modal open={!!dispose} onClose={() => setDispose(null)} title="Xử lý đồ khách để lại"
        description={dispose ? `${userName(db, dispose.customerId)} · ${facilityName(db, dispose.facilityId)} · kho ${unitLabel(db, dispose.unitId)} · giữ đến ${fmtDate(dispose.leftover?.holdUntil)}` : ''}
        footer={<Button variant="danger" disabled={disposeForm.note.trim().length < 3 || disposeForm.fee > LEFTOVER_FEE_MAX}
          onClick={() => dispose && void run('resolveLeftover', { contractId: dispose._id, outcome: 'DISPOSED', fee: disposeForm.fee, note: disposeForm.note.trim() },
            disposeForm.fee > 0 ? `Đã xử lý — ghi phí ${vnd(disposeForm.fee)} vào công nợ khách` : 'Đã xử lý đồ để lại — ô kho trống lại', () => setDispose(null))}>Xác nhận</Button>}>
        <div className="space-y-4">
          {dispose?.leftover && (
            <Callout tone="amber" icon={<Timer />} title={dispose.leftover.description}>
              Hết hạn giữ {fmtDate(dispose.leftover.holdUntil)}.
            </Callout>
          )}
          <Field label="Phí xử lý (VND)" hint={`Điều 9 · 0 nếu không thu · tối đa ${vnd(LEFTOVER_FEE_MAX)}`}>
            <input type="number" min={0} max={LEFTOVER_FEE_MAX} step={10_000} className={inputCls} value={disposeForm.fee}
              onChange={(e) => setDisposeForm((f) => ({ ...f, fee: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
          </Field>
          <Field label="Cách xử lý">
            <textarea className={inputCls} rows={2} maxLength={500} value={disposeForm.note} onChange={(e) => setDisposeForm((f) => ({ ...f, note: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!payout} onClose={() => setPayout(null)} title="Xác nhận đã chuyển khoản"
        description={payout ? `${userName(db, payout.customerId)} · ${vnd(payout.amount)} · ${PAYMENT_TYPE[payout.type].label}` : ''}
        footer={<Button disabled={payoutForm.reference.trim().length < 3 || (!!payout && !accountOf(payout) && payoutForm.toAccount.trim().length < 6)}
          onClick={() => payout && void run('confirmPayout', { paymentId: payout._id, reference: payoutForm.reference.trim(), toAccount: payoutForm.toAccount.trim() }, 'Đã ghi nhận chuyển khoản', () => setPayout(null))
            .then((r) => setPayoutError(!r.ok && r.code === 'SAME_APPROVER' && payout.gatewayRefund ? r.error : ''))}>Xác nhận</Button>}>
        {payout && (
          <div className="space-y-4">
            {payoutError && <Callout tone="red" icon={<ShieldAlert />} title="Cần người khác xác nhận">{payoutError}</Callout>}
            <FactGrid>
              <Fact icon={<Banknote className="size-4" />} label="Số tiền" tone="blue">{vnd(payout.amount)}</Fact>
              <Fact icon={<CreditCard className="size-4" />} label="Tài khoản nhận" tone={accountOf(payout) ? 'gray' : 'amber'}>
                {accountOf(payout) ? `${accountOf(payout)!.bankName} · ${accountOf(payout)!.accountNumber}` : 'Khách chưa khai'}
              </Fact>
            </FactGrid>
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
