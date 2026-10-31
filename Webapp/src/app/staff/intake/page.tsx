'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  Ban, Boxes, CalendarDays, CircleCheck, CircleX, Clock, FileSignature, History, ListChecks, LogOut, NotebookPen, Package, PackageCheck, PackagePlus, Pencil, Phone, Printer, RefreshCw,
  Search, SearchX, ShieldAlert, TriangleAlert, X,
} from 'lucide-react';
import type { IntakeBatch, IntakeCheckKey, InventoryItem, RentalContract, SealedCheckKey } from '@ssm/shared';
import {
  INTAKE_BATCH_STATUS, INTAKE_CANCEL_REASON_MIN, INTAKE_CHECK_ITEMS, INTAKE_ITEM_CONDITION, INTAKE_ITEM_STATE, INTAKE_SEALED_CHECK_ITEMS, itemStockLabel, SEALED_CLAIM_RULE, SEALED_PACKAGE_KIND,
  canDeclareIntake, contractHoldsGoods, intakeItemsValue, inventoryOf,
} from '@ssm/shared';
import type { IntakeItemInput, SealedIntakeInput } from '@/shared/api/actions';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { CONTRACT_STATUS } from '@/shared/lib/labels';
import { byId, contractIntakeBatches, facilityName, inScope, intakeBatchesOf, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, Disclosure, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { WithdrawDialog } from '@/features/intake/contract-goods';
import { EMPTY_INTAKE_ITEM, EMPTY_SEALED, GoodsCheckFields, IntakeItemsEditor, SealedFields, intakeItemsError, sealedError } from '@/features/intake/intake-items-editor';
import { ActionBar, Callout, Chip, ChipRow, Meta, PanelHeader, QueueRow, StepBlock, SubHeading, UnitTag } from '@/features/staff-ui';

type Sel = { kind: 'batch' | 'contract'; id: string } | null;
/** Form xác nhận đợt khách đã khai, hoặc tạo đợt thay khách tại quầy. */
// Đợt 16 (D2): `sealedMode` = tạo đợt gửi kín tại quầy; `pledge` = nhân viên tick "Khách đã ký bản cam kết giấy".
type Form = { key: string; items: IntakeItemInput[]; checks: (IntakeCheckKey | SealedCheckKey)[]; checkNote: string; staffNote: string; tried: boolean; sealedMode: boolean; sealed: SealedIntakeInput; pledge: boolean };
const toInput = (b: IntakeBatch): IntakeItemInput[] => b.items.map((it) => ({ ...it, category: it.category ?? '', note: it.note ?? '' }));
const sameItems = (a: IntakeItemInput[], b: IntakeItemInput[]) => JSON.stringify(a) === JSON.stringify(b);
const today = () => todayISO().slice(0, 10);

/**
 * NHẬP HÀNG (tách khỏi nhận kho): mỗi lần khách mang đồ vào là một đợt nhập. Nhân viên tra mã hợp đồng / mã đợt, xem hàng chờ các
 * đợt khách đã khai, đối chiếu đồ thực tế (sửa số lượng, tình trạng, thêm dòng), kiểm đủ các mục hàng cấm rồi xác nhận — có hàng cấm
 * thì từ chối. Khách chưa khai thì tạo đợt thay khách tại quầy (khai + xác nhận một bước).
 */
function IntakeInner() {
  const { db, user, run, busy, refresh, toast } = useStore();
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
  // A8: huỷ đợt khách khai mà không mang đồ đến (bắt buộc lý do, khách nhận email).
  const [cancelling, setCancelling] = useState<IntakeBatch | null>(null);
  // A4: khách vừa sửa đợt nhập trong lúc nhân viên đang xem → server 409, đã tải lại.
  const [changedFor, setChangedFor] = useState<string | null>(null);
  // A7: ghi "khách lấy ra" một món đang gửi.
  const [withdrawing, setWithdrawing] = useState<InventoryItem | null>(null);
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

  // Form gắn với lựa chọn hiện tại — đổi đợt / hợp đồng thì dựng lại (đợt đã khai: điền sẵn danh sách khách khai). Có cả mốc updatedAt:
  // khách sửa đợt (server báo 409 INTAKE_CHANGED, đã tải lại) thì form dựng lại theo danh sách mới.
  const formKey = batch ? `b:${batch._id}:${batch.status}:${batch.updatedAt}` : contract ? `c:${contract._id}` : '';
  // A3: dòng KHÁCH khai (đợt khách tự khai, chưa xác nhận) — khoá tên / giá trị khi nhân viên xác nhận.
  const lockedIds = batch && batch.status === 'DECLARED' && !batch.onBehalf ? new Set(batch.items.map((x) => x._id)) : undefined;
  const contractInv = contract ? inventoryOf(contractIntakeBatches(db, contract._id)) : null;
  const holds = !!contract && contractHoldsGoods(contract);
  if ((form?.key ?? '') !== formKey) {
    setForm(formKey ? { key: formKey, items: batch ? toInput(batch) : [{ ...EMPTY_INTAKE_ITEM }], checks: [], checkNote: '', staffNote: '', tried: false, sealedMode: false, sealed: { ...EMPTY_SEALED }, pledge: false } : null);
  }
  // D1: nhóm đồ theo cỡ kho đang thuê (sau đổi cỡ là loại mới) + kích thước ô cho cảnh báo thể tích.
  const unitType = contract ? byId(db.unitTypes, contract.unitTypeId) : undefined;
  // D2: đợt gửi kín (đang xem) hoặc đang tạo gửi kín tại quầy — kiểm bên ngoài thay cho kiểm hàng cấm, bắt buộc bản cam kết giấy.
  const sealedFlow = !!batch?.sealed || (!batch && !!form?.sealedMode);
  const printPledge = async (b: IntakeBatch) => {
    try {
      const blob = await api.blob(`/intake-batches/${b._id}/sealed-pledge.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `cam-ket-gui-kin-${b.code}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được bản cam kết', 'error');
    }
  };

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

  const itemsErr = form ? (sealedFlow ? (batch ? null : sealedError(form.sealed)) : intakeItemsError(form.items)) : null;
  const checkList: readonly { key: IntakeCheckKey | SealedCheckKey }[] = sealedFlow ? INTAKE_SEALED_CHECK_ITEMS : INTAKE_CHECK_ITEMS;
  const checksOk = !!form && checkList.every((i) => form.checks.includes(i.key));
  const pledgeOk = !sealedFlow || !!form?.pledge;
  const goodsCheck = form ? { confirmed: form.checks.filter((k) => checkList.some((i) => i.key === k)), note: form.checkNote } : { confirmed: [] };

  // Luôn gửi danh sách + mốc updatedAt lúc mở (A4) — khách vừa sửa đợt thì server trả 409 INTAKE_CHANGED: báo và nạp lại để kiểm lại.
  const onChanged = (b: IntakeBatch) => (res: { ok: boolean; code?: string }) => { if (!res.ok && res.code === 'INTAKE_CHANGED') { setChangedFor(b._id); void refresh(); } };
  const confirm = (b: IntakeBatch) => {
    if (!form) return;
    if (itemsErr || !checksOk || !pledgeOk) { setForm({ ...form, tried: true }); return; }
    setChangedFor(null);
    void run('confirmIntake', { batchId: b._id, goodsCheck, items: b.sealed ? undefined : form.items, staffNote: form.staffNote, expectedUpdatedAt: b.updatedAt, pledgeSigned: b.sealed ? form.pledge : undefined },
      (x) => `Đã xác nhận nhập kho đợt ${x.code} — khách nhận ${x.sealed ? 'xác nhận gửi kín' : 'danh sách'} qua email`).then(onChanged(b));
  };
  const createOnBehalf = (c: RentalContract) => {
    if (!form) return;
    if (itemsErr || !checksOk) { setForm({ ...form, tried: true }); return; }
    void run('declareIntake', { contractId: c._id, items: form.items, onBehalf: true, goodsCheck, staffNote: form.staffNote },
      (x) => `Đã nhập kho đợt ${x.code}`, (x) => setSel({ kind: 'batch', id: x._id }));
  };
  // D2: gửi kín tại quầy — đăng ký đợt trước (có mã để in bản cam kết), khách ký giấy, rồi kiểm bên ngoài và xác nhận.
  const registerSealed = (c: RentalContract) => {
    if (!form) return;
    if (itemsErr) { setForm({ ...form, tried: true }); return; }
    void run('declareIntake', { contractId: c._id, sealed: form.sealed, onBehalf: true, staffNote: form.staffNote },
      (x) => `Đã đăng ký đợt gửi kín ${x.code} — in bản cam kết cho khách ký`, (x) => setSel({ kind: 'batch', id: x._id }));
  };

  const sealedInfo = (b: IntakeBatch) => b.sealed && (
    <Callout tone="violet" icon={<Package />} title={`Gửi kín — ${b.sealed.packageCount} ${SEALED_PACKAGE_KIND[b.sealed.packageKind].toLowerCase()}, ${b.sealed.hasSeal ? 'có niêm phong' : 'không niêm phong'}`}>
      <p>{b.items.map((i) => i.name).join(', ')} · {b.sealed.declaredValue ? `tổng giá trị khai ${vnd(b.sealed.declaredValue)} (mỗi kiện ${vnd(Math.floor(b.sealed.declaredValue / b.sealed.packageCount))})` : 'không khai giá trị'}{b.sealed.description ? ` · ${b.sealed.description}` : ''}</p>
      {b.sealed.pledge ? <p className="mt-1 text-xs">Khách đã ký bản cam kết giấy (mẫu {b.sealed.pledge.version}) — {b.sealed.pledge.confirmedByName} xác nhận {fmtDateTime(b.sealed.pledge.confirmedAt)}</p>
        : <p className="mt-1 text-xs">{SEALED_CLAIM_RULE}</p>}
    </Callout>
  );
  const editor = form && (
    <div className="space-y-6">
      {batch?.sealed ? (
        <StepBlock n={1} state={form.pledge ? 'done' : 'current'} icon={<FileSignature />} title="Bản cam kết gửi kín (ký giấy tại quầy)"
          tip="Không mở kiện. In bản cam kết, khách đọc và ký giấy; chi nhánh lưu bản giấy.">
          <div className="space-y-3">
            {sealedInfo(batch)}
            <Button variant="secondary" onClick={() => void printPledge(batch)}><Printer className="size-4" />In bản cam kết</Button>
            <label className={cx('flex cursor-pointer gap-2.5 text-sm', form.tried && !form.pledge ? 'font-medium text-red-700' : 'text-stone-800')}>
              <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={form.pledge} onChange={(e) => setForm({ ...form, pledge: e.target.checked })} />
              <span>Khách đã ký bản cam kết giấy (cam kết không gửi hàng cấm, đồng ý giới hạn bồi thường theo kiện)</span>
            </label>
          </div>
        </StepBlock>
      ) : batch || !form.sealedMode ? (
        <StepBlock n={1} state={itemsErr ? 'current' : 'done'} icon={<ListChecks />} title={batch ? 'Danh sách thực tế' : 'Đồ khách mang vào'}
          tip={batch ? 'Đối chiếu số lượng và tình trạng bên ngoài với bản khách khai — không kiểm định, không định giá. Món khách mang thêm thì thêm dòng.' : undefined}
          aside={<Chip>{form.items.length} dòng</Chip>}>
          <IntakeItemsEditor items={form.items} onChange={(items) => setForm({ ...form, items })} error={form.tried ? itemsErr : null} lockedIds={lockedIds} unitType={unitType} />
          {batch && !sameItems(form.items, toInput(batch)) && <Callout tone="amber" icon={<Pencil />} className="mt-2">Đã sửa so với bản khách khai — bản khai được lưu lại làm chứng cứ.</Callout>}
        </StepBlock>
      ) : (
        <StepBlock n={1} state={itemsErr ? 'current' : 'done'} icon={<Package />} title="Gửi kín theo kiện" tip="Khách không kê khai chi tiết — chỉ số kiện, loại kiện, niêm phong, tổng giá trị (nếu khai).">
          <SealedFields value={form.sealed} onChange={(sealed) => setForm({ ...form, sealed })} error={form.tried ? itemsErr : null} />
        </StepBlock>
      )}
      {(batch || !form.sealedMode) && (
        <StepBlock n={2} state={checksOk ? 'done' : 'current'} icon={<ShieldAlert />} title={sealedFlow ? 'Kiểm bên ngoài' : 'Kiểm hàng cấm'} tip={sealedFlow ? 'Không mở kiện — quan sát mùi, rò rỉ, tiếng động, khối lượng. Bất thường thì bấm “Từ chối”.' : 'Tick đủ mọi mục. Phát hiện hàng cấm thì bấm “Từ chối”.'}>
          <GoodsCheckFields sealed={sealedFlow} value={form.checks} onChange={(checks) => setForm({ ...form, checks })} note={form.checkNote} onNote={(checkNote) => setForm({ ...form, checkNote })} showError={form.tried} />
        </StepBlock>
      )}
      <StepBlock n={form.sealedMode && !batch ? 2 : 3} state={form.staffNote.trim() ? 'done' : 'todo'} icon={<NotebookPen />} title="Ghi chú của nhân viên" aside={<span className="text-xs text-stone-400">Không bắt buộc</span>}>
        <input className={inputCls} maxLength={500} aria-label="Ghi chú của nhân viên (không bắt buộc)" value={form.staffNote} onChange={(e) => setForm({ ...form, staffNote: e.target.value })} />
      </StepBlock>
    </div>
  );
  const errorNote = form?.tried && (itemsErr || (!(form.sealedMode && !batch) && !checksOk) || !pledgeOk) && <p role="alert" className="text-right text-xs font-medium text-red-600">Còn mục chưa hợp lệ — xem các ô báo đỏ ở trên.</p>;

  const batchRow = (b: IntakeBatch) => (
    <QueueRow key={b._id} active={sel?.id === b._id} onSelect={() => setSel({ kind: 'batch', id: b._id })}
      lead={<UnitTag label={unitLabel(db, byId(db.contracts, b.contractId)?.unitId)} size="sm" tone={b.status === 'DECLARED' ? 'ink' : INTAKE_BATCH_STATUS[b.status].tone} />}
      title={userName(db, b.customerId)}
      badges={b.status === 'DECLARED' ? dueToday(b) && <Badge tone="amber" dot>Hôm nay</Badge> : <StatusBadge map={INTAKE_BATCH_STATUS} value={b.status} />}
      meta={<>
        <Meta mono>{b.code}</Meta>
        <Meta icon={b.sealed ? <Package /> : <Boxes />}>{b.sealed ? `Gửi kín ${b.sealed.packageCount} kiện` : `${b.items.length} dòng`} · {vnd(intakeItemsValue(b.items))}</Meta>
        {b.expectedDate && b.status === 'DECLARED' && <Meta icon={<CalendarDays />}>Hẹn {fmtDate(b.expectedDate)}</Meta>}
      </>}
    />
  );

  return (
    <>
      <PageHeader title="Nhập hàng" description="Kiểm hàng cấm và xác nhận danh sách đồ mỗi lần khách mang vào kho." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4 sm:p-5">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <input className={cx(inputCls, 'h-10 pl-9 font-mono uppercase')} placeholder="Mã hợp đồng, mã đợt IN-… hoặc số ô" aria-label="Mã hợp đồng, mã đợt hoặc số ô" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Button type="submit"><Search className="size-4" />Tra cứu</Button>
              <Button type="button" variant="secondary" onClick={() => void refresh()}><RefreshCw className="size-4" />Tải lại</Button>
            </form>
            {error && <Callout tone="red" icon={<TriangleAlert />} className="mt-3">{error}</Callout>}
          </Card>

          {sel && !contractOk && <Card><EmptyState icon={<SearchX className="size-6" />} title="Không tìm thấy" description="Đợt nhập / hợp đồng không thuộc chi nhánh của bạn hoặc chưa tải xong." /></Card>}

          {contractOk && contract && (
            <Card>
              <div className="flex flex-wrap items-start gap-3 border-b border-stone-100 p-4 sm:p-5">
                <UnitTag label={unitLabel(db, contract.unitId)} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">{userName(db, contract.customerId)}</h2>
                    <StatusBadge map={CONTRACT_STATUS} value={contract.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">HĐ <span className="font-mono">{contract.contractNumber}</span> · {facilityName(db, contract.facilityId)}</p>
                  <ChipRow className="mt-2">
                    <Chip icon={<Phone />} title="Số điện thoại">{byId(db.users, contract.customerId)?.phone ?? '—'}</Chip>
                    <Chip icon={<Boxes />} tone={holds ? 'teal' : 'gray'} title="Đồ đang gửi">{holds ? `Đang gửi ${contractInv?.inStorageCount ?? 0} món · ${vnd(contractInv?.totalValue ?? 0)}` : 'Đã trả kho'}</Chip>
                  </ChipRow>
                </div>
                <Button size="sm" variant="ghost" aria-label="Đóng" onClick={() => setSel(null)}><X className="size-4" /></Button>
              </div>

              <div className="p-4 sm:p-5">
                {batch ? (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <IconTile icon={<PackageCheck className="size-4" />} tone={INTAKE_BATCH_STATUS[batch.status].tone} size="sm" />
                        <p className="font-semibold text-ink">Đợt <span className="font-mono">{batch.code}</span></p>
                        <StatusBadge map={INTAKE_BATCH_STATUS} value={batch.status} />
                        {batch.onBehalf && <Badge>Tạo tại quầy</Badge>}
                        {batch.sealed && <Badge tone="violet">Gửi kín</Badge>}
                      </div>
                      <ChipRow>
                        <Chip icon={<Clock />}>Khai {fmtDateTime(batch.declaredAt)}</Chip>
                        {batch.expectedDate && <Chip icon={<CalendarDays />}>Hẹn mang đến {fmtDate(batch.expectedDate)}</Chip>}
                        {batch.confirmedAt && <Chip icon={<CircleCheck />} tone="green">Xác nhận {fmtDateTime(batch.confirmedAt)} · {userName(db, batch.confirmedBy)}</Chip>}
                      </ChipRow>
                    </div>
                    {batch.status === 'DECLARED' ? (
                      <>
                        {changedFor === batch._id && <Callout tone="amber" icon={<RefreshCw />}>Khách vừa sửa đợt nhập — đã tải lại, kiểm tra lại.</Callout>}
                        {editor}
                        <ActionBar note={errorNote}>
                          <Button variant="ghost" disabled={busy} onClick={() => { setReason(''); setCancelling(batch); }}><CircleX className="size-4" />Huỷ đợt…</Button>
                          <Button variant="danger" disabled={busy} onClick={() => { setReason(''); setRejecting(batch); }}><Ban className="size-4" />Từ chối…</Button>
                          <Button disabled={busy} onClick={() => confirm(batch)}><CircleCheck className="size-4" />Xác nhận nhập kho</Button>
                        </ActionBar>
                      </>
                    ) : (
                      <>
                        {sealedInfo(batch)}
                        <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-stone-200">
                          {/* Cùng dạng dòng "đồ đang gửi" (đợt chưa xác nhận thì coi như vừa nhập) — đợt đã xác nhận có thêm số đang gửi / trạng thái. */}
                          <Table rows={inventoryOf([{ ...batch, status: 'CONFIRMED' }]).items} rowKey={(it) => it.itemId} columns={[
                            { key: 'n', header: 'Đồ', cell: (it) => <div><p className="flex flex-wrap items-center gap-1.5 font-medium">{it.name}{it.addedByStaff && <Badge tone="amber">Thêm tại quầy</Badge>}</p><p className="text-xs text-stone-500">{[it.category, it.note].filter(Boolean).join(' · ') || '—'}</p></div> },
                            { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => (it.inStorage !== it.quantity ? <span>{it.inStorage}<span className="text-stone-400">/{it.quantity}</span></span> : it.quantity) },
                            { key: 'c', header: 'Tình trạng', cell: (it) => <StatusBadge map={INTAKE_ITEM_CONDITION} value={it.condition} /> },
                            { key: 's', header: 'Trạng thái', cell: (it) => (batch.status === 'CONFIRMED' ? <StatusBadge map={INTAKE_ITEM_STATE} value={it.state} /> : '—') },
                            { key: 'v', header: 'Giá trị', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.estValue) },
                          ]} />
                        </div>
                        {batch.status === 'REJECTED' && batch.rejectReason && <Callout tone="red" icon={<Ban />} title="Lý do từ chối">{batch.rejectReason}</Callout>}
                        {batch.status === 'CANCELLED' && batch.cancelReason && <Callout tone="gray" icon={<CircleX />} title="Lý do huỷ">{batch.cancelReason}</Callout>}
                        {batch.goodsCheck?.note && <Callout tone="gray" icon={<ShieldAlert />} title="Ghi chú kiểm hàng">{batch.goodsCheck.note}</Callout>}
                        {batch.staffNote && <Callout tone="gray" icon={<NotebookPen />} title="Ghi chú nhân viên">{batch.staffNote}</Callout>}
                        {canDeclareIntake(contract) && <Button variant="secondary" onClick={() => setSel({ kind: 'contract', id: contract._id })}><PackagePlus className="size-4" />Tạo đợt nhập mới cho hợp đồng này</Button>}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-5">
                    {contractInv && contractInv.items.length > 0 && (
                      <Disclosure icon={<Boxes className="size-4" />} title="Đồ đã nhập kho" meta={holds ? `Đang gửi ${contractInv.inStorageCount} món` : 'Đã trả kho'} defaultOpen>
                        <ul className="-mx-4 -mb-4 divide-y divide-stone-100 border-t border-stone-100">
                          {contractInv.items.map((it) => (
                            <QueueRow key={it.itemId}
                              title={<span className="flex flex-wrap items-center gap-1.5">{it.name}<StatusBadge map={INTAKE_ITEM_STATE} value={it.state} /></span>}
                              meta={<>
                                <Meta mono>{it.batchCode}</Meta>
                                <Meta icon={<Boxes />}>{itemStockLabel(it)}</Meta>
                                <Meta>{vnd(it.estValue)}/cái</Meta>
                              </>}
                              actions={holds && it.inStorage > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setWithdrawing(it)}><LogOut className="size-3.5" />Khách lấy ra</Button>}
                            />
                          ))}
                        </ul>
                      </Disclosure>
                    )}
                    {contractIntakeBatches(db, contract._id).length > 0 && (
                      <Disclosure icon={<History className="size-4" />} title="Các đợt nhập" meta={`${contractIntakeBatches(db, contract._id).length} đợt`}>
                        <ul className="-mx-4 -mb-4 divide-y divide-stone-100 border-t border-stone-100">
                          {contractIntakeBatches(db, contract._id).map((b) => (
                            <QueueRow key={b._id} onSelect={() => setSel({ kind: 'batch', id: b._id })}
                              title={<span className="font-mono text-xs">{b.code}</span>}
                              meta={<><Meta icon={<Clock />}>{fmtDateTime(b.declaredAt)}</Meta><Meta icon={<Boxes />}>{b.items.length} dòng · {vnd(intakeItemsValue(b.items))}</Meta></>}
                              actions={<StatusBadge map={INTAKE_BATCH_STATUS} value={b.status} />}
                            />
                          ))}
                        </ul>
                      </Disclosure>
                    )}
                    {canDeclareIntake(contract) ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-2 font-semibold text-ink"><IconTile icon={<PackagePlus className="size-4" />} size="sm" />Tạo đợt nhập tại quầy</p>
                          {form && (
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                              <input type="checkbox" className="size-4" checked={form.sealedMode} onChange={(e) => setForm({ ...form, sealedMode: e.target.checked, tried: false })} />
                              Không kê khai chi tiết (gửi kín)
                            </label>
                          )}
                        </div>
                        {editor}
                        <ActionBar note={errorNote}>
                          {form?.sealedMode
                            ? <Button disabled={busy} onClick={() => registerSealed(contract)}><Package className="size-4" />Đăng ký gửi kín — in bản cam kết</Button>
                            : <Button disabled={busy} onClick={() => createOnBehalf(contract)}><CircleCheck className="size-4" />Xác nhận nhập kho</Button>}
                        </ActionBar>
                      </>
                    ) : (
                      <Callout tone="amber" icon={<TriangleAlert />}>Hợp đồng đang “{CONTRACT_STATUS[contract.status].label}” — không nhận nhập hàng.</Callout>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <Card className="self-start">
          <PanelHeader icon={<PackageCheck className="size-4" />} tone="amber" title="Chờ xác nhận" count={queue.length} tip="Đợt khách đã khai — hẹn mang đến hôm nay (hoặc chưa hẹn ngày) lên trước." />
          {queue.length === 0 ? <EmptyState compact icon={<PackageCheck className="size-5" />} title="Không có đợt nào" /> : <ul className="divide-y divide-stone-100">{queue.map(batchRow)}</ul>}
          {recent.length > 0 && (
            <div className="border-t border-stone-100">
              <SubHeading icon={<History />} title="Đã xử lý hôm nay" count={recent.length} />
              <ul className="divide-y divide-stone-100">{recent.map(batchRow)}</ul>
            </div>
          )}
        </Card>
      </div>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Từ chối đợt nhập" description={rejecting ? `${rejecting.code} · ${userName(db, rejecting.customerId)}` : ''}
        footer={<>
          <Button variant="secondary" onClick={() => setRejecting(null)}>Huỷ</Button>
          <Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => { if (!rejecting) return; const b = rejecting; void run('rejectIntake', { batchId: b._id, reason, expectedUpdatedAt: b.updatedAt }, `Đã từ chối đợt ${b.code}`, () => setRejecting(null)).then((res) => { if (!res.ok && res.code === 'INTAKE_CHANGED') { setRejecting(null); onChanged(b)(res); } }); }}>Từ chối nhập</Button>
        </>}>
        <Field label="Lý do (hàng cấm phát hiện được)" hint="Tối thiểu 5 ký tự — khách xem được lý do.">
          <textarea className={inputCls} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Có 2 bình gas mini trong thùng đồ dã ngoại." />
        </Field>
      </Modal>

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title="Huỷ đợt nhập" description={cancelling ? `${cancelling.code} · ${userName(db, cancelling.customerId)}` : ''}
        footer={<>
          <Button variant="secondary" onClick={() => setCancelling(null)}>Đóng</Button>
          <Button variant="danger" disabled={busy || reason.trim().length < INTAKE_CANCEL_REASON_MIN} onClick={() => cancelling && void run('cancelIntake', { batchId: cancelling._id, reason }, `Đã huỷ đợt ${cancelling.code} — khách nhận email lý do`, () => { setCancelling(null); setSel(null); })}>Huỷ đợt nhập</Button>
        </>}>
        <Field label="Lý do huỷ" hint={`Tối thiểu ${INTAKE_CANCEL_REASON_MIN} ký tự — khách nhận lý do qua email.`}>
          <textarea className={inputCls} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Khách khai nhưng không mang đồ đến, đã gọi điện không liên lạc được." />
        </Field>
      </Modal>

      <WithdrawDialog item={withdrawing} onClose={() => setWithdrawing(null)} staff />
    </>
  );
}

export default function StaffIntakePage() {
  return <Suspense><IntakeInner /></Suspense>;
}
