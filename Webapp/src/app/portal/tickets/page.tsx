'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { TICKET_CATEGORY_ICON } from '@/features/tickets/ticket-icons';
import { addDays, isClosedContract, ISSUE_TICKET_CATEGORIES, OPEN_CONTRACT_STATUSES, todayISO, type TicketCategory, type TicketPriority } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, Table, inputCls } from '@/shared/ui';
import { TicketModal } from '@/features/tickets/ticket-thread';

function TicketsInner() {
  const { db, user, run } = useStore();
  const sp = useSearchParams();
  const presetContract = sp.get('contract');
  const [open, setOpen] = useState(!!presetContract);
  // ?open=<id>: mở thẳng một phiếu (VD vừa gửi yêu cầu tư vấn từ trang đặt kho).
  const [viewId, setViewId] = useState<string | null>(sp.get('open'));
  // Hợp đồng đang thuê, hoặc đã đóng trong 30 ngày (khiếu nại biên bản trả kho, thắc mắc thanh toán / nợ sau quyết toán) — giống app.
  const closedSince = addDays(todayISO(), -30);
  const contracts = user ? db.contracts
    .filter((c) => c.customerId === user._id && (OPEN_CONTRACT_STATUSES.includes(c.status) || (isClosedContract(c.status) && ((c.closedAt ?? '') >= closedSince || c.balance.outstanding > 0))))
    .sort((a, b) => (OPEN_CONTRACT_STATUSES.includes(a.status) ? 0 : 1) - (OPEN_CONTRACT_STATUSES.includes(b.status) ? 0 : 1)) : [];
  // Lặt vặt đợt 16: khách CHỈ có đặt chỗ (chưa nhận kho) cũng gửi được phiếu tới chi nhánh đã đặt — như BE (đang thuê HOẶC đã đặt ở chi nhánh).
  const bookings = user ? db.reservations.filter((r) => r.customerId === user._id && ['PENDING', 'CONFIRMED', 'ALLOCATED'].includes(r.status)) : [];
  const [contractId, setContractId] = useState(presetContract ?? '');
  // Danh sách hợp đồng có thể về sau lần render đầu — chưa chọn / chọn không hợp lệ thì lấy hợp đồng đầu tiên.
  const booking = bookings.find((r) => `r:${r._id}` === contractId);
  const selected = booking ? undefined : contracts.find((c) => c._id === contractId) ?? contracts[0];
  const canSend = contracts.length > 0 || bookings.length > 0;
  const [category, setCategory] = useState<TicketCategory>('ACCESS');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  if (!user) return null;
  const mine = db.tickets.filter((t) => t.reporterId === user._id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const view = viewId ? byId(db.tickets, viewId) ?? null : null;

  const submit = async () => {
    const c = selected;
    const target = c ? { facilityId: c.facilityId, contractId: c._id, unitId: OPEN_CONTRACT_STATUSES.includes(c.status) ? c.unitId : null } : booking ? { facilityId: booking.facilityId, contractId: null, unitId: null } : null;
    if (!target) return;
    // Hợp đồng đã đóng: KHÔNG gửi unitId — ô cũ có thể đã cho người khác thuê, BE chỉ nhận ô của hợp đồng còn mở. Đặt chỗ: chỉ chi nhánh.
    const res = await run('createTicket', { ...target, kind: 'CUSTOMER_ISSUE', category, priority, subject, description }, 'Đã gửi yêu cầu — chi nhánh sẽ phản hồi sớm');
    if (res.ok) { setOpen(false); setSubject(''); setDescription(''); }
  };

  return (
    <>
      <PageHeader title="Hỗ trợ" description="Báo sự cố, hỏi về thanh toán hay hợp đồng — chi nhánh phản hồi trong mục này." actions={<Button onClick={() => setOpen(true)} disabled={!canSend}><Plus className="size-4" />Gửi yêu cầu</Button>} />
      <Card>
        <Table rows={mine} rowKey={(t) => t._id} onRowClick={(t) => setViewId(t._id)} empty={<EmptyState icon={<MessageSquare className="size-6" />} title="Chưa có yêu cầu nào" action={canSend ? <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />Gửi yêu cầu</Button> : undefined} />} columns={[
          { key: 's', header: 'Yêu cầu', cell: (t) => { const Icon = TICKET_CATEGORY_ICON[t.category] ?? MessageSquare; return <div className="flex items-center gap-3"><IconTile icon={<Icon className="size-4" />} size="sm" tone="gray" /><div className="min-w-0"><p className="font-medium">{t.subject}</p><p className="text-xs text-stone-500">{t.ticketNumber} · {facilityName(db, t.facilityId)} · {unitLabel(db, t.unitId)}</p></div></div>; } },
          { key: 'c', header: 'Loại', cell: (t) => TICKET_CATEGORY[t.category] },
          { key: 'p', header: 'Mức độ', cell: (t) => <StatusBadge map={TICKET_PRIORITY} value={t.priority} /> },
          { key: 'st', header: 'Trạng thái', cell: (t) => <StatusBadge map={TICKET_STATUS} value={t.status} /> },
          { key: 'u', header: 'Cập nhật', cell: (t) => <span className="text-xs text-stone-500">{fmtDateTime(t.updatedAt)}</span> },
        ]} />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Gửi yêu cầu hỗ trợ" footer={<Button onClick={() => void submit()}>Gửi</Button>}>
        <div className="grid gap-4">
          <Field label="Kho liên quan">
            <select className={inputCls} value={booking ? `r:${booking._id}` : selected?._id ?? ''} onChange={(e) => setContractId(e.target.value)}>
              {contracts.map((c) => <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {facilityName(db, c.facilityId)}{isClosedContract(c.status) ? ' · đã kết thúc' : ''}</option>)}
              {bookings.map((r) => <option key={r._id} value={`r:${r._id}`}>Đặt chỗ {r.code} · {facilityName(db, r.facilityId)} · nhận {fmtDate(r.startDate)}</option>)}
            </select>
            {selected && isClosedContract(selected.status) && <p className="mt-1.5 text-xs text-stone-500">Hợp đồng đã kết thúc ngày {fmtDate(selected.closedAt)} — gửi yêu cầu để khiếu nại biên bản trả kho hoặc thắc mắc về thanh toán.</p>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại"><select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>{ISSUE_TICKET_CATEGORIES.map((k) => <option key={k} value={k}>{TICKET_CATEGORY[k]}</option>)}</select></Field>
            {/* Khách chọn tối đa "Cao" — "Khẩn cấp" do chi nhánh nâng (server cũng hạ URGENT của khách về HIGH). */}
            <Field label="Mức độ"><select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>{Object.entries(TICKET_PRIORITY).filter(([k]) => k !== 'URGENT').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          </div>
          <Field label="Tiêu đề"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="VD: Cửa cuốn khó kéo" /></Field>
          <Field label="Mô tả"><textarea className={inputCls} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
      </Modal>
      <TicketModal ticket={view} onClose={() => setViewId(null)} />
    </>
  );
}

export default function MyTickets() {
  return <Suspense><TicketsInner /></Suspense>;
}
