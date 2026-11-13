'use client';

import { CLAIM_CAUSE, CLAIM_CAUSES, causeOf, planOf, type ClaimCause, type DamageClaim, type RentalContract } from '@ssm/shared';
import { inputCls } from '@/shared/ui';

/** Chọn nguyên nhân sự cố (gói bảo vệ — Điều 6): lỗi của kho → trần 10 lần tiền thuê; rủi ro nêu tên → mức gói của hợp đồng. */
export function ClaimCauseSelect({ value, onChange, id }: { value: ClaimCause; onChange: (v: ClaimCause) => void; id?: string }) {
  return (
    <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value as ClaimCause)}>
      {CLAIM_CAUSES.map((c) => <option key={c} value={c}>{CLAIM_CAUSE[c].label}{CLAIM_CAUSE[c].basis === 'PLAN' ? ' — theo gói bảo vệ' : ' — tối đa 10 lần tiền thuê'}</option>)}
    </select>
  );
}

/** Một dòng cho người duyệt: nguyên nhân khách chọn + gói bảo vệ của hợp đồng. */
export function claimCauseLine(x: Pick<DamageClaim, 'cause'>, contract?: Pick<RentalContract, 'protectionPlan'> | null) {
  return `${CLAIM_CAUSE[causeOf(x.cause)].label} · gói ${planOf(contract?.protectionPlan).label}`;
}
