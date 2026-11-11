'use client';

import { useState } from 'react';
import { ArrowRight, Banknote, Building2, CalendarDays, CircleCheck, Clock, Gift, Hand, MessageSquareText, PackageSearch, Repeat, Ruler, Timer, Truck, UserRound, Warehouse } from 'lucide-react';
import { defaultSwapFee, isFreeSwap, isValidPerformedBy, normalizePerformedBy, openIntakeOf, PERFORMED_BY_MAX, PERFORMED_BY_MESSAGE, sizeChangeNote, swapBlockedByIntakeText, SWAP_FEE_MAX, swapFeeDue, type CounterPayMethod, type UnitSwapRequest } from '@ssm/shared';
import { isTxnRef, type SwapCompleteSizeChange } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { SWAP_METHOD, SWAP_REQUEST_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { Callout, CheckLine, Fact, FactGrid, Meta, QueueRow, UnitTag } from '@/features/staff-ui';
import { NewAccessFields } from '@/features/access/unit-access-fields';
import { PhotoLinks, PhotoUploadInput, parsePhotoLinks } from '@/shared/ui/photo-links';
import { CounterPayPicker, counterMethodPhrase, counterTxnPlaceholder } from '@/features/payments/pay-method';

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
  const [tried, setTried] = useState(false);
  // Thuê người chuyển: quản lý chia việc ngoài hệ thống, lúc hoàn tất ghi người thực hiện.
  const [performedBy, setPerformedBy] = useState('');
  // RV3: biên bản chuyển đồ khi chi nhánh chuyển (DELIVERY).
  const [movePackages, setMovePackages] = useState(0);
  const [movePhotos, setMovePhotos] = useState('');
  const [moveNote, setMoveNote] = useState('');
  const [collectMethod, setCollectMethod] = useState<CounterPayMethod>('CASH');
  const [collectRef, setCollectRef] = useState('');
  const [collected, setCollected] = useState(false);
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
    setApprove(true); setFacilityFault(false); setFee(String(defaultSwapFee({ facilityFault: false, isFirstSwap: isFirstSwap(s), method: s.method }))); setScheduledFor(''); setRejectReason('');
    setDlg({ kind: 'decide', s });
  };
  const openCollect = (s: UnitSwapRequest) => {
    setCollectMethod('CASH'); setCollectRef(''); setCollected(false);
    setDlg({ kind: 'collect', s });
  };
  const collectTxnOk = collectMethod === 'CASH' || isTxnRef(collectRef);

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
            {/* Dữ liệu cũ còn tên người được phân công: vẫn hiện. Từ nay quản lý chia việc ngoài hệ thống, người thực hiện ghi lúc hoàn tất. */}
            {s.moveCheck && <Meta icon={<Truck />}>Đã chuyển {s.moveCheck.packages} kiện</Meta>}
            {s.moveCheck && <PhotoLinks urls={s.moveCheck.photoUrls} />}
            {s.performedBy
              ? <Meta icon={<UserRound />} className="font-medium text-stone-700">Người thực hiện: {s.performedBy}</Meta>
              : s.assignedStaffName && <Meta icon={<UserRound />} className="font-medium text-stone-700">{s.assignedStaffName}</Meta>}
            {s.scheduledFor && <Meta icon={<CalendarDays />}>Ngày chuyển {fmtDate(s.scheduledFor)}</Meta>}
            {s.feePrepay && s.fee > 0 && (s.paymentId
              ? <Badge tone={s.feeRefundPaymentId ? 'gray' : 'green'}>{s.feeRefundPaymentId ? `${byId(db.payments, s.feeRefundPaymentId)?.status === 'PENDING' ? 'Đang hoàn phí' : 'Đã hoàn phí'} ${vnd(s.fee)}` : `Đã trả phí ${vnd(s.fee)}`}</Badge>
              : s.status === 'APPROVED' && <Badge tone="amber">Chưa trả phí {vnd(s.fee)}</Badge>)}
          </>}
      </>}
      actions={<>
        {s.status === 'SUBMITTED' && isFM && <Button size="sm" onClick={() => openDecide(s)}>Xét duyệt</Button>}
        {swapFeeDue(s) > 0 && <Button size="sm" variant="secondary" onClick={() => openCollect(s)}><Banknote className="size-3.5" />Thu phí tại quầy</Button>}
        {s.status === 'APPROVED' && s.method === 'DELIVERY' && isFM && <Button size="sm" variant="secondary" onClick={() => { setScheduledFor(s.scheduledFor ? s.scheduledFor.slice(0, 10) : ''); setDlg({ kind: 'reschedule', s }); }}><CalendarDays className="size-3.5" />Dời ngày</Button>}
        {s.status === 'APPROVED' && isFM && <Button size="sm" variant="dangerOutline" onClick={() => { if (window.confirm(`Huỷ yêu cầu ${s.requestNumber}? Ô đang giữ cho yêu cầu này sẽ được nhả${s.feePrepay && s.paymentId ? `, phí đã trả ${vnd(s.fee)} được hoàn đủ` : ''}.`)) void run('cancelSwapRequest', { swapRequestId: s._id }, 'Đã huỷ yêu cầu đổi ô — ô đích trống trở lại'); }}>Huỷ</Button>}
        {/* Phí trả trước chưa trả: khoá nút, server cũng chặn 422 SWAP_FEE_UNPAID. */}
        {s.status === 'APPROVED' && <Button size="sm" variant="secondary" disabled={swapFeeDue(s) > 0 || !!openIntakeOf(db.intakeBatches, s.contractId)} title={swapFeeDue(s) > 0 ? 'Khách chưa trả phí thuê người chuyển' : openIntakeOf(db.intakeBatches, s.contractId) ? swapBlockedByIntakeText(openIntakeOf(db.intakeBatches, s.contractId)!.code) : undefined} onClick={() => { setKeyTag(''); setOldReset(false); setTried(false); setPerformedBy(''); setMovePackages(0); setMovePhotos(''); setMoveNote(''); setDlg({ kind: 'complete', s }); }}><CircleCheck className="size-3.5" />Xác nhận đã chuyển</Button>}
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
                  <>
                    <Field label="Ngày cử người chuyển" hint="Khách thấy ngày này. Chia việc cho ai do quản lý sắp xếp ngoài hệ thống; lúc hoàn tất ghi người thực hiện.">
                      <input type="date" className={inputCls} min={new Date().toISOString().slice(0, 10)} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                    </Field>
                    {!isFreeSwap({ facilityFault, isFirstSwap: isFirstSwap(dlg.s) }) && Number(fee.replace(/\D/g, '')) > 0 && (
                      <Callout tone="amber" icon={<Banknote />}>Khách phải trả phí trước khi chuyển (online hoặc tại quầy). Chưa trả thì chưa xác nhận đã chuyển được.</Callout>
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
          <Button disabled={!collected || !collectTxnOk} onClick={() => dlg && void run('paySwapFee', { swapRequestId: dlg.s._id, method: collectMethod, txnRef: collectRef, expectedFee: dlg.s.fee }, (v) => (v.replayed ? 'Phí đã được thu trước đó, không thu thêm' : `Đã thu ${vnd(v.amount)} tại quầy`), () => close())}>
            <Banknote className="size-4" />Xác nhận đã thu {vnd(dlg?.s.fee ?? 0)}
          </Button>
        </>}>
        <div className="space-y-4 text-sm">
          <Field label="Hình thức thu"><CounterPayPicker value={collectMethod} onChange={(m) => { setCollectMethod(m); setCollected(false); }} /></Field>
          {collectMethod !== 'CASH' && (
            <Field label="Mã giao dịch">
              <input className={inputCls} value={collectRef} maxLength={64} onChange={(e) => setCollectRef(e.target.value)} placeholder={counterTxnPlaceholder(collectMethod)} />
            </Field>
          )}
          <CheckLine checked={collected} onChange={setCollected}>Đã nhận đủ <b>{vnd(dlg?.s.fee ?? 0)}</b> ({counterMethodPhrase(collectMethod)}).</CheckLine>
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
          void run('completeSwapRequest', { swapRequestId: dlg.s._id, keyTag: keyTag.trim(), oldAccessReset: oldReset, performedBy: delivery ? normalizePerformedBy(performedBy) : undefined,
            moveCheck: delivery ? { packages: movePackages, photoUrls: photos, note: moveNote.trim() || undefined } : undefined },
            (r) => [r.sizeChange ? resizeDoneText(r.sizeChange) : null, r.pin ? `Mật khẩu mới của ô: ${r.pin} (khách cũng xem được trong tài khoản)` : 'Đã giao phương tiện mở kho mới', oldReset ? null : 'ô cũ chờ ghi nhận thu chìa / thẻ (trang Kho)'].filter(Boolean).join(' · '), () => close());
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
          <Field className="mt-3" label="Người thực hiện" hint="Ghi tên người đã chuyển đồ, nhiều người thì cách nhau bằng dấu phẩy. Khách không thấy thông tin này." error={tried && !isValidPerformedBy(performedBy) ? PERFORMED_BY_MESSAGE : undefined}>
            <input className={inputCls} value={performedBy} maxLength={PERFORMED_BY_MAX} onChange={(e) => setPerformedBy(e.target.value)} placeholder="Nguyễn Văn A, Trần Văn B" />
          </Field>
        )}
        {dlg?.kind === 'complete' && dlg.s.method === 'DELIVERY' && (
          <div className="mt-3 space-y-3 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
            <p className="text-sm font-semibold text-ink">Biên bản chuyển đồ</p>
            <p className="text-xs text-stone-600">Chi nhánh chuyển nên chi nhánh chịu trách nhiệm hư hại / mất mát trong lúc chuyển. Đếm số kiện và chụp ảnh đồ tại ô mới — khách xem được và dùng để đối chiếu nếu báo hư hại.</p>
            <Field label="Số kiện / món đã chuyển" error={tried && movePackages < 1 ? 'Nhập số kiện đã chuyển' : undefined}>
              <input type="number" min={1} max={999} className={inputCls} value={movePackages || ''} onChange={(e) => setMovePackages(Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0))))} />
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-stone-700">Ảnh đồ tại ô mới</span>
              <PhotoUploadInput max={20} required value={movePhotos} onChange={setMovePhotos} />
              {tried && !parsePhotoLinks(movePhotos).urls.length && <p className="mt-1 text-xs font-medium text-red-700">Chụp ít nhất 1 ảnh</p>}
            </div>
            <Field label="Tình trạng / ghi chú (không bắt buộc)">
              <input className={inputCls} maxLength={500} value={moveNote} onChange={(e) => setMoveNote(e.target.value)} placeholder="VD: 1 thùng móp góc từ trước, khách đã xem" />
            </Field>
          </div>
        )}
        {dlg?.s.fee ? <p className="mt-2 text-sm">{dlg.s.feePrepay ? <>Phí <b>{vnd(dlg.s.fee)}</b> khách đã trả trước.</> : <>Phí <b>{vnd(dlg.s.fee)}</b> sẽ được cộng vào công nợ của khách.</>}</p> : null}
        {dlg?.kind === 'complete' && sizeChangeNote(dlg.s) && (
          <Callout tone="blue" icon={<Banknote />} className="mt-3">
            {sizeChangeNote(dlg.s)} Xác nhận xong, hợp đồng sang loại mới và hệ thống tự ghi phần chênh tính theo hôm nay (thu thêm cộng vào công nợ; hoàn theo cách khách đã trả). Hợp đồng còn công nợ thì thu xong trước.
          </Callout>
        )}
      </Modal>
    </>
  );
}
