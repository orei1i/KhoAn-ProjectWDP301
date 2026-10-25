/**
 * Kiểu dữ liệu báo cáo (GET /reports/summary) dùng chung BE ↔ Webapp.
 * Doanh thu KHÔNG gồm tiền giữ chân (DEPOSIT) và khoản hoàn tiền giữ chân — tiền giữ chân là tiền của khách gửi giữ, báo riêng ở
 * `deposits` (đã thu / đã hoàn trong tháng).
 */
export interface RevenueMonthRow {
  /** "YYYY-MM" theo giờ VN. */
  month: string;
  /** Doanh thu thuần (thu − hoàn), không gồm tiền giữ chân. */
  total: number;
  byFacility: Record<string, number>;
  deposits: { collected: number; refunded: number };
}

export const REVENUE_LABEL = 'Doanh thu (không gồm tiền giữ chân)';
export const DEPOSITS_LABEL = 'Tiền giữ chân';
