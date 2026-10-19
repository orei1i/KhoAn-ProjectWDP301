import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CLAIM_STATUS, CLAIM_TYPE, TICKET_PRIORITY, TICKET_STATUS, fmtDateTime, vnd } from '@ssm/shared';
import { facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Card, Chips, EmptyState, H1, Muted, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

type Tab = 'tickets' | 'claims';
const TABS: { value: Tab; label: string }[] = [
  { value: 'tickets', label: 'Yêu cầu hỗ trợ' }, { value: 'claims', label: 'Bồi thường' },
];

export default function SupportScreen() {
  const { db, user } = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('tickets');
  if (!user) return null;

  const tickets = db.tickets.filter((t) => t.reporterId === user._id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const claims = db.claims.filter((c) => c.customerId === user._id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <SafeAreaView style={st.screen} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl * 2, gap: S.md }}>
          <H1>Hỗ trợ</H1>
          <Chips options={TABS} value={tab} onChange={setTab} columns={2} />

          {tab === 'tickets' ? (
            tickets.length === 0 ? (
              <Card><EmptyState icon="chatbubbles-outline" title="Chưa có yêu cầu hỗ trợ nào" /></Card>
            ) : tickets.map((t) => (
              <Pressable key={t._id} onPress={() => router.push(`/ticket/${t._id}`)}>
                <Card>
                  <View style={st.rowBetween}>
                    <Text style={st.title} numberOfLines={1}>{t.subject}</Text>
                    <StatusBadge map={TICKET_STATUS} value={t.status} />
                  </View>
                  <Muted style={{ marginTop: 2 } as never}>{t.ticketNumber} · {facilityName(db, t.facilityId)}</Muted>
                  <View style={st.rowGap}>
                    <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
                    <Muted>{fmtDateTime(t.updatedAt)}</Muted>
                  </View>
                </Card>
              </Pressable>
            ))
          ) : (
            claims.length === 0 ? (
              <Card><EmptyState icon="cash-outline" title="Chưa có yêu cầu bồi thường nào" /></Card>
            ) : claims.map((c) => (
              <Pressable key={c._id} onPress={() => router.push(`/claim/${c._id}`)}>
                <Card>
                  <View style={st.rowBetween}>
                    <Text style={st.title}>{c.claimNumber}</Text>
                    <StatusBadge map={CLAIM_STATUS} value={c.status} />
                  </View>
                  <Muted style={{ marginTop: 2 } as never}>{unitLabel(db, c.unitId)} · {CLAIM_TYPE[c.type]}</Muted>
                  <Text style={st.amount}>{vnd(c.claimedAmount)}</Text>
                </Card>
              </Pressable>
            ))
          )}
        </ScrollView>

        <Pressable style={st.fab} onPress={() => router.push(tab === 'tickets' ? '/ticket/new' : '/claim/new')}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={st.fabText}>{tab === 'tickets' ? 'Gửi yêu cầu' : 'Gửi yêu cầu bồi thường'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm },
  title: { fontSize: 15, fontWeight: '700', color: C.ink, flexShrink: 1 },
  amount: { fontSize: 15, fontWeight: '700', color: C.ink, marginTop: S.sm },
  fab: {
    position: 'absolute', right: S.lg, bottom: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.sm,
    backgroundColor: C.brand700, paddingHorizontal: S.lg, height: 48, borderRadius: R.full,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
