import type { ClientSession, Types } from 'mongoose';
import type { Actor } from '@ssm/shared';
import { StorageUnitModel } from '../../shared/db/models';
import type { RentalContractHydrated } from './rental-contract.model';
import { audit } from '../audit/audit.service';
import { createPayment } from '../payments/payment.service';
import { addNotice, type PendingNotice } from './contract-notice.service';

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
