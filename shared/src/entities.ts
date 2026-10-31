import type { IntakeCheck, IntakeCheckKey } from './check-in';
import type { SealedCheckKey, SealedPackageKind, SealedPackageState } from './intake';
import type {
  AbandonedItemsDisposal, AccessMethod, AuditResult, CancellationReason, CheckInShift, ClaimStatus, ClaimType, ContractStatus, DepositStatus, FacilityStatus,
  InspectionOutcome, InspectionStatus, InspectionType, ItemCondition, PaymentMethod, PaymentStatus, PaymentType, RentalPeriod,
  ReservationStatus, Role, ServiceOrderStatus, AccessRequestStatus, AccessRequestType, SignatureMethod, SigningPreference, SwapMethod, SwapRequestStatus, TicketCategory, TicketKind, TicketPriority, TicketStatus, UnitCategory,
  UnitStatus, UserStatus, ContractNoticeKind, NoticeEmailStatus, PrivacyRequestStatus, PrivacyRequestType, IntakeBatchStatus, IntakeItemCondition,
  IntakeRemovalKind, ClaimItemFlag,
} from './enums';

/**
 * Generic over id/date so ONE definition serves both sides:
 *   client: Reservation            (I = string,          D = string ISO)
 *   server: Reservation<ObjectId, Date>
 * All money = integer in the facility currency's minor unit (VND has none -> plain đồng).
 */
export type ID = string;
export type CurrencyCode = 'VND' | 'USD';

export interface BaseEntity<I = ID, D = string> {
  _id: I;
  createdAt: D;
  updatedAt: D;
  createdBy?: I | null;
  updatedBy?: I | null;
}
export interface SoftDeletable<I = ID, D = string> {
  isDeleted: boolean;
  deletedAt?: D | null;
  deletedBy?: I | null;
}
export interface StatusChange<S extends string, I = ID, D = string> {
  from: S | null;
  to: S;
  at: D;
  by?: I | null;
  reason?: string;
}

// ---------- User ----------
export interface User<I = ID, D = string> extends BaseEntity<I, D>, SoftDeletable<I, D> {
  /** Firebase Auth uid (email/password or Google). null = profile not yet linked to a login. */
  firebaseUid?: string | null;
  email: string;
  phone?: string | null;
  fullName: string;
  role: Role;
  /** Required (>=1) for STAFF / FACILITY_MANAGER; must be empty for every other role. */
  facilityIds: I[];
  status: UserStatus;
  /** Bump to invalidate every issued refresh token (logout-all, role change, suspension). */
  tokenVersion: number;
  lastLoginAt?: D | null;
  /**
   * Lúc email được XÁC MINH: khách tự đăng ký (Firebase `email_verified`) hoặc nhân viên nhập mã 6 số gửi tới email khi tạo tài
   * khoản tại quầy. Thông báo hợp đồng chỉ gửi email khi khách có tài khoản đăng nhập (firebaseUid) hoặc email đã xác minh.
   */
  emailVerifiedAt?: D | null;
  /** Chấp thuận Điều khoản + Chính sách bảo mật tại thời điểm tạo tài khoản. null với tài khoản tạo trước tính năng này. */
  consent?: {
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: D;
    /** WALK_IN: nhân viên tạo tài khoản cho khách tại quầy (POST /reservations/walk-in) — khách chấp thuận trước mặt nhân viên. */
    method: 'SIGNUP_FORM' | 'GOOGLE' | 'WALK_IN';
  } | null;
  /**
   * Lần đồng ý GẦN NHẤT với Điều khoản + Chính sách bảo mật (đăng ký, đặt chỗ, đồng ý lại qua POST /auth/me/consent). `consent` ở trên
   * là bằng chứng lúc tạo tài khoản, không sửa; trường này cập nhật mỗi lần khách đồng ý bản hiện hành. null / thiếu = chỉ có `consent`.
   */
  consentLatest?: UserConsentRecord<D> | null;
  /**
   * CHỈ ĐỌC — BE điền ở GET /auth/me và bootstrap (`me`): true khi khách chưa đồng ý bản Điều khoản / Chính sách bảo mật HIỆN HÀNH
   * (TERMS_VERSION / PRIVACY_VERSION). Web / app bắt buộc khách xem tóm tắt thay đổi và đồng ý lại (POST /auth/me/consent) trước khi dùng
   * tiếp. Không phải khách thì luôn false.
   */
  consentRequired?: boolean;
  /**
   * Chỉ Quản lý chi nhánh: giấy uỷ quyền của người đại diện theo pháp luật cho người này ký hợp đồng thay Bên A (số, ngày ký).
   * In vào dòng người đại diện Bên A trên hợp đồng / phụ lục của chi nhánh. Quản trị viên nhập khi giao quản lý chi nhánh.
   */
  authorization?: { number: string; issuedOn: D } | null;
  customerProfile?: {
    idType?: 'CCCD' | 'PASSPORT';
    idNumberLast4?: string;               // never store the full national ID
    address?: string;
    emergencyContact?: { name: string; phone: string };
    /** Tài khoản nhận tiền hoàn (tiền giữ chân, tiền thanh lý còn dư…) — chỉ dùng để chuyển khoản hoàn, khách tự khai. */
    payoutAccount?: { bankName: string; accountNumber: string; accountName: string } | null;
  } | null;
  /** Ca làm việc cố định — bắt buộc với STAFF (một trong STAFF_SHIFTS), null/không có với vai trò khác. */
  shift?: CheckInShift | null;
}

/** Cách khách bày tỏ đồng ý (xem User.consentLatest). RECONSENT: đồng ý lại bản mới qua POST /auth/me/consent; BOOKING: khi đặt chỗ. */
export type ConsentMethod = 'SIGNUP_FORM' | 'GOOGLE' | 'WALK_IN' | 'BOOKING' | 'RECONSENT';
export interface UserConsentRecord<D = string> {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: D;
  method: ConsentMethod;
  ip?: string | null;
}

// ---------- Facility ----------
export interface Facility<I = ID, D = string> extends BaseEntity<I, D>, SoftDeletable<I, D> {
  code: string;                           // "HCM-Q7-01"
  name: string;
  status: FacilityStatus;
  address: { line1: string; ward?: string; district: string; city: string; country: string };
  location: { type: 'Point'; coordinates: [lng: number, lat: number] };
  timezone: string;                       // IANA, e.g. "Asia/Ho_Chi_Minh"
  currency: CurrencyCode;
  operatingHours: { dayOfWeek: number; open: string; close: string }[]; // 0=Sun, "HH:mm"
  accessHours?: { open: string; close: string } | null;
  contact: { phone: string; email?: string };
  amenities: string[];
  imageUrls: string[];
  /** Facility-specific policy; null -> active GLOBAL policy applies. */
  policyId?: I | null;
}

// ---------- UnitType (per facility) ----------
export interface UnitType<I = ID, D = string> extends BaseEntity<I, D>, SoftDeletable<I, D> {
  facilityId: I;
  code: string;                           // "M-3x3"; shared code across branches enables chain-wide BI
  name: string;
  category: UnitCategory;
  description?: string;
  dimensions: { widthM: number; depthM: number; heightM: number };
  areaM2: number;                         // derived
  /** indoor/outdoor là thuộc tính CHUNG cho cả loại (VD XL drive-up luôn ngoài trời). Hình thức khoá
   * KHÔNG ở đây — mỗi ô vật lý tự có (StorageUnit.accessMethod), vì cùng loại kho có thể có ô khoá
   * thẻ lẫn ô khoá chìa. */
  features: { indoor: boolean };
  /**
   * Giá cho MỖI chu kỳ khách có thể chọn lúc đặt (khách tự chọn ngày/tuần/tháng, không cố định
   * theo loại kho) — Quản lý vận hành niêm yết sẵn cả 3 mức. Đây là giá KHÔNG dùng điều hòa; điều hòa
   * là add-on khách tự bật lúc đặt (không phải thuộc tính của ô) — cộng phụ phí CLIMATE của chính
   * sách giá khi bật, với các cỡ nằm trong `policy.surcharges[CLIMATE].categories` (mọi ô của loại
   * kho hợp lệ đều SẴN CÓ máy lạnh về mặt cơ sở vật chất — chỉ tính phí khi khách chọn dùng).
   */
  rates: Record<RentalPeriod, number>;
  depositOverride?: number | null;
  /** Số chu kỳ tối thiểu phải thuê. */
  minPeriods: number;
  imageUrls: string[];
  isActive: boolean;
  /** Concurrency token. Every reservation/allocation txn for this type increments it -> concurrent txns write-conflict. */
  inventoryVersion: number;
}

/** Đợt 16 (B1): việc thu chìa / thẻ cũ hoặc đặt lại ổ khoá của ô khách vừa chuyển đi. */
export interface UnitAccessReset<I = ID, D = string> {
  contractId: I;
  contractNumber?: string | null;
  /** Hình thức khoá của ô (lúc khách chuyển đi) và số thẻ / mã chìa khách đang giữ. */
  method: AccessMethod;
  keyTag?: string | null;
  requiredAt: D;
  doneAt?: D | null;
  doneBy?: I | null;
  doneByName?: string | null;
  note?: string | null;
}

// ---------- StorageUnit (physical unit) ----------
export interface StorageUnit<I = ID, D = string> extends BaseEntity<I, D>, SoftDeletable<I, D> {
  facilityId: I;
  unitTypeId: I;
  unitNumber: string;                     // "B2-117"
  location: { building?: string; floor: number; zone?: string; aisle?: string };
  /** Hình thức khoá của TỪNG Ô — chìa khoá / thẻ khoá / mật khẩu; khách lọc/chọn ngay trên sơ đồ.
   * (Điều hòa KHÔNG ở đây nữa — xem UnitType.rates: mọi ô của loại kho hợp lệ đều có sẵn máy lạnh,
   * dùng hay không là lựa chọn của khách lúc đặt, xem Reservation.useAirConditioning.) */
  accessMethod: AccessMethod;
  status: UnitStatus;
  statusChangedAt: D;
  statusReason?: string | null;
  currentReservationId?: I | null;
  currentContractId?: I | null;
  /** Giữ ô trong lúc chờ khách chuyển đồ sau khi yêu cầu đổi ô được duyệt (xem UnitSwapRequest). */
  currentSwapRequestId?: I | null;
  /** Lockout is an overlay on OCCUPIED, not a separate unit status. */
  overlockActive: boolean;
  notes?: string;
  /**
   * Đợt 16 (B1) + đợt 17 (A1): ô khách vừa RỜI ĐI (đổi ô / đổi cỡ, trả kho, hàng bỏ lại) — phải ghi nhận đã thu chìa / thẻ (ô chìa, ô thẻ) hoặc đã đặt
   * lại ổ khoá (ô mật khẩu) thì mới mở cho thuê lại (AVAILABLE). `doneAt` null = chưa ghi nhận; lượt mới ghi đè bản cũ. Ô chưa từng có khách rời đi thì không có.
   */
  accessReset?: UnitAccessReset<I, D> | null;
  /** CHỈ ĐỌC — BE điền khi trả về: ô đang giữ đồ khách để lại (hợp đồng leftover.status = HELD) đến ngày này; null / thiếu = không giữ.
   * Ô đang giữ đồ không mở cho thuê / hoàn tất bảo trì được — chỉ xử lý ở mục Đồ đang giữ. */
  leftoverHeldUntil?: D | null;
}

/**
 * Trạng thái ô trên SƠ ĐỒ CÔNG KHAI (GET /facilities/public/:id/unit-types/:typeId/floor-plan): công chúng chỉ biết ô còn trống hay
 * không thuê được — không phân biệt đang thuê / đang giữ chỗ / bảo trì (không lộ tình trạng thuê của người khác).
 */
export type PublicUnitStatus = 'AVAILABLE' | 'UNAVAILABLE';
export interface PublicFloorPlanUnit<I = ID> {
  _id: I;
  unitNumber: string;
  location: { floor: number; zone?: string };
  status: PublicUnitStatus;
  accessMethod: AccessMethod;
}

/**
 * Ô trên MÔ HÌNH 3D công khai (GET /facilities/public/:id/site-map). Trạng thái như sơ đồ 2D: còn trống / không thuê được — không phân biệt
 * đang thuê / giữ chỗ / bảo trì (không lộ tình trạng thuê của người khác). Không kèm bất kỳ thông tin nào về người thuê.
 */
export interface PublicSiteUnit<I = ID> {
  _id: I;
  unitNumber: string;
  unitTypeId: I;
  location: { building?: string; floor: number; zone?: string; aisle?: string };
  status: PublicUnitStatus;
}

// ---------- Reservation ----------
export interface PriceQuote<I = ID> {
  currency: CurrencyCode;
  rentalPeriod: RentalPeriod;
  rate: number;
  depositAmount: number;
  discountAmount: number;
  surchargeAmount: number;
  appliedRuleCodes: string[];
  firstPeriodRent: number;
  /** Tổng phải trả khi đặt chỗ = tiền giữ chân + (tiền thuê kỳ đầu nếu `firstPeriodAtBooking`). */
  totalDueAtBooking: number;
  /** Tiền giữ chân (`depositAmount`) bằng bấy nhiêu kỳ tiền thuê — kho cỡ lớn ≥ 2, xem tier-rules.ts. Thiếu ở báo giá cũ = 1. */
  depositPeriods?: number;
  /** Tiền thuê kỳ đầu thu CÙNG LÚC đặt chỗ (kho cỡ lớn) thay vì khi nhận kho. Thiếu ở báo giá cũ = false. */
  firstPeriodAtBooking?: boolean;
  /**
   * Số kỳ tiền thuê thu TRƯỚC khi dùng kho. Thuê theo tháng = 1 (kỳ đầu, các kỳ sau xuất hoá đơn từng tháng). Thuê theo NGÀY /
   * TUẦN = toàn bộ số kỳ đã đặt: trả trọn một lần khi nhận kho, không xuất hoá đơn lẻ từng ngày. Thiếu ở báo giá cũ = 1.
   */
  prepaidPeriods?: number;
  policyId: I;
  policyVersion: number;
}

export interface Reservation<I = ID, D = string> extends BaseEntity<I, D> {
  code: string;                           // "RSV-260911-7K2Q9M"
  facilityId: I;
  customerId: I;
  unitTypeId: I;
  unitId?: I | null;                      // khách chọn ô cụ thể trên sơ đồ ngay lúc đặt — set từ PENDING
  status: ReservationStatus;
  startDate: D;                           // date-only: facility-local calendar day stored as 00:00Z
  periods: number;                        // số chu kỳ thuê (theo rentalPeriod của loại kho)
  endDate: D;                             // derived: startDate + periods × rentalPeriod
  /** Ca giờ khách dự kiến đến nhận kho — chọn ngay lúc đặt; UNKNOWN = "Chưa rõ giờ" (mặc định). */
  preferredCheckInShift: CheckInShift;
  /**
   * Add-on điều hòa — khách TỰ CHỌN lúc đặt, không phải thuộc tính của ô. Mọi ô của loại kho hợp lệ
   * (theo policy.surcharges[CLIMATE].categories) đều sẵn có máy lạnh về cơ sở vật chất; bật thì cộng
   * phụ phí CLIMATE vào `quote`, không bật thì không tính phí. false với loại kho không hợp lệ (VD Locker).
   */
  useAirConditioning: boolean;
  quote: PriceQuote<I>;                   // frozen at booking -> later price/policy changes don't affect it
  holdExpiresAt?: D | null;               // PENDING only
  depositPaymentId?: I | null;
  allocation?: { allocatedAt: D; allocatedBy?: I | null } | null;
  checkIn?: { qrTokenHash?: string | null; qrExpiresAt?: D | null; checkedInAt?: D | null; checkedInBy?: I | null } | null;
  cancellation?: { reason: CancellationReason; note?: string; cancelledAt: D; cancelledBy?: I | null; refundAmount: number } | null;
  contractId?: I | null;
  source: 'WEB' | 'MOBILE' | 'WALK_IN';
  /** Đặt tại quầy (source WALK_IN): nhân viên tạo đặt chỗ thay khách và thu tiền giữ chân. null với đặt online. */
  bookedBy?: I | null;
  idempotencyKey?: string | null;
  /**
   * Khách chọn ký online (OTP) hay ký GIẤY tại quầy khi đến nhận kho (POST /reservations/:id/signing-preference) — chỉ khi đã trả giữ
   * chân, chưa ký, chưa nhận kho. Thiếu (dữ liệu cũ) = ONLINE; đặt tại quầy mặc định PAPER_AT_COUNTER. Ký online xong thì về ONLINE,
   * ghi nhận ký giấy thì PAPER_AT_COUNTER. Nhân viên dùng để mở thẳng bước in hợp đồng / tải bản scan.
   */
  signingPreference?: SigningPreference;
  /** Lúc khách chọn / đổi cách ký gần nhất. null / thiếu = chưa chọn (mặc định). */
  signingPreferenceAt?: D | null;
  /** Khoá đối chiếu giấy tờ khi nhận kho do nhập sai nhiều lần (xem IdCheckState). */
  idCheck?: IdCheckState<I, D> | null;
  /**
   * "Giữ chỗ, trả tại quầy" (đợt 14): khách đặt online nhưng chọn trả tiền giữ chân (+ tiền thuê kỳ đầu kho cỡ lớn) TẠI QUẦY — đặt chỗ
   * PENDING giữ ô tới `holdExpiresAt` = min(lúc đặt + COUNTER_HOLD_HOURS giờ, 00:00 giờ VN của ngày sau ngày nhận) — counterHoldExpiry, đợt 15 (B6), mặc định ký giấy tại quầy. Nhân viên thu qua POST
   * /reservations/:id/collect-deposit; khách vẫn trả online được (pay-deposit) trước khi hết hạn giữ. Thiếu / false = đặt thường.
   */
  payAtCounter?: boolean;
  /**
   * Đợt 15 (C1) — "Trả khi nhận kho" (COD): luôn đi cùng `payAtCounter: true`. PENDING giữ ô tới hết ngày nhận (codHoldExpiry); khách đến
   * quầy: đối chiếu CCCD → ký giấy (được ký khi còn PENDING) → nhân viên thu tiền giữ chân (collect-deposit) → nhận kho. Quá hạn → job huỷ
   * NO_SHOW và khách tạm mất lựa chọn này COD_BAN_DAYS ngày. Khách trả online trước (pay-deposit) → về false: đặt chỗ đã trả như thường.
   * Thiếu / false = không phải COD (dữ liệu cũ).
   */
  payOnArrival?: boolean;
  /**
   * Bằng chứng khách đã chấp thuận Điều khoản + Chính sách bảo mật tại thời điểm đặt.
   * null với dữ liệu tạo trước khi tính năng này tồn tại; bắt buộc với mọi đặt chỗ mới qua API.
   */
  consent?: {
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: D;
    /** Lúc khách xác nhận đã được báo trước 2 khoản thanh toán (cọc khi đặt + tiền thuê kỳ đầu khi nhận kho). null với đặt chỗ cũ. */
    paymentScheduleAckAt?: D | null;
    /** Lúc khách xác nhận đã mở xem và đọc hợp đồng của kho trước khi đặt / trả tiền giữ chân. null với đặt chỗ cũ. */
    contractAckAt?: D | null;
    ip?: string | null;
    userAgent?: string | null;
  } | null;
  /**
   * Chữ ký xác nhận hợp đồng — khách ký SAU khi đã trả cọc và TRƯỚC khi nhận kho (check-in bị chặn nếu
   * chưa ký). null = chưa ký (hoặc dữ liệu cũ tạo trước tính năng này).
   */
  signature?: ContractSignature<I, D> | null;
  /**
   * Ngày bắt đầu GỐC lúc đặt — lưu ở lần đổi ngày nhận kho đầu tiên (POST /reservations/:id/reschedule); null/thiếu = chưa đổi lần
   * nào. Mốc giới hạn dời muộn (+30 ngày) và hoàn tiền khi huỷ tính theo ngày SỚM NHẤT (min(originalStartDate, startDate)).
   */
  originalStartDate?: D | null;
  /** Lịch sử đổi ngày nhận kho (tối đa RESCHEDULE_MAX_CHANGES lần). Đã ký mà đổi ngày thì chữ ký cũ chuyển vào `voidedSignature`. */
  scheduleChanges?: ReservationScheduleChange<I, D>[];
  /**
   * Đợt 16 (C2) — bản hợp đồng CHỐT lúc khách trả tiền giữ chân (hoặc lúc giữ chỗ trả tại quầy / trả khi nhận kho được tạo, đặt tại quầy):
   * mẫu hợp đồng (`templateId` null = mẫu mặc định của hệ thống, `templateVersion` 0) + chính sách dùng dựng điều khoản. Ký online / in giấy
   * / xem trước sau đó dựng theo đúng bản này. null / thiếu (dữ liệu cũ, chưa trả) = mẫu đang áp dụng như trước.
   */
  contractLock?: { templateId?: I | null; templateVersion: number; policyId?: I | null; policyVersion?: number | null; lockedAt: D } | null;
  statusHistory: StatusChange<ReservationStatus, I, D>[];
}

/** Một lần đổi ngày nhận kho. `byRole`: CUSTOMER tự đổi, STAFF / FACILITY_MANAGER đổi tại quầy. */
export interface ReservationScheduleChange<I = ID, D = string> {
  from: D;
  to: D;
  at: D;
  by: I;
  byRole: Role;
  reason?: string | null;
  /** Chữ ký hợp đồng bị huỷ hiệu lực vì ngày trên hợp đồng đổi — khách phải ký lại. Không có nếu lúc đổi chưa ký. */
  voidedSignature?: ContractSignature<I, D> | null;
  /**
   * Đợt 15 (B1): nhân viên bấm "Nhận kho từ hôm nay" (khách đến SỚM tại quầy) — dời về hôm nay. Mốc hoàn tiền khi huỷ và hạn "không
   * đến" vẫn tính theo ngày nhận TRƯỚC lần đổi này (`from`); khách không nhận kho hôm nay thì "Trả về ngày cũ" (đổi lại đúng `from`).
   */
  earlyArrival?: boolean | null;
}

// ---------- RentalContract ----------
export interface RentalContract<I = ID, D = string> extends BaseEntity<I, D> {
  contractNumber: string;
  facilityId: I;
  customerId: I;
  unitId: I;
  unitTypeId: I;
  reservationId: I;
  status: ContractStatus;
  startDate: D;
  endDate: D;                             // current term end (moves on renewal)
  autoRenew: boolean;
  /** Chốt từ Reservation.useAirConditioning lúc nhận kho — hiện cho nhân viên biết hợp đồng có tính phí điều hòa hay không. */
  useAirConditioning: boolean;
  billing: { currency: CurrencyCode; rentalPeriod: RentalPeriod; rate: number; nextBillingDate: D; paidThrough: D };
  deposit: { amount: number; status: DepositStatus; paymentId?: I | null; refundedAmount: number };
  balance: {
    outstanding: number; lastPaymentAt?: D | null;
    /** Đợt 15 (B5): lần trả công nợ gần nhất có Idempotency-Key — gửi lại đúng key thì trả lại kết quả cũ, không thu lần hai. */
    lastPayment?: { key: string; amount: number; paymentIds: I[]; at: D } | null;
  };
  /** `finalNoticeAt`: lúc quản lý gửi THÔNG BÁO CUỐI cho đợt nợ này — chỉ được xử lý đồ bỏ lại sau `abandonAfterLockedOutDays` ngày kể từ mốc này. */
  /** lockFrom: ngày sớm nhất được khoá quyền ra vào — đúng ngày ghi trong thông báo hết ân hạn (GRACE_EXPIRED) đã gửi khách, luôn
   *  ≥ ngày báo + LOCKOUT_MIN_NOTICE_DAYS. Thiếu (dữ liệu cũ) = chưa báo, job báo ở lượt sau. */
  delinquency?: { since: D; daysOverdue: number; lateFeesAccrued: number; lockedOutAt?: D | null; finalNoticeAt?: D | null; lockFrom?: D | null } | null;
  /** Các thông báo công nợ đã gửi khách (email + trong tài khoản) — chứng cứ đã báo trước khi khoá / xử lý đồ. Mới nhất ở cuối. */
  notices?: ContractNotice<I, D>[];
  /**
   * Lần nhân viên ĐỐI CHIẾU giấy tờ tùy thân bản gốc của Bên B khi bàn giao kho: loại giấy tờ + 4 số cuối (khớp với thông tin khách
   * khai trong tài khoản), ai đối chiếu, lúc nào. In kèm PDF hợp đồng. Hợp đồng nhận kho trước khi có trường này thì không có.
   */
  identity?: { idType: 'CCCD' | 'PASSPORT'; idNumberLast4: string; verifiedAt: D; verifiedBy: I; verifiedByName: string } | null;
  access: {
    method: AccessMethod;
    keyTag?: string | null;               // physical key label
    // KHÔNG BAO GIỜ gửi ra client: credentialHash / credentialEnc (mật khẩu mã hoá) ở BE chỉ đọc khi chủ hợp đồng
    // gọi GET /contracts/:id/access. Kiểu dưới đây chỉ để mô tả document.
    credentialHash?: string | null;       // PIN: hash để so khớp; thẻ: tham chiếu nhà cung cấp
    credentialEnc?: string | null;        // PIN mã hoá AES-GCM để chủ hợp đồng xem lại được
    issuedAt?: D | null; issuedBy?: I | null;
    suspendedAt?: D | null; revokedAt?: D | null;
    /**
     * Khách đã báo mất thẻ / chìa (đang có yêu cầu cấp lại). Đợt 16 (B2): chi nhánh khoá thẻ cũ (trong giờ làm việc) rồi bấm xác nhận
     * (`lostBlockedAt/By/ByName`) — trước đó khách thấy "chi nhánh đang khoá thẻ cũ". Cả hai cờ xoá khi đã giao thẻ / chìa mới.
     */
    lostReportedAt?: D | null;
    lostBlockedAt?: D | null;
    lostBlockedBy?: I | null;
    lostBlockedByName?: string | null;
    /** Nhật ký các lần nhân viên MỞ KHO HỘ theo yêu cầu của khách bằng chìa tổng / thẻ tổng (khách mất chìa, mất thẻ, cần mở gấp). */
    /** `forName`: mở cho NGƯỜI ĐƯỢC UỶ QUYỀN (tên lúc mở) thay vì chính chủ hợp đồng. `idType`: loại giấy tờ bản gốc người đó xuất trình
     *  (nhân viên nhập, server đã so khớp — không lưu số). */
    assistedOpens?: { at: D; by: I; byName: string; reason: string; forName?: string | null; presenter?: IdPresenter | null; idType?: 'CCCD' | 'PASSPORT' | null }[];
  };
  /**
   * Người được chủ hợp đồng UỶ QUYỀN ra vào / lấy đồ (tối đa 3). Nhân viên đối chiếu họ tên + 4 số cuối giấy tờ tại quầy.
   * Chỉ chủ hợp đồng thêm / xoá; mọi thay đổi ghi nhật ký.
   */
  authorizedPersons?: AuthorizedPerson<D>[];
  terms: { policyId: I; policyVersion: number; gracePeriodDays: number; lockoutAfterDays: number; signedAt: D; signatureRef?: string; signerName?: string | null };
  /** Khoá đối chiếu giấy tờ khi mở kho hộ / giao thẻ, chìa mới do nhập sai nhiều lần (xem IdCheckState). */
  idCheck?: IdCheckState<I, D> | null;
  /** `idempotencyKey`: header Idempotency-Key của lần gia hạn — gửi lại cùng khoá thì trả đúng kết quả lần trước, không gia hạn thêm. */
  /**
   * `prepaidUntil` (đợt 14): khoản RENEWAL (`paymentId`) trả trước tiền thuê tới hết ngày TRƯỚC mốc này — thuê tháng: hết tháng đầu của
   * kỳ gia hạn (các tháng sau xuất hoá đơn như thường); thuê ngày / tuần: `newEndDate` (trả trọn). Thiếu (dữ liệu cũ) mà có paymentId
   * = trả trước cả kỳ gia hạn. Job billing / màn khách không xuất lại hoá đơn RENT cho phần đã trả trước (coveredByPaidRenewal).
   */
  renewals: { previousEndDate: D; newEndDate: D; periods: number; paymentId?: I | null; prepaidUntil?: D | null; at: D; idempotencyKey?: string | null }[];
  /**
   * Các KỲ CAM KẾT của hợp đồng, nối tiếp nhau: kỳ gốc (lúc nhận kho) rồi từng lần gia hạn. Mỗi kỳ có giá riêng — ưu đãi thuê dài
   * hạn tính theo số tháng của CHÍNH kỳ đó (`discountAmount`), `rate` = `gross` − `discountAmount` là tiền thuê mỗi kỳ. Ngoài mọi
   * kỳ cam kết (hết hạn mà không gia hạn) thì tính theo `gross` của kỳ gần nhất, không còn ưu đãi. Hợp đồng cũ không có mảng này.
   */
  commitments?: {
    kind: 'INITIAL' | 'RENEWAL'; startDate: D; endDate: D; periods: number; gross: number; discountAmount: number; rate: number; policyId?: I | null; at?: D;
    /** Phụ lục gia hạn khách đã xác nhận điện tử cho kỳ này — lưu NGUYÊN VĂN lúc xác nhận (chỉ có ở kỳ RENEWAL). */
    appendix?: ContractAppendixRecord<I, D> | null;
    /**
     * Đợt 15 (C3) — giá của kỳ này sau các lần ĐỔI CỠ KHO: từ ngày `from` tính theo giá mới (giá gốc loại mới, cùng bậc ưu đãi của kỳ).
     * Giá gốc của kỳ (gross / discountAmount / rate ở trên) giữ nguyên làm lịch sử — xem priceAt ở @ssm/shared.
     */
    repricings?: CommitmentRepricing<I, D>[];
  }[];
  /**
   * Lịch sử đổi ô kho (A1). Đổi ô tại quầy chỉ trong CÙNG loại (giá thuê / tiền giữ chân giữ nguyên); đổi sang LOẠI khác (đổi cỡ kho, đợt
   * 15 C3) đi qua yêu cầu đổi ô và ghi thêm ở `sizeChanges`.
   * Optional: hợp đồng tạo trước tính năng này không có trường này khi đọc bằng lean().
   */
  unitSwaps?: { fromUnitId: I; toUnitId: I; reason: string; fee: number; paymentId?: I | null; at: D; by?: I | null }[];
  /** Đợt 15 (C3) — các lần ĐỔI CỠ KHO: sửa đổi hợp đồng (không chấm dứt), mỗi lần một phụ lục "Đổi cỡ kho" khách đã xác nhận. */
  sizeChanges?: ContractSizeChange<I, D>[];
  /**
   * Đợt 17 (D9): giá THÁNG niêm yết chốt lúc nhận kho và mỗi lần đổi cỡ (`from` = ngày có hiệu lực, date-only) — căn cứ mức trách nhiệm của
   * thuê ngày / tuần (monthlyRentOf). Hợp đồng cũ không có: dùng giá hiện hành của loại kho.
   */
  monthlyListRates?: { from: D; unitTypeId: I; rate: number }[] | null;
  /** Kiểm tra hàng hoá lúc nhận kho (Điều 4) — nhân viên xác nhận không có hàng cấm. */
  intakeCheck?: IntakeCheck<I, D> | null;
  /** `scheduledFor` = ngày khách HẸN trả; `returnedOn` = ngày khách THỰC TẾ bàn giao kho (nhân viên bấm nhận lại) — quyết toán tính theo ngày này. */
  /**
   * `reason`: lý do khi NHÂN VIÊN đăng ký trả kho thay khách (khách tự đăng ký thì không có); `requestedBy`: người bấm.
   * `handover`: xác nhận bàn giao lúc nhận lại kho — khách ký tay trên màn hình (CUSTOMER_SIGNATURE, ảnh chữ ký không gửi ra
   * danh sách), hoặc Quản lý chi nhánh xác nhận khi khách vắng mặt (MANAGER_CONFIRM, kèm lý do).
   */
  moveOut?: {
    requestedAt: D; scheduledFor?: D | null; returnedOn?: D | null; completedAt?: D | null; inspectionId?: I | null;
    reason?: string | null; requestedBy?: I | null;
    handover?: MoveOutHandover<I, D> | null;
  } | null;
  /**
   * Đồ khách để lại trong ô sau khi trả kho (biên bản ghi `leftItems.present`): chi nhánh giữ LEFTOVER_HOLD_DAYS ngày (`holdUntil`),
   * ô ở trạng thái MAINTENANCE. Khách đến lấy → PICKED_UP; quá hạn giữ, Quản lý chi nhánh xử lý → DISPOSED (phí theo Điều 9).
   */
  leftover?: ContractLeftover<I, D> | null;
  closedAt?: D | null;
  statusHistory: StatusChange<ContractStatus, I, D>[];
}

// ---------- ServiceOffering / ServiceOrder (dịch vụ thêm sau khi thuê — giá riêng từng chi nhánh) ----------
export interface ServiceOffering<I = ID, D = string> extends BaseEntity<I, D>, SoftDeletable<I, D> {
  facilityId: I;
  code: string;                           // duy nhất trong chi nhánh, VD "PACK-BOX"
  name: string;
  description?: string;
  price: number;                          // đơn giá một đơn vị (VND)
  unitLabel: string;                      // "lần", "thùng", "giờ"... — tổng = đơn giá × số lượng
  isActive: boolean;
}

export interface ServiceOrder<I = ID, D = string> extends BaseEntity<I, D> {
  orderNumber: string;                    // "SVC-261005-7K2Q9M"
  facilityId: I;
  customerId: I;
  /** Có khi đặt sau khi thuê, hoặc đơn chọn kèm lúc đặt kho đã được gắn vào hợp đồng khi nhận kho. */
  contractId?: I | null;
  /** Đơn chọn KÈM lúc đặt kho — thu tiền khi nhận kho; huỷ đặt chỗ thì đơn tự huỷ. */
  reservationId?: I | null;
  serviceId: I;
  /** Chốt tại thời điểm đặt — đổi giá/tên dịch vụ sau đó không ảnh hưởng đơn đã đặt. */
  serviceName: string;
  unitPrice: number;
  unitLabel: string;
  quantity: number;
  total: number;
  preferredDate?: D | null;               // ngày khách muốn thực hiện
  note?: string;
  status: ServiceOrderStatus;
  paymentId?: I | null;
  refundPaymentId?: I | null;             // có khi huỷ — hoàn đủ tiền
  /** Đợt 16 (C4): huỷ do trả kho / xử lý hàng bỏ lại — tiền hoàn đi vào quyết toán (cấn công nợ, phần thiếu trước; còn lại mới chi). */
  refundAtSettlement?: boolean;
  /** Đợt 16 (C6): header Idempotency-Key lúc đặt — gửi lại cùng khoá thì trả đúng đơn đã tạo, không thu lần hai. */
  idempotencyKey?: string | null;
  completedAt?: D | null;
  completedBy?: I | null;
  cancelReason?: string | null;
  statusHistory: StatusChange<ServiceOrderStatus, I, D>[];
}

// ---------- AccessRequest (xin đặt lại mật khẩu / làm lại thẻ / cấp lại chìa) ----------
export interface AccessRequest<I = ID, D = string> extends BaseEntity<I, D> {
  requestNumber: string;                  // "ACC-261005-7K2Q9M"
  facilityId: I;
  customerId: I;
  contractId: I;
  unitId: I;
  type: AccessRequestType;
  /** Hình thức khoá của ô tại lúc gửi — quyết định `type`. */
  accessMethod: AccessMethod;
  reason?: string;                        // khách ghi: "mất thẻ", "quên mật khẩu"...
  /** Phí chốt lúc gửi (theo chính sách) — trả ngay khi gửi, hoàn đủ nếu bị từ chối/huỷ. 0 = miễn phí. */
  fee: number;
  status: AccessRequestStatus;
  paymentId?: I | null;
  refundPaymentId?: I | null;
  /** Đợt 16 (C4): huỷ do trả kho / xử lý hàng bỏ lại — phí hoàn đi vào quyết toán (cấn công nợ, phần thiếu trước; còn lại mới chi). */
  refundAtSettlement?: boolean;
  /** Đợt 16 (C6): header Idempotency-Key lúc gửi — gửi lại cùng khoá thì trả đúng yêu cầu đã tạo, không thu phí lần hai. */
  idempotencyKey?: string | null;
  decidedBy?: I | null;
  decidedAt?: D | null;
  decisionNote?: string | null;           // lý do từ chối
  completedAt?: D | null;
  completedBy?: I | null;
  /** Số thẻ/mã chìa mới nhân viên ghi khi bàn giao (thẻ & chìa). */
  newKeyTag?: string | null;
  /** Người nhận thẻ / chìa mới tại quầy: chủ hợp đồng hoặc người được uỷ quyền — giấy tờ bản gốc đã được đối chiếu (không lưu số). */
  handedTo?: { presenter: IdPresenter; name: string; idType: 'CCCD' | 'PASSPORT'; authorizedPersonId?: string | null } | null;
  cancelReason?: string | null;
  /**
   * Đợt 16 (B2): báo mất thẻ / chìa — số thẻ / mã chìa cũ, việc "Vô hiệu thẻ …" trong hàng việc chi nhánh (`blockTaskId`, phiếu OPS_TASK) và
   * ai xác nhận đã khoá thẻ cũ, lúc nào (`oldBlocked*`).
   */
  oldKeyTag?: string | null;
  blockTaskId?: I | null;
  oldBlockedAt?: D | null;
  oldBlockedBy?: I | null;
  oldBlockedByName?: string | null;
  statusHistory: StatusChange<AccessRequestStatus, I, D>[];
}

// ---------- ContractSignature (chữ ký xác nhận hợp đồng, lưu trên Reservation) ----------
/** Người ký thay Bên A chốt lúc khách ký: Quản lý chi nhánh + giấy uỷ quyền (chuỗi đã định dạng). null = dữ liệu cũ → lấy hiện hành. */
export interface LessorSignatory { name: string | null; authorization: string | null }

/** Phụ lục hợp đồng đã xác nhận điện tử (gia hạn / đổi cỡ kho) — lưu NGUYÊN VĂN lúc xác nhận cùng dấu vết xác nhận. */
export interface ContractAppendixRecord<I = ID, D = string> {
  number: number; title: string; acceptedAt: D; signerName: string; termsVersion: string;
  clauses: { title: string; paragraphs: string[]; bullets: string[] }[]; lessorSignatory?: LessorSignatory | null;
  signedBy?: I | null; ip?: string | null; userAgent?: string | null;
}

/** Đợt 15 (C3) — giá một kỳ cam kết từ ngày đổi cỡ kho `from`. */
export interface CommitmentRepricing<I = ID, D = string> { from: D; gross: number; discountAmount: number; rate: number; unitTypeId?: I | null }

/**
 * Đợt 15 (C3) — một lần ĐỔI CỠ KHO đã thực hiện. Hợp đồng giữ nguyên (thời hạn, kỳ cam kết, bậc ưu đãi, đồ đang gửi, hồ sơ); từ
 * `effectiveFrom` áp giá loại mới. `rentDiff`: phần chênh tiền thuê của các kỳ đã trả, tính theo ngày (+ thu thêm / − hoàn);
 * `depositDiff`: chênh tiền giữ chân theo cách tính của loại mới (+ nộp thêm / − hoàn).
 */
export interface ContractSizeChange<I = ID, D = string> {
  swapRequestId: I; effectiveFrom: D; at: D; by?: I | null;
  fromUnitTypeId: I; toUnitTypeId: I; fromUnitId: I; toUnitId: I;
  previousRate: number; rate: number; gross: number; discountAmount: number;
  previousDeposit: number; deposit: number;
  rentDiff: number; depositDiff: number;
  paymentIds?: I[];
  appendix?: ContractAppendixRecord<I, D> | null;
}

/**
 * Đợt 15 (C3) — đổi cỡ kho trên yêu cầu đổi ô: báo giá + phụ lục khách đã xác nhận lúc gửi (giá chốt), và kết quả lúc hoàn tất.
 * `gross` = giá niêm yết loại mới mỗi kỳ (gồm phụ phí điều hòa nếu còn dùng); ưu đãi tính lại theo CÙNG bậc của từng kỳ cam kết.
 */
export interface SwapSizeChange<I = ID, D = string> {
  fromUnitTypeId: I; toUnitTypeId: I; rentalPeriod: RentalPeriod;
  currentRate: number; gross: number; discountAmount: number; rate: number;
  currentDeposit: number; deposit: number; depositDiff: number;
  useAirConditioning: boolean;
  /** Ước tính phần chênh tiền thuê nếu đổi vào ngày gửi — số thật tính theo ngày hoàn tất. */
  estimate: { from: D; rentDiff: number };
  /** Loại mới không có dịch vụ thêm → đơn dịch vụ chưa làm bị huỷ, hoàn tiền khi đổi xong. */
  servicesCancelled?: boolean;
  appendix: Omit<ContractAppendixRecord<I, D>, 'number'> & { number?: number | null };
  /** Lúc hoàn tất. */
  effectiveFrom?: D | null; rentDiff?: number | null; appendixNumber?: number | null; paymentIds?: I[];
}

export interface ContractSignature<I = ID, D = string> {
  /**
   * NGUYÊN VĂN các điều khoản khách đã đọc và ký — chốt lúc ký để sau này mẫu hợp đồng / mã nguồn đổi thế nào thì hợp đồng
   * đã ký vẫn in ra đúng như lúc ký. Không gửi kèm trong /bootstrap (nặng); đọc qua GET /reservations/:id/contract.
   * Thiếu với hợp đồng ký trước khi có tính năng này → dựng lại từ mẫu mặc định.
   */
  clauses?: { title: string; paragraphs: string[]; bullets: string[] }[];
  /** Phiên bản mẫu hợp đồng dùng lúc ký (0 = mẫu mặc định của hệ thống). */
  templateVersion?: number | null;
  /** Đại diện Bên A lúc ký — in ở khối chữ ký; đổi quản lý / giấy uỷ quyền về sau không đổi bản đã ký. */
  lessorSignatory?: LessorSignatory | null;
  signedAt: D;
  signerName: string;
  method: SignatureMethod;
  /** PNG data URL của chữ ký vẽ tay (method DRAWN) — nhỏ, chỉ để hiển thị lại trên bản hợp đồng. */
  image?: string | null;
  /** Ký giấy tại quầy (method PAPER): bản scan nhân viên tải lên — tải về qua GET /reservations/:id/signed-file. */
  fileId?: I | null;
  /** Ký online: lúc khách nhập đúng mã OTP gửi qua email. */
  otpVerifiedAt?: D | null;
  /** Phiên bản Điều khoản/chính sách mà khách đã xem lúc ký. */
  termsVersion: string;
  policyVersion: number;
  signedBy?: I | null;                    // người thao tác: chính khách, hoặc nhân viên ký hộ tại quầy
  onBehalf: boolean;                      // true khi ký giấy tại quầy (nhân viên tải bản khách đã ký); ký online luôn false
  /** Lần gửi PDF hợp đồng đã ký tới email khách thành công gần nhất; emailedTo đã che (a***@gmail.com). */
  emailedAt?: D | null;
  emailedTo?: string | null;
}

/**
 * Một thông báo công nợ gửi khách. `amountDue`: dư nợ lúc gửi; `deadline`: hạn chót trong thông báo (khoá kho với GRACE_EXPIRED,
 * hạn chót trước khi xử lý đồ với FINAL_NOTICE); `note`: ghi chú của quản lý (VD đã gọi điện, gửi thư bảo đảm số …).
 */
export interface ContractNotice<I = ID, D = string> {
  _id: I; kind: ContractNoticeKind; at: D; amountDue: number; deadline?: D | null; note?: string | null; by?: I | null;
  email: { status: NoticeEmailStatus; to?: string | null; at?: D | null };
  /** EXPIRY_30 / EXPIRY_7 / EXPIRY_2: ngày hết hạn được nhắc (khoá chống gửi trùng — gia hạn đổi endDate thì nhắc lại cho mốc mới). */
  endDate?: D | null;
  /** Quản lý ghi nhận đã báo khách bằng kênh khác (email không tới được) — đủ điều kiện xử lý đồ bỏ lại như email đã gửi. */
  manualDelivery?: { channel: ManualDeliveryChannel; note: string; at: D; by: I } | null;
}

export type MoveOutHandoverMethod = 'CUSTOMER_SIGNATURE' | 'MANAGER_CONFIRM';
export interface MoveOutHandover<I = ID, D = string> {
  method: MoveOutHandoverMethod; at: D; by: I;
  /** CUSTOMER_SIGNATURE: tên người ký + ảnh chữ ký (PNG data URL — chỉ lưu, không gửi ra bootstrap / danh sách). */
  signerName?: string | null; image?: string | null;
  /** MANAGER_CONFIRM: lý do khách vắng mặt. */
  reason?: string | null;
}

export type LeftoverStatus = 'HELD' | 'PICKED_UP' | 'DISPOSED';
export interface ContractLeftover<I = ID, D = string> {
  description: string; photoUrls: string[]; holdUntil: D; status: LeftoverStatus;
  recordedAt?: D | null; resolvedAt?: D | null; resolvedBy?: I | null; fee?: number | null; note?: string | null; feePaymentId?: I | null;
}
/** Số ngày chi nhánh giữ đồ khách để lại sau khi trả kho trước khi xử lý (Điều 9). */
export const LEFTOVER_HOLD_DAYS = 14;
/** Trần tuyệt đối phí xử lý đồ khách để lại (VND). Trên CLAIM_FM_APPROVAL_LIMIT chỉ Quản lý vận hành lập (403 DISPOSAL_LIMIT). */
export const LEFTOVER_FEE_MAX = 50_000_000;

/** Kênh quản lý ghi nhận ĐÃ BÁO khách thông báo cuối khi email không tới được khách. */
export type ManualDeliveryChannel = 'PHONE' | 'REGISTERED_MAIL' | 'IN_PERSON';

/** Người xuất trình giấy tờ tại quầy (mở kho hộ / nhận thẻ, chìa mới): chủ hợp đồng hoặc người được uỷ quyền. */
export type IdPresenter = 'CUSTOMER' | 'AUTHORIZED';
export interface AuthorizedPerson<D = string> { _id: string; fullName: string; phone: string; idNumberLast4: string; relationship?: string | null; addedAt: D }
export const MAX_AUTHORIZED_PERSONS = 3;

// ---------- UnitSwapRequest (đổi ô kho theo yêu cầu — A1b) ----------
export interface UnitSwapRequest<I = ID, D = string> extends BaseEntity<I, D> {
  requestNumber: string;                  // "SWP-260930-7K2Q9M"
  facilityId: I;
  customerId: I;
  contractId: I;
  unitTypeId: I;                          // loại kho đang thuê lúc gửi yêu cầu
  /** Đợt 15 (C3): loại kho của ô mới — khác `unitTypeId` là ĐỔI CỠ KHO (xem `sizeChange`); thiếu / trùng = đổi ô cùng loại. */
  toUnitTypeId?: I | null;
  sizeChange?: SwapSizeChange<I, D> | null;
  fromUnitId: I;
  toUnitId: I;                            // khách chọn trên sơ đồ lúc gửi yêu cầu
  method: SwapMethod;
  reason: string;                         // khách tự khai lý do muốn đổi
  status: SwapRequestStatus;
  /** Chốt lúc FM duyệt: 0 nếu facilityFault hoặc là lần đổi đầu của hợp đồng; ngược lại theo chính sách. */
  fee: number;
  /** FM đánh dấu lúc duyệt — có phải lỗi từ chi nhánh không (quyết định miễn phí). null khi chưa duyệt. */
  facilityFault?: boolean | null;
  scheduledFor?: D | null;                // hẹn ngày chi nhánh cử người chuyển (method DELIVERY)
  /** Nhân viên chi nhánh được phân công chuyển đồ (method DELIVERY) — Quản lý chi nhánh chọn lúc duyệt, đổi được khi còn APPROVED. */
  assignedStaffId?: I | null;
  /** Tên nhân viên lúc phân công — lưu kèm để KHÁCH thấy ai đến chuyển (khách không đọc được danh sách nhân viên). */
  assignedStaffName?: string | null;
  moveDeadline?: D | null;                // hạn 7 ngày tự chuyển (method SELF), tính từ lúc duyệt
  decidedBy?: I | null;
  decidedAt?: D | null;
  rejectReason?: string | null;
  completedAt?: D | null;
  paymentId?: I | null;                   // khoản phí (nếu > 0), tạo lúc hoàn tất
  statusHistory: StatusChange<SwapRequestStatus, I, D>[];
}

// ---------- PaymentTransaction ----------
export interface PaymentTransaction<I = ID, D = string> extends BaseEntity<I, D> {
  facilityId: I;
  customerId: I;
  contractId?: I | null;
  reservationId?: I | null;
  type: PaymentType;
  direction: 'CHARGE' | 'REFUND';         // amount always positive; direction gives the sign
  amount: number;
  currency: CurrencyCode;
  status: PaymentStatus;
  method: PaymentMethod;
  period?: { start: D; end: D } | null;   // RENT / RENEWAL coverage
  provider?: { name: string; txnRef?: string | null; rawStatus?: string; /** mã giao dịch nhân viên nhập khi thu tại quầy */ counterRef?: string | null } | null;
  idempotencyKey: string;
  refundOf?: I | null;
  refundedAmount: number;
  waiver?: { approvedBy: I; reason: string } | null;
  recordedBy?: I | null;                  // nhân viên thu tại quầy (mọi hình thức, không chỉ tiền mặt)
  /** Người dùng thao tác tạo ra khoản này (VD người lập biên bản trả kho tạo khoản hoàn) — không được tự xác nhận đã chi. */
  createdBy?: I | null;
  paidAt?: D | null;
  failureReason?: string | null;
  /** Khoản hoàn bằng chuyển khoản: tạo ở trạng thái PENDING (chờ chuyển), quản lý xác nhận đã chuyển kèm mã giao dịch. */
  payout?: { reference: string; toAccount: string; confirmedBy: I; confirmedAt: D } | null;
  statusHistory: StatusChange<PaymentStatus, I, D>[];
}

/** Yêu cầu thực hiện quyền dữ liệu cá nhân của khách (Nghị định 13/2023). Hạn phản hồi `dueAt` = lúc gửi + 72 giờ. */
export interface PrivacyRequest<I = ID, D = string> extends BaseEntity<I, D> {
  requestNumber: string; customerId: I; type: PrivacyRequestType; note?: string | null; status: PrivacyRequestStatus; dueAt: D;
  response?: string | null; handledBy?: I | null; handledAt?: D | null;
}

// ---------- InspectionLog ----------
export interface InspectionLog<I = ID, D = string> extends BaseEntity<I, D> {
  facilityId: I;
  unitId: I;
  contractId?: I | null;
  type: InspectionType;
  status: InspectionStatus;
  inspectorId: I;
  performedAt: D;
  checklist: { item: string; condition: ItemCondition; note?: string }[];
  damages: { description: string; severity: 'MINOR' | 'MODERATE' | 'SEVERE'; cost: number; photoUrls: string[] }[];
  photoUrls: string[];
  outcome?: InspectionOutcome | null;
  totalDamageFee: number;
  /** Điều chỉnh chi phí hư hại sau khi khách khiếu nại đúng: giảm nợ còn lại trước, phần dư hoàn cho khách (refundPaymentId). */
  adjustments?: { amount: number; reason: string; by: I; at: D; refundPaymentId?: I | null; debtCut?: number; refund?: number }[];
  depositSettlement?: {
    depositHeld: number; deductions: number; refundAmount: number;
    /** Phần chi phí hư hại + công nợ VƯỢT tiền giữ chân — khách còn nợ sau khi đóng hợp đồng (nằm ở contract.balance.outstanding). */
    shortfall?: number;
    /** Tiền thuê trả trước khi gia hạn cho các kỳ chưa bắt đầu: `prepaidRentRefund` hoàn lại khách, `prepaidRentOffset` cấn trừ vào hư hại / công nợ. */
    prepaidRentRefund?: number;
    prepaidRentOffset?: number;
    /**
     * Đợt 16 (C4): tiền đơn dịch vụ / phí cấp lại thẻ, chìa bị huỷ khi trả kho / xử lý hàng bỏ lại — `creditOffset` cấn vào công nợ / phần
     * thiếu, `creditRefund` hoàn lại khách (theo khoản gốc).
     */
    creditRefund?: number;
    creditOffset?: number;
    /** Đầu vào để TÍNH LẠI quyết toán khi khách khiếu nại đúng (shared/move-out-rules settleDeposit): công nợ trước khi lập biên bản,
     *  trần hoàn khi trả sớm (đồng, null = không giới hạn), ưu đãi phải thu hồi đầy đủ. Biên bản cũ có thể thiếu. */
    priorOutstanding?: number | null; refundCap?: number | null; clawbackDue?: number | null;
    refundPaymentId?: I | null; damagePaymentId?: I | null; approvedBy?: I | null; approvedAt?: D | null;
    /** Chỉ có khi trả kho SỚM (trước endDate của kỳ hạn) — % thời gian kỳ hạn đã dùng và trần hoàn cọc theo đó. */
    /** `discountClawback`: phần ưu đãi thuê dài hạn bị thu hồi (đã trừ vào tiền giữ chân) vì mới dùng `usedPeriods` kỳ. */
    earlyTermination?: { elapsedPct: number; refundCapPct: number; discountClawback?: number; usedPeriods?: number } | null;
    /** Xử lý đồ bỏ lại: phần tiền thanh lý dùng bù nợ và phần còn dư trả lại khách. */
    proceedsApplied?: number; proceedsPayout?: number;
  } | null;
  /** Chỉ có khi type = ABANDONMENT — danh sách đồ đạc khách bỏ lại và phương án xử lý (LOCKED_OUT quá lâu). */
  /** `proceeds`: tiền thu được khi thanh lý; `costs`: chi phí kiểm kê / vận chuyển / thanh lý — cùng tiền giữ chân cấn trừ công nợ. */
  abandonment?: { items: { description: string; quantity: number }[]; disposalMethod: AbandonedItemsDisposal; proceeds?: number; costs?: number; finalNoticeAt?: D | null; photoUrls?: string[] } | null;
  /** Chỉ biên bản MOVE_OUT (từ batch 10): khách có để lại đồ trong ô không — có thì mô tả + ảnh, ô được giữ LEFTOVER_HOLD_DAYS ngày. */
  leftItems?: { present: boolean; description?: string | null; photoUrls?: string[] } | null;
  notes?: string;
}

// ---------- SupportTicket (customer issues + internal ops tasks share one queue) ----------
export interface SupportTicket<I = ID, D = string> extends BaseEntity<I, D>, SoftDeletable<I, D> {
  ticketNumber: string;
  kind: TicketKind;
  facilityId: I;
  reporterId: I;
  /** Phiếu chi nhánh ghi nhận THAY khách tại quầy (vd khiếu nại biên bản trả kho): `reporterId` là khách, đây là nhân viên đã nhập. */
  recordedBy?: I | null;
  /** Đợt 16 (B2): việc "Vô hiệu thẻ …" hệ thống tạo khi khách báo mất — trỏ tới yêu cầu cấp lại (nút xác nhận đã khoá thẻ cũ). */
  accessRequestId?: I | null;
  /** Đợt 16 (C3): chi nhánh đóng phiếu CHƯA giải quyết — lý do (bắt buộc, email cho khách). */
  closeReason?: string | null;
  contractId?: I | null;
  unitId?: I | null;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  description: string;
  attachmentUrls: string[];
  assigneeId?: I | null;
  dueAt?: D | null;                       // SLA / task deadline
  resolvedAt?: D | null;
  messages: { authorId: I; body: string; internal: boolean; at: D }[];
  /**
   * Email hệ thống đã gửi về phiếu (mới nhất cuối, tối đa 50): MANAGER_ALERT — phiếu khách mức HIGH/URGENT báo quản lý chi nhánh;
   * CUSTOMER_REPLY / CUSTOMER_RESOLVED — báo khách khi chi nhánh trả lời (không gửi ghi chú nội bộ) hoặc đã giải quyết.
   * `status` như thông báo hợp đồng; NO_RECIPIENT = không có quản lý nào nhận được.
   */
  emailLog?: { kind: TicketEmailKind; status: NoticeEmailStatus | 'NO_RECIPIENT'; at: D }[];
  statusHistory: StatusChange<TicketStatus, I, D>[];
}
/** Đợt 16 (C3): CUSTOMER_CLOSED — báo khách chi nhánh đóng phiếu chưa giải quyết; STAFF_REOPENED — báo người phụ trách / quản lý khi khách nhắn vào phiếu đã giải quyết (tự mở lại). */
export type TicketEmailKind = 'MANAGER_ALERT' | 'CUSTOMER_REPLY' | 'CUSTOMER_RESOLVED' | 'CUSTOMER_CLOSED' | 'STAFF_REOPENED';

// ---------- DamageClaim (bồi thường hư hỏng / mất mát) ----------
export interface ClaimItem<D = string> {
  name: string;
  quantity: number;
  /** Giá trị khai báo cho MỘT đơn vị. Tổng dòng = quantity * unitValue. */
  unitValue: number;
  note?: string;
  /**
   * Đợt 14: món đồ trong danh sách "đồ đang gửi" (IntakeBatchItem._id của một đợt nhập ĐÃ XÁC NHẬN của hợp đồng) — server lấy tên theo
   * danh sách, `unitValue` mặc định = giá trị đã khai (khách nhập thấp hơn được, cao hơn → 422 CLAIM_OVER_DECLARED), số lượng ≤ số đã
   * nhập. null / thiếu = đồ ngoài danh sách.
   */
  intakeItemId?: string | null;
  /** Server tự gắn (không nhận từ client): true = đồ KHÔNG có trong danh sách đã khai & xác nhận — nhân viên xét kỹ, cần chứng cứ. */
  undeclared?: boolean;
  /**
   * Đợt 15 — server tự gắn: AFTER_INCIDENT (món nhập kho sau ngày sự cố — vẫn giữ liên kết + trần giá trị, nhưng undeclared = true),
   * DAMAGED_AT_INTAKE (món đã hư lúc nhập, hồ sơ hư hỏng), MATCHES_DECLARED (đồ ngoài danh sách trùng tên món đã khai → matchedItem).
   */
  flag?: ClaimItemFlag | null;
  /**
   * Đợt 16 (D2): dòng là một KIỆN gửi kín — tình trạng kiện khách khai (MISSING / OUTER_DAMAGE; CONTENTS_ONLY không nhận). Server gắn
   * `sealedPackage: true`.
   */
  packageState?: SealedPackageState | null;
  sealedPackage?: boolean;
  /** Đợt 15: chép từ đợt nhập lúc lập hồ sơ (dòng chọn từ danh sách) — mã đợt, thời điểm xác nhận, tình trạng lúc nhập. */
  batchCode?: string | null;
  intakeConfirmedAt?: D | null;
  intakeCondition?: IntakeItemCondition | null;
  /** Đợt 15 (A9): món đã khai mà dòng "ngoài danh sách" trùng tên. */
  matchedItem?: { intakeItemId: string; name: string; estValue: number } | null;
}

/** Đợt 15 (A6): người nhận tiền mặt bồi thường tại quầy — đã đối chiếu giấy tờ bản gốc. */
export interface ClaimPayoutRecipient<I = ID, D = string> {
  name: string;
  idType: 'CCCD' | 'PASSPORT';
  /** Nhân viên quầy không được xem (bootstrap / API bỏ trường này với STAFF). */
  idNumberLast4?: string;
  at: D;
  by: I;
}

export interface DamageClaim<I = ID, D = string> extends BaseEntity<I, D> {
  claimNumber: string;                    // "CLM-260916-3F7K2Q"
  facilityId: I;
  customerId: I;
  contractId: I;
  unitId: I;
  /** Sự cố khách đã báo trước đó, nếu có — nối hồ sơ bồi thường với luồng hỗ trợ. */
  ticketId?: I | null;
  type: ClaimType;
  status: ClaimStatus;
  incidentAt: D;
  description: string;
  items: ClaimItem<D>[];
  /** Tổng khách yêu cầu = sum(quantity * unitValue). Server tự tính, không nhận từ client. */
  claimedAmount: number;
  photoUrls: string[];
  /** Kết quả xét duyệt. Ghi một lần rồi không sửa — mở xem xét lại sẽ ghi đè bản mới kèm statusHistory. */
  review?: {
    reviewedBy: I;
    reviewedAt: D;
    /** <= min(claimedAmount, liabilityCap). 0 khi từ chối. */
    approvedAmount: number;
    /** Hạn mức trách nhiệm theo Điều khoản, chốt tại thời điểm duyệt để sau này đổi chính sách không hồi tố. */
    liabilityCap: number;
    decisionNote: string;
  } | null;
  /** Lệnh chi: tiền mặt thì paidAt có ngay; chuyển khoản thì paidAt = null tới khi quản lý / vận hành xác nhận đã chuyển. */
  /** Đợt 15 (A6): chi tiền mặt thì `recipient` = người nhận đã đối chiếu giấy tờ bản gốc (tên, loại giấy tờ, 4 số cuối, lúc nào, ai chi). */
  settlement?: { paymentId: I; paidAt: D | null; method: PaymentMethod; recipient?: ClaimPayoutRecipient<I, D> | null } | null;
  statusHistory: StatusChange<ClaimStatus, I, D>[];
}

// ---------- IntakeBatch (đợt nhập hàng — đợt 14) ----------
/** Một dòng đồ trong đợt nhập. `_id`: chuỗi 24 hex do server sinh — hồ sơ bồi thường trỏ tới bằng `items[].intakeItemId`. */
export interface IntakeBatchItem<I = ID, D = string> {
  _id: string;
  name: string;
  category?: string | null;
  quantity: number;
  /** Giá trị ước tính cho MỘT cái (VND) — mặc định cho bồi thường. Tổng dòng = quantity × estValue. */
  estValue: number;
  condition: IntakeItemCondition;
  note?: string | null;
  /** Đợt 15 (A3): dòng nhân viên THÊM lúc xác nhận (không có trong bản khách khai) — giá trị do khách nói tại quầy. */
  addedByStaff?: boolean;
  /** Đợt 15 (A7): các lần đồ ra khỏi kho — số đang gửi = quantity − Σ removals[].quantity. Dữ liệu cũ không có = chưa ra lần nào. */
  removals?: IntakeItemRemoval<I, D>[];
  /** Server tính (chỉ có trong bootstrap / GET inventory): số đang gửi và số đã bồi thường (dòng hồ sơ PAID trỏ tới món này). */
  inStorage?: number;
  compensated?: number;
}

/** Đợt 15 (A7): một lần đồ ra khỏi kho. `at` = NGÀY Việt Nam (date-only 00:00Z). */
export interface IntakeItemRemoval<I = ID, D = string> {
  kind: IntakeRemovalKind;
  quantity: number;
  at: D;
  by?: I | null;
  note?: string | null;
}

/**
 * Đợt NHẬP HÀNG vào kho (collection `intakeBatches`) — tách khỏi nhận kho: khách khai danh sách đồ mỗi lần mang vào (POST
 * /contracts/:id/intake-batches), nhân viên chi nhánh kiểm hàng cấm (đủ INTAKE_CHECK_ITEMS) và xác nhận danh sách thực tế (CONFIRMED) hoặc
 * từ chối khi có hàng cấm (REJECTED). Nhân viên cũng tạo thay khách tại quầy (`onBehalf`, khai + xác nhận một bước). Danh sách "đồ đang
 * gửi" của hợp đồng = các dòng của mọi đợt CONFIRMED (GET /contracts/:id/inventory, `inventoryOf`) — căn cứ khi xét bồi thường.
 */
export interface IntakeBatch<I = ID, D = string> extends BaseEntity<I, D> {
  code: string;                           // "IN-261028-7K2Q9M"
  contractId: I;
  facilityId: I;
  customerId: I;
  status: IntakeBatchStatus;
  /** Danh sách hiện hành: khách khai; sau khi xác nhận = danh sách THỰC TẾ nhân viên đã kiểm. 1..INTAKE_MAX_ITEMS dòng. */
  items: IntakeBatchItem<I, D>[];
  /** Bản khách khai ban đầu — chỉ có khi nhân viên sửa danh sách lúc xác nhận (giữ làm chứng cứ). */
  declaredItems?: IntakeBatchItem<I, D>[] | null;
  declaredAt: D;
  declaredBy: I;
  /** Nhân viên / quản lý tạo thay khách tại quầy (khai + xác nhận một bước). */
  onBehalf?: boolean;
  /** Ngày khách dự kiến mang đồ đến (khách tự chọn, tuỳ chọn). */
  expectedDate?: D | null;
  confirmedAt?: D | null;
  confirmedBy?: I | null;
  /** Kết quả kiểm hàng cấm lúc xác nhận (đủ INTAKE_CHECK_ITEMS; đợt gửi kín: đủ INTAKE_SEALED_CHECK_ITEMS — chỉ quan sát bên ngoài). */
  goodsCheck?: { confirmed: (IntakeCheckKey | SealedCheckKey)[]; note?: string | null } | null;
  /** Đợt 16 (D2): đợt GỬI KÍN theo kiện — khách không kê khai chi tiết; `items` = các kiện "Kiện 1..N". Đợt thường: không có. */
  sealed?: IntakeSealed<I, D> | null;
  rejectReason?: string | null;
  /** Đợt 15 (A8): lý do huỷ khi nhân viên huỷ đợt khách khai mà không mang đến, hoặc hệ thống tự huỷ khi quá hạn. */
  cancelReason?: string | null;
  staffNote?: string | null;
  statusHistory: StatusChange<IntakeBatchStatus, I, D>[];
}

/** Đợt 16 (D2): thông tin đợt gửi kín + bản cam kết giấy khách đã ký tại quầy (nhân viên xác nhận). */
export interface IntakeSealed<I = ID, D = string> {
  packageCount: number;
  packageKind: SealedPackageKind;
  /** Có niêm phong hay không. */
  hasSeal: boolean;
  description?: string | null;
  /** TỔNG giá trị khai (VND) — null = không khai (bồi thường cần chứng cứ). */
  declaredValue?: number | null;
  pledge?: { version: string; confirmedAt: D; confirmedBy: I; confirmedByName: string } | null;
}

// ---------- BusinessPolicy (Ops Manager; versioned, never edited once active) ----------
export interface BusinessPolicy<I = ID, D = string> extends BaseEntity<I, D> {
  scope: 'GLOBAL' | 'FACILITY';
  facilityId?: I | null;
  version: number;
  isActive: boolean;
  effectiveFrom: D;
  /** mode PERIODS_OF_RENT: cọc = value × tiền thuê một chu kỳ (mặc định value = 1). */
  deposit: { mode: 'PERIODS_OF_RENT' | 'FIXED'; value: number };
  reservationHoldMinutes: number;
  allocationLeadDays: number;
  noShowAfterHours: number;
  gracePeriodDays: number;
  lockoutAfterDays: number;
  /** Số ngày kể từ khi LOCKED_OUT mà khách vẫn không đóng tiền/liên hệ thì FM được xử lý đồ bỏ lại (kiểm kê + thanh lý). */
  abandonAfterLockedOutDays: number;
  lateFees: { afterDays: number; kind: 'FIXED' | 'PERCENT_OF_RENT'; value: number; recurringEveryDays?: number | null }[];
  cancellation: { minHoursBeforeStart: number; depositRefundPct: number }[];
  /**
   * Phạt trả kho sớm khi hợp đồng đang OCCUPIED (huỷ trước ngày hết hạn kỳ hạn hiện tại `endDate`),
   * theo % thời gian đã dùng trên kỳ hạn (elapsed = (scheduledFor − startDate) / (endDate − startDate)).
   * Tier có `maxElapsedPct` nhỏ nhất mà elapsed% vẫn ≤ nó sẽ được áp dụng; dùng làm TRẦN hoàn cọc
   * (kết hợp min() với phần hoàn còn lại sau khi trừ hư hỏng/công nợ) — không cộng dồn phạt.
   */
  earlyTermination: { maxElapsedPct: number; depositRefundPct: number }[];
  minPeriods: number;
  maxPeriods: number;
  surcharges: { code: string; label: string; kind: 'FIXED' | 'PERCENT'; value: number; categories: UnitCategory[] }[];
  discounts: { code: string; kind: 'FIXED' | 'PERCENT'; value: number; minPeriods: number; validFrom?: D | null; validTo?: D | null; requiresApprovalRole?: Role | null }[];
  waiverLimits: { role: Role; maxAmount: number }[];
  /** Phí cấp lại phương tiện vào kho theo loại yêu cầu (VND, 0 = miễn phí). Thiếu → DEFAULT_ACCESS_FEES. */
  accessFees?: Record<AccessRequestType, number>;
}

// ---------- AuditLog (append-only) ----------
export interface AuditLog<I = ID, D = string> {
  _id: I;
  at: D;
  actorId?: I | null;
  actorRole?: Role | 'SYSTEM' | 'ANONYMOUS';
  action: string;                         // "reservation.allocate", "auth.login", "contract.override"
  entityType?: string | null;
  entityId?: I | null;
  facilityId?: I | null;
  result: AuditResult;
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  reason?: string | null;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  /** Đợt 16 (C9): quá thời hạn lưu (24 tháng) — job lưu trữ đã ẩn danh (bỏ người thao tác, IP, nội dung thay đổi, lý do). */
  anonymizedAt?: D | null;
}

/**
 * Body `expected` của POST /contracts/:id/extend — chép ĐÚNG từ báo giá GET /contracts/:id/extension-quote khách đang xem (`from`,
 * `newEndDate` là chuỗi ISO trong báo giá, so theo ngày). Lệch (giá đổi, hoặc vừa gia hạn xong nên mốc bắt đầu đã khác) → 409
 * PRICE_CHANGED. Kèm header Idempotency-Key để bấm hai lần không gia hạn hai lần.
 */
export interface ExtensionExpected { rate: number; payNow: number; from: string; newEndDate: string }

/**
 * Khoá đối chiếu giấy tờ (hợp đồng: mở hộ / giao thẻ, chìa; đặt chỗ: nhận kho). Nhập sai lần thứ ID_CHECK_MAX_FAILURES trong
 * ID_CHECK_WINDOW_HOURS giờ (đếm từ lần đối chiếu đúng / mở khoá gần nhất) → `lockedAt`; mọi lần đối chiếu tiếp theo bị từ chối (423 ID_CHECK_LOCKED) cho tới khi Quản lý chi nhánh mở
 * khoá (`unlockedAt` …) hoặc hết 24 giờ kể từ `lockedAt`. Số lần sai đếm từ nhật ký kiểm toán (không lưu số đã nhập). Xem idCheckLocked.
 */
export interface IdCheckState<I = ID, D = string> {
  lockedAt: D | null;
  unlockedAt?: D | null;
  unlockedBy?: I | null;
  unlockReason?: string | null;
  /** Lần đối chiếu ĐÚNG gần nhất — số lần sai chỉ đếm từ mốc này (và lần mở khoá gần nhất). */
  passedAt?: D | null;
}
