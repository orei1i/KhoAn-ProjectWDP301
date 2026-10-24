import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  CANCELLATION_REASON, COLLECTED_PAYMENT_STATUSES, PAYMENT_METHOD, PAYMENT_TYPE, RESERVATION_STATUS, dueAtBooking, fmtDate, fmtDateTime, paymentStatusLabel, periodLabel, vnd,
} from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Card, Chips, Muted, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

type Tab = 'payments' | 'reservations';
const TABS: { value: Tab; label: string }[] = [{ value: 'payments', label: 'Thanh toán & hoàn tiền' }, { value: 'reservations', label: 'Đặt chỗ đã qua' }];
const PAGE = 8;
const LIVE_RESERVATION = ['PENDING', 'CONFIRMED', 'ALLOCATED'];

/** Khoản KhoAn đang chờ CHUYỂN KHOẢN cho khách (hoàn tiền / bồi thường / tiền thanh lý dư) — quản lý chuyển rồi xác nhận kèm mã giao dịch. */
function usePendingPayouts() {
  const { db, user } = useStore();
  const items = user ? db.payments.filter((p) => p.customerId === user._id && p.direction === 'REFUND' && p.status === 'PENDING' && p.method === 'BANK_TRANSFER') : [];
  return { items, total: items.reduce((s, p) => s + p.amount, 0), account: user?.customerProfile?.payoutAccount ?? null };
}

/**
 * Banner "KhoAn đang chuẩn bị chuyển khoản hoàn X" — cùng nội dung với web (portal/payments). Chưa khai tài khoản nhận tiền thì nhắc
 * khai, vì không có tài khoản thì chi nhánh phải gọi hỏi, tiền về chậm. `onOpen` = nút dẫn tới chỗ khai / xem lịch sử (trang chủ).
 */
export function PayoutBanner({ onOpen, style }: { onOpen?: () => void; style?: StyleProp<ViewStyle> }) {
  const { items, total, account } = usePendingPayouts();
  if (items.length === 0) return null;
  return (
    <Card style={[{ backgroundColor: C.amberBg, borderColor: '#fde68a' }, style]}>
      <View style={st.row}>
        <Ionicons name="cash-outline" size={20} color={C.amber} />
        <Text style={{ flex: 1, color: C.amber, fontWeight: '700' }}>KhoAn đang chuẩn bị chuyển khoản hoàn {vnd(total)} cho bạn</Text>
      </View>
      <Text style={[st.small, { color: C.text, marginTop: 6 }]}>
        {account
          ? `Tài khoản nhận: ${account.bankName} · ••••${account.accountNumber.slice(-4)}. Đổi tài khoản ở tab Tài khoản → thẻ Thông tin cá nhân → Sửa thông tin.`
          : 'Bạn chưa khai tài khoản nhận tiền — khai ở tab Tài khoản → thẻ Thông tin cá nhân → Sửa thông tin → "Tài khoản nhận tiền hoàn" để được chuyển nhanh.'}
      </Text>
      {onOpen && (
        <Button title={account ? 'Xem lịch sử thanh toán' : 'Khai tài khoản nhận tiền'} variant={account ? 'secondary' : 'primary'} icon="arrow-forward" style={{ marginTop: S.md }} onPress={onOpen} />
      )}
    </Card>
  );
}

/** Lịch sử đặt chỗ & thanh toán của khách — các khoản đã trả / đã hoàn / đang chờ, và đặt chỗ đã qua (huỷ thì kèm lý do + tiền hoàn). */
export function HistoryCard() {
  const { db, user } = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('payments');
  const [limit, setLimit] = useState(PAGE);
  const pending = usePendingPayouts();
  if (!user) return null;

  const payments = db.payments.filter((p) => p.customerId === user._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Khoản đã hoàn (một phần / toàn bộ) vẫn là tiền khách đã trả — phần hoàn nằm ở "Đã hoàn".
  const paid = payments.filter((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status) && p.direction === 'CHARGE' && p.method !== 'INTERNAL').reduce((s, p) => s + p.amount, 0);
  const refunded = payments.filter((p) => p.direction === 'REFUND' && p.status === 'SUCCEEDED').reduce((s, p) => s + p.amount, 0);
  const due = payments.filter((p) => p.direction === 'CHARGE' && (p.status === 'PENDING' || p.status === 'FAILED')).reduce((s, p) => s + p.amount, 0);
  const past = db.reservations.filter((r) => r.customerId === user._id && !LIVE_RESERVATION.includes(r.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows = tab === 'payments' ? payments : past;

  return (
    <Card style={{ marginTop: S.md }}>
      <Text style={st.title}>Lịch sử đặt chỗ & thanh toán</Text>
      <PayoutBanner style={{ marginTop: S.md }} />

      <View style={st.stats}>
        <Stat label="Đã thanh toán" value={vnd(paid)} color={C.green} />
        <Stat label="Chờ nhận hoàn" value={vnd(pending.total)} color={C.amber} />
        <Stat label="Đã hoàn" value={vnd(refunded)} color={C.violet} />
      </View>
      {due > 0 && <Muted style={{ marginTop: S.sm } as never}>Chưa thanh toán: {vnd(due)} — thanh toán ở màn hợp đồng hoặc đặt chỗ tương ứng.</Muted>}

      <View style={{ marginTop: S.md }}>
        <Chips options={TABS} value={tab} onChange={(v) => { setTab(v); setLimit(PAGE); }} columns={2} />
      </View>

      {tab === 'payments' && (payments.length === 0 ? <Muted style={{ marginTop: S.md } as never}>Chưa có khoản thanh toán nào.</Muted> : payments.slice(0, limit).map((p) => {
        const c = byId(db.contracts, p.contractId);
        const s = paymentStatusLabel(p);
        return (
          <View key={p._id} style={st.item}>
            <View style={st.rowBetween}>
              <StatusBadge map={PAYMENT_TYPE} value={p.type} />
              <Text style={[st.amount, p.direction === 'REFUND' && { color: C.violet }]}>{p.direction === 'REFUND' ? '+' : ''}{vnd(p.amount)}</Text>
            </View>
            <View style={[st.rowBetween, { marginTop: 4 }]}>
              <Muted style={{ flex: 1 } as never}>
                {fmtDateTime(p.paidAt ?? p.createdAt)} · {PAYMENT_METHOD[p.method]}
                {c ? ` · kho ${unitLabel(db, c.unitId)}` : ''} · {facilityName(db, p.facilityId)}
              </Muted>
              <Badge tone={s.tone}>{s.label}</Badge>
            </View>
            {p.period && <Muted>Kỳ {fmtDate(p.period.start)} – {fmtDate(p.period.end)}</Muted>}
            {p.payout && <Muted>Đã chuyển khoản · mã giao dịch {p.payout.reference}</Muted>}
          </View>
        );
      }))}

      {tab === 'reservations' && (past.length === 0 ? <Muted style={{ marginTop: S.md } as never}>Chưa có đặt chỗ nào đã kết thúc hoặc đã huỷ.</Muted> : past.slice(0, limit).map((r) => {
        // Khoản hoàn của lần huỷ này (nếu có) — để khách thấy tiền đã về hay đang chờ chuyển khoản.
        const refundPay = r.status === 'CANCELLED' ? db.payments.find((p) => p.reservationId === r._id && p.direction === 'REFUND') : undefined;
        return (
          <Pressable key={r._id} style={st.item} onPress={() => router.push(`/booking/${r._id}`)} accessibilityRole="button">
            <View style={st.rowBetween}>
              <Text style={st.code}>{r.code}</Text>
              <StatusBadge map={RESERVATION_STATUS} value={r.status} />
            </View>
            <Muted style={{ marginTop: 4 } as never}>
              {typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)} · nhận {fmtDate(r.startDate)} · {periodLabel(r.quote.rentalPeriod, r.periods)}
            </Muted>
            {r.status === 'CANCELLED' && r.cancellation && (
              <>
                <Text style={[st.small, { color: C.text, marginTop: 4 }]}>
                  Huỷ {fmtDate(r.cancellation.cancelledAt)} · lý do: {CANCELLATION_REASON[r.cancellation.reason]}{r.cancellation.note ? ` (${r.cancellation.note})` : ''}
                </Text>
                <Text style={[st.small, { color: r.cancellation.refundAmount > 0 ? C.violet : C.muted }]}>
                  {r.depositPaymentId
                    ? `Hoàn ${vnd(r.cancellation.refundAmount)} / ${vnd(dueAtBooking(r.quote))} đã trả khi đặt${refundPay ? ` · ${paymentStatusLabel(refundPay).label.toLowerCase()}` : ''}`
                    : 'Chưa trả tiền nên không có khoản hoàn'}
                </Text>
              </>
            )}
          </Pressable>
        );
      }))}

      {rows.length > limit && (
        <Button title={`Xem thêm (${rows.length - limit})`} variant="ghost" icon="chevron-down" style={{ marginTop: S.sm }} onPress={() => setLimit((n) => n + PAGE)} />
      )}
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={st.stat}>
      <Text style={st.statLabel} numberOfLines={1}>{label}</Text>
      <Text style={[st.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  small: { fontSize: 13, lineHeight: 18 },
  stats: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
  stat: { flex: 1, backgroundColor: C.bg, borderRadius: R.md, padding: S.sm, borderWidth: 1, borderColor: C.line },
  statLabel: { fontSize: 11, color: C.muted },
  statValue: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  item: { marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.line },
  amount: { fontSize: 15, fontWeight: '800', color: C.ink },
  code: { fontSize: 14, fontWeight: '700', color: C.ink, letterSpacing: 0.4 },
});
