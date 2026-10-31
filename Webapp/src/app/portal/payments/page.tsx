'use client';

import { useMemo, useState } from 'react';
import { Banknote, CircleCheck, Clock3, Landmark, ReceiptText, Undo2 } from 'lucide-react';
import { COLLECTED_PAYMENT_STATUSES, GATEWAY_REFUND_PENDING_LABEL } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { PAYMENT_METHOD, PAYMENT_TYPE, paymentStatusLabel } from '@/shared/lib/labels';
import { ProfileDialog } from '@/features/auth/profile-name';
import { ReceiptButton, hasReceipt } from '@/features/payments/receipt-button';
import { byId, facilityName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, IconTile, PageHeader, StatCard, StatusBadge, Table, Tabs } from '@/shared/ui';

type Tab = 'all' | 'due';

export default function MyPayments() {
  const { db, user } = useStore();
  const [tab, setTab] = useState<Tab>('all');
  const [profileOpen, setProfileOpen] = useState(false);
  const mine = useMemo(() => (user ? db.payments.filter((p) => p.customerId === user._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []), [db.payments, user]);
  if (!user) return null;
  // Khoản phải TRẢ còn treo; khoản HOÀN bằng chuyển khoản đang chờ chuyển tính riêng (không phải "chờ thanh toán").
  const due = mine.filter((p) => p.direction === 'CHARGE' && (p.status === 'PENDING' || p.status === 'FAILED'));
  const awaiting = mine.filter((p) => p.direction === 'REFUND' && p.status === 'PENDING');
  // Đợt VNPAY: khoản hoàn qua cổng tự gửi, khách không phải khai tài khoản — banner chuyển khoản chỉ tính khoản chuyển khoản. Tổng "Chờ nhận hoàn" vẫn tính cả hai.
  const awaitingBank = awaiting.filter((p) => p.method === 'BANK_TRANSFER');
  const awaitingVnpay = awaiting.filter((p) => p.method === 'VNPAY');
  // Khoản gốc đã ghi "Đã hoàn" ngay lúc xếp hàng hoàn: tiền chưa đi thì hiện đúng tình trạng của khoản hoàn.
  const vnpayRefundingOf = new Set(awaitingVnpay.map((p) => p.refundOf));
  // Khoản đã hoàn (một phần / toàn bộ) vẫn là tiền khách đã trả — phần hoàn nằm ở "Đã hoàn".
  const paid = mine.filter((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status) && p.direction === 'CHARGE' && p.method !== 'INTERNAL').reduce((s, p) => s + p.amount, 0);
  const refunded = mine.filter((p) => p.direction === 'REFUND' && p.status === 'SUCCEEDED').reduce((s, p) => s + p.amount, 0);
  const rows = tab === 'all' ? mine : due;

  return (
    <>
      {/* Không có khoản hoàn chuyển khoản đang chờ: vẫn cho khai / đổi tài khoản nhận tiền hoàn ngay tại đây (banner bên dưới chỉ hiện khi có khoản chờ). */}
      <PageHeader title="Lịch sử thanh toán" actions={awaitingBank.length === 0 && user.role === 'CUSTOMER' ? <Button size="sm" variant="secondary" onClick={() => setProfileOpen(true)}>{user.customerProfile?.payoutAccount ? 'Đổi tài khoản nhận tiền' : 'Khai tài khoản nhận tiền'}</Button> : undefined} />
      {awaitingVnpay.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <IconTile icon={<Undo2 className="size-5" />} tone="amber" />
          <p className="min-w-0 flex-1">Khoản hoàn <b>{vnd(awaitingVnpay.reduce((s, p) => s + p.amount, 0))}</b> đang được xử lý qua VNPAY, về phương thức bạn đã trả (tối đa 7 ngày làm việc). Bạn không cần làm gì thêm.</p>
        </div>
      )}
      {awaitingBank.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <IconTile icon={<Landmark className="size-5" />} tone="amber" />
          <p className="min-w-0 flex-1">KhoAn đang chuẩn bị chuyển khoản hoàn <b>{vnd(awaitingBank.reduce((s, p) => s + p.amount, 0))}</b> cho bạn.{' '}
            {user.customerProfile?.payoutAccount
              ? <>Tài khoản nhận: {user.customerProfile.payoutAccount.bankName} · ••••{user.customerProfile.payoutAccount.accountNumber.slice(-4)}.</>
              : <b>Bạn chưa khai tài khoản nhận tiền — khai để được chuyển nhanh.</b>}
          </p>
          <Button size="sm" variant={user.customerProfile?.payoutAccount ? 'secondary' : 'primary'} onClick={() => setProfileOpen(true)}>{user.customerProfile?.payoutAccount ? 'Đổi tài khoản nhận' : 'Khai tài khoản nhận tiền'}</Button>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Đã thanh toán" value={vnd(paid)} tone="green" icon={<CircleCheck className="size-5" />} />
        <StatCard label="Chờ thanh toán" value={vnd(due.reduce((s, p) => s + p.amount, 0))} tone={due.length ? 'amber' : 'gray'} icon={<Clock3 className="size-5" />} />
        <StatCard label="Chờ nhận hoàn" value={vnd(awaiting.reduce((s, p) => s + p.amount, 0))} tone={awaiting.length ? 'amber' : 'gray'} icon={<Banknote className="size-5" />} />
        <StatCard label="Đã hoàn" value={vnd(refunded)} tone="violet" icon={<Undo2 className="size-5" />} />
      </div>
      <Tabs tabs={[{ key: 'all', label: 'Tất cả', count: mine.length }, { key: 'due', label: 'Chưa thanh toán', count: due.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={rows} rowKey={(p) => p._id} empty={<EmptyState icon={<ReceiptText className="size-6" />} title={tab === 'due' ? 'Không có khoản chờ thanh toán' : 'Chưa có giao dịch nào'} />} columns={[
          { key: 'date', header: 'Ngày', cell: (p) => fmtDateTime(p.paidAt ?? p.createdAt) },
          { key: 'type', header: 'Khoản', cell: (p) => <div><StatusBadge map={PAYMENT_TYPE} value={p.type} />{p.period && <p className="mt-1 text-xs text-stone-500">Kỳ {fmtDate(p.period.start)} – {fmtDate(p.period.end)}</p>}</div> },
          { key: 'unit', header: 'Kho', cell: (p) => { const c = byId(db.contracts, p.contractId); return <span className="text-sm">{c ? unitLabel(db, c.unitId) : '—'} <span className="text-stone-500">· {facilityName(db, p.facilityId)}</span></span>; } },
          { key: 'method', header: 'Phương thức', cell: (p) => PAYMENT_METHOD[p.method] },
          { key: 'amount', header: 'Số tiền', className: 'text-right tabular-nums', cell: (p) => <span className={p.direction === 'REFUND' ? 'text-violet-700' : ''}>{p.direction === 'REFUND' ? '+' : ''}{vnd(p.amount)}</span> },
          { key: 'status', header: 'Trạng thái', cell: (p) => { const l = vnpayRefundingOf.has(p._id) ? GATEWAY_REFUND_PENDING_LABEL : paymentStatusLabel(p); return <Badge tone={l.tone}>{l.label}</Badge>; } },
          { key: 'receipt', header: '', className: 'text-right', cell: (p) => (hasReceipt(p) ? <ReceiptButton paymentId={p._id} variant="ghost" /> : null) },
        ]} />
      </Card>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
