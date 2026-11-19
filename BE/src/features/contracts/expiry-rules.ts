import { usesGraceHold } from '@ssm/shared';
import { StorageUnitModel } from '../../shared/db/models';
import { Unprocessable } from '../../shared/core/errors';
import { todayUTC } from '../../shared/utils/dates';
import type { ClientSession, Types } from 'mongoose';

/**
 * Điều khoản 1.24 — đổi ô / đổi cỡ kho chỉ trong thời hạn: hợp đồng theo quy tắc hết hạn đã qua ngày hết hạn (đang ân hạn) hoặc đã khoá
 * (EXPIRED) → 422 CONTRACT_EXPIRED (gia hạn trước). Hợp đồng cũ (không có `expiry`) giữ nguyên kiểm tra trạng thái như trước.
 */
export function assertNotPastTerm(c: { status: string; endDate: Date; expiry?: { rule?: string | null } | null }) {
  if (c.status === 'EXPIRED' || (usesGraceHold(c) && todayUTC().getTime() >= c.endDate.getTime())) {
    throw Unprocessable('Hợp đồng đã hết hạn — gia hạn trước khi đổi ô / đổi cỡ', 'CONTRACT_EXPIRED');
  }
}

/** Khoá chặn ô (overlock) của hợp đồng hết hạn đã khoá: gắn lại khi khoá / rút đăng ký trả kho tại quầy, gỡ khi nhân viên đăng ký trả kho. */
export async function setExpiryOverlock(unitId: Types.ObjectId, on: boolean, session: ClientSession) {
  await StorageUnitModel.updateOne({ _id: unitId, status: 'OCCUPIED' }, { $set: { overlockActive: on } }, { session });
}
