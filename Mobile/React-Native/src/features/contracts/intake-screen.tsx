import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { IntakeItemCondition } from '@ssm/shared';
import {
  INTAKE_BATCH_STATUS, INTAKE_ITEM_CONDITION, INTAKE_ITEM_NAME_MAX, INTAKE_ITEM_NAME_MIN, INTAKE_MAX_ITEMS, INTAKE_NOTE_MAX, INTAKE_QTY_MAX, INTAKE_VALUE_MAX,
  addDays, canDeclareIntake, fmtDate, intakeItemsValue, inventoryOf, todayISO, vnd,
} from '@ssm/shared';
import { byId, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Card, Chips, DateStepper, EmptyState, Input, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, R, S } from '../../shared/ui/theme';

const CONDITIONS = (Object.keys(INTAKE_ITEM_CONDITION) as IntakeItemCondition[]).map((v) => ({ value: v, label: INTAKE_ITEM_CONDITION[v].label }));
/** Một dòng đang khai — số lượng / giá trị giữ dạng chữ để khách xoá và gõ lại thoải mái, chỉ đổi sang số lúc kiểm và gửi. */
interface Row { name: string; qty: string; value: string; condition: IntakeItemCondition; note: string }
const EMPTY_ROW: Row = { name: '', qty: '1', value: '', condition: 'GOOD', note: '' };
const digits = (v: string) => v.replace(/\D/g, '');
const parseRow = (r: Row) => ({ name: r.name.trim(), quantity: Number(r.qty), estValue: Number(r.value || 0), condition: r.condition, note: r.note.trim() || undefined });
const rowOk = (r: Row) => {
  const p = parseRow(r);
  return p.name.length >= INTAKE_ITEM_NAME_MIN && p.name.length <= INTAKE_ITEM_NAME_MAX && Number.isInteger(p.quantity) && p.quantity >= 1 && p.quantity <= INTAKE_QTY_MAX
    && p.estValue >= 0 && p.estValue <= INTAKE_VALUE_MAX;
};

/**
 * Đồ đang gửi / Nhập hàng của một hợp đồng: danh sách đồ đã được chi nhánh xác nhận (căn cứ khi xét bồi thường), lịch sử các đợt nhập, và
 * form khai đợt nhập mới — mỗi lần mang đồ vào kho khai một đợt, nhân viên kiểm hàng cấm rồi xác nhận tại quầy.
 */
export default function IntakeScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null); // null = form đang đóng
  const [expected, setExpected] = useState(todayISO());

  const c = byId(db.contracts, contract);
  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const batches = db.intakeBatches.filter((b) => b.contractId === c._id).sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));
  const inv = inventoryOf(batches);
  const canDeclare = canDeclareIntake(c);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const formOk = !!rows && rows.length > 0 && rows.every(rowOk);
  const formTotal = rows ? intakeItemsValue(rows.map(parseRow).map((p) => ({ quantity: p.quantity || 0, estValue: p.estValue || 0 }))) : 0;
  const askCancel = (id: string, code: string) => confirmAction('Huỷ đợt nhập?', `Đợt ${code} chưa được xác nhận — huỷ thì nhân viên không kiểm đợt này nữa.`, 'Huỷ đợt',
    () => void run('cancelIntake', { batchId: id }, `Đã huỷ đợt nhập ${code}`));

  return (
    <Screen>
      <ScreenHeader title="Đồ đang gửi" subtitle={`Hợp đồng ${c.contractNumber} · Kho ${unitLabel(db, c.unitId)}`} />

      <Card>
        <View style={st.rowBetween}>
          <Text style={st.title}>Đã nhập kho</Text>
          <Text style={st.total}>{vnd(inv.totalValue)}</Text>
        </View>
        {inv.items.length === 0 ? <Muted style={{ marginTop: S.sm } as never}>Chưa có đồ nào được xác nhận nhập kho.</Muted> : inv.items.map((it) => (
          <View key={it.itemId} style={st.line}>
            <View style={st.rowBetween}>
              <Text style={st.name}>{it.name} × {it.quantity}</Text>
              <Text style={st.value}>{vnd(it.quantity * it.estValue)}</Text>
            </View>
            <View style={st.meta}>
              <Badge tone={INTAKE_ITEM_CONDITION[it.condition].tone}>{INTAKE_ITEM_CONDITION[it.condition].label}</Badge>
              <Muted>{vnd(it.estValue)}/cái · {it.batchCode}</Muted>
            </View>
            {it.note ? <Muted>{it.note}</Muted> : null}
          </View>
        ))}
      </Card>

      {canDeclare && !rows && (
        <Button title="Khai đợt nhập hàng" icon="add-circle-outline" style={{ marginTop: S.md }} onPress={() => { setRows([{ ...EMPTY_ROW }]); setExpected(todayISO()); }} />
      )}

      {canDeclare && rows && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.title}>Khai đợt nhập hàng</Text>
          <Muted style={{ marginTop: 2 } as never}>Nhân viên kiểm hàng cấm và xác nhận khi bạn mang đồ đến.</Muted>
          <View style={{ gap: S.sm, marginTop: S.md }}>
            {rows.map((r, i) => (
              <View key={i} style={st.itemRow}>
                <View style={st.itemHead}>
                  <Input value={r.name} onChangeText={(v) => setRow(i, { name: v })} placeholder="Tên món đồ" maxLength={INTAKE_ITEM_NAME_MAX} style={{ flex: 1 }} />
                  <Pressable onPress={() => setRows((rs) => rs && rs.filter((_, k) => k !== i))} disabled={rows.length === 1} hitSlop={8} style={rows.length === 1 && { opacity: 0.3 }} accessibilityLabel="Xoá dòng">
                    <Ionicons name="trash-outline" size={20} color={C.red} />
                  </Pressable>
                </View>
                <View style={st.itemBody}>
                  <Input value={r.qty} onChangeText={(v) => setRow(i, { qty: digits(v).slice(0, 3) })} keyboardType="number-pad" placeholder="SL" style={{ flex: 1 }} />
                  <Input value={r.value} onChangeText={(v) => setRow(i, { value: digits(v).slice(0, 10) })} keyboardType="number-pad" placeholder="Giá trị ước tính / cái (₫)" style={{ flex: 3 }} />
                </View>
                <Chips options={CONDITIONS} value={r.condition} onChange={(v) => setRow(i, { condition: v })} columns={2} />
                <Input value={r.note} onChangeText={(v) => setRow(i, { note: v })} placeholder="Ghi chú (không bắt buộc)" maxLength={INTAKE_NOTE_MAX} />
                {r.name.trim().length > 0 && !rowOk(r) && <Text style={st.warn}>Tên {INTAKE_ITEM_NAME_MIN}–{INTAKE_ITEM_NAME_MAX} ký tự, số lượng 1–{INTAKE_QTY_MAX}.</Text>}
              </View>
            ))}
          </View>
          {rows.length < INTAKE_MAX_ITEMS && (
            <Pressable onPress={() => setRows((rs) => rs && [...rs, { ...EMPTY_ROW }])} style={st.addRow}>
              <Ionicons name="add-circle-outline" size={16} color={C.brand700} />
              <Text style={st.addRowText}>Thêm món</Text>
            </Pressable>
          )}
          <View style={{ marginTop: S.md }}>
            <DateStepper label="Ngày mang đồ đến" value={expected} onChange={setExpected} min={todayISO()} max={addDays(todayISO(), 30)} />
          </View>
          <Text style={st.sum}>Tổng giá trị khai: {vnd(formTotal)}</Text>
          <Button
            title="Gửi khai báo" disabled={!formOk} style={{ marginTop: S.md }}
            onPress={() => rows && void run('declareIntake', { contractId: c._id, items: rows.map(parseRow), expectedDate: expected },
              (b) => `Đã khai đợt ${b.code} — mang đồ đến quầy để nhân viên kiểm và xác nhận`, () => setRows(null))}
          />
          <Button title="Đóng" variant="ghost" style={{ marginTop: S.xs }} onPress={() => setRows(null)} />
        </Card>
      )}

      <Text style={st.section}>Các đợt nhập</Text>
      {batches.length === 0 ? <Card><Muted>Chưa có đợt nhập nào.</Muted></Card> : batches.map((b) => (
        <Card key={b._id} style={{ marginTop: S.sm }}>
          <View style={st.rowBetween}>
            <Text style={st.code}>{b.code}</Text>
            <StatusBadge map={INTAKE_BATCH_STATUS} value={b.status} />
          </View>
          <Muted style={{ marginTop: 2 } as never}>
            Khai {fmtDate(b.declaredAt)}{b.onBehalf ? ' tại quầy' : ''} · {b.items.length} dòng · {vnd(intakeItemsValue(b.items))}
            {b.status === 'DECLARED' && b.expectedDate ? ` · dự kiến mang đến ${fmtDate(b.expectedDate)}` : ''}
            {b.status === 'CONFIRMED' && b.confirmedAt ? ` · xác nhận ${fmtDate(b.confirmedAt)}` : ''}
          </Muted>
          <Text style={st.items} numberOfLines={3}>{b.items.map((it) => `${it.name} × ${it.quantity}`).join(', ')}</Text>
          {b.status === 'REJECTED' && b.rejectReason ? <Text style={st.reject}>Lý do từ chối: {b.rejectReason}</Text> : null}
          {b.staffNote ? <Muted>Ghi chú của chi nhánh: {b.staffNote}</Muted> : null}
          {b.status === 'DECLARED' && (
            <Button title="Huỷ đợt nhập" variant="ghost" style={{ marginTop: S.xs }} onPress={() => askCancel(b._id, b.code)} />
          )}
        </Card>
      ))}
    </Screen>
  );
}

const st = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  title: { fontSize: 15, fontWeight: '700', color: C.ink },
  total: { fontSize: 16, fontWeight: '800', color: C.brand700 },
  line: { marginTop: S.sm, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, gap: 4 },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: C.ink },
  value: { fontSize: 14, fontWeight: '700', color: C.ink },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm },
  itemRow: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.sm, gap: S.sm },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  itemBody: { flexDirection: 'row', gap: S.sm },
  warn: { fontSize: 12, color: C.amber },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: S.sm, paddingVertical: 2 },
  addRowText: { fontSize: 13, fontWeight: '600', color: C.brand700 },
  sum: { fontSize: 14, fontWeight: '600', color: C.ink, marginTop: S.md },
  section: { fontSize: 16, fontWeight: '700', color: C.ink, marginTop: S.xl },
  code: { fontSize: 14, fontWeight: '700', color: C.ink, letterSpacing: 0.4 },
  items: { fontSize: 13, color: C.text, marginTop: 4, lineHeight: 18 },
  reject: { marginTop: 4, fontSize: 13, color: C.red },
});
