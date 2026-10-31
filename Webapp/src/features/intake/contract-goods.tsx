'use client';

import { useState } from 'react';
import { LogOut, PackagePlus, Pencil } from 'lucide-react';
import type { IntakeBatch, InventoryItem, RentalContract } from '@ssm/shared';
import { INTAKE_BATCH_STATUS, INTAKE_ITEM_CONDITION, INTAKE_ITEM_STATE, INTAKE_NOTE_MAX, INTAKE_REMOVAL_KIND, canDeclareIntake, contractHoldsGoods, intakeItemsValue, inventoryOf, itemStockLabel } from '@ssm/shared';
import type { IntakeItemInput, SealedIntakeInput } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { byId, contractIntakeBatches, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Button, EmptyState, Field, Modal, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { EMPTY_INTAKE_ITEM, EMPTY_SEALED, IntakeItemsEditor, SealedFields, intakeItemsError, sealedError } from '@/features/intake/intake-items-editor';

/**
 * Tóm tắt "đồ đang gửi" của một hợp đồng cho thẻ hợp đồng: số món ĐANG GỬI (đã trừ món lấy ra), tổng giá trị đang gửi, số đợt chờ nhân viên
 * xác nhận. `returned` = hợp đồng không còn giữ đồ (đã trả kho / đã đóng) — màn hình ghi "Đã trả kho" thay cho số món.
 */
export function goodsSummary(batches: IntakeBatch[], contract?: RentalContract | null) {
  const inv = inventoryOf(batches);
  return { count: inv.inStorageCount, total: inv.totalValue, pending: batches.filter((b) => b.status === 'DECLARED').length, returned: !!contract && !contractHoldsGoods(contract) };
}

/** Ghi "đã lấy ra" một món đang gửi: chọn số lượng (≤ số đang gửi), ghi chú tuỳ chọn. Khách tự ghi hoặc nhân viên ghi tại quầy. */
export function WithdrawDialog({ item, onClose, staff = false }: { item: InventoryItem | null; onClose: () => void; staff?: boolean }) {
  const { run, busy } = useStore();
  const [state, setState] = useState<{ id: string | null; qty: number; note: string }>({ id: null, qty: 1, note: '' });
  if ((item?.itemId ?? null) !== state.id) setState({ id: item?.itemId ?? null, qty: item?.inStorage ?? 1, note: '' });
  if (!item) return null;
  const ok = Number.isInteger(state.qty) && state.qty >= 1 && state.qty <= item.inStorage;
  return (
    <Modal open onClose={onClose} title={staff ? 'Ghi khách lấy đồ ra' : 'Đã lấy đồ ra'} description={`${item.name} · đang gửi ${item.inStorage}/${item.quantity} · đợt ${item.batchCode}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Huỷ</Button>
        <Button disabled={busy || !ok} onClick={() => void run('withdrawIntakeItem', { batchId: item.batchId, itemId: item.itemId, quantity: state.qty, note: state.note }, `Đã ghi lấy ra ${state.qty} × ${item.name}`, onClose)}>
          <LogOut className="size-4" />Ghi đã lấy ra
        </Button>
      </>}>
      <div className="space-y-4">
        <Field label="Số lượng lấy ra" hint={`Tối đa ${item.inStorage} (số đang gửi).`} className="max-w-[10rem]">
          <input type="number" min={1} max={item.inStorage} className={inputCls} value={state.qty} onChange={(e) => setState((s) => ({ ...s, qty: Math.min(item.inStorage, Math.max(1, Math.round(Number(e.target.value)) || 1)) }))} />
        </Field>
        <Field label="Ghi chú (không bắt buộc)">
          <input className={inputCls} maxLength={INTAKE_NOTE_MAX} value={state.note} onChange={(e) => setState((s) => ({ ...s, note: e.target.value }))} placeholder={staff ? 'VD: Khách lấy tại quầy' : 'VD: Mang về dùng'} />
        </Field>
        <p className="text-xs text-stone-500">Món đã lấy ra không còn tính vào đồ đang gửi (căn cứ khi xét bồi thường).</p>
      </div>
    </Modal>
  );
}

// Đợt 16 (D2): `sealedMode` = gửi kín theo kiện (không kê khai chi tiết) — chỉ đăng ký trước, khách ký bản cam kết giấy khi mang đồ đến quầy.
type FormState = { batchId: string | null; items: IntakeItemInput[]; expectedDate: string; tried: boolean; sealedMode: boolean; sealed: SealedIntakeInput };
const newForm = (): FormState => ({ batchId: null, items: [{ ...EMPTY_INTAKE_ITEM }], expectedDate: '', tried: false, sealedMode: false, sealed: { ...EMPTY_SEALED } });

/**
 * Khách xem "Đồ đang gửi" của hợp đồng (các đợt nhập đã được nhân viên xác nhận), khai đợt nhập hàng mới (nhiều dòng) và xem lịch sử
 * các đợt — đợt còn chờ xác nhận thì sửa / huỷ được. Danh sách đã xác nhận là căn cứ khi xét bồi thường.
 */
export function ContractGoodsDialog({ contract, declare = false, onClose }: { contract: RentalContract | null; declare?: boolean; onClose: () => void }) {
  const { db, run, busy } = useStore();
  const [form, setForm] = useState<FormState | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<InventoryItem | null>(null);
  // Mở cho hợp đồng khác → mở thẳng form khai nếu được yêu cầu.
  if ((contract?._id ?? null) !== openedFor) { setOpenedFor(contract?._id ?? null); setForm(contract && declare ? newForm() : null); }
  if (!contract) return null;

  const c = db.contracts.find((x) => x._id === contract._id) ?? contract;
  const batches = contractIntakeBatches(db, c._id);
  const inv = inventoryOf(batches);
  const canDeclare = canDeclareIntake(c);
  const holds = contractHoldsGoods(c);
  const err = form ? (form.sealedMode ? sealedError(form.sealed) : intakeItemsError(form.items)) : null;
  // D1: nhóm đồ theo cỡ kho đang thuê (sau đổi cỡ là loại mới) + kích thước ô cho cảnh báo thể tích.
  const unitType = byId(db.unitTypes, c.unitTypeId);

  const submit = () => {
    if (!form) return;
    if (err) { setForm({ ...form, tried: true }); return; }
    const done = () => setForm(null);
    const body = form.sealedMode ? { sealed: form.sealed } : { items: form.items };
    if (form.batchId) void run('updateIntake', { batchId: form.batchId, ...body, expectedDate: form.expectedDate || null }, 'Đã cập nhật đợt nhập', done);
    else void run('declareIntake', { contractId: c._id, ...body, expectedDate: form.expectedDate || undefined },
      (b) => b.sealed ? `Đã đăng ký gửi kín ${b.code} — mang các kiện đến quầy, ký bản cam kết giấy để nhân viên xác nhận` : `Đã khai đợt ${b.code} — mang đồ đến quầy để nhân viên kiểm và xác nhận`, done);
  };
  const edit = (b: IntakeBatch) => setForm({
    batchId: b._id, items: b.items.map((it) => ({ ...it, category: it.category ?? '', note: it.note ?? '' })), expectedDate: b.expectedDate?.slice(0, 10) ?? '', tried: false,
    sealedMode: !!b.sealed, sealed: b.sealed ? { packageCount: b.sealed.packageCount, packageKind: b.sealed.packageKind, hasSeal: b.sealed.hasSeal, description: b.sealed.description ?? '', declaredValue: b.sealed.declaredValue ?? null } : { ...EMPTY_SEALED },
  });

  return (
    <Modal open onClose={onClose} size="lg" title="Đồ đang gửi" description={`Kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}`}
      footer={form ? <>
        <Button variant="secondary" onClick={() => setForm(null)}>Huỷ</Button>
        <Button disabled={busy} onClick={submit}>{form.batchId ? 'Lưu thay đổi' : 'Gửi khai báo'}</Button>
      </> : canDeclare ? <Button onClick={() => setForm(newForm())}><PackagePlus className="size-4" />Khai đợt nhập hàng</Button> : undefined}>
      {form ? (
        <div className="space-y-4">
          {!form.batchId && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-stone-50 p-3 text-sm ring-1 ring-inset ring-stone-200">
              <input type="checkbox" className="mt-0.5 size-4" checked={form.sealedMode} onChange={(e) => setForm({ ...form, sealedMode: e.target.checked, tried: false })} />
              <span><b>Không kê khai chi tiết (gửi kín)</b> — chỉ ghi số kiện, loại kiện, niêm phong và tổng giá trị (nếu muốn). Nhân viên không mở kiện; bạn ký bản cam kết không gửi hàng cấm BẰNG GIẤY tại quầy.</span>
            </label>
          )}
          {form.sealedMode ? (
            <SealedFields value={form.sealed} onChange={(sealed) => setForm({ ...form, sealed })} error={form.tried ? err : null} />
          ) : (
            <>
              <p className="text-sm text-stone-600">Khai từng món sẽ mang vào kho. Nhân viên kiểm hàng cấm và xác nhận danh sách thực tế tại quầy.</p>
              <IntakeItemsEditor items={form.items} onChange={(items) => setForm({ ...form, items })} error={form.tried ? err : null} unitType={unitType} />
            </>
          )}
          <Field label="Ngày dự kiến mang đến (không bắt buộc)" className="max-w-xs">
            <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={addDays(todayISO(), 60).slice(0, 10)} value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
          </Field>
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Đã nhập kho</h3>
              <p className="text-sm">{holds ? <>Đang gửi {inv.inStorageCount} món · <b className="tabular-nums">{vnd(inv.totalValue)}</b></> : <b>Đã trả kho</b>}</p>
            </div>
            <Table rows={inv.items} rowKey={(it) => it.itemId} empty={<EmptyState title="Chưa có đồ nào được xác nhận" description={canDeclare ? 'Khai đợt nhập hàng trước khi mang đồ đến.' : undefined} />} columns={[
              { key: 'n', header: 'Đồ', cell: (it) => <div><p className="font-medium">{it.name}{it.sealed && <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-200">Gửi kín</span>}</p><p className="text-xs text-stone-500">{[it.category, it.note, it.batchCode].filter(Boolean).join(' · ') || '—'}</p></div> },
              { key: 'q', header: 'Đang gửi', className: 'tabular-nums', cell: (it) => (it.inStorage !== it.quantity ? <span>{it.inStorage}<span className="text-stone-400">/{it.quantity}</span></span> : it.quantity) },
              { key: 'c', header: 'Tình trạng', cell: (it) => <StatusBadge map={INTAKE_ITEM_CONDITION} value={it.condition} /> },
              {
                key: 's', header: 'Trạng thái', cell: (it) => (
                  <div>
                    <StatusBadge map={INTAKE_ITEM_STATE} value={it.state} />
                    {it.removals.length > 0 && <p className="mt-0.5 text-[11px] text-stone-500">{it.removals.map((r) => `${INTAKE_REMOVAL_KIND[r.kind].label} ${r.quantity} · ${fmtDate(r.at)}`).join('; ')}</p>}
                    {it.inStorage !== it.quantity && <p className={cx('text-[11px]', it.compensated > 0 ? 'text-violet-700' : 'text-stone-500')}>{itemStockLabel(it)}</p>}
                  </div>
                ),
              },
              { key: 'v', header: 'Giá trị', className: 'text-right tabular-nums', cell: (it) => <div><p>{vnd(it.inStorage * it.estValue)}</p><p className="text-xs text-stone-500">{vnd(it.estValue)}/cái</p></div> },
              { key: 'a', header: '', className: 'text-right', cell: (it) => (holds && it.inStorage > 0 ? <Button size="sm" variant="ghost" onClick={() => setWithdrawing(it)}><LogOut className="size-3.5" />Đã lấy ra</Button> : null) },
            ]} />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Các đợt nhập hàng</h3>
            {batches.length === 0 ? <p className="text-sm text-stone-500">Chưa có đợt nào.</p> : (
              <ul className="divide-y divide-stone-100 rounded-lg ring-1 ring-stone-200">
                {batches.map((b) => (
                  <li key={b._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p><span className="font-mono text-xs">{b.code}</span> <StatusBadge map={INTAKE_BATCH_STATUS} value={b.status} /></p>
                      <p className="text-xs text-stone-500">
                        Khai {fmtDateTime(b.declaredAt)}{b.expectedDate && b.status === 'DECLARED' ? ` · dự kiến mang đến ${fmtDate(b.expectedDate)}` : ''}
                        {b.confirmedAt ? ` · xác nhận ${fmtDateTime(b.confirmedAt)}` : ''} · {b.sealed ? `gửi kín ${b.sealed.packageCount} kiện` : `${b.items.length} dòng`} · {vnd(intakeItemsValue(b.items))}
                      </p>
                      {b.sealed && b.status === 'DECLARED' && <p className="text-xs text-violet-800">Mang các kiện đến quầy — ký bản cam kết giấy để nhân viên xác nhận.</p>}
                      {b.sealed?.pledge && <p className="text-xs text-stone-600">Đã ký bản cam kết giấy ngày {fmtDate(b.sealed.pledge.confirmedAt)}</p>}
                      {b.status === 'REJECTED' && b.rejectReason && <p className="text-xs text-red-700">Lý do: {b.rejectReason}</p>}
                      {b.status === 'CANCELLED' && b.cancelReason && <p className="text-xs text-stone-600">Đã huỷ: {b.cancelReason}</p>}
                      {b.staffNote && <p className="text-xs text-stone-600">Nhân viên: {b.staffNote}</p>}
                    </div>
                    {b.status === 'DECLARED' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => edit(b)}><Pencil className="size-3.5" />Sửa</Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Huỷ đợt nhập ${b.code}?`)) void run('cancelIntake', { batchId: b._id }, 'Đã huỷ đợt nhập'); }}>Huỷ</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!canDeclare && <p className="text-xs text-stone-500">Hợp đồng không còn nhận khai đợt nhập mới.</p>}
        </div>
      )}
      <WithdrawDialog item={withdrawing} onClose={() => setWithdrawing(null)} />
    </Modal>
  );
}

/**
 * Danh sách đồ đã xác nhận nhập kho của hợp đồng — để nhân viên ĐỐI CHIẾU khi kiểm tra trả kho / kiểm kê thanh lý hàng bỏ lại (A7).
 * `onFill`: điền nhanh danh sách kiểm kê từ các món còn đang gửi.
 */
export function GoodsReference({ contractId, onFill }: { contractId: string; onFill?: (items: { description: string; quantity: number }[]) => void }) {
  const { db } = useStore();
  const inv = inventoryOf(contractIntakeBatches(db, contractId));
  if (inv.items.length === 0) return <p className="text-xs text-stone-500">Khách chưa có đợt nhập hàng nào được xác nhận.</p>;
  const left = inv.items.filter((it) => it.inStorage > 0);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-stone-100 rounded-lg text-sm ring-1 ring-inset ring-stone-200">
        {inv.items.map((it) => (
          <li key={it.itemId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0"><span className="font-medium">{itemStockLabel(it)}</span> <span className="text-xs text-stone-500">· {it.batchCode} · {INTAKE_ITEM_CONDITION[it.condition].label.toLowerCase()}</span></span>
            <StatusBadge map={INTAKE_ITEM_STATE} value={it.state} />
          </li>
        ))}
      </ul>
      {onFill && left.length > 0 && (
        <Button size="sm" variant="secondary" onClick={() => onFill(left.map((it) => ({ description: it.name, quantity: it.inStorage })))}>Điền từ {left.length} món còn đang gửi</Button>
      )}
    </div>
  );
}
