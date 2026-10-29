'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity, ArrowRight, Banknote, CalendarClock, CircleCheck, ClipboardList, Clock, FileText, Gauge, HandCoins, Hourglass, LayoutGrid, ListChecks, ListTodo,
  Lock, PackageOpen, ScrollText, ShieldCheck, ShieldX, TrendingUp, TriangleAlert, UserRound, Warehouse,
} from 'lucide-react';
import { REVENUE_LABEL } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CONTRACT_STATUS, TICKET_PRIORITY, type Tone } from '@/shared/lib/labels';
import { byId, effectivePolicy, facilityStats, revenueByMonth, ticketUrgency, unitLabel, userName } from '@/shared/lib/domain';
import { compactVnd, fmtDate, fmtDateTime, fmtMonth, pct, vnd } from '@/shared/lib/format';
import { Badge, ButtonLink, Card, EmptyState, IconTile, PageHeader, StatCard, StatusBadge } from '@/shared/ui';
import { BarChart, SegmentBar } from '@/shared/ui/charts';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { CATEGORY_ICON } from '@/features/facilities/visuals';
import { TICKET_CATEGORY_ICON } from '@/features/tickets/ticket-icons';
import { Chip, Meta, PanelHeader, QueueRow, QuickTile, SubHeading, UnitTag } from '@/features/staff-ui';
import { MeterRow } from '@/features/backoffice-ui';

const linkCls = 'inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline';

export default function ManagerHome() {
  const { db } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const s = facilityStats(db, fid);
  const policy = effectivePolicy(db, fid);
  const delinquent = db.contracts.filter((c) => c.facilityId === fid && (c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT')).sort((a, b) => b.balance.outstanding - a.balance.outstanding);
  const types = db.unitTypes.filter((t) => t.facilityId === fid);
  const activity = db.audit.filter((a) => a.facilityId === fid).slice(0, 6);

  // ---- Chỉ để trình bày (không đổi dữ liệu / luồng): số việc đang chờ ở từng mục và doanh thu 6 tháng cho biểu đồ.
  const openTickets = db.tickets.filter((t) => t.facilityId === fid && !t.isDeleted && (t.status === 'OPEN' || t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS'));
  const urgent = openTickets.filter((t) => ticketUrgency(t) < 2).sort((a, b) => ticketUrgency(a) - ticketUrgency(b) || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  const claimsOpen = db.claims.filter((c) => c.facilityId === fid && (c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW' || c.status === 'APPROVED'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rev = revenueByMonth(db, [fid], 6);
  const todo = delinquent.length + claimsOpen.length + urgent.length;
  const now = Date.now();

  const quick: { href: string; icon: ReactNode; label: string; count?: number; tone: Tone }[] = [
    { href: '/manager/contracts', icon: <FileText className="size-5" />, label: 'Hợp đồng & công nợ', count: delinquent.length, tone: 'amber' },
    { href: '/manager/tasks', icon: <ListTodo className="size-5" />, label: 'Yêu cầu & công việc', count: openTickets.filter((t) => t.status === 'OPEN').length, tone: 'blue' },
    { href: '/manager/claims', icon: <HandCoins className="size-5" />, label: 'Bồi thường', count: claimsOpen.length, tone: 'violet' },
    { href: '/manager/units', icon: <LayoutGrid className="size-5" />, label: 'Quản lý kho', tone: 'teal' },
    { href: '/manager/reports', icon: <TrendingUp className="size-5" />, label: 'Báo cáo', tone: 'green' },
    { href: '/staff', icon: <ClipboardList className="size-5" />, label: 'Hàng đợi quầy', tone: 'blue' },
    { href: '/staff/move-out', icon: <PackageOpen className="size-5" />, label: 'Trả kho', tone: 'violet' },
    { href: '/manager/audit', icon: <ShieldCheck className="size-5" />, label: 'Nhật ký chi nhánh', tone: 'gray' },
  ];

  return (
    <>
      <PageHeader title="Tổng quan chi nhánh"
        description={(
          <span className="mt-1 flex flex-wrap gap-1.5">
            <Chip icon={<ScrollText />}>Chính sách v{policy.version}</Chip>
            <Chip icon={<Hourglass />}>Ân hạn {policy.gracePeriodDays} ngày</Chip>
            <Chip icon={<Lock />} tone="amber">Khóa truy cập sau {policy.lockoutAfterDays} ngày quá hạn</Chip>
          </span>
        )}
        actions={<FacilityPicker scope={scope} />} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Tỷ lệ lấp đầy" value={pct(s.occupancy)} sub={`${s.occupied}/${s.total - s.maintenance} kho khả dụng · diện tích ${pct(s.areaOccupancy)}`} icon={<Gauge className="size-5" />} href="/manager/units" />
        <StatCard label="Doanh thu định kỳ / tháng" value={compactVnd(s.mrr)} sub={`${s.activeContracts} hợp đồng đang mở`} icon={<Banknote className="size-5" />} tone="green" href="/manager/reports" />
        {/* Chỉ nợ đã quá ân hạn — khớp bảng tuổi nợ ở trang Báo cáo; tổng công nợ (gồm hoá đơn kỳ mới chưa đến hạn) ghi riêng. */}
        <StatCard label="Công nợ quá hạn" value={compactVnd(s.overdue)} sub={`${s.overdueCount} hợp đồng · tổng công nợ ${compactVnd(s.outstanding)}`} icon={<TriangleAlert className="size-5" />} tone={s.overdue > 0 ? 'amber' : 'green'} href="/manager/contracts" />
        <StatCard label="Yêu cầu đang mở" value={openTickets.length} sub={urgent.length ? `${urgent.length} yêu cầu khẩn / cao` : 'Không có yêu cầu khẩn'} icon={<ListTodo className="size-5" />} tone={urgent.length ? 'red' : 'blue'} href="/manager/tasks" />
      </div>

      <nav aria-label="Lối tắt" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quick.map((q) => <QuickTile key={q.href} {...q} />)}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card className="min-w-0">
          <PanelHeader icon={<ListChecks className="size-4" />} tone="amber" title="Cần xử lý" count={todo}
            tip="Hợp đồng quá hạn / bị khoá, hồ sơ bồi thường chưa xong và yêu cầu khẩn / cao của khách."
            action={<ButtonLink href="/manager/contracts" size="sm" variant="secondary">Xử lý công nợ</ButtonLink>} />
          {todo === 0 ? <EmptyState icon={<CircleCheck className="size-6" />} title="Không có việc cần xử lý" description="Không có công nợ quá hạn, hồ sơ bồi thường hay yêu cầu khẩn." /> : (
            <div className="pb-2">
              {delinquent.length > 0 && (
                <>
                  <SubHeading icon={<TriangleAlert />} tone="red" title="Công nợ quá hạn" count={delinquent.length} />
                  <ul className="divide-y divide-stone-100">
                    {delinquent.slice(0, 6).map((c) => (
                      <QueueRow key={c._id} href="/manager/contracts"
                        lead={<UnitTag label={unitLabel(db, c.unitId)} tone={c.status === 'LOCKED_OUT' ? 'red' : 'amber'} />}
                        title={userName(db, c.customerId)}
                        badges={<StatusBadge map={CONTRACT_STATUS} value={c.status} />}
                        meta={<Meta icon={<CalendarClock />}>{c.delinquency?.daysOverdue} ngày quá hạn</Meta>}
                        actions={<span className="text-sm font-semibold tabular-nums text-red-700">{vnd(c.balance.outstanding)}</span>}
                      />
                    ))}
                  </ul>
                </>
              )}
              {claimsOpen.length > 0 && (
                <>
                  <SubHeading icon={<HandCoins />} tone="violet" title="Bồi thường chưa xong" count={claimsOpen.length} />
                  <ul className="divide-y divide-stone-100">
                    {claimsOpen.slice(0, 4).map((x) => (
                      <QueueRow key={x._id} href="/manager/claims"
                        lead={<IconTile icon={<HandCoins className="size-4" />} tone={CLAIM_STATUS[x.status].tone} />}
                        title={userName(db, x.customerId)}
                        badges={<StatusBadge map={CLAIM_STATUS} value={x.status} />}
                        meta={<><Meta mono>{x.claimNumber}</Meta><Meta icon={<Warehouse />}>Kho {unitLabel(db, x.unitId)}</Meta></>}
                        actions={<span className="text-sm font-medium tabular-nums text-stone-700">{vnd(x.review?.approvedAmount ?? x.claimedAmount)}</span>}
                      />
                    ))}
                  </ul>
                </>
              )}
              {urgent.length > 0 && (
                <>
                  <SubHeading icon={<ListTodo />} tone="amber" title="Yêu cầu khẩn / cao" count={urgent.length} />
                  <ul className="divide-y divide-stone-100">
                    {urgent.slice(0, 4).map((t) => {
                      const Icon = TICKET_CATEGORY_ICON[t.category];
                      const late = !!t.dueAt && new Date(t.dueAt).getTime() < now;
                      return (
                        <QueueRow key={t._id} href="/manager/tasks"
                          lead={<IconTile icon={<Icon className="size-4" />} tone={TICKET_PRIORITY[t.priority].tone} />}
                          title={t.subject}
                          badges={<StatusBadge map={TICKET_PRIORITY} value={t.priority} />}
                          meta={<>
                            <Meta icon={<UserRound />}>{t.assigneeId ? userName(db, t.assigneeId) : 'Chưa giao'}</Meta>
                            <Meta icon={<CalendarClock />} className={late ? 'font-medium text-red-700' : undefined}>Hạn {fmtDate(t.dueAt)}</Meta>
                          </>}
                          actions={<ArrowRight className="size-4 text-stone-300" aria-hidden />}
                        />
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </Card>

        <Card className="min-w-0">
          <PanelHeader icon={<Warehouse className="size-4" />} title="Lấp đầy theo loại kho" action={<Link href="/manager/units" className={linkCls}>Quản lý kho <ArrowRight className="size-3.5" /></Link>} />
          <div className="border-b border-stone-100 px-4 py-4 sm:px-5">
            <SegmentBar segments={[
              { key: 'occ', label: 'Đang thuê', value: s.occupied, tone: 'teal' },
              { key: 'res', label: 'Đã giữ', value: s.reserved, tone: 'blue' },
              { key: 'free', label: 'Trống', value: s.available, tone: 'green' },
              { key: 'mt', label: 'Bảo trì', value: s.maintenance, tone: 'amber' },
            ]} />
          </div>
          <ul className="divide-y divide-stone-100">
            {types.map((t) => {
              const us = db.units.filter((u) => u.unitTypeId === t._id);
              const occ = us.filter((u) => u.status === 'OCCUPIED' || u.status === 'PENDING_INSPECTION').length;
              const rentable = us.filter((u) => u.status !== 'MAINTENANCE').length;
              const r = rentable ? occ / rentable : 0;
              const Icon = CATEGORY_ICON[t.category];
              return (
                <MeterRow key={t._id} icon={<Icon className="size-4" />} label={t.name} value={r} tone={r >= 0.9 ? 'red' : r >= 0.75 ? 'amber' : 'teal'} right={`${occ}/${rentable} · ${pct(r)}`} />
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <PanelHeader icon={<TrendingUp className="size-4" />} tone="green" title={`${REVENUE_LABEL} · 6 tháng`}
            tip="Thực thu đã trừ hoàn tiền. Rê chuột lên cột để xem số tiền."
            action={<Link href="/manager/reports" className={linkCls}>Báo cáo <ArrowRight className="size-3.5" /></Link>} />
          <div className="px-4 pb-4 pt-8 sm:px-5"><BarChart data={rev.map((r) => ({ label: fmtMonth(r.key), value: r.total }))} format={compactVnd} height={160} /></div>
        </Card>

        <Card className="min-w-0">
          <PanelHeader icon={<Activity className="size-4" />} tone="gray" title="Hoạt động gần đây" tip="Từ nhật ký kiểm toán của chi nhánh."
            action={<Link href="/manager/audit" className={linkCls}>Nhật ký <ArrowRight className="size-3.5" /></Link>} />
          {activity.length === 0 ? <EmptyState compact icon={<Activity className="size-5" />} title="Chưa có hoạt động" /> : (
            <ul className="divide-y divide-stone-100">
              {activity.map((a) => (
                <QueueRow key={a._id}
                  lead={<IconTile icon={a.result === 'SUCCESS' ? <CircleCheck className="size-4" /> : <ShieldX className="size-4" />} tone={a.result === 'SUCCESS' ? 'green' : 'red'} size="sm" />}
                  title={<span className="font-mono text-xs">{a.action}</span>}
                  meta={<>
                    <Meta icon={<UserRound />}>{a.actorId ? byId(db.users, a.actorId)?.fullName : 'Hệ thống'}</Meta>
                    <Meta icon={<Clock />}>{fmtDateTime(a.at)}</Meta>
                  </>}
                  actions={<Badge tone={a.result === 'SUCCESS' ? 'green' : 'red'}>{a.result === 'SUCCESS' ? 'OK' : 'Từ chối'}</Badge>}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
