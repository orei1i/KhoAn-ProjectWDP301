'use client';

import { useState } from 'react';
import { Check, DoorOpen, KeyRound, ShieldAlert, X } from 'lucide-react';
import type { AccessRequest } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, ACCESS_REQUEST_STATUS, ACCESS_REQUEST_TYPE } from '@/shared/lib/labels';
import { byId, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

type Tab = 'open' | 'all';
type Dialog = { kind: 'reject' | 'handover' | 'cancel'; req: AccessRequest } | null;

/**
 * Yêu cầu cấp lại mật khẩu / thẻ khoá / chìa khoá của khách. Quản lý chi nhánh duyệt hoặc từ chối; mật khẩu được cấp
 * ngay khi duyệt (khách xem trong app, người duyệt không thấy mã); thẻ/chìa thì nhân viên bàn giao xong mới hoàn tất.
 */
export default function StaffAccessRequests() {
  const { db, user, run, toast } = useStore();
  const scope = useFacilityScope();
  const isFM = user?.role === 'FACILITY_MANAGER';
  const [tab, setTab] = useState<Tab>('open');
  const [dlg, setDlg] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [showErr, setShowErr] = useState(false);
  // Mở kho hộ khách bằng chìa tổng / thẻ tổng (khách mất chìa, mất thẻ, cần vào gấp).
  const [openFor, setOpenFor] = useState<{ contractId: string; reason: string; verified: boolean; personId: string } | null>(null);

  const all = db.accessRequests.filter((r) => scope.facilityIds.includes(r.facilityId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = all.filter((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
  const rows = tab === 'open' ? [...open].reverse() : all;
  const openDialog = (kind: NonNullable<Dialog>['kind'], req: AccessRequest) => { setText(''); setShowErr(false); setDlg({ kind, req }); };

  // Mọi hình thức khoá đều mở hộ được: chìa tổng, thẻ tổng, hoặc mở + đặt lại ổ khoá mật khẩu vật lý. Hợp đồng bị khoá do công nợ
  // hoặc đã nhận lại kho (chờ kiểm tra / quyết toán — server trả ALREADY_RETURNED) thì không.
  const openable = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId)
    && ['ACTIVE', 'DELINQUENT', 'MOVE_OUT_PENDING'].includes(c.status) && !c.access.suspendedAt && !c.access.revokedAt)
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
  const openLog = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId))
    .flatMap((c) => (c.access.assistedOpens ?? []).map((o) => ({ ...o, c })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  const openTarget = openFor ? byId(db.contracts, openFor.contractId) : undefined;
  const openReady = !!openFor && !!openTarget && openFor.reason.trim().length >= 5 && openFor.verified;

  const submit = () => {
    if (!dlg) return;
    const t = text.trim();
    if (dlg.kind !== 'cancel' && !t) { setShowErr(true); toast(dlg.kind === 'reject' ? 'Cần ghi lý do từ chối' : 'Nhập số thẻ / mã chìa mới', 'error'); return; }
    const close = () => setDlg(null);
    if (dlg.kind === 'reject') void run('decideAccessRequest', { requestId: dlg.req._id, approve: false, note: t }, 'Đã từ chối và hoàn phí cho khách', close);
    else if (dlg.kind === 'handover') void run('completeAccessRequest', { requestId: dlg.req._id, keyTag: t }, 'Đã bàn giao — hoàn tất yêu cầu', close);
    else void run('cancelAccessRequest', { requestId: dlg.req._id, reason: t }, 'Đã huỷ yêu cầu và hoàn phí', close);
  };

  return (
    <>
      <PageHeader title="Cấp lại mã / thẻ / chìa" description="Khách xin làm lại thẻ hoặc cấp lại chìa khoá (ô khoá mật khẩu là khoá vật lý — khách tự đổi mật khẩu trên ổ khoá, không cần yêu cầu). Quản lý chi nhánh duyệt; thẻ và chìa do nhân viên bàn giao rồi ghi số thẻ / mã chìa mới. Từ chối hoặc huỷ thì hoàn đủ phí." actions={<FacilityPicker scope={scope} />} />
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 border-amber-200 bg-amber-50 p-5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold text-amber-950"><DoorOpen className="size-4" />Khách cần mở kho gấp (mất chìa, mất thẻ, quên mật khẩu ổ khoá)</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">Xác minh danh tính khách tại quầy, ghi nhận ở đây rồi mới dùng <b>chìa tổng / thẻ tổng</b> để mở — có mặt khách, không vào trong ô kho. Mỗi lần mở được ghi nhật ký và khách xem được. Ô khoá mật khẩu: mở và đặt lại ổ khoá vật lý để khách tự đặt mật khẩu mới ngay tại chỗ.</p>
        </div>
        <Button onClick={() => setOpenFor({ contractId: '', reason: '', verified: false, personId: '' })}><DoorOpen className="size-4" />Mở kho hộ khách</Button>
      </Card>

      <Tabs tabs={[{ key: 'open', label: 'Đang xử lý', count: open.length }, { key: 'all', label: 'Tất cả', count: all.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={rows} rowKey={(r) => r._id} empty={<EmptyState icon={<KeyRound className="size-5" />} title="Không có yêu cầu cấp lại" />} columns={[
          { key: 'n', header: 'Mã', cell: (r) => <div><span className="font-mono text-xs">{r.requestNumber}</span><p className="text-xs text-stone-500">{fmtDate(r.createdAt)}</p></div> },
          { key: 'c', header: 'Khách / kho', cell: (r) => { const c = byId(db.contracts, r.contractId); return <div><p className="font-medium">{userName(db, r.customerId)}</p><p className="text-xs text-stone-500">Kho {c ? unitLabel(db, c.unitId) : '—'} · khoá {ACCESS_METHOD[r.accessMethod].toLowerCase()}</p></div>; } },
          { key: 't', header: 'Yêu cầu', cell: (r) => <div><p>{ACCESS_REQUEST_TYPE[r.type].title}</p>{r.reason && <p className="text-xs text-stone-500">{r.reason}</p>}{r.type === 'CARD_REISSUE' && (r.status === 'REQUESTED' || r.status === 'APPROVED') && <p className="text-xs font-medium text-amber-700">Thẻ cũ đã bị khoá từ lúc khách báo mất</p>}{r.decisionNote && <p className="text-xs text-red-700">Lý do từ chối: {r.decisionNote}</p>}{r.newKeyTag && <p className="text-xs text-emerald-700">Số mới: {r.newKeyTag}</p>}</div> },
          { key: 'f', header: 'Phí', className: 'tabular-nums', cell: (r) => (r.fee > 0 ? vnd(r.fee) : <span className="text-stone-400">Miễn phí</span>) },
          { key: 's', header: 'Trạng thái', cell: (r) => <StatusBadge map={ACCESS_REQUEST_STATUS} value={r.status} /> },
          { key: 'a', header: '', className: 'text-right', cell: (r) => {
            if (r.status === 'REQUESTED') {
              return isFM ? (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" onClick={() => void run('decideAccessRequest', { requestId: r._id, approve: true }, r.type === 'PIN_RESET' ? 'Đã duyệt — mật khẩu mới đã gửi vào tài khoản khách' : 'Đã duyệt — chờ bàn giao')}><Check className="size-3.5" />Duyệt</Button>
                  <Button size="sm" variant="ghost" onClick={() => openDialog('reject', r)}><X className="size-3.5" />Từ chối</Button>
                </div>
              ) : <span className="text-xs text-stone-500">Chờ quản lý duyệt</span>;
            }
            if (r.status === 'APPROVED') {
              return (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" onClick={() => openDialog('handover', r)}><KeyRound className="size-3.5" />Bàn giao</Button>
                  {isFM && <Button size="sm" variant="ghost" onClick={() => openDialog('cancel', r)}>Huỷ</Button>}
                </div>
              );
            }
            return null;
          } },
        ]} />
      </Card>

      <Card className="mt-6">
        <div className="border-b border-stone-100 px-5 py-4">
          <h3 className="font-semibold">Nhật ký mở kho hộ</h3>
          <p className="mt-0.5 text-sm text-stone-500">20 lần gần nhất — ghi tự động, không sửa xoá được.</p>
        </div>
        <Table rows={openLog} rowKey={(o) => `${o.c._id}-${o.at}`} empty={<EmptyState icon={<DoorOpen className="size-5" />} title="Chưa có lần mở hộ nào" />} columns={[
          { key: 't', header: 'Thời điểm', cell: (o) => fmtDateTime(o.at) },
          { key: 'k', header: 'Khách / kho', cell: (o) => <div><p className="font-medium">{userName(db, o.c.customerId)}</p><p className="text-xs text-stone-500">Kho {unitLabel(db, o.c.unitId)} · khoá {ACCESS_METHOD[o.c.access.method].toLowerCase()}</p></div> },
          { key: 'f', header: 'Mở cho', cell: (o) => (o.forName ? <span>{o.forName} <span className="text-xs text-stone-500">(được uỷ quyền)</span></span> : 'Chủ hợp đồng') },
          { key: 'b', header: 'Nhân viên mở', cell: (o) => o.byName },
          { key: 'r', header: 'Lý do', cell: (o) => o.reason },
        ]} />
      </Card>

      <Modal open={!!openFor} onClose={() => setOpenFor(null)} title="Mở kho hộ khách" description="Dùng chìa tổng / thẻ tổng của chi nhánh — chỉ khi khách có mặt và đã xác minh danh tính."
        footer={<><Button variant="secondary" onClick={() => setOpenFor(null)}>Đóng</Button><Button disabled={!openReady} onClick={() => openFor && void run('assistedOpen', { contractId: openFor.contractId, reason: openFor.reason.trim(), authorizedPersonId: openFor.personId || undefined }, 'Đã ghi nhận — có thể mở kho cho khách', () => setOpenFor(null))}>Ghi nhận & mở kho</Button></>}>
        {openFor && (
          <div className="space-y-4">
            <Field label="Kho cần mở" hint="Kho đang còn quyền ra vào (chìa, thẻ, mật khẩu).">
              <select className={inputCls} value={openFor.contractId} onChange={(e) => setOpenFor({ ...openFor, contractId: e.target.value, verified: false, personId: '' })}>
                <option value="">— Chọn kho —</option>
                {openable.map((c) => <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {userName(db, c.customerId)} · {ACCESS_METHOD[c.access.method]}</option>)}
              </select>
            </Field>
            {openTarget && (
              <div className="rounded-lg bg-stone-50 p-3 text-sm ring-1 ring-inset ring-stone-200">
                <p><b>{userName(db, openTarget.customerId)}</b> · hợp đồng {openTarget.contractNumber}</p>
                <p className="mt-1 text-stone-600">Giấy tờ (4 số cuối): <b>{byId(db.users, openTarget.customerId)?.customerProfile?.idNumberLast4 ?? 'chưa có — xem giấy tờ gốc'}</b> · {openTarget.access.method === 'RFID_CARD' ? 'Số thẻ' : 'Mã chìa'}: {openTarget.access.keyTag ?? '—'}</p>
                {openTarget.access.lostReportedAt && <p className="mt-1 flex items-center gap-1.5 font-medium text-amber-700"><ShieldAlert className="size-4" />Khách đã báo mất từ {fmtDateTime(openTarget.access.lostReportedAt)}</p>}
              </div>
            )}
            {openTarget && (
              <Field label="Người đến quầy" hint="Chỉ chủ hợp đồng hoặc người chủ hợp đồng đã đăng ký uỷ quyền mới được mở hộ.">
                <select className={inputCls} value={openFor.personId} onChange={(e) => setOpenFor({ ...openFor, personId: e.target.value, verified: false })}>
                  <option value="">Chủ hợp đồng — {userName(db, openTarget.customerId)}</option>
                  {(openTarget.authorizedPersons ?? []).map((p) => <option key={p._id} value={p._id}>Người được uỷ quyền — {p.fullName} (giấy tờ •••• {p.idNumberLast4}, {p.phone})</option>)}
                </select>
              </Field>
            )}
            <Field label="Lý do mở hộ" hint="VD: Khách làm mất thẻ, cần lấy hồ sơ gấp">
              <textarea className={inputCls} rows={2} maxLength={300} value={openFor.reason} onChange={(e) => setOpenFor({ ...openFor, reason: e.target.value })} />
            </Field>
            <label className="flex cursor-pointer gap-2.5 text-sm leading-relaxed">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={openFor.verified} onChange={(e) => setOpenFor({ ...openFor, verified: e.target.checked })} />
              <span>{openFor.personId ? 'Tôi đã xác minh danh tính người được uỷ quyền: họ tên và 4 số cuối giấy tờ tùy thân khớp với thông tin chủ hợp đồng đã đăng ký. Người này có mặt khi mở kho.' : 'Tôi đã xác minh danh tính: khách đăng nhập đúng tài khoản và giấy tờ tùy thân khớp 4 số cuối ở trên. Khách có mặt khi mở kho.'}</span>
            </label>
          </div>
        )}
      </Modal>

      <Modal open={!!dlg} onClose={() => setDlg(null)}
        title={dlg?.kind === 'reject' ? 'Từ chối yêu cầu' : dlg?.kind === 'handover' ? 'Bàn giao thẻ / chìa mới' : 'Huỷ yêu cầu đã duyệt'}
        description={dlg ? `${dlg.req.requestNumber} · ${ACCESS_REQUEST_TYPE[dlg.req.type].title}` : ''}
        footer={dlg && <><Button variant="secondary" onClick={() => setDlg(null)}>Đóng</Button><Button variant={dlg.kind === 'handover' ? 'primary' : 'danger'} onClick={submit}>{dlg.kind === 'reject' ? 'Từ chối & hoàn phí' : dlg.kind === 'handover' ? 'Xác nhận đã bàn giao' : 'Huỷ & hoàn phí'}</Button></>}>
        {dlg?.kind === 'handover' ? (
          <Field label={dlg.req.type === 'CARD_REISSUE' ? 'Số thẻ mới' : 'Mã chìa mới'} hint="Ghi đúng số in trên thẻ / nhãn chìa vừa bàn giao cho khách" error={showErr && !text.trim() ? 'Nhập số thẻ / mã chìa mới' : undefined}>
            <input className={inputCls} value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder={dlg.req.type === 'CARD_REISSUE' ? 'CARD-0042' : 'KEY-0042'} />
          </Field>
        ) : (
          <Field label={dlg?.kind === 'reject' ? 'Lý do từ chối (khách sẽ thấy)' : 'Lý do huỷ (không bắt buộc)'} error={dlg?.kind === 'reject' && showErr && !text.trim() ? 'Cần ghi lý do từ chối' : undefined}>
            <textarea className={inputCls} rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {dlg && dlg.req.fee > 0 && dlg.kind !== 'handover' && <p className="mt-3 text-sm text-stone-600">Khách được hoàn <b>đủ {vnd(dlg.req.fee)}</b> phí đã trả.</p>}
        {/* Chi nhánh từ chối / huỷ không gỡ cờ báo mất — chỉ khách tự huỷ (tìm lại được) mới dùng lại thẻ / chìa cũ. */}
        {dlg && dlg.kind !== 'handover' && dlg.req.type !== 'PIN_RESET' && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">Thẻ / chìa cũ vẫn bị vô hiệu (Điều 5) — khách cần gửi yêu cầu mới, hoặc nhân viên mở hộ tại quầy.</p>
        )}
      </Modal>
    </>
  );
}
