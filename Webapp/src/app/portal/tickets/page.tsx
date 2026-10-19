'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { ISSUE_TICKET_CATEGORIES, OPEN_CONTRACT_STATUSES, type TicketCategory, type TicketPriority } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, unitLabel } from '@/shared/lib/domain';
import { fmtDateTime } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Table, inputCls } from '@/shared/ui';
import { TicketModal } from '@/features/tickets/ticket-thread';

function TicketsInner() {
  const { db, user, run } = useStore();
  const sp = useSearchParams();
  const presetContract = sp.get('contract');
  const [open, setOpen] = useState(!!presetContract);
  // ?open=<id>: mở thẳng một phiếu (VD vừa gửi yêu cầu tư vấn từ trang đặt kho).
  const [viewId, setViewId] = useState<string | null>(sp.get('open'));
  const contracts = user ? db.contracts.filter((c) => c.customerId === user._id && OPEN_CONTRACT_STATUSES.includes(c.status)) : [];
  const [contractId, setContractId] = useState(presetContract ?? contracts[0]?._id ?? '');
  const [category, setCategory] = useState<TicketCategory>('ACCESS');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  if (!user) return null;
  const mine = db.tickets.filter((t) => t.reporterId === user._id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const view = viewId ? byId(db.tickets, viewId) ?? null : null;

  const submit = async () => {
    const c = byId(db.contracts, contractId);
    if (!c) return;
    const res = await run('createTicket', { facilityId: c.facilityId, kind: 'CUSTOMER_ISSUE', category, priority, subject, description, unitId: c.unitId, contractId: c._id }, 'Đã gửi yêu cầu — chi nhánh sẽ phản hồi sớm');
    if (res.ok) { setOpen(false); setSubject(''); setDescription(''); }
  };

  return (
    <>
      <PageHeader title="Hỗ trợ" description="Báo sự cố khóa, hư hỏng, vệ sinh, thắc mắc thanh toán — và theo dõi các yêu cầu tư vấn thuê kho." actions={<Button onClick={() => setOpen(true)} disabled={!contracts.length}><Plus className="size-4" />Gửi yêu cầu</Button>} />
      <Card>
        <Table rows={mine} rowKey={(t) => t._id} onRowClick={(t) => setViewId(t._id)} empty={<EmptyState icon={<MessageSquare className="size-6" />} title="Chưa có yêu cầu nào" />} columns={[
          { key: 's', header: 'Yêu cầu', cell: (t) => <div><p className="font-medium">{t.subject}</p><p className="text-xs text-stone-500">{t.ticketNumber} · {facilityName(db, t.facilityId)} · {unitLabel(db, t.unitId)}</p></div> },
          { key: 'c', header: 'Loại', cell: (t) => TICKET_CATEGORY[t.category] },
          { key: 'p', header: 'Mức độ', cell: (t) => <StatusBadge map={TICKET_PRIORITY} value={t.priority} /> },
          { key: 'st', header: 'Trạng thái', cell: (t) => <StatusBadge map={TICKET_STATUS} value={t.status} /> },
          { key: 'u', header: 'Cập nhật', cell: (t) => <span className="text-xs text-stone-500">{fmtDateTime(t.updatedAt)}</span> },
        ]} />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Gửi yêu cầu hỗ trợ" footer={<Button onClick={() => void submit()}>Gửi</Button>}>
        <div className="grid gap-4">
          <Field label="Kho liên quan">
            <select className={inputCls} value={contractId} onChange={(e) => setContractId(e.target.value)}>
              {contracts.map((c) => <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {facilityName(db, c.facilityId)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại"><select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>{ISSUE_TICKET_CATEGORIES.map((k) => <option key={k} value={k}>{TICKET_CATEGORY[k]}</option>)}</select></Field>
            <Field label="Mức độ"><select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>{Object.entries(TICKET_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
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
