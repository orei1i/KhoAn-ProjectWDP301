'use client';

import { useState } from 'react';
import { CircleCheck, Inbox, ListTodo, Plus, ShieldCheck, Timer, UserPlus } from 'lucide-react';
import { ISSUE_TICKET_CATEGORIES, type SupportTicket, type TicketCategory, type TicketPriority } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { TICKET_CATEGORY, TICKET_PRIORITY } from '@/shared/lib/labels';
import { compareTickets, userName } from '@/shared/lib/domain';
import { addDays, todayISO } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, Modal, PageHeader, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';
import { TicketAssignFields, assignDueValid, assignFormOf, assignPayload, type AssignForm } from '@/features/tickets/ticket-assign';
import { TicketRow, ticketDone, ticketDoneAt } from '@/features/tickets/ticket-row';
import { PillFilter, Segmented } from '@/features/staff-ui';

/**
 * Góp ý 17/11: tổng quan yêu cầu & công việc của chi nhánh chia ba nhóm theo việc quản lý cần làm — Chờ phân công (phiếu mới, chưa ai phụ
 * trách) → Đang xử lý (đã giao / đang làm, thấy người phụ trách, mức ưu tiên, hạn) → Đã xong. Lọc riêng phiếu của khách và việc nội bộ
 * (không trộn hai loại trong một danh sách khó đọc); "Giao cho tôi" chỉ hiện khi quản lý thật sự được giao việc.
 */
type Tab = 'open' | 'progress' | 'done';
type Kind = 'all' | 'customer' | 'internal' | 'me';

export default function ManagerTasks() {
  const { db, user, run, busy } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const [tab, setTab] = useState<Tab>('open');
  const [kind, setKind] = useState<Kind>('all');
  const [view, setView] = useState<SupportTicket | null>(null);
  const [assignFor, setAssignFor] = useState<SupportTicket | null>(null);
  const [creating, setCreating] = useState(false);
  const staff = db.users.filter((u) => (u.role === 'STAFF' || u.role === 'FACILITY_MANAGER') && u.facilityIds.includes(fid) && u.status === 'ACTIVE');
  const [assignee, setAssignee] = useState('');
  // Góp ý mục 4 (#1): hộp Giao việc có thêm mức ưu tiên (nâng được Khẩn cấp) và hạn xử lý.
  const [assignForm, setAssignForm] = useState<AssignForm>({ assigneeId: '', priority: 'MEDIUM', dueDate: '' });
  const [form, setForm] = useState({ subject: '', description: '', category: 'MAINTENANCE' as TicketCategory, priority: 'MEDIUM' as TicketPriority, dueAt: addDays(todayISO(), 2).slice(0, 10) });

  // Mỗi phiếu một lần (Map theo _id).
  const all = [...new Map(db.tickets.filter((t) => t.facilityId === fid && !t.isDeleted).map((t) => [t._id, t])).values()];
  const ofKind = (k: Kind) => (t: SupportTicket) => k === 'all' || (k === 'customer' ? t.kind === 'CUSTOMER_ISSUE' : k === 'internal' ? t.kind === 'OPS_TASK' : t.assigneeId === user?._id);
  const inTab: Record<Tab, (t: SupportTicket) => boolean> = {
    open: (t) => t.status === 'OPEN',
    progress: (t) => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS',
    done: ticketDone,
  };
  const count = (k: Kind) => all.filter(inTab[tab]).filter(ofKind(k)).length;
  // "Giao cho tôi" chỉ hiện khi quản lý đang có việc được giao (trong nhóm đang xem) — không thêm bộ lọc thừa.
  const mineCount = count('me');
  const kindNow: Kind = kind === 'me' && mineCount === 0 ? 'all' : kind;
  // Khẩn cấp > Cao > Trung bình > Thấp (phiếu khách lẫn việc nội bộ), rồi hạn gần nhất; nhóm "Đã xong": mới xong trước.
  const shown = all.filter(inTab[tab]).filter(ofKind(kindNow))
    .sort(tab === 'done' ? (a, b) => ticketDoneAt(b).localeCompare(ticketDoneAt(a)) : compareTickets);

  return (
    <>
      <PageHeader title="Yêu cầu & công việc" description="Phiếu của khách và việc nội bộ của chi nhánh — phân công, theo dõi tới khi xong." actions={<><FacilityPicker scope={scope} /><Button onClick={() => { setCreating(true); setAssignee(staff[0]?._id ?? ''); }}><Plus className="size-4" />Giao việc mới</Button></>} />
      <PillFilter value={tab} onChange={setTab} options={[
        { key: 'open', label: 'Chờ phân công', icon: <Inbox />, count: all.filter(inTab.open).length },
        { key: 'progress', label: 'Đang xử lý', icon: <Timer />, count: all.filter(inTab.progress).length },
        { key: 'done', label: 'Đã xong', icon: <CircleCheck />, count: all.filter(inTab.done).length },
      ]} />
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-4 py-2.5 sm:px-5">
          <span className="text-xs text-stone-500">Loại</span>
          <Segmented<Kind> label="Lọc theo loại" value={kindNow} onChange={setKind} options={[
            { value: 'all', label: `Tất cả · ${count('all')}` },
            { value: 'customer', label: `Yêu cầu của khách · ${count('customer')}`, tone: 'blue' },
            { value: 'internal', label: `Việc nội bộ · ${count('internal')}` },
            ...(mineCount > 0 ? [{ value: 'me' as const, label: `Giao cho tôi · ${mineCount}`, tone: 'teal' as const }] : []),
          ]} />
        </div>
        {shown.length === 0
          ? <EmptyState icon={<ListTodo className="size-6" />} title={tab === 'open' ? 'Không có phiếu nào chờ phân công' : tab === 'progress' ? 'Không có việc nào đang xử lý' : 'Chưa có việc nào xong'} />
          : (
            <ul className="divide-y divide-stone-100">
              {shown.map((t) => (
                <TicketRow key={t._id} db={db} ticket={t} onSelect={() => setView(t)} showAssignee={tab !== 'open'}
                  actions={<>
                    {/* Đợt 16 (B2): việc "Vô hiệu thẻ …" — xác nhận đã khoá thẻ / chìa khách báo mất (hệ thống báo lại khách). */}
                    {t.accessRequestId && !ticketDone(t) && (
                      <Button size="sm" onClick={() => { if (window.confirm(`${t.subject}: xác nhận đã khoá? Hệ thống báo lại cho khách.`)) void run('confirmLostBlocked', { requestId: t.accessRequestId! }, 'Đã xác nhận khoá — khách được báo qua email'); }}><ShieldCheck className="size-3.5" />Xác nhận đã vô hiệu</Button>
                    )}
                    {(t.status === 'OPEN' || t.status === 'ASSIGNED') && !t.accessRequestId && (
                      <Button size="sm" variant="secondary" onClick={() => { setAssignFor(t); setAssignForm(assignFormOf(t, t.assigneeId ?? staff[0]?._id ?? '')); }}><UserPlus className="size-3.5" />{t.assigneeId ? 'Giao lại' : 'Giao việc'}</Button>
                    )}
                  </>}
                />
              ))}
            </ul>
          )}
      </Card>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Giao việc" description={assignFor?.subject} size="lg"
        footer={<Button disabled={!assignForm.assigneeId || (!!assignFor && !assignDueValid(assignFor, assignForm))} onClick={() => assignFor && void run('assignTicket', assignPayload(assignFor, assignForm), `Đã giao cho ${userName(db, assignForm.assigneeId)}`, () => setAssignFor(null))}><UserPlus className="size-4" />Giao</Button>}>
        <TicketAssignFields value={assignForm} onChange={setAssignForm} staff={staff} />
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Giao việc nội bộ"
        footer={<Button disabled={busy || form.subject.trim().length < 5} onClick={() => void run('createTicket', { facilityId: fid, kind: 'OPS_TASK', ...form, dueAt: `${form.dueAt}T00:00:00.000Z`, assigneeId: assignee || null }, 'Đã tạo và giao việc', () => setCreating(false))}><Plus className="size-4" />Tạo</Button>}>
        <div className="grid gap-4">
          <Field label="Tiêu đề"><input className={inputCls} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="VD: Kiểm tra khoá dãy M tầng 2" /></Field>
          <Field label="Mô tả"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loại"><select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TicketCategory })}>{ISSUE_TICKET_CATEGORIES.map((k) => <option key={k} value={k}>{TICKET_CATEGORY[k]}</option>)}</select></Field>
            <Field label="Mức ưu tiên"><select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TicketPriority })}>{Object.entries(TICKET_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <Field label="Giao cho"><select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{staff.map((s) => <option key={s._id} value={s._id}>{s.fullName}</option>)}</select></Field>
            <Field label="Hạn hoàn thành"><input type="date" className={inputCls} value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
      <TicketModal ticket={view} onClose={() => setView(null)} />
    </>
  );
}
