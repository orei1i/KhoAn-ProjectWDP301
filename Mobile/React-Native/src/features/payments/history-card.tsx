import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  CANCELLATION_REASON, COLLECTED_PAYMENT_STATUSES, CONTRACT_STATUS, PAYMENT_METHOD, PAYMENT_TYPE, RESERVATION_STATUS, depositSettlementText, dueAtBooking, fmtDate, fmtDateTime, isClosedContract,
  paymentMethodLabel, paymentStatusLabel, periodLabel, vnd, type RentalContract,
} from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Callout, Card, Chips, EmptyState, IconTile, Muted, StatusBadge } from '../../shared/ui';
import { C, R, S, T, TOUCH } from '../../shared/ui/theme';
import { hasReceipt, useReceipt } from './receipt';

type Tab = 'payments' | 'rentals' | 'reservations';
// Góp ý 17/11: thêm "Kho đã thuê" — hợp đồng đã kết thúc (trả kho / đóng sau xử lý đồ bỏ lại), trang chủ ẩn đi sau khi hết các hạn khiếu nại / bồi thường.
const TABS: { value: Tab; label: string }[] = [{ value: 'payments', label: 'Thanh toán' }, { value: 'rentals', label: 'Kho đã thuê' }, { value: 'reservations', label: 'Đặt chỗ cũ' }]; // "Đặt chỗ đã qua" — rút gọn để vừa 3 cột ở màn 360px
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
    <Callout
      tone="amber" icon="cash-outline" style={style}
      title={`KhoAn đang chuẩn bị chuyển khoản hoàn ${vnd(total)} cho bạn`}
      action={onOpen ? (
        <Button title={account ? 'Xem lịch sử thanh toán' : 'Khai tài khoản nhận tiền'} variant={account ? 'secondary' : 'primary'} size="sm" iconRight="arrow-forward" onPress={onOpen} />
      ) : undefined}
    >
      {account
        ? `Tài khoản nhận: ${account.bankName} · ••••${account.accountNumber.slice(-4)}. Đổi tài khoản ở tab Tài khoản → thẻ Thông tin cá nhân → Sửa thông tin.`
        : 'Bạn chưa khai tài khoản nhận tiền — khai ở tab Tài khoản → thẻ Thông tin cá nhân → Sửa thông tin → "Tài khoản nhận tiền hoàn" để được chuyển nhanh.'}
    </Callout>
  );
}

/** Ngày kết thúc thật của hợp đồng đã đóng: ngày bàn giao lại ô, không có thì ngày đóng, cuối cùng là hạn hợp đồng. */
const endedOn = (c: RentalContract) => c.moveOut?.returnedOn ?? c.closedAt ?? c.endDate;

/**
 * Lịch sử đặt chỗ & thanh toán của khách — các khoản đã trả / đã hoàn / đang chờ, kho đã thuê (hợp đồng đã kết thúc, mở được màn hợp đồng: biên bản trả kho,
 * tiền giữ chân, PDF / email, bồi thường) và đặt chỗ đã qua (huỷ thì kèm lý do + tiền hoàn; đã thành hợp đồng thì mở hợp đồng).
 */
export function HistoryCard() {
  const { db, user } = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('payments');
  const [limit, setLimit] = useState(PAGE);
  const { opening, open: openReceipt } = useReceipt();
  const pending = usePendingPayouts();
  if (!user) return null;

  const payments = db.payments.filter((p) => p.customerId === user._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Khoản đã hoàn (một phần / toàn bộ) vẫn là tiền khách đã trả — phần hoàn nằm ở "Đã hoàn".
  const paid = payments.filter((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status) && p.direction === 'CHARGE' && p.method !== 'INTERNAL').reduce((s, p) => s + p.amount, 0);
  const refunded = payments.filter((p) => p.direction === 'REFUND' && p.status === 'SUCCEEDED').reduce((s, p) => s + p.amount, 0);
  const due = payments.filter((p) => p.direction === 'CHARGE' && (p.status === 'PENDING' || p.status === 'FAILED')).reduce((s, p) => s + p.amount, 0);
  // Đợt VNPAY: khoản hoàn qua cổng còn PENDING là tiền chưa về — tính vào "Chờ nhận hoàn", không phải "Đã hoàn". Banner chuyển khoản không nói tới khoản này.
  const gatewayRefunding = payments.filter((p) => p.direction === 'REFUND' && p.status === 'PENDING' && p.method === 'VNPAY').reduce((s, p) => s + p.amount, 0);
  const past = db.reservations.filter((r) => r.customerId === user._id && !LIVE_RESERVATION.includes(r.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rentals = db.contracts.filter((c) => c.customerId === user._id && isClosedContract(c.status)).sort((a, b) => endedOn(b).localeCompare(endedOn(a)));
  const rows = tab === 'payments' ? payments : tab === 'rentals' ? rentals : past;
  /** Đặt chỗ đã nhận kho (đã thành hợp đồng) → mở màn hợp đồng; còn lại mở màn đặt chỗ. */
  const contractOf = (r: (typeof past)[number]) => (r.contractId ? byId(db.contracts, r.contractId) : undefined) ?? db.contracts.find((c) => c.reservationId === r._id);

  return (
    <Card style={{ marginTop: S.md }}>
      <View style={st.head}>
        <IconTile icon="receipt-outline" />
        <Text style={st.title}>Lịch sử đặt chỗ & thanh toán</Text>
      </View>
      <PayoutBanner style={{ marginTop: S.md }} />

      {/* Góp ý 18/11: ba ô một hàng ở máy 390px cắt mất số tiền (bản web không có adjustsFontSizeToFit) — "Đã thanh toán" (số lớn nhất)
          một hàng riêng, hai ô còn lại chia đôi hàng dưới. */}
      <View style={st.stats}>
        <Stat label="Đã thanh toán" value={vnd(paid)} color={C.green} icon="checkmark-circle-outline" wide />
        <Stat label="Chờ nhận hoàn" value={vnd(pending.total + gatewayRefunding)} color={C.amber} icon="hourglass-outline" />
        <Stat label="Đã hoàn" value={vnd(refunded)} color={C.violet} icon="arrow-undo-outline" />
      </View>
      {due > 0 && <Muted style={{ marginTop: S.sm } as never}>Chưa thanh toán: {vnd(due)} — thanh toán ở màn hợp đồng hoặc đặt chỗ tương ứng.</Muted>}
      {gatewayRefunding > 0 && <Muted style={{ marginTop: S.sm } as never}>Đang hoàn {vnd(gatewayRefunding)} qua VNPAY về phương thức bạn đã trả — thời gian tiền về tuỳ ngân hàng.</Muted>}

      <View style={{ marginTop: S.md }}>
        <Chips options={TABS} value={tab} onChange={(v) => { setTab(v); setLimit(PAGE); }} columns={3} />
      </View>

      {tab === 'payments' && (payments.length === 0 ? <EmptyState icon="wallet-outline" title="Chưa có khoản thanh toán nào." /> : payments.slice(0, limit).map((p) => {
        const c = byId(db.contracts, p.contractId);
        const s = paymentStatusLabel(p);
        const refund = p.direction === 'REFUND';
        return (
          <View key={p._id} style={st.item}>
            <View style={st.itemRow}>
              <IconTile icon={refund ? 'arrow-undo' : 'card-outline'} tone={refund ? 'violet' : 'gray'} size="sm" />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={st.rowBetween}>
                  <StatusBadge map={PAYMENT_TYPE} value={p.type} />
                  <Text style={[st.amount, refund && { color: C.violet }]}>{refund ? '+' : ''}{vnd(p.amount)}</Text>
                </View>
                <View style={st.rowBetween}>
                  <Muted style={{ flex: 1 } as never}>
                    {fmtDateTime(p.paidAt ?? p.createdAt)} · {paymentMethodLabel(p) ?? PAYMENT_METHOD[p.method]}
                    {c ? ` · kho ${unitLabel(db, c.unitId)}` : ''} · {facilityName(db, p.facilityId)}
                  </Muted>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </View>
                {p.period && <Muted>Kỳ {fmtDate(p.period.start)} – {fmtDate(p.period.end)}</Muted>}
                {p.payout && <Muted>Đã chuyển khoản · mã giao dịch {p.payout.reference}</Muted>}
                {hasReceipt(p) && (
                  <Pressable onPress={() => void openReceipt(p._id)} disabled={opening !== null} accessibilityRole="button" style={({ pressed }) => [st.receipt, pressed && { opacity: 0.7 }]}>
                    <Ionicons name="document-text-outline" size={15} color={C.brand700} />
                    <Text style={st.receiptText}>{opening === p._id ? 'Đang mở biên lai…' : 'Biên lai PDF'}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        );
      }))}

      {tab === 'rentals' && (rentals.length === 0 ? <EmptyState icon="cube-outline" title="Chưa có kho nào đã trả." /> : rentals.slice(0, limit).map((c) => {
        const settled = depositSettlementText(c.deposit);
        return (
          <Pressable key={c._id} style={({ pressed }) => [st.item, pressed && { opacity: 0.7 }]} onPress={() => router.push(`/contract/${c._id}`)} accessibilityRole="button"
            accessibilityLabel={`Kho ${unitLabel(db, c.unitId)}, ${facilityName(db, c.facilityId)}, hợp đồng ${c.contractNumber}`}>
            <View style={st.itemRow}>
              <IconTile icon="cube-outline" tone={c.balance.outstanding > 0 ? 'red' : 'gray'} size="sm" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={st.rowBetween}>
                  <Text style={st.code} numberOfLines={1}>Kho {unitLabel(db, c.unitId)} · {typeName(db, c.unitTypeId)}</Text>
                  <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                </View>
                <Muted style={{ marginTop: 4 } as never}>{facilityName(db, c.facilityId)} · {fmtDate(c.startDate)} → {fmtDate(endedOn(c))}</Muted>
                {c.balance.outstanding > 0
                  ? <Text style={[st.small, { color: C.red, fontWeight: '700', marginTop: 4 }]}>Còn nợ {vnd(c.balance.outstanding)}</Text>
                  : <Text style={[st.small, { color: c.deposit.refundedAmount > 0 ? C.violet : C.muted, marginTop: 4 }]}>Tiền giữ chân {vnd(c.deposit.amount)}{settled ? ` · ${settled}` : ''}</Text>}
                <Muted style={{ marginTop: 2 } as never}>{c.contractNumber}</Muted>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.faint} />
            </View>
          </Pressable>
        );
      }))}

      {tab === 'reservations' && (past.length === 0 ? <EmptyState icon="calendar-outline" title="Chưa có đặt chỗ nào đã kết thúc hoặc đã huỷ." /> : past.slice(0, limit).map((r) => {
        // Khoản hoàn của lần huỷ này (nếu có) — để khách thấy tiền đã về hay đang chờ chuyển khoản.
        const refundPay = r.status === 'CANCELLED' ? db.payments.find((p) => p.reservationId === r._id && p.direction === 'REFUND') : undefined;
        const ctr = contractOf(r);
        return (
          <Pressable key={r._id} style={({ pressed }) => [st.item, pressed && { opacity: 0.7 }]} onPress={() => router.push(ctr ? `/contract/${ctr._id}` : `/booking/${r._id}`)} accessibilityRole="button">
            <View style={st.itemRow}>
              <IconTile icon="calendar-outline" tone={r.status === 'CANCELLED' ? 'red' : 'gray'} size="sm" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={st.rowBetween}>
                  <Text style={st.code}>{r.code}</Text>
                  <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                </View>
                <Muted style={{ marginTop: 4 } as never}>
                  {typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)} · nhận {fmtDate(r.startDate)} · {periodLabel(r.quote.rentalPeriod, r.periods)}
                </Muted>
                {ctr && <Text style={[st.small, { color: C.brand700, fontWeight: '700', marginTop: 4 }]}>Hợp đồng {ctr.contractNumber} · {CONTRACT_STATUS[ctr.status].label.toLowerCase()}</Text>}
                {r.status === 'CANCELLED' && r.cancellation && (
                  <>
                    <Text style={[st.small, { color: C.text, marginTop: 4 }]}>
                      Huỷ {fmtDate(r.cancellation.cancelledAt)} · lý do: {CANCELLATION_REASON[r.cancellation.reason]}{r.cancellation.note ? ` (${r.cancellation.note})` : ''}
                    </Text>
                    <Text style={[st.small, { color: r.cancellation.refundAmount > 0 ? C.violet : C.muted }]}>
                      {r.depositPaymentId
                        ? `Hoàn ${vnd(r.cancellation.refundAmount)} / ${vnd(dueAtBooking(r.quote) + db.serviceOrders.filter((o) => String(o.reservationId ?? '') === r._id && !!o.paymentId).reduce((s, o) => s + o.total, 0))} đã trả khi đặt${refundPay ? ` · ${refundPay.method === 'VNPAY' ? paymentStatusLabel(refundPay).label : paymentStatusLabel(refundPay).label.toLowerCase()}` : ''}`
                        : 'Chưa trả tiền nên không có khoản hoàn'}
                    </Text>
                  </>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.faint} />
            </View>
          </Pressable>
        );
      }))}

      {rows.length > limit && (
        <Button title={`Xem thêm (${rows.length - limit})`} variant="ghost" icon="chevron-down" style={{ marginTop: S.sm }} onPress={() => setLimit((n) => n + PAGE)} />
      )}
    </Card>
  );
}

function Stat({ label, value, color, icon, wide = false }: { label: string; value: string; color: string; icon: keyof typeof Ionicons.glyphMap; wide?: boolean }) {
  return (
    <View style={[st.stat, wide && st.statWide]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={13} color={color} />
        <Text style={st.statLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[st.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  title: { ...T.h3, flex: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  small: { fontSize: 13, lineHeight: 18 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.md },
  stat: { flexGrow: 1, flexBasis: '40%', minWidth: 0, backgroundColor: C.bg, borderRadius: R.md, padding: S.sm + 2, borderWidth: 1, borderColor: C.lineSoft },
  statWide: { flexBasis: '100%' },
  statLabel: { fontSize: 11, color: C.muted, flexShrink: 1 },
  statValue: { fontSize: 14, fontWeight: '800', marginTop: 4, ...T.tabular },
  item: { marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  amount: { fontSize: 15, fontWeight: '800', color: C.ink, ...T.tabular },
  code: { fontSize: 14, fontWeight: '700', color: C.ink, letterSpacing: 0.4 },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: TOUCH, paddingHorizontal: S.md, marginTop: 2, borderRadius: R.sm, backgroundColor: C.brand50 },
  receiptText: { fontSize: 13, fontWeight: '700', color: C.brand700 },
});
