'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import type { CashReport } from '@/shared/api/actions';
import { PAYMENT_TYPE } from '@/shared/lib/labels';
import { agingOf, facilityStats, revenueByMonth, revenueMix } from '@/shared/lib/domain';
import { compactVnd, fmtMonth, monthKey, pct, todayISO, vnd } from '@/shared/lib/format';
import { Card, CardHeader, EmptyState, PageHeader, Progress, Stat, Table, cx, inputCls } from '@/shared/ui';
import { BarChart } from '@/shared/ui/charts';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

export default function Reports() {
  const { db } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const s = facilityStats(db, fid);
  const rev = useMemo(() => revenueByMonth(db, [fid], 6), [db, fid]);
  const thisMonth = monthKey(todayISO());

  // Tuổi nợ cùng định nghĩa "quá hạn" với ô Công nợ quá hạn ở trang Tổng quan và báo cáo ở BE (AGING_BUCKETS / pastDueDays).
  const aging = useMemo(() => agingOf(db, fid), [db, fid]);
  const agingTotal = aging.reduce((x, b) => x + b.amount, 0);

  // Cùng quy tắc thực thu với biểu đồ (khoản gốc đã hoàn vẫn tính gộp, dòng hoàn trừ ra; tháng theo giờ VN).
  const mix = useMemo(() => revenueMix(db, [fid], thisMonth), [db, fid, thisMonth]);

  // Chốt ca tiền mặt theo ngày: tiền mặt từng nhân viên đã thu / đã chi — đối chiếu với két cuối ngày.
  const [cashDate, setCashDate] = useState(todayISO().slice(0, 10));
  const [cash, setCash] = useState<CashReport | null>(null);
  const [cashErr, setCashErr] = useState('');
  useEffect(() => {
    if (!fid || !cashDate) return;
    let alive = true;
    setCash(null); setCashErr('');
    api.get<CashReport>(`/reports/cash?facilityId=${fid}&date=${cashDate}`)
      .then((r) => alive && setCash(r))
      .catch((e: Error) => alive && setCashErr(e.message));
    return () => { alive = false; };
  }, [fid, cashDate, db]);

  const last = rev.at(-1)?.total ?? 0;
  const prev = rev.at(-2)?.total ?? 0;

  return (
    <>
      <PageHeader title="Báo cáo chi nhánh" description="Doanh thu thực thu (đã trừ hoàn tiền), lấp đầy và tuổi nợ." actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Thực thu ${fmtMonth(thisMonth)}`} value={compactVnd(last)} sub={prev ? `${last >= prev ? '▲' : '▼'} ${pct(Math.abs(last - prev) / prev, 1)} so với tháng trước (tháng này chưa hết)` : undefined} tone="green" />
        <Stat label="Doanh thu định kỳ / tháng" value={compactVnd(s.mrr)} sub="Giá thuê hợp đồng đang mở, quy đổi theo tháng" />
        <Stat label="Lấp đầy (số kho)" value={pct(s.occupancy)} sub={`Theo diện tích: ${pct(s.areaOccupancy)}`} tone="blue" />
        <Stat label="Phải thu quá hạn" value={compactVnd(agingTotal)} sub={`${s.overdueCount} hợp đồng · tổng công nợ ${compactVnd(s.outstanding)}`} tone="amber" />
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
              <li key={b.key} className="grid grid-cols-[100px_1fr_auto] items-center gap-3 px-5 py-3 text-sm">
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

      <Card className="mt-6">
        <CardHeader title="Chốt ca tiền mặt" actions={<input type="date" className={cx(inputCls, 'w-44')} max={todayISO().slice(0, 10)} value={cashDate} onChange={(e) => setCashDate(e.target.value)} />} />
        {cashErr ? <p className="px-5 py-4 text-sm text-red-700">{cashErr}</p> : !cash ? <p className="px-5 py-4 text-sm text-stone-500">Đang tải…</p> : (
          <Table rows={cash.byStaff} rowKey={(r) => r.staffId} empty={<EmptyState title="Không có giao dịch tiền mặt" />} columns={[
            { key: 'n', header: 'Nhân viên', cell: (r) => r.fullName },
            { key: 'c', header: 'Đã thu', className: 'text-right tabular-nums', cell: (r) => <span>{vnd(r.collected.total)} <span className="text-xs text-stone-500">({r.collected.count})</span></span> },
            { key: 'o', header: 'Đã chi', className: 'text-right tabular-nums', cell: (r) => <span>{vnd(r.paidOut.total)} <span className="text-xs text-stone-500">({r.paidOut.count})</span></span> },
            { key: 'b', header: 'Phải nộp', className: 'text-right font-medium tabular-nums', cell: (r) => vnd(r.collected.total - r.paidOut.total) },
          ]} />
        )}
        {cash && cash.byStaff.length > 0 && (
          <div className="flex justify-end gap-6 border-t border-stone-100 px-5 py-3 text-sm">
            <span>Thu <b className="tabular-nums">{vnd(cash.totals.collected)}</b></span>
            <span>Chi <b className="tabular-nums">{vnd(cash.totals.paidOut)}</b></span>
            <span>Tồn quỹ <b className="tabular-nums">{vnd(cash.totals.net)}</b></span>
          </div>
        )}
      </Card>
    </>
  );
}
