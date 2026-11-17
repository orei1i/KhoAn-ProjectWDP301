'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupportTicket } from '@ssm/shared';
import { nextStates, vnDayOf, type Actor } from '@ssm/shared';
import { TICKET_MACHINE } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { facilityName, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime } from '@/shared/lib/format';
import { Badge, Button, KV, Modal, StatusBadge, cx, inputCls } from '@/shared/ui';
import { TicketAssignFields, assignChanged, assignDueValid, assignPayload, type AssignForm } from './ticket-assign';

const ACTION_LABEL: Record<string, string> = { ASSIGNED: 'Giao việc', IN_PROGRESS: 'Bắt đầu xử lý', RESOLVED: 'Đánh dấu đã xử lý', CLOSED: 'Đóng yêu cầu', OPEN: 'Trả về hàng chờ' };

export function TicketModal({ ticket, onClose }: { ticket: SupportTicket | null; onClose: () => void }) {
  const { db, user, run, busy } = useStore();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  // Góp ý mục 4 (#1): giao việc kèm mức ưu tiên + hạn xử lý.
  const [assign, setAssign] = useState<AssignForm>({ assigneeId: '', priority: 'MEDIUM', dueDate: '' });
  // Đợt 16 (C3): chi nhánh đóng phiếu CHƯA giải quyết — bắt buộc lý do (khách thấy + nhận qua email).
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  // Góp ý mục 4 (#23): đánh dấu đã xử lý phải ghi một dòng kết quả — khách nhận như tin nhắn của chi nhánh (và email).
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState('');

  // Mở ticket khác (hoặc phiếu vừa được giao / đổi mức / đổi hạn) thì các ô nhảy theo phiếu đó.
  const tId = ticket?._id;
  const tAssignee = ticket?.assigneeId ?? '';
  const tPriority = ticket?.priority ?? 'MEDIUM';
  const tDue = ticket?.dueAt ?? null;
  useEffect(() => {
    setAssign({ assigneeId: tAssignee, priority: tPriority, dueDate: tDue ? vnDayOf(tDue) : '' });
    setClosing(false); setReason(''); setResolving(false); setResult(''); setInternal(false);
  }, [tId, tAssignee, tPriority, tDue]);

  // Chỉ nhân sự đang hoạt động thuộc đúng chi nhánh của ticket — trùng với ràng buộc assertAssignee ở server.
  const staff = useMemo(() => db.users.filter((u) =>
    (u.role === 'STAFF' || u.role === 'FACILITY_MANAGER')
    && u.status === 'ACTIVE'
    && u.facilityIds.some((f) => String(f) === String(ticket?.facilityId)),
  ), [db.users, ticket?.facilityId]);

  if (!ticket || !user) return null;
  const t = db.tickets.find((x) => x._id === ticket._id) ?? ticket;
  const isCustomer = user.role === 'CUSTOMER';
  // Việc "Vô hiệu thẻ …" (B2) đóng / xong qua nút xác nhận khoá — không đổi trạng thái tay ở đây.
  const actions = t.accessRequestId ? [] : nextStates(TICKET_MACHINE, t.status, user.role as Actor).filter((s) => s !== 'ASSIGNED');
  const needsReason = !isCustomer && t.status !== 'RESOLVED';
  // Kết quả xử lý bắt buộc với phiếu của khách (BE: 422 RESOLUTION_REQUIRED); việc nội bộ ghi hay không tuỳ người làm.
  const resultRequired = t.kind === 'CUSTOMER_ISSUE';
  // CLOSED là trạng thái cuối — không trao đổi thêm, không mở lại được.
  const move = (s: (typeof actions)[number]) => {
    if (s === 'RESOLVED' && !isCustomer) { setResolving(true); setClosing(false); return; }
    if (s === 'CLOSED' && needsReason) { setClosing(true); setResolving(false); return; }
    if (s === 'CLOSED' && !window.confirm(`Đóng yêu cầu ${t.ticketNumber}? Không mở lại được.`)) return;
    void run('setTicketStatus', { ticketId: t._id, to: s }, `Đã chuyển sang "${TICKET_STATUS[s].label}"`);
  };

  // Góp ý 17/11: nút ở chân hộp chỉ MỞ ô ghi kết quả / lý do; khi ô đang mở thì ẩn nút đó — nút gửi trong ô mang tên khác, không còn hai nút
  // "Đánh dấu đã xử lý" (hay hai nút "Đóng yêu cầu") cùng lúc.
  const footerActions = actions.filter((s) => !(s === 'RESOLVED' && resolving) && !(s === 'CLOSED' && closing));

  return (
    <Modal open onClose={onClose} size="lg" title={t.subject} description={`${t.ticketNumber} · ${facilityName(db, t.facilityId)}`}
      footer={footerActions.length > 0 && footerActions.map((s) => (
        <Button key={s} variant={s === 'CLOSED' ? 'secondary' : 'primary'} size="sm" onClick={() => move(s)}>{ACTION_LABEL[s] ?? s}</Button>
      ))}>
      <div className="flex flex-wrap gap-2">
        <StatusBadge map={TICKET_STATUS} value={t.status} />
        <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
        <Badge>{TICKET_CATEGORY[t.category]}</Badge>
      </div>
      <div className="mt-4"><KV items={[['Người gửi', userName(db, t.reporterId)], ['Phụ trách', t.assigneeId ? userName(db, t.assigneeId) : 'Chưa giao'], ['Kho', t.unitId ? unitLabel(db, t.unitId) : '—'], ['Hạn xử lý', t.dueAt ? fmtDate(t.dueAt) : 'Chưa đặt']]} /></div>
      {resolving && (
        <div className="mt-4 space-y-2 rounded-lg bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-200">
          <p className="text-sm font-medium text-emerald-900">{resultRequired ? 'Kết quả xử lý — khách nhận như tin nhắn của chi nhánh (kèm email)' : 'Kết quả xử lý (không bắt buộc với việc nội bộ)'}</p>
          <input className={inputCls} maxLength={500} value={result} onChange={(e) => setResult(e.target.value)} placeholder="VD: Đã thay lò xo cửa cuốn, cửa kéo nhẹ bình thường" aria-label="Kết quả xử lý" />
          {resultRequired && result.trim().length > 0 && result.trim().length < 5 && <p className="text-xs text-red-600">Tối thiểu 5 ký tự</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setResolving(false)}>Thôi</Button>
            <Button size="sm" disabled={busy || (resultRequired && result.trim().length < 5)}
              onClick={() => void run('setTicketStatus', { ticketId: t._id, to: 'RESOLVED', reason: result }, resultRequired ? 'Đã xử lý — kết quả đã gửi cho khách' : 'Đã đánh dấu đã xử lý', () => { setResolving(false); setResult(''); })}>
              {resultRequired ? 'Gửi kết quả & hoàn tất' : 'Xác nhận đã xử lý'}
            </Button>
          </div>
        </div>
      )}
      {closing && (
        <div className="mt-4 space-y-2 rounded-lg bg-red-50 p-3 ring-1 ring-inset ring-red-200">
          <p className="text-sm font-medium text-red-900">Đóng yêu cầu chưa giải quyết — ghi lý do (khách thấy trong yêu cầu và nhận qua email)</p>
          <textarea className={inputCls} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Đã gọi điện giải đáp trực tiếp cho khách" aria-label="Lý do đóng yêu cầu" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setClosing(false)}>Thôi</Button>
            <Button size="sm" variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => void run('setTicketStatus', { ticketId: t._id, to: 'CLOSED', reason }, 'Đã đóng yêu cầu — khách nhận lý do qua email', () => setClosing(false))}>Gửi lý do & đóng</Button>
          </div>
        </div>
      )}
      {t.closeReason && <p className="mt-3 text-sm text-stone-600">Lý do đóng: {t.closeReason}</p>}
      {user.role === 'FACILITY_MANAGER' && t.status !== 'CLOSED' && (
        <div className="mt-4 rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
          <p className="text-xs font-medium text-stone-600">Giao cho nhân viên chi nhánh · mức ưu tiên · hạn xử lý</p>
          <div className="mt-2">
            <TicketAssignFields value={assign} onChange={setAssign} staff={staff} />
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!assign.assigneeId || !assignChanged(t, assign) || !assignDueValid(t, assign)}
              onClick={() => void run('assignTicket', assignPayload(t, assign), 'Đã giao việc')}>
              {t.assigneeId ? 'Giao lại / cập nhật' : 'Giao việc'}
            </Button>
          </div>
          {staff.length === 0 && <p className="mt-2 text-xs text-orange-700">Chi nhánh này chưa có nhân viên nào đang hoạt động.</p>}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {t.messages.filter((m) => !isCustomer || !m.internal).map((m, i) => {
          const mine = m.authorId === user._id;
          // Góp ý mục 4 (#12): ghi chú nội bộ luôn nền vàng nhạt + nhãn "Nội bộ" (kể cả của chính mình) — không lẫn với tin gửi khách.
          return (
            <div key={i} className={cx('max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm', mine && 'ml-auto', m.internal ? 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-300' : mine ? 'bg-brand-700 text-white' : 'bg-stone-100')}>
              <p className={cx('mb-1 flex flex-wrap items-center gap-1.5 text-[11px]', m.internal ? 'text-amber-800' : mine ? 'text-brand-100' : 'text-stone-500')}>
                {m.internal && <span className="rounded bg-amber-200 px-1.5 py-px font-semibold text-amber-900">Nội bộ</span>}
                <span>{userName(db, m.authorId)} · {fmtDateTime(m.at)}</span>
              </p>
              <p className="whitespace-pre-line">{m.body}</p>
            </div>
          );
        })}
        {t.messages.length === 0 && <p className="text-sm text-stone-500">Chưa có trao đổi.</p>}
      </div>
      {t.status !== 'CLOSED' && (
        <form className="mt-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run('addTicketMessage', { ticketId: t._id, body, internal }, undefined, () => { setBody(''); setInternal(false); }); }}>
          {isCustomer && t.status === 'RESOLVED' && <p className="text-xs text-stone-500">Gửi tin nhắn sẽ mở lại yêu cầu — chi nhánh được báo.</p>}
          <textarea className={cx(inputCls, internal && 'bg-amber-50')} rows={2} placeholder={internal ? 'Ghi chú nội bộ — khách không thấy…' : 'Nhập phản hồi…'} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex items-center justify-between gap-2">
            {!isCustomer ? <label className="flex items-center gap-2 text-xs text-stone-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Ghi chú nội bộ (khách không thấy)</label> : <span />}
            <Button size="sm" type="submit" disabled={!body.trim()}>{internal ? 'Lưu ghi chú nội bộ' : 'Gửi'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
