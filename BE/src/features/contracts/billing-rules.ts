/**
 * Kỳ bắt đầu từ `start` đã được khách trả trước qua gia hạn (RENEWAL có paymentId) chưa.
 *
 * Gia hạn thu tiền ngay cho các kỳ sau `previousEndDate` và đẩy `endDate` ra xa; nếu job billing vẫn xuất
 * hoá đơn RENT cho đúng các kỳ đó thì khách bị thu hai lần. Gia hạn tự động (auto-renew) có paymentId = null
 * nên không tính là trả trước — kỳ đó vẫn phải xuất hoá đơn bình thường.
 */
export function coveredByPaidRenewal(
  renewals: readonly { previousEndDate: Date; newEndDate: Date; paymentId?: unknown }[],
  start: Date,
) {
  const t = start.getTime();
  return renewals.some((r) => !!r.paymentId && r.previousEndDate.getTime() <= t && t < r.newEndDate.getTime());
}

/**
 * Tiền thuê của kỳ bắt đầu từ `start`. Hợp đồng có các KỲ CAM KẾT (`commitments`): trong kỳ nào tính giá của kỳ đó (đã trừ ưu đãi
 * của chính kỳ đó); ngoài mọi kỳ cam kết — hết hạn mà không gia hạn — tính giá CHƯA ưu đãi của kỳ gần nhất, vì không còn cam kết
 * thì không còn ưu đãi. Hợp đồng cũ chưa có `commitments` giữ nguyên `billing.rate`.
 */
export function rentForPeriod(
  c: { billing: { rate: number }; commitments?: readonly { startDate: Date; endDate: Date; gross: number; rate: number }[] | null },
  start: Date,
): number {
  const list = c.commitments ?? [];
  if (!list.length) return c.billing.rate;
  const t = start.getTime();
  const seg = list.find((s) => s.startDate.getTime() <= t && t < s.endDate.getTime());
  if (seg) return seg.rate;
  return [...list].sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0].gross;
}
