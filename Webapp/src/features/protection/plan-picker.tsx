'use client';

import { ShieldCheck } from 'lucide-react';
import { PROTECTION_EXCLUSIONS, PROTECTION_PERILS, PROTECTION_PLAN_CODES, PROTECTION_PLANS, protectionFeeText, protectionLimitOf, vnd, type ProtectionPlanCode } from '@ssm/shared';
import { cx } from '@/shared/ui';

/**
 * Chọn gói bảo vệ đồ gửi khi đặt kho (Điều 6, bản 1.20). Phí gói cộng vào tiền thuê mỗi kỳ (server tính lại báo giá theo gói);
 * mức chi trả gói Cơ bản tính theo thể tích ô (`volumeM3` của loại kho đang chọn, không có thì ghi cách tính).
 */
export function ProtectionPlanPicker({ value, onChange, volumeM3, compact = false }: {
  value: ProtectionPlanCode; onChange: (v: ProtectionPlanCode) => void; volumeM3?: number | null; compact?: boolean;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label="Gói bảo vệ đồ gửi" className={cx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
        {PROTECTION_PLAN_CODES.map((code) => {
          const p = PROTECTION_PLANS[code];
          const on = value === code;
          const limit = p.perM3 && !volumeM3 ? `${vnd(p.perM3)}/m³, tối đa ${vnd(p.limit)}` : `tối đa ${vnd(protectionLimitOf(code, volumeM3 ?? 0))}`;
          return (
            <button key={code} type="button" role="radio" aria-checked={on} onClick={() => onChange(code)}
              className={cx('rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition-colors', on ? 'bg-emerald-50 ring-2 ring-emerald-600' : 'bg-white ring-stone-200 hover:bg-stone-50')}>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><ShieldCheck className={cx('size-4', on ? 'text-emerald-700' : 'text-stone-500')} />{p.label}</span>
              <span className="mt-0.5 block text-xs font-medium text-stone-700">{protectionFeeText(code)}</span>
              <span className="mt-0.5 block text-xs text-stone-600">{limit} mỗi sự cố</span>
            </button>
          );
        })}
      </div>
      <details className="mt-2 text-xs text-stone-600">
        <summary className="cursor-pointer select-none font-medium text-stone-700">Gói chi trả khi nào?</summary>
        <p className="mt-1.5">Chi trả thiệt hại thực tế, trong mức của gói, kể cả khi KhoAn không có lỗi, khi đồ bị: {PROTECTION_PERILS.join('; ').toLowerCase()}.</p>
        <p className="mt-1">Không chi trả: {PROTECTION_EXCLUSIONS.join('; ').toLowerCase()}.</p>
        <p className="mt-1">KhoAn làm hư đồ (lỗi của kho) thì bồi thường tối đa 10 lần tiền thuê một tháng, không phụ thuộc gói (Điều 6).</p>
      </details>
    </div>
  );
}
