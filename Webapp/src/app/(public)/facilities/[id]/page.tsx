'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CircleCheck, Clock, FileText, Headset, Info, MapPin, Minus, Phone, Plus, ShoppingCart, Snowflake, Trash2 } from 'lucide-react';
import type { BusinessPolicy, CheckInShift, Facility, PriceQuote, RentalPeriod, UnitType } from '@ssm/shared';
import { AccessMethod, allowsRentalPeriod, profileGaps, isMonthOnly, buildPaymentSchedule, dueAtBooking, dueAtCheckIn, enumValues, paymentAckText, periodLabel, STAFF_SHIFTS, surchargeLines, withPolicyDefaults } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { ACCESS_METHOD, CHECK_IN_SHIFT, PERIOD_UNIT, UNIT_CATEGORY } from '@/shared/lib/labels';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/features/legal/legal-content';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Field, cx, inputCls } from '@/shared/ui';
import { FloorPlanPicker, type FloorPlanUnit } from '@/features/facilities/floor-plan-picker';
import { DurationPicker } from '@/features/facilities/duration-picker';
import { PaymentSchedule } from '@/features/payments/payment-schedule';
import { ContractPreviewDialog, type ContractPreviewParams } from '@/features/contracts/contract-preview';
import { ConsultationDialog, type ConsultationContext } from '@/features/tickets/consultation-dialog';
import { ProfileDialog } from '@/features/auth/profile-name';

// acEligible: loại kho này có tuỳ chọn điều hòa (add-on) hay không, theo policy.surcharges[CLIMATE].
type TypeRow = UnitType & { quote: PriceQuote; acEligible: boolean; availability: { total: number; free: number; available: number } };
interface Detail {
  facility: Facility;
  unitTypes: TypeRow[];
  services: { _id: string; code: string; name: string; description?: string; price: number; unitLabel: string }[];
  policy: Pick<BusinessPolicy, 'version' | 'scope' | 'reservationHoldMinutes' | 'cancellation' | 'earlyTermination' | 'minPeriods' | 'maxPeriods' | 'discounts' | 'gracePeriodDays'> & Partial<Pick<BusinessPolicy, 'surcharges'>>;
}
/** Một ô khách đã bấm chọn trên sơ đồ. Báo giá KHÔNG lưu ở đây — luôn lấy theo thời hạn/điều hòa đang chọn để số tiền hiển thị khớp đúng lúc đặt. */
interface PickedUnit { unitId: string; unitNumber: string; typeId: string; typeName: string }
/** Đặt tối đa bấy nhiêu kho trong một lượt (khớp giới hạn của API /reservations/batch). */
const MAX_UNITS = 10;
/** Khoá "đã xem hợp đồng" của một dòng — đổi ô / ngày / chu kỳ / số kỳ / điều hòa là hợp đồng khác, phải xem lại. */
const contractKey = (p: Pick<ContractPreviewParams, 'unitId' | 'startDate' | 'rentalPeriod' | 'periods' | 'useAirConditioning'>) =>
  `${p.unitId}|${p.startDate.slice(0, 10)}|${p.rentalPeriod}|${p.periods}|${p.useAirConditioning}`;
/** Số lượng tối đa mỗi dịch vụ kèm. */
const MAX_SERVICE_QTY = 99;

/** Ca giờ nhận kho — chọn ngay lúc đặt, cộng thêm "Chưa rõ giờ" cho khách chưa chắc lịch. */
const CHECK_IN_SHIFTS: { value: CheckInShift; label: string }[] = [...STAFF_SHIFTS, 'UNKNOWN' as const].map((s) => ({ value: s, label: CHECK_IN_SHIFT[s].label }));
/** Hình thức khoá — thuộc tính của TỪNG Ô (không phải loại kho); "Tất cả" = không lọc. */
const LOCK_OPTIONS: { value: AccessMethod | null; label: string }[] = [
  { value: null, label: 'Tất cả' },
  ...enumValues(AccessMethod).map((v) => ({ value: v, label: ACCESS_METHOD[v] })),
];

/** Công tắc bật/tắt — dễ nhìn hơn 2-3 nút bấm cạnh nhau cho lựa chọn nhị phân. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 select-none">
      <button
        type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-stone-300')}
      >
        <span className={cx('inline-block size-4 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
      <span className="text-sm font-medium text-stone-700">{label}</span>
    </label>
  );
}

export default function FacilityDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, run, toast } = useStore();
  const router = useRouter();
  const [start, setStart] = useState(todayISO().slice(0, 10));
  const [period, setPeriod] = useState<RentalPeriod>('MONTH');
  const [periods, setPeriods] = useState(3);
  const [checkInShift, setCheckInShift] = useState<CheckInShift>('UNKNOWN');
  // Điều hòa là ADD-ON khách tự bật khi đặt — không gắn với ô cụ thể nào, mọi ô của loại kho hợp lệ
  // đều dùng chung một giá. Hình thức khoá vẫn là thuộc tính của TỪNG Ô — lọc ngay trên sơ đồ (làm
  // mờ ô không khớp, không ẩn khỏi sơ đồ).
  const [useAirConditioning, setUseAirConditioning] = useState(false);
  const [lockFilter, setLockFilter] = useState<AccessMethod | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [typeId, setTypeId] = useState('');
  const [floorPlan, setFloorPlan] = useState<FloorPlanUnit[] | null>(null);
  // Chọn NHIỀU ô ngay trên sơ đồ: bấm một ô để chọn, bấm lại để bỏ. Đổi loại kho thì các ô đã chọn vẫn giữ.
  const [picked, setPicked] = useState<PickedUnit[]>([]);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  // Xác nhận đã đọc lịch thanh toán gắn với ĐÚNG số tiền đang hiển thị — giỏ đổi (số tiền đổi) thì phải xác nhận lại.
  const [ackedPayment, setAckedPayment] = useState('');
  const [preview, setPreview] = useState<ContractPreviewParams | null>(null);
  // Hợp đồng từng dòng đã mở xem (theo contractKey) + xác nhận đã đọc gắn với đúng giỏ lúc tick — giỏ đổi thì tick lại.
  const [viewedContracts, setViewedContracts] = useState<string[]>([]);
  const [ackedContracts, setAckedContracts] = useState('');
  const [consult, setConsult] = useState<ConsultationContext | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // Dịch vụ kèm: serviceId → số lượng. Đơn riêng ngoài hợp đồng thuê, thu tiền khi nhận kho.
  const [svcQty, setSvcQty] = useState<Record<string, number>>({});

  // Khách tự chọn chu kỳ (ngày/tuần/tháng) + số chu kỳ + có dùng điều hòa không — server tính lại giá
  // theo đúng combo này (ac bị bỏ qua cho loại kho không hợp lệ, xem TypeRow.acEligible).
  useEffect(() => {
    let alive = true;
    api.get<Detail>(`/facilities/public/${id}?period=${period}&periods=${periods}&ac=${useAirConditioning}`)
      .then((d) => { if (!alive) return; setDetail({ ...d, policy: withPolicyDefaults(d.policy) }); setError(''); setTypeId((cur) => cur || d.unitTypes.find((t) => t.availability.available > 0)?._id || ''); })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id, period, periods, useAirConditioning]);

  // Sơ đồ 2D cơ bản của loại kho đang chọn — khách bấm chọn một hoặc nhiều ô trống.
  useEffect(() => {
    if (!typeId) { setFloorPlan(null); return; }
    let alive = true;
    api.get<{ items: FloorPlanUnit[] }>(`/facilities/public/${id}/unit-types/${typeId}/floor-plan`)
      .then((d) => alive && setFloorPlan(d.items))
      .catch(() => alive && setFloorPlan([]));
    return () => { alive = false; };
  }, [id, typeId]);

  // Mỗi ô đã chọn + báo giá hiện hành của loại kho đó (theo thời hạn và công tắc điều hòa đang chọn).
  const cart = useMemo(() => picked.flatMap((p) => {
    const t = detail?.unitTypes.find((x) => x._id === p.typeId);
    return t ? [{ ...p, quote: t.quote, useAirConditioning: t.acEligible && useAirConditioning }] : [];
  }), [picked, detail, useAirConditioning]);
  const schedule = useMemo(() => (cart.length ? buildPaymentSchedule(cart.map((l) => l.quote), detail?.policy.gracePeriodDays) : null), [cart, detail]);
  const ackKey = schedule ? `${schedule.payNow}:${schedule.payAtCheckIn}` : '';
  const agreePayment = !!schedule && ackedPayment === ackKey;
  const lineParams = (l: (typeof cart)[number]): ContractPreviewParams => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate: `${start}T00:00:00.000Z`, rentalPeriod: period, periods, useAirConditioning: l.useAirConditioning, label: `${l.typeName} · ô ${l.unitNumber} · ${periodLabel(period, periods)}` });
  const cartContractKeys = cart.map((l) => contractKey(lineParams(l)));
  const allContractsViewed = cart.length > 0 && cartContractKeys.every((k) => viewedContracts.includes(k));
  const agreeContract = allContractsViewed && ackedContracts === cartContractKeys.join(',');

  if (error) return <main className="mx-auto max-w-7xl p-8"><EmptyState title="Không tải được chi nhánh" description={error} action={<ButtonLink href="/facilities">Quay lại</ButtonLink>} /></main>;
  if (!detail) return <main className="mx-auto max-w-7xl p-16 text-center text-sm text-stone-500">Đang tải…</main>;

  const { facility: f, unitTypes: types, policy, services } = detail;
  const ut = types.find((t) => t._id === typeId);
  const q = ut?.quote;
  const qSurcharges = q ? surchargeLines(q, policy.surcharges) : [];
  const discountPct = q && q.discountAmount ? Math.round((q.discountAmount / (q.rate + q.surchargeAmount)) * 100) : 0;
  const bookable = f.status === 'ACTIVE';
  const pickedServices = services.filter((s) => (svcQty[s._id] ?? 0) > 0).map((s) => ({ ...s, quantity: svcQty[s._id] }));
  const servicesTotal = pickedServices.reduce((sum, s) => sum + s.price * s.quantity, 0);
  const servicesPayload = pickedServices.map((s) => ({ serviceId: s._id, quantity: s.quantity }));
  const setQty = (serviceId: string, qty: number) => setSvcQty((c) => ({ ...c, [serviceId]: Math.min(MAX_SERVICE_QTY, Math.max(0, Math.round(qty) || 0)) }));

  const toggleUnit = (unitId: string) => {
    if (!ut) return;
    if (picked.some((p) => p.unitId === unitId)) { setPicked((c) => c.filter((p) => p.unitId !== unitId)); return; }
    if (picked.length >= MAX_UNITS) { toast(`Mỗi lượt đặt tối đa ${MAX_UNITS} kho`, 'error'); return; }
    const u = floorPlan?.find((x) => x._id === unitId);
    setPicked((c) => [...c, { unitId, unitNumber: u?.unitNumber ?? '', typeId: ut._id, typeName: ut.name }]);
  };
  const removeFromCart = (unitId: string) => setPicked((c) => c.filter((p) => p.unitId !== unitId));

  const book = async () => {
    if (!user) { router.push(`/login?next=${encodeURIComponent(`/facilities/${f._id}`)}`); return; }
    if (user.role !== 'CUSTOMER') { toast('Đặt chỗ dành cho tài khoản khách hàng', 'error'); return; }
    // Họ tên, số điện thoại, giấy tờ được in vào hợp đồng — thiếu thì mở form bổ sung ngay tại đây, không mất giỏ hàng.
    const gaps = profileGaps(user);
    if (gaps.length) { toast(`Bổ sung ${gaps.join(', ')} trước khi đặt kho`, 'error'); setProfileOpen(true); return; }
    if (cart.length === 0) return;
    if (!agreePayment) { toast('Vui lòng xác nhận đã đọc lịch thanh toán trước khi giữ chỗ', 'error'); return; }
    if (!agreeContract) { toast('Vui lòng mở xem và xác nhận đã đọc hợp đồng của các kho đã chọn', 'error'); return; }
    const consent = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true as const, contractAck: true as const };
    const startDate = `${start}T00:00:00.000Z`;
    if (cart.length === 1) {
      const line = cart[0];
      const res = await run('createReservation', { unitTypeId: line.typeId, unitId: line.unitId, startDate, rentalPeriod: period, periods, preferredCheckInShift: checkInShift, useAirConditioning: line.useAirConditioning, services: servicesPayload, source: 'WEB', consent }, 'Đã giữ chỗ — vui lòng thanh toán để giữ kho');
      if (res.ok) router.push(`/booking/${res.value._id}`);
      return;
    }
    const res = await run('createReservationsBatch', {
      // Dịch vụ kèm gắn vào dòng đặt ĐẦU TIÊN.
      items: cart.map((l, i) => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate, rentalPeriod: period, periods, preferredCheckInShift: checkInShift, useAirConditioning: l.useAirConditioning, ...(i === 0 ? { services: servicesPayload } : {}) })), consent,
    }, (items) => `Đã giữ chỗ ${items.length} kho — thanh toán từng kho trong mục Đặt chỗ của tôi`);
    if (res.ok) router.push('/portal/reservations');
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{f.name}</h1>
          <Link href={`/facilities/${f._id}/gioi-thieu`} className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">Xem giới thiệu & hình ảnh kho</Link>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-500">
            <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{f.address.line1}, {f.address.district}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" />Ra vào {f.accessHours?.open ?? '06:00'}–{f.accessHours?.close ?? '22:00'}</span>
            <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{f.contact.phone}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{f.amenities.map((a) => <Badge key={a}>{a}</Badge>)}</div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Loại kho" description={`Giá theo ${periodLabel(period, periods)}, bắt đầu ${fmtDate(`${start}T00:00:00.000Z`)}`} />
            <ul className="divide-y divide-stone-100">
              {types.map((t) => {
                const a = t.availability;
                const selected = t._id === typeId;
                // Kho cỡ lớn chỉ thuê theo tháng: đang chọn thuê ngày / tuần thì làm mờ, không cho chọn.
                const periodOff = !allowsRentalPeriod(t.category, period);
                return (
                  <li key={t._id}>
                    <button type="button" disabled={a.available === 0 || periodOff} onClick={() => setTypeId(t._id)} title={periodOff ? 'Kho cỡ lớn chỉ cho thuê theo tháng' : undefined} className={cx('flex w-full flex-wrap items-center gap-4 px-5 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60', selected ? 'bg-brand-50' : 'hover:bg-stone-50')}>
                      <span className={cx('grid size-5 place-items-center rounded-full border-2', selected ? 'border-brand-600' : 'border-stone-300')}>{selected && <span className="size-2.5 rounded-full bg-brand-600" />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t.name} <span className="font-normal text-stone-500">· {t.dimensions.widthM}×{t.dimensions.depthM}×{t.dimensions.heightM} m ({t.areaM2} m²)</span></p>
                        <p className="mt-0.5 text-sm text-stone-500">{t.description}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge>{UNIT_CATEGORY[t.category]}</Badge>
                          {isMonthOnly(t.category) && <Badge tone={periodOff ? 'amber' : 'gray'}>Chỉ thuê theo tháng</Badge>}
                          {t.minPeriods > 1 && <Badge tone="gray">Tối thiểu {periodLabel(period, t.minPeriods)}</Badge>}
                          {t.quote.firstPeriodAtBooking && <Badge tone="amber">Giữ chân {periodLabel(period, t.quote.depositPeriods ?? 1)} + trả {PERIOD_UNIT[period]} đầu khi đặt</Badge>}
                          {picked.some((p) => p.typeId === t._id) && <Badge tone="violet">Đã chọn {picked.filter((p) => p.typeId === t._id).length} ô</Badge>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{vnd(t.quote.firstPeriodRent)}<span className="text-xs font-normal text-stone-500">/{PERIOD_UNIT[period]}</span></p>
                        <p className={cx('mt-1 text-xs font-medium', a.available === 0 ? 'text-red-600' : a.available <= 2 ? 'text-amber-700' : 'text-emerald-700')}>
                          {a.available === 0 ? 'Hết chỗ' : `Còn ${a.available}/${a.total} kho`}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {services.length > 0 && (
            <Card className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold">Dịch vụ kèm (tuỳ chọn)</h3>
                <p className="text-xs text-stone-500">Đơn riêng, thanh toán khi nhận kho.</p>
              </div>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {services.map((s) => {
                  const qty = svcQty[s._id] ?? 0;
                  return (
                    <li key={s._id} className={cx('flex flex-col rounded-xl p-3.5 ring-1 ring-inset', qty > 0 ? 'bg-brand-50 ring-brand-300' : 'bg-stone-50 ring-stone-200')}>
                      <p className="text-sm font-semibold">{s.name}</p>
                      {s.description && <p className="mt-1 flex-1 text-xs leading-relaxed text-stone-500">{s.description}</p>}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold tabular-nums text-brand-700">{vnd(s.price)}<span className="text-xs font-normal text-stone-500"> / {s.unitLabel}</span></p>
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label={`Giảm ${s.name}`} disabled={qty === 0} onClick={() => setQty(s._id, qty - 1)} className="grid size-7 place-items-center rounded-md ring-1 ring-inset ring-stone-300 hover:bg-white disabled:opacity-40"><Minus className="size-3.5" /></button>
                          <input type="number" min={0} max={MAX_SERVICE_QTY} aria-label={`Số lượng ${s.name}`} value={qty} onChange={(e) => setQty(s._id, Number(e.target.value))} className="h-7 w-12 rounded-md border-0 bg-white text-center text-sm tabular-nums ring-1 ring-inset ring-stone-300" />
                          <button type="button" aria-label={`Thêm ${s.name}`} disabled={qty >= MAX_SERVICE_QTY} onClick={() => setQty(s._id, qty + 1)} className="grid size-7 place-items-center rounded-md ring-1 ring-inset ring-stone-300 hover:bg-white disabled:opacity-40"><Plus className="size-3.5" /></button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {servicesTotal > 0 && <p className="mt-3 text-sm">Dịch vụ kèm: <b className="tabular-nums">{vnd(servicesTotal)}</b> — thu khi nhận kho.</p>}
            </Card>
          )}

          {ut && (
            <Card className="p-5">
              <CardHeader title={`Chọn ô kho — ${ut.name}`} description={`Bấm ô còn trống để chọn, bấm lại để bỏ (tối đa ${MAX_UNITS} ô).`} />
              <div className="mt-4 flex flex-wrap gap-1.5">
                {LOCK_OPTIONS.map((o) => (
                  <button key={o.label} type="button" onClick={() => setLockFilter(o.value)} className={cx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', lockFilter === o.value ? 'bg-brand-600 text-white ring-brand-600' : 'text-stone-600 ring-stone-300 hover:bg-stone-50')}>{o.label}</button>
                ))}
              </div>
              <div className="mt-4">
                {floorPlan === null ? <p className="text-sm text-stone-500">Đang tải sơ đồ…</p> : (
                  <FloorPlanPicker items={floorPlan} value={null} selected={picked.map((p) => p.unitId)} onChange={toggleUnit} lockMethod={lockFilter} />
                )}
              </div>
              <p className="mt-3 text-sm text-stone-600">
                {picked.length === 0 ? 'Chưa chọn ô nào.' : <>Đã chọn <b>{picked.length}</b> ô: {picked.map((p) => p.unitNumber).join(', ')}.</>}
              </p>
            </Card>
          )}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start space-y-4">
          <Card className="p-5">
            <h2 className="font-semibold">Thông tin đặt kho</h2>
            <div className="mt-4 grid gap-4">
              <Field label="Ngày bắt đầu">
                <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={addDays(todayISO(), 60).slice(0, 10)} value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="Bạn sẽ gửi trong bao lâu?">
                <DurationPicker period={period} periods={periods} discounts={detail?.policy.discounts ?? []} onChange={(p, n) => { setPeriod(p); setPeriods(n); }}
                  monthOnly={(!!ut && isMonthOnly(ut.category)) || picked.some((p) => { const t = types.find((x) => x._id === p.typeId); return !!t && isMonthOnly(t.category); })} />
              </Field>
              {ut?.acEligible && (
                <Field label="Điều hòa" hint="Bật thì cộng phụ phí điều hòa vào tiền thuê mỗi kỳ.">
                  <Switch checked={useAirConditioning} onChange={setUseAirConditioning}
                    label={<span className="inline-flex items-center gap-1"><Snowflake className="size-3.5 text-sky-500" />{useAirConditioning ? 'Có sử dụng' : 'Không sử dụng'}</span>} />
                </Field>
              )}
              <Field label="Ca giờ dự kiến đến nhận kho">
                <div className="grid grid-cols-2 gap-2">
                  {CHECK_IN_SHIFTS.map((s) => (
                    <button key={s.value} type="button" onClick={() => setCheckInShift(s.value)} className={cx('rounded-lg py-2 text-xs font-medium ring-1 ring-inset', checkInShift === s.value ? 'bg-ink text-white ring-ink' : 'ring-stone-300 hover:bg-stone-50')}>{s.label}</button>
                  ))}
                </div>
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="size-4" />Giỏ đặt kho {cart.length > 0 && `(${cart.length})`}</h2>
            {cart.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">Chưa chọn ô nào.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {cart.map((l) => {
                  const seen = viewedContracts.includes(contractKey(lineParams(l)));
                  return (
                  <li key={l.unitId} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.typeName} · ô {l.unitNumber}{l.useAirConditioning ? ' · có điều hòa' : ''}</p>
                      <p className="text-xs text-stone-500">
                        Hôm nay {vnd(dueAtBooking(l.quote))}{l.quote.firstPeriodAtBooking ? ` (giữ chân ${vnd(l.quote.depositAmount)} + thuê ${PERIOD_UNIT[period]} đầu ${vnd(l.quote.firstPeriodRent)})` : ' tiền giữ chân'}
                        {dueAtCheckIn(l.quote) > 0 ? ` · thêm ${vnd(dueAtCheckIn(l.quote))} khi nhận kho` : ' · nhận kho không trả thêm'}
                      </p>
                    </div>
                    <button type="button" title={seen ? 'Đã xem hợp đồng của kho này' : 'Chưa xem hợp đồng của kho này'} onClick={() => setPreview(lineParams(l))}
                      className={cx('inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', seen ? 'text-emerald-700 hover:bg-emerald-50' : 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300 hover:bg-amber-200')}>
                      {seen ? <CircleCheck className="size-3.5" /> : <FileText className="size-3.5" />}{seen ? 'Hợp đồng' : 'Xem hợp đồng'}
                    </button>
                    <button type="button" aria-label="Bỏ khỏi giỏ" onClick={() => removeFromCart(l.unitId)} className="grid size-7 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-200 hover:text-red-600"><Trash2 className="size-4" /></button>
                  </li>
                  );
                })}
              </ul>
            )}
            {cart.length > 0 && (
              <PaymentSchedule quotes={cart.map((l) => l.quote)} graceDays={policy.gracePeriodDays} className="mt-3" />
            )}
            {cart.length > 0 && servicesTotal > 0 && (
              <div className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-950 ring-1 ring-inset ring-sky-200">
                <p className="font-medium">Thanh toán khi nhận kho: <span className="tabular-nums">{vnd(servicesTotal)}</span> <span className="font-normal">(đơn riêng, ngoài hợp đồng thuê)</span></p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {pickedServices.map((s) => <li key={s._id}>{s.name} × {s.quantity} {s.unitLabel} — {vnd(s.price * s.quantity)}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-5 space-y-2.5 border-t border-dashed border-stone-200 pt-4">
              {schedule && (
                <label className="flex cursor-pointer gap-2.5 rounded-lg bg-amber-50 p-2.5 text-xs font-medium leading-relaxed text-amber-950 ring-1 ring-inset ring-amber-200">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agreePayment} onChange={(e) => setAckedPayment(e.target.checked ? ackKey : '')} />
                  <span>{paymentAckText(schedule)}</span>
                </label>
              )}
              {cart.length > 0 && (
                <label className={cx('flex gap-2.5 text-xs leading-relaxed', allContractsViewed ? 'cursor-pointer text-stone-700' : 'cursor-not-allowed text-stone-400')}>
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0" disabled={!allContractsViewed} checked={agreeContract} onChange={(e) => setAckedContracts(e.target.checked ? cartContractKeys.join(',') : '')} />
                  <span>Tôi đã đọc hợp đồng của các kho đã chọn{allContractsViewed ? '' : ' (bấm “Xem hợp đồng” ở từng kho)'}</span>
                </label>
              )}
              <label className="flex cursor-pointer gap-2.5 text-xs leading-relaxed text-stone-700">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span>Tôi đã đọc và đồng ý với <Link href="/dieu-khoan" target="_blank" className="font-medium text-brand-700 hover:underline">Điều khoản thuê kho (v{TERMS_VERSION})</Link></span>
              </label>
              <label className="flex cursor-pointer gap-2.5 text-xs leading-relaxed text-stone-700">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
                <span>Tôi đồng ý cho KhoAn xử lý dữ liệu cá nhân theo <Link href="/bao-mat" target="_blank" className="font-medium text-brand-700 hover:underline">Chính sách bảo mật (v{PRIVACY_VERSION})</Link></span>
              </label>
            </div>
            <Button size="lg" className="mt-4 w-full" onClick={() => void book()} disabled={cart.length === 0 || !bookable || !agreeTerms || !agreePrivacy || !agreePayment || !agreeContract}>
              {bookable ? `Giữ chỗ & thanh toán${cart.length > 1 ? ` (${cart.length} kho)` : ''}` : 'Chi nhánh chưa nhận đặt chỗ'}
            </Button>
            <p className="mt-3 text-xs leading-relaxed text-stone-500">
              Giữ chỗ {policy.reservationHoldMinutes} phút để thanh toán. Hủy trước ngày nhận ≥{policy.cancellation[0]?.minHoursBeforeStart} giờ hoàn {policy.cancellation[0]?.depositRefundPct}% số tiền đã trả khi đặt chỗ,
              ≥{policy.cancellation[1]?.minHoursBeforeStart} giờ hoàn {policy.cancellation[1]?.depositRefundPct}%, sát hơn không hoàn.
              Hợp đồng có ưu đãi thuê dài mà trả kho sớm: dùng ≤{policy.earlyTermination[0]?.maxElapsedPct}% thời hạn hoàn {policy.earlyTermination[0]?.depositRefundPct}% tiền giữ chân,
              ≤{policy.earlyTermination[1]?.maxElapsedPct}% hoàn {policy.earlyTermination[1]?.depositRefundPct}%, quá {policy.earlyTermination[1]?.maxElapsedPct}% hoàn {policy.earlyTermination[2]?.depositRefundPct ?? 100}%.
              {servicesTotal > 0 && ' Huỷ đặt chỗ thì đơn dịch vụ kèm tự huỷ.'}
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Headset className="size-4 text-brand-700" />Cần tư vấn trước khi đặt?</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
              Cần hoá đơn VAT, hợp đồng riêng hoặc thuê nhiều kho — gửi yêu cầu, chi nhánh gọi lại. Kho không được giữ trong lúc chờ.
            </p>
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setConsult({
              facilityId: f._id, facilityName: f.name, rentalPeriod: period, periods,
              unitTypeIds: [...new Set([...picked.map((p) => p.typeId), ...(ut ? [ut._id] : [])])].slice(0, 5),
            })}>Yêu cầu tư vấn</Button>
          </Card>
          {q && ut && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold">Báo giá {ut.name}</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-stone-500">{ut.name} / {PERIOD_UNIT[period]}</dt><dd className="tabular-nums">{vnd(q.rate)}</dd></div>
                {qSurcharges.map((s) => (
                  <div key={s.code}>
                    <div className="flex justify-between"><dt className="text-stone-500">{s.label}{s.basis ? ` (${s.basis})` : ''}</dt><dd className="tabular-nums">+{vnd(s.amount)}</dd></div>
                    <p className="mt-0.5 flex gap-1.5 text-xs leading-relaxed text-stone-500"><Info className="mt-0.5 size-3 shrink-0" />{s.reason}</p>
                  </div>
                ))}
                {q.discountAmount > 0 && <div className="flex justify-between text-emerald-700"><dt>Ưu đãi thuê {periodLabel(period, periods)} (−{discountPct}%)</dt><dd className="tabular-nums">−{vnd(q.discountAmount)}</dd></div>}
                <div className="flex justify-between font-medium"><dt>Tiền thuê mỗi {PERIOD_UNIT[period]}</dt><dd className="tabular-nums">{vnd(q.firstPeriodRent)}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Tổng giá trị {periodLabel(period, periods)} <span className="text-xs">(trả từng {PERIOD_UNIT[period]})</span></dt><dd className="tabular-nums">{vnd(q.firstPeriodRent * periods)}</dd></div>
              </dl>
            </Card>
          )}
        </div>
      </div>
      <ContractPreviewDialog params={preview} onClose={() => setPreview(null)}
        onViewed={() => { if (!preview) return; const k = contractKey(preview); setViewedContracts((c) => (c.includes(k) ? c : [...c, k])); }} />
      <ConsultationDialog ctx={consult} onClose={() => setConsult(null)} />
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </main>
  );
}
