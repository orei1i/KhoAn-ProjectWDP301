import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canDisputeInspection, CONTRACT_STATUS, isClosedContract, OPEN_CONTRACT_STATUSES, profileGaps, PERIOD_UNIT, RESERVATION_STATUS, daysBetween, dueAtCheckIn, fmtDate, lastDayOf, paymentDueDate, paysWholeTerm, relativeDay, todayISO, vnd } from '@ssm/shared';
import { facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Card, EmptyState, H1, KV, Muted, Skeleton, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';
import { QuickActions } from './quick-actions';

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

        {/* ---- mã nhận kho: việc quan trọng nhất của app ---- */}
        {upcoming.length > 0 && (
          <View style={{ gap: S.md }}>
            <Text style={st.section}>Sắp nhận kho</Text>
            {upcoming.map((r) => {
              const left = daysBetween(T, r.startDate);
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
                      ['Trả thêm khi nhận kho', dueAtCheckIn(r.quote) > 0 ? vnd(dueAtCheckIn(r.quote)) : 'Không — đã trả đủ khi đặt'],
                    ]} />
                  </View>
                  <Button
                    title={left > 0 ? 'Xem mã nhận kho' : 'Đưa mã cho nhân viên'}
                    icon="qr-code-outline"
                    style={{ marginTop: S.lg }}
                    onPress={() => router.push(`/qr/${r._id}`)}
                  />
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
                description="Chọn chi nhánh và loại kho phù hợp ở tab Thuê kho."
                action={<Button title="Tìm kho" icon="search-outline" onPress={() => router.push('/explore')} />}
              />
            </Card>
          ) : contracts.map((c) => {
            const toEnd = daysBetween(T, c.endDate);
            const toBill = daysBetween(T, c.billing.nextBillingDate);
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
                    ['Tiền thuê', `${vnd(c.billing.rate)}/${PERIOD_UNIT[c.billing.rentalPeriod]}`],
                    ['Kỳ thanh toán tới', `${fmtDate(c.billing.nextBillingDate)}${toBill <= SOON_DAYS ? ` · ${relativeDay(c.billing.nextBillingDate)}` : ''}`],
                    ['Hạn trả tiền kỳ tới', fmtDate(paymentDueDate(c.billing.nextBillingDate, c.terms.gracePeriodDays))],
                    ['Thuê đến hết ngày', `${fmtDate(lastDayOf(c.endDate))}${toEnd <= 30 ? ` · ${relativeDay(lastDayOf(c.endDate))}` : ''}`],
                    ['Công nợ', c.balance.outstanding > 0
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
