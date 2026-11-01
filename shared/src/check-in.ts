import { dueAtBooking } from './payment-schedule';

/**
 * Kiểm tra hàng cấm (Điều 4): nhân viên xác nhận từng nhóm hàng cấm KHÔNG có trong số hàng khách mang vào. Từ đợt 14 kiểm ở mỗi ĐỢT
 * NHẬP HÀNG (POST /intake-batches/:id/confirm — thiếu mục → 422 GOODS_CHECK_REQUIRED; có hàng cấm thì từ chối đợt đó), không còn bắt
 * buộc lúc nhận kho (check-in vẫn nhận `goodsCheck` nếu gửi, để tương thích). Một danh mục cho BE (kiểm đủ) và các màn hình.
 */
export const INTAKE_CHECK_ITEMS = [
  { key: 'ILLEGAL', label: 'Không có ma tuý, vũ khí, hàng cấm, hàng giả, hàng không rõ nguồn gốc' },
  { key: 'HAZARDOUS', label: 'Không có chất dễ cháy nổ, hoá chất độc hại, khí nén, pin lithium hỏng' },
  { key: 'LIVING', label: 'Không có người, động vật sống, cây trồng' },
  { key: 'PERISHABLE', label: 'Không có thực phẩm tươi sống, rác thải, chất thải y tế' },
  { key: 'VALUABLES', label: 'Không có tiền mặt, kim loại quý, đá quý, giấy tờ gốc chưa khai báo' },
] as const;
export type IntakeCheckKey = (typeof INTAKE_CHECK_ITEMS)[number]['key'];

/** Kết quả kiểm tra hàng lúc nhận kho, lưu trên hợp đồng. */
export interface IntakeCheck<I = string, D = string> {
  checkedAt: D;
  checkedBy: I;
  items: IntakeCheckKey[];
  note?: string | null;
  photoUrls?: string[];
}

type BookingOrderLike = { reservationId?: unknown; status: string; paymentId?: unknown; total: number };

/**
 * Dịch vụ thêm khách chọn KÈM lúc đặt kho: đơn riêng (ngoài hợp đồng thuê).
 * Tổng tiền các đơn CHƯA trả của một đặt chỗ. Đặt online trả ngay: trả cùng tiền giữ chân (payDeposit). Trả khi nhận kho / trả tại quầy / đặt tại quầy: thu khi nhận kho.
 */
export const bookingServicesDue = (orders: readonly BookingOrderLike[], reservationId: string) =>
  orders.filter((o) => String(o.reservationId ?? '') === reservationId && o.status === 'REQUESTED' && !o.paymentId).reduce((s, o) => s + o.total, 0);

/** Tổng tiền các đơn kèm ĐÃ trả, chưa thực hiện của một đặt chỗ: huỷ đặt chỗ thì hoàn đủ khoản này, nhận kho không thu lại. */
export const bookingServicesPaid = (orders: readonly BookingOrderLike[], reservationId: string) =>
  orders.filter((o) => String(o.reservationId ?? '') === reservationId && o.status === 'REQUESTED' && !!o.paymentId).reduce((s, o) => s + o.total, 0);

/** Đặt chỗ này trả dịch vụ kèm cùng tiền giữ chân không. `payAtCounter` gồm cả "trả khi nhận kho", kể cả khi khách trả online trước: dịch vụ vẫn thu tại quầy. */
export const servicesPaidWithDeposit = (r: { payAtCounter?: boolean | null }) => !r.payAtCounter;

/** Số tiền của lần trả online tiền giữ chân: khoản lúc đặt + dịch vụ kèm chưa trả (nếu đặt chỗ này trả dịch vụ cùng lúc). Cùng công thức với payDeposit. */
export const depositPayNow = (r: { _id: string; payAtCounter?: boolean | null; quote: Parameters<typeof dueAtBooking>[0] }, orders: readonly BookingOrderLike[]) =>
  dueAtBooking(r.quote) + (servicesPaidWithDeposit(r) ? bookingServicesDue(orders, r._id) : 0);

/** Dịch vụ chuyển đồ: mã bắt đầu bằng MOVE. Xác nhận hoàn thành phải ghi người thực hiện. */
export const isMoveService = (code?: string | null) => /^MOVE/i.test(code ?? '');

/** Người thực hiện chuyển đồ: chữ tự do, được nhiều người, 2–200 ký tự sau khi bỏ khoảng trắng thừa. */
export const PERFORMED_BY_MIN = 2;
export const PERFORMED_BY_MAX = 200;
export const PERFORMED_BY_MESSAGE = `Nhập người thực hiện chuyển đồ (${PERFORMED_BY_MIN}–${PERFORMED_BY_MAX} ký tự, được ghi nhiều người)`;
export const normalizePerformedBy = (v?: string | null) => (v ?? '').trim().replace(/\s+/g, ' ');
export const isValidPerformedBy = (v?: string | null) => {
  const n = normalizePerformedBy(v).length;
  return n >= PERFORMED_BY_MIN && n <= PERFORMED_BY_MAX;
};

/** Phí đổi ô còn phải trả TRƯỚC khi chuyển: DELIVERY có phí, duyệt từ khi có cờ `feePrepay`. Yêu cầu cũ không có cờ giữ hành vi cũ (thành công nợ lúc hoàn tất). */
export const swapFeeDue = (s: { status: string; feePrepay?: boolean | null; fee?: number | null; paymentId?: unknown }) =>
  (s.status === 'APPROVED' && !!s.feePrepay && !s.paymentId ? s.fee ?? 0 : 0);

/** Dịch vụ kèm lúc đặt (thùng, kệ, vận chuyển, đóng gói…) chỉ cho kho đủ lớn — tủ locker và phòng S không có. */
export const SERVICE_ELIGIBLE_CATEGORIES = ['MEDIUM', 'LARGE', 'XL'] as const;
export const servicesAllowedFor = (category: string) => (SERVICE_ELIGIBLE_CATEGORIES as readonly string[]).includes(category);

/** Giới hạn file hợp đồng giấy (bản scan) nhân viên tải lên khi khách ký tại quầy. */
export const PAPER_CONTRACT_MAX_BYTES = 5 * 1024 * 1024;
export const PAPER_CONTRACT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
