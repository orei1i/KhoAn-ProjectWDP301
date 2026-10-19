import type {
  AbandonedItemsDisposal, AccessMethod, AuditResult, CancellationReason, CheckInShift, ClaimStatus, ClaimType, ContractStatus, DepositStatus, FacilityStatus,
  InspectionOutcome, InspectionStatus, InspectionType, ItemCondition, PaymentMethod, PaymentStatus, PaymentType, RentalPeriod,
  ReservationStatus, Role, ServiceOrderStatus, AccessRequestStatus, AccessRequestType, SignatureMethod, SwapMethod, SwapRequestStatus, TicketCategory, TicketKind, TicketPriority, TicketStatus, UnitCategory,
  UnitStatus, UserStatus, ContractNoticeKind, NoticeEmailStatus, PrivacyRequestStatus, PrivacyRequestType,
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
  /** Chấp thuận Điều khoản + Chính sách bảo mật tại thời điểm tạo tài khoản. null với tài khoản tạo trước tính năng này. */
  consent?: {
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: D;
    method: 'SIGNUP_FORM' | 'GOOGLE';
  } | null;
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
  idempotencyKey?: string | null;
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
    ip?: string | null;
    userAgent?: string | null;
  } | null;
  /**
   * Chữ ký xác nhận hợp đồng — khách ký SAU khi đã trả cọc và TRƯỚC khi nhận kho (check-in bị chặn nếu
   * chưa ký). null = chưa ký (hoặc dữ liệu cũ tạo trước tính năng này).
   */
  signature?: ContractSignature<I, D> | null;
  statusHistory: StatusChange<ReservationStatus, I, D>[];
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
  balance: { outstanding: number; lastPaymentAt?: D | null };
  /** `finalNoticeAt`: lúc quản lý gửi THÔNG BÁO CUỐI cho đợt nợ này — chỉ được xử lý đồ bỏ lại sau `abandonAfterLockedOutDays` ngày kể từ mốc này. */
  delinquency?: { since: D; daysOverdue: number; lateFeesAccrued: number; lockedOutAt?: D | null; finalNoticeAt?: D | null } | null;
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
    /** Khách đã báo mất thẻ / chìa (đang có yêu cầu cấp lại): thẻ cũ bị vô hiệu từ lúc này cho đến khi bàn giao thẻ mới. */
    lostReportedAt?: D | null;
    /** Nhật ký các lần nhân viên MỞ KHO HỘ theo yêu cầu của khách bằng chìa tổng / thẻ tổng (khách mất chìa, mất thẻ, cần mở gấp). */
    /** `forName`: mở cho NGƯỜI ĐƯỢC UỶ QUYỀN (tên lúc mở) thay vì chính chủ hợp đồng. */
    assistedOpens?: { at: D; by: I; byName: string; reason: string; forName?: string | null }[];
  };
  /**
   * Người được chủ hợp đồng UỶ QUYỀN ra vào / lấy đồ (tối đa 3). Nhân viên đối chiếu họ tên + 4 số cuối giấy tờ tại quầy.
   * Chỉ chủ hợp đồng thêm / xoá; mọi thay đổi ghi nhật ký.
   */
  authorizedPersons?: AuthorizedPerson<D>[];
  terms: { policyId: I; policyVersion: number; gracePeriodDays: number; lockoutAfterDays: number; signedAt: D; signatureRef?: string; signerName?: string | null };
  renewals: { previousEndDate: D; newEndDate: D; periods: number; paymentId?: I | null; at: D }[];
  /**
   * Các KỲ CAM KẾT của hợp đồng, nối tiếp nhau: kỳ gốc (lúc nhận kho) rồi từng lần gia hạn. Mỗi kỳ có giá riêng — ưu đãi thuê dài
   * hạn tính theo số tháng của CHÍNH kỳ đó (`discountAmount`), `rate` = `gross` − `discountAmount` là tiền thuê mỗi kỳ. Ngoài mọi
   * kỳ cam kết (hết hạn mà không gia hạn) thì tính theo `gross` của kỳ gần nhất, không còn ưu đãi. Hợp đồng cũ không có mảng này.
   */
  commitments?: {
    kind: 'INITIAL' | 'RENEWAL'; startDate: D; endDate: D; periods: number; gross: number; discountAmount: number; rate: number; policyId?: I | null; at?: D;
    /** Phụ lục gia hạn khách đã xác nhận điện tử cho kỳ này — lưu NGUYÊN VĂN lúc xác nhận (chỉ có ở kỳ RENEWAL). */
    appendix?: { number: number; title: string; acceptedAt: D; signerName: string; termsVersion: string; clauses: { title: string; paragraphs: string[]; bullets: string[] }[]; lessorSignatory?: LessorSignatory | null } | null;
  }[];
  /**
   * Lịch sử đổi ô kho (A1). Chỉ đổi được sang ô CÙNG loại (unitTypeId không đổi), nên
   * billing.monthlyRate và deposit giữ nguyên theo hợp đồng đã ký — đổi ô không phải là định giá lại.
   * Optional: hợp đồng tạo trước tính năng này không có trường này khi đọc bằng lean().
   */
  unitSwaps?: { fromUnitId: I; toUnitId: I; reason: string; fee: number; paymentId?: I | null; at: D; by?: I | null }[];
  /** `scheduledFor` = ngày khách HẸN trả; `returnedOn` = ngày khách THỰC TẾ bàn giao kho (nhân viên bấm nhận lại) — quyết toán tính theo ngày này. */
  moveOut?: { requestedAt: D; scheduledFor?: D | null; returnedOn?: D | null; completedAt?: D | null; inspectionId?: I | null } | null;
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
  contractId: I;
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
  decidedBy?: I | null;
  decidedAt?: D | null;
  decisionNote?: string | null;           // lý do từ chối
  completedAt?: D | null;
  completedBy?: I | null;
  /** Số thẻ/mã chìa mới nhân viên ghi khi bàn giao (thẻ & chìa). */
  newKeyTag?: string | null;
  cancelReason?: string | null;
  statusHistory: StatusChange<AccessRequestStatus, I, D>[];
}

// ---------- ContractSignature (chữ ký xác nhận hợp đồng, lưu trên Reservation) ----------
/** Người ký thay Bên A chốt lúc khách ký: Quản lý chi nhánh + giấy uỷ quyền (chuỗi đã định dạng). null = dữ liệu cũ → lấy hiện hành. */
export interface LessorSignatory { name: string | null; authorization: string | null }

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
  /** Phiên bản Điều khoản/chính sách mà khách đã xem lúc ký. */
  termsVersion: string;
  policyVersion: number;
  signedBy?: I | null;                    // người thao tác: chính khách, hoặc nhân viên ký hộ tại quầy
  onBehalf: boolean;                      // luôn false với chữ ký mới (nhân viên không ký thay); chỉ còn ở dữ liệu cũ
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
}

export interface AuthorizedPerson<D = string> { _id: string; fullName: string; phone: string; idNumberLast4: string; relationship?: string | null; addedAt: D }
export const MAX_AUTHORIZED_PERSONS = 3;

// ---------- UnitSwapRequest (đổi ô kho theo yêu cầu — A1b) ----------
export interface UnitSwapRequest<I = ID, D = string> extends BaseEntity<I, D> {
  requestNumber: string;                  // "SWP-260930-7K2Q9M"
  facilityId: I;
  customerId: I;
  contractId: I;
  unitTypeId: I;                          // cùng loại cả hai ô — giá thuê/cọc không đổi
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
  provider?: { name: string; txnRef?: string | null; rawStatus?: string } | null;
  idempotencyKey: string;
  refundOf?: I | null;
  refundedAmount: number;
  waiver?: { approvedBy: I; reason: string } | null;
  recordedBy?: I | null;                  // staff member who took cash
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
  adjustments?: { amount: number; reason: string; by: I; at: D; refundPaymentId?: I | null }[];
  depositSettlement?: {
    depositHeld: number; deductions: number; refundAmount: number;
    /** Phần chi phí hư hại + công nợ VƯỢT tiền giữ chân — khách còn nợ sau khi đóng hợp đồng (nằm ở contract.balance.outstanding). */
    shortfall?: number;
    /** Tiền thuê trả trước khi gia hạn cho các kỳ chưa bắt đầu: `prepaidRentRefund` hoàn lại khách, `prepaidRentOffset` cấn trừ vào hư hại / công nợ. */
    prepaidRentRefund?: number;
    prepaidRentOffset?: number;
    refundPaymentId?: I | null; damagePaymentId?: I | null; approvedBy?: I | null; approvedAt?: D | null;
    /** Chỉ có khi trả kho SỚM (trước endDate của kỳ hạn) — % thời gian kỳ hạn đã dùng và trần hoàn cọc theo đó. */
    /** `discountClawback`: phần ưu đãi thuê dài hạn bị thu hồi (đã trừ vào tiền giữ chân) vì mới dùng `usedPeriods` kỳ. */
    earlyTermination?: { elapsedPct: number; refundCapPct: number; discountClawback?: number; usedPeriods?: number } | null;
    /** Xử lý đồ bỏ lại: phần tiền thanh lý dùng bù nợ và phần còn dư trả lại khách. */
    proceedsApplied?: number; proceedsPayout?: number;
  } | null;
  /** Chỉ có khi type = ABANDONMENT — danh sách đồ đạc khách bỏ lại và phương án xử lý (LOCKED_OUT quá lâu). */
  /** `proceeds`: tiền thu được khi thanh lý; `costs`: chi phí kiểm kê / vận chuyển / thanh lý — cùng tiền giữ chân cấn trừ công nợ. */
  abandonment?: { items: { description: string; quantity: number }[]; disposalMethod: AbandonedItemsDisposal; proceeds?: number; costs?: number; finalNoticeAt?: D | null } | null;
  notes?: string;
}

// ---------- SupportTicket (customer issues + internal ops tasks share one queue) ----------
export interface SupportTicket<I = ID, D = string> extends BaseEntity<I, D>, SoftDeletable<I, D> {
  ticketNumber: string;
  kind: TicketKind;
  facilityId: I;
  reporterId: I;
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
  statusHistory: StatusChange<TicketStatus, I, D>[];
}

// ---------- DamageClaim (bồi thường hư hỏng / mất mát) ----------
export interface ClaimItem {
  name: string;
  quantity: number;
  /** Giá trị khai báo cho MỘT đơn vị. Tổng dòng = quantity * unitValue. */
  unitValue: number;
  note?: string;
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
  items: ClaimItem[];
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
  settlement?: { paymentId: I; paidAt: D | null; method: PaymentMethod } | null;
  statusHistory: StatusChange<ClaimStatus, I, D>[];
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
}
