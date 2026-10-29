const values = <T extends Record<string, string>>(o: T) => Object.values(o) as T[keyof T][];
export { values as enumValues };

export const Role = { CUSTOMER: 'CUSTOMER', STAFF: 'STAFF', FACILITY_MANAGER: 'FACILITY_MANAGER', OPS_MANAGER: 'OPS_MANAGER', ADMIN: 'ADMIN' } as const;
export type Role = (typeof Role)[keyof typeof Role];
export const FACILITY_SCOPED_ROLES: readonly Role[] = [Role.STAFF, Role.FACILITY_MANAGER];

export const UserStatus = { PENDING_VERIFICATION: 'PENDING_VERIFICATION', ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const FacilityStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION' } as const;
export type FacilityStatus = (typeof FacilityStatus)[keyof typeof FacilityStatus];

export const UnitCategory = { LOCKER: 'LOCKER', SMALL: 'SMALL', MEDIUM: 'MEDIUM', LARGE: 'LARGE', XL: 'XL' } as const;
export type UnitCategory = (typeof UnitCategory)[keyof typeof UnitCategory];

/**
 * Chu kỳ thuê: khách TỰ CHỌN lúc đặt (ngày / tuần / tháng), không gắn cứng theo loại kho.
 * Mỗi loại kho niêm yết sẵn 3 giá (UnitType.rates), khách chọn chu kỳ nào thì tính theo giá đó.
 */
export const RentalPeriod = { DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH' } as const;
export type RentalPeriod = (typeof RentalPeriod)[keyof typeof RentalPeriod];

export const UnitStatus = { AVAILABLE: 'AVAILABLE', RESERVED: 'RESERVED', OCCUPIED: 'OCCUPIED', MAINTENANCE: 'MAINTENANCE', PENDING_INSPECTION: 'PENDING_INSPECTION' } as const;
export type UnitStatus = (typeof UnitStatus)[keyof typeof UnitStatus];

export const ReservationStatus = { PENDING: 'PENDING', CONFIRMED: 'CONFIRMED', ALLOCATED: 'ALLOCATED', CHECKED_IN: 'CHECKED_IN', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' } as const;
export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const CancellationReason = { CUSTOMER_REQUEST: 'CUSTOMER_REQUEST', HOLD_EXPIRED: 'HOLD_EXPIRED', PAYMENT_FAILED: 'PAYMENT_FAILED', NO_SHOW: 'NO_SHOW', FACILITY_UNAVAILABLE: 'FACILITY_UNAVAILABLE', ADMIN_OVERRIDE: 'ADMIN_OVERRIDE' } as const;
export type CancellationReason = (typeof CancellationReason)[keyof typeof CancellationReason];

export const ContractStatus = { ACTIVE: 'ACTIVE', DELINQUENT: 'DELINQUENT', LOCKED_OUT: 'LOCKED_OUT', MOVE_OUT_PENDING: 'MOVE_OUT_PENDING', ABANDONED: 'ABANDONED', CLOSED: 'CLOSED' } as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];
export const OPEN_CONTRACT_STATUSES: readonly ContractStatus[] = ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT', 'MOVE_OUT_PENDING'];
/** Hợp đồng đã kết thúc: trả kho bình thường (CLOSED) hoặc đã xử lý đồ bỏ lại (ABANDONED). Cả hai có thể còn "nợ sau quyết toán". */
export const CLOSED_CONTRACT_STATUSES: readonly ContractStatus[] = ['CLOSED', 'ABANDONED'];
export const isClosedContract = (s: ContractStatus) => CLOSED_CONTRACT_STATUSES.includes(s);

/**
 * Trạng thái tiền giữ chân của hợp đồng. Đợt 15 (F5): quyết toán có khoản hoàn chuyển khoản đang chờ → REFUND_PENDING ("Đang hoàn — chờ
 * chuyển") cho tới khi khoản đó được xác nhận đã chuyển (confirmPayout) → REFUNDED / PARTIALLY_REFUNDED; dùng hết để trả nợ / hư hại →
 * APPLIED ("Đã cấn trừ"). FORFEITED ("Không hoàn") chỉ còn cho dữ liệu cũ — mất thật sự (huỷ sát ngày / không đến) là ở đặt chỗ.
 */
export const DepositStatus = { HELD: 'HELD', REFUND_PENDING: 'REFUND_PENDING', PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', REFUNDED: 'REFUNDED', APPLIED: 'APPLIED', FORFEITED: 'FORFEITED' } as const;
export type DepositStatus = (typeof DepositStatus)[keyof typeof DepositStatus];

export const AccessMethod = { PHYSICAL_KEY: 'PHYSICAL_KEY', PIN: 'PIN', RFID_CARD: 'RFID_CARD' } as const;
export type AccessMethod = (typeof AccessMethod)[keyof typeof AccessMethod];

/**
 * Ca giờ nhận kho khách chọn LÚC ĐẶT (không phải giờ hoạt động của chi nhánh) — cùng bộ ca cũng
 * dùng để gắn nhãn ca làm việc cố định cho nhân viên (STAFF.shift, xem STAFF_SHIFTS) để hàng đợi
 * nhận kho lọc đúng ca. UNKNOWN = khách chưa chắc giờ, chỉ hợp lệ cho khách — nhân viên bắt buộc
 * chọn 1 trong 4 ca cụ thể.
 */
export const CheckInShift = { SHIFT_1: 'SHIFT_1', SHIFT_2: 'SHIFT_2', SHIFT_3: 'SHIFT_3', SHIFT_4: 'SHIFT_4', UNKNOWN: 'UNKNOWN' } as const;
export type CheckInShift = (typeof CheckInShift)[keyof typeof CheckInShift];
export const STAFF_SHIFTS: readonly CheckInShift[] = ['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'SHIFT_4'];

// ---------- Đổi ô kho theo yêu cầu (A1b): khách gửi yêu cầu, Quản lý chi nhánh xét duyệt ----------
/** Khách tự chuyển đồ trong hạn 7 ngày, hoặc thuê nhân viên chi nhánh chuyển hộ (chi nhánh xếp lịch). */
export const SwapMethod = { SELF: 'SELF', DELIVERY: 'DELIVERY' } as const;
export type SwapMethod = (typeof SwapMethod)[keyof typeof SwapMethod];

export const SwapRequestStatus = {
  SUBMITTED: 'SUBMITTED',   // khách vừa gửi, ô mới CHƯA bị giữ
  APPROVED: 'APPROVED',     // FM duyệt, đã chốt phí — ô mới bị giữ (RESERVED) chờ chuyển
  REJECTED: 'REJECTED',     // FM từ chối
  DONE: 'DONE',             // đã xác nhận chuyển xong, hợp đồng đã sang ô mới
  EXPIRED: 'EXPIRED',       // tự chuyển nhưng quá 7 ngày chưa chuyển — hủy, nhả ô mới
  CANCELLED: 'CANCELLED',   // khách tự rút trước khi FM duyệt
} as const;
export type SwapRequestStatus = (typeof SwapRequestStatus)[keyof typeof SwapRequestStatus];
export const OPEN_SWAP_STATUSES: readonly SwapRequestStatus[] = ['SUBMITTED', 'APPROVED'];

/** Dịch vụ thêm khách đặt sau khi thuê (đóng gói, vận chuyển, vệ sinh...). Trả tiền ngay lúc đặt. */
export const ServiceOrderStatus = {
  REQUESTED: 'REQUESTED',   // khách đã đặt và thanh toán, chờ chi nhánh thực hiện
  DONE: 'DONE',             // nhân viên xác nhận đã thực hiện xong
  CANCELLED: 'CANCELLED',   // huỷ trước khi thực hiện — hoàn tiền đủ
} as const;
export type ServiceOrderStatus = (typeof ServiceOrderStatus)[keyof typeof ServiceOrderStatus];
export const OPEN_SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = ['REQUESTED'];

/**
 * Yêu cầu cấp lại phương tiện vào kho (khách gửi, Quản lý chi nhánh duyệt). Loại yêu cầu do HÌNH THỨC KHOÁ của ô quyết định:
 * mật khẩu → đặt lại; thẻ khoá → làm lại thẻ (có phí); chìa khoá → cấp lại chìa.
 */
export const AccessRequestType = { PIN_RESET: 'PIN_RESET', CARD_REISSUE: 'CARD_REISSUE', KEY_REISSUE: 'KEY_REISSUE' } as const;
export type AccessRequestType = (typeof AccessRequestType)[keyof typeof AccessRequestType];

export const AccessRequestStatus = {
  REQUESTED: 'REQUESTED',   // khách đã gửi (và trả phí nếu có), chờ Quản lý chi nhánh duyệt
  APPROVED: 'APPROVED',     // đã duyệt — thẻ/chìa chờ nhân viên làm và bàn giao
  DONE: 'DONE',             // mật khẩu mới đã cấp / thẻ-chìa đã bàn giao
  REJECTED: 'REJECTED',     // bị từ chối — hoàn phí
  CANCELLED: 'CANCELLED',   // khách (hoặc chi nhánh) huỷ trước khi hoàn tất — hoàn phí
} as const;
export type AccessRequestStatus = (typeof AccessRequestStatus)[keyof typeof AccessRequestStatus];
export const OPEN_ACCESS_REQUEST_STATUSES: readonly AccessRequestStatus[] = ['REQUESTED', 'APPROVED'];

/** Cách ký xác nhận hợp đồng: vẽ tay trên màn hình, hoặc gõ họ tên rồi tích đồng ý. */
// PAPER: khách ký hợp đồng giấy tại quầy, nhân viên tải bản scan lên (signature.fileId).
export const SignatureMethod = { DRAWN: 'DRAWN', TYPED: 'TYPED', PAPER: 'PAPER' } as const;
export type SignatureMethod = (typeof SignatureMethod)[keyof typeof SignatureMethod];

/**
 * Khách CHỌN cách ký hợp đồng (Điều 11): ký online ngay trên tài khoản (OTP qua email) hoặc ký giấy tại quầy khi đến nhận kho — hai
 * cách có giá trị như nhau. Mặc định ONLINE (đặt tại quầy mặc định PAPER_AT_COUNTER). Đã chọn ký giấy vẫn ký online được — ký online
 * thì coi như ONLINE.
 */
export const SigningPreference = { ONLINE: 'ONLINE', PAPER_AT_COUNTER: 'PAPER_AT_COUNTER' } as const;
export type SigningPreference = (typeof SigningPreference)[keyof typeof SigningPreference];

export const PaymentType = { DEPOSIT: 'DEPOSIT', PREPAID_RENT: 'PREPAID_RENT', RENT: 'RENT', RENEWAL: 'RENEWAL', LATE_FEE: 'LATE_FEE', DAMAGE_FEE: 'DAMAGE_FEE', PENALTY: 'PENALTY', DISCOUNT_CLAWBACK: 'DISCOUNT_CLAWBACK', SETTLEMENT_DEBT: 'SETTLEMENT_DEBT', REFUND: 'REFUND', WAIVER: 'WAIVER', COMPENSATION: 'COMPENSATION', SERVICE: 'SERVICE', ACCESS_FEE: 'ACCESS_FEE', DISPOSAL_FEE: 'DISPOSAL_FEE', LIQUIDATION_PAYOUT: 'LIQUIDATION_PAYOUT', SIZE_CHANGE: 'SIZE_CHANGE' } as const;
export type PaymentType = (typeof PaymentType)[keyof typeof PaymentType];
// Đợt 15 (C3): SIZE_CHANGE = phần chênh tiền thuê của kỳ đã trả khi đổi sang loại kho đắt hơn (tính theo ngày) — rẻ hơn thì là REFUND.
/**
 * Tiền đi RA khỏi doanh nghiệp → direction = 'REFUND'. COMPENSATION và LIQUIDATION_PAYOUT (trả khách phần tiền thanh lý tài sản bỏ lại
 * còn dư sau khi trừ nợ) không có refundOf vì không hoàn lại khoản thu nào.
 */
export const OUTBOUND_PAYMENT_TYPES: readonly PaymentType[] = ['REFUND', 'COMPENSATION', 'LIQUIDATION_PAYOUT'];

/**
 * Thông báo gửi khách về công nợ của một hợp đồng (email + hiện trong tài khoản), theo đúng các mốc của Điều khoản (Điều 7):
 * hết ân hạn → cảnh báo; khoá quyền ra vào → báo khoá; quản lý gửi THÔNG BÁO CUỐI (bắt buộc trước khi được xử lý đồ bỏ lại);
 * đã xử lý đồ bỏ lại → báo kết quả quyết toán.
 */
/** Yêu cầu thực hiện quyền của chủ thể dữ liệu (Nghị định 13/2023/NĐ-CP) — khách gửi trong tài khoản, Quản trị viên xử lý trong 72 giờ. */
export const PrivacyRequestType = { ACCESS: 'ACCESS', CORRECTION: 'CORRECTION', DELETION: 'DELETION', WITHDRAW_CONSENT: 'WITHDRAW_CONSENT', OBJECTION: 'OBJECTION' } as const;
export type PrivacyRequestType = (typeof PrivacyRequestType)[keyof typeof PrivacyRequestType];
export const PrivacyRequestStatus = { OPEN: 'OPEN', DONE: 'DONE', REJECTED: 'REJECTED' } as const;
export type PrivacyRequestStatus = (typeof PrivacyRequestStatus)[keyof typeof PrivacyRequestStatus];

export const ContractNoticeKind = { GRACE_EXPIRED: 'GRACE_EXPIRED', LOCKED_OUT: 'LOCKED_OUT', FINAL_NOTICE: 'FINAL_NOTICE', ABANDONED: 'ABANDONED', EXPIRY_30: 'EXPIRY_30', EXPIRY_7: 'EXPIRY_7' } as const;
export type ContractNoticeKind = (typeof ContractNoticeKind)[keyof typeof ContractNoticeKind];
/**
 * Kết quả gửi email của một thông báo. NOT_CONFIGURED: hệ thống chưa cấu hình gửi mail; NO_EMAIL: khách không có email;
 * SKIPPED: cố ý không gửi — khách chưa từng có tài khoản đăng nhập (dữ liệu nhập tay / seed) hoặc địa chỉ thuộc tên miền demo.
 */
export const NoticeEmailStatus = { PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED', NOT_CONFIGURED: 'NOT_CONFIGURED', NO_EMAIL: 'NO_EMAIL', SKIPPED: 'SKIPPED' } as const;
export type NoticeEmailStatus = (typeof NoticeEmailStatus)[keyof typeof NoticeEmailStatus];

export const PaymentStatus = { PENDING: 'PENDING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', CANCELLED: 'CANCELLED', PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', REFUNDED: 'REFUNDED' } as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = { CARD: 'CARD', BANK_TRANSFER: 'BANK_TRANSFER', VNPAY: 'VNPAY', MOMO: 'MOMO', CASH: 'CASH', INTERNAL: 'INTERNAL' } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const InspectionType = { MOVE_IN: 'MOVE_IN', MOVE_OUT: 'MOVE_OUT', ROUTINE: 'ROUTINE', MAINTENANCE: 'MAINTENANCE', ABANDONMENT: 'ABANDONMENT' } as const;
export type InspectionType = (typeof InspectionType)[keyof typeof InspectionType];

export const InspectionOutcome = { PASS: 'PASS', PASS_WITH_DAMAGE: 'PASS_WITH_DAMAGE', MAINTENANCE_REQUIRED: 'MAINTENANCE_REQUIRED' } as const;
export type InspectionOutcome = (typeof InspectionOutcome)[keyof typeof InspectionOutcome];

export const InspectionStatus = { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', APPROVED: 'APPROVED' } as const;
export type InspectionStatus = (typeof InspectionStatus)[keyof typeof InspectionStatus];

/** Phương án xử lý đồ đạc khách bỏ lại khi hợp đồng bị đánh dấu ABANDONED (đã khoá, đã gửi thông báo cuối và hết hạn chót). */
export const AbandonedItemsDisposal = { AUCTION: 'AUCTION', DONATE: 'DONATE', DISCARD: 'DISCARD' } as const;
export type AbandonedItemsDisposal = (typeof AbandonedItemsDisposal)[keyof typeof AbandonedItemsDisposal];

export const ItemCondition = { OK: 'OK', DAMAGED: 'DAMAGED', MISSING: 'MISSING' } as const;
export type ItemCondition = (typeof ItemCondition)[keyof typeof ItemCondition];

export const TicketKind = { CUSTOMER_ISSUE: 'CUSTOMER_ISSUE', OPS_TASK: 'OPS_TASK' } as const;
export type TicketKind = (typeof TicketKind)[keyof typeof TicketKind];

export const TicketCategory = { ACCESS: 'ACCESS', DAMAGE: 'DAMAGE', PEST: 'PEST', BILLING: 'BILLING', MAINTENANCE: 'MAINTENANCE', SECURITY: 'SECURITY', CLEANING: 'CLEANING', OTHER: 'OTHER', CONSULTATION: 'CONSULTATION' } as const;
export type TicketCategory = (typeof TicketCategory)[keyof typeof TicketCategory];
/** Loại cho phiếu sự cố / việc nội bộ — CONSULTATION (tư vấn trước khi thuê) chỉ tạo qua form tư vấn riêng. */
export const ISSUE_TICKET_CATEGORIES = (Object.values(TicketCategory) as TicketCategory[]).filter((c) => c !== 'CONSULTATION');

/** Khung giờ khách muốn được gọi lại khi yêu cầu tư vấn. */
export const ContactWindow = { ANY: 'ANY', MORNING: 'MORNING', AFTERNOON: 'AFTERNOON', EVENING: 'EVENING' } as const;
export type ContactWindow = (typeof ContactWindow)[keyof typeof ContactWindow];

export const TicketPriority = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export const TicketStatus = { OPEN: 'OPEN', ASSIGNED: 'ASSIGNED', IN_PROGRESS: 'IN_PROGRESS', RESOLVED: 'RESOLVED', CLOSED: 'CLOSED' } as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const AuditResult = { SUCCESS: 'SUCCESS', DENIED: 'DENIED', FAILED: 'FAILED' } as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];

// ---------- Bồi thường hư hỏng / mất mát (A2) ----------
export const ClaimType = { DAMAGE: 'DAMAGE', LOSS: 'LOSS' } as const;
export type ClaimType = (typeof ClaimType)[keyof typeof ClaimType];

// ---------- Nhập hàng nhiều đợt (đợt 14): khách khai đồ mỗi lần mang vào, nhân viên kiểm hàng cấm và xác nhận ----------
export const IntakeBatchStatus = {
  DECLARED: 'DECLARED',     // khách (hoặc nhân viên thay khách) vừa khai, chờ nhân viên kiểm hàng
  CONFIRMED: 'CONFIRMED',   // nhân viên đã kiểm hàng cấm, xác nhận danh sách thực tế — tính vào "đồ đang gửi"
  REJECTED: 'REJECTED',     // có hàng cấm (Điều 4) — không nhận đợt này
  CANCELLED: 'CANCELLED',   // khách tự huỷ khi còn DECLARED
} as const;
export type IntakeBatchStatus = (typeof IntakeBatchStatus)[keyof typeof IntakeBatchStatus];
export const OPEN_INTAKE_BATCH_STATUSES: readonly IntakeBatchStatus[] = ['DECLARED'];

/** Tình trạng một món đồ lúc nhập kho (khách khai, nhân viên sửa theo thực tế khi xác nhận). */
export const IntakeItemCondition = { NEW: 'NEW', GOOD: 'GOOD', USED: 'USED', DAMAGED: 'DAMAGED' } as const;
export type IntakeItemCondition = (typeof IntakeItemCondition)[keyof typeof IntakeItemCondition];

/** Đợt 15 (A7): một lần đồ RA khỏi kho của một dòng đồ đã xác nhận — khách lấy ra, trả hết khi trả kho, thanh lý hàng bỏ lại. */
export const IntakeRemovalKind = { WITHDRAWN: 'WITHDRAWN', RETURNED: 'RETURNED', DISPOSED: 'DISPOSED' } as const;
export type IntakeRemovalKind = (typeof IntakeRemovalKind)[keyof typeof IntakeRemovalKind];

/**
 * Đợt 15 (A5, A9): cờ cảnh báo trên một dòng bồi thường — server tự gắn, quản lý xét kỹ.
 *  AFTER_INCIDENT: món nhập kho SAU ngày sự cố; DAMAGED_AT_INTAKE: món đã hư lúc nhập (hồ sơ hư hỏng);
 *  MATCHES_DECLARED: đồ "ngoài danh sách" nhưng tên trùng / gần trùng một món đã khai.
 */
export const ClaimItemFlag = { AFTER_INCIDENT: 'AFTER_INCIDENT', DAMAGED_AT_INTAKE: 'DAMAGED_AT_INTAKE', MATCHES_DECLARED: 'MATCHES_DECLARED' } as const;
export type ClaimItemFlag = (typeof ClaimItemFlag)[keyof typeof ClaimItemFlag];

export const ClaimStatus = {
  SUBMITTED: 'SUBMITTED',       // khách vừa gửi
  UNDER_REVIEW: 'UNDER_REVIEW', // chi nhánh đang xác minh
  APPROVED: 'APPROVED',         // đã duyệt số tiền, chờ chi
  REJECTED: 'REJECTED',
  PAID: 'PAID',                 // đã chi tiền
  WITHDRAWN: 'WITHDRAWN',       // khách tự rút
} as const;
export type ClaimStatus = (typeof ClaimStatus)[keyof typeof ClaimStatus];
export const OPEN_CLAIM_STATUSES: readonly ClaimStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];
