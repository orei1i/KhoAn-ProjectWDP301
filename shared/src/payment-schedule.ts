import type { PriceQuote } from './entities';
import type { RentalPeriod } from './enums';
import { vnd } from './format';
import { PERIOD_UNIT } from './labels';

/**
 * Lịch thanh toán — MỘT nguồn cho báo giá lúc đặt chỗ (web/app), màn thanh toán, màn nhận kho và điều khoản
 * hợp đồng, để mọi nơi nói cùng một con số và khách biết trước mình phải trả gì, lúc nào.
 *
 * Hai cách thu tiền thuê kỳ đầu (xem tier-rules.ts):
 * - kho thường: tiền giữ chân khi đặt chỗ, tiền thuê kỳ đầu trả THÊM khi nhận kho;
 * - kho cỡ lớn: tiền giữ chân (≥ 2 kỳ) + tiền thuê kỳ đầu trả CÙNG LÚC đặt chỗ, nhận kho không trả thêm.
 *
 * Thuê theo NGÀY / TUẦN: tiền thuê của CẢ thời hạn trả trọn một lần khi nhận kho (`prepaidPeriods` = số kỳ đã đặt) — không
 * xuất hoá đơn lẻ từng ngày; trả kho sớm không hoàn các kỳ chưa dùng; quá thời hạn mà chưa trả kho thì tính tiếp từng kỳ.
 */
/** Số kỳ tiền thuê thu trước khi dùng kho cho một lượt thuê: theo tháng = 1, theo ngày / tuần = cả thời hạn. */
export const prepaidPeriodsOf = (period: RentalPeriod, periods: number) => (period === 'MONTH' ? 1 : Math.max(1, periods));
export interface PaymentStep {
  key: 'DEPOSIT' | 'FIRST_RENT_NOW' | 'FIRST_RENT' | 'NEXT_PERIODS';
  /** "Hôm nay — khi đặt chỗ" / "Khi nhận kho" / "Các tháng sau" */
  when: string;
  title: string;
  amount: number;
  note: string;
}

export interface PaymentSchedule {
  steps: PaymentStep[];
  /** Tiền giữ chân (một phần của khoản phải trả khi đặt chỗ). */
  holdFee: number;
  /** Tiền thuê kỳ đầu thu cùng lúc đặt chỗ (kho cỡ lớn) — 0 với kho thường. */
  prepaidRent: number;
  /** Tổng phải trả ngay khi đặt chỗ = tiền giữ chân + tiền thuê kỳ đầu trả trước (nếu có). */
  payNow: number;
  /** Trả thêm khi nhận kho (tiền thuê kỳ đầu của kho thường) — khoản khách hay bỏ sót. */
  payAtCheckIn: number;
  /** Tổng chuẩn bị trước khi dùng kho = payNow + payAtCheckIn. */
  totalBeforeUse: number;
  /** Tiền thuê của MỘT kỳ, cộng tất cả kho trong đơn. */
  perPeriod: number;
  unit: string;
  /** Thuê theo ngày / tuần: tiền thuê cả thời hạn trả trọn trước khi dùng kho. */
  wholeTerm: boolean;
}

type QuoteLike = Pick<PriceQuote, 'depositAmount' | 'firstPeriodRent' | 'rentalPeriod'> & Partial<Pick<PriceQuote, 'firstPeriodAtBooking' | 'depositPeriods' | 'prepaidPeriods'>>;

/** Tổng tiền thuê phải trả trước khi dùng kho của MỘT báo giá (1 kỳ với thuê tháng, cả thời hạn với thuê ngày / tuần). */
export const rentBeforeUse = (q: QuoteLike) => q.firstPeriodRent * Math.max(1, q.prepaidPeriods ?? 1);
/** Báo giá này thu trọn tiền thuê cả thời hạn (thuê theo ngày / tuần; báo giá cũ chưa có `prepaidPeriods` thì không). */
export const paysWholeTerm = (q: QuoteLike) => q.rentalPeriod !== 'MONTH' && q.prepaidPeriods != null;

/** Số tiền phải trả khi đặt chỗ của MỘT báo giá (báo giá cũ không có cờ → chỉ tiền giữ chân). */
/** Các khoản thanh toán thuộc về một hợp đồng: khoản gắn thẳng vào hợp đồng + khoản thu LÚC ĐẶT CHỖ (tiền giữ chân, tiền
 * thuê kỳ đầu của kho cỡ lớn) — những khoản này phát sinh trước khi có hợp đồng nên chỉ mang reservationId. */
export const paymentsOfContract = <P extends { contractId?: string | null; reservationId?: string | null }>(payments: readonly P[], c: { _id: string; reservationId?: string | null }) =>
  payments.filter((p) => p.contractId === c._id || (!!c.reservationId && p.reservationId === c.reservationId));

export const dueAtBooking = (q: QuoteLike) => q.depositAmount + (q.firstPeriodAtBooking ? q.firstPeriodRent : 0);
/** Số tiền phải trả thêm khi nhận kho của MỘT báo giá. */
export const dueAtCheckIn = (q: QuoteLike) => rentBeforeUse(q) - (q.firstPeriodAtBooking ? q.firstPeriodRent : 0);

/** `quotes`: một báo giá, hoặc nhiều dòng trong giỏ (cùng chu kỳ). `graceDays`: ân hạn của chính sách, nếu biết. */
export function buildPaymentSchedule(quotes: readonly QuoteLike[], graceDays?: number): PaymentSchedule {
  const unit = PERIOD_UNIT[quotes[0]?.rentalPeriod ?? 'MONTH'];
  const holdFee = quotes.reduce((s, q) => s + q.depositAmount, 0);
  const prepaidRent = quotes.reduce((s, q) => s + (q.firstPeriodAtBooking ? q.firstPeriodRent : 0), 0);
  const payAtCheckIn = quotes.reduce((s, q) => s + dueAtCheckIn(q), 0);
  const perPeriod = quotes.reduce((s, q) => s + q.firstPeriodRent, 0);
  const payNow = holdFee + prepaidRent;
  const maxHoldPeriods = Math.max(1, ...quotes.map((q) => q.depositPeriods ?? 1));
  const wholeTerm = quotes.some(paysWholeTerm);

  const steps: PaymentStep[] = [
    {
      key: 'DEPOSIT', when: 'Hôm nay — khi đặt chỗ', title: 'Tiền giữ chân', amount: holdFee,
      note: 'Giữ ô kho cho bạn, được giữ đến khi trả kho — không trừ vào tiền thuê — và hoàn lại sau khi trừ phí hư hại, công nợ (nếu có).'
        + (maxHoldPeriods > 1 ? ` Kho cỡ lớn: tiền giữ chân bằng ${maxHoldPeriods} ${unit} tiền thuê.` : ''),
    },
  ];
  if (prepaidRent > 0) {
    steps.push({
      key: 'FIRST_RENT_NOW', when: 'Hôm nay — khi đặt chỗ', title: `Tiền thuê ${unit} đầu`, amount: prepaidRent,
      note: 'Kho cỡ lớn: trả CÙNG tiền giữ chân ngay khi đặt chỗ — đến nhận kho không phải trả thêm tiền thuê kỳ đầu.',
    });
  }
  if (payAtCheckIn > 0) {
    steps.push({
      key: 'FIRST_RENT', when: 'Khi nhận kho', title: wholeTerm ? 'Tiền thuê cả thời hạn' : `Tiền thuê ${unit} đầu`, amount: payAtCheckIn,
      note: wholeTerm
        ? `Thuê theo ${unit}: trả TRỌN tiền thuê của cả thời hạn một lần, tại quầy khi nhân viên bàn giao kho — ngoài tiền giữ chân. Trả kho sớm không hoàn tiền các ${unit} chưa dùng.`
        : 'Khoản riêng, trả THÊM ngoài tiền giữ chân — thanh toán tại quầy khi nhân viên bàn giao kho (tiền mặt, thẻ, VNPay hoặc chuyển khoản).',
    });
  }
  steps.push(wholeTerm ? {
    key: 'NEXT_PERIODS', when: 'Nếu quá thời hạn đã đặt', title: `Tiền thuê mỗi ${unit}`, amount: perPeriod,
    note: `Chỉ phát sinh khi hết thời hạn mà bạn chưa trả kho — tính tiếp từng ${unit} theo giá cũ.`,
  } : {
    key: 'NEXT_PERIODS', when: `Các ${unit} sau`, title: `Tiền thuê mỗi ${unit}`, amount: perPeriod,
    note: `Hoá đơn xuất vào đầu mỗi kỳ${graceDays !== undefined ? `, trả trong vòng ${graceDays} ngày — quá hạn bị tính phí trễ` : ''}.`,
  });

  return { steps, holdFee, prepaidRent, payNow, payAtCheckIn, totalBeforeUse: payNow + payAtCheckIn, perPeriod, unit, wholeTerm };
}

/** Câu khách tick xác nhận trước khi đặt chỗ. */
export const paymentAckText = (s: Pick<PaymentSchedule, 'holdFee' | 'prepaidRent' | 'payNow' | 'payAtCheckIn' | 'unit'> & { wholeTerm?: boolean }) => {
  if (s.wholeTerm && s.prepaidRent === 0) {
    return `Tôi hiểu rằng hôm nay chỉ thanh toán tiền giữ chân ${vnd(s.holdFee)}; tiền thuê của CẢ thời hạn ${vnd(s.payAtCheckIn)} sẽ thanh toán trọn một lần khi nhận kho (ngoài khoản giữ chân), và trả kho sớm không được hoàn tiền các ${s.unit} chưa dùng.`;
  }
  if (s.prepaidRent > 0 && s.payAtCheckIn === 0) {
    return `Tôi hiểu rằng hôm nay thanh toán ${vnd(s.payNow)}, gồm tiền giữ chân ${vnd(s.holdFee)} và tiền thuê ${s.unit} đầu ${vnd(s.prepaidRent)}; đến nhận kho không phải trả thêm tiền thuê kỳ đầu.`;
  }
  if (s.prepaidRent > 0) {
    return `Tôi hiểu rằng hôm nay thanh toán ${vnd(s.payNow)} (tiền giữ chân ${vnd(s.holdFee)} + tiền thuê ${s.unit} đầu của kho cỡ lớn ${vnd(s.prepaidRent)}); tiền thuê ${s.unit} đầu của các kho còn lại ${vnd(s.payAtCheckIn)} sẽ thanh toán THÊM khi nhận kho.`;
  }
  return `Tôi hiểu rằng hôm nay chỉ thanh toán tiền giữ chân ${vnd(s.holdFee)}; tiền thuê ${s.unit} đầu ${vnd(s.payAtCheckIn)} sẽ thanh toán THÊM khi nhận kho (ngoài khoản giữ chân).`;
};

/** Dòng tóm tắt dưới lịch thanh toán. */
/** Dòng tổng kết khi khách ĐÃ thanh toán các khoản lúc đặt chỗ (màn chi tiết đặt chỗ sau khi trả tiền). */
export function paymentPaidText(s: Pick<PaymentSchedule, 'payNow' | 'payAtCheckIn'> & { wholeTerm?: boolean }): string {
  return s.payAtCheckIn > 0
    ? `Đã trả ${vnd(s.payNow)} khi đặt chỗ. Còn ${vnd(s.payAtCheckIn)} tiền thuê ${s.wholeTerm ? 'cả thời hạn' : 'kỳ đầu'}, trả tại quầy khi nhận kho.`
    : `Đã trả đủ ${vnd(s.payNow)} khi đặt chỗ — đến nhận kho không phải trả thêm.`;
}

export const paymentTotalText = (s: Pick<PaymentSchedule, 'holdFee' | 'prepaidRent' | 'payNow' | 'payAtCheckIn' | 'totalBeforeUse' | 'unit'>) => {
  if (s.payAtCheckIn === 0) {
    return `Tổng cần chuẩn bị trước khi dùng kho: ${vnd(s.totalBeforeUse)}${s.prepaidRent > 0 ? `, trả một lần hôm nay (giữ chân ${vnd(s.holdFee)} + tiền thuê ${s.unit} đầu ${vnd(s.prepaidRent)})` : ''}.`;
  }
  return `Tổng cần chuẩn bị trước khi dùng kho: ${vnd(s.totalBeforeUse)} (${vnd(s.payNow)} hôm nay + ${vnd(s.payAtCheckIn)} khi nhận kho).`;
};
