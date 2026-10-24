import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Facility, PriceQuote, UnitType } from '@ssm/shared';
import {
  FACILITY_PHOTOS, FACILITY_STATUS, INTRO_FAQ, INTRO_HIGHLIGHTS, INTRO_STEPS, PHOTO_CREDIT, UNIT_CATEGORY, UNIT_CATEGORY_GUIDE, periodLabel, vnd,
  type FacilityPhotoKey, type IntroIcon,
} from '@ssm/shared';
import { api } from '../../shared/api/client';
import { Badge, Button, Card, EmptyState, Muted, Screen, ScreenHeader, Skeleton, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

type TypeRow = UnitType & { quote: PriceQuote; availability: { total: number; free: number; available: number } };
interface Detail { facility: Facility; unitTypes: TypeRow[] }

// Ảnh đóng gói sẵn trong app (require tĩnh) — xem được cả khi mạng yếu. Cùng bộ ảnh với Webapp/public/images/kho.
// Không giới thiệu camera an ninh: ảnh / mục nào không có trong bảng dưới thì không hiện.
const PHOTO_SOURCES: Partial<Record<FacilityPhotoKey, ImageSourcePropType>> = {
  'kho-drive-up': require('../../../assets/kho/kho-drive-up.jpg'),
  'mat-tien-cua-cuon': require('../../../assets/kho/mat-tien-cua-cuon.jpg'),
  'hanh-lang-kho': require('../../../assets/kho/hanh-lang-kho.jpg'),
  'cua-o-kho': require('../../../assets/kho/cua-o-kho.jpg'),
  'ben-trong-kho': require('../../../assets/kho/ben-trong-kho.jpg'),
  'tu-locker': require('../../../assets/kho/tu-locker.jpg'),
};
const ICONS: Partial<Record<IntroIcon, keyof typeof Ionicons.glyphMap>> = {
  key: 'key-outline', snow: 'snow-outline', contract: 'document-text-outline', calendar: 'calendar-outline', swap: 'swap-horizontal-outline',
};
const PHOTOS = FACILITY_PHOTOS.filter((p) => PHOTO_SOURCES[p.key]);
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
        <EmptyState icon="alert-circle-outline" title="Không tải được chi nhánh" description={error} action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  if (!detail) {
    return <Screen><View style={{ gap: S.md }}><Skeleton h={28} w="60%" /><Skeleton h={200} /><Skeleton h={120} /></View></Screen>;
  }

  const { facility: f, unitTypes: types } = detail;
  const bookable = f.status === 'ACTIVE';
  const address = `${f.address.line1}, ${f.address.district}, ${f.address.city}`;
  const book = () => router.push(`/facility/${f._id}`);
  const amenities = f.amenities.filter((a) => !isCameraAmenity(a));

  return (
    <Screen>
      <ScreenHeader title={f.name} subtitle={`${f.address.district}, ${f.address.city}`} right={<StatusBadge map={FACILITY_STATUS} value={f.status} />} />

      {/* ---- ảnh: vuốt ngang */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={PHOTO_W + S.sm} decelerationRate="fast" contentContainerStyle={{ gap: S.sm }}>
        {PHOTOS.map((p) => (
          <View key={p.key} style={{ width: PHOTO_W }}>
            <Image source={PHOTO_SOURCES[p.key]} style={st.photo} resizeMode="cover" accessibilityLabel={p.caption} />
            <Muted style={{ marginTop: 6 } as never}>{p.caption}</Muted>
          </View>
        ))}
      </ScrollView>
      <Text style={st.credit}>{PHOTO_CREDIT}</Text>

      <Card style={{ marginTop: S.md }}>
        <Text style={st.lead}>
          Kho tự quản: bạn tự khoá, tự ra vào ô kho của mình trong giờ hoạt động. Có {types.length} cỡ kho.
        </Text>
        <View style={st.infoRow}><Ionicons name="location-outline" size={16} color={C.muted} /><Text style={st.infoText}>{address}</Text></View>
        <View style={st.infoRow}><Ionicons name="time-outline" size={16} color={C.muted} /><Text style={st.infoText}>Ra vào kho {f.accessHours?.open ?? '06:00'}–{f.accessHours?.close ?? '22:00'} mỗi ngày</Text></View>
        <View style={st.infoRow}><Ionicons name="call-outline" size={16} color={C.muted} /><Text style={st.infoText}>{f.contact.phone}</Text></View>
        {amenities.length > 0 && <View style={st.badges}>{amenities.map((a) => <Badge key={a}>{a}</Badge>)}</View>}
        <Button title="Chỉ đường" icon="navigate-outline" variant="secondary" style={{ marginTop: S.md }}
          onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`)} />
      </Card>

      {bookable
        ? <Button title="Xem chỗ trống & đặt kho" icon="arrow-forward" style={{ marginTop: S.md }} onPress={book} />
        : <Card style={{ marginTop: S.md, backgroundColor: C.amberBg }}><Text style={{ color: C.amber, fontWeight: '600' }}>Chi nhánh chưa nhận đặt chỗ</Text></Card>}

      <Text style={st.section}>Vì sao gửi đồ ở đây</Text>
      <Card>
        {HIGHLIGHTS.map((h, i) => (
          <View key={h.title} style={[st.highlight, i > 0 && st.divider]}>
            <View style={st.iconBox}><Ionicons name={ICONS[h.icon] ?? 'checkmark-outline'} size={18} color={C.brand700} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.itemTitle}>{h.title}</Text>
              <Muted>{h.text}</Muted>
            </View>
          </View>
        ))}
      </Card>

      <Text style={st.section}>Các cỡ kho — cỡ nào vừa với bạn?</Text>
      <View style={{ gap: S.md }}>
        {types.map((t) => {
          const g = UNIT_CATEGORY_GUIDE[t.category];
          const a = t.availability.available;
          return (
            <Card key={t._id} style={{ padding: 0, overflow: 'hidden' }}>
              <Image source={PHOTO_SOURCES[g.photo]} style={st.typePhoto} resizeMode="cover" accessibilityLabel={`Minh hoạ ${t.name}`} />
              <View style={{ padding: S.md }}>
                <View style={st.rowBetween}>
                  <Text style={st.typeName}>{t.name}</Text>
                  <Badge>{UNIT_CATEGORY[t.category]}</Badge>
                </View>
                <Muted>{t.dimensions.widthM} × {t.dimensions.depthM} × {t.dimensions.heightM} m · {t.areaM2} m²</Muted>
                <Text style={st.fits}>Vừa với: {g.fits}</Text>
                {g.examples.map((x) => <Muted key={x}>• {x}</Muted>)}
                {t.quote.firstPeriodAtBooking && (
                  <Text style={st.largeNote}>Kho cỡ lớn: giữ chân {periodLabel('MONTH', t.quote.depositPeriods ?? 1)} tiền thuê + trả tiền thuê tháng đầu ngay khi đặt.</Text>
                )}
                <View style={[st.rowBetween, { marginTop: S.sm }]}>
                  <Text style={st.price}>Từ {vnd(t.rates.MONTH)}/tháng</Text>
                  {bookable && <Text style={{ fontSize: 12, fontWeight: '600', color: a === 0 ? C.red : a <= 2 ? C.amber : C.green }}>{a === 0 ? 'Hết chỗ' : `Còn ${a} ô trống`}</Text>}
                </View>
              </View>
            </Card>
          );
        })}
      </View>

      <Text style={st.section}>Thuê kho như thế nào</Text>
      <Card>
        {INTRO_STEPS.map((s, i) => (
          <View key={s.title} style={[st.highlight, i > 0 && st.divider]}>
            <View style={st.stepDot}><Text style={st.stepNum}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={st.itemTitle}>{s.title}</Text>
              <Muted>{s.text}</Muted>
            </View>
          </View>
        ))}
      </Card>

      <Text style={st.section}>Câu hỏi thường gặp</Text>
      <Card>
        {INTRO_FAQ.map((x, i) => {
          const open = openFaq === i;
          return (
            <Pressable key={x.q} onPress={() => setOpenFaq(open ? null : i)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={[{ paddingVertical: S.sm }, i > 0 && st.divider]}>
              <View style={st.rowBetween}>
                <Text style={[st.itemTitle, { flex: 1 }]}>{x.q}</Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
              </View>
              {open && <Muted style={{ marginTop: 6 } as never}>{x.a}</Muted>}
            </Pressable>
          );
        })}
      </Card>

      {bookable && <Button title="Xem chỗ trống & đặt kho" icon="arrow-forward" style={{ marginTop: S.lg }} onPress={book} />}
    </Screen>
  );
}

const PHOTO_W = 280;
const st = StyleSheet.create({
  photo: { width: PHOTO_W, height: 190, borderRadius: R.lg, backgroundColor: C.fill },
  credit: { fontSize: 11, color: C.faint, marginTop: S.sm },
  lead: { fontSize: 14, lineHeight: 21, color: C.text, marginBottom: S.sm },
  infoRow: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', marginTop: 6 },
  infoText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs, marginTop: S.sm },
  section: { fontSize: 12, fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: S.lg, marginBottom: S.sm },
  highlight: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', paddingVertical: S.sm },
  divider: { borderTopWidth: 1, borderTopColor: C.line },
  iconBox: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.brand50, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  stepNum: { color: '#fff', fontSize: 12, fontWeight: '800' },
  typePhoto: { width: '100%', height: 150, backgroundColor: C.fill },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  typeName: { fontSize: 16, fontWeight: '700', color: C.ink },
  fits: { fontSize: 13, fontWeight: '600', color: C.text, marginTop: S.sm },
  largeNote: { fontSize: 12, lineHeight: 17, color: '#78350f', backgroundColor: C.amberBg, borderRadius: R.md, padding: S.sm, marginTop: S.sm },
  price: { fontSize: 14, fontWeight: '700', color: C.brand800 },
});
