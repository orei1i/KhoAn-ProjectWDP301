'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  Ban, Banknote, CalendarCheck, CalendarClock, CalendarDays, CircleCheck, CircleDashed, Clock, Hourglass, IdCard, KeyRound, PackagePlus, PenLine, Pencil, Phone,
  Printer, RefreshCw, Repeat, ScanLine, Search, Smartphone, Store, Timer, TriangleAlert, Upload, UserRound, Wallet, Warehouse, X,
} from 'lucide-react';
import type { CheckInShift, PaymentMethod, Reservation } from '@ssm/shared';
import { addPeriods, SIGNING_PREFERENCE, signingPreferenceOf, bookingServicesDue, dueAtBooking, dueAtCheckIn, fmtHoldUntil, ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, PAPER_CONTRACT_MAX_BYTES, PAPER_CONTRACT_TYPES, RESCHEDULE_STATUSES, paymentDueDate, paysWholeTerm, periodLabel, rescheduleCheck } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { isTxnRef } from '@/shared/api/actions';
import { ACCESS_METHOD, CHECK_IN_SHIFT, PERIOD_UNIT, RESERVATION_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, inScope, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, ButtonLink, Card, EmptyState, Field, IconTile, InfoTip, Modal, PageHeader, StatusBadge, cx, inputCls } from '@/shared/ui';
import { ActionBar, Callout, Chip, ChipRow, CheckLine, Ledger, LedgerRow, Meta, PanelHeader, PillFilter, QueueRow, StepBlock, StepTrack, SubHeading, UnitTag, type StepState } from '@/features/staff-ui';
import { PayMethodPicker } from '@/features/payments/pay-method';
import { NewReceipts, ReceiptButton } from '@/features/payments/receipt-button';
import { QrScanButton } from '@/features/reservations/qr-scanner';
import { SignatureInfo } from '@/features/contracts/contract-document';
import { ContractFileActions } from '@/features/contracts/contract-file-actions';
import { CustomerIdentityDialog } from '@/features/auth/customer-identity-dialog';
import { CancelReservationDialog } from '@/features/reservations/cancel-reservation-dialog';
import { IdCheckUnlock } from '@/features/contracts/id-check-unlock';

/** Khách chưa ký và đã chọn ký giấy tại quầy — mở thẳng bước in hợp đồng / tải bản scan. */
const wantsPaper = (x: Reservation) => !x.signature && signingPreferenceOf(x) === 'PAPER_AT_COUNTER';
// Đặt chỗ còn huỷ được từ quầy (chưa nhận kho).
const CANCELLABLE: Reservation['status'][] = ['PENDING', 'CONFIRMED', 'ALLOCATED'];

/** Đặt chỗ "giữ chỗ, trả tại quầy" còn chờ thu tiền giữ chân. */
const awaitingCounter = (x: Reservation) => x.status === 'PENDING' && !!x.payAtCounter;
const holdLive = (x: Reservation) => !x.holdExpiresAt || new Date(x.holdExpiresAt).getTime() > Date.now();
type CounterPay = 'CASH' | 'BANK_TRANSFER' | 'CARD';

/**
 * Bước "Thu tiền giữ chân" cho đặt chỗ khách chọn trả tại quầy: tiền giữ chân (+ tiền thuê kỳ đầu kho cỡ lớn), chọn hình thức thu, mã
 * giao dịch (không phải tiền mặt). Thu xong đặt chỗ được xác nhận + giữ ô — tiếp tục ký giấy và nhận kho như thường.
 */
function CollectDepositStep({ r, onCollected }: { r: Reservation; onCollected: (v: { amount: number; paymentIds: string[] }) => void }) {
  const { run, busy } = useStore();
  const [method, setMethod] = useState<CounterPay>('CASH');
  const [txnRef, setTxnRef] = useState('');
  const [received, setReceived] = useState(false);
  const amount = dueAtBooking(r.quote);
  const expired = !holdLive(r);
  const needTxn = method !== 'CASH';
  const collect = () => void run('collectDeposit', { reservationId: r._id, payMethod: method, txnRef: needTxn ? txnRef : undefined },
    (v) => `Đã thu ${vnd(v.amount)} tại quầy — đặt chỗ đã xác nhận`, (v) => onCollected(v));
  return (
    <section className="space-y-4 rounded-xl bg-violet-50/50 p-4 text-sm ring-1 ring-inset ring-violet-200">
      <header className="flex flex-wrap items-center gap-2.5">
        <IconTile icon={<Store className="size-4" />} tone="violet" size="sm" />
        <p className="min-w-0 flex-1 font-semibold text-ink">Thu tiền giữ chân</p>
        {r.holdExpiresAt && <Badge tone={expired ? 'red' : 'violet'} dot>{expired ? 'Đã hết hạn giữ' : `Giữ ô đến ${fmtHoldUntil(r.holdExpiresAt)}`}</Badge>}
      </header>
      <Ledger className="bg-white">
        <LedgerRow label="Tiền giữ chân" value={vnd(r.quote.depositAmount)} />
        {r.quote.firstPeriodAtBooking && <LedgerRow label={`Tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`} tip="Kho cỡ lớn trả trước tiền thuê kỳ đầu khi đặt chỗ." value={vnd(r.quote.firstPeriodRent)} />}
        <LedgerRow total label="Thu bây giờ" value={vnd(amount)} />
      </Ledger>
      {expired ? (
        <Callout tone="red" icon={<TriangleAlert />} title="Đã hết thời gian giữ chỗ — không thu được nữa.">Đặt lại cho khách ở “Đặt chỗ tại quầy”.</Callout>
      ) : (
        <>
          <Field label="Hình thức thu"><PayMethodPicker icons value={method} onChange={(m) => { setMethod(m as CounterPay); setReceived(false); }} methods={['CASH', 'BANK_TRANSFER', 'CARD']} /></Field>
          {needTxn && (
            <Field label="Mã giao dịch">
              <input className={inputCls} value={txnRef} maxLength={64} onChange={(e) => setTxnRef(e.target.value)} placeholder={method === 'CARD' ? 'Mã chuẩn chi' : 'FT26292xxxxx'} />
            </Field>
          )}
          <CheckLine checked={received} onChange={setReceived}>Đã nhận đủ <b>{vnd(amount)}</b> — không huỷ được sau khi xác nhận.</CheckLine>
          <div className="flex justify-end">
            <Button className="w-full sm:w-auto" disabled={busy || !received || (needTxn && !isTxnRef(txnRef))} onClick={collect}><Banknote className="size-4" />Xác nhận đã thu {vnd(amount)}</Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Đọc file thành base64 (bỏ tiền tố data:...;base64,). */
const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(f);
});

function CheckInInner() {
  const { db, user, run, refresh, busy, toast } = useStore();
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get('code') ?? '');
  const [found, setFound] = useState<Reservation | null>(null);
  const [error, setError] = useState('');
  const [keyTag, setKeyTag] = useState('');
  const [pay, setPay] = useState<PaymentMethod>('CASH');
  const [txnRef, setTxnRef] = useState('');
  // Đối chiếu giấy tờ tùy thân bản gốc — bắt buộc trước khi bàn giao. Nhân viên LUÔN nhập loại + 4 số cuối theo giấy tờ khách xuất trình
  // (ô để trống, không hiện sẵn số khách đã khai); server so với số đã khai, lệch thì từ chối.
  const [idChecked, setIdChecked] = useState(false);
  // Đã bấm "Xác nhận bàn giao" ít nhất một lần → hiện lỗi dưới các ô còn thiếu.
  const [tried, setTried] = useState(false);
  const [editIdentity, setEditIdentity] = useState(false);
  const [idInput, setIdInput] = useState<{ idType: 'CCCD' | 'PASSPORT' | ''; idNumberLast4: string }>({ idType: '', idNumberLast4: '' });
  // Huỷ đặt chỗ từ quầy (khách yêu cầu / chi nhánh không giao được ô) — lý do theo vai trò, ghi chú bắt buộc.
  const [cancelling, setCancelling] = useState<{ r: Reservation; reason?: 'FACILITY_UNAVAILABLE' } | null>(null);
  const [done, setDone] = useState<{ pin?: string; contract: string; unit: string; contractId: string; reservationId: string; before: string[]; paidNote: string } | null>(null);
  // Vừa thu tiền giữ chân tại quầy (đặt chỗ "trả tại quầy") — in biên lai rồi tiếp tục ký giấy, nhận kho.
  const [collected, setCollected] = useState<{ reservationId: string; amount: number; paymentIds: string[] } | null>(null);
  // Ký giấy tại quầy: in hợp đồng → khách ký → tải bản scan lên.
  const [paperName, setPaperName] = useState('');
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperErr, setPaperErr] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  // Nhân viên chia theo ca cố định — mặc định lọc đúng ca của mình, có thể bấm xem "Tất cả ca".
  const [shiftFilter, setShiftFilter] = useState<CheckInShift | 'ALL'>(() => user?.shift ?? 'ALL');
  // Quản lý chi nhánh phân / đổi ô cho đặt chỗ (khách chưa ký hợp đồng ghi số ô) — đổi là nhả ô cũ, giữ ô mới cùng lúc.
  const [assign, setAssign] = useState<Reservation | null>(null);
  const [assignUnit, setAssignUnit] = useState('');
  useEffect(() => { const c = sp.get('code'); if (c) void lookup(c); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Ký giấy tại quầy: điền sẵn họ tên khách của đặt chỗ — người ký khác (đại diện…) thì nhân viên sửa lại.
  const foundCustomerName = found ? byId(db.users, found.customerId)?.fullName ?? '' : '';
  useEffect(() => { setPaperName(foundCustomerName); }, [found?._id, foundCustomerName]);
  if (!user) return null;

  const r = found ? db.reservations.find((x) => x._id === found._id) ?? null : null;
  // Hình thức khoá là thuộc tính của chính ô đã chọn (không còn theo loại kho).
  const method = (r ? db.units.find((u) => u._id === r.unitId)?.accessMethod : null) ?? 'PIN';
  const arrivals = db.reservations.filter((x) => x.status === 'ALLOCATED' && x.startDate <= todayISO() && inScope(db, user, x.facilityId)
    && (shiftFilter === 'ALL' || x.preferredCheckInShift === shiftFilter));
  // Đã trả tiền giữ chân nhưng chưa có ô (chi nhánh gỡ ô mà chưa phân lại) — quá hạn nhận mà vẫn chưa có ô thì hệ thống huỷ, hoàn 100%.
  const unassigned = db.reservations.filter((x) => x.status === 'CONFIRMED' && !x.unitId && inScope(db, user, x.facilityId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const isFM = user.role === 'FACILITY_MANAGER';
  // Đặt chỗ đã có ô, nhận trong 14 ngày tới — quản lý đổi ô (khách chưa ký) hoặc huỷ hoàn 100% TRƯỚC ngày nhận khi ô có vấn đề.
  const upcoming = isFM ? db.reservations.filter((x) => x.status === 'ALLOCATED' && x.startDate > todayISO() && x.startDate <= addDays(todayISO(), 14) && inScope(db, user, x.facilityId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
  // Chờ thu tiền tại quầy: khách đặt online, chọn trả tại quầy, còn hạn giữ ô.
  const counterHolds = db.reservations.filter((x) => awaitingCounter(x) && holdLive(x) && inScope(db, user, x.facilityId))
    .sort((a, b) => (a.holdExpiresAt ?? '').localeCompare(b.holdExpiresAt ?? ''));
  const assignFromMethod = assign?.unitId ? byId(db.units, assign.unitId)?.accessMethod : undefined;
  // Ưu tiên ô cùng hình thức khoá với ô khách đã chọn — khách chọn ô mật khẩu thì không âm thầm chuyển sang ô chìa.
  const assignCandidates = assign
    ? db.units.filter((u) => u.facilityId === assign.facilityId && u.unitTypeId === assign.unitTypeId && u.status === 'AVAILABLE' && !u.isDeleted)
      .sort((a, b) => Number(a.accessMethod !== assignFromMethod) - Number(b.accessMethod !== assignFromMethod) || a.location.floor - b.location.floor || a.unitNumber.localeCompare(b.unitNumber))
    : [];
  const openAssign = (x: Reservation) => { setAssignUnit(''); setAssign(x); };

  // Server-side lookup: enforces facility scope (out-of-scope codes are written to the audit log as DENIED)
  const lookup = async (c = code) => {
    setDone(null); setCollected(null); setError(''); setIdChecked(false); setTried(false); setIdInput({ idType: '', idNumberLast4: '' }); setKeyTag(''); setTxnRef('');
    setPaperFile(null); setPaperErr('');
    if (!c.trim()) return;
    try {
      const res = await api.get<{ reservation: Reservation; qrValid: boolean | null }>(`/reservations/lookup?code=${encodeURIComponent(c.trim())}`);
      if (!db.reservations.some((x) => x._id === res.reservation._id)) await refresh();
      setFound(res.reservation);
      if (res.qrValid === false) setError('Mã QR không khớp — kiểm tra giấy tờ khách trước khi bàn giao');
    } catch (e) {
      setFound(null);
      setError(e instanceof Error ? e.message : 'Không tra cứu được');
    }
  };

  // Tiền thu khi nhận kho = tiền thuê kỳ đầu + dịch vụ khách chọn kèm lúc đặt (chưa thu).
  const rentDue = r ? dueAtCheckIn(r.quote) : 0;
  const svcOrders = r ? db.serviceOrders.filter((o) => String(o.reservationId ?? '') === r._id && o.status === 'REQUESTED' && !o.paymentId) : [];
  const svcDue = r ? bookingServicesDue(db.serviceOrders, r._id) : 0;
  const totalDue = rentDue + svcDue;

  const idOk = !!idInput.idType && ID_LAST4_RE.test(idInput.idNumberLast4.trim());
  // Kiểm tra từng ô: bấm "Xác nhận" khi còn thiếu thì báo lỗi ngay dưới ô đó và cuộn tới ô thiếu đầu tiên.
  // Kiểm hàng cấm KHÔNG còn ở bước nhận kho — làm ở mỗi đợt nhập hàng (trang Nhập hàng).
  const errs: Record<'keyTag' | 'txnRef' | 'idType' | 'last4' | 'idChecked', string | null> = {
    keyTag: method !== 'PIN' && !keyTag.trim() ? `Nhập ${method === 'PHYSICAL_KEY' ? 'mã chìa' : 'số thẻ'} đã giao cho khách` : null,
    txnRef: totalDue > 0 && pay !== 'CASH' && !isTxnRef(txnRef) ? 'Nhập mã giao dịch (4–64 ký tự)' : null,
    idType: !idInput.idType ? 'Chọn loại giấy tờ khách xuất trình' : null,
    last4: !ID_LAST4_RE.test(idInput.idNumberLast4.trim()) ? 'Nhập đúng 4 ký tự cuối' : null,
    idChecked: !idChecked ? 'Tick sau khi đã đối chiếu bản gốc' : null,
  };
  const hasErr = Object.values(errs).some(Boolean);
  const errOf = (k: keyof typeof errs) => (tried ? errs[k] ?? undefined : undefined);
  const invalidCls = (k: keyof typeof errs) => (tried && errs[k] ? 'ring-2 ring-red-500' : '');
  const submit = () => {
    if (hasErr) {
      setTried(true);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[data-invalid="true"]');
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus({ preventScroll: true });
      });
      return;
    }
    void confirm();
  };
  const confirm = async () => {
    if (!r || !idInput.idType || !idOk) return;
    const id = { idType: idInput.idType, idNumberLast4: idInput.idNumberLast4.trim() };
    const before = db.payments.map((p) => p._id);
    const res = await run('checkIn', { reservationId: r._id, keyTag: method !== 'PIN' ? keyTag.trim() : undefined, payMethod: totalDue > 0 ? pay : undefined, txnRef: totalDue > 0 ? txnRef : undefined, ...id }, 'Nhận kho thành công — hợp đồng đã kích hoạt');
    // Nói đúng tiền đã có: tiền thuê kỳ đầu trả lúc đặt chỗ, và / hoặc tiền thuê + dịch vụ kèm vừa thu tại quầy.
    const collected = [rentDue > 0 ? `${vnd(rentDue)} tiền thuê` : null, svcDue > 0 ? `${vnd(svcDue)} dịch vụ kèm` : null].filter(Boolean);
    const notes = [r.quote.firstPeriodAtBooking ? 'tiền thuê kỳ đầu khách đã trả khi đặt chỗ' : null, collected.length ? `đã ghi nhận thu tại quầy ${collected.join(' + ')}` : null].filter(Boolean);
    const paidNote = notes.length ? notes.join('; ') : 'không có khoản thu thêm khi nhận kho';
    if (res.ok) setDone({ pin: res.value.pin, contract: res.value.contract.contractNumber, unit: res.value.unit.unitNumber, contractId: res.value.contract._id, reservationId: r._id, before, paidNote });
  };

  // PDF hợp đồng chưa ký để in cho khách ký giấy (cần token nên tải qua blob).
  const printContract = async (x: Reservation) => {
    setFileBusy(true);
    try {
      const blob = await api.blob(`/reservations/${x._id}/contract-print.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `hop-dong-${x.code}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được hợp đồng', 'error');
    } finally {
      setFileBusy(false);
    }
  };

  const pickPaper = (f: File | null) => {
    setPaperErr(''); setPaperFile(null);
    if (!f) return;
    if (!(PAPER_CONTRACT_TYPES as readonly string[]).includes(f.type)) return setPaperErr('Chỉ nhận PDF, JPG hoặc PNG');
    if (f.size > PAPER_CONTRACT_MAX_BYTES) return setPaperErr(`File quá ${Math.round(PAPER_CONTRACT_MAX_BYTES / 1024 / 1024)}MB`);
    setPaperFile(f);
  };

  const savePaper = async () => {
    if (!r || !paperFile) return;
    let base64: string;
    try { base64 = await toBase64(paperFile); } catch { return setPaperErr('Không đọc được file'); }
    await run('signPaper', { reservationId: r._id, signerName: paperName.trim(), file: { name: paperFile.name, contentType: paperFile.type, base64 } }, 'Đã lưu hợp đồng giấy — đặt chỗ đã ký', () => { setPaperFile(null); setPaperName(''); });
  };

  // Khách đến sớm: chưa bàn giao được trước ngày nhận theo lịch — dời ngày nhận về hôm nay (ô đã giữ riêng cho khách),
  // chữ ký cũ hết hiệu lực nên khách ký lại (giấy tại quầy / online) rồi mới nhận kho.
  const early = !!r && r.startDate > todayISO() && RESCHEDULE_STATUSES.includes(r.status);
  const earlyCheck = r && early ? rescheduleCheck(r, todayISO()) : null;
  const receiveToday = () => { if (r) void run('rescheduleReservation', { reservationId: r._id, startDate: todayISO(), reason: 'Khách đến sớm tại quầy' }, 'Đã dời ngày nhận kho về hôm nay'); };
  const blockers: string[] = [];
  if (r && !awaitingCounter(r)) {
    if (r.status !== 'ALLOCATED') blockers.push(r.status === 'CONFIRMED' ? 'Đặt chỗ chưa được phân kho — cần Quản lý chi nhánh phân kho trước.' : `Trạng thái "${RESERVATION_STATUS[r.status].label}" không cho phép nhận kho.`);
    if (r.startDate > todayISO() && !early) blockers.push(`Chưa đến ngày nhận kho (${fmtDate(r.startDate)}).`);
    const c = byId(db.users, r.customerId);
    if (c?.status === 'SUSPENDED') blockers.push('Tài khoản khách đang bị tạm khóa.');
  }

  // ---- Chỉ để trình bày: đang ở bước nào của quy trình (cùng điều kiện hiển thị như bên dưới, không đổi luồng).
  const phase = !r ? null : awaitingCounter(r) ? 'deposit' : early && blockers.length === 0 ? 'early' : blockers.length === 0 && !r.signature ? 'sign' : blockers.length > 0 ? 'blocked' : 'handover';
  const track: { label: string; icon: ReactNode; state: StepState }[] = !r ? [] : [
    ...(r.payAtCounter ? [{ label: 'Thu giữ chân', icon: <Banknote />, state: (phase === 'deposit' ? 'current' : 'done') as StepState }] : []),
    { label: 'Ký hợp đồng', icon: <PenLine />, state: r.signature ? 'done' : phase === 'sign' ? 'current' : phase === 'blocked' ? 'blocked' : 'todo' },
    { label: 'Đối chiếu & thu tiền', icon: <IdCard />, state: phase === 'handover' ? 'current' : phase === 'blocked' && r.signature ? 'blocked' : 'todo' },
    { label: 'Bàn giao', icon: <KeyRound />, state: 'todo' },
  ];
  /** Hai cột khi đủ rộng; ở màn lg cột trái hẹp (cạnh hàng đợi) nên về một cột. */
  const COLS2 = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2';

  return (
    <>
      <PageHeader title="Nhận kho (check-in)" description="Quét QR hoặc nhập mã đặt chỗ." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4 sm:p-5">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
              <div className="relative min-w-56 flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <input className={cx(inputCls, 'h-10 pl-9 font-mono uppercase')} placeholder="RSV-260911-XXXXXX" aria-label="Mã đặt chỗ" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <Button type="submit"><Search className="size-4" />Tra cứu</Button>
              <QrScanButton onResult={(text) => { setCode(text); void lookup(text); }} />
            </form>
            {error && <Callout tone="red" icon={<TriangleAlert />} className="mt-3">{error}</Callout>}
          </Card>

          {done && (
            <Card className="overflow-hidden border-emerald-200">
              <div className="flex flex-wrap items-center gap-4 bg-emerald-50 p-4 sm:p-5">
                <IconTile icon={<CircleCheck className="size-6" />} tone="green" size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-emerald-900">Đã bàn giao kho {done.unit}</p>
                  <p className="text-sm text-emerald-900/80">Hợp đồng {done.contract} đã kích hoạt — {done.paidNote}.</p>
                </div>
              </div>
              {done.pin && (
                <div className="border-t border-emerald-100 px-4 py-4 sm:px-5">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500"><KeyRound className="size-3.5" />Mã PIN truy cập · chỉ hiển thị một lần</p>
                  <p className="mt-2 inline-block rounded-xl bg-ink px-4 py-2 font-mono text-3xl font-bold tracking-[0.35em] text-white">{done.pin}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-stone-100 px-4 py-4 sm:px-5">
                <NewReceipts payments={db.payments.filter((p) => p.contractId === done.contractId || p.reservationId === done.reservationId)} before={done.before} />
                {/* Nhập hàng là bước riêng sau bàn giao: mở đợt nhập cho hợp đồng vừa tạo (khai đồ + kiểm hàng cấm). */}
                <ButtonLink href={`/staff/intake?contract=${done.contractId}`} size="sm"><PackagePlus className="size-3.5" />Nhập hàng ngay</ButtonLink>
                <ButtonLink href="/staff" variant="secondary" size="sm">Về hàng đợi</ButtonLink>
              </div>
            </Card>
          )}

          {r && !done && (
            <Card>
              {/* Tóm tắt khách + ô: nhìn là biết đang phục vụ ai, ô nào. */}
              <div className="flex flex-wrap items-start gap-3 border-b border-stone-100 p-4 sm:p-5">
                <UnitTag label={unitLabel(db, r.unitId)} tone={r.unitId ? 'ink' : 'gray'} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">{userName(db, r.customerId)}</h2>
                    {wantsPaper(r) && <Badge tone={SIGNING_PREFERENCE.PAPER_AT_COUNTER.tone}>{SIGNING_PREFERENCE.PAPER_AT_COUNTER.label}</Badge>}
                    <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500"><span className="font-mono">{r.code}</span> · {typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)}</p>
                </div>
                {CANCELLABLE.includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setCancelling({ r })}><X className="size-3.5" />Huỷ đặt chỗ…</Button>}
              </div>
              <div className="space-y-4 border-b border-stone-100 px-4 py-4 sm:px-5">
                <ChipRow>
                  <Chip icon={<Phone />} title="Số điện thoại">{byId(db.users, r.customerId)?.phone ?? '—'}</Chip>
                  {(() => { const p = byId(db.users, r.customerId)?.customerProfile; return <Chip icon={<IdCard />} tone={p?.idType ? 'gray' : 'amber'} title="Giấy tờ khách khai">{p?.idType ? `${ID_TYPE_LABEL[p.idType]} · đã khai` : 'Chưa khai giấy tờ'}</Chip>; })()}
                  <Chip icon={<CalendarDays />} title="Ngày nhận">Nhận {fmtDate(r.startDate)}</Chip>
                  <Chip icon={<Clock />} tone={CHECK_IN_SHIFT[r.preferredCheckInShift].tone} title="Ca dự kiến đến">{CHECK_IN_SHIFT[r.preferredCheckInShift].label}</Chip>
                  <Chip icon={<Hourglass />} title="Thời hạn">{periodLabel(r.quote.rentalPeriod, r.periods)}</Chip>
                  <Chip icon={<Wallet />} tone={r.status === 'PENDING' ? 'amber' : 'green'} title="Tiền giữ chân">Giữ chân {r.status === 'PENDING' ? (r.payAtCounter ? 'chưa thu · trả tại quầy' : 'chưa thu') : `${vnd(r.quote.depositAmount)} · đã thu`}</Chip>
                </ChipRow>
                {CANCELLABLE.includes(r.status) && <StepTrack steps={track} className="mx-auto max-w-xl" />}
              </div>

              <div className="space-y-5 p-4 sm:p-5">
                {collected?.reservationId === r._id && (
                  <Callout tone="green" icon={<CircleCheck />} title={`Đã thu ${vnd(collected.amount)} tại quầy`}
                    action={collected.paymentIds.map((id, i) => <ReceiptButton key={id} paymentId={id} print label={collected.paymentIds.length > 1 ? `In biên lai ${i + 1}` : 'In biên lai'} />)}>
                    Tiếp tục ký hợp đồng và nhận kho.
                  </Callout>
                )}
                {awaitingCounter(r) && <CollectDepositStep r={r} onCollected={(v) => setCollected({ reservationId: r._id, ...v })} />}
                {early && (
                  <Callout tone="blue" icon={<CalendarClock />} title={`Khách đến sớm · lịch nhận ${fmtDate(r.startDate)}`}
                    action={earlyCheck?.ok && <Button size="sm" disabled={busy} onClick={receiveToday}>Nhận kho từ hôm nay</Button>}>
                    <span className="text-xs">{earlyCheck?.ok ? `Chưa bàn giao được trước ngày nhận.${r.signature ? ' Đổi ngày thì khách phải ký lại hợp đồng.' : ''}` : earlyCheck?.message}</span>
                  </Callout>
                )}
                {awaitingCounter(r) || (early && blockers.length === 0) ? null : blockers.length === 0 && !r.signature ? (
                  <div className="space-y-4">
                    {!wantsPaper(r) && <Callout tone="amber" icon={<TriangleAlert />} title="Khách chưa ký hợp đồng — chưa bàn giao kho được." />}
                    {/* Khách đã chọn ký giấy tại quầy: bước in / tải bản scan lên trước, lời nhắc ký online xuống sau. */}
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      <div className={cx('flex flex-col gap-3 rounded-xl p-4 text-sm ring-1 ring-inset ring-stone-200', wantsPaper(r) ? 'order-2' : 'order-1')}>
                        <div className="flex items-center gap-2.5">
                          <IconTile icon={<Smartphone className="size-4" />} tone="blue" size="sm" />
                          <p className="min-w-0 flex-1 font-semibold text-ink">Ký online</p>
                          <InfoTip align="end">Khách ký trên app / web: Đặt chỗ của tôi → Ký hợp đồng, mã {r.code}.</InfoTip>
                        </div>
                        <p className="text-stone-600">{wantsPaper(r) ? 'Khách vẫn có thể ký online thay cho ký giấy.' : 'Khách ký trên app / web rồi bấm “Kiểm tra lại”.'}</p>
                        <Chip mono className="self-start">{r.code}</Chip>
                        <Button className="mt-auto self-start" size="sm" variant="secondary" onClick={() => void refresh()}><RefreshCw className="size-4" />Kiểm tra lại</Button>
                      </div>
                      <div className={cx('space-y-3 rounded-xl p-4 text-sm ring-1 ring-inset', wantsPaper(r) ? 'order-1 bg-violet-50/60 ring-violet-200' : 'order-2 ring-stone-200')}>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <IconTile icon={<PenLine className="size-4" />} tone="violet" size="sm" />
                          <p className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold text-ink">Ký giấy tại quầy{wantsPaper(r) && <Badge tone="violet">Khách đã chọn</Badge>}</p>
                          <Button size="sm" variant="secondary" disabled={fileBusy} onClick={() => void printContract(r)}><Printer className="size-3.5" />In hợp đồng</Button>
                        </div>
                        <ol className="flex flex-wrap gap-1.5 text-xs text-stone-600">
                          {['In hợp đồng', 'Đối chiếu giấy tờ, khách đọc & ký', 'Tải bản đã ký lên'].map((s, i) => (
                            <li key={s} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 ring-1 ring-inset ring-stone-200"><span className="font-semibold text-violet-700">{i + 1}</span>{s}</li>
                          ))}
                        </ol>
                        <div className={COLS2}>
                          <Field label="Họ tên người ký"><input className={inputCls} value={paperName} maxLength={100} onChange={(e) => setPaperName(e.target.value)} placeholder={userName(db, r.customerId)} /></Field>
                          <Field label="Bản đã ký (PDF / JPG / PNG, ≤ 5MB)" error={paperErr || undefined}>
                            <input type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-stone-200"
                              onChange={(e) => pickPaper(e.target.files?.[0] ?? null)} />
                          </Field>
                        </div>
                        <Button disabled={busy || paperName.trim().length < 2 || !paperFile} onClick={() => void savePaper()}><Upload className="size-4" />Lưu bản đã ký</Button>
                      </div>
                    </div>
                  </div>
                ) : blockers.length > 0 ? (
                  <Callout tone="amber" icon={<Ban />} title="Chưa nhận kho được">
                    <ul className="space-y-1">{blockers.map((b) => <li key={b} className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />{b}</li>)}</ul>
                  </Callout>
                ) : (
                  <div className="space-y-6">
                    {/* Ký giấy (PAPER): SignatureInfo ghi "Ký giấy tại quầy", ContractFileActions tải bản scan. */}
                    {r.signature && (
                      <StepBlock n={1} state="done" icon={<PenLine />} title="Hợp đồng đã ký">
                        <SignatureInfo signature={r.signature} /><ContractFileActions reservation={r} />
                      </StepBlock>
                    )}

                    <StepBlock n={2} state={errs.keyTag ? 'current' : 'done'} icon={<KeyRound />} title="Phương tiện mở kho">
                      <div className={COLS2}>
                        <Field label="Hình thức truy cập">
                          <div className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm font-medium ring-1 ring-inset ring-stone-200">
                            <KeyRound className="size-4 text-stone-500" />{ACCESS_METHOD[method]}
                          </div>
                        </Field>
                        {method !== 'PIN' && <Field label={method === 'PHYSICAL_KEY' ? 'Mã chìa khoá (bắt buộc)' : 'Số thẻ khoá (bắt buộc)'} error={errOf('keyTag')}><input className={cx(inputCls, invalidCls('keyTag'))} data-invalid={!!errOf('keyTag')} value={keyTag} maxLength={50} onChange={(e) => setKeyTag(e.target.value)} placeholder={method === 'PHYSICAL_KEY' ? `K-${unitLabel(db, r.unitId)}` : 'RF-000123'} /></Field>}
                      </div>
                    </StepBlock>

                    <StepBlock n={3} state={errs.txnRef ? 'current' : 'done'} icon={<Banknote />} title="Thanh toán khi nhận kho"
                      aside={<span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold tabular-nums text-white">Thu {vnd(totalDue)}</span>}>
                      <div className="space-y-3">
                        <Ledger>
                          <LedgerRow label="Tiền giữ chân" tip="Đã thu lúc đặt, không trừ vào tiền thuê." tone={r.depositPaymentId ? 'good' : 'bad'} value={`${vnd(r.quote.depositAmount)} · ${r.depositPaymentId ? 'đã thu' : 'chưa thu'}`} />
                          {r.quote.firstPeriodAtBooking ? (
                            <LedgerRow label={`Tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`} tip="Đã trả lúc đặt chỗ." tone="good" value={`${vnd(r.quote.firstPeriodRent)} · đã thu`} />
                          ) : null}
                          {rentDue > 0 && <LedgerRow label={paysWholeTerm(r.quote) ? `Tiền thuê cả thời hạn (${periodLabel(r.quote.rentalPeriod, r.periods)})` : `Tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`} value={vnd(rentDue)} />}
                          {svcOrders.map((o) => (
                            <LedgerRow key={o._id} icon={<PackagePlus />} label={<>Dịch vụ kèm: {o.serviceName} × {o.quantity} {o.unitLabel} <span className="font-mono text-xs text-stone-400">{o.orderNumber}</span></>} value={vnd(o.total)} />
                          ))}
                          <LedgerRow total label="Thu hôm nay" value={vnd(totalDue)} />
                        </Ledger>
                        {(() => {
                          const grace = db.policies.find((p) => p._id === r.quote.policyId)?.gracePeriodDays;
                          const next = addPeriods(todayISO(), r.quote.rentalPeriod, Math.max(1, r.quote.prepaidPeriods ?? 1));
                          return (
                            <p className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                              <CalendarClock className="size-3.5 shrink-0 text-stone-400" />
                              Kỳ kế tiếp từ <b className="text-stone-700">{fmtDate(next)}</b>
                              {grace !== undefined && <>· hạn trả <b className="text-stone-700">{fmtDate(paymentDueDate(next, grace))}</b></>}
                              <InfoTip align="start">{paysWholeTerm(r.quote) && 'Trả kho sớm không hoàn các kỳ chưa dùng. '}{grace !== undefined && 'Quá hạn trả thì tính phí trễ.'}</InfoTip>
                            </p>
                          );
                        })()}
                        {totalDue > 0 && (
                          <Field label="Hình thức thu tiền">
                            <PayMethodPicker icons value={pay} onChange={setPay} methods={['CASH', 'CARD', 'VNPAY', 'BANK_TRANSFER']} />
                          </Field>
                        )}
                        {totalDue > 0 && pay !== 'CASH' && (
                          <Field label="Mã giao dịch" error={errOf('txnRef')}>
                            <input className={cx(inputCls, invalidCls('txnRef'))} data-invalid={!!errOf('txnRef')} maxLength={64} value={txnRef} onChange={(e) => setTxnRef(e.target.value)} placeholder={pay === 'CARD' ? 'Mã chuẩn chi' : pay === 'VNPAY' ? 'Mã giao dịch VNPay' : 'FT26292xxxxx'} />
                          </Field>
                        )}
                      </div>
                    </StepBlock>

                    {(() => {
                      const declared = byId(db.users, r.customerId)?.customerProfile;
                      return (
                        <StepBlock n={4} state={idOk && idChecked ? 'done' : 'current'} icon={<IdCard />} title="Đối chiếu giấy tờ bản gốc"
                          tip={declared?.idType ? 'Nhập theo bản gốc — hệ thống tự so với số đã khai, không khớp thì KHÔNG bàn giao.' : 'Khách chưa khai giấy tờ — nhập theo bản gốc khách xuất trình.'}>
                          <div className="space-y-3 rounded-xl bg-sky-50/70 p-4 text-sm ring-1 ring-inset ring-sky-200">
                            <ChipRow>
                              {declared?.idType
                                ? <><Chip icon={<IdCard />} tone="blue" title="Giấy tờ khách đã khai">Đã khai {ID_TYPE_LABEL[declared.idType]}</Chip><Chip icon={<UserRound />} title="Họ tên">{userName(db, r.customerId)}</Chip></>
                                : <Chip icon={<IdCard />} tone="amber">Khách chưa khai giấy tờ</Chip>}
                              {declared?.idType && isFM && (
                                <button type="button" title="Khách đã đổi giấy tờ hợp lệ? Cập nhật theo bản gốc." className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" onClick={() => setEditIdentity(true)}>
                                  <Pencil className="size-3" />Cập nhật theo bản gốc
                                </button>
                              )}
                            </ChipRow>
                            <div className="grid gap-3 sm:grid-cols-[1fr_140px] lg:grid-cols-1 xl:grid-cols-[1fr_140px]">
                              <Field label="Loại giấy tờ khách xuất trình" error={errOf('idType')}>
                                <select className={cx(inputCls, invalidCls('idType'))} data-invalid={!!errOf('idType')} value={idInput.idType} onChange={(e) => setIdInput((x) => ({ ...x, idType: e.target.value as 'CCCD' | 'PASSPORT' | '' }))}>
                                  <option value="">— Chọn —</option>
                                  {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
                                </select>
                              </Field>
                              <Field label="4 số cuối" error={errOf('last4')}><input className={cx(inputCls, 'font-mono uppercase', invalidCls('last4'))} data-invalid={!!errOf('last4')} maxLength={4} autoComplete="off" value={idInput.idNumberLast4} onChange={(e) => setIdInput((x) => ({ ...x, idNumberLast4: e.target.value }))} /></Field>
                            </div>
                            {/* Nhập sai nhiều lần → server khoá đối chiếu của đặt chỗ (423 ID_CHECK_LOCKED); quản lý mở khoá tại đây. */}
                            <IdCheckUnlock kind="reservations" target={r} label={`đặt chỗ ${r.code}`} />
                            <label className={cx('flex cursor-pointer gap-2.5 rounded-lg px-3 py-2.5 text-sky-950 ring-inset', invalidCls('idChecked') || (idChecked ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'bg-white ring-1 ring-sky-200'))}>
                              <input type="checkbox" className="mt-0.5 size-4 shrink-0" data-invalid={!!errOf('idChecked')} checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} />
                              <span>Đã đối chiếu bản gốc: đúng người, họ tên và 4 số cuối khớp.</span>
                            </label>
                            {errOf('idChecked') && <p role="alert" className="text-xs font-medium text-red-600">{errOf('idChecked')}</p>}
                          </div>
                        </StepBlock>
                      );
                    })()}

                    <ActionBar note={tried && hasErr && <p role="alert" className="text-right text-xs font-medium text-red-600">Còn ô chưa điền / chưa tick — xem các ô báo đỏ ở trên.</p>}>
                      <Button size="lg" className="w-full sm:w-auto" disabled={busy} onClick={submit}><KeyRound className="size-4" />Xác nhận bàn giao kho</Button>
                    </ActionBar>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <Card className="self-start">
          <PanelHeader icon={<ScanLine className="size-4" />} tone="blue" title="Sẵn sàng nhận kho" count={arrivals.length} tip="Đã phân kho, đến ngày nhận. Bấm một dòng để mở." />
          <div className="border-b border-stone-100 px-4 py-2.5 sm:px-5">
            <PillFilter<CheckInShift | 'ALL'> value={shiftFilter} onChange={setShiftFilter} options={[
              { key: 'ALL', label: 'Tất cả ca' },
              ...(user.shift ? [{ key: user.shift, label: `Ca của tôi (${CHECK_IN_SHIFT[user.shift].label})`, icon: <Clock /> }] : []),
            ]} />
          </div>
          {counterHolds.length > 0 && (
            <div className="border-b border-stone-100 pb-1">
              <SubHeading icon={<Store />} tone="violet" title="Chờ thu tiền tại quầy" count={counterHolds.length} />
              <ul className="divide-y divide-stone-100">
                {counterHolds.map((x) => (
                  <QueueRow key={x._id} active={r?._id === x._id} onSelect={() => { setCode(x.code); void lookup(x.code); }}
                    lead={<UnitTag label={unitLabel(db, x.unitId)} tone="violet" size="sm" />}
                    title={userName(db, x.customerId)}
                    meta={<>
                      <Meta mono>{x.code}</Meta>
                      <Meta icon={<Banknote />}>{vnd(dueAtBooking(x.quote))}</Meta>
                      {x.holdExpiresAt && <Meta icon={<Timer />} className="text-violet-700">Giữ ô đến {fmtHoldUntil(x.holdExpiresAt)}</Meta>}
                    </>}
                  />
                ))}
              </ul>
            </div>
          )}
          <SubHeading icon={<CalendarCheck />} tone="blue" title="Đến ngày nhận" count={arrivals.length} />
          {arrivals.length === 0 ? <EmptyState compact icon={<CalendarCheck className="size-5" />} title="Không có lượt nào" /> : (
            <ul className="divide-y divide-stone-100">
              {arrivals.map((x) => (
                <QueueRow key={x._id} active={r?._id === x._id} onSelect={() => { setCode(x.code); void lookup(x.code); }}
                  lead={<UnitTag label={unitLabel(db, x.unitId)} size="sm" />}
                  title={userName(db, x.customerId)}
                  meta={<>
                    <Meta mono>{x.code}</Meta>
                    <StatusBadge map={CHECK_IN_SHIFT} value={x.preferredCheckInShift} />
                    {wantsPaper(x) && <Badge tone={SIGNING_PREFERENCE.PAPER_AT_COUNTER.tone}>{SIGNING_PREFERENCE.PAPER_AT_COUNTER.label}</Badge>}
                  </>}
                  actions={isFM && (
                    <button type="button" title={x.signature ? 'Khách đã ký — huỷ hoàn 100% nếu không giao được ô' : 'Đổi sang ô khác cùng loại (khách chưa ký hợp đồng)'}
                      aria-label={x.signature ? 'Khách đã ký — huỷ hoàn 100% nếu không giao được ô' : 'Đổi sang ô khác cùng loại (khách chưa ký hợp đồng)'} onClick={() => openAssign(x)}
                      className="shrink-0 rounded-md p-2 text-stone-400 hover:bg-stone-100 hover:text-brand-700">
                      <Repeat className="size-4" />
                    </button>
                  )}
                />
              ))}
            </ul>
          )}
          {upcoming.length > 0 && (
            <div className="border-t border-stone-100">
              <SubHeading icon={<CalendarClock />} title="Sắp nhận kho (14 ngày tới)" count={upcoming.length} />
              <ul className="divide-y divide-stone-100">
                {upcoming.map((x) => (
                  <QueueRow key={x._id}
                    lead={<UnitTag label={unitLabel(db, x.unitId)} tone="gray" size="sm" />}
                    title={userName(db, x.customerId)}
                    meta={<>
                      <Meta mono>{x.code}</Meta>
                      <Meta icon={<CalendarDays />}>Nhận {fmtDate(x.startDate)}</Meta>
                      {x.signature ? <Meta icon={<PenLine />} className="text-emerald-700">Đã ký</Meta> : wantsPaper(x) && <Meta icon={<PenLine />} className="text-violet-700">{SIGNING_PREFERENCE.PAPER_AT_COUNTER.label}</Meta>}
                    </>}
                    actions={<Button size="sm" variant="secondary" onClick={() => openAssign(x)}>{x.signature ? 'Huỷ…' : 'Đổi ô'}</Button>}
                  />
                ))}
              </ul>
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="border-t border-stone-100">
              <SubHeading icon={<CircleDashed />} tone="amber" title="Chưa có ô — cần phân" count={unassigned.length}
                tip={isFM ? 'Quá hạn nhận mà vẫn chưa có ô thì hệ thống tự huỷ và hoàn khách 100%.' : 'Báo Quản lý chi nhánh phân ô trước khi khách đến.'} />
              <ul className="divide-y divide-stone-100">
                {unassigned.map((x) => (
                  <QueueRow key={x._id}
                    lead={<IconTile icon={<CircleDashed className="size-4" />} tone="amber" size="sm" />}
                    title={userName(db, x.customerId)}
                    meta={<>
                      <Meta mono>{x.code}</Meta>
                      <Meta icon={<Warehouse />}>{typeName(db, x.unitTypeId)}</Meta>
                      <Meta icon={<CalendarDays />}>Nhận {fmtDate(x.startDate)}</Meta>
                    </>}
                    actions={isFM && <Button size="sm" variant="secondary" onClick={() => openAssign(x)}>Phân ô</Button>}
                  />
                ))}
              </ul>
            </div>
          )}
          <div className="h-2" aria-hidden />
        </Card>
      </div>
      <Modal open={!!assign} onClose={() => setAssign(null)} title={assign?.unitId ? 'Đổi ô cho đặt chỗ' : 'Phân ô cho đặt chỗ'}
        description={assign ? `${userName(db, assign.customerId)} · ${assign.code} · ${typeName(db, assign.unitTypeId)}${assign.unitId ? ` · đang giữ ô ${unitLabel(db, assign.unitId)}` : ''}` : ''}
        footer={<>
          {assign && <Button variant="danger" onClick={() => { setCancelling({ r: assign, reason: 'FACILITY_UNAVAILABLE' }); setAssign(null); }}>Không giao được ô — huỷ, hoàn 100%</Button>}
          {!assign?.signature && <Button disabled={!assignUnit} onClick={() => assign && void run('allocate', { reservationId: assign._id, unitId: assignUnit }, (u) => `Đã ${assign.unitId ? 'đổi sang' : 'phân'} ô ${u.unitNumber}`, () => setAssign(null))}>Xác nhận</Button>}
        </>}>
        {assign?.signature ? (
          <Callout tone="amber" icon={<PenLine />} title={`Khách đã ký hợp đồng ghi ô ${unitLabel(db, assign.unitId)} nên không đổi ô được.`}>Ô không giao được thì huỷ đặt chỗ — hoàn khách 100%.</Callout>
        ) : assignCandidates.length === 0 ? <Callout tone="amber" icon={<TriangleAlert />} title="Không còn ô trống cùng loại ở chi nhánh này." /> : (
          <Field label="Ô mới (cùng loại, đang trống)">
            <select className={inputCls} value={assignUnit} onChange={(e) => setAssignUnit(e.target.value)}>
              <option value="">— Chọn ô —</option>
              {assignCandidates.map((u) => <option key={u._id} value={u._id}>{u.unitNumber} · tầng {u.location.floor} · {ACCESS_METHOD[u.accessMethod]}{assignFromMethod && u.accessMethod !== assignFromMethod ? ' (khác khoá ô cũ)' : ''}</option>)}
            </select>
          </Field>
        )}
      </Modal>
      <CancelReservationDialog reservation={cancelling?.r ?? null} defaultReason={cancelling?.reason} onClose={() => setCancelling(null)} />
      <CustomerIdentityDialog target={isFM && editIdentity && r ? { kind: 'reservations', id: r._id } : null} customer={r ? byId(db.users, r.customerId) ?? null : null} onClose={() => setEditIdentity(false)} />
    </>
  );
}

export default function CheckInPage() {
  return <Suspense><CheckInInner /></Suspense>;
}
