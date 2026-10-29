import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { SwapMethod } from '@ssm/shared';
import { ACCESS_METHOD, SWAP_METHOD, SWAP_REQUEST_STATUS, fmtDate, swapRequestNote } from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { api } from '../../shared/api/client';
import { Button, Callout, Card, Chips, Disclosure, EmptyState, IconTile, Input, Screen, ScreenHeader, Skeleton, StatusBadge } from '../../shared/ui';
import { C, S, T } from '../../shared/ui/theme';
import { FloorPlanPicker, type FloorPlanUnit } from '../facilities/floor-plan-picker';
import { contractSwaps, swapEndedAt } from './swap-status';

const METHODS: { value: SwapMethod; label: string }[] = (['SELF', 'DELIVERY'] as SwapMethod[]).map((v) => ({ value: v, label: SWAP_METHOD[v] }));

/**
 * Đổi ô kho. Đang có yêu cầu chưa xong (chờ duyệt / đã duyệt chờ chuyển) thì chỉ hiện yêu cầu đó để xem và rút, không cho gửi thêm;
 * không thì hiện yêu cầu vừa kết thúc gần đây (kèm lý do) và form gửi yêu cầu mới.
 */
export default function SwapRequestScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [candidates, setCandidates] = useState<FloorPlanUnit[] | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [method, setMethod] = useState<SwapMethod>('SELF');
  const [reason, setReason] = useState('');

  const c = byId(db.contracts, contract);
  const { openSwap, recentSwap } = contractSwaps(db.swapRequests, c?._id);
  // Chỉ tải sơ đồ ô trống khi thật sự hiện form gửi yêu cầu.
  const canRequest = c?.status === 'ACTIVE' && !openSwap;

  useEffect(() => {
    if (!contract || !canRequest) return;
    let alive = true;
    api.get<{ items: FloorPlanUnit[] }>(`/contracts/${contract}/swap-candidates`).then((d) => alive && setCandidates(d.items));
    return () => { alive = false; };
  }, [contract, canRequest]);

  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const canSend = !!unitId && reason.trim().length >= 5;
  // Xong thao tác thì về màn Hợp đồng (lùi về nếu đang mở bên dưới, không thì thay màn này) để thấy trạng thái mới.
  const backToContract = () => router.dismissTo(`/contract/${c._id}`);

  return (
    <Screen footer={!openSwap && canRequest ? (
      <Button
        title="Gửi yêu cầu" icon="send" size="lg" disabled={!canSend}
        onPress={() => unitId && void run(
          'requestUnitSwap', { contractId: c._id, toUnitId: unitId, method, reason: reason.trim() },
          (r) => `Đã gửi yêu cầu ${r.requestNumber} — chờ chi nhánh xét duyệt`, backToContract,
        )}
      />
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
              <Card>
                <View style={st.head}>
                  <IconTile icon="grid-outline" size="sm" />
                  <View style={{ flex: 1 }}>
                    <Text style={st.sectionTitle}>Chọn ô mới trên sơ đồ</Text>
                    <Text style={T.caption}>Giá thuê và tiền giữ chân giữ nguyên.</Text>
                  </View>
                </View>
                {candidates === null ? <View style={{ gap: S.sm }}><Skeleton h={14} w="60%" /><Skeleton h={56} /></View> : <FloorPlanPicker items={candidates} value={unitId} onChange={setUnitId} />}
                {(() => {
                  // Hình thức khoá thuộc về từng ô: chọn ô khác khoá thì báo trước để khách không bất ngờ.
                  const lock = candidates?.find((u) => u._id === unitId)?.accessMethod;
                  return lock && lock !== c.access.method ? (
                    <Callout tone="amber" icon="key-outline" style={{ marginTop: S.md }}>
                      Ô này khoá bằng {ACCESS_METHOD[lock]}, khác ô bạn đang thuê ({ACCESS_METHOD[c.access.method]}). Khi đổi xong, {ACCESS_METHOD[c.access.method].toLowerCase()} cũ hết hiệu lực và chi nhánh cấp {ACCESS_METHOD[lock].toLowerCase()} mới cho bạn.
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
                  <Text style={[st.sectionTitle, { flex: 1 }]}>Lý do muốn đổi ô</Text>
                </View>
                <Input
                  value={reason} onChangeText={setReason} multiline numberOfLines={3}
                  placeholder="VD: Muốn đổi sang ô gần cửa ra vào hơn để dễ chở đồ."
                />
                <Disclosure title="Phí đổi ô" icon="pricetag-outline" style={{ marginTop: S.xs }}>
                  Phí đổi ô (nếu có) sẽ được chi nhánh thông báo khi duyệt — miễn phí nếu là lần đổi đầu tiên hoặc do lỗi từ chi nhánh.
                </Disclosure>
              </Card>
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
});
