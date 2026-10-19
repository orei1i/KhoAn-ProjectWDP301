'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, HandCoins, KeyRound, LifeBuoy, Lock, PackageOpen, RefreshCw, Repeat, Trash2, UserCheck } from 'lucide-react';
import type { PaymentMethod, RentalContract, SwapMethod } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, CONTRACT_STATUS, DEPOSIT_STATUS, SWAP_METHOD, SWAP_REQUEST_STATUS } from '@/shared/lib/labels';
import { byId, earlyTerminationPreview, facilityName, typeName, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { canDisputeInspection, contractClawback, delinquencyAlert, INSPECTION_DISPUTE_DAYS, isClosedContract, handoverDeadline, isValidPhone, lastDayOf, MAX_AUTHORIZED_PERSONS, MAX_MOVE_OUT_LEAD_DAYS, OPEN_CONTRACT_STATUSES, OPEN_SWAP_STATUSES, PERIOD_UNIT, paymentDueDate, periodLabel } from '@ssm/shared';
import { Badge, Button, ButtonLink, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, cx, inputCls } from '@/shared/ui';
import { PayMethodPicker } from '@/features/payments/pay-method';
import { AccessPanel } from '@/features/access/access-panel';
import { AppendixText, ExtensionQuoteSummary, useExtensionQuote } from '@/features/contracts/extension-quote';
import { api } from '@/shared/api/client';
import { FloorPlanPicker, type FloorPlanUnit } from '@/features/facilities/floor-plan-picker';
import { ContractFileActions } from '@/features/contracts/contract-file-actions';
import { ContractNotices } from '@/features/contracts/contract-notices';
import { InspectionReport } from '@/features/contracts/inspection-report';

type Dialog = { kind: 'pay' | 'extend' | 'moveout' | 'swap' | 'authorized' | 'access' | 'appendix' | 'inspection'; c: RentalContract } | null;
const EMPTY_PERSON = { fullName: '', phone: '', idNumberLast4: '', relationship: '' };

export default function MyUnits() {
  const { db, user, run } = useStore();
  const [dlg, setDlg] = useState<Dialog>(null);
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');
  const [periods, setPeriods] = useState(3);
  const ext = useExtensionQuote(dlg?.kind === 'extend' ? dlg.c._id : undefined, periods);
  // Khách phải tick xác nhận Phụ lục gia hạn; đổi số kỳ (phụ lục khác) thì phải xác nhận lại.
  const [agree, setAgree] = useState(false);
  useEffect(() => { setAgree(false); }, [periods, dlg?.kind, dlg?.c._id]);
  const downloadAppendix = async (c: RentalContract, n: number) => {
    const blob = await api.blob(`/contracts/${c._id}/appendices/${n}.pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `phu-luc-${String(n).padStart(2, '0')}-${c.contractNumber}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };
  const [date, setDate] = useState(addDays(todayISO(), 3).slice(0, 10));
  const [swapCandidates, setSwapCandidates] = useState<FloorPlanUnit[] | null>(null);
  const [swapUnitId, setSwapUnitId] = useState<string | null>(null);
  const [swapMethod, setSwapMethod] = useState<SwapMethod>('SELF');
  const [swapReason, setSwapReason] = useState('');
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [dispute, setDispute] = useState('');
  if (!user) return null;
  const contracts = db.contracts.filter((c) => c.customerId === user._id)
    .sort((a, b) => (OPEN_CONTRACT_STATUSES.includes(a.status) ? 0 : 1) - (OPEN_CONTRACT_STATUSES.includes(b.status) ? 0 : 1));
  const close = () => setDlg(null);
  /** Biên bản kiểm tra khi trả kho (Điều 9) — khách xem chi tiết và khiếu nại trong hạn. */
  const moveOutInspection = (c: RentalContract) => db.inspections.find((i) => i.contractId === c._id && i.type === 'MOVE_OUT');

  // Sơ đồ ô trống cùng loại — tải khi mở dialog đổi ô, không tải sẵn cho mọi hợp đồng.
  useEffect(() => {
    if (dlg?.kind !== 'swap') return;
    let alive = true;
    setSwapCandidates(null); setSwapUnitId(null); setSwapReason(''); setSwapMethod('SELF');
    api.get<{ items: FloorPlanUnit[] }>(`/contracts/${dlg.c._id}/swap-candidates`).then((d) => alive && setSwapCandidates(d.items));
    return () => { alive = false; };
  }, [dlg]);

  return (
    <>
      <PageHeader title="Kho đang thuê" description="Thanh toán, gia hạn hoặc đăng ký trả kho. Mọi thay đổi được ghi vào hợp đồng điện tử." />
      {contracts.length === 0 && <Card><EmptyState title="Bạn chưa có hợp đồng thuê kho" action={<ButtonLink href="/facilities">Tìm kho</ButtonLink>} /></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        {contracts.map((c) => {
          const unit = byId(db.units, c.unitId);
          return (
            <Card key={c._id} className="p-5">
              <div className="flex items-start gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-ink text-sm font-bold text-white">{unitLabel(db, c.unitId)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{typeName(db, c.unitTypeId)}</p>
                    <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                    {unit?.overlockActive && <Badge tone="red"><Lock className="size-3" />Đã gắn khóa chặn</Badge>}
                  </div>
                  <p className="text-sm text-stone-500">{facilityName(db, c.facilityId)} · Tầng {unit?.location.floor} · {c.contractNumber}</p>
                </div>
              </div>
              <div className="mt-4"><KV items={[
                ['Thời hạn', `${fmtDate(c.startDate)} → hết ngày ${fmtDate(lastDayOf(c.endDate))}`],
                ['Tiền thuê', `${vnd(c.billing.rate)}/${PERIOD_UNIT[c.billing.rentalPeriod]}`],
                // Hợp đồng đã đóng không còn kỳ thanh toán nào — chỉ còn (nếu có) khoản nợ sau quyết toán ở dòng Công nợ.
                ...(OPEN_CONTRACT_STATUSES.includes(c.status) ? ([
                  ['Kỳ thanh toán tới', `${fmtDate(c.billing.nextBillingDate)} · ${vnd(c.billing.rate)}`],
                  ['Hạn trả tiền kỳ tới', `${fmtDate(paymentDueDate(c.billing.nextBillingDate, c.terms.gracePeriodDays))} — quá hạn bị tính phí trễ`],
                ] as [string, string][]) : []),
                ['Truy cập', <span key="a" className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" />{ACCESS_METHOD[c.access.method]}{c.access.keyTag ? ` · ${c.access.keyTag}` : ''}</span>],
                ['Tiền giữ chân', <span key="d">{vnd(c.deposit.amount)} · {DEPOSIT_STATUS[c.deposit.status].label}</span>],
                ['Công nợ', <span key="o" className={c.balance.outstanding ? 'text-red-700' : ''}>{vnd(c.balance.outstanding)}</span>],
                ['Hợp đồng đã ký', `${c.terms.signerName ?? '—'} · ${fmtDate(c.terms.signedAt)}`],
              ]} /></div>
              {(() => { const rsv = db.reservations.find((x) => x.contractId === c._id); return rsv ? <ContractFileActions reservation={rsv} /> : null; })()}
              {(() => {
                const openSwap = db.swapRequests.find((s) => s.contractId === c._id && (OPEN_SWAP_STATUSES as readonly string[]).includes(s.status));
                const alert = delinquencyAlert(c);
                return (
                  <>
                    {alert && (
                      <div className={cx('mt-5 rounded-lg px-3 py-2.5 text-sm ring-1', alert.tone === 'red' ? 'bg-red-50 text-red-900 ring-red-200' : 'bg-amber-50 text-amber-950 ring-amber-200')}>
                        <p className="font-semibold">{alert.title}</p>
                        <p className="mt-0.5">{alert.text}</p>
                      </div>
                    )}
                    {(c.notices?.length ?? 0) > 0 && (
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer font-medium text-stone-700">Thông báo từ KhoAn ({c.notices!.length})</summary>
                        <div className="mt-2"><ContractNotices contract={c} limit={5} /></div>
                      </details>
                    )}
                    {isClosedContract(c.status) && c.balance.outstanding > 0 && (
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-200">
                        <span>{c.status === 'ABANDONED' ? 'Hợp đồng đã đóng sau khi xử lý đồ bỏ lại — tiền giữ chân và tiền thanh lý chưa đủ bù công nợ' : 'Hợp đồng đã đóng nhưng chi phí hư hại và công nợ vượt tiền giữ chân'} — bạn còn nợ <b>{vnd(c.balance.outstanding)}</b>. Thanh toán xong mới đặt kho mới được.</span>
                        <Button size="sm" onClick={() => setDlg({ kind: 'pay', c })}>Thanh toán {vnd(c.balance.outstanding)}</Button>
                      </div>
                    )}
                    {(() => {
                      const insp = moveOutInspection(c);
                      return insp ? (
                        <div className="mt-3">
                          <Button size="sm" variant="secondary" onClick={() => { setDispute(''); setDlg({ kind: 'inspection', c }); }}>
                            <ClipboardCheck className="size-3.5" />Biên bản trả kho{canDisputeInspection(insp.performedAt, todayISO()) ? ' · còn hạn khiếu nại' : ''}
                          </Button>
                        </div>
                      ) : null;
                    })()}
                    {OPEN_CONTRACT_STATUSES.includes(c.status) && (
                      <div className="mt-5 flex flex-wrap gap-2 border-t border-stone-100 pt-4">
                        {c.balance.outstanding > 0 && <Button size="sm" onClick={() => setDlg({ kind: 'pay', c })}>Thanh toán {vnd(c.balance.outstanding)}</Button>}
                        <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'access', c })}><KeyRound className="size-3.5" />Mã vào kho</Button>
                        {(c.commitments ?? []).some((s) => s.appendix) && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'appendix', c })}>Phụ lục ({(c.commitments ?? []).filter((s) => s.appendix).length})</Button>}
                        {c.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'extend', c })}><RefreshCw className="size-3.5" />Gia hạn</Button>}
                        {c.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'moveout', c })}><PackageOpen className="size-3.5" />Đăng ký trả kho</Button>}
                        {c.status === 'ACTIVE' && !openSwap && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'swap', c })}><Repeat className="size-3.5" />Đổi ô kho</Button>}
                        <Button size="sm" variant="secondary" onClick={() => { setPerson(EMPTY_PERSON); setDlg({ kind: 'authorized', c }); }}><UserCheck className="size-3.5" />Người được uỷ quyền{(c.authorizedPersons?.length ?? 0) > 0 ? ` (${c.authorizedPersons!.length})` : ''}</Button>
                        {c.status === 'MOVE_OUT_PENDING' && <Badge tone="violet">{c.access.revokedAt ? 'Đã bàn giao — chờ kiểm tra' : `Hẹn trả kho ${fmtDate(c.moveOut?.scheduledFor)} · bàn giao trước hết ngày ${fmtDate(handoverDeadline(c))} để không tính kỳ mới`}</Badge>}
                        {c.status === 'MOVE_OUT_PENDING' && !c.access.revokedAt && <Button size="sm" variant="ghost" onClick={() => void run('cancelMoveOut', { contractId: c._id }, 'Đã rút đăng ký trả kho — hợp đồng tiếp tục hiệu lực')}>Rút đăng ký trả kho</Button>}
                        <ButtonLink href={`/portal/tickets?contract=${c._id}`} size="sm" variant="ghost"><LifeBuoy className="size-3.5" />Báo sự cố</ButtonLink>
                        <ButtonLink href="/portal/claims" size="sm" variant="ghost"><HandCoins className="size-3.5" />Yêu cầu bồi thường</ButtonLink>
                      </div>
                    )}
                    {openSwap && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-violet-50 px-3 py-2.5 text-sm ring-1 ring-violet-200">
                        <span>
                          Yêu cầu đổi ô {openSwap.requestNumber} · <StatusBadge map={SWAP_REQUEST_STATUS} value={openSwap.status} />
                          {openSwap.status === 'APPROVED' && openSwap.method === 'SELF' && openSwap.moveDeadline && <> · hạn chuyển {fmtDate(openSwap.moveDeadline)}</>}
                          {openSwap.status === 'APPROVED' && openSwap.method === 'DELIVERY' && <> · chi nhánh chuyển ngày {fmtDate(openSwap.scheduledFor)}{openSwap.assignedStaffName ? `, nhân viên ${openSwap.assignedStaffName}` : ''}</>}
                        </span>
                        {(openSwap.status === 'SUBMITTED' || openSwap.status === 'APPROVED') && (
                          <Button size="sm" variant="ghost" onClick={() => void run('cancelSwapRequest', { swapRequestId: openSwap._id }, 'Đã rút yêu cầu đổi ô')}>Rút yêu cầu</Button>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </Card>
          );
        })}
      </div>

      <Modal open={dlg?.kind === 'pay'} onClose={close} title="Thanh toán công nợ" description={dlg ? `${unitLabel(db, dlg.c.unitId)} · ${vnd(dlg.c.balance.outstanding)}` : ''}
        footer={<Button onClick={() => dlg && void run('payBalance', { contractId: dlg.c._id, method }, (v) => `Đã thanh toán ${vnd(v)} — truy cập kho được khôi phục`, () => close())}>Thanh toán</Button>}>
        <PayMethodPicker value={method} onChange={setMethod} />
        {dlg?.c.status === 'LOCKED_OUT' && <p className="mt-3 text-sm text-stone-600">Sau khi thanh toán đủ, khóa chặn sẽ được gỡ và mã truy cập hoạt động lại.</p>}
      </Modal>

      <Modal open={dlg?.kind === 'inspection'} onClose={close} size="lg" title="Biên bản trả kho" description={dlg ? `Hợp đồng ${dlg.c.contractNumber} · kho ${unitLabel(db, dlg.c.unitId)}` : ''}>
        {dlg?.kind === 'inspection' && (() => {
          const insp = moveOutInspection(dlg.c);
          if (!insp) return null;
          return (
            <div className="space-y-5">
              <InspectionReport inspection={insp} inspectorName={byId(db.users, insp.inspectorId)?.fullName} />
              <div className="border-t border-stone-100 pt-4">
                {canDisputeInspection(insp.performedAt, todayISO()) ? (
                  <>
                    <Field label="Khiếu nại biên bản" hint={`Trong ${INSPECTION_DISPUTE_DAYS} ngày kể từ ngày lập biên bản. Khiếu nại đúng thì KhoAn giảm chi phí hư hại: trừ vào khoản còn nợ trước, phần còn lại hoàn bằng chuyển khoản.`}>
                      <textarea className={inputCls} rows={3} value={dispute} onChange={(e) => setDispute(e.target.value)} placeholder="VD: Vết trầy ở cửa đã có từ lúc nhận kho." />
                    </Field>
                    <div className="mt-2">
                      <Button disabled={dispute.trim().length < 10}
                        onClick={() => void run('createTicket', { facilityId: dlg.c.facilityId, kind: 'CUSTOMER_ISSUE', category: 'BILLING', priority: 'HIGH', subject: `Khiếu nại biên bản trả kho ${dlg.c.contractNumber}`, description: dispute.trim(), contractId: dlg.c._id }, 'Đã gửi khiếu nại — theo dõi phản hồi ở mục Hỗ trợ', () => close())}>
                        Gửi khiếu nại
                      </Button>
                    </div>
                  </>
                ) : <p className="text-xs text-stone-500">Đã quá hạn khiếu nại {INSPECTION_DISPUTE_DAYS} ngày kể từ ngày lập biên bản — liên hệ chi nhánh nếu cần.</p>}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={dlg?.kind === 'appendix'} onClose={close} size="lg" title="Phụ lục hợp đồng" description={dlg ? `Hợp đồng ${dlg.c.contractNumber} — các phụ lục gia hạn bạn đã xác nhận` : ''}>
        {dlg?.kind === 'appendix' && (
          <div className="space-y-5">
            {(dlg.c.commitments ?? []).filter((s) => s.appendix).map((s) => (
              <div key={s.appendix!.number} className="rounded-xl p-4 ring-1 ring-inset ring-stone-200">
                <AppendixText title={s.appendix!.title} clauses={s.appendix!.clauses} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3 text-xs text-stone-500">
                  <span>Bên B xác nhận điện tử: <b className="text-ink">{s.appendix!.signerName}</b> · {fmtDate(s.appendix!.acceptedAt)} · Bên A xác nhận qua hệ thống KhoAn</span>
                  <Button size="sm" variant="secondary" onClick={() => void downloadAppendix(dlg.c, s.appendix!.number)}>Tải PDF</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={dlg?.kind === 'extend'} onClose={close} size="lg" title="Gia hạn hợp đồng" description={dlg ? `Thời hạn hiện tại: đến hết ngày ${fmtDate(lastDayOf(dlg.c.endDate))}` : ''}
        footer={<Button disabled={!ext.quote || !agree} onClick={() => dlg && ext.quote && void run('extendContract', { contractId: dlg.c._id, periods, method: ext.quote.payNow > 0 ? method : undefined, acceptAppendix: agree },
          (v) => (v > 0 ? `Đã gia hạn ${periodLabel(dlg.c.billing.rentalPeriod, periods)} — thanh toán ${vnd(v)}` : `Đã gia hạn ${periodLabel(dlg.c.billing.rentalPeriod, periods)} — tiền thuê trả theo từng tháng`), () => close())}>{ext.quote && ext.quote.payNow > 0 ? 'Gia hạn & thanh toán' : 'Xác nhận gia hạn'}</Button>}>
        <Field label={dlg ? `Số ${PERIOD_UNIT[dlg.c.billing.rentalPeriod]} gia hạn` : 'Số chu kỳ gia hạn'}>
          <select className={inputCls} value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>{[1, 3, 6, 12].map((m) => <option key={m} value={m}>{dlg ? periodLabel(dlg.c.billing.rentalPeriod, m) : m}</option>)}</select>
        </Field>
        {dlg && <ExtensionQuoteSummary quote={ext.quote} error={ext.error} accepted={agree} onAccept={setAgree} />}
        {ext.quote && ext.quote.payNow > 0 && <div className="mt-4"><PayMethodPicker value={method} onChange={setMethod} /></div>}
      </Modal>

      <Modal open={dlg?.kind === 'access'} onClose={close} size="lg" title="Mã vào kho" description={dlg ? `Kho ${unitLabel(db, dlg.c.unitId)} · ${facilityName(db, dlg.c.facilityId)}` : ''}>
        {dlg?.kind === 'access' && (() => { const live = db.contracts.find((x) => x._id === dlg.c._id) ?? dlg.c; return <AccessPanel c={live} />; })()}
      </Modal>

      <Modal open={dlg?.kind === 'moveout'} onClose={close} title="Đăng ký trả kho"
        footer={<Button onClick={() => dlg && void run('requestMoveOut', { contractId: dlg.c._id, date: `${date}T00:00:00.000Z` }, 'Đã đăng ký trả kho', () => close())}>Xác nhận</Button>}>
        <Field label="Ngày trả kho dự kiến" hint="Nhân viên sẽ kiểm tra kho khi bạn bàn giao chìa khóa. Tiền thuê vẫn được tính đến ngày bạn THỰC TẾ bàn giao kho, và mức hoàn tiền giữ chân cũng tính theo ngày đó — không theo ngày hẹn. Chưa bàn giao thì bạn rút đăng ký được bất cứ lúc nào.">
          <input type="date" className={inputCls} min={todayISO().slice(0, 10)} max={addDays(todayISO(), MAX_MOVE_OUT_LEAD_DAYS).slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {dlg && (() => {
          // Mốc 00:00 ngày thu kỳ kế tiếp là lúc phát sinh tiền thuê kỳ mới — bàn giao trước mốc này thì không bị tính thêm kỳ.
          const deadline = handoverDeadline(dlg.c);
          const late = `${date}T00:00:00.000Z` > deadline;
          return (
            <p className={cx('mt-2 rounded-lg p-3 text-xs leading-relaxed', late ? 'bg-amber-50 text-amber-900' : 'bg-stone-50 text-stone-700')}>
              Bàn giao kho trước <strong>hết ngày {fmtDate(deadline)}</strong> để không phát sinh tiền thuê kỳ mới
              {late ? ` — ngày hẹn này sau mốc đó nên kỳ thuê bắt đầu ${fmtDate(dlg.c.billing.nextBillingDate)} vẫn được tính tiền.` : '.'} Hẹn trước tối đa {MAX_MOVE_OUT_LEAD_DAYS} ngày.
            </p>
          );
        })()}
        {dlg && (() => {
          const preview = earlyTerminationPreview(db, dlg.c, `${date}T00:00:00.000Z`);
          const rsv = byId(db.reservations, dlg.c.reservationId);
          const claw = contractClawback(dlg.c, rsv?.quote, db.policies, `${date}T00:00:00.000Z`);
          return preview && (
            <div className={cx('mt-3 space-y-1.5 rounded-lg p-3 text-xs leading-relaxed', preview.refundCapPct === 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900')}>
              <p>
                Trả kho sớm — nếu bàn giao đúng ngày này thì bạn đã dùng {preview.elapsedPct}% kỳ hạn thuê, tiền giữ chân được hoàn tối đa <strong>{preview.refundCapPct}%</strong> (càng gần hết hạn càng được hoàn nhiều)
                {preview.refundCapPct === 0 ? ' (không hoàn tiền giữ chân)' : ''}, chưa kể trừ chi phí hư hại nếu có.
              </p>
              {claw && (
                <p>
                  Thu hồi ưu đãi thuê dài hạn: bạn mới dùng {claw.usedPeriods} tháng nên chỉ được giảm {vnd(claw.entitledPerPeriod)}/tháng thay vì {vnd(claw.discountPerPeriod)}/tháng —
                  phần đã hưởng vượt <strong>{vnd(claw.amount)}</strong> sẽ trừ vào tiền giữ chân được hoàn.
                </p>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={dlg?.kind === 'authorized'} onClose={close} size="lg" title="Người được uỷ quyền ra vào kho"
        description={dlg ? `Kho ${unitLabel(db, dlg.c.unitId)} · tối đa ${MAX_AUTHORIZED_PERSONS} người` : ''}>
        {dlg?.kind === 'authorized' && (() => {
          const c = db.contracts.find((x) => x._id === dlg.c._id) ?? dlg.c; // lấy bản mới nhất sau mỗi lần thêm / xoá
          const list = c.authorizedPersons ?? [];
          const valid = person.fullName.trim().length >= 2 && isValidPhone(person.phone.trim()) && /^\d{4}$/.test(person.idNumberLast4);
          return (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-stone-600">Người có tên dưới đây được thay bạn ra vào và lấy đồ. Khi họ đến chi nhánh, nhân viên đối chiếu họ tên và 4 số cuối giấy tờ tùy thân. Bạn chịu trách nhiệm về việc người được uỷ quyền làm tại ô kho và có thể xoá bất cứ lúc nào.</p>
              {list.length === 0 ? <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-500">Chưa uỷ quyền cho ai.</p> : (
                <ul className="divide-y divide-stone-100 rounded-lg ring-1 ring-stone-200">
                  {list.map((p) => (
                    <li key={p._id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div><p className="font-medium">{p.fullName}{p.relationship ? <span className="font-normal text-stone-500"> · {p.relationship}</span> : null}</p><p className="text-xs text-stone-500">{p.phone} · giấy tờ •••• {p.idNumberLast4} · thêm {fmtDate(p.addedAt)}</p></div>
                      <button type="button" aria-label={`Xoá uỷ quyền của ${p.fullName}`} onClick={() => { if (window.confirm(`Xoá uỷ quyền của ${p.fullName}?`)) void run('removeAuthorizedPerson', { contractId: c._id, personId: p._id }, 'Đã xoá uỷ quyền'); }}
                        className="grid size-8 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-600"><Trash2 className="size-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {c.status !== 'CLOSED' && list.length < MAX_AUTHORIZED_PERSONS && (
                <div className="grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-2">
                  <Field label="Họ tên"><input className={inputCls} maxLength={100} value={person.fullName} onChange={(e) => setPerson({ ...person, fullName: e.target.value })} /></Field>
                  <Field label="Số điện thoại"><input className={inputCls} inputMode="tel" maxLength={15} value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} placeholder="09xxxxxxxx" /></Field>
                  <Field label="4 số cuối giấy tờ tùy thân" hint="CCCD / hộ chiếu của người được uỷ quyền"><input className={inputCls} inputMode="numeric" maxLength={4} value={person.idNumberLast4} onChange={(e) => setPerson({ ...person, idNumberLast4: e.target.value.replace(/\D/g, '') })} /></Field>
                  <Field label="Quan hệ (không bắt buộc)"><input className={inputCls} maxLength={60} value={person.relationship} onChange={(e) => setPerson({ ...person, relationship: e.target.value })} placeholder="Vợ / chồng, nhân viên…" /></Field>
                  <div className="sm:col-span-2"><Button disabled={!valid} onClick={() => void run('addAuthorizedPerson', { contractId: c._id, ...person, fullName: person.fullName.trim(), phone: person.phone.trim() }, 'Đã thêm người được uỷ quyền', () => setPerson(EMPTY_PERSON))}><UserCheck className="size-4" />Thêm người được uỷ quyền</Button></div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={dlg?.kind === 'swap'} onClose={close} size="lg" title="Yêu cầu đổi ô kho"
        description="Gửi yêu cầu để Quản lý chi nhánh xét duyệt. Giá thuê và tiền giữ chân giữ nguyên vì chỉ đổi sang ô cùng loại."
        footer={<Button disabled={!swapUnitId || swapReason.trim().length < 5} onClick={() => dlg && swapUnitId && void run(
          'requestUnitSwap', { contractId: dlg.c._id, toUnitId: swapUnitId, method: swapMethod, reason: swapReason },
          (r) => `Đã gửi yêu cầu ${r.requestNumber} — chờ chi nhánh xét duyệt`, () => close(),
        )}>Gửi yêu cầu</Button>}>
        <div className="space-y-4">
          <Field label="Chọn ô mới trên sơ đồ">
            {swapCandidates === null ? <p className="text-sm text-stone-500">Đang tải sơ đồ…</p> : <FloorPlanPicker items={swapCandidates} value={swapUnitId} onChange={setSwapUnitId} />}
            {(() => {
              // Hình thức khoá thuộc về từng ô: chọn ô khác khoá thì báo trước để khách không bất ngờ.
              const lock = swapCandidates?.find((u) => u._id === swapUnitId)?.accessMethod;
              return dlg && lock && lock !== dlg.c.access.method ? (
                <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
                  Ô này khoá bằng <b>{ACCESS_METHOD[lock]}</b>, khác ô bạn đang thuê ({ACCESS_METHOD[dlg.c.access.method]}). Khi đổi xong, {ACCESS_METHOD[dlg.c.access.method].toLowerCase()} cũ hết hiệu lực và chi nhánh cấp {ACCESS_METHOD[lock].toLowerCase()} mới cho bạn.
                </p>
              ) : null;
            })()}
          </Field>
          <Field label="Hình thức chuyển">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(SWAP_METHOD) as SwapMethod[]).map((m) => (
                <button key={m} type="button" onClick={() => setSwapMethod(m)} className={cx('rounded-lg py-2 text-sm font-medium ring-1 ring-inset', swapMethod === m ? 'bg-ink text-white ring-ink' : 'ring-stone-300 hover:bg-stone-50')}>{SWAP_METHOD[m]}</button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-stone-500">{swapMethod === 'SELF' ? 'Sau khi được duyệt, bạn có 7 ngày để tự chuyển đồ sang ô mới.' : 'Chi nhánh sẽ liên hệ hẹn ngày cử người chuyển giúp bạn.'}</p>
          </Field>
          <Field label="Lý do muốn đổi ô" hint="Tối thiểu 5 ký tự.">
            <textarea className={inputCls} rows={3} value={swapReason} onChange={(e) => setSwapReason(e.target.value)} placeholder="VD: Muốn đổi sang ô gần cửa ra vào hơn để dễ chở đồ." />
          </Field>
          <p className="text-xs text-stone-500">Phí đổi ô (nếu có) sẽ được chi nhánh thông báo khi duyệt — miễn phí nếu là lần đổi đầu tiên hoặc do lỗi từ chi nhánh.</p>
        </div>
      </Modal>
    </>
  );
}
