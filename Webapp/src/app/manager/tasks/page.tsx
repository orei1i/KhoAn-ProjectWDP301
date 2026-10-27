'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ISSUE_TICKET_CATEGORIES, type SupportTicket, type TicketCategory, type TicketPriority } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { TICKET_CATEGORY, TICKET_KIND, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { ticketUrgency, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';

type Tab = 'open' | 'progress' | 'done';

export default function ManagerTasks() {
  const { db, run } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const [tab, setTab] = useState<Tab>('open');
  const [view, setView] = useState<SupportTicket | null>(null);
  const [assignFor, setAssignFor] = useState<SupportTicket | null>(null);
  const [creating, setCreating] = useState(false);
  const staff = db.users.filter((u) => (u.role === 'STAFF' || u.role === 'FACILITY_MANAGER') && u.facilityIds.includes(fid) && u.status === 'ACTIVE');
  const [assignee, setAssignee] = useState('');
  const [form, setForm] = useState({ subject: '', description: '', category: 'MAINTENANCE' as TicketCategory, priority: 'MEDIUM' as TicketPriority, dueAt: addDays(todayISO(), 2).slice(0, 10) });

  // Yêu cầu khách Khẩn cấp / Cao lên đầu, sau đó theo hạn.
  const all = db.tickets.filter((t) => t.facilityId === fid && !t.isDeleted)
    .sort((a, b) => ticketUrgency(a) - ticketUrgency(b) || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  const groups: Record<Tab, SupportTicket[]> = {
    open: all.filter((t) => t.status === 'OPEN'),
    progress: all.filter((t) => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS'),
    done: all.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED'),
  };

  return (
    <>
      <PageHeader title="Yêu cầu & công việc" description="Yêu cầu của khách và việc nội bộ giao cho nhân viên chi nhánh." actions={<><FacilityPicker scope={scope} /><Button onClick={() => { setCreating(true); setAssignee(staff[0]?._id ?? ''); }}><Plus className="size-4" />Giao việc mới</Button></>} />
      <Tabs tabs={[{ key: 'open', label: 'Chưa giao', count: groups.open.length }, { key: 'progress', label: 'Đang xử lý', count: groups.progress.length }, { key: 'done', label: 'Đã xong', count: groups.done.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={groups[tab]} rowKey={(t) => t._id} onRowClick={setView} empty={<EmptyState title="Không có mục nào" />} columns={[
          { key: 's', header: 'Nội dung', cell: (t) => <div><p className="flex flex-wrap items-center gap-2 font-medium">{t.subject}{ticketUrgency(t) < 2 && <Badge tone={TICKET_PRIORITY[t.priority].tone}>{TICKET_PRIORITY[t.priority].label}</Badge>}</p><p className="text-xs text-stone-500">{TICKET_KIND[t.kind]} · {TICKET_CATEGORY[t.category]}{t.unitId ? ` · kho ${unitLabel(db, t.unitId)}` : ''}</p></div> },
          { key: 'r', header: 'Người tạo', cell: (t) => userName(db, t.reporterId) },
          { key: 'as', header: 'Phụ trách', cell: (t) => (t.assigneeId ? userName(db, t.assigneeId) : <span className="text-stone-400">—</span>) },
          { key: 'd', header: 'Hạn', cell: (t) => fmtDate(t.dueAt) },
          { key: 'p', header: 'Mức độ', cell: (t) => <StatusBadge map={TICKET_PRIORITY} value={t.priority} /> },
          { key: 'st', header: 'Trạng thái', cell: (t) => <StatusBadge map={TICKET_STATUS} value={t.status} /> },
          { key: 'a', header: '', className: 'text-right', cell: (t) => (t.status === 'OPEN' || t.status === 'ASSIGNED') && (
            <span onClick={(e) => e.stopPropagation()}><Button size="sm" variant="secondary" onClick={() => { setAssignFor(t); setAssignee(t.assigneeId ?? staff[0]?._id ?? ''); }}>{t.assigneeId ? 'Giao lại' : 'Giao việc'}</Button></span>
          ) },
        ]} />
      </Card>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Giao việc" description={assignFor?.subject}
        footer={<Button disabled={!assignee} onClick={() => assignFor && void run('assignTicket', { ticketId: assignFor._id, assigneeId: assignee }, `Đã giao cho ${userName(db, assignee)}`, () => setAssignFor(null))}>Giao</Button>}>
        <Field label="Nhân viên"><select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{staff.map((s) => <option key={s._id} value={s._id}>{s.fullName}</option>)}</select></Field>
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Giao việc nội bộ"
        footer={<Button onClick={() => void run('createTicket', { facilityId: fid, kind: 'OPS_TASK', ...form, dueAt: `${form.dueAt}T00:00:00.000Z`, assigneeId: assignee || null }, 'Đã tạo và giao việc', () => setCreating(false))}>Tạo</Button>}>
        <div className="grid gap-4">
          <Field label="Tiêu đề"><input className={inputCls} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="VD: Kiểm tra khóa dãy M tầng 2" /></Field>
          <Field label="Mô tả"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại"><select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TicketCategory })}>{ISSUE_TICKET_CATEGORIES.map((k) => <option key={k} value={k}>{TICKET_CATEGORY[k]}</option>)}</select></Field>
            <Field label="Mức độ"><select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TicketPriority })}>{Object.entries(TICKET_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Giao cho"><select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{staff.map((s) => <option key={s._id} value={s._id}>{s.fullName}</option>)}</select></Field>
            <Field label="Hạn hoàn thành"><input type="date" className={inputCls} value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
      <TicketModal ticket={view} onClose={() => setView(null)} />
    </>
  );
}
