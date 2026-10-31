import type {
  AbandonedItemsDisposal, AccessMethod, CheckInShift, ContactWindow, ContractNoticeKind, NoticeEmailStatus, PrivacyRequestStatus, PrivacyRequestType, ClaimStatus, ClaimType, ContractStatus, FacilityStatus, PaymentMethod, PaymentStatus, PaymentType,
  RentalPeriod, ReservationStatus, Role, SwapMethod, SwapRequestStatus, TicketCategory, TicketKind, TicketPriority,
  TicketStatus, UnitCategory, UnitStatus, UserStatus, CancellationReason, InspectionOutcome, DepositStatus, ServiceOrderStatus, AccessRequestStatus, AccessRequestType, SigningPreference,
  IntakeBatchStatus, IntakeItemCondition, IntakeRemovalKind, ClaimItemFlag,
} from './enums';
import type { PublicUnitStatus } from './entities';

export type Tone = 'gray' | 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'teal';
type LabelMap<K extends string> = Record<K, { label: string; tone: Tone }>;

export const ROLE: LabelMap<Role> = {
  CUSTOMER: { label: 'Khách hàng', tone: 'gray' },
  STAFF: { label: 'Nhân viên kho', tone: 'blue' },
  FACILITY_MANAGER: { label: 'Quản lý chi nhánh', tone: 'teal' },
  OPS_MANAGER: { label: 'Quản lý vận hành', tone: 'violet' },
  ADMIN: { label: 'Quản trị hệ thống', tone: 'red' },
};

export const UNIT_STATUS: LabelMap<UnitStatus> = {
  AVAILABLE: { label: 'Trống', tone: 'green' },
  RESERVED: { label: 'Đã giữ chỗ', tone: 'blue' },
  OCCUPIED: { label: 'Đang thuê', tone: 'teal' },
  MAINTENANCE: { label: 'Bảo trì', tone: 'amber' },
  PENDING_INSPECTION: { label: 'Chờ kiểm tra', tone: 'violet' },
};

export const RESERVATION_STATUS: LabelMap<ReservationStatus> = {
  PENDING: { label: 'Chờ trả tiền giữ chân', tone: 'amber' },
  CONFIRMED: { label: 'Đã xác nhận', tone: 'blue' },
  ALLOCATED: { label: 'Đã phân kho', tone: 'violet' },
  CHECKED_IN: { label: 'Đã nhận kho', tone: 'teal' },
  COMPLETED: { label: 'Hoàn tất', tone: 'gray' },
  CANCELLED: { label: 'Đã hủy', tone: 'red' },
};

export const CONTRACT_STATUS: LabelMap<ContractStatus> = {
  ACTIVE: { label: 'Đang hiệu lực', tone: 'green' },
  DELINQUENT: { label: 'Quá hạn thanh toán', tone: 'amber' },
  LOCKED_OUT: { label: 'Đã khóa truy cập', tone: 'red' },
  MOVE_OUT_PENDING: { label: 'Chờ trả kho', tone: 'violet' },
  ABANDONED: { label: 'Hàng bỏ lại — đã xử lý', tone: 'red' },
  CLOSED: { label: 'Đã kết thúc', tone: 'gray' },
};

export const DISPOSAL_METHOD: Record<AbandonedItemsDisposal, string> = {
  AUCTION: 'Thanh lý / bán', DONATE: 'Quyên tặng', DISCARD: 'Tiêu hủy',
};

export const DEPOSIT_STATUS: LabelMap<DepositStatus> = {
  HELD: { label: 'Đang giữ', tone: 'blue' },
  REFUND_PENDING: { label: 'Đang hoàn (chờ chuyển)', tone: 'amber' },
  PARTIALLY_REFUNDED: { label: 'Hoàn một phần', tone: 'teal' },
  REFUNDED: { label: 'Đã hoàn', tone: 'green' },
  APPLIED: { label: 'Đã cấn trừ', tone: 'gray' },
  FORFEITED: { label: 'Không hoàn', tone: 'red' },
};

/**
 * Đợt 15 (F5): một dòng giải thích tiền giữ chân sau quyết toán — phần đã / đang hoàn và phần "đã cấn trừ" (trả nợ, hư hại, phí…), không
 * gọi phần cấn trừ là "không hoàn". null khi còn đang giữ (chưa quyết toán).
 */
export function depositSettlementText(d: { amount: number; status: DepositStatus; refundedAmount?: number | null }): string | null {
  if (d.status === 'HELD') return null;
  const refunded = Math.min(d.amount, Math.max(0, d.refundedAmount ?? 0));
  const applied = d.amount - refunded;
  const fmt = (n: number) => `${n.toLocaleString('vi-VN')} ₫`;
  if (d.status === 'FORFEITED') return 'Không hoàn';
  const parts = [
    ...(refunded > 0 ? [`${d.status === 'REFUND_PENDING' ? 'đang hoàn' : 'đã hoàn'} ${fmt(refunded)}${d.status === 'REFUND_PENDING' ? ' (chờ chuyển khoản)' : ''}`] : []),
    ...(applied > 0 ? [`đã cấn trừ ${fmt(applied)}`] : []),
  ];
  return parts.length ? parts.join(' · ').replace(/^./, (c) => c.toUpperCase()) : DEPOSIT_STATUS[d.status].label;
}

export const PAYMENT_TYPE: LabelMap<PaymentType> = {
  DEPOSIT: { label: 'Tiền giữ chân', tone: 'blue' },
  PREPAID_RENT: { label: 'Tiền thuê kỳ đầu (trả khi đặt)', tone: 'teal' },
  RENT: { label: 'Tiền thuê', tone: 'teal' },
  RENEWAL: { label: 'Gia hạn', tone: 'teal' },
  LATE_FEE: { label: 'Phí trễ hạn', tone: 'amber' },
  DAMAGE_FEE: { label: 'Phí hư hại', tone: 'red' },
  SETTLEMENT_DEBT: { label: 'Nợ còn lại sau quyết toán', tone: 'red' },
  PENALTY: { label: 'Phí phạt', tone: 'red' },
  DISCOUNT_CLAWBACK: { label: 'Thu hồi ưu đãi (trả kho sớm)', tone: 'amber' },
  REFUND: { label: 'Hoàn tiền', tone: 'violet' },
  WAIVER: { label: 'Miễn giảm', tone: 'gray' },
  COMPENSATION: { label: 'Bồi thường', tone: 'violet' },
  SERVICE: { label: 'Dịch vụ thêm', tone: 'teal' },
  ACCESS_FEE: { label: 'Phí cấp lại thẻ / chìa', tone: 'teal' },
  DISPOSAL_FEE: { label: 'Chi phí xử lý đồ bỏ lại', tone: 'red' },
  LIQUIDATION_PAYOUT: { label: 'Trả lại tiền thanh lý còn dư', tone: 'violet' },
  SIZE_CHANGE: { label: 'Chênh lệch tiền thuê (đổi cỡ kho)', tone: 'teal' },
};

export const PRIVACY_REQUEST_TYPE: Record<PrivacyRequestType, string> = {
  ACCESS: 'Xem / nhận bản sao dữ liệu', CORRECTION: 'Chỉnh sửa dữ liệu', DELETION: 'Xoá dữ liệu (xoá tài khoản)',
  WITHDRAW_CONSENT: 'Rút lại sự đồng ý', OBJECTION: 'Phản đối / hạn chế xử lý',
};
export const PRIVACY_REQUEST_STATUS: LabelMap<PrivacyRequestStatus> = {
  OPEN: { label: 'Đang xử lý', tone: 'amber' }, DONE: { label: 'Đã xử lý', tone: 'green' }, REJECTED: { label: 'Từ chối', tone: 'red' },
};

export const CONTRACT_NOTICE: LabelMap<ContractNoticeKind> = {
  GRACE_EXPIRED: { label: 'Nhắc thanh toán quá hạn', tone: 'amber' },
  LOCKED_OUT: { label: 'Đã khoá quyền ra vào', tone: 'red' },
  FINAL_NOTICE: { label: 'Thông báo cuối', tone: 'red' },
  ABANDONED: { label: 'Đã xử lý đồ bỏ lại', tone: 'gray' },
  EXPIRY_30: { label: 'Còn 30 ngày hết hạn', tone: 'amber' },
  EXPIRY_7: { label: 'Còn 7 ngày hết hạn', tone: 'amber' },
};

export const MANUAL_DELIVERY_CHANNEL: Record<'PHONE' | 'REGISTERED_MAIL' | 'IN_PERSON', string> = {
  PHONE: 'Gọi điện', REGISTERED_MAIL: 'Thư bảo đảm', IN_PERSON: 'Báo trực tiếp',
};

export const LEFTOVER_STATUS: LabelMap<'HELD' | 'PICKED_UP' | 'DISPOSED'> = {
  HELD: { label: 'Đang giữ đồ', tone: 'amber' },
  PICKED_UP: { label: 'Khách đã lấy', tone: 'green' },
  DISPOSED: { label: 'Đã xử lý', tone: 'gray' },
};

export const HANDOVER_METHOD: Record<'CUSTOMER_SIGNATURE' | 'MANAGER_CONFIRM', string> = {
  CUSTOMER_SIGNATURE: 'Khách ký nhận', MANAGER_CONFIRM: 'Quản lý xác nhận (khách vắng mặt)',
};

export const NOTICE_EMAIL_STATUS: LabelMap<NoticeEmailStatus> = {
  PENDING: { label: 'Đang gửi email', tone: 'gray' },
  SENT: { label: 'Đã gửi email', tone: 'green' },
  FAILED: { label: 'Gửi email lỗi', tone: 'red' },
  NOT_CONFIGURED: { label: 'Chưa cấu hình email — chỉ báo trong ứng dụng', tone: 'amber' },
  NO_EMAIL: { label: 'Khách không có email — chỉ báo trong ứng dụng', tone: 'amber' },
  SKIPPED: { label: 'Không gửi email (tài khoản chưa đăng nhập / địa chỉ demo)', tone: 'gray' },
};

/** Trạng thái hiển thị của một khoản: khoản HOÀN bằng chuyển khoản đang PENDING là "chờ chuyển khoản" chứ không phải "chờ thanh toán". */
export const PAYOUT_PENDING_LABEL = { label: 'Chờ chuyển khoản', tone: 'amber' as Tone };
export const paymentStatusLabel = (p: { direction: 'CHARGE' | 'REFUND'; status: PaymentStatus }) =>
  (p.direction === 'REFUND' && p.status === 'PENDING' ? PAYOUT_PENDING_LABEL : PAYMENT_STATUS[p.status]);

export const CLAIM_STATUS: LabelMap<ClaimStatus> = {
  SUBMITTED: { label: 'Chờ tiếp nhận', tone: 'blue' },
  UNDER_REVIEW: { label: 'Đang xác minh', tone: 'amber' },
  APPROVED: { label: 'Đã duyệt, chờ chi', tone: 'violet' },
  REJECTED: { label: 'Từ chối', tone: 'red' },
  PAID: { label: 'Đã bồi thường', tone: 'green' },
  WITHDRAWN: { label: 'Khách đã rút', tone: 'gray' },
};

export const CLAIM_TYPE: Record<ClaimType, string> = { DAMAGE: 'Hư hỏng', LOSS: 'Mất mát' };

/** Đợt nhập hàng (đợt 14). */
export const INTAKE_BATCH_STATUS: LabelMap<IntakeBatchStatus> = {
  DECLARED: { label: 'Chờ nhân viên xác nhận', tone: 'amber' },
  CONFIRMED: { label: 'Đã nhập kho', tone: 'green' },
  REJECTED: { label: 'Từ chối nhập', tone: 'red' },
  CANCELLED: { label: 'Đã huỷ', tone: 'gray' },
};
/** Tình trạng đồ lúc nhập kho. */
export const INTAKE_ITEM_CONDITION: LabelMap<IntakeItemCondition> = {
  NEW: { label: 'Mới', tone: 'green' },
  GOOD: { label: 'Còn tốt', tone: 'teal' },
  USED: { label: 'Đã qua sử dụng', tone: 'gray' },
  DAMAGED: { label: 'Đã hư hỏng', tone: 'amber' },
};

/** Đợt 15 (A7): loại lần đồ ra khỏi kho. */
export const INTAKE_REMOVAL_KIND: LabelMap<IntakeRemovalKind> = {
  WITHDRAWN: { label: 'Khách lấy ra', tone: 'blue' },
  RETURNED: { label: 'Trả khi trả kho', tone: 'gray' },
  DISPOSED: { label: 'Thanh lý', tone: 'red' },
};
/** Đợt 15 (A7): trạng thái hiển thị của một món đồ đã xác nhận (itemStateOf — shared/intake.ts). */
export type IntakeItemState = 'IN_STORAGE' | 'PARTLY_WITHDRAWN' | 'WITHDRAWN' | 'RETURNED' | 'DISPOSED' | 'COMPENSATED';
export const INTAKE_ITEM_STATE: LabelMap<IntakeItemState> = {
  IN_STORAGE: { label: 'Đang gửi', tone: 'teal' },
  PARTLY_WITHDRAWN: { label: 'Đã lấy ra một phần', tone: 'blue' },
  WITHDRAWN: { label: 'Đã lấy ra hết', tone: 'gray' },
  RETURNED: { label: 'Đã trả khi trả kho', tone: 'gray' },
  DISPOSED: { label: 'Đã thanh lý', tone: 'red' },
  COMPENSATED: { label: 'Đã bồi thường', tone: 'violet' },
};
/** Đợt 15 (A5, A9): cờ cảnh báo trên dòng bồi thường. */
export const CLAIM_ITEM_FLAG: LabelMap<ClaimItemFlag> = {
  AFTER_INCIDENT: { label: 'Nhập sau ngày sự cố', tone: 'red' },
  DAMAGED_AT_INTAKE: { label: 'Đã hư lúc nhập kho', tone: 'amber' },
  MATCHES_DECLARED: { label: 'Trùng món đã khai', tone: 'amber' },
  SEALED_PACKAGE: { label: 'Kiện gửi kín', tone: 'violet' },
  SEALED_NO_VALUE: { label: 'Kiện không khai giá trị — cần chứng cứ', tone: 'red' },
};

export const PAYMENT_STATUS: LabelMap<PaymentStatus> = {
  PENDING: { label: 'Chờ thanh toán', tone: 'amber' },
  SUCCEEDED: { label: 'Thành công', tone: 'green' },
  FAILED: { label: 'Thất bại', tone: 'red' },
  CANCELLED: { label: 'Đã hủy', tone: 'gray' },
  PARTIALLY_REFUNDED: { label: 'Hoàn một phần', tone: 'violet' },
  REFUNDED: { label: 'Đã hoàn', tone: 'violet' },
};

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  CARD: 'Thẻ ngân hàng', BANK_TRANSFER: 'Chuyển khoản', VNPAY: 'VNPay', MOMO: 'MoMo', CASH: 'Tiền mặt', INTERNAL: 'Nội bộ',
};

export const TICKET_STATUS: LabelMap<TicketStatus> = {
  OPEN: { label: 'Mới', tone: 'blue' },
  ASSIGNED: { label: 'Đã giao', tone: 'violet' },
  IN_PROGRESS: { label: 'Đang xử lý', tone: 'amber' },
  RESOLVED: { label: 'Đã xử lý', tone: 'green' },
  CLOSED: { label: 'Đã đóng', tone: 'gray' },
};

export const TICKET_PRIORITY: LabelMap<TicketPriority> = {
  LOW: { label: 'Thấp', tone: 'gray' },
  MEDIUM: { label: 'Trung bình', tone: 'blue' },
  HIGH: { label: 'Cao', tone: 'amber' },
  URGENT: { label: 'Khẩn cấp', tone: 'red' },
};

export const TICKET_CATEGORY: Record<TicketCategory, string> = {
  ACCESS: 'Ra vào / khóa', DAMAGE: 'Hư hỏng', PEST: 'Côn trùng', BILLING: 'Thanh toán',
  MAINTENANCE: 'Bảo trì', SECURITY: 'An ninh', CLEANING: 'Vệ sinh', OTHER: 'Khác', CONSULTATION: 'Tư vấn thuê kho',
};

export const CONTACT_WINDOW: Record<ContactWindow, string> = { ANY: 'Giờ hành chính bất kỳ', MORNING: 'Buổi sáng (8–12h)', AFTERNOON: 'Buổi chiều (13–17h)', EVENING: 'Buổi tối (18–20h)' };

export const TICKET_KIND: Record<TicketKind, string> = { CUSTOMER_ISSUE: 'Yêu cầu khách hàng', OPS_TASK: 'Công việc nội bộ' };

export const UNIT_CATEGORY: Record<UnitCategory, string> = {
  LOCKER: 'Tủ locker', SMALL: 'Nhỏ', MEDIUM: 'Vừa', LARGE: 'Lớn', XL: 'Rất lớn',
};

export const ACCESS_METHOD: Record<AccessMethod, string> = { PHYSICAL_KEY: 'Chìa khoá', PIN: 'Mật khẩu', RFID_CARD: 'Thẻ khoá' };

/** Nhãn chu kỳ thuê. RENTAL_PERIOD cho tiêu đề ("Tháng"), PERIOD_UNIT để ghép số ("3 tháng", "5 ngày"). */
export const RENTAL_PERIOD: Record<RentalPeriod, string> = { DAY: 'Ngày', WEEK: 'Tuần', MONTH: 'Tháng' };
export const PERIOD_UNIT: Record<RentalPeriod, string> = { DAY: 'ngày', WEEK: 'tuần', MONTH: 'tháng' };
export const periodLabel = (period: RentalPeriod, n: number) => `${n} ${PERIOD_UNIT[period]}`;

export const SWAP_METHOD: Record<SwapMethod, string> = { SELF: 'Tự chuyển', DELIVERY: 'Thuê người chuyển' };

export const SWAP_REQUEST_STATUS: LabelMap<SwapRequestStatus> = {
  SUBMITTED: { label: 'Chờ duyệt', tone: 'amber' },
  APPROVED: { label: 'Đã duyệt · chờ chuyển', tone: 'blue' },
  REJECTED: { label: 'Từ chối', tone: 'red' },
  DONE: { label: 'Đã đổi ô', tone: 'green' },
  EXPIRED: { label: 'Hết hạn', tone: 'gray' },
  CANCELLED: { label: 'Đã huỷ', tone: 'gray' },
};

/**
 * Câu giải thích cho khách vì sao yêu cầu đổi ô kết thúc / phải trả gì — cùng một câu trên web và app. Phân biệt hết hạn vì chi nhánh
 * chưa xét với hết hạn vì chưa chuyển đồ, khách tự rút với hệ thống / chi nhánh huỷ.
 */
export function swapRequestNote(s: { status: SwapRequestStatus; customerId: unknown; fee?: number | null; facilityFault?: boolean | null; rejectReason?: string | null;
  statusHistory?: readonly { from: SwapRequestStatus | null; to: SwapRequestStatus; by?: unknown; reason?: string | null }[] }): string | null {
  const last = [...(s.statusHistory ?? [])].reverse().find((h) => h.to === s.status);
  switch (s.status) {
    // Phí 0 có thể do lần đổi đầu, lỗi chi nhánh, hoặc chi nhánh miễn — chỉ nêu lý do khi biết chắc (lỗi chi nhánh).
    case 'APPROVED': return s.fee ? `Phí đổi ô ${s.fee.toLocaleString('vi-VN')} ₫ — cộng vào khoản phải thanh toán khi đổi xong.` : `Miễn phí${s.facilityFault ? ' (đổi do lỗi từ chi nhánh)' : ''}.`;
    case 'REJECTED': return `Chi nhánh từ chối${s.rejectReason ? `: ${s.rejectReason}` : '.'}`;
    case 'EXPIRED': return last?.from === 'SUBMITTED' ? 'Chi nhánh chưa xét trong 7 ngày nên yêu cầu tự hết hạn — gửi lại nếu bạn vẫn muốn đổi.' : 'Quá hạn chuyển đồ nên yêu cầu tự hết hạn, ô mới đã được nhả.';
    case 'CANCELLED':
      if (last?.by && String(last.by) === String(s.customerId)) return 'Bạn đã rút yêu cầu.';
      return last?.by ? `Chi nhánh đã huỷ${last.reason ? `: ${last.reason}` : '.'}` : `Hệ thống tự huỷ${last?.reason ? `: ${last.reason}` : ' (hợp đồng đã trả kho / đóng).'}`;
    default: return null;
  }
}

export const SERVICE_ORDER_STATUS: LabelMap<ServiceOrderStatus> = {
  REQUESTED: { label: 'Chờ thực hiện', tone: 'amber' },
  DONE: { label: 'Đã hoàn thành', tone: 'green' },
  CANCELLED: { label: 'Đã huỷ', tone: 'gray' },
};

export const ACCESS_REQUEST_STATUS: LabelMap<AccessRequestStatus> = {
  REQUESTED: { label: 'Chờ quản lý duyệt', tone: 'amber' },
  APPROVED: { label: 'Đã duyệt — chờ bàn giao', tone: 'blue' },
  DONE: { label: 'Đã hoàn tất', tone: 'green' },
  REJECTED: { label: 'Bị từ chối', tone: 'red' },
  CANCELLED: { label: 'Đã huỷ', tone: 'gray' },
};

/** Tên yêu cầu theo loại; `short` dùng cho nút, `title` cho tiêu đề. */
export const ACCESS_REQUEST_TYPE: Record<AccessRequestType, { title: string; button: string; what: string }> = {
  PIN_RESET: { title: 'Đặt lại mật khẩu kho', button: 'Xin đặt lại mật khẩu', what: 'mật khẩu mới' },
  CARD_REISSUE: { title: 'Làm lại thẻ khoá', button: 'Xin làm lại thẻ', what: 'thẻ khoá mới' },
  KEY_REISSUE: { title: 'Cấp lại chìa khoá', button: 'Xin cấp lại chìa', what: 'chìa khoá mới' },
};

export const FACILITY_STATUS: LabelMap<FacilityStatus> = {
  ACTIVE: { label: 'Đang hoạt động', tone: 'green' },
  INACTIVE: { label: 'Tạm ngưng', tone: 'gray' },
  UNDER_CONSTRUCTION: { label: 'Đang xây dựng', tone: 'amber' },
};

export const USER_STATUS: LabelMap<UserStatus> = {
  PENDING_VERIFICATION: { label: 'Chờ xác minh', tone: 'amber' },
  ACTIVE: { label: 'Hoạt động', tone: 'green' },
  SUSPENDED: { label: 'Tạm khóa', tone: 'red' },
};

export const CANCELLATION_REASON: Record<CancellationReason, string> = {
  CUSTOMER_REQUEST: 'Khách yêu cầu', HOLD_EXPIRED: 'Hết thời gian giữ chỗ', PAYMENT_FAILED: 'Thanh toán thất bại',
  NO_SHOW: 'Không đến nhận kho', FACILITY_UNAVAILABLE: 'Chi nhánh không đáp ứng', ADMIN_OVERRIDE: 'Quản trị hủy',
};

/**
 * Lý do huỷ đặt chỗ mỗi vai trò được chọn (POST /reservations/:id/cancel): nhân viên chỉ huỷ theo yêu cầu của khách; quản lý chi nhánh
 * thêm "chi nhánh không đáp ứng" (hoàn 100%); vận hành / quản trị thêm "quản trị huỷ". Lý do khác → 403 CANCEL_REASON_FORBIDDEN.
 * Người không phải khách huỷ phải ghi chú CANCEL_NOTE_MIN..CANCEL_NOTE_MAX ký tự (422 CANCEL_NOTE_REQUIRED) — gửi kèm email báo khách.
 */
export const CANCEL_REASONS_BY_ROLE: Record<Role, CancellationReason[]> = {
  CUSTOMER: ['CUSTOMER_REQUEST'],
  STAFF: ['CUSTOMER_REQUEST'],
  FACILITY_MANAGER: ['CUSTOMER_REQUEST', 'FACILITY_UNAVAILABLE'],
  OPS_MANAGER: ['CUSTOMER_REQUEST', 'FACILITY_UNAVAILABLE', 'ADMIN_OVERRIDE'],
  ADMIN: ['CUSTOMER_REQUEST', 'FACILITY_UNAVAILABLE', 'ADMIN_OVERRIDE'],
};
export const CANCEL_NOTE_MIN = 5;
export const CANCEL_NOTE_MAX = 300;

/** Ca giờ nhận kho khách chọn lúc đặt, cũng dùng làm ca làm việc cố định của nhân viên (STAFF.shift). */
/**
 * Cách ký khách đã chọn (Reservation.signingPreference — thiếu = ONLINE). `label`: nhãn ngắn cho danh sách nhận kho / màn tra mã;
 * `choice`: chữ trên nút lựa chọn của khách; `note`: dòng nhắc khi khách đã chọn ký giấy.
 */
export const SIGNING_PREFERENCE: Record<SigningPreference, { label: string; tone: Tone; choice: string; note: string }> = {
  ONLINE: { label: 'Ký online', tone: 'blue', choice: 'Ký online ngay', note: 'Ký trên tài khoản bằng mã xác nhận gửi qua email.' },
  PAPER_AT_COUNTER: {
    label: 'Ký giấy tại quầy', tone: 'violet', choice: 'Ký giấy tại quầy khi nhận kho',
    note: 'Bạn sẽ ký hợp đồng giấy khi đến nhận kho — mang CCCD/hộ chiếu.',
  },
};
/** Cách ký hiệu lực của một đặt chỗ (dữ liệu cũ thiếu trường = ký online). */
export const signingPreferenceOf = (r: { signingPreference?: SigningPreference | null }): SigningPreference => r.signingPreference ?? 'ONLINE';

/** Trạng thái ô trên sơ đồ công khai — chỉ "còn trống" / "không thuê được". */
export const PUBLIC_UNIT_STATUS: LabelMap<PublicUnitStatus> = {
  AVAILABLE: { label: 'Còn trống', tone: 'green' },
  UNAVAILABLE: { label: 'Không thuê được', tone: 'gray' },
};

export const CHECK_IN_SHIFT: LabelMap<CheckInShift> = {
  SHIFT_1: { label: 'Ca 1 · 09:00–10:30', tone: 'blue' },
  SHIFT_2: { label: 'Ca 2 · 10:30–12:00', tone: 'blue' },
  SHIFT_3: { label: 'Ca 3 · 14:00–15:30', tone: 'blue' },
  SHIFT_4: { label: 'Ca 4 · 15:30–17:00', tone: 'blue' },
  UNKNOWN: { label: 'Chưa rõ giờ', tone: 'gray' },
};

export const INSPECTION_OUTCOME: LabelMap<InspectionOutcome> = {
  PASS: { label: 'Đạt', tone: 'green' },
  PASS_WITH_DAMAGE: { label: 'Đạt, có hư hại', tone: 'amber' },
  MAINTENANCE_REQUIRED: { label: 'Cần bảo trì', tone: 'red' },
};
