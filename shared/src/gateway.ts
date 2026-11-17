import type { CounterPurpose, GatewayOrderKind, GatewayOrderStatus, GatewayRefundState, PaymentMethod } from './enums';

/**
 * Đợt VNPAY — hợp đồng API thanh toán online dùng chung BE, Web, App.
 * Giao diện chỉ dùng cấu hình để chọn hiển thị; quyết định chuyển hướng dựa trên phản hồi thật (202 thì chuyển, 200 / 201 thì xong).
 */
export type PaymentMode = 'MOCK' | 'VNPAY' | 'OFF';
export interface PaymentConfig { mode: PaymentMode; methods: PaymentMethod[] }

/** Phản hồi 202 của 5 endpoint thanh toán khi đi qua cổng thật. */
export interface GatewayStart {
  gateway: { orderId: string; txnRef: string; payUrl: string; amount: number; expiresAt: string; kind: GatewayOrderKind; reused: boolean };
}

/** GET /payments/gateway-orders/:txnRef */
export interface GatewayOrderView {
  _id: string; txnRef: string; kind: GatewayOrderKind; status: GatewayOrderStatus; amount: number;
  createdAt: string; expireAt: string; reservationId: string | null; contractId: string | null;
  /** Chỉ khi PENDING, còn hạn, và người xem là chủ order. */
  payUrl: string | null;
  /** Các dòng sổ đã ghi — để in biên lai. */
  paymentIds: string[];
  result: { serviceOrderId?: string; accessRequestId?: string; newEndDate?: string } | null;
  transactionNo: string | null; paidAt: string | null;
  unapplied: { code: string; message: string } | null;
  /** Gộp từ các khoản REFUND của order. Khách không thấy REJECTED / UNKNOWN (hiện là SENDING: đang xử lý). `transferred`: MOVED_TO_BANK và tiền đã được chuyển xong. */
  refund: { state: GatewayRefundState; amount: number; transferred: boolean } | null;
  /** Góp ý 17/11 — chỉ lệnh tại quầy (kind COUNTER), chỉ nhân sự thấy. `payUrl` của lệnh này hiện cho nhân sự chi nhánh khi còn PENDING, còn hạn. */
  counter?: CounterOrderState | null;
}

/** Góp ý 17/11 — tình trạng dùng một lệnh VNPAY tại quầy. */
export interface CounterOrderState {
  purpose: CounterPurpose;
  consumedAt: string | null; consumedFor: string | null;
  released: { at: string; note: string } | null;
}

/**
 * POST /payments/counter-orders — nhân viên mở (hoặc dùng lại) lệnh VNPAY tại quầy. Số tiền server tự tính theo việc (trừ đặt chỗ tại quầy: số nhân viên
 * đang thu, kiểm lại khi đặt). `reused`: lệnh cùng việc, cùng số tiền đã có (đang chờ còn hạn, hoặc ĐÃ TRẢ mà chưa dùng — status PAID thì gửi thao tác luôn).
 * `payUrl`: trang VNPAY (chế độ VNPAY) hoặc đường dẫn tương đối tới trang giả lập của Webapp (chế độ MOCK, bắt đầu bằng "/").
 */
export interface CounterOrderStart {
  txnRef: string; amount: number; status: GatewayOrderStatus; expiresAt: string; purpose: CounterPurpose;
  payUrl: string | null; reused: boolean; transactionNo: string | null; paidAt: string | null;
}

/** Một dòng của hàng "VNPAY tại quầy đã thu, chưa ghi nhận" (GET /payments/counter-orders) — tiền đã vào, chưa thao tác nào dùng, chưa trả lại khách. */
export interface CounterOrderRow {
  txnRef: string; amount: number; purpose: CounterPurpose; facilityId: string; customerId: string | null; reservationId: string | null; contractId: string | null;
  openedBy: string | null; openedByName: string | null; createdAt: string; paidAt: string | null; transactionNo: string | null;
  /** Mã đặt chỗ / số hợp đồng / tên khách để nhân viên nhận ra lượt thu. */
  label: string;
  /** Lệnh đã nối với khách + đặt chỗ / hợp đồng: trả lại khách thì ghi sổ khoản hoàn chuyển khoản; không thì chỉ ghi chú đã hoàn ngoài hệ thống. */
  refundable: boolean;
}

/** Lựa chọn thu tại quầy gửi kèm thao tác: tiền mặt, hoặc VNPAY với mã lệnh đã PAID. */
export type CounterPaySelection = { payMethod: 'CASH' } | { payMethod: 'VNPAY'; gatewayTxnRef: string };

export type GatewayRefundAction = 'RETRY' | 'TO_BANK_TRANSFER' | 'MARK_DONE';

/** Mã giao dịch VNPAY của KhoAn: 'KA' + ObjectId. Trang kết quả kiểm bằng regex này trước khi gửi lên BE. */
export const GATEWAY_TXN_REF_RE = /^KA[0-9a-f]{24}$/;

/** Đợt VNPAY (Q2): báo mất thẻ / chìa có phí đi qua VNPAY — chưa trả xong thì việc khoá thẻ chưa được tạo. Màn gửi yêu cầu hiện câu này. */
export const LOST_KEY_URGENT_NOTE = 'Cần khoá gấp thẻ / chìa bị mất? Gọi ngay chi nhánh — yêu cầu qua mạng chỉ có hiệu lực sau khi trả phí.';
