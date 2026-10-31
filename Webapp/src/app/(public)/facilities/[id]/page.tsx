'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Box, Check, ChevronRight, CircleCheck, Clock, CreditCard, FileText, Handshake, Headset, Images, Info, LayoutGrid, MapPin, Minus, Phone, Plus, ShoppingCart, Snowflake, Store, Trash2, Warehouse } from 'lucide-react';
import type { BusinessPolicy, CheckInShift, CodEligibility, Facility, PayTiming, PriceQuote, PublicSiteUnit, RentalPeriod, UnitType } from '@ssm/shared';
import { AccessMethod, allowsRentalPeriod, servicesAllowedFor, profileGaps, isMonthOnly, buildPaymentSchedule, cartLineText, COD_NOTE, codHoldExpiry, COUNTER_HOLD_TOO_SHORT_TEXT, counterHoldExpiry, counterHoldTooShort, DAILY_DEPOSIT_MIN_DAYS, DAILY_DEPOSIT_NOTE, DAILY_LEAD_MESSAGE, dueAtBooking, enumValues, fmtEndOfDay, fmtHoldUntil, maxLeadDaysOf, ONLINE_TIMING, paymentAckKey, paymentAckText, payNowLabel, periodLabel, PAY_AT_COUNTER_NOTE, STAFF_SHIFTS, surchargeLines, withPolicyDefaults } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import type { UnitTakenDetails } from '@/shared/api/actions';
import { ACCESS_METHOD, CHECK_IN_SHIFT, PERIOD_UNIT, UNIT_CATEGORY } from '@/shared/lib/labels';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/features/legal/legal-content';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { categoryCutaway, facilityPhoto } from '@/shared/lib/images';
import { Badge, Button, ButtonLink, Card, Disclosure, EmptyState, IconTile, InfoTip, Skeleton, cx, inputCls } from '@/shared/ui';
import { FloorPlanPicker, type FloorPlanUnit } from '@/features/facilities/floor-plan-picker';
import { Facility3DPanel, type Site3DType } from '@/features/facilities/view3d/facility-3d-panel';
import { DurationPicker } from '@/features/facilities/duration-picker';
import { AvailabilityBar, CATEGORY_ICON, amenityIcon, serviceIcon } from '@/features/facilities/visuals';
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
const contractKey = (p: Pick<ContractPreviewParams, 'unitId' | 'startDate' | 'rentalPeriod' | 'periods' | 'useAirConditioning' | 'payOnArrival'>) =>
  `${p.unitId}|${p.startDate.slice(0, 10)}|${p.rentalPeriod}|${p.periods}|${p.useAirConditioning}${p.payOnArrival ? '|COD' : ''}`;
/** Cách trả: online ngay · giữ chỗ, trả tại quầy (24 giờ) · trả khi nhận kho (đợt 15, C1 — hôm nay 0 ₫, giữ ô đến hết ngày nhận). */
type PayMode = 'ONLINE' | 'COUNTER' | 'COD';
/** Số lượng tối đa mỗi dịch vụ kèm. */
const MAX_SERVICE_QTY = 99;

/** Ca giờ nhận kho — chọn ngay lúc đặt, cộng thêm "Chưa rõ giờ" cho khách chưa chắc lịch. */
const CHECK_IN_SHIFTS: { value: CheckInShift; label: string }[] = [...STAFF_SHIFTS, 'UNKNOWN' as const].map((s) => ({ value: s, label: CHECK_IN_SHIFT[s].label }));
/** Hình thức khoá — thuộc tính của TỪNG Ô (không phải loại kho); "Tất cả" = không lọc. */
const LOCK_OPTIONS: { value: AccessMethod | null; label: string }[] = [
  { value: null, label: 'Tất cả' },
  ...enumValues(AccessMethod).map((v) => ({ value: v, label: ACCESS_METHOD[v] })),
];

/**
 * Đợt 17 (C6): giỏ đang chọn lưu theo chi nhánh trong sessionStorage (tải lại trang, đăng nhập giữa chừng không mất). CỐ Ý không lưu các tick đồng ý và
 * hợp đồng đã xem: sự đồng ý phải do tài khoản đã đăng nhập thực hiện. Trình duyệt chặn storage thì chỉ là không nhớ giỏ.
 */
interface SavedCart { picked: PickedUnit[]; typeId: string; start: string; period: RentalPeriod; periods: number; checkInShift: CheckInShift; useAirConditioning: boolean; svcQty: Record<string, number>; payMode: PayMode; view: '2D' | '3D' }
const cartKey = (facilityId: string) => `khoan.cart.${facilityId}`;
function readCart(facilityId: string): SavedCart | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = JSON.parse(window.sessionStorage.getItem(cartKey(facilityId)) ?? 'null') as SavedCart | null;
    return v && Array.isArray(v.picked) && v.picked.length > 0 ? v : null;
  } catch { return null; }
}
function writeCart(facilityId: string, cart: SavedCart) { try { window.sessionStorage.setItem(cartKey(facilityId), JSON.stringify(cart)); } catch { /* không nhớ giỏ */ } }
function clearCart(facilityId: string) { try { window.sessionStorage.removeItem(cartKey(facilityId)); } catch { /* không có gì để xoá */ } }

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

/** Khung một bước đặt kho: số thứ tự (xong thì dấu ✓), tiêu đề, một dòng gợi ý và nội dung. */
function Step({ n, title, hint, done = false, id, aside, children }: { n: number; title: ReactNode; hint?: ReactNode; done?: boolean; id?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`buoc-${n}`} className="scroll-mt-24 rounded-2xl border border-stone-200 bg-white shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-4 sm:px-5">
        <span className={cx('grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors', done ? 'bg-emerald-600 text-white' : 'bg-ink text-white')}>{done ? <Check className="size-4" /> : n}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`buoc-${n}`} className="font-semibold leading-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
        </div>
        {aside}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Nhãn nhóm cho một cụm nút (không dùng <label> — nhãn bọc nút bấm sẽ "bấm hộ" nút đầu tiên khi chạm vào chữ). */
function Group({ label, tip, children, className }: { label: string; tip?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={className}>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-stone-700">{label}{tip && <InfoTip align="start">{tip}</InfoTip>}</p>
      {children}
    </div>
  );
}

export default function FacilityDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, ready, syncing, run, toast } = useStore();
  const router = useRouter();
  // Đợt 17 (C6): khôi phục giỏ đã lưu (lần render đầu luôn là khung chờ nên không lệch với HTML từ server).
  const [saved] = useState(() => readCart(id));
  const [start, setStart] = useState(() => { const today = todayISO().slice(0, 10); return saved && saved.start >= today ? saved.start : today; });
  const [period, setPeriod] = useState<RentalPeriod>(saved?.period ?? 'MONTH');
  const [periods, setPeriods] = useState(saved?.periods ?? 3);
  const [checkInShift, setCheckInShift] = useState<CheckInShift>(saved?.checkInShift ?? 'UNKNOWN');
  // Điều hòa là ADD-ON khách tự bật khi đặt — không gắn với ô cụ thể nào, mọi ô của loại kho hợp lệ
  // đều dùng chung một giá. Hình thức khoá vẫn là thuộc tính của TỪNG Ô — lọc ngay trên sơ đồ (làm
  // mờ ô không khớp, không ẩn khỏi sơ đồ).
  const [useAirConditioning, setUseAirConditioning] = useState(saved?.useAirConditioning ?? false);
  const [lockFilter, setLockFilter] = useState<AccessMethod | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [typeId, setTypeId] = useState(saved?.typeId ?? '');
  const [floorPlan, setFloorPlan] = useState<FloorPlanUnit[] | null>(null);
  // Chọn NHIỀU ô ngay trên sơ đồ: bấm một ô để chọn, bấm lại để bỏ. Đổi loại kho thì các ô đã chọn vẫn giữ.
  const [picked, setPicked] = useState<PickedUnit[]>(saved?.picked ?? []);
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
  const [svcQty, setSvcQty] = useState<Record<string, number>>(saved?.svcQty ?? {});
  // Đợt 17 (C2, C5, C6): lý do giỏ / giá vừa đổi — ô vừa có người đặt, giá mới. Tăng `reload` để tải lại báo giá và sơ đồ, giữ nguyên những gì đã nhập.
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  // "Giữ chỗ, trả tại quầy": giữ ô COUNTER_HOLD_HOURS giờ để khách đến quầy trả và ký giấy — mỗi tài khoản 1 đặt chỗ như vậy nên chỉ khi giỏ có 1 kho.
  // Đợt 15 (C1): "Trả khi nhận kho" — server quyết định có chọn được không (GET /reservations/cod-eligibility), kèm lý do để làm mờ lựa chọn.
  const [payMode, setPayMode] = useState<PayMode>(saved?.payMode ?? 'ONLINE');
  const [cod, setCod] = useState<(CodEligibility & { key: string }) | null>(null);
  // Xem sơ đồ 2D hay mô hình 3D — link "?view=3d" (nút Xem 3D của app) mở thẳng mô hình và cuộn tới bước chọn ô.
  const [view, setView] = useState<'2D' | '3D'>(saved?.view ?? '2D');
  const linked3D = useRef(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') !== '3d') return;
    linked3D.current = true;
    setView('3D');
  }, []);
  useEffect(() => {
    if (!detail || !linked3D.current) return;
    linked3D.current = false;
    document.getElementById('chon-o')?.scrollIntoView({ block: 'start' });
  }, [detail]);
  const fallbackTo2D = useCallback((reason: string) => { setView('2D'); toast(`${reason} — đã chuyển về sơ đồ 2D`, 'info'); }, [toast]);
  const types3D = useMemo<Site3DType[]>(() => (detail?.unitTypes ?? []).map((t) => ({
    _id: t._id, name: t.name, category: t.category, dimensions: t.dimensions, priceText: `${vnd(t.quote.firstPeriodRent)}/${PERIOD_UNIT[period]}`,
    offReason: allowsRentalPeriod(t.category, period) ? undefined : 'Kho cỡ lớn chỉ cho thuê theo tháng — đổi thời hạn ở bước 3',
  })), [detail, period]);

  // Khách tự chọn chu kỳ (ngày/tuần/tháng) + số chu kỳ + có dùng điều hòa không — server tính lại giá
  // theo đúng combo này (ac bị bỏ qua cho loại kho không hợp lệ, xem TypeRow.acEligible).
  useEffect(() => {
    let alive = true;
    api.get<Detail>(`/facilities/public/${id}?period=${period}&periods=${periods}&ac=${useAirConditioning}`)
      .then((d) => { if (!alive) return; setDetail({ ...d, policy: withPolicyDefaults(d.policy) }); setError(''); setTypeId((cur) => (cur && d.unitTypes.some((t) => t._id === cur) ? cur : d.unitTypes.find((t) => t.availability.available > 0)?._id || '')); })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id, period, periods, useAirConditioning, reload]);

  // Sơ đồ 2D cơ bản của loại kho đang chọn — khách bấm chọn một hoặc nhiều ô trống.
  useEffect(() => {
    if (!typeId) { setFloorPlan(null); return; }
    let alive = true;
    api.get<{ items: FloorPlanUnit[] }>(`/facilities/public/${id}/unit-types/${typeId}/floor-plan`)
      .then((d) => alive && setFloorPlan(d.items))
      .catch(() => alive && setFloorPlan([]));
    return () => { alive = false; };
  }, [id, typeId, reload]);

  // Đợt 17 (C6): lưu giỏ mỗi khi đổi; đặt xong thì xoá và không lưu lại nữa.
  const booked = useRef(false);
  useEffect(() => {
    if (booked.current) return;
    if (picked.length === 0) { clearCart(id); return; }
    writeCart(id, { picked, typeId, start, period, periods, checkInShift, useAirConditioning, svcQty, payMode, view });
  }, [id, picked, typeId, start, period, periods, checkInShift, useAirConditioning, svcQty, payMode, view]);
  // Giỏ khôi phục: ô có thể đã có người đặt trong lúc đăng nhập — đối chiếu sơ đồ, bỏ ô không còn trống và báo rõ. Lỗi mạng thì giữ giỏ, server vẫn kiểm khi đặt.
  const verifySaved = useRef(!!saved);
  useEffect(() => {
    if (!verifySaved.current) return;
    verifySaved.current = false;
    api.get<{ items: PublicSiteUnit[] }>(`/facilities/public/${id}/site-map`).then((d) => {
      const free = new Set(d.items.filter((u) => u.status === 'AVAILABLE').map((u) => u._id));
      const gone = (saved?.picked ?? []).filter((p) => !free.has(p.unitId));
      if (!gone.length) return;
      const text = `Ô ${gone.map((p) => p.unitNumber).join(', ')} không còn trống — đã bỏ khỏi giỏ. Chọn ô khác trên sơ đồ.`;
      setPicked((c) => c.filter((p) => free.has(p.unitId)));
      setNotice(text);
      toast(text, 'error');
    }).catch(() => {});
  }, [id, saved, toast]);
  // Đợt 17 (C6): sự đồng ý gắn với tài khoản đang đăng nhập — đổi tài khoản thì xác nhận lại từ đầu.
  useEffect(() => { setAgreeTerms(false); setAgreePrivacy(false); setAckedPayment(''); setAckedContracts(''); setViewedContracts([]); }, [user?._id]);

  // Mỗi ô đã chọn + báo giá hiện hành của loại kho đó (theo thời hạn và công tắc điều hòa đang chọn).
  const cart = useMemo(() => picked.flatMap((p) => {
    const t = detail?.unitTypes.find((x) => x._id === p.typeId);
    return t ? [{ ...p, quote: t.quote, useAirConditioning: t.acEligible && useAirConditioning }] : [];
  }), [picked, detail, useAirConditioning]);
  // C1: hỏi server "trả khi nhận kho" có chọn được cho đúng loại kho + ngày nhận của giỏ 1 kho (khách đã đăng nhập) — đổi ô / ngày thì hỏi lại.
  const codKey = cart.length === 1 && user?.role === 'CUSTOMER' ? `${cart[0].typeId}|${start}` : '';
  useEffect(() => {
    if (!codKey) return;
    let alive = true;
    const [unitTypeId, day] = codKey.split('|');
    api.get<CodEligibility>(`/reservations/cod-eligibility?unitTypeId=${unitTypeId}&startDate=${day}`)
      .then((v) => alive && setCod({ ...v, key: codKey }))
      .catch((e: Error) => alive && setCod({ allowed: false, message: `Chưa kiểm tra được (${e.message}) — chọn cách thanh toán khác`, holdUntil: '', key: codKey }));
    return () => { alive = false; };
  }, [codKey]);
  // Đợt 15 (B6): giữ chỗ trả tại quầy giữ ô tới min(lúc đặt + 24 giờ, hết ngày nhận kho) — cùng công thức với server; còn dưới 2 giờ thì
  // không cho chọn. B7: lịch thanh toán, dòng giỏ và câu tick nói theo chế độ trả (trả tại quầy trước HH:mm dd/mm thay cho "hôm nay");
  // F6: báo giá có ưu đãi cam kết → câu trả kho sớm theo bậc của chính sách. ackKey gồm chế độ trả → đổi chế độ phải tick lại.
  const holdUntil = counterHoldExpiry(`${start}T00:00:00.000Z`);
  const counterShort = counterHoldTooShort(holdUntil);
  const counter = payMode === 'COUNTER' && cart.length === 1 && !counterShort;
  // C1: COD chỉ khi server cho phép đúng giỏ đang chọn (cod.key) — lý do không cho phép hiện ngay dưới lựa chọn.
  const codFresh = !!codKey && cod?.key === codKey;
  const codAllowed = codFresh && !!cod?.allowed;
  const codOn = payMode === 'COD' && codAllowed;
  const codUntil = codFresh && cod ? cod.holdUntil : codHoldExpiry(`${start}T00:00:00.000Z`).toISOString();
  const codReason = cart.length > 1 ? 'Chỉ khi đặt 1 kho' : !user || user.role !== 'CUSTOMER' ? 'Đăng nhập tài khoản khách để chọn' : codFresh && !cod?.allowed ? cod?.message ?? '' : '';
  const timing: PayTiming = codOn ? { mode: 'COD', holdUntil: codUntil } : counter ? { mode: 'COUNTER', holdUntil } : ONLINE_TIMING;
  // C2: thuê theo ngày chỉ đặt trước tối đa 14 ngày — ngày đã chọn xa hơn thì báo và không cho đặt.
  const leadMax = addDays(todayISO(), Math.min(60, maxLeadDaysOf(period))).slice(0, 10);
  const leadOff = start > leadMax;
  const schedule = cart.length ? buildPaymentSchedule(cart.map((l) => l.quote), detail?.policy.gracePeriodDays, { timing, earlyTermination: detail?.policy.earlyTermination }) : null;
  const ackKey = schedule ? paymentAckKey(schedule) : '';
  const agreePayment = !!schedule && ackedPayment === ackKey;
  const lineParams = (l: (typeof cart)[number]): ContractPreviewParams => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate: `${start}T00:00:00.000Z`, rentalPeriod: period, periods, useAirConditioning: l.useAirConditioning, payOnArrival: codOn, label: `${l.typeName} · ô ${l.unitNumber} · ${periodLabel(period, periods)}` });
  const cartContractKeys = cart.map((l) => contractKey(lineParams(l)));
  const allContractsViewed = cart.length > 0 && cartContractKeys.every((k) => viewedContracts.includes(k));
  const agreeContract = allContractsViewed && ackedContracts === cartContractKeys.join(',');

  if (error) return <main className="mx-auto max-w-7xl p-8"><EmptyState icon={<Warehouse className="size-6" />} title="Không tải được chi nhánh" description={error} action={<ButtonLink href="/facilities">Quay lại</ButtonLink>} /></main>;
  if (!detail) {
    return (
      <main aria-busy className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-40 rounded-2xl" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px]">
          <div className="grid gap-6"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </main>
    );
  }

  const { facility: f, unitTypes: types, policy, services } = detail;
  const ut = types.find((t) => t._id === typeId);
  const q = ut?.quote;
  const qSurcharges = q ? surchargeLines(q, policy.surcharges) : [];
  const discountPct = q && q.discountAmount ? Math.round((q.discountAmount / (q.rate + q.surchargeAmount)) * 100) : 0;
  const bookable = f.status === 'ACTIVE';
  // Dịch vụ kèm chỉ cho kho từ cỡ Vừa trở lên — gắn vào ô đủ lớn đầu tiên trong giỏ; giỏ chỉ có locker / phòng S thì không có dịch vụ.
  const svcLine = cart.find((l) => servicesAllowedFor(types.find((t) => t._id === l.typeId)?.category ?? ''));
  const svcVisible = services.length > 0 && (!!svcLine || (!!ut && servicesAllowedFor(ut.category)));
  const pickedServices = svcLine ? services.filter((s) => (svcQty[s._id] ?? 0) > 0).map((s) => ({ ...s, quantity: svcQty[s._id] })) : [];
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
  // Bấm ô trên mô hình 3D: mọi loại kho nằm chung một cảnh nên ô tự mang theo loại của nó, và báo giá bên phải chuyển sang đúng loại đó.
  const toggleSiteUnit = (unit: { _id: string; unitNumber: string; unitTypeId: string }) => {
    if (picked.some((p) => p.unitId === unit._id)) { removeFromCart(unit._id); return; }
    if (picked.length >= MAX_UNITS) { toast(`Mỗi lượt đặt tối đa ${MAX_UNITS} kho`, 'error'); return; }
    const t = types.find((x) => x._id === unit.unitTypeId);
    if (!t) return;
    setPicked((c) => [...c, { unitId: unit._id, unitNumber: unit.unitNumber, typeId: t._id, typeName: t.name }]);
    setTypeId(t._id);
  };

  // Đợt 17 (C6): chưa đăng nhập thì thay các tick đồng ý bằng nút đăng nhập; giỏ đã lưu, quay lại đúng kiểu sơ đồ đang xem.
  const authPending = !user && (!ready || syncing);
  const anon = !user && !authPending;
  const loginHref = `/login?next=${encodeURIComponent(`/facilities/${f._id}${view === '3D' ? '?view=3d' : ''}`)}`;
  // Đợt 17 (C2, C5): server từ chối vì giá vừa đổi / ô vừa bị giữ — không có gì được ghi. Giữ nguyên dữ liệu đã nhập, tải lại báo giá và sơ đồ.
  const onBookFailed = (res: { error: string; code?: string; details?: unknown }) => {
    if (res.code === 'UNIT_NOT_AVAILABLE') {
      const taken = res.details as UnitTakenDetails | undefined;
      if (taken?.unitId) setPicked((c) => c.filter((p) => p.unitId !== taken.unitId));
      setNotice(taken?.unitId ? `${res.error}. Đã bỏ ô này khỏi giỏ.` : res.error);
      setReload((n) => n + 1);
    } else if (res.code === 'PRICE_CHANGED') {
      // Hợp đồng và lịch thanh toán đã xem ghi giá cũ — xem và xác nhận lại theo giá mới.
      setViewedContracts([]); setAckedContracts(''); setAckedPayment('');
      setNotice(`${res.error}.`);
      setReload((n) => n + 1);
    }
  };
  const finishBooking = () => { booked.current = true; clearCart(f._id); };

  const book = async () => {
    if (!user) { router.push(loginHref); return; }
    if (user.role !== 'CUSTOMER') { toast('Đặt chỗ dành cho tài khoản khách hàng', 'error'); return; }
    // Họ tên, số điện thoại, giấy tờ được in vào hợp đồng — thiếu thì mở form bổ sung ngay tại đây, không mất giỏ hàng.
    const gaps = profileGaps(user);
    if (gaps.length) { toast(`Bổ sung ${gaps.join(', ')} trước khi đặt kho`, 'error'); setProfileOpen(true); return; }
    if (cart.length === 0) return;
    if (!agreePayment) { toast('Vui lòng xác nhận đã đọc lịch thanh toán trước khi giữ chỗ', 'error'); return; }
    if (!agreeContract) { toast('Vui lòng mở xem và xác nhận đã đọc hợp đồng của các kho đã chọn', 'error'); return; }
    const consent = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true as const, contractAck: true as const };
    const startDate = `${start}T00:00:00.000Z`;
    setNotice('');
    // Đợt 17 (C2): tổng phải trả khi đặt của báo giá đang xem — kể cả trả tại quầy / trả khi nhận kho (số thu sau, nhưng cùng báo giá).
    const expectedTotal = cart.reduce((s, l) => s + dueAtBooking(l.quote), 0);
    if (cart.length === 1) {
      const line = cart[0];
      const res = await run('createReservation', { unitTypeId: line.typeId, unitId: line.unitId, startDate, rentalPeriod: period, periods, preferredCheckInShift: checkInShift, useAirConditioning: line.useAirConditioning, ...(line === svcLine ? { services: servicesPayload } : {}), source: 'WEB', consent, payAtCounter: counter, payOnArrival: codOn, expectedTotal },
        (r) => (codOn ? `Đã giữ chỗ — trả khi nhận kho, giữ ô đến hết ngày ${r.holdExpiresAt ? fmtEndOfDay(r.holdExpiresAt) : ''}` : counter ? `Đã giữ chỗ — đến quầy thanh toán trước ${r.holdExpiresAt ? fmtHoldUntil(r.holdExpiresAt) : ''}` : 'Đã giữ chỗ — vui lòng thanh toán để giữ kho'));
      if (res.ok) { finishBooking(); router.push(`/booking/${res.value._id}`); } else onBookFailed(res);
      return;
    }
    const res = await run('createReservationsBatch', {
      // Dịch vụ kèm gắn vào ô đủ lớn đầu tiên trong giỏ.
      items: cart.map((l) => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate, rentalPeriod: period, periods, preferredCheckInShift: checkInShift, useAirConditioning: l.useAirConditioning, ...(l === svcLine ? { services: servicesPayload } : {}) })), consent, expectedTotal,
    }, (items) => `Đã giữ chỗ ${items.length} kho — thanh toán từng kho trong mục Đặt chỗ của tôi`);
    if (res.ok) { finishBooking(); router.push('/portal/reservations'); } else onBookFailed(res);
  };

  const canBook = cart.length > 0 && bookable && !leadOff && agreeTerms && agreePrivacy && agreePayment && agreeContract;
  const bookLabel = !bookable ? 'Chi nhánh chưa nhận đặt chỗ' : codOn ? 'Giữ chỗ, trả khi nhận kho' : counter ? 'Giữ chỗ, trả tại quầy' : `Giữ chỗ & thanh toán${cart.length > 1 ? ` (${cart.length} kho)` : ''}`;
  const holdLine = codOn ? `Hôm nay chưa trả gì — ô được giữ đến hết ngày ${fmtEndOfDay(codUntil)}.` : counter ? `Ô được giữ đến ${fmtHoldUntil(holdUntil)} để bạn thanh toán tại quầy.` : `Giữ chỗ ${policy.reservationHoldMinutes} phút để thanh toán.`;
  // Những việc còn thiếu trước khi giữ chỗ — hiện dạng danh sách đánh dấu ở thẻ tóm tắt.
  const checklist = anon ? [
    { ok: cart.length > 0, label: 'Chọn ô kho trên sơ đồ' },
    { ok: false, label: 'Đăng nhập để xác nhận và giữ chỗ' },
  ] : [
    { ok: cart.length > 0, label: 'Chọn ô kho trên sơ đồ' },
    { ok: allContractsViewed, label: 'Mở xem hợp đồng từng kho' },
    { ok: agreeContract, label: 'Xác nhận đã đọc hợp đồng' },
    { ok: agreePayment, label: 'Xác nhận lịch thanh toán' },
    { ok: agreeTerms && agreePrivacy, label: 'Đồng ý điều khoản & bảo mật' },
  ];
  const bookButton = (className?: string) => (anon
    ? <ButtonLink href={loginHref} size="lg" className={cx('w-full', className)}>Đăng nhập để đặt</ButtonLink>
    : <Button size="lg" className={cx('w-full', className)} onClick={() => void book()} disabled={!canBook || authPending}>{bookLabel}</Button>);
  const noticeBox = notice && <p role="alert" className="mb-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-950 ring-1 ring-inset ring-amber-300"><Info className="mt-0.5 size-4 shrink-0" />{notice}</p>;

  return (
    <main className={cx(cart.length > 0 && 'pb-24 lg:pb-0')}>
      {/* ---- đầu trang: ảnh chi nhánh + thông tin nhanh */}
      <section className="relative isolate overflow-hidden bg-ink text-white">
        <img src={facilityPhoto(f)} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-ink via-ink/90 to-ink/40" />
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <nav aria-label="Vị trí trang" className="flex items-center gap-1 text-xs text-stone-300">
            <Link href="/facilities" className="hover:text-white">Tìm kho</Link><ChevronRight className="size-3.5" /><span className="truncate text-white">{f.name}</span>
          </nav>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{f.name}</h1>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-stone-200">
                <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-brand-200" />{f.address.line1}, {f.address.district}</span>
                <span className="inline-flex items-center gap-1.5"><Clock className="size-4 text-brand-200" />Ra vào {f.accessHours?.open ?? '06:00'}–{f.accessHours?.close ?? '22:00'}</span>
                <span className="inline-flex items-center gap-1.5"><Phone className="size-4 text-brand-200" />{f.contact.phone}</span>
              </div>
            </div>
            <Link href={`/facilities/${f._id}/gioi-thieu`} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium ring-1 ring-inset ring-white/20 backdrop-blur transition hover:bg-white/20">
              <Images className="size-4" />Xem giới thiệu & hình ảnh kho
            </Link>
          </div>
          {f.amenities.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {f.amenities.map((a) => { const Icon = amenityIcon(a); return <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/15"><Icon className="size-3.5 text-brand-200" />{a}</li>; })}
            </ul>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-6">
            {/* ---- bước 1: loại kho */}
            <Step n={1} title="Chọn loại kho" done={picked.length > 0} hint={`Giá theo ${periodLabel(period, periods)}, bắt đầu ${fmtDate(`${start}T00:00:00.000Z`)} — đổi thời hạn ở bước 3`}>
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {types.map((t) => {
                  const a = t.availability;
                  const selected = t._id === typeId;
                  // Kho cỡ lớn chỉ thuê theo tháng: đang chọn thuê ngày / tuần thì làm mờ, không cho chọn.
                  const periodOff = !allowsRentalPeriod(t.category, period);
                  const nPicked = picked.filter((p) => p.typeId === t._id).length;
                  const Icon = CATEGORY_ICON[t.category];
                  return (
                    <li key={t._id} className="min-w-0">
                      <button type="button" disabled={a.available === 0 || periodOff} onClick={() => setTypeId(t._id)} aria-pressed={selected} title={periodOff ? 'Kho cỡ lớn chỉ cho thuê theo tháng' : t.description}
                        className={cx('flex h-full w-full overflow-hidden rounded-xl text-left transition disabled:cursor-not-allowed disabled:opacity-55', selected ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-1 ring-stone-200 enabled:hover:shadow-lift enabled:hover:ring-stone-300')}>
                        <span className="relative w-24 shrink-0 overflow-hidden bg-stone-50 sm:w-28">
                          <img src={categoryCutaway(t.category)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-contain p-1.5" />
                          {selected && <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-brand-600 text-white ring-2 ring-white"><Check className="size-3.5" /></span>}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-2.5 p-3.5">
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700"><Icon className="size-3.5" />{UNIT_CATEGORY[t.category]}</span>
                              <span className="block font-semibold leading-snug">{t.name}</span>
                              <span className="block text-xs text-stone-500">{t.dimensions.widthM}×{t.dimensions.depthM}×{t.dimensions.heightM} m · {t.areaM2} m²</span>
                            </span>
                            <span className="shrink-0 text-right leading-tight">
                              <span className="block font-bold tabular-nums">{vnd(t.quote.firstPeriodRent)}</span>
                              <span className="text-xs text-stone-500">/{PERIOD_UNIT[period]}</span>
                            </span>
                          </span>
                          <AvailabilityBar available={a.available} total={a.total} />
                          {(isMonthOnly(t.category) || t.minPeriods > 1 || t.quote.firstPeriodAtBooking || nPicked > 0 || period === 'DAY') && (
                            <span className="flex flex-wrap gap-1.5 [&>span]:whitespace-normal">
                              {isMonthOnly(t.category) && <Badge tone={periodOff ? 'amber' : 'gray'}>Chỉ thuê theo tháng</Badge>}
                              {t.minPeriods > 1 && <Badge tone="gray">Tối thiểu {periodLabel(period, t.minPeriods)}</Badge>}
                              {t.quote.firstPeriodAtBooking && <Badge tone="amber">Giữ chân {periodLabel(period, t.quote.depositPeriods ?? 1)} + trả {PERIOD_UNIT[period]} đầu khi đặt</Badge>}
                              {period === 'DAY' && (t.quote.depositPeriods ?? 1) > 1 && <Badge tone="gray">Giữ chân tối thiểu {DAILY_DEPOSIT_MIN_DAYS} ngày tiền thuê</Badge>}
                              {nPicked > 0 && <Badge tone="violet">Đã chọn {nPicked} ô</Badge>}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Step>

            {/* ---- bước 2: chọn ô trên sơ đồ */}
            {(ut || view === '3D') && (
              <Step n={2} id="chon-o" title={view === '3D' || !ut ? 'Chọn ô trên mô hình 3D' : `Chọn ô — ${ut.name}`} done={picked.length > 0} hint={`Bấm ô còn trống để chọn, bấm lại để bỏ (tối đa ${MAX_UNITS} ô).`}
                aside={(
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    {picked.length > 0 && <Badge tone="violet">Đã chọn {picked.length} ô</Badge>}
                    <div role="group" aria-label="Kiểu sơ đồ" className="inline-flex rounded-lg bg-stone-100 p-0.5">
                      {([['2D', 'Sơ đồ 2D', LayoutGrid], ['3D', 'Xem 3D', Box]] as const).map(([v, label, Icon]) => (
                        <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors', view === v ? 'bg-white text-ink shadow-sm' : 'text-stone-600 hover:text-ink')}>
                          <Icon className="size-3.5" />{label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}>
                {view === '3D' || !ut ? (
                  <Facility3DPanel facilityId={f._id} types={types3D} selected={picked.map((p) => p.unitId)} onToggle={toggleSiteUnit} onBlocked={(m) => toast(m, 'error')} onFallback={fallbackTo2D} reloadKey={reload} />
                ) : (
                  <>
                    <Group label="Hình thức khoá">
                      <div className="flex flex-wrap gap-1.5">
                        {LOCK_OPTIONS.map((o) => (
                          <button key={o.label} type="button" aria-pressed={lockFilter === o.value} onClick={() => setLockFilter(o.value)} className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors', lockFilter === o.value ? 'bg-brand-600 text-white ring-brand-600' : 'text-stone-600 ring-stone-300 hover:bg-stone-50')}>{o.label}</button>
                        ))}
                      </div>
                    </Group>
                    <div className="mt-4">
                      {floorPlan === null ? <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : (
                        <FloorPlanPicker items={floorPlan} value={null} selected={picked.map((p) => p.unitId)} onChange={toggleUnit} lockMethod={lockFilter} />
                      )}
                    </div>
                  </>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm text-stone-600">
                  {picked.length === 0 ? 'Chưa chọn ô nào.' : <>Đã chọn <b>{picked.length}</b> ô: {picked.map((p) => <span key={p.unitId} className="rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">{p.unitNumber}</span>)}</>}
                </div>
              </Step>
            )}

            {/* ---- bước 3: thời hạn & dịch vụ */}
            <Step n={3} title="Thời hạn & dịch vụ" hint="Ngày nhận kho, thời gian gửi, điều hòa và dịch vụ kèm.">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-stone-700">Ngày bắt đầu</span>
                  <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={leadMax} value={start} onChange={(e) => setStart(e.target.value)} />
                  {leadOff && <span role="alert" className="mt-1 block text-xs font-medium text-red-600">{DAILY_LEAD_MESSAGE} — chọn ngày đến {fmtDate(`${leadMax}T00:00:00.000Z`)}.</span>}
                </label>
                <Group label="Ca giờ dự kiến đến nhận kho">
                  <div className="grid grid-cols-2 gap-2">
                    {CHECK_IN_SHIFTS.map((s) => (
                      <button key={s.value} type="button" aria-pressed={checkInShift === s.value} onClick={() => setCheckInShift(s.value)} className={cx('rounded-lg py-2 text-xs font-medium ring-1 ring-inset transition-colors', checkInShift === s.value ? 'bg-ink text-white ring-ink' : 'ring-stone-300 hover:bg-stone-50')}>{s.label}</button>
                    ))}
                  </div>
                </Group>
              </div>
              <Group label="Bạn sẽ gửi trong bao lâu?" className="mt-5">
                <DurationPicker period={period} periods={periods} discounts={detail?.policy.discounts ?? []} onChange={(p, n) => { setPeriod(p); setPeriods(n); }}
                  monthOnly={(!!ut && isMonthOnly(ut.category)) || picked.some((p) => { const t = types.find((x) => x._id === p.typeId); return !!t && isMonthOnly(t.category); })} />
                {period === 'DAY' && <p className="mt-2 flex gap-1.5 text-xs text-stone-500"><Info className="mt-0.5 size-3.5 shrink-0" />{DAILY_DEPOSIT_NOTE}.</p>}
              </Group>
              {ut?.acEligible && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sky-50/70 px-4 py-3 ring-1 ring-inset ring-sky-100">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-sky-950"><Snowflake className="size-4 text-sky-500" />Điều hòa<InfoTip align="start">Bật thì cộng phụ phí điều hòa vào tiền thuê mỗi kỳ.</InfoTip></p>
                  <Switch checked={useAirConditioning} onChange={setUseAirConditioning} label={useAirConditioning ? 'Có sử dụng' : 'Không sử dụng'} />
                </div>
              )}

              {svcVisible && (
                <div className="mt-6 border-t border-stone-100 pt-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">Dịch vụ kèm <span className="font-normal text-stone-500">(tuỳ chọn)</span></h3>
                    <p className="text-xs text-stone-500">Cho kho từ cỡ Vừa trở lên · đơn riêng, thanh toán khi nhận kho.</p>
                  </div>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {services.map((s) => {
                      const qty = svcQty[s._id] ?? 0;
                      const Icon = serviceIcon(s.code);
                      return (
                        <li key={s._id} className={cx('flex flex-col rounded-xl p-3.5 ring-1 ring-inset transition-colors', qty > 0 ? 'bg-brand-50 ring-brand-300' : 'bg-stone-50 ring-stone-200')}>
                          <div className="flex items-start gap-2.5">
                            <IconTile icon={<Icon className="size-4" />} size="sm" tone={qty > 0 ? 'teal' : 'gray'} />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold leading-snug">{s.name}</p>
                              {s.description && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-stone-500" title={s.description}>{s.description}</p>}
                            </div>
                          </div>
                          <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                            <p className="text-sm font-semibold tabular-nums text-brand-700">{vnd(s.price)}<span className="text-xs font-normal text-stone-500"> / {s.unitLabel}</span></p>
                            <div className="flex items-center gap-1">
                              <button type="button" aria-label={`Giảm ${s.name}`} disabled={qty === 0} onClick={() => setQty(s._id, qty - 1)} className="grid size-7 place-items-center rounded-md bg-white ring-1 ring-inset ring-stone-300 hover:bg-stone-100 disabled:opacity-40"><Minus className="size-3.5" /></button>
                              <input type="number" min={0} max={MAX_SERVICE_QTY} aria-label={`Số lượng ${s.name}`} value={qty} onChange={(e) => setQty(s._id, Number(e.target.value))} className="h-7 w-12 rounded-md border-0 bg-white text-center text-sm tabular-nums ring-1 ring-inset ring-stone-300" />
                              <button type="button" aria-label={`Thêm ${s.name}`} disabled={qty >= MAX_SERVICE_QTY} onClick={() => setQty(s._id, qty + 1)} className="grid size-7 place-items-center rounded-md bg-white ring-1 ring-inset ring-stone-300 hover:bg-stone-100 disabled:opacity-40"><Plus className="size-3.5" /></button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {servicesTotal > 0 && <p className="mt-3 text-sm">Dịch vụ kèm: <b className="tabular-nums">{vnd(servicesTotal)}</b> — thu khi nhận kho.</p>}
                </div>
              )}
            </Step>

            {/* ---- bước 4: giỏ, lịch thanh toán, xác nhận */}
            <Step n={4} id="xac-nhan" title="Xác nhận & thanh toán" done={canBook} hint={cart.length > 0 ? `${cart.length} kho trong giỏ` : undefined}>
              <div className="lg:hidden">{noticeBox}</div>
              {cart.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl bg-stone-50 p-4 text-sm text-stone-500 ring-1 ring-inset ring-stone-200">
                  <IconTile icon={<ShoppingCart className="size-4" />} tone="gray" size="sm" />Chưa chọn ô nào.
                </div>
              ) : (
                <ul className="space-y-2">
                  {cart.map((l) => {
                    const seen = viewedContracts.includes(contractKey(lineParams(l)));
                    const cat = types.find((t) => t._id === l.typeId)?.category;
                    const Icon = cat ? CATEGORY_ICON[cat] : Warehouse;
                    return (
                      <li key={l.unitId} className="flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-stone-200 sm:flex-nowrap">
                        <IconTile icon={<Icon className="size-4" />} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{l.typeName} · ô {l.unitNumber}{l.useAirConditioning ? ' · có điều hòa' : ''}</p>
                          <p className="text-xs text-stone-500">{cartLineText(l.quote, timing)}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          <button type="button" title={seen ? 'Đã xem hợp đồng của kho này' : 'Chưa xem hợp đồng của kho này'} onClick={() => setPreview(lineParams(l))}
                            className={cx('inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors', seen ? 'text-emerald-700 hover:bg-emerald-50' : 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300 hover:bg-amber-200')}>
                            {seen ? <CircleCheck className="size-3.5" /> : <FileText className="size-3.5" />}{seen ? 'Hợp đồng' : 'Xem hợp đồng'}
                          </button>
                          <button type="button" aria-label="Bỏ khỏi giỏ" onClick={() => removeFromCart(l.unitId)} className="grid size-7 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-200 hover:text-red-600"><Trash2 className="size-4" /></button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {cart.length > 0 && <PaymentSchedule quotes={cart.map((l) => l.quote)} graceDays={policy.gracePeriodDays} timing={timing} earlyTermination={policy.earlyTermination} className="mt-4" />}
              {cart.length > 0 && servicesTotal > 0 && (
                <div className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-950 ring-1 ring-inset ring-sky-200">
                  <p className="font-medium">Thanh toán khi nhận kho: <span className="tabular-nums">{vnd(servicesTotal)}</span> <span className="font-normal">(đơn riêng, ngoài hợp đồng thuê)</span></p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {pickedServices.map((s) => <li key={s._id}>{s.name} × {s.quantity} {s.unitLabel} — {vnd(s.price * s.quantity)}</li>)}
                  </ul>
                </div>
              )}

              {cart.length > 0 && (
                <Group label="Cách thanh toán" className="mt-5">
                  {(() => {
                    const mode: PayMode = codOn ? 'COD' : counter ? 'COUNTER' : 'ONLINE';
                    const counterOff = cart.length > 1 || counterShort;
                    // C1: lý do không chọn được "trả khi nhận kho" do server trả về (hoặc giỏ > 1 kho / chưa đăng nhập).
                    const opts: { v: PayMode; label: string; sub: string; Icon: typeof CreditCard; off: boolean; why?: string }[] = [
                      { v: 'ONLINE', label: 'Thanh toán online', sub: 'VNPay / MoMo / thẻ', Icon: CreditCard, off: false },
                      { v: 'COUNTER', label: 'Giữ chỗ, trả tại quầy', sub: cart.length > 1 ? 'Chỉ khi đặt 1 kho' : counterShort ? 'Hết ngày nhận kho sắp tới' : `Giữ ô đến ${fmtHoldUntil(holdUntil)}`, Icon: Store, off: counterOff, why: cart.length > 1 ? 'Chỉ áp dụng khi đặt 1 kho' : counterShort ? COUNTER_HOLD_TOO_SHORT_TEXT : undefined },
                      { v: 'COD', label: 'Trả khi nhận kho', sub: codAllowed ? `Hôm nay 0 ₫ · giữ ô đến hết ngày ${fmtEndOfDay(codUntil)}` : codReason || 'Đang kiểm tra…', Icon: Handshake, off: !codAllowed, why: codReason || undefined },
                    ];
                    return (
                      <>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {opts.map(({ v, label, sub, Icon, off, why }) => (
                            <button key={v} type="button" aria-pressed={mode === v} disabled={off} onClick={() => setPayMode(v)} title={off ? why : undefined}
                              className={cx('flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-50', mode === v ? 'bg-brand-50 text-brand-900 ring-2 ring-brand-600' : 'ring-stone-300 hover:bg-stone-50')}>
                              <Icon className={cx('size-5 shrink-0', mode === v ? 'text-brand-700' : 'text-stone-400')} />
                              <span className="min-w-0"><span className="block text-sm font-semibold leading-tight">{label}</span><span className="block text-[11px] text-stone-500">{sub}</span></span>
                            </button>
                          ))}
                        </div>
                        <p className={cx('mt-2 flex gap-1.5 text-xs leading-relaxed', mode !== 'ONLINE' ? 'text-stone-700' : 'text-stone-500')}><Info className="mt-0.5 size-3.5 shrink-0" />{mode === 'COD' ? COD_NOTE : PAY_AT_COUNTER_NOTE}</p>
                        {counterShort && cart.length === 1 && mode === 'COUNTER' && <p className="mt-1.5 text-xs font-medium text-amber-800">{COUNTER_HOLD_TOO_SHORT_TEXT}.</p>}
                        {payMode === 'COD' && !codAllowed && codReason && <p className="mt-1.5 text-xs font-medium text-amber-800">Không chọn được trả khi nhận kho: {codReason}.</p>}
                      </>
                    );
                  })()}
                </Group>
              )}

              {/* Đợt 17 (C6): các xác nhận do chính tài khoản đã đăng nhập thực hiện — chưa đăng nhập thì chỉ có nút đăng nhập, giỏ vẫn được giữ. */}
              {anon ? (
                <div className="mt-5 rounded-xl bg-brand-50 p-4 ring-1 ring-inset ring-brand-200">
                  <p className="text-sm text-brand-950">Đăng nhập để xác nhận hợp đồng, lịch thanh toán và giữ chỗ. Các ô và thời hạn đã chọn được giữ lại sau khi đăng nhập.</p>
                  <ButtonLink href={loginHref} className="mt-3 w-full">Đăng nhập để đặt</ButtonLink>
                </div>
              ) : authPending ? (
                <p className="mt-5 border-t border-dashed border-stone-200 pt-4 text-sm text-stone-500">Đang kiểm tra đăng nhập…</p>
              ) : (
              <div className="mt-5 space-y-2.5 border-t border-dashed border-stone-200 pt-4">
                {schedule && (
                  <label className="flex cursor-pointer gap-2.5 rounded-lg bg-amber-50 p-2.5 text-xs font-medium leading-relaxed text-amber-950 ring-1 ring-inset ring-amber-200">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-700" checked={agreePayment} onChange={(e) => setAckedPayment(e.target.checked ? ackKey : '')} />
                    <span>{paymentAckText(schedule)}</span>
                  </label>
                )}
                {cart.length > 0 && (
                  <label className={cx('flex gap-2.5 text-xs leading-relaxed', allContractsViewed ? 'cursor-pointer text-stone-700' : 'cursor-not-allowed text-stone-400')}>
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-700" disabled={!allContractsViewed} checked={agreeContract} onChange={(e) => setAckedContracts(e.target.checked ? cartContractKeys.join(',') : '')} />
                    <span>Tôi đã đọc hợp đồng của các kho đã chọn{allContractsViewed ? '' : ' (bấm “Xem hợp đồng” ở từng kho)'}</span>
                  </label>
                )}
                <label className="flex cursor-pointer gap-2.5 text-xs leading-relaxed text-stone-700">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-700" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                  <span>Tôi đã đọc và đồng ý với <Link href="/dieu-khoan" target="_blank" className="font-medium text-brand-700 hover:underline">Điều khoản thuê kho (v{TERMS_VERSION})</Link></span>
                </label>
                <label className="flex cursor-pointer gap-2.5 text-xs leading-relaxed text-stone-700">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-700" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
                  <span>Tôi đồng ý cho KhoAn xử lý dữ liệu cá nhân theo <Link href="/bao-mat" target="_blank" className="font-medium text-brand-700 hover:underline">Chính sách bảo mật (v{PRIVACY_VERSION})</Link></span>
                </label>
              </div>
              )}
              {/* Màn hình lớn: nút giữ chỗ nằm ở thẻ tóm tắt bên phải (luôn hiện khi cuộn); màn hình nhỏ: nút ở cuối bước này. */}
              {!anon && (
                <div className="mt-4 lg:hidden">
                  {bookButton()}
                  <p className="mt-2 text-center text-xs text-stone-500">{holdLine}</p>
                </div>
              )}
              <Disclosure variant="plain" className="mt-4 border-t border-stone-100 pt-2" icon={<Info className="size-4" />} title={<span className="text-sm">Chính sách huỷ & trả kho sớm</span>}>
                <p className="text-xs leading-relaxed text-stone-600">
                  {holdLine} Hủy trước ngày nhận ≥{policy.cancellation[0]?.minHoursBeforeStart} giờ hoàn {policy.cancellation[0]?.depositRefundPct}% tiền giữ chân,
                  ≥{policy.cancellation[1]?.minHoursBeforeStart} giờ hoàn {policy.cancellation[1]?.depositRefundPct}%, sát hơn không hoàn; tiền thuê trả trước luôn hoàn đủ.
                  Hợp đồng có ưu đãi thuê dài mà trả kho sớm: dùng ≤{policy.earlyTermination[0]?.maxElapsedPct}% thời hạn hoàn {policy.earlyTermination[0]?.depositRefundPct}% tiền giữ chân,
                  ≤{policy.earlyTermination[1]?.maxElapsedPct}% hoàn {policy.earlyTermination[1]?.depositRefundPct}%, quá {policy.earlyTermination[1]?.maxElapsedPct}% hoàn {policy.earlyTermination[2]?.depositRefundPct ?? 100}%.
                  {servicesTotal > 0 && ' Huỷ đặt chỗ thì đơn dịch vụ kèm tự huỷ.'}
                </p>
              </Disclosure>
            </Step>
          </div>

          {/* ---- cột phải: tóm tắt giá + nút giữ chỗ, dính khi cuộn */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Card className="overflow-hidden">
              <div className="bg-ink px-5 py-4 text-white">
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Tóm tắt đặt kho</p>
                <p className="mt-1 text-sm text-stone-200">{periodLabel(period, periods)} · từ {fmtDate(`${start}T00:00:00.000Z`)}{cart.length > 0 ? ` · ${cart.length} kho` : ''}</p>
              </div>
              <div className="p-5">
                <div className="hidden lg:block">{noticeBox}</div>
                {q && ut && (
                  <>
                    <h3 className="text-sm font-semibold">Báo giá {ut.name}</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-stone-500">{ut.name} / {PERIOD_UNIT[period]}</dt><dd className="tabular-nums">{vnd(q.rate)}</dd></div>
                      {qSurcharges.map((s) => (
                        <div key={s.code} className="flex justify-between gap-3">
                          <dt className="flex items-center gap-1 text-stone-500">{s.label}{s.basis ? ` (${s.basis})` : ''}<InfoTip align="start">{s.reason}</InfoTip></dt>
                          <dd className="tabular-nums">+{vnd(s.amount)}</dd>
                        </div>
                      ))}
                      {q.discountAmount > 0 && <div className="flex justify-between gap-3 text-emerald-700"><dt>Ưu đãi thuê {periodLabel(period, periods)} (−{discountPct}%)</dt><dd className="tabular-nums">−{vnd(q.discountAmount)}</dd></div>}
                      <div className="flex justify-between gap-3 border-t border-stone-100 pt-2 font-semibold"><dt>Tiền thuê mỗi {PERIOD_UNIT[period]}</dt><dd className="tabular-nums">{vnd(q.firstPeriodRent)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-stone-500">Tổng giá trị {periodLabel(period, periods)} <span className="text-xs">(trả từng {PERIOD_UNIT[period]})</span></dt><dd className="tabular-nums">{vnd(q.firstPeriodRent * periods)}</dd></div>
                    </dl>
                  </>
                )}
                {schedule && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-inset ring-brand-100">
                      <p className="text-[11px] font-medium text-brand-800">{counter ? payNowLabel(timing) : 'Trả hôm nay'}</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-brand-900">{vnd(schedule.payNow)}</p>
                    </div>
                    <div className="rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                      <p className="text-[11px] font-medium text-stone-600">Khi nhận kho</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums">{vnd(schedule.payAtCheckIn + servicesTotal)}</p>
                    </div>
                  </div>
                )}
                <ul className="mt-4 space-y-1.5 text-sm" aria-label="Các bước còn lại">
                  {checklist.map((c) => (
                    <li key={c.label} className={cx('flex items-center gap-2', c.ok ? 'text-emerald-700' : 'text-stone-500')}>
                      <span className={cx('grid size-4 shrink-0 place-items-center rounded-full', c.ok ? 'bg-emerald-600 text-white' : 'ring-1 ring-inset ring-stone-300')}>{c.ok && <Check className="size-3" />}</span>
                      {c.label}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 hidden lg:block">
                  {bookButton()}
                  {!anon && <p className="mt-2 text-center text-xs text-stone-500">{holdLine}</p>}
                </div>
                {!anon && !canBook && cart.length > 0 && <a href="#xac-nhan" className="mt-3 hidden items-center justify-center gap-1 text-xs font-medium text-brand-700 hover:underline lg:flex">Hoàn tất bước 4 để giữ chỗ <ArrowRight className="size-3.5" /></a>}
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <IconTile icon={<Headset className="size-5" />} />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Cần tư vấn trước khi đặt?</h3>
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">Cần hoá đơn VAT, hợp đồng riêng hoặc thuê nhiều kho — gửi yêu cầu, chi nhánh gọi lại. Kho không được giữ trong lúc chờ.</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setConsult({
                facilityId: f._id, facilityName: f.name, rentalPeriod: period, periods,
                unitTypeIds: [...new Set([...picked.map((p) => p.typeId), ...(ut ? [ut._id] : [])])].slice(0, 5),
              })}>Yêu cầu tư vấn</Button>
            </Card>
          </aside>
        </div>
      </div>

      {/* ---- màn hình nhỏ: thanh tổng tiền dính đáy */}
      {cart.length > 0 && schedule && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-lift backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-stone-500">{cart.length} kho · {codOn ? 'trả khi nhận kho' : counter ? 'trả tại quầy' : 'trả hôm nay'}</p>
              <p className="text-lg font-bold tabular-nums">{vnd(schedule.payNow)}</p>
            </div>
            <a href="#xac-nhan" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-800">
              Tiếp tục <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      )}

      <ContractPreviewDialog params={preview} onClose={() => setPreview(null)}
        onViewed={() => { if (!preview) return; const k = contractKey(preview); setViewedContracts((c) => (c.includes(k) ? c : [...c, k])); }} />
      <ConsultationDialog ctx={consult} onClose={() => setConsult(null)} />
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </main>
  );
}
