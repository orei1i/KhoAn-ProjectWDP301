'use client';

import type { ReactNode } from 'react';
import { CalendarCheck, CalendarClock, UserCheck, UserRound, Warehouse } from 'lucide-react';
import type { SupportTicket } from '@ssm/shared';
import type { DB } from '@/shared/lib/mock-data';
import { TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate } from '@/shared/lib/format';
import { Badge, IconTile, StatusBadge } from '@/shared/ui';
import { Meta, QueueRow } from '@/features/staff-ui';
import { TICKET_CATEGORY_ICON } from './ticket-icons';

/**
 * Góp ý 17/11: một dòng phiếu dùng chung cho "Công việc của tôi" (nhân viên), "Yêu cầu & công việc" (quản lý chi nhánh) và "Hàng đợi hôm nay".
 * Chỉ giữ: tiêu đề, nhãn Khách / Nội bộ, mức ưu tiên, ô kho, người tạo / người phụ trách, hạn (hoặc ngày xong), trạng thái.
 */

export const ticketDone = (t: SupportTicket) => t.status === 'RESOLVED' || t.status === 'CLOSED';

/** Lần cuối phiếu chuyển sang Đã xử lý / Đã đóng (lịch sử trạng thái). */
const lastDoneStep = (t: SupportTicket) => [...(t.statusHistory ?? [])].reverse().find((h) => h.to === 'RESOLVED' || h.to === 'CLOSED');

/** Ngày xong việc: lúc đánh dấu đã xử lý / đóng (không phải hạn xử lý). */
export const ticketDoneAt = (t: SupportTicket) => lastDoneStep(t)?.at ?? t.resolvedAt ?? t.updatedAt;

/** Việc nhân viên này đã làm xong: phiếu xong mà họ là người phụ trách, hoặc chính họ bấm xong (VD xác nhận đã khoá thẻ khách báo mất). */
export const ticketFinishedBy = (t: SupportTicket, userId: string) => ticketDone(t) && (t.assigneeId === userId || lastDoneStep(t)?.by === userId);

/** Nhãn phân biệt phiếu khách gửi với việc nội bộ chi nhánh tự giao. */
export function TicketKindBadge({ ticket }: { ticket: SupportTicket }) {
  return ticket.kind === 'CUSTOMER_ISSUE'
    ? <Badge tone="blue">{ticket.recordedBy ? 'Khách · ghi tại quầy' : 'Khách'}</Badge>
    : <Badge tone="gray">Nội bộ</Badge>;
}

export function TicketRow({ db, ticket: t, onSelect, showCreator = true, showAssignee = false, extraBadge, actions }: {
  db: DB; ticket: SupportTicket; onSelect?: () => void;
  /** Người gửi / người giao việc. */
  showCreator?: boolean;
  /** Người phụ trách (hoặc "Chưa giao"). */
  showAssignee?: boolean;
  extraBadge?: ReactNode;
  /** Nút thao tác đặt sau trạng thái. */
  actions?: ReactNode;
}) {
  const Icon = TICKET_CATEGORY_ICON[t.category];
  const done = ticketDone(t);
  const late = !done && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
  const handler = t.assigneeId ?? (done ? lastDoneStep(t)?.by ?? null : null);
  return (
    <QueueRow onSelect={onSelect}
      lead={<IconTile icon={<Icon className="size-4" />} tone={done ? 'gray' : TICKET_PRIORITY[t.priority].tone} />}
      title={t.subject}
      badges={<><TicketKindBadge ticket={t} /><StatusBadge map={TICKET_PRIORITY} value={t.priority} />{extraBadge}</>}
      meta={<>
        {t.unitId && <Meta icon={<Warehouse />}>Kho {unitLabel(db, t.unitId)}</Meta>}
        {/* Việc "Vô hiệu thẻ …" hệ thống tạo đứng tên khách báo mất — ghi rõ, không gọi khách là người "tạo" việc nội bộ. */}
        {showCreator && <Meta icon={<UserRound />}>{t.kind === 'CUSTOMER_ISSUE' ? 'Khách' : t.accessRequestId ? 'Khách báo mất' : 'Tạo'}: {userName(db, t.reporterId)}</Meta>}
        {/* Việc đã xong không có người phụ trách (VD xác nhận khoá thẻ): hiện người bấm xong thay vì "Chưa giao". */}
        {showAssignee && (handler
          ? <Meta icon={<UserCheck />} className="text-stone-600">{t.assigneeId ? 'Phụ trách' : 'Người xử lý'}: {userName(db, handler)}</Meta>
          : !done && <Meta icon={<UserCheck />} className="text-amber-700">Chưa giao</Meta>)}
        {done
          ? <Meta icon={<CalendarCheck />}>Xong {fmtDate(ticketDoneAt(t))}</Meta>
          : <Meta icon={<CalendarClock />} className={late ? 'font-medium text-red-700' : undefined}>{t.dueAt ? `Hạn ${fmtDate(t.dueAt)}${late ? ' · quá hạn' : ''}` : 'Chưa đặt hạn'}</Meta>}
      </>}
      actions={<><StatusBadge map={TICKET_STATUS} value={t.status} />{actions}</>}
    />
  );
}
