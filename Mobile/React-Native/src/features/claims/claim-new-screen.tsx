import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ClaimItem, ClaimType, InventoryItem } from '@ssm/shared';
import { CLAIM_TYPE, UNDECLARED_ITEM_NOTE, addDays, claimCapOf, inventoryOf, todayISO, vnd } from '@ssm/shared';
import { CLAIM_WINDOW_DAYS, claimTotal, facilityName, typeName, unitLabel, useStore, type DB } from '../../shared/store/store';
import { Badge, Button, Card, Chips, DateStepper, EmptyState, Field, Input, Muted, Screen, ScreenHeader } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

const TYPE_OPTIONS: { value: ClaimType; label: string }[] = [
  { value: 'DAMAGE', label: CLAIM_TYPE.DAMAGE }, { value: 'LOSS', label: CLAIM_TYPE.LOSS },
];
/**
 * Một dòng bồi thường. Chọn từ "đồ đang gửi" thì có `intakeItemId` (tên theo danh sách, giá trị mặc định = giá đã khai, không vượt số
 * lượng / giá trị đã khai — server cũng chặn CLAIM_OVER_DECLARED); không có = đồ ngoài danh sách (server gắn cờ để nhân viên xét kỹ).
 */
type Row = ClaimItem & { maxQty?: number; declaredValue?: number };
const EMPTY_ITEM: Row = { name: '', quantity: 1, unitValue: 0 };
/** Link ảnh chứng cứ (chưa có tải ảnh lên): mỗi link https một dòng hoặc cách nhau dấu phẩy, tối đa 20 — như web. */
const MAX_PHOTOS = 20;
const parsePhotos = (text: string) => {
  const urls = text.split(/[\s,]+/).filter(Boolean);
  return { urls, ok: urls.length <= MAX_PHOTOS && urls.every((u) => /^https:\/\/\S+$/.test(u) && u.length <= 500) };
};
const inventoryOfContract = (db: DB, contractId: string) => inventoryOf(db.intakeBatches.filter((b) => b.contractId === contractId));
/** Hợp đồng có danh sách đồ thì bắt đầu trống (khách chọn từ danh sách); chưa có thì mở sẵn một dòng tự khai. */
const startRows = (db: DB, contractId: string): Row[] => (inventoryOfContract(db, contractId).items.length > 0 ? [] : [{ ...EMPTY_ITEM }]);
const overDeclared = (it: Row) => (it.maxQty !== undefined && it.quantity > it.maxQty) || (it.declaredValue !== undefined && it.unitValue > it.declaredValue);

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
  const [items, setItems] = useState<Row[]>(() => startRows(db, contractId));
  const [photoText, setPhotoText] = useState('');

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
  const inventory = inventoryOfContract(db, c._id);
  const total = claimTotal(items);
  const cap = claimCapOf(c, db.unitTypes, incidentAt); // Điều 6: 10 × tiền thuê tháng theo hợp đồng
  const overCap = cap !== null && total > cap;
  const validItems = items.length > 0 && items.every((it) => it.name.trim().length > 0 && it.quantity > 0 && it.unitValue >= 0 && !overDeclared(it));
  const photos = parsePhotos(photoText);
  const canSend = !!c && description.trim().length >= 10 && total > 0 && validItems && photos.ok;

  const setItem = (i: number, patch: Partial<Row>) => setItems((arr) => arr.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, k) => k !== i));
  // Chọn / bỏ một món trong danh sách đồ đang gửi: tự điền tên + giá trị đã khai, số lượng mặc định 1.
  const togglePick = (it: InventoryItem) => setItems((arr) => (arr.some((r) => r.intakeItemId === it.itemId)
    ? arr.filter((r) => r.intakeItemId !== it.itemId)
    : [...arr, { name: it.name, quantity: 1, unitValue: it.estValue, intakeItemId: it.itemId, maxQty: it.quantity, declaredValue: it.estValue }]));
  const pickContract = (id: string) => { setContractId(id); setItems(startRows(db, id)); };

  return (
    <Screen>
      <ScreenHeader title="Yêu cầu bồi thường" subtitle={`Hạn gửi ${CLAIM_WINDOW_DAYS} ngày${cap !== null ? ` · mức tối đa ${vnd(cap)}/sự vụ` : ''}`} />

      <Card>
        <Field label="Hợp đồng / kho">
          <Chips
            options={eligible.map((x) => ({ value: x._id, label: `${unitLabel(db, x.unitId)} · ${typeName(db, x.unitTypeId)} · ${facilityName(db, x.facilityId)}` }))}
            value={c._id}
            onChange={pickContract}
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
        <Field label="Diễn biến sự việc" hint="Tối thiểu 10 ký tự.">
          <Input
            value={description} onChangeText={setDescription} multiline numberOfLines={4} style={st.multiline}
            placeholder="VD: Ngày 12/9 tôi mở kho thì thấy trần thấm nước, hai thùng sách bị ướt và mốc."
          />
        </Field>
        <Field label="Link ảnh chứng cứ (không bắt buộc)" hint={photos.ok ? `Mỗi link https một dòng, tối đa ${MAX_PHOTOS} ảnh (Google Drive, Google Photos…)` : 'Chỉ nhận link bắt đầu bằng https://'}>
          <Input
            value={photoText} onChangeText={setPhotoText} multiline numberOfLines={3} style={[st.multiline, !photos.ok && { borderColor: C.red }]}
            placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url"
          />
        </Field>

        <Text style={[st.label, { marginBottom: S.sm }]}>Hạng mục thiệt hại</Text>
        {/* Đồ đã khai và được chi nhánh xác nhận khi nhập kho — căn cứ xét bồi thường. */}
        {inventory.items.length > 0 && (
          <View style={st.pickBox}>
            <Text style={st.pickTitle}>Chọn từ đồ đang gửi</Text>
            {inventory.items.map((it) => {
              const on = items.some((r) => r.intakeItemId === it.itemId);
              return (
                <Pressable key={it.itemId} onPress={() => togglePick(it)} style={st.pickRow} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? C.brand700 : C.faint} />
                  <Text style={st.pickName}>{it.name} × {it.quantity}</Text>
                  <Muted>{vnd(it.estValue)}/cái</Muted>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ gap: S.sm }}>
          {items.map((it, i) => (
            <View key={it.intakeItemId ?? `free-${i}`} style={st.itemRow}>
              <View style={st.itemHead}>
                {it.intakeItemId
                  ? <Text style={st.listedName}>{it.name}</Text>
                  : <Input value={it.name} onChangeText={(v) => setItem(i, { name: v })} placeholder="Tên tài sản" style={{ flex: 1 }} />}
                <Pressable onPress={() => removeItem(i)} hitSlop={8} accessibilityLabel="Xoá dòng">
                  <Ionicons name="trash-outline" size={20} color={C.red} />
                </Pressable>
              </View>
              <Badge tone={it.intakeItemId ? 'green' : 'amber'}>{it.intakeItemId ? 'Trong danh sách đồ đang gửi' : 'Ngoài danh sách'}</Badge>
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
              {overDeclared(it)
                ? <Text style={st.warn}>Không vượt số đã nhập ({it.maxQty}) và giá trị đã khai ({vnd(it.declaredValue ?? 0)}/cái).</Text>
                : <Text style={st.itemTotal}>{vnd(it.quantity * it.unitValue)}</Text>}
            </View>
          ))}
        </View>
        {items.length === 0 && <Muted>Chọn đồ ở trên hoặc thêm đồ ngoài danh sách.</Muted>}
        <Pressable onPress={addItem} style={st.addRow}>
          <Ionicons name="add-circle-outline" size={16} color={C.brand700} />
          <Text style={st.addRowText}>{inventory.items.length > 0 ? 'Thêm đồ ngoài danh sách' : 'Thêm dòng'}</Text>
        </Pressable>
        {items.some((it) => !it.intakeItemId) && <Text style={st.hint}>{UNDECLARED_ITEM_NOTE}.</Text>}

        <Text style={st.totalLine}>Tổng khai báo: <Text style={overCap && { color: C.amber }}>{vnd(total)}</Text></Text>
        {overCap && (
          <Text style={st.warn}>
            Vượt mức trách nhiệm tối đa {vnd(cap ?? 0)} (10 lần giá thuê tháng của ô kho) — bạn vẫn gửi được, nhưng số tiền duyệt sẽ dừng ở mức này.
          </Text>
        )}

        <Button
          title="Gửi yêu cầu" disabled={!canSend} style={{ marginTop: S.md }}
          onPress={() => void run(
            'createClaim',
            {
              contractId: c._id, type, incidentAt, description: description.trim(), photoUrls: photos.urls,
              items: items.map((it) => ({ name: it.name.trim(), quantity: it.quantity, unitValue: it.unitValue, ...(it.intakeItemId ? { intakeItemId: it.intakeItemId } : {}) })),
            },
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
  label: { fontSize: 12, fontWeight: '600', color: C.text },
  pickBox: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: S.sm, marginBottom: S.sm, backgroundColor: C.bg },
  pickTitle: { fontSize: 13, fontWeight: '700', color: C.ink, marginBottom: 4 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 6 },
  pickName: { flex: 1, fontSize: 14, color: C.ink },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: S.sm, paddingVertical: 2 },
  addRowText: { fontSize: 13, fontWeight: '600', color: C.brand700 },
  itemRow: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: S.sm, gap: S.sm },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  listedName: { flex: 1, fontSize: 15, fontWeight: '600', color: C.ink },
  itemBody: { flexDirection: 'row', gap: S.sm },
  itemTotal: { fontSize: 12, color: C.muted, textAlign: 'right' },
  totalLine: { fontSize: 14, fontWeight: '600', color: C.ink, marginTop: S.md },
  warn: { fontSize: 12, color: C.amber, marginTop: 4 },
});
