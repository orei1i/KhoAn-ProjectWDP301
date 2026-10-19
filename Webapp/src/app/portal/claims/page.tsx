'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HandCoins, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { ClaimItem, ClaimType, DamageClaim } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE } from '@/shared/lib/labels';
import { CLAIM_LIABILITY_CAP, CLAIM_WINDOW_DAYS, claimTotal, typeName, unitLabel } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, KV, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';

const EMPTY_ITEM: ClaimItem = { name: '', quantity: 1, unitValue: 0 };

export default function MyClaims() {
  const { db, user, run } = useStore();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DamageClaim | null>(null);
  const [form, setForm] = useState({
    contractId: '',
    type: 'DAMAGE' as ClaimType,
    incidentAt: todayISO().slice(0, 10),
    description: '',
    items: [{ ...EMPTY_ITEM }] as ClaimItem[],
  });

  if (!user) return null;

  // Chỉ hợp đồng còn mở, hoặc vừa kết thúc trong hạn khiếu nại, mới gửi được yêu cầu.
  // ABANDONED (hàng bỏ lại, đã thanh lý) không có quy trình khiếu nại — loại hẳn, không tính hạn khiếu nại.
  const eligible = db.contracts.filter((c) =>
    c.customerId === user._id && c.status !== 'ABANDONED' && (c.status !== 'CLOSED' || (c.closedAt ?? '') >= addDays(todayISO(), -CLAIM_WINDOW_DAYS)));
  const claims = db.claims.filter((c) => c.customerId === user._id);
  const total = claimTotal(form.items);
  const valid = form.contractId && form.description.trim().length >= 10 && total > 0
    && form.items.every((it) => it.name.trim() && it.quantity > 0 && it.unitValue >= 0);

  const setItem = (i: number, patch: Partial<ClaimItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }));
  const reset = () => setForm({ contractId: eligible[0]?._id ?? '', type: 'DAMAGE', incidentAt: todayISO().slice(0, 10), description: '', items: [{ ...EMPTY_ITEM }] });
  const current = view ? db.claims.find((c) => c._id === view._id) ?? null : null;

  return (
    <>
      <PageHeader
        title="Yêu cầu bồi thường"
        description={`Báo hư hỏng hoặc mất mát tài sản gửi trong kho. Hạn gửi ${CLAIM_WINDOW_DAYS} ngày kể từ khi xảy ra sự cố, mức trách nhiệm tối đa ${vnd(CLAIM_LIABILITY_CAP)} cho mỗi sự vụ.`}
        actions={eligible.length > 0 && <Button onClick={() => { reset(); setOpen(true); }}><Plus className="size-4" />Gửi yêu cầu</Button>}
      />

      {eligible.length === 0 && (
        <Card className="mb-4 flex gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert className="size-5 shrink-0" />
          <p>Bạn chưa có hợp đồng thuê kho đang hiệu lực nên chưa gửi được yêu cầu bồi thường.</p>
        </Card>
      )}

      <Card>
        <Table rows={claims} rowKey={(c) => c._id} onRowClick={setView}
          empty={<EmptyState icon={<HandCoins className="size-6" />} title="Chưa có yêu cầu nào" description="Nếu tài sản trong kho bị hư hỏng hoặc mất, hãy gửi yêu cầu kèm ảnh chụp để chi nhánh xác minh." />}
          columns={[
            { key: 'n', header: 'Mã hồ sơ', cell: (c) => <div><p className="font-mono text-xs">{c.claimNumber}</p><p className="text-xs text-stone-500">{fmtDate(c.createdAt)}</p></div> },
            { key: 'u', header: 'Kho', cell: (c) => <div><p>{unitLabel(db, c.unitId)}</p><p className="text-xs text-stone-500">{CLAIM_TYPE[c.type]}</p></div> },
            { key: 'a', header: 'Yêu cầu', className: 'tabular-nums', cell: (c) => vnd(c.claimedAmount) },
            { key: 'd', header: 'Được duyệt', className: 'tabular-nums', cell: (c) => (c.review ? <span className={cx(c.review.approvedAmount > 0 ? 'font-medium text-emerald-700' : 'text-stone-500')}>{vnd(c.review.approvedAmount)}</span> : '—') },
            { key: 's', header: 'Trạng thái', cell: (c) => <StatusBadge map={CLAIM_STATUS} value={c.status} /> },
          ]} />
      </Card>

      {/* ---- gửi yêu cầu ---- */}
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Gửi yêu cầu bồi thường"
        description={`Tổng khai báo hiện tại: ${vnd(total)}`}
        footer={<Button disabled={!valid} onClick={() => void run('createClaim', {
          contractId: form.contractId, type: form.type, incidentAt: `${form.incidentAt}T00:00:00.000Z`,
          description: form.description, items: form.items,
        }, (c) => `Đã gửi hồ sơ ${c.claimNumber} — chi nhánh sẽ liên hệ xác minh`, () => setOpen(false))}>Gửi yêu cầu</Button>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hợp đồng / kho">
              <select className={inputCls} value={form.contractId} onChange={(e) => setForm((f) => ({ ...f, contractId: e.target.value }))}>
                <option value="">— Chọn kho —</option>
                {eligible.map((c) => <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {typeName(db, c.unitTypeId)}</option>)}
              </select>
            </Field>
            <Field label="Loại sự cố">
              <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ClaimType }))}>
                <option value="DAMAGE">{CLAIM_TYPE.DAMAGE}</option>
                <option value="LOSS">{CLAIM_TYPE.LOSS}</option>
              </select>
            </Field>
          </div>

          <Field label="Thời điểm xảy ra / phát hiện" hint={`Không nhận yêu cầu quá ${CLAIM_WINDOW_DAYS} ngày kể từ ngày này`}>
            <input type="date" className={inputCls} max={todayISO().slice(0, 10)} min={addDays(todayISO(), -CLAIM_WINDOW_DAYS).slice(0, 10)}
              value={form.incidentAt} onChange={(e) => setForm((f) => ({ ...f, incidentAt: e.target.value }))} />
          </Field>

          <Field label="Diễn biến sự việc" hint="Tối thiểu 10 ký tự. Mô tả càng rõ thì xác minh càng nhanh.">
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="VD: Ngày 12/9 tôi mở kho thì thấy trần thấm nước, hai thùng sách bị ướt và mốc." />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-stone-700">Hạng mục thiệt hại</p>
              <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))}><Plus className="size-3.5" />Thêm dòng</Button>
            </div>
            <div className="space-y-2">
              {form.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_72px_140px_32px] items-center gap-2">
                  <input className={inputCls} placeholder="Tên tài sản" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
                  <input type="number" min={1} max={999} className={inputCls} value={it.quantity} onChange={(e) => setItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
                  <input type="number" min={0} step={10_000} className={inputCls} placeholder="Giá trị / cái" value={it.unitValue} onChange={(e) => setItem(i, { unitValue: Math.max(0, Number(e.target.value) || 0) })} />
                  <button type="button" aria-label="Xóa dòng" disabled={form.items.length === 1}
                    onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, k) => k !== i) }))}
                    className="grid size-8 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-600 disabled:opacity-30"><Trash2 className="size-4" /></button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-sm">Tổng khai báo: <b className={cx(total > CLAIM_LIABILITY_CAP && 'text-amber-700')}>{vnd(total)}</b></p>
            {total > CLAIM_LIABILITY_CAP && (
              <p className="mt-1 text-xs text-amber-700">
                Vượt mức trách nhiệm tối đa {vnd(CLAIM_LIABILITY_CAP)} — bạn vẫn gửi được, nhưng số tiền duyệt sẽ dừng ở mức này theo{' '}
                <Link href="/dieu-khoan" className="underline">Điều khoản dịch vụ</Link>.
              </p>
            )}
          </div>
        </div>
      </Modal>

      {/* ---- chi tiết ---- */}
      <Modal open={!!current} onClose={() => setView(null)} size="lg" title={`Hồ sơ ${current?.claimNumber ?? ''}`}
        description={current ? `${CLAIM_TYPE[current.type]} · kho ${unitLabel(db, current.unitId)}` : ''}
        footer={current && (current.status === 'SUBMITTED' || current.status === 'UNDER_REVIEW')
          ? <Button variant="secondary" onClick={() => void run('withdrawClaim', { claimId: current._id }, 'Đã rút hồ sơ', () => setView(null))}>Rút hồ sơ</Button>
          : undefined}>
        {current && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2"><StatusBadge map={CLAIM_STATUS} value={current.status} /></div>
            <KV items={[
              ['Ngày sự cố', fmtDate(current.incidentAt)],
              ['Ngày gửi', fmtDate(current.createdAt)],
              ['Tổng khai báo', vnd(current.claimedAmount)],
              ['Được duyệt', current.review ? vnd(current.review.approvedAmount) : 'Chưa có'],
            ]} />
            <div>
              <h4 className="mb-1 text-sm font-semibold">Diễn biến</h4>
              <p className="whitespace-pre-line text-sm text-stone-600">{current.description}</p>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold">Hạng mục</h4>
              <Table rows={current.items} rowKey={(it) => `${it.name}-${it.quantity}-${it.unitValue}`} columns={[
                { key: 'n', header: 'Tài sản', cell: (it) => it.name },
                { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
                { key: 'v', header: 'Thành tiền', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.unitValue) },
              ]} />
            </div>
            {current.review && (
              <div className="rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-stone-200">
                <p className="font-medium">Kết quả xét duyệt · {fmtDate(current.review.reviewedAt)}</p>
                <p className="mt-1 whitespace-pre-line text-stone-600">{current.review.decisionNote}</p>
                <p className="mt-2">Số tiền duyệt: <b>{vnd(current.review.approvedAmount)}</b> <span className="text-stone-500">(mức trách nhiệm tối đa {vnd(current.review.liabilityCap)})</span></p>
              </div>
            )}
            {current.settlement && (
              <p className="text-sm text-emerald-700">Đã chi {fmtDate(current.settlement.paidAt)} qua {current.settlement.method === 'CASH' ? 'tiền mặt tại quầy' : 'chuyển khoản'}.</p>
            )}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Lịch sử xử lý</h4>
              <ol className="space-y-1 text-sm">
                {current.statusHistory.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-24 shrink-0 text-xs text-stone-500">{fmtDate(h.at)}</span>
                    {h.from ? `${CLAIM_STATUS[h.from].label} → ` : ''}{CLAIM_STATUS[h.to].label}
                    {h.reason && <span className="text-stone-500"> · {h.reason}</span>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>

      <p className="mt-4 text-xs text-stone-500">
        Yêu cầu bồi thường không thay cho báo sự cố. Nếu cần chi nhánh xử lý ngay (khóa hỏng, thấm dột…), hãy{' '}
        <Link href="/portal/tickets" className="text-brand-700 underline">gửi yêu cầu hỗ trợ</Link> trước.
      </p>
    </>
  );
}
