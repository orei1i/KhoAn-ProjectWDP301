'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { AccessMethod, PublicUnitStatus, UnitStatus } from '@ssm/shared';
import { UNIT_STATUS } from '@/shared/lib/labels';
import { cx } from '@/shared/ui';

export interface FloorPlanUnit {
  _id: string;
  unitNumber: string;
  location: { floor: number; zone?: string };
  /** Sơ đồ công khai chỉ phân biệt còn trống / không thuê được — server có thể trả trạng thái rút gọn (VD 'UNAVAILABLE')
   * thay cho OCCUPIED / RESERVED / MAINTENANCE; chỉ 'AVAILABLE' là chọn được. */
  status: UnitStatus | PublicUnitStatus;
  overlockActive?: boolean;
  /** Vắng mặt (luồng đổi ô chưa cần) = không tham gia lọc khoá, không bị làm mờ. Điều hòa KHÔNG ở
   * đây — mọi ô của loại kho hợp lệ đều sẵn có máy lạnh, dùng hay không là add-on chọn lúc đặt
   * (xem toggle "Sử dụng điều hòa" ở panel đặt kho), không gắn với ô cụ thể nào. */
  accessMethod?: AccessMethod;
}

// Ba trạng thái khách cần phân biệt ngay: ĐANG CHỌN (đậm), CÒN TRỐNG (xanh), KHÔNG THUÊ ĐƯỢC (xám, gạch chéo).
const FREE = 'bg-emerald-50 ring-2 ring-emerald-500 text-emerald-900 hover:bg-emerald-100 cursor-pointer';
const PICKED = 'bg-brand-600 ring-2 ring-brand-800 text-white shadow-md';
const TAKEN = 'bg-stone-100 ring-1 ring-stone-200 text-stone-400 cursor-not-allowed bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(120,113,108,0.12)_6px,rgba(120,113,108,0.12)_8px)]';
/** Nhãn ô không chọn được: trạng thái thật nếu server trả (luồng đổi ô), trạng thái rút gọn / lạ thì "Không thuê được". */
const offLabel = (s: FloorPlanUnit['status']) => (s in UNIT_STATUS ? UNIT_STATUS[s as UnitStatus].label : 'Không thuê được');
const Swatch = ({ cls, label }: { cls: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className={cx('inline-block size-3.5 rounded', cls)} />{label}</span>
);

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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        <Swatch cls="bg-brand-600 ring-2 ring-brand-800" label="Đang chọn" />
        <Swatch cls="bg-emerald-50 ring-2 ring-emerald-500" label="Còn trống" />
        <Swatch cls="bg-stone-200 ring-1 ring-stone-300" label="Không thuê được" />
      </div>
      {floors.filter((fl) => fl === activeFloor).map((fl) => (
        <div key={fl}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
            {items.filter((u) => u.location.floor === fl).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber)).map((u) => {
              const picked = selected ? selected.includes(u._id) : u._id === value;
              const dimmed = !matches(u);
              const pickable = u.status === 'AVAILABLE' && !dimmed;
              return (
                <button key={u._id} type="button" disabled={!pickable && !picked} aria-pressed={picked} onClick={() => onChange(u._id)}
                  title={picked ? 'Đang chọn' : pickable ? `Còn trống${u.location.zone ? ` · ${u.location.zone}` : ''}` : 'Không thuê được'}
                  className={cx('relative rounded-lg px-2 py-2 text-left ring-inset transition-colors', picked ? PICKED : pickable ? FREE : TAKEN)}>
                  <p className="text-sm font-semibold">{u.unitNumber}</p>
                  <p className="truncate text-[10px] opacity-80">{picked ? '✓ Đang chọn' : pickable ? 'Còn trống' : dimmed && u.status === 'AVAILABLE' ? 'Khác loại khoá' : offLabel(u.status)}</p>
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
