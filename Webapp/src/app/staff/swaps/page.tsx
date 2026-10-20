'use client';

import { useState } from 'react';
import { defaultSwapFee, isFreeSwap, SWAP_FEE_MAX, type UnitSwapRequest } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, CHECK_IN_SHIFT, SWAP_METHOD, SWAP_REQUEST_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

type Tab = 'pending' | 'approved' | 'done';
type Dialog = { kind: 'decide' | 'complete' | 'assign'; s: UnitSwapRequest } | null;

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
    <Field label="Nhân viên chuyển đồ" hint="Chỉ nhân viên đang hoạt động của chi nhánh này. Khách sẽ thấy tên người đến chuyển.">
      <select className={inputCls} value={moverId} onChange={(e) => setMoverId(e.target.value)}>
        <option value="">— Chọn nhân viên —</option>
        {moversOf(s).map((u) => <option key={u._id} value={u._id}>{u.fullName}{u.shift ? ` · ${CHECK_IN_SHIFT[u.shift].label}` : ''}</option>)}
      </select>
    </Field>
  );
  const deliveryReady = !!scheduledFor && !!moverId;

  const columns = [
    { key: 'n', header: 'Yêu cầu', cell: (s: UnitSwapRequest) => <div><p className="font-mono text-xs">{s.requestNumber}</p><p className="text-xs text-stone-500">{facilityName(db, s.facilityId)}</p></div> },
    { key: 'k', header: 'Khách hàng', cell: (s: UnitSwapRequest) => userName(db, s.customerId) },
    { key: 'u', header: 'Đổi ô', cell: (s: UnitSwapRequest) => <span>{unitLabel(db, s.fromUnitId)} → <b>{unitLabel(db, s.toUnitId)}</b> <span className="text-stone-400">({typeName(db, s.unitTypeId)})</span></span> },
    { key: 'm', header: 'Hình thức', cell: (s: UnitSwapRequest) => SWAP_METHOD[s.method] },
    { key: 'mv', header: 'Người chuyển', cell: (s: UnitSwapRequest) => (s.method === 'SELF'
      ? <span className="text-stone-500">Khách tự chuyển{s.moveDeadline ? ` · hạn ${fmtDate(s.moveDeadline)}` : ''}</span>
      : s.assignedStaffName
        ? <div><p className="font-medium">{s.assignedStaffName} {s.assignedStaffId === user._id && <Badge tone="violet">Giao cho bạn</Badge>}</p><p className="text-xs text-stone-500">Ngày chuyển {fmtDate(s.scheduledFor)}</p></div>
        // Người chuyển cũ bị khoá / chuyển chi nhánh → hệ thống gỡ phân công (users.updateUser); yêu cầu đã duyệt chờ quản lý giao lại.
        : <div><p className="font-medium text-amber-700">Chưa có người chuyển{s.status === 'APPROVED' ? ' — giao lại' : ''}</p>{s.scheduledFor && <p className="text-xs text-stone-500">Ngày chuyển {fmtDate(s.scheduledFor)}</p>}</div>) },
    { key: 'st', header: 'Trạng thái', cell: (s: UnitSwapRequest) => <StatusBadge map={SWAP_REQUEST_STATUS} value={s.status} /> },
    { key: 'a', header: '', className: 'text-right', cell: (s: UnitSwapRequest) => (
      <div className="flex flex-wrap justify-end gap-2">
        {s.status === 'SUBMITTED' && isFM && <Button size="sm" onClick={() => openDecide(s)}>Xét duyệt</Button>}
        {s.status === 'APPROVED' && s.method === 'DELIVERY' && isFM && <Button size="sm" variant={s.assignedStaffId ? 'ghost' : 'primary'} onClick={() => openAssign(s)}>{s.assignedStaffId ? 'Đổi người chuyển' : 'Giao người chuyển'}</Button>}
        {s.status === 'APPROVED' && isFM && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Huỷ yêu cầu ${s.requestNumber}? Ô đang giữ cho yêu cầu này sẽ được nhả.`)) void run('cancelSwapRequest', { swapRequestId: s._id }, 'Đã huỷ yêu cầu đổi ô — ô đích trống trở lại'); }}>Huỷ</Button>}
        {s.status === 'APPROVED' && <Button size="sm" variant="secondary" onClick={() => { setKeyTag(''); setDlg({ kind: 'complete', s }); }}>Xác nhận đã chuyển</Button>}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader title="Yêu cầu đổi ô kho" description="Khách gửi yêu cầu đổi sang ô cùng loại — quản lý xét duyệt, phân công nhân viên chuyển đồ (nếu khách thuê người chuyển), rồi xác nhận khi đã chuyển xong." actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[
        { key: 'pending', label: 'Chờ duyệt', count: groups.pending.length },
        { key: 'approved', label: 'Đã duyệt · chờ chuyển', count: groups.approved.length },
        { key: 'done', label: 'Đã xử lý', count: groups.done.length },
      ]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={groups[tab]} rowKey={(s) => s._id} empty={<EmptyState title="Không có yêu cầu nào" />} columns={columns} />
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
            <KV items={[
              ['Lý do khách nêu', dlg.s.reason],
              ['Hình thức', SWAP_METHOD[dlg.s.method]],
              ['Gửi lúc', fmtDateTime(dlg.s.createdAt)],
            ]} />
            {approve ? (
              <>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input type="checkbox" className="size-4" checked={facilityFault} onChange={(e) => { setFacilityFault(e.target.checked); setFee(String(defaultSwapFee({ facilityFault: e.target.checked, isFirstSwap: isFirstSwap(dlg.s), method: dlg.s.method }))); }} />
                  Lỗi từ chi nhánh (hư hỏng, mất an ninh…) — miễn phí đổi ô
                </label>
                {isFreeSwap({ facilityFault, isFirstSwap: isFirstSwap(dlg.s) }) ? (
                  <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Miễn phí — {facilityFault ? 'đổi do lỗi từ chi nhánh' : 'lần đổi ô đầu tiên của hợp đồng này'} (Điều 8).</p>
                ) : (
                  <Field label="Phí đổi ô" hint={`Đã điền phí đề xuất (phí thao tác${dlg.s.method === 'DELIVERY' ? ' + phí chuyển đồ' : ''}). Sửa được, tối đa ${vnd(SWAP_FEE_MAX)}; 0 nếu miễn.`}>
                    <input className={inputCls} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
                  </Field>
                )}
                {dlg.s.method === 'DELIVERY' && (
                  <>
                    <Field label="Ngày cử người chuyển">
                      <input type="date" className={inputCls} min={new Date().toISOString().slice(0, 10)} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                    </Field>
                    {moverSelect(dlg.s)}
                  </>
                )}
                {dlg.s.method === 'SELF' && <p className="text-xs text-stone-500">Duyệt xong khách có 7 ngày để tự chuyển đồ sang ô mới, quá hạn yêu cầu sẽ tự hủy.</p>}
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
          (r) => (r.pin ? `Đã đổi ô — mật khẩu mới của ô: ${r.pin} (khách cũng xem được trong tài khoản)` : r.accessChanged ? 'Đã đổi ô — hình thức khoá của hợp đồng đã đổi theo ô mới' : 'Đã đổi ô — hợp đồng cập nhật ô mới'), () => close())}>Xác nhận</Button>}>
        <p className="text-sm text-stone-600">Kiểm tra khách đã dọn hết đồ sang ô mới và trả lại ô cũ trước khi xác nhận. Ô cũ sẽ chuyển sang chờ kiểm tra.</p>
        {dlg?.kind === 'complete' && (() => {
          // Hình thức khoá thuộc về từng ô — ô mới khác khoá thì hợp đồng đổi theo và phải giao phương tiện mới.
          const oldLock = byId(db.contracts, dlg.s.contractId)?.access.method;
          const newLock = byId(db.units, dlg.s.toUnitId)?.accessMethod;
          if (!newLock) return null;
          return (
            <div className="mt-3 space-y-3">
              {oldLock && oldLock !== newLock && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  Ô mới khoá bằng <b>{ACCESS_METHOD[newLock]}</b>, khác ô cũ (<b>{ACCESS_METHOD[oldLock]}</b>). Thu lại {ACCESS_METHOD[oldLock].toLowerCase()} cũ nếu có
                  {newLock === 'PIN' ? ' — hệ thống sẽ cấp mật khẩu mới ngay khi xác nhận.' : ` và giao ${ACCESS_METHOD[newLock].toLowerCase()} của ô mới cho khách.`}
                </p>
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
      </Modal>
    </>
  );
}
