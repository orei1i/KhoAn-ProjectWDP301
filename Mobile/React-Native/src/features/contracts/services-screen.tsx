import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ServiceOffering } from '@ssm/shared';
import { SERVICE_ORDER_STATUS, addDays, fmtDate, paymentStatusLabel, servicesAllowedFor, todayISO, vnd } from '@ssm/shared';
import { byId, facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Callout, Card, DateStepper, EmptyState, Field, IconTile, Input, Muted, Screen, ScreenHeader, SectionHeader, StatusBadge } from '../../shared/ui';
import { C, R, S, SHADOW, T } from '../../shared/ui/theme';
import { serviceIcon } from '../../shared/ui/visuals';
import { payHref } from '../payments/pay-intent';

/** Dịch vụ thêm sau khi thuê: giá riêng từng chi nhánh, trả tiền ngay khi đặt, huỷ trước khi thực hiện được hoàn đủ. */
export default function ServicesScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [picked, setPicked] = useState<ServiceOffering | null>(null);
  const [qty, setQty] = useState('1');
  const [date, setDate] = useState(addDays(todayISO(), 2));
  const [note, setNote] = useState('');

  const c = byId(db.contracts, contract);
  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  const offerings = db.services.filter((s) => s.facilityId === c.facilityId && s.isActive && !s.isDeleted).sort((a, b) => a.price - b.price);
  const orders = db.serviceOrders.filter((o) => o.contractId === c._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const quantity = Math.min(99, Math.max(1, Math.round(Number(qty) || 1)));
  // Đợt 15 (B4): chỉ kho từ cỡ Vừa trở lên đặt được dịch vụ thêm (server: 422 SERVICE_NOT_FOR_SIZE) — kho nhỏ chỉ xem / huỷ đơn cũ.
  const sizeOk = servicesAllowedFor(byId(db.unitTypes, c.unitTypeId)?.category ?? '');
  const canOrder = c.status === 'ACTIVE' && sizeOk;
  // Xong thao tác thì về màn Hợp đồng (lùi về nếu đang mở bên dưới, không thì thay màn này) để thấy trạng thái mới.
  const backToContract = () => router.dismissTo(`/contract/${c._id}`);

  return (
    <Screen footer={picked ? (
      // Trả ngay qua cổng thanh toán (giả lập) — đơn chỉ được tạo khi khách xác nhận thanh toán ở cổng.
      <Button
        title={`Thanh toán ${vnd(picked.price * quantity)}`}
        icon="card-outline"
        size="lg"
        onPress={() => router.push(payHref({
          target: { kind: 'SERVICE', contractId: c._id, serviceId: picked._id, quantity, preferredDate: date, note: note.trim() || undefined },
          facilityId: c.facilityId, code: c.contractNumber, purpose: `${picked.name} × ${quantity}`, amount: picked.price * quantity,
          doneNote: `Đơn chờ thực hiện ngày ${fmtDate(date)} — huỷ trước khi thực hiện được hoàn đủ.`,
          back: { label: 'Về hợp đồng', href: `/contract/${c._id}` },
        }))}
      />
    ) : undefined}>
      <ScreenHeader icon="construct-outline" tone="amber" title="Dịch vụ thêm" subtitle={`Kho ${unitLabel(db, c.unitId)} · ${facilityName(db, c.facilityId)}`} />
      {!canOrder && <Callout tone="amber" icon="lock-closed-outline" style={{ marginBottom: S.md }}>{sizeOk ? 'Chỉ đặt được dịch vụ khi hợp đồng đang hiệu lực và không có công nợ.' : 'Dịch vụ thêm chỉ áp dụng cho kho từ cỡ Vừa (M) trở lên.'}</Callout>}

      {offerings.length === 0 ? (
        <Card><EmptyState icon="construct-outline" title="Chi nhánh chưa có dịch vụ thêm." /></Card>
      ) : (
        <View style={{ gap: S.sm }}>
          {offerings.map((s) => {
            const on = picked?._id === s._id;
            return (
              <Pressable key={s._id} disabled={!canOrder} onPress={() => { setPicked(s); setQty('1'); setNote(''); }}
                accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !canOrder }}
                style={({ pressed }) => [st.offer, on && st.offerOn, !canOrder && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}>
                <IconTile icon={serviceIcon(s.code)} tone={on ? 'teal' : 'amber'} solid={on} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.name}>{s.name}</Text>
                  {s.description ? <Muted style={{ marginTop: 2 } as never}>{s.description}</Muted> : null}
                  <Text style={st.price}>{vnd(s.price)} <Text style={st.unit}>/ {s.unitLabel}</Text></Text>
                </View>
                <View style={[st.pick, on && st.pickOn]}>
                  {on ? <Ionicons name="checkmark" size={16} color={C.white} /> : <Text style={st.pickText}>Đặt</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {picked && (
        <Card style={{ marginTop: S.lg }}>
          <View style={st.head}>
            <IconTile icon="create-outline" size="sm" />
            <Text style={st.headTitle}>Đặt: {picked.name}</Text>
          </View>
          <Field label={`Số lượng (${picked.unitLabel})`}><Input value={qty} onChangeText={setQty} keyboardType="number-pad" /></Field>
          <DateStepper label="Ngày mong muốn" value={date} onChange={setDate} min={todayISO()} />
          <View style={{ marginTop: S.md }}>
            <Field label="Ghi chú cho nhân viên"><Input value={note} onChangeText={setNote} placeholder="VD: giao buổi sáng, gọi trước khi đến" /></Field>
          </View>
        </Card>
      )}

      <SectionHeader title="Đơn của tôi" icon="receipt-outline" count={orders.length || undefined} />
      {orders.length === 0 ? <Card><EmptyState icon="receipt-outline" title="Chưa có đơn dịch vụ." /></Card> : (
        <View style={{ gap: S.sm }}>
          {orders.map((o) => (
            <Card key={o._id}>
              <View style={st.orderRow}>
                <IconTile icon="cube-outline" tone="gray" size="sm" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={st.rowBetween}>
                    <Text style={[st.name, { flex: 1 }]}>{o.serviceName} × {o.quantity}</Text>
                    <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />
                  </View>
                  <Muted style={{ marginTop: 2 } as never}>{o.orderNumber} · {vnd(o.total)} · mong muốn {fmtDate(o.preferredDate)}</Muted>
                  {o.status === 'CANCELLED' && <Muted style={{ marginTop: 2 } as never}>{o.refundAtSettlement && !o.refundPaymentId ? `Hoàn ${vnd(o.total)} trong quyết toán trả kho` : o.refundAtSettlement ? 'Đã tính vào quyết toán trả kho' : (() => {
                    // Đợt VNPAY: khoản hoàn qua cổng còn chờ thì tiền chưa về — không ghi "đã hoàn".
                    const refund = byId(db.payments, o.refundPaymentId);
                    return refund?.status === 'PENDING' && refund.method === 'VNPAY' ? `${paymentStatusLabel(refund).label} · ${vnd(o.total)}` : `Đã hoàn ${vnd(o.total)}`;
                  })()}</Muted>}
                </View>
              </View>
              {o.status === 'REQUESTED' && (
                <Button title="Huỷ đơn (hoàn đủ tiền)" variant="ghost" size="sm" icon="close-circle-outline" style={{ marginTop: S.sm }}
                  onPress={() => void run('cancelServiceOrder', { orderId: o._id }, `Đã huỷ — hoàn ${vnd(o.total)}`, backToContract)} />
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  offer: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1.5, borderColor: C.line, padding: S.md, ...SHADOW.card },
  offerOn: { borderColor: C.brand600, backgroundColor: C.brand50 },
  pick: { minWidth: 56, height: 36, borderRadius: R.full, borderWidth: 1.5, borderColor: C.brand600, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.md },
  pickOn: { backgroundColor: C.brand700, borderColor: C.brand700 },
  pickText: { fontSize: 13, fontWeight: '700', color: C.brand700 },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md },
  headTitle: { ...T.h3, flex: 1 },
  orderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  name: { fontSize: 15, fontWeight: '700', color: C.ink },
  price: { fontSize: 15, fontWeight: '800', color: C.ink, marginTop: 4 },
  unit: { fontSize: 13, fontWeight: '400', color: C.muted },
});
