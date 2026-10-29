'use client';

import { IdCard } from 'lucide-react';
import { ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, type DamageClaim, type IdType, type RentalContract } from '@ssm/shared';
import { Field, InfoTip, cx, inputCls } from '@/shared/ui';
import { CheckLine } from '@/features/staff-ui';
import { IdCheckUnlock } from '@/features/contracts/id-check-unlock';

/** Giấy tờ bản gốc của người nhận tiền mặt bồi thường (chủ hợp đồng) — nhân viên tự đọc và nhập, server so với hồ sơ. */
export type PayoutIdForm = { idType: IdType | ''; last4: string; checked: boolean };
export const EMPTY_PAYOUT_ID: PayoutIdForm = { idType: '', last4: '', checked: false };
export const payoutIdReady = (f: PayoutIdForm) => !!f.idType && ID_LAST4_RE.test(f.last4.trim()) && f.checked;
export const payoutIdPayload = (f: PayoutIdForm) => ({ idType: f.idType as IdType, idNumberLast4: f.last4.trim(), identityVerified: f.checked });

/** Người lập hồ sơ (người đầu tiên trong lịch sử) — không được tự ghi nhận chi tiền (server: 403 SELF_PAYOUT). */
export const claimCreatorId = (c: Pick<DamageClaim, 'statusHistory'>) => c.statusHistory[0]?.by ?? null;

/**
 * Chi tiền mặt bồi thường: đối chiếu giấy tờ tùy thân BẢN GỐC của chủ hợp đồng (loại giấy tờ + 4 số cuối + tick đã kiểm). Không khớp thì
 * server từ chối; nhập sai nhiều lần thì khoá đối chiếu của hợp đồng (quản lý mở khoá ngay tại đây).
 */
export function PayoutIdFields({ contract, customerName, value, onChange }: { contract?: RentalContract | null; customerName: string; value: PayoutIdForm; onChange: (v: PayoutIdForm) => void }) {
  return (
    <div className="space-y-3 rounded-xl bg-sky-50/70 p-4 text-sm ring-1 ring-inset ring-sky-200">
      <p className="flex items-center gap-2 font-semibold text-sky-950">
        <IdCard className="size-4 text-sky-600" />Giấy tờ người nhận — {customerName}
        <InfoTip align="start">Chỉ chi cho chính chủ hợp đồng. Nhập đúng loại giấy tờ và 4 số cuối theo bản gốc — hệ thống tự so với hồ sơ, không khớp thì không chi.</InfoTip>
      </p>
      {contract && <IdCheckUnlock kind="contracts" target={contract} label={`hợp đồng ${contract.contractNumber}`} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <Field label="Loại giấy tờ">
          <select className={inputCls} value={value.idType} onChange={(e) => onChange({ ...value, idType: e.target.value as IdType | '' })}>
            <option value="">— Chọn —</option>
            {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="4 số cuối"><input className={cx(inputCls, 'font-mono uppercase')} maxLength={4} autoComplete="off" value={value.last4} onChange={(e) => onChange({ ...value, last4: e.target.value })} /></Field>
      </div>
      <CheckLine checked={value.checked} onChange={(checked) => onChange({ ...value, checked })}>
        Chủ hợp đồng có mặt tại quầy; tôi đã xem giấy tờ bản gốc và nhập đúng loại giấy tờ, 4 số cuối.
      </CheckLine>
    </div>
  );
}
