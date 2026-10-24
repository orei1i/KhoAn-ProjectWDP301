'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupportTicket } from '@ssm/shared';
import { nextStates, type Actor } from '@ssm/shared';
import { TICKET_MACHINE } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ROLE, TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { facilityName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime } from '@/shared/lib/format';
import { Badge, Button, KV, Modal, StatusBadge, cx, inputCls } from '@/shared/ui';

const ACTION_LABEL: Record<string, string> = { ASSIGNED: 'Giao việc', IN_PROGRESS: 'Bắt đầu xử lý', RESOLVED: 'Đánh dấu đã xử lý', CLOSED: 'Đóng yêu cầu', OPEN: 'Trả về hàng chờ' };

export function TicketModal({ ticket, onClose }: { ticket: SupportTicket | null; onClose: () => void }) {
  const { db, user, run } = useStore();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [assignee, setAssignee] = useState('');

  // Mở ticket khác thì ô chọn phải nhảy theo người đang phụ trách của ticket đó.
  useEffect(() => { setAssignee(ticket?.assigneeId ?? ''); }, [ticket?._id, ticket?.assigneeId]);

  // Chỉ nhân sự đang hoạt động thuộc đúng chi nhánh của ticket — trùng với ràng buộc assertAssignee ở server.
  const staff = useMemo(() => db.users.filter((u) =>
    (u.role === 'STAFF' || u.role === 'FACILITY_MANAGER')
    && u.status === 'ACTIVE'
    && u.facilityIds.some((f) => String(f) === String(ticket?.facilityId)),
  ), [db.users, ticket?.facilityId]);

  if (!ticket || !user) return null;
  const t = db.tickets.find((x) => x._id === ticket._id) ?? ticket;
  const isCustomer = user.role === 'CUSTOMER';
  const actions = nextStates(TICKET_MACHINE, t.status, user.role as Actor).filter((s) => s !== 'ASSIGNED');
  // CLOSED là trạng thái cuối — không trao đổi thêm, không mở lại được.
  const move = (s: (typeof actions)[number]) => {
    if (s === 'CLOSED' && !window.confirm(`Đóng yêu cầu ${t.ticketNumber}? Không mở lại được.`)) return;
    void run('setTicketStatus', { ticketId: t._id, to: s }, `Đã chuyển sang "${TICKET_STATUS[s].label}"`);
  };

  return (
    <Modal open onClose={onClose} size="lg" title={t.subject} description={`${t.ticketNumber} · ${facilityName(db, t.facilityId)}`}
      footer={actions.map((s) => (
        <Button key={s} variant={s === 'CLOSED' ? 'secondary' : 'primary'} size="sm" onClick={() => move(s)}>{ACTION_LABEL[s] ?? s}</Button>
      ))}>
      <div className="flex flex-wrap gap-2">
        <StatusBadge map={TICKET_STATUS} value={t.status} />
        <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
        <Badge>{TICKET_CATEGORY[t.category]}</Badge>
      </div>
      <div className="mt-4"><KV items={[['Người gửi', userName(db, t.reporterId)], ['Phụ trách', t.assigneeId ? userName(db, t.assigneeId) : 'Chưa giao'], ['Kho', t.unitId ? unitLabel(db, t.unitId) : '—'], ['Hạn xử lý', fmtDate(t.dueAt)]]} /></div>
      {user.role === 'FACILITY_MANAGER' && t.status !== 'CLOSED' && (
        <div className="mt-4 rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
          <p className="text-xs font-medium text-stone-600">Giao cho nhân viên chi nhánh</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className={cx(inputCls, 'flex-1')} value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={staff.length === 0}>
              <option value="">— Chọn nhân viên —</option>
              {staff.map((s) => <option key={s._id} value={s._id}>{s.fullName} · {ROLE[s.role].label}</option>)}
            </select>
            <Button size="sm" disabled={!assignee || assignee === t.assigneeId}
              onClick={() => void run('assignTicket', { ticketId: t._id, assigneeId: assignee }, 'Đã giao việc')}>
              {t.assigneeId ? 'Giao lại' : 'Giao việc'}
            </Button>
          </div>
          {staff.length === 0 && <p className="mt-2 text-xs text-orange-700">Chi nhánh này chưa có nhân viên nào đang hoạt động.</p>}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {t.messages.filter((m) => !isCustomer || !m.internal).map((m, i) => {
          const mine = m.authorId === user._id;
          return (
            <div key={i} className={cx('max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm', mine ? 'ml-auto bg-brand-700 text-white' : m.internal ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'bg-stone-100')}>
              <p className={cx('mb-1 text-[11px]', mine ? 'text-brand-100' : 'text-stone-500')}>{userName(db, m.authorId)} · {fmtDateTime(m.at)}{m.internal && ' · ghi chú nội bộ'}</p>
              <p className="whitespace-pre-line">{m.body}</p>
            </div>
          );
        })}
        {t.messages.length === 0 && <p className="text-sm text-stone-500">Chưa có trao đổi.</p>}
      </div>
      {t.status !== 'CLOSED' && (
        <form className="mt-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run('addTicketMessage', { ticketId: t._id, body, internal }, undefined, () => setBody('')); }}>
          <textarea className={inputCls} rows={2} placeholder="Nhập phản hồi…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex items-center justify-between gap-2">
            {!isCustomer ? <label className="flex items-center gap-2 text-xs text-stone-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Ghi chú nội bộ (khách không thấy)</label> : <span />}
            <Button size="sm" type="submit" disabled={!body.trim()}>Gửi</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
