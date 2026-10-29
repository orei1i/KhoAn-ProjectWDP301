import { CalendarClock, Check, Wallet } from 'lucide-react';
import type { EarlyExitTier, PayTiming, PriceQuote } from '@ssm/shared';
import { buildPaymentSchedule, paymentPaidText, paymentTotalText } from '@ssm/shared';
import { vnd } from '@/shared/lib/format';
import { Disclosure, cx } from '@/shared/ui';

/**
 * Lịch thanh toán "giữ chân + kỳ đầu": nói rõ NGAY LÚC ĐẶT khách phải trả gì, lúc nào — kho thường trả tiền giữ chân
 * hôm nay rồi trả THÊM tiền thuê kỳ đầu khi nhận kho; kho cỡ lớn trả cả hai ngay lúc đặt. Cùng một nguồn số liệu với hợp đồng.
 * Dạng dòng thời gian: số tiền nổi bật, phần giải thích từng khoản gom vào khối thu gọn (vẫn đầy đủ nội dung).
 */
export function PaymentSchedule({ quotes, graceDays, compact = false, className, paid = false, timing, earlyTermination }: {
  quotes: readonly (Pick<PriceQuote, 'depositAmount' | 'firstPeriodRent' | 'rentalPeriod'> & Partial<Pick<PriceQuote, 'firstPeriodAtBooking' | 'depositPeriods' | 'prepaidPeriods' | 'discountAmount'>>)[];
  graceDays?: number; compact?: boolean; className?: string;
  /** Khách ĐÃ trả các khoản lúc đặt chỗ — đổi lời "sẽ thanh toán / hôm nay" thành "đã trả". */
  paid?: boolean;
  /** Đợt 15 (B7): trả online (mặc định) hay giữ chỗ, trả tại quầy trước hạn giữ ô; C1: trả khi nhận kho (hôm nay 0 ₫). */
  timing?: PayTiming | null;
  /** Đợt 15 (F6): bậc hoàn tiền giữ chân khi trả kho sớm của chính sách — báo giá có ưu đãi cam kết thì ghi chú vào khoản giữ chân. */
  earlyTermination?: readonly EarlyExitTier[] | null;
}) {
  if (quotes.length === 0) return null;
  const s = buildPaymentSchedule(quotes, graceDays, { timing, earlyTermination });
  const upfront = s.steps.filter((x) => x.key !== 'NEXT_PERIODS').length;
  const paidStep = (key: string) => paid && (key === 'DEPOSIT' || key === 'FIRST_RENT_NOW');
  return (
    <div className={cx('rounded-xl bg-amber-50/70 p-4 text-sm ring-1 ring-inset ring-amber-200', className)}>
      <p className="flex items-center gap-2 font-semibold text-amber-950"><Wallet className="size-4" />{paid ? 'Các khoản thanh toán của đặt chỗ này' : `Bạn sẽ thanh toán ${upfront} khoản trước khi dùng kho`}</p>
      <ol className="relative mt-3 space-y-3">
        <span className="absolute bottom-3 left-[9px] top-3 w-px bg-amber-300" aria-hidden />
        {s.steps.map((step, i) => (
          <li key={step.key} className={cx('relative flex gap-3', step.key === 'NEXT_PERIODS' && 'opacity-80')}>
            <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ring-2 ring-amber-50',
              paidStep(step.key) ? 'bg-emerald-600 text-white' : i < upfront ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-900')}>
              {paidStep(step.key) ? <Check className="size-3" /> : i < upfront ? i + 1 : <CalendarClock className="size-3" />}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <p className="min-w-0 font-medium text-ink">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">{paidStep(step.key) ? (s.timing.mode === 'COD' ? 'Đã trả tại quầy' : 'Đã trả khi đặt chỗ') : step.when}</span>
                <span className="block">{step.title}</span>
              </p>
              <p className="shrink-0 text-base font-semibold tabular-nums text-ink">{vnd(step.amount)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs font-medium leading-relaxed text-amber-950">{paid ? paymentPaidText(s) : paymentTotalText(s)}</p>
      {!compact && (
        <Disclosure variant="plain" title={<span className="text-xs font-semibold text-amber-900">Giải thích từng khoản</span>} className="mt-2">
          <dl className="space-y-2 text-xs leading-relaxed text-stone-700">
            {s.steps.map((step) => (
              <div key={step.key}>
                <dt className="font-semibold text-ink">{step.title}</dt>
                <dd>{step.note}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      )}
    </div>
  );
}
