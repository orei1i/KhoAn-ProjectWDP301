'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Banknote, CalendarDays, CircleCheck, ClipboardCheck, FileText, Hammer, History, KeyRound, MailCheck, Package, PackageOpen, PenLine, Plus,
  ShieldAlert, Timer, Trash2, TriangleAlert, UserPlus, UserRound, UserX, Wallet, Warehouse,
} from 'lucide-react';
import type { InspectionLog, RentalContract } from '@ssm/shared';
import { CLAIM_FM_APPROVAL_LIMIT, contractClawback, contractTermText, DAMAGE_STAFF_LIMIT, lastDayOf, LEFTOVER_FEE_MAX, LEFTOVER_HOLD_DAYS, monthsDaysBetween, monthsDaysText, OPEN_ACCESS_REQUEST_STATUSES, OPEN_SERVICE_ORDER_STATUSES, OPEN_SWAP_STATUSES, unusedRenewalRefunds } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { INSPECTION_OUTCOME } from '@/shared/lib/labels';
import { byId, earlyTerminationCap, settlementDateOf, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, Disclosure, EmptyState, Field, InfoTip, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { PhotoLinks, PhotoUploadInput, parsePhotoLinks } from '@/shared/ui/photo-links';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { GoodsReference } from '@/features/intake/contract-goods';
import { AccessResetCheck, AccessResetReminder, accessResetTaskText } from '@/features/access/unit-access-fields';
import { CounterCollectDialog } from '@/features/payments/counter-collect';
import { ActionBar, Callout, Chip, ChipRow, Fact, FactGrid, Ledger, LedgerRow, Meta, PanelHeader, QueueRow, Segmented, StepBlock, StepTrack, UnitTag, type StepState } from '@/features/staff-ui';

// Danh mục kiểm tra: mỗi mục chỉ đánh dấu "đã kiểm" — hư hại (nếu có) ghi ở mục 2 "Hư hại & chi phí".
const ITEMS = ['Cửa cuốn / cửa kho', 'Ổ khóa', 'Sàn', 'Tường & vách ngăn', 'Trần / chống thấm', 'Vệ sinh chung'];
type Damage = InspectionLog['damages'][number];
const OTP_RE = /^\d{6}$/;
/**
 * Trạng thái một lượt trong hàng "Chờ trả kho" (theo trạng thái ô): ô còn OCCUPIED = khách đã đăng ký trả kho nhưng chưa bàn giao (còn chìa /
 * thẻ / mật khẩu); PENDING_INSPECTION = ô đã nhận lại (thu hồi quyền vào kho), chỉ còn lập biên bản. Chữ nói trạng thái, không dựa vào màu.
 */
const QUEUE_STATE = {
  handover: { label: 'Chờ khách bàn giao', tone: 'amber' as const },
  report: { label: 'Đã nhận ô — chờ biên bản', tone: 'violet' as const },
};

export default function MoveOutPage() {
  const { db, user, run, busy } = useStore();
  const scope = useFacilityScope();
  const [active, setActive] = useState<RentalContract | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Khách có mặt ký: mã OTP gửi tới email tài khoản chủ hợp đồng (gắn với hợp đồng đang mở), khách đọc mã cho nhân viên nhập.
  const [otp, setOtp] = useState<{ contractId: string; sentTo: string; resendAt: number; demoCode?: string } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // Quyết toán còn thiếu (khách cần trả thêm): thu ngay tại quầy sau khi hoàn tất, hoặc để thành nợ (khách trả sau trên web / app / tại quầy).
  const [afterDebt, setAfterDebt] = useState<'COLLECT' | 'DEBT'>('COLLECT');
  const [collectId, setCollectId] = useState<string | null>(null);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [notes, setNotes] = useState('');
  const [photoText, setPhotoText] = useState<string[]>([]); // ảnh của từng hư hại (link ảnh đã tải lên, cách nhau xuống dòng)
  const [walkIn, setWalkIn] = useState('');
  const [walkInReason, setWalkInReason] = useState('');
  const [confirmDone, setConfirmDone] = useState(false); // hộp xác nhận trước khi đóng hợp đồng
  const [remindReset, setRemindReset] = useState(false); // popup nhắc nhận lại chìa / thẻ khi bấm hoàn tất mà chưa tick
  // RV3: khách ký BIÊN BẢN ở bước cuối (sau khi đã kiểm tra, chốt đồ để lại, xem quyết toán) — hoặc (chỉ quản lý) khách vắng mặt + lý do.
  const [recvMode, setRecvMode] = useState<'SIGN' | 'ABSENT'>('SIGN');
  const [absentReason, setAbsentReason] = useState('');
  // Đợt 17 (A1): đã thu chìa / thẻ hoặc đặt lại khoá ngay lúc nhận lại kho / lúc kiểm tra — không tick thì ô chờ ghi nhận mới mở cho thuê lại.
  const [recvReset, setRecvReset] = useState(false);
  const [inspReset, setInspReset] = useState(false);
  // Đồ khách để lại trong ô (bắt buộc khai): null = chưa chọn.
  const [left, setLeft] = useState<boolean | null>(null);
  const [leftDesc, setLeftDesc] = useState('');
  const [leftPhotos, setLeftPhotos] = useState('');
  const [dispose, setDispose] = useState<RentalContract | null>(null);
  const [disposeForm, setDisposeForm] = useState({ fee: 0, note: '' });
  const isFM = user?.role === 'FACILITY_MANAGER';
  // Phí xử lý đồ để lại trên ngưỡng duyệt của chi nhánh chỉ Quản lý vận hành lập (server trả 403 DISPOSAL_LIMIT) — chặn ngay ở đây.
  const disposeOverLimit = user?.role !== 'OPS_MANAGER' && disposeForm.fee > CLAIM_FM_APPROVAL_LIMIT;

  const pending = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && c.status === 'MOVE_OUT_PENDING');
  // Khách đến quầy trả kho mà chưa tự đăng ký (VD còn nợ nên app không cho): nhân viên lập đăng ký hộ — đang quá hạn / bị khoá thì quản lý lập.
  const walkInStatuses = user?.role === 'FACILITY_MANAGER' ? ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT'] : ['ACTIVE'];
  const walkInCandidates = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && walkInStatuses.includes(c.status))
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
  // Đồ khách để lại sau trả kho — ô đang giữ (MAINTENANCE) đến hết hạn giữ.
  const held = db.contracts.filter((x) => scope.facilityIds.includes(x.facilityId) && x.leftover?.status === 'HELD')
    .sort((a, b) => a.leftover!.holdUntil.localeCompare(b.leftover!.holdUntil));
  const history = db.inspections.filter((i) => scope.facilityIds.includes(i.facilityId)).sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  const c = active ? db.contracts.find((x) => x._id === active._id) ?? null : null;
  const unit = c ? byId(db.units, c.unitId) : undefined;
  const damageTotal = damages.reduce((s, d) => s + (d.cost || 0), 0);
  // Kiểm soát hai cấp: chi phí hư hại lớn do Quản lý chi nhánh lập biên bản.
  const overStaffLimit = user?.role === 'STAFF' && damageTotal > DAMAGE_STAFF_LIMIT;
  const earlyTermination = c ? earlyTerminationCap(db, c) : null;
  const normalRefund = c ? c.deposit.amount - Math.min(c.deposit.amount, damageTotal + c.balance.outstanding) : 0;
  // Hư hại + công nợ vượt tiền giữ chân: phần chênh thành khoản nợ còn lại sau quyết toán (cùng công thức với server).
  const rawShortfall = c ? Math.max(0, damageTotal + c.balance.outstanding - c.deposit.amount) : 0;
  // Tiền thuê khách trả trước khi gia hạn cho các kỳ chưa bắt đầu: cấn vào phần thiếu trước, còn lại hoàn cho khách (như server). Đợt 16
  // (A1): số khách THỰC TRẢ cho các kỳ đó — phần RENEWAL còn lại + phần SIZE_CHANGE thu thêm khi đổi cỡ (unusedRenewalRefunds, cùng hàm server).
  const unusedRent = c ? unusedRenewalRefunds({
    period: c.billing.rentalPeriod, contract: c, returnedOn: settlementDateOf(c),
    renewals: c.renewals.flatMap((x) => {
      const p = x.paymentId ? db.payments.find((y) => y._id === x.paymentId && ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(y.status)) : undefined;
      // prepaidUntil: gia hạn thuê tháng chỉ trả trước tháng đầu — phần chưa dùng tính theo mốc này (như server).
      return p ? [{ key: p._id, previousEndDate: x.previousEndDate, periods: x.periods, amount: p.amount, refundedAmount: p.refundedAmount ?? 0, prepaidUntil: x.prepaidUntil ?? null }] : [];
    }),
    sizeCharges: db.payments.filter((p) => p.contractId === c._id && p.type === 'SIZE_CHANGE' && ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'PENDING'].includes(p.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ key: p._id, amount: p.amount, refundedAmount: p.refundedAmount ?? 0 })),
  }).total : 0;
  // Đợt 16 (C4): tiền đơn dịch vụ / phí cấp lại bị huỷ lúc nhận lại kho — hoàn trong quyết toán, cùng thứ tự cấn trừ (sau tiền gia hạn).
  const credits = c ? [...db.serviceOrders.filter((o) => o.contractId === c._id).map((o) => ({ o, due: o.total })), ...db.accessRequests.filter((o) => o.contractId === c._id).map((o) => ({ o, due: o.fee }))]
    .filter(({ o }) => o.status === 'CANCELLED' && o.refundAtSettlement && !o.refundPaymentId && o.paymentId).reduce((sum, x) => sum + x.due, 0) : 0;
  const rentOffset = Math.min(unusedRent, rawShortfall);
  const creditOffset = Math.min(credits, rawShortfall - rentOffset);
  const shortfall = rawShortfall - rentOffset - creditOffset;
  const cappedRefund = c ? (earlyTermination ? Math.min(normalRefund, Math.round((c.deposit.amount * earlyTermination.refundCapPct) / 100)) : normalRefund) : 0;
  // Thu hồi ưu đãi thuê dài hạn khi trả sớm — cùng công thức với server (shared), trừ vào phần tiền giữ chân còn lại.
  const rsv = c ? byId(db.reservations, c.reservationId) : undefined;
  const claw = c && c.moveOut ? contractClawback(c, rsv?.quote, db.policies, settlementDateOf(c)) : null;
  const clawback = claw ? Math.min(cappedRefund, claw.amount) : 0;
  const refundAmount = cappedRefund - clawback;
  const refundTotal = refundAmount + unusedRent - rentOffset + credits - creditOffset;

  const start = (x: RentalContract) => {
    setConfirmDone(false); setActive(x); setChecked({}); setDamages([]); setPhotoText([]); setNotes('');
    setLeft(null); setLeftDesc(''); setLeftPhotos(''); setInspReset(false);
    setRecvMode('SIGN'); setAbsentReason(''); setRecvReset(false);
    setOtp(null); setOtpCode(''); setAfterDebt('COLLECT');
  };
  // Đếm ngược "Gửi lại sau 45s" — chỉ chạy khi đang chờ được gửi lại.
  const otpWait = otp && c && otp.contractId === c._id ? Math.max(0, Math.ceil((otp.resendAt - now) / 1000)) : 0;
  useEffect(() => {
    if (otpWait <= 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [otpWait]);
  const otpSent = !!otp && !!c && otp.contractId === c._id;
  const sendOtp = async () => {
    if (!c) return;
    const res = await run('requestMoveOutOtp', { contractId: c._id }, (v) => `Đã gửi mã OTP tới ${v.sentTo}${v.pending ? ' (thư đang gửi)' : ''}`);
    if (res.ok) {
      setOtp({ contractId: c._id, sentTo: res.value.sentTo, resendAt: Date.now() + res.value.resendAfterSeconds * 1000, demoCode: res.value.demoCode });
      setOtpCode(''); setNow(Date.now());
    } else if (res.code === 'OTP_COOLDOWN') {
      const wait = (res.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60;
      setOtp((o) => (o && o.contractId === c._id ? { ...o, resendAt: Date.now() + wait * 1000 } : o)); setNow(Date.now());
    }
  };
  const photosOf = (i: number) => parsePhotoLinks(photoText[i] ?? '').urls;
  const leftUrls = parsePhotoLinks(leftPhotos).urls;
  const leftOk = left === false || (left === true && leftDesc.trim().length >= 3 && leftUrls.length > 0);
  const submit = async () => {
    if (!c || left === null) return;
    const leftItems = left ? { present: true, description: leftDesc.trim(), photoUrls: leftUrls } : { present: false };
    const inspection = { checklist: ITEMS.map((item) => ({ item, checked: true })), damages: damages.map((d, i) => ({ ...d, photoUrls: photosOf(i) })), notes, leftItems };
    const doneText = (v: { inspection: InspectionLog; accessResetPending?: boolean; accessResetTask?: string | null }) =>
      `Hoàn tất trả kho — hoàn tiền giữ chân ${vnd(v.inspection.depositSettlement?.refundAmount ?? 0)}${(v.inspection.depositSettlement?.shortfall ?? 0) > 0 ? ` · khách cần trả thêm ${vnd(v.inspection.depositSettlement?.shortfall ?? 0)}` : ''}${left ? ` · giữ đồ khách ${LEFTOVER_HOLD_DAYS} ngày` : ''}${v.accessResetPending ? ` · còn việc: ${v.accessResetTask}, ô chưa mở cho thuê` : ''}`;
    // Còn thiếu theo quyết toán của SERVER: chọn thu ngay → mở hộp thu công nợ tại quầy (POST /contracts/:id/pay-balance) cho hợp đồng vừa đóng.
    const done = (v: { inspection: InspectionLog }) => {
      setConfirmDone(false); setActive(null);
      if (collectNow && (v.inspection.depositSettlement?.shortfall ?? 0) > 0) setCollectId(c._id);
    };
    // RV3: ô còn đang thuê → khách ký biên bản ở bước cuối, server nhận lại kho rồi lập biên bản trong cùng một lần bấm.
    if (occupied) {
      if (!recvOk) return;
      const handover = recvMode === 'SIGN'
        ? { method: 'CUSTOMER_SIGNATURE' as const, signerName: userName(db, c.customerId), otp: otpCode.trim(), accessReset: recvReset }
        : { method: 'MANAGER_CONFIRM' as const, reason: absentReason.trim(), accessReset: recvReset };
      const res = await run('completeMoveOut', { contractId: c._id, handover, inspection }, doneText);
      if (res.ok) done(res.value);
      // Mã hết hạn / đã đổi / sai quá số lần: xoá ô nhập để nhân viên gửi mã mới.
      else if (res.code === 'EMAIL_OTP_EXPIRED' || res.code === 'OTP_INVALIDATED' || res.code === 'EMAIL_OTP_INVALID') { setOtpCode(''); setConfirmDone(false); }
      return;
    }
    // Đợt 17 (A1): tick ở bước kiểm tra = ghi nhận trước khi lập biên bản, để kết quả sạch thì ô mở cho thuê ngay.
    if (resetPending && inspReset && unit) {
      const rec = await run('recordUnitAccessReset', { unitId: unit._id, note: 'Ghi nhận khi kiểm tra trả kho' });
      if (!rec.ok) return;
    }
    const res = await run('submitInspection', { contractId: c._id, ...inspection }, doneText);
    if (res.ok) done(res.value);
  };
  // Đăng ký trả kho hộ khách tại quầy — đối chiếu đúng khách + mã kho trước khi gửi; bắt buộc lý do (khách được email báo).
  const registerWalkIn = () => {
    const x = byId(db.contracts, walkIn);
    if (!x || !window.confirm(`Đăng ký trả kho hôm nay cho:

Khách: ${userName(db, x.customerId)}
Kho: ${unitLabel(db, x.unitId)} · HĐ ${x.contractNumber}`)) return;
    void run('requestMoveOut', { contractId: x._id, date: todayISO(), reason: walkInReason.trim() }, 'Đã đăng ký trả kho — nhận lại chìa khoá ở danh sách trên', () => { setWalkIn(''); setWalkInReason(''); });
  };
  const openItemsOf = (x: RentalContract) => {
    const orders = db.serviceOrders.filter((o) => o.contractId === x._id && OPEN_SERVICE_ORDER_STATUSES.includes(o.status)).length;
    const access = db.accessRequests.filter((r) => r.contractId === x._id && OPEN_ACCESS_REQUEST_STATUSES.includes(r.status)).length;
    const swaps = db.swapRequests.filter((r) => r.contractId === x._id && OPEN_SWAP_STATUSES.includes(r.status)).length;
    return [orders && `${orders} đơn dịch vụ`, access && `${access} yêu cầu cấp lại thẻ / chìa`, swaps && `${swaps} yêu cầu đổi ô`].filter(Boolean).join(', ');
  };
  // Khách có mặt: họ tên + chữ ký + mã OTP khách đọc (đã gửi cho đúng hợp đồng này). Khách vắng mặt: như cũ (chỉ quản lý, kèm lý do).
  const recvOk = recvMode === 'SIGN' ? otpSent && OTP_RE.test(otpCode.trim()) : isFM && absentReason.trim().length >= 5;
  const pickedUp = (x: RentalContract) => {
    if (!window.confirm(`Khách ${userName(db, x.customerId)} đã lấy hết đồ để lại ở kho ${unitLabel(db, x.unitId)}?`)) return;
    void run('resolveLeftover', { contractId: x._id, outcome: 'PICKED_UP' }, (v) => (v.accessResetPending ? `Đã ghi nhận khách lấy đồ — còn việc: ${v.accessResetTask}, ô chưa mở cho thuê` : 'Đã ghi nhận khách lấy đồ — ô kho trống lại'));
  };
  const withdraw = (x: RentalContract) => {
    if (!window.confirm(`Rút đăng ký trả kho của ${userName(db, x.customerId)} — kho ${unitLabel(db, x.unitId)}?
Hợp đồng tiếp tục và tiếp tục tính tiền thuê.`)) return;
    void run('cancelMoveOut', { contractId: x._id }, 'Đã rút đăng ký trả kho', () => setActive(null));
  };

  // ---- Chỉ để trình bày (không đổi luồng): bước hiện tại, số mục có vấn đề.
  const occupied = unit?.status === 'OCCUPIED';
  // Đợt 17 (A1): bản ghi của đúng hợp đồng này còn chờ. Dữ liệu cũ bàn giao trước khi có bước này thì chưa có bản ghi — server tạo khi lập biên bản, ghi nhận ở "Ô chờ thu chìa".
  const resetPending = !!c && !!unit?.accessReset && !unit.accessReset.doneAt && unit.accessReset.contractId === c._id;
  const checkedCount = ITEMS.filter((i) => checked[i]).length;
  const allChecked = checkedCount === ITEMS.length;
  // Khách có mặt (tự ký, hoặc ô đã nhận lại và nhân viên đang lập biên bản) mới thu được ngay; khách vắng mặt → để thành nợ.
  const collectNow = shortfall > 0 && afterDebt === 'COLLECT' && !(occupied && recvMode === 'ABSENT');
  const queueState = (x: RentalContract) => (byId(db.units, x.unitId)?.status === 'PENDING_INSPECTION' ? QUEUE_STATE.report : QUEUE_STATE.handover);
  // Thời gian thuê (để hiểu dòng "Trả kho sớm" ở quyết toán): mốc trả kho = ngày đã bàn giao, chưa bàn giao thì hôm nay (như server).
  const settleDay = c ? settlementDateOf(c) : todayISO();
  // RV3: kiểm tra cùng khách → chốt đồ để lại & quyết toán → khách ký biên bản (ô đã nhận lại từ trước thì bước ký đã xong).
  const inspected = allChecked && left !== null && leftOk;
  const moveSteps: { label: string; icon: ReactNode; state: StepState }[] = [
    { label: 'Kiểm tra cùng khách', icon: <ClipboardCheck />, state: inspected ? 'done' : 'current' },
    { label: 'Quyết toán', icon: <Wallet />, state: overStaffLimit ? 'blocked' : inspected ? 'current' : 'todo' },
    { label: 'Khách xác nhận OTP', icon: <MailCheck />, state: !occupied ? 'done' : recvOk ? 'current' : 'todo' },
  ];
  const INSPECTION_TYPE: Record<InspectionLog['type'], string> = { MOVE_IN: 'Nhận kho', MOVE_OUT: 'Trả kho', ROUTINE: 'Định kỳ', MAINTENANCE: 'Bảo trì', ABANDONMENT: 'Hàng bỏ lại' };

  return (
    <>
      <PageHeader title="Trả kho & kiểm tra" actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="self-start">
          <PanelHeader icon={<PackageOpen className="size-4" />} tone="violet" title="Chờ trả kho" count={pending.length}
            tip={`${QUEUE_STATE.handover.label}: khách đã đăng ký trả kho, ô vẫn đang thuê — kiểm tra cùng khách rồi khách xác nhận bằng mã OTP. ${QUEUE_STATE.report.label}: ô đã nhận lại, chỉ còn lập biên bản.`} />
          {pending.length === 0 ? <EmptyState compact icon={<PackageOpen className="size-5" />} title="Không có lượt trả kho" /> : (
            <ul className="divide-y divide-stone-100">
              {pending.map((x) => {
                const s = queueState(x);
                return (
                  <QueueRow key={x._id} active={c?._id === x._id} onSelect={() => start(x)}
                    lead={<UnitTag label={unitLabel(db, x.unitId)} size="sm" />}
                    title={userName(db, x.customerId)}
                    meta={<>
                      <Meta icon={<CalendarDays />}>Hẹn {fmtDate(x.moveOut?.scheduledFor)}</Meta>
                      <Badge tone={s.tone} dot>{s.label}</Badge>
                    </>}
                  />
                );
              })}
            </ul>
          )}
          <div className="space-y-2.5 border-t border-stone-100 p-4 sm:p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <UserPlus className="size-4 text-stone-400" />Khách đến trả kho chưa đăng ký
              {user?.role === 'STAFF' && <InfoTip align="end">Hợp đồng quá hạn / bị khoá: nhờ quản lý chi nhánh lập.</InfoTip>}
            </p>
            <select className={inputCls} value={walkIn} onChange={(e) => setWalkIn(e.target.value)} aria-label="Hợp đồng">
              <option value="">Chọn hợp đồng…</option>
              {walkInCandidates.map((x) => (
                <option key={x._id} value={x._id}>{unitLabel(db, x.unitId)} · {userName(db, x.customerId)}{x.status === 'DELINQUENT' ? ' · quá hạn' : x.status === 'LOCKED_OUT' ? ' · bị khoá' : ''}</option>
              ))}
            </select>
            {walkIn && <input className={inputCls} maxLength={300} value={walkInReason} onChange={(e) => setWalkInReason(e.target.value)} placeholder="Lý do (bắt buộc)" aria-label="Lý do" />}
            <Button size="sm" className="w-full" disabled={!walkIn || walkInReason.trim().length < 5} onClick={registerWalkIn}>Đăng ký trả kho hôm nay</Button>
          </div>
        </Card>

        {!c ? (
          <Card className="self-start"><EmptyState icon={<ClipboardCheck className="size-6" />} title="Chọn một lượt trả kho" description="Bấm một dòng trong danh sách chờ trả kho." /></Card>
        ) : (
          <Card className="min-w-0">
            <div className="flex flex-wrap items-start gap-3 border-b border-stone-100 p-4 sm:p-5">
              <UnitTag label={unitLabel(db, c.unitId)} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-ink">{userName(db, c.customerId)}</h2>
                <ChipRow className="mt-1.5">
                  <Chip tone={queueState(c).tone}>{queueState(c).label}</Chip>
                  <Chip icon={<Warehouse />}>{typeName(db, c.unitTypeId)}</Chip>
                  <Chip icon={<FileText />} mono>HĐ {c.contractNumber}</Chip>
                  <Chip icon={<CalendarDays />}>Hẹn {fmtDate(c.moveOut?.scheduledFor)}</Chip>
                  <Chip icon={<Wallet />}>Giữ chân {vnd(c.deposit.amount)}</Chip>
                  {c.balance.outstanding > 0 && <Chip icon={<Banknote />} tone="red">Nợ {vnd(c.balance.outstanding)}</Chip>}
                </ChipRow>
                {/* Thời gian thuê — để hiểu dòng "Trả kho sớm" ở quyết toán (mốc trả kho như server: ngày đã bàn giao, chưa bàn giao thì hôm nay). */}
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  <div><dt className="text-stone-500">Bắt đầu</dt><dd className="font-medium text-ink">{fmtDate(c.startDate)}</dd></div>
                  <div><dt className="text-stone-500">Kỳ hạn</dt><dd className="font-medium text-ink">{contractTermText(c)}, đến hết {fmtDate(lastDayOf(c.endDate))}</dd></div>
                  <div><dt className="text-stone-500">{c.moveOut?.returnedOn ? 'Đã bàn giao' : 'Trả kho'}</dt><dd className="font-medium text-ink">{c.moveOut?.returnedOn ? fmtDate(settleDay) : `Hôm nay ${fmtDate(settleDay)}`}</dd></div>
                  <div><dt className="text-stone-500">Đã thuê</dt><dd className="font-medium text-ink">{monthsDaysText(monthsDaysBetween(c.startDate, settleDay))}</dd></div>
                </dl>
              </div>
            </div>
            <div className="border-b border-stone-100 px-4 py-4 sm:px-5"><StepTrack steps={moveSteps} className="mx-auto max-w-md" /></div>
            <div className="space-y-6 p-4 sm:p-5">
              {(
                <div className="space-y-6">
                  <StepBlock n={1} state={allChecked ? 'done' : 'current'} icon={<ClipboardCheck />} title="Danh mục kiểm tra"
                    aside={<>
                      <Chip tone={allChecked ? 'green' : 'gray'}>Đã kiểm {checkedCount}/{ITEMS.length}</Chip>
                      {!allChecked && <Button size="sm" variant="secondary" onClick={() => setChecked(Object.fromEntries(ITEMS.map((i) => [i, true])))}><CircleCheck className="size-3.5" />Đã kiểm tất cả</Button>}
                    </>}>
                    <ul className="divide-y divide-stone-100 rounded-xl ring-1 ring-inset ring-stone-200">
                      {ITEMS.map((item) => (
                        <li key={item}>
                          <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
                            <input type="checkbox" className="size-4 shrink-0" checked={!!checked[item]} onChange={(e) => setChecked((s) => ({ ...s, [item]: e.target.checked }))} />
                            <span className="flex-1">{item}</span>
                            <span className={cx('text-xs', checked[item] ? 'text-emerald-700' : 'text-stone-400')}>{checked[item] ? 'Đã kiểm' : 'Chưa kiểm'}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-stone-500">Có hư hại thì ghi ở mục 2 kèm chi phí và ảnh.</p>
                  </StepBlock>

                  <StepBlock n={2} state={damages.some((d) => !d.description.trim()) ? 'current' : 'done'} icon={<Hammer />} title="Hư hại & chi phí"
                    aside={<>
                      {damageTotal > 0 && <Chip tone="red">{vnd(damageTotal)}</Chip>}
                      <Button size="sm" variant="secondary" onClick={() => { setDamages((d) => [...d, { description: '', severity: 'MINOR', cost: 0, photoUrls: [] }]); setPhotoText((p) => [...p, '']); }}><Plus className="size-3.5" />Thêm</Button>
                    </>}>
                    {damages.length === 0 && <p className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-sm text-stone-500 ring-1 ring-inset ring-stone-200"><CircleCheck className="size-4 text-emerald-500" />Không ghi nhận hư hại.</p>}
                    <div className="space-y-2">
                      {damages.map((d, i) => (
                        <div key={i} className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                          <div className="flex items-center gap-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-red-100 text-xs font-bold text-red-700">{i + 1}</span>
                            <input className={cx(inputCls, 'flex-1')} placeholder="Mô tả hư hại" value={d.description} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                            <Button variant="dangerOutline" size="sm" onClick={() => { setDamages((arr) => arr.filter((_, j) => j !== i)); setPhotoText((arr) => arr.filter((_, j) => j !== i)); }} aria-label="Xóa"><Trash2 className="size-4" /></Button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select className={inputCls} aria-label="Mức độ" value={d.severity} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, severity: e.target.value as Damage['severity'] } : x)))}>
                              <option value="MINOR">Nhẹ</option><option value="MODERATE">Vừa</option><option value="SEVERE">Nặng (cần bảo trì)</option>
                            </select>
                            <input className={inputCls} type="number" min={0} step={10000} placeholder="Chi phí" aria-label="Chi phí" value={d.cost || ''} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, cost: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} />
                          </div>
                          <PhotoUploadInput max={10} value={photoText[i] ?? ''} onChange={(v) => setPhotoText((arr) => { const next = [...arr]; next[i] = v; return next; })} />
                        </div>
                      ))}
                    </div>
                    <textarea className={cx(inputCls, 'mt-3')} rows={2} placeholder="Ghi chú thêm" aria-label="Ghi chú thêm" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </StepBlock>

                  <StepBlock n={3} state={left !== null && leftOk ? 'done' : 'current'} icon={<Package />} title="Đồ khách để lại"
                    aside={<Segmented<boolean> label="Đồ khách để lại" value={left} onChange={setLeft} options={[{ value: false, label: 'Không', tone: 'green' }, { value: true, label: 'Có', tone: 'amber' }]} />}>
                    {left === null && <p className="text-xs text-stone-500">Khách mang hết đồ về → “Không”. Còn đồ khách không mang về → “Có”, chụp ảnh và báo cách xử lý.</p>}
                    <Disclosure variant="plain" icon={<PackageOpen className="size-4" />} title="Đồ khách đã khai — đối chiếu" className="mb-2">
                      <GoodsReference contractId={c._id} />
                    </Disclosure>
                    {left && (
                      <div className="space-y-2">
                        <input className={inputCls} maxLength={500} placeholder="Mô tả đồ để lại" aria-label="Mô tả đồ để lại" value={leftDesc} onChange={(e) => setLeftDesc(e.target.value)} />
                        <PhotoUploadInput max={10} required value={leftPhotos} onChange={setLeftPhotos} />
                        <Callout tone="amber" icon={<Timer />}>
                          Báo khách trước khi xác nhận: chi nhánh giữ đồ {LEFTOVER_HOLD_DAYS} ngày (đến lấy bất cứ lúc nào). Quá hạn thì chi nhánh xử lý và có thể tính phí theo Điều 9 — ghi trong biên bản khách ký.
                        </Callout>
                      </div>
                    )}
                  </StepBlock>

                  <StepBlock n={4} state={overStaffLimit ? 'blocked' : 'current'} icon={<Wallet />} title="Quyết toán tiền giữ chân">
                    <Ledger>
                      <LedgerRow label="Tiền giữ chân đang giữ" value={vnd(c.deposit.amount)} />
                      <LedgerRow label="Chi phí hư hại" tone={damageTotal > 0 ? 'bad' : 'default'} value={`−${vnd(damageTotal)}`} />
                      {c.balance.outstanding > 0 && <LedgerRow label="Công nợ còn lại" tone="bad" value={`−${vnd(c.balance.outstanding)}`} />}
                      {shortfall > 0 && <LedgerRow label="Vượt tiền giữ chân — còn nợ" tip="Hư hại + công nợ vượt tiền giữ chân: khách còn nợ phần chênh sau quyết toán." tone="bad" value={vnd(shortfall)} />}
                      {earlyTermination && (
                        <LedgerRow label="Trả kho sớm" tone="warn" tip={`Bàn giao ${fmtDate(settlementDateOf(c))}, đã dùng ${earlyTermination.elapsedPct}% kỳ hạn.`} value={`trần ${earlyTermination.refundCapPct}% tiền giữ chân`} />
                      )}
                      {claw && <LedgerRow label="Thu hồi ưu đãi thuê dài hạn" tone="warn" tip={`Mới dùng ${claw.usedPeriods} tháng.`} value={`−${vnd(clawback)}`} />}
                      {unusedRent > 0 && (
                        <LedgerRow label="Tiền thuê trả trước chưa dùng" tone="good" value={`+${vnd(unusedRent - rentOffset)}`}
                          tip={`Tiền thuê trả trước của các kỳ gia hạn chưa dùng (gồm phần chênh đổi cỡ kho đã trả)${rentOffset > 0 ? ` (cấn ${vnd(rentOffset)} vào phần vượt tiền giữ chân)` : ''}.`} />
                      )}
                      {credits > 0 && (
                        <LedgerRow label="Dịch vụ / phí cấp lại đã huỷ" tone="good" value={`+${vnd(credits - creditOffset)}`}
                          tip={`Tiền đơn dịch vụ chưa làm / phí cấp lại thẻ, chìa bị huỷ khi nhận lại kho${creditOffset > 0 ? ` (cấn ${vnd(creditOffset)} vào phần vượt tiền giữ chân)` : ''}.`} />
                      )}
                      <LedgerRow total label="Hoàn lại khách" value={vnd(refundTotal)} />
                      {shortfall > 0 && <LedgerRow total label="Khách cần trả thêm" tone="bad" value={vnd(shortfall)} />}
                    </Ledger>
                    {shortfall > 0 && (
                      <Callout tone="amber" icon={<Banknote />} className="mt-3" title={`Khách cần trả thêm ${vnd(shortfall)}`}>
                        {occupied && recvMode === 'ABSENT' ? (
                          <p>Khách vắng mặt — khoản này thành nợ sau quyết toán. Khách trả sau trên web / app, hoặc tại quầy (mục &quot;Khách đến trả nợ&quot;).</p>
                        ) : (
                          <div className="space-y-2">
                            <Segmented<'COLLECT' | 'DEBT'> label="Khoản cần trả thêm" value={afterDebt} onChange={setAfterDebt}
                              options={[{ value: 'COLLECT', label: 'Thu tại quầy ngay', icon: <Banknote /> }, { value: 'DEBT', label: 'Để thành nợ', icon: <FileText /> }]} />
                            <p className="text-xs">{afterDebt === 'COLLECT'
                              ? 'Hoàn tất xong sẽ mở bước thu: tiền mặt, chuyển khoản, thẻ hoặc VNPAY QR, có biên lai.'
                              : 'Thành nợ sau quyết toán — khách trả sau trên web / app, hoặc tại quầy (mục "Khách đến trả nợ"). Chưa trả thì chưa đặt kho mới được.'}</p>
                          </div>
                        )}
                      </Callout>
                    )}
                  </StepBlock>

                  {resetPending && unit?.accessReset && (
                    <AccessResetCheck method={unit.accessReset.method} keyTag={unit.accessReset.keyTag} checked={inspReset} onChange={setInspReset} />
                  )}

                  {occupied && (
                    <StepBlock n={5} state={recvOk ? 'done' : 'current'} icon={<MailCheck />} title="Khách xác nhận bằng mã OTP">
                      <div className="space-y-3 text-sm">
                        <p className="text-stone-600">Khách xem lại danh mục kiểm tra, hư hại, đồ để lại và quyết toán ở trên rồi đọc mã OTP nhận qua email để xác nhận. Không ký tay trên màn hình — nhân viên không ký hộ khách. Xác nhận xong: thu hồi quyền vào kho{openItemsOf(c) ? `, tự huỷ và hoàn ${openItemsOf(c)}` : ''}, đóng hợp đồng.</p>
                        {isFM && (
                          <Segmented<'SIGN' | 'ABSENT'> label="Xác nhận" value={recvMode} onChange={setRecvMode}
                            options={[{ value: 'SIGN', label: 'Khách có mặt (OTP)', icon: <MailCheck /> }, { value: 'ABSENT', label: 'Khách vắng mặt', icon: <UserX /> }]} />
                        )}
                        {recvMode === 'SIGN' ? (
                          <>
                            {/* Xác minh đúng chủ hợp đồng: mã OTP gửi tới email tài khoản, khách đọc mã cho nhân viên nhập. */}
                            <div className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                              <p className="flex items-center gap-2 font-medium text-ink">
                                <MailCheck className="size-4 text-stone-400" />Xác minh bằng mã OTP
                                <InfoTip align="start">Mã gửi tới email tài khoản của chủ hợp đồng. Khách đọc mã, bạn nhập vào ô dưới.</InfoTip>
                              </p>
                              <Button size="sm" variant="secondary" disabled={busy || otpWait > 0} onClick={() => void sendOtp()}>
                                <MailCheck className="size-3.5" />{otpWait > 0 ? `Gửi lại sau ${otpWait}s` : otpSent ? 'Gửi lại mã' : 'Gửi mã OTP tới email khách'}
                              </Button>
                              {otpSent && (
                                <Field label={`Mã đã gửi tới ${otp!.sentTo}`} hint={otp!.demoCode ? `Mã thử: ${otp!.demoCode} · mã gồm 6 số, hiệu lực 10 phút` : 'Mã gồm 6 số, hiệu lực 10 phút'}>
                                  <input className={cx(inputCls, 'font-mono tracking-[0.3em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" aria-label="Mã OTP" />
                                </Field>
                              )}
                            </div>
                          </>
                        ) : (
                          <Field label="Lý do khách vắng mặt">
                            <textarea className={inputCls} rows={2} maxLength={300} value={absentReason} onChange={(e) => setAbsentReason(e.target.value)} placeholder="VD: khách gửi chìa qua bảo vệ, đã gọi xác nhận" />
                          </Field>
                        )}
                        <AccessResetCheck method={c.access.method} keyTag={c.access.keyTag} checked={recvReset} onChange={setRecvReset} />
                      </div>
                    </StepBlock>
                  )}

                  <ActionBar note={overStaffLimit && <Callout tone="amber" icon={<ShieldAlert />}>Chi phí hư hại trên {vnd(DAMAGE_STAFF_LIMIT)} cần Quản lý chi nhánh lập biên bản — báo quản lý hoàn tất trả kho này.</Callout>}>
                    {occupied && !c.access.revokedAt && <Button variant="secondary" onClick={() => withdraw(c)}>Rút đăng ký</Button>}
                    <Button variant="secondary" onClick={() => setActive(null)}>Để sau</Button>
                    <Button onClick={() => ((occupied ? !recvReset : resetPending && !inspReset) ? setRemindReset(true) : setConfirmDone(true))} disabled={!allChecked || damages.some((d) => !d.description.trim()) || overStaffLimit || !leftOk || (occupied && !recvOk)}>
                      <CircleCheck className="size-4" />{occupied ? 'Khách đã xác nhận — hoàn tất trả kho' : 'Hoàn tất & đóng hợp đồng'}
                    </Button>
                  </ActionBar>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <Modal open={confirmDone && !!c} onClose={() => setConfirmDone(false)} title="Hoàn tất trả kho & đóng hợp đồng"
        description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}` : ''}
        footer={<><Button variant="secondary" onClick={() => setConfirmDone(false)}>Quay lại</Button><Button onClick={() => void submit()}>Xác nhận đóng hợp đồng</Button></>}>
        <div className="space-y-4 text-sm">
          <FactGrid>
            <Fact icon={<Hammer className="size-4" />} label="Chi phí hư hại" tone={damageTotal > 0 ? 'red' : 'gray'}>{vnd(damageTotal)}</Fact>
            <Fact icon={<Banknote className="size-4" />} label="Công nợ trừ vào quyết toán">{vnd(c?.balance.outstanding ?? 0)}</Fact>
            <Fact icon={<Wallet className="size-4" />} label="Hoàn lại khách" tone="green">{vnd(refundTotal)}</Fact>
            <Fact icon={<TriangleAlert className="size-4" />} label="Khách cần trả thêm" tone={shortfall > 0 ? 'red' : 'gray'}>{shortfall > 0 ? `${vnd(shortfall)} · ${collectNow ? 'thu tại quầy ngay' : 'để thành nợ'}` : 'Không'}</Fact>
            <Fact icon={<Package className="size-4" />} label="Đồ khách để lại" tone={left ? 'amber' : 'gray'}>{left ? `Có — giữ ${LEFTOVER_HOLD_DAYS} ngày` : 'Không'}</Fact>
            {resetPending && unit?.accessReset && <Fact icon={<KeyRound className="size-4" />} label="Chìa / thẻ, ổ khoá" tone={inspReset ? 'green' : 'amber'}>{inspReset ? 'Ghi nhận cùng lúc này' : `Chưa ${accessResetTaskText(unit.accessReset.method, unit.accessReset.keyTag)} — ô chưa mở cho thuê`}</Fact>}
            {occupied && <Fact icon={<PenLine className="size-4" />} label="Xác nhận biên bản" tone="green">{recvMode === 'SIGN' ? `Khách xác nhận bằng mã OTP gửi ${otp?.sentTo ?? ''}` : 'Quản lý xác nhận khách vắng mặt'}</Fact>}
          </FactGrid>
          <Callout tone="amber" icon={<TriangleAlert />}>Không hoàn tác được — sai thì chỉ điều chỉnh khi khách khiếu nại.</Callout>
        </div>
      </Modal>

      {/* Quyết toán còn thiếu, đã chọn thu ngay: thu công nợ của hợp đồng vừa đóng tại quầy (cùng đường thu nợ ở trang chủ nhân viên). Đóng hộp = để thành nợ. */}
      <CounterCollectDialog contract={collectId ? db.contracts.find((x) => x._id === collectId) ?? null : null} onClose={() => setCollectId(null)} />

      {/* Nhắc nhận lại chìa / thẻ (đặt lại khoá) ngay lúc khách rời ô; ô chưa ghi nhận nằm ở mục riêng của trang Cấp lại thẻ / chìa, mở hộ. */}
      {c && (
        <AccessResetReminder open={remindReset} onClose={() => setRemindReset(false)}
          method={occupied ? c.access.method : unit?.accessReset?.method} keyTag={occupied ? c.access.keyTag : unit?.accessReset?.keyTag}
          unit={unitLabel(db, c.unitId)} customer={userName(db, c.customerId)}
          onCollected={() => { if (occupied) setRecvReset(true); else setInspReset(true); setRemindReset(false); setConfirmDone(true); }}
          onLater={() => { setRemindReset(false); setConfirmDone(true); }} />
      )}

      {held.length > 0 && (
        <Card className="mt-6">
          <PanelHeader icon={<Package className="size-4" />} tone="amber" title="Đồ đang giữ" count={held.length} tip={`Đồ khách để lại sau trả kho — ô giữ ${LEFTOVER_HOLD_DAYS} ngày, chưa cho thuê lại.`} />
          <ul className="divide-y divide-stone-100">
            {held.map((x) => {
              const due = todayISO().slice(0, 10) >= x.leftover!.holdUntil.slice(0, 10);
              return (
                <QueueRow key={x._id}
                  lead={<UnitTag label={unitLabel(db, x.unitId)} size="sm" />}
                  title={x.leftover!.description}
                  meta={<>
                    <Meta icon={<UserRound />}>{userName(db, x.customerId)}</Meta>
                    <Meta icon={<Timer />} className={due ? 'font-medium text-red-700' : undefined}>Giữ đến {fmtDate(x.leftover!.holdUntil)}{due ? ' · đã hết hạn giữ' : ''}</Meta>
                    <PhotoLinks urls={x.leftover!.photoUrls} />
                  </>}
                  actions={<>
                    <Button size="sm" variant="secondary" onClick={() => pickedUp(x)}><Package className="size-3.5" />Khách đã lấy</Button>
                    {isFM && todayISO().slice(0, 10) >= x.leftover!.holdUntil.slice(0, 10) && (
                      <Button size="sm" variant="danger" onClick={() => { setDisposeForm({ fee: 0, note: '' }); setDispose(x); }}>Đã xử lý</Button>
                    )}
                  </>}
                />
              );
            })}
          </ul>
        </Card>
      )}

      <Modal open={!!dispose} onClose={() => setDispose(null)} title="Xử lý đồ khách để lại"
        description={dispose ? `${userName(db, dispose.customerId)} · kho ${unitLabel(db, dispose.unitId)} · giữ đến ${fmtDate(dispose.leftover?.holdUntil)}` : ''}
        footer={<Button variant="danger" disabled={disposeForm.note.trim().length < 3 || disposeOverLimit || disposeForm.fee > LEFTOVER_FEE_MAX}
          onClick={() => dispose && void run('resolveLeftover', { contractId: dispose._id, outcome: 'DISPOSED', fee: disposeForm.fee, note: disposeForm.note.trim() },
            (v) => `${disposeForm.fee > 0 ? `Đã xử lý — ghi phí ${vnd(disposeForm.fee)} vào công nợ khách` : 'Đã xử lý đồ để lại'}${v.accessResetPending ? ` · còn việc: ${v.accessResetTask}, ô chưa mở cho thuê` : disposeForm.fee > 0 ? '' : ' — ô kho trống lại'}`, () => setDispose(null))}>Xác nhận</Button>}>
        <div className="space-y-4">
          <Field label="Phí xử lý (VND)" hint="Điều 9 · 0 nếu không thu">
            <input type="number" min={0} step={10_000} className={inputCls} value={disposeForm.fee}
              onChange={(e) => setDisposeForm((f) => ({ ...f, fee: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
          </Field>
          {disposeOverLimit && (
            <Callout tone="amber" icon={<ShieldAlert />}>
              Phí trên {vnd(CLAIM_FM_APPROVAL_LIMIT)} — cần Quản lý vận hành xử lý (mục Duyệt & chi). Giảm phí hoặc chuyển cho vận hành.
            </Callout>
          )}
          {disposeForm.fee > LEFTOVER_FEE_MAX && <p className="text-xs font-medium text-red-700">Phí xử lý tối đa {vnd(LEFTOVER_FEE_MAX)}.</p>}
          <Field label="Cách xử lý">
            <textarea className={inputCls} rows={2} maxLength={500} value={disposeForm.note} onChange={(e) => setDisposeForm((f) => ({ ...f, note: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <Disclosure className="mt-6 shadow-card" icon={<History className="size-4" />} title="Lịch sử kiểm tra" meta={`${history.length} lượt`}>
        <div className="-mx-4 -mb-4 overflow-hidden rounded-b-xl border-t border-stone-100">
          <Table rows={history} rowKey={(i) => i._id} empty={<EmptyState compact icon={<History className="size-5" />} title="Chưa có lượt kiểm tra" />} columns={[
            { key: 't', header: 'Thời gian', cell: (i) => <span className="whitespace-nowrap">{fmtDateTime(i.performedAt)}</span> },
            { key: 'u', header: 'Kho', cell: (i) => <span className="font-semibold">{unitLabel(db, i.unitId)}</span> },
            { key: 'k', header: 'Loại', cell: (i) => <Badge>{INSPECTION_TYPE[i.type]}</Badge> },
            { key: 'by', header: 'Người kiểm tra', cell: (i) => userName(db, i.inspectorId) },
            { key: 'o', header: 'Kết quả', cell: (i) => (i.outcome ? <StatusBadge map={INSPECTION_OUTCOME} value={i.outcome} /> : '—') },
            { key: 'f', header: 'Hư hại', className: 'text-right tabular-nums', cell: (i) => vnd(i.totalDamageFee) },
            { key: 'r', header: 'Hoàn tiền giữ chân', className: 'text-right tabular-nums', cell: (i) => (i.depositSettlement ? vnd(i.depositSettlement.refundAmount) : '—') },
          ]} />
        </div>
      </Disclosure>
    </>
  );
}
