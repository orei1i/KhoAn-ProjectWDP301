'use client';

import { useStore } from '@/shared/store/store';
import { facilityStats } from '@/shared/lib/domain';
import { pct } from '@/shared/lib/format';
import { Card, PageHeader } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { UnitMap } from '@/features/facilities/unit-map';

export default function StaffUnits() {
  const { db } = useStore();
  const scope = useFacilityScope();
  const s = facilityStats(db, scope.facilityId);
  return (
    <>
      <PageHeader title="Sơ đồ kho" description={`Lấp đầy ${pct(s.occupancy)} · ${s.available} kho trống · ${s.maintenance} đang bảo trì`} actions={<FacilityPicker scope={scope} />} />
      <Card className="p-5"><UnitMap facilityId={scope.facilityId} /></Card>
    </>
  );
}
