'use client';

import { useState } from 'react';
import type { SupportTicket } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { TICKET_CATEGORY, TICKET_KIND, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate } from '@/shared/lib/format';
import { Card, EmptyState, PageHeader, StatusBadge, Table, Tabs } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';

type Tab = 'mine' | 'overview' | 'done';

export default function StaffTasks() {
  const { db, user } = useStore();
  const scope = useFacilityScope();
  const [tab, setTab] = useState<Tab>('mine');
  const [view, setView] = useState<SupportTicket | null>(null);
  if (!user) return null;
  const all = db.tickets.filter((t) => scope.facilityIds.includes(t.facilityId) && !t.isDeleted);
  const groups: Record<Tab, SupportTicket[]> = {
    mine: all.filter((t) => t.assigneeId === user._id && t.status !== 'CLOSED' && t.status !== 'RESOLVED'),
    overview: all,
    done: all.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED'),
  };
  return (
    <>
      <PageHeader title="Công việc của tôi" actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[{ key: 'mine', label: 'Được giao cho tôi', count: groups.mine.length }, { key: 'overview', label: 'Tổng quan', count: groups.overview.length }, { key: 'done', label: 'Đã xong', count: groups.done.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={groups[tab]} rowKey={(t) => t._id} onRowClick={setView} empty={<EmptyState title="Không có mục nào" />} columns={[
          { key: 's', header: 'Nội dung', cell: (t) => <div><p className="font-medium">{t.subject}</p><p className="text-xs text-stone-500">{TICKET_KIND[t.kind]} · {TICKET_CATEGORY[t.category]}{t.unitId ? ` · kho ${unitLabel(db, t.unitId)}` : ''}</p></div> },
          { key: 'r', header: 'Người tạo', cell: (t) => userName(db, t.reporterId) },
          { key: 'd', header: 'Hạn', cell: (t) => fmtDate(t.dueAt) },
          { key: 'p', header: 'Mức độ', cell: (t) => <StatusBadge map={TICKET_PRIORITY} value={t.priority} /> },
          { key: 'st', header: 'Trạng thái', cell: (t) => <StatusBadge map={TICKET_STATUS} value={t.status} /> },
        ]} />
      </Card>
      <TicketModal ticket={view} onClose={() => setView(null)} />
    </>
  );
}
