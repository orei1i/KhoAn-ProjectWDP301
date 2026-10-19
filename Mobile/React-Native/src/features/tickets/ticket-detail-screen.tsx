import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TICKET_CATEGORY, TICKET_MACHINE, TICKET_PRIORITY, TICKET_STATUS, fmtDateTime, nextStates } from '@ssm/shared';
import { byId, unitLabel, useStore, userName } from '../../shared/store/store';
import { Badge, Button, Card, EmptyState, Input, KV, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

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

  return (
    <Screen>
      <ScreenHeader title={t.subject} subtitle={t.ticketNumber} />

      <Card>
        <View style={st.badgeRow}>
          <StatusBadge map={TICKET_STATUS} value={t.status} />
          <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
          <Badge>{TICKET_CATEGORY[t.category]}</Badge>
        </View>
        <View style={{ marginTop: S.md }}>
          <KV items={[
            ['Người gửi', userName(db, t.reporterId)],
            ['Kho', t.unitId ? unitLabel(db, t.unitId) : '—'],
            ['Hạn xử lý', t.dueAt ? fmtDateTime(t.dueAt) : 'Chưa đặt'],
          ]} />
        </View>
      </Card>

      <View style={{ marginTop: S.md, gap: S.sm }}>
        {messages.length === 0 ? (
          <Muted>Chưa có tin nhắn nào.</Muted>
        ) : messages.map((m, i) => {
          const mine = m.authorId === user._id;
          return (
            <View key={i} style={[st.bubbleRow, mine && st.bubbleRowMine]}>
              <View style={[st.bubble, mine ? st.bubbleMine : st.bubbleTheirs]}>
                <Text style={mine ? st.bubbleTextMine : st.bubbleText}>{m.body}</Text>
              </View>
              <Muted style={st.bubbleTime as never}>{fmtDateTime(m.at)}</Muted>
            </View>
          );
        })}
      </View>

      {t.status !== 'CLOSED' && (
        <View style={st.composer}>
          <Input value={body} onChangeText={setBody} placeholder="Nhắn cho chi nhánh..." style={{ flex: 1 }} />
          <Button
            title="Gửi" style={st.sendBtn} disabled={body.trim().length === 0}
            onPress={() => void run('addTicketMessage', { ticketId: t._id, body: body.trim() }, undefined, () => setBody(''))}
          />
        </View>
      )}

      {(canClose || canReopen) && (
        <View style={{ marginTop: S.md, gap: S.sm }}>
          {canClose && (
            <Button
              title="Đóng yêu cầu" variant="secondary"
              onPress={() => void run('setTicketStatus', { ticketId: t._id, to: 'CLOSED' }, 'Đã đóng yêu cầu')}
            />
          )}
          {canReopen && (
            <Button
              title="Mở lại" variant="secondary"
              onPress={() => void run('setTicketStatus', { ticketId: t._id, to: 'IN_PROGRESS' }, 'Đã mở lại yêu cầu')}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  bubbleRow: { alignSelf: 'flex-start', maxWidth: '85%' },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: R.md, paddingVertical: S.sm, paddingHorizontal: S.md },
  bubbleMine: { backgroundColor: C.brand700 },
  bubbleTheirs: { backgroundColor: C.fill },
  bubbleText: { fontSize: 14, color: C.ink },
  bubbleTextMine: { fontSize: 14, color: '#fff' },
  bubbleTime: { fontSize: 11, marginTop: 2 },
  composer: { flexDirection: 'row', gap: S.sm, marginTop: S.md, alignItems: 'center' },
  sendBtn: { width: 72, height: 48 },
});
