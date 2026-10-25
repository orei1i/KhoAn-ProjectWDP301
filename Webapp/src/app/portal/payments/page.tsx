'use client';

import { useMemo, useState } from 'react';
import { COLLECTED_PAYMENT_STATUSES } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { PAYMENT_METHOD, PAYMENT_TYPE, paymentStatusLabel } from '@/shared/lib/labels';
import { ProfileDialog } from '@/features/auth/profile-name';
import { ReceiptButton, hasReceipt } from '@/features/payments/receipt-button';
import { byId, facilityName, unitLabel } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, PageHeader, Stat, StatusBadge, Table, Tabs } from '@/shared/ui';

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
  // Khoản đã hoàn (một phần / toàn bộ) vẫn là tiền khách đã trả — phần hoàn nằm ở "Đã hoàn".
  const paid = mine.filter((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status) && p.direction === 'CHARGE' && p.method !== 'INTERNAL').reduce((s, p) => s + p.amount, 0);
  const refunded = mine.filter((p) => p.direction === 'REFUND' && p.status === 'SUCCEEDED').reduce((s, p) => s + p.amount, 0);
  const rows = tab === 'all' ? mine : due;

  return (
    <>
      <PageHeader title="Lịch sử thanh toán" />
      {awaiting.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex-1">KhoAn đang chuẩn bị chuyển khoản hoàn <b>{vnd(awaiting.reduce((s, p) => s + p.amount, 0))}</b> cho bạn.{' '}
            {user.customerProfile?.payoutAccount
              ? <>Tài khoản nhận: {user.customerProfile.payoutAccount.bankName} · ••••{user.customerProfile.payoutAccount.accountNumber.slice(-4)}.</>
              : <b>Bạn chưa khai tài khoản nhận tiền — khai để được chuyển nhanh.</b>}
          </p>
          <Button size="sm" variant={user.customerProfile?.payoutAccount ? 'secondary' : 'primary'} onClick={() => setProfileOpen(true)}>{user.customerProfile?.payoutAccount ? 'Đổi tài khoản nhận' : 'Khai tài khoản nhận tiền'}</Button>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Đã thanh toán" value={vnd(paid)} tone="green" />
        <Stat label="Chờ thanh toán" value={vnd(due.reduce((s, p) => s + p.amount, 0))} tone="amber" />
        <Stat label="Chờ nhận hoàn" value={vnd(awaiting.reduce((s, p) => s + p.amount, 0))} tone="amber" />
        <Stat label="Đã hoàn" value={vnd(refunded)} tone="violet" />
      </div>
      <Tabs tabs={[{ key: 'all', label: 'Tất cả', count: mine.length }, { key: 'due', label: 'Chưa thanh toán', count: due.length }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={rows} rowKey={(p) => p._id} columns={[
          { key: 'date', header: 'Ngày', cell: (p) => fmtDateTime(p.paidAt ?? p.createdAt) },
          { key: 'type', header: 'Khoản', cell: (p) => <div><StatusBadge map={PAYMENT_TYPE} value={p.type} />{p.period && <p className="mt-1 text-xs text-stone-500">Kỳ {fmtDate(p.period.start)} – {fmtDate(p.period.end)}</p>}</div> },
          { key: 'unit', header: 'Kho', cell: (p) => { const c = byId(db.contracts, p.contractId); return <span className="text-sm">{c ? unitLabel(db, c.unitId) : '—'} <span className="text-stone-500">· {facilityName(db, p.facilityId)}</span></span>; } },
          { key: 'method', header: 'Phương thức', cell: (p) => PAYMENT_METHOD[p.method] },
          { key: 'amount', header: 'Số tiền', className: 'text-right tabular-nums', cell: (p) => <span className={p.direction === 'REFUND' ? 'text-violet-700' : ''}>{p.direction === 'REFUND' ? '+' : ''}{vnd(p.amount)}</span> },
          { key: 'status', header: 'Trạng thái', cell: (p) => { const l = paymentStatusLabel(p); return <Badge tone={l.tone}>{l.label}</Badge>; } },
          { key: 'receipt', header: '', className: 'text-right', cell: (p) => (hasReceipt(p) ? <ReceiptButton paymentId={p._id} variant="ghost" /> : null) },
        ]} />
      </Card>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
