import type { ClaimStatus, ContractStatus, PaymentMethod, PaymentType, ReservationStatus, TicketStatus } from './enums';

/**
 * XOÁ TÀI KHOẢN KHÁCH = ẨN DANH HOÁ hồ sơ (POST /users/:id/anonymize): không xoá cứng, không cờ xoá mềm — bản ghi người dùng ở lại để
 * hợp đồng, chứng từ, nhật ký vẫn tham chiếu được. Tài khoản đã ẩn danh nhận ra bằng email thay thế `deleted-<id>@deleted.invalid`.
 * Tài khoản nhân sự không xoá — dùng Tạm khoá để tên vẫn còn trên phê duyệt và nhật ký.
 */
export const ANONYMIZED_EMAIL_DOMAIN = 'deleted.invalid';
export const ANONYMIZED_NAME = 'Khách đã xoá dữ liệu';
export const isAnonymizedEmail = (email?: string | null) => !!email && email.toLowerCase().endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`);

/** Lý do xoá tài khoản admin nhập ở trang Người dùng — tối thiểu (ký tự, sau khi bỏ khoảng trắng hai đầu). */
export const ACCOUNT_DELETE_REASON_MIN = 10;

/** Nơi thao tác xoá được gọi — ghi vào nhật ký `user.anonymize` (changes.after.source). */
export type AnonymizeSource = 'USER_PAGE' | 'PRIVACY_REQUEST';

/**
 * Lý do chưa xoá được, theo thứ tự kiểm (POST /users/:id/anonymize báo 422 với mã của mục ĐẦU TIÊN, details.blockers = cả danh sách).
 * Mã giữ nguyên như trước khi có danh sách — API test dựa vào.
 */
export type CustomerDeletionBlocker =
  | { code: 'HAS_OPEN_CONTRACT'; message: string; details: { contracts: { contractNumber: string; status: ContractStatus }[]; reservations: { code: string; status: ReservationStatus; startDate: string | null }[] } }
  | { code: 'LEFTOVER_HELD'; message: string; details: { contracts: { contractNumber: string; holdUntil: string | null }[] } }
  | { code: 'HAS_DEBT'; message: string; details: { total: number; contracts: { contractNumber: string; status: ContractStatus; outstanding: number }[] } }
  | { code: 'HAS_PENDING_PAYOUT'; message: string; details: { total: number; payouts: { type: PaymentType; amount: number; method: PaymentMethod; contractNumber: string | null; reservationCode: string | null; createdAt: string | null }[] } }
  | { code: 'HAS_OPEN_CLAIM'; message: string; details: { claims: { claimNumber: string; status: ClaimStatus; claimedAmount: number | null }[] } }
  | { code: 'HAS_OPEN_TICKET'; message: string; details: { tickets: { ticketNumber: string; status: TicketStatus }[] } }
  | { code: 'DISPUTE_WINDOW_OPEN'; message: string; details: { until: string; lastDay: string; inspections: { contractNumber: string | null; performedAt: string; until: string; lastDay: string }[] } };
export type CustomerDeletionBlockerCode = CustomerDeletionBlocker['code'];

/** GET /users/:id/deletion-check — kiểm trước khi xoá: lý do chặn (kèm chi tiết), việc sẽ làm, thứ được giữ lại. */
export interface CustomerDeletionCheck {
  customer: { _id: string; fullName: string; email: string; status: string };
  canDelete: boolean;
  blockers: CustomerDeletionBlocker[];
  /** Việc thao tác xoá sẽ làm, kèm số lượng khi đếm được rẻ — VD "Xoá 3 ảnh chữ ký". */
  willDo: string[];
  /** Thứ được giữ lại theo Chính sách bảo mật — VD "Giữ 2 hợp đồng (lời văn, họ tên người ký)". */
  keeps: string[];
}
