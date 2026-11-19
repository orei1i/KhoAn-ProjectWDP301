import type { InspectionStatus, ItemCondition } from './enums';

/**
 * Biên bản kiểm tra và quyết toán khi trả kho (Điều 9 Điều khoản) — dùng chung BE / Webapp / app.
 */

/**
 * Đợt 17 — trả kho ba bước: nhân viên kiểm ô và ghi lỗi (mô tả, mức độ, ảnh — không ghi tiền); Quản lý chi nhánh ghi phí sửa chữa / phí
 * khác rồi duyệt; khách xác nhận sau cùng bằng mã OTP. Hạn mức "nhân viên ghi hư hại tối đa 2.000.000 ₫" (DAMAGE_STAFF_LIMIT, lỗi
 * DAMAGE_NEEDS_FM) đã bỏ — nhân viên không còn ghi tiền.
 */
/** Danh mục kiểm tra khi trả kho — mỗi mục chỉ đánh dấu "đã kiểm"; hư hại (nếu có) ghi riêng. Dùng chung web, seed. */
export const MOVE_OUT_CHECKLIST = ['Cửa cuốn / cửa kho', 'Ổ khóa', 'Sàn', 'Tường & vách ngăn', 'Trần / chống thấm', 'Vệ sinh chung'] as const;
/** Tối đa số dòng phí khác trong một biên bản trả kho. */
export const MOVE_OUT_OTHER_FEES_MAX = 10;
/** Gợi ý tên phí khác cho quản lý (vẫn gõ được tên khác). */
export const MOVE_OUT_FEE_PRESETS = ['Vệ sinh ô kho', 'Thay ổ khoá', 'Dọn rác / đồ bỏ đi'] as const;

/** Bước hiện tại của một lượt trả kho đang mở (hợp đồng MOVE_OUT_PENDING); null = hợp đồng không đang trả kho. */
export type MoveOutStage = 'AWAITING_HANDOVER' | 'AWAITING_INSPECTION' | 'RETURNED' | 'AWAITING_APPROVAL' | 'AWAITING_CONFIRMATION';

/**
 * `report`: biên bản MOVE_OUT của hợp đồng (nếu có). Chưa thu hồi quyền vào kho = chờ khách bàn giao; đã nhận ô, chưa có biên bản = chờ
 * nhân viên kiểm; còn lại theo trạng thái biên bản — dùng chung staff / quản lý / cổng khách / app.
 */
export function moveOutStageOf(c: { status: string; access: { revokedAt?: unknown } }, report?: { status: InspectionStatus } | null): MoveOutStage | null {
  if (c.status !== 'MOVE_OUT_PENDING') return null;
  if (report?.status === 'SUBMITTED') return 'AWAITING_APPROVAL';
  if (report?.status === 'RETURNED') return 'RETURNED';
  if (report?.status === 'FM_APPROVED') return 'AWAITING_CONFIRMATION';
  return c.access.revokedAt ? 'AWAITING_INSPECTION' : 'AWAITING_HANDOVER';
}

/** Tổng tiền trừ vào quyết toán của một biên bản: phí sửa chữa từng hư hại + phí khác. */
export const moveOutFeeTotal = (i: { damages: readonly { cost: number }[]; otherFees?: readonly { amount: number }[] | null }) =>
  i.damages.reduce((s, d) => s + (d.cost || 0), 0) + (i.otherFees ?? []).reduce((s, f) => s + (f.amount || 0), 0);

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
  /** Điều khoản 1.24: phí lưu giữ từ ngày hết hạn tới ngày bàn giao — trừ như công nợ. Thiếu (biên bản cũ) = 0. */
  storageFee?: number;
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
  const owed = i.damage + (i.storageFee ?? 0) + i.priorOutstanding;
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
