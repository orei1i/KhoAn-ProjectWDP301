import { Linking, StyleSheet, Text, View } from 'react-native';
import { USER_STATUS, fmtDate } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Avatar, Button, Callout, ListGroup, ListRow, Screen, StatusBadge, TabHeader } from '../../shared/ui';
import { ProfileCard } from './profile-card';
import { PrivacyCard } from './privacy-card';
import { HistoryCard } from '../payments/history-card';
import { API_URL } from '../../shared/api/client';
import { C, R, S, SHADOW, T } from '../../shared/ui/theme';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';

export default function AccountScreen() {
  const { user, logout } = useStore();
  if (!user) return null;

  return (
    <Screen>
      <TabHeader title="Tài khoản" />

      <View style={st.hero}>
        <View style={st.row}>
          <Avatar name={user.fullName} size={56} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.name} numberOfLines={2}>{user.fullName}</Text>
            <Text style={st.email} numberOfLines={1}>{user.email}</Text>
          </View>
        </View>
        <View style={st.meta}>
          <View style={st.metaCell}>
            <Text style={st.metaLabel}>Trạng thái</Text>
            <StatusBadge map={USER_STATUS} value={user.status} />
          </View>
          <View style={st.metaCell}>
            <Text style={st.metaLabel}>Tham gia từ</Text>
            <Text style={st.metaValue}>{fmtDate(user.createdAt)}</Text>
          </View>
        </View>
      </View>

      {user.status === 'PENDING_VERIFICATION' && (
        <Callout tone="amber" icon="mail-unread-outline" title="Chưa xác minh email" style={{ marginTop: S.md }}>
          Mở link trong email đã gửi để kích hoạt tài khoản. Chưa xác minh thì không đặt kho được.
        </Callout>
      )}

      {/* Lịch sử đặt chỗ & thanh toán (đặt chỗ đã huỷ, khoản hoàn đang chờ chuyển…) — trang chủ dẫn tới đây; thẻ Thông tin cá nhân ngay
          dưới là chỗ khai tài khoản nhận tiền hoàn. */}
      {user.role === 'CUSTOMER' && <HistoryCard />}
      <ProfileCard />
      {user.role === 'CUSTOMER' && <PrivacyCard />}

      <ListGroup style={{ marginTop: S.md }}>
        <ListRow icon="key-outline" tone="gray" title="Đổi mật khẩu" subtitle="Mở trang đặt mật khẩu"
          right={<View style={st.ext}><Text style={st.extText}>Web</Text></View>}
          onPress={() => Linking.openURL(`${WEB_ORIGIN}/dat-mat-khau`)} />
      </ListGroup>

      <Button title="Đăng xuất" variant="danger" icon="log-out-outline" style={{ marginTop: S.xl }} onPress={() => void logout()} />

      <Text style={[T.caption, { marginTop: S.xl, textAlign: 'center', fontSize: 11, color: C.faint }]}>
        Máy chủ: {API_URL}
      </Text>
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { backgroundColor: C.brand900, borderRadius: R.xl, padding: S.lg, ...SHADOW.lift },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  name: { fontSize: 19, fontWeight: '800', color: C.white, letterSpacing: -0.2 },
  email: { fontSize: 13, color: C.brand200, marginTop: 2 },
  meta: { flexDirection: 'row', gap: S.sm, marginTop: S.lg },
  metaCell: { flex: 1, gap: 6, backgroundColor: C.white, borderRadius: R.md, padding: S.md },
  metaLabel: { fontSize: 11, fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaValue: { fontSize: 14, fontWeight: '700', color: C.ink, ...T.tabular },
  ext: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.full, backgroundColor: C.fill },
  extText: { fontSize: 11, fontWeight: '700', color: C.muted },
});
