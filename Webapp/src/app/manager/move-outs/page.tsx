'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, ClipboardCheck, FileText, Hammer, PackageOpen, Plus, RotateCcw, ShieldCheck, Trash2, Undo2, UserRound, Wallet } from 'lucide-react';
import { DAMAGE_SEVERITY_LABEL, INSPECTION_STATUS, MOVE_OUT_FEE_PRESETS, MOVE_OUT_OTHER_FEES_MAX, type InspectionLog, type RentalContract } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { byId, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { estimateMoveOutSettlement, MoveOutReportBody, SettlementLedger } from '@/features/contracts/move-out-settlement';
import { ActionBar, Callout, Chip, ChipRow, Meta, PanelHeader, QueueRow, StepBlock, UnitTag } from '@/features/staff-ui';

type Tab = 'SUBMITTED' | 'FM_APPROVED' | 'RETURNED';
const TABS: { key: Tab; label: string }[] = [
  { key: 'SUBMITTED', label: 'Chờ duyệt' },
  { key: 'FM_APPROVED', label: 'Chờ khách xác nhận' },
  { key: 'RETURNED', label: 'Đã trả lại' },
];

/**
 * DUYỆT TRẢ KHO (đợt 17) — Quản lý chi nhánh: biên bản nhân viên đã kiểm (hư hại có mô tả, mức độ, ảnh — chưa có tiền) → ghi phí sửa chữa từng
 * hư hại + phí khác (vệ sinh, thay khoá…), xem quyết toán ước tính rồi duyệt; hoặc trả lại nhân viên sửa (bắt buộc lý do). Đã duyệt: khách xác
 * nhận bằng mã OTP ở trang Trả kho; khách chưa xác nhận thì quản lý mở lại để sửa phí.
 */
export default function MoveOutReviewsPage() {
  return <Suspense><MoveOutReviews /></Suspense>;
}

function MoveOutReviews() {
  const { db } = useStore();
  const sp = useSearchParams();
  const scope = useFacilityScope();
  const [openId, setOpenId] = useState<string | null>(sp.get('open'));
  const reports = db.inspections.filter((i) => i.type === 'MOVE_OUT' && scope.facilityIds.includes(i.facilityId) && (i.status === 'SUBMITTED' || i.status === 'FM_APPROVED' || i.status === 'RETURNED'));
  const opened = openId ? reports.find((i) => i.contractId === openId) : undefined;
  const [tab, setTab] = useState<Tab>(opened ? (opened.status as Tab) : 'SUBMITTED');
  const list = reports.filter((i) => i.status === tab)
    .sort((a, b) => (a.review?.submittedAt ?? a.performedAt).localeCompare(b.review?.submittedAt ?? b.performedAt));
  const report = opened;
  const c = report?.contractId ? byId(db.contracts, report.contractId) : undefined;

  return (
    <>
      <PageHeader title="Duyệt trả kho" description="Ghi phí sửa chữa và phí khác cho biên bản nhân viên đã kiểm, rồi duyệt — khách xác nhận sau cùng bằng mã OTP." actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="self-start">
          <PanelHeader icon={<ClipboardCheck className="size-4" />} tone="blue" title="Biên bản trả kho" count={reports.filter((i) => i.status === 'SUBMITTED').length}
            tip="Số trên đầu = biên bản đang chờ bạn duyệt." />
          <div className="border-b border-stone-100 px-3 pt-2">
            <Tabs tabs={TABS.map((t) => ({ ...t, count: reports.filter((i) => i.status === t.key).length }))} value={tab} onChange={setTab} />
          </div>
          {list.length === 0 ? <EmptyState compact icon={<PackageOpen className="size-5" />} title={tab === 'SUBMITTED' ? 'Không có biên bản chờ duyệt' : 'Không có biên bản'} /> : (
            <ul className="divide-y divide-stone-100">
              {list.map((i) => {
                const k = i.contractId ? byId(db.contracts, i.contractId) : undefined;
                return (
                  <QueueRow key={i._id} active={report?._id === i._id} onSelect={() => setOpenId(i.contractId ?? null)}
                    lead={<UnitTag label={unitLabel(db, i.unitId)} size="sm" />}
                    title={k ? userName(db, k.customerId) : '—'}
                    meta={<>
                      <Meta icon={<CalendarDays />}>{fmtDateTime(i.review?.submittedAt ?? i.performedAt)}</Meta>
                      <Meta icon={<Hammer />}>{i.damages.length} hư hại</Meta>
                      {i.status === 'FM_APPROVED' && <Meta icon={<Wallet />}>{vnd(i.totalDamageFee)}</Meta>}
                    </>}
                  />
                );
              })}
            </ul>
          )}
        </Card>

        {!report || !c ? (
          <Card className="self-start"><EmptyState icon={<ClipboardCheck className="size-6" />} title="Chọn một biên bản" description="Bấm một dòng ở danh sách bên trái." /></Card>
        ) : (
          // key: nạp lại phí từ biên bản mỗi khi biên bản đổi (gửi lại, duyệt, mở lại).
          <ReviewPanel key={`${report._id}-${report.updatedAt}`} report={report} c={c} />
        )}
      </div>
    </>
  );
}

/** Ô số tiền (VND) bề rộng cố định, kèm số đã định dạng bên dưới để quản lý đọc nhanh. */
function MoneyInput({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="w-44 shrink-0">
      <input type="text" inputMode="numeric" className={cx(inputCls, 'text-right tabular-nums')} placeholder={placeholder} aria-label={label}
        value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 11))} />
      <p className="mt-0.5 text-right text-[11px] text-stone-500 tabular-nums">{value.trim() === '' ? 'Chưa nhập' : vnd(Number(value))}</p>
    </div>
  );
}

function ReviewPanel({ report, c }: { report: InspectionLog; c: RentalContract }) {
  const { db, run, busy } = useStore();
  const submitted = report.status === 'SUBMITTED';
  // Phí từng hư hại (chuỗi để ô trống được) — gửi lại sau khi bị trả lại thì giữ phí đã ghi của hư hại không đổi mô tả.
  const [costs, setCosts] = useState<string[]>(report.damages.map((d) => (d.cost > 0 ? String(d.cost) : '')));
  const [fees, setFees] = useState<{ label: string; amount: string }[]>((report.otherFees ?? []).map((f) => ({ label: f.label, amount: String(f.amount) })));
  const [dlg, setDlg] = useState<'return' | 'reopen' | 'approve' | null>(null);
  const [note, setNote] = useState('');
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const costOk = costs.every((s) => Number.isInteger(num(s)) && num(s) >= 0);
  const feesOk = fees.every((f) => f.label.trim().length >= 2 && Number.isInteger(num(f.amount)) && num(f.amount) > 0);
  const total = costs.reduce((s, x) => s + (Number(x) || 0), 0) + fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const estimate = estimateMoveOutSettlement(db, c, total);
  const preview = report.status === 'FM_APPROVED' ? report.review?.settlementPreview : null;
  const unit = byId(db.units, c.unitId);

  const approve = () => run('approveMoveOut', {
    contractId: c._id, damageCosts: costs.map((s) => Number(s)), otherFees: fees.map((f) => ({ label: f.label.trim(), amount: Number(f.amount) })),
  }, 'Đã duyệt biên bản — khách xem trên web / app và xác nhận bằng mã OTP tại quầy', () => setDlg(null));
  const sendBack = () => run('returnMoveOut', { contractId: c._id, note }, 'Đã trả lại biên bản cho nhân viên sửa', () => { setDlg(null); setNote(''); });
  const reopen = () => run('reopenMoveOut', { contractId: c._id, reason: note }, 'Đã mở lại biên bản — sửa phí rồi duyệt lại', () => { setDlg(null); setNote(''); });

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start gap-3 border-b border-stone-100 p-4 sm:p-5">
        <UnitTag label={unitLabel(db, c.unitId)} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{userName(db, c.customerId)}</h2>
          <ChipRow className="mt-1.5">
            <StatusBadge map={INSPECTION_STATUS} value={report.status} />
            <Chip icon={<FileText />} mono>HĐ {c.contractNumber}</Chip>
            <Chip>{typeName(db, c.unitTypeId)}</Chip>
            <Chip icon={<UserRound />}>Kiểm: {userName(db, report.inspectorId)}</Chip>
            <Chip icon={<CalendarDays />}>Nhận lại ô {fmtDate(c.moveOut?.returnedOn)}</Chip>
            <Chip icon={<Wallet />}>Giữ chân {vnd(c.deposit.amount)}</Chip>
          </ChipRow>
          {unit?.accessReset && unit.accessReset.contractId === c._id && !unit.accessReset.doneAt && (
            <p className="mt-2 text-xs text-amber-800">Chưa ghi nhận thu chìa / thẻ — nhân viên ghi nhận ở bước khách xác nhận.</p>
          )}
        </div>
      </div>
      <div className="space-y-6 p-4 sm:p-5">
        {report.status === 'RETURNED' && (
          <Callout tone="red" icon={<Undo2 />} title={`Đã trả lại nhân viên · ${fmtDateTime(report.review?.returnedAt)}`}>
            {report.review?.returnNote} — chờ nhân viên sửa và gửi lại.
          </Callout>
        )}
        {report.status === 'FM_APPROVED' && (
          <Callout tone="green" icon={<ShieldCheck />} title={`Đã duyệt ${fmtDateTime(report.review?.approvedAt)} — chờ khách xác nhận bằng mã OTP`}
            action={<ButtonLink size="sm" variant="secondary" href="/staff/move-out">Trang Trả kho</ButtonLink>}>
            Khách xem biên bản trên web / app; nhân viên gửi mã OTP và nhập mã khách đọc tại quầy. Khách vắng mặt: bạn xác nhận thay (kèm lý do) ở trang Trả kho.
          </Callout>
        )}

        <StepBlock n={1} state="done" icon={<ClipboardCheck />} title="Biên bản nhân viên đã kiểm">
          <MoveOutReportBody i={report} costs={!submitted} />
        </StepBlock>

        {submitted ? (
          <>
            <StepBlock n={2} state={costOk && feesOk ? 'done' : 'current'} icon={<Hammer />} title="Phí sửa chữa & phí khác">
              <div className="space-y-2">
                {report.damages.length === 0 && <p className="text-sm text-stone-500">Không có hư hại — chỉ ghi phí khác nếu có.</p>}
                {report.damages.map((d, k) => (
                  <div key={k} className="flex flex-wrap items-center gap-2 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-red-100 text-xs font-bold text-red-700">{k + 1}</span>
                    <span className="min-w-0 flex-1 basis-48 text-sm">{d.description} <span className="text-xs text-stone-500">(mức {DAMAGE_SEVERITY_LABEL[d.severity]})</span></span>
                    <MoneyInput label={`Phí sửa chữa hư hại ${k + 1}`} placeholder="Phí sửa chữa" value={costs[k] ?? ''} onChange={(v) => setCosts((a) => a.map((x, j) => (j === k ? v : x)))} />
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">Phí khác</p>
                  <div className="flex flex-wrap gap-1.5">
                    {MOVE_OUT_FEE_PRESETS.map((p) => (
                      <Button key={p} size="sm" variant="ghost" disabled={fees.length >= MOVE_OUT_OTHER_FEES_MAX} onClick={() => setFees((f) => [...f, { label: p, amount: '' }])}><Plus className="size-3.5" />{p}</Button>
                    ))}
                    <Button size="sm" variant="secondary" disabled={fees.length >= MOVE_OUT_OTHER_FEES_MAX} onClick={() => setFees((f) => [...f, { label: '', amount: '' }])}><Plus className="size-3.5" />Phí khác</Button>
                  </div>
                </div>
                {fees.length === 0 ? <p className="text-xs text-stone-500">Chưa có phí khác (vệ sinh ô kho, thay ổ khoá…).</p> : (
                  <div className="space-y-2">
                    {fees.map((f, k) => (
                      <div key={k} className="flex flex-wrap items-center gap-2">
                        <input className={cx(inputCls, 'min-w-0 flex-1 basis-48')} maxLength={100} placeholder="Tên phí" aria-label={`Tên phí khác ${k + 1}`} value={f.label}
                          onChange={(e) => setFees((a) => a.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} />
                        <MoneyInput label={`Số tiền phí khác ${k + 1}`} placeholder="Số tiền" value={f.amount} onChange={(v) => setFees((a) => a.map((x, j) => (j === k ? { ...x, amount: v } : x)))} />
                        <Button size="sm" variant="dangerOutline" aria-label={`Xoá phí khác ${k + 1}`} onClick={() => setFees((a) => a.filter((_, j) => j !== k))}><Trash2 className="size-4" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-3 flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"><span className="text-stone-600">Tổng phí trừ vào quyết toán</span><b className="tabular-nums">{vnd(total)}</b></p>
            </StepBlock>
            <StepBlock n={3} state="current" icon={<Wallet />} title="Quyết toán (ước tính)">
              <SettlementLedger p={estimate} estimate />
              <p className="mt-2 text-xs text-stone-500">Số chốt do hệ thống tính khi bạn duyệt — khách xem đúng số đó trước khi đọc mã OTP.</p>
            </StepBlock>
            <ActionBar>
              <Button variant="dangerOutline" onClick={() => { setNote(''); setDlg('return'); }}><Undo2 className="size-4" />Trả lại nhân viên</Button>
              <Button disabled={busy || !costOk || !feesOk} onClick={() => setDlg('approve')}><ShieldCheck className="size-4" />Duyệt biên bản</Button>
            </ActionBar>
          </>
        ) : report.status === 'FM_APPROVED' && preview ? (
          <>
            <StepBlock n={2} state="done" icon={<Wallet />} title="Quyết toán đã duyệt">
              <SettlementLedger p={preview} />
            </StepBlock>
            <ActionBar>
              <Button variant="dangerOutline" onClick={() => { setNote(''); setDlg('return'); }}><Undo2 className="size-4" />Trả lại nhân viên</Button>
              <Button variant="secondary" onClick={() => { setNote(''); setDlg('reopen'); }}><RotateCcw className="size-4" />Mở lại để sửa phí</Button>
            </ActionBar>
          </>
        ) : null}
      </div>

      <Modal open={dlg === 'approve'} onClose={() => setDlg(null)} title="Duyệt biên bản trả kho"
        description={`${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}`}
        footer={<><Button variant="secondary" onClick={() => setDlg(null)}>Quay lại</Button><Button disabled={busy} onClick={() => void approve()}><ShieldCheck className="size-4" />Duyệt</Button></>}>
        <div className="space-y-3 text-sm">
          <p>Chốt phí <b>{vnd(total)}</b> ({report.damages.length} hư hại{fees.length ? `, ${fees.length} phí khác` : ''}). Khách xem biên bản và quyết toán trên web / app, rồi xác nhận bằng mã OTP tại quầy — lúc đó hợp đồng mới đóng.</p>
          <p className="text-xs text-stone-500">Khách chưa xác nhận thì bạn vẫn mở lại để sửa phí được.</p>
        </div>
      </Modal>
      <Modal open={dlg === 'return' || dlg === 'reopen'} onClose={() => setDlg(null)} title={dlg === 'reopen' ? 'Mở lại biên bản để sửa phí' : 'Trả lại biên bản cho nhân viên'}
        description={`${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)}`}
        footer={<><Button variant="secondary" onClick={() => setDlg(null)}>Quay lại</Button>
          <Button variant={dlg === 'return' ? 'danger' : 'primary'} disabled={busy || note.trim().length < 5} onClick={() => void (dlg === 'reopen' ? reopen() : sendBack())}>{dlg === 'reopen' ? 'Mở lại' : 'Trả lại'}</Button></>}>
        <Field label={dlg === 'reopen' ? 'Lý do mở lại' : 'Lý do trả lại (nhân viên thấy)'} hint="Ít nhất 5 ký tự">
          <textarea className={inputCls} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={dlg === 'reopen' ? 'VD: khách không đồng ý phí vệ sinh' : 'VD: thiếu ảnh vết trầy sàn, ghi rõ vị trí hư hại'} />
        </Field>
        {report.status === 'FM_APPROVED' && <p className="mt-2 text-xs text-stone-500">Mã OTP đã gửi cho khách (nếu có) hết hiệu lực.</p>}
      </Modal>
    </Card>
  );
}
