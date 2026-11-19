'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Bell, CalendarClock, ClipboardCheck, CreditCard, FileText, HandCoins, KeyRound, LifeBuoy, Lock, Package, PackageOpen, PackagePlus, RefreshCw, Repeat, Search, ShieldCheck, Trash2, TriangleAlert, UserCheck, Wallet, Warehouse } from 'lucide-react';
import { contractPlanOf, protectionPlanLine, swapFeeDue, unitVolumeM3, type PaymentMethod, type PaymentType, type RentalContract, type UnitSwapRequest } from '@ssm/shared';
import { expiryAlert, expiryLockFrom, usesGraceHold } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, CLAIM_STATUS, CONTRACT_STATUS, DEPOSIT_STATUS, PAYMENT_TYPE, SWAP_REQUEST_STATUS, TICKET_STATUS, depositSettlementText, swapRequestNote } from '@/shared/lib/labels';
import { byId, contractIntakeBatches, earlyTerminationPreview, facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { MOVE_OUT_STAGE, moveOutStageOf } from '@ssm/shared';
import { billingDue, billingDueRows, canDeclareIntake, canExtend, canDisputeInspection, contractAppendices, contractClawback, delinquencyAlert, sizeChangeNote, INSPECTION_DISPUTE_DAYS, isClosedContract, handoverDeadline, isValidPhone, lastDayOf, MAX_AUTHORIZED_PERSONS, MAX_MOVE_OUT_LEAD_DAYS, OPEN_CONTRACT_STATUSES, OPEN_SWAP_STATUSES, PERIOD_UNIT, periodLabel } from '@ssm/shared';
import { Badge, Button, ButtonLink, Card, Disclosure, EmptyState, Field, Modal, PageHeader, StatusBadge, cx, inputCls } from '@/shared/ui';
import { CATEGORY_ICON } from '@/features/facilities/visuals';
import { TermProgress } from '@/features/contracts/term-progress';
import { MockGateway, type GatewayOrder } from '@/features/payments/mock-gateway';
import { ContractGoodsDialog, goodsSummary } from '@/features/intake/contract-goods';
import { AccessPanel } from '@/features/access/access-panel';
import { AppendixText, ExtensionQuoteSummary, useExtensionQuote } from '@/features/contracts/extension-quote';
import { api } from '@/shared/api/client';
import { newKey } from '@/shared/api/actions';
import { SwapRequestForm } from '@/features/contracts/swap-request-form';
import { OpenSwapExtras, SwapChangeDate, SwapMoveRecord } from '@/features/contracts/swap-extras';
import { ContractFileActions } from '@/features/contracts/contract-file-actions';
import { ContractNotices } from '@/features/contracts/contract-notices';
import { InspectionReport } from '@/features/contracts/inspection-report';
import { HandoverInfo, LeftoverInfo } from '@/features/contracts/move-out-info';
import { canOpenTicket, claimWindow } from '@/features/claims/claim-window';

type Dialog = { kind: 'extend' | 'moveout' | 'swap' | 'authorized' | 'access' | 'appendix' | 'inspection'; c: RentalContract } | null;
const EMPTY_PERSON = { fullName: '', phone: '', idNumberLast4: '', relationship: '' };
const ENDED_SWAP_STATUSES = ['REJECTED', 'EXPIRED', 'CANCELLED'] as const;
const ENDED_SWAP_SHOW_MS = 7 * 86_400_000;

/** Ngày hẹn trả kho xa nhất: 30 ngày tới; hợp đồng có quy tắc hết hạn (Điều khoản 1.24) thì phải trước ngày khoá. */
const moveOutMaxDate = (c: RentalContract) => {
  const far = addDays(todayISO(), MAX_MOVE_OUT_LEAD_DAYS);
  const lockLast = usesGraceHold(c) ? addDays(expiryLockFrom(c), -1) : far;
  return (lockLast < far ? lockLast : far).slice(0, 10);
};
/** Diễn giải khoản nợ sau khi hợp đồng đã đóng — loại khác lấy theo nhãn khoản thanh toán. */
const DEBT_PART: Partial<Record<PaymentType, string>> = {
  SETTLEMENT_DEBT: 'chi phí hư hại và công nợ vượt tiền giữ chân',
  DISPOSAL_FEE: 'phí xử lý đồ để lại',
};

export default function MyUnits() {
  const { db, user, run, busy } = useStore();
  const [dlg, setDlg] = useState<Dialog>(null);
  // Cổng thanh toán (giả lập) cho trả công nợ / gia hạn — mở chồng lên hộp đang mở.
  const [gateway, setGateway] = useState<GatewayOrder | null>(null);
  // Đồ đang gửi / khai đợt nhập hàng (declare: mở thẳng form khai).
  const [goods, setGoods] = useState<{ c: RentalContract; declare: boolean } | null>(null);
  const [periods, setPeriods] = useState(3);
  const ext = useExtensionQuote(dlg?.kind === 'extend' ? dlg.c._id : undefined, periods);
  // Khách phải tick xác nhận Phụ lục gia hạn; đổi số kỳ (phụ lục khác) thì phải xác nhận lại.
  const [agree, setAgree] = useState(false);
  useEffect(() => { setAgree(false); }, [periods, dlg?.kind, dlg?.c._id]);
  const downloadAppendix = async (c: RentalContract, n: number) => {
    const blob = await api.blob(`/contracts/${c._id}/appendices/${n}.pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `phu-luc-${String(n).padStart(2, '0')}-${c.contractNumber}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };
  const [date, setDate] = useState(addDays(todayISO(), 3).slice(0, 10));
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [dispute, setDispute] = useState('');
  if (!user) return null;
  const contracts = db.contracts.filter((c) => c.customerId === user._id)
    .sort((a, b) => (OPEN_CONTRACT_STATUSES.includes(a.status) ? 0 : 1) - (OPEN_CONTRACT_STATUSES.includes(b.status) ? 0 : 1));
  const close = () => setDlg(null);
  /** Biên bản kiểm tra khi trả kho (Điều 9) — khách xem chi tiết và khiếu nại trong hạn. */
  const moveOutInspection = (c: RentalContract) => db.inspections.find((i) => i.contractId === c._id && i.type === 'MOVE_OUT');
  /** Hợp đồng đã đóng còn nợ: nói đúng khoản đang chờ thu (nợ sau quyết toán, phí xử lý đồ để lại…) theo các khoản thanh toán chờ. */
  const closedDebtText = (c: RentalContract) => {
    const types = [...new Set(db.payments.filter((p) => p.contractId === c._id && p.direction === 'CHARGE' && p.status === 'PENDING').map((p) => p.type))];
    const parts = types.map((t) => DEBT_PART[t] ?? PAYMENT_TYPE[t].label.toLowerCase());
    return `Hợp đồng đã đóng nhưng còn ${parts.length ? parts.join(' và ') : 'chi phí hư hại và công nợ vượt tiền giữ chân'}`;
  };
  // Chỉ hợp đồng đang thuê bị khoá / chậm trả mới có truy cập để khôi phục; hợp đồng đã đóng là trả nợ sau quyết toán.
  const paidBalanceText = (c: RentalContract, v: number) => (isClosedContract(c.status) ? `Đã thanh toán ${vnd(v)} — đã thanh toán khoản nợ sau quyết toán`
    // Điều khoản 1.24: hết hạn đã khoá — trả nợ không mở lại quyền ra vào.
    : c.status === 'EXPIRED' || (c.status === 'MOVE_OUT_PENDING' && !!c.expiry?.lockedAt) ? `Đã thanh toán ${vnd(v)} — hợp đồng hết hạn vẫn bị khoá, đến quầy để lấy đồ`
    : c.status === 'LOCKED_OUT' || c.status === 'DELINQUENT' ? `Đã thanh toán ${vnd(v)} — truy cập kho được khôi phục` : `Đã thanh toán ${vnd(v)}`);

  /**
   * Trả toàn bộ công nợ hiện tại của hợp đồng (kể cả nợ sau quyết toán của hợp đồng đã đóng) qua cổng thanh toán. Đợt 15 (B5): gửi đúng số
   * đang hiển thị — số dư vừa đổi (phí trễ, hoá đơn kỳ mới) thì server trả 409 BALANCE_CHANGED: đóng cổng, thẻ hợp đồng hiện số mới để
   * khách bấm lại. Một key cho mỗi lần mở cổng — bấm lại không thu hai lần.
   */
  /** Trả trước phí thuê người chuyển: gửi đúng số đang hiện. Bấm lại khi đã trả không thu thêm (server trả `replayed`). */
  const payFee = (s: UnitSwapRequest) => setGateway({
    facilityId: s.facilityId, code: s.requestNumber, amount: s.fee, purpose: 'Phí thuê người chuyển',
    pay: (m) => run('paySwapFee', { swapRequestId: s._id, method: m, expectedFee: s.fee }, (v) => (v.replayed ? 'Phí đã được thanh toán trước đó, không thu thêm' : `Đã trả phí ${vnd(v.amount)}`)),
    back: { label: 'Về kho đang thuê' },
  });

  const payDebt = (c: RentalContract) => {
    const expectedAmount = c.balance.outstanding;
    const idempotencyKey = newKey();
    setGateway({
      facilityId: c.facilityId, code: c.contractNumber, amount: expectedAmount,
      purpose: isClosedContract(c.status) ? 'Nợ sau quyết toán' : c.status === 'LOCKED_OUT' ? 'Công nợ — mở lại quyền vào kho' : c.status === 'EXPIRED' ? 'Công nợ (hợp đồng hết hạn — không mở lại quyền vào kho)' : 'Công nợ tiền thuê',
      pay: (m) => run('payBalance', { contractId: c._id, method: m, expectedAmount, idempotencyKey }, (v) => paidBalanceText(c, v))
        .then((r) => { if (!r.ok && r.code === 'BALANCE_CHANGED') setGateway(null); return r; }),
      back: { label: 'Về kho đang thuê' },
    });
  };

  /**
   * Gia hạn theo báo giá đang xem. Có khoản trả ngay (tháng đầu của kỳ gia hạn / trọn kỳ thuê ngày, tuần) → qua cổng thanh toán; cùng
   * idempotencyKey nên bấm lại / thử lại không gia hạn 2 lần. Giá đã đổi (PRICE_CHANGED) → tải lại báo giá, khách xem và xác nhận lại.
   */
  const extend = (c: RentalContract, q: NonNullable<typeof ext.quote>) => {
    const label = periodLabel(c.billing.rentalPeriod, periods);
    const call = (m?: PaymentMethod) => run('extendContract', { contractId: c._id, periods, method: m, acceptAppendix: agree, expected: { rate: q.rate, payNow: q.payNow, from: q.from, newEndDate: q.newEndDate, policyVersion: q.policyVersion, appendixHash: q.appendixHash }, idempotencyKey: ext.idemKey },
      (v) => (v > 0 ? `Đã gia hạn ${label} — thanh toán ${vnd(v)}` : `Đã gia hạn ${label}`))
      // Giá / phụ lục đổi (đợt 16 C2: APPENDIX_CHANGED): đóng cổng thanh toán để khách xem báo giá + phụ lục mới (thử lại với bản cũ vẫn bị từ chối).
      .then((r) => { if (!r.ok && (r.code === 'PRICE_CHANGED' || r.code === 'APPENDIX_CHANGED')) { setAgree(false); ext.reload(); setGateway(null); } return r; });
    if (q.payNow <= 0) { void call().then((r) => r.ok && close()); return; }
    setGateway({
      facilityId: c.facilityId, code: c.contractNumber, amount: q.payNow,
      purpose: q.rentalPeriod === 'MONTH' && periods > 1 ? `Gia hạn ${label} — tháng đầu` : `Gia hạn ${label}`,
      pay: (m) => call(m), back: { label: 'Về kho đang thuê' },
    });
  };

  return (
    <>
      <PageHeader title="Kho đang thuê" actions={<ButtonLink href="/facilities" variant="secondary"><Search className="size-4" />Thuê thêm kho</ButtonLink>} />
      {contracts.length === 0 && <Card><EmptyState icon={<Warehouse className="size-6" />} title="Bạn chưa có hợp đồng thuê kho" action={<ButtonLink href="/facilities">Tìm kho</ButtonLink>} /></Card>}
      <div className="grid gap-5 xl:grid-cols-2">
        {contracts.map((c) => {
          const unit = byId(db.units, c.unitId);
          const open = OPEN_CONTRACT_STATUSES.includes(c.status);
          const cat = byId(db.unitTypes, c.unitTypeId)?.category;
          const CatIcon = cat ? CATEGORY_ICON[cat] : Warehouse;
          const swaps = db.swapRequests.filter((s) => s.contractId === c._id);
          const openSwap = swaps.find((s) => (OPEN_SWAP_STATUSES as readonly string[]).includes(s.status));
          // Yêu cầu vừa kết thúc mà không đổi được (từ chối / hết hạn / huỷ) trong 7 ngày gần đây — hiện kèm lý do để
          // khách không thấy yêu cầu "biến mất" lặng lẽ. Đã có yêu cầu mới đang mở thì thôi.
          const endedSwap = openSwap ? undefined : swaps
            .map((s) => ({ s, at: [...(s.statusHistory ?? [])].reverse().find((h) => h.to === s.status)?.at ?? s.decidedAt ?? s.updatedAt }))
            .filter(({ s, at }) => (ENDED_SWAP_STATUSES as readonly string[]).includes(s.status) && Date.now() - new Date(at).getTime() <= ENDED_SWAP_SHOW_MS)
            .sort((a, b) => b.at.localeCompare(a.at))[0];
          // Điều khoản 1.24: cảnh báo hết hạn (ân hạn / đã khoá — giữ đồ / quá hạn giữ đồ) cùng câu với app; rồi cảnh báo công nợ nếu có.
          const alerts = [expiryAlert(c), delinquencyAlert(c)].filter((a): a is NonNullable<typeof a> => !!a);
          const insp = moveOutInspection(c);
          const rsv = db.reservations.find((x) => x.contractId === c._id);
          // Mọi phụ lục đã xác nhận: gia hạn + đổi cỡ kho (đợt 15, C3), đánh số chung.
          const appendices = contractAppendices(c).length;
          const extendCheck = canExtend(c);
          return (
            <Card key={c._id} className={cx('flex flex-col overflow-hidden', !open && 'bg-stone-50/60')}>
              {/* ---- đầu thẻ: số ô, loại kho, trạng thái, thời hạn */}
              <div className="flex items-start gap-4 p-5">
                <span className={cx('relative grid size-14 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white', open ? 'bg-ink' : 'bg-stone-400')}>
                  {unitLabel(db, c.unitId)}
                  <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-lg bg-brand-500 ring-2 ring-white"><CatIcon className="size-3.5" /></span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{typeName(db, c.unitTypeId)}</p>
                    <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                    {unit?.overlockActive && <Badge tone="red"><Lock className="size-3" />Đã gắn khóa chặn</Badge>}
                  </div>
                  <p className="text-sm text-stone-500">{facilityName(db, c.facilityId)} · Tầng {unit?.location.floor} · {c.contractNumber}</p>
                  {open
                    ? <TermProgress start={c.startDate} end={c.endDate} className="mt-2.5 max-w-sm" />
                    : <p className="mt-1 text-xs text-stone-500">{c.closedAt ? `Kết thúc ngày ${fmtDate(c.closedAt)}` : `${fmtDate(c.startDate)} → hết ngày ${fmtDate(lastDayOf(c.endDate))}`}</p>}
                </div>
              </div>

              {alerts.map((alert) => (
                <div key={alert.title} className={cx('mx-5 mb-4 flex gap-3 rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset', alert.tone === 'red' ? 'bg-red-50 text-red-900 ring-red-200' : 'bg-amber-50 text-amber-950 ring-amber-200')}>
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <div><p className="font-semibold">{alert.title}</p><p className="mt-0.5">{alert.text}</p></div>
                </div>
              ))}

              {/* ---- số liệu chính */}
              <dl className="grid grid-cols-2 gap-px border-y border-stone-100 bg-stone-100 sm:grid-cols-3">
                <div className="bg-white px-5 py-3">
                  <dt className="flex items-center gap-1.5 text-xs text-stone-500"><Wallet className="size-3.5" />Tiền thuê</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{vnd(c.billing.rate)}/{PERIOD_UNIT[c.billing.rentalPeriod]}</dd>
                </div>
                <div className="bg-white px-5 py-3">
                  <dt className="flex items-center gap-1.5 text-xs text-stone-500"><CreditCard className="size-3.5" />Công nợ</dt>
                  <dd className={cx('mt-0.5 text-sm font-semibold tabular-nums', c.balance.outstanding ? 'text-red-700' : 'text-emerald-700')}>{vnd(c.balance.outstanding)}</dd>
                </div>
                <div className="col-span-2 bg-white px-5 py-3 sm:col-span-1">
                  <dt className="flex items-center gap-1.5 text-xs text-stone-500"><ShieldCheck className="size-3.5" />Tiền giữ chân</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{vnd(c.deposit.amount)} <span className="font-normal text-stone-500">· {DEPOSIT_STATUS[c.deposit.status].label}</span></dd>
                  {/* F5: sau quyết toán nói rõ phần đã / đang hoàn và phần đã cấn trừ (trả nợ, hư hại) — không gọi phần cấn trừ là "không hoàn". */}
                  {depositSettlementText(c.deposit) && c.deposit.status !== 'REFUNDED' && <dd className="mt-0.5 text-xs text-stone-500">{depositSettlementText(c.deposit)}</dd>}
                </div>
              </dl>
              {/* Gói bảo vệ đồ gửi (Điều 6): phí gói đã nằm trong tiền thuê mỗi kỳ ở trên. */}
              <p className="flex items-center gap-1.5 border-b border-stone-100 px-5 py-2.5 text-xs text-stone-600"><ShieldCheck className="size-3.5 text-emerald-700" />{protectionPlanLine(contractPlanOf(c), unitVolumeM3(byId(db.unitTypes, c.unitTypeId)?.dimensions))}</p>

              <div className="space-y-3 p-5">
                {/* Hợp đồng đã đóng không còn kỳ thanh toán nào — chỉ còn (nếu có) khoản nợ sau quyết toán ở dòng Công nợ.
                    Đang nợ: số đang nợ + hạn chót trước khi bị tính phí trễ (theo paidThrough, như job) — không lấy nextBillingDate, vì
                    xuất hoá đơn xong job đã đẩy nó sang kỳ sau. Kỳ tới: đúng số sẽ thu (hết cam kết thì giá chưa ưu đãi).
                    Đã bàn giao lại ô (đang trả kho): job không tính kỳ mới nữa — không hiện "kỳ thanh toán tới". */}
                {open && !c.access.revokedAt && (
                  <ul className="space-y-1.5 text-sm">
                    {billingDueRows(billingDue(c)).map(([k, v]) => (
                      <li key={k} className="flex gap-2.5"><CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-700" /><span><span className="text-stone-500">{k}:</span> <span className="font-medium">{v}</span></span></li>
                    ))}
                  </ul>
                )}
                {isClosedContract(c.status) && c.balance.outstanding > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
                    <span>{c.status === 'ABANDONED' ? 'Hợp đồng đã đóng sau khi xử lý đồ bỏ lại — tiền giữ chân và tiền thanh lý chưa đủ bù công nợ' : closedDebtText(c)} — bạn còn nợ <b>{vnd(c.balance.outstanding)}</b>. Thanh toán xong mới đặt kho mới được.</span>
                    <Button size="sm" onClick={() => payDebt(c)}>Thanh toán {vnd(c.balance.outstanding)}</Button>
                  </div>
                )}
                {openSwap && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-violet-50 px-3.5 py-3 text-sm ring-1 ring-inset ring-violet-200">
                    <span className="flex gap-2.5">
                      <Repeat className="mt-0.5 size-4 shrink-0 text-violet-700" />
                      <span>
                        Yêu cầu đổi ô {openSwap.requestNumber} · <StatusBadge map={SWAP_REQUEST_STATUS} value={openSwap.status} />
                        {openSwap.status === 'APPROVED' && openSwap.method === 'SELF' && openSwap.moveDeadline && <> · hạn chuyển {fmtDate(openSwap.moveDeadline)}</>}
                        {openSwap.status === 'APPROVED' && openSwap.method === 'DELIVERY' && <> · chi nhánh chuyển ngày {fmtDate(openSwap.scheduledFor)}</>}
                        {/* Đã duyệt: phí đổi ô chốt lúc duyệt (hoặc miễn phí) — khách biết trước số sẽ cộng vào khoản phải trả. */}
                        {swapRequestNote(openSwap) && <span className="mt-0.5 block text-xs text-violet-900">{swapRequestNote(openSwap)}</span>}
                        {/* Đổi cỡ kho (C3): loại mới, giá / tiền giữ chân mới, phần chênh ước tính — tính lại theo ngày chuyển xong. */}
                        {sizeChangeNote(openSwap) && <span className="mt-0.5 block text-xs text-violet-900">{typeName(db, openSwap.unitTypeId)} → {typeName(db, openSwap.toUnitTypeId)} · {sizeChangeNote(openSwap)}</span>}
                        {/* Góp ý 17/11: ô mới + hình thức, từng khoản tiền đổi cỡ, đồ chi nhánh chuyển, lịch sử dời ngày chuyển. */}
                        <OpenSwapExtras s={openSwap} />
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {swapFeeDue(openSwap) > 0 && <Button size="sm" onClick={() => payFee(openSwap)}><CreditCard className="size-3.5" />Trả phí {vnd(openSwap.fee)}</Button>}
                      <SwapChangeDate s={openSwap} />
                      {(openSwap.status === 'SUBMITTED' || openSwap.status === 'APPROVED') && (
                        <Button size="sm" variant="dangerOutline" onClick={() => void run('cancelSwapRequest', { swapRequestId: openSwap._id }, openSwap.feePrepay && openSwap.paymentId ? `Đã rút yêu cầu đổi ô — phí ${vnd(openSwap.fee)} được hoàn đủ` : 'Đã rút yêu cầu đổi ô')}>Rút yêu cầu</Button>
                      )}
                    </span>
                  </div>
                )}
                {/* Hợp đồng đã kết thúc: không còn chuyện đổi ô — bỏ khối "Yêu cầu đổi ô … Đã huỷ · Khách đã trả kho". */}
                {open && endedSwap && (
                  <div className="rounded-xl bg-stone-50 px-3.5 py-3 text-sm ring-1 ring-inset ring-stone-200">
                    <p>Yêu cầu đổi ô {endedSwap.s.requestNumber} · <StatusBadge map={SWAP_REQUEST_STATUS} value={endedSwap.s.status} /> <span className="text-xs text-stone-500">· {fmtDate(endedSwap.at)}</span></p>
                    {swapRequestNote(endedSwap.s) && <p className="mt-0.5 text-xs text-stone-600">{swapRequestNote(endedSwap.s)}</p>}
                  </div>
                )}
                {/* Góp ý 17/11: biên bản chuyển đồ (số kiện, ảnh, danh sách đồ đã / chưa chuyển) của lần chi nhánh chuyển gần nhất. */}
                {open && <SwapMoveRecord contractId={c._id} />}
                {/* Sau trả kho: xác nhận bàn giao và đồ để lại trong ô (giữ đến ngày nào, đã lấy / đã xử lý chưa). */}
                {c.moveOut?.handover && <HandoverInfo handover={c.moveOut.handover} byName={byId(db.users, c.moveOut.handover.by)?.fullName} />}
                {c.leftover && <LeftoverInfo leftover={c.leftover} />}
                {/* Đợt 17: biên bản đang chờ quản lý duyệt → chỉ báo trạng thái; đã duyệt → xem phí + quyết toán dự kiến rồi xác nhận OTP tại quầy;
                    đã chốt → biên bản + khiếu nại trong hạn. */}
                {insp && (insp.status === 'SUBMITTED' || insp.status === 'RETURNED') && (
                  <p className="flex items-center gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
                    <ClipboardCheck className="size-4 shrink-0" />{MOVE_OUT_STAGE.AWAITING_APPROVAL.customer} — chi nhánh đã kiểm ô, quản lý đang ghi phí và duyệt.
                  </p>
                )}
                {insp && (insp.status === 'FM_APPROVED' || insp.status === 'APPROVED') && (
                  <Button size="sm" variant={insp.status === 'FM_APPROVED' ? 'primary' : 'secondary'} onClick={() => { setDispute(''); setDlg({ kind: 'inspection', c }); }}>
                    <ClipboardCheck className="size-3.5" />{insp.status === 'FM_APPROVED' ? 'Xem biên bản đã duyệt' : `Biên bản trả kho${canDisputeInspection(insp.performedAt) ? ' · còn hạn khiếu nại' : ''}`}
                  </Button>
                )}

                {/* ---- chi tiết hợp đồng: luôn hiện, không thu gọn (góp ý: thông tin kho bị ẩn, ngày bị cắt) — chữ dài xuống dòng, không cắt. */}
                <section className="rounded-xl px-4 py-3 ring-1 ring-inset ring-stone-200" aria-label="Chi tiết hợp đồng">
                  <h3 className="mb-2.5 flex items-center gap-2.5 text-sm font-medium text-ink"><FileText className="size-4 shrink-0 text-stone-500" aria-hidden />Chi tiết hợp đồng</h3>
                  <dl className="grid gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
                    {([
                      ['Thời hạn', `${fmtDate(c.startDate)} → hết ngày ${fmtDate(lastDayOf(c.endDate))}`],
                      ['Truy cập', <><KeyRound className="mr-1.5 inline size-3.5 align-[-2px] text-stone-500" aria-hidden />{ACCESS_METHOD[c.access.method]}{c.access.keyTag ? ` · ${c.access.keyTag}` : ''}</>],
                      ...(open || contractIntakeBatches(db, c._id).length > 0 ? [(() => {
                        const g = goodsSummary(contractIntakeBatches(db, c._id), c);
                        // Hợp đồng đã trả kho / đã đóng: ghi "Đã trả kho" thay cho số món đang gửi.
                        return ['Đồ đang gửi', g.returned ? 'Đã trả kho' : <>{g.count} món{g.total > 0 && ` · ${vnd(g.total)}`}{g.pending > 0 && <span className="text-amber-700"> · {g.pending} đợt chờ xác nhận</span>}</>] as [string, ReactNode];
                      })()] : []),
                      ['Hợp đồng đã ký', `${c.terms.signerName ?? '—'} · ${fmtDate(c.terms.signedAt)}`],
                    ] as [string, ReactNode][]).map(([k, v]) => (
                      <div key={k} className="min-w-0 sm:col-span-2 sm:grid sm:grid-cols-subgrid">
                        <dt className="text-xs text-stone-500 sm:text-sm">{k}</dt>
                        <dd className="mt-0.5 min-w-0 break-words font-medium text-ink sm:mt-0">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {rsv ? <ContractFileActions reservation={rsv} /> : null}
                </section>
                {/* Hợp đồng đã kết thúc: hồ sơ bồi thường / yêu cầu hỗ trợ của hợp đồng vẫn xem được; còn hạn thì gửi tiếp (khớp BE). */}
                {!open && <EndedContractSupport c={c} />}
                {/* Nhắc hết hạn / nhắc thanh toán chỉ có nghĩa khi hợp đồng còn mở — hợp đồng đã kết thúc không hiện. */}
                {open && (c.notices?.length ?? 0) > 0 && (
                  <Disclosure icon={<Bell className="size-4" />} title={`Thông báo từ KhoAn (${c.notices!.length})`}>
                    <ContractNotices contract={c} limit={5} audience="customer" />
                  </Disclosure>
                )}
              </div>

              {/* ---- thanh hành động */}
              {open && (
                <div className="mt-auto border-t border-stone-100 bg-stone-50/70 px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    {c.balance.outstanding > 0 && <Button size="sm" onClick={() => payDebt(c)}><CreditCard className="size-3.5" />Thanh toán {vnd(c.balance.outstanding)}</Button>}
                    {/* Đợt 16 (A4): đang chờ đổi cỡ kho thì không gia hạn (server chặn RESIZE_PENDING) — hoàn tất hoặc huỷ yêu cầu đổi cỡ trước. */}
                    {/* Cửa sổ gia hạn (30 / 7 / 2 ngày cuối theo chu kỳ) và khoản quá hạn: canExtend — server chặn cùng quy tắc (EXTENSION_TOO_EARLY / EXTENSION_OVERDUE). */}
                    {(c.status === 'ACTIVE' || c.status === 'EXPIRED') && (openSwap?.sizeChange
                      ? <Button size="sm" variant="secondary" disabled title="Đang chờ đổi cỡ kho — hoàn tất hoặc huỷ yêu cầu đổi cỡ trước khi gia hạn"><RefreshCw className="size-3.5" />Gia hạn (chờ đổi cỡ kho)</Button>
                      : !extendCheck.ok
                        ? <span className="inline-flex items-center gap-2"><Button size="sm" variant="secondary" disabled title={extendCheck.reason}><RefreshCw className="size-3.5" />Gia hạn</Button><span className="text-xs text-stone-500">{extendCheck.reason}</span></span>
                        : <Button size="sm" variant={c.balance.outstanding > 0 ? 'secondary' : 'primary'} onClick={() => setDlg({ kind: 'extend', c })}><RefreshCw className="size-3.5" />Gia hạn</Button>)}
                    <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'access', c })}><KeyRound className="size-3.5" />Mã vào kho</Button>
                    {c.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'moveout', c })}><PackageOpen className="size-3.5" />Đăng ký trả kho</Button>}
                    {c.status === 'MOVE_OUT_PENDING' && <Badge tone="violet">{c.access.revokedAt ? MOVE_OUT_STAGE[moveOutStageOf(c, insp) ?? 'AWAITING_INSPECTION'].customer : `Hẹn trả kho ${fmtDate(c.moveOut?.scheduledFor)} · bàn giao trước hết ngày ${fmtDate(handoverDeadline(c))} để không tính kỳ mới`}</Badge>}
                    {c.status === 'MOVE_OUT_PENDING' && !c.access.revokedAt && <Button size="sm" variant="dangerOutline" onClick={() => void run('cancelMoveOut', { contractId: c._id }, 'Đã rút đăng ký trả kho — hợp đồng tiếp tục hiệu lực')}>Rút đăng ký trả kho</Button>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setGoods({ c, declare: false })}><Package className="size-3.5" />Đồ đang gửi</Button>
                    {canDeclareIntake(c) && <Button size="sm" variant="ghost" onClick={() => setGoods({ c, declare: true })}><PackagePlus className="size-3.5" />Khai đợt nhập hàng</Button>}
                    {appendices > 0 && <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: 'appendix', c })}><FileText className="size-3.5" />Phụ lục ({appendices})</Button>}
                    {c.status === 'ACTIVE' && !openSwap && <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: 'swap', c })}><Repeat className="size-3.5" />Đổi ô kho</Button>}
                    <Button size="sm" variant="ghost" onClick={() => { setPerson(EMPTY_PERSON); setDlg({ kind: 'authorized', c }); }}><UserCheck className="size-3.5" />Người được uỷ quyền{(c.authorizedPersons?.length ?? 0) > 0 ? ` (${c.authorizedPersons!.length})` : ''}</Button>
                    <ButtonLink href={`/portal/tickets?contract=${c._id}`} size="sm" variant="ghost"><LifeBuoy className="size-3.5" />Báo sự cố</ButtonLink>
                    <ButtonLink href={`/portal/claims?contract=${c._id}`} size="sm" variant="ghost"><HandCoins className="size-3.5" />Yêu cầu bồi thường</ButtonLink>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>


      <Modal open={dlg?.kind === 'inspection'} onClose={close} size="lg" title="Biên bản trả kho" description={dlg ? `Hợp đồng ${dlg.c.contractNumber} · kho ${unitLabel(db, dlg.c.unitId)}` : ''}>
        {dlg?.kind === 'inspection' && (() => {
          const insp = moveOutInspection(dlg.c);
          if (!insp) return null;
          return (
            <div className="space-y-5">
              <InspectionReport inspection={insp} inspectorName={byId(db.users, insp.inspectorId)?.fullName} contract={dlg.c} handoverByName={byId(db.users, dlg.c.moveOut?.handover?.by)?.fullName} />
              {/* Đợt 17: biên bản đã duyệt nhưng chưa xác nhận — khiếu nại sau khi chốt; không đồng ý thì báo nhân viên tại quầy trước khi đọc mã. */}
              {insp.status === 'FM_APPROVED' ? (
                <p className="border-t border-stone-100 pt-4 text-xs text-stone-500">Không đồng ý khoản nào: báo nhân viên tại quầy trước khi đọc mã OTP — quản lý sẽ xem lại. Sau khi xác nhận, bạn vẫn khiếu nại được trong {INSPECTION_DISPUTE_DAYS} ngày.</p>
              ) : (
              <div className="border-t border-stone-100 pt-4">
                {canDisputeInspection(insp.performedAt) ? (
                  <>
                    <Field label="Khiếu nại biên bản" tip={`Trong ${INSPECTION_DISPUTE_DAYS} ngày từ ngày lập biên bản. Khiếu nại đúng thì tính lại phí hư hại và hoàn phần trả thừa.`}>
                      <textarea className={inputCls} rows={3} value={dispute} onChange={(e) => setDispute(e.target.value)} placeholder="VD: Vết trầy ở cửa đã có từ lúc nhận kho." />
                    </Field>
                    <div className="mt-2">
                      <Button disabled={dispute.trim().length < 10 || busy}
                        // Góp ý 18/11: khách không chọn mức ưu tiên — server luôn lưu MEDIUM, quản lý đặt mức khi giao.
                        onClick={() => void run('createTicket', { facilityId: dlg.c.facilityId, kind: 'CUSTOMER_ISSUE', category: 'BILLING', subject: `Khiếu nại biên bản trả kho ${dlg.c.contractNumber}`, description: dispute.trim(), contractId: dlg.c._id }, 'Đã gửi khiếu nại — theo dõi phản hồi ở mục Hỗ trợ', () => close())}>
                        Gửi khiếu nại
                      </Button>
                    </div>
                  </>
                ) : <p className="text-xs text-stone-500">Đã quá hạn khiếu nại {INSPECTION_DISPUTE_DAYS} ngày kể từ ngày lập biên bản — liên hệ chi nhánh nếu cần.</p>}
              </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={dlg?.kind === 'appendix'} onClose={close} size="lg" title="Phụ lục hợp đồng" description={dlg ? `Hợp đồng ${dlg.c.contractNumber} — các phụ lục (gia hạn, đổi cỡ kho) bạn đã xác nhận` : ''}>
        {dlg?.kind === 'appendix' && (
          <div className="space-y-5">
            {contractAppendices(dlg.c).map((a) => (
              <div key={a.number} className="rounded-xl p-4 ring-1 ring-inset ring-stone-200">
                <AppendixText title={a.title} clauses={a.clauses} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3 text-xs text-stone-500">
                  <span>Bên B xác nhận điện tử: <b className="text-ink">{a.signerName}</b> · {fmtDate(a.acceptedAt)} · Bên A xác nhận qua hệ thống KhoAn</span>
                  <Button size="sm" variant="secondary" onClick={() => void downloadAppendix(dlg.c, a.number)}>Tải PDF</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={dlg?.kind === 'extend'} onClose={close} size="lg" title="Gia hạn hợp đồng" description={dlg ? `Thời hạn hiện tại: đến hết ngày ${fmtDate(lastDayOf(dlg.c.endDate))}` : ''}
        footer={<Button disabled={!ext.quote || !agree} onClick={() => dlg && ext.quote && extend(dlg.c, ext.quote)}>{ext.quote && ext.quote.payNow > 0 ? `Gia hạn & thanh toán ${vnd(ext.quote.payNow)}` : 'Xác nhận gia hạn'}</Button>}>
        <Field label={dlg ? `Số ${PERIOD_UNIT[dlg.c.billing.rentalPeriod]} gia hạn` : 'Số chu kỳ gia hạn'}>
          <select className={inputCls} value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>{[1, 3, 6, 12].map((m) => <option key={m} value={m}>{dlg ? periodLabel(dlg.c.billing.rentalPeriod, m) : m}</option>)}</select>
        </Field>
        {dlg && <ExtensionQuoteSummary quote={ext.quote} error={ext.error} accepted={agree} onAccept={setAgree} graceDays={dlg.c.terms.gracePeriodDays} />}
      </Modal>

      <Modal open={dlg?.kind === 'access'} onClose={close} size="lg" title="Mã vào kho" description={dlg ? `Kho ${unitLabel(db, dlg.c.unitId)} · ${facilityName(db, dlg.c.facilityId)}` : ''}>
        {dlg?.kind === 'access' && (() => { const live = db.contracts.find((x) => x._id === dlg.c._id) ?? dlg.c; return <AccessPanel c={live} />; })()}
      </Modal>

      <Modal open={dlg?.kind === 'moveout'} onClose={close} title="Đăng ký trả kho"
        footer={<Button onClick={() => dlg && void run('requestMoveOut', { contractId: dlg.c._id, date: `${date}T00:00:00.000Z` }, 'Đã đăng ký trả kho', () => close())}>Xác nhận</Button>}>
        <Field label="Ngày trả kho dự kiến" tip="Tiền thuê và tiền giữ chân tính theo ngày bàn giao thực tế, không theo ngày hẹn.">
          {/* Điều khoản 1.24: hợp đồng có quy tắc hết hạn — hẹn trước ngày khoá (server: 422 MOVE_OUT_AFTER_GRACE). */}
          <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={dlg ? moveOutMaxDate(dlg.c) : addDays(todayISO(), MAX_MOVE_OUT_LEAD_DAYS).slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {dlg && usesGraceHold(dlg.c) && (
          <p className="mt-2 rounded-lg bg-stone-50 p-3 text-xs leading-relaxed text-stone-700">
            Hết thời hạn (hết ngày {fmtDate(lastDayOf(dlg.c.endDate))}) không tính thêm tiền thuê. Bàn giao sau ngày đó thì phí lưu giữ {vnd(dlg.c.expiry?.dailyFee ?? 0)}/ngày tính từ ngày {fmtDate(dlg.c.endDate)} tới ngày bàn giao (trừ vào tiền giữ chân).
            Hẹn bàn giao trước ngày <strong>{fmtDate(expiryLockFrom(dlg.c))}</strong> — từ ngày đó quyền ra vào bị khoá, đăng ký chưa bàn giao tự huỷ.
          </p>
        )}
        {dlg && !usesGraceHold(dlg.c) && (() => {
          // Mốc 00:00 ngày thu kỳ kế tiếp là lúc phát sinh tiền thuê kỳ mới — bàn giao trước mốc này thì không bị tính thêm kỳ.
          const deadline = handoverDeadline(dlg.c);
          const late = `${date}T00:00:00.000Z` > deadline;
          return (
            <p className={cx('mt-2 rounded-lg p-3 text-xs leading-relaxed', late ? 'bg-amber-50 text-amber-900' : 'bg-stone-50 text-stone-700')}>
              Bàn giao trước <strong>hết ngày {fmtDate(deadline)}</strong> để không tính kỳ mới
              {late ? `; hẹn ngày này thì kỳ từ ${fmtDate(dlg.c.billing.nextBillingDate)} vẫn tính tiền.` : '.'} Hẹn trước tối đa {MAX_MOVE_OUT_LEAD_DAYS} ngày.
            </p>
          );
        })()}
        {dlg && (() => {
          const preview = earlyTerminationPreview(db, dlg.c, `${date}T00:00:00.000Z`);
          const rsv = byId(db.reservations, dlg.c.reservationId);
          const claw = contractClawback(dlg.c, rsv?.quote, db.policies, `${date}T00:00:00.000Z`);
          return preview && (
            <div className={cx('mt-3 space-y-1.5 rounded-lg p-3 text-xs leading-relaxed', preview.refundCapPct === 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900')}>
              <p>
                Trả kho sớm: bàn giao ngày này là đã dùng {preview.elapsedPct}% thời hạn, hoàn tối đa <strong>{preview.refundCapPct}%</strong> tiền giữ chân
                {preview.refundCapPct === 0 ? ' (không hoàn)' : ''}, chưa trừ phí hư hại nếu có.
              </p>
              {claw && (
                <p>
                  Thu hồi ưu đãi: mới dùng {claw.usedPeriods} tháng nên chỉ được giảm {vnd(claw.entitledPerPeriod)}/tháng (thay vì {vnd(claw.discountPerPeriod)});
                  phần vượt <strong>{vnd(claw.amount)}</strong> trừ vào tiền giữ chân.
                </p>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={dlg?.kind === 'authorized'} onClose={close} size="lg" title="Người được uỷ quyền ra vào kho"
        description={dlg ? `Kho ${unitLabel(db, dlg.c.unitId)} · tối đa ${MAX_AUTHORIZED_PERSONS} người` : ''}>
        {dlg?.kind === 'authorized' && (() => {
          const c = db.contracts.find((x) => x._id === dlg.c._id) ?? dlg.c; // lấy bản mới nhất sau mỗi lần thêm / xoá
          const list = c.authorizedPersons ?? [];
          const valid = person.fullName.trim().length >= 2 && isValidPhone(person.phone.trim()) && /^\d{4}$/.test(person.idNumberLast4);
          return (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-stone-600">Người dưới đây được thay bạn ra vào và lấy đồ; nhân viên đối chiếu họ tên và 4 số cuối giấy tờ. Bạn chịu trách nhiệm về việc họ làm và xoá được bất cứ lúc nào.</p>
              {list.length === 0 ? <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-500">Chưa uỷ quyền cho ai.</p> : (
                <ul className="divide-y divide-stone-100 rounded-lg ring-1 ring-stone-200">
                  {list.map((p) => (
                    <li key={p._id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div><p className="font-medium">{p.fullName}{p.relationship ? <span className="font-normal text-stone-500"> · {p.relationship}</span> : null}</p><p className="text-xs text-stone-500">{p.phone} · giấy tờ •••• {p.idNumberLast4} · thêm {fmtDate(p.addedAt)}</p></div>
                      <button type="button" aria-label={`Xoá uỷ quyền của ${p.fullName}`} onClick={() => { if (window.confirm(`Xoá uỷ quyền của ${p.fullName}?`)) void run('removeAuthorizedPerson', { contractId: c._id, personId: p._id }, 'Đã xoá uỷ quyền'); }}
                        className="grid size-8 shrink-0 place-items-center rounded-md text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50"><Trash2 className="size-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {c.status !== 'CLOSED' && list.length < MAX_AUTHORIZED_PERSONS && (
                <div className="grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-2">
                  <Field label="Họ tên"><input className={inputCls} maxLength={100} value={person.fullName} onChange={(e) => setPerson({ ...person, fullName: e.target.value })} /></Field>
                  <Field label="Số điện thoại"><input className={inputCls} inputMode="tel" maxLength={15} value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} placeholder="09xxxxxxxx" /></Field>
                  <Field label="4 số cuối giấy tờ tùy thân" tip="CCCD / hộ chiếu của người được uỷ quyền"><input className={inputCls} inputMode="numeric" maxLength={4} value={person.idNumberLast4} onChange={(e) => setPerson({ ...person, idNumberLast4: e.target.value.replace(/\D/g, '') })} /></Field>
                  <Field label="Quan hệ (không bắt buộc)"><input className={inputCls} maxLength={60} value={person.relationship} onChange={(e) => setPerson({ ...person, relationship: e.target.value })} placeholder="Vợ / chồng, nhân viên…" /></Field>
                  <div className="sm:col-span-2"><Button disabled={!valid} onClick={() => void run('addAuthorizedPerson', { contractId: c._id, ...person, fullName: person.fullName.trim(), phone: person.phone.trim() }, 'Đã thêm người được uỷ quyền', () => setPerson(EMPTY_PERSON))}><UserCheck className="size-4" />Thêm người được uỷ quyền</Button></div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={dlg?.kind === 'swap'} onClose={close} size="lg" title="Yêu cầu đổi ô kho"
        description="Chi nhánh xét duyệt. Đổi ô cùng loại giữ nguyên giá; đổi cỡ kho thì xem giá mới trước khi gửi.">
        {dlg?.kind === 'swap' && <SwapRequestForm key={dlg.c._id} c={dlg.c} onDone={close} />}
      </Modal>
      <MockGateway order={gateway} onClose={(paid) => { setGateway(null); if (paid) close(); }} />
      <ContractGoodsDialog contract={goods?.c ?? null} declare={goods?.declare} onClose={() => setGoods(null)} />
    </>
  );
}

/**
 * Hợp đồng đã kết thúc (trả kho / đóng): hồ sơ bồi thường và yêu cầu hỗ trợ của hợp đồng — trước đây mất hẳn khỏi thẻ khi trả kho.
 * Trong hạn (CLAIM_WINDOW_DAYS ngày từ ngày đóng, như BE) vẫn gửi được yêu cầu bồi thường / báo sự cố; quá hạn chỉ còn lịch sử.
 */
function EndedContractSupport({ c }: { c: RentalContract }) {
  const { db, user } = useStore();
  const win = claimWindow(c);
  const ticketOk = canOpenTicket(c);
  const claims = db.claims.filter((k) => k.contractId === c._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tickets = db.tickets.filter((t) => t.contractId === c._id && t.reporterId === user?._id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const note = win.canFile
    ? (win.until ? `Nhận yêu cầu bồi thường đến hết ngày ${fmtDate(win.until)}.` : null)
    : c.status === 'ABANDONED' ? 'Hợp đồng đóng sau khi xử lý đồ bỏ lại — không nhận yêu cầu bồi thường.'
      : `Đã hết hạn gửi yêu cầu bồi thường — hạn chót hết ngày ${fmtDate(win.until)}.`;
  // Đồ bỏ lại đã thanh lý, không có hồ sơ nào và không còn gửi được gì: khỏi hiện khối trống.
  if (!claims.length && !tickets.length && !ticketOk && c.status === 'ABANDONED') return null;
  return (
    <section className="rounded-xl px-4 py-3 ring-1 ring-inset ring-stone-200" aria-label="Bồi thường và hỗ trợ">
      <h3 className="flex items-center gap-2.5 text-sm font-medium text-ink"><HandCoins className="size-4 shrink-0 text-stone-500" aria-hidden />Bồi thường & hỗ trợ</h3>
      {(claims.length > 0 || tickets.length > 0) && (
        <ul className="mt-1.5 divide-y divide-stone-100 text-sm">
          {claims.map((k) => (
            <li key={k._id}>
              <Link href={`/portal/claims?open=${k._id}`} className="flex items-start justify-between gap-3 py-2 hover:text-brand-800">
                <span className="min-w-0"><span className="block font-mono text-xs">{k.claimNumber}</span><span className="block text-stone-600">Bồi thường · {vnd(k.claimedAmount)}</span></span>
                <span className="shrink-0"><StatusBadge map={CLAIM_STATUS} value={k.status} /></span>
              </Link>
            </li>
          ))}
          {tickets.map((t) => (
            <li key={t._id}>
              <Link href={`/portal/tickets?open=${t._id}`} className="flex items-start justify-between gap-3 py-2 hover:text-brand-800">
                <span className="min-w-0"><span className="block font-mono text-xs">{t.ticketNumber}</span><span className="block break-words text-stone-600">{t.subject}</span></span>
                <span className="shrink-0"><StatusBadge map={TICKET_STATUS} value={t.status} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-1.5 text-xs text-stone-500">{note}</p>}
      {(ticketOk || win.canFile) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ticketOk && <ButtonLink href={`/portal/tickets?contract=${c._id}`} size="sm" variant="ghost"><LifeBuoy className="size-3.5" />Báo sự cố</ButtonLink>}
          {win.canFile && <ButtonLink href={`/portal/claims?contract=${c._id}`} size="sm" variant="ghost"><HandCoins className="size-3.5" />Yêu cầu bồi thường</ButtonLink>}
        </div>
      )}
    </section>
  );
}
