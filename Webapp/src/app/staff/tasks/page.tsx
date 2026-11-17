'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CalendarClock, CircleCheck, HandCoins, ListTodo, ShieldAlert, ShieldCheck, UserRound, Warehouse } from 'lucide-react';
import type { DamageClaim, SupportTicket } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_TYPE } from '@/shared/lib/labels';
import { byId, compareTickets, unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, IconTile, Modal, PageHeader } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { TicketModal } from '@/features/tickets/ticket-thread';
import { TicketRow, ticketDone, ticketDoneAt, ticketFinishedBy } from '@/features/tickets/ticket-row';
import { Ledger, LedgerRow, Meta, PanelHeader, PillFilter, QueueRow } from '@/features/staff-ui';
import { EMPTY_PAYOUT_ID, PayoutIdFields, claimCreatorId, payoutIdPayload, payoutIdReady, type PayoutIdForm } from '@/features/claims/payout-id-fields';

/**
 * Góp ý 17/11: trang của NHÂN VIÊN chỉ còn hai nhóm — việc đang giao cho mình và việc mình đã làm xong. Không có tổng quan cả chi nhánh
 * (quản lý chi nhánh xem ở "Yêu cầu & công việc").
 */
type Tab = 'mine' | 'done';

export default function StaffTasks() {
  const { db, user, run, busy } = useStore();
  const scope = useFacilityScope();
  const [tab, setTab] = useState<Tab>('mine');
  const [view, setView] = useState<SupportTicket | null>(null);
  // Chi tiền mặt bồi thường: hộp đối chiếu giấy tờ người nhận (chủ hợp đồng).
  const [paying, setPaying] = useState<DamageClaim | null>(null);
  const [payId, setPayId] = useState<PayoutIdForm>(EMPTY_PAYOUT_ID);
  const router = useRouter();
  // Trang của nhân viên quầy — quản lý chi nhánh dùng "Yêu cầu & công việc" (phiếu) và "Bồi thường" (chi tiền).
  useEffect(() => { if (user?.role === 'FACILITY_MANAGER') router.replace('/manager/tasks'); }, [user?.role, router]);
  if (!user || user.role === 'FACILITY_MANAGER') return null;
  // Mỗi phiếu một lần (Map theo _id) — một phiếu không bao giờ hiện hai dòng.
  const all = [...new Map(db.tickets.filter((t) => scope.facilityIds.includes(t.facilityId) && !t.isDeleted).map((t) => [t._id, t])).values()];
  // Đợt 16 (B2): khách báo mất thẻ / chìa — việc "Vô hiệu thẻ …" chờ khoá rồi xác nhận (nhân viên hoặc quản lý đều làm được). Nằm ở khung riêng
  // bên dưới, không lặp lại trong danh sách việc của tôi.
  const lostTasks = all.filter((t) => !!t.accessRequestId && !ticketDone(t)).sort(compareTickets);
  const groups: Record<Tab, SupportTicket[]> = {
    // Khẩn cấp > Cao > Trung bình > Thấp (phiếu khách lẫn việc nội bộ); rồi hạn gần nhất.
    mine: all.filter((t) => t.assigneeId === user._id && !ticketDone(t) && !t.accessRequestId).sort(compareTickets),
    // Mới xong trước.
    done: all.filter((t) => ticketFinishedBy(t, user._id)).sort((a, b) => ticketDoneAt(b).localeCompare(ticketDoneAt(a))),
  };
  // Bồi thường đã được quản lý duyệt, khách đến quầy nhận tiền mặt: nhân viên chi (người duyệt không tự chi).
  const cashClaims = db.claims.filter((x) => scope.facilityIds.includes(x.facilityId) && x.status === 'APPROVED' && !x.settlement);
  const confirmBlocked = (t: SupportTicket) => {
    if (!t.accessRequestId || !window.confirm(`${t.subject}: xác nhận đã khoá? Hệ thống báo lại cho khách.`)) return;
    void run('confirmLostBlocked', { requestId: t.accessRequestId }, 'Đã xác nhận khoá — khách được báo qua email');
  };
  return (
    <>
      <PageHeader title="Công việc của tôi" description="Việc quản lý chi nhánh giao cho bạn — việc gấp và sắp tới hạn ở trên cùng." actions={<FacilityPicker scope={scope} />} />
      <PillFilter value={tab} onChange={setTab} options={[
        { key: 'mine', label: 'Công việc của tôi', icon: <ListTodo />, count: groups.mine.length },
        { key: 'done', label: 'Đã hoàn thành', icon: <CircleCheck />, count: groups.done.length },
      ]} />
      <Card className="mt-4">
        {groups[tab].length === 0
          ? <EmptyState icon={<ListTodo className="size-6" />} title={tab === 'mine' ? 'Bạn chưa có việc nào đang mở' : 'Chưa có việc nào bạn đã làm xong'} description={tab === 'mine' ? 'Quản lý chi nhánh giao việc thì việc hiện ở đây.' : undefined} />
          : (
            <ul className="divide-y divide-stone-100">
              {groups[tab].map((t) => <TicketRow key={t._id} db={db} ticket={t} onSelect={() => setView(t)} />)}
            </ul>
          )}
      </Card>
      {lostTasks.length > 0 && (
        <Card className="mt-6">
          <PanelHeader icon={<ShieldAlert className="size-4" />} tone="red" title="Khoá thẻ / chìa khách báo mất" count={lostTasks.length}
            tip="Khoá thẻ / chìa cũ ngay trong giờ làm việc rồi bấm xác nhận; khách được báo." />
          <ul className="divide-y divide-stone-100">
            {lostTasks.map((t) => (
              <QueueRow key={t._id}
                lead={<IconTile icon={<ShieldAlert className="size-4" />} tone="red" />}
                title={t.subject}
                meta={<>
                  {t.unitId && <Meta icon={<Warehouse />}>Kho {unitLabel(db, t.unitId)}</Meta>}
                  <Meta icon={<UserRound />}>{userName(db, t.reporterId)}</Meta>
                  <Meta icon={<CalendarClock />}>Báo lúc {fmtDate(t.createdAt)}</Meta>
                </>}
                actions={<Button size="sm" onClick={() => confirmBlocked(t)}><ShieldCheck className="size-3.5" />Xác nhận đã vô hiệu</Button>}
              />
            ))}
          </ul>
        </Card>
      )}
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
                  : claimCreatorId(x) === user._id
                    // Người lập hồ sơ hộ khách không tự ghi nhận chi tiền.
                    ? <span className="text-xs text-stone-500">Bạn lập hồ sơ — người khác chi</span>
                    : (
                      <Button size="sm" onClick={() => { setPayId(EMPTY_PAYOUT_ID); setPaying(x); }}>
                        <Banknote className="size-3.5" />Chi tiền mặt…
                      </Button>
                    )}
              />
            ))}
          </ul>
        </Card>
      )}
      <TicketModal ticket={view} onClose={() => setView(null)} />
      <Modal open={!!paying} onClose={() => setPaying(null)} title="Chi bồi thường tiền mặt" description={paying ? `${paying.claimNumber} · ${userName(db, paying.customerId)} · kho ${unitLabel(db, paying.unitId)}` : ''}
        footer={paying && <>
          <Button variant="secondary" onClick={() => setPaying(null)}>Đóng</Button>
          <Button disabled={busy || !payoutIdReady(payId)} onClick={() => void run('payClaim', { claimId: paying._id, method: 'CASH', ...payoutIdPayload(payId) }, (v) => `Đã chi ${vnd(v.amount)} tiền mặt cho khách`, () => setPaying(null))}>
            <Banknote className="size-4" />Đã chi {vnd(paying.review?.approvedAmount ?? 0)}
          </Button>
        </>}>
        {paying && (
          <div className="space-y-4">
            <Ledger>
              <LedgerRow total icon={<HandCoins />} label="Số tiền chi" value={vnd(paying.review?.approvedAmount ?? 0)} />
            </Ledger>
            <PayoutIdFields contract={byId(db.contracts, paying.contractId)} customerName={userName(db, paying.customerId)} value={payId} onChange={setPayId} />
            <p className="text-xs text-stone-500">Ghi rõ số tiền trên phiếu chi, khách ký nhận.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
