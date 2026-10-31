import { useEffect, useState, type ReactNode } from 'react';
import { Image, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AccessMethod, BusinessPolicy, CheckInShift, CodEligibility, Facility, PayTiming, PriceQuote, RentalPeriod, UnitType } from '@ssm/shared';
import {
  ACCESS_METHOD, AccessMethod as ACCESS_METHOD_ENUM, allowsRentalPeriod, isMonthOnly, buildPaymentSchedule, cartLineText, CHECK_IN_SHIFT, COD_NOTE, codHoldExpiry, codHoldText, COUNTER_HOLD_TOO_SHORT_TEXT, counterHoldExpiry, counterHoldText, counterHoldTooShort,
  DAILY_DEPOSIT_MIN_DAYS, DAILY_DEPOSIT_NOTE, DAILY_LEAD_MESSAGE, enumValues, fmtEndOfDay, fmtHoldUntil, maxLeadDaysOf,
  ONLINE_TIMING, PAY_AT_COUNTER_NOTE, paymentAckKey, paymentAckText, payNowLabel, PERIOD_UNIT,
  PRIVACY_VERSION, profileGaps, servicesAllowedFor, STAFF_SHIFTS, surchargeLines, TERMS_EFFECTIVE, TERMS_VERSION, UNIT_CATEGORY, addDays, periodLabel, todayISO, vnd,
} from '@ssm/shared';
import { api } from '../../shared/api/client';
import type { BookingService } from '../../shared/api/actions';
import { useStore } from '../../shared/store/store';
import { Button, Callout, Card, CheckRow, Chip, Chips, DateStepper, Disclosure, EmptyState, IconTile, KV, Muted, OptionCard, Screen, ScreenHeader, ScreenSkeleton, Skeleton } from '../../shared/ui';
import { C, R, S, SHADOW, T, TOUCH } from '../../shared/ui/theme';
import { availabilityTone, categoryCutaway, categoryIcon, serviceIcon } from '../../shared/ui/visuals';
import { FloorPlanPicker, type FloorPlanUnit } from './floor-plan-picker';
import { DurationPicker } from './duration-picker';
import { PaymentSchedule } from '../payments/payment-schedule';
import { ContractPreviewModal, type ContractPreviewParams } from '../contracts/contract-preview-modal';
import { ConsultationModal, type ConsultationContext } from '../tickets/consultation-modal';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';

// acEligible: loại kho này có tuỳ chọn điều hòa (add-on) hay không, theo policy.surcharges[CLIMATE].
type TypeRow = UnitType & { quote: PriceQuote; acEligible: boolean; availability: { total: number; free: number; available: number } };
interface Detail {
  facility: Facility;
  unitTypes: TypeRow[];
  services: { _id: string; code: string; name: string; description?: string; price: number; unitLabel: string }[];
  policy: Pick<BusinessPolicy, 'version' | 'scope' | 'reservationHoldMinutes' | 'cancellation' | 'minPeriods' | 'maxPeriods' | 'discounts' | 'gracePeriodDays'> & Partial<Pick<BusinessPolicy, 'surcharges' | 'earlyTermination'>>;
}
/** Một ô khách đã bấm chọn trên sơ đồ. Báo giá luôn lấy theo thời hạn/điều hòa đang chọn, không lưu cứng ở đây. */
interface PickedUnit { unitId: string; unitNumber: string; typeId: string; typeName: string }
/** Đặt tối đa bấy nhiêu kho trong một lượt (khớp giới hạn của API /reservations/batch). */
const MAX_UNITS = 10;
/** Khoá "đã xem hợp đồng" của một kho — đổi ô / ngày / chu kỳ / số kỳ / điều hòa / trả khi nhận kho là hợp đồng khác, phải xem lại. */
const contractKey = (p: Pick<ContractPreviewParams, 'unitId' | 'startDate' | 'rentalPeriod' | 'periods' | 'useAirConditioning' | 'payOnArrival'>) =>
  `${p.unitId}|${p.startDate.slice(0, 10)}|${p.rentalPeriod}|${p.periods}|${p.useAirConditioning}${p.payOnArrival ? '|COD' : ''}`;
/** Số lượng tối đa mỗi dịch vụ kèm (như màn đặt dịch vụ sau khi thuê). */
const MAX_SERVICE_QTY = 99;
/**
 * Cách trả tiền giữ chân: online ngay (qua cổng thanh toán), giữ ô (tối đa 24 giờ, không quá hết ngày nhận) rồi trả tại quầy (`payAtCounter`),
 * hoặc đợt 15 (C1) "Trả khi nhận kho" (`payOnArrival`) — hôm nay 0 ₫, giữ ô đến hết ngày nhận; server quyết định có chọn được không.
 */
type PayMode = 'ONLINE' | 'COUNTER' | 'COD';

// Nhãn ngắn trên chip ("Ca 1"), thời gian đầy đủ chỉ hiện ở dòng chú thích bên dưới khi đã chọn — đỡ rối mắt.
const CHECK_IN_SHIFTS: { value: CheckInShift; label: string }[] = [...STAFF_SHIFTS, 'UNKNOWN' as const]
  .map((s) => ({ value: s, label: s === 'UNKNOWN' ? 'Chưa rõ' : `Ca ${s.slice(-1)}` }));
/** Hình thức khoá — thuộc tính của TỪNG Ô (không phải loại kho); 'ALL' = không lọc. */
const LOCK_OPTIONS: { value: AccessMethod | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tất cả' },
  ...enumValues(ACCESS_METHOD_ENUM).map((v) => ({ value: v, label: ACCESS_METHOD[v] })),
];

/** Bảng tóm tắt giá — tách hàm để không phải nhồi logic điều kiện vào JSX. */
function priceItems(q: PriceQuote, typeName: string, periods: number, surcharges: Detail['policy']['surcharges']): [string, ReactNode][] {
  const unit = PERIOD_UNIT[q.rentalPeriod];
  const items: [string, ReactNode][] = [[`${typeName} / ${unit}`, vnd(q.rate)]];
  // Phụ phí phải nói rõ là phụ phí gì và tính thế nào — không ghi trơ trọi "Phụ phí".
  for (const s of surchargeLines(q, surcharges)) items.push([`${s.label}${s.basis ? ` (${s.basis})` : ''}`, `+${vnd(s.amount)}`]);
  if (q.discountAmount > 0) items.push([`Ưu đãi thuê ${periodLabel(q.rentalPeriod, periods)}`, `-${vnd(q.discountAmount)}`]);
  items.push([`Tiền thuê mỗi ${unit}`, vnd(q.firstPeriodRent)]);
  items.push([`Tổng giá trị ${periodLabel(q.rentalPeriod, periods)} (trả từng ${unit})`, vnd(q.firstPeriodRent * periods)]);
  return items;
}

export default function FacilityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, run, user, toast } = useStore();
  const router = useRouter();
  const [start, setStart] = useState(todayISO());
  const [period, setPeriod] = useState<RentalPeriod>('MONTH');
  const [periods, setPeriods] = useState('3');
  const [checkInShift, setCheckInShift] = useState<CheckInShift>('UNKNOWN');
  // Điều hòa là ADD-ON khách tự bật khi đặt — không gắn với ô cụ thể nào, mọi ô của loại kho hợp lệ
  // đều dùng chung một giá. Hình thức khoá vẫn là thuộc tính của TỪNG Ô — lọc ngay trên sơ đồ.
  const [useAirConditioning, setUseAirConditioning] = useState(false);
  const [lockFilter, setLockFilter] = useState<AccessMethod | 'ALL'>('ALL');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [typeId, setTypeId] = useState('');
  const [floorPlan, setFloorPlan] = useState<FloorPlanUnit[] | null>(null);
  // Chọn NHIỀU ô ngay trên sơ đồ: bấm một ô để chọn, bấm lại để bỏ. Đổi loại kho thì các ô đã chọn vẫn giữ.
  const [picked, setPicked] = useState<PickedUnit[]>([]);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  // Xác nhận đã đọc lịch thanh toán gắn với ĐÚNG số tiền đang hiển thị — đổi ô/chu kỳ (số tiền đổi) thì phải xác nhận lại.
  const [ackedPayment, setAckedPayment] = useState('');
  const [preview, setPreview] = useState<ContractPreviewParams | null>(null);
  // Hợp đồng từng kho đã mở xem (theo contractKey) + xác nhận đã đọc gắn với đúng giỏ lúc tick — giỏ đổi thì tick lại.
  const [viewedContracts, setViewedContracts] = useState<string[]>([]);
  const [ackedContracts, setAckedContracts] = useState('');
  const [consult, setConsult] = useState<ConsultationContext | null>(null);
  // Dịch vụ kèm chọn lúc đặt (serviceId → số lượng): đơn riêng ngoài hợp đồng thuê, thu tiền khi nhận kho.
  const [svcQty, setSvcQty] = useState<Record<string, number>>({});
  const [payMode, setPayMode] = useState<PayMode>('ONLINE');
  // C1: kết quả GET /reservations/cod-eligibility cho đúng giỏ 1 kho + ngày nhận đang chọn (key) — lý do không chọn được hiện dưới lựa chọn.
  const [cod, setCod] = useState<(CodEligibility & { key: string }) | null>(null);
  const codKey = picked.length === 1 && user?.role === 'CUSTOMER' ? `${picked[0].typeId}|${start.slice(0, 10)}` : '';

  // Khách tự chọn chu kỳ (ngày/tuần/tháng) + số chu kỳ + có dùng điều hòa không — server tính lại
  // giá theo đúng combo này (ac bị bỏ qua cho loại kho không hợp lệ, xem TypeRow.acEligible).
  useEffect(() => {
    let alive = true;
    api.get<Detail>(`/facilities/public/${id}?period=${period}&periods=${periods}&ac=${useAirConditioning}`)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setError('');
        setTypeId((cur) => cur || d.unitTypes.find((t) => t.availability.available > 0)?._id || '');
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id, period, periods, useAirConditioning]);

  // C1: hỏi server "trả khi nhận kho" có chọn được cho loại kho + ngày nhận của giỏ 1 kho — đổi ô / ngày thì hỏi lại.
  useEffect(() => {
    if (!codKey) return;
    let alive = true;
    const [unitTypeId, day] = codKey.split('|');
    api.get<CodEligibility>(`/reservations/cod-eligibility?unitTypeId=${unitTypeId}&startDate=${day}`)
      .then((v) => alive && setCod({ ...v, key: codKey }))
      .catch((e: Error) => alive && setCod({ allowed: false, message: `Chưa kiểm tra được (${e.message}) — chọn cách thanh toán khác`, holdUntil: '', key: codKey }));
    return () => { alive = false; };
  }, [codKey]);

  // Sơ đồ 2D cơ bản của loại kho đang chọn — khách bấm chọn một hoặc nhiều ô trống.
  useEffect(() => {
    if (!typeId) { setFloorPlan(null); return; }
    let alive = true;
    api.get<{ items: FloorPlanUnit[] }>(`/facilities/public/${id}/unit-types/${typeId}/floor-plan`)
      .then((d) => alive && setFloorPlan(d.items))
      .catch(() => alive && setFloorPlan([]));
    return () => { alive = false; };
  }, [id, typeId]);

  if (error) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          tone="red"
          title="Không tải được chi nhánh"
          description={error}
          action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }
  if (!detail) {
    return <Screen><ScreenSkeleton hero={false} rows={3} /></Screen>;
  }

  const { facility: f, unitTypes: types } = detail;
  const ut = types.find((t) => t._id === typeId);
  const q = ut?.quote;
  const periodsNum = Math.max(1, Math.min(365, Number(periods) || 1));
  // Mỗi ô đã chọn + báo giá hiện hành của loại kho đó (theo thời hạn và công tắc điều hòa đang chọn).
  const cart = picked.flatMap((p) => {
    const t = types.find((x) => x._id === p.typeId);
    return t ? [{ ...p, quote: t.quote, useAirConditioning: t.acEligible && useAirConditioning }] : [];
  });
  // Trả tại quầy: mỗi tài khoản giữ tối đa 1 đặt chỗ kiểu này cùng lúc (server chặn COUNTER_HOLD_LIMIT) → chỉ khi đặt đúng 1 kho.
  // Đợt 15 (B6): hạn giữ ô = min(lúc đặt + 24 giờ, hết ngày nhận kho) như server — còn dưới 2 giờ thì không cho chọn.
  const counterHeld = db.reservations.some((r) => r.status === 'PENDING' && r.payAtCounter && (r.holdExpiresAt ?? '') > new Date().toISOString());
  const holdUntil = counterHoldExpiry(start);
  const counterShort = counterHoldTooShort(holdUntil);
  const counterOff = cart.length > 1 || counterHeld || counterShort;
  const atCounter = payMode === 'COUNTER' && !counterOff;
  // C1: chỉ chọn được khi server cho phép đúng giỏ đang chọn.
  const codFresh = !!codKey && cod?.key === codKey && cart.length === 1;
  const codAllowed = codFresh && !!cod?.allowed;
  const codOn = payMode === 'COD' && codAllowed;
  const codUntil = codFresh && cod ? cod.holdUntil : codHoldExpiry(start).toISOString();
  const codReason = cart.length > 1 ? 'Chỉ áp dụng khi đặt 1 kho' : codFresh && !cod?.allowed ? cod?.message ?? '' : '';
  // B7: lịch thanh toán / dòng giỏ / câu tick theo chế độ trả; F6: báo giá có ưu đãi cam kết → câu trả kho sớm. ackKey gồm chế độ trả.
  const timing: PayTiming = codOn ? { mode: 'COD', holdUntil: codUntil } : atCounter ? { mode: 'COUNTER', holdUntil } : ONLINE_TIMING;
  // C2: thuê theo ngày chỉ đặt trước tối đa 14 ngày.
  const leadMax = addDays(todayISO(), Math.min(60, maxLeadDaysOf(period)));
  const leadOff = start.slice(0, 10) > leadMax.slice(0, 10);
  const earlyTermination = detail.policy.earlyTermination ?? [];
  const schedule = cart.length ? buildPaymentSchedule(cart.map((l) => l.quote), detail.policy.gracePeriodDays, { timing, earlyTermination }) : null;
  const ackKey = schedule ? paymentAckKey(schedule) : '';
  const agreePayment = !!schedule && ackedPayment === ackKey;
  const lineParams = (l: (typeof cart)[number]): ContractPreviewParams => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate: start, rentalPeriod: period, periods: periodsNum, useAirConditioning: l.useAirConditioning, payOnArrival: codOn, label: `${l.typeName} · ô ${l.unitNumber} · ${periodLabel(period, periodsNum)}` });
  const cartContractKeys = cart.map((l) => contractKey(lineParams(l)));
  const allContractsViewed = cart.length > 0 && cartContractKeys.every((k) => viewedContracts.includes(k));
  const agreeContract = allContractsViewed && ackedContracts === cartContractKeys.join(',');
  const canBook = cart.length > 0 && !leadOff && agreeTerms && agreePrivacy && agreePayment && agreeContract;
  const qReasons = q ? surchargeLines(q, detail.policy.surcharges) : [];
  // Dịch vụ kèm chỉ cho kho từ cỡ Vừa trở lên — gắn vào ô đủ lớn đầu tiên trong giỏ.
  const svcLine = cart.find((l) => servicesAllowedFor(types.find((t) => t._id === l.typeId)?.category ?? ''));
  const svcVisible = (detail.services ?? []).length > 0 && (!!svcLine || (!!ut && servicesAllowedFor(ut.category)));
  const svcList = svcVisible ? detail.services ?? [] : [];
  const services: BookingService[] = !svcLine ? [] : svcList.filter((sv) => (svcQty[sv._id] ?? 0) > 0).map((sv) => ({ serviceId: sv._id, quantity: svcQty[sv._id] }));
  const svcTotal = !svcLine ? 0 : svcList.reduce((s, sv) => s + sv.price * (svcQty[sv._id] ?? 0), 0);
  const stepSvc = (id: string, d: number) => setSvcQty((m) => ({ ...m, [id]: Math.max(0, Math.min(MAX_SERVICE_QTY, (m[id] ?? 0) + d)) }));


  const toggleUnit = (unitId: string) => {
    if (!ut) return;
    if (picked.some((p) => p.unitId === unitId)) { setPicked((c) => c.filter((p) => p.unitId !== unitId)); return; }
    if (picked.length >= MAX_UNITS) return;
    const u = floorPlan?.find((x) => x._id === unitId);
    setPicked((c) => [...c, { unitId, unitNumber: u?.unitNumber ?? '', typeId: ut._id, typeName: ut.name }]);
  };
  const book = () => {
    // Họ tên, số điện thoại, giấy tờ được in vào hợp đồng — thiếu thì chuyển sang Tài khoản để bổ sung.
    const gaps = user ? profileGaps(user) : [];
    if (gaps.length) { toast(`Bổ sung ${gaps.join(', ')} trong Tài khoản trước khi đặt kho`, 'error'); router.push('/account'); return; }
    const item = (l: (typeof cart)[number]) => ({ unitTypeId: l.typeId, unitId: l.unitId, startDate: start, rentalPeriod: period, periods: periodsNum, preferredCheckInShift: checkInShift, useAirConditioning: l.useAirConditioning });
    const svc = services.length ? services : undefined;
    // Đặt xong: bỏ các màn trung gian (khám phá → giới thiệu → chọn ô) — màn đặt chỗ nằm ngay trên trang chính, back một lần là về.
    if (cart.length === 1) {
      void run('createReservation', { ...item(cart[0]), services: cart[0] === svcLine ? svc : undefined, contractAck: true, payAtCounter: atCounter || undefined, payOnArrival: codOn || undefined },
        (v) => (codOn && v.holdExpiresAt ? `Đã giữ chỗ — ${codHoldText(v.holdExpiresAt)}` : atCounter && v.holdExpiresAt ? `Đã giữ chỗ — ${counterHoldText(v.holdExpiresAt)}` : 'Đã giữ chỗ — vui lòng thanh toán để giữ kho'),
        (v) => { router.dismissAll(); router.push(`/booking/${v._id}`); });
      return;
    }
    // Nhiều kho: mỗi kho là một đặt chỗ riêng — về trang chủ, mục "Chờ thanh toán" liệt kê từng kho để trả.
    // Dịch vụ kèm gắn vào ô đủ lớn đầu tiên trong giỏ.
    void run('createReservationsBatch', { items: cart.map((l) => (l === svcLine ? { ...item(l), services: svc } : item(l))), contractAck: true }, (items) => `Đã giữ chỗ ${items.length} kho — thanh toán từng kho ở mục Chờ thanh toán`, () => { router.dismissAll(); router.navigate('/'); });
  };

  const footer = (
    <View style={st.footRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.caption} numberOfLines={1}>{cart.length > 0 ? `${cart.length} kho đã chọn · ${codOn ? `trả khi nhận kho · giữ đến hết ${fmtEndOfDay(codUntil)}` : atCounter ? payNowLabel(timing) : 'thanh toán hôm nay'}` : 'Chưa chọn ô nào'}</Text>
        <Text style={st.footAmount} numberOfLines={1} adjustsFontSizeToFit>{schedule ? vnd(schedule.payNow) : '—'}</Text>
      </View>
      <Button
        title={codOn ? 'Giữ chỗ, trả khi nhận kho' : atCounter ? 'Giữ chỗ, trả tại quầy' : `Giữ chỗ & thanh toán${cart.length > 1 ? ` (${cart.length} kho)` : ''}`}
        disabled={!canBook}
        style={{ flex: 1.6 }}
        onPress={book}
      />
    </View>
  );

  return (
    <Screen footer={footer}>
      <ScreenHeader title={f.name} subtitle={`${f.address.district}, ${f.address.city}`} />
      <Pressable onPress={() => router.push(`/facility/intro/${f._id}`)} accessibilityRole="link" style={({ pressed }) => [st.introLink, pressed && { opacity: 0.7 }]}>
        <Ionicons name="images-outline" size={18} color={C.brand700} />
        <Text style={st.introLinkText}>Xem giới thiệu & hình ảnh kho</Text>
        <Ionicons name="chevron-forward" size={16} color={C.brand700} />
      </Pressable>
      {/* Mô hình 3D chỉ có trên web (không dựng 3D native) — mở thẳng trang chi nhánh ở chế độ 3D. */}
      <Pressable onPress={() => void Linking.openURL(`${WEB_ORIGIN}/facilities/${f._id}?view=3d`)} accessibilityRole="link" style={({ pressed }) => [st.introLink, { marginTop: S.sm }, pressed && { opacity: 0.7 }]}>
        <Ionicons name="cube-outline" size={18} color={C.brand700} />
        <Text style={st.introLinkText}>Xem 3D (mở trên web)</Text>
        <Ionicons name="open-outline" size={16} color={C.brand700} />
      </Pressable>

      <StepHead n={1} title="Thời gian thuê" icon="calendar-outline" />
      <Card>
        <DateStepper label="Ngày bắt đầu" value={start} onChange={setStart} min={todayISO()} max={leadMax} presets={[0, 3, 7, 14]} />
        {leadOff && <Muted style={{ marginTop: S.xs, color: C.red } as never}>{DAILY_LEAD_MESSAGE} — chọn ngày nhận sớm hơn.</Muted>}

        <View style={st.block}>
          <Text style={st.label}>Bạn sẽ gửi trong bao lâu?</Text>
          <DurationPicker period={period} periods={periodsNum} discounts={detail?.policy.discounts ?? []} onChange={(p, n) => { setPeriod(p); setPeriods(String(n)); }}
            monthOnly={(!!ut && isMonthOnly(ut.category)) || picked.some((p) => { const t = types.find((x) => x._id === p.typeId); return !!t && isMonthOnly(t.category); })} />
          {period === 'DAY' && <Muted style={{ marginTop: S.sm } as never}>{DAILY_DEPOSIT_NOTE}.</Muted>}
        </View>

        <View style={st.block}>
          <Text style={st.label}>Ca giờ dự kiến đến nhận kho</Text>
          <Chips options={CHECK_IN_SHIFTS} value={checkInShift} onChange={setCheckInShift} />
          {checkInShift !== 'UNKNOWN' && <Muted style={{ marginTop: 6 } as never}>{CHECK_IN_SHIFT[checkInShift].label}</Muted>}
        </View>

        {ut?.acEligible && (
          <View style={st.acRow}>
            <IconTile icon="snow-outline" tone="blue" size="sm" />
            <Text style={st.acText}>{useAirConditioning ? 'Có sử dụng điều hòa' : 'Không sử dụng điều hòa'}</Text>
            <Switch value={useAirConditioning} onValueChange={setUseAirConditioning} trackColor={{ false: C.line, true: C.brand600 }} thumbColor={C.card} />
          </View>
        )}
      </Card>

      <StepHead n={2} title="Loại kho & chỗ trống" icon="cube-outline" />
      <View style={{ gap: S.sm }}>
        {types.map((t) => {
          const a = t.availability;
          const selected = t._id === typeId;
          const full = a.available === 0;
          // Kho cỡ lớn chỉ thuê theo tháng: đang chọn thuê ngày / tuần thì làm mờ, không cho chọn.
          const periodOff = !allowsRentalPeriod(t.category, period);
          const nPicked = picked.filter((p) => p.typeId === t._id).length;
          return (
            <Pressable key={t._id} disabled={full || periodOff} onPress={() => setTypeId(t._id)}
              accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: full || periodOff }}
              style={({ pressed }) => [st.typeCard, selected && st.typeCardSelected, (full || periodOff) && st.typeCardFull, pressed && { opacity: 0.85 }]}>
              <View style={st.typeTop}>
                {/* Ảnh mặt cắt cỡ kho (cùng bộ tranh minh hoạ với web); thiếu ảnh thì dùng icon như cũ. */}
                {categoryCutaway(t.category)
                  ? <View style={[st.typeThumb, selected && st.typeThumbSelected]}><Image source={categoryCutaway(t.category)} style={st.typeThumbImg} resizeMode="contain" accessibilityLabel={`Minh hoạ ${t.name}`} /></View>
                  : <IconTile icon={categoryIcon(t.category)} tone={selected ? 'teal' : 'gray'} solid={selected} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.typeName}>{t.name}</Text>
                  <Text style={T.caption}>{t.dimensions.widthM}×{t.dimensions.depthM}×{t.dimensions.heightM} m ({t.areaM2} m²)</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={st.typePrice}>{vnd(t.quote.firstPeriodRent)}</Text>
                  <Text style={T.caption}>/{PERIOD_UNIT[period]}</Text>
                </View>
              </View>
              {t.description ? <Muted style={{ marginTop: S.sm } as never}>{t.description}</Muted> : null}
              <View style={st.typeChips}>
                <Chip size="sm" icon={categoryIcon(t.category)}>{UNIT_CATEGORY[t.category]}</Chip>
                <Chip size="sm" tone={availabilityTone(a.available)} dot>{full ? 'Hết chỗ' : `Còn ${a.available}/${a.total}`}</Chip>
                {isMonthOnly(t.category) && <Chip size="sm" tone={periodOff ? 'amber' : 'gray'} icon="calendar-outline">Chỉ thuê theo tháng</Chip>}
                {t.quote.firstPeriodAtBooking && <Chip size="sm" tone="amber">Giữ chân {periodLabel(period, t.quote.depositPeriods ?? 1)} + trả {PERIOD_UNIT[period]} đầu khi đặt</Chip>}
                {period === 'DAY' && (t.quote.depositPeriods ?? 1) > 1 && <Chip size="sm" tone="gray">Giữ chân tối thiểu {DAILY_DEPOSIT_MIN_DAYS} ngày</Chip>}
                {nPicked > 0 && <Chip size="sm" tone="violet" icon="checkmark-circle">Đã chọn {nPicked} ô</Chip>}
              </View>
            </Pressable>
          );
        })}
      </View>

      {ut && (
        <>
          <StepHead n={3} title={`Chọn ô kho — ${ut.name}`} icon="grid-outline" />
          <Card>
            <Text style={st.label}>Hình thức khoá</Text>
            <Chips options={LOCK_OPTIONS} value={lockFilter} onChange={setLockFilter} />
            <Muted style={{ marginTop: S.sm } as never}>Chọn tối đa {MAX_UNITS} ô.</Muted>
            <View style={{ marginTop: S.md }}>
              {floorPlan === null ? <View style={{ gap: S.sm }}><Skeleton h={14} w="60%" /><Skeleton h={56} /><Skeleton h={56} /></View> : (
                <FloorPlanPicker items={floorPlan} value={null} selected={picked.map((p) => p.unitId)} onChange={toggleUnit} lockMethod={lockFilter === 'ALL' ? null : lockFilter} />
              )}
            </View>
          </Card>
        </>
      )}

      {ut && q && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.cardHead}>
            <IconTile icon="pricetags-outline" size="sm" />
            <Text style={st.cardTitle}>Báo giá {ut.name}</Text>
          </View>
          <KV items={priceItems(q, ut.name, periodsNum, detail.policy.surcharges)} />
          {qReasons.length > 0 && (
            <Disclosure title="Vì sao có phụ phí" style={{ marginTop: S.sm }}>
              {qReasons.map((s) => <Text key={s.code} style={T.small}>{s.label}: {s.reason}</Text>)}
            </Disclosure>
          )}
        </Card>
      )}

      <StepHead n={ut ? 4 : 3} title={`Kho đã chọn${cart.length > 0 ? ` (${cart.length})` : ''}`} icon="cart-outline" />
      <Card>
        {cart.length === 0 ? <EmptyState icon="grid-outline" title="Chưa chọn ô nào." description="Bấm vào một ô còn trống trên sơ đồ để thêm vào đây." /> : cart.map((l, i) => {
          const seen = viewedContracts.includes(contractKey(lineParams(l)));
          return (
            <View key={l.unitId} style={[st.cartLine, i > 0 && st.lineTop]}>
              <View style={st.cartTop}>
                <View style={st.unitBadge}><Text style={st.unitBadgeText} numberOfLines={1} adjustsFontSizeToFit>{l.unitNumber}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.cartName}>{l.typeName} · ô {l.unitNumber}{l.useAirConditioning ? ' · có điều hòa' : ''}</Text>
                  <Muted>{cartLineText(l.quote, timing)}</Muted>
                </View>
                <Pressable accessibilityLabel="Bỏ ô này" hitSlop={4} style={({ pressed }) => [st.iconBtn, pressed && { opacity: 0.6 }]} onPress={() => setPicked((c) => c.filter((p) => p.unitId !== l.unitId))}>
                  <Ionicons name="close" size={20} color={C.muted} />
                </Pressable>
              </View>
              <Pressable accessibilityLabel={seen ? 'Xem lại hợp đồng' : 'Xem hợp đồng'} style={({ pressed }) => [st.docBtn, !seen && st.docBtnTodo, pressed && { opacity: 0.7 }]} onPress={() => setPreview(lineParams(l))}>
                <Ionicons name={seen ? 'checkmark-circle' : 'document-text-outline'} size={18} color={seen ? C.green : C.amberInk} />
                <Text style={seen ? st.docDoneText : st.docTodoText}>{seen ? 'Hợp đồng · đã xem' : 'Xem hợp đồng'}</Text>
              </Pressable>
            </View>
          );
        })}
        {schedule && <View style={{ marginTop: S.md }}><PaymentSchedule quotes={cart.map((l) => l.quote)} graceDays={detail.policy.gracePeriodDays} timing={timing} earlyTermination={earlyTermination} /></View>}
      </Card>

      {svcList.length > 0 && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.cardHead}>
            <IconTile icon="construct-outline" tone="amber" size="sm" />
            <Text style={st.cardTitle}>Dịch vụ kèm (tuỳ chọn) · kho từ cỡ Vừa</Text>
          </View>
          {svcList.map((sv, i) => {
            const n = svcQty[sv._id] ?? 0;
            return (
              <View key={sv._id} style={[st.svcLine, i > 0 && st.lineTop]}>
                <IconTile icon={serviceIcon(sv.code)} tone="gray" size="sm" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.cartName}>{sv.name}</Text>
                  {sv.description ? <Muted>{sv.description}</Muted> : null}
                  <Text style={st.svcPrice}>{vnd(sv.price)}<Text style={st.svcUnit}> / {sv.unitLabel}</Text></Text>
                </View>
                <View style={st.qtyRow}>
                  <Pressable accessibilityLabel={`Bớt ${sv.name}`} disabled={n === 0} onPress={() => stepSvc(sv._id, -1)} style={[st.qtyBtn, n === 0 && { opacity: 0.4 }]}>
                    <Ionicons name="remove" size={20} color={C.brand700} />
                  </Pressable>
                  <Text style={st.qty}>{n}</Text>
                  <Pressable accessibilityLabel={`Thêm ${sv.name}`} disabled={n >= MAX_SERVICE_QTY} onPress={() => stepSvc(sv._id, 1)} style={st.qtyBtn}>
                    <Ionicons name="add" size={20} color={C.brand700} />
                  </Pressable>
                </View>
              </View>
            );
          })}
          {svcTotal > 0 && <Text style={st.svcDue}>Thanh toán khi nhận kho: {vnd(svcTotal)} (đơn riêng, ngoài hợp đồng thuê)</Text>}
        </Card>
      )}

      <Card style={{ marginTop: S.md }}>
        <View style={st.consult}>
          <IconTile icon="headset-outline" tone="blue" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.cardTitle}>Cần tư vấn trước khi đặt?</Text>
            <Disclosure title="Chi tiết" icon={null}>
              Cần hoá đơn VAT, hợp đồng riêng hoặc xem hợp đồng trước — quản lý chi nhánh sẽ gọi lại. Kho không được giữ trong lúc chờ.
            </Disclosure>
          </View>
        </View>
        <Button title="Yêu cầu tư vấn" variant="secondary" icon="headset-outline" size="sm" style={{ marginTop: S.sm }}
          onPress={() => setConsult({ facilityId: f._id, facilityName: f.name, rentalPeriod: period, periods: periodsNum, unitTypeIds: [...new Set([...picked.map((p) => p.typeId), ...(ut ? [ut._id] : [])])].slice(0, 5) })} />
      </Card>

      <StepHead n={ut ? 5 : 4} title="Xác nhận & thanh toán" icon="shield-checkmark-outline" />
      <Card>
        {schedule && (
          <CheckRow tone="amber" checked={agreePayment} onPress={() => setAckedPayment(agreePayment ? '' : ackKey)} style={{ marginBottom: S.sm }}>
            <Text style={{ fontWeight: '600', color: C.amberInk }}>{paymentAckText(schedule)}</Text>
          </CheckRow>
        )}
        {cart.length > 0 && (
          <CheckRow checked={agreeContract} disabled={!allContractsViewed} onPress={() => setAckedContracts(agreeContract ? '' : cartContractKeys.join(','))}>
            Tôi đã đọc hợp đồng của các kho đã chọn{allContractsViewed ? '.' : ' (bấm “Xem hợp đồng” ở từng kho).'}
          </CheckRow>
        )}
        <CheckRow checked={agreeTerms} onPress={() => setAgreeTerms((v) => !v)}>
          Tôi đã đọc và đồng ý{' '}
          <Text style={st.link} onPress={() => Linking.openURL(`${WEB_ORIGIN}/dieu-khoan`)}>Điều khoản dịch vụ</Text>
          {' '}(bản {TERMS_VERSION}, hiệu lực {TERMS_EFFECTIVE}).
        </CheckRow>
        <CheckRow checked={agreePrivacy} onPress={() => setAgreePrivacy((v) => !v)}>
          Tôi đồng ý cho KhoAn xử lý dữ liệu cá nhân theo{' '}
          <Text style={st.link} onPress={() => Linking.openURL(`${WEB_ORIGIN}/bao-mat`)}>Chính sách bảo mật</Text>
          {' '}(bản {PRIVACY_VERSION}).
        </CheckRow>

        {/* Trả online ngay, giữ ô (tối đa 24 giờ, không quá hết ngày nhận) rồi mang CCCD đến quầy trả tiền và ký hợp đồng giấy (Điều 11), hoặc
            đợt 15 (C1) trả khi nhận kho — hôm nay 0 ₫, giữ ô đến hết ngày nhận; server quyết định có chọn được không (kèm lý do). */}
        <Text style={[st.label, { marginTop: S.md }]}>Cách thanh toán</Text>
        <View style={{ gap: S.sm }}>
          {([
            { value: 'ONLINE', label: 'Thanh toán online ngay', sub: 'VNPay / MoMo / thẻ', icon: 'card-outline', off: false },
            { value: 'COUNTER', label: 'Giữ chỗ, trả tại quầy', sub: `Giữ ô đến ${fmtHoldUntil(holdUntil)}`, icon: 'storefront-outline', off: counterOff },
            { value: 'COD', label: 'Trả khi nhận kho', sub: codAllowed ? `Hôm nay 0 ₫ · giữ ô đến hết ngày ${fmtEndOfDay(codUntil)}` : codReason || (user?.role === 'CUSTOMER' ? 'Chọn 1 kho để kiểm tra' : 'Đăng nhập để chọn'), icon: 'hand-left-outline', off: !codAllowed },
          ] as const).map((o) => {
            const mode: PayMode = codOn ? 'COD' : atCounter ? 'COUNTER' : 'ONLINE';
            return <OptionCard key={o.value} selected={mode === o.value} disabled={o.off} onPress={() => setPayMode(o.value)} icon={o.icon} title={o.label} subtitle={o.sub} />;
          })}
        </View>
        {counterOff && cart.length > 0 && <Muted style={{ marginTop: S.sm } as never}>{counterHeld ? 'Bạn đang có một đặt chỗ trả tại quầy chưa thanh toán.' : cart.length > 1 ? 'Trả tại quầy chỉ áp dụng khi đặt 1 kho.' : `${COUNTER_HOLD_TOO_SHORT_TEXT}.`}</Muted>}
        {atCounter && <Callout tone="violet" icon="storefront-outline" style={{ marginTop: S.sm }}>{PAY_AT_COUNTER_NOTE}</Callout>}
        {codOn && <Callout tone="teal" icon="hand-left-outline" style={{ marginTop: S.sm }}>{COD_NOTE}</Callout>}
      </Card>
      <ContractPreviewModal params={preview} onClose={() => setPreview(null)}
        onViewed={() => { if (!preview) return; const k = contractKey(preview); setViewedContracts((c) => (c.includes(k) ? c : [...c, k])); }} />
      <ConsultationModal ctx={consult} onClose={() => setConsult(null)} />
    </Screen>
  );
}

/** Tiêu đề từng bước của luồng đặt kho: số thứ tự + tên bước. */
function StepHead({ n, title, icon }: { n: number; title: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={st.stepHead}>
      <View style={st.stepNum}><Text style={st.stepNumText}>{n}</Text></View>
      <Text style={st.stepTitle} numberOfLines={2}>{title}</Text>
      <Ionicons name={icon} size={18} color={C.faint} />
    </View>
  );
}

const st = StyleSheet.create({
  introLink: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: TOUCH, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.brand50, borderWidth: 1, borderColor: C.brand100, marginTop: -S.xs },
  introLinkText: { flex: 1, fontSize: 14, fontWeight: '700', color: C.brand800 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.xl, marginBottom: S.md },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: C.white, fontSize: 13, fontWeight: '800' },
  stepTitle: { ...T.h3, fontSize: 16, flex: 1 },
  block: { marginTop: S.lg },
  label: { fontSize: 13, fontWeight: '600', color: C.sub, marginBottom: S.sm },
  acRow: { marginTop: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.blueBg, minHeight: 56 },
  acText: { flex: 1, fontSize: 14, fontWeight: '600', color: C.ink },
  typeCard: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1.5, borderColor: C.line, padding: S.md, ...SHADOW.card },
  typeCardSelected: { borderColor: C.brand600, backgroundColor: C.brand50 },
  typeCardFull: { opacity: 0.55 },
  typeTop: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  typeThumb: { width: 72, height: 60, borderRadius: R.md, backgroundColor: C.brand50, borderWidth: 1, borderColor: C.lineSoft, padding: 4 },
  typeThumbSelected: { borderColor: C.brand700 },
  typeThumbImg: { width: '100%', height: '100%' },
  typeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs, marginTop: S.md },
  typeName: { fontSize: 15, fontWeight: '700', color: C.ink },
  typePrice: { fontSize: 16, fontWeight: '800', color: C.ink, ...T.tabular },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.ink, flexShrink: 1 },
  cartLine: { paddingVertical: S.sm, gap: S.sm },
  lineTop: { borderTopWidth: 1, borderTopColor: C.lineSoft, marginTop: S.xs, paddingTop: S.md },
  cartTop: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  unitBadge: { minWidth: 44, height: 44, paddingHorizontal: 4, borderRadius: R.md, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  unitBadgeText: { color: C.white, fontSize: 12, fontWeight: '800' },
  cartName: { fontSize: 14, fontWeight: '700', color: C.ink },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.fill, marginTop: -4 },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: TOUCH, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenLine, marginLeft: 56 },
  docBtnTodo: { backgroundColor: C.amberBg, borderColor: '#fcd34d' },
  docTodoText: { color: C.amberInk, fontWeight: '700', fontSize: 14 },
  docDoneText: { color: C.green, fontWeight: '700', fontSize: 14 },
  link: { color: C.brand700, fontWeight: '700', textDecorationLine: 'underline' },
  svcLine: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  svcPrice: { marginTop: 2, fontSize: 13, fontWeight: '700', color: C.brand700 },
  svcUnit: { fontSize: 12, fontWeight: '400', color: C.muted },
  svcDue: { marginTop: S.sm, fontSize: 13, fontWeight: '700', color: C.ink, backgroundColor: C.fill, borderRadius: R.md, padding: S.md },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.fill, borderRadius: R.full, padding: 2 },
  qtyBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  qty: { minWidth: 24, textAlign: 'center', fontSize: 15, fontWeight: '800', color: C.ink, ...T.tabular },
  consult: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  footAmount: { fontSize: 18, fontWeight: '800', color: C.ink, ...T.tabular },
});
