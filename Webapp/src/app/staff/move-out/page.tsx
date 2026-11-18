'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Banknote, CalendarDays, CircleCheck, ClipboardCheck, FileText, Hammer, History, KeyRound, MailCheck, Package, PackageOpen, PenLine, Plus,
  Send, ShieldAlert, ShieldCheck, Timer, Trash2, TriangleAlert, Undo2, UserPlus, UserRound, UserX, Wallet, Warehouse,
} from 'lucide-react';
import type { InspectionLog, RentalContract } from '@ssm/shared';
import { CLAIM_FM_APPROVAL_LIMIT, contractTermText, INSPECTION_DISPUTE_DAYS, INSPECTION_STATUS, lastDayOf, LEFTOVER_FEE_MAX, LEFTOVER_HOLD_DAYS, monthsDaysBetween, monthsDaysText, MOVE_OUT_CHECKLIST, OPEN_ACCESS_REQUEST_STATUSES, OPEN_SERVICE_ORDER_STATUSES, OPEN_SWAP_STATUSES } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { INSPECTION_OUTCOME } from '@/shared/lib/labels';
import { byId, settlementDateOf, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, ButtonLink, Card, Disclosure, EmptyState, Field, InfoTip, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { PhotoLinks, PhotoUploadInput, parsePhotoLinks } from '@/shared/ui/photo-links';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { GoodsReference } from '@/features/intake/contract-goods';
import { AccessResetCheck, AccessResetReminder, accessResetTaskText } from '@/features/access/unit-access-fields';
import { CounterCollectDialog } from '@/features/payments/counter-collect';
import { MoveOutReportBody, moveOutReportOf, moveOutStage, SettlementLedger, settlementRefundTotal } from '@/features/contracts/move-out-settlement';
import { ActionBar, Callout, Chip, ChipRow, Fact, FactGrid, Meta, PanelHeader, QueueRow, Segmented, StepBlock, StepTrack, UnitTag, type StepState } from '@/features/staff-ui';

type Damage = { description: string; severity: InspectionLog['damages'][number]['severity'] };
const OTP_RE = /^\d{6}$/;
const INSPECTION_TYPE: Record<InspectionLog['type'], string> = { MOVE_IN: 'Nhận kho', MOVE_OUT: 'Trả kho', ROUTINE: 'Định kỳ', MAINTENANCE: 'Bảo trì', ABANDONMENT: 'Hàng bỏ lại' };

/**
 * TRẢ KHO BA BƯỚC (đợt 17): (1) nhận lại ô / chìa → (2) nhân viên kiểm ô, ghi hư hại (mô tả, mức độ, ảnh — KHÔNG ghi tiền), đồ để lại rồi
 * gửi quản lý → (3) Quản lý chi nhánh ghi phí sửa chữa / phí khác rồi duyệt (trang Duyệt trả kho) → (4) khách xem biên bản + quyết toán đã
 * duyệt và xác nhận SAU CÙNG bằng mã OTP (hoặc quản lý xác nhận khách vắng mặt) — lúc đó mới đóng hợp đồng và quyết toán.
 */
export default function MoveOutPage() {
  const { db, user, run, busy } = useStore();
  const scope = useFacilityScope();
  const [active, setActive] = useState<RentalContract | null>(null);
  // ---- bước 2: biên bản kiểm ô
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [damages, setDamages] = useState<Damage[]>([]);
  const [photoText, setPhotoText] = useState<string[]>([]); // ảnh của từng hư hại (link ảnh đã tải lên, cách nhau xuống dòng)
  const [notes, setNotes] = useState('');
  const [left, setLeft] = useState<boolean | null>(null); // đồ khách để lại (bắt buộc khai): null = chưa chọn
  const [leftDesc, setLeftDesc] = useState('');
  const [leftPhotos, setLeftPhotos] = useState('');
  // ---- chìa / thẻ (đợt 17 A1): tick ở bước nhận ô; ô nhận trước đó mà chưa ghi nhận thì nhắc lại ở bước kiểm / bước cuối.
  const [recvReset, setRecvReset] = useState(false);
  const [inspReset, setInspReset] = useState(false);
  const [remind, setRemind] = useState<'receive' | 'confirm' | null>(null);
  // ---- bước cuối: khách xác nhận bằng OTP (mã gửi tới email tài khoản chủ hợp đồng) hoặc quản lý xác nhận khách vắng mặt.
  const [recvMode, setRecvMode] = useState<'SIGN' | 'ABSENT'>('SIGN');
  const [absentReason, setAbsentReason] = useState('');
  const [otp, setOtp] = useState<{ contractId: string; sentTo: string; resendAt: number; demoCode?: string } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [confirmDone, setConfirmDone] = useState(false); // hộp tóm tắt "không hoàn tác được" — chỉ mở SAU khi mã đã đúng
  // Quyết toán còn thiếu: thu ngay tại quầy sau khi xác nhận, hoặc để thành nợ (khách trả sau trên web / app / tại quầy).
  const [afterDebt, setAfterDebt] = useState<'COLLECT' | 'DEBT'>('COLLECT');
  const [collectId, setCollectId] = useState<string | null>(null);
  // ---- khác
  const [walkIn, setWalkIn] = useState('');
  const [walkInReason, setWalkInReason] = useState('');
  const [dispose, setDispose] = useState<RentalContract | null>(null);
  const [disposeForm, setDisposeForm] = useState({ fee: 0, note: '' });
  const isFM = user?.role === 'FACILITY_MANAGER';
  // Phí xử lý đồ để lại trên ngưỡng duyệt của chi nhánh chỉ Quản lý vận hành lập (server trả 403 DISPOSAL_LIMIT) — chặn ngay ở đây.
  const disposeOverLimit = user?.role !== 'OPS_MANAGER' && disposeForm.fee > CLAIM_FM_APPROVAL_LIMIT;

  const pending = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && c.status === 'MOVE_OUT_PENDING');
  // Khách đến quầy trả kho mà chưa tự đăng ký (VD còn nợ nên app không cho): nhân viên lập đăng ký hộ — đang quá hạn / bị khoá thì quản lý lập.
  const walkInStatuses = isFM ? ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT'] : ['ACTIVE'];
  const walkInCandidates = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && walkInStatuses.includes(c.status))
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
  // Đồ khách để lại sau trả kho — ô đang giữ (MAINTENANCE) đến hết hạn giữ.
  const held = db.contracts.filter((x) => scope.facilityIds.includes(x.facilityId) && x.leftover?.status === 'HELD')
    .sort((a, b) => a.leftover!.holdUntil.localeCompare(b.leftover!.holdUntil));
  const history = db.inspections.filter((i) => scope.facilityIds.includes(i.facilityId)).sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  const c = active ? db.contracts.find((x) => x._id === active._id) ?? null : null;
  const unit = c ? byId(db.units, c.unitId) : undefined;
  const report = c ? moveOutReportOf(db, c._id) : undefined;
  const st = c ? moveOutStage(db, c) : null;
  const preview = report?.status === 'FM_APPROVED' ? report.review?.settlementPreview ?? null : null;

  /** Mở một lượt: biên bản bị trả lại thì điền sẵn nội dung đã gửi để nhân viên sửa. */
  const start = (x: RentalContract) => {
    const r = moveOutReportOf(db, x._id);
    const back = r?.status === 'RETURNED' ? r : null;
    setActive(x);
    setChecked(back ? Object.fromEntries(back.checklist.map((i) => [i.item, !!i.checked || !!i.condition])) : {});
    setDamages(back ? back.damages.map((d) => ({ description: d.description, severity: d.severity })) : []);
    setPhotoText(back ? back.damages.map((d) => d.photoUrls.join('\n')) : []);
    setNotes(back?.notes ?? '');
    setLeft(back ? !!back.leftItems?.present : null);
    setLeftDesc(back?.leftItems?.description ?? '');
    setLeftPhotos((back?.leftItems?.photoUrls ?? []).join('\n'));
    setRecvReset(false); setInspReset(false); setRemind(null);
    setRecvMode('SIGN'); setAbsentReason(''); setOtp(null); setOtpCode(''); setConfirmDone(false); setAfterDebt('COLLECT');
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

  // ---- Bước 1: nhận lại ô / chìa. Chưa tick "đã thu chìa / thẻ" → popup nhắc (Đã nhận = tick rồi nhận ô; Để sau = nhận ô, ghi nhận sau).
  const receive = async (accessReset: boolean) => {
    if (!c) return;
    await run('receiveUnit', { contractId: c._id, accessReset }, (v) => `Đã nhận lại ô ${unitLabel(db, c.unitId)} — kiểm ô rồi gửi biên bản cho quản lý duyệt${v.accessResetPending ? ` · còn việc: ${v.accessResetTask}` : ''}`);
  };

  // ---- Bước 2: biên bản gửi quản lý duyệt (không có tiền).
  const photosOf = (i: number) => parsePhotoLinks(photoText[i] ?? '').urls;
  const leftUrls = parsePhotoLinks(leftPhotos).urls;
  const leftOk = left === false || (left === true && leftDesc.trim().length >= 3 && leftUrls.length > 0);
  const checkedCount = MOVE_OUT_CHECKLIST.filter((i) => checked[i]).length;
  const allChecked = checkedCount === MOVE_OUT_CHECKLIST.length;
  const damagesOk = damages.every((d) => d.description.trim().length >= 2);
  // Đợt 17 (A1): bản ghi thu chìa / thẻ của đúng hợp đồng này còn chờ.
  const resetPending = !!c && !!unit?.accessReset && !unit.accessReset.doneAt && unit.accessReset.contractId === c._id;
  const submitReport = async () => {
    if (!c || left === null) return;
    if (resetPending && inspReset && unit) {
      const rec = await run('recordUnitAccessReset', { unitId: unit._id, note: 'Ghi nhận khi kiểm ô trả kho' });
      if (!rec.ok) return;
    }
    await run('submitInspection', {
      contractId: c._id,
      checklist: MOVE_OUT_CHECKLIST.map((item) => ({ item, checked: true })),
      damages: damages.map((d, i) => ({ description: d.description.trim(), severity: d.severity, photoUrls: photosOf(i) })),
      notes, leftItems: left ? { present: true, description: leftDesc.trim(), photoUrls: leftUrls } : { present: false },
    }, report?.status === 'RETURNED' ? 'Đã gửi lại biên bản — chờ quản lý chi nhánh duyệt' : 'Đã gửi biên bản — chờ quản lý chi nhánh ghi phí và duyệt');
  };

  // ---- Bước cuối: KIỂM MÃ TRƯỚC (sai thì dừng ở đây — không nhắc chìa, không mở hộp tóm tắt), rồi nhắc chìa nếu còn, rồi hộp tóm tắt.
  const recvOk = recvMode === 'SIGN' ? otpSent && OTP_RE.test(otpCode.trim()) : isFM && absentReason.trim().length >= 5;
  const shortfall = preview?.shortfall ?? 0;
  // Khách có mặt mới thu được ngay; khách vắng mặt → để thành nợ.
  const collectNow = shortfall > 0 && afterDebt === 'COLLECT' && recvMode === 'SIGN';
  const startConfirm = async () => {
    if (!c || !recvOk) return;
    if (recvMode === 'SIGN') {
      const chk = await run('checkMoveOutOtp', { contractId: c._id, otp: otpCode.trim() });
      if (!chk.ok) {
        // Mã sai (server đã đếm lượt) / hết hạn / sai quá số lần: xoá ô nhập; không đi tiếp.
        if (chk.code === 'EMAIL_OTP_INVALID' || chk.code === 'EMAIL_OTP_EXPIRED' || chk.code === 'EMAIL_OTP_REQUIRED') setOtpCode('');
        return;
      }
    }
    if (resetPending && !inspReset) { setRemind('confirm'); return; }
    setConfirmDone(true);
  };
  const confirm = async () => {
    if (!c) return;
    if (resetPending && inspReset && unit) {
      const rec = await run('recordUnitAccessReset', { unitId: unit._id, note: 'Ghi nhận khi khách xác nhận biên bản trả kho' });
      if (!rec.ok) return;
    }
    const handover = recvMode === 'SIGN'
      ? { method: 'CUSTOMER_SIGNATURE' as const, signerName: userName(db, c.customerId), otp: otpCode.trim() }
      : { method: 'MANAGER_CONFIRM' as const, reason: absentReason.trim() };
    const res = await run('confirmMoveOut', { contractId: c._id, handover }, (v) => {
      const ds = v.inspection.depositSettlement;
      const back = (ds?.refundAmount ?? 0) + (ds?.prepaidRentRefund ?? 0) + (ds?.creditRefund ?? 0);
      return `Đã đóng hợp đồng — hoàn khách ${vnd(back)}${(ds?.shortfall ?? 0) > 0 ? ` · khách cần trả thêm ${vnd(ds?.shortfall ?? 0)}` : ''}${v.inspection.leftItems?.present ? ` · giữ đồ khách ${LEFTOVER_HOLD_DAYS} ngày` : ''}${v.accessResetPending ? ` · còn việc: ${v.accessResetTask}, ô chưa mở cho thuê` : ''}`;
    });
    if (res.ok) {
      setConfirmDone(false); setActive(null);
      if (collectNow && (res.value.inspection.depositSettlement?.shortfall ?? 0) > 0) setCollectId(c._id);
    } else {
      setConfirmDone(false);
      if (res.code === 'EMAIL_OTP_EXPIRED' || res.code === 'OTP_INVALIDATED' || res.code === 'EMAIL_OTP_INVALID') setOtpCode('');
    }
  };

  // Đăng ký trả kho hộ khách tại quầy — đối chiếu đúng khách + mã kho trước khi gửi; bắt buộc lý do (khách được email báo).
  const registerWalkIn = () => {
    const x = byId(db.contracts, walkIn);
    if (!x || !window.confirm(`Đăng ký trả kho hôm nay cho:

Khách: ${userName(db, x.customerId)}
Kho: ${unitLabel(db, x.unitId)} · HĐ ${x.contractNumber}`)) return;
    void run('requestMoveOut', { contractId: x._id, date: todayISO(), reason: walkInReason.trim() }, 'Đã đăng ký trả kho — nhận lại ô ở danh sách trên', () => { setWalkIn(''); setWalkInReason(''); });
  };
  const openItemsOf = (x: RentalContract) => {
    const orders = db.serviceOrders.filter((o) => o.contractId === x._id && OPEN_SERVICE_ORDER_STATUSES.includes(o.status)).length;
    const access = db.accessRequests.filter((r) => r.contractId === x._id && OPEN_ACCESS_REQUEST_STATUSES.includes(r.status)).length;
    const swaps = db.swapRequests.filter((r) => r.contractId === x._id && OPEN_SWAP_STATUSES.includes(r.status)).length;
    return [orders && `${orders} đơn dịch vụ`, access && `${access} yêu cầu cấp lại thẻ / chìa`, swaps && `${swaps} yêu cầu đổi ô`].filter(Boolean).join(', ');
  };
  const pickedUp = (x: RentalContract) => {
    if (!window.confirm(`Khách ${userName(db, x.customerId)} đã lấy hết đồ để lại ở kho ${unitLabel(db, x.unitId)}?`)) return;
    void run('resolveLeftover', { contractId: x._id, outcome: 'PICKED_UP' }, (v) => (v.accessResetPending ? `Đã ghi nhận khách lấy đồ — còn việc: ${v.accessResetTask}, ô chưa mở cho thuê` : 'Đã ghi nhận khách lấy đồ — ô kho trống lại'));
  };
  const withdraw = (x: RentalContract) => {
    if (!window.confirm(`Rút đăng ký trả kho của ${userName(db, x.customerId)} — kho ${unitLabel(db, x.unitId)}?
Hợp đồng tiếp tục và tiếp tục tính tiền thuê.`)) return;
    void run('cancelMoveOut', { contractId: x._id }, 'Đã rút đăng ký trả kho', () => setActive(null));
  };

  // ---- Trình bày: thanh bước theo trạng thái của lượt trả kho.
  const stage = st?.stage;
  const stepState = (i: number): StepState => {
    const at = stage === 'AWAITING_HANDOVER' ? 0 : stage === 'AWAITING_INSPECTION' || stage === 'RETURNED' ? 1 : stage === 'AWAITING_APPROVAL' ? 2 : 3;
    return i < at ? 'done' : i === at ? (stage === 'RETURNED' ? 'blocked' : 'current') : 'todo';
  };
  const moveSteps: { label: string; icon: ReactNode; state: StepState }[] = [
    { label: 'Nhận lại ô', icon: <KeyRound />, state: stepState(0) },
    { label: 'Kiểm & gửi', icon: <ClipboardCheck />, state: stepState(1) },
    { label: 'Quản lý duyệt', icon: <ShieldCheck />, state: stepState(2) },
    { label: 'Khách xác nhận OTP', icon: <MailCheck />, state: stepState(3) },
  ];
  const settleDay = c ? settlementDateOf(c) : todayISO();

  return (
    <>
      <PageHeader title="Trả kho & kiểm tra" actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="self-start">
          <PanelHeader icon={<PackageOpen className="size-4" />} tone="violet" title="Chờ trả kho" count={pending.length}
            tip="Nhận lại ô → kiểm ô và gửi biên bản (không ghi tiền) → quản lý chi nhánh ghi phí và duyệt → khách xem biên bản rồi xác nhận bằng mã OTP." />
          {pending.length === 0 ? <EmptyState compact icon={<PackageOpen className="size-5" />} title="Không có lượt trả kho" /> : (
            <ul className="divide-y divide-stone-100">
              {pending.map((x) => {
                const s = moveOutStage(db, x);
                return (
                  <QueueRow key={x._id} active={c?._id === x._id} onSelect={() => start(x)}
                    lead={<UnitTag label={unitLabel(db, x.unitId)} size="sm" />}
                    title={userName(db, x.customerId)}
                    meta={<>
                      <Meta icon={<CalendarDays />}>Hẹn {fmtDate(x.moveOut?.scheduledFor)}</Meta>
                      {s && <Badge tone={s.tone} dot>{s.label}</Badge>}
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

        {!c || !st ? (
          <Card className="self-start"><EmptyState icon={<ClipboardCheck className="size-6" />} title="Chọn một lượt trả kho" description="Bấm một dòng trong danh sách chờ trả kho." /></Card>
        ) : (
          <Card className="min-w-0">
            <div className="flex flex-wrap items-start gap-3 border-b border-stone-100 p-4 sm:p-5">
              <UnitTag label={unitLabel(db, c.unitId)} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-ink">{userName(db, c.customerId)}</h2>
                <ChipRow className="mt-1.5">
                  <Chip tone={st.tone}>{st.label}</Chip>
                  <Chip icon={<Warehouse />}>{typeName(db, c.unitTypeId)}</Chip>
                  <Chip icon={<FileText />} mono>HĐ {c.contractNumber}</Chip>
                  <Chip icon={<CalendarDays />}>Hẹn {fmtDate(c.moveOut?.scheduledFor)}</Chip>
                  <Chip icon={<Wallet />}>Giữ chân {vnd(c.deposit.amount)}</Chip>
                  {c.balance.outstanding > 0 && <Chip icon={<Banknote />} tone="red">Nợ {vnd(c.balance.outstanding)}</Chip>}
                </ChipRow>
                {/* Thời gian thuê — để hiểu dòng "Trả kho sớm" ở quyết toán (mốc trả kho như server: ngày đã nhận lại ô, chưa nhận thì hôm nay). */}
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  <div><dt className="text-stone-500">Bắt đầu</dt><dd className="font-medium text-ink">{fmtDate(c.startDate)}</dd></div>
                  <div><dt className="text-stone-500">Kỳ hạn</dt><dd className="font-medium text-ink">{contractTermText(c)}, đến hết {fmtDate(lastDayOf(c.endDate))}</dd></div>
                  <div><dt className="text-stone-500">{c.moveOut?.returnedOn ? 'Đã nhận lại ô' : 'Trả kho'}</dt><dd className="font-medium text-ink">{c.moveOut?.returnedOn ? fmtDate(settleDay) : `Hôm nay ${fmtDate(settleDay)}`}</dd></div>
                  <div><dt className="text-stone-500">Đã thuê</dt><dd className="font-medium text-ink">{monthsDaysText(monthsDaysBetween(c.startDate, settleDay))}</dd></div>
                </dl>
              </div>
            </div>
            <div className="border-b border-stone-100 px-4 py-4 sm:px-5"><StepTrack steps={moveSteps} className="mx-auto max-w-xl" /></div>
            <div className="space-y-6 p-4 sm:p-5">

              {/* ---------------- Bước 1: nhận lại ô / chìa ---------------- */}
              {stage === 'AWAITING_HANDOVER' && (
                <>
                  <StepBlock n={1} state="current" icon={<KeyRound />} title="Nhận lại ô & chìa / thẻ">
                    <div className="space-y-3 text-sm">
                      <p className="text-stone-600">
                        Khách bàn giao ô: thu {c.access.method === 'PIN' ? 'mật khẩu (đặt lại ổ khoá)' : c.access.method === 'RFID_CARD' ? 'thẻ' : 'chìa'}, kiểm nhanh ô đã dọn trống. Bấm nhận lại ô: thu hồi quyền vào kho
                        {openItemsOf(c) ? `, tự huỷ ${openItemsOf(c)} (hoàn trong quyết toán)` : ''}. Hợp đồng CHƯA đóng — khách xác nhận biên bản sau cùng bằng mã OTP, khi quản lý đã duyệt.
                      </p>
                      <AccessResetCheck method={c.access.method} keyTag={c.access.keyTag} checked={recvReset} onChange={setRecvReset} />
                    </div>
                  </StepBlock>
                  <ActionBar>
                    {!c.access.revokedAt && <Button variant="secondary" onClick={() => withdraw(c)}>Rút đăng ký</Button>}
                    <Button variant="secondary" onClick={() => setActive(null)}>Để sau</Button>
                    <Button disabled={busy} onClick={() => (recvReset ? void receive(true) : setRemind('receive'))}><KeyRound className="size-4" />Đã nhận lại ô — bắt đầu kiểm</Button>
                  </ActionBar>
                </>
              )}

              {/* ---------------- Bước 2: kiểm ô & gửi biên bản (không ghi tiền) ---------------- */}
              {(stage === 'AWAITING_INSPECTION' || stage === 'RETURNED') && (
                <div className="space-y-6">
                  {stage === 'RETURNED' && report?.review?.returnNote && (
                    <Callout tone="red" icon={<Undo2 />} title={`Quản lý trả lại${report.review.returnedBy ? ` — ${userName(db, report.review.returnedBy)}` : ''}${report.review.returnedAt ? ` · ${fmtDateTime(report.review.returnedAt)}` : ''}`}>
                      {report.review.returnNote}
                    </Callout>
                  )}
                  <StepBlock n={1} state={allChecked ? 'done' : 'current'} icon={<ClipboardCheck />} title="Danh mục kiểm tra"
                    aside={<>
                      <Chip tone={allChecked ? 'green' : 'gray'}>Đã kiểm {checkedCount}/{MOVE_OUT_CHECKLIST.length}</Chip>
                      {!allChecked && <Button size="sm" variant="secondary" onClick={() => setChecked(Object.fromEntries(MOVE_OUT_CHECKLIST.map((i) => [i, true])))}><CircleCheck className="size-3.5" />Đã kiểm tất cả</Button>}
                    </>}>
                    <ul className="divide-y divide-stone-100 rounded-xl ring-1 ring-inset ring-stone-200">
                      {MOVE_OUT_CHECKLIST.map((item) => (
                        <li key={item}>
                          <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
                            <input type="checkbox" className="size-4 shrink-0" checked={!!checked[item]} onChange={(e) => setChecked((s) => ({ ...s, [item]: e.target.checked }))} />
                            <span className="flex-1">{item}</span>
                            <span className={cx('text-xs', checked[item] ? 'text-emerald-700' : 'text-stone-400')}>{checked[item] ? 'Đã kiểm' : 'Chưa kiểm'}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-stone-500">Có hư hại thì ghi ở mục 2 kèm mức độ và ảnh.</p>
                  </StepBlock>

                  <StepBlock n={2} state={damagesOk ? 'done' : 'current'} icon={<Hammer />} title="Hư hại"
                    aside={<Button size="sm" variant="secondary" onClick={() => { setDamages((d) => [...d, { description: '', severity: 'MINOR' }]); setPhotoText((p) => [...p, '']); }}><Plus className="size-3.5" />Thêm</Button>}>
                    <p className="mb-2 text-xs text-stone-500">Ghi mô tả, mức độ và ảnh — không ghi tiền. Quản lý chi nhánh ghi phí sửa chữa khi duyệt biên bản.</p>
                    {damages.length === 0 && <p className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-sm text-stone-500 ring-1 ring-inset ring-stone-200"><CircleCheck className="size-4 text-emerald-500" />Không ghi nhận hư hại.</p>}
                    <div className="space-y-2">
                      {damages.map((d, i) => (
                        <div key={i} className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                          <div className="flex items-center gap-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-red-100 text-xs font-bold text-red-700">{i + 1}</span>
                            <input className={cx(inputCls, 'flex-1')} placeholder="Mô tả hư hại" aria-label={`Mô tả hư hại ${i + 1}`} maxLength={500} value={d.description} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                            <Button variant="dangerOutline" size="sm" onClick={() => { setDamages((arr) => arr.filter((_, j) => j !== i)); setPhotoText((arr) => arr.filter((_, j) => j !== i)); }} aria-label={`Xoá hư hại ${i + 1}`}><Trash2 className="size-4" /></Button>
                          </div>
                          <select className={inputCls} aria-label={`Mức độ hư hại ${i + 1}`} value={d.severity} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, severity: e.target.value as Damage['severity'] } : x)))}>
                            <option value="MINOR">Nhẹ</option><option value="MODERATE">Vừa</option><option value="SEVERE">Nặng (cần bảo trì)</option>
                          </select>
                          <PhotoUploadInput max={10} value={photoText[i] ?? ''} onChange={(v) => setPhotoText((arr) => { const next = [...arr]; next[i] = v; return next; })} />
                        </div>
                      ))}
                    </div>
                    <textarea className={cx(inputCls, 'mt-3')} rows={2} maxLength={2000} placeholder="Ghi chú thêm" aria-label="Ghi chú thêm" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </StepBlock>

                  <StepBlock n={3} state={left !== null && leftOk ? 'done' : 'current'} icon={<Package />} title="Đồ khách để lại"
                    aside={<Segmented<boolean> label="Đồ khách để lại" value={left} onChange={setLeft} options={[{ value: false, label: 'Không', tone: 'green' }, { value: true, label: 'Có', tone: 'amber' }]} />}>
                    {left === null && <p className="text-xs text-stone-500">Khách mang hết đồ về → “Không”. Còn đồ khách không mang về → “Có”, mô tả và chụp ảnh.</p>}
                    <Disclosure variant="plain" icon={<PackageOpen className="size-4" />} title="Đồ khách đã khai — đối chiếu" className="mb-2">
                      <GoodsReference contractId={c._id} />
                    </Disclosure>
                    {left && (
                      <div className="space-y-2">
                        <input className={inputCls} maxLength={500} placeholder="Mô tả đồ để lại" aria-label="Mô tả đồ để lại" value={leftDesc} onChange={(e) => setLeftDesc(e.target.value)} />
                        <PhotoUploadInput max={10} required value={leftPhotos} onChange={setLeftPhotos} />
                        <Callout tone="amber" icon={<Timer />}>
                          Báo khách: chi nhánh giữ đồ {LEFTOVER_HOLD_DAYS} ngày kể từ khi khách xác nhận biên bản (đến lấy bất cứ lúc nào). Quá hạn thì chi nhánh xử lý và có thể tính phí theo Điều 9.
                        </Callout>
                      </div>
                    )}
                  </StepBlock>

                  {resetPending && unit?.accessReset && (
                    <AccessResetCheck method={unit.accessReset.method} keyTag={unit.accessReset.keyTag} checked={inspReset} onChange={setInspReset} />
                  )}

                  <ActionBar note={<p className="text-xs text-stone-500">Gửi xong biên bản bị khoá — chỉ sửa được khi quản lý trả lại.</p>}>
                    <Button variant="secondary" onClick={() => setActive(null)}>Để sau</Button>
                    <Button disabled={busy || !allChecked || !damagesOk || left === null || !leftOk} onClick={() => void submitReport()}>
                      <Send className="size-4" />{stage === 'RETURNED' ? 'Gửi lại quản lý duyệt' : 'Gửi quản lý duyệt'}
                    </Button>
                  </ActionBar>
                </div>
              )}

              {/* ---------------- Bước 3: chờ quản lý duyệt (chỉ xem) ---------------- */}
              {stage === 'AWAITING_APPROVAL' && report && (
                <div className="space-y-5">
                  <Callout tone="blue" icon={<ShieldCheck />} title="Chờ quản lý chi nhánh duyệt biên bản"
                    action={isFM ? <ButtonLink size="sm" href={`/manager/move-outs?open=${c._id}`}>Ghi phí & duyệt</ButtonLink> : undefined}>
                    Gửi lúc {fmtDateTime(report.review?.submittedAt ?? report.performedAt)} bởi {userName(db, report.review?.submittedBy ?? report.inspectorId)}. Quản lý ghi phí sửa chữa / phí khác rồi duyệt — sau đó khách xem biên bản và xác nhận bằng mã OTP.
                  </Callout>
                  <MoveOutReportBody i={report} />
                </div>
              )}

              {/* ---------------- Bước 4: khách xem biên bản đã duyệt & xác nhận bằng OTP ---------------- */}
              {stage === 'AWAITING_CONFIRMATION' && report && preview && (
                <div className="space-y-6">
                  <StepBlock n={1} state="done" icon={<FileText />} title="Biên bản đã duyệt — cho khách xem"
                    aside={<Chip tone="green" icon={<ShieldCheck />}>Duyệt bởi {userName(db, report.review?.approvedBy)}</Chip>}>
                    <MoveOutReportBody i={report} costs />
                  </StepBlock>
                  <StepBlock n={2} state="done" icon={<Wallet />} title="Quyết toán tiền giữ chân">
                    <SettlementLedger p={preview} />
                    {shortfall > 0 && (
                      <Callout tone="amber" icon={<Banknote />} className="mt-3" title={`Khách cần trả thêm ${vnd(shortfall)}`}>
                        {recvMode === 'ABSENT' ? (
                          <p>Khách vắng mặt — khoản này thành nợ sau quyết toán. Khách trả sau trên web / app, hoặc tại quầy (mục &quot;Khách đến trả nợ&quot;).</p>
                        ) : (
                          <div className="space-y-2">
                            <Segmented<'COLLECT' | 'DEBT'> label="Khoản cần trả thêm" value={afterDebt} onChange={setAfterDebt}
                              options={[{ value: 'COLLECT', label: 'Thu tại quầy ngay', icon: <Banknote /> }, { value: 'DEBT', label: 'Để thành nợ', icon: <FileText /> }]} />
                            <p className="text-xs">{afterDebt === 'COLLECT'
                              ? 'Xác nhận xong sẽ mở bước thu: tiền mặt hoặc VNPAY, có biên lai.'
                              : 'Thành nợ sau quyết toán — khách trả sau trên web / app, hoặc tại quầy (mục "Khách đến trả nợ"). Chưa trả thì chưa đặt kho mới được.'}</p>
                          </div>
                        )}
                      </Callout>
                    )}
                  </StepBlock>
                  <StepBlock n={3} state={recvOk ? 'done' : 'current'} icon={<MailCheck />} title="Khách xác nhận bằng mã OTP">
                    <div className="space-y-3 text-sm">
                      <p className="text-stone-600">Khách xem biên bản và quyết toán ở trên rồi đọc mã OTP nhận qua email. Không ký tay trên màn hình — nhân viên không ký hộ khách. Xác nhận xong: đóng hợp đồng, quyết toán, bắt đầu {INSPECTION_DISPUTE_DAYS} ngày khiếu nại.</p>
                      {isFM && (
                        <Segmented<'SIGN' | 'ABSENT'> label="Xác nhận" value={recvMode} onChange={setRecvMode}
                          options={[{ value: 'SIGN', label: 'Khách có mặt (OTP)', icon: <MailCheck /> }, { value: 'ABSENT', label: 'Khách vắng mặt', icon: <UserX /> }]} />
                      )}
                      {recvMode === 'SIGN' ? (
                        <div className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                          <p className="flex items-center gap-2 font-medium text-ink">
                            <MailCheck className="size-4 text-stone-400" />Xác minh bằng mã OTP
                            <InfoTip align="start">Mã gửi tới email tài khoản của chủ hợp đồng. Khách đọc mã, bạn nhập vào ô dưới — mã được kiểm trước khi mở bước xác nhận cuối.</InfoTip>
                          </p>
                          <Button size="sm" variant="secondary" disabled={busy || otpWait > 0} onClick={() => void sendOtp()}>
                            <MailCheck className="size-3.5" />{otpWait > 0 ? `Gửi lại sau ${otpWait}s` : otpSent ? 'Gửi lại mã' : 'Gửi mã OTP tới email khách'}
                          </Button>
                          {otpSent && (
                            <Field label={`Mã đã gửi tới ${otp!.sentTo}`} tip="Mã gồm 6 số, hiệu lực 10 phút" note={otp!.demoCode ? `Mã thử: ${otp!.demoCode}` : undefined}>
                              <input className={cx(inputCls, 'font-mono tracking-[0.3em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode}
                                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" aria-label="Mã OTP" />
                            </Field>
                          )}
                        </div>
                      ) : (
                        <Field label="Lý do khách vắng mặt">
                          <textarea className={inputCls} rows={2} maxLength={300} value={absentReason} onChange={(e) => setAbsentReason(e.target.value)} placeholder="VD: khách gửi chìa qua bảo vệ, đã gọi xác nhận" />
                        </Field>
                      )}
                      {resetPending && unit?.accessReset && (
                        <Callout tone="amber" icon={<KeyRound />}>Chưa ghi nhận {accessResetTaskText(unit.accessReset.method, unit.accessReset.keyTag)} — hệ thống nhắc lại sau khi kiểm mã.</Callout>
                      )}
                    </div>
                  </StepBlock>
                  <ActionBar>
                    <Button variant="secondary" onClick={() => setActive(null)}>Để sau</Button>
                    <Button disabled={busy || !recvOk} onClick={() => void startConfirm()}>
                      <CircleCheck className="size-4" />{recvMode === 'SIGN' ? 'Kiểm mã & xác nhận' : 'Xác nhận thay khách vắng mặt'}
                    </Button>
                  </ActionBar>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <Modal open={confirmDone && !!c && !!preview} onClose={() => setConfirmDone(false)} title="Đóng hợp đồng & quyết toán"
        description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}` : ''}
        footer={<><Button variant="secondary" onClick={() => setConfirmDone(false)}>Quay lại</Button><Button disabled={busy} onClick={() => void confirm()}>Xác nhận đóng hợp đồng</Button></>}>
        {preview && (
          <div className="space-y-4 text-sm">
            <FactGrid>
              <Fact icon={<Hammer className="size-4" />} label="Phí sửa chữa & phí khác" tone={preview.damageFee > 0 ? 'red' : 'gray'}>{vnd(preview.damageFee)}</Fact>
              <Fact icon={<Banknote className="size-4" />} label="Công nợ trừ vào quyết toán">{vnd(preview.priorOutstanding)}</Fact>
              <Fact icon={<Wallet className="size-4" />} label="Hoàn lại khách" tone="green">{vnd(settlementRefundTotal(preview))}</Fact>
              <Fact icon={<TriangleAlert className="size-4" />} label="Khách cần trả thêm" tone={shortfall > 0 ? 'red' : 'gray'}>{shortfall > 0 ? `${vnd(shortfall)} · ${collectNow ? 'thu tại quầy ngay' : 'để thành nợ'}` : 'Không'}</Fact>
              <Fact icon={<Package className="size-4" />} label="Đồ khách để lại" tone={report?.leftItems?.present ? 'amber' : 'gray'}>{report?.leftItems?.present ? `Có — giữ ${LEFTOVER_HOLD_DAYS} ngày` : 'Không'}</Fact>
              {resetPending && unit?.accessReset && <Fact icon={<KeyRound className="size-4" />} label="Chìa / thẻ, ổ khoá" tone={inspReset ? 'green' : 'amber'}>{inspReset ? 'Ghi nhận cùng lúc này' : `Chưa ${accessResetTaskText(unit.accessReset.method, unit.accessReset.keyTag)} — ô chưa mở cho thuê`}</Fact>}
              <Fact icon={<PenLine className="size-4" />} label="Xác nhận biên bản" tone="green">{recvMode === 'SIGN' ? `Khách đã đọc đúng mã OTP gửi ${otp?.sentTo ?? ''}` : 'Quản lý xác nhận khách vắng mặt'}</Fact>
            </FactGrid>
            <Callout tone="amber" icon={<TriangleAlert />}>Không hoàn tác được — sai thì chỉ điều chỉnh khi khách khiếu nại (trong {INSPECTION_DISPUTE_DAYS} ngày).</Callout>
          </div>
        )}
      </Modal>

      {/* Quyết toán còn thiếu, đã chọn thu ngay: thu công nợ của hợp đồng vừa đóng tại quầy (cùng đường thu nợ ở trang chủ nhân viên). Đóng hộp = để thành nợ. */}
      <CounterCollectDialog contract={collectId ? db.contracts.find((x) => x._id === collectId) ?? null : null} onClose={() => setCollectId(null)} />

      {/* Nhắc nhận lại chìa / thẻ (đặt lại khoá): ở bước nhận ô; và ở bước cuối nếu vẫn chưa ghi nhận — CHỈ sau khi mã OTP đã đúng. */}
      {c && (
        <AccessResetReminder open={!!remind} onClose={() => setRemind(null)}
          method={remind === 'receive' ? c.access.method : unit?.accessReset?.method} keyTag={remind === 'receive' ? c.access.keyTag : unit?.accessReset?.keyTag}
          unit={unitLabel(db, c.unitId)} customer={userName(db, c.customerId)}
          onCollected={() => { const r = remind; setRemind(null); if (r === 'receive') { setRecvReset(true); void receive(true); } else { setInspReset(true); setConfirmDone(true); } }}
          onLater={() => { const r = remind; setRemind(null); if (r === 'receive') void receive(false); else setConfirmDone(true); }} />
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
                    {isFM && due && (
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
          <Field label="Phí xử lý (VND)" tip="Điều 9 · 0 nếu không thu">
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
            { key: 's', header: 'Trạng thái', cell: (i) => <StatusBadge map={INSPECTION_STATUS} value={i.status} /> },
            { key: 'by', header: 'Người kiểm tra', cell: (i) => userName(db, i.inspectorId) },
            { key: 'o', header: 'Kết quả', cell: (i) => (i.outcome ? <StatusBadge map={INSPECTION_OUTCOME} value={i.outcome} /> : '—') },
            { key: 'f', header: 'Phí', className: 'text-right tabular-nums', cell: (i) => (i.status === 'APPROVED' || i.status === 'FM_APPROVED' ? vnd(i.totalDamageFee) : '—') },
            { key: 'r', header: 'Hoàn tiền giữ chân', className: 'text-right tabular-nums', cell: (i) => (i.depositSettlement ? vnd(i.depositSettlement.refundAmount) : '—') },
          ]} />
        </div>
      </Disclosure>
    </>
  );
}
