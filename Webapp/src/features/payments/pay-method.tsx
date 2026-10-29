'use client';

import { ArrowRightLeft, Banknote, CreditCard, Landmark, QrCode, Wallet, type LucideIcon } from 'lucide-react';
import type { PaymentMethod } from '@ssm/shared';
import { PAYMENT_METHOD } from '@/shared/lib/labels';
import { cx } from '@/shared/ui';

/** Icon theo hình thức thanh toán — chỉ hiện khi truyền `icons` (mặc định như cũ, không icon). */
const METHOD_ICON: Record<PaymentMethod, LucideIcon> = {
  CASH: Banknote, CARD: CreditCard, BANK_TRANSFER: Landmark, VNPAY: QrCode, MOMO: Wallet, INTERNAL: ArrowRightLeft,
};

export function PayMethodPicker({ value, onChange, methods = ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'], icons = false }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; methods?: PaymentMethod[]; icons?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {methods.map((m) => {
        const Icon = METHOD_ICON[m];
        return (
          <button key={m} type="button" onClick={() => onChange(m)} className={cx('rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ring-inset', icons && 'inline-flex items-center justify-center gap-2', value === m ? 'bg-brand-50 text-brand-900 ring-brand-600' : 'ring-stone-300 hover:bg-stone-50')}>
            {icons && <Icon className={cx('size-4 shrink-0', value === m ? 'text-brand-700' : 'text-stone-400')} />}
            {PAYMENT_METHOD[m]}
          </button>
        );
      })}
    </div>
  );
}
