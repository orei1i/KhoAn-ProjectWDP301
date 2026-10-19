'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { AccessMethod, UnitStatus } from '@ssm/shared';
import { UNIT_STATUS } from '@/shared/lib/labels';
import { cx } from '@/shared/ui';

export interface FloorPlanUnit {
  _id: string;
  unitNumber: string;
  location: { floor: number; zone?: string };
  status: UnitStatus;
  overlockActive?: boolean;
  /** Vắng mặt (luồng đổi ô chưa cần) = không tham gia lọc khoá, không bị làm mờ. Điều hòa KHÔNG ở
   * đây — mọi ô của loại kho hợp lệ đều sẵn có máy lạnh, dùng hay không là add-on chọn lúc đặt
   * (xem toggle "Sử dụng điều hòa" ở panel đặt kho), không gắn với ô cụ thể nào. */
  accessMethod?: AccessMethod;
}

const CELL: Record<UnitStatus, string> = {
  AVAILABLE: 'bg-emerald-50 ring-emerald-300 text-emerald-900 hover:bg-emerald-100 cursor-pointer',
  RESERVED: 'bg-sky-50 ring-sky-200 text-sky-700 cursor-not-allowed opacity-60',
  OCCUPIED: 'bg-stone-100 ring-stone-200 text-stone-500 cursor-not-allowed opacity-60',
  MAINTENANCE: 'bg-amber-50 ring-amber-200 text-amber-700 cursor-not-allowed opacity-60',
  PENDING_INSPECTION: 'bg-violet-50 ring-violet-200 text-violet-700 cursor-not-allowed opacity-60',
};

/**
 * Sơ đồ 2D cơ bản: gom theo tầng, mỗi ô kho là một nút bấm — chỉ ô còn trống mới chọn được.
 * Dùng chung cho khách chọn ô lúc đặt kho và lúc gửi yêu cầu đổi ô (chỉ khác nguồn `items`).
 *
 * Hình thức khoá là thuộc tính của TỪNG Ô (không phải loại kho) — `lockMethod` lọc ngay trên chính
 * sơ đồ này: ô không khớp bị LÀM MỜ VÀ TẮT (không bấm được) nhưng vẫn hiện nguyên vị trí, không bị
 * ẩn khỏi sơ đồ — khách vẫn thấy toàn cảnh để đổi ý lọc lại.
 *
 * Chọn NHIỀU ô (đặt nhiều kho một lượt): truyền `selected` — mỗi lần bấm một ô gọi `onChange`, nơi dùng tự bật/tắt
 * ô đó trong danh sách; ô đã chọn hiện dấu ✓ ngay trên sơ đồ. Không truyền `selected` = chọn một ô như cũ (`value`).
 */
export function FloorPlanPicker({ items, value, onChange, lockMethod = null, selected }: {
  items: FloorPlanUnit[]; value: string | null; onChange: (unitId: string) => void;
  lockMethod?: AccessMethod | null; selected?: readonly string[];
}) {
  const floors = [...new Set(items.map((u) => u.location.floor))].sort((a, b) => b - a);
  const [floor, setFloor] = useState<number | null>(null);
  const activeFloor = floor !== null && floors.includes(floor) ? floor : (floors[0] ?? null);

  if (items.length === 0) return <p className="text-sm text-stone-500">Chưa có ô kho nào thuộc loại này.</p>;

  const matches = (u: FloorPlanUnit) => lockMethod === null || u.accessMethod === undefined || u.accessMethod === lockMethod;

  return (
    <div className="space-y-3">
      {floors.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {floors.map((fl) => (
            <button key={fl} type="button" onClick={() => setFloor(fl)}
              className={cx('rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset', fl === activeFloor ? 'bg-ink text-white ring-ink' : 'text-stone-600 ring-stone-300 hover:bg-stone-50')}>
              {fl < 0 ? 'Tầng hầm' : `Tầng ${fl}`}
            </button>
          ))}
        </div>
      )}
      {floors.filter((fl) => fl === activeFloor).map((fl) => (
        <div key={fl}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
            {items.filter((u) => u.location.floor === fl).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber)).map((u) => {
              const picked = selected ? selected.includes(u._id) : u._id === value;
              const dimmed = !matches(u);
              const pickable = u.status === 'AVAILABLE' && !dimmed;
              return (
                <button key={u._id} type="button" disabled={!pickable} aria-pressed={picked} onClick={() => onChange(u._id)} title={u.location.zone}
                  className={cx('relative rounded-lg px-2 py-2 text-left ring-1 ring-inset transition-colors', CELL[u.status], picked && 'ring-2 ring-brand-600 bg-brand-50', dimmed && 'opacity-30 grayscale cursor-not-allowed hover:bg-transparent')}>
                  <p className="text-sm font-semibold">{u.unitNumber}</p>
                  <p className="truncate text-[10px] opacity-75">{dimmed ? 'Khác lựa chọn' : picked && selected ? '✓ Đã chọn' : pickable ? 'Còn trống' : UNIT_STATUS[u.status].label}</p>
                  {u.overlockActive && <Lock className="absolute right-1 top-1 size-3 text-red-600" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
