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
  perM3?: number | null;
}
export type ProtectionPlanTable = Record<ProtectionPlanCode, ProtectionPlan>;
/** Điều khoản gói CHỐT vào đặt chỗ / hợp đồng (phí tháng, mức chi trả) — chính sách đổi về sau không áp lại cho hợp đồng đã ký. */
export interface ProtectionTerms { monthlyFee: number; limit: number; perM3?: number | null }
/** Một dòng gói trong chính sách giá (BusinessPolicy.protectionPlans) — Quản lý vận hành chỉnh và phát hành theo phiên bản. */
export interface ProtectionPlanRow extends ProtectionTerms { code: ProtectionPlanCode }

/** Bảng gói MẶC ĐỊNH (Điều khoản 1.20) — dùng khi chính sách chưa có `protectionPlans` và cho hợp đồng ký trước khi gói theo chính sách. */
export const PROTECTION_PLANS: ProtectionPlanTable = {
  BASIC: { code: 'BASIC', label: 'Cơ bản', monthlyFee: 0, limit: 10_000_000, perM3: 500_000 },
  SILVER: { code: 'SILVER', label: 'Bạc', monthlyFee: 50_000, limit: 25_000_000 },
  GOLD: { code: 'GOLD', label: 'Vàng', monthlyFee: 100_000, limit: 50_000_000 },
  PLATINUM: { code: 'PLATINUM', label: 'Bạch kim', monthlyFee: 200_000, limit: 100_000_000 },
};
/** Các dòng gói mặc định dạng lưu trong chính sách. */
export const DEFAULT_PROTECTION_PLAN_ROWS: ProtectionPlanRow[] = PROTECTION_PLAN_CODES.map((code) => {
  const p = PROTECTION_PLANS[code];
  return { code, monthlyFee: p.monthlyFee, limit: p.limit, perM3: p.perM3 ?? null };
});

export const isProtectionPlan = (v: unknown): v is ProtectionPlanCode => typeof v === 'string' && v in PROTECTION_PLANS;

/**
 * Bảng gói của MỘT chính sách giá: dòng chính sách đã khai (Quản lý vận hành phát hành), thiếu thì lấy mặc định. Tên gói cố định.
 * Gói Cơ bản luôn miễn phí (khách nào cũng có gói này) — chính sách chỉ đổi được mức theo m³ và mức tối đa.
 */
export function protectionPlansOf(policy?: { protectionPlans?: readonly Partial<ProtectionPlanRow>[] | null } | null): ProtectionPlanTable {
  const out = { ...PROTECTION_PLANS };
  for (const code of PROTECTION_PLAN_CODES) {
    const row = policy?.protectionPlans?.find((r) => r.code === code);
    if (!row) continue;
    const base = PROTECTION_PLANS[code];
    out[code] = {
      ...base,
      monthlyFee: code === 'BASIC' ? 0 : Math.max(0, Math.round(row.monthlyFee ?? base.monthlyFee)),
      limit: Math.max(0, Math.round(row.limit ?? base.limit)),
      perM3: code === 'BASIC' ? Math.max(0, Math.round(row.perM3 ?? base.perM3 ?? 0)) : null,
    };
  }
  return out;
}

/** Gói theo mã trong một bảng gói (mặc định: bảng mặc định) — mã lạ / thiếu (dữ liệu cũ chưa chọn gói) = Cơ bản. */
export const planOf = (code?: string | null, table: ProtectionPlanTable = PROTECTION_PLANS): ProtectionPlan =>
  table[isProtectionPlan(code) ? code : DEFAULT_PROTECTION_PLAN];

/** Điều khoản gói lưu vào đặt chỗ / hợp đồng. */
export const protectionTermsOfPlan = (p: ProtectionPlan): ProtectionTerms => ({ monthlyFee: p.monthlyFee, limit: p.limit, perM3: p.perM3 ?? null });

/**
 * Gói ĐÃ CHỐT của một đặt chỗ / hợp đồng: mã gói + điều khoản đã lưu (phí, mức chi trả). Hợp đồng ký trước khi gói theo chính sách
 * (chưa có `protectionTerms`) dùng bảng mặc định — đúng mức khách đã đồng ý ở Điều khoản 1.20.
 */
export function contractPlanOf(c?: { protectionPlan?: string | null; protectionTerms?: ProtectionTerms | null } | null): ProtectionPlan {
  const base = planOf(c?.protectionPlan);
  const t = c?.protectionTerms;
  return t ? { ...base, monthlyFee: t.monthlyFee, limit: t.limit, perM3: base.code === 'BASIC' ? (t.perM3 ?? base.perM3 ?? null) : null } : base;
}

/** Gói theo mã (tra bảng) hoặc gói đã có sẵn (VD gói đã chốt của hợp đồng). */
type PlanRef = string | null | undefined | ProtectionPlan;
const resolvePlan = (ref: PlanRef, table?: ProtectionPlanTable): ProtectionPlan =>
  ref && typeof ref === 'object' ? ref : planOf(ref, table);

/** Thể tích ô (m³) theo kích thước loại kho, làm tròn 0,1 m³. */
export const unitVolumeM3 = (d?: { widthM: number; depthM: number; heightM: number } | null) =>
  d ? Math.round(d.widthM * d.depthM * d.heightM * 10) / 10 : 0;

/** Mức chi trả tối đa MỖI SỰ CỐ của gói cho một ô có thể tích `volumeM3`. */
export function protectionLimitOf(ref: PlanRef, volumeM3: number, table?: ProtectionPlanTable): number {
  const p = resolvePlan(ref, table);
  return p.perM3 ? Math.min(p.limit, Math.round(p.perM3 * Math.max(0, volumeM3))) : p.limit;
}

/** Số kỳ thuê trong một tháng (năm 365 ngày) — quy đổi phí tháng của gói sang phí mỗi ngày / tuần. */
const PERIODS_IN_MONTH: Record<RentalPeriod, number> = { DAY: 365 / 12, WEEK: 365 / 12 / 7, MONTH: 1 };
/** Phí gói cho MỘT kỳ thuê: thuê tháng = phí tháng; thuê ngày / tuần quy đổi theo số ngày. */
export const protectionFeePerPeriod = (ref: PlanRef, period: RentalPeriod, table?: ProtectionPlanTable) =>
  Math.round(resolvePlan(ref, table).monthlyFee / (PERIODS_IN_MONTH[period] ?? 1));

/** Mã dòng phụ phí của gói trong báo giá (`quote.appliedRuleCodes`), VD "PROTECT_SILVER". Gói miễn phí không có dòng. */
export const PROTECTION_RULE_PREFIX = 'PROTECT_';
export const protectionRuleCode = (code: ProtectionPlanCode) => `${PROTECTION_RULE_PREFIX}${code}`;
/** Gói đọc từ mã phụ phí của báo giá (không có dòng gói = Cơ bản). */
export const planFromRuleCodes = (codes?: readonly string[] | null): ProtectionPlanCode => {
  const hit = codes?.find((c) => c.startsWith(PROTECTION_RULE_PREFIX))?.slice(PROTECTION_RULE_PREFIX.length);
  return isProtectionPlan(hit) ? hit : DEFAULT_PROTECTION_PLAN;
};

/** Phí gói hiển thị: "Miễn phí" hoặc "50.000 ₫/tháng". */
export const protectionFeeText = (ref: PlanRef, table?: ProtectionPlanTable) => {
  const fee = resolvePlan(ref, table).monthlyFee;
  return fee > 0 ? `${vnd(fee)}/tháng` : 'Miễn phí';
};
/** Số tiền gọn cho dòng chữ nhỏ: 25.000.000 → "25 triệu", 2.500.000 → "2,5 triệu"; dưới 1 triệu hoặc số lẻ giữ dạng "600.000 ₫". */
export const moneyShort = (n: number) =>
  n >= 1_000_000 && n % 100_000 === 0 ? `${String(n / 1_000_000).replace('.', ',')} triệu` : vnd(n);
/** Mức chi trả gọn: "tối đa 25 triệu"; gói Cơ bản chưa biết thể tích ô thì "500.000 ₫/m³, tối đa 10 triệu". */
export function protectionLimitShort(ref: PlanRef, volumeM3?: number | null, table?: ProtectionPlanTable): string {
  const p = resolvePlan(ref, table);
  if (p.perM3 && !volumeM3) return `${moneyShort(p.perM3)}/m³, tối đa ${moneyShort(p.limit)}`;
  return `tối đa ${moneyShort(protectionLimitOf(p, volumeM3 ?? 0))}`;
}
/** Một dòng tóm tắt gói, VD "Gói Bạc · 50.000 ₫/tháng · tối đa 25 triệu/sự cố". */
export const protectionPlanLine = (ref: PlanRef, volumeM3?: number | null, table?: ProtectionPlanTable) => {
  const p = resolvePlan(ref, table);
  return `Gói ${p.label} · ${protectionFeeText(p).toLowerCase()} · ${protectionLimitShort(p, volumeM3)}/sự cố`;
};

/** Kiểm bảng gói trước khi phát hành chính sách: đủ 4 gói, mức chi trả > 0, gói Cơ bản có mức theo m³. Trả câu lỗi đầu tiên hoặc null. */
export function protectionRowsError(rows: readonly ProtectionPlanRow[]): string | null {
  for (const code of PROTECTION_PLAN_CODES) {
    const r = rows.find((x) => x.code === code);
    const name = PROTECTION_PLANS[code].label;
    if (!r) return `Thiếu gói ${name}`;
    if (!(r.limit > 0)) return `Mức chi trả tối đa của gói ${name} phải lớn hơn 0`;
    if (code === 'BASIC' && !((r.perM3 ?? 0) > 0)) return 'Gói Cơ bản cần mức chi trả theo m³ lớn hơn 0';
    if (code !== 'BASIC' && !(r.monthlyFee > 0)) return `Phí tháng của gói ${name} phải lớn hơn 0 (chỉ gói Cơ bản miễn phí)`;
  }
  return null;
}

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
  FACILITY_FAULT: { label: 'Lỗi của kho', hint: 'Kho dột, khoá hỏng, nhân viên làm hư đồ', basis: 'FAULT' },
  FIRE: { label: 'Cháy, nổ, sét đánh', hint: 'Cháy lan, chập điện, sét đánh', basis: 'PLAN' },
  FLOOD: { label: 'Lũ lụt, bão, ngập nước', hint: 'Mưa bão, nước tràn vào kho', basis: 'PLAN' },
  BURGLARY: { label: 'Trộm, cướp, phá hoại có đột nhập', hint: 'Phải có dấu hiệu phá khoá', basis: 'PLAN' },
  IMPACT: { label: 'Xe đâm, vật rơi', hint: 'Xe cộ, vật rơi va vào kho', basis: 'PLAN' },
};
export const isClaimCause = (v: unknown): v is ClaimCause => typeof v === 'string' && v in CLAIM_CAUSE;
/** Nguyên nhân của hồ sơ — hồ sơ cũ chưa có = lỗi của kho (cách xét trước đây). */
export const causeOf = (c?: string | null): ClaimCause => (isClaimCause(c) ? c : DEFAULT_CLAIM_CAUSE);
export const isPlanCause = (c?: string | null) => CLAIM_CAUSE[causeOf(c)].basis === 'PLAN';
