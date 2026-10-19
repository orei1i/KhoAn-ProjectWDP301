import type { BusinessPolicy, PriceQuote } from './entities';

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
type QuoteSurchargeInput = Pick<PriceQuote, 'rate' | 'surchargeAmount' | 'appliedRuleCodes'>;

/** Các dòng phụ phí đã áp dụng trong báo giá (rỗng nếu không có phụ phí). Tổng các dòng = `surchargeAmount`. */
export function surchargeLines(q: QuoteSurchargeInput, policySurcharges: readonly PolicySurcharge[] = []): SurchargeLine[] {
  if (!(q.surchargeAmount > 0)) return [];
  const applied = policySurcharges.filter((s) => q.appliedRuleCodes.includes(s.code));
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
  // Không biết chính sách (hợp đồng cũ, báo giá đã lưu) → một dòng điều hòa với tổng đã chốt.
  if (lines.length === 0 || lines.reduce((s, l) => s + l.amount, 0) !== q.surchargeAmount) {
    return [{ code: 'CLIMATE', label: SURCHARGE_INFO.CLIMATE.label, basis: '', reason: SURCHARGE_INFO.CLIMATE.reason, amount: q.surchargeAmount }];
  }
  return lines;
}
