import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { RentalContract } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { C, R, S } from '../../shared/ui/theme';

type Icon = keyof typeof Ionicons.glyphMap;
interface Tile { key: string; icon: Icon; label: string; href: string; dot?: 'amber' | 'red' }

/** Lối tắt tới các chức năng của một kho đang thuê — chạm một lần là tới đúng màn hình, khỏi lục trong chi tiết hợp đồng. */
export function QuickActions({ contract: c }: { contract: RentalContract }) {
  const router = useRouter();
  const { db } = useStore();
  const openRequest = db.accessRequests.some((r) => r.contractId === c._id && (r.status === 'REQUESTED' || r.status === 'APPROVED'));
  const accessLabel = c.access.method === 'PIN' ? 'Mật khẩu' : c.access.method === 'RFID_CARD' ? 'Thẻ khoá' : 'Chìa khoá';
  const accessIcon: Icon = c.access.method === 'PIN' ? 'keypad-outline' : c.access.method === 'RFID_CARD' ? 'card-outline' : 'key-outline';

  const tiles: Tile[] = [
    { key: 'access', icon: accessIcon, label: accessLabel, href: `/contract/access?contract=${c._id}`, dot: openRequest ? 'amber' : undefined },
    { key: 'pay', icon: 'wallet-outline', label: 'Thanh toán', href: `/contract/${c._id}`, dot: c.balance.outstanding > 0 ? 'red' : undefined },
    { key: 'extend', icon: 'calendar-outline', label: 'Gia hạn', href: `/contract/${c._id}` },
    { key: 'moveout', icon: 'exit-outline', label: 'Trả kho', href: `/contract/${c._id}` },
    { key: 'services', icon: 'construct-outline', label: 'Dịch vụ', href: `/contract/services?contract=${c._id}` },
    { key: 'swap', icon: 'swap-horizontal-outline', label: 'Đổi ô', href: `/contract/swap?contract=${c._id}` },
    { key: 'support', icon: 'chatbubbles-outline', label: 'Hỗ trợ', href: '/ticket/new' },
    { key: 'claim', icon: 'shield-checkmark-outline', label: 'Bồi thường', href: `/claim/new?contract=${c._id}` },
  ];
  const rows = [tiles.slice(0, 4), tiles.slice(4)];

  return (
    <View style={{ marginTop: S.lg, gap: S.sm }}>
      {rows.map((row, i) => (
        <View key={i} style={st.row}>
          {row.map((t) => (
            <Pressable key={t.key} onPress={() => router.push(t.href as never)} style={st.tile} accessibilityRole="button" accessibilityLabel={t.label}>
              <View style={st.iconWrap}>
                <Ionicons name={t.icon} size={22} color={C.brand700} />
                {t.dot && <View style={[st.dot, { backgroundColor: t.dot === 'red' ? C.red : C.amber }]} />}
              </View>
              <Text style={st.label} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', gap: S.sm },
  tile: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: S.xs },
  iconWrap: { width: 48, height: 48, borderRadius: R.md, backgroundColor: C.brand50, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 5, right: 5, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: '#fff' },
  label: { fontSize: 12, fontWeight: '600', color: C.text, textAlign: 'center' },
});
