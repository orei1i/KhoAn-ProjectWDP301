import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Facility, PriceQuote, UnitType } from '@ssm/shared';
import {
  FACILITY_STATUS, INTRO_FAQ, INTRO_HIGHLIGHTS, INTRO_STEPS, PHOTO_CREDIT, UNIT_CATEGORY, UNIT_CATEGORY_GUIDE, periodLabel, vnd,
  type IntroIcon,
} from '@ssm/shared';
import { api } from '../../shared/api/client';
import { Button, Callout, Card, Chip, EmptyState, IconTile, PhotoBanner, Screen, ScreenHeader, ScreenSkeleton, SectionHeader, StatusBadge } from '../../shared/ui';
import { C, R, S, SHADOW, T } from '../../shared/ui/theme';
import { amenityIcon, availabilityTone, categoryIcon, PHOTO_SOURCES, PHOTOS } from '../../shared/ui/visuals';

type TypeRow = UnitType & { quote: PriceQuote; availability: { total: number; free: number; available: number } };
interface Detail { facility: Facility; unitTypes: TypeRow[] }

const ICONS: Partial<Record<IntroIcon, keyof typeof Ionicons.glyphMap>> = {
  key: 'key-outline', snow: 'snow-outline', contract: 'document-text-outline', calendar: 'calendar-outline', swap: 'swap-horizontal-outline',
};
const HIGHLIGHTS = INTRO_HIGHLIGHTS.filter((h) => ICONS[h.icon]);
/** Tiện ích chi nhánh tự khai — bỏ mục camera. */
const isCameraAmenity = (a: string) => /camera/i.test(a);

/**
 * Màn GIỚI THIỆU KHO: hình ảnh, tiện ích, từng cỡ kho vừa với gì, quy trình, câu hỏi thường gặp — khách xem xét trước
 * rồi mới sang màn chọn ô & đặt kho. Nội dung tĩnh dùng chung với web (@ssm/shared), số liệu lấy từ API công khai.
 */
export default function FacilityIntroScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<Detail>(`/facilities/public/${id}?period=MONTH&periods=1&ac=false`)
      .then((d) => { if (alive) { setDetail(d); setError(''); } })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  if (error) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" tone="red" title="Không tải được chi nhánh" description={error} action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  if (!detail) {
    return <Screen><ScreenSkeleton rows={2} /></Screen>;
  }

  const { facility: f, unitTypes: types } = detail;
  const bookable = f.status === 'ACTIVE';
  const address = `${f.address.line1}, ${f.address.district}, ${f.address.city}`;
  const book = () => router.push(`/facility/${f._id}`);
  const amenities = f.amenities.filter((a) => !isCameraAmenity(a));

  return (
    <Screen footer={bookable ? <Button title="Xem chỗ trống & đặt kho" iconRight="arrow-forward" size="lg" onPress={book} /> : undefined}>
      <ScreenHeader title={f.name} subtitle={`${f.address.district}, ${f.address.city}`} right={<StatusBadge map={FACILITY_STATUS} value={f.status} />} />

      {/* ---- ảnh: vuốt ngang */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={PHOTO_W + S.sm} decelerationRate="fast"
        contentContainerStyle={{ gap: S.sm }} style={{ marginHorizontal: -S.lg }}>
        <View style={{ width: S.lg - S.sm }} />
        {PHOTOS.map((p, i) => (
          <PhotoBanner key={p.key} source={PHOTO_SOURCES[p.key]} height={210} radius={R.xl} style={{ width: PHOTO_W }} accessibilityLabel={p.caption}
            topLeft={<View style={st.counter}><Ionicons name="images-outline" size={12} color={C.white} /><Text style={st.counterText}>{i + 1}/{PHOTOS.length}</Text></View>}>
            <Text style={st.caption} numberOfLines={2}>{p.caption}</Text>
          </PhotoBanner>
        ))}
        <View style={{ width: S.lg - S.sm }} />
      </ScrollView>
      <Text style={st.credit}>{PHOTO_CREDIT}</Text>

      <Card style={{ marginTop: S.md }}>
        <Text style={st.lead}>
          Kho tự quản: bạn tự khoá, tự ra vào ô kho của mình trong giờ hoạt động. Có {types.length} cỡ kho.
        </Text>
        <View style={{ gap: S.md }}>
          <InfoLine icon="location-outline" text={address} />
          <InfoLine icon="time-outline" text={`Ra vào kho ${f.accessHours?.open ?? '06:00'}–${f.accessHours?.close ?? '22:00'} mỗi ngày`} />
          <InfoLine icon="call-outline" text={f.contact.phone} />
        </View>
        {amenities.length > 0 && <View style={st.badges}>{amenities.map((a) => <Chip key={a} tone="teal" icon={amenityIcon(a)}>{a}</Chip>)}</View>}
        <Button title="Chỉ đường" icon="navigate-outline" variant="secondary" style={{ marginTop: S.lg }}
          onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`)} />
      </Card>

      {!bookable && <Callout tone="amber" icon="pause-circle-outline" title="Chi nhánh chưa nhận đặt chỗ" style={{ marginTop: S.md }} />}

      <SectionHeader title="Vì sao gửi đồ ở đây" icon="sparkles-outline" />
      <Card>
        {HIGHLIGHTS.map((h, i) => (
          <View key={h.title} style={[st.highlight, i > 0 && st.divider]}>
            <IconTile icon={ICONS[h.icon] ?? 'checkmark-outline'} />
            <View style={{ flex: 1 }}>
              <Text style={st.itemTitle}>{h.title}</Text>
              <Text style={T.small}>{h.text}</Text>
            </View>
          </View>
        ))}
      </Card>

      <SectionHeader title="Các cỡ kho — cỡ nào vừa với bạn?" icon="resize-outline" count={types.length} />
      <View style={{ gap: S.lg }}>
        {types.map((t) => {
          const g = UNIT_CATEGORY_GUIDE[t.category];
          const a = t.availability.available;
          return (
            <View key={t._id} style={st.typeCard}>
              <PhotoBanner source={PHOTO_SOURCES[g.photo]} height={150} accessibilityLabel={`Minh hoạ ${t.name}`}
                topLeft={<Chip tone="teal" icon={categoryIcon(t.category)}>{UNIT_CATEGORY[t.category]}</Chip>}
                topRight={bookable ? <Chip tone={availabilityTone(a)} dot>{a === 0 ? 'Hết chỗ' : `Còn ${a} ô trống`}</Chip> : undefined}>
                <Text style={st.typeName}>{t.name}</Text>
              </PhotoBanner>
              <View style={{ padding: S.lg }}>
                <View style={st.badges0}>
                  <Chip icon="resize-outline">{t.dimensions.widthM} × {t.dimensions.depthM} × {t.dimensions.heightM} m</Chip>
                  <Chip icon="grid-outline">{t.areaM2} m²</Chip>
                  <Chip tone="teal" icon="pricetag-outline">Từ {vnd(t.rates.MONTH)}/tháng</Chip>
                </View>
                <View style={st.fitsBox}>
                  <Text style={st.fits}>Vừa với: {g.fits}</Text>
                  {g.examples.map((x) => (
                    <View key={x} style={st.example}>
                      <Ionicons name="checkmark-circle" size={15} color={C.brand500} />
                      <Text style={T.small}>{x}</Text>
                    </View>
                  ))}
                </View>
                {t.quote.firstPeriodAtBooking && (
                  <Callout tone="amber" icon="information-circle-outline" style={{ marginTop: S.md }}>
                    Kho cỡ lớn: giữ chân {periodLabel('MONTH', t.quote.depositPeriods ?? 1)} tiền thuê + trả tiền thuê tháng đầu ngay khi đặt.
                  </Callout>
                )}
              </View>
            </View>
          );
        })}
      </View>

      <SectionHeader title="Thuê kho như thế nào" icon="footsteps-outline" />
      <Card>
        {INTRO_STEPS.map((s, i) => (
          <View key={s.title} style={st.step}>
            <View style={st.stepRail}>
              <View style={st.stepDot}><Text style={st.stepNum}>{i + 1}</Text></View>
              {i < INTRO_STEPS.length - 1 && <View style={st.stepLine} />}
            </View>
            <View style={{ flex: 1, paddingBottom: i < INTRO_STEPS.length - 1 ? S.lg : 0 }}>
              <Text style={st.itemTitle}>{s.title}</Text>
              <Text style={T.small}>{s.text}</Text>
            </View>
          </View>
        ))}
      </Card>

      <SectionHeader title="Câu hỏi thường gặp" icon="help-circle-outline" />
      <Card style={{ paddingVertical: S.xs }}>
        {INTRO_FAQ.map((x, i) => {
          const open = openFaq === i;
          return (
            <View key={x.q} style={i > 0 && st.divider}>
              <Pressable onPress={() => setOpenFaq(open ? null : i)} accessibilityRole="button" accessibilityState={{ expanded: open }}
                style={({ pressed }) => [st.faqHead, pressed && { opacity: 0.7 }]}>
                <Text style={[st.itemTitle, { flex: 1 }]}>{x.q}</Text>
                <View style={[st.faqIcon, open && { backgroundColor: C.brand50 }]}>
                  <Ionicons name={open ? 'remove' : 'add'} size={16} color={open ? C.brand700 : C.muted} />
                </View>
              </Pressable>
              {open && <Text style={[T.small, { paddingBottom: S.md }]}>{x.a}</Text>}
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

function InfoLine({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={st.infoRow}>
      <IconTile icon={icon} tone="gray" size="sm" />
      <Text style={st.infoText}>{text}</Text>
    </View>
  );
}

const PHOTO_W = 288;
const st = StyleSheet.create({
  counter: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(22,32,30,0.55)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.full },
  counterText: { color: C.white, fontSize: 11, fontWeight: '700' },
  caption: { color: C.white, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  credit: { fontSize: 11, color: C.faint, marginTop: S.sm },
  lead: { ...T.body, marginBottom: S.lg },
  infoRow: { flexDirection: 'row', gap: S.md, alignItems: 'center' },
  infoText: { flex: 1, fontSize: 14, color: C.text, lineHeight: 20 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.lg },
  badges0: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  highlight: { flexDirection: 'row', gap: S.md, alignItems: 'flex-start', paddingVertical: S.md },
  divider: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  itemTitle: { fontSize: 15, fontWeight: '700', color: C.ink, lineHeight: 21 },
  typeCard: { backgroundColor: C.card, borderRadius: R.xl, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...SHADOW.card },
  typeName: { fontSize: 19, fontWeight: '800', color: C.white, letterSpacing: -0.2 },
  fitsBox: { marginTop: S.md, backgroundColor: C.bg, borderRadius: R.md, padding: S.md, gap: 6 },
  fits: { fontSize: 14, fontWeight: '700', color: C.ink },
  example: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: { flexDirection: 'row', gap: S.md },
  stepRail: { alignItems: 'center', width: 28 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' },
  stepNum: { color: C.white, fontSize: 13, fontWeight: '800' },
  stepLine: { flex: 1, width: 2, backgroundColor: C.brand100, marginTop: 4 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: 52, paddingVertical: S.sm },
  faqIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
});
