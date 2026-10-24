import { useCallback, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { billingDue, bookingServicesDue, canDisputeInspection, CONTRACT_STATUS, inspectionDisputeDeadline, isClosedContract, nextChargeText, OPEN_CONTRACT_STATUSES, owingText, profileGaps, PERIOD_UNIT, RESERVATION_STATUS, daysBetween, dueAtCheckIn, fmtDate, lastDayOf, paysWholeTerm, relativeDay, todayISO, vnd } from '@ssm/shared';
import { facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Card, EmptyState, H1, KV, Muted, Skeleton, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';
import { QuickActions } from './quick-actions';
import { PayoutBanner } from '../payments/history-card';

/** Sắp hết hạn = còn <= 7 ngày. Đủ sớm để khách xoay xở, không sớm tới mức thành tiếng ồn. */
const SOON_DAYS = 7;

export default function HomeScreen() {
  const { db, user, ready, refresh } = useStore();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh().catch(() => {});
    setRefreshing(false);
  }, [refresh]);

  if (!ready || !user) {
    return (
      <SafeAreaView style={st.screen} edges={['top']}>
        <View style={{ padding: S.lg, gap: S.md }}>
          <Skeleton h={28} w="60%" />
          <Skeleton h={120} />
          <Skeleton h={120} />
        </View>
      </SafeAreaView>
    );
  }

  const T = todayISO();
  // Đã xác nhận / đã phân kho = chưa nhận kho → đây là nhóm cần đưa mã cho nhân viên.
  const upcoming = db.reservations
    .filter((r) => r.status === 'CONFIRMED' || r.status === 'ALLOCATED')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const pending = db.reservations.filter((r) => r.status === 'PENDING');
  // Hợp đồng đã đóng vẫn hiện khi còn nợ sau quyết toán (để khách thấy và trả) hoặc biên bản trả kho còn trong hạn khiếu nại (Điều 9).
  const contracts = db.contracts.filter((c) => OPEN_CONTRACT_STATUSES.includes(c.status)
    || (isClosedContract(c.status) && (c.balance.outstanding > 0 || db.inspections.some((i) => i.contractId === c._id && i.type === 'MOVE_OUT' && canDisputeInspection(i.performedAt)))));

  const overdueTotal = contracts.reduce((s, c) => s + c.balance.outstanding, 0);

  return (
    <SafeAreaView style={st.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl * 2, gap: S.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand700} />}
      >
        <View>
          <Muted>Xin chào</Muted>
          <H1>{user.fullName}</H1>
        </View>

        {profileGaps(user).length > 0 && (
          <Card style={{ backgroundColor: C.amberBg, borderColor: '#fde68a' }}>
            <Text style={{ color: C.amber, fontWeight: '700' }}>Bổ sung thông tin cá nhân</Text>
            <Muted style={{ marginTop: 4 } as never}>Còn thiếu {profileGaps(user).join(', ')} — cần có để đặt kho, ký và gia hạn hợp đồng.</Muted>
            <Button title="Cập nhật ở Tài khoản" variant="secondary" icon="person-outline" style={{ marginTop: S.md }} onPress={() => router.push('/account')} />
          </Card>
        )}

        {overdueTotal > 0 && (
          <Card style={{ backgroundColor: C.redBg, borderColor: '#fecaca' }}>
            <View style={st.rowGap}>
              <Ionicons name="alert-circle" size={20} color={C.red} />
              <Text style={{ flex: 1, color: C.red, fontWeight: '600' }}>Đang có công nợ {vnd(overdueTotal)}</Text>
            </View>
            <Muted style={{ marginTop: 6 } as never}>{contracts.some((c) => isClosedContract(c.status)) ? 'Gồm khoản nợ còn lại sau quyết toán hợp đồng đã đóng — trả xong mới đặt kho mới được.' : 'Thanh toán sớm để tránh bị khoá truy cập kho.'}</Muted>
          </Card>
        )}

        {/* Khoản hoàn bằng chuyển khoản đang chờ chuyển — nhắc khai tài khoản nhận tiền nếu chưa khai. */}
        <PayoutBanner onOpen={() => router.push('/account')} />

        {/* ---- mã nhận kho: việc quan trọng nhất của app ---- */}
        {upcoming.length > 0 && (
          <View style={{ gap: S.md }}>
            <Text style={st.section}>Sắp nhận kho</Text>
            {upcoming.map((r) => {
              const left = daysBetween(T, r.startDate);
              // Tiền thuê kỳ đầu (nếu chưa trả) + dịch vụ chọn kèm lúc đặt — thu khi nhận kho.
              const dueAtDesk = dueAtCheckIn(r.quote) + bookingServicesDue(db.serviceOrders, r._id);
              return (
                <Card key={r._id}>
                  <View style={st.rowBetween}>
                    <Text style={st.code}>{r.code}</Text>
                    <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                  </View>
                  <View style={{ marginTop: S.md }}>
                    <KV items={[
                      ['Chi nhánh', facilityName(db, r.facilityId)],
                      ['Loại kho', typeName(db, r.unitTypeId)],
                      ['Kho được phân', r.unitId ? unitLabel(db, r.unitId) : 'Chi nhánh sẽ phân trước ngày nhận'],
                      ['Ngày nhận', `${fmtDate(r.startDate)} · ${relativeDay(r.startDate)}`],
                      ['Trả thêm khi nhận kho', dueAtDesk > 0 ? vnd(dueAtDesk) : 'Không — đã trả đủ khi đặt'],
                    ]} />
                  </View>
                  {/* Chưa ký hợp đồng thì việc cần làm trước là ký (ở màn Đặt chỗ) — không ký thì không nhận kho được. */}
                  {!r.signature && (
                    <>
                      <Muted style={{ marginTop: S.md, color: C.amber } as never}>Bạn chưa ký hợp đồng — ký trước khi đến nhận kho.</Muted>
                      <Button title="Ký hợp đồng" icon="create-outline" style={{ marginTop: S.sm }} onPress={() => router.push(`/booking/${r._id}`)} />
                    </>
                  )}
                  <Button
                    title={left > 0 ? 'Xem mã nhận kho' : 'Đưa mã cho nhân viên'}
                    icon="qr-code-outline"
                    variant={r.signature ? 'primary' : 'secondary'}
                    style={{ marginTop: r.signature ? S.lg : S.sm }}
                    onPress={() => router.push(`/qr/${r._id}`)}
                  />
                  {r.signature && (
                    <Button title="Chi tiết đặt chỗ" variant="ghost" icon="document-text-outline" style={{ marginTop: S.xs }} onPress={() => router.push(`/booking/${r._id}`)} />
                  )}
                </Card>
              );
            })}
          </View>
        )}

        {pending.length > 0 && (
          <View style={{ gap: S.md }}>
            <Text style={st.section}>Chờ thanh toán</Text>
            {pending.map((r) => (
              <Card key={r._id} style={{ backgroundColor: C.amberBg, borderColor: '#fde68a' }}>
                <View style={st.rowBetween}>
                  <Text style={st.code}>{r.code}</Text>
                  <Badge tone="amber">Giữ chỗ tạm thời</Badge>
                </View>
                <Muted style={{ marginTop: 6 } as never}>
                  {typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)} · {r.quote.firstPeriodAtBooking
                    ? `giữ chân ${vnd(r.quote.depositAmount)} + thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu ${vnd(r.quote.firstPeriodRent)}, trả cùng lúc hôm nay`
                    : `giữ chân ${vnd(r.quote.depositAmount)} hôm nay, ${paysWholeTerm(r.quote) ? 'tiền thuê cả thời hạn' : `thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`} ${vnd(dueAtCheckIn(r.quote))} trả thêm khi nhận kho`}
                  {bookingServicesDue(db.serviceOrders, r._id) > 0 ? ` · dịch vụ kèm ${vnd(bookingServicesDue(db.serviceOrders, r._id))} trả khi nhận kho` : ''}
                </Muted>
                <Button
                  title="Thanh toán"
                  style={{ marginTop: S.md }}
                  onPress={() => router.push(`/booking/${r._id}`)}
                />
              </Card>
            ))}
          </View>
        )}

        {/* ---- hợp đồng đang thuê ---- */}
        <View style={{ gap: S.md }}>
          <Text style={st.section}>Kho đang thuê</Text>
          {contracts.length === 0 ? (
            <Card>
              <EmptyState
                icon="cube-outline"
                title="Bạn chưa thuê kho nào"
                action={<Button title="Tìm kho" icon="search-outline" onPress={() => router.push('/explore')} />}
              />
            </Card>
          ) : contracts.map((c) => {
            const toEnd = daysBetween(T, c.endDate);
            // Hợp đồng đã đóng (còn hiện vì nợ sau quyết toán / biên bản còn hạn khiếu nại) không còn kỳ thanh toán hay hạn thuê nào —
            // chỉ in các dòng đó khi hợp đồng còn mở, như màn chi tiết hợp đồng.
            const open = OPEN_CONTRACT_STATUSES.includes(c.status);
            // Hạn chót tính như job billing (theo paidThrough + ân hạn) — không theo nextBillingDate, vì xuất hoá đơn xong job đã đẩy nó
            // sang kỳ sau. Kỳ tới hiện đúng số sẽ thu (hết cam kết thì giá chưa ưu đãi).
            const due = open ? billingDue(c, T) : null;
            const toBill = due ? daysBetween(T, due.next.date) : 0;
            const insp = open ? undefined : db.inspections.find((i) => i.contractId === c._id && i.type === 'MOVE_OUT' && canDisputeInspection(i.performedAt));
            const billingRows: [string, ReactNode][] = due ? [
              ['Tiền thuê', `${vnd(c.billing.rate)}/${PERIOD_UNIT[c.billing.rentalPeriod]}`],
              ...(due.owing ? [['Cần thanh toán', <Text key="due" style={{ color: C.red, fontWeight: '700' }}>{owingText(due)}</Text>] as [string, ReactNode]] : []),
              ['Kỳ thanh toán tới', `${fmtDate(due.next.date)} · ${nextChargeText(due)}${toBill <= SOON_DAYS ? ` · ${relativeDay(due.next.date)}` : ''}`],
              ...(!due.owing && !due.next.prepaid ? [['Hạn trả tiền kỳ tới', fmtDate(due.deadline)] as [string, ReactNode]] : []),
              ['Thuê đến hết ngày', `${fmtDate(lastDayOf(c.endDate))}${toEnd <= 30 ? ` · ${relativeDay(lastDayOf(c.endDate))}` : ''}`],
            ] : [
              ['Hợp đồng kết thúc', fmtDate(c.closedAt)],
              ...(insp ? [['Hạn khiếu nại biên bản', fmtDate(new Date(inspectionDisputeDeadline(insp.performedAt)).toISOString())] as [string, ReactNode]] : []),
            ];
            return (
              <Card key={c._id}>
                <View style={st.rowBetween}>
                  <View style={st.rowGap}>
                    <View style={st.unitChip}><Text style={st.unitChipText}>{unitLabel(db, c.unitId)}</Text></View>
                    <View>
                      <Text style={st.unitName}>{typeName(db, c.unitTypeId)}</Text>
                      <Muted>{facilityName(db, c.facilityId)}</Muted>
                    </View>
                  </View>
                  <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                </View>

                <View style={{ marginTop: S.lg }}>
                  <KV items={[
                    ...billingRows,
                    [open ? 'Công nợ' : 'Nợ sau quyết toán', c.balance.outstanding > 0
                      ? <Text style={{ color: C.red, fontWeight: '700' }}>{vnd(c.balance.outstanding)}</Text>
                      : 'Không có'],
                  ]} />
                </View>

                {toEnd <= SOON_DAYS && c.status === 'ACTIVE' && (
                  <View style={[st.notice, { backgroundColor: C.amberBg }]}>
                    <Ionicons name="time-outline" size={16} color={C.amber} />
                    <Text style={{ flex: 1, fontSize: 13, color: C.amber }}>
                      Hợp đồng {toEnd <= 0 ? 'đã tới hạn' : `còn ${toEnd} ngày`}. Gia hạn hoặc đăng ký trả kho để khỏi phát sinh phí.
                    </Text>
                  </View>
                )}

                <QuickActions contract={c} />

                <Button
                  title="Chi tiết hợp đồng"
                  variant="secondary"
                  style={{ marginTop: S.md }}
                  onPress={() => router.push(`/contract/${c._id}`)}
                />
              </Card>
            );
          })}
        </View>

        {/* Lối vào lịch sử: đặt chỗ đã huỷ (lý do + tiền hoàn), các khoản đã trả / đã hoàn / đang chờ chuyển — nằm ở tab Tài khoản. */}
        <Button title="Lịch sử đặt chỗ & thanh toán" variant="secondary" icon="receipt-outline" onPress={() => router.push('/account')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  section: { fontSize: 12, fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: 0.6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  code: { fontSize: 15, fontWeight: '700', color: C.ink, letterSpacing: 0.4 },
  unitChip: { width: 46, height: 46, borderRadius: R.md, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  unitChipText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  unitName: { fontSize: 15, fontWeight: '700', color: C.ink },
  notice: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', padding: S.md, borderRadius: R.md, marginTop: S.md },
});
