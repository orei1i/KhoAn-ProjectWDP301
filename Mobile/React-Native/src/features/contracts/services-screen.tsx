import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { PaymentMethod, ServiceOffering } from '@ssm/shared';
import { PAYMENT_METHOD, SERVICE_ORDER_STATUS, addDays, fmtDate, todayISO, vnd } from '@ssm/shared';
import { byId, facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, Chips, DateStepper, EmptyState, Field, Input, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

const METHODS: { value: PaymentMethod; label: string }[] = (['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'] as PaymentMethod[])
  .map((v) => ({ value: v, label: PAYMENT_METHOD[v] }));

/** Dịch vụ thêm sau khi thuê: giá riêng từng chi nhánh, trả tiền ngay khi đặt, huỷ trước khi thực hiện được hoàn đủ. */
export default function ServicesScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [picked, setPicked] = useState<ServiceOffering | null>(null);
  const [qty, setQty] = useState('1');
  const [date, setDate] = useState(addDays(todayISO(), 2));
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');

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
  const canOrder = c.status === 'ACTIVE';

  return (
    <Screen>
      <ScreenHeader title="Dịch vụ thêm" subtitle={`Kho ${unitLabel(db, c.unitId)} · ${facilityName(db, c.facilityId)}`} />
      {!canOrder && <Card><Muted>Chỉ đặt được dịch vụ khi hợp đồng đang hiệu lực và không có công nợ.</Muted></Card>}

      {offerings.length === 0 ? (
        <Card><Muted>Chi nhánh chưa có dịch vụ thêm.</Muted></Card>
      ) : offerings.map((s) => (
        <Card key={s._id} style={{ marginTop: S.md }}>
          <Text style={st.name}>{s.name}</Text>
          {s.description ? <Muted style={{ marginTop: 2 } as never}>{s.description}</Muted> : null}
          <View style={st.rowBetween}>
            <Text style={st.price}>{vnd(s.price)} <Text style={st.unit}>/ {s.unitLabel}</Text></Text>
            <Button title={picked?._id === s._id ? 'Đang chọn' : 'Đặt'} variant="secondary" disabled={!canOrder} onPress={() => { setPicked(s); setQty('1'); setNote(''); }} />
          </View>
        </Card>
      ))}

      {picked && (
        <Card style={{ marginTop: S.lg }}>
          <Text style={st.name}>Đặt: {picked.name}</Text>
          <View style={{ marginTop: S.md }}>
            <Field label={`Số lượng (${picked.unitLabel})`}><Input value={qty} onChangeText={setQty} keyboardType="number-pad" /></Field>
            <DateStepper label="Ngày mong muốn" value={date} onChange={setDate} min={todayISO()} />
            <Field label="Ghi chú cho nhân viên"><Input value={note} onChangeText={setNote} placeholder="VD: giao buổi sáng, gọi trước khi đến" /></Field>
            <Chips options={METHODS} value={method} onChange={setMethod} columns={2} />
          </View>
          <Button
            title={`Thanh toán ${vnd(picked.price * quantity)}`}
            style={{ marginTop: S.lg }}
            onPress={() => void run('orderService', { contractId: c._id, serviceId: picked._id, quantity, preferredDate: date, note, method }, `Đã đặt và thanh toán ${vnd(picked.price * quantity)}`, () => setPicked(null))}
          />
        </Card>
      )}

      <Text style={st.section}>Đơn của tôi</Text>
      {orders.length === 0 ? <Card><Muted>Chưa có đơn dịch vụ.</Muted></Card> : orders.map((o) => (
        <Card key={o._id} style={{ marginTop: S.sm }}>
          <View style={st.rowBetween}>
            <Text style={st.name}>{o.serviceName} × {o.quantity}</Text>
            <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />
          </View>
          <Muted style={{ marginTop: 2 } as never}>{o.orderNumber} · {vnd(o.total)} · mong muốn {fmtDate(o.preferredDate)}</Muted>
          {o.status === 'CANCELLED' && <Muted style={{ marginTop: 2 } as never}>Đã hoàn {vnd(o.total)}</Muted>}
          {o.status === 'REQUESTED' && (
            <Button title="Huỷ đơn (hoàn đủ tiền)" variant="ghost" style={{ marginTop: S.sm }}
              onPress={() => void run('cancelServiceOrder', { orderId: o._id }, `Đã huỷ — hoàn ${vnd(o.total)}`)} />
          )}
        </Card>
      ))}
    </Screen>
  );
}

const st = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md, marginTop: S.sm },
  name: { fontSize: 15, fontWeight: '700', color: C.ink },
  price: { fontSize: 16, fontWeight: '700', color: C.ink },
  unit: { fontSize: 13, fontWeight: '400', color: C.muted },
  section: { fontSize: 16, fontWeight: '700', color: C.ink, marginTop: S.xl },
});
