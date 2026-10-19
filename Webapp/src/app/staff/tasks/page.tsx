'use client';

import { useState } from 'react';
import { Banknote } from 'lucide-react';
import type { SupportTicket } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_TYPE, TICKET_CATEGORY, TICKET_KIND, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, PageHeader, StatusBadge, Table, Tabs } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';

type Tab = 'mine' | 'overview' | 'done';

export default function StaffTasks() {
  const { db, user, run } = useStore();
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
  // Bồi thường đã được quản lý duyệt, khách đến quầy nhận tiền mặt: nhân viên chi (người duyệt không tự chi).
  const cashClaims = db.claims.filter((x) => scope.facilityIds.includes(x.facilityId) && x.status === 'APPROVED' && !x.settlement);
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
      {cashClaims.length > 0 && (
        <Card className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">Chi bồi thường tiền mặt tại quầy</h3>
          <Table rows={cashClaims} rowKey={(x) => x._id} columns={[
            { key: 'n', header: 'Hồ sơ', cell: (x) => <div><p className="font-mono text-xs">{x.claimNumber}</p><p className="text-xs text-stone-500">{CLAIM_TYPE[x.type]} · kho {unitLabel(db, x.unitId)}</p></div> },
            { key: 'k', header: 'Khách hàng', cell: (x) => userName(db, x.customerId) },
            { key: 'a', header: 'Số tiền đã duyệt', className: 'tabular-nums', cell: (x) => vnd(x.review?.approvedAmount ?? 0) },
            { key: 'x', header: '', className: 'text-right', cell: (x) => (x.review?.reviewedBy === user._id
              // Người duyệt không tự chi — để nhân viên / quản lý khác chi.
              ? <span className="text-xs text-stone-500">Bạn đã duyệt — người khác chi</span>
              : (
                <Button size="sm" onClick={() => {
                  if (!window.confirm(`Xác nhận đã chi ${vnd(x.review?.approvedAmount ?? 0)} tiền mặt cho ${userName(db, x.customerId)} (hồ sơ ${x.claimNumber})?`)) return;
                  void run('payClaim', { claimId: x._id, method: 'CASH' }, (v) => `Đã chi ${vnd(v.amount)} tiền mặt cho khách`);
                }}>
                  <Banknote className="size-3.5" />Đã chi tiền mặt
                </Button>
              )) },
          ]} />
          <p className="mt-2 text-xs text-stone-500">Đối chiếu giấy tờ tùy thân của khách trước khi chi, ghi rõ số tiền trên phiếu chi.</p>
        </Card>
      )}
      <TicketModal ticket={view} onClose={() => setView(null)} />
    </>
  );
}
