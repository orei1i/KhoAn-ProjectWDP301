import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TICKET_CATEGORY, TICKET_MACHINE, TICKET_PRIORITY, TICKET_STATUS, fmtDateTime, nextStates } from '@ssm/shared';
import { byId, unitLabel, useStore, userName } from '../../shared/store/store';
import { Badge, Button, Card, EmptyState, Input, KV, Screen, ScreenHeader, SectionHeader, StatusBadge } from '../../shared/ui';
import { C, R, S, T, TOUCH } from '../../shared/ui/theme';

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, user, run } = useStore();
  const router = useRouter();
  const [body, setBody] = useState('');

  const t = byId(db.tickets, id);
  if (!t || !user) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy yêu cầu" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  // Chỉ CUSTOMER được đóng (từ OPEN/RESOLVED) hoặc mở lại (chỉ khi đang RESOLVED) — state machine quyết định, không đoán ở đây.
  const allowed = nextStates(TICKET_MACHINE, t.status, 'CUSTOMER');
  const canClose = allowed.includes('CLOSED');
  const canReopen = allowed.includes('IN_PROGRESS');
  const messages = t.messages.filter((m) => !m.internal);
  const send = () => void run('addTicketMessage', { ticketId: t._id, body: body.trim() }, undefined, () => setBody(''));

  return (
    <Screen footer={t.status !== 'CLOSED' ? (
      <View style={st.composer}>
        <Input value={body} onChangeText={setBody} placeholder="Nhắn cho chi nhánh..." style={st.composerInput} />
        <Pressable
          onPress={send} disabled={body.trim().length === 0} accessibilityRole="button" accessibilityLabel="Gửi"
          style={({ pressed }) => [st.sendBtn, body.trim().length === 0 && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="send" size={20} color={C.white} />
        </Pressable>
      </View>
    ) : undefined}>
      <ScreenHeader icon="chatbubble-ellipses-outline" tone="blue" title={t.subject} subtitle={t.ticketNumber} />

      <Card>
        <View style={st.badgeRow}>
          <StatusBadge map={TICKET_STATUS} value={t.status} />
          <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
          <Badge icon="pricetag-outline">{TICKET_CATEGORY[t.category]}</Badge>
        </View>
        <View style={{ marginTop: S.md }}>
          <KV items={[
            ['Người gửi', userName(db, t.reporterId)],
            ['Kho', t.unitId ? unitLabel(db, t.unitId) : '—'],
            ['Hạn xử lý', t.dueAt ? fmtDateTime(t.dueAt) : 'Chưa đặt'],
          ]} />
        </View>
        {(canClose || canReopen) && (
          <View style={st.actions}>
            {canClose && (
              <Button
                title="Đóng yêu cầu" variant="secondary" size="sm" icon="checkmark-done-outline" style={{ flex: 1 }}
                onPress={() => void run('setTicketStatus', { ticketId: t._id, to: 'CLOSED' }, 'Đã đóng yêu cầu')}
              />
            )}
            {canReopen && (
              <Button
                title="Mở lại" variant="secondary" size="sm" icon="refresh-outline" style={{ flex: 1 }}
                onPress={() => void run('setTicketStatus', { ticketId: t._id, to: 'IN_PROGRESS' }, 'Đã mở lại yêu cầu')}
              />
            )}
          </View>
        )}
      </Card>

      <SectionHeader title="Trao đổi" icon="chatbubbles-outline" count={messages.length || undefined} />
      <View style={{ gap: S.md }}>
        {messages.length === 0 ? (
          <Card><EmptyState icon="chatbubbles-outline" title="Chưa có tin nhắn nào." /></Card>
        ) : messages.map((m, i) => {
          const mine = m.authorId === user._id;
          return (
            <View key={i} style={[st.bubbleRow, mine && st.bubbleRowMine]}>
              <View style={[st.bubble, mine ? st.bubbleMine : st.bubbleTheirs]}>
                <Text style={mine ? st.bubbleTextMine : st.bubbleText}>{m.body}</Text>
              </View>
              <Text style={st.bubbleTime}>{fmtDateTime(m.at)}</Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  actions: { flexDirection: 'row', gap: S.sm, marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft },
  bubbleRow: { alignSelf: 'flex-start', maxWidth: '85%' },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  author: { ...T.caption, fontWeight: '600', marginBottom: 2, marginLeft: 4 },
  bubble: { borderRadius: R.lg, paddingVertical: S.sm + 2, paddingHorizontal: S.md },
  bubbleMine: { backgroundColor: C.brand700, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20, color: C.ink },
  bubbleTextMine: { fontSize: 14, lineHeight: 20, color: '#fff' },
  bubbleTime: { fontSize: 11, color: C.faint, marginTop: 3, marginHorizontal: 4 },
  composer: { flexDirection: 'row', gap: S.sm, alignItems: 'center' },
  composerInput: { flex: 1, borderRadius: R.full, paddingHorizontal: S.lg },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' },
});
