import type { ClientSession, Types } from 'mongoose';
import { LOCKOUT_MIN_NOTICE_DAYS, type Actor } from '@ssm/shared';
import { StorageUnitModel } from '../../shared/db/models';
import type { RentalContractHydrated } from './rental-contract.model';
import { audit } from '../audit/audit.service';
import { createPayment } from '../payments/payment.service';
import { addNotice, type PendingNotice } from './contract-notice.service';
import { addDays } from '../../shared/utils/dates';

/**
 * Khoá truy cập vì nợ quá hạn — DÙNG CHUNG cho job (tự động) và Quản lý chi nhánh (khoá tay), để hai đường cùng thu phí cố định
 * khi khoá theo chính sách khách đã ký, cùng gắn khoá chặn ô và cùng gửi thông báo. Gọi trong transaction; thông báo trả về để
 * gửi SAU khi commit.
 */
export async function applyLockout(
  c: RentalContractHydrated,
  policy: { lateFees: { kind: string; value: number }[] },
  actor: { role: Actor; by?: Types.ObjectId | null; reason: string },
  session: ClientSession,
): Promise<PendingNotice> {
  const fixed = policy.lateFees.find((f) => f.kind === 'FIXED');
  if (fixed?.value) {
    // Cùng khoá idempotency với job: một đợt nợ (theo paidThrough) chỉ thu phí khoá một lần dù job và quản lý cùng thao tác.
    await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'LATE_FEE', amount: fixed.value, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `lock-${c._id}-${c.billing.paidThrough.toISOString().slice(0, 10)}` }, session);
    c.balance.outstanding += fixed.value;
    c.delinquency!.lateFeesAccrued += fixed.value;
  }
  c.transitionTo('LOCKED_OUT', { actor: actor.role, by: actor.by ?? null, reason: actor.reason });
  c.delinquency!.lockedOutAt = new Date();
  c.access.suspendedAt = new Date();
  await StorageUnitModel.updateOne({ _id: c.unitId, status: 'OCCUPIED' }, { $set: { overlockActive: true } }, { session });
  await audit({ action: 'contract.lockout', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: actor.reason, changes: { after: { lockFee: fixed?.value ?? 0 } } }, session);
  return addNotice(c, 'LOCKED_OUT', { amountDue: c.balance.outstanding, by: actor.by ?? undefined });
}

/**
 * Thông báo HẾT ÂN HẠN (GRACE_EXPIRED, Điều 7) của đợt nợ: ghi kèm NGÀY KHOÁ = max(ngày bắt đầu quá hạn + lockoutAfterDays + 1, hôm nay
 * + LOCKOUT_MIN_NOTICE_DAYS) vào thông báo và delinquency.lockFrom — ngày khoá luôn ở tương lai, khách luôn có ít nhất
 * LOCKOUT_MIN_NOTICE_DAYS ngày kể từ khi được báo (kể cả khi job chạy bù sau khi server ngủ). Gọi trong transaction.
 */
export function addGraceNotice(c: RentalContractHydrated, overdueFrom: Date, today: Date, note?: string): PendingNotice {
  const byContract = addDays(overdueFrom, c.terms.lockoutAfterDays + 1);
  const minDay = addDays(today, LOCKOUT_MIN_NOTICE_DAYS);
  const lockFrom = byContract > minDay ? byContract : minDay;
  c.delinquency!.lockFrom = lockFrom;
  return addNotice(c, 'GRACE_EXPIRED', { amountDue: c.balance.outstanding, deadline: lockFrom, note });
}

/**
 * Ngày sớm nhất được khoá quyền ra vào (job và Quản lý chi nhánh dùng chung) = ngày khoá đã báo khách trong thông báo hết ân hạn
 * (delinquency.lockFrom). null = đợt nợ này chưa được báo (dữ liệu cũ) — job báo ở lượt kế tiếp. Điều kiện số ngày quá hạn theo hợp
 * đồng kiểm riêng.
 */
export const lockoutFrom = (c: Pick<RentalContractHydrated, 'delinquency'>): Date | null => c.delinquency?.lockFrom ?? null;
