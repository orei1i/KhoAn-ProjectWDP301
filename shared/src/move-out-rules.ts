import type { ItemCondition } from './enums';
import { daysBetween } from './format';

/**
 * Biên bản kiểm tra khi trả kho (Điều 9 Điều khoản) — dùng chung BE / Webapp / app.
 */

/** Nhân viên tự ghi chi phí hư hại tối đa mức này trong một biên bản; lớn hơn phải Quản lý chi nhánh lập (kiểm soát hai cấp). */
export const DAMAGE_STAFF_LIMIT = 2_000_000;

/** Khách khiếu nại biên bản trả kho trong số ngày này kể từ ngày lập biên bản. */
export const INSPECTION_DISPUTE_DAYS = 7;

/** Biên bản lập ngày `performedAt` còn trong hạn khiếu nại tại ngày `today` không. */
export const canDisputeInspection = (performedAt: string, today: string) => daysBetween(performedAt, today) <= INSPECTION_DISPUTE_DAYS;

export const ITEM_CONDITION_LABEL: Record<ItemCondition, string> = { OK: 'Bình thường', DAMAGED: 'Hư hỏng', MISSING: 'Thiếu' };
export const DAMAGE_SEVERITY_LABEL: Record<'MINOR' | 'MODERATE' | 'SEVERE', string> = { MINOR: 'nhẹ', MODERATE: 'vừa', SEVERE: 'nặng' };
