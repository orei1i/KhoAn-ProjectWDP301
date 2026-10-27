'use client';

import { HANDOVER_METHOD, LEFTOVER_STATUS, type ContractLeftover, type MoveOutHandover } from '@ssm/shared';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { StatusBadge } from '@/shared/ui';
import { PhotoLinks } from '@/shared/ui/photo-links';

/** Đồ khách để lại trong ô sau khi trả kho: giữ đến ngày nào, trạng thái (đang giữ / đã lấy / đã xử lý), mô tả + ảnh. */
export function LeftoverInfo({ leftover: l }: { leftover: Pick<ContractLeftover, 'description' | 'photoUrls'> & Partial<Pick<ContractLeftover, 'holdUntil' | 'status' | 'fee'>> }) {
  return (
    <div className="space-y-1.5 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Đồ để lại{l.holdUntil ? ` · giữ đến ${fmtDate(l.holdUntil)}` : ''}</p>
        {l.status && <StatusBadge map={LEFTOVER_STATUS} value={l.status} />}
      </div>
      {l.description && <p className="whitespace-pre-line">{l.description}</p>}
      {l.status === 'DISPOSED' && (l.fee ?? 0) > 0 && <p className="text-xs">Phí xử lý đồ để lại: {vnd(l.fee ?? 0)}</p>}
      <PhotoLinks urls={l.photoUrls} />
    </div>
  );
}

/** Xác nhận bàn giao lúc nhận lại kho: cách xác nhận, người ký / lý do khách vắng mặt, thời điểm. */
export function HandoverInfo({ handover: h, byName }: { handover: MoveOutHandover; byName?: string }) {
  const who = h.method === 'CUSTOMER_SIGNATURE' ? h.signerName : byName;
  return (
    <p className="text-sm text-stone-700">
      <span className="font-medium">Bàn giao kho:</span> {HANDOVER_METHOD[h.method]}{who ? ` · ${who}` : ''} · {fmtDateTime(h.at)}
      {h.method === 'MANAGER_CONFIRM' && h.reason ? <span className="block text-xs text-stone-500">Lý do: {h.reason}</span> : null}
    </p>
  );
}
