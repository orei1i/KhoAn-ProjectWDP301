'use client';

import { CLAIM_CAUSE, CLAIM_CAUSES, CLAIM_FAULT_CAP_LABEL, SPECIFIC_CLAIM_CAUSES, causeOf, planOf, type ClaimCause, type DamageClaim, type RentalContract } from '@ssm/shared';
import { inputCls } from '@/shared/ui';

/** Mức xét của một nguyên nhân, ghi kèm trong danh sách chọn: lỗi kho 10 lần tiền thuê, rủi ro nêu tên theo gói, "Khác" chi nhánh xác định. */
const causeCapHint = (c: ClaimCause) => {
  const basis = CLAIM_CAUSE[c].basis;
  return basis === 'PLAN' ? 'theo gói' : basis === 'FAULT' ? CLAIM_FAULT_CAP_LABEL : 'chi nhánh xác định mức';
};

/**
 * Chọn nguyên nhân sự cố (gói bảo vệ — Điều 6): lỗi của kho → trần 10 lần tiền thuê 1 tháng; rủi ro nêu tên → mức gói của hợp đồng;
 * "Khác" → chưa có mức, chi nhánh xác định. Form lập hồ sơ truyền `value = ''` để KHÔNG chọn sẵn (góp ý mục 4 #20) — người lập phải chọn.
 * `reviewer`: người duyệt chỉ chọn 5 nguyên nhân cụ thể (không đổi sang "Khác"); hồ sơ đang là "Khác" hiện một dòng nhắc chọn lại.
 */
export function ClaimCauseSelect<V extends ClaimCause | ''>({ value, onChange, id, reviewer }: { value: V; onChange: (v: ClaimCause) => void; id?: string; reviewer?: boolean }) {
  const options: readonly ClaimCause[] = reviewer ? SPECIFIC_CLAIM_CAUSES : CLAIM_CAUSES;
  return (
    <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value as ClaimCause)}>
      {value === '' && <option value="" disabled>— Chọn nguyên nhân —</option>}
      {reviewer && value === 'OTHER' && <option value="OTHER" disabled>{CLAIM_CAUSE.OTHER.label} — chọn 1 trong 5 nguyên nhân cụ thể</option>}
      {options.map((c) => <option key={c} value={c}>{CLAIM_CAUSE[c].label} ({causeCapHint(c)})</option>)}
    </select>
  );
}

/** Một dòng cho người duyệt: nguyên nhân khách chọn + gói bảo vệ của hợp đồng. */
export function claimCauseLine(x: Pick<DamageClaim, 'cause'>, contract?: Pick<RentalContract, 'protectionPlan'> | null) {
  return `${CLAIM_CAUSE[causeOf(x.cause)].label} · gói ${planOf(contract?.protectionPlan).label}`;
}
