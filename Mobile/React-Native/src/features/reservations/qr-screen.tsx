import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Brightness from 'expo-brightness';
import QRCode from 'react-native-qrcode-svg';
import { RESERVATION_STATUS, dueAtCheckIn, fmtDate, fmtDateTime, vnd } from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { actions } from '../../shared/api/actions';
import { Button, Card, KV, Muted, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

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
      <View style={st.center}>
        <Muted>Không tìm thấy đặt chỗ này.</Muted>
        <Button title="Đóng" variant="secondary" style={{ marginTop: S.lg }} onPress={() => router.back()} />
      </View>
    );
  }

  return (
    // Cuộn được: thêm nút ký / chi tiết đặt chỗ thì máy màn hình thấp không bị khuất nút "Cấp mã mới".
    <ScrollView style={st.scroll} contentContainerStyle={st.screen}>
      <Pressable style={st.close} onPress={() => router.back()} hitSlop={12}>
        <Ionicons name="close" size={26} color={C.muted} />
      </Pressable>

      <View style={st.head}>
        <Text style={st.title}>Mã nhận kho</Text>
        <StatusBadge map={RESERVATION_STATUS} value={r.status} />
      </View>
      <Muted style={{ textAlign: 'center', marginTop: 4 } as never}>Đưa màn hình này cho nhân viên tại quầy</Muted>
      {!r.signature && <Text style={st.unsigned}>Bạn chưa ký hợp đồng — hãy ký ở màn Đặt chỗ trước khi nhận kho.</Text>}
      {/* Màn này mở dạng modal từ trang chủ hoặc từ màn Đặt chỗ: dismissTo quay về màn Đặt chỗ nếu nó nằm ngay dưới, không thì thay modal
          bằng màn Đặt chỗ — không chồng thêm một bản nữa. */}
      {!r.signature && (r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && (
        <Button title="Ký hợp đồng ở màn Đặt chỗ" icon="create-outline" style={{ marginTop: S.md }} onPress={() => router.dismissTo(`/booking/${r._id}`)} />
      )}

      <View style={st.qrBox}>
        {loading ? (
          <View style={st.qrPlaceholder}><ActivityIndicator color={C.brand700} /></View>
        ) : error ? (
          <View style={st.qrPlaceholder}>
            <Ionicons name="warning-outline" size={28} color={C.amber} />
            <Text style={st.errText}>{error}</Text>
          </View>
        ) : payload ? (
          <QRCode value={payload} size={240} backgroundColor="#fff" color={C.ink} />
        ) : null}
      </View>

      {/* Phương án dự phòng: nhân viên gõ tay mã này vào webapp */}
      <View style={st.codeBox}>
        <Muted>Hoặc đọc mã cho nhân viên nhập tay</Muted>
        <Text style={st.code} selectable>{r.code}</Text>
      </View>

      <Card style={{ marginTop: S.lg }}>
        <KV items={[
          ['Chi nhánh', facilityName(db, r.facilityId)],
          ['Loại kho', typeName(db, r.unitTypeId)],
          ['Kho được phân', r.unitId ? unitLabel(db, r.unitId) : 'Chưa phân'],
          ['Ngày nhận', fmtDate(r.startDate)],
          ['Trả thêm khi nhận kho', dueAtCheckIn(r.quote) > 0 ? vnd(dueAtCheckIn(r.quote)) : 'Không — đã trả đủ khi đặt'],
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
      <Muted style={{ textAlign: 'center', marginTop: S.sm } as never}>
        Mỗi lần cấp mã mới, mã hiện trên ảnh chụp màn hình trước đó sẽ không dùng được nữa.
      </Muted>
      {r.signature && (
        <Button title="Chi tiết đặt chỗ" variant="ghost" icon="document-text-outline" style={{ marginTop: S.xs }} onPress={() => router.dismissTo(`/booking/${r._id}`)} />
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  screen: { flexGrow: 1, padding: S.lg, paddingTop: S.xxl, paddingBottom: S.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: S.lg },
  close: { position: 'absolute', top: S.lg, right: S.lg, zIndex: 1, padding: S.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.md, marginTop: S.sm },
  title: { fontSize: 20, fontWeight: '700', color: C.ink },
  qrBox: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.xl, marginTop: S.xl },
  qrPlaceholder: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center', gap: S.sm },
  unsigned: { fontSize: 13, color: C.amber, textAlign: 'center', marginTop: S.sm, fontWeight: '600' },
  errText: { fontSize: 13, color: C.amber, textAlign: 'center', paddingHorizontal: S.md },
  codeBox: { alignItems: 'center', marginTop: S.lg, gap: 2 },
  code: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 2 },
});
