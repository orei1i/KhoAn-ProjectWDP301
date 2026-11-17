import { Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CLAIM_CAUSE, CLAIM_STATUS, CLAIM_TYPE, PAYMENT_METHOD, causeOf, fmtDate, vnd, type ClaimItem } from '@ssm/shared';
import { byId, unitLabel, usePullRefresh, useStore } from '../../shared/store/store';
import { Button, Callout, Card, Chip, EmptyState, IconTile, KV, Muted, Screen, ScreenHeader, StatCard, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { PhotoThumbs } from '../../shared/ui/photo-picker';
import { C, R, S, T, TONE, TOUCH } from '../../shared/ui/theme';

/**
 * Ghi chú sau tên món — cùng ý với web quản lý: "ngoài danh sách" chỉ cho đồ không có intakeItemId; món chọn từ danh sách mà server gắn
 * `undeclared` (không khai giá trị, hoặc nhập kho sau ngày sự cố) thì "xét như ngoài danh sách".
 */
const itemNote = (it: ClaimItem) => {
  if (!it.intakeItemId) return ' (ngoài danh sách)';
  if (!it.undeclared) return '';
  return it.flag === 'AFTER_INCIDENT' ? ' (nhập kho sau ngày sự cố — xét như ngoài danh sách)' : ' (không khai giá trị — xét như ngoài danh sách)';
};

export default function ClaimDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, user, run } = useStore();
  const router = useRouter();
  // Góp ý 17/11: kéo xuống để tải lại (ngoài lần tự tải khi quay lại app / mỗi 30 giây).
  const pull = usePullRefresh();

  const c = byId(db.claims, id);
  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hồ sơ" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const canWithdraw = c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW';
  // Từ chối thì approvedAmount = 0 — ghi "Từ chối" kèm lý do, không ghi "duyệt 0 ₫".
  const rejected = c.status === 'REJECTED';

  return (
    <Screen refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={C.brand700} />} footer={canWithdraw ? (
      <Button
        title="Rút hồ sơ" variant="secondary" icon="arrow-undo-outline"
        onPress={() => confirmAction(
          'Rút hồ sơ?', 'Hồ sơ chuyển sang "Khách đã rút" và không mở lại được.', 'Rút hồ sơ',
          () => void run('withdrawClaim', { claimId: c._id }, 'Đã rút hồ sơ', () => router.back()),
        )}
      />
    ) : undefined}>
      <ScreenHeader icon="shield-checkmark-outline" title={`Hồ sơ ${c.claimNumber}`} subtitle={`Kho ${unitLabel(db, c.unitId)}`} right={<StatusBadge map={CLAIM_STATUS} value={c.status} />} />

      <View style={st.stats}>
        <StatCard style={{ flex: 1 }} label="Tổng khai báo" value={vnd(c.claimedAmount)} icon="document-text-outline" tone="amber" />
        {rejected
          ? <StatCard style={{ flex: 1 }} label="Kết quả" value="Từ chối" icon="close-circle-outline" tone="red" />
          : <StatCard style={{ flex: 1 }} label="Được duyệt" value={c.review ? vnd(c.review.approvedAmount) : 'Chưa có'} icon="checkmark-done-outline" tone={c.review ? 'green' : 'gray'} />}
      </View>

      <Card style={{ marginTop: S.md }}>
        <KV items={[
          ['Loại sự cố', CLAIM_TYPE[c.type]],
          ['Ngày sự cố', fmtDate(c.incidentAt)],
          ['Nguyên nhân', CLAIM_CAUSE[causeOf(c.cause)].label],
          ['Ngày gửi', fmtDate(c.createdAt)],
        ]} />
      </Card>

      <Card style={{ marginTop: S.md }}>
        <View style={st.head}>
          <IconTile icon="reader-outline" size="sm" />
          <Text style={st.sectionTitle}>Diễn biến</Text>
        </View>
        <Text style={st.body}>{c.description}</Text>
        {c.photoUrls?.length > 0 && <View style={{ marginTop: S.md }}><PhotoThumbs urls={c.photoUrls} /></View>}
      </Card>

      <Card style={{ marginTop: S.md }}>
        <View style={st.head}>
          <IconTile icon="pricetags-outline" tone="amber" size="sm" />
          <Text style={st.sectionTitle}>Hạng mục thiệt hại</Text>
        </View>
        {/* Đồ ngoài danh sách đã khai khi nhập kho: chi nhánh xét kỹ hơn, cần chứng cứ. */}
        <KV items={c.items.map((it) => [`${it.name}${itemNote(it)}`, `${it.quantity} × ${vnd(it.unitValue)} = ${vnd(it.quantity * it.unitValue)}`])} />
      </Card>

      {c.review && (
        <Card style={{ marginTop: S.md }} tone="gray">
          <View style={st.head}>
            <IconTile icon="ribbon-outline" tone="violet" size="sm" style={{ backgroundColor: C.white }} />
            <Text style={st.sectionTitle}>Kết quả xét duyệt · {fmtDate(c.review.reviewedAt)}</Text>
          </View>
          {rejected ? (
            <Text style={st.reviewAmount}>
              <Text style={{ fontWeight: '700', color: C.red }}>Từ chối</Text>
              {c.review.decisionNote ? ` — lý do: ${c.review.decisionNote}` : ''}
            </Text>
          ) : (
            <>
              <Muted>{c.review.decisionNote}</Muted>
              {/* Trần duyệt = min(tổng khai báo, mức xét) như web quản lý; căn cứ mức xét chỉ nêu khi chính mức xét là giới hạn. */}
              <Text style={st.reviewAmount}>
                Số tiền duyệt: <Text style={{ fontWeight: '700' }}>{vnd(c.review.approvedAmount)}</Text>
                <Text style={{ color: C.muted }}> · Trần duyệt {vnd(Math.min(c.claimedAmount, c.review.liabilityCap))}{c.review.capBasis && c.review.liabilityCap < c.claimedAmount ? ` theo ${c.review.capBasis}` : ''}</Text>
              </Text>
            </>
          )}
        </Card>
      )}

      {c.settlement && (
        <Callout
          tone={c.settlement.paidAt ? 'green' : 'amber'} icon={c.settlement.paidAt ? 'checkmark-circle-outline' : 'swap-horizontal-outline'} style={{ marginTop: S.md }}
          action={!c.settlement.paidAt && !user?.customerProfile?.payoutAccount
            ? <Button title="Khai tài khoản nhận tiền" variant="secondary" size="sm" icon="card-outline" onPress={() => router.push('/account')} />
            : undefined}
        >
          {c.settlement.paidAt
            ? `Đã chi ${fmtDate(c.settlement.paidAt)} qua ${PAYMENT_METHOD[c.settlement.method]}.`
            : `Đã lập lệnh chuyển khoản — ${user?.customerProfile?.payoutAccount ? 'KhoAn chuyển tới tài khoản nhận tiền bạn đã khai và xác nhận kèm mã giao dịch.' : 'bạn chưa khai tài khoản nhận tiền: khai ở tab Tài khoản → thẻ Thông tin cá nhân → Sửa thông tin (mục Tài khoản nhận tiền hoàn), hoặc chi nhánh sẽ liên hệ bạn.'}`}
        </Callout>
      )}

      <Card style={{ marginTop: S.md }}>
        <View style={st.head}>
          <IconTile icon="git-commit-outline" tone="gray" size="sm" />
          <Text style={st.sectionTitle}>Lịch sử xử lý</Text>
        </View>
        {c.statusHistory.map((h, i) => {
          const last = i === c.statusHistory.length - 1;
          return (
            <View key={i} style={st.historyRow}>
              <View style={st.rail}>
                <View style={[st.dot, { backgroundColor: TONE[CLAIM_STATUS[h.to].tone].dot }]} />
                {!last && <View style={st.line} />}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : S.md, gap: 4 }}>
                <Text style={T.caption}>{fmtDate(h.at)}</Text>
                <View style={st.historyChips}>
                  {h.from ? <><Chip size="sm" tone={CLAIM_STATUS[h.from].tone}>{CLAIM_STATUS[h.from].label}</Chip><Ionicons name="arrow-forward" size={12} color={C.faint} /></> : null}
                  <Chip size="sm" tone={CLAIM_STATUS[h.to].tone} dot>{CLAIM_STATUS[h.to].label}</Chip>
                </View>
                {h.reason ? <Text style={st.body}>{h.reason}</Text> : null}
              </View>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  stats: { flexDirection: 'row', gap: S.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink, flex: 1 },
  body: { fontSize: 13, lineHeight: 19, color: C.text },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.md },
  photo: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.brand50 },
  photoText: { color: C.brand700, fontWeight: '700', fontSize: 13 },
  reviewAmount: { fontSize: 13, color: C.text, marginTop: S.sm },
  historyRow: { flexDirection: 'row', gap: S.md },
  rail: { alignItems: 'center', width: 12, paddingTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { flex: 1, width: 2, backgroundColor: C.line, marginTop: 4 },
  historyChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
});
