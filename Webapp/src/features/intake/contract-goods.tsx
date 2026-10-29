'use client';

import { useState } from 'react';
import { PackagePlus, Pencil } from 'lucide-react';
import type { IntakeBatch, RentalContract } from '@ssm/shared';
import { INTAKE_BATCH_STATUS, INTAKE_ITEM_CONDITION, canDeclareIntake, intakeItemsValue, inventoryOf } from '@ssm/shared';
import type { IntakeItemInput } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { contractIntakeBatches, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Button, EmptyState, Field, Modal, StatusBadge, Table, inputCls } from '@/shared/ui';
import { EMPTY_INTAKE_ITEM, IntakeItemsEditor, intakeItemsError } from '@/features/intake/intake-items-editor';

/** Tóm tắt "đồ đang gửi" của một hợp đồng cho thẻ hợp đồng: số món, tổng giá trị, số đợt đang chờ nhân viên xác nhận. */
export function goodsSummary(batches: IntakeBatch[]) {
  const inv = inventoryOf(batches);
  return { count: inv.items.reduce((s, it) => s + it.quantity, 0), total: inv.totalValue, pending: batches.filter((b) => b.status === 'DECLARED').length };
}

type FormState = { batchId: string | null; items: IntakeItemInput[]; expectedDate: string; tried: boolean };
const newForm = (): FormState => ({ batchId: null, items: [{ ...EMPTY_INTAKE_ITEM }], expectedDate: '', tried: false });

/**
 * Khách xem "Đồ đang gửi" của hợp đồng (các đợt nhập đã được nhân viên xác nhận), khai đợt nhập hàng mới (nhiều dòng) và xem lịch sử
 * các đợt — đợt còn chờ xác nhận thì sửa / huỷ được. Danh sách đã xác nhận là căn cứ khi xét bồi thường.
 */
export function ContractGoodsDialog({ contract, declare = false, onClose }: { contract: RentalContract | null; declare?: boolean; onClose: () => void }) {
  const { db, run, busy } = useStore();
  const [form, setForm] = useState<FormState | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  // Mở cho hợp đồng khác → mở thẳng form khai nếu được yêu cầu.
  if ((contract?._id ?? null) !== openedFor) { setOpenedFor(contract?._id ?? null); setForm(contract && declare ? newForm() : null); }
  if (!contract) return null;

  const c = db.contracts.find((x) => x._id === contract._id) ?? contract;
  const batches = contractIntakeBatches(db, c._id);
  const inv = inventoryOf(batches);
  const canDeclare = canDeclareIntake(c);
  const err = form ? intakeItemsError(form.items) : null;

  const submit = () => {
    if (!form) return;
    if (err) { setForm({ ...form, tried: true }); return; }
    const done = () => setForm(null);
    if (form.batchId) void run('updateIntake', { batchId: form.batchId, items: form.items, expectedDate: form.expectedDate || null }, 'Đã cập nhật đợt nhập', done);
    else void run('declareIntake', { contractId: c._id, items: form.items, expectedDate: form.expectedDate || undefined }, (b) => `Đã khai đợt ${b.code} — mang đồ đến quầy để nhân viên kiểm và xác nhận`, done);
  };
  const edit = (b: IntakeBatch) => setForm({ batchId: b._id, items: b.items.map((it) => ({ ...it, category: it.category ?? '', note: it.note ?? '' })), expectedDate: b.expectedDate?.slice(0, 10) ?? '', tried: false });

  return (
    <Modal open onClose={onClose} size="lg" title="Đồ đang gửi" description={`Kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}`}
      footer={form ? <>
        <Button variant="secondary" onClick={() => setForm(null)}>Huỷ</Button>
        <Button disabled={busy} onClick={submit}>{form.batchId ? 'Lưu thay đổi' : 'Gửi khai báo'}</Button>
      </> : canDeclare ? <Button onClick={() => setForm(newForm())}><PackagePlus className="size-4" />Khai đợt nhập hàng</Button> : undefined}>
      {form ? (
        <div className="space-y-4">
          <p className="text-sm text-stone-600">Khai từng món sẽ mang vào kho. Nhân viên kiểm hàng cấm và xác nhận danh sách thực tế tại quầy.</p>
          <IntakeItemsEditor items={form.items} onChange={(items) => setForm({ ...form, items })} error={form.tried ? err : null} />
          <Field label="Ngày dự kiến mang đến (không bắt buộc)" className="max-w-xs">
            <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={addDays(todayISO(), 60).slice(0, 10)} value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
          </Field>
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Đã nhập kho</h3>
              <p className="text-sm">Tổng giá trị <b className="tabular-nums">{vnd(inv.totalValue)}</b></p>
            </div>
            <Table rows={inv.items} rowKey={(it) => it.itemId} empty={<EmptyState title="Chưa có đồ nào được xác nhận" description={canDeclare ? 'Khai đợt nhập hàng trước khi mang đồ đến.' : undefined} />} columns={[
              { key: 'n', header: 'Đồ', cell: (it) => <div><p className="font-medium">{it.name}</p><p className="text-xs text-stone-500">{[it.category, it.note].filter(Boolean).join(' · ') || '—'}</p></div> },
              { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
              { key: 'c', header: 'Tình trạng', cell: (it) => <StatusBadge map={INTAKE_ITEM_CONDITION} value={it.condition} /> },
              { key: 'v', header: 'Giá trị', className: 'text-right tabular-nums', cell: (it) => <div><p>{vnd(it.quantity * it.estValue)}</p>{it.quantity > 1 && <p className="text-xs text-stone-500">{vnd(it.estValue)}/cái</p>}</div> },
              { key: 'b', header: 'Đợt', cell: (it) => <span className="font-mono text-xs">{it.batchCode}</span> },
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
                        {b.confirmedAt ? ` · xác nhận ${fmtDateTime(b.confirmedAt)}` : ''} · {b.items.length} dòng · {vnd(intakeItemsValue(b.items))}
                      </p>
                      {b.status === 'REJECTED' && b.rejectReason && <p className="text-xs text-red-700">Lý do: {b.rejectReason}</p>}
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
    </Modal>
  );
}
