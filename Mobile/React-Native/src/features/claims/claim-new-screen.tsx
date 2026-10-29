import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ClaimItem, ClaimType, InventoryItem } from '@ssm/shared';
import { CLAIM_COUNTED_STATUSES, CLAIM_TYPE, UNDECLARED_ITEM_NOTE, addDays, claimCapOf, claimHoldEnd, claimableQty, confirmedAfterIncident, fmtDate, inventoryOf, todayISO, vnd } from '@ssm/shared';
import { CLAIM_WINDOW_DAYS, claimTotal, facilityName, typeName, unitLabel, useStore, type DB } from '../../shared/store/store';
import { Badge, Button, Callout, Card, Chips, DateStepper, EmptyState, Field, IconTile, Input, Muted, Screen, ScreenHeader } from '../../shared/ui';
import { C, R, S, T, TOUCH } from '../../shared/ui/theme';

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
const overDeclared = (it: Row, maxQty?: number) => (maxQty !== undefined && it.quantity > maxQty) || (it.declaredValue !== undefined && it.unitValue > it.declaredValue);
/** Số lượng mỗi món đã được yêu cầu ở các hồ sơ còn được tính của hợp đồng (chưa bị từ chối / rút — kể cả đã chi), như server. */
const claimedElsewhere = (db: DB, contractId: string) => {
  const m = new Map<string, number>();
  for (const k of db.claims) {
    if (k.contractId !== contractId || !(CLAIM_COUNTED_STATUSES as readonly string[]).includes(k.status)) continue;
    for (const it of k.items) if (it.intakeItemId) m.set(it.intakeItemId, (m.get(it.intakeItemId) ?? 0) + it.quantity);
  }
  return m;
};
/** Ngày sự cố tối đa = min(hôm nay, ngày trả kho) — KhoAn chỉ chịu trách nhiệm trong thời gian thuê. */
const maxIncidentOf = (c: Parameters<typeof claimHoldEnd>[0] | undefined) => {
  const end = c ? claimHoldEnd(c) : null;
  const today = todayISO();
  return end && `${end}T00:00:00.000Z` < today ? `${end}T00:00:00.000Z` : today;
};

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
  const [incidentAt, setIncidentAt] = useState(() => maxIncidentOf(eligible.find((x) => x._id === contractId)));
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<Row[]>(() => startRows(db, contractId));
  const [photoText, setPhotoText] = useState('');

  if (eligible.length === 0) {
    return (
      <Screen>
        <ScreenHeader icon="shield-checkmark-outline" title="Yêu cầu bồi thường" />
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
  const holdEnd = claimHoldEnd(c);
  const maxIncident = maxIncidentOf(c);
  const incidentDay = incidentAt.slice(0, 10);
  const claimed = claimedElsewhere(db, c._id);
  // "Số còn đòi được" của món: số còn trong kho vào ngày sự cố − số đã yêu cầu ở hồ sơ khác (server cũng chặn CLAIM_OVER_DECLARED).
  const maxOf = (inv: InventoryItem) => claimableQty(inv, incidentDay, claimed.get(inv.itemId) ?? 0);
  const rowMax = (it: Row) => { const inv = it.intakeItemId ? inventory.items.find((x) => x.itemId === it.intakeItemId) : undefined; return inv ? maxOf(inv) : undefined; };
  const total = claimTotal(items);
  const cap = claimCapOf(c, db.unitTypes, incidentAt); // Điều 6: 10 × tiền thuê tháng theo hợp đồng
  const overCap = cap !== null && total > cap;
  const validItems = items.length > 0 && items.every((it) => it.name.trim().length > 0 && it.quantity > 0 && it.unitValue >= 0 && !overDeclared(it, rowMax(it)));
  const photos = parsePhotos(photoText);
  const canSend = !!c && description.trim().length >= 10 && total > 0 && validItems && photos.ok && incidentAt <= maxIncident;

  const setItem = (i: number, patch: Partial<Row>) => setItems((arr) => arr.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, k) => k !== i));
  // Chọn / bỏ một món trong danh sách đồ đang gửi: tự điền tên + giá trị đã khai, số lượng mặc định 1.
  const togglePick = (it: InventoryItem) => setItems((arr) => (arr.some((r) => r.intakeItemId === it.itemId)
    ? arr.filter((r) => r.intakeItemId !== it.itemId)
    : [...arr, { name: it.name, quantity: 1, unitValue: it.estValue, intakeItemId: it.itemId, maxQty: it.quantity, declaredValue: it.estValue }]));
  const pickContract = (id: string) => {
    setContractId(id); setItems(startRows(db, id));
    const max = maxIncidentOf(eligible.find((x) => x._id === id));
    if (incidentAt > max) setIncidentAt(max);
  };

  return (
    <Screen footer={(
      <View style={st.footRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={T.caption}>Tổng khai báo</Text>
          <Text style={[st.footAmount, overCap && { color: C.amber }]} numberOfLines={1} adjustsFontSizeToFit>{vnd(total)}</Text>
        </View>
        <Button
          title="Gửi yêu cầu" icon="send" disabled={!canSend} style={{ flex: 1.3 }}
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
      </View>
    )}>
      <ScreenHeader icon="shield-checkmark-outline" title="Yêu cầu bồi thường" subtitle={`Hạn gửi ${CLAIM_WINDOW_DAYS} ngày${cap !== null ? ` · mức tối đa ${vnd(cap)}/sự vụ` : ''}`} />

      <Card>
        <CardTitle icon="document-text-outline" title="Sự cố" />
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
            min={addDays(todayISO(), -CLAIM_WINDOW_DAYS)} max={maxIncident}
          />
          <Text style={st.hint}>{holdEnd ? `Kho đã trả ngày ${fmtDate(holdEnd)} — chỉ nhận sự cố đến ngày này, trong ${CLAIM_WINDOW_DAYS} ngày` : `Không nhận yêu cầu quá ${CLAIM_WINDOW_DAYS} ngày kể từ ngày này`}</Text>
        </View>
        <Field label="Diễn biến sự việc" hint="Tối thiểu 10 ký tự.">
          <Input
            value={description} onChangeText={setDescription} multiline numberOfLines={4}
            placeholder="VD: Ngày 12/9 tôi mở kho thì thấy trần thấm nước, hai thùng sách bị ướt và mốc."
          />
        </Field>
      </Card>

      <Card style={{ marginTop: S.md }}>
        <CardTitle icon="images-outline" title="Ảnh chứng cứ" tone="blue" />
        <Field label="Link ảnh chứng cứ (không bắt buộc)" hint={photos.ok ? `Mỗi link https một dòng, tối đa ${MAX_PHOTOS} ảnh (Google Drive, Google Photos…)` : 'Chỉ nhận link bắt đầu bằng https://'}>
          <Input
            value={photoText} onChangeText={setPhotoText} multiline numberOfLines={3} style={!photos.ok ? { borderColor: C.red } : undefined}
            placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url"
          />
        </Field>
      </Card>

      <Card style={{ marginTop: S.md }}>
        <CardTitle icon="pricetags-outline" title="Hạng mục thiệt hại" tone="amber" />
        {/* Đồ đã khai và được chi nhánh xác nhận khi nhập kho — căn cứ xét bồi thường. */}
        {inventory.items.length > 0 && (
          <View style={st.pickBox}>
            <Text style={st.pickTitle}>Chọn từ đồ đang gửi</Text>
            {inventory.items.map((it, i) => {
              const on = items.some((r) => r.intakeItemId === it.itemId);
              const max = maxOf(it);
              const late = confirmedAfterIncident(it.confirmedAt, incidentDay);
              return (
                <Pressable key={it.itemId} onPress={() => togglePick(it)} disabled={!on && max <= 0} style={({ pressed }) => [st.pickRow, i > 0 && st.lineTop, !on && max <= 0 && { opacity: 0.45 }, pressed && { opacity: 0.7 }]} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !on && max <= 0 }}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? C.brand700 : C.faint} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.pickName}>{it.name} × {max}</Text>
                    {late ? <Text style={st.late}>Nhập sau ngày sự cố</Text> : null}
                  </View>
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
                <Pressable onPress={() => removeItem(i)} accessibilityLabel="Xoá dòng" style={({ pressed }) => [st.iconBtn, pressed && { opacity: 0.6 }]}>
                  <Ionicons name="trash-outline" size={18} color={C.red} />
                </Pressable>
              </View>
              <Badge tone={it.intakeItemId ? 'green' : 'amber'} icon={it.intakeItemId ? 'checkmark-circle-outline' : 'help-circle-outline'}>{it.intakeItemId ? 'Trong danh sách đồ đang gửi' : 'Ngoài danh sách'}</Badge>
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
              {overDeclared(it, rowMax(it))
                ? <Text style={st.warn}>Không vượt số còn đòi được ({rowMax(it)}) và giá trị đã khai ({vnd(it.declaredValue ?? 0)}/cái).</Text>
                : <Text style={st.itemTotal}>{vnd(it.quantity * it.unitValue)}</Text>}
              {it.intakeItemId && (() => { const inv = inventory.items.find((x) => x.itemId === it.intakeItemId); return inv && confirmedAfterIncident(inv.confirmedAt, incidentDay); })()
                ? <Text style={st.late}>Món nhập kho sau ngày sự cố — xét như đồ ngoài danh sách (cần chứng cứ).</Text> : null}
            </View>
          ))}
        </View>
        {items.length === 0 && <Muted>Chọn đồ ở trên hoặc thêm đồ ngoài danh sách.</Muted>}
        <Button title={inventory.items.length > 0 ? 'Thêm đồ ngoài danh sách' : 'Thêm dòng'} variant="subtle" size="sm" icon="add"
          style={{ marginTop: S.md, alignSelf: 'flex-start' }} onPress={addItem} />
        {items.some((it) => !it.intakeItemId) && <Text style={st.hint}>{UNDECLARED_ITEM_NOTE}.</Text>}

        <View style={st.totalBox}>
          <Text style={st.totalLabel}>Tổng khai báo</Text>
          <Text style={[st.totalValue, overCap && { color: C.amber }]}>{vnd(total)}</Text>
        </View>
        {overCap && (
          <Callout tone="amber" style={{ marginTop: S.sm }}>
            Vượt mức trách nhiệm tối đa {vnd(cap ?? 0)} (10 lần giá thuê tháng của ô kho) — bạn vẫn gửi được, nhưng số tiền duyệt sẽ dừng ở mức này.
          </Callout>
        )}
      </Card>
    </Screen>
  );
}

function CardTitle({ icon, title, tone = 'teal' }: { icon: keyof typeof Ionicons.glyphMap; title: string; tone?: 'teal' | 'blue' | 'amber' }) {
  return (
    <View style={st.cardTitle}>
      <IconTile icon={icon} tone={tone} size="sm" />
      <Text style={st.cardTitleText}>{title}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md },
  cardTitleText: { ...T.h3, flex: 1 },
  hint: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  pickBox: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: S.md, paddingTop: S.sm, marginBottom: S.md, backgroundColor: C.bg },
  pickTitle: { fontSize: 13, fontWeight: '700', color: C.ink, marginBottom: 2 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: TOUCH, paddingVertical: S.xs },
  lineTop: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  pickName: { flex: 1, fontSize: 14, color: C.ink },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.redBg, alignItems: 'center', justifyContent: 'center' },
  itemRow: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, gap: S.sm, backgroundColor: C.bg },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  listedName: { flex: 1, fontSize: 15, fontWeight: '600', color: C.ink },
  itemBody: { flexDirection: 'row', gap: S.sm },
  itemTotal: { fontSize: 13, fontWeight: '700', color: C.sub, textAlign: 'right' },
  totalBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.lg, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft },
  totalLabel: { fontSize: 14, fontWeight: '600', color: C.sub },
  totalValue: { fontSize: 18, fontWeight: '800', color: C.ink, ...T.tabular },
  warn: { fontSize: 12, color: C.amber, marginTop: 4 },
  late: { fontSize: 12, color: C.red, fontWeight: '600' },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  footAmount: { fontSize: 18, fontWeight: '800', color: C.ink, ...T.tabular },
});
