import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { RentalPeriod, SwapMethod, UnitCategory } from '@ssm/shared';
import { ACCESS_METHOD, MONTH_ONLY_MESSAGE, PERIOD_UNIT, SWAP_METHOD, SWAP_REQUEST_STATUS, fmtDate, sizeChangeNote, swapRequestNote, vnd } from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { api } from '../../shared/api/client';
import { Button, Callout, Card, CheckRow, Chips, Disclosure, EmptyState, IconTile, Input, KV, Screen, ScreenHeader, Skeleton, StatusBadge } from '../../shared/ui';
import { C, R, S, T, TOUCH } from '../../shared/ui/theme';
import { FloorPlanPicker, type FloorPlanUnit } from '../facilities/floor-plan-picker';
import { AppendixText } from './appendix-text';
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
/** "thu thêm X" / "hoàn X" / "không đổi" — phần chênh tiền thuê, tiền giữ chân. */
const diffText = (n: number, more: string, back: string) => (n > 0 ? `${more} ${vnd(n)}` : n < 0 ? `${back} ${vnd(-n)}` : 'không đổi');

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

  const c = byId(db.contracts, contract);
  const { openSwap, recentSwap } = contractSwaps(db.swapRequests, c?._id);
  // Chỉ tải sơ đồ ô trống khi thật sự hiện form gửi yêu cầu.
  const canRequest = c?.status === 'ACTIVE' && !openSwap;
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
  const canSend = !!unitId && reason.trim().length >= 5 && (!resize || (!!quote && agree));
  // Xong thao tác thì về màn Hợp đồng (lùi về nếu đang mở bên dưới, không thì thay màn này) để thấy trạng thái mới.
  const backToContract = () => router.dismissTo(`/contract/${c._id}`);
  // Loại kho chọn được: loại đang thuê, và loại khác còn ô trống, hợp chu kỳ thuê (L / XL chỉ thuê tháng).
  const typeOptions = types.filter((t) => t.current || (t.allowed && t.available > 0))
    .map((t) => ({ value: t._id, label: t.current ? `Giữ cỡ · ${t.name}` : `${t.name} · ${t.areaM2} m²` }));
  const monthOnlyHidden = types.some((t) => !t.current && !t.allowed);
  const submit = () => unitId && void run(
    'requestUnitSwap',
    { contractId: c._id, toUnitId: unitId, method, reason: reason.trim(), ...(resize && quote ? { acceptAppendix: agree, expected: { rate: quote.rate, deposit: quote.deposit } } : {}) },
    (r) => `Đã gửi yêu cầu ${r.requestNumber} — chờ chi nhánh xét duyệt`, backToContract,
  ).then((r) => { if (!r.ok && r.code === 'PRICE_CHANGED') setNonce((n) => n + 1); });

  return (
    <Screen footer={!openSwap && canRequest ? (
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
          {openSwap.status === 'APPROVED' && openSwap.method === 'SELF' && openSwap.moveDeadline && (
            <InfoLine icon="time-outline" text={`Hạn tự chuyển: ${fmtDate(openSwap.moveDeadline)}`} />
          )}
          {openSwap.status === 'APPROVED' && openSwap.method === 'DELIVERY' && (
            <InfoLine icon="car-outline" text={`Chi nhánh chuyển ngày ${fmtDate(openSwap.scheduledFor)}${openSwap.assignedStaffName ? ` — nhân viên ${openSwap.assignedStaffName}` : ''}`} />
          )}
          {/* Đổi cỡ kho (C3): loại mới, giá / tiền giữ chân mới, phần chênh ước tính — tính lại theo ngày chuyển xong. Cùng câu với web. */}
          {sizeChangeNote(openSwap) && (
            <Callout tone="blue" icon="resize-outline" style={{ marginTop: S.md }}>{`${typeName(db, openSwap.unitTypeId)} → ${typeName(db, openSwap.toUnitTypeId)}. ${sizeChangeNote(openSwap)}`}</Callout>
          )}
          {/* Phí đổi ô chốt lúc duyệt (hoặc miễn phí: lần đầu / lỗi chi nhánh) — cùng câu với web. */}
          {openSwap.status === 'APPROVED' && (
            <Callout tone={openSwap.fee ? 'amber' : 'green'} icon="pricetag-outline" style={{ marginTop: S.md }}>{swapRequestNote(openSwap)}</Callout>
          )}
          {(openSwap.status === 'SUBMITTED' || openSwap.status === 'APPROVED') && (
            <Button
              title="Rút yêu cầu" variant="secondary" icon="arrow-undo-outline" style={{ marginTop: S.md }}
              onPress={() => void run('cancelSwapRequest', { swapRequestId: openSwap._id }, 'Đã rút yêu cầu đổi ô', backToContract)}
            />
          )}
        </Card>
      ) : (
        <>
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

          {!canRequest ? <Callout tone="amber" icon="lock-closed-outline">Chỉ gửi yêu cầu đổi ô khi hợp đồng đang hiệu lực.</Callout> : (
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
                      <KV items={[
                        ['Tiền thuê', `${vnd(quote.currentRate)} → ${vnd(quote.rate)}/${unit}`],
                        ...(quote.discountAmount > 0 ? [['Ưu đãi (cùng bậc)', `−${vnd(quote.discountAmount)}/${unit} trên giá ${vnd(quote.gross)}`] as [string, string]] : []),
                        ['Phần chênh kỳ đã trả', diffText(quote.estimate.rentDiff, 'thu thêm', 'hoàn')],
                        ['Tiền giữ chân', `${vnd(quote.currentDeposit)} → ${vnd(quote.deposit)} (${diffText(quote.depositDiff, 'nộp thêm', 'được hoàn')})`],
                      ]} />
                      <Text style={st.hint}>Phần chênh tính theo ngày — ước tính nếu đổi ngày {fmtDate(quote.estimate.from)}, tính lại theo ngày chuyển xong. Khoản thu thêm cộng vào công nợ; khoản hoàn trả theo cách bạn đã thanh toán.</Text>
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
                <Chips options={METHODS} value={method} onChange={setMethod} columns={2} />
                <Text style={st.hint}>
                  {method === 'SELF' ? 'Sau khi được duyệt, bạn có 7 ngày để tự chuyển đồ sang ô mới.' : 'Chi nhánh sẽ liên hệ hẹn ngày cử người chuyển giúp bạn.'}
                </Text>
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

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.md },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  body: { flex: 1, fontSize: 13, lineHeight: 19, color: C.text },
  info: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.xs },
  hint: { fontSize: 13, lineHeight: 19, color: C.muted, marginTop: S.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: TOUCH, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.brand50 },
  toggleText: { fontSize: 14, fontWeight: '700', color: C.brand700, flex: 1 },
});
