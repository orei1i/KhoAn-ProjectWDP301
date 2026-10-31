'use client';

import { useState, type ReactNode } from 'react';
import {
  Ban, Banknote, CalendarDays, CircleCheck, ClipboardCheck, FileText, Hammer, History, Image as ImageIcon, KeyRound, LockKeyhole, Package, PackageOpen, PenLine, Plus,
  ShieldAlert, Timer, Trash2, TriangleAlert, Undo2, UserPlus, UserRound, UserX, Wallet, Warehouse,
} from 'lucide-react';
import type { InspectionLog, ItemCondition, RentalContract } from '@ssm/shared';
import { CLAIM_FM_APPROVAL_LIMIT, contractClawback, DAMAGE_STAFF_LIMIT, LEFTOVER_FEE_MAX, LEFTOVER_HOLD_DAYS, OPEN_ACCESS_REQUEST_STATUSES, OPEN_SERVICE_ORDER_STATUSES, OPEN_SWAP_STATUSES, unusedRenewalRefunds } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { INSPECTION_OUTCOME } from '@/shared/lib/labels';
import { byId, earlyTerminationCap, settlementDateOf, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, Disclosure, EmptyState, Field, IconTile, InfoTip, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { SignaturePad } from '@/features/contracts/signature-pad';
import { GoodsReference } from '@/features/intake/contract-goods';
import { ActionBar, Callout, Chip, ChipRow, Fact, FactGrid, Ledger, LedgerRow, Meta, PanelHeader, QueueRow, Segmented, StepBlock, StepTrack, UnitTag, type StepState } from '@/features/staff-ui';

const ITEMS = ['Cửa cuốn / cửa kho', 'Ổ khóa', 'Sàn', 'Tường & vách ngăn', 'Trần / chống thấm', 'Vệ sinh chung'];
const COND: { v: ItemCondition; label: string }[] = [{ v: 'OK', label: 'Tốt' }, { v: 'DAMAGED', label: 'Hư hại' }, { v: 'MISSING', label: 'Thiếu' }];
type Damage = InspectionLog['damages'][number];
const HTTPS_RE = /^https:\/\/\S+$/;
const urlsOf = (s: string) => s.split(/[\s,]+/).filter(Boolean);

export default function MoveOutPage() {
  const { db, user, run } = useStore();
  const scope = useFacilityScope();
  const [active, setActive] = useState<RentalContract | null>(null);
  const [checklist, setChecklist] = useState<Record<string, ItemCondition>>({});
  const [damages, setDamages] = useState<Damage[]>([]);
  const [notes, setNotes] = useState('');
  const [photoText, setPhotoText] = useState<string[]>([]); // link ảnh của từng hư hại, cách nhau dấu phẩy / xuống dòng
  const [walkIn, setWalkIn] = useState('');
  const [walkInReason, setWalkInReason] = useState('');
  const [confirmDone, setConfirmDone] = useState(false); // hộp xác nhận trước khi đóng hợp đồng
  // Nhận lại kho: khách có mặt ký tay trên màn hình, hoặc (chỉ quản lý) xác nhận khách vắng mặt kèm lý do.
  const [recv, setRecv] = useState<RentalContract | null>(null);
  const [recvMode, setRecvMode] = useState<'SIGN' | 'ABSENT'>('SIGN');
  const [signerName, setSignerName] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [absentReason, setAbsentReason] = useState('');
  // Đồ khách để lại trong ô (bắt buộc khai): null = chưa chọn.
  const [left, setLeft] = useState<boolean | null>(null);
  const [leftDesc, setLeftDesc] = useState('');
  const [leftPhotos, setLeftPhotos] = useState('');
  const [dispose, setDispose] = useState<RentalContract | null>(null);
  const [disposeForm, setDisposeForm] = useState({ fee: 0, note: '' });
  const isFM = user?.role === 'FACILITY_MANAGER';
  // Phí xử lý đồ để lại trên ngưỡng duyệt của chi nhánh chỉ Quản lý vận hành lập (server trả 403 DISPOSAL_LIMIT) — chặn ngay ở đây.
  const disposeOverLimit = user?.role !== 'OPS_MANAGER' && disposeForm.fee > CLAIM_FM_APPROVAL_LIMIT;

  const pending = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && c.status === 'MOVE_OUT_PENDING');
  // Khách đến quầy trả kho mà chưa tự đăng ký (VD còn nợ nên app không cho): nhân viên lập đăng ký hộ — đang quá hạn / bị khoá thì quản lý lập.
  const walkInStatuses = user?.role === 'FACILITY_MANAGER' ? ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT'] : ['ACTIVE'];
  const walkInCandidates = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && walkInStatuses.includes(c.status))
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
  // Đồ khách để lại sau trả kho — ô đang giữ (MAINTENANCE) đến hết hạn giữ.
  const held = db.contracts.filter((x) => scope.facilityIds.includes(x.facilityId) && x.leftover?.status === 'HELD')
    .sort((a, b) => a.leftover!.holdUntil.localeCompare(b.leftover!.holdUntil));
  const history = db.inspections.filter((i) => scope.facilityIds.includes(i.facilityId)).sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  const c = active ? db.contracts.find((x) => x._id === active._id) ?? null : null;
  const unit = c ? byId(db.units, c.unitId) : undefined;
  const damageTotal = damages.reduce((s, d) => s + (d.cost || 0), 0);
  // Kiểm soát hai cấp: chi phí hư hại lớn do Quản lý chi nhánh lập biên bản.
  const overStaffLimit = user?.role === 'STAFF' && damageTotal > DAMAGE_STAFF_LIMIT;
  const earlyTermination = c ? earlyTerminationCap(db, c) : null;
  const normalRefund = c ? c.deposit.amount - Math.min(c.deposit.amount, damageTotal + c.balance.outstanding) : 0;
  // Hư hại + công nợ vượt tiền giữ chân: phần chênh thành khoản nợ còn lại sau quyết toán (cùng công thức với server).
  const rawShortfall = c ? Math.max(0, damageTotal + c.balance.outstanding - c.deposit.amount) : 0;
  // Tiền thuê khách trả trước khi gia hạn cho các kỳ chưa bắt đầu: cấn vào phần thiếu trước, còn lại hoàn cho khách (như server). Đợt 16
  // (A1): số khách THỰC TRẢ cho các kỳ đó — phần RENEWAL còn lại + phần SIZE_CHANGE thu thêm khi đổi cỡ (unusedRenewalRefunds, cùng hàm server).
  const unusedRent = c ? unusedRenewalRefunds({
    period: c.billing.rentalPeriod, contract: c, returnedOn: settlementDateOf(c),
    renewals: c.renewals.flatMap((x) => {
      const p = x.paymentId ? db.payments.find((y) => y._id === x.paymentId && ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(y.status)) : undefined;
      // prepaidUntil: gia hạn thuê tháng chỉ trả trước tháng đầu — phần chưa dùng tính theo mốc này (như server).
      return p ? [{ key: p._id, previousEndDate: x.previousEndDate, periods: x.periods, amount: p.amount, refundedAmount: p.refundedAmount ?? 0, prepaidUntil: x.prepaidUntil ?? null }] : [];
    }),
    sizeCharges: db.payments.filter((p) => p.contractId === c._id && p.type === 'SIZE_CHANGE' && ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'PENDING'].includes(p.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ key: p._id, amount: p.amount, refundedAmount: p.refundedAmount ?? 0 })),
  }).total : 0;
  // Đợt 16 (C4): tiền đơn dịch vụ / phí cấp lại bị huỷ lúc nhận lại kho — hoàn trong quyết toán, cùng thứ tự cấn trừ (sau tiền gia hạn).
  const credits = c ? [...db.serviceOrders.filter((o) => o.contractId === c._id).map((o) => ({ o, due: o.total })), ...db.accessRequests.filter((o) => o.contractId === c._id).map((o) => ({ o, due: o.fee }))]
    .filter(({ o }) => o.status === 'CANCELLED' && o.refundAtSettlement && !o.refundPaymentId && o.paymentId).reduce((sum, x) => sum + x.due, 0) : 0;
  const rentOffset = Math.min(unusedRent, rawShortfall);
  const creditOffset = Math.min(credits, rawShortfall - rentOffset);
  const shortfall = rawShortfall - rentOffset - creditOffset;
  const cappedRefund = c ? (earlyTermination ? Math.min(normalRefund, Math.round((c.deposit.amount * earlyTermination.refundCapPct) / 100)) : normalRefund) : 0;
  // Thu hồi ưu đãi thuê dài hạn khi trả sớm — cùng công thức với server (shared), trừ vào phần tiền giữ chân còn lại.
  const rsv = c ? byId(db.reservations, c.reservationId) : undefined;
  const claw = c && c.moveOut ? contractClawback(c, rsv?.quote, db.policies, settlementDateOf(c)) : null;
  const clawback = claw ? Math.min(cappedRefund, claw.amount) : 0;
  const refundAmount = cappedRefund - clawback;
  const refundTotal = refundAmount + unusedRent - rentOffset + credits - creditOffset;

  const start = (x: RentalContract) => {
    setConfirmDone(false); setActive(x); setChecklist(Object.fromEntries(ITEMS.map((i) => [i, 'OK']))); setDamages([]); setPhotoText([]); setNotes('');
    setLeft(null); setLeftDesc(''); setLeftPhotos('');
  };
  const photosOf = (i: number) => (photoText[i] ?? '').split(/[\s,]+/).filter((u) => /^https?:\/\/\S+$/.test(u));
  const leftUrls = urlsOf(leftPhotos);
  const leftOk = left === false || (left === true && leftDesc.trim().length >= 3 && leftUrls.length > 0 && leftUrls.every((u) => HTTPS_RE.test(u)));
  const submit = async () => {
    if (!c || left === null) return;
    const leftItems = left ? { present: true, description: leftDesc.trim(), photoUrls: leftUrls } : { present: false };
    const res = await run('submitInspection', { contractId: c._id, checklist: ITEMS.map((item) => ({ item, condition: checklist[item] ?? 'OK' })), damages: damages.map((d, i) => ({ ...d, photoUrls: photosOf(i) })), notes, leftItems },
      (ins) => `Hoàn tất trả kho — hoàn tiền giữ chân ${vnd(ins.depositSettlement?.refundAmount ?? 0)}${left ? ` · giữ đồ khách ${LEFTOVER_HOLD_DAYS} ngày` : ''}`);
    if (res.ok) { setConfirmDone(false); setActive(null); }
  };
  // Đăng ký trả kho hộ khách tại quầy — đối chiếu đúng khách + mã kho trước khi gửi; bắt buộc lý do (khách được email báo).
  const registerWalkIn = () => {
    const x = byId(db.contracts, walkIn);
    if (!x || !window.confirm(`Đăng ký trả kho hôm nay cho:

Khách: ${userName(db, x.customerId)}
Kho: ${unitLabel(db, x.unitId)} · HĐ ${x.contractNumber}`)) return;
    void run('requestMoveOut', { contractId: x._id, date: todayISO(), reason: walkInReason.trim() }, 'Đã đăng ký trả kho — nhận lại chìa khoá ở danh sách trên', () => { setWalkIn(''); setWalkInReason(''); });
  };
  /** Nhận lại kho: thu hồi quyền vào kho, server tự huỷ + hoàn các đơn / yêu cầu đang mở của hợp đồng. Không rút đăng ký được nữa. */
  const openReceive = (x: RentalContract) => { setRecvMode('SIGN'); setSignerName(userName(db, x.customerId)); setSig(null); setAbsentReason(''); setRecv(x); };
  const openItemsOf = (x: RentalContract) => {
    const orders = db.serviceOrders.filter((o) => o.contractId === x._id && OPEN_SERVICE_ORDER_STATUSES.includes(o.status)).length;
    const access = db.accessRequests.filter((r) => r.contractId === x._id && OPEN_ACCESS_REQUEST_STATUSES.includes(r.status)).length;
    const swaps = db.swapRequests.filter((r) => r.contractId === x._id && OPEN_SWAP_STATUSES.includes(r.status)).length;
    return [orders && `${orders} đơn dịch vụ`, access && `${access} yêu cầu cấp lại thẻ / chìa`, swaps && `${swaps} yêu cầu đổi ô`].filter(Boolean).join(', ');
  };
  const recvOk = recvMode === 'SIGN' ? signerName.trim().length >= 2 && !!sig : isFM && absentReason.trim().length >= 5;
  const receive = () => {
    if (!recv || !recvOk) return;
    const handover = recvMode === 'SIGN'
      ? { method: 'CUSTOMER_SIGNATURE' as const, signerName: signerName.trim(), image: sig! }
      : { method: 'MANAGER_CONFIRM' as const, reason: absentReason.trim() };
    void run('receiveUnit', { contractId: recv._id, handover }, 'Đã nhận lại kho — chuyển sang chờ kiểm tra', () => setRecv(null));
  };
  const pickedUp = (x: RentalContract) => {
    if (!window.confirm(`Khách ${userName(db, x.customerId)} đã lấy hết đồ để lại ở kho ${unitLabel(db, x.unitId)}?`)) return;
    void run('resolveLeftover', { contractId: x._id, outcome: 'PICKED_UP' }, 'Đã ghi nhận khách lấy đồ — ô kho trống lại');
  };
  const withdraw = (x: RentalContract) => {
    if (!window.confirm(`Rút đăng ký trả kho của ${userName(db, x.customerId)} — kho ${unitLabel(db, x.unitId)}?
Hợp đồng tiếp tục và tiếp tục tính tiền thuê.`)) return;
    void run('cancelMoveOut', { contractId: x._id }, 'Đã rút đăng ký trả kho', () => setActive(null));
  };

  // ---- Chỉ để trình bày (không đổi luồng): bước hiện tại, số mục có vấn đề.
  const occupied = unit?.status === 'OCCUPIED';
  const issues = ITEMS.filter((i) => (checklist[i] ?? 'OK') !== 'OK').length;
  const moveSteps: { label: string; icon: ReactNode; state: StepState }[] = [
    { label: 'Nhận lại kho', icon: <KeyRound />, state: occupied ? 'current' : 'done' },
    { label: 'Kiểm tra ô', icon: <ClipboardCheck />, state: occupied ? 'todo' : 'current' },
    { label: 'Quyết toán & đóng HĐ', icon: <Wallet />, state: occupied ? 'todo' : overStaffLimit ? 'blocked' : 'current' },
  ];
  const INSPECTION_TYPE: Record<InspectionLog['type'], string> = { MOVE_IN: 'Nhận kho', MOVE_OUT: 'Trả kho', ROUTINE: 'Định kỳ', MAINTENANCE: 'Bảo trì', ABANDONMENT: 'Hàng bỏ lại' };

  return (
    <>
      <PageHeader title="Trả kho & kiểm tra" actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="self-start">
          <PanelHeader icon={<PackageOpen className="size-4" />} tone="violet" title="Chờ trả kho" count={pending.length} />
          {pending.length === 0 ? <EmptyState compact icon={<PackageOpen className="size-5" />} title="Không có lượt trả kho" /> : (
            <ul className="divide-y divide-stone-100">
              {pending.map((x) => {
                const inspecting = byId(db.units, x.unitId)?.status === 'PENDING_INSPECTION';
                return (
                  <QueueRow key={x._id} active={c?._id === x._id} onSelect={() => start(x)}
                    lead={<UnitTag label={unitLabel(db, x.unitId)} tone={inspecting ? 'violet' : 'amber'} size="sm" />}
                    title={userName(db, x.customerId)}
                    meta={<>
                      <Meta icon={<CalendarDays />}>Hẹn {fmtDate(x.moveOut?.scheduledFor)}</Meta>
                      <Badge tone={inspecting ? 'violet' : 'amber'} dot>{inspecting ? 'Chờ kiểm tra' : 'Chờ nhận chìa'}</Badge>
                    </>}
                  />
                );
              })}
            </ul>
          )}
          <div className="space-y-2.5 border-t border-stone-100 p-4 sm:p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <UserPlus className="size-4 text-stone-400" />Khách đến trả kho chưa đăng ký
              {user?.role === 'STAFF' && <InfoTip align="end">Hợp đồng quá hạn / bị khoá: nhờ quản lý chi nhánh lập.</InfoTip>}
            </p>
            <select className={inputCls} value={walkIn} onChange={(e) => setWalkIn(e.target.value)} aria-label="Hợp đồng">
              <option value="">Chọn hợp đồng…</option>
              {walkInCandidates.map((x) => (
                <option key={x._id} value={x._id}>{unitLabel(db, x.unitId)} · {userName(db, x.customerId)}{x.status === 'DELINQUENT' ? ' · quá hạn' : x.status === 'LOCKED_OUT' ? ' · bị khoá' : ''}</option>
              ))}
            </select>
            {walkIn && <input className={inputCls} maxLength={300} value={walkInReason} onChange={(e) => setWalkInReason(e.target.value)} placeholder="Lý do (bắt buộc)" aria-label="Lý do" />}
            <Button size="sm" className="w-full" disabled={!walkIn || walkInReason.trim().length < 5} onClick={registerWalkIn}>Đăng ký trả kho hôm nay</Button>
          </div>
        </Card>

        {!c ? (
          <Card className="self-start"><EmptyState icon={<ClipboardCheck className="size-6" />} title="Chọn một lượt trả kho" description="Bấm một dòng trong danh sách chờ trả kho." /></Card>
        ) : (
          <Card className="min-w-0">
            <div className="flex flex-wrap items-start gap-3 border-b border-stone-100 p-4 sm:p-5">
              <UnitTag label={unitLabel(db, c.unitId)} size="lg" tone={occupied ? 'amber' : 'violet'} />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-ink">{userName(db, c.customerId)}</h2>
                <ChipRow className="mt-1.5">
                  <Chip icon={<Warehouse />}>{typeName(db, c.unitTypeId)}</Chip>
                  <Chip icon={<FileText />} mono>HĐ {c.contractNumber}</Chip>
                  <Chip icon={<CalendarDays />}>Hẹn {fmtDate(c.moveOut?.scheduledFor)}</Chip>
                  <Chip icon={<Wallet />}>Giữ chân {vnd(c.deposit.amount)}</Chip>
                  {c.balance.outstanding > 0 && <Chip icon={<Banknote />} tone="red">Nợ {vnd(c.balance.outstanding)}</Chip>}
                </ChipRow>
              </div>
            </div>
            <div className="border-b border-stone-100 px-4 py-4 sm:px-5"><StepTrack steps={moveSteps} className="mx-auto max-w-md" /></div>
            <div className="space-y-6 p-4 sm:p-5">
              {occupied ? (
                <Callout tone="amber" icon={<KeyRound />} title="Khách đã dọn đồ và trả chìa / thẻ?"
                  action={<>
                    {!c.access.revokedAt && <Button variant="secondary" onClick={() => withdraw(c)}>Rút đăng ký</Button>}
                    <Button onClick={() => openReceive(c)}><KeyRound className="size-4" />Đã nhận lại kho</Button>
                  </>}>
                  Xác nhận sẽ thu hồi mã truy cập.
                </Callout>
              ) : (
                <div className="space-y-6">
                  <StepBlock n={1} state={issues ? 'blocked' : 'done'} icon={<ClipboardCheck />} title="Danh mục kiểm tra"
                    aside={<Chip tone={issues ? 'red' : 'green'}>{issues ? `${issues} mục có vấn đề` : 'Tất cả tốt'}</Chip>}>
                    <div className="divide-y divide-stone-100 rounded-xl ring-1 ring-inset ring-stone-200">
                      {ITEMS.map((item) => {
                        const v = checklist[item] ?? 'OK';
                        return (
                          <div key={item} className={cx('flex flex-wrap items-center justify-between gap-2 px-3 py-2', v !== 'OK' && 'bg-red-50/60')}>
                            <span className="flex items-center gap-2 text-sm">
                              {v === 'OK' ? <CircleCheck className="size-4 shrink-0 text-emerald-500" /> : <TriangleAlert className="size-4 shrink-0 text-red-500" />}{item}
                            </span>
                            <Segmented<ItemCondition> label={item} value={checklist[item] ?? null} onChange={(nv) => setChecklist((s) => ({ ...s, [item]: nv }))}
                              options={COND.map((o) => ({ value: o.v, label: o.label, tone: o.v === 'OK' ? 'green' : 'red' }))} />
                          </div>
                        );
                      })}
                    </div>
                  </StepBlock>

                  <StepBlock n={2} state={damages.some((d) => !d.description.trim()) ? 'current' : 'done'} icon={<Hammer />} title="Hư hại & chi phí"
                    aside={<>
                      {damageTotal > 0 && <Chip tone="red">{vnd(damageTotal)}</Chip>}
                      <Button size="sm" variant="secondary" onClick={() => { setDamages((d) => [...d, { description: '', severity: 'MINOR', cost: 0, photoUrls: [] }]); setPhotoText((p) => [...p, '']); }}><Plus className="size-3.5" />Thêm</Button>
                    </>}>
                    {damages.length === 0 && <p className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-sm text-stone-500 ring-1 ring-inset ring-stone-200"><CircleCheck className="size-4 text-emerald-500" />Không ghi nhận hư hại.</p>}
                    <div className="space-y-2">
                      {damages.map((d, i) => (
                        <div key={i} className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                          <div className="flex items-center gap-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-red-100 text-xs font-bold text-red-700">{i + 1}</span>
                            <input className={cx(inputCls, 'flex-1')} placeholder="Mô tả hư hại" value={d.description} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                            <Button variant="ghost" size="sm" onClick={() => { setDamages((arr) => arr.filter((_, j) => j !== i)); setPhotoText((arr) => arr.filter((_, j) => j !== i)); }} aria-label="Xóa"><Trash2 className="size-4" /></Button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select className={inputCls} aria-label="Mức độ" value={d.severity} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, severity: e.target.value as Damage['severity'] } : x)))}>
                              <option value="MINOR">Nhẹ</option><option value="MODERATE">Vừa</option><option value="SEVERE">Nặng (cần bảo trì)</option>
                            </select>
                            <input className={inputCls} type="number" min={0} step={10000} placeholder="Chi phí" aria-label="Chi phí" value={d.cost || ''} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, cost: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} />
                          </div>
                          <input className={inputCls} placeholder="Link ảnh hiện trạng (https://…), nhiều ảnh cách nhau dấu phẩy — khách xem được trong biên bản"
                            aria-label="Link ảnh hiện trạng" value={photoText[i] ?? ''} onChange={(e) => setPhotoText((arr) => { const next = [...arr]; next[i] = e.target.value; return next; })} />
                        </div>
                      ))}
                    </div>
                    <textarea className={cx(inputCls, 'mt-3')} rows={2} placeholder="Ghi chú thêm" aria-label="Ghi chú thêm" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </StepBlock>

                  <StepBlock n={3} state={left !== null && leftOk ? 'done' : 'current'} icon={<Package />} title="Đồ khách để lại"
                    aside={<Segmented<boolean> label="Đồ khách để lại" value={left} onChange={setLeft} options={[{ value: false, label: 'Không', tone: 'green' }, { value: true, label: 'Có', tone: 'amber' }]} />}>
                    {left === null && <p className="text-xs text-stone-500">Chọn “Không” hoặc “Có” — bắt buộc khai.</p>}
                    <Disclosure variant="plain" icon={<PackageOpen className="size-4" />} title="Đồ khách đã khai — đối chiếu" className="mb-2">
                      <GoodsReference contractId={c._id} />
                    </Disclosure>
                    {left && (
                      <div className="space-y-2">
                        <input className={inputCls} maxLength={500} placeholder="Mô tả đồ để lại" aria-label="Mô tả đồ để lại" value={leftDesc} onChange={(e) => setLeftDesc(e.target.value)} />
                        <input className={inputCls} placeholder="Link ảnh (https://…), cách nhau dấu phẩy" aria-label="Link ảnh đồ để lại" value={leftPhotos} onChange={(e) => setLeftPhotos(e.target.value)} />
                        <Callout tone="amber" icon={<Timer />}>Ô giữ đồ {LEFTOVER_HOLD_DAYS} ngày, chưa cho thuê lại.</Callout>
                      </div>
                    )}
                  </StepBlock>

                  <StepBlock n={4} state={overStaffLimit ? 'blocked' : 'current'} icon={<Wallet />} title="Quyết toán tiền giữ chân">
                    <Ledger>
                      <LedgerRow label="Tiền giữ chân đang giữ" value={vnd(c.deposit.amount)} />
                      <LedgerRow label="Chi phí hư hại" tone={damageTotal > 0 ? 'bad' : 'default'} value={`−${vnd(damageTotal)}`} />
                      {c.balance.outstanding > 0 && <LedgerRow label="Công nợ còn lại" tone="bad" value={`−${vnd(c.balance.outstanding)}`} />}
                      {shortfall > 0 && <LedgerRow label="Vượt tiền giữ chân — còn nợ" tip="Hư hại + công nợ vượt tiền giữ chân: khách còn nợ phần chênh sau quyết toán." tone="bad" value={vnd(shortfall)} />}
                      {earlyTermination && (
                        <LedgerRow label="Trả kho sớm" tone="warn" tip={`Bàn giao ${fmtDate(settlementDateOf(c))}, đã dùng ${earlyTermination.elapsedPct}% kỳ hạn.`} value={`trần ${earlyTermination.refundCapPct}% tiền giữ chân`} />
                      )}
                      {claw && <LedgerRow label="Thu hồi ưu đãi thuê dài hạn" tone="warn" tip={`Mới dùng ${claw.usedPeriods} tháng.`} value={`−${vnd(clawback)}`} />}
                      {unusedRent > 0 && (
                        <LedgerRow label="Tiền thuê trả trước chưa dùng" tone="good" value={`+${vnd(unusedRent - rentOffset)}`}
                          tip={`Tiền thuê trả trước của các kỳ gia hạn chưa dùng (gồm phần chênh đổi cỡ kho đã trả)${rentOffset > 0 ? ` (cấn ${vnd(rentOffset)} vào phần vượt tiền giữ chân)` : ''}.`} />
                      )}
                      {credits > 0 && (
                        <LedgerRow label="Dịch vụ / phí cấp lại đã huỷ" tone="good" value={`+${vnd(credits - creditOffset)}`}
                          tip={`Tiền đơn dịch vụ chưa làm / phí cấp lại thẻ, chìa bị huỷ khi nhận lại kho${creditOffset > 0 ? ` (cấn ${vnd(creditOffset)} vào phần vượt tiền giữ chân)` : ''}.`} />
                      )}
                      <LedgerRow total label="Hoàn lại khách" value={vnd(refundTotal)} />
                    </Ledger>
                    {shortfall > 0 && <Callout tone="amber" icon={<Banknote />} className="mt-3">Chi phí vượt tiền giữ chân — phần chênh lệch cần thu thêm từ khách.</Callout>}
                  </StepBlock>

                  <ActionBar note={overStaffLimit && <Callout tone="amber" icon={<ShieldAlert />}>Chi phí hư hại trên {vnd(DAMAGE_STAFF_LIMIT)} cần Quản lý chi nhánh lập biên bản — báo quản lý hoàn tất trả kho này.</Callout>}>
                    <Button variant="secondary" onClick={() => setActive(null)}>Để sau</Button>
                    <Button onClick={() => setConfirmDone(true)} disabled={damages.some((d) => !d.description.trim()) || overStaffLimit || !leftOk}><CircleCheck className="size-4" />Hoàn tất & đóng hợp đồng</Button>
                  </ActionBar>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <Modal open={confirmDone && !!c} onClose={() => setConfirmDone(false)} title="Hoàn tất trả kho & đóng hợp đồng"
        description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}` : ''}
        footer={<><Button variant="secondary" onClick={() => setConfirmDone(false)}>Quay lại</Button><Button onClick={() => void submit()}>Xác nhận đóng hợp đồng</Button></>}>
        <div className="space-y-4 text-sm">
          <FactGrid>
            <Fact icon={<Hammer className="size-4" />} label="Chi phí hư hại" tone={damageTotal > 0 ? 'red' : 'gray'}>{vnd(damageTotal)}</Fact>
            <Fact icon={<Banknote className="size-4" />} label="Công nợ trừ vào quyết toán">{vnd(c?.balance.outstanding ?? 0)}</Fact>
            <Fact icon={<Wallet className="size-4" />} label="Hoàn lại khách" tone="green">{vnd(refundTotal)}</Fact>
            <Fact icon={<TriangleAlert className="size-4" />} label="Khách còn nợ" tone={shortfall > 0 ? 'red' : 'gray'}>{shortfall > 0 ? vnd(shortfall) : 'Không'}</Fact>
            <Fact icon={<Package className="size-4" />} label="Đồ khách để lại" tone={left ? 'amber' : 'gray'}>{left ? `Có — giữ ${LEFTOVER_HOLD_DAYS} ngày` : 'Không'}</Fact>
          </FactGrid>
          <Callout tone="amber" icon={<TriangleAlert />}>Không hoàn tác được — sai thì chỉ điều chỉnh khi khách khiếu nại.</Callout>
        </div>
      </Modal>

      <Modal open={!!recv} onClose={() => setRecv(null)} title="Nhận lại kho"
        description={recv ? `${userName(db, recv.customerId)} · kho ${unitLabel(db, recv.unitId)} · HĐ ${recv.contractNumber}` : ''}
        footer={<><Button variant="secondary" onClick={() => setRecv(null)}>Quay lại</Button><Button disabled={!recvOk} onClick={receive}>Xác nhận nhận lại kho</Button></>}>
        {recv && (
          <div className="space-y-4 text-sm">
            <ul className="space-y-2 text-stone-700">
              <li className="flex items-center gap-2.5"><IconTile icon={<LockKeyhole className="size-4" />} tone="red" size="sm" />Thu hồi quyền vào kho của khách.</li>
              <li className="flex items-center gap-2.5"><IconTile icon={<Undo2 className="size-4" />} tone="amber" size="sm" />Tự huỷ và hoàn tiền đơn / yêu cầu đang mở{openItemsOf(recv) ? ` (${openItemsOf(recv)})` : ''}.</li>
              <li className="flex items-center gap-2.5"><IconTile icon={<Ban className="size-4" />} tone="gray" size="sm" />Không rút đăng ký trả kho được nữa.</li>
            </ul>
            {isFM && (
              <Segmented<'SIGN' | 'ABSENT'> label="Cách nhận lại" value={recvMode} onChange={setRecvMode}
                options={[{ value: 'SIGN', label: 'Khách ký nhận', icon: <PenLine /> }, { value: 'ABSENT', label: 'Khách vắng mặt', icon: <UserX /> }]} />
            )}
            {recvMode === 'SIGN' ? (
              <>
                <Field label="Họ tên người ký"><input className={inputCls} maxLength={100} value={signerName} onChange={(e) => setSignerName(e.target.value)} /></Field>
                <SignaturePad onChange={setSig} />
              </>
            ) : (
              <Field label="Lý do khách vắng mặt">
                <textarea className={inputCls} rows={2} maxLength={300} value={absentReason} onChange={(e) => setAbsentReason(e.target.value)} placeholder="VD: khách gửi chìa qua bảo vệ, đã gọi xác nhận" />
              </Field>
            )}
          </div>
        )}
      </Modal>

      {held.length > 0 && (
        <Card className="mt-6">
          <PanelHeader icon={<Package className="size-4" />} tone="amber" title="Đồ đang giữ" count={held.length} tip={`Đồ khách để lại sau trả kho — ô giữ ${LEFTOVER_HOLD_DAYS} ngày, chưa cho thuê lại.`} />
          <ul className="divide-y divide-stone-100">
            {held.map((x) => {
              const due = todayISO().slice(0, 10) >= x.leftover!.holdUntil.slice(0, 10);
              return (
                <QueueRow key={x._id}
                  lead={<UnitTag label={unitLabel(db, x.unitId)} tone="amber" size="sm" />}
                  title={x.leftover!.description}
                  meta={<>
                    <Meta icon={<UserRound />}>{userName(db, x.customerId)}</Meta>
                    <Meta icon={<Timer />} className={due ? 'font-medium text-red-700' : undefined}>Giữ đến {fmtDate(x.leftover!.holdUntil)}</Meta>
                    {x.leftover!.photoUrls.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><ImageIcon className="size-3.5" />Ảnh {i + 1}</a>)}
                  </>}
                  actions={<>
                    <Button size="sm" variant="secondary" onClick={() => pickedUp(x)}><Package className="size-3.5" />Khách đã lấy</Button>
                    {isFM && todayISO().slice(0, 10) >= x.leftover!.holdUntil.slice(0, 10) && (
                      <Button size="sm" variant="danger" onClick={() => { setDisposeForm({ fee: 0, note: '' }); setDispose(x); }}>Đã xử lý</Button>
                    )}
                  </>}
                />
              );
            })}
          </ul>
        </Card>
      )}

      <Modal open={!!dispose} onClose={() => setDispose(null)} title="Xử lý đồ khách để lại"
        description={dispose ? `${userName(db, dispose.customerId)} · kho ${unitLabel(db, dispose.unitId)} · giữ đến ${fmtDate(dispose.leftover?.holdUntil)}` : ''}
        footer={<Button variant="danger" disabled={disposeForm.note.trim().length < 3 || disposeOverLimit || disposeForm.fee > LEFTOVER_FEE_MAX}
          onClick={() => dispose && void run('resolveLeftover', { contractId: dispose._id, outcome: 'DISPOSED', fee: disposeForm.fee, note: disposeForm.note.trim() },
            disposeForm.fee > 0 ? `Đã xử lý — ghi phí ${vnd(disposeForm.fee)} vào công nợ khách` : 'Đã xử lý đồ để lại — ô kho trống lại', () => setDispose(null))}>Xác nhận</Button>}>
        <div className="space-y-4">
          <Field label="Phí xử lý (VND)" hint="Điều 9 · 0 nếu không thu">
            <input type="number" min={0} step={10_000} className={inputCls} value={disposeForm.fee}
              onChange={(e) => setDisposeForm((f) => ({ ...f, fee: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
          </Field>
          {disposeOverLimit && (
            <Callout tone="amber" icon={<ShieldAlert />}>
              Phí trên {vnd(CLAIM_FM_APPROVAL_LIMIT)} — cần Quản lý vận hành xử lý (mục Duyệt & chi). Giảm phí hoặc chuyển cho vận hành.
            </Callout>
          )}
          {disposeForm.fee > LEFTOVER_FEE_MAX && <p className="text-xs font-medium text-red-700">Phí xử lý tối đa {vnd(LEFTOVER_FEE_MAX)}.</p>}
          <Field label="Cách xử lý">
            <textarea className={inputCls} rows={2} maxLength={500} value={disposeForm.note} onChange={(e) => setDisposeForm((f) => ({ ...f, note: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <Disclosure className="mt-6 shadow-card" icon={<History className="size-4" />} title="Lịch sử kiểm tra" meta={`${history.length} lượt`}>
        <div className="-mx-4 -mb-4 overflow-hidden rounded-b-xl border-t border-stone-100">
          <Table rows={history} rowKey={(i) => i._id} empty={<EmptyState compact icon={<History className="size-5" />} title="Chưa có lượt kiểm tra" />} columns={[
            { key: 't', header: 'Thời gian', cell: (i) => <span className="whitespace-nowrap">{fmtDateTime(i.performedAt)}</span> },
            { key: 'u', header: 'Kho', cell: (i) => <span className="font-semibold">{unitLabel(db, i.unitId)}</span> },
            { key: 'k', header: 'Loại', cell: (i) => <Badge>{INSPECTION_TYPE[i.type]}</Badge> },
            { key: 'by', header: 'Người kiểm tra', cell: (i) => userName(db, i.inspectorId) },
            { key: 'o', header: 'Kết quả', cell: (i) => (i.outcome ? <StatusBadge map={INSPECTION_OUTCOME} value={i.outcome} /> : '—') },
            { key: 'f', header: 'Hư hại', className: 'text-right tabular-nums', cell: (i) => vnd(i.totalDamageFee) },
            { key: 'r', header: 'Hoàn tiền giữ chân', className: 'text-right tabular-nums', cell: (i) => (i.depositSettlement ? vnd(i.depositSettlement.refundAmount) : '—') },
          ]} />
        </div>
      </Disclosure>
    </>
  );
}
