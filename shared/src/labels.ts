import type {
  AbandonedItemsDisposal, AccessMethod, CheckInShift, ContactWindow, ContractNoticeKind, NoticeEmailStatus, PrivacyRequestStatus, PrivacyRequestType, ClaimStatus, ClaimType, ContractStatus, FacilityStatus, PaymentMethod, PaymentStatus, PaymentType,
  RentalPeriod, ReservationStatus, Role, SwapMethod, SwapRequestStatus, TicketCategory, TicketKind, TicketPriority,
  TicketStatus, UnitCategory, UnitStatus, UserStatus, CancellationReason, InspectionOutcome, InspectionStatus, DepositStatus, ServiceOrderStatus, AccessRequestStatus, AccessRequestType, SigningPreference,
  IntakeBatchStatus, IntakeItemCondition, IntakeRemovalKind, ClaimItemFlag, GatewayOrderStatus, GatewayRefundState, CounterPayMethod, CounterPurpose,
} from './enums';
import type { PublicUnitStatus } from './entities';
import type { MoveOutStage } from './move-out-rules';

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
  LOCKED_OUT: { label: 'Đã khoá truy cập', tone: 'red' },
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
  GATEWAY_UNAPPLIED: { label: 'Tiền cổng chưa áp được', tone: 'amber' },
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
  EXPIRY_2: { label: 'Còn 2 ngày hết hạn', tone: 'amber' },
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
  CUSTOMER_SIGNATURE: 'Khách xác nhận biên bản trả kho', MANAGER_CONFIRM: 'Quản lý xác nhận (khách vắng mặt)',
};
/** Dòng ghi trên biên bản trả kho khi khách có mặt xác nhận bằng mã OTP qua email (web, app, bản sao dữ liệu). */
export const handoverOtpText = (o: { sentTo: string }) => `Khách xác nhận bằng mã OTP gửi tới email ${o.sentTo}`;

export const NOTICE_EMAIL_STATUS: LabelMap<NoticeEmailStatus> = {
  PENDING: { label: 'Đang gửi email', tone: 'gray' },
  SENT: { label: 'Đã gửi email', tone: 'green' },
  FAILED: { label: 'Gửi email lỗi', tone: 'red' },
  NOT_CONFIGURED: { label: 'Chưa cấu hình email — chỉ báo trong ứng dụng', tone: 'amber' },
  NO_EMAIL: { label: 'Khách không có email — chỉ báo trong ứng dụng', tone: 'amber' },
  SKIPPED: { label: 'Chỉ báo trong ứng dụng', tone: 'gray' },
};

/** Trạng thái hiển thị của một khoản: khoản HOÀN bằng chuyển khoản đang PENDING là "chờ chuyển khoản" chứ không phải "chờ thanh toán". */
export const PAYOUT_PENDING_LABEL = { label: 'Chờ chuyển khoản', tone: 'amber' as Tone };
export const GATEWAY_REFUND_PENDING_LABEL = { label: 'Đang hoàn qua VNPAY', tone: 'amber' as Tone };
export const GATEWAY_REFUND_TRANSFERRED_LABEL = { label: 'Đã chuyển khoản hoàn tiền', tone: 'green' as Tone };
export const paymentStatusLabel = (p: { direction: 'CHARGE' | 'REFUND'; status: PaymentStatus; method?: PaymentMethod }) =>
  (p.direction === 'REFUND' && p.status === 'PENDING' ? (p.method === 'VNPAY' ? GATEWAY_REFUND_PENDING_LABEL : PAYOUT_PENDING_LABEL) : PAYMENT_STATUS[p.status]);

/** Đợt VNPAY: lệnh thu qua cổng + tiến trình hoàn qua cổng. */
export const GATEWAY_ORDER_STATUS: LabelMap<GatewayOrderStatus> = {
  PENDING: { label: 'Đang chờ thanh toán', tone: 'amber' },
  PAID: { label: 'Đã thanh toán', tone: 'green' },
  PAID_UNAPPLIED: { label: 'Đã nhận tiền, đang hoàn', tone: 'amber' },
  FAILED: { label: 'Không thành công', tone: 'red' },
  EXPIRED: { label: 'Hết hạn', tone: 'gray' },
  SUPERSEDED: { label: 'Đã thay bằng giao dịch mới', tone: 'gray' },
};
export const GATEWAY_REFUND_STATE: LabelMap<GatewayRefundState> = {
  QUEUED: { label: 'Chờ gửi yêu cầu hoàn', tone: 'amber' },
  SENDING: { label: 'Đang gửi yêu cầu hoàn', tone: 'amber' },
  DONE: { label: 'Đã gửi yêu cầu hoàn', tone: 'green' },
  REJECTED: { label: 'VNPAY từ chối — cần xử lý', tone: 'red' },
  UNKNOWN: { label: 'Chưa rõ kết quả — kiểm trên merchant VNPAY trước khi xử lý', tone: 'red' },
  MOVED_TO_BANK: { label: 'Chuyển sang hoàn chuyển khoản', tone: 'violet' },
};

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
/** Nhãn hình thức thu TẠI QUẦY (góp ý 17/11: chỉ tiền mặt và VNPAY qua cổng — khách trả trên trang VNPAY ngay tại quầy). */
export const COUNTER_PAY_METHOD: Record<CounterPayMethod, string> = { CASH: 'Tiền mặt', VNPAY: 'VNPAY' };
/** Khoản CŨ nhân viên ghi tay mã giao dịch VNPAY (khách quét QR của chi nhánh, có provider.counterRef) — vẫn hiện như trước. */
export const LEGACY_COUNTER_VNPAY_LABEL = 'VNPAY (QR tại quầy)';
/** Khoản VNPAY thu tại quầy qua cổng (lệnh COUNTER): có người thu (recordedBy) và mã lệnh cổng (provider.orderId). */
export const COUNTER_GATEWAY_VNPAY_LABEL = 'VNPay (tại quầy)';
/** Việc của lệnh VNPAY tại quầy — hiện ở hàng "VNPAY đã thu chưa ghi nhận" và trang thanh toán giả lập. */
export const COUNTER_PURPOSE: Record<CounterPurpose, string> = {
  CHECK_IN: 'Tiền thu khi nhận kho', HOLD_DEPOSIT: 'Tiền giữ chân (giữ chỗ trả tại quầy)', WALK_IN: 'Đặt chỗ tại quầy', BALANCE: 'Công nợ hợp đồng', SWAP_FEE: 'Phí đổi ô',
};
/** Nhãn hình thức của một khoản đã thu: khoản VNPAY cũ ghi tay tại quầy (counterRef) → "VNPAY (QR tại quầy)"; VNPAY qua cổng tại quầy → "VNPay (tại quầy)". */
export const paymentMethodLabel = (p: { method: PaymentMethod; recordedBy?: unknown; provider?: { counterRef?: string | null; orderId?: unknown } | null }) =>
  (p.method === 'VNPAY' && p.provider?.counterRef ? LEGACY_COUNTER_VNPAY_LABEL
    : p.method === 'VNPAY' && p.recordedBy && p.provider?.orderId ? COUNTER_GATEWAY_VNPAY_LABEL : PAYMENT_METHOD[p.method]);

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
  ACCESS: 'Ra vào / khoá', DAMAGE: 'Hư hỏng', PEST: 'Côn trùng', BILLING: 'Thanh toán',
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
  feePrepay?: boolean | null; paymentId?: unknown; feeRefundPaymentId?: unknown;
  statusHistory?: readonly { from: SwapRequestStatus | null; to: SwapRequestStatus; by?: unknown; reason?: string | null }[] }): string | null {
  const last = [...(s.statusHistory ?? [])].reverse().find((h) => h.to === s.status);
  const refunded = s.feeRefundPaymentId && s.fee ? ` Phí đã trả ${s.fee.toLocaleString('vi-VN')} ₫ được hoàn đủ.` : '';
  switch (s.status) {
    // Phí 0 có thể do lần đổi đầu, lỗi chi nhánh, hoặc chi nhánh miễn — chỉ nêu lý do khi biết chắc (lỗi chi nhánh).
    case 'APPROVED':
      if (s.fee && s.feePrepay) return s.paymentId ? `Đã trả phí thuê người chuyển ${s.fee.toLocaleString('vi-VN')} ₫.` : `Phí thuê người chuyển ${s.fee.toLocaleString('vi-VN')} ₫ — trả trước ngày chuyển; huỷ hoặc quá hạn được hoàn đủ.`;
      return s.fee ? `Phí đổi ô ${s.fee.toLocaleString('vi-VN')} ₫ — cộng vào khoản phải thanh toán khi đổi xong.` : `Miễn phí${s.facilityFault ? ' (đổi do lỗi từ chi nhánh)' : ''}.`;
    case 'REJECTED': return `Chi nhánh từ chối${s.rejectReason ? `: ${s.rejectReason}` : '.'}`;
    case 'EXPIRED': return last?.from === 'SUBMITTED' ? 'Chi nhánh chưa xét trong 7 ngày nên yêu cầu tự hết hạn — gửi lại nếu bạn vẫn muốn đổi.' : `Quá hạn chuyển đồ nên yêu cầu tự hết hạn, ô mới đã được nhả.${refunded}`;
    case 'CANCELLED':
      if (last?.by && String(last.by) === String(s.customerId)) return `Bạn đã rút yêu cầu.${refunded}`;
      return `${last?.by ? `Chi nhánh đã huỷ${last.reason ? `: ${last.reason}` : '.'}` : `Hệ thống tự huỷ${last?.reason ? `: ${last.reason}` : ' (hợp đồng đã trả kho / đóng).'}`}${refunded}`;
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

/** Lý do cấp lại mà thẻ / chìa còn trong tay khách: không phải báo mất. Web và app gửi đúng các chuỗi này; lý do khác, kể cả "Khác" hay để trống, vẫn coi là báo mất cho an toàn. */
const DAMAGED_KEY_REASONS = ['Thẻ hỏng', 'Chìa hỏng'];
export const isDamagedKeyReason = (reason?: string | null) => DAMAGED_KEY_REASONS.includes(reason?.trim() ?? '');

export const FACILITY_STATUS: LabelMap<FacilityStatus> = {
  ACTIVE: { label: 'Đang hoạt động', tone: 'green' },
  INACTIVE: { label: 'Tạm ngưng', tone: 'gray' },
  UNDER_CONSTRUCTION: { label: 'Đang xây dựng', tone: 'amber' },
};

export const USER_STATUS: LabelMap<UserStatus> = {
  PENDING_VERIFICATION: { label: 'Chờ xác minh', tone: 'amber' },
  ACTIVE: { label: 'Hoạt động', tone: 'green' },
  SUSPENDED: { label: 'Tạm khoá', tone: 'red' },
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

/** Trạng thái biên bản trả kho (đợt 17) — xem INSPECTION_MACHINE. */
export const INSPECTION_STATUS: LabelMap<InspectionStatus> = {
  DRAFT: { label: 'Nháp', tone: 'gray' },
  SUBMITTED: { label: 'Chờ quản lý duyệt', tone: 'blue' },
  RETURNED: { label: 'Trả lại để sửa', tone: 'red' },
  FM_APPROVED: { label: 'Đã duyệt — chờ khách xác nhận', tone: 'violet' },
  APPROVED: { label: 'Đã chốt', tone: 'green' },
};

/**
 * Bước của lượt trả kho đang mở (moveOutStageOf): `label` cho nhân viên / quản lý, `customer` cho khách (web + app). Khách không cần biết
 * biên bản bị trả lại — vẫn thấy "đang chờ quản lý duyệt".
 */
export const MOVE_OUT_STAGE: Record<MoveOutStage, { label: string; tone: Tone; customer: string }> = {
  AWAITING_HANDOVER: { label: 'Chờ khách bàn giao', tone: 'amber', customer: 'Đã đăng ký trả kho' },
  AWAITING_INSPECTION: { label: 'Đã nhận ô — chờ kiểm', tone: 'violet', customer: 'Đã bàn giao — chi nhánh đang kiểm tra ô' },
  RETURNED: { label: 'Bị trả lại — sửa biên bản', tone: 'red', customer: 'Đang chờ quản lý duyệt biên bản' },
  AWAITING_APPROVAL: { label: 'Chờ quản lý duyệt biên bản', tone: 'blue', customer: 'Đang chờ quản lý duyệt biên bản' },
  AWAITING_CONFIRMATION: { label: 'Chờ khách xác nhận OTP', tone: 'green', customer: 'Biên bản đã duyệt — xác nhận bằng mã OTP tại quầy' },
};

export const INSPECTION_OUTCOME: LabelMap<InspectionOutcome> = {
  PASS: { label: 'Đạt', tone: 'green' },
  PASS_WITH_DAMAGE: { label: 'Đạt, có hư hại', tone: 'amber' },
  MAINTENANCE_REQUIRED: { label: 'Cần bảo trì', tone: 'red' },
};

// ---------- Nhật ký kiểm toán ----------

/**
 * Tên tiếng Việt của MỌI mã hành động BE ghi nhật ký (audit / auditDenied / assertCanAccess / assertFacility). Mã dựng lúc chạy
 * (`access.<method>:<đường dẫn>` khi sai vai trò) hoặc mã mới chưa có ở đây → auditActionLabel đoán theo tiền tố.
 */
export const AUDIT_ACTION: Record<string, string> = {
  // Tài khoản
  'auth.link': 'Liên kết tài khoản đăng nhập',
  'auth.signup': 'Đăng ký tài khoản',
  'user.consent': 'Đồng ý điều khoản mới',
  'user.create': 'Tạo tài khoản nhân sự',
  'user.update': 'Cập nhật tài khoản',
  'user.profile_update': 'Cập nhật hồ sơ',
  'user.identity_update': 'Cập nhật giấy tờ tuỳ thân',
  'user.payout_account_update': 'Cập nhật tài khoản nhận tiền',
  'user.anonymize': 'Xoá tài khoản khách (ẩn danh hoá)',
  'customer.lookup': 'Tra cứu khách hàng',
  'customer.id_mismatch': 'Giấy tờ khách không khớp',
  'customer.id_required': 'Thiếu giấy tờ khách',
  'privacy.request': 'Gửi yêu cầu về dữ liệu cá nhân',
  'privacy.resolve': 'Xử lý yêu cầu về dữ liệu cá nhân',
  'privacy.export': 'Tải dữ liệu cá nhân',
  // Đặt chỗ
  'reservation.create': 'Đặt chỗ',
  'reservation.walk_in': 'Đặt chỗ tại quầy',
  'reservation.walk_in_email_otp': 'Gửi mã xác minh email tại quầy',
  'reservation.allocate': 'Xếp ô kho',
  'reservation.unallocate': 'Bỏ xếp ô kho',
  'reservation.cancel': 'Huỷ đặt chỗ',
  'reservation.reschedule': 'Đổi ngày nhận kho',
  'reservation.sign': 'Ký hợp đồng online',
  'reservation.sign_otp': 'Gửi mã ký hợp đồng',
  'reservation.sign_paper': 'Ký hợp đồng giấy',
  'reservation.signing_preference': 'Đổi cách ký hợp đồng',
  'reservation.collect_deposit': 'Thu tiền giữ chân tại quầy',
  'reservation.check_in': 'Nhận kho',
  'reservation.qr_reissue': 'Cấp lại mã QR nhận kho',
  'reservation.pay_deposit': 'Trả tiền giữ chân',
  'reservation.read': 'Xem đặt chỗ',
  'reservation.lookup': 'Tra cứu đặt chỗ',
  'reservation.contract_view': 'Xem hợp đồng',
  'reservation.contract_pdf': 'Tải PDF hợp đồng',
  'reservation.contract_print': 'In hợp đồng',
  'reservation.contract_email': 'Gửi hợp đồng qua email',
  'reservation.signed_file': 'Xem bản hợp đồng đã ký',
  'reservation.id_mismatch': 'Giấy tờ không khớp khi nhận kho',
  'reservation.id_required': 'Thiếu giấy tờ khi nhận kho',
  'reservation.id_check_locked': 'Khoá đối chiếu giấy tờ (đặt chỗ)',
  'reservation.id_check_unlock': 'Mở khoá đối chiếu giấy tờ (đặt chỗ)',
  // Thanh toán
  'payment.deposit': 'Trả tiền giữ chân',
  'payment.balance': 'Thanh toán công nợ',
  'payment.waiver': 'Miễn giảm khoản nợ',
  'payment.write_off': 'Xoá nợ sau quyết toán',
  'payment.payout': 'Xác nhận đã chi tiền',
  'payment.receipt': 'Tải biên lai',
  'payment.gateway_paid': 'VNPAY báo đã trả',
  'payment.gateway_unapplied': 'Tiền vào nhưng không áp được',
  'payment.gateway_amount_mismatch': 'VNPAY báo sai số tiền',
  'payment.gateway_review': 'Giao dịch VNPAY cần đối soát',
  'payment.gateway_refund': 'Hoàn tiền qua VNPAY',
  'payment.gateway_refund_resolve': 'Xử lý hoàn tiền VNPAY',
  'payment.counter_order': 'Mở lệnh VNPAY tại quầy',
  'payment.counter_release': 'Trả lại khách khoản VNPAY tại quầy chưa dùng',
  // Hợp đồng
  'contract.read': 'Xem hợp đồng',
  'contract.extend': 'Gia hạn hợp đồng',
  'contract.expiry_notice': 'Nhắc hết hạn hợp đồng',
  'contract.delinquent': 'Chuyển nợ quá hạn',
  'contract.lockout': 'Khoá quyền ra vào',
  'contract.final_notice': 'Gửi thông báo cuối',
  'contract.final_notice_delivery': 'Ghi nhận đã báo khách',
  'contract.abandonment': 'Xử lý hàng bỏ lại',
  'contract.leftover': 'Xử lý đồ để lại',
  'contract.leftover_resolve': 'Xử lý đồ để lại',
  'contract.move_out_request': 'Đăng ký trả kho',
  'contract.move_out_cancel': 'Huỷ đăng ký trả kho',
  'contract.move_out_complete': 'Hoàn tất trả kho',
  'contract.swap_unit': 'Đổi ô kho',
  'contract.access_view': 'Xem mã vào kho',
  'contract.assisted_open': 'Mở kho hộ',
  'contract.authorize_person': 'Thêm người được uỷ quyền',
  'contract.revoke_person': 'Xoá người được uỷ quyền',
  'contract.appendix_pdf': 'Tải phụ lục hợp đồng',
  'contract.inventory': 'Xem đồ đang gửi',
  'contract.pay_balance': 'Thanh toán công nợ',
  'contract.resize_quote': 'Báo giá đổi cỡ kho',
  'contract.id_mismatch': 'Giấy tờ không khớp',
  'contract.id_required': 'Thiếu giấy tờ',
  'contract.id_check_locked': 'Khoá đối chiếu giấy tờ (hợp đồng)',
  'contract.id_check_unlock': 'Mở khoá đối chiếu giấy tờ (hợp đồng)',
  'inspection.move_out': 'Chốt biên bản & quyết toán trả kho',
  'inspection.move_out_submit': 'Gửi biên bản trả kho chờ duyệt',
  'inspection.move_out_return': 'Trả lại biên bản trả kho',
  'inspection.move_out_approve': 'Duyệt biên bản trả kho',
  'inspection.move_out_reopen': 'Mở lại biên bản trả kho',
  'inspection.adjust': 'Điều chỉnh biên bản trả kho',
  // Kho, chi nhánh, chính sách
  'unit.receive': 'Nhận lại kho',
  'contract.move_out_otp': 'Gửi mã OTP trả kho',
  'contract.move_out_otp_verify': 'Khách xác nhận trả kho bằng OTP',
  'unit.access_reset': 'Thu chìa / thẻ, đặt lại khoá',
  'unit.create': 'Thêm ô kho',
  'unit.bulk_create': 'Thêm nhiều ô kho',
  'unit.update': 'Sửa ô kho',
  'unit.delete': 'Xoá ô kho',
  'unit.status': 'Đổi trạng thái ô kho',
  'unit_type.create': 'Thêm loại kho',
  'unit_type.update': 'Sửa loại kho',
  'unit_type.delete': 'Xoá loại kho',
  'pricing.update': 'Đổi bảng giá',
  'facility.create': 'Thêm chi nhánh',
  'facility.update': 'Sửa chi nhánh',
  'facility.delete': 'Xoá chi nhánh',
  'policy.publish': 'Phát hành chính sách',
  'policy.revert': 'Bỏ chính sách riêng',
  'contract_template.publish': 'Phát hành mẫu hợp đồng',
  'contract_template.retire': 'Ngừng dùng mẫu hợp đồng',
  // Dịch vụ, đổi ô, thẻ / chìa
  'service_offering.create': 'Thêm dịch vụ',
  'service_offering.update': 'Sửa dịch vụ',
  'service_offering.delete': 'Xoá dịch vụ',
  'service.order': 'Đặt dịch vụ',
  'service.complete': 'Hoàn tất dịch vụ',
  'service.cancel': 'Huỷ đơn dịch vụ',
  'swap_request.create': 'Gửi yêu cầu đổi ô',
  'swap_request.read': 'Xem yêu cầu đổi ô',
  'swap_request.decide': 'Xét duyệt đổi ô',
  'swap_request.approve': 'Duyệt đổi ô',
  'swap_request.reject': 'Từ chối đổi ô',
  'swap_request.pay_fee': 'Trả phí chuyển đồ',
  'swap_request.reschedule': 'Đổi lịch đổi ô',
  'swap_request.complete': 'Hoàn tất đổi ô',
  'swap_request.cancel': 'Huỷ yêu cầu đổi ô',
  'swap_request.expire': 'Yêu cầu đổi ô hết hạn',
  'swap_request.email': 'Email kết quả xét đổi ô',
  'swap_request.unassign': 'Bỏ phân công đổi ô',
  'access.request': 'Yêu cầu cấp lại thẻ / chìa',
  'access.decide': 'Xét duyệt cấp lại thẻ / chìa',
  'access.approve': 'Duyệt cấp lại thẻ / chìa',
  'access.reject': 'Từ chối cấp lại thẻ / chìa',
  'access.complete': 'Giao thẻ / chìa mới',
  'access.cancel': 'Huỷ yêu cầu cấp lại thẻ / chìa',
  'access.lost_block': 'Khoá thẻ / chìa bị mất',
  'access.lost_blocked': 'Khoá thẻ / chìa bị mất',
  'access.facility_scope': 'Truy cập ngoài chi nhánh được giao',
  'access.ownership': 'Truy cập dữ liệu không thuộc về mình',
  // Bồi thường, nhập hàng, hỗ trợ
  'claim.create': 'Gửi yêu cầu bồi thường',
  'claim.read': 'Xem yêu cầu bồi thường',
  'claim.review': 'Nhận xem xét bồi thường',
  'claim.decide': 'Xét duyệt bồi thường',
  'claim.approve': 'Duyệt bồi thường',
  'claim.reject': 'Từ chối bồi thường',
  'claim.pay': 'Chi tiền bồi thường',
  'claim.payout_request': 'Lập khoản chi bồi thường',
  'claim.withdraw': 'Rút yêu cầu bồi thường',
  'intake.read': 'Xem đợt nhập hàng',
  'intake.declare': 'Khai đợt nhập hàng',
  'intake.declare_on_behalf': 'Khai nhập hàng hộ khách',
  'intake.create_on_behalf': 'Nhập hàng hộ khách',
  'intake.update': 'Sửa đợt nhập hàng',
  'intake.confirm': 'Xác nhận nhập hàng',
  'intake.reject': 'Từ chối đợt nhập hàng',
  'intake.cancel': 'Huỷ đợt nhập hàng',
  'intake.expire': 'Đợt nhập hàng hết hạn',
  'intake.withdraw': 'Lấy đồ ra khỏi kho',
  'intake.return': 'Trả đồ cho khách',
  'intake.dispose': 'Xử lý đồ',
  'intake.sealed_pledge': 'In cam kết gửi kín',
  'intake.sealed_pledge_print': 'In cam kết gửi kín',
  'ticket.read': 'Xem yêu cầu hỗ trợ',
  'ticket.create': 'Tạo yêu cầu hỗ trợ',
  'ticket.consultation': 'Yêu cầu tư vấn',
  'ticket.message': 'Nhắn trong yêu cầu hỗ trợ',
  'ticket.assign': 'Phân công yêu cầu hỗ trợ',
  'ticket.unassign': 'Bỏ phân công yêu cầu hỗ trợ',
  'ticket.status': 'Đổi trạng thái yêu cầu hỗ trợ',
  'ticket.reopen': 'Mở lại yêu cầu hỗ trợ',
  'report.cash': 'Xem chốt ca tiền mặt',
  'system.retention': 'Dọn dữ liệu quá hạn lưu',
  // Chỉ có trong dữ liệu mẫu (seed) — BE hiện không ghi các mã này.
  'auth.login': 'Đăng nhập',
  'user.role_change': 'Đổi vai trò / chi nhánh',
  'contract.override': 'Sửa giá hợp đồng',
};

/** Nhóm theo tiền tố mã — tên dự phòng cho mã chưa có trong AUDIT_ACTION. */
export const AUDIT_ACTION_GROUP: Record<string, string> = {
  auth: 'Tài khoản', user: 'Tài khoản', customer: 'Khách hàng', privacy: 'Dữ liệu cá nhân', reservation: 'Đặt chỗ', payment: 'Thanh toán',
  contract: 'Hợp đồng', inspection: 'Biên bản trả kho', unit: 'Ô kho', unit_type: 'Loại kho', pricing: 'Bảng giá', facility: 'Chi nhánh',
  policy: 'Chính sách', contract_template: 'Mẫu hợp đồng', service_offering: 'Dịch vụ', service: 'Dịch vụ', swap_request: 'Đổi ô',
  access: 'Thẻ / chìa', claim: 'Bồi thường', intake: 'Nhập hàng', ticket: 'Hỗ trợ', report: 'Báo cáo', system: 'Hệ thống',
};

export function auditActionLabel(action: string): string {
  const hit = AUDIT_ACTION[action];
  if (hit) return hit;
  // authorize(): `access.<method>:<đường dẫn>` — gọi chức năng mà vai trò không được dùng.
  if (/^access\.[a-z]+:/.test(action)) return 'Gọi chức năng ngoài quyền của vai trò';
  const group = AUDIT_ACTION_GROUP[action.split('.')[0]];
  return group ? `${group} · thao tác khác` : 'Thao tác khác';
}

/**
 * Bản ghi TỰ ĐỘNG, THƯỜNG LỆ của hệ thống — nhắc, thông báo, dọn dữ liệu: ẩn mặc định ở trang Nhật ký (GET /audit?excludeRoutine=1).
 * Việc đổi tiền, trạng thái hay quyền ra vào KHÔNG thuộc nhóm này, kể cả khi job tự làm (chuyển nợ quá hạn, khoá, tự huỷ…).
 */
export const ROUTINE_AUDIT_ACTIONS: readonly string[] = ['contract.expiry_notice', 'system.retention'];
export const isRoutineAudit = (action: string) => ROUTINE_AUDIT_ACTIONS.includes(action);

/** Loại đối tượng của bản ghi nhật ký (AuditLog.entityType). */
export const AUDIT_ENTITY: Record<string, string> = {
  RentalContract: 'Hợp đồng', Reservation: 'Đặt chỗ', User: 'Người dùng', PaymentTransaction: 'Khoản thanh toán', GatewayOrder: 'Giao dịch VNPAY',
  DamageClaim: 'Bồi thường', IntakeBatch: 'Đợt nhập hàng', UnitSwapRequest: 'Yêu cầu đổi ô', ServiceOrder: 'Đơn dịch vụ', ServiceOffering: 'Dịch vụ',
  SupportTicket: 'Yêu cầu hỗ trợ', AccessRequest: 'Yêu cầu cấp lại thẻ / chìa', PrivacyRequest: 'Yêu cầu dữ liệu cá nhân', StorageUnit: 'Ô kho',
  UnitType: 'Loại kho', Facility: 'Chi nhánh', BusinessPolicy: 'Chính sách', ContractTemplate: 'Mẫu hợp đồng', InspectionLog: 'Biên bản trả kho',
};
