'use client';

import { todayISO, vnDayOf, type SupportTicket, type TicketPriority, type User } from '@ssm/shared';
import { ROLE, TICKET_PRIORITY } from '@/shared/lib/labels';
import { Field, inputCls } from '@/shared/ui';

/**
 * Giao việc (góp ý mục 4 #1): quản lý chi nhánh chọn người phụ trách, mức ưu tiên (chi nhánh nâng được "Khẩn cấp" — khách tự gửi tối đa
 * "Cao") và hạn xử lý (ngày; server tính tới hết ngày đó giờ Việt Nam). Dùng ở hộp "Giao việc" của danh sách và trong chi tiết phiếu.
 */
export type AssignForm = { assigneeId: string; priority: TicketPriority; dueDate: string };

export const assignFormOf = (t: SupportTicket, assigneeId = t.assigneeId ?? ''): AssignForm => ({
  assigneeId, priority: t.priority, dueDate: t.dueAt ? vnDayOf(t.dueAt) : '',
});

/** Có gì khác so với phiếu hiện tại không (để bật nút Giao). */
export const assignChanged = (t: SupportTicket, f: AssignForm) => {
  const o = assignFormOf(t);
  return f.assigneeId !== o.assigneeId || f.priority !== o.priority || f.dueDate !== o.dueDate;
};

/** Tham số cho run('assignTicket'): mức ưu tiên / hạn chỉ gửi khi quản lý đổi — không đụng tới thì server giữ nguyên (kể cả hạn đã qua). */
export const assignPayload = (t: SupportTicket, f: AssignForm) => {
  const o = assignFormOf(t);
  return {
    ticketId: t._id, assigneeId: f.assigneeId,
    ...(f.priority !== o.priority ? { priority: f.priority } : {}),
    ...(f.dueDate !== o.dueDate ? { dueAt: f.dueDate || null } : {}),
  };
};

export function TicketAssignFields({ value, onChange, staff }: { value: AssignForm; onChange: (v: AssignForm) => void; staff: User[] }) {
  const today = todayISO().slice(0, 10);
  const pastDue = !!value.dueDate && value.dueDate < today;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Nhân viên">
        <select className={inputCls} value={value.assigneeId} onChange={(e) => onChange({ ...value, assigneeId: e.target.value })} disabled={staff.length === 0}>
          <option value="">— Chọn nhân viên —</option>
          {staff.map((s) => <option key={s._id} value={s._id}>{s.fullName} · {ROLE[s.role].label}</option>)}
        </select>
      </Field>
      <Field label="Mức ưu tiên">
        <select className={inputCls} value={value.priority} onChange={(e) => onChange({ ...value, priority: e.target.value as TicketPriority })}>
          {Object.entries(TICKET_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      <Field label="Hạn xử lý" note={value.dueDate ? undefined : 'Chưa đặt'} error={pastDue ? 'Hạn đã qua — chọn từ hôm nay' : undefined}>
        <input type="date" className={inputCls} min={today} value={value.dueDate} onChange={(e) => onChange({ ...value, dueDate: e.target.value })} />
      </Field>
    </div>
  );
}

/** Hạn đã chọn hợp lệ để gửi: không đổi hạn, bỏ hạn, hoặc hạn mới từ hôm nay. */
export const assignDueValid = (t: SupportTicket, f: AssignForm) =>
  f.dueDate === assignFormOf(t).dueDate || !f.dueDate || f.dueDate >= todayISO().slice(0, 10);
