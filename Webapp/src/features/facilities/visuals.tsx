import { ArrowUpDown, Boxes, Clock3, HandHelping, LockKeyhole, Package, PackagePlus, ShieldCheck, ShoppingCart, Snowflake, Sparkles, Truck, Warehouse, type LucideIcon } from 'lucide-react';
import type { UnitCategory } from '@ssm/shared';
import { cx } from '@/shared/ui';

/** Icon đại diện cho từng cỡ kho — dùng khi không có chỗ cho ảnh (danh sách, giỏ, bộ lọc). */
export const CATEGORY_ICON: Record<UnitCategory, LucideIcon> = {
  LOCKER: LockKeyhole, SMALL: Package, MEDIUM: Boxes, LARGE: Warehouse, XL: Truck,
};

/** Tiện ích của chi nhánh (chuỗi tự do do vận hành nhập) → icon theo từ khoá; không khớp thì dùng dấu lấp lánh. */
export function amenityIcon(label: string): LucideIcon {
  const s = label.toLowerCase();
  if (s.includes('xe đẩy')) return ShoppingCart;
  if (s.includes('thang')) return ArrowUpDown;
  if (s.includes('bảo vệ') || s.includes('an ninh') || s.includes('ra vào')) return ShieldCheck;
  if (s.includes('điều hòa') || s.includes('điều hoà') || s.includes('lạnh')) return Snowflake;
  if (s.includes('giờ') || s.includes('24')) return Clock3;
  return Sparkles;
}

/** Dịch vụ thêm → icon theo mã dịch vụ (PACK-BOX, PACK-SVC, MOVE-…). */
export function serviceIcon(code?: string): LucideIcon {
  const c = (code ?? '').toUpperCase();
  if (c.startsWith('MOVE')) return Truck;
  if (c === 'PACK-BOX' || c.includes('BOX')) return Package;
  if (c.startsWith('PACK')) return HandHelping;
  return PackagePlus;
}

/** Màu theo số ô còn trống: hết = đỏ, còn ít (≤ 2) = vàng, còn nhiều = xanh. */
export const availabilityTone = (available: number) => (available === 0 ? 'red' : available <= 2 ? 'amber' : 'green') as 'red' | 'amber' | 'green';
const BAR = { red: 'bg-red-500', amber: 'bg-amber-500', green: 'bg-emerald-500' } as const;
const TEXT = { red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700' } as const;

/**
 * Thanh "còn trống": phần tô màu = tỉ lệ ô còn đặt được trên tổng số ô. Số liệu lấy thẳng từ API công khai.
 * `label=false` chỉ vẽ thanh (khi chữ đã hiện ở chỗ khác).
 */
export function AvailabilityBar({ available, total, label = true, className }: { available: number; total: number; label?: boolean; className?: string }) {
  const tone = availabilityTone(available);
  const pct = total > 0 ? Math.min(100, Math.max(available > 0 ? 4 : 0, (available / total) * 100)) : 0;
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className={cx('font-semibold', TEXT[tone])}>{available === 0 ? 'Hết chỗ' : `Còn ${available} ô trống`}</span>
          <span className="tabular-nums text-stone-400">{available}/{total}</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/70" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={available} aria-label={`Còn ${available}/${total} ô trống`}>
        <div className={cx('h-full rounded-full transition-[width] duration-500', BAR[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
