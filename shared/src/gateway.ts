import type { GatewayOrderKind, GatewayOrderStatus, GatewayRefundState, PaymentMethod } from './enums';

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
}

export type GatewayRefundAction = 'RETRY' | 'TO_BANK_TRANSFER' | 'MARK_DONE';

/** Mã giao dịch VNPAY của KhoAn: 'KA' + ObjectId. Trang kết quả kiểm bằng regex này trước khi gửi lên BE. */
export const GATEWAY_TXN_REF_RE = /^KA[0-9a-f]{24}$/;

/** Đợt VNPAY (Q2): báo mất thẻ / chìa có phí đi qua VNPAY — chưa trả xong thì việc khoá thẻ chưa được tạo. Màn gửi yêu cầu hiện câu này. */
export const LOST_KEY_URGENT_NOTE = 'Cần khoá gấp thẻ / chìa bị mất? Gọi ngay chi nhánh — yêu cầu qua mạng chỉ có hiệu lực sau khi thanh toán phí xong.';
