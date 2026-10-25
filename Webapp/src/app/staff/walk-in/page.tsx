'use client';

import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, FileText, KeyRound, MailCheck, Minus, Plus, Search, Snowflake, Trash2, TriangleAlert, UserPlus } from 'lucide-react';
import type { BusinessPolicy, CheckInShift, Facility, PriceQuote, RentalPeriod, Reservation, UnitType } from '@ssm/shared';
import {
  allowsRentalPeriod, buildPaymentSchedule, dueAtBooking, dueAtCheckIn, ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, isMonthOnly, isValidPersonName, isValidProfilePhone,
  normalizeIdLast4, normalizePhone, periodLabel, STAFF_SHIFTS, type IdType,
} from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { actions, isTxnRef, type BookingLine, type CounterCustomer, type WalkInCustomerInput } from '@/shared/api/actions';
import { CHECK_IN_SHIFT, PERIOD_UNIT } from '@/shared/lib/labels';
import { addDays, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, ButtonLink, Card, CardHeader, Field, PageHeader, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { FloorPlanPicker, type FloorPlanUnit } from '@/features/facilities/floor-plan-picker';
import { DurationPicker } from '@/features/facilities/duration-picker';
import { PayMethodPicker } from '@/features/payments/pay-method';
import { NewReceipts } from '@/features/payments/receipt-button';
import { ContractPreviewDialog, type ContractPreviewParams } from '@/features/contracts/contract-preview';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/features/legal/legal-content';

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
  const services = detail?.services ?? [];
  const pickedServices = services.filter((s) => (svcQty[s._id] ?? 0) > 0).map((s) => ({ ...s, quantity: svcQty[s._id] }));
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
    // Dịch vụ kèm gắn vào dòng đặt ĐẦU TIÊN (như đặt online).
    const items: BookingLine[] = cart.map((l, i) => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate, rentalPeriod: period, periods, preferredCheckInShift: shift, useAirConditioning: l.useAirConditioning, ...(i === 0 ? { services: servicesPayload } : {}) }));
    const before = db.payments.map((p) => p._id);
    const res = await run('walkInBooking', {
      customer, items, payMethod: pay, txnRef, idempotencyKey: idemKey,
      consent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true, contractAck: true },
    }, (v) => `Đã đặt ${v.items.length} kho cho ${v.customer.fullName}`);
    if (res.ok) { setDone({ customerName: res.value.customer.fullName, items: res.value.items, before }); setIdemKey(newKey()); setReload((n) => n + 1); }
  };

  const reset = () => {
    setDone(null); setQ(''); setCust(null); setLookupErr(''); setForm(EMPTY_FORM); setPicked([]); setSvcQty({});
    setViewedContracts([]); setAckedContracts(''); setAckedPayment(''); setAgreeTerms(false); setPay('CASH'); setTxnRef('');
    setOtp(null); setOtpCode(''); setOtpErr('');
  };

  if (done) {
    const collected = done.items.reduce((s, r) => s + dueAtBooking(r.quote), 0);
    const atCheckIn = done.items.reduce((s, r) => s + dueAtCheckIn(r.quote), 0);
    return (
      <>
        <PageHeader title="Đặt chỗ tại quầy" />
        <Card className="max-w-2xl border-emerald-200 bg-emerald-50 p-5">
          <p className="flex items-center gap-2 font-semibold text-emerald-800"><CircleCheck className="size-5" />Đã đặt chỗ cho {done.customerName}</p>
          <p className="mt-1 text-sm text-emerald-900">Đã thu <b className="tabular-nums">{vnd(collected)}</b>{atCheckIn > 0 && <> · thu thêm <b className="tabular-nums">{vnd(atCheckIn)}</b> khi nhận kho</>}.</p>
          <ul className="mt-4 divide-y divide-emerald-200 rounded-lg bg-white ring-1 ring-emerald-200">
            {done.items.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-mono text-sm font-semibold">{r.code}</p>
                  <p className="text-xs text-stone-500">{periodLabel(r.quote.rentalPeriod, r.periods)} · đã thu {vnd(dueAtBooking(r.quote))}</p>
                </div>
                <ButtonLink href={`/staff/check-in?code=${encodeURIComponent(r.code)}`} size="sm"><KeyRound className="size-3.5" />Ký giấy & nhận kho</ButtonLink>
              </li>
            ))}
          </ul>
          <div className="mt-4"><NewReceipts payments={db.payments.filter((p) => done.items.some((r) => r._id === p.reservationId))} before={done.before} /></div>
          <Button variant="secondary" size="sm" className="mt-4" onClick={reset}><UserPlus className="size-4" />Đặt cho khách khác</Button>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Đặt chỗ tại quầy" description="Khách chưa đặt online — đặt kho và thu tiền giữ chân tại quầy." actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1. Khách hàng" />
            <div className="space-y-4 p-5">
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
                <input className={cx(inputCls, 'min-w-60 flex-1')} placeholder="Email hoặc số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
                <Button type="submit" variant="secondary" disabled={searching}><Search className="size-4" />Tìm</Button>
              </form>
              {lookupErr && <p className="flex items-center gap-2 text-sm text-red-700"><TriangleAlert className="size-4" />{lookupErr}</p>}

              {existing && (
                <div className="space-y-3 rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-inset ring-stone-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{existing.fullName}</p>
                    {suspended && <Badge tone="red">Tài khoản đang bị khoá</Badge>}
                  </div>
                  <p className="text-stone-600">{existing.email} · {existing.phone || 'chưa có SĐT'}</p>
                  <p>{existing.hasIdentity ? <>Đã khai {existing.idType ? <b>{ID_TYPE_LABEL[existing.idType]}</b> : 'giấy tờ'} — nhập theo bản gốc, hệ thống tự so khớp.</> : 'Chưa khai giấy tờ — nhập theo bản gốc khách xuất trình.'}</p>
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
                <div className="space-y-3 rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-inset ring-stone-200">
                  <p className="font-semibold">Chưa có tài khoản — tạo khách mới</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Họ tên"><input className={inputCls} maxLength={100} value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} /></Field>
                    <Field label="Số điện thoại"><input className={inputCls} inputMode="tel" maxLength={20} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
                    <Field label="Email" className="sm:col-span-2">
                      <div className="flex gap-2">
                        <input className={cx(inputCls, 'flex-1')} type="email" maxLength={200} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                        <Button type="button" variant="secondary" disabled={otpBusy || !EMAIL_RE.test(email)} onClick={() => void sendOtp()}><MailCheck className="size-4" />{otpSent ? 'Gửi lại mã' : 'Gửi mã xác minh'}</Button>
                      </div>
                    </Field>
                    {otpErr && <p className="flex items-center gap-2 text-sm text-red-700 sm:col-span-2"><TriangleAlert className="size-4" />{otpErr}</p>}
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
              {cust && !suspended && !customer && <p className="text-xs text-amber-800">Điền đủ thông tin khách và giấy tờ (đối chiếu bản gốc){cust.kind === 'new' ? ', nhập mã xác minh email' : ''}.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="2. Chọn kho" />
            <div className="space-y-5 p-5">
              {detailErr && <p className="flex items-center gap-2 text-sm text-red-700"><TriangleAlert className="size-4" />{detailErr}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ngày bắt đầu">
                  <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={addDays(todayISO(), 60).slice(0, 10)} value={start} onChange={(e) => setStart(e.target.value)} />
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
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={useAirConditioning} onChange={(e) => setUseAirConditioning(e.target.checked)} />
                  <Snowflake className="size-3.5 text-sky-500" />Dùng điều hòa (loại kho có điều hòa)
                </label>
              )}

              {!detail && !detailErr ? <p className="text-sm text-stone-500">Đang tải…</p> : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {types.map((t) => {
                    const off = t.availability.available === 0 || !allowsRentalPeriod(t.category, period);
                    const n = picked.filter((p) => p.typeId === t._id).length;
                    return (
                      <button key={t._id} type="button" disabled={off} onClick={() => setTypeId(t._id)}
                        className={cx('rounded-lg px-3 py-2.5 text-left text-sm ring-1 ring-inset disabled:cursor-not-allowed disabled:opacity-50', t._id === typeId ? 'bg-brand-50 ring-brand-600' : 'ring-stone-200 hover:bg-stone-50')}>
                        <p className="font-medium">{t.name} <span className="font-normal text-stone-500">· {t.areaM2} m²</span></p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          {vnd(t.quote.firstPeriodRent)}/{PERIOD_UNIT[period]} · còn {t.availability.available}/{t.availability.total}
                          {n > 0 && <span className="font-medium text-violet-700"> · đã chọn {n}</span>}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              {ut && (
                floorPlan === null ? <p className="text-sm text-stone-500">Đang tải sơ đồ…</p>
                  : <FloorPlanPicker items={floorPlan} value={null} selected={picked.map((p) => p.unitId)} onChange={toggleUnit} />
              )}

              {services.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Dịch vụ kèm <span className="font-normal text-stone-500">(thu khi nhận kho)</span></p>
                  <ul className="mt-2 divide-y divide-stone-100 rounded-lg ring-1 ring-inset ring-stone-200">
                    {services.map((s) => {
                      const qty = svcQty[s._id] ?? 0;
                      return (
                        <li key={s._id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span>{s.name} <span className="text-xs text-stone-500">· {vnd(s.price)}/{s.unitLabel}</span></span>
                          <span className="flex items-center gap-1">
                            <button type="button" aria-label={`Giảm ${s.name}`} disabled={qty === 0} onClick={() => setQty(s._id, qty - 1)} className="grid size-7 place-items-center rounded-md ring-1 ring-inset ring-stone-300 hover:bg-stone-50 disabled:opacity-40"><Minus className="size-3.5" /></button>
                            <span className="w-8 text-center tabular-nums">{qty}</span>
                            <button type="button" aria-label={`Thêm ${s.name}`} disabled={qty >= MAX_SERVICE_QTY} onClick={() => setQty(s._id, qty + 1)} className="grid size-7 place-items-center rounded-md ring-1 ring-inset ring-stone-300 hover:bg-stone-50 disabled:opacity-40"><Plus className="size-3.5" /></button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <h2 className="font-semibold">3. Xác nhận & thu tiền</h2>
            {cart.length === 0 ? <p className="mt-3 text-sm text-stone-500">Chưa chọn ô nào.</p> : (
              <ul className="mt-3 space-y-2">
                {cart.map((l) => {
                  const seen = viewedContracts.includes(contractKey(lineParams(l)));
                  return (
                    <li key={l.unitId} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{l.typeName} · ô {l.unitNumber}{l.useAirConditioning ? ' · điều hòa' : ''}</p>
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
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between font-semibold"><dt>Thu ngay</dt><dd className="tabular-nums">{vnd(schedule.payNow)}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-600">Thu khi nhận kho</dt><dd className="tabular-nums">{vnd(schedule.payAtCheckIn + servicesTotal)}</dd></div>
              </dl>
            )}

            <div className="mt-4 space-y-2.5 border-t border-dashed border-stone-200 pt-4 text-xs leading-relaxed">
              <label className="flex cursor-pointer gap-2.5 text-stone-700">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span>Khách đã đọc và đồng ý Điều khoản thuê kho (v{TERMS_VERSION}) và Chính sách bảo mật (v{PRIVACY_VERSION})</span>
              </label>
              <label className={cx('flex gap-2.5', schedule ? 'cursor-pointer text-stone-700' : 'cursor-not-allowed text-stone-400')}>
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" disabled={!schedule} checked={agreePayment} onChange={(e) => setAckedPayment(e.target.checked ? payKey : '')} />
                <span>Khách đã được báo lịch thanh toán: thu ngay và thu khi nhận kho như trên</span>
              </label>
              <label className={cx('flex gap-2.5', allViewed ? 'cursor-pointer text-stone-700' : 'cursor-not-allowed text-stone-400')}>
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" disabled={!allViewed} checked={agreeContract} onChange={(e) => setAckedContracts(e.target.checked ? cartKeys.join(',') : '')} />
                <span>Khách đã đọc hợp đồng của các kho đã chọn</span>
              </label>
            </div>

            <Field label="Hình thức thu" className="mt-4">
              <PayMethodPicker value={pay} onChange={(m) => setPay(m as WalkInPay)} methods={['CASH', 'BANK_TRANSFER', 'CARD']} />
            </Field>
            {pay !== 'CASH' && (
              <Field label="Mã giao dịch" className="mt-3">
                <input className={inputCls} maxLength={64} value={txnRef} onChange={(e) => setTxnRef(e.target.value)} placeholder={pay === 'CARD' ? 'Mã chuẩn chi' : 'FT26292xxxxx'} />
              </Field>
            )}
            <Button size="lg" className="mt-4 w-full" disabled={!canSubmit} onClick={() => void submit()}>
              Thu tiền & đặt chỗ{schedule ? ` · ${vnd(schedule.payNow)}` : ''}
            </Button>
          </Card>
        </div>
      </div>
      <ContractPreviewDialog params={preview} onClose={() => setPreview(null)} tenantNote="Bản mẫu — phần Bên thuê để trống, hợp đồng thật ghi theo thông tin khách."
        onViewed={() => { if (!preview) return; const k = contractKey(preview); setViewedContracts((c) => (c.includes(k) ? c : [...c, k])); }} />
    </>
  );
}
