'use client';

import { useState } from 'react';
import { ArrowRight, Banknote, Building2, CalendarCheck, CalendarDays, CircleCheck, Clock, Gift, Hand, MessageSquareText, PackageSearch, Repeat, Ruler, Timer, Truck, UserRound, Warehouse } from 'lucide-react';
import { defaultSwapFee, isFreeSwap, isValidPerformedBy, normalizePerformedBy, openIntakeOf, PERFORMED_BY_MAX, PERFORMED_BY_MESSAGE, swapBlockedByIntakeText, SWAP_FEE_MAX, swapFeeDue, vnDayOf, type CounterPaySelection, type UnitSwapRequest } from '@ssm/shared';
import type { SwapCompleteSizeChange } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { SWAP_METHOD, SWAP_REQUEST_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { Callout, CheckLine, Fact, FactGrid, Meta, QueueRow, UnitTag } from '@/features/staff-ui';
import { AccessResetReminder, NewAccessFields } from '@/features/access/unit-access-fields';
import { PhotoLinks, PhotoUploadInput, parsePhotoLinks } from '@/shared/ui/photo-links';
import { CounterPayment } from '@/features/payments/counter-pay';
import { MoveItemsList, ScheduleHistory, SizeChangeMoney } from '@/features/contracts/swap-extras';
import { swapMoveItemLabel, swapMoveItemsCount } from '@ssm/shared';

type Tab = 'pending' | 'approved' | 'done';

/** Đợt 15 (C3): yêu cầu đổi sang LOẠI kho khác = đổi cỡ kho (có báo giá + phụ lục khách đã xác nhận). */
const isResize = (s: UnitSwapRequest) => !!s.sizeChange || (!!s.toUnitTypeId && s.toUnitTypeId !== s.unitTypeId);
/** Câu báo sau khi xác nhận đổi cỡ: phần chênh tiền thuê / tiền giữ chân đã ghi. */
const resizeDoneText = (x: SwapCompleteSizeChange) => {
  const part = (n: number, more: string, back: string) => (n > 0 ? `${more} ${vnd(n)}` : n < 0 ? `${back} ${vnd(-n)}` : '');
  const bits = [part(x.rentDiff, 'thu thêm tiền thuê', 'hoàn tiền thuê'), part(x.depositDiff, 'thu thêm tiền giữ chân', 'hoàn tiền giữ chân')].filter(Boolean);
  return `Đã đổi cỡ kho — giá mới ${vnd(x.rate)}, Phụ lục số ${String(x.appendixNumber).padStart(2, '0')}${bits.length ? ` · ${bits.join(', ')}` : ''}`;
};
type Dialog = { kind: 'decide' | 'complete' | 'collect' | 'reschedule'; s: UnitSwapRequest } | null;

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
  const [rejectReason, setRejectReason] = useState('');
  const [keyTag, setKeyTag] = useState('');
  // Đợt 16 (B1): đã thu chìa / thẻ cũ (hoặc đặt lại ổ khoá ô cũ) ngay lúc xác nhận; `tried` hiện lỗi thiếu mã chìa / thẻ mới.
  const [oldReset, setOldReset] = useState(false);
  const [remindOld, setRemindOld] = useState(false); // popup nhắc nhận lại chìa / thẻ ô cũ khi bấm Xác nhận mà chưa tick
  const [tried, setTried] = useState(false);
  // Thuê người chuyển: quản lý chia việc ngoài hệ thống, lúc hoàn tất ghi người thực hiện.
  const [performedBy, setPerformedBy] = useState('');
  // RV3: biên bản chuyển đồ khi chi nhánh chuyển (DELIVERY).
  const [movePackages, setMovePackages] = useState(0);
  const [movePhotos, setMovePhotos] = useState('');
  const [moveNote, setMoveNote] = useState('');
  // Góp ý 17/11: danh sách đồ cần chuyển (khách chọn lúc gửi) — nhân viên tick từng món đã chuyển.
  const [movedIds, setMovedIds] = useState<string[]>([]);
  // Góp ý 17/11: thu phí tại quầy — tiền mặt (tick đã nhận đủ) hoặc VNPAY tại quầy khách đã trả xong; null = chưa thu.
  const [collectSel, setCollectSel] = useState<CounterPaySelection | null>(null);
  if (!user) return null;
  const close = () => setDlg(null);
  // Gửi xác nhận đã chuyển xong (đã qua các bước kiểm ở nút Xác nhận); reset = đã thu chìa / thẻ cũ hoặc đã đặt lại ổ khoá ô cũ.
  const finishComplete = (reset: boolean) => {
    if (!dlg) return;
    const delivery = dlg.s.method === 'DELIVERY';
    const photos = parsePhotoLinks(movePhotos).urls;
    void run('completeSwapRequest', { swapRequestId: dlg.s._id, keyTag: keyTag.trim(), oldAccessReset: reset, performedBy: delivery ? normalizePerformedBy(performedBy) : undefined,
      moveCheck: delivery ? { packages: movePackages, photoUrls: photos, note: moveNote.trim() || undefined, ...(dlg.s.moveItems?.length ? { movedItemIds: movedIds } : {}) } : undefined },
      (r) => [r.sizeChange ? resizeDoneText(r.sizeChange) : null, r.pin ? `Mật khẩu mới của ô: ${r.pin} (khách cũng xem được trong tài khoản)` : 'Đã giao phương tiện mở kho mới', reset ? null : 'ô cũ chờ thu chìa / thẻ (trang Cấp lại thẻ / chìa, mở hộ)'].filter(Boolean).join(' · '), () => close());
  };

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
    setApprove(true); setFacilityFault(false); setFee(String(defaultSwapFee({ facilityFault: false, isFirstSwap: isFirstSwap(s), method: s.method }))); setScheduledFor(''); setRejectReason('');
    setDlg({ kind: 'decide', s });
  };
  const openCollect = (s: UnitSwapRequest) => {
    setCollectSel(null);
    setDlg({ kind: 'collect', s });
  };

  // Góp ý 17/11: yêu cầu đã chuyển xong hiện NGÀY CHUYỂN THẬT (lúc bấm "Xác nhận đã chuyển"), không phải ngày hẹn; ngày hẹn chỉ kèm thêm
  // "hẹn …" khi khác ngày. Chưa xong thì hiện ngày hẹn như cũ.
  const doneAt = (s: UnitSwapRequest) => (s.status === 'DONE' ? s.completedAt ?? [...(s.statusHistory ?? [])].reverse().find((h) => h.to === 'DONE')?.at ?? null : null);
  const moveDate = (s: UnitSwapRequest) => {
    const done = doneAt(s);
    if (done) {
      const planned = s.method === 'DELIVERY' ? s.scheduledFor : null; // khách tự chuyển: hạn 7 ngày không phải ngày hẹn
      const differs = !!planned && vnDayOf(planned) !== vnDayOf(done);
      return <Meta icon={<CalendarCheck />} className="font-medium text-emerald-700">Đã chuyển {fmtDate(done)}{differs ? <span className="font-normal text-stone-500"> · hẹn {fmtDate(planned)}</span> : null}</Meta>;
    }
    if (s.method === 'SELF') return s.moveDeadline ? <Meta icon={<CalendarDays />}>Hạn tự chuyển {fmtDate(s.moveDeadline)}</Meta> : null;
    return s.scheduledFor ? <Meta icon={<CalendarDays />}>Ngày hẹn chuyển {fmtDate(s.scheduledFor)}</Meta> : null;
  };

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
          ? <><Meta icon={<Hand />}>Khách tự chuyển</Meta>{moveDate(s)}</>
          : <>
            <Meta icon={<Truck />}>{SWAP_METHOD[s.method]}</Meta>
            {/* Dữ liệu cũ còn tên người được phân công: vẫn hiện. Từ nay quản lý chia việc ngoài hệ thống, người thực hiện ghi lúc hoàn tất. */}
            {s.moveCheck && <Meta icon={<Truck />}>Đã chuyển {s.moveCheck.packages} kiện</Meta>}
            {s.moveCheck && <PhotoLinks urls={s.moveCheck.photoUrls} />}
            {s.performedBy
              ? <Meta icon={<UserRound />} className="font-medium text-stone-700">Người thực hiện: {s.performedBy}</Meta>
              : s.assignedStaffName && <Meta icon={<UserRound />} className="font-medium text-stone-700">{s.assignedStaffName}</Meta>}
            {moveDate(s)}
            {!!s.moveItems?.length && <Meta icon={<PackageSearch />} className="font-medium text-stone-700">{s.status === 'DONE' ? `Đã chuyển ${s.moveItems.filter((it) => it.moved).length}/${s.moveItems.length} món theo danh sách` : `${swapMoveItemsCount(s.moveItems)} món / kiện cần chuyển`}</Meta>}
            {s.feePrepay && s.fee > 0 && (s.paymentId
              ? <Badge tone={s.feeRefundPaymentId ? 'gray' : 'green'}>{s.feeRefundPaymentId ? `${byId(db.payments, s.feeRefundPaymentId)?.status === 'PENDING' ? 'Đang hoàn phí' : 'Đã hoàn phí'} ${vnd(s.fee)}` : `Đã trả phí ${vnd(s.fee)}`}</Badge>
              : s.status === 'APPROVED' && <Badge tone="amber">Chưa trả phí {vnd(s.fee)}</Badge>)}
          </>}
        {/* Góp ý 17/11: lịch sử dời ngày chuyển (quản lý dời / khách tự đổi). */}
        <ScheduleHistory s={s} className="w-full" />
        {/* Tester: nút "Xác nhận đã chuyển" / "Duyệt" bị khoá vì còn đợt nhập chờ xác nhận — ghi lý do thành chữ vàng ngay dưới dòng, không chỉ ở tooltip. */}
        {(s.status === 'APPROVED' || s.status === 'SUBMITTED') && openIntakeOf(db.intakeBatches, s.contractId) && (
          <span className="flex w-full items-start gap-1.5 font-medium text-amber-800"><PackageSearch className="mt-px size-3.5 shrink-0" aria-hidden />{swapBlockedByIntakeText(openIntakeOf(db.intakeBatches, s.contractId)!.code)}</span>
        )}
      </>}
      actions={<>
        {s.status === 'SUBMITTED' && isFM && <Button size="sm" onClick={() => openDecide(s)}>Xét duyệt</Button>}
        {swapFeeDue(s) > 0 && <Button size="sm" variant="secondary" onClick={() => openCollect(s)}><Banknote className="size-3.5" />Thu phí tại quầy</Button>}
        {s.status === 'APPROVED' && s.method === 'DELIVERY' && isFM && <Button size="sm" variant="secondary" onClick={() => { setScheduledFor(s.scheduledFor ? s.scheduledFor.slice(0, 10) : ''); setDlg({ kind: 'reschedule', s }); }}><CalendarDays className="size-3.5" />Dời ngày</Button>}
        {s.status === 'APPROVED' && isFM && <Button size="sm" variant="dangerOutline" onClick={() => { if (window.confirm(`Huỷ yêu cầu ${s.requestNumber}? Ô đang giữ cho yêu cầu này sẽ được nhả${s.feePrepay && s.paymentId ? `, phí đã trả ${vnd(s.fee)} được hoàn đủ` : ''}.`)) void run('cancelSwapRequest', { swapRequestId: s._id }, 'Đã huỷ yêu cầu đổi ô — ô đích trống trở lại'); }}>Huỷ</Button>}
        {/* Phí trả trước chưa trả: khoá nút, server cũng chặn 422 SWAP_FEE_UNPAID. */}
        {s.status === 'APPROVED' && <Button size="sm" variant="secondary" disabled={swapFeeDue(s) > 0 || !!openIntakeOf(db.intakeBatches, s.contractId)} title={swapFeeDue(s) > 0 ? 'Khách chưa trả phí thuê người chuyển' : openIntakeOf(db.intakeBatches, s.contractId) ? swapBlockedByIntakeText(openIntakeOf(db.intakeBatches, s.contractId)!.code) : undefined} onClick={() => { setKeyTag(''); setOldReset(false); setTried(false); setPerformedBy(''); setMovePackages(swapMoveItemsCount(s.moveItems)); setMovePhotos(''); setMoveNote(''); setMovedIds([]); setDlg({ kind: 'complete', s }); }}><CircleCheck className="size-3.5" />Xác nhận đã chuyển</Button>}
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
          <Button variant="dangerOutline" onClick={() => setApprove(false)}>Từ chối</Button>
          <Button variant={approve ? 'primary' : 'danger'} disabled={approve && ((dlg?.s.method === 'DELIVERY' && !scheduledFor) || !!openIntakeOf(db.intakeBatches, dlg?.s.contractId))} onClick={() => dlg && void run('decideSwapRequest', {
            swapRequestId: dlg.s._id, approve, facilityFault: approve ? facilityFault : undefined,
            fee: approve ? Math.round(Number(fee.replace(/\D/g, '')) || 0) : undefined,
            scheduledFor: approve && dlg.s.method === 'DELIVERY' ? `${scheduledFor}T00:00:00.000Z` : undefined,
            rejectReason: !approve ? rejectReason : undefined,
          }, approve ? 'Đã duyệt yêu cầu đổi ô' : 'Đã từ chối yêu cầu', () => close())}>
            {approve ? 'Duyệt' : 'Xác nhận từ chối'}
          </Button>
        </>}>
        {dlg && (
          <div className="space-y-4">
            <div className="flex items-center gap-3"><SwapUnits from={unitLabel(db, dlg.s.fromUnitId)} to={unitLabel(db, dlg.s.toUnitId)} /><span className="text-sm text-stone-500">{isResize(dlg.s) ? `${typeName(db, dlg.s.unitTypeId)} → ${typeName(db, dlg.s.toUnitTypeId)}` : typeName(db, dlg.s.unitTypeId)}</span></div>
            {openIntakeOf(db.intakeBatches, dlg.s.contractId) && <Callout tone="amber" icon={<PackageSearch />}>{swapBlockedByIntakeText(openIntakeOf(db.intakeBatches, dlg.s.contractId)!.code)}</Callout>}
            {/* Đổi cỡ kho: giá / tiền giữ chân mới đã chốt theo phụ lục khách xác nhận — quản lý chỉ duyệt và đặt phí thao tác. */}
            {/* Góp ý 17/11: tiền khi đổi cỡ tách từng khoản (cùng nguồn với form khách và email duyệt). */}
            {dlg.s.sizeChange && (
              <Callout tone="blue" icon={<Ruler />} title={`Đổi cỡ kho ${typeName(db, dlg.s.unitTypeId)} → ${typeName(db, dlg.s.toUnitTypeId)} — khách đã xác nhận Phụ lục`}>
                <SizeChangeMoney x={dlg.s.sizeChange} className="mt-2" />
              </Callout>
            )}
            {!!dlg.s.moveItems?.length && (
              <div className="rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                <p className="mb-1.5 text-sm font-semibold text-ink">Đồ khách nhờ chi nhánh chuyển · {swapMoveItemsCount(dlg.s.moveItems)} món / kiện</p>
                <MoveItemsList items={dlg.s.moveItems} />
              </div>
            )}
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
                  <>
                    <Field label="Ngày cử người chuyển" hint="Khách thấy ngày này. Lúc hoàn tất ghi người thực hiện.">
                      <input type="date" className={inputCls} min={new Date().toISOString().slice(0, 10)} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                    </Field>
                    {!isFreeSwap({ facilityFault, isFirstSwap: isFirstSwap(dlg.s) }) && Number(fee.replace(/\D/g, '')) > 0 && (
                      <Callout tone="amber" icon={<Banknote />}>Khách phải trả phí (online hoặc tại quầy) trước khi xác nhận đã chuyển.</Callout>
                    )}
                  </>
                )}
                {dlg.s.method === 'SELF' && <Callout tone="gray" icon={<Timer />}>Duyệt xong khách có 7 ngày để tự chuyển đồ sang ô mới, quá hạn yêu cầu sẽ tự hủy.</Callout>}
              </>
            ) : (
              <Field label="Lý do từ chối"><textarea className={inputCls} rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></Field>
            )}
          </div>
        )}
      </Modal>

      <Modal open={dlg?.kind === 'reschedule'} onClose={close} title={`Dời ngày chuyển ${dlg?.s.requestNumber ?? ''}`} description="Khách được email báo ngày mới. Phí đã trả giữ nguyên."
        footer={<><Button variant="secondary" onClick={close}>Đóng</Button><Button disabled={!scheduledFor} onClick={() => dlg && void run('rescheduleSwapDelivery', { swapRequestId: dlg.s._id, scheduledFor: `${scheduledFor}T00:00:00.000Z` }, 'Đã dời ngày chuyển', close)}>Lưu ngày mới</Button></>}>
        <Field label="Ngày chuyển mới">
          <input type="date" className={inputCls} min={new Date().toISOString().slice(0, 10)} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={dlg?.kind === 'collect'} onClose={close} title="Thu phí thuê người chuyển tại quầy"
        description={dlg ? `${userName(db, dlg.s.customerId)} · ${dlg.s.requestNumber}` : ''}
        footer={<>
          <Button variant="secondary" onClick={close}>Đóng</Button>
          <Button disabled={!collectSel} onClick={() => dlg && collectSel && void run('paySwapFee', { swapRequestId: dlg.s._id, method: collectSel.payMethod, gatewayTxnRef: collectSel.payMethod === 'VNPAY' ? collectSel.gatewayTxnRef : undefined, expectedFee: dlg.s.fee }, (v) => (v.replayed ? 'Phí đã được thu trước đó, không thu thêm' : `Đã thu ${vnd(v.amount)} tại quầy${collectSel.payMethod === 'VNPAY' ? ' qua VNPAY' : ''}`), () => close())}>
            <Banknote className="size-4" />Xác nhận đã thu {vnd(dlg?.s.fee ?? 0)}
          </Button>
        </>}>
        <div className="space-y-4 text-sm">
          {dlg?.kind === 'collect' && (
            <CounterPayment amount={dlg.s.fee} target={{ purpose: 'SWAP_FEE', swapRequestId: dlg.s._id }} value={collectSel} onChange={setCollectSel} />
          )}
        </div>
      </Modal>

      <Modal open={dlg?.kind === 'complete'} onClose={close} title="Xác nhận đã chuyển xong"
        description={dlg ? `${unitLabel(db, dlg.s.fromUnitId)} → ${unitLabel(db, dlg.s.toUnitId)}${dlg.s.fee ? ` · phí ${vnd(dlg.s.fee)}` : ' · miễn phí'}` : ''}
        footer={<Button onClick={() => {
          if (!dlg) return;
          // B1: ô mới khoá chìa / thẻ → bắt buộc mã chìa / số thẻ mới (server cũng chặn 422 KEYTAG_REQUIRED).
          if (byId(db.units, dlg.s.toUnitId)?.accessMethod !== 'PIN' && !keyTag.trim()) { setTried(true); return; }
          // Thuê người chuyển: bắt buộc người thực hiện (server cũng chặn 422 PERFORMED_BY_REQUIRED).
          const delivery = dlg.s.method === 'DELIVERY';
          if (delivery && !isValidPerformedBy(performedBy)) { setTried(true); return; }
          // RV3: biên bản chuyển đồ — số kiện + ít nhất 1 ảnh (server cũng chặn 422 MOVE_CHECK_REQUIRED).
          const photos = parsePhotoLinks(movePhotos).urls;
          if (delivery && (movePackages < 1 || !photos.length)) { setTried(true); return; }
          // Góp ý 17/11: có danh sách đồ cần chuyển → tick ít nhất một món; chưa tick hết thì ghi chú lý do (server: MOVE_ITEMS_REQUIRED / MOVE_ITEMS_NOTE_REQUIRED).
          const listed = delivery ? dlg.s.moveItems ?? [] : [];
          if (listed.length && (!movedIds.length || (movedIds.length < listed.length && !moveNote.trim()))) { setTried(true); return; }
          // Chưa tick đã thu chìa / thẻ cũ → popup nhắc nhân viên nhận lại trước khi xác nhận.
          if (!oldReset && byId(db.contracts, dlg.s.contractId)?.access.method) { setRemindOld(true); return; }
          finishComplete(oldReset);
        }}>Xác nhận</Button>}>
        <p className="text-sm text-stone-600">Khách đã dọn hết đồ sang ô mới và trả ô cũ? Ô cũ chuyển sang chờ kiểm tra.</p>
        {dlg?.kind === 'complete' && (() => {
          // Đợt 16 (B1): đổi ô luôn cấp phương tiện mở MỚI như nhận kho; ô cũ chờ thu chìa / thẻ cũ hoặc đặt lại ổ khoá.
          const c = byId(db.contracts, dlg.s.contractId);
          return (
            <div className="mt-3">
              <NewAccessFields oldMethod={c?.access.method} oldKeyTag={c?.access.keyTag} newMethod={byId(db.units, dlg.s.toUnitId)?.accessMethod}
                keyTag={keyTag} onKeyTag={setKeyTag} oldReset={oldReset} onOldReset={setOldReset} showError={tried} />
            </div>
          );
        })()}
        {dlg?.kind === 'complete' && dlg.s.method === 'DELIVERY' && (
          <Field className="mt-3" label="Người thực hiện" hint="Tên người chuyển đồ, cách nhau bằng dấu phẩy. Khách không thấy." error={tried && !isValidPerformedBy(performedBy) ? PERFORMED_BY_MESSAGE : undefined}>
            <input className={inputCls} value={performedBy} maxLength={PERFORMED_BY_MAX} onChange={(e) => setPerformedBy(e.target.value)} placeholder="Nguyễn Văn A, Trần Văn B" />
          </Field>
        )}
        {dlg?.kind === 'complete' && dlg.s.method === 'DELIVERY' && (
          <div className="mt-3 space-y-3 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
            <p className="text-sm font-semibold text-ink">Biên bản chuyển đồ</p>
            <p className="text-xs text-stone-600">Chi nhánh chịu trách nhiệm hư hại, mất mát lúc chuyển. Đếm kiện và chụp ảnh đồ tại ô mới để đối chiếu (khách xem được).</p>
            {!!dlg.s.moveItems?.length && (() => {
              const items = dlg.s.moveItems;
              const all = movedIds.length === items.length;
              return (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-stone-700">Đồ khách nhờ chuyển — tick món đã chuyển sang ô mới ({movedIds.length}/{items.length})</span>
                    <Button size="sm" variant="ghost" onClick={() => setMovedIds(all ? [] : items.map((it) => it.itemId))}>{all ? 'Bỏ tick tất cả' : 'Tick tất cả'}</Button>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {items.map((it) => (
                      <CheckLine key={it.itemId} checked={movedIds.includes(it.itemId)} onChange={(v) => setMovedIds((ids) => (v ? [...ids, it.itemId] : ids.filter((x) => x !== it.itemId)))}>
                        {swapMoveItemLabel(it)} <span className="text-xs text-stone-500">· đợt {it.batchCode}</span>
                      </CheckLine>
                    ))}
                  </div>
                  {tried && !movedIds.length && <p className="mt-1 text-xs font-medium text-red-700">Tick các món đã chuyển</p>}
                  {movedIds.length > 0 && movedIds.length < items.length && <p className="mt-1 text-xs font-medium text-amber-800">Còn {items.length - movedIds.length} món chưa tick — ghi chú lý do bên dưới (khách xem được trong biên bản).</p>}
                </div>
              );
            })()}
            <Field label="Số kiện / món đã chuyển" error={tried && movePackages < 1 ? 'Nhập số kiện đã chuyển' : undefined}>
              <input type="number" min={1} max={999} className={inputCls} value={movePackages || ''} onChange={(e) => setMovePackages(Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0))))} />
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-stone-700">Ảnh đồ tại ô mới</span>
              <PhotoUploadInput max={20} required value={movePhotos} onChange={setMovePhotos} />
              {tried && !parsePhotoLinks(movePhotos).urls.length && <p className="mt-1 text-xs font-medium text-red-700">Chụp ít nhất 1 ảnh</p>}
            </div>
            <Field label={dlg.s.moveItems?.length && movedIds.length < dlg.s.moveItems.length ? 'Tình trạng / ghi chú (bắt buộc: lý do món chưa chuyển)' : 'Tình trạng / ghi chú (không bắt buộc)'}
              error={tried && !!dlg.s.moveItems?.length && movedIds.length > 0 && movedIds.length < dlg.s.moveItems.length && !moveNote.trim() ? 'Ghi lý do món chưa chuyển' : undefined}>
              <input className={inputCls} maxLength={500} value={moveNote} onChange={(e) => setMoveNote(e.target.value)} placeholder="VD: 1 thùng móp góc từ trước, khách đã xem" />
            </Field>
          </div>
        )}
        {dlg?.s.fee ? <p className="mt-2 text-sm">{dlg.s.feePrepay ? <>Phí <b>{vnd(dlg.s.fee)}</b> khách đã trả trước.</> : <>Phí <b>{vnd(dlg.s.fee)}</b> sẽ được cộng vào công nợ của khách.</>}</p> : null}
        {dlg?.kind === 'complete' && dlg.s.sizeChange && (
          <Callout tone="blue" icon={<Banknote />} className="mt-3" title="Đổi cỡ kho — tiền tính khi xác nhận">
            <SizeChangeMoney x={dlg.s.sizeChange} className="mt-2" />
            <p className="mt-2">Xác nhận xong, hợp đồng sang loại mới và hệ thống tự ghi phần chênh tính theo hôm nay (thu thêm cộng vào công nợ; hoàn theo cách khách đã trả). Hợp đồng còn công nợ thì thu xong trước.</p>
          </Callout>
        )}
      </Modal>
      {dlg?.kind === 'complete' && (() => {
        const oc = byId(db.contracts, dlg.s.contractId);
        return (
          <AccessResetReminder open={remindOld} onClose={() => setRemindOld(false)} method={oc?.access.method} keyTag={oc?.access.keyTag}
            unit={unitLabel(db, dlg.s.fromUnitId)} customer={oc ? userName(db, oc.customerId) : undefined}
            onCollected={() => { setOldReset(true); setRemindOld(false); finishComplete(true); }}
            onLater={() => { setRemindOld(false); finishComplete(false); }} />
        );
      })()}
    </>
  );
}
