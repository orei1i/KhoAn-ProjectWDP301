'use client';

import { Banknote, Gauge, TriangleAlert } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { byId, effectivePolicy, facilityStats, unitLabel, userName } from '@/shared/lib/domain';
import { compactVnd, fmtDateTime, pct, vnd } from '@/shared/lib/format';
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Progress, Stat } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';

export default function ManagerHome() {
  const { db } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const s = facilityStats(db, fid);
  const policy = effectivePolicy(db, fid);
  const delinquent = db.contracts.filter((c) => c.facilityId === fid && (c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT')).sort((a, b) => b.balance.outstanding - a.balance.outstanding);
  const types = db.unitTypes.filter((t) => t.facilityId === fid);
  const activity = db.audit.filter((a) => a.facilityId === fid).slice(0, 6);

  return (
    <>
      <PageHeader title="Tổng quan chi nhánh" description={`Chính sách v${policy.version}: ân hạn ${policy.gracePeriodDays} ngày, khóa truy cập sau ${policy.lockoutAfterDays} ngày quá hạn.`} actions={<FacilityPicker scope={scope} />} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Tỷ lệ lấp đầy" value={pct(s.occupancy)} sub={`${s.occupied}/${s.total - s.maintenance} kho khả dụng · diện tích ${pct(s.areaOccupancy)}`} icon={<Gauge className="size-4" />} />
        <Stat label="Doanh thu định kỳ / tháng" value={compactVnd(s.mrr)} sub={`${s.activeContracts} hợp đồng đang mở`} icon={<Banknote className="size-4" />} tone="green" />
        <Stat label="Công nợ quá hạn" value={compactVnd(s.overdue)} sub={`${s.delinquentCount} hợp đồng`} icon={<TriangleAlert className="size-4" />} tone="amber" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Lấp đầy theo loại kho" />
          <ul className="divide-y divide-stone-100">
            {types.map((t) => {
              const us = db.units.filter((u) => u.unitTypeId === t._id);
              const occ = us.filter((u) => u.status === 'OCCUPIED' || u.status === 'PENDING_INSPECTION').length;
              const rentable = us.filter((u) => u.status !== 'MAINTENANCE').length;
              const r = rentable ? occ / rentable : 0;
              return (
                <li key={t._id} className="grid grid-cols-[140px_1fr_auto] items-center gap-4 px-5 py-3 text-sm">
                  <span className="truncate font-medium">{t.name}</span>
                  <Progress value={r} tone={r >= 0.9 ? 'red' : r >= 0.75 ? 'amber' : 'teal'} />
                  <span className="w-24 text-right tabular-nums text-stone-600">{occ}/{rentable} · {pct(r)}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Công nợ quá hạn" actions={<ButtonLink href="/manager/contracts" size="sm" variant="secondary">Xử lý</ButtonLink>} />
          {delinquent.length === 0 ? <EmptyState title="Không có công nợ quá hạn" /> : (
            <ul className="divide-y divide-stone-100">
              {delinquent.slice(0, 6).map((c) => (
                <li key={c._id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="w-14 font-semibold">{unitLabel(db, c.unitId)}</span>
                  <span className="min-w-0 flex-1 truncate">{userName(db, c.customerId)}</span>
                  <span className="text-xs text-stone-500">{c.delinquency?.daysOverdue} ngày</span>
                  <span className="w-28 text-right font-medium tabular-nums text-red-700">{vnd(c.balance.outstanding)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Hoạt động gần đây" description="Từ nhật ký kiểm toán của chi nhánh" />
          {activity.length === 0 ? <EmptyState title="Chưa có hoạt động" /> : (
            <ul className="divide-y divide-stone-100">
              {activity.map((a) => (
                <li key={a._id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <Badge tone={a.result === 'SUCCESS' ? 'green' : 'red'}>{a.result === 'SUCCESS' ? 'OK' : 'Từ chối'}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{a.action}</span>
                  <span className="text-xs text-stone-500">{a.actorId ? byId(db.users, a.actorId)?.fullName : 'Hệ thống'} · {fmtDateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
