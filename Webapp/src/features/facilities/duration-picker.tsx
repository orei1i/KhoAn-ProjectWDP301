'use client';

import { useState } from 'react';
import type { RentalPeriod } from '@ssm/shared';
import { DURATION_CHOICES, applyDurationChoice, discountPctFor, durationKeyOf, type DiscountTier } from '@ssm/shared';
import { RENTAL_PERIOD } from '@/shared/lib/labels';
import { cx, inputCls } from '@/shared/ui';

/** "Dưới 1 tháng" tối đa 29 ngày hoặc 4 tuần; còn lại theo tháng, tối đa 10 năm. */
const MAX: Record<RentalPeriod, number> = { DAY: 29, WEEK: 4, MONTH: 120 };
const clamp = (period: RentalPeriod, n: number) => Math.max(1, Math.min(MAX[period], Math.round(n) || 1));

/**
 * Bộ chọn "Bạn sẽ gửi trong bao lâu?": các nút 1/2/3/6 tháng, 1+ năm kèm nhãn "Tiết kiệm x%" (lấy từ bậc ưu đãi
 * của chính sách đang áp cho chi nhánh) và "Dưới 1 tháng" (chọn ngày/tuần). Vẫn nhập được số tháng tuỳ ý.
 */
export function DurationPicker({ period, periods, discounts, onChange, monthOnly = false }: {
  period: RentalPeriod; periods: number; discounts: readonly DiscountTier[]; onChange: (period: RentalPeriod, periods: number) => void;
  /** Đang chọn kho cỡ lớn (chỉ thuê theo tháng): làm mờ "Dưới 1 tháng" và nút Ngày / Tuần. */
  monthOnly?: boolean;
}) {
  const [unsure, setUnsure] = useState(false);
  const active = unsure ? null : durationKeyOf(period, periods);

  const choose = (key: (typeof DURATION_CHOICES)[number]['key']) => {
    setUnsure(false);
    const next = applyDurationChoice(key, { period, periods });
    onChange(next.period, next.periods);
  };
  const toggleUnsure = (v: boolean) => {
    setUnsure(v);
    if (v) onChange('MONTH', 1); // chưa chắc → bắt đầu 1 tháng, gia hạn sau
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {DURATION_CHOICES.map((c) => {
          const pct = c.months ? discountPctFor(discounts, c.months) : 0;
          const on = active === c.key;
          const off = monthOnly && c.months === null; // "Dưới 1 tháng" = thuê theo ngày / tuần
          return (
            <button key={c.key} type="button" onClick={() => choose(c.key)} aria-pressed={on} disabled={off} title={off ? 'Kho cỡ lớn (L, XL) chỉ cho thuê theo tháng' : undefined}
              className={cx('flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-sm font-semibold ring-1 ring-inset transition', off ? 'cursor-not-allowed bg-stone-100 text-stone-400 ring-stone-200' : on ? 'bg-ink text-white ring-ink' : 'ring-stone-300 hover:bg-stone-50')}>
              {c.label}
              {off && <span className="text-[10px] font-medium">Chỉ kho nhỏ</span>}
              {pct > 0 && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', on ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700')}>Tiết kiệm {pct}%</span>}
            </button>
          );
        })}
      </div>

      {unsure ? (
        <p className="mt-2 text-xs leading-relaxed text-stone-500">Bạn có thể bắt đầu với 1 tháng và gia hạn bất cứ lúc nào, không cần chốt thời gian ngay bây giờ.</p>
      ) : period === 'MONTH' ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-stone-500">Hoặc nhập số tháng</span>
          <input type="number" min={1} max={MAX.MONTH} value={periods} onChange={(e) => onChange('MONTH', clamp('MONTH', Number(e.target.value)))} className={cx(inputCls, 'w-20')} />
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* shrink-0 + whitespace-nowrap: trong cột hẹp nút Ngày / Tuần không bị bóp méo, đè chữ lên nhau. */}
          <div className="inline-flex shrink-0 gap-1 rounded-lg bg-stone-100 p-1 text-xs">
            {(['DAY', 'WEEK'] as const).map((p) => (
              <button key={p} type="button" disabled={monthOnly} onClick={() => onChange(p, clamp(p, periods))}
                className={cx('min-w-14 whitespace-nowrap rounded-md px-3 py-1.5 text-center font-medium disabled:cursor-not-allowed disabled:opacity-50', period === p ? 'bg-white text-ink shadow-sm' : 'text-stone-500 hover:text-stone-900')}>{RENTAL_PERIOD[p]}</button>
            ))}
          </div>
          <input type="number" min={1} max={MAX[period]} value={periods} disabled={monthOnly} onChange={(e) => onChange(period, clamp(period, Number(e.target.value)))} className={cx(inputCls, 'w-20 shrink-0 disabled:opacity-50')} />
          <span className="whitespace-nowrap text-xs text-stone-500">{period === 'WEEK' ? 'tuần (tối đa 4)' : 'ngày (tối đa 29)'}</span>
        </div>
      )}

      {monthOnly && <p className="mt-2 text-xs leading-relaxed text-amber-800">Kho cỡ lớn (L, XL) chỉ cho thuê theo tháng.</p>}

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" className="size-4" checked={unsure} onChange={(e) => toggleUnsure(e.target.checked)} />
        Tôi chưa biết
      </label>
    </div>
  );
}
