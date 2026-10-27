import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { RentalContract } from '@ssm/shared';
import { CLAIM_WINDOW_DAYS, OPEN_CONTRACT_STATUSES, OPEN_SWAP_STATUSES, addDays, todayISO } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { C, R, S } from '../../shared/ui/theme';

type Icon = keyof typeof Ionicons.glyphMap;
interface Tile { key: string; icon: Icon; label: string; href: string; dot?: 'amber' | 'red'; show: boolean }
const PER_ROW = 4;

/**
 * Lối tắt tới các chức năng của một kho đang thuê — chạm một lần là tới đúng màn hình, khỏi lục trong chi tiết hợp đồng.
 * Chỉ hiện lối tắt hợp lệ với trạng thái hợp đồng (cùng điều kiện với BE): hợp đồng đã đóng chỉ còn thanh toán nợ sau quyết toán,
 * hỗ trợ và bồi thường trong hạn; gia hạn / dịch vụ / đổi ô chỉ khi đang hiệu lực.
 */
export function QuickActions({ contract: c }: { contract: RentalContract }) {
  const router = useRouter();
  const { db } = useStore();
  const openRequest = db.accessRequests.some((r) => r.contractId === c._id && (r.status === 'REQUESTED' || r.status === 'APPROVED'));
  const accessLabel = c.access.method === 'PIN' ? 'Mật khẩu' : c.access.method === 'RFID_CARD' ? 'Thẻ khoá' : 'Chìa khoá';
  const accessIcon: Icon = c.access.method === 'PIN' ? 'keypad-outline' : c.access.method === 'RFID_CARD' ? 'card-outline' : 'key-outline';

  const open = OPEN_CONTRACT_STATUSES.includes(c.status);
  const active = c.status === 'ACTIVE';
  // Đang có yêu cầu đổi ô chưa xong thì chấm cam; màn Đổi ô khi đó chỉ cho xem / rút yêu cầu, không gửi thêm.
  const openSwap = db.swapRequests.some((s) => s.contractId === c._id && (OPEN_SWAP_STATUSES as readonly string[]).includes(s.status));
  // Bồi thường: hợp đồng còn mở, hoặc đã đóng trong hạn khiếu nại — ABANDONED (đồ bỏ lại đã thanh lý) không có — khớp claim.service.
  const claimable = c.status !== 'ABANDONED' && (c.status !== 'CLOSED' || (c.closedAt ?? '') >= addDays(todayISO(), -CLAIM_WINDOW_DAYS));

  const tiles: Tile[] = [
    { key: 'access', icon: accessIcon, label: accessLabel, href: `/contract/access?contract=${c._id}`, dot: openRequest ? 'amber' : undefined, show: open },
    { key: 'pay', icon: 'wallet-outline', label: 'Thanh toán', href: `/contract/${c._id}`, dot: c.balance.outstanding > 0 ? 'red' : undefined, show: open || c.balance.outstanding > 0 },
    { key: 'extend', icon: 'calendar-outline', label: 'Gia hạn', href: `/contract/extend?contract=${c._id}`, show: active },
    { key: 'moveout', icon: 'exit-outline', label: 'Trả kho', href: `/contract/move-out?contract=${c._id}`, show: active || c.status === 'MOVE_OUT_PENDING' },
    { key: 'services', icon: 'construct-outline', label: 'Dịch vụ', href: `/contract/services?contract=${c._id}`, show: active },
    { key: 'swap', icon: 'swap-horizontal-outline', label: 'Đổi ô', href: `/contract/swap?contract=${c._id}`, dot: openSwap ? 'amber' : undefined, show: active },
    { key: 'support', icon: 'chatbubbles-outline', label: 'Hỗ trợ', href: `/ticket/new?contract=${c._id}`, show: true },
    { key: 'claim', icon: 'shield-checkmark-outline', label: 'Bồi thường', href: `/claim/new?contract=${c._id}`, show: claimable },
  ];
  const shown = tiles.filter((t) => t.show);
  // Chia hàng 4 ô; hàng cuối thiếu thì chèn ô trống để các ô giữ cùng độ rộng.
  const rows: (Tile | null)[][] = [];
  for (let i = 0; i < shown.length; i += PER_ROW) {
    const row: (Tile | null)[] = shown.slice(i, i + PER_ROW);
    while (row.length < PER_ROW) row.push(null);
    rows.push(row);
  }

  return (
    <View style={{ marginTop: S.lg, gap: S.sm }}>
      {rows.map((row, i) => (
        <View key={i} style={st.row}>
          {row.map((t, k) => (!t ? <View key={`pad-${k}`} style={st.tile} /> : (
            <Pressable key={t.key} onPress={() => router.push(t.href as never)} style={st.tile} accessibilityRole="button" accessibilityLabel={t.label}>
              <View style={st.iconWrap}>
                <Ionicons name={t.icon} size={22} color={C.brand700} />
                {t.dot && <View style={[st.dot, { backgroundColor: t.dot === 'red' ? C.red : C.amber }]} />}
              </View>
              <Text style={st.label} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          )))}
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
