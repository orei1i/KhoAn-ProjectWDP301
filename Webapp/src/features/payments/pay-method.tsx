'use client';

import { ArrowRightLeft, Banknote, CreditCard, Landmark, QrCode, Wallet, type LucideIcon } from 'lucide-react';
import { COUNTER_PAY_METHODS, type CounterPayMethod, type PaymentMethod } from '@ssm/shared';
import { COUNTER_PAY_METHOD, PAYMENT_METHOD } from '@/shared/lib/labels';
import { cx } from '@/shared/ui';

/** Icon theo hình thức thanh toán — chỉ hiện khi truyền `icons` (mặc định như cũ, không icon). */
const METHOD_ICON: Record<PaymentMethod, LucideIcon> = {
  CASH: Banknote, CARD: CreditCard, BANK_TRANSFER: Landmark, VNPAY: QrCode, MOMO: Wallet, INTERNAL: ArrowRightLeft,
};

/** Gợi ý ô "Mã giao dịch" khi nhân viên thu tại quầy không bằng tiền mặt. */
export const counterTxnPlaceholder = (m: PaymentMethod) => (m === 'CARD' ? 'Mã chuẩn chi' : m === 'VNPAY' ? 'Mã giao dịch VNPAY' : 'FT26292xxxxx');
/** Cụm chữ thường ghép trong câu ("Đã nhận đủ … (chuyển khoản)"). */
export const counterMethodPhrase = (m: CounterPayMethod) => (m === 'VNPAY' ? 'VNPAY quét QR tại quầy' : COUNTER_PAY_METHOD[m].toLowerCase());

/**
 * Chọn hình thức thanh toán. Mặc định: khách trả online. Màn thu TẠI QUẦY dùng `<CounterPayPicker>` bên dưới — VNPAY ở đó là khách quét
 * QR của chi nhánh, nhân viên ghi tay mã giao dịch, không qua cổng online.
 */
export function PayMethodPicker({ value, onChange, methods = ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'], icons = false, labels = PAYMENT_METHOD }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; methods?: readonly PaymentMethod[]; icons?: boolean; labels?: Partial<Record<PaymentMethod, string>> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {methods.map((m) => {
        const Icon = METHOD_ICON[m];
        return (
          <button key={m} type="button" onClick={() => onChange(m)} className={cx('rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ring-inset', icons && 'inline-flex items-center justify-center gap-2', value === m ? 'bg-brand-50 text-brand-900 ring-brand-600' : 'ring-stone-300 hover:bg-stone-50')}>
            {icons && <Icon className={cx('size-4 shrink-0', value === m ? 'text-brand-700' : 'text-stone-400')} />}
            {labels[m] ?? PAYMENT_METHOD[m]}
          </button>
        );
      })}
    </div>
  );
}

/** Hình thức nhân viên thu tại quầy: tiền mặt, chuyển khoản vào tài khoản chi nhánh, quẹt thẻ (POS), VNPAY (khách quét QR tại quầy). */
export function CounterPayPicker({ value, onChange, icons = false }: { value: CounterPayMethod; onChange: (m: CounterPayMethod) => void; icons?: boolean }) {
  return <PayMethodPicker icons={icons} value={value} onChange={(m) => onChange(m as CounterPayMethod)} methods={COUNTER_PAY_METHODS} labels={COUNTER_PAY_METHOD} />;
}
