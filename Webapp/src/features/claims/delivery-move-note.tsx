'use client';

import { Truck } from 'lucide-react';
import { deliveryMoveFor, fmtDate, SWAP_DELIVERY_CLAIM_DAYS, type DamageClaim } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { Callout } from '@/features/staff-ui';
import { PhotoLinks } from '@/shared/ui/photo-links';

/**
 * RV3: sự cố xảy ra trong SWAP_DELIVERY_CLAIM_DAYS ngày sau khi CHI NHÁNH chuyển đồ đổi ô ("thuê người chuyển") → nhắc người xét: hư hại /
 * mất mát trong lúc chi nhánh chuyển là trách nhiệm của KhoAn; đối chiếu biên bản chuyển đồ (số kiện, ảnh) với hạng mục khách khai.
 */
export function DeliveryMoveNote({ claim }: { claim: Pick<DamageClaim, 'contractId' | 'incidentAt'> }) {
  const { db } = useStore();
  const move = deliveryMoveFor(db.swapRequests, claim.contractId, claim.incidentAt);
  if (!move) return null;
  return (
    <Callout tone="blue" icon={<Truck />} title={`Sự cố trong ${SWAP_DELIVERY_CLAIM_DAYS} ngày sau khi chi nhánh chuyển đồ (${move.requestNumber}, ngày ${fmtDate(move.completedAt)})`}>
      <span className="block">Chi nhánh chuyển nên hư hại / mất mát do việc chuyển là trách nhiệm của KhoAn (vẫn trong mức trách nhiệm Điều 6). Đối chiếu biên bản chuyển đồ với hạng mục khách khai.</span>
      {move.moveCheck && (
        <span className="mt-2 block">
          Biên bản: {move.moveCheck.packages} kiện{move.moveCheck.note ? ` · ${move.moveCheck.note}` : ''}
          <span className="mt-1.5 block"><PhotoLinks urls={move.moveCheck.photoUrls} /></span>
        </span>
      )}
    </Callout>
  );
}
