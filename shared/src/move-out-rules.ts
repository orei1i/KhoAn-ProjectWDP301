import type { ItemCondition } from './enums';

/**
 * Biên bản kiểm tra và quyết toán khi trả kho (Điều 9 Điều khoản) — dùng chung BE / Webapp / app.
 */

/** Nhân viên tự ghi chi phí hư hại tối đa mức này trong một biên bản; lớn hơn phải Quản lý chi nhánh lập (kiểm soát hai cấp). */
export const DAMAGE_STAFF_LIMIT = 2_000_000;

/** Khách khiếu nại biên bản trả kho trong số ngày này kể từ NGÀY lập biên bản (tính theo giờ Việt Nam, hết ngày thứ 7). */
export const INSPECTION_DISPUTE_DAYS = 7;

const VN_OFFSET_MS = 7 * 3_600_000; // Việt Nam không đổi giờ mùa hè
const DAY_MS = 86_400_000;

/** Thời điểm hết hạn khiếu nại (ms): 00:00 giờ Việt Nam của ngày thứ INSPECTION_DISPUTE_DAYS + 1 sau ngày lập biên bản. */
export function inspectionDisputeDeadline(performedAt: string | Date): number {
  const local = new Date(new Date(performedAt).getTime() + VN_OFFSET_MS);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - VN_OFFSET_MS;
  return localMidnight + (INSPECTION_DISPUTE_DAYS + 1) * DAY_MS;
}

/** Biên bản lập lúc `performedAt` còn trong hạn khiếu nại tại thời điểm `now` (mặc định: bây giờ) không. */
export const canDisputeInspection = (performedAt: string | Date, now: string | Date = new Date()) =>
  new Date(now).getTime() < inspectionDisputeDeadline(performedAt);

/**
 * Đầu vào quyết toán tiền giữ chân lúc trả kho. Lưu cùng biên bản để khi khách khiếu nại đúng, quyết toán được TÍNH LẠI y hệt với
 * mức hư hại mới (trần hoàn khi trả sớm, thu hồi ưu đãi, tiền thuê trả trước cấn trừ…) rồi chỉ trả phần chênh lệch.
 */
export interface SettlementInputs {
  deposit: number;
  damage: number;
  /** Công nợ của hợp đồng ngay trước khi lập biên bản (tiền thuê, phí trễ… chưa trả). */
  priorOutstanding: number;
  /** Trần tiền giữ chân được hoàn khi trả SỚM hợp đồng có ưu đãi (đồng); null = không giới hạn. */
  refundCap: number | null;
  /** Ưu đãi thuê dài hạn phải thu hồi (đầy đủ, trước khi giới hạn theo phần tiền giữ chân còn lại). */
  clawbackDue: number;
  /** Tiền thuê trả trước của các kỳ gia hạn chưa bắt đầu tại ngày bàn giao. */
  prepaidUnused: number;
}

export interface SettlementResult {
  /** Tiền giữ chân hoàn lại khách. */
  refund: number;
  /** Phần tiền giữ chân bị giữ lại (hư hại, công nợ, giới hạn trả sớm, thu hồi ưu đãi). */
  deductions: number;
  /** Khách còn nợ sau quyết toán. */
  shortfall: number;
  clawback: number;
  prepaidOffset: number;
  prepaidRefund: number;
}

/** Quyết toán tiền giữ chân — MỘT công thức cho lúc trả kho và lúc tính lại sau khiếu nại. */
export function settleDeposit(i: SettlementInputs): SettlementResult {
  const owed = i.damage + i.priorOutstanding;
  const normal = Math.min(i.deposit, owed);
  let refund = i.deposit - normal;
  let shortfall = owed - normal;
  if (i.refundCap !== null) refund = Math.min(refund, i.refundCap);
  const clawback = Math.min(refund, i.clawbackDue);
  refund -= clawback;
  const prepaidOffset = Math.min(i.prepaidUnused, shortfall);
  shortfall -= prepaidOffset;
  return { refund, deductions: i.deposit - refund, shortfall, clawback, prepaidOffset, prepaidRefund: i.prepaidUnused - prepaidOffset };
}

/** Vị thế ròng của khách sau quyết toán: dương = khách còn nợ KhoAn, âm = KhoAn phải trả khách. */
export const settlementNet = (r: SettlementResult) => r.shortfall - r.refund - r.prepaidRefund;

export const ITEM_CONDITION_LABEL: Record<ItemCondition, string> = { OK: 'Bình thường', DAMAGED: 'Hư hỏng', MISSING: 'Thiếu' };
export const DAMAGE_SEVERITY_LABEL: Record<'MINOR' | 'MODERATE' | 'SEVERE', string> = { MINOR: 'nhẹ', MODERATE: 'vừa', SEVERE: 'nặng' };
