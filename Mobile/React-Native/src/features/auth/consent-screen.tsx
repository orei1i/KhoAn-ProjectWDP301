import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LEGAL_CHANGE_SUMMARY, PRIVACY_VERSION, TERMS_VERSION } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Button, Card, Muted, Screen, ScreenHeader } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';

/**
 * Màn bắt buộc khi Điều khoản / Chính sách bảo mật đổi phiên bản mà khách chưa đồng ý bản mới (`user.consentRequired` do server tính):
 * xem tóm tắt thay đổi, mở đọc bản đầy đủ trên web, tick đồng ý rồi mới dùng tiếp app (POST /auth/me/consent). Không đồng ý thì
 * chỉ có thể đăng xuất. Cổng ở app/_layout.tsx hiện màn này thay cho mọi màn khác.
 */
export function ConsentScreen() {
  const { run, busy, logout } = useStore();
  const [agree, setAgree] = useState(false);
  return (
    <Screen>
      <ScreenHeader title="Điều khoản đã cập nhật" subtitle={`Điều khoản v${TERMS_VERSION} · Chính sách bảo mật v${PRIVACY_VERSION}`} />
      <Card>
        <Text style={st.title}>Thay đổi chính</Text>
        {LEGAL_CHANGE_SUMMARY.map((s) => (
          <View key={s} style={st.row}>
            <Text style={st.bullet}>•</Text>
            <Text style={st.p}>{s}</Text>
          </View>
        ))}
        <Muted style={{ marginTop: S.md } as never}>Đọc bản đầy đủ:</Muted>
        <Text style={st.link} onPress={() => void Linking.openURL(`${WEB_ORIGIN}/dieu-khoan`)}>Điều khoản thuê kho</Text>
        <Text style={st.link} onPress={() => void Linking.openURL(`${WEB_ORIGIN}/bao-mat`)}>Chính sách bảo mật</Text>

        <Pressable onPress={() => setAgree((v) => !v)} style={st.consent} hitSlop={6}>
          <Ionicons name={agree ? 'checkbox' : 'square-outline'} size={22} color={agree ? C.brand700 : C.faint} />
          <Text style={st.consentText}>
            Tôi đã đọc và đồng ý với Điều khoản thuê kho (v{TERMS_VERSION}) và cho KhoAn xử lý dữ liệu cá nhân theo Chính sách bảo mật (v{PRIVACY_VERSION}).
          </Text>
        </Pressable>
        <Button title="Đồng ý và tiếp tục" disabled={!agree} loading={busy} style={{ marginTop: S.md }}
          onPress={() => void run('acceptLegal', undefined, 'Đã ghi nhận đồng ý — cảm ơn bạn')} />
        <Button title="Đăng xuất" variant="ghost" style={{ marginTop: S.sm }} onPress={() => void logout()} />
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: C.ink, marginBottom: S.sm },
  row: { flexDirection: 'row', gap: S.sm, marginTop: 4 },
  bullet: { fontSize: 13, color: C.text, lineHeight: 19 },
  p: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },
  link: { color: C.brand700, fontWeight: '600', fontSize: 14, marginTop: S.sm },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, marginTop: S.lg },
  consentText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },
});
