'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  ArrowRight, Banknote, CalendarCheck, CalendarClock, CalendarDays, CircleCheck, ConciergeBell, Handshake, KeyRound, LayoutGrid, ListTodo, Lock,
  PackageCheck, PackageOpen, Repeat, ScanLine, Store, Timer, UserPlus, Wallet, Warehouse,
} from 'lucide-react';
import { bookingServicesDue, dueAtBooking, dueAtCheckIn, fmtEndOfDay, fmtHoldUntil, isClosedContract, isUnpaidCod, SIGNING_PREFERENCE, signingPreferenceOf, type RentalContract, type SupportTicket } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CONTRACT_STATUS, RESERVATION_STATUS } from '@/shared/lib/labels';
import { byId, compareTickets, facilityStats, intakeBatchesOf, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, pct, relativeDay, todayISO, vnd } from '@/shared/lib/format';
import { facilityPhoto } from '@/shared/lib/images';
import { Badge, Button, ButtonLink, Card, EmptyState, IconTile, PageHeader, Progress, StatCard, StatusBadge, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';
import { TicketRow } from '@/features/tickets/ticket-row';
import { CounterCollectDialog } from '@/features/payments/counter-collect';
import { CounterOrdersQueue } from '@/features/payments/counter-orders-queue';
import { isAccessResetPending } from '@/features/access/unit-access-fields';
import { moveOutStage } from '@/features/contracts/move-out-settlement';
import { Chip, ChipRow, Meta, PanelHeader, PillFilter, QueueRow, QuickTile, SubHeading, UnitTag } from '@/features/staff-ui';

type Filter = 'all' | 'arrivals' | 'returns' | 'tickets' | 'locked';

export default function StaffQueue() {
  const { db, user } = useStore();
  const scope = useFacilityScope();
  const [view, setView] = useState<SupportTicket | null>(null);
  // Thu nợ tại quầy: kho bị khoá, hoặc khách bất kỳ đến trả nợ (kể cả hợp đồng đã đóng còn nợ sau quyết toán).
  const [collect, setCollect] = useState<RentalContract | null>(null);
  const [debtorId, setDebtorId] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const fid = scope.facilityId;
  const T = todayISO();

  // Kèm đặt chỗ "giữ chỗ, trả tại quầy" còn hạn giữ (khách đến quầy trả tiền giữ chân rồi ký, nhận kho).
  const counterHold = (r: (typeof db.reservations)[number]) => r.status === 'PENDING' && !!r.payAtCounter && (!r.holdExpiresAt || new Date(r.holdExpiresAt).getTime() > Date.now());
  // Đợt 15 (C1): "trả khi nhận kho" nhận HÔM NAY (chưa trả, còn giữ ô) — nhóm riêng "Đến nhận & trả tại quầy hôm nay": khách đến là làm trọn
  // đối chiếu CCCD → in & ký giấy → thu tiền giữ chân → nhận kho.
  const codToday = db.reservations.filter((r) => r.facilityId === fid && isUnpaidCod(r) && counterHold(r) && r.startDate <= T).sort((a, b) => a.code.localeCompare(b.code));
  const arrivals = db.reservations.filter((r) => r.facilityId === fid && !codToday.includes(r) && (((r.status === 'ALLOCATED' || r.status === 'CONFIRMED') && r.startDate <= addDays(T, 1)) || counterHold(r))).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const returns = db.contracts.filter((c) => c.facilityId === fid && c.status === 'MOVE_OUT_PENDING');
  // Góp ý 17/11: nhân viên chỉ thấy việc đang giao cho mình (+ việc khoá thẻ / chìa khách báo mất — ai ở quầy cũng xác nhận được), như trang
  // "Công việc của tôi"; quản lý chi nhánh thấy mọi phiếu đang mở. Khẩn cấp > Cao > Trung bình > Thấp, rồi hạn gần nhất (compareTickets).
  const isStaff = user?.role === 'STAFF';
  const tickets = db.tickets.filter((t) => t.facilityId === fid && !t.isDeleted && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(t.status)
    && (!isStaff || t.assigneeId === user?._id || !!t.accessRequestId)).sort(compareTickets);
  const overlock = db.contracts.filter((c) => c.facilityId === fid && c.status === 'LOCKED_OUT');
  const debtors = db.contracts.filter((c) => c.facilityId === fid && c.balance.outstanding > 0)
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)) || a.contractNumber.localeCompare(b.contractNumber));
  const debtor = debtors.find((c) => c._id === debtorId);
  const tasksHref = user?.role === 'FACILITY_MANAGER' ? '/manager/tasks' : '/staff/tasks';

  // Số việc chờ ở từng quy trình — chỉ để hiện trên ô lối tắt.
  const intakeWaiting = intakeBatchesOf(db).filter((b) => b.facilityId === fid && b.status === 'DECLARED').length;
  // Gồm cả ô khách đã rời mà chưa thu chìa / thẻ (mục riêng ở trang Cấp lại thẻ / chìa, mở hộ).
  const accessOpen = db.accessRequests.filter((r) => r.facilityId === fid && (r.status === 'REQUESTED' || r.status === 'APPROVED')).length
    + db.units.filter((u) => u.facilityId === fid && !u.isDeleted && isAccessResetPending(u)).length;
  const swapsOpen = db.swapRequests.filter((s) => s.facilityId === fid && (s.status === 'SUBMITTED' || s.status === 'APPROVED')).length;
  const servicesOpen = db.serviceOrders.filter((o) => o.facilityId === fid && o.status === 'REQUESTED').length;
  const readyNow = codToday.length + arrivals.filter((r) => counterHold(r) || (r.status === 'ALLOCATED' && r.startDate <= T)).length;

  const facility = byId(db.facilities, fid);
  const stats = facilityStats(db, fid);
  const total = codToday.length + arrivals.length + returns.length + tickets.length + overlock.length;
  const show = (f: Filter) => filter === 'all' || filter === f;

  const quick: { href: string; icon: ReactNode; label: string; count?: number; tone: 'teal' | 'blue' | 'green' | 'violet' | 'amber' | 'gray' }[] = [
    { href: '/staff/check-in', icon: <ScanLine className="size-5" />, label: 'Nhận kho', count: readyNow, tone: 'blue' },
    { href: '/staff/walk-in', icon: <UserPlus className="size-5" />, label: 'Đặt tại quầy', tone: 'teal' },
    { href: '/staff/intake', icon: <PackageCheck className="size-5" />, label: 'Nhập hàng', count: intakeWaiting, tone: 'green' },
    { href: '/staff/move-out', icon: <PackageOpen className="size-5" />, label: 'Trả kho', count: returns.length, tone: 'violet' },
    { href: '/staff/access', icon: <KeyRound className="size-5" />, label: 'Thẻ / chìa, mở hộ', count: accessOpen, tone: 'amber' },
    { href: '/staff/swaps', icon: <Repeat className="size-5" />, label: 'Đổi ô', count: swapsOpen, tone: 'blue' },
    { href: '/staff/services', icon: <ConciergeBell className="size-5" />, label: 'Dịch vụ', count: servicesOpen, tone: 'teal' },
    { href: '/staff/units', icon: <LayoutGrid className="size-5" />, label: 'Sơ đồ kho', tone: 'gray' },
  ];

  return (
    <>
      <PageHeader title="Hàng đợi hôm nay" description={fmtDate(T)} actions={<><FacilityPicker scope={scope} /><ButtonLink href="/staff/check-in"><ScanLine className="size-4" />Quét QR nhận kho</ButtonLink></>} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Khách đến nhận kho" value={codToday.length + arrivals.length} icon={<CalendarCheck className="size-5" />} tone="blue" sub="Hôm nay & ngày mai" href="/staff/check-in" />
        <StatCard label="Trả kho chờ kiểm tra" value={returns.length} icon={<PackageOpen className="size-5" />} tone="violet" href="/staff/move-out" />
        <StatCard label={isStaff ? 'Việc của tôi đang mở' : 'Yêu cầu đang mở'} value={tickets.length} icon={<ListTodo className="size-5" />} tone="amber" href={tasksHref} />
        <StatCard label="Kho bị khóa chặn" value={overlock.length} icon={<Lock className="size-5" />} tone={overlock.length ? 'red' : 'green'} sub={overlock.length ? 'Chờ khách trả nợ' : 'Không có kho bị khoá'} />
      </div>

      <nav aria-label="Lối tắt" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quick.map((q) => <QuickTile key={q.href} {...q} />)}
      </nav>

      {/* Góp ý 17/11: khách đã trả VNPAY tại quầy mà chưa được ghi nhận — không để tiền nằm im. */}
      {fid && <CounterOrdersQueue facilityId={fid} className="mt-6" />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <PanelHeader icon={<ListTodo className="size-4" />} title="Việc hôm nay" count={total} />
          <div className="border-b border-stone-100 px-4 py-2.5 sm:px-5">
            <PillFilter value={filter} onChange={setFilter} options={[
              { key: 'all', label: 'Tất cả', count: total },
              { key: 'arrivals', label: 'Nhận kho', icon: <ScanLine />, count: codToday.length + arrivals.length },
              { key: 'returns', label: 'Trả kho', icon: <PackageOpen />, count: returns.length },
              { key: 'tickets', label: isStaff ? 'Việc của tôi' : 'Yêu cầu', icon: <ListTodo />, count: tickets.length },
              { key: 'locked', label: 'Khoá chặn', icon: <Lock />, count: overlock.length },
            ]} />
          </div>

          {total === 0 ? <EmptyState icon={<CircleCheck className="size-6" />} title="Không còn việc nào" description="Chưa có lượt nhận kho, trả kho hay yêu cầu nào đang chờ." /> : (
            <div className="pb-2">
              {show('arrivals') && codToday.length > 0 && (
                <>
                  <SubHeading icon={<Handshake />} tone="teal" title="Đến nhận & trả tại quầy hôm nay" count={codToday.length} />
                  <ul className="divide-y divide-stone-100">
                    {codToday.map((r) => (
                      <QueueRow key={r._id}
                        lead={<IconTile icon={<Handshake className="size-4" />} tone="teal" />}
                        title={userName(db, r.customerId)}
                        badges={<>{r.signature ? <Badge tone="green">Đã ký</Badge> : <Badge tone={SIGNING_PREFERENCE.PAPER_AT_COUNTER.tone}>{SIGNING_PREFERENCE.PAPER_AT_COUNTER.label}</Badge>}</>}
                        meta={<>
                          <Meta mono>{r.code}</Meta>
                          <Meta icon={<Warehouse />}>{typeName(db, r.unitTypeId)} · ô <b className="text-stone-700">{unitLabel(db, r.unitId)}</b></Meta>
                          <Meta icon={<Banknote />}>Thu {vnd(dueAtBooking(r.quote) + dueAtCheckIn(r.quote) + bookingServicesDue(db.serviceOrders, r._id))}</Meta>
                          {r.holdExpiresAt && <Meta icon={<Timer />} className="text-teal-700">Giữ ô đến hết ngày {fmtEndOfDay(r.holdExpiresAt)}</Meta>}
                        </>}
                        actions={<ButtonLink href={`/staff/check-in?code=${r.code}`} size="sm"><Handshake className="size-3.5" />Làm thủ tục</ButtonLink>}
                      />
                    ))}
                  </ul>
                </>
              )}
              {show('arrivals') && arrivals.length > 0 && (
                <>
                  <SubHeading icon={<ScanLine />} tone="blue" title="Khách đến nhận kho" count={arrivals.length} />
                  <ul className="divide-y divide-stone-100">
                    {arrivals.map((r) => {
                      const hold = counterHold(r);
                      const ready = r.status === 'ALLOCATED' && r.startDate <= T;
                      return (
                        <QueueRow key={r._id}
                          lead={<IconTile icon={hold ? <Store className="size-4" /> : ready ? <ScanLine className="size-4" /> : <CalendarClock className="size-4" />} tone={hold ? 'violet' : ready ? 'blue' : 'amber'} />}
                          title={userName(db, r.customerId)}
                          badges={<>
                            {!r.signature && signingPreferenceOf(r) === 'PAPER_AT_COUNTER' && <Badge tone={SIGNING_PREFERENCE.PAPER_AT_COUNTER.tone}>{SIGNING_PREFERENCE.PAPER_AT_COUNTER.label}</Badge>}
                            <StatusBadge map={RESERVATION_STATUS} value={r.status} />
                          </>}
                          meta={<>
                            <Meta mono>{r.code}</Meta>
                            <Meta icon={<Warehouse />}>{typeName(db, r.unitTypeId)} · ô <b className="text-stone-700">{unitLabel(db, r.unitId)}</b></Meta>
                            <Meta icon={<CalendarDays />}>{relativeDay(r.startDate)}</Meta>
                            {hold && r.holdExpiresAt && <Meta icon={<Timer />} className="text-violet-700">Giữ ô đến {fmtHoldUntil(r.holdExpiresAt)}</Meta>}
                          </>}
                          actions={hold
                            ? <><Badge tone={r.payOnArrival ? 'teal' : 'violet'}>{r.payOnArrival ? `Trả khi nhận kho · nhận ${fmtDate(r.startDate).slice(0, 5)}` : 'Chờ thu tiền tại quầy'}</Badge><ButtonLink href={`/staff/check-in?code=${r.code}`} size="sm"><Banknote className="size-3.5" />Thu tiền</ButtonLink></>
                            : ready
                              ? <ButtonLink href={`/staff/check-in?code=${r.code}`} size="sm"><ScanLine className="size-3.5" />Nhận kho</ButtonLink>
                              : <Badge tone="amber">{r.status === 'CONFIRMED' ? 'Chờ quản lý phân kho' : 'Chưa đến ngày'}</Badge>}
                        />
                      );
                    })}
                  </ul>
                </>
              )}

              {show('returns') && returns.length > 0 && (
                <>
                  <SubHeading icon={<PackageOpen />} tone="violet" title="Trả kho" count={returns.length} />
                  <ul className="divide-y divide-stone-100">
                    {returns.map((c) => {
                      // Đợt 17: bước của lượt trả kho (chờ nhận ô / chờ kiểm / chờ quản lý duyệt / chờ khách xác nhận OTP).
                      const s = moveOutStage(db, c);
                      return (
                        <QueueRow key={c._id} href="/staff/move-out"
                          lead={<UnitTag label={unitLabel(db, c.unitId)} tone="violet" />}
                          title={userName(db, c.customerId)}
                          badges={s && <Badge tone={s.tone} dot>{s.label}</Badge>}
                          meta={<>
                            <Meta icon={<CalendarDays />}>Hẹn {fmtDate(c.moveOut?.scheduledFor)}</Meta>
                            <Meta icon={<Wallet />}>Giữ chân {vnd(c.deposit.amount)}</Meta>
                          </>}
                          actions={<ArrowRight className="size-4 text-stone-300" aria-hidden />}
                        />
                      );
                    })}
                  </ul>
                </>
              )}

              {show('tickets') && tickets.length > 0 && (
                <>
                  {/* Quản lý chi nhánh giao / xử lý phiếu ở trang "Yêu cầu & công việc"; nhân viên ở "Công việc của tôi". */}
                  <SubHeading icon={<ListTodo />} tone="amber" title={isStaff ? 'Việc của tôi' : 'Yêu cầu & công việc'} count={tickets.length} />
                  <ul className="divide-y divide-stone-100">
                    {tickets.slice(0, 6).map((t) => <TicketRow key={t._id} db={db} ticket={t} onSelect={() => setView(t)} showCreator={false} showAssignee={!isStaff} />)}
                  </ul>
                  <div className="px-4 pt-1 sm:px-5">
                    <Link href={tasksHref} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Xem tất cả <ArrowRight className="size-3.5" /></Link>
                  </div>
                </>
              )}

              {show('locked') && overlock.length > 0 && (
                <>
                  <SubHeading icon={<Lock />} tone="red" title="Kho quá hạn — khóa chặn" count={overlock.length} tip="Không cho khách vào kho cho tới khi thanh toán đủ." />
                  <ul className="divide-y divide-stone-100">
                    {overlock.map((c) => (
                      <QueueRow key={c._id}
                        lead={<UnitTag label={unitLabel(db, c.unitId)} tone="red" />}
                        title={userName(db, c.customerId)}
                        badges={<StatusBadge map={CONTRACT_STATUS} value={c.status} />}
                        meta={<Meta icon={<Banknote />} className="font-medium text-red-700">Nợ {vnd(c.balance.outstanding)}</Meta>}
                        actions={c.balance.outstanding > 0 && <Button size="sm" variant="secondary" onClick={() => setCollect(c)}><Banknote className="size-3.5" />Thu tại quầy</Button>}
                      />
                    ))}
                  </ul>
                </>
              )}

              {filter !== 'all' && ({ arrivals, returns, tickets, locked: overlock } as const)[filter].length === 0 && (
                <EmptyState compact icon={<CircleCheck className="size-5" />} title="Không có mục nào" />
              )}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {facility && (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <img src={facilityPhoto(facility)} alt="" loading="lazy" decoding="async" className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-stone-200" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{facility.name}</p>
                  <p className="truncate text-xs text-stone-500">{[facility.address?.district, facility.address?.city].filter(Boolean).join(', ')}</p>
                </div>
              </div>
              <div className="border-t border-stone-100 px-4 py-3">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-stone-600">Lấp đầy</span>
                  <span className="font-semibold tabular-nums text-ink">{pct(stats.occupancy)}</span>
                </div>
                <Progress value={stats.occupancy} className="mt-1.5" />
                <ChipRow className="mt-3">
                  <Chip tone="green">Trống {stats.available}</Chip>
                  {stats.reserved > 0 && <Chip tone="blue">Đã giữ {stats.reserved}</Chip>}
                  {stats.pendingInspection > 0 && <Chip tone="violet">Chờ kiểm tra {stats.pendingInspection}</Chip>}
                  {stats.maintenance > 0 && <Chip tone="amber">Bảo trì {stats.maintenance}</Chip>}
                </ChipRow>
                <Link href="/staff/units" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Mở sơ đồ kho <ArrowRight className="size-3.5" /></Link>
              </div>
            </Card>
          )}

          <Card>
            <PanelHeader icon={<Banknote className="size-4" />} tone="amber" title="Khách đến trả nợ" count={debtors.length} />
            <div className="space-y-2.5 p-4 sm:p-5">
              <select className={inputCls} value={debtorId} onChange={(e) => setDebtorId(e.target.value)} aria-label="Hợp đồng còn nợ">
                <option value="">{debtors.length ? 'Chọn hợp đồng còn nợ…' : 'Không có hợp đồng nào còn nợ'}</option>
                {debtors.map((c) => (
                  <option key={c._id} value={c._id}>{unitLabel(db, c.unitId)} · {userName(db, c.customerId)} · {c.contractNumber} · nợ {vnd(c.balance.outstanding)}{isClosedContract(c.status) ? ' · đã đóng (nợ sau quyết toán)' : ` · ${CONTRACT_STATUS[c.status].label.toLowerCase()}`}</option>
                ))}
              </select>
              <Button size="sm" className="w-full" disabled={!debtor} onClick={() => debtor && setCollect(debtor)}><Banknote className="size-3.5" />Thu tại quầy</Button>
            </div>
          </Card>
        </div>
      </div>
      <TicketModal ticket={view} onClose={() => setView(null)} />
      <CounterCollectDialog contract={collect} onClose={() => { setCollect(null); setDebtorId(''); }} />
    </>
  );
}
