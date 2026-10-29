import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Brightness from 'expo-brightness';
import QRCode from 'react-native-qrcode-svg';
import { RESERVATION_STATUS, SIGNING_PREFERENCE, signingPreferenceOf, bookingServicesDue, dueAtCheckIn, fmtDate, fmtDateTime, vnd } from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { actions } from '../../shared/api/actions';
import { Button, Callout, Card, Chip, EmptyState, KV, StatusBadge } from '../../shared/ui';
import { C, MONO, R, S, SHADOW, T, TOUCH } from '../../shared/ui/theme';

/**
 * Màn hình đưa mã cho nhân viên.
 *
 * Ba điểm cố ý:
 *
 *  1. Mã được XIN MỚI mỗi lần mở màn hình. payDeposit chỉ trả payload đúng một lần rồi server giữ
 *     lại hash, nên không có cách nào "đọc lại" mã cũ — và cũng không nên: mỗi lần cấp mới sẽ vô
 *     hiệu hoá mã trước đó, nên ảnh chụp màn hình lọt ra ngoài cũng vô dụng.
 *  2. Kéo sáng màn hình lên tối đa rồi trả lại lúc thoát. Màn hình tối là lý do phổ biến nhất khiến
 *     máy quét không đọc được QR.
 *  3. Luôn hiện mã chữ to bên dưới. Camera hỏng, màn hình vỡ, hay app treo thì nhân viên vẫn gõ tay
 *     được mã này vào webapp — BE nhận cả hai dạng.
 */
export default function QrScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, toast } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [payload, setPayload] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const prevBrightness = useRef<number | null>(null);

  const r = byId(db.reservations, id);

  const issue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await actions.reissueQr({ reservationId: id });
      setPayload(res.qrPayload);
      setExpiresAt(res.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lấy được mã');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void issue(); }, [issue]);

  // Sáng tối đa khi mở, trả lại độ sáng cũ khi thoát.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cur = await Brightness.getBrightnessAsync();
        if (!alive) return;
        prevBrightness.current = cur;
        await Brightness.setBrightnessAsync(1);
      } catch { /* máy không cho đổi độ sáng thì thôi, không phải lỗi chặn */ }
    })();
    return () => {
      alive = false;
      if (prevBrightness.current !== null) Brightness.setBrightnessAsync(prevBrightness.current).catch(() => {});
    };
  }, []);

  if (!r) {
    return (
      <View style={[st.center, { paddingTop: insets.top }]}>
        <EmptyState icon="qr-code-outline" tone="gray" title="Không tìm thấy đặt chỗ này."
          action={<Button title="Đóng" variant="secondary" onPress={() => router.back()} />} />
      </View>
    );
  }

  // Trả thêm khi nhận kho = tiền thuê kỳ đầu (nếu chưa trả) + dịch vụ chọn kèm lúc đặt.
  const dueAtDesk = dueAtCheckIn(r.quote) + bookingServicesDue(db.serviceOrders, r._id);
  // iOS mở màn này dạng sheet (đã nằm dưới thanh trạng thái); Android / web mở toàn màn hình nên chừa vùng an toàn trên.
  const topPad = Platform.OS === 'ios' ? S.lg : insets.top + S.md;

  return (
    // Cuộn được: thêm nút ký / chi tiết đặt chỗ thì máy màn hình thấp không bị khuất nút "Cấp mã mới".
    <ScrollView style={st.scroll} contentContainerStyle={[st.screen, { paddingTop: topPad, paddingBottom: insets.bottom + S.xxl }]}>
      {Platform.OS === 'android' && <StatusBar style="light" />}
      <View style={st.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Mã nhận kho</Text>
          <Text style={st.sub}>Đưa màn hình này cho nhân viên tại quầy</Text>
        </View>
        <Pressable style={({ pressed }) => [st.close, pressed && { opacity: 0.6 }]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Đóng">
          <Ionicons name="close" size={22} color={C.white} />
        </Pressable>
      </View>

      <View style={st.ticket}>
        <View style={st.ticketHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.ticketTitle} numberOfLines={1}>{typeName(db, r.unitTypeId)}</Text>
            <Text style={T.caption} numberOfLines={1}>{facilityName(db, r.facilityId)} · nhận {fmtDate(r.startDate)}</Text>
          </View>
          <StatusBadge map={RESERVATION_STATUS} value={r.status} />
        </View>

        <View style={st.qrBox}>
          {loading ? (
            <View style={st.qrPlaceholder}><ActivityIndicator color={C.brand700} size="large" /></View>
          ) : error ? (
            <View style={st.qrPlaceholder}>
              <Ionicons name="warning-outline" size={32} color={C.amber} />
              <Text style={st.errText}>{error}</Text>
            </View>
          ) : payload ? (
            <QRCode value={payload} size={232} backgroundColor="#fff" color={C.ink} />
          ) : null}
        </View>

        {/* Đường răng cưa giữa phần QR và phần mã chữ — như cuống vé. */}
        <View style={st.perf}>
          <View style={[st.notch, { left: -12 }]} />
          <View style={st.dash} />
          <View style={[st.notch, { right: -12 }]} />
        </View>

        {/* Phương án dự phòng: nhân viên gõ tay mã này vào webapp */}
        <View style={st.codeBox}>
          <Text style={T.caption}>Hoặc đọc mã cho nhân viên nhập tay</Text>
          <Text style={st.code} selectable>{r.code}</Text>
          {expiresAt ? <Chip tone="gray" icon="time-outline" size="sm">Mã hết hạn {fmtDateTime(expiresAt)}</Chip> : null}
        </View>
      </View>

      {!r.signature && (signingPreferenceOf(r) === 'PAPER_AT_COUNTER'
        ? <Callout tone="violet" icon="document-text-outline" style={{ marginTop: S.lg }}>{SIGNING_PREFERENCE.PAPER_AT_COUNTER.note}</Callout>
        : <Callout tone="amber" icon="create-outline" style={{ marginTop: S.lg }}>Chưa ký hợp đồng — phải ký trước khi nhận kho.</Callout>)}
      {/* Màn này mở dạng modal từ trang chủ hoặc từ màn Đặt chỗ: dismissTo quay về màn Đặt chỗ nếu nó nằm ngay dưới, không thì thay modal
          bằng màn Đặt chỗ — không chồng thêm một bản nữa. */}
      {!r.signature && signingPreferenceOf(r) !== 'PAPER_AT_COUNTER' && (r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && (
        <Button title="Ký hợp đồng ở màn Đặt chỗ" icon="create-outline" style={{ marginTop: S.md }} onPress={() => router.dismissTo(`/booking/${r._id}`)} />
      )}

      <Card style={{ marginTop: S.lg }}>
        <KV items={[
          ['Chi nhánh', facilityName(db, r.facilityId)],
          ['Loại kho', typeName(db, r.unitTypeId)],
          ['Kho được phân', r.unitId ? unitLabel(db, r.unitId) : 'Chưa phân'],
          ['Ngày nhận', fmtDate(r.startDate)],
          ['Trả thêm khi nhận kho', dueAtDesk > 0 ? vnd(dueAtDesk) : 'Không — đã trả đủ khi đặt'],
          ...(expiresAt ? ([['Mã hết hạn', fmtDateTime(expiresAt)]] as [string, string][]) : []),
        ]} />
      </Card>

      <Button
        title="Cấp mã mới"
        variant="secondary"
        icon="refresh-outline"
        style={{ marginTop: S.md }}
        loading={loading}
        onPress={() => { void issue(); toast('Mã cũ đã hết hiệu lực', 'info'); }}
      />
      {r.signature && (
        <Button title="Chi tiết đặt chỗ" variant="ghost" icon="document-text-outline" style={{ marginTop: S.xs }} onPress={() => router.dismissTo(`/booking/${r._id}`)} />
      )}
    </ScrollView>
  );
}

/** Nền tối của header kéo dài lên trên phần nội dung — kéo giãn (bounce) ở đầu trang không lộ khoảng trắng. */
const OVERSCROLL = 400;
const st = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  screen: { flexGrow: 1, paddingHorizontal: S.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: S.lg },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.brand900, marginHorizontal: -S.lg, marginTop: -OVERSCROLL, paddingTop: OVERSCROLL, paddingHorizontal: S.lg, paddingBottom: 72 },
  title: { fontSize: 22, fontWeight: '800', color: C.white, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: C.brand200, marginTop: 2 },
  close: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  ticket: { backgroundColor: C.card, borderRadius: R.xl, marginTop: -56, ...SHADOW.lift },
  ticketHead: { flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.lg, paddingBottom: 0 },
  ticketTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  qrBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: S.lg },
  qrPlaceholder: { width: 232, height: 232, alignItems: 'center', justifyContent: 'center', gap: S.sm, backgroundColor: C.fill, borderRadius: R.md },
  perf: { height: 24, justifyContent: 'center' },
  notch: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: C.bg },
  dash: { marginHorizontal: S.lg, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: C.line },
  codeBox: { alignItems: 'center', paddingTop: S.sm, paddingBottom: S.lg, gap: 6 },
  code: { fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: 3, fontFamily: MONO },
  errText: { fontSize: 13, color: C.amber, textAlign: 'center', paddingHorizontal: S.md },
});
