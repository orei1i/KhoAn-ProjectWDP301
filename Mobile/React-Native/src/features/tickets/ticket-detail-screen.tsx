import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FACILITY_UTC_OFFSET_HOURS, TICKET_CATEGORY, TICKET_MACHINE, TICKET_PRIORITY, TICKET_STATUS, nextStates } from '@ssm/shared';
import { byId, unitLabel, usePullRefresh, useStore, userName } from '../../shared/store/store';
import { Badge, Button, Callout, Card, EmptyState, Input, KV, Muted, Screen, ScreenHeader, SectionHeader, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, R, S, T, TOUCH } from '../../shared/ui/theme';

/** "15/11 22:04" theo giờ Việt Nam — ngày trước giờ, gạch chéo như các ngày khác trong app (Intl vi-VN ra "22:04 15-11"). */
const dayTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + FACILITY_UTC_OFFSET_HOURS * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export default function TicketDetailScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { db, user, run } = useStore();
  const router = useRouter();
  const [body, setBody] = useState('');
  // Góp ý 17/11: kéo xuống để tải lại (ngoài lần tự tải khi quay lại app / mỗi 30 giây).
  const pull = usePullRefresh();

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
    <Screen refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={C.brand700} />} footer={t.status !== 'CLOSED' ? (
      <View style={st.composer}>
        <Input value={body} onChangeText={setBody} placeholder={t.status === 'RESOLVED' ? 'Nhắn để mở lại yêu cầu...' : 'Nhắn cho chi nhánh...'} style={st.composerInput} />
        <Pressable
          onPress={send} disabled={body.trim().length === 0} accessibilityRole="button" accessibilityLabel="Gửi"
          style={({ pressed }) => [st.sendBtn, body.trim().length === 0 && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="send" size={20} color={C.white} />
        </Pressable>
      </View>
    ) : undefined}>
      <ScreenHeader icon="chatbubble-ellipses-outline" tone="blue" title={t.subject} subtitle={t.ticketNumber} />
      {/* Thẻ "đã gửi" chỉ hợp khi phiếu còn Mới — chi nhánh đã nhận / khách đã đóng thì ẩn. */}
      {created === '1' && t.status === 'OPEN' && (
        <Callout tone="green" icon="checkmark-circle-outline" style={{ marginBottom: S.md }}>
          {`Đã gửi yêu cầu ${t.ticketNumber}. Chi nhánh đã được báo và sẽ trả lời ngay tại đây — bạn cũng nhận email xác nhận.`}
        </Callout>
      )}

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
            ['Hạn xử lý', t.dueAt ? dayTime(t.dueAt) : 'Chưa đặt'],
          ]} />
        </View>
        {/* Đợt 16 (C3): chi nhánh đóng phiếu chưa giải quyết thì ghi lý do; khách nhắn vào phiếu đã giải quyết → phiếu tự mở lại. */}
        {t.closeReason ? <Muted style={{ marginTop: S.sm } as never}>Chi nhánh đóng yêu cầu: {t.closeReason}</Muted> : null}
        {t.status === 'RESOLVED' ? <Muted style={{ marginTop: S.sm } as never}>Vấn đề vẫn còn? Nhắn thêm bên dưới — yêu cầu tự mở lại và chi nhánh được báo.</Muted> : null}
        {(canClose || canReopen) && (
          <View style={st.actions}>
            {canClose && (
              <Button
                title="Đóng yêu cầu" variant="secondary" size="sm" icon="checkmark-done-outline" style={{ flex: 1 }}
                onPress={() => confirmAction(
                  'Đóng yêu cầu?', 'Đóng rồi thì không nhắn thêm và không mở lại được. Cần hỗ trợ tiếp thì gửi yêu cầu mới.', 'Đóng yêu cầu',
                  () => void run('setTicketStatus', { ticketId: t._id, to: 'CLOSED' }, 'Đã đóng yêu cầu'),
                )}
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
              <Text style={st.bubbleTime}>{dayTime(m.at)}</Text>
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
  // C.muted (#78716C) trên nền #F6F6F4 ≈ 4,4:1 — C.faint cũ chỉ ≈ 2,3:1, khó đọc.
  bubbleTime: { fontSize: 11, color: C.muted, marginTop: 3, marginHorizontal: 4 },
  composer: { flexDirection: 'row', gap: S.sm, alignItems: 'center' },
  composerInput: { flex: 1, borderRadius: R.full, paddingHorizontal: S.lg },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' },
});
