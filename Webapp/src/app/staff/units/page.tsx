'use client';

import { ClipboardCheck, DoorOpen, Gauge, Wrench } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { facilityStats } from '@/shared/lib/domain';
import { pct } from '@/shared/lib/format';
import { Card, PageHeader, StatCard } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { UnitMap } from '@/features/facilities/unit-map';

export default function StaffUnits() {
  const { db } = useStore();
  const scope = useFacilityScope();
  const s = facilityStats(db, scope.facilityId);
  return (
    <>
      <PageHeader title="Sơ đồ kho" description="Bấm một ô để xem chi tiết." actions={<FacilityPicker scope={scope} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Lấp đầy" value={pct(s.occupancy)} icon={<Gauge className="size-5" />} tone="teal" sub={`Đang dùng ${s.occupied}/${s.total - s.maintenance} ô`} />
        <StatCard label="Ô trống" value={s.available} icon={<DoorOpen className="size-5" />} tone="green" sub={`Trên tổng ${s.total} ô`} />
        <StatCard label="Chờ kiểm tra" value={s.pendingInspection} icon={<ClipboardCheck className="size-5" />} tone="violet" href="/staff/move-out" />
        <StatCard label="Đang bảo trì" value={s.maintenance} icon={<Wrench className="size-5" />} tone="amber" />
      </div>
      <Card className="p-4 sm:p-5"><UnitMap facilityId={scope.facilityId} /></Card>
    </>
  );
}
