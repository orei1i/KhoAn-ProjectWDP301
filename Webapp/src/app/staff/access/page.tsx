'use client';

import { useState } from 'react';
import { Banknote, CalendarDays, Check, CreditCard, DoorOpen, History, IdCard, Key, KeyRound, RectangleEllipsis, ShieldAlert, UserRound, Warehouse, X, type LucideIcon } from 'lucide-react';
import { ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, type AccessRequest, type AccessRequestType, type IdType, type RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, ACCESS_REQUEST_STATUS, ACCESS_REQUEST_TYPE } from '@/shared/lib/labels';
import { byId, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Button, Card, Disclosure, EmptyState, Field, IconTile, InfoTip, Modal, PageHeader, StatusBadge, Table, Tabs, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { IdCheckUnlock } from '@/features/contracts/id-check-unlock';
import { Callout, CheckLine, Chip, ChipRow, Meta, QueueRow } from '@/features/staff-ui';

type Tab = 'open' | 'all';
type Dialog = { kind: 'reject' | 'handover' | 'cancel'; req: AccessRequest } | null;
/** Giấy tờ bản gốc người đến quầy xuất trình — nhân viên tự đọc và nhập, server so với hồ sơ (không hiện sẵn số đã khai). */
type IdForm = { personId: string; idType: IdType | ''; last4: string; checked: boolean };
const EMPTY_ID: IdForm = { personId: '', idType: '', last4: '', checked: false };
const idReady = (f: IdForm) => !!f.idType && ID_LAST4_RE.test(f.last4.trim()) && f.checked;
const idPayload = (f: IdForm) => ({
  presenter: f.personId ? 'AUTHORIZED' as const : 'CUSTOMER' as const, authorizedPersonId: f.personId || undefined,
  idType: f.idType as IdType, idNumberLast4: f.last4.trim(),
});
/** Loại yêu cầu → icon (chỉ để nhìn). */
const TYPE_ICON: Record<AccessRequestType, LucideIcon> = { PIN_RESET: RectangleEllipsis, CARD_REISSUE: CreditCard, KEY_REISSUE: Key };

/** Chọn người xuất trình (chủ hợp đồng / người được uỷ quyền) + loại giấy tờ + 4 số cuối — trống, bắt buộc. */
function PresentedIdFields({ contract, value, onChange, customerName }: { contract: RentalContract; value: IdForm; onChange: (v: IdForm) => void; customerName: string }) {
  return (
    <div className="space-y-3 rounded-xl bg-sky-50/70 p-4 text-sm ring-1 ring-inset ring-sky-200">
      <p className="flex items-center gap-2 font-semibold text-sky-950">
        <IdCard className="size-4 text-sky-600" />Đối chiếu giấy tờ tùy thân bản gốc
        <InfoTip align="start">Nhập đúng loại giấy tờ và 4 số cuối theo bản gốc. Hệ thống tự so với hồ sơ — không khớp thì không ghi nhận.</InfoTip>
      </p>
      {/* Nhập sai nhiều lần → server khoá đối chiếu của hợp đồng (423 ID_CHECK_LOCKED); quản lý mở khoá tại đây. */}
      <IdCheckUnlock kind="contracts" target={contract} label={`hợp đồng ${contract.contractNumber}`} />
      <Field label="Người xuất trình giấy tờ" hint="Chỉ chủ hợp đồng hoặc người được uỷ quyền đã đăng ký.">
        <select className={inputCls} value={value.personId} onChange={(e) => onChange({ ...value, personId: e.target.value, checked: false })}>
          <option value="">Chủ hợp đồng — {customerName}</option>
          {(contract.authorizedPersons ?? []).map((p) => <option key={p._id} value={p._id}>Người được uỷ quyền — {p.fullName} ({p.phone})</option>)}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <Field label="Loại giấy tờ">
          <select className={inputCls} value={value.idType} onChange={(e) => onChange({ ...value, idType: e.target.value as IdType | '' })}>
            <option value="">— Chọn —</option>
            {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="4 số cuối"><input className={cx(inputCls, 'font-mono uppercase')} maxLength={4} autoComplete="off" value={value.last4} onChange={(e) => onChange({ ...value, last4: e.target.value })} /></Field>
      </div>
      <CheckLine checked={value.checked} onChange={(checked) => onChange({ ...value, checked })}>
        Người này có mặt tại quầy; tôi đã xem giấy tờ bản gốc và nhập đúng loại giấy tờ, 4 số cuối.
      </CheckLine>
    </div>
  );
}

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
  // Người nhận thẻ / chìa mới (bàn giao).
  const [handId, setHandId] = useState<IdForm>(EMPTY_ID);
  // Mở kho hộ khách bằng chìa tổng / thẻ tổng (khách mất chìa, mất thẻ, cần vào gấp).
  const [openFor, setOpenFor] = useState<({ contractId: string; reason: string } & IdForm) | null>(null);

  const all = db.accessRequests.filter((r) => scope.facilityIds.includes(r.facilityId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = all.filter((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
  const rows = tab === 'open' ? [...open].reverse() : all;
  const openDialog = (kind: NonNullable<Dialog>['kind'], req: AccessRequest) => { setText(''); setShowErr(false); setHandId(EMPTY_ID); setDlg({ kind, req }); };

  // Mọi hình thức khoá đều mở hộ được: chìa tổng, thẻ tổng, hoặc mở + đặt lại ổ khoá mật khẩu vật lý. Hợp đồng bị khoá do công nợ
  // hoặc đã nhận lại kho (chờ kiểm tra / quyết toán — server trả ALREADY_RETURNED) thì không.
  const openable = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId)
    && ['ACTIVE', 'DELINQUENT', 'MOVE_OUT_PENDING'].includes(c.status) && !c.access.suspendedAt && !c.access.revokedAt)
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
  const openLog = db.contracts.filter((c) => scope.facilityIds.includes(c.facilityId))
    .flatMap((c) => (c.access.assistedOpens ?? []).map((o) => ({ ...o, c })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  const openTarget = openFor ? byId(db.contracts, openFor.contractId) : undefined;
  const openReady = !!openFor && !!openTarget && openFor.reason.trim().length >= 5 && idReady(openFor);
  const handContract = dlg?.kind === 'handover' ? byId(db.contracts, dlg.req.contractId) : undefined;

  const submit = () => {
    if (!dlg) return;
    const t = text.trim();
    if (dlg.kind !== 'cancel' && !t) { setShowErr(true); toast(dlg.kind === 'reject' ? 'Cần ghi lý do từ chối' : 'Nhập số thẻ / mã chìa mới', 'error'); return; }
    if (dlg.kind === 'handover' && !idReady(handId)) { setShowErr(true); toast('Nhập giấy tờ bản gốc của người nhận và xác nhận đã đối chiếu', 'error'); return; }
    const close = () => setDlg(null);
    if (dlg.kind === 'reject') void run('decideAccessRequest', { requestId: dlg.req._id, approve: false, note: t }, 'Đã từ chối và hoàn phí cho khách', close);
    else if (dlg.kind === 'handover') void run('completeAccessRequest', { requestId: dlg.req._id, keyTag: t, ...idPayload(handId) }, 'Đã bàn giao — hoàn tất yêu cầu', close);
    else void run('cancelAccessRequest', { requestId: dlg.req._id, reason: t }, 'Đã huỷ yêu cầu và hoàn phí', close);
  };

  return (
    <>
      <PageHeader title="Cấp lại thẻ / chìa, mở hộ" description="Quản lý chi nhánh duyệt; từ chối hoặc huỷ thì hoàn đủ phí." actions={<FacilityPicker scope={scope} />} />
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-200 sm:p-5">
        <IconTile icon={<DoorOpen className="size-5" />} tone="amber" size="lg" />
        <div className="min-w-0 flex-1 basis-60">
          <p className="font-semibold text-amber-950">Khách cần mở kho gấp</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-amber-900">
            Mất chìa, mất thẻ, quên mật khẩu ổ khoá
            <InfoTip align="start">Nhập giấy tờ bản gốc người đến quầy và ghi nhận trước khi dùng chìa tổng / thẻ tổng — người đó phải có mặt.</InfoTip>
          </p>
        </div>
        <Button onClick={() => setOpenFor({ contractId: '', reason: '', ...EMPTY_ID })}><DoorOpen className="size-4" />Mở kho hộ khách</Button>
      </div>

      <Tabs tabs={[{ key: 'open', label: 'Đang xử lý', count: open.length }, { key: 'all', label: 'Tất cả', count: all.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        {rows.length === 0 ? <EmptyState icon={<KeyRound className="size-6" />} title="Không có yêu cầu cấp lại" /> : (
          <ul className="divide-y divide-stone-100">
            {rows.map((r) => {
              const c = byId(db.contracts, r.contractId);
              const Icon = TYPE_ICON[r.type] ?? KeyRound;
              return (
                <QueueRow key={r._id}
                  lead={<IconTile icon={<Icon className="size-4" />} tone={ACCESS_REQUEST_STATUS[r.status].tone} />}
                  title={ACCESS_REQUEST_TYPE[r.type].title}
                  badges={<StatusBadge map={ACCESS_REQUEST_STATUS} value={r.status} />}
                  meta={<>
                    <Meta mono>{r.requestNumber}</Meta>
                    <Meta icon={<UserRound />}>{userName(db, r.customerId)}</Meta>
                    <Meta icon={<Warehouse />}>Kho {c ? unitLabel(db, c.unitId) : '—'} · khoá {ACCESS_METHOD[r.accessMethod].toLowerCase()}</Meta>
                    <Meta icon={<CalendarDays />}>{fmtDate(r.createdAt)}</Meta>
                    <Meta icon={<Banknote />} className={r.fee > 0 ? 'font-medium text-stone-700' : undefined}>{r.fee > 0 ? vnd(r.fee) : 'Miễn phí'}</Meta>
                    {r.reason && <span className="basis-full text-stone-600">{r.reason}</span>}
                    {r.type === 'CARD_REISSUE' && (r.status === 'REQUESTED' || r.status === 'APPROVED') && <span className="flex basis-full items-center gap-1 font-medium text-amber-700"><ShieldAlert className="size-3.5" />Thẻ cũ đã bị khoá từ lúc khách báo mất</span>}
                    {r.decisionNote && <span className="basis-full text-red-700">Lý do từ chối: {r.decisionNote}</span>}
                    {r.newKeyTag && <span className="basis-full font-medium text-emerald-700">Số mới: {r.newKeyTag}</span>}
                  </>}
                  actions={(() => {
                    if (r.status === 'REQUESTED') {
                      return isFM ? (
                        <>
                          <Button size="sm" onClick={() => void run('decideAccessRequest', { requestId: r._id, approve: true }, r.type === 'PIN_RESET' ? 'Đã duyệt' : 'Đã duyệt — chờ bàn giao')}><Check className="size-3.5" />Duyệt</Button>
                          <Button size="sm" variant="ghost" onClick={() => openDialog('reject', r)}><X className="size-3.5" />Từ chối</Button>
                        </>
                      ) : <span className="text-xs text-stone-500">Chờ quản lý duyệt</span>;
                    }
                    if (r.status === 'APPROVED') {
                      return (
                        <>
                          <Button size="sm" onClick={() => openDialog('handover', r)}><KeyRound className="size-3.5" />Bàn giao</Button>
                          {isFM && <Button size="sm" variant="ghost" onClick={() => openDialog('cancel', r)}>Huỷ</Button>}
                        </>
                      );
                    }
                    return null;
                  })()}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Disclosure className="mt-6 shadow-card" icon={<History className="size-4" />} title="Nhật ký mở kho hộ" meta={openLog.length ? `${openLog.length} lần gần nhất` : 'Chưa có'}>
        <div className="-mx-4 -mb-4 overflow-hidden rounded-b-xl border-t border-stone-100">
          <Table rows={openLog} rowKey={(o) => `${o.c._id}-${o.at}`} empty={<EmptyState compact icon={<DoorOpen className="size-5" />} title="Chưa có lần mở hộ nào" />} columns={[
            { key: 't', header: 'Thời điểm', cell: (o) => <span className="whitespace-nowrap">{fmtDateTime(o.at)}</span> },
            { key: 'k', header: 'Khách / kho', cell: (o) => <div><p className="font-medium">{userName(db, o.c.customerId)}</p><p className="text-xs text-stone-500">Kho {unitLabel(db, o.c.unitId)} · khoá {ACCESS_METHOD[o.c.access.method].toLowerCase()}</p></div> },
            { key: 'f', header: 'Mở cho', cell: (o) => <div>{o.forName ? <span>{o.forName} <span className="text-xs text-stone-500">(được uỷ quyền)</span></span> : 'Chủ hợp đồng'}{o.idType && <p className="text-xs text-stone-500">Đã đối chiếu {ID_TYPE_LABEL[o.idType]}</p>}</div> },
            { key: 'b', header: 'Nhân viên mở', cell: (o) => o.byName },
            { key: 'r', header: 'Lý do', cell: (o) => o.reason },
          ]} />
        </div>
      </Disclosure>

      <Modal open={!!openFor} onClose={() => setOpenFor(null)} title="Mở kho hộ khách"
        footer={<><Button variant="secondary" onClick={() => setOpenFor(null)}>Đóng</Button><Button disabled={!openReady} onClick={() => openFor && void run('assistedOpen', { contractId: openFor.contractId, reason: openFor.reason.trim(), ...idPayload(openFor) }, 'Đã ghi nhận — có thể mở kho cho khách', () => setOpenFor(null))}><DoorOpen className="size-4" />Ghi nhận & mở kho</Button></>}>
        {openFor && (
          <div className="space-y-4">
            <Field label="Kho cần mở">
              <select className={inputCls} value={openFor.contractId} onChange={(e) => setOpenFor({ ...openFor, contractId: e.target.value, ...EMPTY_ID })}>
                <option value="">— Chọn kho —</option>
                {openable.map((c) => <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {userName(db, c.customerId)} · {ACCESS_METHOD[c.access.method]}</option>)}
              </select>
            </Field>
            {openTarget && (
              <div className="space-y-2 rounded-xl bg-stone-50 p-3 text-sm ring-1 ring-inset ring-stone-200">
                <ChipRow>
                  <Chip icon={<UserRound />}>{userName(db, openTarget.customerId)}</Chip>
                  <Chip mono>HĐ {openTarget.contractNumber}</Chip>
                  <Chip icon={<KeyRound />}>{openTarget.access.method === 'RFID_CARD' ? 'Số thẻ' : 'Mã chìa'}: {openTarget.access.keyTag ?? '—'}</Chip>
                </ChipRow>
                {openTarget.access.lostReportedAt && <Callout tone="amber" icon={<ShieldAlert />}>Khách đã báo mất từ {fmtDateTime(openTarget.access.lostReportedAt)}</Callout>}
              </div>
            )}
            <Field label="Lý do mở hộ" hint="VD: Khách làm mất thẻ, cần lấy hồ sơ gấp">
              <textarea className={inputCls} rows={2} maxLength={300} value={openFor.reason} onChange={(e) => setOpenFor({ ...openFor, reason: e.target.value })} />
            </Field>
            {openTarget && <PresentedIdFields contract={openTarget} customerName={userName(db, openTarget.customerId)} value={openFor} onChange={(v) => setOpenFor({ ...openFor, ...v })} />}
          </div>
        )}
      </Modal>

      <Modal open={!!dlg} onClose={() => setDlg(null)}
        title={dlg?.kind === 'reject' ? 'Từ chối yêu cầu' : dlg?.kind === 'handover' ? 'Bàn giao thẻ / chìa mới' : 'Huỷ yêu cầu đã duyệt'}
        description={dlg ? `${dlg.req.requestNumber} · ${ACCESS_REQUEST_TYPE[dlg.req.type].title}` : ''}
        footer={dlg && <><Button variant="secondary" onClick={() => setDlg(null)}>Đóng</Button><Button variant={dlg.kind === 'handover' ? 'primary' : 'danger'} onClick={submit}>{dlg.kind === 'reject' ? 'Từ chối & hoàn phí' : dlg.kind === 'handover' ? 'Xác nhận đã bàn giao' : 'Huỷ & hoàn phí'}</Button></>}>
        {dlg?.kind === 'handover' ? (
          <div className="space-y-4">
            <Field label={dlg.req.type === 'CARD_REISSUE' ? 'Số thẻ mới' : 'Mã chìa mới'} error={showErr && !text.trim() ? 'Nhập số thẻ / mã chìa mới' : undefined}>
              <input className={inputCls} value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder={dlg.req.type === 'CARD_REISSUE' ? 'CARD-0042' : 'KEY-0042'} />
            </Field>
            {handContract && <PresentedIdFields contract={handContract} customerName={userName(db, handContract.customerId)} value={handId} onChange={setHandId} />}
          </div>
        ) : (
          <Field label={dlg?.kind === 'reject' ? 'Lý do từ chối (khách sẽ thấy)' : 'Lý do huỷ (không bắt buộc)'} error={dlg?.kind === 'reject' && showErr && !text.trim() ? 'Cần ghi lý do từ chối' : undefined}>
            <textarea className={inputCls} rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {dlg && dlg.req.fee > 0 && dlg.kind !== 'handover' && <Callout tone="green" icon={<Banknote />} className="mt-3">Khách được hoàn <b>đủ {vnd(dlg.req.fee)}</b> phí đã trả.</Callout>}
        {/* Chi nhánh từ chối / huỷ không gỡ cờ báo mất — chỉ khách tự huỷ (tìm lại được) mới dùng lại thẻ / chìa cũ. */}
        {dlg && dlg.kind !== 'handover' && dlg.req.type !== 'PIN_RESET' && (
          <Callout tone="amber" icon={<ShieldAlert />} className="mt-3">Thẻ / chìa cũ vẫn bị vô hiệu (Điều 5) — khách cần gửi yêu cầu mới, hoặc nhân viên mở hộ tại quầy.</Callout>
        )}
      </Modal>
    </>
  );
}
