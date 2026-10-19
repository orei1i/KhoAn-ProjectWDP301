'use client';

import { useMemo } from 'react';
import { useStore } from '@/shared/store/store';
import { PAYMENT_TYPE } from '@/shared/lib/labels';
import { facilityStats, revenueByMonth } from '@/shared/lib/domain';
import { compactVnd, fmtMonth, monthKey, pct, todayISO, vnd } from '@/shared/lib/format';
import { Card, CardHeader, PageHeader, Progress, Stat, Table } from '@/shared/ui';
import { BarChart } from '@/shared/ui/charts';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

export default function Reports() {
  const { db } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const s = facilityStats(db, fid);
  const rev = useMemo(() => revenueByMonth(db, [fid], 6), [db, fid]);
  const thisMonth = monthKey(todayISO());

  const aging = useMemo(() => {
    const buckets = [{ label: '1–7 ngày', min: 1, max: 7 }, { label: '8–15 ngày', min: 8, max: 15 }, { label: '16–30 ngày', min: 16, max: 30 }, { label: 'Trên 30 ngày', min: 31, max: 9999 }];
    const cs = db.contracts.filter((c) => c.facilityId === fid && c.balance.outstanding > 0);
    return buckets.map((b) => {
      const inB = cs.filter((c) => (c.delinquency?.daysOverdue ?? 0) >= b.min && (c.delinquency?.daysOverdue ?? 0) <= b.max);
      return { ...b, count: inB.length, amount: inB.reduce((x, c) => x + c.balance.outstanding, 0) };
    });
  }, [db.contracts, fid]);
  const agingTotal = aging.reduce((x, b) => x + b.amount, 0);

  const mix = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of db.payments) {
      if (p.facilityId !== fid || p.status !== 'SUCCEEDED' || !p.paidAt || monthKey(p.paidAt) !== thisMonth || p.method === 'INTERNAL') continue;
      m.set(p.type, (m.get(p.type) ?? 0) + (p.direction === 'REFUND' ? -p.amount : p.amount));
    }
    return [...m.entries()].map(([type, amount]) => ({ type, amount })).sort((a, b) => b.amount - a.amount);
  }, [db.payments, fid, thisMonth]);

  const last = rev.at(-1)?.total ?? 0;
  const prev = rev.at(-2)?.total ?? 0;

  return (
    <>
      <PageHeader title="Báo cáo chi nhánh" description="Doanh thu thực thu (đã trừ hoàn tiền), lấp đầy và tuổi nợ." actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Thực thu ${fmtMonth(thisMonth)}`} value={compactVnd(last)} sub={prev ? `${last >= prev ? '▲' : '▼'} ${pct(Math.abs(last - prev) / prev, 1)} so với tháng trước (tháng này chưa hết)` : undefined} tone="green" />
        <Stat label="Doanh thu định kỳ / tháng" value={compactVnd(s.mrr)} sub="Tổng giá thuê hợp đồng đang mở" />
        <Stat label="Lấp đầy (số kho)" value={pct(s.occupancy)} sub={`Theo diện tích: ${pct(s.areaOccupancy)}`} tone="blue" />
        <Stat label="Phải thu quá hạn" value={compactVnd(agingTotal)} sub={`${s.delinquentCount} hợp đồng`} tone="amber" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Thực thu 6 tháng gần nhất" description="Đơn vị: VND · rê chuột để xem chi tiết" />
          <div className="px-5 pb-5 pt-8"><BarChart data={rev.map((r) => ({ label: fmtMonth(r.key), value: r.total }))} format={compactVnd} /></div>
        </Card>
        <Card>
          <CardHeader title="Tuổi nợ" />
          <ul className="divide-y divide-stone-100">
            {aging.map((b) => (
              <li key={b.label} className="grid grid-cols-[100px_1fr_auto] items-center gap-3 px-5 py-3 text-sm">
                <span>{b.label}</span>
                <Progress value={agingTotal ? b.amount / agingTotal : 0} tone={b.min > 15 ? 'red' : 'amber'} />
                <span className="w-32 text-right tabular-nums">{vnd(b.amount)} <span className="text-xs text-stone-500">({b.count})</span></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title={`Cơ cấu thu ${fmtMonth(thisMonth)}`} description="Theo loại khoản thu" />
        <Table rows={mix} rowKey={(r) => r.type} columns={[
          { key: 't', header: 'Loại', cell: (r) => PAYMENT_TYPE[r.type as keyof typeof PAYMENT_TYPE].label },
          { key: 'a', header: 'Số tiền', className: 'text-right tabular-nums', cell: (r) => vnd(r.amount) },
          { key: 'p', header: 'Tỷ trọng', className: 'w-1/3', cell: (r) => <Progress value={last ? Math.max(0, r.amount) / last : 0} /> },
        ]} />
      </Card>
    </>
  );
}
