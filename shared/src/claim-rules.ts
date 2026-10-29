/**
 * Quy tắc bồi thường hư hỏng / mất mát — là ĐIỀU KHOẢN (Điều 6 Điều khoản thuê kho), không phải cấu hình vận hành. Dùng chung BE,
 * Webapp, app để mọi nơi tính cùng một mức. Mỗi hồ sơ chốt mức trách nhiệm vào chính nó lúc duyệt → đổi hằng số về sau không hồi tố.
 */

import { priceAt, type PricedSegment } from './duration';

/** Trần trách nhiệm một SỰ VỤ = số tháng này × tiền thuê MỘT THÁNG của ô kho theo hợp đồng. */
export const CLAIM_CAP_MONTHS = 10;
/** Điều 6: "tối đa mười lần tiền thuê một tháng của ô kho đó, hoặc giá trị thiệt hại thực tế — lấy giá trị nhỏ hơn". */
export const claimLiabilityCap = (monthlyRent: number) => CLAIM_CAP_MONTHS * Math.max(0, Math.round(monthlyRent));

/** Thời hạn gửi yêu cầu, tính từ ngày xảy ra sự cố. */
export const CLAIM_WINDOW_DAYS = 30;

/**
 * Quản lý chi nhánh chỉ quyết (duyệt, từ chối, mở lại) sự vụ có giá trị xét bồi thường — min(tổng khách yêu cầu của sự vụ, mức trách
 * nhiệm) — tới mức này; lớn hơn thì Quản lý vận hành quyết. Người duyệt không tự chi / tự xác nhận đã chuyển khoản, người lập hồ sơ hộ
 * khách không tự duyệt — mỗi khoản bồi thường luôn qua tay hai người.
 */
export const CLAIM_FM_APPROVAL_LIMIT = 5_000_000;

/** Tổng khách yêu cầu. Server luôn tự tính từ items — client gửi lên gì cũng bị ghi đè. */
export const claimTotal = (items: { quantity: number; unitValue: number }[]) =>
  items.reduce((sum, it) => sum + it.quantity * it.unitValue, 0);

type Iso = string | Date;
const iso = (d: Iso) => (typeof d === 'string' ? d : d.toISOString());

/**
 * Tiền thuê một tháng của ô kho THEO HỢP ĐỒNG: thuê tháng → giá (đã gồm phụ phí điều hoà, chưa trừ ưu đãi) của kỳ cam kết chứa
 * thời điểm sự cố (hoặc kỳ gần nhất); thuê ngày / tuần → giá tháng niêm yết của loại kho.
 */
export function monthlyRentOf(
  contract: { unitTypeId: unknown; billing: { rentalPeriod: string }; commitments?: readonly ({ startDate: Iso; endDate: Iso } & PricedSegment)[] | null },
  unitTypes: readonly { _id: unknown; rates: { MONTH: number } }[],
  at?: Iso | null,
): number | null {
  const segs = contract.commitments ?? [];
  if (contract.billing.rentalPeriod === 'MONTH' && segs.length) {
    const t = at ? iso(at) : null;
    const seg = (t && segs.find((s) => iso(s.startDate) <= t && t < iso(s.endDate))) || segs[segs.length - 1];
    // Đợt 15 (C3): đã đổi cỡ kho thì theo giá của loại kho tại thời điểm sự cố (trước / sau ngày đổi).
    return priceAt(seg, t ?? '9999-12-31T00:00:00.000Z').gross;
  }
  const ut = unitTypes.find((x) => String(x._id) === String(contract.unitTypeId));
  return ut ? ut.rates.MONTH : null;
}

/** Mức trách nhiệm của hợp đồng cho một sự cố — cùng công thức ở server lúc duyệt và ở màn hình. */
export function claimCapOf(
  contract: Parameters<typeof monthlyRentOf>[0] | null | undefined,
  unitTypes: Parameters<typeof monthlyRentOf>[1],
  at?: Iso | null,
): number | null {
  const m = contract ? monthlyRentOf(contract, unitTypes, at) : null;
  return m === null ? null : claimLiabilityCap(m);
}

/** Ngày (giờ Việt Nam) của thời điểm sự cố — các hồ sơ cùng hợp đồng, cùng ngày sự cố (hoặc cùng phiếu sự cố) là MỘT sự vụ. */
const incidentDay = (d: Iso) => new Date(new Date(d).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
export const sameIncident = (
  a: { contractId: unknown; incidentAt: Iso; ticketId?: unknown },
  b: { contractId: unknown; incidentAt: Iso; ticketId?: unknown },
) => String(a.contractId) === String(b.contractId)
  && ((!!a.ticketId && String(a.ticketId) === String(b.ticketId)) || incidentDay(a.incidentAt) === incidentDay(b.incidentAt));

/** Hồ sơ còn được tính vào sự vụ (chưa bị từ chối / khách rút). */
export const CLAIM_COUNTED_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID'] as const;

/** Sự vụ có giá trị xét bồi thường vượt hạn mức quản lý chi nhánh → chỉ Quản lý vận hành quyết. */
export const claimNeedsOps = (incidentClaimedTotal: number, cap: number) => Math.min(incidentClaimedTotal, cap) > CLAIM_FM_APPROVAL_LIMIT;

/**
 * Đợt 15 (A2): mốc HẾT GIỮ ĐỒ của hợp đồng ('YYYY-MM-DD', ngày VN) — ngày khách bàn giao lại kho (`moveOut.returnedOn`), không có thì ngày
 * thu hồi quyền ra vào, không có nữa thì ngày đóng hợp đồng. null = còn đang thuê. Sự cố sau mốc này → 422 INCIDENT_AFTER_RETURN; ô chọn
 * ngày sự cố giới hạn tối đa min(hôm nay, mốc).
 */
export function claimHoldEnd(c: { moveOut?: { returnedOn?: Iso | null } | null; access?: { revokedAt?: Iso | null } | null; closedAt?: Iso | null }): string | null {
  if (c.moveOut?.returnedOn) return iso(c.moveOut.returnedOn).slice(0, 10);
  if (c.access?.revokedAt) return incidentDay(c.access.revokedAt);
  if (c.closedAt) return incidentDay(c.closedAt);
  return null;
}
