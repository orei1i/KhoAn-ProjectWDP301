/**
 * Kiểm tra hàng hoá khi NHẬN KHO lần đầu (Điều 4): nhân viên xác nhận từng nhóm hàng cấm KHÔNG có trong số hàng khách mang vào
 * trước khi bàn giao — có hàng cấm thì không bàn giao. Một danh mục cho BE (kiểm đủ) và màn nhận kho.
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

/**
 * Dịch vụ thêm khách chọn KÈM lúc đặt kho: đơn riêng (ngoài hợp đồng thuê), chưa thanh toán — thu cùng lúc nhận kho.
 * Tổng tiền các đơn còn chờ thu của một đặt chỗ, để màn nhận kho / đặt chỗ hiện đúng số phải trả khi nhận kho.
 */
export const bookingServicesDue = (orders: readonly { reservationId?: unknown; status: string; paymentId?: unknown; total: number }[], reservationId: string) =>
  orders.filter((o) => String(o.reservationId ?? '') === reservationId && o.status === 'REQUESTED' && !o.paymentId).reduce((s, o) => s + o.total, 0);

/** Dịch vụ kèm lúc đặt (thùng, kệ, vận chuyển, đóng gói…) chỉ cho kho đủ lớn — tủ locker và phòng S không có. */
export const SERVICE_ELIGIBLE_CATEGORIES = ['MEDIUM', 'LARGE', 'XL'] as const;
export const servicesAllowedFor = (category: string) => (SERVICE_ELIGIBLE_CATEGORIES as readonly string[]).includes(category);

/** Giới hạn file hợp đồng giấy (bản scan) nhân viên tải lên khi khách ký tại quầy. */
export const PAPER_CONTRACT_MAX_BYTES = 5 * 1024 * 1024;
export const PAPER_CONTRACT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
