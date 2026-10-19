import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ClaimItem, ClaimType } from '@ssm/shared';
import { CLAIM_TYPE, addDays, todayISO, vnd } from '@ssm/shared';
import { CLAIM_LIABILITY_CAP, CLAIM_WINDOW_DAYS, claimTotal, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, Chips, DateStepper, EmptyState, Field, Input, Screen, ScreenHeader } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

const TYPE_OPTIONS: { value: ClaimType; label: string }[] = [
  { value: 'DAMAGE', label: CLAIM_TYPE.DAMAGE }, { value: 'LOSS', label: CLAIM_TYPE.LOSS },
];
const EMPTY_ITEM: ClaimItem = { name: '', quantity: 1, unitValue: 0 };

export default function ClaimNewScreen() {
  const { contract } = useLocalSearchParams<{ contract?: string }>();
  const { db, user, run } = useStore();
  const router = useRouter();

  // Hợp đồng còn hiệu lực, hoặc vừa đóng trong hạn khiếu nại — khớp rule BE claim.service.ts.
  // ABANDONED (hàng bỏ lại, đã thanh lý) không có quy trình khiếu nại — loại hẳn, không tính hạn khiếu nại.
  const eligible = user
    ? db.contracts.filter((c) => c.customerId === user._id && c.status !== 'ABANDONED' && (c.status !== 'CLOSED' || (c.closedAt ?? '') >= addDays(todayISO(), -CLAIM_WINDOW_DAYS)))
    : [];
  const [contractId, setContractId] = useState(contract && eligible.some((c) => c._id === contract) ? contract : (eligible[0]?._id ?? ''));
  const [type, setType] = useState<ClaimType>('DAMAGE');
  const [incidentAt, setIncidentAt] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<ClaimItem[]>([{ ...EMPTY_ITEM }]);

  if (eligible.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Yêu cầu bồi thường" />
        <EmptyState
          icon="cube-outline"
          title="Chưa có hợp đồng đủ điều kiện"
          description={`Cần có hợp đồng đang hiệu lực, hoặc vừa kết thúc trong ${CLAIM_WINDOW_DAYS} ngày, để gửi yêu cầu bồi thường.`}
        />
      </Screen>
    );
  }

  const c = eligible.find((x) => x._id === contractId) ?? eligible[0];
  const total = claimTotal(items);
  const overCap = total > CLAIM_LIABILITY_CAP;
  const validItems = items.every((it) => it.name.trim().length > 0 && it.quantity > 0 && it.unitValue >= 0);
  const canSend = !!c && description.trim().length >= 10 && total > 0 && validItems;

  const setItem = (i: number, patch: Partial<ClaimItem>) => setItems((arr) => arr.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, k) => k !== i));

  return (
    <Screen>
      <ScreenHeader title="Yêu cầu bồi thường" subtitle={`Hạn gửi ${CLAIM_WINDOW_DAYS} ngày · mức tối đa ${vnd(CLAIM_LIABILITY_CAP)}/sự vụ`} />

      <Card>
        <Field label="Hợp đồng / kho">
          <Chips
            options={eligible.map((x) => ({ value: x._id, label: `${unitLabel(db, x.unitId)} · ${typeName(db, x.unitTypeId)} · ${facilityName(db, x.facilityId)}` }))}
            value={c._id}
            onChange={setContractId}
          />
        </Field>
        <Field label="Loại sự cố">
          <Chips options={TYPE_OPTIONS} value={type} onChange={setType} columns={2} />
        </Field>
        <View style={{ marginBottom: S.md }}>
          <DateStepper
            label="Thời điểm xảy ra / phát hiện" value={incidentAt} onChange={setIncidentAt}
            min={addDays(todayISO(), -CLAIM_WINDOW_DAYS)} max={todayISO()}
          />
          <Text style={st.hint}>Không nhận yêu cầu quá {CLAIM_WINDOW_DAYS} ngày kể từ ngày này</Text>
        </View>
        <Field label="Diễn biến sự việc" hint="Tối thiểu 10 ký tự. Mô tả càng rõ thì xác minh càng nhanh.">
          <Input
            value={description} onChangeText={setDescription} multiline numberOfLines={4} style={st.multiline}
            placeholder="VD: Ngày 12/9 tôi mở kho thì thấy trần thấm nước, hai thùng sách bị ướt và mốc."
          />
        </Field>

        <View style={st.rowBetween}>
          <Text style={st.label}>Hạng mục thiệt hại</Text>
          <Pressable onPress={addItem} style={st.addRow}>
            <Ionicons name="add-circle-outline" size={16} color={C.brand700} />
            <Text style={st.addRowText}>Thêm dòng</Text>
          </Pressable>
        </View>
        <View style={{ gap: S.sm }}>
          {items.map((it, i) => (
            <View key={i} style={st.itemRow}>
              <View style={st.itemHead}>
                <Input
                  value={it.name} onChangeText={(v) => setItem(i, { name: v })} placeholder="Tên tài sản" style={{ flex: 1 }}
                />
                <Pressable onPress={() => removeItem(i)} disabled={items.length === 1} hitSlop={8} style={items.length === 1 && { opacity: 0.3 }}>
                  <Ionicons name="trash-outline" size={20} color={C.red} />
                </Pressable>
              </View>
              <View style={st.itemBody}>
                <Input
                  value={String(it.quantity)} onChangeText={(v) => setItem(i, { quantity: Math.max(1, Number(v) || 1) })}
                  keyboardType="numeric" placeholder="SL" style={{ flex: 1 }}
                />
                <Input
                  value={String(it.unitValue)} onChangeText={(v) => setItem(i, { unitValue: Math.max(0, Number(v) || 0) })}
                  keyboardType="numeric" placeholder="Giá trị / cái" style={{ flex: 2 }}
                />
              </View>
              <Text style={st.itemTotal}>{vnd(it.quantity * it.unitValue)}</Text>
            </View>
          ))}
        </View>

        <Text style={st.totalLine}>Tổng khai báo: <Text style={overCap && { color: C.amber }}>{vnd(total)}</Text></Text>
        {overCap && (
          <Text style={st.warn}>
            Vượt mức trách nhiệm tối đa {vnd(CLAIM_LIABILITY_CAP)} — bạn vẫn gửi được, nhưng số tiền duyệt sẽ dừng ở mức này.
          </Text>
        )}

        <Button
          title="Gửi yêu cầu" disabled={!canSend} style={{ marginTop: S.md }}
          onPress={() => void run(
            'createClaim',
            { contractId: c._id, type, incidentAt, description: description.trim(), items },
            (claim) => `Đã gửi hồ sơ ${claim.claimNumber} — chi nhánh sẽ liên hệ xác minh`,
            () => router.back(),
          )}
        />
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: 12, color: C.muted, marginTop: 4 },
  multiline: { height: 90, paddingTop: S.sm, textAlignVertical: 'top' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.sm },
  label: { fontSize: 12, fontWeight: '600', color: C.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addRowText: { fontSize: 13, fontWeight: '600', color: C.brand700 },
  itemRow: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: S.sm, gap: S.sm },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  itemBody: { flexDirection: 'row', gap: S.sm },
  itemTotal: { fontSize: 12, color: C.muted, textAlign: 'right' },
  totalLine: { fontSize: 14, fontWeight: '600', color: C.ink, marginTop: S.md },
  warn: { fontSize: 12, color: C.amber, marginTop: 4 },
});
