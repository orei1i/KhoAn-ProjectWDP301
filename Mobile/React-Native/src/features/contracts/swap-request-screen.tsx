import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { SwapMethod } from '@ssm/shared';
import { ACCESS_METHOD, SWAP_METHOD } from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { api } from '../../shared/api/client';
import { Button, Card, Chips, EmptyState, Input, Screen, ScreenHeader } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';
import { FloorPlanPicker, type FloorPlanUnit } from '../facilities/floor-plan-picker';

const METHODS: { value: SwapMethod; label: string }[] = (['SELF', 'DELIVERY'] as SwapMethod[]).map((v) => ({ value: v, label: SWAP_METHOD[v] }));

export default function SwapRequestScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [candidates, setCandidates] = useState<FloorPlanUnit[] | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [method, setMethod] = useState<SwapMethod>('SELF');
  const [reason, setReason] = useState('');

  const c = byId(db.contracts, contract);

  useEffect(() => {
    if (!contract) return;
    let alive = true;
    api.get<{ items: FloorPlanUnit[] }>(`/contracts/${contract}/swap-candidates`).then((d) => alive && setCandidates(d.items));
    return () => { alive = false; };
  }, [contract]);

  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const canSend = !!unitId && reason.trim().length >= 5;

  return (
    <Screen>
      <ScreenHeader title="Yêu cầu đổi ô kho" subtitle={`${unitLabel(db, c.unitId)} · ${typeName(db, c.unitTypeId)} · ${facilityName(db, c.facilityId)}`} />

      <Card>
        <Text style={st.sectionTitle}>Chọn ô mới trên sơ đồ</Text>
        <Text style={st.hint}>Giá thuê và tiền giữ chân giữ nguyên.</Text>
        {candidates === null ? <Text style={st.hint}>Đang tải sơ đồ…</Text> : <FloorPlanPicker items={candidates} value={unitId} onChange={setUnitId} />}
        {(() => {
          // Hình thức khoá thuộc về từng ô: chọn ô khác khoá thì báo trước để khách không bất ngờ.
          const lock = candidates?.find((u) => u._id === unitId)?.accessMethod;
          return lock && lock !== c.access.method ? (
            <Text style={[st.hint, { color: '#92400e' }]}>
              Ô này khoá bằng {ACCESS_METHOD[lock]}, khác ô bạn đang thuê ({ACCESS_METHOD[c.access.method]}). Khi đổi xong, {ACCESS_METHOD[c.access.method].toLowerCase()} cũ hết hiệu lực và chi nhánh cấp {ACCESS_METHOD[lock].toLowerCase()} mới cho bạn.
            </Text>
          ) : null;
        })()}
      </Card>

      <Card style={{ marginTop: S.md }}>
        <Text style={st.sectionTitle}>Hình thức chuyển</Text>
        <Chips options={METHODS} value={method} onChange={setMethod} columns={2} />
        <Text style={st.hint}>
          {method === 'SELF' ? 'Sau khi được duyệt, bạn có 7 ngày để tự chuyển đồ sang ô mới.' : 'Chi nhánh sẽ liên hệ hẹn ngày cử người chuyển giúp bạn.'}
        </Text>
      </Card>

      <Card style={{ marginTop: S.md }}>
        <Text style={st.sectionTitle}>Lý do muốn đổi ô</Text>
        <Input
          value={reason} onChangeText={setReason} multiline numberOfLines={3} style={st.multiline}
          placeholder="VD: Muốn đổi sang ô gần cửa ra vào hơn để dễ chở đồ."
        />
        <Text style={st.hint}>Phí đổi ô (nếu có) sẽ được chi nhánh thông báo khi duyệt — miễn phí nếu là lần đổi đầu tiên hoặc do lỗi từ chi nhánh.</Text>
      </Card>

      <Button
        title="Gửi yêu cầu" disabled={!canSend} style={{ marginTop: S.lg }}
        onPress={() => unitId && void run(
          'requestUnitSwap', { contractId: c._id, toUnitId: unitId, method, reason: reason.trim() },
          (r) => `Đã gửi yêu cầu ${r.requestNumber} — chờ chi nhánh xét duyệt`, () => router.back(),
        )}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  hint: { fontSize: 12, color: C.muted, marginTop: 6, marginBottom: S.sm },
  multiline: { height: 80, paddingTop: S.sm, textAlignVertical: 'top' },
});
