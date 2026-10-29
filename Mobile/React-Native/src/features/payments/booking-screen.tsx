import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PERIOD_UNIT, RESERVATION_STATUS, SERVICE_ORDER_STATUS, bookingServicesDue, cancellationRefundOf, counterHoldText, dueAtBooking, dueAtCheckIn, fmtDate, fmtHoldUntil, lastDayOf, minutesLeft, periodLabel, rescheduleChangesLeft, rescheduleCheck, rescheduledEndDate, rescheduleWindow, vnd } from '@ssm/shared';
import { byId, effectivePolicy, facilityName, typeName, useStore } from '../../shared/store/store';
import { Button, Callout, Card, Chip, DateStepper, EmptyState, IconTile, KV, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, R, S, T } from '../../shared/ui/theme';
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

  const confirmed = r.status === 'CONFIRMED' || r.status === 'ALLOCATED';
  const [dd, mm] = fmtDate(r.startDate).split('/');
  const footer = r.status === 'PENDING' ? (
    // Trả online qua cổng thanh toán (giả lập); đặt chỗ trả tại quầy vẫn trả sớm online được.
    <Button
      title={counter ? `Thanh toán online ${vnd(dueAtBooking(r.quote))}` : `Thanh toán ${vnd(dueAtBooking(r.quote))}`}
      variant={counter ? 'secondary' : 'primary'}
      icon="card-outline"
      size="lg"
      onPress={payNow}
    />
  ) : confirmed ? (
    <Button title="Xem mã nhận kho" icon="qr-code-outline" size="lg" onPress={() => router.push(`/qr/${r._id}`)} />
  ) : undefined;

  return (
    <Screen footer={footer}>
      <ScreenHeader icon="calendar-outline" tone="blue" title={`Đặt chỗ ${r.code}`} subtitle={facilityName(db, r.facilityId)} right={<StatusBadge map={RESERVATION_STATUS} value={r.status} />} />

      <Card>
        <View style={st.summary}>
          <View style={st.dateTile}>
            <Text style={st.dateDay}>{dd}</Text>
            <Text style={st.dateMonth}>TH{Number(mm)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.sectionTitle}>{typeName(db, r.unitTypeId)}</Text>
            <Text style={T.small}>Nhận kho {fmtDate(r.startDate)} · {periodLabel(r.quote.rentalPeriod, r.periods)}</Text>
          </View>
        </View>
        <View style={st.divider} />
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

      {r.status === 'PENDING' && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.rowBetween}>
            <View style={st.titleRow}>
              <IconTile icon={counter ? 'storefront-outline' : 'hourglass-outline'} tone={counter ? 'violet' : 'amber'} size="sm" />
              <Text style={st.sectionTitle}>{counter ? 'Trả tại quầy' : 'Thanh toán giữ chỗ'}</Text>
            </View>
            <Chip tone={left <= 5 ? 'red' : 'amber'} icon="time-outline">{counter ? `Giữ đến ${fmtHoldUntil(r.holdExpiresAt!)}` : `Còn ${left} phút`}</Chip>
          </View>
          {counter && (
            <>
              <Callout tone="violet" icon="storefront-outline" style={{ marginTop: S.md }}>{counterHoldText(r.holdExpiresAt!)}.</Callout>
              <Muted style={{ marginTop: S.sm } as never}>Trả tại quầy {vnd(dueAtBooking(r.quote))} · đọc mã {r.code} cho nhân viên.</Muted>
            </>
          )}
          <Button
            title="Hủy giữ chỗ"
            variant="ghost"
            size="sm"
            icon="close-circle-outline"
            style={{ marginTop: S.sm }}
            onPress={() => void run('cancelReservation', { reservationId: r._id }, (v) => `Đã hủy giữ chỗ — hoàn ${vnd(v)}`, () => router.back())}
          />
        </Card>
      )}

      {open && (
        <View style={{ marginTop: S.md }}><PaymentSchedule quotes={[r.quote]} paid={r.status !== 'PENDING'} /></View>
      )}

      {svcOrders.length > 0 && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.titleRow}>
            <IconTile icon="construct-outline" tone="amber" size="sm" />
            <Text style={st.sectionTitle}>Dịch vụ kèm</Text>
          </View>
          {svcOrders.map((o) => (
            <View key={o._id} style={st.svcRow}>
              <View style={st.rowBetween}>
                <Text style={st.svcName}>{o.serviceName} × {o.quantity}</Text>
                <StatusBadge map={SERVICE_ORDER_STATUS} value={o.status} />
              </View>
              <Muted>{o.orderNumber} · {vnd(o.total)}</Muted>
              {open && o.status === 'REQUESTED' && !o.paymentId && (
                <Button title="Huỷ đơn" variant="ghost" size="sm" icon="close-circle-outline" style={{ marginTop: S.xs, alignSelf: 'flex-start' }} onPress={() => askCancelService(o)} />
              )}
            </View>
          ))}
          {svcDue > 0 && <Text style={st.svcDue}>Thanh toán khi nhận kho: {vnd(svcDue)} (đơn riêng, ngoài hợp đồng thuê)</Text>}
        </Card>
      )}

      {confirmed && <ContractSignCard reservation={r} />}

      {confirmed && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.titleRow}>
            <IconTile icon="checkmark-circle" tone="green" size="sm" />
            <Text style={[st.sectionTitle, { color: C.green }]}>Đặt chỗ đã được xác nhận</Text>
          </View>
          <Muted style={{ marginTop: S.sm } as never}>
            Đưa mã QR cho nhân viên tại quầy vào ngày {fmtDate(r.startDate)} để nhận kho.
          </Muted>
          {canMove && !newDate && <Button title="Đổi ngày nhận kho" icon="calendar-outline" variant="secondary" style={{ marginTop: S.md }} onPress={openMove} />}
          {newDate && (
            <View style={st.moveBox}>
              <DateStepper label={`Ngày nhận mới · còn đổi ${rescheduleChangesLeft(r)} lần`} value={newDate} onChange={setNewDate} min={win.min} max={win.max} />
              {moveCheck?.ok
                ? <Muted style={{ marginTop: S.sm } as never}>Kết thúc: hết ngày {fmtDate(lastDayOf(rescheduledEndDate(r, newDate)))}</Muted>
                : moveCheck && moveCheck.code !== 'RESCHEDULE_SAME' ? <Muted style={{ marginTop: S.sm } as never}>{moveCheck.message}</Muted> : null}
              {r.signature && <Callout tone="amber" icon="create-outline" style={{ marginTop: S.sm }}>Đổi ngày thì phải ký lại hợp đồng.</Callout>}
              <View style={st.moveActions}>
                <Button title="Đóng" variant="secondary" style={{ flex: 1 }} onPress={() => setNewDate(null)} />
                <Button
                  title="Xác nhận đổi"
                  disabled={!moveCheck?.ok}
                  style={{ flex: 1.4 }}
                  onPress={() => void run('rescheduleReservation', { reservationId: r._id, startDate: newDate }, (v) => `Đã đổi ngày nhận kho sang ${fmtDate(v.startDate)}`, () => setNewDate(null))}
                />
              </View>
            </View>
          )}
          <Button title="Hủy đặt chỗ" variant="ghost" size="sm" icon="close-circle-outline" style={{ marginTop: S.sm }} onPress={askCancel} />
        </Card>
      )}

      {(r.status === 'CANCELLED' || r.status === 'CHECKED_IN' || r.status === 'COMPLETED') && (
        <Card style={{ marginTop: S.md }}>
          <EmptyState
            icon={r.status === 'CANCELLED' ? 'close-circle-outline' : 'checkmark-done-circle-outline'}
            tone={r.status === 'CANCELLED' ? 'gray' : 'green'}
            title={r.status === 'CANCELLED' ? 'Đặt chỗ đã hủy' : 'Bạn đã nhận kho'}
            description={r.status === 'CANCELLED'
              ? `Đặt chỗ đã hủy. Số tiền hoàn: ${vnd(r.cancellation?.refundAmount ?? 0)}.`
              : 'Bạn đã nhận kho. Quản lý hợp đồng ở tab Kho của tôi.'}
            action={<Button title="Quay lại" variant="secondary" icon="arrow-back" onPress={() => router.back()} />}
          />
        </Card>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  dateTile: { width: 56, paddingVertical: 8, borderRadius: R.md, backgroundColor: C.blueBg, borderWidth: 1, borderColor: C.blueLine, alignItems: 'center' },
  dateDay: { fontSize: 22, fontWeight: '800', color: '#0c4a6e', lineHeight: 24, ...T.tabular },
  dateMonth: { fontSize: 10, fontWeight: '700', color: C.blue, letterSpacing: 0.4 },
  divider: { height: 1, backgroundColor: C.lineSoft, marginVertical: S.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md, flexWrap: 'wrap' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, flexShrink: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink, flexShrink: 1 },
  svcRow: { marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft, gap: 2 },
  svcName: { flex: 1, fontSize: 14, fontWeight: '600', color: C.ink },
  moveBox: { marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft },
  moveActions: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
  svcDue: { marginTop: S.md, fontSize: 13, fontWeight: '700', color: C.ink, backgroundColor: C.fill, borderRadius: R.md, padding: S.md },
});
