import type { PriceQuote } from './entities';
import type { RentalPeriod } from './enums';
import { localMidnightMs, vnd } from './format';
import { PERIOD_UNIT } from './labels';
import { hasTermCommitment } from './duration';
import { earlyExitText, type EarlyExitTier } from './early-termination';
import { DAILY_DEPOSIT_MIN_DAYS } from './tier-rules';
import type { UnitCategory } from './enums';

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

/**
 * Đợt 15 (B7) — chế độ trả khoản lúc đặt chỗ: trả online ngay (mặc định), hoặc "giữ chỗ, trả tại quầy" trước `holdUntil` (hạn giữ ô —
 * counterHoldExpiry). Lịch thanh toán, dòng giỏ hàng và câu khách tick xác nhận nói đúng theo chế độ đang chọn.
 */
export type PayTiming = { mode: 'ONLINE' } | { mode: 'COUNTER'; holdUntil: string | Date } | { mode: 'COD'; holdUntil: string | Date };
/**
 * Đợt 15 (C1) — chế độ thứ ba "Trả khi nhận kho" (COD): hôm nay KHÔNG trả gì; tiền giữ chân + tiền thuê kỳ đầu trả tại quầy khi nhận kho,
 * ô giữ đến hết ngày nhận (`holdUntil` = 00:00 giờ VN hôm sau — codHoldExpiry). Lịch thanh toán ghi "Hôm nay 0 ₫ · Khi nhận kho X".
 */
export const isCodTiming = (t?: PayTiming | null): t is { mode: 'COD'; holdUntil: string | Date } => t?.mode === 'COD';
export const ONLINE_TIMING: PayTiming = { mode: 'ONLINE' };

export interface PaymentSchedule {
  steps: PaymentStep[];
  /** Tiền giữ chân (một phần của khoản phải trả khi đặt chỗ). */
  holdFee: number;
  /** Tiền thuê kỳ đầu thu cùng lúc đặt chỗ (kho cỡ lớn) — 0 với kho thường. */
  prepaidRent: number;
  /** Tổng phải trả ngay khi đặt chỗ = tiền giữ chân + tiền thuê kỳ đầu trả trước (nếu có). Trả khi nhận kho (COD): 0. */
  payNow: number;
  /** Trả thêm khi nhận kho (tiền thuê kỳ đầu của kho thường) — khoản khách hay bỏ sót. Trả khi nhận kho (COD): gồm cả tiền giữ chân. */
  payAtCheckIn: number;
  /** Tổng chuẩn bị trước khi dùng kho = payNow + payAtCheckIn. */
  totalBeforeUse: number;
  /** Tiền thuê của MỘT kỳ, cộng tất cả kho trong đơn. */
  perPeriod: number;
  unit: string;
  /** Thuê theo ngày / tuần: tiền thuê cả thời hạn trả trọn trước khi dùng kho. */
  wholeTerm: boolean;
  /** Chế độ trả khoản lúc đặt chỗ (B7). */
  timing: PayTiming;
  /** Đợt 15 (F6): báo giá có ưu đãi cam kết thuê dài hạn → câu nói rõ trả kho sớm hoàn bao nhiêu tiền giữ chân + thu lại ưu đãi. */
  earlyExit: string | null;
}

type QuoteLike = Pick<PriceQuote, 'depositAmount' | 'firstPeriodRent' | 'rentalPeriod'> & Partial<Pick<PriceQuote, 'firstPeriodAtBooking' | 'depositPeriods' | 'prepaidPeriods' | 'discountAmount'>>;

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

/** Tuỳ chọn của lịch thanh toán: chế độ trả lúc đặt (B7) và bậc hoàn tiền giữ chân khi trả kho sớm của chính sách (F6). */
export interface PaymentScheduleOptions { timing?: PayTiming | null; earlyTermination?: readonly EarlyExitTier[] | null }

/** Chữ "khi nào trả" của khoản lúc đặt chỗ theo chế độ: "Hôm nay — khi đặt chỗ" / "Trả tại quầy trước HH:mm dd/mm" / "Khi nhận kho". */
export function payNowWhen(timing?: PayTiming | null): string {
  if (timing?.mode === 'COD') return 'Khi nhận kho';
  return timing?.mode === 'COUNTER' ? `Trả tại quầy trước ${fmtHoldUntil(timing.holdUntil)}` : 'Hôm nay — khi đặt chỗ';
}
/** Nhãn ngắn cho dòng giỏ hàng / ô tổng: "Hôm nay", "Trả tại quầy trước HH:mm dd/mm" hoặc "Khi nhận kho" (COD). */
export function payNowLabel(timing?: PayTiming | null): string {
  if (timing?.mode === 'COD') return 'Khi nhận kho';
  return timing?.mode === 'COUNTER' ? `Trả tại quầy trước ${fmtHoldUntil(timing.holdUntil)}` : 'Hôm nay';
}
/**
 * Dòng giỏ hàng của MỘT báo giá theo chế độ trả — web và app dùng chung: online / trả tại quầy "Hôm nay X tiền giữ chân · thêm Y khi nhận
 * kho"; trả khi nhận kho "Hôm nay 0 ₫ · khi nhận kho X (giữ chân + tiền thuê)".
 */
export function cartLineText(q: QuoteLike, timing?: PayTiming | null): string {
  const unit = PERIOD_UNIT[q.rentalPeriod];
  if (timing?.mode === 'COD') {
    const rent = rentBeforeUse(q);
    return `Hôm nay 0 ₫ · khi nhận kho ${vnd(q.depositAmount + rent)} (giữ chân ${vnd(q.depositAmount)} + tiền thuê ${paysWholeTerm(q) ? 'cả thời hạn' : `${unit} đầu`} ${vnd(rent)})`;
  }
  const head = `${payNowLabel(timing)} ${vnd(dueAtBooking(q))}${q.firstPeriodAtBooking ? ` (giữ chân ${vnd(q.depositAmount)} + thuê ${unit} đầu ${vnd(q.firstPeriodRent)})` : ' tiền giữ chân'}`;
  return `${head}${dueAtCheckIn(q) > 0 ? ` · thêm ${vnd(dueAtCheckIn(q))} khi nhận kho` : ' · nhận kho không trả thêm'}`;
}

/**
 * `quotes`: một báo giá, hoặc nhiều dòng trong giỏ (cùng chu kỳ). `graceDays`: ân hạn của chính sách, nếu biết. `opts.timing`: trả online /
 * trả tại quầy (B7); `opts.earlyTermination`: bậc hoàn khi trả kho sớm của chính sách — có thì ghi chú vào khoản giữ chân khi báo giá có
 * ưu đãi cam kết (F6).
 */
export function buildPaymentSchedule(quotes: readonly QuoteLike[], graceDays?: number, opts: PaymentScheduleOptions = {}): PaymentSchedule {
  const timing = opts.timing ?? ONLINE_TIMING;
  const cod = timing.mode === 'COD';
  const nowWhen = payNowWhen(timing);
  const committed = quotes.some((q) => hasTermCommitment({ rentalPeriod: q.rentalPeriod, discountAmount: q.discountAmount ?? 0 }));
  const earlyExit = committed && opts.earlyTermination ? earlyExitText(opts.earlyTermination) : null;
  const unit = PERIOD_UNIT[quotes[0]?.rentalPeriod ?? 'MONTH'];
  const holdFee = quotes.reduce((s, q) => s + q.depositAmount, 0);
  const prepaidRent = quotes.reduce((s, q) => s + (q.firstPeriodAtBooking ? q.firstPeriodRent : 0), 0);
  const rentAtCheckIn = quotes.reduce((s, q) => s + dueAtCheckIn(q), 0);
  const perPeriod = quotes.reduce((s, q) => s + q.firstPeriodRent, 0);
  // Trả khi nhận kho (C1): hôm nay 0 ₫ — mọi khoản trước khi dùng kho trả tại quầy khi nhận kho.
  const payNow = cod ? 0 : holdFee + prepaidRent;
  const payAtCheckIn = cod ? holdFee + prepaidRent + rentAtCheckIn : rentAtCheckIn;
  const maxHoldPeriods = Math.max(1, ...quotes.map((q) => q.depositPeriods ?? 1));
  const daily = quotes.some((q) => q.rentalPeriod === 'DAY');
  const wholeTerm = quotes.some(paysWholeTerm);

  const steps: PaymentStep[] = [
    {
      key: 'DEPOSIT', when: nowWhen, title: 'Tiền giữ chân', amount: holdFee,
      note: 'Giữ ô kho cho bạn, được giữ đến khi trả kho — không trừ vào tiền thuê — và hoàn lại sau khi trừ phí hư hại, công nợ (nếu có).'
        + (maxHoldPeriods > 1 ? (daily ? ` Thuê theo ngày: tiền giữ chân tối thiểu ${DAILY_DEPOSIT_MIN_DAYS} ngày tiền thuê.` : ` Kho cỡ lớn: tiền giữ chân bằng ${maxHoldPeriods} ${unit} tiền thuê.`) : '')
        + (timing.mode === 'COUNTER' ? ' Quá hạn chưa trả tại quầy thì đặt chỗ tự huỷ.' : '')
        + (timing.mode === 'COD' ? ` Trả khi nhận kho: trả tại quầy sau khi ký hợp đồng, trước khi nhận bàn giao kho; ô giữ đến hết ngày ${fmtEndOfDay(timing.holdUntil)} — không đến thì đặt chỗ tự huỷ và tài khoản tạm mất lựa chọn "trả khi nhận kho" ${COD_BAN_DAYS} ngày.` : '')
        + (earlyExit ? ` ${earlyExit}` : ''),
    },
  ];
  if (prepaidRent > 0) {
    steps.push({
      key: 'FIRST_RENT_NOW', when: nowWhen, title: `Tiền thuê ${unit} đầu`, amount: prepaidRent,
      note: 'Kho cỡ lớn: trả CÙNG tiền giữ chân ngay khi đặt chỗ — đến nhận kho không phải trả thêm tiền thuê kỳ đầu.',
    });
  }
  if (rentAtCheckIn > 0) {
    steps.push({
      key: 'FIRST_RENT', when: 'Khi nhận kho', title: wholeTerm ? 'Tiền thuê cả thời hạn' : `Tiền thuê ${unit} đầu`, amount: rentAtCheckIn,
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

  return { steps, holdFee, prepaidRent, payNow, payAtCheckIn, totalBeforeUse: payNow + payAtCheckIn, perPeriod, unit, wholeTerm, timing, earlyExit };
}

/**
 * Câu khách tick xác nhận trước khi đặt chỗ — theo chế độ trả (B7: trả tại quầy thì nêu hạn "trước HH:mm dd/mm" thay cho "hôm nay") và,
 * khi báo giá có ưu đãi cam kết, kèm câu trả kho sớm (F6). Đổi chế độ / số tiền là câu khác → khách phải tick lại (paymentAckKey).
 */
export const paymentAckText = (s: Pick<PaymentSchedule, 'holdFee' | 'prepaidRent' | 'payNow' | 'payAtCheckIn' | 'unit'> & { wholeTerm?: boolean; timing?: PayTiming | null; earlyExit?: string | null }) => {
  if (s.timing?.mode === 'COD') {
    // C1 — câu tick RIÊNG của "trả khi nhận kho": hôm nay chưa trả gì; tiền giữ chân + tiền thuê trả tại quầy; không đến thì mất quyền COD.
    const rent = s.payAtCheckIn - s.holdFee - s.prepaidRent;
    return `Tôi hiểu rằng hôm nay tôi chưa phải thanh toán gì; khi nhận kho tôi trả tại quầy ${vnd(s.payAtCheckIn)}, gồm tiền giữ chân ${vnd(s.holdFee + s.prepaidRent)} và tiền thuê ${s.wholeTerm ? 'cả thời hạn' : `${s.unit} đầu`} ${vnd(rent)}, sau khi ký hợp đồng và trước khi nhận kho. Ô được giữ đến hết ngày ${fmtEndOfDay(s.timing.holdUntil)}; không đến nhận kho thì đặt chỗ tự huỷ và tôi tạm mất lựa chọn "trả khi nhận kho" ${COD_BAN_DAYS} ngày.${s.wholeTerm ? ` Trả kho sớm không được hoàn tiền các ${s.unit} chưa dùng.` : ''}${s.earlyExit ? ` ${s.earlyExit}` : ''}`;
  }
  const counter = s.timing?.mode === 'COUNTER' ? fmtHoldUntil(s.timing.holdUntil) : null;
  // Vế "trả lúc đặt chỗ": online = "hôm nay …"; trả tại quầy = "tôi trả tại quầy trước HH:mm dd/mm: … — quá hạn chưa trả thì đặt chỗ tự huỷ".
  const head = (only: boolean, what: string) => (counter
    ? `tôi trả tại quầy trước ${counter}: ${what} — quá hạn chưa trả thì đặt chỗ tự huỷ`
    : `hôm nay ${only ? 'chỉ ' : ''}thanh toán ${what}`);
  const tail = s.earlyExit ? ` ${s.earlyExit}` : '';
  if (s.wholeTerm && s.prepaidRent === 0) {
    return `Tôi hiểu rằng ${head(true, `tiền giữ chân ${vnd(s.holdFee)}`)}; tiền thuê của CẢ thời hạn ${vnd(s.payAtCheckIn)} sẽ thanh toán trọn một lần khi nhận kho (ngoài khoản giữ chân), và trả kho sớm không được hoàn tiền các ${s.unit} chưa dùng.${tail}`;
  }
  if (s.prepaidRent > 0 && s.payAtCheckIn === 0) {
    return `Tôi hiểu rằng ${head(false, `${vnd(s.payNow)}, gồm tiền giữ chân ${vnd(s.holdFee)} và tiền thuê ${s.unit} đầu ${vnd(s.prepaidRent)}`)}; đến nhận kho không phải trả thêm tiền thuê kỳ đầu.${tail}`;
  }
  if (s.prepaidRent > 0) {
    return `Tôi hiểu rằng ${head(false, `${vnd(s.payNow)} (tiền giữ chân ${vnd(s.holdFee)} + tiền thuê ${s.unit} đầu của kho cỡ lớn ${vnd(s.prepaidRent)})`)}; tiền thuê ${s.unit} đầu của các kho còn lại ${vnd(s.payAtCheckIn)} sẽ thanh toán THÊM khi nhận kho.${tail}`;
  }
  return `Tôi hiểu rằng ${head(true, `tiền giữ chân ${vnd(s.holdFee)}`)}; tiền thuê ${s.unit} đầu ${vnd(s.payAtCheckIn)} sẽ thanh toán THÊM khi nhận kho (ngoài khoản giữ chân).${tail}`;
};

/** Khoá "đã tick lịch thanh toán" (web / app): đổi số tiền, chế độ trả hay câu trả kho sớm thì phải tick lại. */
export const paymentAckKey = (s: Pick<PaymentSchedule, 'payNow' | 'payAtCheckIn' | 'timing' | 'earlyExit'>) =>
  `${s.payNow}:${s.payAtCheckIn}:${s.timing.mode}:${s.earlyExit ? 'EXIT' : ''}`;

/** Dòng tóm tắt dưới lịch thanh toán. */
/** Dòng tổng kết khi khách ĐÃ thanh toán các khoản lúc đặt chỗ (màn chi tiết đặt chỗ sau khi trả tiền). */
export function paymentPaidText(s: Pick<PaymentSchedule, 'payNow' | 'payAtCheckIn'> & { wholeTerm?: boolean; holdFee?: number; prepaidRent?: number; timing?: PayTiming | null }): string {
  if (s.timing?.mode === 'COD') {
    // Trả khi nhận kho đã thu tiền giữ chân tại quầy: còn tiền thuê, thu ở bước nhận kho.
    const paid = (s.holdFee ?? 0) + (s.prepaidRent ?? 0);
    const rest = s.payAtCheckIn - paid;
    return rest > 0
      ? `Đã trả tiền giữ chân ${vnd(paid)} tại quầy. Còn ${vnd(rest)} tiền thuê ${s.wholeTerm ? 'cả thời hạn' : 'kỳ đầu'}, trả khi nhân viên bàn giao kho.`
      : `Đã trả tiền giữ chân ${vnd(paid)} tại quầy.`;
  }
  return s.payAtCheckIn > 0
    ? `Đã trả ${vnd(s.payNow)} khi đặt chỗ. Còn ${vnd(s.payAtCheckIn)} tiền thuê ${s.wholeTerm ? 'cả thời hạn' : 'kỳ đầu'}, trả tại quầy khi nhận kho.`
    : `Đã trả đủ ${vnd(s.payNow)} khi đặt chỗ — đến nhận kho không phải trả thêm.`;
}

export const paymentTotalText = (s: Pick<PaymentSchedule, 'holdFee' | 'prepaidRent' | 'payNow' | 'payAtCheckIn' | 'totalBeforeUse' | 'unit'> & { timing?: PayTiming | null }) => {
  if (s.timing?.mode === 'COD') {
    return `Hôm nay 0 ₫ · Khi nhận kho ${vnd(s.payAtCheckIn)} (tiền giữ chân ${vnd(s.holdFee + s.prepaidRent)} + tiền thuê ${vnd(s.payAtCheckIn - s.holdFee - s.prepaidRent)}). Giữ ô đến hết ngày ${fmtEndOfDay(s.timing.holdUntil)}.`;
  }
  const counter = s.timing?.mode === 'COUNTER' ? `trả tại quầy trước ${fmtHoldUntil(s.timing.holdUntil)}` : null;
  if (s.payAtCheckIn === 0) {
    return `Tổng cần chuẩn bị trước khi dùng kho: ${vnd(s.totalBeforeUse)}${s.prepaidRent > 0 ? `, ${counter ?? 'trả một lần hôm nay'} (giữ chân ${vnd(s.holdFee)} + tiền thuê ${s.unit} đầu ${vnd(s.prepaidRent)})` : ''}.`;
  }
  return `Tổng cần chuẩn bị trước khi dùng kho: ${vnd(s.totalBeforeUse)} (${vnd(s.payNow)} ${counter ?? 'hôm nay'} + ${vnd(s.payAtCheckIn)} khi nhận kho).`;
};

// ---------- Giữ chỗ, trả tại quầy (đợt 14) ----------
/**
 * Khách đặt online nhưng chọn TRẢ TẠI QUẦY (`payAtCounter`): ô được giữ tối đa COUNTER_HOLD_HOURS giờ (thay cho reservationHoldMinutes
 * của chính sách) để khách mang CCCD đến quầy trả tiền giữ chân (+ tiền thuê kỳ đầu kho cỡ lớn) và ký hợp đồng giấy. Quá hạn mà chưa trả
 * thì đặt chỗ tự huỷ (HOLD_EXPIRED, không có gì để hoàn). Mỗi khách chỉ được giữ COUNTER_HOLD_MAX_PER_CUSTOMER đặt chỗ kiểu này cùng lúc.
 * Đợt 15 (B6): hạn giữ không vượt quá hết NGÀY NHẬN KHO (00:00 giờ VN hôm sau) — counterHoldExpiry; còn dưới COUNTER_HOLD_MIN_HOURS giờ
 * thì không nhận giữ chỗ kiểu này (422 COUNTER_HOLD_TOO_SHORT — chọn trả online hoặc ngày nhận khác).
 */
export const COUNTER_HOLD_HOURS = 24;
export const COUNTER_HOLD_MAX_PER_CUSTOMER = 1;
export const COUNTER_HOLD_MIN_HOURS = 2;
const pad2 = (n: number) => String(n).padStart(2, '0');
/** "HH:mm dd/mm" theo giờ Việt Nam. */
export function fmtHoldUntil(at: string | Date): string {
  const d = new Date(new Date(at).getTime() + 7 * 3_600_000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} ${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
}
/** 00:00 giờ VN của ngày SAU ngày nhận kho (date-only `startDate` — 'YYYY-MM-DD', ISO hoặc Date) — tức hết ngày nhận kho. */
export function endOfStartDayMs(startDate: string | Date): number {
  const ymd = (typeof startDate === 'string' ? startDate : startDate.toISOString()).slice(0, 10);
  return localMidnightMs(new Date(Date.parse(`${ymd}T00:00:00.000Z`) + 86_400_000));
}
/**
 * Hạn giữ ô của "giữ chỗ, trả tại quầy" nếu đặt vào lúc `now` với ngày nhận `startDate`: min(now + COUNTER_HOLD_HOURS giờ, 00:00 giờ VN
 * của ngày sau ngày nhận). Một công thức cho BE (lưu holdExpiresAt) và web / app (hiện "Giữ ô đến …" trước khi khách bấm đặt).
 */
export function counterHoldExpiry(startDate: string | Date, now: string | Date = new Date()): Date {
  return new Date(Math.min(new Date(now).getTime() + COUNTER_HOLD_HOURS * 3_600_000, endOfStartDayMs(startDate)));
}
/** Hạn giữ còn dưới COUNTER_HOLD_MIN_HOURS giờ → không nhận "giữ chỗ, trả tại quầy" (B6). */
export const counterHoldTooShort = (holdUntil: string | Date, now: string | Date = new Date()) =>
  new Date(holdUntil).getTime() - new Date(now).getTime() < COUNTER_HOLD_MIN_HOURS * 3_600_000;
export const COUNTER_HOLD_TOO_SHORT_TEXT = `Chỉ còn chưa đến ${COUNTER_HOLD_MIN_HOURS} giờ là hết ngày nhận kho — chọn thanh toán online hoặc ngày nhận khác`;
/** Dòng nhắc trên trang / màn đặt chỗ "trả tại quầy" của khách. */
export const counterHoldText = (holdExpiresAt: string | Date) =>
  `Giữ ô đến ${fmtHoldUntil(holdExpiresAt)} — mang CCCD đến quầy thanh toán và ký hợp đồng`;
/** Một câu giải thích lựa chọn trên màn đặt kho (khớp Điều 11 Điều khoản). */
export const PAY_AT_COUNTER_NOTE = `Giữ chỗ, trả tại quầy: ô được giữ tối đa ${COUNTER_HOLD_HOURS} giờ và không quá hết ngày nhận kho, để bạn đến quầy thanh toán và ký hợp đồng giấy; quá hạn chưa thanh toán thì đặt chỗ tự huỷ. Mỗi tài khoản giữ tối đa ${COUNTER_HOLD_MAX_PER_CUSTOMER} đặt chỗ kiểu này.`;

// ---------- Trả khi nhận kho — COD (đợt 15, C1) ----------
/**
 * Lựa chọn thứ ba khi đặt online (chỉ 1 kho mỗi lượt): hôm nay không trả gì, ô giữ đến HẾT NGÀY NHẬN KHO (00:00 giờ VN hôm sau — không cộng
 * noShowAfterHours); khách đến quầy: đối chiếu CCCD → in & ký hợp đồng giấy → trả tiền giữ chân (collect-deposit) → nhận kho (tiền thuê
 * kỳ đầu + dịch vụ). Lưu `payAtCounter: true, payOnArrival: true`. Điều kiện (server quyết định — GET /reservations/cod-eligibility):
 *  - ngày nhận trong COD_MAX_LEAD_DAYS ngày tới (hôm nay..+3), kho Locker / S / M (không L / XL);
 *  - tài khoản ACTIVE, email đã xác minh, hồ sơ đã khai CCCD, không còn nợ sau quyết toán;
 *  - tối đa 1 đặt chỗ chưa trả (chung với "giữ chỗ, trả tại quầy"); loại kho còn ≥ COD_MIN_FREE_UNITS ô trống SAU khi giữ;
 *  - không có lần "không đến nhận kho" của đặt chỗ COD chưa trả trong COD_BAN_DAYS ngày gần nhất.
 * Huỷ lúc nào cũng miễn phí (chưa trả gì); quá hạn → job huỷ lý do NO_SHOW và tài khoản tạm mất lựa chọn này 90 ngày. Khách vẫn trả online
 * trước được — trả rồi thì là đặt chỗ đã trả tiền giữ chân như thường (mốc hoàn khi huỷ, không đến thì mất tiền giữ chân).
 */
export const COD_MAX_LEAD_DAYS = 3;
export const COD_MIN_FREE_UNITS = 2;
export const COD_BAN_DAYS = 90;
export const COD_CATEGORIES: readonly UnitCategory[] = ['LOCKER', 'SMALL', 'MEDIUM'];
export const codAllowedFor = (category: string) => (COD_CATEGORIES as readonly string[]).includes(category);
/** Hạn giữ ô của đặt chỗ trả khi nhận kho: 00:00 giờ VN của ngày SAU ngày nhận (hết ngày nhận kho). */
export const codHoldExpiry = (startDate: string | Date): Date => new Date(endOfStartDayMs(startDate));
/** "dd/mm" của NGÀY CUỐI được giữ (hạn là 00:00 hôm sau) — "Giữ ô đến hết ngày dd/mm". */
export function fmtEndOfDay(holdUntil: string | Date): string {
  const d = new Date(new Date(holdUntil).getTime() + 7 * 3_600_000 - 1);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
}
/** Dòng nhắc trên trang / màn đặt chỗ "trả khi nhận kho" của khách. */
export const codHoldText = (holdUntil: string | Date) =>
  `Giữ ô đến hết ngày ${fmtEndOfDay(holdUntil)} — mang CCCD đến quầy: ký hợp đồng, trả tiền giữ chân + tiền thuê rồi nhận kho`;
/** Lý do server từ chối "trả khi nhận kho" (422 COD_NOT_ALLOWED, details.reason) — web / app làm mờ lựa chọn và hiện câu tương ứng. */
export type CodReason = 'PROFILE' | 'ACCOUNT' | 'DEBT' | 'BANNED' | 'LIMIT' | 'SIZE' | 'LEAD_DAYS' | 'TOO_LATE' | 'LOW_STOCK';
export const COD_REASON_TEXT: Record<CodReason, string> = {
  // Đợt 16 (A8): hồ sơ chưa đủ lập hợp đồng (họ tên, điện thoại, giấy tờ) — đặt sẽ bị 422 PROFILE_INCOMPLETE, nên báo ngay ở bước chọn.
  PROFILE: 'Bổ sung hồ sơ (họ tên, số điện thoại, giấy tờ tùy thân) trong tài khoản trước — các thông tin này được in vào hợp đồng',
  ACCOUNT: 'Cần tài khoản đã kích hoạt, email đã xác minh và đã khai CCCD',
  DEBT: 'Tài khoản còn nợ sau quyết toán — thanh toán xong mới chọn được',
  BANNED: `Tài khoản đã không đến nhận kho một đặt chỗ trả khi nhận kho — tạm không chọn được trong ${COD_BAN_DAYS} ngày`,
  LIMIT: 'Mỗi tài khoản chỉ giữ 1 đặt chỗ chưa trả (trả khi nhận kho / trả tại quầy), 1 kho mỗi lượt',
  SIZE: 'Chỉ áp dụng cho tủ Locker và kho cỡ S, M',
  LEAD_DAYS: `Chỉ áp dụng khi nhận kho trong ${COD_MAX_LEAD_DAYS} ngày tới`,
  TOO_LATE: `Chỉ còn chưa đến ${COUNTER_HOLD_MIN_HOURS} giờ là hết ngày nhận kho — chọn thanh toán online hoặc ngày nhận khác`,
  LOW_STOCK: `Loại kho này sắp hết chỗ (cần còn ít nhất ${COD_MIN_FREE_UNITS} ô trống sau khi giữ) — vui lòng thanh toán online`,
};
/** Kết quả GET /reservations/cod-eligibility (BE quyết định — web / app chỉ hiện / làm mờ lựa chọn kèm lý do). */
export interface CodEligibility {
  allowed: boolean;
  reason?: CodReason;
  message?: string;
  /** Hạn giữ ô nếu đặt ngay bây giờ (00:00 giờ VN của ngày sau ngày nhận). */
  holdUntil: string;
  /** BANNED: hết ngày bị tạm khoá lựa chọn. */
  banUntil?: string | null;
}
/**
 * Điều kiện THEO Ô của COD (thuần — BE dùng để chặn; tài khoản / nợ / giới hạn do BE tra DB): cỡ kho, ngày nhận trong 3 ngày tới, còn đủ giờ
 * trong ngày nhận, loại kho còn ≥ 2 ô trống sau khi giữ. `today` = 00:00Z của ngày VN hôm nay; `freeAfterHold` = số ô trống còn lại.
 */
export function codUnitReason(i: { category: string; startDate: string | Date; today: string | Date; now?: string | Date; freeAfterHold: number }): CodReason | null {
  if (!codAllowedFor(i.category)) return 'SIZE';
  const ymd = (d: string | Date) => Date.parse(`${(typeof d === 'string' ? d : d.toISOString()).slice(0, 10)}T00:00:00.000Z`);
  const start = ymd(i.startDate);
  const today = ymd(i.today);
  if (start < today || start > today + COD_MAX_LEAD_DAYS * 86_400_000) return 'LEAD_DAYS';
  if (counterHoldTooShort(codHoldExpiry(i.startDate), i.now ?? new Date())) return 'TOO_LATE';
  if (i.freeAfterHold < COD_MIN_FREE_UNITS) return 'LOW_STOCK';
  return null;
}
/** Một câu giải thích lựa chọn trên màn đặt kho (khớp Điều 3 / Điều 11). */
export const COD_NOTE = `Trả khi nhận kho: hôm nay chưa trả gì, ô được giữ đến hết ngày nhận kho. Mang CCCD đến quầy — ký hợp đồng giấy, trả tiền giữ chân + tiền thuê kỳ đầu rồi nhận kho. Chỉ 1 kho mỗi lượt, nhận trong ${COD_MAX_LEAD_DAYS} ngày tới, kho Locker / S / M. Huỷ lúc nào cũng miễn phí; không đến nhận kho thì đặt chỗ tự huỷ và tài khoản tạm mất lựa chọn này ${COD_BAN_DAYS} ngày.`;
/** Cảnh báo TRƯỚC khi khách đặt chỗ COD bấm trả online sớm (C1, mục 8). */
export const COD_PAY_EARLY_WARNING = 'Trả online trước thì đặt chỗ thành đặt chỗ đã trả tiền giữ chân như thường: huỷ sát ngày nhận có thể không được hoàn tiền giữ chân (theo mốc hoàn khi huỷ), không đến nhận kho thì mất tiền giữ chân. Không trả trước thì vẫn huỷ miễn phí và trả tại quầy khi nhận kho.';

// ---------- Thanh toán khi gia hạn (đợt 14) ----------
type ExtensionLike = { rentalPeriod: RentalPeriod; periods: number; rate: number; payNow: number; gracePeriodDays?: number | null };
/**
 * Lịch thanh toán của MỘT lần gia hạn: thuê tháng trả ngay tiền thuê tháng đầu (payNow = rate), các tháng sau xuất hoá đơn đầu mỗi tháng
 * như hợp đồng; thuê ngày / tuần trả trọn cả kỳ gia hạn ngay. Dùng cho màn báo giá gia hạn (web + app) — cùng con số với phụ lục.
 */
export function extensionPaymentSteps(q: ExtensionLike): { key: 'NOW' | 'NEXT'; when: string; title: string; amount: number; note: string }[] {
  const unit = PERIOD_UNIT[q.rentalPeriod];
  if (q.rentalPeriod !== 'MONTH') {
    return [{ key: 'NOW', when: 'Hôm nay — khi gia hạn', title: `Tiền thuê cả ${q.periods} ${unit} gia hạn`, amount: q.payNow, note: `Trả trọn một lần; trả kho sớm không hoàn tiền các ${unit} chưa dùng.` }];
  }
  const steps: { key: 'NOW' | 'NEXT'; when: string; title: string; amount: number; note: string }[] = [
    { key: 'NOW', when: 'Hôm nay — khi gia hạn', title: 'Tiền thuê tháng đầu', amount: q.payNow, note: 'Tháng đầu của thời gian gia hạn — hệ thống không xuất hoá đơn lại tháng này.' },
  ];
  if (q.periods > 1) {
    steps.push({
      key: 'NEXT', when: `${q.periods - 1} tháng sau`, title: 'Tiền thuê mỗi tháng', amount: q.rate,
      note: `Hoá đơn xuất đầu mỗi tháng${q.gracePeriodDays != null ? `, trả trong vòng ${q.gracePeriodDays} ngày — quá hạn bị tính phí trễ` : ''}.`,
    });
  }
  return steps;
}
/** Một dòng tóm tắt: "Trả ngay tháng đầu X ₫; các tháng sau Y ₫/tháng, hạn trả …". */
export function extensionPaymentText(q: ExtensionLike): string {
  const unit = PERIOD_UNIT[q.rentalPeriod];
  if (q.rentalPeriod !== 'MONTH') return `Trả ngay ${vnd(q.payNow)} — tiền thuê cả ${q.periods} ${unit} gia hạn.`;
  if (q.periods <= 1) return `Trả ngay tháng đầu ${vnd(q.payNow)} — cũng là tháng duy nhất của lần gia hạn này.`;
  return `Trả ngay tháng đầu ${vnd(q.payNow)}; các tháng sau ${vnd(q.rate)}/tháng, hạn trả ${q.gracePeriodDays != null ? `trong vòng ${q.gracePeriodDays} ngày kể từ` : 'theo hoá đơn xuất vào'} đầu mỗi tháng.`;
}
