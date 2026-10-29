import type { ImageSourcePropType } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';
import type { FacilityPhotoKey, UnitCategory } from '@ssm/shared';
import { FACILITY_PHOTOS, UNIT_CATEGORY_GUIDE } from '@ssm/shared';

/**
 * Hình ảnh và icon đại diện dùng chung — tương đương Webapp/src/features/facilities/visuals.tsx.
 * Hình đóng gói sẵn trong app (require tĩnh) nên xem được cả khi mạng yếu. Là bản PNG của đúng bộ tranh minh hoạ SVG bên
 * Webapp/public/images (kho/ = cảnh chi nhánh, o-kho/ = cut-away từng cỡ kho) — React Native không hiện file SVG qua require.
 */
export type IconName = keyof typeof Ionicons.glyphMap;

// Không giới thiệu camera an ninh: ảnh / mục nào không có trong bảng dưới thì không hiện.
export const PHOTO_SOURCES: Partial<Record<FacilityPhotoKey, ImageSourcePropType>> = {
  'kho-drive-up': require('../../../assets/kho/kho-drive-up.png'),
  'mat-tien-cua-cuon': require('../../../assets/kho/mat-tien-cua-cuon.png'),
  'hanh-lang-kho': require('../../../assets/kho/hanh-lang-kho.png'),
  'cua-o-kho': require('../../../assets/kho/cua-o-kho.png'),
  'ben-trong-kho': require('../../../assets/kho/ben-trong-kho.png'),
  'tu-locker': require('../../../assets/kho/tu-locker.png'),
};

/** Cut-away từng cỡ kho (nền trong suốt, có đường kích thước không ghi số) — đặt trên nền sáng, resizeMode="contain". */
export const CUTAWAY_SOURCES: Record<UnitCategory, ImageSourcePropType> = {
  LOCKER: require('../../../assets/o-kho/locker.png'),
  SMALL: require('../../../assets/o-kho/small.png'),
  MEDIUM: require('../../../assets/o-kho/medium.png'),
  LARGE: require('../../../assets/o-kho/large.png'),
  XL: require('../../../assets/o-kho/xl.png'),
};
export const categoryCutaway = (category?: UnitCategory | string | null): ImageSourcePropType | undefined =>
  category ? CUTAWAY_SOURCES[category as UnitCategory] : undefined;

/** Ảnh có trong app, theo thứ tự giới thiệu. */
export const PHOTOS = FACILITY_PHOTOS.filter((p) => PHOTO_SOURCES[p.key]);

/** Ảnh minh hoạ cho một chi nhánh trong danh sách — xoay vòng theo vị trí để các thẻ không giống hệt nhau. */
export function facilityPhoto(index: number): ImageSourcePropType | undefined {
  if (PHOTOS.length === 0) return undefined;
  return PHOTO_SOURCES[PHOTOS[((index % PHOTOS.length) + PHOTOS.length) % PHOTOS.length].key];
}

/** Ảnh minh hoạ cỡ kho (tủ locker, ô nhỏ, ô drive-up…). */
export function categoryPhoto(category?: UnitCategory | string | null): ImageSourcePropType | undefined {
  const g = category ? UNIT_CATEGORY_GUIDE[category as UnitCategory] : undefined;
  return g ? PHOTO_SOURCES[g.photo] : PHOTO_SOURCES['mat-tien-cua-cuon'];
}

/** Icon đại diện cho từng cỡ kho — dùng khi không có chỗ cho ảnh (danh sách, giỏ, bộ lọc). */
export const CATEGORY_ICON: Record<UnitCategory, IconName> = {
  LOCKER: 'lock-closed-outline', SMALL: 'cube-outline', MEDIUM: 'file-tray-stacked-outline', LARGE: 'business-outline', XL: 'car-outline',
};
export const categoryIcon = (category?: string | null): IconName => CATEGORY_ICON[category as UnitCategory] ?? 'cube-outline';

/** Tiện ích của chi nhánh (chuỗi tự do do vận hành nhập) → icon theo từ khoá; không khớp thì dùng dấu lấp lánh. */
export function amenityIcon(label: string): IconName {
  const s = label.toLowerCase();
  if (s.includes('xe đẩy')) return 'cart-outline';
  if (s.includes('thang')) return 'swap-vertical-outline';
  if (s.includes('bảo vệ') || s.includes('an ninh') || s.includes('ra vào')) return 'shield-checkmark-outline';
  if (s.includes('điều hòa') || s.includes('điều hoà') || s.includes('lạnh')) return 'snow-outline';
  if (s.includes('giờ') || s.includes('24')) return 'time-outline';
  if (s.includes('xe') || s.includes('đỗ')) return 'car-outline';
  return 'sparkles-outline';
}

/** Dịch vụ thêm → icon theo mã dịch vụ (PACK-BOX, PACK-SVC, MOVE-…). */
export function serviceIcon(code?: string): IconName {
  const c = (code ?? '').toUpperCase();
  if (c.startsWith('MOVE')) return 'car-outline';
  if (c === 'PACK-BOX' || c.includes('BOX')) return 'cube-outline';
  if (c.startsWith('PACK')) return 'hand-left-outline';
  return 'construct-outline';
}

/** Màu theo số ô còn trống: hết = đỏ, còn ít (≤ 2) = vàng, còn nhiều = xanh. */
export const availabilityTone = (available: number) => (available === 0 ? 'red' : available <= 2 ? 'amber' : 'green') as 'red' | 'amber' | 'green';
