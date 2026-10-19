import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CLAIM_STATUS, CLAIM_TYPE, PAYMENT_METHOD, fmtDate, vnd } from '@ssm/shared';
import { byId, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, EmptyState, KV, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

export default function ClaimDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, run } = useStore();
  const router = useRouter();

  const c = byId(db.claims, id);
  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hồ sơ" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const canWithdraw = c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW';

  return (
    <Screen>
      <ScreenHeader title={`Hồ sơ ${c.claimNumber}`} subtitle={`Kho ${unitLabel(db, c.unitId)}`} right={<StatusBadge map={CLAIM_STATUS} value={c.status} />} />

      <Card>
        <KV items={[
          ['Loại sự cố', CLAIM_TYPE[c.type]],
          ['Ngày sự cố', fmtDate(c.incidentAt)],
          ['Ngày gửi', fmtDate(c.createdAt)],
          ['Tổng khai báo', vnd(c.claimedAmount)],
          ['Được duyệt', c.review ? vnd(c.review.approvedAmount) : 'Chưa có'],
        ]} />
      </Card>

      <Card style={{ marginTop: S.md }}>
        <Text style={st.sectionTitle}>Diễn biến</Text>
        <Muted style={{ marginTop: 4 } as never}>{c.description}</Muted>
      </Card>

      <Card style={{ marginTop: S.md }}>
        <Text style={st.sectionTitle}>Hạng mục thiệt hại</Text>
        <View style={{ marginTop: S.sm }}>
          <KV items={c.items.map((it) => [it.name, `${it.quantity} × ${vnd(it.unitValue)} = ${vnd(it.quantity * it.unitValue)}`])} />
        </View>
      </Card>

      {c.review && (
        <Card style={{ marginTop: S.md, backgroundColor: C.fill }}>
          <Text style={st.sectionTitle}>Kết quả xét duyệt · {fmtDate(c.review.reviewedAt)}</Text>
          <Muted style={{ marginTop: 4 } as never}>{c.review.decisionNote}</Muted>
          <Text style={st.reviewAmount}>
            Số tiền duyệt: <Text style={{ fontWeight: '700' }}>{vnd(c.review.approvedAmount)}</Text>
            <Text style={{ color: C.muted }}> (mức trách nhiệm tối đa {vnd(c.review.liabilityCap)})</Text>
          </Text>
        </Card>
      )}

      {c.settlement && (
        <Card style={{ marginTop: S.md }}>
          <Text style={{ color: C.green, fontWeight: '600' }}>
            Đã chi {fmtDate(c.settlement.paidAt)} qua {PAYMENT_METHOD[c.settlement.method]}.
          </Text>
        </Card>
      )}

      <Card style={{ marginTop: S.md }}>
        <Text style={st.sectionTitle}>Lịch sử xử lý</Text>
        <View style={{ marginTop: S.sm, gap: S.sm }}>
          {c.statusHistory.map((h, i) => (
            <View key={i} style={st.historyRow}>
              <Text style={st.historyDate}>{fmtDate(h.at)}</Text>
              <Text style={st.historyText}>
                {h.from ? `${CLAIM_STATUS[h.from].label} → ` : ''}{CLAIM_STATUS[h.to].label}
                {h.reason ? ` · ${h.reason}` : ''}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {canWithdraw && (
        <Button
          title="Rút hồ sơ" variant="secondary" style={{ marginTop: S.md }}
          onPress={() => void run('withdrawClaim', { claimId: c._id }, 'Đã rút hồ sơ', () => router.back())}
        />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  reviewAmount: { fontSize: 13, color: C.text, marginTop: S.sm },
  historyRow: { flexDirection: 'row', gap: S.sm },
  historyDate: { fontSize: 12, color: C.muted, width: 76 },
  historyText: { fontSize: 13, color: C.text, flex: 1 },
});
