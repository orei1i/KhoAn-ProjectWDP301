'use client';

import { useState } from 'react';
import { ArrowRight, Banknote, Building2, CalendarDays, CircleCheck, Clock, Gift, Hand, KeyRound, MessageSquareText, Repeat, Ruler, Timer, TriangleAlert, Truck, UserRound, Warehouse } from 'lucide-react';
import { defaultSwapFee, isFreeSwap, sizeChangeNote, SWAP_FEE_MAX, type UnitSwapRequest } from '@ssm/shared';
import type { SwapCompleteSizeChange } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, CHECK_IN_SHIFT, SWAP_METHOD, SWAP_REQUEST_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { Callout, CheckLine, Fact, FactGrid, Meta, QueueRow, UnitTag } from '@/features/staff-ui';

type Tab = 'pending' | 'approved' | 'done';

/** Đợt 15 (C3): yêu cầu đổi sang LOẠI kho khác = đổi cỡ kho (có báo giá + phụ lục khách đã xác nhận). */
const isResize = (s: UnitSwapRequest) => !!s.sizeChange || (!!s.toUnitTypeId && s.toUnitTypeId !== s.unitTypeId);
/** Câu báo sau khi xác nhận đổi cỡ: phần chênh tiền thuê / tiền giữ chân đã ghi. */
const resizeDoneText = (x: SwapCompleteSizeChange) => {
  const part = (n: number, more: string, back: string) => (n > 0 ? `${more} ${vnd(n)}` : n < 0 ? `${back} ${vnd(-n)}` : '');
  const bits = [part(x.rentDiff, 'thu thêm tiền thuê', 'hoàn tiền thuê'), part(x.depositDiff, 'thu thêm tiền giữ chân', 'hoàn tiền giữ chân')].filter(Boolean);
  return `Đã đổi cỡ kho — giá mới ${vnd(x.rate)}, Phụ lục số ${String(x.appendixNumber).padStart(2, '0')}${bits.length ? ` · ${bits.join(', ')}` : ''}`;
};
type Dialog = { kind: 'decide' | 'complete' | 'assign'; s: UnitSwapRequest } | null;

/** Ô cũ → ô mới, nhìn là biết đổi gì. */
function SwapUnits({ from, to }: { from: string; to: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-label={`${from} sang ${to}`}>
      <UnitTag label={from} tone="gray" size="sm" />
      <ArrowRight className="size-3.5 text-stone-400" aria-hidden />
      <UnitTag label={to} size="sm" />
    </span>
  );
}

export default function StaffSwaps() {
  const { db, user, run } = useStore();
  const scope = useFacilityScope();
  const isFM = user?.role === 'FACILITY_MANAGER';
  const [tab, setTab] = useState<Tab>('pending');
  const [dlg, setDlg] = useState<Dialog>(null);
  const [approve, setApprove] = useState(true);
  const [facilityFault, setFacilityFault] = useState(false);
  const [fee, setFee] = useState('0');
  const [scheduledFor, setScheduledFor] = useState('');
  // Nhân viên được phân công chuyển đồ cho yêu cầu "Thuê người chuyển" — FM chọn lúc duyệt, đổi lại được khi chưa hoàn tất.
  const [moverId, setMoverId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [keyTag, setKeyTag] = useState('');
  if (!user) return null;
  const close = () => setDlg(null);

  const all = db.swapRequests.filter((s) => scope.facilityIds.includes(s.facilityId));
  const groups: Record<Tab, UnitSwapRequest[]> = {
    pending: all.filter((s) => s.status === 'SUBMITTED'),
    approved: all.filter((s) => s.status === 'APPROVED'),
    done: all.filter((s) => !['SUBMITTED', 'APPROVED'].includes(s.status)),
  };

  /** Lần đổi đầu tiên của hợp đồng (chưa có lần đổi nào hoàn tất) — miễn phí như màn hình khách đã hứa; server cũng áp đúng quy tắc này. */
  // Đếm theo mọi lần đổi đã ghi trên hợp đồng (theo yêu cầu lẫn chi nhánh đổi tại quầy) — cùng cách đếm với server.
  const isFirstSwap = (s: UnitSwapRequest) => (db.contracts.find((x) => x._id === s.contractId)?.unitSwaps ?? []).length === 0;
  const openDecide = (s: UnitSwapRequest) => {
    // Điền sẵn phí đề xuất theo quy tắc chung (phí thao tác, + phí chuyển đồ nếu thuê người chuyển) — quản lý sửa được trong trần.
    setApprove(true); setFacilityFault(false); setFee(String(defaultSwapFee({ facilityFault: false, isFirstSwap: isFirstSwap(s), method: s.method }))); setScheduledFor(''); setRejectReason(''); setMoverId('');
    setDlg({ kind: 'decide', s });
  };
  const openAssign = (s: UnitSwapRequest) => {
    setMoverId(s.assignedStaffId ?? ''); setScheduledFor(s.scheduledFor ? s.scheduledFor.slice(0, 10) : '');
    setDlg({ kind: 'assign', s });
  };
  /** Nhân viên đang hoạt động của đúng chi nhánh của yêu cầu — chỉ những người này mới được phân công. */
  const moversOf = (s: UnitSwapRequest) => db.users.filter((u) => u.role === 'STAFF' && u.status === 'ACTIVE' && u.facilityIds.includes(s.facilityId));
  const moverSelect = (s: UnitSwapRequest) => (
    <Field label="Nhân viên chuyển đồ" hint="Khách thấy tên người đến chuyển.">
      <select className={inputCls} value={moverId} onChange={(e) => setMoverId(e.target.value)}>
        <option value="">— Chọn nhân viên —</option>
        {moversOf(s).map((u) => <option key={u._id} value={u._id}>{u.fullName}{u.shift ? ` · ${CHECK_IN_SHIFT[u.shift].label}` : ''}</option>)}
      </select>
    </Field>
  );
  const deliveryReady = !!scheduledFor && !!moverId;

  const row = (s: UnitSwapRequest) => (
    <QueueRow key={s._id}
      lead={<SwapUnits from={unitLabel(db, s.fromUnitId)} to={unitLabel(db, s.toUnitId)} />}
      title={userName(db, s.customerId)}
      badges={<StatusBadge map={SWAP_REQUEST_STATUS} value={s.status} />}
      meta={<>
        <Meta mono>{s.requestNumber}</Meta>
        {isResize(s)
          ? <><Badge tone="violet">Đổi cỡ kho</Badge><Meta icon={<Ruler />}>{typeName(db, s.unitTypeId)} → {typeName(db, s.toUnitTypeId)}</Meta></>
          : <Meta icon={<Warehouse />}>{typeName(db, s.unitTypeId)}</Meta>}
        <Meta icon={<Building2 />}>{facilityName(db, s.facilityId)}</Meta>
        {s.method === 'SELF'
          ? <Meta icon={<Hand />}>Khách tự chuyển{s.moveDeadline ? ` · hạn ${fmtDate(s.moveDeadline)}` : ''}</Meta>
          : <>
            <Meta icon={<Truck />}>{SWAP_METHOD[s.method]}</Meta>
            {s.assignedStaffName
              ? <><Meta icon={<UserRound />} className="font-medium text-stone-700">{s.assignedStaffName}</Meta>{s.assignedStaffId === user._id && <Badge tone="violet">Giao cho bạn</Badge>}</>
              // Người chuyển cũ bị khoá / chuyển chi nhánh → hệ thống gỡ phân công (users.updateUser); yêu cầu đã duyệt chờ quản lý giao lại.
              : <Meta icon={<TriangleAlert />} className="font-medium text-amber-700">Chưa có người chuyển{s.status === 'APPROVED' ? ' — giao lại' : ''}</Meta>}
            {s.scheduledFor && <Meta icon={<CalendarDays />}>Ngày chuyển {fmtDate(s.scheduledFor)}</Meta>}
          </>}
      </>}
      actions={<>
        {s.status === 'SUBMITTED' && isFM && <Button size="sm" onClick={() => openDecide(s)}>Xét duyệt</Button>}
        {s.status === 'APPROVED' && s.method === 'DELIVERY' && isFM && <Button size="sm" variant={s.assignedStaffId ? 'ghost' : 'primary'} onClick={() => openAssign(s)}>{s.assignedStaffId ? 'Đổi người chuyển' : 'Giao người chuyển'}</Button>}
        {s.status === 'APPROVED' && isFM && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Huỷ yêu cầu ${s.requestNumber}? Ô đang giữ cho yêu cầu này sẽ được nhả.`)) void run('cancelSwapRequest', { swapRequestId: s._id }, 'Đã huỷ yêu cầu đổi ô — ô đích trống trở lại'); }}>Huỷ</Button>}
        {s.status === 'APPROVED' && <Button size="sm" variant="secondary" onClick={() => { setKeyTag(''); setDlg({ kind: 'complete', s }); }}><CircleCheck className="size-3.5" />Xác nhận đã chuyển</Button>}
      </>}
    />
  );

  return (
    <>
      <PageHeader title="Yêu cầu đổi ô kho" actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[
        { key: 'pending', label: 'Chờ duyệt', count: groups.pending.length },
        { key: 'approved', label: 'Đã duyệt · chờ chuyển', count: groups.approved.length },
        { key: 'done', label: 'Đã xử lý', count: groups.done.length },
      ]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        {groups[tab].length === 0 ? <EmptyState icon={<Repeat className="size-6" />} title="Không có yêu cầu nào" /> : <ul className="divide-y divide-stone-100">{groups[tab].map(row)}</ul>}
      </Card>

      <Modal open={dlg?.kind === 'decide'} onClose={close} size="lg" title={`Xét duyệt ${dlg?.s.requestNumber ?? ''}`}
        description={dlg ? `${userName(db, dlg.s.customerId)} · ${unitLabel(db, dlg.s.fromUnitId)} → ${unitLabel(db, dlg.s.toUnitId)}` : ''}
        footer={<>
          <Button variant="secondary" onClick={() => setApprove(false)}>Từ chối</Button>
          <Button disabled={approve && dlg?.s.method === 'DELIVERY' && !deliveryReady} onClick={() => dlg && void run('decideSwapRequest', {
            swapRequestId: dlg.s._id, approve, facilityFault: approve ? facilityFault : undefined,
            fee: approve ? Math.round(Number(fee.replace(/\D/g, '')) || 0) : undefined,
            scheduledFor: approve && dlg.s.method === 'DELIVERY' ? `${scheduledFor}T00:00:00.000Z` : undefined,
            assignedStaffId: approve && dlg.s.method === 'DELIVERY' ? moverId : undefined,
            rejectReason: !approve ? rejectReason : undefined,
          }, approve ? 'Đã duyệt yêu cầu đổi ô' : 'Đã từ chối yêu cầu', () => close())}>
            {approve ? 'Duyệt' : 'Xác nhận từ chối'}
          </Button>
        </>}>
        {dlg && (
          <div className="space-y-4">
            <div className="flex items-center gap-3"><SwapUnits from={unitLabel(db, dlg.s.fromUnitId)} to={unitLabel(db, dlg.s.toUnitId)} /><span className="text-sm text-stone-500">{isResize(dlg.s) ? `${typeName(db, dlg.s.unitTypeId)} → ${typeName(db, dlg.s.toUnitTypeId)}` : typeName(db, dlg.s.unitTypeId)}</span></div>
            {/* Đổi cỡ kho: giá / tiền giữ chân mới đã chốt theo phụ lục khách xác nhận — quản lý chỉ duyệt và đặt phí thao tác. */}
            {sizeChangeNote(dlg.s) && <Callout tone="blue" icon={<Ruler />}>{sizeChangeNote(dlg.s)} Khách đã xác nhận Phụ lục đổi cỡ kho.</Callout>}
            <FactGrid>
              <Fact icon={<MessageSquareText className="size-4" />} label="Lý do khách nêu">{dlg.s.reason}</Fact>
              <Fact icon={dlg.s.method === 'SELF' ? <Hand className="size-4" /> : <Truck className="size-4" />} label="Hình thức">{SWAP_METHOD[dlg.s.method]}</Fact>
              <Fact icon={<Clock className="size-4" />} label="Gửi lúc">{fmtDateTime(dlg.s.createdAt)}</Fact>
            </FactGrid>
            {approve ? (
              <>
                <CheckLine checked={facilityFault} onChange={(v) => { setFacilityFault(v); setFee(String(defaultSwapFee({ facilityFault: v, isFirstSwap: isFirstSwap(dlg.s), method: dlg.s.method }))); }}>
                  Lỗi từ chi nhánh (hư hỏng, mất an ninh…) — miễn phí đổi ô
                </CheckLine>
                {isFreeSwap({ facilityFault, isFirstSwap: isFirstSwap(dlg.s) }) ? (
                  <Callout tone="green" icon={<Gift />}>Miễn phí — {facilityFault ? 'đổi do lỗi từ chi nhánh' : 'lần đổi ô đầu tiên của hợp đồng này'} (Điều 8).</Callout>
                ) : (
                  <Field label="Phí đổi ô" hint={`Tối đa ${vnd(SWAP_FEE_MAX)}; 0 nếu miễn.`}>
                    <input className={inputCls} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
                  </Field>
                )}
                {dlg.s.method === 'DELIVERY' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Ngày cử người chuyển">
                      <input type="date" className={inputCls} min={new Date().toISOString().slice(0, 10)} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                    </Field>
                    {moverSelect(dlg.s)}
                  </div>
                )}
                {dlg.s.method === 'SELF' && <Callout tone="gray" icon={<Timer />}>Duyệt xong khách có 7 ngày để tự chuyển đồ sang ô mới, quá hạn yêu cầu sẽ tự hủy.</Callout>}
              </>
            ) : (
              <Field label="Lý do từ chối"><textarea className={inputCls} rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></Field>
            )}
          </div>
        )}
      </Modal>

      <Modal open={dlg?.kind === 'assign'} onClose={close} title={`Phân công chuyển đồ ${dlg?.s.requestNumber ?? ''}`}
        description={dlg ? `${userName(db, dlg.s.customerId)} · ${unitLabel(db, dlg.s.fromUnitId)} → ${unitLabel(db, dlg.s.toUnitId)}` : ''}
        footer={<Button disabled={!deliveryReady} onClick={() => dlg && void run('assignSwapMover', { swapRequestId: dlg.s._id, assignedStaffId: moverId, scheduledFor: `${scheduledFor}T00:00:00.000Z` }, 'Đã cập nhật người chuyển', () => close())}>Lưu phân công</Button>}>
        {dlg && (
          <div className="space-y-4">
            <Field label="Ngày chuyển">
              <input type="date" className={inputCls} min={new Date().toISOString().slice(0, 10)} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
            </Field>
            {moverSelect(dlg.s)}
          </div>
        )}
      </Modal>

      <Modal open={dlg?.kind === 'complete'} onClose={close} title="Xác nhận đã chuyển xong"
        description={dlg ? `${unitLabel(db, dlg.s.fromUnitId)} → ${unitLabel(db, dlg.s.toUnitId)}${dlg.s.fee ? ` · phí ${vnd(dlg.s.fee)}` : ' · miễn phí'}` : ''}
        footer={<Button onClick={() => dlg && void run('completeSwapRequest', { swapRequestId: dlg.s._id, keyTag: keyTag.trim() },
          (r) => [r.sizeChange ? resizeDoneText(r.sizeChange) : null, r.pin ? `Mật khẩu mới của ô: ${r.pin} (khách cũng xem được trong tài khoản)` : r.accessChanged ? 'Hình thức khoá của hợp đồng đã đổi theo ô mới' : null].filter(Boolean).join(' · ') || 'Đã đổi ô — hợp đồng cập nhật ô mới', () => close())}>Xác nhận</Button>}>
        <p className="text-sm text-stone-600">Khách đã dọn hết đồ sang ô mới và trả ô cũ? Ô cũ chuyển sang chờ kiểm tra.</p>
        {dlg?.kind === 'complete' && (() => {
          // Hình thức khoá thuộc về từng ô — ô mới khác khoá thì hợp đồng đổi theo và phải giao phương tiện mới.
          const oldLock = byId(db.contracts, dlg.s.contractId)?.access.method;
          const newLock = byId(db.units, dlg.s.toUnitId)?.accessMethod;
          if (!newLock) return null;
          return (
            <div className="mt-3 space-y-3">
              {oldLock && oldLock !== newLock && (
                <Callout tone="amber" icon={<KeyRound />}>
                  Ô mới khoá bằng <b>{ACCESS_METHOD[newLock]}</b>, khác ô cũ (<b>{ACCESS_METHOD[oldLock]}</b>). Thu lại {ACCESS_METHOD[oldLock].toLowerCase()} cũ nếu có
                  {newLock === 'PIN' ? ' — hệ thống sẽ cấp mật khẩu mới ngay khi xác nhận.' : ` và giao ${ACCESS_METHOD[newLock].toLowerCase()} của ô mới cho khách.`}
                </Callout>
              )}
              {newLock !== 'PIN' && (
                <Field label={newLock === 'RFID_CARD' ? 'Số thẻ khoá giao cho khách' : 'Nhãn chìa khoá giao cho khách'} hint="Để trống nếu khách tiếp tục dùng thẻ / chìa cũ.">
                  <input className={inputCls} value={keyTag} maxLength={50} onChange={(e) => setKeyTag(e.target.value)} />
                </Field>
              )}
            </div>
          );
        })()}
        {dlg?.s.fee ? <p className="mt-2 text-sm">Phí <b>{vnd(dlg.s.fee)}</b> sẽ được cộng vào công nợ của khách.</p> : null}
        {dlg?.kind === 'complete' && sizeChangeNote(dlg.s) && (
          <Callout tone="blue" icon={<Banknote />} className="mt-3">
            {sizeChangeNote(dlg.s)} Xác nhận xong, hợp đồng sang loại mới và hệ thống tự ghi phần chênh tính theo hôm nay (thu thêm cộng vào công nợ; hoàn theo cách khách đã trả). Hợp đồng còn công nợ thì thu xong trước.
          </Callout>
        )}
      </Modal>
    </>
  );
}
