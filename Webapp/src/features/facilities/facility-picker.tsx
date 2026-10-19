'use client';

import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { scopeIds } from '@/shared/lib/domain';
import { cx, inputCls } from '@/shared/ui';

/** Facility selector limited to the signed-in user's data scope. */
export function useFacilityScope(allowAll = false) {
  const { db, user } = useStore();
  const ids = scopeIds(db, user).filter((id) => db.facilities.find((f) => f._id === id)?.status !== 'UNDER_CONSTRUCTION');
  const [picked, setPicked] = useState<string>(allowAll ? 'ALL' : ids[0] ?? '');
  const facilityIds = picked === 'ALL' ? ids : ids.includes(picked) ? [picked] : ids.slice(0, 1);
  return { picked, setPicked, ids, facilityIds, facilityId: facilityIds[0] ?? '' };
}

export function FacilityPicker({ scope, allowAll = false, className }: { scope: ReturnType<typeof useFacilityScope>; allowAll?: boolean; className?: string }) {
  const { db } = useStore();
  if (scope.ids.length <= 1 && !allowAll) {
    const f = db.facilities.find((x) => x._id === scope.facilityId);
    return <span className={cx('inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-stone-200', className)}><Building2 className="size-4 text-stone-500" />{f?.name ?? '—'}</span>;
  }
  return (
    <select className={cx(inputCls, 'w-auto min-w-52', className)} value={scope.picked} onChange={(e) => scope.setPicked(e.target.value)}>
      {allowAll && <option value="ALL">Tất cả chi nhánh</option>}
      {scope.ids.map((id) => <option key={id} value={id}>{db.facilities.find((f) => f._id === id)?.name}</option>)}
    </select>
  );
}
