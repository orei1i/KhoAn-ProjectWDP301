'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, Check, CircleCheck, FileText, Hourglass, IdCard, KeyRound, Mail, MailCheck, Minus, PackagePlus, Phone, Plus, Search, Snowflake, Trash2, TriangleAlert,
  UserPlus, UserRound, Warehouse,
} from 'lucide-react';
import type { BusinessPolicy, CheckInShift, Facility, PriceQuote, RentalPeriod, Reservation, UnitType } from '@ssm/shared';
import {
  allowsRentalPeriod, buildPaymentSchedule, dueAtBooking, dueAtCheckIn, ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, isMonthOnly, isValidPersonName, isValidProfilePhone,
  maxLeadDaysOf, normalizeIdLast4, normalizePhone, periodLabel, servicesAllowedFor, STAFF_SHIFTS, type IdType,
} from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { actions, isTxnRef, type BookingLine, type CounterCustomer, type PriceChangedDetails, type UnitTakenDetails, type WalkInCustomerInput } from '@/shared/api/actions';
import { CHECK_IN_SHIFT, PERIOD_UNIT } from '@/shared/lib/labels';
import { addDays, todayISO, vnd } from '@/shared/lib/format';
import { unitLabel } from '@/shared/lib/domain';
import { Badge, Button, ButtonLink, Card, EmptyState, Field, IconTile, InfoTip, PageHeader, Skeleton, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { FloorPlanPicker, type FloorPlanUnit } from '@/features/facilities/floor-plan-picker';
import { DurationPicker } from '@/features/facilities/duration-picker';
import { PayMethodPicker } from '@/features/payments/pay-method';
import { NewReceipts } from '@/features/payments/receipt-button';
import { ContractPreviewDialog, type ContractPreviewParams } from '@/features/contracts/contract-preview';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/features/legal/legal-content';
import { AvailabilityBar, CATEGORY_ICON, serviceIcon } from '@/features/facilities/visuals';
import { Avatar, Callout, CheckLine, Chip, ChipRow, Ledger, LedgerRow, Meta, QueueRow, StepCard, StepTrack, UnitTag, type StepState } from '@/features/staff-ui';

// Cùng dữ liệu trang đặt kho công khai (GET /facilities/public/:id) — báo giá theo đúng chu kỳ / số kỳ / điều hòa đang chọn.
type TypeRow = UnitType & { quote: PriceQuote; acEligible: boolean; availability: { total: number; free: number; available: number } };
interface Detail {
  facility: Facility;
  unitTypes: TypeRow[];
  services: { _id: string; code: string; name: string; price: number; unitLabel: string }[];
  policy: Pick<BusinessPolicy, 'discounts' | 'gracePeriodDays'>;
}
interface PickedUnit { unitId: string; unitNumber: string; typeId: string; typeName: string }
type WalkInPay = 'CASH' | 'BANK_TRANSFER' | 'CARD';
type Cust = { kind: 'existing'; c: CounterCustomer } | { kind: 'new' } | null;

const MAX_UNITS = 10;
const MAX_SERVICE_QTY = 99;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHECK_IN_SHIFTS: CheckInShift[] = [...STAFF_SHIFTS, 'UNKNOWN'];
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
/** Khoá "đã xem hợp đồng" của một dòng — đổi ô / ngày / chu kỳ / số kỳ / điều hòa là hợp đồng khác, phải xem lại. */
const contractKey = (p: ContractPreviewParams) => `${p.unitId}|${p.startDate.slice(0, 10)}|${p.rentalPeriod}|${p.periods}|${p.useAirConditioning}`;
const EMPTY_FORM = { fullName: '', email: '', phone: '', idType: 'CCCD' as IdType | '', idNumberLast4: '' };
const OTP_RE = /^\d{6}$/;

/**
 * Đặt chỗ tại quầy cho khách vãng lai: tra / tạo khách → chọn kho trên sơ đồ → khách xem hợp đồng, xác nhận → thu tiền giữ chân
 * (+ tiền thuê kỳ đầu với kho cỡ lớn) ngay tại quầy. Sau đó sang "Nhận kho" để in hợp đồng, khách ký giấy và bàn giao.
 */
export default function WalkInBooking() {
  const { db, user, run, busy } = useStore();
  const scope = useFacilityScope();
  const facilityId = scope.facilityId;

  // ---- bước 1: khách
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [lookupErr, setLookupErr] = useState('');
  const [cust, setCust] = useState<Cust>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // Khách mới: xác minh email bằng mã 6 số trước khi tạo tài khoản — thông báo hợp đồng chỉ gửi tới email đã xác minh.
  const [otp, setOtp] = useState<{ email: string; sentTo: string; demoCode?: string } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpErr, setOtpErr] = useState('');

  // ---- bước 2: kho
  const [start, setStart] = useState(todayISO().slice(0, 10));
  const [period, setPeriod] = useState<RentalPeriod>('MONTH');
  const [periods, setPeriods] = useState(1);
  const [useAirConditioning, setUseAirConditioning] = useState(false);
  const [shift, setShift] = useState<CheckInShift>(user?.shift ?? 'UNKNOWN');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState('');
  const [typeId, setTypeId] = useState('');
  const [floorPlan, setFloorPlan] = useState<FloorPlanUnit[] | null>(null);
  const [picked, setPicked] = useState<PickedUnit[]>([]);
  const [svcQty, setSvcQty] = useState<Record<string, number>>({});
  // Tăng sau mỗi lượt đặt thành công để tải lại sơ đồ / chỗ trống.
  const [reload, setReload] = useState(0);

  // ---- bước 3: xác nhận
  const [preview, setPreview] = useState<ContractPreviewParams | null>(null);
  const [viewedContracts, setViewedContracts] = useState<string[]>([]);
  const [ackedContracts, setAckedContracts] = useState('');
  const [ackedPayment, setAckedPayment] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [pay, setPay] = useState<WalkInPay>('CASH');
  const [txnRef, setTxnRef] = useState('');
  // Giữ nguyên giữa các lần bấm của cùng một lượt đặt — bấm 2 lần không tạo 2 đặt chỗ; đổi sau khi đặt thành công.
  const [idemKey, setIdemKey] = useState(newKey);
  const [done, setDone] = useState<{ customerName: string; items: Reservation[]; before: string[] } | null>(null);
  // Đợt 17 (C2, C5): giá vừa đổi / ô vừa bị giữ — báo ngay tại bước thu tiền, không mất thông tin khách và giỏ đã nhập.
  const [notice, setNotice] = useState('');

  // Đổi chi nhánh → bỏ các ô đã chọn.
  useEffect(() => { setPicked([]); setTypeId(''); setSvcQty({}); setDetail(null); }, [facilityId]);

  useEffect(() => {
    if (!facilityId) return;
    let alive = true;
    api.get<Detail>(`/facilities/public/${facilityId}?period=${period}&periods=${periods}&ac=${useAirConditioning}`)
      .then((d) => { if (!alive) return; setDetail(d); setDetailErr(''); setTypeId((cur) => cur || d.unitTypes.find((t) => t.availability.available > 0)?._id || ''); })
      .catch((e: Error) => alive && setDetailErr(e.message));
    return () => { alive = false; };
  }, [facilityId, period, periods, useAirConditioning, reload]);

  useEffect(() => {
    if (!facilityId || !typeId) { setFloorPlan(null); return; }
    let alive = true;
    api.get<{ items: FloorPlanUnit[] }>(`/facilities/public/${facilityId}/unit-types/${typeId}/floor-plan`)
      .then((d) => alive && setFloorPlan(d.items))
      .catch(() => alive && setFloorPlan([]));
    return () => { alive = false; };
  }, [facilityId, typeId, reload]);

  const cart = useMemo(() => picked.flatMap((p) => {
    const t = detail?.unitTypes.find((x) => x._id === p.typeId);
    return t ? [{ ...p, quote: t.quote, useAirConditioning: t.acEligible && useAirConditioning }] : [];
  }), [picked, detail, useAirConditioning]);
  const schedule = cart.length ? buildPaymentSchedule(cart.map((l) => l.quote), detail?.policy.gracePeriodDays) : null;

  if (!user) return null;

  const types = detail?.unitTypes ?? [];
  const ut = types.find((t) => t._id === typeId);
  // Dịch vụ kèm chỉ cho kho từ cỡ Vừa trở lên — gắn vào ô đủ lớn đầu tiên trong giỏ.
  const svcLine = cart.find((l) => servicesAllowedFor(types.find((t) => t._id === l.typeId)?.category ?? ''));
  const services = (detail?.services ?? []).length > 0 && (!!svcLine || (!!ut && servicesAllowedFor(ut.category))) ? detail?.services ?? [] : [];
  const pickedServices = !svcLine ? [] : services.filter((s) => (svcQty[s._id] ?? 0) > 0).map((s) => ({ ...s, quantity: svcQty[s._id] }));
  const servicesTotal = pickedServices.reduce((sum, s) => sum + s.price * s.quantity, 0);
  const setQty = (serviceId: string, qty: number) => setSvcQty((c) => ({ ...c, [serviceId]: Math.min(MAX_SERVICE_QTY, Math.max(0, Math.round(qty) || 0)) }));

  const lineParams = (l: (typeof cart)[number]): ContractPreviewParams => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate: `${start}T00:00:00.000Z`, rentalPeriod: period, periods, useAirConditioning: l.useAirConditioning, label: `${l.typeName} · ô ${l.unitNumber} · ${periodLabel(period, periods)}` });
  const cartKeys = cart.map((l) => contractKey(lineParams(l)));
  const allViewed = cart.length > 0 && cartKeys.every((k) => viewedContracts.includes(k));
  const agreeContract = allViewed && ackedContracts === cartKeys.join(',');
  const payKey = schedule ? `${schedule.payNow}:${schedule.payAtCheckIn}:${servicesTotal}` : '';
  const agreePayment = !!schedule && ackedPayment === payKey;

  // Khách: có tài khoản hoặc khách mới — đều nhập loại + 4 số cuối theo giấy tờ bản gốc (khách cũ: server so với số đã khai).
  const idType = form.idType || null;
  const idOk = !!idType && ID_LAST4_RE.test(form.idNumberLast4.trim());
  const existing = cust?.kind === 'existing' ? cust.c : null;
  const suspended = existing?.status === 'SUSPENDED';
  const email = form.email.trim().toLowerCase();
  const otpSent = !!otp && otp.email === email; // đổi email sau khi gửi mã → phải gửi lại
  const customer: WalkInCustomerInput | null = existing
    ? (suspended || !idOk || !idType ? null : { customerId: existing._id, idType, idNumberLast4: normalizeIdLast4(form.idNumberLast4) })
    : cust?.kind === 'new' && isValidPersonName(form.fullName.trim()) && EMAIL_RE.test(email) && isValidProfilePhone(form.phone) && idOk && idType && otpSent && OTP_RE.test(otpCode.trim())
      ? { email, fullName: form.fullName.trim(), phone: normalizePhone(form.phone), idType, idNumberLast4: normalizeIdLast4(form.idNumberLast4), emailOtp: otpCode.trim() }
      : null;
  const txnOk = pay === 'CASH' || isTxnRef(txnRef);
  const canSubmit = !!customer && cart.length > 0 && agreeTerms && agreePayment && agreeContract && txnOk && !busy;

  const sendOtp = async () => {
    setOtpErr(''); setOtpBusy(true);
    try {
      const r = await actions.requestWalkInEmailOtp({ email });
      setOtp({ email, sentTo: r.sentTo, demoCode: r.demoCode }); setOtpCode('');
    } catch (e) {
      setOtpErr(e instanceof Error ? e.message : 'Không gửi được mã');
    } finally {
      setOtpBusy(false);
    }
  };

  const lookup = async () => {
    const s = q.trim();
    setLookupErr(''); setCust(null); setOtp(null); setOtpCode(''); setOtpErr('');
    if (s.length < 5) { setLookupErr('Nhập email hoặc số điện thoại'); return; }
    const isEmail = s.includes('@');
    setSearching(true);
    try {
      const c = await actions.lookupCustomer({ q: isEmail ? s.toLowerCase() : normalizePhone(s) });
      if (c) { setCust({ kind: 'existing', c }); setForm({ ...EMPTY_FORM, idType: '' }); } // không chọn sẵn — nhân viên nhập theo bản gốc
      else { setCust({ kind: 'new' }); setForm({ ...EMPTY_FORM, email: isEmail ? s.toLowerCase() : '', phone: isEmail ? '' : s }); }
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : 'Không tra cứu được');
    } finally {
      setSearching(false);
    }
  };

  const toggleUnit = (unitId: string) => {
    if (!ut) return;
    if (picked.some((p) => p.unitId === unitId)) { setPicked((c) => c.filter((p) => p.unitId !== unitId)); return; }
    if (picked.length >= MAX_UNITS) return;
    const u = floorPlan?.find((x) => x._id === unitId);
    setPicked((c) => [...c, { unitId, unitNumber: u?.unitNumber ?? '', typeId: ut._id, typeName: ut.name }]);
  };

  const submit = async () => {
    if (!customer || !canSubmit) return;
    const startDate = `${start}T00:00:00.000Z`;
    const servicesPayload = pickedServices.map((s) => ({ serviceId: s._id, quantity: s.quantity }));
    // Dịch vụ kèm gắn vào ô đủ lớn đầu tiên trong giỏ (như đặt online).
    const items: BookingLine[] = cart.map((l) => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate, rentalPeriod: period, periods, preferredCheckInShift: shift, useAirConditioning: l.useAirConditioning, ...(l === svcLine ? { services: servicesPayload } : {}) }));
    const before = db.payments.map((p) => p._id);
    setNotice('');
    const res = await run('walkInBooking', {
      customer, items, payMethod: pay, txnRef, idempotencyKey: idemKey,
      // Đợt 17 (C2): BẮT BUỘC gửi số đang thu — giá vừa đổi thì server từ chối (409 PRICE_CHANGED), không thu, không ghi gì.
      expectedTotal: cart.reduce((s, l) => s + dueAtBooking(l.quote), 0),
      consent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true, contractAck: true },
    }, (v) => `Đã đặt ${v.items.length} kho cho ${v.customer.fullName}`);
    if (res.ok) { setDone({ customerName: res.value.customer.fullName, items: res.value.items, before }); setIdemKey(newKey()); setReload((n) => n + 1); return; }
    if (res.code === 'PRICE_CHANGED') {
      // Hợp đồng và lịch thanh toán khách đã xem ghi giá cũ — khách xem và xác nhận lại theo giá mới; thông tin khách, giỏ, hình thức thu giữ nguyên.
      const d = res.details as PriceChangedDetails | undefined;
      setViewedContracts([]); setAckedContracts(''); setAckedPayment('');
      setNotice(d ? `Giá vừa thay đổi: thu ngay ${vnd(d.total)} (trước đó ${vnd(d.expectedTotal)}). Chưa thu tiền. Báo khách giá mới, xem lại hợp đồng rồi xác nhận lại.` : `${res.error}.`);
      setReload((n) => n + 1);
    } else if (res.code === 'UNIT_NOT_AVAILABLE') {
      const taken = res.details as UnitTakenDetails | undefined;
      if (taken?.unitId) setPicked((c) => c.filter((p) => p.unitId !== taken.unitId));
      setNotice(`${res.error}. Chưa thu tiền${taken?.unitId ? ', đã bỏ ô này khỏi giỏ' : ''}.`);
      setReload((n) => n + 1);
    }
  };

  const reset = () => {
    setDone(null); setNotice(''); setQ(''); setCust(null); setLookupErr(''); setForm(EMPTY_FORM); setPicked([]); setSvcQty({});
    setViewedContracts([]); setAckedContracts(''); setAckedPayment(''); setAgreeTerms(false); setPay('CASH'); setTxnRef('');
    setOtp(null); setOtpCode(''); setOtpErr('');
  };

  if (done) {
    const collected = done.items.reduce((s, r) => s + dueAtBooking(r.quote), 0);
    const atCheckIn = done.items.reduce((s, r) => s + dueAtCheckIn(r.quote), 0);
    return (
      <>
        <PageHeader title="Đặt chỗ tại quầy" />
        <Card className="max-w-2xl overflow-hidden border-emerald-200">
          <div className="flex flex-wrap items-center gap-4 bg-emerald-50 p-4 sm:p-5">
            <IconTile icon={<CircleCheck className="size-6" />} tone="green" size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-emerald-900">Đã đặt chỗ cho {done.customerName}</p>
              <p className="text-sm text-emerald-900/80">Đã thu <b className="tabular-nums">{vnd(collected)}</b>{atCheckIn > 0 && <> · thu thêm <b className="tabular-nums">{vnd(atCheckIn)}</b> khi nhận kho</>}.</p>
            </div>
          </div>
          <ul className="divide-y divide-stone-100">
            {done.items.map((r) => (
              <QueueRow key={r._id}
                lead={<UnitTag label={unitLabel(db, r.unitId)} size="sm" />}
                title={<span className="font-mono">{r.code}</span>}
                meta={<><Meta icon={<Hourglass />}>{periodLabel(r.quote.rentalPeriod, r.periods)}</Meta><Meta icon={<Banknote />}>Đã thu {vnd(dueAtBooking(r.quote))}</Meta></>}
                actions={<ButtonLink href={`/staff/check-in?code=${encodeURIComponent(r.code)}`} size="sm"><KeyRound className="size-3.5" />Ký giấy & nhận kho</ButtonLink>}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 p-4 sm:p-5">
            <NewReceipts payments={db.payments.filter((p) => done.items.some((r) => r._id === p.reservationId))} before={done.before} />
            <Button variant="secondary" size="sm" className="ml-auto" onClick={reset}><UserPlus className="size-4" />Đặt cho khách khác</Button>
          </div>
        </Card>
      </>
    );
  }

  const step3State: StepState = canSubmit ? 'done' : customer && cart.length > 0 ? 'current' : 'todo';

  return (
    <>
      <PageHeader title="Đặt chỗ tại quầy" description="Khách chưa đặt online — đặt kho và thu tiền giữ chân tại quầy." actions={<FacilityPicker scope={scope} />} />
      <StepTrack className="mb-6 max-w-lg" steps={[
        { label: 'Khách hàng', icon: <UserRound />, state: customer ? 'done' : 'current' },
        { label: 'Chọn kho', icon: <Warehouse />, state: cart.length > 0 ? 'done' : customer ? 'current' : 'todo' },
        { label: 'Xác nhận & thu tiền', icon: <Banknote />, state: step3State },
      ]} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <StepCard n={1} state={customer ? 'done' : 'current'} icon={<UserRound />} title="Khách hàng"
            tip="Tìm theo email hoặc số điện thoại. Có tài khoản hay khách mới đều nhập loại + 4 số cuối theo giấy tờ bản gốc.">
            <div className="space-y-4">
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
                <div className="relative min-w-56 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                  <input className={cx(inputCls, 'h-10 pl-9')} placeholder="Email hoặc số điện thoại" aria-label="Email hoặc số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Button type="submit" variant="secondary" disabled={searching}><Search className="size-4" />Tìm</Button>
              </form>
              {lookupErr && <Callout tone="red" icon={<TriangleAlert />}>{lookupErr}</Callout>}

              {existing && (
                <div className="space-y-3 rounded-xl bg-stone-50 p-4 text-sm ring-1 ring-inset ring-stone-200">
                  <div className="flex flex-wrap items-start gap-3">
                    <Avatar name={existing.fullName} tone={suspended ? 'red' : 'teal'} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">{existing.fullName}{suspended && <Badge tone="red" dot>Tài khoản đang bị khoá</Badge>}</p>
                      <ChipRow className="mt-1.5">
                        <Chip icon={<Mail />}>{existing.email}</Chip>
                        <Chip icon={<Phone />} tone={existing.phone ? 'gray' : 'amber'}>{existing.phone || 'chưa có SĐT'}</Chip>
                        <Chip icon={<IdCard />} tone={existing.hasIdentity ? 'blue' : 'amber'}>{existing.hasIdentity ? <>Đã khai {existing.idType ? ID_TYPE_LABEL[existing.idType] : 'giấy tờ'}</> : 'Chưa khai giấy tờ'}</Chip>
                      </ChipRow>
                    </div>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    <IdCard className="size-3.5" />Giấy tờ bản gốc
                    <InfoTip align="start">{existing.hasIdentity ? 'Khách đã khai giấy tờ — nhập theo bản gốc, hệ thống tự so khớp.' : 'Chưa khai giấy tờ — nhập theo bản gốc khách xuất trình.'}</InfoTip>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                    <Field label="Loại giấy tờ">
                      <select className={inputCls} value={form.idType} onChange={(e) => setForm((f) => ({ ...f, idType: e.target.value as IdType | '' }))}>
                        <option value="">— Chọn —</option>
                        {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
                      </select>
                    </Field>
                    <Field label="4 số cuối"><input className={cx(inputCls, 'font-mono uppercase')} maxLength={4} autoComplete="off" value={form.idNumberLast4} onChange={(e) => setForm((f) => ({ ...f, idNumberLast4: e.target.value }))} /></Field>
                  </div>
                </div>
              )}

              {cust?.kind === 'new' && (
                <div className="space-y-3 rounded-xl bg-stone-50 p-4 text-sm ring-1 ring-inset ring-stone-200">
                  <div className="flex items-center gap-2.5">
                    <IconTile icon={<UserPlus className="size-4" />} size="sm" />
                    <p className="min-w-0 flex-1 font-semibold text-ink">Chưa có tài khoản — tạo khách mới</p>
                    <InfoTip align="end">Xác minh email bằng mã 6 số trước khi tạo tài khoản — thông báo hợp đồng chỉ gửi tới email đã xác minh.</InfoTip>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Họ tên"><input className={inputCls} maxLength={100} value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} /></Field>
                    <Field label="Số điện thoại"><input className={inputCls} inputMode="tel" maxLength={20} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
                    <Field label="Email" className="sm:col-span-2">
                      <div className="flex flex-wrap gap-2">
                        <input className={cx(inputCls, 'min-w-48 flex-1')} type="email" maxLength={200} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                        <Button type="button" variant="secondary" disabled={otpBusy || !EMAIL_RE.test(email)} onClick={() => void sendOtp()}><MailCheck className="size-4" />{otpSent ? 'Gửi lại mã' : 'Gửi mã xác minh'}</Button>
                      </div>
                    </Field>
                    {otpErr && <Callout tone="red" icon={<TriangleAlert />} className="sm:col-span-2">{otpErr}</Callout>}
                    {otpSent && (
                      <Field label={`Mã xác minh đã gửi tới ${otp!.sentTo}`} hint={otp!.demoCode ? `Mã thử: ${otp!.demoCode}` : undefined} className="sm:col-span-2">
                        <input className={cx(inputCls, 'font-mono tracking-[0.3em]')} inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
                      </Field>
                    )}
                    <Field label="Loại giấy tờ">
                      <select className={inputCls} value={form.idType} onChange={(e) => setForm((f) => ({ ...f, idType: e.target.value as IdType | '' }))}>
                        {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
                      </select>
                    </Field>
                    <Field label="4 số cuối"><input className={cx(inputCls, 'font-mono uppercase')} maxLength={4} value={form.idNumberLast4} onChange={(e) => setForm((f) => ({ ...f, idNumberLast4: e.target.value }))} /></Field>
                  </div>
                </div>
              )}
              {cust && !suspended && !customer && <p className="flex items-center gap-1.5 text-xs text-amber-800"><TriangleAlert className="size-3.5 shrink-0" />Điền đủ thông tin khách và giấy tờ (đối chiếu bản gốc){cust.kind === 'new' ? ', nhập mã xác minh email' : ''}.</p>}
            </div>
          </StepCard>

          <StepCard n={2} state={cart.length > 0 ? 'done' : 'current'} icon={<Warehouse />} title="Chọn kho"
            aside={picked.length > 0 && <Chip tone="violet" icon={<Check />}>Đã chọn {picked.length} ô</Chip>}>
            <div className="space-y-5">
              {detailErr && <Callout tone="red" icon={<TriangleAlert />}>{detailErr}</Callout>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ngày bắt đầu">
                  <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={addDays(todayISO(), Math.min(60, maxLeadDaysOf(period))).slice(0, 10)} value={start} onChange={(e) => setStart(e.target.value)} />
                </Field>
                <Field label="Ca dự kiến nhận kho">
                  <select className={inputCls} value={shift} onChange={(e) => setShift(e.target.value as CheckInShift)}>
                    {CHECK_IN_SHIFTS.map((s) => <option key={s} value={s}>{CHECK_IN_SHIFT[s].label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Thời hạn thuê">
                <DurationPicker period={period} periods={periods} discounts={detail?.policy.discounts ?? []} onChange={(p, n) => { setPeriod(p); setPeriods(n); }}
                  monthOnly={(!!ut && isMonthOnly(ut.category)) || picked.some((p) => { const t = types.find((x) => x._id === p.typeId); return !!t && isMonthOnly(t.category); })} />
              </Field>
              {types.some((t) => t.acEligible) && (
                <label className={cx('inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 ring-inset transition-colors', useAirConditioning ? 'bg-sky-50 text-sky-900 ring-sky-300' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50')}>
                  <input type="checkbox" className="size-4" checked={useAirConditioning} onChange={(e) => setUseAirConditioning(e.target.checked)} />
                  <Snowflake className="size-3.5 text-sky-500" />Dùng điều hòa (loại kho có điều hòa)
                </label>
              )}

              {!detail && !detailErr ? (
                <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {types.map((t) => {
                    const off = t.availability.available === 0 || !allowsRentalPeriod(t.category, period);
                    const n = picked.filter((p) => p.typeId === t._id).length;
                    const Icon = CATEGORY_ICON[t.category] ?? Warehouse;
                    return (
                      <button key={t._id} type="button" disabled={off} onClick={() => setTypeId(t._id)} aria-pressed={t._id === typeId}
                        className={cx('flex items-start gap-3 rounded-xl px-3 py-3 text-left text-sm ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50', t._id === typeId ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-stone-200 hover:bg-stone-50')}>
                        <IconTile icon={<Icon className="size-4" />} tone={t._id === typeId ? 'teal' : 'gray'} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-1.5 font-medium text-ink">{t.name} <span className="font-normal text-stone-500">· {t.areaM2} m²</span>{n > 0 && <Badge tone="violet">đã chọn {n}</Badge>}</p>
                          <p className="mt-0.5 text-xs text-stone-600"><b className="tabular-nums text-ink">{vnd(t.quote.firstPeriodRent)}</b>/{PERIOD_UNIT[period]}</p>
                          <AvailabilityBar available={t.availability.available} total={t.availability.total} className="mt-1.5" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {ut && (
                floorPlan === null ? <Skeleton className="h-40" />
                  : <FloorPlanPicker items={floorPlan} value={null} selected={picked.map((p) => p.unitId)} onChange={toggleUnit} />
              )}

              {services.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><PackagePlus className="size-4 text-stone-400" />Dịch vụ kèm<InfoTip align="start">Chỉ cho kho từ cỡ Vừa trở lên — thu tiền khi nhận kho.</InfoTip></p>
                  <ul className="mt-2 divide-y divide-stone-100 rounded-xl ring-1 ring-inset ring-stone-200">
                    {services.map((s) => {
                      const qty = svcQty[s._id] ?? 0;
                      const SIcon = serviceIcon(s.code);
                      return (
                        <li key={s._id} className={cx('flex items-center gap-3 px-3 py-2 text-sm', qty > 0 && 'bg-brand-50/50')}>
                          <IconTile icon={<SIcon className="size-4" />} tone={qty > 0 ? 'teal' : 'gray'} size="sm" />
                          <span className="min-w-0 flex-1">{s.name} <span className="text-xs text-stone-500">· {vnd(s.price)}/{s.unitLabel}</span></span>
                          <span className="flex items-center gap-1">
                            <button type="button" aria-label={`Giảm ${s.name}`} disabled={qty === 0} onClick={() => setQty(s._id, qty - 1)} className="grid size-7 place-items-center rounded-md bg-white ring-1 ring-inset ring-stone-300 hover:bg-stone-50 disabled:opacity-40"><Minus className="size-3.5" /></button>
                            <span className="w-8 text-center font-medium tabular-nums">{qty}</span>
                            <button type="button" aria-label={`Thêm ${s.name}`} disabled={qty >= MAX_SERVICE_QTY} onClick={() => setQty(s._id, qty + 1)} className="grid size-7 place-items-center rounded-md bg-white ring-1 ring-inset ring-stone-300 hover:bg-stone-50 disabled:opacity-40"><Plus className="size-3.5" /></button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </StepCard>
        </div>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <StepCard n={3} state={step3State} icon={<Banknote />} title="Xác nhận & thu tiền">
            {notice && <Callout tone="amber" icon={<TriangleAlert />} className="mb-4">{notice}</Callout>}
            {cart.length === 0 ? <EmptyState compact icon={<Warehouse className="size-5" />} title="Chưa chọn ô nào" /> : (
              <ul className="space-y-2">
                {cart.map((l) => {
                  const seen = viewedContracts.includes(contractKey(lineParams(l)));
                  return (
                    <li key={l.unitId} className="flex items-center gap-2.5 rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-inset ring-stone-200">
                      <UnitTag label={l.unitNumber} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1 truncate font-medium">{l.typeName}{l.useAirConditioning && <Snowflake className="size-3.5 shrink-0 text-sky-500" aria-label="điều hòa" />}</p>
                        <p className="text-xs text-stone-500">Thu ngay {vnd(dueAtBooking(l.quote))}{dueAtCheckIn(l.quote) > 0 ? ` · nhận kho ${vnd(dueAtCheckIn(l.quote))}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => setPreview(lineParams(l))}
                        className={cx('inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', seen ? 'text-emerald-700 hover:bg-emerald-50' : 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300 hover:bg-amber-200')}>
                        {seen ? <CircleCheck className="size-3.5" /> : <FileText className="size-3.5" />}{seen ? 'Hợp đồng' : 'Xem hợp đồng'}
                      </button>
                      <button type="button" aria-label="Bỏ ô này" onClick={() => setPicked((c) => c.filter((p) => p.unitId !== l.unitId))} className="grid size-7 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-200 hover:text-red-600"><Trash2 className="size-4" /></button>
                    </li>
                  );
                })}
              </ul>
            )}

            {schedule && (
              <Ledger className="mt-4">
                <LedgerRow total label="Thu ngay" value={vnd(schedule.payNow)} />
                <LedgerRow label="Thu khi nhận kho" value={vnd(schedule.payAtCheckIn + servicesTotal)} />
              </Ledger>
            )}

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Khách xác nhận</p>
              <CheckLine className="text-xs leading-relaxed" checked={agreeTerms} onChange={setAgreeTerms}>
                Khách đã đọc và đồng ý Điều khoản thuê kho (v{TERMS_VERSION}) và Chính sách bảo mật (v{PRIVACY_VERSION})
              </CheckLine>
              <CheckLine className="text-xs leading-relaxed" disabled={!schedule} checked={agreePayment} onChange={(v) => setAckedPayment(v ? payKey : '')}>
                Khách đã được báo lịch thanh toán: thu ngay và thu khi nhận kho như trên
              </CheckLine>
              <CheckLine className="text-xs leading-relaxed" disabled={!allViewed} checked={agreeContract} onChange={(v) => setAckedContracts(v ? cartKeys.join(',') : '')}>
                Khách đã đọc hợp đồng của các kho đã chọn
              </CheckLine>
            </div>

            <Field label="Hình thức thu" className="mt-4">
              <PayMethodPicker icons value={pay} onChange={(m) => setPay(m as WalkInPay)} methods={['CASH', 'BANK_TRANSFER', 'CARD']} />
            </Field>
            {pay !== 'CASH' && (
              <Field label="Mã giao dịch" className="mt-3">
                <input className={inputCls} maxLength={64} value={txnRef} onChange={(e) => setTxnRef(e.target.value)} placeholder={pay === 'CARD' ? 'Mã chuẩn chi' : 'FT26292xxxxx'} />
              </Field>
            )}
            <Button size="lg" className="mt-4 w-full" disabled={!canSubmit} onClick={() => void submit()}>
              <Banknote className="size-4" />Thu tiền & đặt chỗ{schedule ? ` · ${vnd(schedule.payNow)}` : ''}
            </Button>
          </StepCard>
        </div>
      </div>
      <ContractPreviewDialog params={preview} onClose={() => setPreview(null)} tenantNote="Bản mẫu — phần Bên thuê để trống, hợp đồng thật ghi theo thông tin khách."
        onViewed={() => { if (!preview) return; const k = contractKey(preview); setViewedContracts((c) => (c.includes(k) ? c : [...c, k])); }} />
    </>
  );
}
