import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { USER_STATUS, fmtDate } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Button, Card, H1, KV, Muted, Screen, StatusBadge } from '../../shared/ui';
import { ProfileCard } from './profile-card';
import { PrivacyCard } from './privacy-card';
import { API_URL } from '../../shared/api/client';
import { C, R, S } from '../../shared/ui/theme';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';

export default function AccountScreen() {
  const { user, logout } = useStore();
  if (!user) return null;

  return (
    <Screen>
      <H1>Tài khoản</H1>

      <Card style={{ marginTop: S.lg }}>
        <View style={st.row}>
          <View style={st.avatar}><Ionicons name="person" size={24} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{user.fullName}</Text>
            <Muted>{user.email}</Muted>
          </View>
        </View>
        <View style={{ marginTop: S.lg }}>
          <KV items={[
            ['Trạng thái', <StatusBadge key="s" map={USER_STATUS} value={user.status} />],
            ['Tham gia từ', fmtDate(user.createdAt)],
          ]} />
        </View>
      </Card>

      <ProfileCard />
      {user.role === 'CUSTOMER' && <PrivacyCard />}

      {user.status === 'PENDING_VERIFICATION' && (
        <Card style={{ marginTop: S.md, backgroundColor: C.amberBg, borderColor: '#fde68a' }}>
          <Text style={{ color: C.amber, fontWeight: '600' }}>Chưa xác minh email</Text>
          <Muted style={{ marginTop: 4 } as never}>
            Mở link trong email đã gửi để kích hoạt tài khoản. Chưa xác minh thì không đặt kho được.
          </Muted>
        </Card>
      )}

      <Card style={{ marginTop: S.md }}>
        <Text style={st.sectionTitle}>Đổi mật khẩu</Text>
        <Muted style={{ marginTop: 4 } as never}>
          Việc này làm trên web để dùng chung luồng xác thực với tài khoản Google.
        </Muted>
        <Button
          title="Mở trang đặt mật khẩu"
          variant="secondary"
          icon="open-outline"
          style={{ marginTop: S.md }}
          onPress={() => Linking.openURL(`${WEB_ORIGIN}/dat-mat-khau`)}
        />
      </Card>

      <Button title="Đăng xuất" variant="danger" icon="log-out-outline" style={{ marginTop: S.xl }} onPress={() => void logout()} />

      <Muted style={{ marginTop: S.xl, textAlign: 'center', fontSize: 11 } as never}>
        Máy chủ: {API_URL}
      </Muted>
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  avatar: { width: 52, height: 52, borderRadius: R.full, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 17, fontWeight: '700', color: C.ink },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
});
