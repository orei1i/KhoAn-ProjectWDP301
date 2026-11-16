'use client';

import { CLAIM_CAUSE, CLAIM_CAUSES, CLAIM_FAULT_CAP_LABEL, causeOf, planOf, type ClaimCause, type DamageClaim, type RentalContract } from '@ssm/shared';
import { inputCls } from '@/shared/ui';

/**
 * Chọn nguyên nhân sự cố (gói bảo vệ — Điều 6): lỗi của kho → trần 10 lần tiền thuê 1 tháng; rủi ro nêu tên → mức gói của hợp đồng.
 * Form lập hồ sơ truyền `value = ''` để KHÔNG chọn sẵn (góp ý mục 4 #20) — người lập phải chọn trước khi gửi.
 */
export function ClaimCauseSelect<V extends ClaimCause | ''>({ value, onChange, id }: { value: V; onChange: (v: ClaimCause) => void; id?: string }) {
  return (
    <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value as ClaimCause)}>
      {value === '' && <option value="" disabled>— Chọn nguyên nhân —</option>}
      {CLAIM_CAUSES.map((c) => <option key={c} value={c}>{CLAIM_CAUSE[c].label}{CLAIM_CAUSE[c].basis === 'PLAN' ? ' (theo gói)' : ` (${CLAIM_FAULT_CAP_LABEL})`}</option>)}
    </select>
  );
}

/** Một dòng cho người duyệt: nguyên nhân khách chọn + gói bảo vệ của hợp đồng. */
export function claimCauseLine(x: Pick<DamageClaim, 'cause'>, contract?: Pick<RentalContract, 'protectionPlan'> | null) {
  return `${CLAIM_CAUSE[causeOf(x.cause)].label} · gói ${planOf(contract?.protectionPlan).label}`;
}
