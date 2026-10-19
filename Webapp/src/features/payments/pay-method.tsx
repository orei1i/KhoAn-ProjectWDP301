'use client';

import type { PaymentMethod } from '@ssm/shared';
import { PAYMENT_METHOD } from '@/shared/lib/labels';
import { cx } from '@/shared/ui';

export function PayMethodPicker({ value, onChange, methods = ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'] }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; methods?: PaymentMethod[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {methods.map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} className={cx('rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ring-inset', value === m ? 'bg-brand-50 text-brand-900 ring-brand-600' : 'ring-stone-300 hover:bg-stone-50')}>
          {PAYMENT_METHOD[m]}
        </button>
      ))}
    </div>
  );
}
