import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CLAIM_STATUS, CLAIM_TYPE, TICKET_PRIORITY, TICKET_STATUS, fmtDateTime, vnd } from '@ssm/shared';
import { facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, Chips, EmptyState, IconTile, Muted, StatusBadge, TabHeader } from '../../shared/ui';
import { C, R, S, SHADOW, T } from '../../shared/ui/theme';

type Tab = 'tickets' | 'claims';
const TABS: { value: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'tickets', label: 'Yêu cầu hỗ trợ', icon: 'chatbubbles-outline' }, { value: 'claims', label: 'Bồi thường', icon: 'shield-checkmark-outline' },
];

export default function SupportScreen() {
  const { db, user } = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('tickets');
  if (!user) return null;

  const tickets = db.tickets.filter((t) => t.reporterId === user._id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const claims = db.claims.filter((c) => c.customerId === user._id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const create = () => router.push(tab === 'tickets' ? '/ticket/new' : '/claim/new');

  return (
    <SafeAreaView style={st.screen} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl * 3, gap: S.md }}>
          <TabHeader eyebrow="Chúng tôi luôn sẵn sàng" title="Hỗ trợ" subtitle="Báo sự cố, theo dõi phản hồi và hồ sơ bồi thường." />
          <Chips options={TABS} value={tab} onChange={setTab} columns={2} />

          {tab === 'tickets' ? (
            tickets.length === 0 ? (
              <Card><EmptyState icon="chatbubbles-outline" title="Chưa có yêu cầu hỗ trợ nào" action={<Button title="Gửi yêu cầu" icon="add" size="sm" onPress={create} />} /></Card>
            ) : tickets.map((t) => (
              <Card key={t._id} onPress={() => router.push(`/ticket/${t._id}`)} accessibilityLabel={t.subject}>
                <View style={st.row}>
                  <IconTile icon="chatbubble-ellipses-outline" tone="blue" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={st.rowBetween}>
                      <Text style={st.title} numberOfLines={1}>{t.subject}</Text>
                      <StatusBadge map={TICKET_STATUS} value={t.status} />
                    </View>
                    <Muted style={{ marginTop: 2 } as never}>{t.ticketNumber} · {facilityName(db, t.facilityId)}</Muted>
                    <View style={st.rowGap}>
                      <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
                      <Text style={T.caption}>{fmtDateTime(t.updatedAt)}</Text>
                    </View>
                  </View>
                </View>
              </Card>
            ))
          ) : (
            claims.length === 0 ? (
              <Card><EmptyState icon="shield-checkmark-outline" title="Chưa có yêu cầu bồi thường nào" action={<Button title="Gửi yêu cầu bồi thường" icon="add" size="sm" onPress={create} />} /></Card>
            ) : claims.map((c) => (
              <Card key={c._id} onPress={() => router.push(`/claim/${c._id}`)} accessibilityLabel={c.claimNumber}>
                <View style={st.row}>
                  <IconTile icon="shield-checkmark-outline" tone="amber" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={st.rowBetween}>
                      <Text style={st.title}>{c.claimNumber}</Text>
                      <StatusBadge map={CLAIM_STATUS} value={c.status} />
                    </View>
                    <Muted style={{ marginTop: 2 } as never}>{unitLabel(db, c.unitId)} · {CLAIM_TYPE[c.type]}</Muted>
                    <Text style={st.amount}>{vnd(c.claimedAmount)}</Text>
                  </View>
                </View>
              </Card>
            ))
          )}
        </ScrollView>

        <Pressable style={({ pressed }) => [st.fab, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]} onPress={create} accessibilityRole="button">
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={st.fabText}>{tab === 'tickets' ? 'Gửi yêu cầu' : 'Gửi yêu cầu bồi thường'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm, flexWrap: 'wrap' },
  title: { fontSize: 15, fontWeight: '700', color: C.ink, flexShrink: 1 },
  amount: { fontSize: 16, fontWeight: '800', color: C.ink, marginTop: S.sm, ...T.tabular },
  fab: {
    position: 'absolute', right: S.lg, bottom: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.sm,
    backgroundColor: C.brand700, paddingHorizontal: S.lg + 2, height: 52, borderRadius: R.full, ...SHADOW.float,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
