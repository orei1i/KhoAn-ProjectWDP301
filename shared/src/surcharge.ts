import type { BusinessPolicy, PriceQuote } from './entities';
import type { RentalPeriod } from './enums';
import { vnd } from './format';
import { planOf, PROTECTION_RULE_PREFIX, protectionFeePerPeriod } from './protection';

/**
 * Phụ phí phải GIẢI THÍCH được cho khách: tên gọi rõ ràng, tính theo cái gì, vì sao thu. Một nguồn cho báo giá
 * (web/app), lịch thanh toán và hợp đồng — không nơi nào chỉ ghi trơ trọi "Phụ phí".
 */
export interface SurchargeLine {
  code: string;
  label: string;
  /** Cách tính, VD "10% giá thuê". */
  basis: string;
  /** Lý do thu — câu giải thích cho khách. */
  reason: string;
  amount: number;
}

/** Nội dung giải thích theo mã phụ phí của chính sách. Mã lạ → dùng nhãn do Ops đặt + câu giải thích chung. */
export const SURCHARGE_INFO: Record<string, { label: string; reason: string }> = {
  CLIMATE: {
    label: 'Phụ phí điều hòa nhiệt độ',
    reason: 'Chi phí điện và vận hành máy lạnh trong ô kho. Chỉ tính khi bạn chọn "Có sử dụng điều hòa" — tắt thì không mất phí này.',
  },
};

type PolicySurcharge = Pick<BusinessPolicy['surcharges'][number], 'code' | 'label' | 'kind' | 'value'>;
type QuoteSurchargeInput = Pick<PriceQuote, 'rate' | 'surchargeAmount' | 'appliedRuleCodes'> & { rentalPeriod?: RentalPeriod };

/** Các dòng phụ phí đã áp dụng trong báo giá (rỗng nếu không có phụ phí). Tổng các dòng = `surchargeAmount`. */
export function surchargeLines(q: QuoteSurchargeInput, policySurcharges: readonly PolicySurcharge[] = []): SurchargeLine[] {
  if (!(q.surchargeAmount > 0)) return [];
  const applied = policySurcharges.filter((s) => q.appliedRuleCodes.includes(s.code));
  // Gói bảo vệ (Điều 6): phí gói tính theo kỳ thuê, đi cùng tiền thuê như phụ phí điều hoà nhưng không thuộc chính sách giá của chi nhánh.
  const planLines = q.appliedRuleCodes.filter((c) => c.startsWith(PROTECTION_RULE_PREFIX)).map((c): SurchargeLine => {
    const p = planOf(c.slice(PROTECTION_RULE_PREFIX.length));
    return {
      code: c, label: `Gói bảo vệ ${p.label}`, basis: `${vnd(p.monthlyFee)}/tháng`,
      reason: `Chi trả tối đa ${vnd(p.limit)} mỗi sự cố khi đồ bị thiệt hại do cháy nổ, lũ lụt, trộm có đột nhập hoặc va chạm, kể cả khi KhoAn không có lỗi (Điều 6). Chọn gói Cơ bản thì không mất phí này.`,
      amount: protectionFeePerPeriod(p.code, q.rentalPeriod ?? 'MONTH'),
    };
  });
  const lines = applied.map((s): SurchargeLine => {
    const info = SURCHARGE_INFO[s.code];
    return {
      code: s.code,
      label: info?.label ?? s.label,
      basis: s.kind === 'PERCENT' ? `${s.value}% giá thuê` : 'phí cố định',
      reason: info?.reason ?? 'Phụ phí theo chính sách giá của chi nhánh.',
      amount: s.kind === 'PERCENT' ? Math.round((q.rate * s.value) / 100) : s.value,
    };
  });
  const all = [...lines, ...planLines];
  // Không biết chính sách (hợp đồng cũ, báo giá đã lưu) → một dòng điều hòa với phần còn lại của tổng đã chốt (sau dòng gói bảo vệ).
  if (all.reduce((s, l) => s + l.amount, 0) !== q.surchargeAmount) {
    const rest = q.surchargeAmount - planLines.reduce((s, l) => s + l.amount, 0);
    return [...(rest > 0 ? [{ code: 'CLIMATE', label: SURCHARGE_INFO.CLIMATE.label, basis: '', reason: SURCHARGE_INFO.CLIMATE.reason, amount: rest }] : []), ...planLines];
  }
  return all;
}
