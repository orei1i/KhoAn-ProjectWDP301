import type { PaymentType } from './enums';
import { COLLECTED_PAYMENT_STATUSES } from './billing';
import { monthKey } from './format';

/**
 * Kiểu dữ liệu báo cáo (GET /reports/summary) dùng chung BE ↔ Webapp.
 *
 * Đợt 15 (C4) — DOANH THU tháng = (1) thực thu − hoàn của các khoản không phải tiền giữ chân + (2) tiền giữ chân bị GIỮ LẠI khi đặt chỗ
 * huỷ sát ngày / không đến nhận kho + (3) phần tiền giữ chân CẤN TRỪ khi quyết toán (hư hại, thu hồi ưu đãi, phí, nợ cấn vào tiền giữ
 * chân — các khoản nợ đó bị CANCELLED nên không được để mất) + (4) tiền thanh lý dùng trừ nợ. Tiền giữ chân khách gửi / được hoàn báo
 * riêng ở `deposits`; phần tiền thanh lý còn dư trả lại khách (LIQUIDATION_PAYOUT) là tiền của khách — không trừ vào doanh thu; khoản
 * hoàn sau khiếu nại biên bản trả kho trừ ra (đã tính vào doanh thu lúc cấn trừ). Đợt 17 (B3): chi bồi thường (COMPENSATION) là khoản CHI,
 * không phải giảm doanh thu — không trừ vào `total`, không nằm trong cơ cấu; báo riêng ở `claimPayouts`.
 */
export interface RevenueMonthRow {
  /** "YYYY-MM" theo giờ VN. */
  month: string;
  /** Doanh thu tháng = tổng các thành phần ở `breakdown`. */
  total: number;
  byFacility: Record<string, number>;
  /** Tiền giữ chân: đã thu / đã hoàn trong tháng, và phần chuyển thành doanh thu (giữ lại khi huỷ + cấn trừ khi quyết toán). */
  deposits: { collected: number; refunded: number; retained: number };
  /** Cơ cấu doanh thu (đợt 15, C4) — cộng lại đúng bằng `total`. */
  breakdown: RevenueBreakdown;
  /** Theo loại khoản (PaymentType) cho phần thực thu, cộng các nguồn RETAINED_DEPOSIT / SETTLEMENT_OFFSET / LIQUIDATION. */
  bySource: Record<string, number>;
  /** Đợt 17 (B3): chi bồi thường đã chi trong tháng — dòng riêng ngoài doanh thu. */
  claimPayouts: number;
}
export interface RevenueBreakdown { payments: number; retainedDeposits: number; settlementOffsets: number; liquidation: number }

/** Nguồn doanh thu không phải một khoản thu tiền (đợt 15, C4). */
export type RevenueSource = PaymentType | 'RETAINED_DEPOSIT' | 'SETTLEMENT_OFFSET' | 'LIQUIDATION';
export const REVENUE_SOURCE_LABEL: Record<'RETAINED_DEPOSIT' | 'SETTLEMENT_OFFSET' | 'LIQUIDATION', string> = {
  RETAINED_DEPOSIT: 'Tiền giữ chân giữ lại (huỷ sát ngày, không đến)',
  SETTLEMENT_OFFSET: 'Tiền giữ chân cấn trừ khi quyết toán',
  LIQUIDATION: 'Tiền thanh lý dùng trừ nợ',
};

export const REVENUE_LABEL = 'Doanh thu';
export const DEPOSITS_LABEL = 'Tiền giữ chân';
export const CLAIM_PAYOUTS_LABEL = 'Chi bồi thường';

type Id = unknown;
const sid = (x: Id) => (x == null ? '' : String(x));
type Iso = string | Date;
const isoOf = (d: Iso) => (typeof d === 'string' ? d : d.toISOString());

export interface RevenuePaymentLike {
  _id: Id; facilityId: Id; type: PaymentType; direction: 'CHARGE' | 'REFUND'; amount: number; status: string; method: string;
  paidAt?: Iso | null; refundOf?: Id | null; reservationId?: Id | null; refundedAmount?: number | null;
}
export interface RevenueReservationLike { _id: Id; facilityId: Id; status: string; cancellation?: { cancelledAt?: Iso | null } | null }
export interface RevenueInspectionLike {
  facilityId: Id; type: string; performedAt: Iso;
  depositSettlement?: { depositHeld: number; deductions?: number | null; refundAmount?: number | null; proceedsApplied?: number | null } | null;
  adjustments?: readonly { refundPaymentId?: Id | null }[] | null;
}

const collectedStatus = (s: string) => (COLLECTED_PAYMENT_STATUSES as readonly string[]).includes(s);

/**
 * Doanh thu theo tháng (`months` = các khoá "YYYY-MM" theo giờ VN, theo thứ tự hiển thị) của các chi nhánh `facilityIds` — MỘT công thức
 * cho báo cáo ở BE và trang báo cáo ở Webapp (đợt 15, C4). `payments` gồm cả các khoản gốc mà dòng hoàn trỏ tới (để biết loại) và khoản
 * tiền giữ chân của các đặt chỗ đã huỷ; `inspections` = biên bản trả kho / xử lý hàng bỏ lại (cả biên bản có điều chỉnh tạo ra dòng hoàn).
 */
export function revenueRows(input: {
  months: readonly string[]; facilityIds: readonly Id[];
  payments: readonly RevenuePaymentLike[]; reservations: readonly RevenueReservationLike[]; inspections: readonly RevenueInspectionLike[];
}): RevenueMonthRow[] {
  const facs = new Set(input.facilityIds.map(sid));
  const rows = input.months.map((month) => ({
    month, total: 0, byFacility: {} as Record<string, number>, deposits: { collected: 0, refunded: 0, retained: 0 },
    breakdown: { payments: 0, retainedDeposits: 0, settlementOffsets: 0, liquidation: 0 }, bySource: {} as Record<string, number>, claimPayouts: 0,
  }));
  const rowOf = (at: Iso | null | undefined) => (at ? rows.find((r) => r.month === monthKey(isoOf(at))) : undefined);
  const add = (row: RevenueMonthRow, facilityId: Id, part: keyof RevenueBreakdown, source: string, v: number) => {
    if (!v) return;
    row.total += v;
    row.breakdown[part] += v;
    row.byFacility[sid(facilityId)] = (row.byFacility[sid(facilityId)] ?? 0) + v;
    row.bySource[source] = (row.bySource[source] ?? 0) + v;
  };
  const typeOf = new Map(input.payments.map((p) => [sid(p._id), p.type]));
  // Khoản hoàn do điều chỉnh biên bản trả kho (khách khiếu nại đúng) — trả lại phần đã ghi doanh thu lúc cấn trừ, dù trỏ tới khoản nào.
  const adjustRefunds = new Set(input.inspections.flatMap((i) => (i.adjustments ?? []).map((a) => sid(a.refundPaymentId)).filter(Boolean)));

  // (1) Thực thu: khoản thành công (kể cả về sau đã hoàn — dòng hoàn trừ riêng), không gồm bút toán nội bộ, tháng theo giờ VN.
  const seen = new Set<string>();
  for (const p of input.payments) {
    const id = sid(p._id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (!facs.has(sid(p.facilityId)) || !collectedStatus(p.status) || p.method === 'INTERNAL' || !p.paidAt) continue;
    const row = rowOf(p.paidAt);
    if (!row) continue;
    // Phần tiền thanh lý còn dư trả lại khách: tiền của khách (tiền thanh lý chỉ tính phần trừ nợ — (4)) → không trừ vào doanh thu.
    if (p.type === 'LIQUIDATION_PAYOUT') continue;
    // Đợt 17 (B3): chi bồi thường là khoản chi, không phải giảm doanh thu (chốt ca tiền mặt vẫn tính ở cashReport).
    if (p.type === 'COMPENSATION') { row.claimPayouts += p.amount; continue; }
    const out = p.direction === 'REFUND';
    const deposit = p.type === 'DEPOSIT' || (out && !adjustRefunds.has(id) && typeOf.get(sid(p.refundOf)) === 'DEPOSIT');
    if (deposit) {
      if (out) row.deposits.refunded += p.amount; else row.deposits.collected += p.amount;
      continue;
    }
    add(row, p.facilityId, 'payments', p.type, out ? -p.amount : p.amount);
  }

  // (2) Tiền giữ chân bị giữ lại khi đặt chỗ huỷ (khách huỷ sát ngày — hoàn theo bậc, hết hạn, không đến nhận kho): số đã thu − số đã hoàn.
  const depositsOf = new Map<string, RevenuePaymentLike[]>();
  for (const p of input.payments) {
    if (p.type !== 'DEPOSIT' || !p.reservationId) continue;
    const k = sid(p.reservationId);
    if (!(depositsOf.get(k) ?? []).some((x) => sid(x._id) === sid(p._id))) depositsOf.set(k, [...(depositsOf.get(k) ?? []), p]);
  }
  for (const r of input.reservations) {
    if (r.status !== 'CANCELLED' || !facs.has(sid(r.facilityId))) continue;
    const row = rowOf(r.cancellation?.cancelledAt);
    if (!row) continue;
    const kept = (depositsOf.get(sid(r._id)) ?? [])
      .filter((p) => collectedStatus(p.status) && p.method !== 'INTERNAL')
      .reduce((s, p) => s + Math.max(0, p.amount - (p.refundedAmount ?? 0)), 0);
    if (kept > 0) { row.deposits.retained += kept; add(row, r.facilityId, 'retainedDeposits', 'RETAINED_DEPOSIT', kept); }
  }

  // (3) + (4) Quyết toán (trả kho / xử lý hàng bỏ lại): phần tiền giữ chân cấn trừ, và tiền thanh lý dùng trừ nợ — tháng lập biên bản.
  for (const i of input.inspections) {
    const ds = i.depositSettlement;
    if (!ds || (i.type !== 'MOVE_OUT' && i.type !== 'ABANDONMENT') || !facs.has(sid(i.facilityId))) continue;
    const row = rowOf(i.performedAt);
    if (!row) continue;
    const applied = Math.max(0, ds.deductions ?? ds.depositHeld - (ds.refundAmount ?? 0));
    if (applied > 0) { row.deposits.retained += applied; add(row, i.facilityId, 'settlementOffsets', 'SETTLEMENT_OFFSET', applied); }
    if (i.type === 'ABANDONMENT') add(row, i.facilityId, 'liquidation', 'LIQUIDATION', Math.max(0, ds.proceedsApplied ?? 0));
  }
  return rows;
}
