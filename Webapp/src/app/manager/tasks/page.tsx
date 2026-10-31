'use client';

import { useState } from 'react';
import { CalendarClock, CircleCheck, ClipboardList, Inbox, ListTodo, Plus, ShieldCheck, Timer, UserCheck, UserPlus, UserRound, Warehouse } from 'lucide-react';
import { ISSUE_TICKET_CATEGORIES, type SupportTicket, type TicketCategory, type TicketPriority } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { TICKET_CATEGORY, TICKET_KIND, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { ticketUrgency, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';
import { TICKET_CATEGORY_ICON } from '@/features/tickets/ticket-icons';
import { Meta, PillFilter, QueueRow } from '@/features/staff-ui';

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
      <PillFilter value={tab} onChange={setTab} options={[
        { key: 'open', label: 'Chưa giao', icon: <Inbox />, count: groups.open.length },
        { key: 'progress', label: 'Đang xử lý', icon: <Timer />, count: groups.progress.length },
        { key: 'done', label: 'Đã xong', icon: <CircleCheck />, count: groups.done.length },
      ]} />
      <Card className="mt-4">
        {groups[tab].length === 0 ? <EmptyState icon={<ListTodo className="size-6" />} title="Không có mục nào" /> : (
          <ul className="divide-y divide-stone-100">
            {groups[tab].map((t) => {
              const Icon = TICKET_CATEGORY_ICON[t.category];
              const open = t.status !== 'RESOLVED' && t.status !== 'CLOSED';
              const late = open && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
              return (
                <QueueRow key={t._id} onSelect={() => setView(t)}
                  lead={<IconTile icon={<Icon className="size-4" />} tone={open ? TICKET_PRIORITY[t.priority].tone : 'gray'} />}
                  title={t.subject}
                  badges={<>
                    <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
                    {ticketUrgency(t) < 2 && <span className="text-[11px] font-semibold uppercase tracking-wide text-red-600">Khách cần gấp</span>}
                  </>}
                  meta={<>
                    <Meta icon={t.kind === 'CUSTOMER_ISSUE' ? <UserRound /> : <ClipboardList />}>{TICKET_KIND[t.kind]} · {TICKET_CATEGORY[t.category]}</Meta>
                    {t.unitId && <Meta icon={<Warehouse />}>Kho {unitLabel(db, t.unitId)}</Meta>}
                    <Meta icon={<UserRound />}>Tạo: {userName(db, t.reporterId)}</Meta>
                    <Meta icon={<UserCheck />} className={t.assigneeId ? undefined : 'text-stone-400'}>{t.assigneeId ? userName(db, t.assigneeId) : 'Chưa giao'}</Meta>
                    <Meta icon={<CalendarClock />} className={late ? 'font-medium text-red-700' : undefined}>Hạn {fmtDate(t.dueAt)}</Meta>
                  </>}
                  actions={<>
                    <StatusBadge map={TICKET_STATUS} value={t.status} />
                    {/* Đợt 16 (B2): việc "Vô hiệu thẻ …" — xác nhận đã khoá thẻ / chìa khách báo mất (hệ thống báo lại khách). */}
                    {t.accessRequestId && open && (
                      <Button size="sm" onClick={() => { if (window.confirm(`${t.subject}: xác nhận đã khoá? Hệ thống báo lại cho khách.`)) void run('confirmLostBlocked', { requestId: t.accessRequestId! }, 'Đã xác nhận khoá — khách được báo qua email'); }}><ShieldCheck className="size-3.5" />Xác nhận đã vô hiệu</Button>
                    )}
                    {(t.status === 'OPEN' || t.status === 'ASSIGNED') && !t.accessRequestId && (
                      <Button size="sm" variant="secondary" onClick={() => { setAssignFor(t); setAssignee(t.assigneeId ?? staff[0]?._id ?? ''); }}><UserPlus className="size-3.5" />{t.assigneeId ? 'Giao lại' : 'Giao việc'}</Button>
                    )}
                  </>}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Giao việc" description={assignFor?.subject}
        footer={<Button disabled={!assignee} onClick={() => assignFor && void run('assignTicket', { ticketId: assignFor._id, assigneeId: assignee }, `Đã giao cho ${userName(db, assignee)}`, () => setAssignFor(null))}><UserPlus className="size-4" />Giao</Button>}>
        <Field label="Nhân viên"><select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{staff.map((s) => <option key={s._id} value={s._id}>{s.fullName}</option>)}</select></Field>
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Giao việc nội bộ"
        footer={<Button onClick={() => void run('createTicket', { facilityId: fid, kind: 'OPS_TASK', ...form, dueAt: `${form.dueAt}T00:00:00.000Z`, assigneeId: assignee || null }, 'Đã tạo và giao việc', () => setCreating(false))}><Plus className="size-4" />Tạo</Button>}>
        <div className="grid gap-4">
          <Field label="Tiêu đề"><input className={inputCls} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="VD: Kiểm tra khóa dãy M tầng 2" /></Field>
          <Field label="Mô tả"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loại"><select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TicketCategory })}>{ISSUE_TICKET_CATEGORIES.map((k) => <option key={k} value={k}>{TICKET_CATEGORY[k]}</option>)}</select></Field>
            <Field label="Mức độ"><select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TicketPriority })}>{Object.entries(TICKET_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <Field label="Giao cho"><select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{staff.map((s) => <option key={s._id} value={s._id}>{s.fullName}</option>)}</select></Field>
            <Field label="Hạn hoàn thành"><input type="date" className={inputCls} value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
      <TicketModal ticket={view} onClose={() => setView(null)} />
    </>
  );
}
