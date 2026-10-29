import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LEGAL_CHANGE_SUMMARY, PRIVACY_VERSION, TERMS_VERSION } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Button, Card, CheckRow, IconTile, ListGroup, ListRow, Screen } from '../../shared/ui';
import { C, S, T } from '../../shared/ui/theme';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';

/**
 * Màn bắt buộc khi Điều khoản / Chính sách bảo mật đổi phiên bản mà khách chưa đồng ý bản mới (`user.consentRequired` do server tính):
 * xem tóm tắt thay đổi, mở đọc bản đầy đủ trên web, tick đồng ý rồi mới dùng tiếp app (POST /auth/me/consent). Không đồng ý thì
 * chỉ có thể đăng xuất. Cổng ở app/_layout.tsx hiện màn này thay cho mọi màn khác — nên không có nút quay lại.
 */
export function ConsentScreen() {
  const { run, busy, logout } = useStore();
  const [agree, setAgree] = useState(false);
  return (
    <Screen footer={(
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Button title="Đăng xuất" variant="secondary" icon="log-out-outline" style={{ flex: 1 }} onPress={() => void logout()} />
        <Button title="Đồng ý và tiếp tục" disabled={!agree} loading={busy} style={{ flex: 1.6 }}
          onPress={() => void run('acceptLegal', undefined, 'Đã ghi nhận đồng ý — cảm ơn bạn')} />
      </View>
    )}>
      <View style={st.header}>
        <IconTile icon="document-lock-outline" tone="violet" size="lg" />
        <View style={{ flex: 1 }}>
          <Text style={T.title}>Điều khoản đã cập nhật</Text>
          <Text style={[T.small, { marginTop: 2 }]}>Điều khoản v{TERMS_VERSION} · Chính sách bảo mật v{PRIVACY_VERSION}</Text>
        </View>
      </View>

      <Card>
        <Text style={st.title}>Thay đổi chính</Text>
        {LEGAL_CHANGE_SUMMARY.map((s) => (
          <View key={s} style={st.row}>
            <Ionicons name="checkmark-circle" size={16} color={C.brand500} style={{ marginTop: 2 }} />
            <Text style={st.p}>{s}</Text>
          </View>
        ))}
      </Card>

      <Text style={[T.overline, { marginTop: S.lg, marginBottom: S.sm }]}>Đọc bản đầy đủ</Text>
      <ListGroup>
        <ListRow icon="document-text-outline" title="Điều khoản thuê kho" right={<Ionicons name="open-outline" size={16} color={C.faint} />} chevron={false}
          onPress={() => void Linking.openURL(`${WEB_ORIGIN}/dieu-khoan`)} />
        <ListRow icon="shield-checkmark-outline" tone="violet" title="Chính sách bảo mật" right={<Ionicons name="open-outline" size={16} color={C.faint} />} chevron={false}
          onPress={() => void Linking.openURL(`${WEB_ORIGIN}/bao-mat`)} />
      </ListGroup>

      <Card style={{ marginTop: S.lg }}>
        <CheckRow checked={agree} onPress={() => setAgree((v) => !v)}>
          Tôi đã đọc và đồng ý với Điều khoản thuê kho (v{TERMS_VERSION}) và cho KhoAn xử lý dữ liệu cá nhân theo Chính sách bảo mật (v{PRIVACY_VERSION}).
        </CheckRow>
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.lg },
  title: { fontSize: 15, fontWeight: '700', color: C.ink, marginBottom: S.xs },
  row: { flexDirection: 'row', gap: S.sm, marginTop: S.sm },
  p: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },
});
