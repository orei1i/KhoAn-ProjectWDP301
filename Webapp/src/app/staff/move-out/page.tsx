'use client';

import { useState } from 'react';
import { ClipboardCheck, KeyRound, Plus, Trash2 } from 'lucide-react';
import type { InspectionLog, ItemCondition, RentalContract } from '@ssm/shared';
import { contractClawback, DAMAGE_STAFF_LIMIT, OPEN_ACCESS_REQUEST_STATUSES, OPEN_SERVICE_ORDER_STATUSES, OPEN_SWAP_STATUSES, unusedPrepaidRent } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { INSPECTION_OUTCOME } from '@/shared/lib/labels';
import { byId, earlyTerminationCap, settlementDateOf, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, KV, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

const ITEMS = ['Cửa cuốn / cửa kho', 'Ổ khóa', 'Sàn', 'Tường & vách ngăn', 'Trần / chống thấm', 'Vệ sinh chung'];
const COND: { v: ItemCondition; label: string }[] = [{ v: 'OK', label: 'Tốt' }, { v: 'DAMAGED', label: 'Hư hại' }, { v: 'MISSING', label: 'Thiếu' }];
type Damage = InspectionLog['damages'][number];

export default function MoveOutPage() {
  const { db, user, run } = useStore();
  const scope = useFacilityScope();
  const [active, setActive] = useState<RentalContract | null>(null);
  const [checklist, setChecklist] = useState<Record<string, ItemCondition>>({});
  const [damages, setDamages] = useState<Damage[]>([]);
  const [notes, setNotes] = useState('');
  const [photoText, setPhotoText] = useState<string[]>([]); // link ảnh của từng hư hại, cách nhau dấu phẩy / xuống dòng
  const [walkIn, setWalkIn] = useState('');
  const [confirmDone, setConfirmDone] = useState(false); // hộp xác nhận trước khi đóng hợp đồng

  const pending = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && c.status === 'MOVE_OUT_PENDING');
  // Khách đến quầy trả kho mà chưa tự đăng ký (VD còn nợ nên app không cho): nhân viên lập đăng ký hộ — đang quá hạn / bị khoá thì quản lý lập.
  const walkInStatuses = user?.role === 'FACILITY_MANAGER' ? ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT'] : ['ACTIVE'];
  const walkInCandidates = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId) && walkInStatuses.includes(c.status))
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
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
  // Tiền thuê khách trả trước khi gia hạn cho các kỳ chưa bắt đầu: cấn vào phần thiếu trước, còn lại hoàn cho khách (như server).
  const unusedRent = c ? unusedPrepaidRent(c.billing.rentalPeriod, c.renewals.flatMap((x) => {
    const p = x.paymentId ? db.payments.find((y) => y._id === x.paymentId) : undefined;
    return p ? [{ key: p._id, previousEndDate: x.previousEndDate, periods: x.periods, amount: p.amount }] : [];
  }), settlementDateOf(c)).total : 0;
  const rentOffset = Math.min(unusedRent, rawShortfall);
  const shortfall = rawShortfall - rentOffset;
  const cappedRefund = c ? (earlyTermination ? Math.min(normalRefund, Math.round((c.deposit.amount * earlyTermination.refundCapPct) / 100)) : normalRefund) : 0;
  // Thu hồi ưu đãi thuê dài hạn khi trả sớm — cùng công thức với server (shared), trừ vào phần tiền giữ chân còn lại.
  const rsv = c ? byId(db.reservations, c.reservationId) : undefined;
  const claw = c && c.moveOut ? contractClawback(c, rsv?.quote, db.policies, settlementDateOf(c)) : null;
  const clawback = claw ? Math.min(cappedRefund, claw.amount) : 0;
  const refundAmount = cappedRefund - clawback;
  const refundTotal = refundAmount + unusedRent - rentOffset;

  const start = (x: RentalContract) => { setConfirmDone(false); setActive(x); setChecklist(Object.fromEntries(ITEMS.map((i) => [i, 'OK']))); setDamages([]); setPhotoText([]); setNotes(''); };
  const photosOf = (i: number) => (photoText[i] ?? '').split(/[\s,]+/).filter((u) => /^https?:\/\/\S+$/.test(u));
  const submit = async () => {
    if (!c) return;
    const res = await run('submitInspection', { contractId: c._id, checklist: ITEMS.map((item) => ({ item, condition: checklist[item] ?? 'OK' })), damages: damages.map((d, i) => ({ ...d, photoUrls: photosOf(i) })), notes }, (ins) => `Hoàn tất trả kho — hoàn tiền giữ chân ${vnd(ins.depositSettlement?.refundAmount ?? 0)}`);
    if (res.ok) { setConfirmDone(false); setActive(null); }
  };
  // Đăng ký trả kho hộ khách tại quầy — đối chiếu đúng khách + mã kho trước khi gửi.
  const registerWalkIn = () => {
    const x = byId(db.contracts, walkIn);
    if (!x || !window.confirm(`Đăng ký trả kho hôm nay cho:

Khách: ${userName(db, x.customerId)}
Kho: ${unitLabel(db, x.unitId)} · HĐ ${x.contractNumber}`)) return;
    void run('requestMoveOut', { contractId: x._id, date: todayISO() }, 'Đã đăng ký trả kho — nhận lại chìa khoá ở danh sách trên', () => setWalkIn(''));
  };
  /** Nhận lại kho: thu hồi quyền vào kho, server tự huỷ + hoàn các đơn / yêu cầu đang mở của hợp đồng. Không rút đăng ký được nữa. */
  const receive = (x: RentalContract) => {
    const orders = db.serviceOrders.filter((o) => o.contractId === x._id && OPEN_SERVICE_ORDER_STATUSES.includes(o.status)).length;
    const access = db.accessRequests.filter((r) => r.contractId === x._id && OPEN_ACCESS_REQUEST_STATUSES.includes(r.status)).length;
    const swaps = db.swapRequests.filter((r) => r.contractId === x._id && OPEN_SWAP_STATUSES.includes(r.status)).length;
    const open = [orders && `${orders} đơn dịch vụ`, access && `${access} yêu cầu cấp lại mã / thẻ / chìa`, swaps && `${swaps} yêu cầu đổi ô`].filter(Boolean).join(', ');
    if (!window.confirm(`Đã nhận lại kho ${unitLabel(db, x.unitId)} của ${userName(db, x.customerId)}?

• Thu hồi quyền vào kho của khách.
• Tự huỷ và hoàn tiền đơn dịch vụ, yêu cầu cấp lại, yêu cầu đổi ô đang mở${open ? ` (${open})` : ''}.
• Không rút đăng ký trả kho được nữa.`)) return;
    void run('receiveUnit', { contractId: x._id }, 'Đã nhận lại kho — chuyển sang chờ kiểm tra');
  };
  const withdraw = (x: RentalContract) => {
    if (!window.confirm(`Rút đăng ký trả kho của ${userName(db, x.customerId)} — kho ${unitLabel(db, x.unitId)}?
Hợp đồng tiếp tục và tiếp tục tính tiền thuê.`)) return;
    void run('cancelMoveOut', { contractId: x._id }, 'Đã rút đăng ký trả kho', () => setActive(null));
  };

  return (
    <>
      <PageHeader title="Trả kho & kiểm tra" description="Nhận lại chìa khóa, kiểm tra hiện trạng, ghi nhận hư hại và quyết toán tiền giữ chân." actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader title="Chờ trả kho" />
          {pending.length === 0 ? <EmptyState title="Không có lượt trả kho" /> : (
            <ul className="divide-y divide-stone-100">
              {pending.map((x) => {
                const u = byId(db.units, x.unitId);
                return (
                  <li key={x._id}>
                    <button onClick={() => start(x)} className={cx('w-full px-5 py-3.5 text-left hover:bg-stone-50', c?._id === x._id && 'bg-brand-50')}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{unitLabel(db, x.unitId)}</p>
                        <Badge tone={u?.status === 'PENDING_INSPECTION' ? 'violet' : 'amber'}>{u?.status === 'PENDING_INSPECTION' ? 'Chờ kiểm tra' : 'Chờ nhận chìa'}</Badge>
                      </div>
                      <p className="text-xs text-stone-500">{userName(db, x.customerId)} · hẹn {fmtDate(x.moveOut?.scheduledFor)}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="space-y-2 border-t border-stone-100 p-5">
            <p className="text-sm font-semibold">Khách đến trả kho chưa đăng ký</p>
            <p className="text-xs text-stone-500">Lập đăng ký trả kho hộ khách tại quầy (ngày hôm nay), rồi nhận lại chìa khoá ở danh sách trên.{user?.role === 'STAFF' ? ' Hợp đồng đang quá hạn / bị khoá: nhờ quản lý chi nhánh lập.' : ''}</p>
            <select className={inputCls} value={walkIn} onChange={(e) => setWalkIn(e.target.value)}>
              <option value="">Chọn hợp đồng…</option>
              {walkInCandidates.map((x) => (
                <option key={x._id} value={x._id}>{unitLabel(db, x.unitId)} · {userName(db, x.customerId)}{x.status === 'DELINQUENT' ? ' · quá hạn' : x.status === 'LOCKED_OUT' ? ' · bị khoá' : ''}</option>
              ))}
            </select>
            <Button size="sm" disabled={!walkIn} onClick={registerWalkIn}>Đăng ký trả kho hôm nay</Button>
          </div>
        </Card>

        {!c ? (
          <Card><EmptyState icon={<ClipboardCheck className="size-6" />} title="Chọn một lượt trả kho" description="Bước 1: nhận lại chìa khóa / thu hồi mã. Bước 2: kiểm tra và quyết toán tiền giữ chân." /></Card>
        ) : (
          <Card>
            <CardHeader title={`Kho ${unitLabel(db, c.unitId)} · ${typeName(db, c.unitTypeId)}`} description={`${userName(db, c.customerId)} · HĐ ${c.contractNumber}`} />
            <div className="space-y-6 p-5">
              {unit?.status === 'OCCUPIED' ? (
                <div className="flex flex-wrap items-center gap-4 rounded-lg bg-amber-50 p-4">
                  <KeyRound className="size-5 text-amber-700" />
                  <p className="flex-1 text-sm text-amber-900">Bước 1 — xác nhận khách đã dọn đồ và bàn giao chìa khóa / thẻ. Mã truy cập sẽ bị thu hồi.</p>
                  <div className="flex flex-wrap gap-2">
                    {!c.access.revokedAt && <Button variant="secondary" onClick={() => withdraw(c)}>Rút đăng ký</Button>}
                    <Button onClick={() => receive(c)}>Đã nhận lại kho</Button>
                  </div>
                </div>
              ) : (
                <>
                  <section>
                    <h4 className="mb-3 text-sm font-semibold">Bước 2 — Danh mục kiểm tra</h4>
                    <div className="divide-y divide-stone-100 rounded-lg ring-1 ring-stone-200">
                      {ITEMS.map((item) => (
                        <div key={item} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                          <span className="text-sm">{item}</span>
                          <div className="flex gap-1">
                            {COND.map((o) => (
                              <button key={o.v} type="button" onClick={() => setChecklist((s) => ({ ...s, [item]: o.v }))}
                                className={cx('rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset', checklist[item] === o.v ? (o.v === 'OK' ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-red-600 text-white ring-red-600') : 'ring-stone-300')}>
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Hư hại & chi phí</h4>
                      <Button size="sm" variant="secondary" onClick={() => { setDamages((d) => [...d, { description: '', severity: 'MINOR', cost: 0, photoUrls: [] }]); setPhotoText((p) => [...p, '']); }}><Plus className="size-3.5" />Thêm</Button>
                    </div>
                    {damages.length === 0 && <p className="text-sm text-stone-500">Không ghi nhận hư hại.</p>}
                    <div className="space-y-2">
                      {damages.map((d, i) => (
                        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_130px_140px_auto]">
                          <input className={inputCls} placeholder="Mô tả hư hại" value={d.description} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                          <select className={inputCls} value={d.severity} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, severity: e.target.value as Damage['severity'] } : x)))}>
                            <option value="MINOR">Nhẹ</option><option value="MODERATE">Vừa</option><option value="SEVERE">Nặng (cần bảo trì)</option>
                          </select>
                          <input className={inputCls} type="number" min={0} step={10000} placeholder="Chi phí" value={d.cost || ''} onChange={(e) => setDamages((arr) => arr.map((x, j) => (j === i ? { ...x, cost: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} />
                          <Button variant="ghost" size="sm" onClick={() => { setDamages((arr) => arr.filter((_, j) => j !== i)); setPhotoText((arr) => arr.filter((_, j) => j !== i)); }} aria-label="Xóa"><Trash2 className="size-4" /></Button>
                          <input className={cx(inputCls, 'sm:col-span-4')} placeholder="Link ảnh hiện trạng (https://…), nhiều ảnh cách nhau dấu phẩy — khách xem được trong biên bản"
                            value={photoText[i] ?? ''} onChange={(e) => setPhotoText((arr) => { const next = [...arr]; next[i] = e.target.value; return next; })} />
                        </div>
                      ))}
                    </div>
                    <textarea className={cx(inputCls, 'mt-3')} rows={2} placeholder="Ghi chú thêm" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </section>

                  <section className="rounded-lg bg-stone-50 p-4 text-sm">
                    <h4 className="mb-2 font-semibold">Quyết toán tiền giữ chân</h4>
                    <dl className="space-y-1.5">
                      <div className="flex justify-between"><dt className="text-stone-500">Tiền giữ chân đang giữ</dt><dd className="tabular-nums">{vnd(c.deposit.amount)}</dd></div>
                      <div className="flex justify-between"><dt className="text-stone-500">Chi phí hư hại</dt><dd className="tabular-nums">−{vnd(damageTotal)}</dd></div>
                      {c.balance.outstanding > 0 && <div className="flex justify-between"><dt className="text-stone-500">Công nợ còn lại</dt><dd className="tabular-nums">−{vnd(c.balance.outstanding)}</dd></div>}
                      {shortfall > 0 && (
                        <div className="flex justify-between font-medium text-red-700">
                          <dt>Vượt tiền giữ chân — khách còn nợ sau quyết toán</dt>
                          <dd className="tabular-nums">{vnd(shortfall)}</dd>
                        </div>
                      )}
                      {earlyTermination && (
                        <div className="flex justify-between text-amber-800">
                          <dt>Trả kho sớm — bàn giao {fmtDate(settlementDateOf(c))}, đã dùng {earlyTermination.elapsedPct}% kỳ hạn</dt>
                          <dd className="tabular-nums">trần {earlyTermination.refundCapPct}% tiền giữ chân</dd>
                        </div>
                      )}
                      {claw && (
                        <div className="flex justify-between text-amber-800">
                          <dt>Thu hồi ưu đãi thuê dài hạn (mới dùng {claw.usedPeriods} tháng)</dt>
                          <dd className="tabular-nums">−{vnd(clawback)}</dd>
                        </div>
                      )}
                      {unusedRent > 0 && (
                        <div className="flex justify-between text-emerald-800">
                          <dt>Tiền thuê trả trước của các kỳ gia hạn chưa dùng{rentOffset > 0 ? ` (cấn ${vnd(rentOffset)} vào phần vượt tiền giữ chân)` : ''}</dt>
                          <dd className="tabular-nums">+{vnd(unusedRent - rentOffset)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-stone-200 pt-1.5 font-semibold"><dt>Hoàn lại khách</dt><dd className="tabular-nums">{vnd(refundTotal)}</dd></div>
                    </dl>
                    {shortfall > 0 && <p className="mt-2 text-xs text-amber-800">Chi phí vượt tiền giữ chân — phần chênh lệch cần thu thêm từ khách.</p>}
                  </section>
                  {overStaffLimit && <p className="text-right text-xs text-amber-800">Chi phí hư hại trên {vnd(DAMAGE_STAFF_LIMIT)} cần Quản lý chi nhánh lập biên bản — báo quản lý hoàn tất trả kho này.</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setActive(null)}>Để sau</Button>
                    <Button onClick={() => setConfirmDone(true)} disabled={damages.some((d) => !d.description.trim()) || overStaffLimit}>Hoàn tất & đóng hợp đồng</Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        )}
      </div>

      <Modal open={confirmDone && !!c} onClose={() => setConfirmDone(false)} title="Hoàn tất trả kho & đóng hợp đồng"
        description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}` : ''}
        footer={<><Button variant="secondary" onClick={() => setConfirmDone(false)}>Quay lại</Button><Button onClick={() => void submit()}>Xác nhận đóng hợp đồng</Button></>}>
        <div className="space-y-4 text-sm">
          <KV items={[
            ['Chi phí hư hại', vnd(damageTotal)], ['Công nợ trừ vào quyết toán', vnd(c?.balance.outstanding ?? 0)],
            ['Hoàn lại khách', vnd(refundTotal)], ['Khách còn nợ', shortfall > 0 ? vnd(shortfall) : 'Không'],
          ]} />
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">Không hoàn tác được — sai thì chỉ điều chỉnh khi khách khiếu nại.</p>
        </div>
      </Modal>

      <Card className="mt-6">
        <CardHeader title="Lịch sử kiểm tra" />
        <Table rows={history} rowKey={(i) => i._id} columns={[
          { key: 't', header: 'Thời gian', cell: (i) => fmtDateTime(i.performedAt) },
          { key: 'u', header: 'Kho', cell: (i) => unitLabel(db, i.unitId) },
          { key: 'k', header: 'Loại', cell: (i) => ({ MOVE_IN: 'Nhận kho', MOVE_OUT: 'Trả kho', ROUTINE: 'Định kỳ', MAINTENANCE: 'Bảo trì', ABANDONMENT: 'Hàng bỏ lại' })[i.type] },
          { key: 'by', header: 'Người kiểm tra', cell: (i) => userName(db, i.inspectorId) },
          { key: 'o', header: 'Kết quả', cell: (i) => (i.outcome ? <StatusBadge map={INSPECTION_OUTCOME} value={i.outcome} /> : '—') },
          { key: 'f', header: 'Hư hại', className: 'text-right tabular-nums', cell: (i) => vnd(i.totalDamageFee) },
          { key: 'r', header: 'Hoàn tiền giữ chân', className: 'text-right tabular-nums', cell: (i) => (i.depositSettlement ? vnd(i.depositSettlement.refundAmount) : '—') },
        ]} />
      </Card>
    </>
  );
}
