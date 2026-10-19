'use client';

import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import type { StorageUnit, UnitStatus } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ACCESS_METHOD, CONTRACT_STATUS, RESERVATION_STATUS, UNIT_STATUS } from '@/shared/lib/labels';
import { byId, typeName, unitRate, userName } from '@/shared/lib/domain';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { Badge, Button, Field, KV, Modal, StatusBadge, TONE_DOT, cx, inputCls } from '@/shared/ui';

const CELL: Record<UnitStatus, string> = {
  AVAILABLE: 'bg-emerald-50 ring-emerald-300 text-emerald-900 hover:bg-emerald-100',
  RESERVED: 'bg-sky-50 ring-sky-300 text-sky-900 hover:bg-sky-100',
  OCCUPIED: 'bg-brand-100 ring-brand-300 text-brand-900 hover:bg-brand-200',
  MAINTENANCE: 'bg-amber-50 ring-amber-300 text-amber-900 hover:bg-amber-100',
  PENDING_INSPECTION: 'bg-violet-50 ring-violet-300 text-violet-900 hover:bg-violet-100',
};

export function UnitMap({ facilityId }: { facilityId: string }) {
  const { db, run } = useStore();
  const [filter, setFilter] = useState<UnitStatus | 'ALL'>('ALL');
  const [sel, setSel] = useState<StorageUnit | null>(null);
  const [reason, setReason] = useState('');
  const units = useMemo(() => db.units.filter((u) => u.facilityId === facilityId && !u.isDeleted), [db.units, facilityId]);
  const floors = [...new Set(units.map((u) => u.location.floor))].sort((a, b) => b - a);
  const counts = Object.fromEntries((Object.keys(UNIT_STATUS) as UnitStatus[]).map((s) => [s, units.filter((u) => u.status === s).length])) as Record<UnitStatus, number>;
  const u = sel ? db.units.find((x) => x._id === sel._id) ?? null : null;
  const contract = u?.currentContractId ? byId(db.contracts, u.currentContractId) : undefined;
  const reservation = u?.currentReservationId ? byId(db.reservations, u.currentReservationId) : undefined;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('ALL')} className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset', filter === 'ALL' ? 'bg-ink text-white ring-ink' : 'bg-white ring-stone-300')}>Tất cả · {units.length}</button>
        {(Object.keys(UNIT_STATUS) as UnitStatus[]).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset', filter === s ? 'bg-ink text-white ring-ink' : 'bg-white ring-stone-300')}>
            <span className={cx('size-2 rounded-full', TONE_DOT[UNIT_STATUS[s].tone])} />{UNIT_STATUS[s].label} · {counts[s]}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-6">
        {floors.map((fl) => (
          <section key={fl}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">{fl < 0 ? 'Tầng hầm' : `Tầng ${fl}`}</h4>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
              {units.filter((x) => x.location.floor === fl).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber)).map((x) => (
                <button key={x._id} onClick={() => { setSel(x); setReason(''); }}
                  className={cx('relative rounded-lg px-2 py-2.5 text-left ring-1 ring-inset transition-colors', CELL[x.status], filter !== 'ALL' && x.status !== filter && 'opacity-25')}>
                  <p className="text-sm font-semibold">{x.unitNumber}</p>
                  <p className="truncate text-[11px] opacity-75">{typeName(db, x.unitTypeId).replace('Phòng ', '')}</p>
                  {x.overlockActive && <Lock className="absolute right-1.5 top-1.5 size-3.5 text-red-600" />}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Modal open={!!u} onClose={() => setSel(null)} title={`Kho ${u?.unitNumber ?? ''}`} description={u ? `${typeName(db, u.unitTypeId)} · Tầng ${u.location.floor} · ${u.location.zone ?? ''}` : ''}
        footer={u && (
          <>
            {u.status === 'AVAILABLE' && <Button variant="secondary" onClick={() => void run('setUnitStatus', { unitId: u._id, to: 'MAINTENANCE', reason: reason || 'Bảo trì' }, 'Đã chuyển sang bảo trì', () => setSel(null))}>Chuyển sang bảo trì</Button>}
            {u.status === 'MAINTENANCE' && <Button onClick={() => void run('setUnitStatus', { unitId: u._id, to: 'AVAILABLE', reason: reason || 'Hoàn tất bảo trì' }, 'Kho đã sẵn sàng cho thuê', () => setSel(null))}>Hoàn tất bảo trì</Button>}
            {/* Ô vừa nhả ra do khách đổi ô kho: không còn hợp đồng nên kiểm tra xong đóng luôn tại đây,
                khác với ô chờ tất toán trả kho (vẫn còn currentContractId) phải đi qua biên bản kiểm tra. */}
            {u.status === 'PENDING_INSPECTION' && !u.currentContractId && (
              <>
                <Button variant="secondary" onClick={() => void run('setUnitStatus', { unitId: u._id, to: 'MAINTENANCE', reason: reason || 'Cần sửa sau khi khách đổi ô' }, 'Đã chuyển sang bảo trì', () => setSel(null))}>Cần bảo trì</Button>
                <Button onClick={() => void run('setUnitStatus', { unitId: u._id, to: 'AVAILABLE', reason: reason || 'Kiểm tra đạt sau khi khách đổi ô' }, 'Kho đã sẵn sàng cho thuê', () => setSel(null))}>Kiểm tra đạt</Button>
              </>
            )}
          </>
        )}>
        {u && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge map={UNIT_STATUS} value={u.status} />
              {u.overlockActive && <Badge tone="red"><Lock className="size-3" />Khóa chặn</Badge>}
            </div>
            <KV items={[
              // Cố ý không truyền `u`: báo giá cho khách tính theo loại kho, hiển thị ở đây phải khớp.
              // Khách tự chọn chu kỳ lúc đặt nên hiện đủ cả 3 giá thay vì chỉ một mức cố định.
              ['Giá theo chu kỳ', `${vnd(unitRate(byId(db.unitTypes, u.unitTypeId)!, 'DAY'))}/ngày · ${vnd(unitRate(byId(db.unitTypes, u.unitTypeId)!, 'WEEK'))}/tuần · ${vnd(unitRate(byId(db.unitTypes, u.unitTypeId)!, 'MONTH'))}/tháng`],
              ['Đổi trạng thái lúc', fmtDateTime(u.statusChangedAt)],
              ['Hình thức khoá', ACCESS_METHOD[u.accessMethod]],
              ['Ghi chú', u.statusReason ?? '—'],
            ]} />
            {contract && (
              <div className="rounded-lg bg-stone-50 p-3 text-sm">
                <p className="font-medium">Hợp đồng {contract.contractNumber} <StatusBadge map={CONTRACT_STATUS} value={contract.status} /></p>
                <p className="mt-1 text-stone-600">{userName(db, contract.customerId)} · đến {fmtDate(contract.endDate)} · công nợ {vnd(contract.balance.outstanding)}</p>
                <p className="mt-1 text-stone-600">Điều hòa: {contract.useAirConditioning ? 'Có dùng' : 'Không dùng'}</p>
              </div>
            )}
            {reservation && (
              <div className="rounded-lg bg-sky-50 p-3 text-sm">
                <p className="font-medium">Giữ cho đặt chỗ {reservation.code} <StatusBadge map={RESERVATION_STATUS} value={reservation.status} /></p>
                <p className="mt-1 text-stone-600">{userName(db, reservation.customerId)} · nhận {fmtDate(reservation.startDate)}</p>
              </div>
            )}
            {(u.status === 'AVAILABLE' || u.status === 'MAINTENANCE' || (u.status === 'PENDING_INSPECTION' && !u.currentContractId)) && (
              <Field label="Lý do / ghi chú"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: thay bản lề cửa cuốn" /></Field>
            )}
            {(u.status === 'RESERVED' || u.status === 'OCCUPIED' || (u.status === 'PENDING_INSPECTION' && !!u.currentContractId)) && (
              <p className="text-xs text-stone-500">Trạng thái này chỉ thay đổi qua quy trình phân kho / nhận kho / trả kho (theo state machine).</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
