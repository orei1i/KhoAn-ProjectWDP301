import type { User } from './entities';
import { isValidPersonName } from './inventory-rules';

/**
 * THÔNG TIN NHẬN DIỆN BÊN B (Bên thuê) — in vào hợp đồng / phụ lục: họ tên, số điện thoại, loại giấy tờ + 4 số cuối. Chính sách
 * bảo mật chỉ cho lưu 4 số cuối (không lưu số giấy tờ đầy đủ). Khách khai trong tài khoản trước khi đặt kho; nhân viên đối chiếu
 * giấy tờ bản gốc khi bàn giao kho và hệ thống ghi lại lần đối chiếu đó vào hợp đồng.
 */
export const ID_TYPES = ['CCCD', 'PASSPORT'] as const;
export type IdType = (typeof ID_TYPES)[number];
export const ID_TYPE_LABEL: Record<IdType, string> = { CCCD: 'Căn cước / CCCD', PASSPORT: 'Hộ chiếu' };

/** 4 ký tự cuối của số giấy tờ (CCCD là số, hộ chiếu có thể có chữ). */
export const ID_LAST4_RE = /^[A-Za-z0-9]{4}$/;
export const ID_LAST4_MESSAGE = 'Nhập đúng 4 ký tự cuối của số giấy tờ (chữ hoặc số)';
export const normalizeIdLast4 = (v: string) => v.trim().toUpperCase();

/** Số điện thoại lưu dạng gọn: chỉ chữ số, có thể có + ở đầu (VD "0901 234 567" → "0901234567"). */
export const normalizePhone = (v: string) => v.trim().replace(/(?!^\+)[^\d]/g, '');
export const STORED_PHONE_RE = /^\+?\d{9,15}$/;
export const PROFILE_PHONE_MESSAGE = 'Số điện thoại gồm 9–15 chữ số, có thể có + ở đầu (VD 0901 234 567)';
export const isValidProfilePhone = (v: string) => STORED_PHONE_RE.test(normalizePhone(v));

/**
 * Họ tên và giấy tờ đã in vào hợp đồng đang có hiệu lực → khách KHÔNG tự sửa (tránh lệch với giấy tờ nhân viên đã đối chiếu);
 * đổi tại quầy, nhân viên đối chiếu bản gốc. Số điện thoại vẫn tự sửa được. Khoá khi còn đặt chỗ đã ký chưa kết thúc hoặc hợp đồng đang mở.
 */
export function identityLocked(
  customerId: string,
  reservations: readonly { customerId: string; status: string; signature?: unknown }[],
  contracts: readonly { customerId: string; status: string }[],
): boolean {
  const OPEN_RSV = ['PENDING', 'CONFIRMED', 'ALLOCATED'];
  const OPEN_CTR = ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT', 'MOVE_OUT_PENDING'];
  return reservations.some((r) => r.customerId === customerId && !!r.signature && OPEN_RSV.includes(r.status))
    || contracts.some((c) => c.customerId === customerId && OPEN_CTR.includes(c.status));
}

/**
 * Những thông tin khách còn thiếu để được đặt kho / ký hợp đồng / gia hạn (rỗng = đủ). Nhân viên / quản lý chỉ cần họ tên hợp lệ.
 * Dùng chung BE (chặn) và Webapp / mobile (nhắc khách bổ sung) để hai bên nói cùng một danh sách.
 */
export function profileGaps(u: Pick<User, 'role' | 'fullName' | 'phone' | 'customerProfile'>): string[] {
  const gaps: string[] = [];
  if (!isValidPersonName(u.fullName)) gaps.push('họ tên');
  if (u.role !== 'CUSTOMER') return gaps;
  if (!u.phone || !STORED_PHONE_RE.test(u.phone)) gaps.push('số điện thoại');
  const p = u.customerProfile;
  if (!p?.idType || !p.idNumberLast4 || !ID_LAST4_RE.test(p.idNumberLast4)) gaps.push('loại giấy tờ tùy thân và 4 số cuối');
  return gaps;
}

/**
 * Kết quả tra khách tại quầy (GET /users/customers/lookup). KHÔNG trả 4 số cuối giấy tờ — nhân viên phải nhập từ giấy tờ bản gốc
 * khi nhận kho / đặt tại quầy và hệ thống tự so khớp; chỉ biết khách đã khai giấy tờ hay chưa (`hasIdentity`).
 */
export interface CustomerLookupResult {
  _id: string; fullName: string; email: string; phone?: string | null; status: User['status'];
  idType: IdType | null; hasIdentity: boolean;
}

/**
 * Nhập sai giấy tờ khi mở kho hộ / giao thẻ, chìa mới / nhận kho: sai lần thứ ID_CHECK_MAX_FAILURES trong ID_CHECK_WINDOW_HOURS giờ (đếm
 * theo hợp đồng, hoặc theo đặt chỗ khi nhận kho; từ lần đối chiếu đúng / mở khoá gần nhất) thì khoá đối chiếu — server trả 423 ID_CHECK_LOCKED cho tới khi Quản lý chi nhánh mở
 * khoá (POST /contracts/:id/id-check/unlock, /reservations/:id/id-check/unlock) hoặc hết 24 giờ (lần sai cũ hơn 24 giờ không còn tính).
 */
export const ID_CHECK_MAX_FAILURES = 5;
export const ID_CHECK_WINDOW_HOURS = 24;

/** Đang khoá đối chiếu giấy tờ? (khoá còn hiệu lực trong ID_CHECK_WINDOW_HOURS giờ kể từ lúc khoá, chưa được mở). */
export function idCheckLocked(x: { idCheck?: { lockedAt?: string | Date | null } | null } | null | undefined, now: number = Date.now()): boolean {
  const at = x?.idCheck?.lockedAt;
  if (!at) return false;
  return now - new Date(at).getTime() < ID_CHECK_WINDOW_HOURS * 3_600_000;
}
