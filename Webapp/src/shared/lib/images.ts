import { FACILITY_PHOTOS, PHOTO_CREDIT, type FacilityPhotoKey, type UnitCategory } from '@ssm/shared';

/**
 * MỘT chỗ duy nhất quyết định trang web dùng ảnh nào (ảnh nằm ở Webapp/public/images/kho/<key>.jpg).
 * Có ảnh mới (VD ảnh AI / ảnh thật của chi nhánh): chép file vào thư mục trên rồi đổi các bảng dưới đây —
 * không cần sửa từng trang. Ảnh hiện tại là ảnh minh hoạ, nơi hiển thị phải kèm `PHOTO_CREDIT`.
 */
export const photoSrc = (key: FacilityPhotoKey) => `/images/kho/${key}.jpg`;

/** Ảnh lớn đầu trang chủ. */
export const HERO_PHOTO = photoSrc('mat-tien-cua-cuon');
/** Ảnh nền khung đăng nhập / đăng ký. */
export const AUTH_PHOTO = photoSrc('hanh-lang-kho');

/** Loại kho → ảnh minh hoạ. Khớp `UNIT_CATEGORY_GUIDE[c].photo` của @ssm/shared (app dùng cùng ảnh). */
export const CATEGORY_PHOTO: Record<UnitCategory, string> = {
  LOCKER: photoSrc('tu-locker'),
  SMALL: photoSrc('cua-o-kho'),
  MEDIUM: photoSrc('hanh-lang-kho'),
  LARGE: photoSrc('mat-tien-cua-cuon'),
  XL: photoSrc('kho-drive-up'),
};
export const categoryPhoto = (c: UnitCategory) => CATEGORY_PHOTO[c] ?? HERO_PHOTO;

/** Ảnh đại diện chi nhánh khi chi nhánh chưa có ảnh riêng — xoay vòng cố định theo mã chi nhánh (không đổi giữa các lần tải). */
const BRANCH_PHOTOS: FacilityPhotoKey[] = ['mat-tien-cua-cuon', 'ben-trong-kho', 'kho-drive-up', 'hanh-lang-kho'];
export function facilityPhoto(f: { _id: string; imageUrls?: string[] }) {
  const own = f.imageUrls?.find((u) => /^https:\/\//.test(u));
  if (own) return own;
  const h = [...f._id].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return photoSrc(BRANCH_PHOTOS[h % BRANCH_PHOTOS.length]);
}

/** Bộ ảnh của trang giới thiệu chi nhánh (kèm chú thích). */
export const GALLERY = FACILITY_PHOTOS.map((p) => ({ ...p, src: photoSrc(p.key) }));

export { PHOTO_CREDIT };
