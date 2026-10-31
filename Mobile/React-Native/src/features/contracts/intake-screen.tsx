import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { IntakeItemCondition, InventoryItem, SealedPackageKind } from '@ssm/shared';
import {
  INTAKE_BATCH_STATUS, INTAKE_ITEM_CONDITION, INTAKE_ITEM_NAME_MAX, INTAKE_ITEM_NAME_MIN, INTAKE_ITEM_STATE, INTAKE_ITEM_SUGGESTIONS, INTAKE_MAX_ITEMS, INTAKE_NOTE_MAX, INTAKE_QTY_MAX,
  INTAKE_REMOVAL_KIND, INTAKE_VALUE_MAX, SEALED_CLAIM_RULE, SEALED_DESC_MAX, SEALED_MAX_PACKAGES, SEALED_PACKAGE_KIND, SEALED_PACKAGE_KINDS, addDays, canDeclareIntake,
  contractHoldsGoods, fmtDate, intakeCategoriesFor, intakeItemsValue, intakeVolumeWarnings, inventoryOf, sealedPackageValues, todayISO, vnd,
} from '@ssm/shared';
import { byId, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Callout, Card, Chips, DateStepper, EmptyState, Field, IconTile, Input, Muted, Screen, ScreenHeader, SectionHeader, Sheet, StatusBadge } from '../../shared/ui';
import { confirmAction } from '../../shared/ui/confirm';
import { C, R, S, T, TOUCH } from '../../shared/ui/theme';

const CONDITIONS = (Object.keys(INTAKE_ITEM_CONDITION) as IntakeItemCondition[]).map((v) => ({ value: v, label: INTAKE_ITEM_CONDITION[v].label }));
/** Một dòng đang khai — số lượng / giá trị giữ dạng chữ để khách xoá và gõ lại thoải mái, chỉ đổi sang số lúc kiểm và gửi. */
interface Row { name: string; category: string; qty: string; value: string; condition: IntakeItemCondition; note: string }
const EMPTY_ROW: Row = { name: '', category: '', qty: '1', value: '', condition: 'GOOD', note: '' };
const digits = (v: string) => v.replace(/\D/g, '');
const parseRow = (r: Row) => ({ name: r.name.trim(), category: r.category || null, quantity: Number(r.qty), estValue: Number(r.value || 0), condition: r.condition, note: r.note.trim() || undefined });
/** Đợt 16 (D2): khai GỬI KÍN — số kiện, loại kiện, niêm phong, mô tả chung, tổng giá trị (tuỳ chọn); dạng chữ như Row. */
interface Sealed { count: string; kind: SealedPackageKind; hasSeal: 'YES' | 'NO'; description: string; value: string }
const EMPTY_SEALED: Sealed = { count: '1', kind: 'BOX', hasSeal: 'YES', description: '', value: '' };
const KINDS = SEALED_PACKAGE_KINDS.map((k) => ({ value: k, label: SEALED_PACKAGE_KIND[k] }));
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
  // Đợt 16 (D2): 'ITEMS' = khai từng món; 'SEALED' = gửi kín theo kiện (không kê khai chi tiết).
  const [mode, setMode] = useState<'ITEMS' | 'SEALED'>('ITEMS');
  const [sealed, setSealed] = useState<Sealed>(EMPTY_SEALED);
  const [expected, setExpected] = useState(todayISO());
  // Ghi "đã lấy ra" một món đang gửi (A7): số lượng giữ dạng chữ để gõ lại thoải mái.
  const [out, setOut] = useState<{ item: InventoryItem; qty: string; note: string } | null>(null);

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
  const holds = contractHoldsGoods(c);
  const outQty = out ? Number(out.qty) : 0;
  const outOk = !!out && Number.isInteger(outQty) && outQty >= 1 && outQty <= out.item.inStorage;
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  // D1: nhóm đồ theo cỡ kho đang thuê (sau đổi cỡ là loại mới); cảnh báo mềm khi đồ ước tính vượt sức chứa / món quá to so với cỡ.
  const unitType = byId(db.unitTypes, c.unitTypeId);
  const cats = intakeCategoriesFor(unitType?.category ?? null).map((v) => ({ value: v, label: v }));
  const warnings = rows ? intakeVolumeWarnings(rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, quantity: Number(r.qty) || 0 })), unitType) : [];
  const sCount = Number(sealed.count);
  const sealedOk = Number.isInteger(sCount) && sCount >= 1 && sCount <= SEALED_MAX_PACKAGES && Number(sealed.value || 0) <= INTAKE_VALUE_MAX * SEALED_MAX_PACKAGES;
  const formOk = mode === 'SEALED' ? sealedOk : !!rows && rows.length > 0 && rows.every(rowOk);
  const formTotal = mode === 'SEALED' ? Number(sealed.value || 0) : rows ? intakeItemsValue(rows.map(parseRow).map((p) => ({ quantity: p.quantity || 0, estValue: p.estValue || 0 }))) : 0;
  const perPackage = sealedOk && Number(sealed.value || 0) > 0 ? sealedPackageValues(Number(sealed.value), sCount)[sCount > 1 ? 1 : 0] : null;
  const submit = () => {
    if (!rows) return;
    const body = mode === 'SEALED'
      ? { sealed: { packageCount: sCount, packageKind: sealed.kind, hasSeal: sealed.hasSeal === 'YES', description: sealed.description, declaredValue: Number(sealed.value || 0) || null } }
      : { items: rows.map(parseRow) };
    void run('declareIntake', { contractId: c._id, ...body, expectedDate: expected },
      (b) => b.sealed ? `Đã đăng ký gửi kín ${b.code} — mang các kiện đến quầy, ký bản cam kết giấy` : `Đã khai đợt ${b.code} — mang đồ đến quầy để nhân viên kiểm và xác nhận`, () => setRows(null));
  };
  const askCancel = (id: string, code: string) => confirmAction('Huỷ đợt nhập?', `Đợt ${code} chưa được xác nhận — huỷ thì nhân viên không kiểm đợt này nữa.`, 'Huỷ đợt',
    () => void run('cancelIntake', { batchId: id }, `Đã huỷ đợt nhập ${code}`));

  const footer = !canDeclare ? undefined : rows ? (
    <View style={st.footRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.caption}>Tổng giá trị khai</Text>
        <Text style={st.footAmount} numberOfLines={1} adjustsFontSizeToFit>{vnd(formTotal)}</Text>
      </View>
      <Button title={mode === 'SEALED' ? 'Đăng ký gửi kín' : 'Gửi khai báo'} icon="send" disabled={!formOk} style={{ flex: 1.3 }} onPress={submit} />
    </View>
  ) : (
    <Button title="Khai đợt nhập hàng" icon="add-circle-outline" size="lg" onPress={() => { setRows([{ ...EMPTY_ROW }]); setMode('ITEMS'); setSealed(EMPTY_SEALED); setExpected(todayISO()); }} />
  );

  return (
    <Screen footer={footer}>
      <ScreenHeader icon="archive-outline" title="Đồ đang gửi" subtitle={`Hợp đồng ${c.contractNumber} · Kho ${unitLabel(db, c.unitId)}`} />

      <Card>
        <View style={st.summary}>
          <IconTile icon="cube-outline" size="lg" />
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Hợp đồng đã trả kho / đã đóng: ghi "Đã trả kho" thay cho số món đang gửi. */}
            <Text style={T.caption}>{holds ? `Đồ đang gửi · ${inv.inStorageCount} món` : 'Đồ đã gửi'}</Text>
            <Text style={st.total}>{holds ? vnd(inv.totalValue) : 'Đã trả kho'}</Text>
          </View>
        </View>
        {inv.items.length === 0 ? <EmptyState icon="file-tray-outline" title="Chưa có đồ nào được xác nhận nhập kho." /> : inv.items.map((it) => (
          <View key={it.itemId} style={st.line}>
            <View style={st.rowBetween}>
              <Text style={st.name}>{it.name} × {it.inStorage !== it.quantity ? `${it.inStorage}/${it.quantity}` : it.quantity}</Text>
              <Text style={st.value}>{vnd(it.inStorage * it.estValue)}</Text>
            </View>
            <View style={st.meta}>
              <StatusBadge map={INTAKE_ITEM_STATE} value={it.state} />
              {it.sealed ? <Badge tone="violet">Gửi kín</Badge> : null}
              <Badge tone={INTAKE_ITEM_CONDITION[it.condition].tone}>{INTAKE_ITEM_CONDITION[it.condition].label}</Badge>
              <Muted>{vnd(it.estValue)}/cái · {it.batchCode}</Muted>
            </View>
            {it.removals.length > 0 ? <Muted>{it.removals.map((r) => `${INTAKE_REMOVAL_KIND[r.kind].label} ${r.quantity} · ${fmtDate(r.at)}`).join('; ')}</Muted> : null}
            {it.compensated > 0 && it.state !== 'COMPENSATED' ? <Muted>Đã bồi thường {it.compensated}</Muted> : null}
            {it.note ? <Muted>{it.note}</Muted> : null}
            {holds && it.inStorage > 0 && (
              <Button title="Đã lấy ra" variant="ghost" size="sm" icon="exit-outline" style={{ alignSelf: 'flex-start' }} onPress={() => setOut({ item: it, qty: String(it.inStorage), note: '' })} />
            )}
          </View>
        ))}
      </Card>

      {canDeclare && rows && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.formHead}>
            <IconTile icon="create-outline" tone="blue" size="sm" />
            <View style={{ flex: 1 }}>
              <Text style={st.title}>Khai đợt nhập hàng</Text>
              <Text style={T.caption}>Nhân viên kiểm hàng cấm và xác nhận khi bạn mang đồ đến.</Text>
            </View>
            <Pressable onPress={() => setRows(null)} accessibilityRole="button" accessibilityLabel="Đóng" style={({ pressed }) => [st.iconBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="close" size={20} color={C.sub} />
            </Pressable>
          </View>
          <View style={{ marginTop: S.md }}>
            <Chips options={[{ value: 'ITEMS' as const, label: 'Khai từng món' }, { value: 'SEALED' as const, label: 'Gửi kín (không kê khai)' }]} value={mode} onChange={setMode} columns={2} />
          </View>
          {mode === 'SEALED' ? (
            <View style={{ gap: S.sm, marginTop: S.md }}>
              <Muted>Chỉ ghi số kiện, loại kiện, niêm phong và tổng giá trị (nếu muốn). Nhân viên không mở kiện; bạn ký bản cam kết không gửi hàng cấm BẰNG GIẤY khi mang đồ đến quầy.</Muted>
              <View style={st.itemBody}>
                <Input value={sealed.count} onChangeText={(v) => setSealed({ ...sealed, count: digits(v).slice(0, 2) })} keyboardType="number-pad" placeholder="Số kiện" style={{ flex: 1 }} />
                <Input value={sealed.value} onChangeText={(v) => setSealed({ ...sealed, value: digits(v).slice(0, 11) })} keyboardType="number-pad" placeholder="Tổng giá trị khai (₫, không bắt buộc)" style={{ flex: 3 }} />
              </View>
              <Chips options={KINDS} value={sealed.kind} onChange={(kind) => setSealed({ ...sealed, kind })} columns={4} />
              <Chips options={[{ value: 'YES' as const, label: 'Có niêm phong' }, { value: 'NO' as const, label: 'Không niêm phong' }]} value={sealed.hasSeal} onChange={(hasSeal) => setSealed({ ...sealed, hasSeal })} columns={2} />
              <Input value={sealed.description} onChangeText={(v) => setSealed({ ...sealed, description: v })} placeholder="Mô tả chung (không bắt buộc)" maxLength={SEALED_DESC_MAX} />
              {!sealedOk && sealed.count !== '' ? <Text style={st.warn}>Số kiện 1–{SEALED_MAX_PACKAGES}.</Text> : null}
              <Callout tone="blue" icon="cube-outline">
                {sealedOk ? `${sCount} dòng "Kiện 1…${sCount}" · ${perPackage !== null ? `mỗi kiện ${vnd(perPackage)}` : 'không khai giá trị — bồi thường cần chứng cứ'}. ` : ''}{SEALED_CLAIM_RULE}
              </Callout>
            </View>
          ) : (
          <View style={{ gap: S.md, marginTop: S.md }}>
            {rows.map((r, i) => (
              <View key={i} style={st.itemRow}>
                <View style={st.itemTop}>
                  <View style={st.itemNum}><Text style={st.itemNumText}>{i + 1}</Text></View>
                  <Text style={[st.title, { flex: 1, fontSize: 14 }]}>Món {i + 1}</Text>
                  <Pressable onPress={() => setRows((rs) => rs && rs.filter((_, k) => k !== i))} disabled={rows.length === 1} style={[st.iconBtn, rows.length === 1 && { opacity: 0.3 }]} accessibilityLabel="Xoá dòng">
                    <Ionicons name="trash-outline" size={18} color={C.red} />
                  </Pressable>
                </View>
                <Text style={T.caption}>Nhóm đồ (theo cỡ kho đang thuê)</Text>
                <Chips options={cats} value={r.category} onChange={(category) => setRow(i, { category })} columns={2} />
                <Input value={r.name} onChangeText={(v) => setRow(i, { name: v })} placeholder="Tên món đồ" maxLength={INTAKE_ITEM_NAME_MAX} />
                {!r.name.trim() && (INTAKE_ITEM_SUGGESTIONS[r.category] ?? []).length > 0 && (
                  <Chips options={(INTAKE_ITEM_SUGGESTIONS[r.category] ?? []).slice(0, 4).map((v) => ({ value: v, label: v }))} value="" onChange={(name) => setRow(i, { name })} columns={2} />
                )}
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
          )}
          {mode === 'ITEMS' && warnings.length > 0 && (
            <Callout tone="amber" icon="warning-outline" style={{ marginTop: S.md }}>{warnings.join(' ')} Chỉ là ước tính để bạn lưu ý — vẫn khai được.</Callout>
          )}
          {mode === 'ITEMS' && rows.length < INTAKE_MAX_ITEMS && (
            <Button title="Thêm món" variant="subtle" size="sm" icon="add" style={{ marginTop: S.md, alignSelf: 'flex-start' }} onPress={() => setRows((rs) => rs && [...rs, { ...EMPTY_ROW }])} />
          )}
          <View style={{ marginTop: S.lg }}>
            <DateStepper label="Ngày mang đồ đến" value={expected} onChange={setExpected} min={todayISO()} max={addDays(todayISO(), 30)} />
          </View>
        </Card>
      )}

      <SectionHeader title="Các đợt nhập" icon="layers-outline" count={batches.length || undefined} />
      {batches.length === 0 ? <Card><EmptyState icon="layers-outline" title="Chưa có đợt nhập nào." /></Card> : (
        <View style={{ gap: S.sm }}>
          {batches.map((b) => (
            <Card key={b._id}>
              <View style={st.rowBetween}>
                <View style={st.codeRow}>
                  <Ionicons name="pricetag-outline" size={14} color={C.muted} />
                  <Text style={st.code}>{b.code}</Text>
                </View>
                <StatusBadge map={INTAKE_BATCH_STATUS} value={b.status} />
              </View>
              <Muted style={{ marginTop: 4 } as never}>
                Khai {fmtDate(b.declaredAt)}{b.onBehalf ? ' tại quầy' : ''} · {b.sealed ? `gửi kín ${b.sealed.packageCount} kiện` : `${b.items.length} dòng`} · {vnd(intakeItemsValue(b.items))}
                {b.status === 'DECLARED' && b.expectedDate ? ` · dự kiến mang đến ${fmtDate(b.expectedDate)}` : ''}
                {b.status === 'CONFIRMED' && b.confirmedAt ? ` · xác nhận ${fmtDate(b.confirmedAt)}` : ''}
              </Muted>
              <Text style={st.items} numberOfLines={3}>{b.sealed ? `${b.items.map((it) => it.name).join(', ')} · ${SEALED_PACKAGE_KIND[b.sealed.packageKind].toLowerCase()}, ${b.sealed.hasSeal ? 'có niêm phong' : 'không niêm phong'}` : b.items.map((it) => `${it.name} × ${it.quantity}`).join(', ')}</Text>
              {b.sealed && b.status === 'DECLARED' ? <Muted style={{ marginTop: 4 } as never}>Mang các kiện đến quầy — ký bản cam kết giấy để nhân viên xác nhận.</Muted> : null}
              {b.sealed?.pledge ? <Muted style={{ marginTop: 4 } as never}>Đã ký bản cam kết giấy ngày {fmtDate(b.sealed.pledge.confirmedAt)}.</Muted> : null}
              {b.status === 'REJECTED' && b.rejectReason ? <Callout tone="red" style={{ marginTop: S.sm }}>Lý do từ chối: {b.rejectReason}</Callout> : null}
              {b.status === 'CANCELLED' && b.cancelReason ? <Muted style={{ marginTop: 4 } as never}>Đã huỷ: {b.cancelReason}</Muted> : null}
              {b.staffNote ? <Muted style={{ marginTop: 4 } as never}>Ghi chú của chi nhánh: {b.staffNote}</Muted> : null}
              {b.status === 'DECLARED' && (
                <Button title="Huỷ đợt nhập" variant="ghost" size="sm" icon="close-circle-outline" style={{ marginTop: S.xs }} onPress={() => askCancel(b._id, b.code)} />
              )}
            </Card>
          ))}
        </View>
      )}

      <Sheet visible={!!out} onClose={() => setOut(null)} title="Đã lấy đồ ra" icon="exit-outline"
        subtitle={out ? `${out.item.name} · đang gửi ${out.item.inStorage}/${out.item.quantity}` : undefined}
        footer={<Button title="Ghi đã lấy ra" icon="checkmark" disabled={!outOk} onPress={() => out && void run('withdrawIntakeItem', { batchId: out.item.batchId, itemId: out.item.itemId, quantity: outQty, note: out.note },
          `Đã ghi lấy ra ${outQty} × ${out.item.name}`, () => setOut(null))} />}>
        {out && (
          <>
            <Field label="Số lượng lấy ra" hint={`Tối đa ${out.item.inStorage} (số đang gửi).`}>
              <Input value={out.qty} onChangeText={(v) => setOut((o) => o && { ...o, qty: digits(v).slice(0, 3) })} keyboardType="number-pad" />
            </Field>
            <Field label="Ghi chú (không bắt buộc)">
              <Input value={out.note} onChangeText={(v) => setOut((o) => o && { ...o, note: v })} maxLength={INTAKE_NOTE_MAX} placeholder="VD: Mang về dùng" />
            </Field>
            <Muted>Món đã lấy ra không còn tính vào đồ đang gửi (căn cứ khi xét bồi thường).</Muted>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  summary: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingBottom: S.sm },
  title: { fontSize: 15, fontWeight: '700', color: C.ink },
  total: { fontSize: 22, fontWeight: '800', color: C.brand700, ...T.tabular },
  line: { marginTop: S.sm, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft, gap: 4 },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: C.ink },
  value: { fontSize: 14, fontWeight: '700', color: C.ink, ...T.tabular },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
  itemRow: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, gap: S.sm, backgroundColor: C.bg },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  itemNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' },
  itemNumText: { color: C.white, fontSize: 12, fontWeight: '800' },
  itemBody: { flexDirection: 'row', gap: S.sm },
  warn: { fontSize: 12, color: C.amber },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  code: { fontSize: 14, fontWeight: '700', color: C.ink, letterSpacing: 0.4 },
  items: { fontSize: 13, color: C.text, marginTop: 6, lineHeight: 18 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  footAmount: { fontSize: 18, fontWeight: '800', color: C.ink, ...T.tabular },
});
