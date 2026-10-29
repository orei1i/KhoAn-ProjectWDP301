import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PERIOD_UNIT, RESERVATION_STATUS, SERVICE_ORDER_STATUS, bookingServicesDue, cancellationRefundOf, counterHoldText, dueAtBooking, dueAtCheckIn, fmtDate, fmtHoldUntil, lastDayOf, minutesLeft, periodLabel, rescheduleChangesLeft, rescheduleCheck, rescheduledEndDate, rescheduleWindow, vnd } from '@ssm/shared';
import { byId, effectivePolicy, facilityName, typeName, useStore } from '../../shared/store/store';
import { Button, Card, DateStepper, EmptyState, KV, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, S } from '../../shared/ui/theme';
import { ContractSignCard } from '../contracts/contract-sign-card';
import { PaymentSchedule } from './payment-schedule';
import { payHref } from './pay-intent';

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  // Đổi ngày nhận kho: null = đang đóng; mở thì giữ ngày đang chọn (ISO date-only).
  const [newDate, setNewDate] = useState<string | null>(null);
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
  // "Giữ chỗ, trả tại quầy": giữ ô tới holdExpiresAt (COUNTER_HOLD_HOURS giờ) — khách vẫn trả online sớm được qua cổng.
  const counter = r.status === 'PENDING' && !!r.payAtCounter && !!r.holdExpiresAt;
  const payNow = () => router.push(payHref({
    target: { kind: 'DEPOSIT', reservationId: r._id }, facilityId: r.facilityId, code: r.code,
    purpose: r.quote.firstPeriodAtBooking ? `Tiền giữ chân + thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu` : 'Tiền giữ chân',
    amount: dueAtBooking(r.quote),
    doneNote: 'Đặt chỗ đã được xác nhận — ký hợp đồng trước ngày nhận kho.',
    back: { label: 'Về đặt chỗ', href: `/booking/${r._id}` },
  }));
  const open = r.status === 'PENDING' || r.status === 'CONFIRMED' || r.status === 'ALLOCATED';
  // Dịch vụ chọn kèm lúc đặt: đơn riêng ngoài hợp đồng thuê, thu khi nhận kho — huỷ được trước khi nhận kho.
  const svcOrders = db.serviceOrders.filter((o) => String(o.reservationId ?? '') === r._id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const svcDue = bookingServicesDue(db.serviceOrders, r._id);
  const askCancelService = (o: (typeof svcOrders)[number]) => confirmAction(
    'Huỷ dịch vụ kèm?',
    `${o.serviceName} × ${o.quantity} — ${vnd(o.total)}. Chưa thu tiền nên không mất phí.`,
    'Huỷ đơn',
    () => void run('cancelServiceOrder', { orderId: o._id }, `Đã huỷ ${o.serviceName}`),
  );
  // Huỷ đặt chỗ ĐÃ trả tiền: báo trước % và số tiền hoàn theo bậc huỷ của chính sách đã chốt lúc đặt (không có thì chính sách đang
  // áp dụng của chi nhánh) — cùng công thức với server, rồi mới gửi.
  const askCancel = () => {
    const policy = db.policies.find((p) => p._id === r.quote.policyId) ?? effectivePolicy(db, r.facilityId);
    const refund = cancellationRefundOf(r, policy?.cancellation ?? []);
    confirmAction(
      'Huỷ đặt chỗ?',
      (refund.amount > 0
        ? `Theo chính sách huỷ, bạn được hoàn ${refund.pct}% tiền giữ chân${refund.prepaidRentRefund > 0 ? ' và hoàn đủ tiền thuê tháng đầu đã trả trước' : ''}: tổng ${vnd(refund.amount)}. Tiền hoàn tối đa trong 7 ngày làm việc.`
        : `Theo chính sách huỷ, huỷ lúc này không được hoàn tiền giữ chân (${vnd(r.quote.depositAmount)}).`)
        + (svcDue > 0 ? ' Dịch vụ kèm cũng bị huỷ.' : ''),
      'Xác nhận huỷ',
      () => void run('cancelReservation', { reservationId: r._id }, (v) => `Đã hủy — hoàn ${vnd(v)}`, () => router.back()),
    );
  };

  // Đổi ngày nhận kho trong cửa sổ cho phép — cùng quy tắc với server (shared). Không còn ngày nào hợp lệ thì ẩn nút.
  const win = rescheduleWindow(r);
  const canMove = rescheduleCheck(r, win.min).ok || rescheduleCheck(r, win.max).ok;
  const moveCheck = newDate ? rescheduleCheck(r, newDate) : null;
  const openMove = () => setNewDate(r.startDate < win.min ? win.min : r.startDate > win.max ? win.max : r.startDate);

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
          ...(open ? [['Trả thêm khi nhận kho', dueAtCheckIn(r.quote) + svcDue > 0 ? vnd(dueAtCheckIn(r.quote) + svcDue) : 'Không'] as [string, string]] : []),
        ]} />
      </Card>

      {open && (
        <View style={{ marginTop: S.md }}><PaymentSchedule quotes={[r.quote]} paid={r.status !== 'PENDING'} /></View>
      )}

      {svcOrders.length > 0 && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Dịch vụ kèm</Text>
          {svcOrders.map((o) => (
            <View key={o._id} style={st.svcRow}>
              <View style={st.rowBetween}>
                <Text style={st.svcName}>{o.serviceName} × {o.quantity}</Text>
                <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />
              </View>
              <Muted>{o.orderNumber} · {vnd(o.total)}</Muted>
              {open && o.status === 'REQUESTED' && !o.paymentId && (
                <Button title="Huỷ đơn" variant="ghost" style={{ marginTop: S.xs }} onPress={() => askCancelService(o)} />
              )}
            </View>
          ))}
          {svcDue > 0 && <Text style={st.svcDue}>Thanh toán khi nhận kho: {vnd(svcDue)} (đơn riêng, ngoài hợp đồng thuê)</Text>}
        </Card>
      )}

      {r.status === 'PENDING' && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.rowBetween}>
            <Text style={st.sectionTitle}>{counter ? 'Trả tại quầy' : 'Thanh toán giữ chỗ'}</Text>
            <View style={[st.timer, left <= 5 && { backgroundColor: C.redBg }]}>
              <Text style={[st.timerText, left <= 5 && { color: C.red }]}>{counter ? `Giữ đến ${fmtHoldUntil(r.holdExpiresAt!)}` : `Còn ${left} phút`}</Text>
            </View>
          </View>
          {counter && (
            <>
              <Text style={st.counter}>{counterHoldText(r.holdExpiresAt!)}.</Text>
              <Muted style={{ marginTop: S.sm } as never}>Trả tại quầy {vnd(dueAtBooking(r.quote))} · đọc mã {r.code} cho nhân viên.</Muted>
            </>
          )}
          {/* Trả online qua cổng thanh toán (giả lập); đặt chỗ trả tại quầy vẫn trả sớm online được. */}
          <Button
            title={counter ? `Thanh toán online ${vnd(dueAtBooking(r.quote))}` : `Thanh toán ${vnd(dueAtBooking(r.quote))}`}
            variant={counter ? 'secondary' : 'primary'}
            style={{ marginTop: S.lg }}
            onPress={payNow}
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
            Đưa mã QR cho nhân viên tại quầy vào ngày {fmtDate(r.startDate)} để nhận kho.
          </Muted>
          <Button title="Xem mã nhận kho" icon="qr-code-outline" style={{ marginTop: S.lg }} onPress={() => router.push(`/qr/${r._id}`)} />
          {canMove && !newDate && <Button title="Đổi ngày nhận kho" icon="calendar-outline" variant="secondary" style={{ marginTop: S.sm }} onPress={openMove} />}
          {newDate && (
            <View style={st.moveBox}>
              <DateStepper label={`Ngày nhận mới · còn đổi ${rescheduleChangesLeft(r)} lần`} value={newDate} onChange={setNewDate} min={win.min} max={win.max} />
              {moveCheck?.ok
                ? <Muted style={{ marginTop: S.sm } as never}>Kết thúc: hết ngày {fmtDate(lastDayOf(rescheduledEndDate(r, newDate)))}</Muted>
                : moveCheck && moveCheck.code !== 'RESCHEDULE_SAME' ? <Muted style={{ marginTop: S.sm } as never}>{moveCheck.message}</Muted> : null}
              {r.signature && <Text style={st.warn}>Đổi ngày thì phải ký lại hợp đồng.</Text>}
              <Button
                title="Xác nhận đổi"
                disabled={!moveCheck?.ok}
                style={{ marginTop: S.md }}
                onPress={() => void run('rescheduleReservation', { reservationId: r._id, startDate: newDate }, (v) => `Đã đổi ngày nhận kho sang ${fmtDate(v.startDate)}`, () => setNewDate(null))}
              />
              <Button title="Đóng" variant="ghost" style={{ marginTop: S.xs }} onPress={() => setNewDate(null)} />
            </View>
          )}
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
  svcRow: { marginTop: S.sm, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, gap: 2 },
  svcName: { flex: 1, fontSize: 14, fontWeight: '600', color: C.ink },
  moveBox: { marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.line },
  warn: { marginTop: S.sm, fontSize: 13, fontWeight: '600', color: C.amber, backgroundColor: C.amberBg, borderRadius: 12, padding: S.sm },
  svcDue: { marginTop: S.md, fontSize: 13, fontWeight: '700', color: C.ink, backgroundColor: C.fill, borderRadius: 12, padding: S.sm },
  counter: { marginTop: S.md, fontSize: 13, fontWeight: '600', color: C.violet, backgroundColor: C.violetBg, borderRadius: 12, padding: S.sm, lineHeight: 19 },
});
