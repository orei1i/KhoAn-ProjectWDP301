/**
 * Gói bảo vệ đồ gửi (Điều 6, bản 1.20) — tham khảo cách các công ty kho tự quản làm (VD MyStorage): khách chọn gói khi đặt kho.
 *  - Gói chi trả khi đồ bị thiệt hại do RỦI RO NÊU TÊN (cháy nổ, lũ lụt, trộm có đột nhập, va chạm) — kể cả khi KhoAn không có lỗi; mức
 *    tối đa mỗi sự cố theo gói. Gói Cơ bản miễn phí, tính theo thể tích ô (500.000 ₫ mỗi m³, không quá 10.000.000 ₫).
 *  - Lỗi trực tiếp của KhoAn vẫn theo trần Điều 6: 10 lần tiền thuê một tháng của ô kho (claimCapOf) — không phụ thuộc gói.
 * Gói do KhoAn tự chi trả, không phải bảo hiểm; phí gói là phí dịch vụ hằng tháng, đi cùng tiền thuê mỗi kỳ như phụ phí điều hoà.
 * Dùng chung BE / Webapp / app để báo giá, hợp đồng và mức xét bồi thường khớp nhau.
 */
import type { RentalPeriod } from './enums';
import { vnd } from './format';

export const PROTECTION_PLAN_CODES = ['BASIC', 'SILVER', 'GOLD', 'PLATINUM'] as const;
export type ProtectionPlanCode = (typeof PROTECTION_PLAN_CODES)[number];
export const DEFAULT_PROTECTION_PLAN: ProtectionPlanCode = 'BASIC';

export interface ProtectionPlan {
  code: ProtectionPlanCode;
  label: string;
  /** Phí mỗi tháng (VND). 0 = miễn phí. */
  monthlyFee: number;
  /** Mức chi trả tối đa mỗi sự cố (VND). */
  limit: number;
  /** Chỉ gói Cơ bản: chi trả theo thể tích ô — số tiền mỗi m³, không quá `limit`. */
  perM3?: number;
}

export const PROTECTION_PLANS: Record<ProtectionPlanCode, ProtectionPlan> = {
  BASIC: { code: 'BASIC', label: 'Cơ bản', monthlyFee: 0, limit: 10_000_000, perM3: 500_000 },
  SILVER: { code: 'SILVER', label: 'Bạc', monthlyFee: 50_000, limit: 25_000_000 },
  GOLD: { code: 'GOLD', label: 'Vàng', monthlyFee: 100_000, limit: 50_000_000 },
  PLATINUM: { code: 'PLATINUM', label: 'Bạch kim', monthlyFee: 200_000, limit: 100_000_000 },
};

export const isProtectionPlan = (v: unknown): v is ProtectionPlanCode => typeof v === 'string' && v in PROTECTION_PLANS;
/** Gói của đặt chỗ / hợp đồng — dữ liệu cũ chưa chọn gói = Cơ bản. */
export const planOf = (code?: string | null): ProtectionPlan => (isProtectionPlan(code) ? PROTECTION_PLANS[code] : PROTECTION_PLANS[DEFAULT_PROTECTION_PLAN]);

/** Thể tích ô (m³) theo kích thước loại kho, làm tròn 0,1 m³. */
export const unitVolumeM3 = (d?: { widthM: number; depthM: number; heightM: number } | null) =>
  d ? Math.round(d.widthM * d.depthM * d.heightM * 10) / 10 : 0;

/** Mức chi trả tối đa MỖI SỰ CỐ của gói cho một ô có thể tích `volumeM3`. */
export function protectionLimitOf(code: string | null | undefined, volumeM3: number): number {
  const p = planOf(code);
  return p.perM3 ? Math.min(p.limit, Math.round(p.perM3 * Math.max(0, volumeM3))) : p.limit;
}

/** Số kỳ thuê trong một tháng (năm 365 ngày) — quy đổi phí tháng của gói sang phí mỗi ngày / tuần. */
const PERIODS_IN_MONTH: Record<RentalPeriod, number> = { DAY: 365 / 12, WEEK: 365 / 12 / 7, MONTH: 1 };
/** Phí gói cho MỘT kỳ thuê: thuê tháng = phí tháng; thuê ngày / tuần quy đổi theo số ngày. */
export const protectionFeePerPeriod = (code: string | null | undefined, period: RentalPeriod) =>
  Math.round(planOf(code).monthlyFee / (PERIODS_IN_MONTH[period] ?? 1));

/** Mã dòng phụ phí của gói trong báo giá (`quote.appliedRuleCodes`), VD "PROTECT_SILVER". Gói miễn phí không có dòng. */
export const PROTECTION_RULE_PREFIX = 'PROTECT_';
export const protectionRuleCode = (code: ProtectionPlanCode) => `${PROTECTION_RULE_PREFIX}${code}`;
/** Gói đọc từ mã phụ phí của báo giá (không có dòng gói = Cơ bản). */
export const planFromRuleCodes = (codes?: readonly string[] | null): ProtectionPlanCode => {
  const hit = codes?.find((c) => c.startsWith(PROTECTION_RULE_PREFIX))?.slice(PROTECTION_RULE_PREFIX.length);
  return isProtectionPlan(hit) ? hit : DEFAULT_PROTECTION_PLAN;
};

/** Phí gói hiển thị: "Miễn phí" hoặc "50.000 ₫/tháng". */
export const protectionFeeText = (code: string | null | undefined) => {
  const fee = planOf(code).monthlyFee;
  return fee > 0 ? `${vnd(fee)}/tháng` : 'Miễn phí';
};
/** Mức chi trả hiển thị: gói Cơ bản ghi cách tính theo m³; có thể tích ô thì ghi luôn số tiền của ô đó. */
export function protectionLimitText(code: string | null | undefined, volumeM3?: number | null): string {
  const p = planOf(code);
  if (!p.perM3) return `tối đa ${vnd(p.limit)} mỗi sự cố`;
  const base = `${vnd(p.perM3)} mỗi m³, tối đa ${vnd(p.limit)} mỗi sự cố`;
  return volumeM3 ? `${base} — ô ${volumeM3.toLocaleString('vi-VN')} m³: tối đa ${vnd(protectionLimitOf(p.code, volumeM3))}` : base;
}
/** Một dòng tóm tắt gói, VD "Gói Bạc · 50.000 ₫/tháng · tối đa 25.000.000 ₫ mỗi sự cố". */
export const protectionPlanLine = (code: string | null | undefined, volumeM3?: number | null) =>
  `Gói ${planOf(code).label} · ${protectionFeeText(code)} · ${protectionLimitText(code, volumeM3)}`;

/** Rủi ro gói chi trả (không cần KhoAn có lỗi). */
export const PROTECTION_PERILS: readonly string[] = [
  'Cháy, nổ, sét đánh',
  'Lũ lụt, bão, ngập nước',
  'Trộm, cướp, phá hoại có dấu hiệu đột nhập hoặc dùng vũ lực',
  'Xe cộ đâm vào kho, vật rơi từ trên cao',
];

/** Không chi trả — cả theo gói lẫn theo trách nhiệm của KhoAn. */
export const PROTECTION_EXCLUSIONS: readonly string[] = [
  'Hao mòn, hư hỏng tự nhiên, ẩm mốc, gỉ sét, côn trùng, chuột',
  'Thay đổi nhiệt độ, độ ẩm; hỏng hóc điện, điện tử, cơ khí của đồ',
  'Đồ bị vỡ, trầy, móp do khách đóng gói hoặc sắp xếp không đúng cách',
  'Tiền mặt, vàng bạc, đá quý, trang sức, giấy tờ có giá',
  'Hàng cấm tại Điều 4 (thực phẩm, chất lỏng, chất dễ cháy…)',
  'Chiến tranh, bạo loạn, đình công; tài sản bị cơ quan nhà nước thu giữ',
  'Thiệt hại gián tiếp (mất thu nhập, lỡ việc…)',
];

/** Nguyên nhân sự cố khách chọn khi gửi hồ sơ bồi thường; người duyệt xác minh và sửa được trước khi quyết định. */
export const CLAIM_CAUSES = ['FACILITY_FAULT', 'FIRE', 'FLOOD', 'BURGLARY', 'IMPACT'] as const;
export type ClaimCause = (typeof CLAIM_CAUSES)[number];
export const DEFAULT_CLAIM_CAUSE: ClaimCause = 'FACILITY_FAULT';
/** `basis`: FAULT = trách nhiệm của KhoAn (trần 10 lần tiền thuê); PLAN = gói bảo vệ của hợp đồng. */
export const CLAIM_CAUSE: Record<ClaimCause, { label: string; hint: string; basis: 'FAULT' | 'PLAN' }> = {
  FACILITY_FAULT: { label: 'Lỗi của kho', hint: 'Nhân viên làm hư đồ, kho dột, khoá hỏng, người KhoAn cử chuyển đồ khi đổi ô…', basis: 'FAULT' },
  FIRE: { label: 'Cháy, nổ, sét đánh', hint: 'Cháy lan từ khu khác, chập điện toà nhà, sét đánh', basis: 'PLAN' },
  FLOOD: { label: 'Lũ lụt, bão, ngập nước', hint: 'Mưa bão, nước ngập tràn vào khu kho', basis: 'PLAN' },
  BURGLARY: { label: 'Trộm, cướp, phá hoại có đột nhập', hint: 'Phải có dấu hiệu phá khoá, đột nhập hoặc dùng vũ lực', basis: 'PLAN' },
  IMPACT: { label: 'Xe đâm, vật rơi', hint: 'Xe cộ đâm vào kho, vật rơi từ trên cao', basis: 'PLAN' },
};
export const isClaimCause = (v: unknown): v is ClaimCause => typeof v === 'string' && v in CLAIM_CAUSE;
/** Nguyên nhân của hồ sơ — hồ sơ cũ chưa có = lỗi của kho (cách xét trước đây). */
export const causeOf = (c?: string | null): ClaimCause => (isClaimCause(c) ? c : DEFAULT_CLAIM_CAUSE);
export const isPlanCause = (c?: string | null) => CLAIM_CAUSE[causeOf(c)].basis === 'PLAN';
