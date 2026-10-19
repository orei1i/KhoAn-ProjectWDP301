'use client';

import { Banknote, Building2, Gauge, TriangleAlert } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { FACILITY_STATUS } from '@/shared/lib/labels';
import { facilityStats, revenueByMonth } from '@/shared/lib/domain';
import { compactVnd, fmtMonth, pct, vnd } from '@/shared/lib/format';
import { Card, CardHeader, PageHeader, Progress, Stat, StatusBadge, Table } from '@/shared/ui';
import { StackedBarChart } from '@/shared/ui/charts';

export default function OpsHome() {
  const { db } = useStore();
  const active = db.facilities.filter((f) => f.status === 'ACTIVE' && !f.isDeleted);
  const ids = active.map((f) => f._id);
  const rows = active.map((f) => {
    const s = facilityStats(db, f._id);
    const area = db.units.filter((u) => u.facilityId === f._id).reduce((x, u) => x + (db.unitTypes.find((t) => t._id === u.unitTypeId)?.areaM2 ?? 0), 0);
    return { f, s, area, perM2: area ? s.mrr / area : 0 };
  });
  const rev = revenueByMonth(db, ids, 6);
  const tot = rows.reduce((a, r) => ({ units: a.units + r.s.total, occ: a.occ + r.s.occupied, rentable: a.rentable + r.s.total - r.s.maintenance, mrr: a.mrr + r.s.mrr, overdue: a.overdue + r.s.overdue }), { units: 0, occ: 0, rentable: 0, mrr: 0, overdue: 0 });

  return (
    <>
      <PageHeader title="Tổng quan chuỗi" description="So sánh hiệu quả các chi nhánh đang hoạt động." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Chi nhánh hoạt động" value={`${active.length}/${db.facilities.length}`} sub={`${tot.units} kho`} icon={<Building2 className="size-4" />} />
        <Stat label="Lấp đầy toàn chuỗi" value={pct(tot.rentable ? tot.occ / tot.rentable : 0)} sub={`${tot.occ}/${tot.rentable} kho khả dụng`} icon={<Gauge className="size-4" />} tone="blue" />
        <Stat label="Doanh thu định kỳ / tháng" value={compactVnd(tot.mrr)} icon={<Banknote className="size-4" />} tone="green" />
        <Stat label="Công nợ quá hạn" value={compactVnd(tot.overdue)} icon={<TriangleAlert className="size-4" />} tone="amber" />
      </div>

      <Card className="mt-6">
        <CardHeader title="Thực thu theo chi nhánh" description="6 tháng gần nhất · rê chuột để xem chi tiết" />
        <div className="p-5">
          <StackedBarChart
            data={rev.map((r) => ({ label: fmtMonth(r.key), parts: r.byFacility }))}
            series={active.map((f) => ({ key: f._id, label: f.name }))}
            format={compactVnd}
          />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="So sánh chi nhánh" />
        <Table rows={rows} rowKey={(r) => r.f._id} columns={[
          { key: 'n', header: 'Chi nhánh', cell: (r) => <div><p className="font-medium">{r.f.name}</p><p className="text-xs text-stone-500">{r.f.code}</p></div> },
          { key: 'st', header: 'Trạng thái', cell: (r) => <StatusBadge map={FACILITY_STATUS} value={r.f.status} /> },
          { key: 'o', header: 'Lấp đầy', className: 'w-48', cell: (r) => <div className="flex items-center gap-2"><Progress value={r.s.occupancy} /><span className="w-10 text-right text-xs tabular-nums">{pct(r.s.occupancy)}</span></div> },
          { key: 'u', header: 'Kho', className: 'text-right tabular-nums', cell: (r) => r.s.total },
          { key: 'm', header: 'Doanh thu / tháng', className: 'text-right tabular-nums', cell: (r) => vnd(r.s.mrr) },
          { key: 'pm', header: 'Doanh thu / m²', className: 'text-right tabular-nums', cell: (r) => vnd(r.perM2) },
          { key: 'd', header: 'Nợ quá hạn', className: 'text-right tabular-nums', cell: (r) => <span className={r.s.overdue ? 'text-red-700' : ''}>{vnd(r.s.overdue)}</span> },
        ]} />
      </Card>
    </>
  );
}
