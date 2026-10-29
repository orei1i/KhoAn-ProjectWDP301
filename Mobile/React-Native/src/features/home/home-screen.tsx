import { useCallback, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { billingDue, bookingServicesDue, canDisputeInspection, CONTRACT_STATUS, counterHoldText, inspectionDisputeDeadline, isClosedContract, nextChargeText, OPEN_CONTRACT_STATUSES, owingText, profileGaps, PERIOD_UNIT, RESERVATION_STATUS, SIGNING_PREFERENCE, signingPreferenceOf, daysBetween, dueAtCheckIn, fmtDate, lastDayOf, paysWholeTerm, relativeDay, todayISO, vnd } from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Avatar, Button, Callout, Card, Chip, EmptyState, IconTile, KV, ListGroup, ListRow, Muted, PhotoBanner, ScreenSkeleton, SectionHeader, StatCard, StatusBadge, TermProgress } from '../../shared/ui';
import { C, R, S, T } from '../../shared/ui/theme';
import { categoryPhoto } from '../../shared/ui/visuals';
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
        <View style={{ padding: S.lg }}><ScreenSkeleton /></View>
      </SafeAreaView>
    );
  }

  const T0 = todayISO();
  // Đã xác nhận / đã phân kho = chưa nhận kho → đây là nhóm cần đưa mã cho nhân viên.
  const upcoming = db.reservations
    .filter((r) => r.status === 'CONFIRMED' || r.status === 'ALLOCATED')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const pending = db.reservations.filter((r) => r.status === 'PENDING');
  // Hợp đồng đã đóng vẫn hiện khi còn nợ sau quyết toán (để khách thấy và trả) hoặc biên bản trả kho còn trong hạn khiếu nại (Điều 9).
  const contracts = db.contracts.filter((c) => OPEN_CONTRACT_STATUSES.includes(c.status)
    || (isClosedContract(c.status) && (c.balance.outstanding > 0 || db.inspections.some((i) => i.contractId === c._id && i.type === 'MOVE_OUT' && canDisputeInspection(i.performedAt)))));

  const overdueTotal = contracts.reduce((s, c) => s + c.balance.outstanding, 0);
  const openCount = contracts.filter((c) => OPEN_CONTRACT_STATUSES.includes(c.status)).length;
  const gaps = profileGaps(user);

  return (
    <SafeAreaView style={st.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand700} />}
      >
        <View style={st.hello}>
          <Avatar name={user.fullName} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Muted>Xin chào</Muted>
            <Text style={st.name} numberOfLines={1}>{user.fullName}</Text>
          </View>
        </View>

        <View style={st.stats}>
          <StatCard style={{ flex: 1 }} label="Kho đang thuê" value={openCount} icon="cube-outline" tone="teal"
            sub={upcoming.length + pending.length > 0 ? `${upcoming.length + pending.length} đặt chỗ đang chờ` : undefined} />
          <StatCard style={{ flex: 1 }} label="Công nợ" value={vnd(overdueTotal)} icon="wallet-outline"
            tone={overdueTotal > 0 ? 'red' : 'green'} sub={overdueTotal > 0 ? 'Cần thanh toán' : 'Không có khoản nợ'} />
        </View>

        <View style={{ gap: S.md, marginTop: S.md }}>
          {gaps.length > 0 && (
            <Callout tone="amber" icon="person-circle-outline" title="Bổ sung thông tin cá nhân"
              action={<Button title="Cập nhật ở Tài khoản" variant="secondary" size="sm" icon="person-outline" onPress={() => router.push('/account')} />}>
              Còn thiếu {gaps.join(', ')} — cần có để đặt kho, ký và gia hạn hợp đồng.
            </Callout>
          )}

          {overdueTotal > 0 && (
            <Callout tone="red" title={`Đang có công nợ ${vnd(overdueTotal)}`}>
              {contracts.some((c) => isClosedContract(c.status)) ? 'Gồm khoản nợ còn lại sau quyết toán hợp đồng đã đóng — trả xong mới đặt kho mới được.' : 'Thanh toán sớm để tránh bị khoá truy cập kho.'}
            </Callout>
          )}

          {/* Khoản hoàn bằng chuyển khoản đang chờ chuyển — nhắc khai tài khoản nhận tiền nếu chưa khai. */}
          <PayoutBanner onOpen={() => router.push('/account')} />
        </View>

        {/* ---- mã nhận kho: việc quan trọng nhất của app ---- */}
        {upcoming.length > 0 && (
          <>
            <SectionHeader title="Sắp nhận kho" icon="calendar-outline" count={upcoming.length} />
            <View style={{ gap: S.md }}>
              {upcoming.map((r) => {
                const left = daysBetween(T0, r.startDate);
                // Tiền thuê kỳ đầu (nếu chưa trả) + dịch vụ chọn kèm lúc đặt — thu khi nhận kho.
                const dueAtDesk = dueAtCheckIn(r.quote) + bookingServicesDue(db.serviceOrders, r._id);
                const [dd, mm] = fmtDate(r.startDate).split('/');
                return (
                  <Card key={r._id}>
                    <View style={st.rsvHead}>
                      <View style={st.dateTile}>
                        <Text style={st.dateDay}>{dd}</Text>
                        <Text style={st.dateMonth}>TH{Number(mm)}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                        <Text style={st.code}>{r.code}</Text>
                        <Text style={T.small} numberOfLines={2}>{typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)}</Text>
                      </View>
                      <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                    </View>
                    <View style={st.divider} />
                    <KV items={[
                      ['Chi nhánh', facilityName(db, r.facilityId)],
                      ['Loại kho', typeName(db, r.unitTypeId)],
                      ['Kho được phân', r.unitId ? unitLabel(db, r.unitId) : 'Chi nhánh sẽ phân trước ngày nhận'],
                      ['Ngày nhận', `${fmtDate(r.startDate)} · ${relativeDay(r.startDate)}`],
                      ['Trả thêm khi nhận kho', dueAtDesk > 0 ? vnd(dueAtDesk) : 'Không — đã trả đủ khi đặt'],
                    ]} />
                    {/* Chưa ký hợp đồng thì việc cần làm trước là ký (ở màn Đặt chỗ) — không ký thì không nhận kho được. */}
                    {/* Khách đã chọn ký giấy tại quầy: không nhắc như lỗi, chỉ nhắc mang giấy tờ. */}
                    {!r.signature && signingPreferenceOf(r) === 'PAPER_AT_COUNTER' && (
                      <Callout tone="violet" icon="document-text-outline" style={{ marginTop: S.md }}>{SIGNING_PREFERENCE.PAPER_AT_COUNTER.note}</Callout>
                    )}
                    {!r.signature && signingPreferenceOf(r) !== 'PAPER_AT_COUNTER' && (
                      <Callout tone="amber" icon="create-outline" style={{ marginTop: S.md }}
                        action={<Button title="Ký hợp đồng" icon="create-outline" size="sm" onPress={() => router.push(`/booking/${r._id}`)} />}>
                        Bạn chưa ký hợp đồng — ký trước khi đến nhận kho.
                      </Callout>
                    )}
                    <Button
                      title={left > 0 ? 'Xem mã nhận kho' : 'Đưa mã cho nhân viên'}
                      icon="qr-code-outline"
                      variant={r.signature || signingPreferenceOf(r) === 'PAPER_AT_COUNTER' ? 'primary' : 'secondary'}
                      style={{ marginTop: S.md }}
                      onPress={() => router.push(`/qr/${r._id}`)}
                    />
                    {r.signature && (
                      <Button title="Chi tiết đặt chỗ" variant="ghost" size="sm" icon="document-text-outline" style={{ marginTop: S.xs }} onPress={() => router.push(`/booking/${r._id}`)} />
                    )}
                  </Card>
                );
              })}
            </View>
          </>
        )}

        {pending.length > 0 && (
          <>
            <SectionHeader title="Chờ thanh toán" icon="time-outline" count={pending.length} />
            <View style={{ gap: S.md }}>
              {pending.map((r) => (
                <Card key={r._id} style={st.pendingCard}>
                  <View style={st.rsvHead}>
                    <IconTile icon={r.payAtCounter ? 'storefront-outline' : 'hourglass-outline'} tone={r.payAtCounter ? 'violet' : 'amber'} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.code}>{r.code}</Text>
                      <Text style={T.caption} numberOfLines={1}>{typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)}</Text>
                    </View>
                    {r.payAtCounter ? <Chip tone="violet" icon="storefront-outline">Trả tại quầy</Chip> : <Chip tone="amber" icon="time-outline">Giữ chỗ tạm thời</Chip>}
                  </View>
                  {/* Giữ chỗ, trả tại quầy: nhắc hạn giữ ô + mang CCCD — vẫn trả online sớm được ở màn Đặt chỗ. */}
                  {r.payAtCounter && r.holdExpiresAt && <Text style={st.counter}>{counterHoldText(r.holdExpiresAt)}</Text>}
                  <Muted style={{ marginTop: S.sm } as never}>
                    {typeName(db, r.unitTypeId)} · {facilityName(db, r.facilityId)} · {r.quote.firstPeriodAtBooking
                      ? `giữ chân ${vnd(r.quote.depositAmount)} + thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu ${vnd(r.quote.firstPeriodRent)}, trả cùng lúc hôm nay`
                      : `giữ chân ${vnd(r.quote.depositAmount)} hôm nay, ${paysWholeTerm(r.quote) ? 'tiền thuê cả thời hạn' : `thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`} ${vnd(dueAtCheckIn(r.quote))} trả thêm khi nhận kho`}
                    {bookingServicesDue(db.serviceOrders, r._id) > 0 ? ` · dịch vụ kèm ${vnd(bookingServicesDue(db.serviceOrders, r._id))} trả khi nhận kho` : ''}
                  </Muted>
                  <Button
                    title={r.payAtCounter ? 'Chi tiết đặt chỗ' : 'Thanh toán'}
                    variant={r.payAtCounter ? 'secondary' : 'primary'}
                    icon={r.payAtCounter ? 'document-text-outline' : 'card-outline'}
                    style={{ marginTop: S.md }}
                    onPress={() => router.push(`/booking/${r._id}`)}
                  />
                </Card>
              ))}
            </View>
          </>
        )}

        {/* ---- hợp đồng đang thuê ---- */}
        <SectionHeader title="Kho đang thuê" icon="cube-outline" count={contracts.length || undefined} />
        <View style={{ gap: S.lg }}>
          {contracts.length === 0 ? (
            <Card>
              <EmptyState
                icon="cube-outline"
                title="Bạn chưa thuê kho nào"
                description="Chọn chi nhánh gần bạn, xem ảnh và chỗ trống rồi đặt ngay trên app."
                action={<Button title="Tìm kho" icon="search-outline" onPress={() => router.push('/explore')} />}
              />
            </Card>
          ) : contracts.map((c) => {
            const toEnd = daysBetween(T0, c.endDate);
            // Hợp đồng đã đóng (còn hiện vì nợ sau quyết toán / biên bản còn hạn khiếu nại) không còn kỳ thanh toán hay hạn thuê nào —
            // chỉ in các dòng đó khi hợp đồng còn mở, như màn chi tiết hợp đồng.
            const open = OPEN_CONTRACT_STATUSES.includes(c.status);
            // Hạn chót tính như job billing (theo paidThrough + ân hạn) — không theo nextBillingDate, vì xuất hoá đơn xong job đã đẩy nó
            // sang kỳ sau. Kỳ tới hiện đúng số sẽ thu (hết cam kết thì giá chưa ưu đãi).
            const due = open ? billingDue(c, T0) : null;
            const toBill = due ? daysBetween(T0, due.next.date) : 0;
            const insp = open ? undefined : db.inspections.find((i) => i.contractId === c._id && i.type === 'MOVE_OUT' && canDisputeInspection(i.performedAt));
            const billingRows: [string, ReactNode][] = due ? [
              ['Tiền thuê', `${vnd(c.billing.rate)}/${PERIOD_UNIT[c.billing.rentalPeriod]}`],
              ...(due.owing ? [['Cần thanh toán', <Text key="due" style={{ color: C.red, fontWeight: '700', textAlign: 'right' }}>{owingText(due)}</Text>] as [string, ReactNode]] : []),
              ...(!due.owing && !due.next.prepaid ? [['Hạn trả tiền kỳ tới', fmtDate(due.deadline)] as [string, ReactNode]] : []),
              ['Thuê đến hết ngày', `${fmtDate(lastDayOf(c.endDate))}${toEnd <= 30 ? ` · ${relativeDay(lastDayOf(c.endDate))}` : ''}`],
            ] : [
              ['Hợp đồng kết thúc', fmtDate(c.closedAt)],
              ...(insp ? [['Hạn khiếu nại biên bản', fmtDate(new Date(inspectionDisputeDeadline(insp.performedAt)).toISOString())] as [string, ReactNode]] : []),
            ];
            const category = byId(db.unitTypes, c.unitTypeId)?.category;
            return (
              <View key={c._id} style={st.hero}>
                <PhotoBanner source={categoryPhoto(category)} height={open ? 176 : 132} accessibilityLabel={`Ảnh minh hoạ ${typeName(db, c.unitTypeId)}`}
                  topLeft={<StatusBadge map={CONTRACT_STATUS} value={c.status} />}>
                  <View style={st.heroRow}>
                    <View style={st.unitChip}><Text style={st.unitChipText} numberOfLines={1} adjustsFontSizeToFit>{unitLabel(db, c.unitId)}</Text></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.heroTitle} numberOfLines={1}>{typeName(db, c.unitTypeId)}</Text>
                      <Text style={st.heroSub} numberOfLines={1}>{facilityName(db, c.facilityId)}</Text>
                    </View>
                  </View>
                  {open && <TermProgress start={c.startDate} end={c.endDate} onDark style={{ marginTop: S.md }} />}
                </PhotoBanner>

                <View style={st.heroBody}>
                  {due && (
                    <View style={[st.nextPay, due.owing && { backgroundColor: C.redBg, borderColor: C.redLine }]}>
                      <IconTile icon="calendar-clear-outline" tone={due.owing ? 'red' : 'violet'} size="md" />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={T.caption}>Kỳ thanh toán tới{toBill <= SOON_DAYS ? ` · ${relativeDay(due.next.date)}` : ''}</Text>
                        <Text style={st.nextPayValue}>{fmtDate(due.next.date)}</Text>
                      </View>
                      <Text style={st.nextPayAmount} numberOfLines={2}>{nextChargeText(due)}</Text>
                    </View>
                  )}

                  <KV items={[
                    ...billingRows,
                    [open ? 'Công nợ' : 'Nợ sau quyết toán', c.balance.outstanding > 0
                      ? <Text style={{ color: C.red, fontWeight: '700' }}>{vnd(c.balance.outstanding)}</Text>
                      : 'Không có'],
                  ]} />

                  {toEnd <= SOON_DAYS && c.status === 'ACTIVE' && (
                    <Callout tone="amber" icon="time-outline" style={{ marginTop: S.md }}>
                      Hợp đồng {toEnd <= 0 ? 'đã tới hạn' : `còn ${toEnd} ngày`}. Gia hạn hoặc đăng ký trả kho để khỏi phát sinh phí.
                    </Callout>
                  )}

                  <QuickActions contract={c} />

                  <Button
                    title="Chi tiết hợp đồng"
                    variant="secondary"
                    iconRight="chevron-forward"
                    style={{ marginTop: S.sm }}
                    onPress={() => router.push(`/contract/${c._id}`)}
                  />
                </View>
              </View>
            );
          })}
        </View>

        {/* Lối vào lịch sử: đặt chỗ đã huỷ (lý do + tiền hoàn), các khoản đã trả / đã hoàn / đang chờ chuyển — nằm ở tab Tài khoản. */}
        <ListGroup style={{ marginTop: S.xl }}>
          <ListRow icon="receipt-outline" title="Lịch sử đặt chỗ & thanh toán" subtitle="Khoản đã trả, đã hoàn, đặt chỗ đã qua" onPress={() => router.push('/account')} />
        </ListGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  hello: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.lg },
  name: { ...T.title },
  stats: { flexDirection: 'row', gap: S.md },
  rsvHead: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  dateTile: { width: 52, paddingVertical: 6, borderRadius: R.md, backgroundColor: C.blueBg, borderWidth: 1, borderColor: C.blueLine, alignItems: 'center' },
  dateDay: { fontSize: 20, fontWeight: '800', color: '#0c4a6e', lineHeight: 22, ...T.tabular },
  dateMonth: { fontSize: 10, fontWeight: '700', color: C.blue, letterSpacing: 0.4 },
  divider: { height: 1, backgroundColor: C.lineSoft, marginVertical: S.md },
  code: { fontSize: 15, fontWeight: '700', color: C.ink, letterSpacing: 0.4 },
  pendingCard: { borderColor: C.amberLine },
  counter: { marginTop: S.sm, fontSize: 13, fontWeight: '600', color: C.violet, lineHeight: 19 },

  hero: { backgroundColor: C.card, borderRadius: R.xl, borderWidth: 1, borderColor: C.line, overflow: 'hidden', boxShadow: '0 12px 28px -14px rgba(22, 32, 30, 0.30), 0 4px 10px -6px rgba(22, 32, 30, 0.12)' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  unitChip: { minWidth: 56, height: 56, paddingHorizontal: 6, borderRadius: R.md, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  unitChipText: { color: C.ink, fontWeight: '800', fontSize: 15 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: C.white, letterSpacing: -0.2 },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  heroBody: { padding: S.lg },
  nextPay: { flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.violetBg, borderWidth: 1, borderColor: C.violetLine, marginBottom: S.md },
  nextPayValue: { fontSize: 16, fontWeight: '800', color: C.ink, ...T.tabular },
  nextPayAmount: { fontSize: 14, fontWeight: '800', color: C.ink, textAlign: 'right', maxWidth: '45%', ...T.tabular },
});
