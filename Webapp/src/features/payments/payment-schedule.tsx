import { CalendarClock, Wallet } from 'lucide-react';
import type { PriceQuote } from '@ssm/shared';
import { buildPaymentSchedule, paymentPaidText, paymentTotalText } from '@ssm/shared';
import { vnd } from '@/shared/lib/format';
import { cx } from '@/shared/ui';

/**
 * Lịch thanh toán "giữ chân + kỳ đầu": nói rõ NGAY LÚC ĐẶT khách phải trả gì, lúc nào — kho thường trả tiền giữ chân
 * hôm nay rồi trả THÊM tiền thuê kỳ đầu khi nhận kho; kho cỡ lớn trả cả hai ngay lúc đặt. Cùng một nguồn số liệu với hợp đồng.
 */
export function PaymentSchedule({ quotes, graceDays, compact = false, className, paid = false }: {
  quotes: readonly (Pick<PriceQuote, 'depositAmount' | 'firstPeriodRent' | 'rentalPeriod'> & Partial<Pick<PriceQuote, 'firstPeriodAtBooking' | 'depositPeriods'>>)[];
  graceDays?: number; compact?: boolean; className?: string;
  /** Khách ĐÃ trả các khoản lúc đặt chỗ — đổi lời "sẽ thanh toán / hôm nay" thành "đã trả". */
  paid?: boolean;
}) {
  if (quotes.length === 0) return null;
  const s = buildPaymentSchedule(quotes, graceDays);
  const upfront = s.steps.filter((x) => x.key !== 'NEXT_PERIODS').length;
  return (
    <div className={cx('rounded-xl bg-amber-50 p-4 text-sm ring-1 ring-inset ring-amber-200', className)}>
      <p className="flex items-center gap-2 font-semibold text-amber-950"><Wallet className="size-4" />{paid ? 'Các khoản thanh toán của đặt chỗ này' : `Bạn sẽ thanh toán ${upfront} khoản trước khi dùng kho`}</p>
      <ol className="mt-3 space-y-3">
        {s.steps.map((step, i) => (
          <li key={step.key} className={cx('flex gap-3', step.key === 'NEXT_PERIODS' && 'opacity-80')}>
            <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold', i < upfront ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-900')}>{i < upfront ? i + 1 : <CalendarClock className="size-3" />}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-ink">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">{paid && (step.key === 'DEPOSIT' || step.key === 'FIRST_RENT_NOW') ? 'Đã trả khi đặt chỗ' : step.when}</span>
                  <span className="block">{step.title}</span>
                </p>
                <p className="shrink-0 text-base font-semibold tabular-nums text-ink">{vnd(step.amount)}</p>
              </div>
              {!compact && <p className="mt-0.5 text-xs leading-relaxed text-stone-600">{step.note}</p>}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium leading-relaxed text-amber-950">{paid ? paymentPaidText(s) : paymentTotalText(s)}</p>
    </div>
  );
}
