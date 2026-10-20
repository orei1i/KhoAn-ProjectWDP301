'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, CalendarCheck, ListTodo, Lock, PackageOpen, ScanLine } from 'lucide-react';
import type { SupportTicket } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CONTRACT_STATUS, RESERVATION_STATUS, TICKET_PRIORITY, TICKET_STATUS } from '@/shared/lib/labels';
import { byId, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, relativeDay, todayISO, vnd } from '@/shared/lib/format';
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Stat, StatusBadge } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';

export default function StaffQueue() {
  const { db, user } = useStore();
  const scope = useFacilityScope();
  const [view, setView] = useState<SupportTicket | null>(null);
  const fid = scope.facilityId;
  const T = todayISO();

  const arrivals = db.reservations.filter((r) => r.facilityId === fid && (r.status === 'ALLOCATED' || r.status === 'CONFIRMED') && r.startDate <= addDays(T, 1)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const returns = db.contracts.filter((c) => c.facilityId === fid && c.status === 'MOVE_OUT_PENDING');
  const tickets = db.tickets.filter((t) => t.facilityId === fid && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(t.status)).sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  const overlock = db.contracts.filter((c) => c.facilityId === fid && c.status === 'LOCKED_OUT');

  return (
    <>
      <PageHeader title="Hàng đợi hôm nay" description={`${fmtDate(T)} · khách đến nhận kho, trả kho và việc cần xử lý.`} actions={<><FacilityPicker scope={scope} /><ButtonLink href="/staff/check-in"><ScanLine className="size-4" />Quét QR nhận kho</ButtonLink></>} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Khách đến nhận kho" value={arrivals.length} icon={<CalendarCheck className="size-4" />} tone="blue" sub="Hôm nay & ngày mai" />
        <Stat label="Trả kho chờ kiểm tra" value={returns.length} icon={<PackageOpen className="size-4" />} tone="violet" />
        <Stat label="Yêu cầu đang mở" value={tickets.length} icon={<ListTodo className="size-4" />} tone="amber" />
        <Stat label="Kho bị khóa chặn" value={overlock.length} icon={<Lock className="size-4" />} tone="red" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Khách đến nhận kho" description="Đặt chỗ đã xác nhận có ngày nhận ≤ ngày mai" />
          {arrivals.length === 0 ? <EmptyState title="Không có lượt nhận kho" /> : (
            <ul className="divide-y divide-stone-100">
              {arrivals.map((r) => (
                <li key={r._id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{userName(db, r.customerId)}</p>
                    <p className="text-xs text-stone-500">{r.code} · {typeName(db, r.unitTypeId)} · kho <b>{unitLabel(db, r.unitId)}</b> · {relativeDay(r.startDate)}</p>
                  </div>
                  <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                  {r.status === 'ALLOCATED' && r.startDate <= T
                    ? <ButtonLink href={`/staff/check-in?code=${r.code}`} size="sm">Nhận kho</ButtonLink>
                    : <Badge tone="amber">{r.status === 'CONFIRMED' ? 'Chờ quản lý phân kho' : 'Chưa đến ngày'}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Trả kho" description="Khách đã đăng ký trả kho" actions={<Link href="/staff/move-out" className="text-xs font-medium text-brand-700">Mở quy trình</Link>} />
          {returns.length === 0 ? <EmptyState title="Không có lượt trả kho" /> : (
            <ul className="divide-y divide-stone-100">
              {returns.map((c) => (
                <li key={c._id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span className="grid size-10 place-items-center rounded-lg bg-violet-50 text-xs font-semibold text-violet-800">{unitLabel(db, c.unitId)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{userName(db, c.customerId)}</p>
                    <p className="text-xs text-stone-500">Hẹn {fmtDate(c.moveOut?.scheduledFor)} · giữ chân {vnd(c.deposit.amount)}</p>
                  </div>
                  <Badge tone="violet">{byId(db.units, c.unitId)?.status === 'PENDING_INSPECTION' ? 'Chờ kiểm tra' : 'Chờ nhận chìa'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          {/* Quản lý chi nhánh giao / xử lý phiếu ở trang "Yêu cầu & công việc"; nhân viên ở "Công việc của tôi". */}
          <CardHeader title="Yêu cầu & công việc" actions={<Link href={user?.role === 'FACILITY_MANAGER' ? '/manager/tasks' : '/staff/tasks'} className="text-xs font-medium text-brand-700">Xem tất cả</Link>} />
          {tickets.length === 0 ? <EmptyState title="Không có việc tồn" /> : (
            <ul className="divide-y divide-stone-100">
              {tickets.slice(0, 6).map((t) => (
                <li key={t._id}>
                  <button type="button" onClick={() => setView(t)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-stone-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.subject}</p>
                      <p className="text-xs text-stone-500">{t.assigneeId ? userName(db, t.assigneeId) : 'Chưa giao'} · hạn {fmtDate(t.dueAt)}</p>
                    </div>
                    <StatusBadge map={TICKET_PRIORITY} value={t.priority} />
                    <StatusBadge map={TICKET_STATUS} value={t.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Kho quá hạn — khóa chặn" description="Không cho khách vào kho cho tới khi thanh toán đủ" />
          {overlock.length === 0 ? <EmptyState title="Không có kho bị khóa" /> : (
            <ul className="divide-y divide-stone-100">
              {overlock.map((c) => (
                <li key={c._id} className="flex items-center gap-3 px-5 py-3">
                  <Lock className="size-4 text-red-600" />
                  <p className="flex-1 text-sm"><b>{unitLabel(db, c.unitId)}</b> · {userName(db, c.customerId)} · nợ {vnd(c.balance.outstanding)}</p>
                  <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-stone-500"><ArrowRight className="size-3.5" />Dữ liệu chỉ hiển thị trong phạm vi chi nhánh được phân quyền.</p>
      <TicketModal ticket={view} onClose={() => setView(null)} />
    </>
  );
}
