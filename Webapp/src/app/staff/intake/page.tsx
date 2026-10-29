'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CircleCheck, PackagePlus, RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import type { IntakeBatch, IntakeCheckKey, RentalContract } from '@ssm/shared';
import { INTAKE_BATCH_STATUS, INTAKE_CHECK_ITEMS, INTAKE_ITEM_CONDITION, canDeclareIntake, intakeItemsValue, inventoryOf } from '@ssm/shared';
import type { IntakeItemInput } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { CONTRACT_STATUS } from '@/shared/lib/labels';
import { byId, contractIntakeBatches, facilityName, inScope, intakeBatchesOf, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { EMPTY_INTAKE_ITEM, GoodsCheckFields, IntakeItemsEditor, intakeItemsError } from '@/features/intake/intake-items-editor';

type Sel = { kind: 'batch' | 'contract'; id: string } | null;
/** Form xác nhận đợt khách đã khai, hoặc tạo đợt thay khách tại quầy. */
type Form = { key: string; items: IntakeItemInput[]; checks: IntakeCheckKey[]; checkNote: string; staffNote: string; tried: boolean };
const toInput = (b: IntakeBatch): IntakeItemInput[] => b.items.map((it) => ({ ...it, category: it.category ?? '', note: it.note ?? '' }));
const sameItems = (a: IntakeItemInput[], b: IntakeItemInput[]) => JSON.stringify(a) === JSON.stringify(b);
const today = () => todayISO().slice(0, 10);

/**
 * NHẬP HÀNG (tách khỏi nhận kho): mỗi lần khách mang đồ vào là một đợt nhập. Nhân viên tra mã hợp đồng / mã đợt, xem hàng chờ các
 * đợt khách đã khai, đối chiếu đồ thực tế (sửa số lượng, tình trạng, thêm dòng), kiểm đủ các mục hàng cấm rồi xác nhận — có hàng cấm
 * thì từ chối. Khách chưa khai thì tạo đợt thay khách tại quầy (khai + xác nhận một bước).
 */
function IntakeInner() {
  const { db, user, run, busy, refresh } = useStore();
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Sel>(() => {
    const b = sp.get('batch'); const c = sp.get('contract');
    return b ? { kind: 'batch', id: b } : c ? { kind: 'contract', id: c } : null;
  });
  const [form, setForm] = useState<Form | null>(null);
  const [rejecting, setRejecting] = useState<IntakeBatch | null>(null);
  const [reason, setReason] = useState('');
  if (!user) return null;

  const batches = intakeBatchesOf(db).filter((b) => inScope(db, user, b.facilityId));
  // Hàng chờ: đợt khách đã khai, chưa xác nhận — hẹn mang đến hôm nay (hoặc chưa hẹn ngày) lên trước, rồi theo lúc khai.
  const dueToday = (b: IntakeBatch) => !b.expectedDate || b.expectedDate.slice(0, 10) <= today();
  const queue = batches.filter((b) => b.status === 'DECLARED')
    .sort((a, b) => Number(dueToday(b)) - Number(dueToday(a)) || a.declaredAt.localeCompare(b.declaredAt));
  const recent = batches.filter((b) => b.status !== 'DECLARED' && (b.confirmedAt ?? b.updatedAt).slice(0, 10) >= today()).slice(0, 10);

  const batch = sel?.kind === 'batch' ? batches.find((b) => b._id === sel.id) ?? null : null;
  const contract = sel ? byId(db.contracts, sel.kind === 'contract' ? sel.id : batch?.contractId) ?? null : null;
  const contractOk = !!contract && inScope(db, user, contract.facilityId);

  // Form gắn với lựa chọn hiện tại — đổi đợt / hợp đồng thì dựng lại (đợt đã khai: điền sẵn danh sách khách khai).
  const formKey = batch ? `b:${batch._id}:${batch.status}` : contract ? `c:${contract._id}` : '';
  if ((form?.key ?? '') !== formKey) {
    setForm(formKey ? { key: formKey, items: batch ? toInput(batch) : [{ ...EMPTY_INTAKE_ITEM }], checks: [], checkNote: '', staffNote: '', tried: false } : null);
  }

  const lookup = (raw = q) => {
    setError('');
    const s = raw.trim().toUpperCase();
    if (!s) return;
    const b = batches.find((x) => x.code.toUpperCase() === s);
    if (b) { setSel({ kind: 'batch', id: b._id }); return; }
    const scoped = db.contracts.filter((c) => inScope(db, user, c.facilityId));
    const c = scoped.find((x) => x.contractNumber.toUpperCase() === s)
      ?? scoped.find((x) => canDeclareIntake(x) && unitLabel(db, x.unitId).toUpperCase() === s)
      ?? scoped.find((x) => x.contractNumber.toUpperCase().includes(s));
    if (c) { setSel({ kind: 'contract', id: c._id }); return; }
    setSel(null);
    setError('Không tìm thấy hợp đồng / đợt nhập ở chi nhánh của bạn');
  };

  const itemsErr = form ? intakeItemsError(form.items) : null;
  const checksOk = !!form && INTAKE_CHECK_ITEMS.every((i) => form.checks.includes(i.key));
  const goodsCheck = form ? { confirmed: form.checks, note: form.checkNote } : { confirmed: [] };

  const confirm = (b: IntakeBatch) => {
    if (!form) return;
    if (itemsErr || !checksOk) { setForm({ ...form, tried: true }); return; }
    void run('confirmIntake', { batchId: b._id, goodsCheck, items: sameItems(form.items, toInput(b)) ? undefined : form.items, staffNote: form.staffNote },
      (x) => `Đã xác nhận nhập kho đợt ${x.code}`);
  };
  const createOnBehalf = (c: RentalContract) => {
    if (!form) return;
    if (itemsErr || !checksOk) { setForm({ ...form, tried: true }); return; }
    void run('declareIntake', { contractId: c._id, items: form.items, onBehalf: true, goodsCheck, staffNote: form.staffNote },
      (x) => `Đã nhập kho đợt ${x.code}`, (x) => setSel({ kind: 'batch', id: x._id }));
  };

  const editor = form && (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold">{batch ? 'Danh sách thực tế' : 'Đồ khách mang vào'}</p>
        <IntakeItemsEditor items={form.items} onChange={(items) => setForm({ ...form, items })} error={form.tried ? itemsErr : null} />
        {batch && !sameItems(form.items, toInput(batch)) && <p className="mt-1 text-xs text-amber-700">Đã sửa so với bản khách khai — bản khai được lưu lại làm chứng cứ.</p>}
      </div>
      <GoodsCheckFields value={form.checks} onChange={(checks) => setForm({ ...form, checks })} note={form.checkNote} onNote={(checkNote) => setForm({ ...form, checkNote })} showError={form.tried} />
      <Field label="Ghi chú của nhân viên (không bắt buộc)"><input className={inputCls} maxLength={500} value={form.staffNote} onChange={(e) => setForm({ ...form, staffNote: e.target.value })} /></Field>
    </div>
  );

  const batchRow = (b: IntakeBatch) => (
    <button key={b._id} type="button" onClick={() => setSel({ kind: 'batch', id: b._id })} className={cx('block w-full px-5 py-3 text-left hover:bg-stone-50', sel?.id === b._id && 'bg-brand-50')}>
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{userName(db, b.customerId)}{b.status === 'DECLARED' && dueToday(b) && <Badge tone="amber">Hôm nay</Badge>}</p>
      <p className="font-mono text-xs text-stone-500">{b.code} · kho {unitLabel(db, byId(db.contracts, b.contractId)?.unitId)}</p>
      <p className="text-xs text-stone-500">{b.items.length} dòng · {vnd(intakeItemsValue(b.items))}{b.expectedDate && b.status === 'DECLARED' ? ` · hẹn ${fmtDate(b.expectedDate)}` : ''}</p>
    </button>
  );

  return (
    <>
      <PageHeader title="Nhập hàng" description="Kiểm hàng cấm và xác nhận danh sách đồ mỗi lần khách mang vào kho." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
              <div className="relative min-w-60 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <input className={cx(inputCls, 'pl-9 font-mono uppercase')} placeholder="Mã hợp đồng, mã đợt IN-… hoặc số ô" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Button type="submit"><Search className="size-4" />Tra cứu</Button>
              <Button type="button" variant="secondary" onClick={() => void refresh()}><RefreshCw className="size-4" />Tải lại</Button>
            </form>
            {error && <p className="mt-3 flex items-center gap-2 text-sm text-red-700"><TriangleAlert className="size-4" />{error}</p>}
          </Card>

          {sel && !contractOk && <Card><EmptyState title="Không tìm thấy" description="Đợt nhập / hợp đồng không thuộc chi nhánh của bạn hoặc chưa tải xong." /></Card>}

          {contractOk && contract && (
            <Card>
              <CardHeader title={`Hợp đồng ${contract.contractNumber}`} actions={<>
                <StatusBadge map={CONTRACT_STATUS} value={contract.status} />
                <Button size="sm" variant="ghost" aria-label="Đóng" onClick={() => setSel(null)}><X className="size-4" /></Button>
              </>} />
              <div className="space-y-5 p-5">
                <KV items={[
                  ['Khách hàng', userName(db, contract.customerId)], ['Số điện thoại', byId(db.users, contract.customerId)?.phone ?? '—'],
                  ['Kho', `${unitLabel(db, contract.unitId)} · ${facilityName(db, contract.facilityId)}`],
                  ['Đồ đang gửi', (() => { const inv = inventoryOf(contractIntakeBatches(db, contract._id)); return `${inv.items.reduce((s, it) => s + it.quantity, 0)} món · ${vnd(inv.totalValue)}`; })()],
                ]} />

                {batch ? (
                  <div className="space-y-4 border-t border-stone-100 pt-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">Đợt <span className="font-mono">{batch.code}</span></p>
                      <StatusBadge map={INTAKE_BATCH_STATUS} value={batch.status} />
                      {batch.onBehalf && <Badge>Tạo tại quầy</Badge>}
                    </div>
                    <p className="text-xs text-stone-500">
                      Khai {fmtDateTime(batch.declaredAt)}{batch.expectedDate ? ` · hẹn mang đến ${fmtDate(batch.expectedDate)}` : ''}
                      {batch.confirmedAt ? ` · xác nhận ${fmtDateTime(batch.confirmedAt)} bởi ${userName(db, batch.confirmedBy)}` : ''}
                    </p>
                    {batch.status === 'DECLARED' ? (
                      <>
                        {editor}
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="danger" disabled={busy} onClick={() => { setReason(''); setRejecting(batch); }}>Từ chối…</Button>
                          <Button disabled={busy} onClick={() => confirm(batch)}><CircleCheck className="size-4" />Xác nhận nhập kho</Button>
                        </div>
                        {form?.tried && (itemsErr || !checksOk) && <p role="alert" className="text-right text-xs font-medium text-red-600">Còn mục chưa hợp lệ — xem các ô báo đỏ ở trên.</p>}
                      </>
                    ) : (
                      <>
                        <Table rows={batch.items} rowKey={(it) => it._id} columns={[
                          { key: 'n', header: 'Đồ', cell: (it) => <div><p className="font-medium">{it.name}</p><p className="text-xs text-stone-500">{[it.category, it.note].filter(Boolean).join(' · ') || '—'}</p></div> },
                          { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
                          { key: 'c', header: 'Tình trạng', cell: (it) => <StatusBadge map={INTAKE_ITEM_CONDITION} value={it.condition} /> },
                          { key: 'v', header: 'Giá trị', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.estValue) },
                        ]} />
                        {batch.status === 'REJECTED' && batch.rejectReason && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Lý do từ chối: {batch.rejectReason}</p>}
                        {batch.goodsCheck?.note && <p className="text-sm text-stone-600">Ghi chú kiểm hàng: {batch.goodsCheck.note}</p>}
                        {batch.staffNote && <p className="text-sm text-stone-600">Ghi chú nhân viên: {batch.staffNote}</p>}
                        {canDeclareIntake(contract) && <Button variant="secondary" onClick={() => setSel({ kind: 'contract', id: contract._id })}><PackagePlus className="size-4" />Tạo đợt nhập mới cho hợp đồng này</Button>}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 border-t border-stone-100 pt-5">
                    {contractIntakeBatches(db, contract._id).length > 0 && (
                      <div>
                        <p className="mb-2 text-sm font-semibold">Các đợt nhập</p>
                        <ul className="divide-y divide-stone-100 rounded-lg ring-1 ring-stone-200">
                          {contractIntakeBatches(db, contract._id).map((b) => (
                            <li key={b._id}>
                              <button type="button" onClick={() => setSel({ kind: 'batch', id: b._id })} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50">
                                <span><span className="font-mono text-xs">{b.code}</span> · {fmtDateTime(b.declaredAt)} · {b.items.length} dòng · {vnd(intakeItemsValue(b.items))}</span>
                                <StatusBadge map={INTAKE_BATCH_STATUS} value={b.status} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {canDeclareIntake(contract) ? (
                      <>
                        <p className="flex items-center gap-2 font-semibold"><PackagePlus className="size-4" />Tạo đợt nhập tại quầy</p>
                        {editor}
                        <div className="flex justify-end"><Button disabled={busy} onClick={() => createOnBehalf(contract)}><CircleCheck className="size-4" />Xác nhận nhập kho</Button></div>
                        {form?.tried && (itemsErr || !checksOk) && <p role="alert" className="text-right text-xs font-medium text-red-600">Còn mục chưa hợp lệ — xem các ô báo đỏ ở trên.</p>}
                      </>
                    ) : (
                      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Hợp đồng đang “{CONTRACT_STATUS[contract.status].label}” — không nhận nhập hàng.</p>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title="Chờ xác nhận" description="Đợt khách đã khai" />
          {queue.length === 0 ? <p className="px-5 pb-5 text-sm text-stone-500">Không có đợt nào.</p> : <div className="divide-y divide-stone-100">{queue.map(batchRow)}</div>}
          {recent.length > 0 && (
            <div className="border-t border-stone-100">
              <p className="px-5 pt-4 text-sm font-semibold">Đã xử lý hôm nay</p>
              <div className="divide-y divide-stone-100">{recent.map(batchRow)}</div>
            </div>
          )}
        </Card>
      </div>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Từ chối đợt nhập" description={rejecting ? `${rejecting.code} · ${userName(db, rejecting.customerId)}` : ''}
        footer={<>
          <Button variant="secondary" onClick={() => setRejecting(null)}>Huỷ</Button>
          <Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => rejecting && void run('rejectIntake', { batchId: rejecting._id, reason }, `Đã từ chối đợt ${rejecting.code}`, () => setRejecting(null))}>Từ chối nhập</Button>
        </>}>
        <Field label="Lý do (hàng cấm phát hiện được)" hint="Tối thiểu 5 ký tự — khách xem được lý do.">
          <textarea className={inputCls} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Có 2 bình gas mini trong thùng đồ dã ngoại." />
        </Field>
      </Modal>
    </>
  );
}

export default function StaffIntakePage() {
  return <Suspense><IntakeInner /></Suspense>;
}
