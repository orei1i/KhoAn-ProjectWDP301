import { addPeriodsUTC } from '../../shared/utils/dates';

/**
 * Ngày thu kỳ kế tiếp sau kỳ bắt đầu `start`, tính từ MỐC GỐC (ngày nhận kho `anchor`), không cộng nối từ kỳ trước. Nhận kho 31/01
 * thì các kỳ là 28/02, 31/03, 30/04… — cộng nối thì sau tháng 2 sẽ trôi về ngày 28 mãi, khách bị thu thêm một kỳ trước khi hết thời
 * hạn (endDate vẫn là 30/04). Dữ liệu cũ đã trôi cũng tự về đúng mốc ở kỳ kế tiếp.
 */
export function nextBillingAfter(anchor: Date, period: 'DAY' | 'WEEK' | 'MONTH', start: Date): Date {
  let k = 1;
  while (addPeriodsUTC(anchor, period, k) <= start) k++;
  return addPeriodsUTC(anchor, period, k);
}

// Kỳ đã trả trước khi gia hạn / giá của một kỳ theo kỳ cam kết: quy tắc thuần, chuyển sang @ssm/shared để cổng khách (web + app) hiện
// đúng số job sẽ thu. Giữ export ở đây để job và các nơi đang import từ file này không phải đổi.
export { coveredByPaidRenewal, rentForPeriod } from '@ssm/shared';
