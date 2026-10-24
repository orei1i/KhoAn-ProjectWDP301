import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { PaymentMethod } from '@ssm/shared';
import { PAYMENT_METHOD, PERIOD_UNIT, RESERVATION_STATUS, cancellationRefundOf, dueAtBooking, fmtDate, lastDayOf, minutesLeft, periodLabel, vnd } from '@ssm/shared';
import { byId, effectivePolicy, facilityName, typeName, useStore } from '../../shared/store/store';
import { Button, Card, Chips, EmptyState, KV, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, S } from '../../shared/ui/theme';
import { ContractSignCard } from '../contracts/contract-sign-card';
import { PaymentSchedule } from './payment-schedule';

const METHODS: { value: PaymentMethod; label: string }[] = (['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'] as PaymentMethod[])
  .map((v) => ({ value: v, label: PAYMENT_METHOD[v] }));

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');
  // Đếm ngược thời gian giữ chỗ — tick lại mỗi 15s để đồng bộ với đồng hồ server, không cần chính xác tới giây.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(t); }, []);

  const r = byId(db.reservations, id);
  if (!r) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title="Không tìm thấy đặt chỗ"
          description="Đặt chỗ có thể đã bị hủy hoặc không thuộc tài khoản này."
          action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const left = minutesLeft(r.holdExpiresAt);
  // Huỷ đặt chỗ ĐÃ trả tiền: báo trước % và số tiền hoàn theo bậc huỷ của chính sách đã chốt lúc đặt (không có thì chính sách đang
  // áp dụng của chi nhánh) — cùng công thức với server, rồi mới gửi.
  const askCancel = () => {
    const policy = db.policies.find((p) => p._id === r.quote.policyId) ?? effectivePolicy(db, r.facilityId);
    const refund = cancellationRefundOf(r, policy?.cancellation ?? []);
    confirmAction(
      'Huỷ đặt chỗ?',
      refund.pct > 0
        ? `Theo chính sách huỷ, bạn được hoàn ${refund.pct}% số tiền đã trả khi đặt chỗ (${vnd(dueAtBooking(r.quote))}): ${vnd(refund.amount)}. Tiền hoàn tối đa trong 7 ngày làm việc.`
        : `Theo chính sách huỷ, huỷ lúc này không được hoàn tiền (0% của ${vnd(dueAtBooking(r.quote))} đã trả khi đặt chỗ).`,
      'Xác nhận huỷ',
      () => void run('cancelReservation', { reservationId: r._id }, (v) => `Đã hủy — hoàn ${vnd(v)}`, () => router.back()),
    );
  };

  return (
    <Screen>
      <ScreenHeader title={`Đặt chỗ ${r.code}`} right={<StatusBadge map={RESERVATION_STATUS} value={r.status} />} />

      <Card>
        <KV items={[
          ['Chi nhánh', facilityName(db, r.facilityId)],
          ['Loại kho', typeName(db, r.unitTypeId)],
          ['Ngày nhận', fmtDate(r.startDate)],
          ['Thời hạn', `${periodLabel(r.quote.rentalPeriod, r.periods)} (đến hết ngày ${fmtDate(lastDayOf(r.endDate))})`],
          [`Tiền thuê / ${PERIOD_UNIT[r.quote.rentalPeriod]}`, vnd(r.quote.firstPeriodRent)],
          ['Tiền giữ chân (trả khi đặt chỗ)', vnd(r.quote.depositAmount)],
          ...(r.quote.firstPeriodAtBooking ? [[`Tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu (trả khi đặt chỗ)`, vnd(r.quote.firstPeriodRent)] as [string, string]] : []),
        ]} />
      </Card>

      {(r.status === 'PENDING' || r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && (
        <View style={{ marginTop: S.md }}><PaymentSchedule quotes={[r.quote]} paid={r.status !== 'PENDING'} /></View>
      )}

      {r.status === 'PENDING' && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.rowBetween}>
            <Text style={st.sectionTitle}>Thanh toán giữ chỗ</Text>
            <View style={[st.timer, left <= 5 && { backgroundColor: C.redBg }]}>
              <Text style={[st.timerText, left <= 5 && { color: C.red }]}>Còn {left} phút</Text>
            </View>
          </View>
          <View style={{ marginTop: S.md }}>
            <Chips options={METHODS} value={method} onChange={setMethod} columns={2} />
          </View>
          <Button
            title={`Thanh toán ${vnd(dueAtBooking(r.quote))}`}
            style={{ marginTop: S.lg }}
            onPress={() => void run('payDeposit', { reservationId: r._id, method }, 'Thanh toán thành công — ký hợp đồng để nhận kho')}
          />
          <Button
            title="Hủy giữ chỗ"
            variant="ghost"
            style={{ marginTop: S.sm }}
            onPress={() => void run('cancelReservation', { reservationId: r._id }, (v) => `Đã hủy giữ chỗ — hoàn ${vnd(v)}`, () => router.back())}
          />
        </Card>
      )}

      {(r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && <ContractSignCard reservation={r} />}

      {(r.status === 'CONFIRMED' || r.status === 'ALLOCATED') && (
        <Card style={{ marginTop: S.md }}>
          <Text style={{ color: C.green, fontWeight: '700' }}>Đặt chỗ đã được xác nhận</Text>
          <Muted style={{ marginTop: 6 } as never}>
            Đưa mã QR cho nhân viên tại quầy vào ngày {fmtDate(r.startDate)} để nhận kho.{r.signature ? '' : ' Bạn cần ký hợp đồng ở trên trước khi nhận kho.'}
          </Muted>
          <Button title="Xem mã nhận kho" icon="qr-code-outline" style={{ marginTop: S.lg }} onPress={() => router.push(`/qr/${r._id}`)} />
          <Button title="Hủy đặt chỗ" variant="ghost" style={{ marginTop: S.sm }} onPress={askCancel} />
        </Card>
      )}

      {(r.status === 'CANCELLED' || r.status === 'CHECKED_IN' || r.status === 'COMPLETED') && (
        <Card style={{ marginTop: S.md }}>
          <Muted>
            {r.status === 'CANCELLED'
              ? `Đặt chỗ đã hủy. Số tiền hoàn: ${vnd(r.cancellation?.refundAmount ?? 0)}.`
              : 'Bạn đã nhận kho. Quản lý hợp đồng ở tab Kho của tôi.'}
          </Muted>
          <Button title="Quay lại" variant="secondary" style={{ marginTop: S.lg }} onPress={() => router.back()} />
        </Card>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  timer: { backgroundColor: C.amberBg, paddingHorizontal: S.sm + 2, paddingVertical: 4, borderRadius: 999 },
  timerText: { fontSize: 12, fontWeight: '600', color: C.amber },
});
