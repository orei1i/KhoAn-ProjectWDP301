import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { RentalPeriod, SizeChangeMoneyInput, SwapGoodsLine, SwapMethod, SwapMoveItem, SwapUnmovedReason, UnitCategory, UnitSwapRequest } from '@ssm/shared';
import { ACCESS_METHOD, addDays, MONTH_ONLY_MESSAGE, PERIOD_UNIT, SWAP_DELIVERY_CLAIM_DAYS, SWAP_LIABILITY, SWAP_METHOD, SWAP_REQUEST_STATUS, SWAP_UNMOVED_REASON, todayISO, fmtDate, openIntakeOf, sizeChangeNote, swapBlockedByIntakeText, swapFeeDue, swapRequestNote, vnd } from '@ssm/shared';
import {
  inventoryOf, sizeChangeMoneyLines, SWAP_CUSTOMER_RESCHEDULE_MAX, SWAP_NO_GOODS_TEXT, SWAP_SELF_MOVE_DAYS, swapCustomerReschedulesLeft, swapMovableGoods,
  swapMoveItemLabel, swapMoveItemsCount, swapRescheduleCheck, swapRescheduleWindow,
} from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, usePullRefresh, useStore } from '../../shared/store/store';
import { api } from '../../shared/api/client';
import { Button, Callout, Card, CheckRow, Chips, DateStepper, Disclosure, EmptyState, IconTile, Input, OptionCard, Screen, ScreenHeader, Skeleton, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, R, S, T, TOUCH } from '../../shared/ui/theme';
import { PhotoThumbs } from '../../shared/ui/photo-picker';
import { FloorPlanPicker, type FloorPlanUnit } from '../facilities/floor-plan-picker';
import { AppendixText } from './appendix-text';
import { payHref } from '../payments/pay-intent';
import { contractSwaps, swapEndedAt } from './swap-status';

const METHODS: { value: SwapMethod; label: string }[] = (['SELF', 'DELIVERY'] as SwapMethod[]).map((v) => ({ value: v, label: SWAP_METHOD[v] }));

/** Loại kho của chi nhánh trong bước chọn cỡ (GET /contracts/:id/swap-candidates → unitTypes). */
interface CandidateType { _id: string; name: string; category: UnitCategory; areaM2: number; current: boolean; available: number; allowed: boolean }
/** Báo giá đổi cỡ kho (GET /contracts/:id/resize-quote) — đợt 15, C3; cùng dữ liệu với web. */
interface ResizeQuote {
  rentalPeriod: RentalPeriod; currentRate: number; gross: number; discountAmount: number; rate: number;
  currentDeposit: number; deposit: number; depositDiff: number;
  estimate: { from: string; rentDiff: number };
  servicesCancelled: boolean; acDropped: boolean;
  appendix: { number: number; title: string; clauses: { title: string; paragraphs: string[]; bullets: string[] }[] };
}

/**
 * Đổi ô kho. Đang có yêu cầu chưa xong (chờ duyệt / đã duyệt chờ chuyển) thì chỉ hiện yêu cầu đó để xem và rút, không cho gửi thêm;
 * không thì hiện yêu cầu vừa kết thúc gần đây (kèm lý do) và form gửi yêu cầu mới. Đợt 15 (C3): chọn cỡ kho khác cùng chi nhánh = ĐỔI CỠ
 * KHO — xem giá mới (cùng bậc ưu đãi), phần chênh kỳ đã trả theo ngày, tiền giữ chân mới, rồi đọc + xác nhận Phụ lục "Đổi cỡ kho".
 */
export default function SwapRequestScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [candidates, setCandidates] = useState<FloorPlanUnit[] | null>(null);
  const [types, setTypes] = useState<CandidateType[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [method, setMethod] = useState<SwapMethod>('SELF');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<ResizeQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [agree, setAgree] = useState(false);
  const [showAppendix, setShowAppendix] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Góp ý 17/11: đổi ngày chuyển (DELIVERY đã duyệt) — null = chưa mở ô chọn ngày.
  const [newDate, setNewDate] = useState<string | null>(null);
  const pull = usePullRefresh();

  const c = byId(db.contracts, contract);
  // Góp ý 17/11: đồ đang gửi (đợt nhập đã xác nhận còn trong kho, kiện gửi kín) — thuê người chuyển chọn món / số lượng, mặc định tất cả.
  const goods = swapMovableGoods(inventoryOf(db.intakeBatches.filter((b) => b.contractId === c?._id)).items);
  const [picks, setPicks] = useState<Record<string, number> | null>(null);
  const chosen = picks ?? Object.fromEntries(goods.map((g) => [g.itemId, g.inStorage]));
  const chosenItems = goods.filter((g) => chosen[g.itemId]).map((g) => ({ itemId: g.itemId, quantity: Math.min(chosen[g.itemId], g.inStorage) }));
  const deliveryOff = goods.length === 0;
  const { openSwap, recentSwap } = contractSwaps(db.swapRequests, c?._id);
  // RV3: lần chi nhánh chuyển đồ gần nhất (thuê người chuyển) — hiện biên bản chuyển đồ trong SWAP_DELIVERY_CLAIM_DAYS ngày.
  const lastMove = db.swapRequests
    .filter((s) => s.contractId === c?._id && s.status === 'DONE' && s.moveCheck && (s.completedAt ?? '') >= addDays(todayISO(), -SWAP_DELIVERY_CLAIM_DAYS))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
  // Chỉ tải sơ đồ ô trống khi thật sự hiện form gửi yêu cầu.
  const pendingIntake = openIntakeOf(db.intakeBatches, c?._id);
  const canRequest = c?.status === 'ACTIVE' && !openSwap && !pendingIntake;
  const currentType = c?.unitTypeId;
  const pickedType = typeId ?? currentType;
  const resize = !!pickedType && !!currentType && pickedType !== currentType;

  // Ô trống của loại đang chọn (+ danh sách loại kho của chi nhánh ở lần tải đầu).
  useEffect(() => {
    if (!contract || !canRequest || !pickedType) return;
    let alive = true;
    setCandidates(null); setUnitId(null);
    api.get<{ items: FloorPlanUnit[]; unitTypes?: CandidateType[] }>(`/contracts/${contract}/swap-candidates${resize ? `?unitTypeId=${pickedType}` : ''}`)
      .then((d) => { if (!alive) return; setCandidates(d.items); if (d.unitTypes?.length) setTypes(d.unitTypes); })
      .catch(() => alive && setCandidates([]));
    return () => { alive = false; };
  }, [contract, canRequest, pickedType, resize]);

  // Báo giá đổi cỡ: tải lại khi đổi loại / chọn ô (phụ lục in số ô) / server báo giá đã đổi. Báo giá mới thì phải xác nhận lại phụ lục.
  useEffect(() => {
    setAgree(false); setQuote(null); setQuoteErr('');
    if (!contract || !canRequest || !resize) return;
    let alive = true;
    api.get<ResizeQuote>(`/contracts/${contract}/resize-quote?unitTypeId=${pickedType}${unitId ? `&toUnitId=${unitId}` : ''}`)
      .then((q) => alive && setQuote(q))
      .catch((e) => alive && setQuoteErr(e instanceof Error ? e.message : 'Không tính được giá đổi cỡ kho'));
    return () => { alive = false; };
  }, [contract, canRequest, resize, pickedType, unitId, nonce]);

  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const unit = PERIOD_UNIT[c.billing.rentalPeriod];
  const canSend = !!unitId && reason.trim().length >= 5 && (!resize || (!!quote && agree)) && (method === 'SELF' || (!deliveryOff && chosenItems.length > 0));
  // Xong thao tác thì về màn Hợp đồng (lùi về nếu đang mở bên dưới, không thì thay màn này) để thấy trạng thái mới.
  const backToContract = () => router.dismissTo(`/contract/${c._id}`);
  // Loại kho chọn được: loại đang thuê, và loại khác còn ô trống, hợp chu kỳ thuê (L / XL chỉ thuê tháng).
  const typeOptions = types.filter((t) => t.current || (t.allowed && t.available > 0))
    .map((t) => ({ value: t._id, label: t.current ? `Giữ cỡ · ${t.name}` : `${t.name} · ${t.areaM2} m²` }));
  const monthOnlyHidden = types.some((t) => !t.current && !t.allowed);
  const submit = () => unitId && void run(
    'requestUnitSwap',
    { contractId: c._id, toUnitId: unitId, method, reason: reason.trim(), ...(resize && quote ? { acceptAppendix: agree, expected: { rate: quote.rate, deposit: quote.deposit } } : {}),
      ...(method === 'DELIVERY' ? { items: chosenItems } : {}) },
    (r) => `Đã gửi yêu cầu ${r.requestNumber} — chờ chi nhánh xét duyệt`, backToContract,
  ).then((r) => { if (!r.ok && r.code === 'PRICE_CHANGED') setNonce((n) => n + 1); });

  // Tester: rút yêu cầu phải hỏi lại (một chạm là mất ô đang giữ).
  const askWithdraw = (s: UnitSwapRequest) => confirmAction(
    'Rút yêu cầu đổi ô?',
    `Yêu cầu ${s.requestNumber} sẽ bị huỷ và ô ${unitLabel(db, s.toUnitId)} đang giữ cho bạn được nhả${s.feePrepay && s.paymentId ? `; phí đã trả ${vnd(s.fee)} được hoàn đủ` : ''}.`,
    'Rút yêu cầu',
    () => void run('cancelSwapRequest', { swapRequestId: s._id }, s.feePrepay && s.paymentId ? `Đã rút yêu cầu đổi ô — phí ${vnd(s.fee)} được hoàn đủ` : 'Đã rút yêu cầu đổi ô', backToContract),
  );
  // Góp ý 17/11: khách đổi ngày chi nhánh chuyển đồ — cùng quy tắc với server (swapRescheduleCheck).
  const today = todayISO();
  const win = swapRescheduleWindow(today);
  const dateCheck = openSwap && newDate ? swapRescheduleCheck(openSwap, newDate, today) : null;
  const canChangeDate = !!openSwap && openSwap.method === 'DELIVERY' && openSwap.status === 'APPROVED' && swapCustomerReschedulesLeft(openSwap) > 0;

  return (
    <Screen refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={C.brand700} />} footer={!openSwap && canRequest ? (
      <Button title={resize ? 'Xác nhận phụ lục & gửi' : 'Gửi yêu cầu'} icon="send" size="lg" disabled={!canSend} onPress={submit} />
    ) : undefined}>
      <ScreenHeader icon="swap-horizontal-outline" tone="blue" title="Yêu cầu đổi ô kho" subtitle={`${unitLabel(db, c.unitId)} · ${typeName(db, c.unitTypeId)} · ${facilityName(db, c.facilityId)}`} />

      {openSwap ? (
        <Card>
          <View style={st.head}>
            <IconTile icon="swap-horizontal-outline" tone="blue" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={st.sectionTitle}>Yêu cầu đổi ô {openSwap.requestNumber}</Text>
              <StatusBadge map={SWAP_REQUEST_STATUS} value={openSwap.status} />
            </View>
          </View>
          {/* Tester: thẻ yêu cầu đang chờ ghi rõ ô mới, hình thức, lý do — không chỉ mã và trạng thái. */}
          <InfoLine icon="swap-horizontal-outline" text={`Ô ${unitLabel(db, openSwap.fromUnitId)} → ô ${unitLabel(db, openSwap.toUnitId)}${openSwap.toUnitTypeId && openSwap.toUnitTypeId !== openSwap.unitTypeId ? ` (${typeName(db, openSwap.toUnitTypeId)})` : ''}`} />
          <InfoLine icon={openSwap.method === 'SELF' ? 'hand-left-outline' : 'car-outline'} text={`Hình thức: ${SWAP_METHOD[openSwap.method]}`} />
          <InfoLine icon="chatbox-ellipses-outline" text={`Lý do: ${openSwap.reason}`} />
          {pendingIntake && <Callout tone="amber" icon="cube-outline" style={{ marginTop: S.md }}>{swapBlockedByIntakeText(pendingIntake.code)}</Callout>}
          {openSwap.status === 'APPROVED' && openSwap.method === 'SELF' && openSwap.moveDeadline && (
            <InfoLine icon="time-outline" text={`Hạn tự chuyển: ${fmtDate(openSwap.moveDeadline)}`} />
          )}
          {openSwap.status === 'APPROVED' && openSwap.method === 'DELIVERY' && (
            <InfoLine icon="car-outline" text={`Chi nhánh chuyển ngày ${fmtDate(openSwap.scheduledFor)}`} />
          )}
          {/* Đổi cỡ kho (C3): loại mới, giá / tiền giữ chân mới, phần chênh ước tính — tính lại theo ngày chuyển xong. Cùng câu với web. */}
          {sizeChangeNote(openSwap) && (
            <Callout tone="blue" icon="resize-outline" style={{ marginTop: S.md }}>{`${typeName(db, openSwap.unitTypeId)} → ${typeName(db, openSwap.toUnitTypeId)}. ${sizeChangeNote(openSwap)}`}</Callout>
          )}
          {/* Góp ý 17/11: tiền đổi cỡ từng khoản (cùng nguồn với web và email duyệt). */}
          {openSwap.sizeChange && <MoneyRows x={openSwap.sizeChange} />}
          {!!openSwap.moveItems?.length && (
            <Disclosure title={`Đồ chi nhánh chuyển · ${swapMoveItemsCount(openSwap.moveItems)} món / kiện`} icon="cube-outline" style={{ marginTop: S.sm }}>
              <MoveItems items={openSwap.moveItems} />
            </Disclosure>
          )}
          <ScheduleHistory s={openSwap} />
          {/* Phí đổi ô chốt lúc duyệt (hoặc miễn phí: lần đầu / lỗi chi nhánh) — cùng câu với web. */}
          {openSwap.status === 'APPROVED' && (
            <Callout tone={!openSwap.fee || (openSwap.feePrepay && openSwap.paymentId) ? 'green' : 'amber'} icon="pricetag-outline" style={{ marginTop: S.md }}>{swapRequestNote(openSwap)}</Callout>
          )}
          {swapFeeDue(openSwap) > 0 && (
            <Button
              title={`Trả phí ${vnd(openSwap.fee)}`} icon="card-outline" style={{ marginTop: S.md }}
              onPress={() => router.push(payHref({
                target: { kind: 'SWAP_FEE', swapRequestId: openSwap._id }, facilityId: openSwap.facilityId, code: openSwap.requestNumber, purpose: 'Phí thuê người chuyển', amount: openSwap.fee,
                doneNote: 'Đã trả phí. Chi nhánh chuyển đồ đúng ngày hẹn.',
                back: { label: 'Về yêu cầu đổi ô', href: `/contract/swap?contract=${c._id}` },
              }))}
            />
          )}
          {canChangeDate && !newDate && (
            <Button title="Đổi ngày chuyển" icon="calendar-outline" variant="secondary" style={{ marginTop: S.md }}
              onPress={() => setNewDate(openSwap.scheduledFor && openSwap.scheduledFor >= win.min && openSwap.scheduledFor <= win.max ? openSwap.scheduledFor : win.min)} />
          )}
          {canChangeDate && newDate && (
            <View style={st.moveBox}>
              <DateStepper label={`Ngày chuyển mới · còn đổi ${swapCustomerReschedulesLeft(openSwap)}/${SWAP_CUSTOMER_RESCHEDULE_MAX} lần`} value={newDate} onChange={setNewDate} min={win.min} max={win.max} />
              <Text style={st.hint}>{dateCheck && !dateCheck.ok && dateCheck.code !== 'SWAP_SAME_DATE' ? dateCheck.message : `Từ ngày mai đến tối đa ${SWAP_SELF_MOVE_DAYS} ngày kể từ hôm nay. Phí, ô mới và đồ cần chuyển giữ nguyên; chi nhánh được báo qua email.`}</Text>
              <View style={st.moveActions}>
                <Button title="Đóng" variant="secondary" style={{ flex: 1 }} onPress={() => setNewDate(null)} />
                <Button title="Lưu ngày mới" style={{ flex: 1.4 }} disabled={!dateCheck?.ok}
                  onPress={() => void run('rescheduleSwapDelivery', { swapRequestId: openSwap._id, scheduledFor: newDate }, (v) => `Đã đổi ngày chuyển sang ${fmtDate(v.scheduledFor)}`, () => setNewDate(null))} />
              </View>
            </View>
          )}
          {(openSwap.status === 'SUBMITTED' || openSwap.status === 'APPROVED') && (
            <Button
              title="Rút yêu cầu" variant="secondary" icon="arrow-undo-outline" style={{ marginTop: S.md }}
              onPress={() => askWithdraw(openSwap)}
            />
          )}
        </Card>
      ) : (
        <>
          {lastMove?.moveCheck && (
            <Card style={{ marginBottom: S.md }}>
              <View style={st.head}>
                <IconTile icon="cube-outline" tone="blue" size="sm" />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={st.sectionTitle}>Biên bản chuyển đồ {lastMove.requestNumber}</Text>
                  <Text style={st.hint}>{fmtDate(lastMove.completedAt)} · chi nhánh chuyển {lastMove.moveCheck.packages} kiện / món sang ô mới</Text>
                </View>
              </View>
              {lastMove.moveCheck.note ? <Text style={[st.body, { marginBottom: S.sm }]}>Ghi chú: {lastMove.moveCheck.note}</Text> : null}
              {/* Góp ý 17/11: danh sách đồ khách nhờ chuyển — món nhân viên đã tick chuyển / chưa chuyển. */}
              {!!lastMove.moveItems?.length && <View style={{ marginBottom: S.sm }}><MoveItems items={lastMove.moveItems} reason={lastMove.moveCheck.unmovedReason} /></View>}
              {lastMove.moveCheck.unmovedReason === 'NOT_YET' && <Text style={[st.hint, { marginBottom: S.sm }]}>Chi nhánh sẽ chuyển nốt các món chưa chuyển sang ô mới.</Text>}
              {lastMove.moveCheck.unmovedReason === 'NOT_FOUND' && <Text style={[st.hint, { marginBottom: S.sm }]}>Chi nhánh đang tìm các món chưa thấy — không tìm thấy thì chi nhánh báo bạn và xử lý bồi thường.</Text>}
              <PhotoThumbs urls={lastMove.moveCheck.photoUrls} />
              <Callout tone="blue" icon="shield-checkmark-outline" style={{ marginTop: S.md }}>{`Thấy hư hại / thiếu đồ do việc chuyển, gửi yêu cầu bồi thường trong ${SWAP_DELIVERY_CLAIM_DAYS} ngày — chi nhánh đối chiếu biên bản này.`}</Callout>
            </Card>
          )}
          {recentSwap && (
            <Card style={{ marginBottom: S.md }}>
              <View style={st.head}>
                <IconTile icon="time-outline" tone="gray" size="sm" />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={st.sectionTitle}>Yêu cầu đổi ô {recentSwap.requestNumber}</Text>
                  <StatusBadge map={SWAP_REQUEST_STATUS} value={recentSwap.status} />
                </View>
              </View>
              <Text style={st.body}>{fmtDate(swapEndedAt(recentSwap))} · {swapRequestNote(recentSwap)}</Text>
            </Card>
          )}

          {!canRequest ? <Callout tone="amber" icon="lock-closed-outline">{pendingIntake ? swapBlockedByIntakeText(pendingIntake.code) : 'Chỉ gửi yêu cầu đổi ô khi hợp đồng đang hiệu lực.'}</Callout> : (
            <>
              {typeOptions.length > 1 && (
                <Card style={{ marginBottom: S.md }}>
                  <View style={st.head}>
                    <IconTile icon="resize-outline" tone="violet" size="sm" />
                    <View style={{ flex: 1 }}>
                      <Text style={st.sectionTitle}>Cỡ kho</Text>
                      <Text style={T.caption}>Giữ cỡ để đổi sang ô khác cùng loại, hoặc chọn kho lớn hơn / nhỏ hơn — không phải làm hợp đồng mới.</Text>
                    </View>
                  </View>
                  <Chips options={typeOptions} value={pickedType ?? ''} onChange={(v) => setTypeId(v)} columns={2} />
                  {monthOnlyHidden && <Text style={st.hint}>{MONTH_ONLY_MESSAGE} — hợp đồng thuê theo {unit} không đổi sang được.</Text>}
                </Card>
              )}

              {resize && (
                <Card style={{ marginBottom: S.md }}>
                  <View style={st.head}>
                    <IconTile icon="swap-vertical-outline" tone="violet" size="sm" />
                    <Text style={[st.sectionTitle, { flex: 1 }]}>Đổi cỡ: {typeName(db, c.unitTypeId)} → {typeName(db, pickedType)}</Text>
                  </View>
                  {quoteErr ? <Callout tone="red" icon="alert-circle-outline">{quoteErr}</Callout> : !quote ? <View style={{ gap: S.sm }}><Skeleton h={14} w="70%" /><Skeleton h={14} w="50%" /></View> : (
                    <>
                      {/* Góp ý 17/11: từng khoản — tiền thuê cũ → mới, chênh tiền giữ chân, chênh tiền thuê kỳ đã trả, tổng phải trả thêm / được hoàn. */}
                      <MoneyRows x={quote} />
                      {quote.discountAmount > 0 && <Text style={st.hint}>Giá mới = giá niêm yết {vnd(quote.gross)} − ưu đãi {vnd(quote.discountAmount)}/{unit} (cùng bậc ưu đãi).</Text>}
                      <Callout tone="blue" icon="information-circle-outline" style={{ marginTop: S.md }}>
                        {['Đổi cỡ là sửa đổi hợp đồng, không phải chấm dứt: thời hạn, kỳ cam kết, đồ đang gửi giữ nguyên; không bị giới hạn mức hoàn hay thu lại ưu đãi vì việc đổi cỡ.',
                          quote.servicesCancelled ? 'Kho mới không có dịch vụ thêm — đơn dịch vụ chưa làm được huỷ và hoàn tiền.' : '',
                          quote.acDropped ? 'Kho mới không có điều hòa — thôi tính phụ phí điều hòa.' : ''].filter(Boolean).join(' ')}
                      </Callout>
                    </>
                  )}
                </Card>
              )}

              <Card>
                <View style={st.head}>
                  <IconTile icon="grid-outline" size="sm" />
                  <View style={{ flex: 1 }}>
                    <Text style={st.sectionTitle}>Chọn ô mới trên sơ đồ</Text>
                    <Text style={T.caption}>{resize ? 'Ô của loại kho mới.' : 'Giá thuê và tiền giữ chân giữ nguyên.'}</Text>
                  </View>
                </View>
                {candidates === null ? <View style={{ gap: S.sm }}><Skeleton h={14} w="60%" /><Skeleton h={56} /></View> : <FloorPlanPicker items={candidates} value={unitId} onChange={setUnitId} />}
                {(() => {
                  // Đợt 16 (B1): đổi ô luôn cấp phương tiện mở MỚI cho ô mới như lúc nhận kho — báo trước để khách không bất ngờ.
                  const lock = candidates?.find((u) => u._id === unitId)?.accessMethod;
                  return lock ? (
                    <Callout tone={lock !== c.access.method ? 'amber' : 'blue'} icon="key-outline" style={{ marginTop: S.md }}>
                      {lock !== c.access.method ? `Ô này khoá bằng ${ACCESS_METHOD[lock]}, khác ô bạn đang thuê (${ACCESS_METHOD[c.access.method]}). ` : ''}Khi đổi xong, {ACCESS_METHOD[c.access.method].toLowerCase()} cũ hết hiệu lực — {lock === 'PIN' ? 'bạn nhận mật khẩu mới trong tài khoản' : `chi nhánh giao ${ACCESS_METHOD[lock].toLowerCase()} mới`} và bạn trả lại {c.access.method === 'PIN' ? 'ô cũ để chi nhánh đặt lại ổ khoá' : `${ACCESS_METHOD[c.access.method].toLowerCase()} của ô cũ`}.
                    </Callout>
                  ) : null;
                })()}
              </Card>

              <Card style={{ marginTop: S.md }}>
                <View style={st.head}>
                  <IconTile icon="car-outline" tone="blue" size="sm" />
                  <Text style={[st.sectionTitle, { flex: 1 }]}>Hình thức chuyển</Text>
                </View>
                {METHODS.map((m) => (
                  <OptionCard key={m.value} selected={method === m.value} onPress={() => setMethod(m.value)} disabled={m.value === 'DELIVERY' && deliveryOff}
                    icon={m.value === 'SELF' ? 'hand-left-outline' : 'car-outline'} title={m.label}
                    subtitle={m.value === 'DELIVERY' && deliveryOff ? `Chưa dùng được: ${SWAP_NO_GOODS_TEXT}` : m.value === 'SELF' ? 'Bạn tự chuyển trong 7 ngày sau khi duyệt' : 'Chi nhánh cử người chuyển theo ngày hẹn'}
                    style={{ marginBottom: S.sm }} />
                ))}
                {method === 'DELIVERY' && !deliveryOff && <GoodsPicker goods={goods} picks={chosen} onChange={setPicks} />}
                <Text style={st.hint}>
                  {method === 'SELF' ? 'Sau khi được duyệt, bạn có 7 ngày để tự chuyển đồ sang ô mới.' : 'Chi nhánh sẽ hẹn ngày cử người chuyển giúp bạn. Có phí thì bạn trả sau khi được duyệt, trước ngày chuyển.'}
                </Text>
                <Callout tone={method === 'SELF' ? 'amber' : 'blue'} icon="shield-checkmark-outline" style={{ marginTop: S.sm }}>{SWAP_LIABILITY[method]}</Callout>
              </Card>

              <Card style={{ marginTop: S.md }}>
                <View style={st.head}>
                  <IconTile icon="chatbox-ellipses-outline" tone="violet" size="sm" />
                  <Text style={[st.sectionTitle, { flex: 1 }]}>{resize ? 'Lý do muốn đổi cỡ kho' : 'Lý do muốn đổi ô'}</Text>
                </View>
                <Input
                  value={reason} onChangeText={setReason} multiline numberOfLines={3}
                  placeholder={resize ? 'VD: Cần kho rộng hơn để chứa thêm đồ.' : 'VD: Muốn đổi sang ô gần cửa ra vào hơn để dễ chở đồ.'}
                />
                <Disclosure title="Phí đổi ô" icon="pricetag-outline" style={{ marginTop: S.xs }}>
                  Phí đổi ô (nếu có) sẽ được chi nhánh thông báo khi duyệt — miễn phí nếu là lần đổi đầu tiên hoặc do lỗi từ chi nhánh.
                </Disclosure>
              </Card>

              {resize && quote && (
                <Card style={{ marginTop: S.md }}>
                  <View style={st.head}>
                    <IconTile icon="document-attach-outline" tone="violet" size="sm" />
                    <Text style={[st.sectionTitle, { flex: 1 }]}>{quote.appendix.title}</Text>
                  </View>
                  <Pressable onPress={() => setShowAppendix((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showAppendix }}
                    style={({ pressed }) => [st.toggle, pressed && { opacity: 0.7 }]}>
                    <Ionicons name="reader-outline" size={17} color={C.brand700} />
                    <Text style={st.toggleText}>{showAppendix ? 'Thu gọn' : 'Đọc'} {quote.appendix.title}</Text>
                    <Ionicons name={showAppendix ? 'chevron-up' : 'chevron-down'} size={18} color={C.brand700} />
                  </Pressable>
                  {showAppendix && <AppendixText clauses={quote.appendix.clauses} />}
                  <CheckRow checked={agree} onPress={() => setAgree((v) => !v)} style={{ marginTop: S.sm }}>
                    Tôi đã đọc và đồng ý toàn bộ nội dung {quote.appendix.title} (có hiệu lực khi chi nhánh xác nhận tôi đã chuyển xong). Việc xác nhận này trên tài khoản của tôi có giá trị như chữ ký của tôi trên phụ lục.
                  </CheckRow>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function InfoLine({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={st.info}>
      <Ionicons name={icon} size={16} color={C.brand700} />
      <Text style={st.body}>{text}</Text>
    </View>
  );
}

/** Góp ý 17/11: tiền khi đổi cỡ kho từng khoản (sizeChangeMoneyLines — cùng nguồn với web và email duyệt). */
function MoneyRows({ x }: { x: SizeChangeMoneyInput }) {
  return (
    <View style={st.money}>
      {sizeChangeMoneyLines(x).map((l) => (
        <View key={l.label} style={l.total ? st.moneyTotal : undefined}>
          {/* Màn hẹp: nhãn một dòng, số một dòng (không bẻ "₫" xuống dòng), ghi chú bên dưới. */}
          <Text style={[st.moneyLabel, l.total && { color: C.ink, fontWeight: '700' }]}>{l.label}</Text>
          <Text style={[st.moneyValue, l.total && { fontSize: 16 }]}>{l.value}</Text>
          {l.note ? <Text style={st.moneyNote}>{l.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Danh sách đồ cần chuyển / biên bản: đã hoàn tất thì ✓ món đã chuyển, ✗ món chưa chuyển kèm lý do (`reason` = moveCheck.unmovedReason). */
function MoveItems({ items, reason }: { items: readonly SwapMoveItem[]; reason?: SwapUnmovedReason | null }) {
  const recorded = items.some((it) => it.moved != null);
  return (
    <View style={{ gap: 4 }}>
      {items.map((it) => (
        <View key={it.itemId} style={st.info}>
          <Ionicons name={!recorded ? 'ellipse' : it.moved ? 'checkmark-circle' : 'close-circle'} size={recorded ? 16 : 7} color={!recorded ? C.faint : it.moved ? C.green : C.red} />
          <Text style={[st.body, { flex: 1 }]}>
            <Text style={recorded && !it.moved ? { color: C.muted, textDecorationLine: 'line-through' } : undefined}>{swapMoveItemLabel(it)} · đợt {it.batchCode}</Text>
            {recorded && !it.moved && reason ? <Text style={{ color: C.amber, fontWeight: '600' }}>{` · ${SWAP_UNMOVED_REASON[reason]}`}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Lịch sử dời ngày chuyển (chi nhánh dời / khách tự đổi). */
function ScheduleHistory({ s }: { s: UnitSwapRequest }) {
  const list = s.scheduleChanges ?? [];
  if (!list.length) return null;
  return (
    <View style={{ marginTop: S.sm, gap: 2 }}>
      {list.map((x, i) => (
        <InfoLine key={i} icon="calendar-outline" text={`${x.byRole === 'CUSTOMER' ? 'Bạn đổi' : 'Chi nhánh dời'} ngày chuyển ${x.from ? fmtDate(x.from) : '—'} → ${fmtDate(x.to)} (${fmtDate(x.at)})`} />
      ))}
    </View>
  );
}

/** Chọn món / số lượng cần chi nhánh chuyển — mặc định tất cả đồ đang gửi. */
function GoodsPicker({ goods, picks, onChange }: { goods: readonly SwapGoodsLine[]; picks: Record<string, number>; onChange: (p: Record<string, number>) => void }) {
  const set = (id: string, n: number | null) => {
    const next = { ...picks };
    if (n === null) delete next[id]; else next[id] = n;
    onChange(next);
  };
  const count = goods.reduce((s, g) => s + (picks[g.itemId] ?? 0), 0);
  const all = goods.every((g) => picks[g.itemId] === g.inStorage);
  return (
    <View style={st.goods}>
      <View style={[st.info, { marginTop: 0, marginBottom: S.xs }]}>
        <Text style={[st.sectionTitle, { flex: 1, fontSize: 14 }]}>Đồ cần chuyển · {count} món / kiện</Text>
        <Pressable onPress={() => onChange(all ? {} : Object.fromEntries(goods.map((g) => [g.itemId, g.inStorage])))} accessibilityRole="button" hitSlop={8}>
          <Text style={st.link}>{all ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</Text>
        </Pressable>
      </View>
      {goods.map((g) => {
        const n = picks[g.itemId] ?? 0;
        return (
          <View key={g.itemId} style={st.goodsRow}>
            <CheckRow checked={n > 0} onPress={() => set(g.itemId, n > 0 ? null : g.inStorage)} style={{ flex: 1 }}>
              {`${g.name}${g.sealed ? ' (gửi kín)' : ''} · đợt ${g.batchCode} · đang gửi ${g.inStorage}`}
            </CheckRow>
            {!g.sealed && g.inStorage > 1 && n > 0 && (
              <View style={st.stepper}>
                <Pressable onPress={() => set(g.itemId, Math.max(1, n - 1))} disabled={n <= 1} accessibilityLabel="Bớt một" hitSlop={6} style={st.stepBtn}><Ionicons name="remove" size={16} color={n <= 1 ? C.faint : C.ink} /></Pressable>
                <Text style={st.stepVal}>{n}</Text>
                <Pressable onPress={() => set(g.itemId, Math.min(g.inStorage, n + 1))} disabled={n >= g.inStorage} accessibilityLabel="Thêm một" hitSlop={6} style={st.stepBtn}><Ionicons name="add" size={16} color={n >= g.inStorage ? C.faint : C.ink} /></Pressable>
              </View>
            )}
          </View>
        );
      })}
      {count === 0 && <Text style={[st.hint, { color: C.red }]}>Chọn ít nhất một món cần chuyển.</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  money: { marginTop: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.brand50, gap: S.sm },
  moneyTotal: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm },
  moneyLabel: { fontSize: 13, lineHeight: 18, color: C.muted },
  moneyValue: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: C.ink },
  moneyNote: { fontSize: 12, lineHeight: 16, color: C.muted },
  goods: { marginTop: S.sm, marginBottom: S.sm, padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.line },
  goodsRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: 30, height: 30, borderRadius: R.sm, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 24, textAlign: 'center', fontSize: 14, fontWeight: '700', color: C.ink },
  link: { fontSize: 13, fontWeight: '700', color: C.brand700 },
  moveBox: { marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft },
  moveActions: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.md },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  body: { flex: 1, fontSize: 13, lineHeight: 19, color: C.text },
  info: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.xs },
  hint: { fontSize: 13, lineHeight: 19, color: C.muted, marginTop: S.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: TOUCH, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.brand50 },
  toggleText: { fontSize: 14, fontWeight: '700', color: C.brand700, flex: 1 },
});
