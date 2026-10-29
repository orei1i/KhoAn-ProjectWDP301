'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CalendarClock, ClipboardList, HandCoins, ListTodo, UserRound, Warehouse } from 'lucide-react';
import type { SupportTicket } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_TYPE, TICKET_CATEGORY, TICKET_KIND, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { ticketUrgency, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, IconTile, PageHeader, StatusBadge, Tabs } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';
import { TICKET_CATEGORY_ICON } from '@/features/tickets/ticket-icons';
import { Meta, PanelHeader, QueueRow } from '@/features/staff-ui';

type Tab = 'mine' | 'overview' | 'done';

export default function StaffTasks() {
  const { db, user, run } = useStore();
  const scope = useFacilityScope();
  const [tab, setTab] = useState<Tab>('mine');
  const [view, setView] = useState<SupportTicket | null>(null);
  const router = useRouter();
  // Trang của nhân viên quầy — quản lý chi nhánh dùng "Yêu cầu & công việc" (phiếu) và "Bồi thường" (chi tiền).
  useEffect(() => { if (user?.role === 'FACILITY_MANAGER') router.replace('/manager/tasks'); }, [user?.role, router]);
  if (!user || user.role === 'FACILITY_MANAGER') return null;
  // Yêu cầu khách Khẩn cấp / Cao lên đầu, sau đó theo hạn.
  const all = db.tickets.filter((t) => scope.facilityIds.includes(t.facilityId) && !t.isDeleted)
    .sort((a, b) => ticketUrgency(a) - ticketUrgency(b) || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  const groups: Record<Tab, SupportTicket[]> = {
    mine: all.filter((t) => t.assigneeId === user._id && t.status !== 'CLOSED' && t.status !== 'RESOLVED'),
    overview: all,
    done: all.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED'),
  };
  // Bồi thường đã được quản lý duyệt, khách đến quầy nhận tiền mặt: nhân viên chi (người duyệt không tự chi).
  const cashClaims = db.claims.filter((x) => scope.facilityIds.includes(x.facilityId) && x.status === 'APPROVED' && !x.settlement);
  const now = Date.now();
  return (
    <>
      <PageHeader title="Công việc của tôi" actions={<FacilityPicker scope={scope} />} />
      <Tabs tabs={[{ key: 'mine', label: 'Được giao cho tôi', count: groups.mine.length }, { key: 'overview', label: 'Tổng quan', count: groups.overview.length }, { key: 'done', label: 'Đã xong', count: groups.done.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        {groups[tab].length === 0 ? <EmptyState icon={<ListTodo className="size-6" />} title="Không có mục nào" /> : (
          <ul className="divide-y divide-stone-100">
            {groups[tab].map((t) => {
              const Icon = TICKET_CATEGORY_ICON[t.category];
              const open = t.status !== 'RESOLVED' && t.status !== 'CLOSED';
              const late = open && !!t.dueAt && new Date(t.dueAt).getTime() < now;
              return (
                <QueueRow key={t._id} onSelect={() => setView(t)}
                  lead={<IconTile icon={<Icon className="size-4" />} tone={open ? TICKET_PRIORITY[t.priority].tone : 'gray'} />}
                  title={t.subject}
                  badges={<StatusBadge map={TICKET_PRIORITY} value={t.priority} />}
                  meta={<>
                    <Meta icon={t.kind === 'CUSTOMER_ISSUE' ? <UserRound /> : <ClipboardList />}>{TICKET_KIND[t.kind]} · {TICKET_CATEGORY[t.category]}</Meta>
                    {t.unitId && <Meta icon={<Warehouse />}>Kho {unitLabel(db, t.unitId)}</Meta>}
                    <Meta icon={<UserRound />}>Tạo: {userName(db, t.reporterId)}</Meta>
                    <Meta icon={<CalendarClock />} className={late ? 'font-medium text-red-700' : undefined}>Hạn {fmtDate(t.dueAt)}</Meta>
                  </>}
                  actions={<StatusBadge map={TICKET_STATUS} value={t.status} />}
                />
              );
            })}
          </ul>
        )}
      </Card>
      {cashClaims.length > 0 && (
        <Card className="mt-6">
          <PanelHeader icon={<HandCoins className="size-4" />} tone="violet" title="Chi bồi thường tiền mặt tại quầy" count={cashClaims.length}
            tip="Đối chiếu giấy tờ tùy thân của khách trước khi chi, ghi rõ số tiền trên phiếu chi." />
          <ul className="divide-y divide-stone-100">
            {cashClaims.map((x) => (
              <QueueRow key={x._id}
                lead={<IconTile icon={<HandCoins className="size-4" />} tone="violet" />}
                title={userName(db, x.customerId)}
                badges={<span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-violet-800 ring-1 ring-inset ring-violet-200">{vnd(x.review?.approvedAmount ?? 0)}</span>}
                meta={<>
                  <Meta mono>{x.claimNumber}</Meta>
                  <Meta icon={<Warehouse />}>{CLAIM_TYPE[x.type]} · kho {unitLabel(db, x.unitId)}</Meta>
                </>}
                actions={x.review?.reviewedBy === user._id
                  // Người duyệt không tự chi — để nhân viên / quản lý khác chi.
                  ? <span className="text-xs text-stone-500">Bạn đã duyệt — người khác chi</span>
                  : (
                    <Button size="sm" onClick={() => {
                      if (!window.confirm(`Xác nhận đã chi ${vnd(x.review?.approvedAmount ?? 0)} tiền mặt cho ${userName(db, x.customerId)} (hồ sơ ${x.claimNumber})?`)) return;
                      void run('payClaim', { claimId: x._id, method: 'CASH' }, (v) => `Đã chi ${vnd(v.amount)} tiền mặt cho khách`);
                    }}>
                      <Banknote className="size-3.5" />Đã chi tiền mặt
                    </Button>
                  )}
              />
            ))}
          </ul>
        </Card>
      )}
      <TicketModal ticket={view} onClose={() => setView(null)} />
    </>
  );
}
