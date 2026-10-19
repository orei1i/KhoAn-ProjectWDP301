import { withPolicyDefaults, type BusinessPolicy } from '@ssm/shared';
import { FacilityModel, PolicyModel } from '../../shared/db/models';
import { NotFound, Unprocessable } from '../../shared/core/errors';
import { effectivePolicy } from './pricing';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';

type Patch = Partial<Pick<BusinessPolicy, 'gracePeriodDays' | 'lockoutAfterDays' | 'abandonAfterLockedOutDays' | 'accessFees' | 'reservationHoldMinutes' | 'allocationLeadDays' | 'noShowAfterHours'
  | 'minPeriods' | 'maxPeriods' | 'deposit' | 'lateFees' | 'cancellation' | 'earlyTermination' | 'surcharges' | 'discounts' | 'waiverLimits'>>;

/** Policies are immutable: publishing clones the current effective rules + patch into a new version. */
export async function publishPolicy(facilityId: string | null, patch: Patch) {
  return withTxn(async (session) => {
    const scope = facilityId ? 'FACILITY' : 'GLOBAL';
    if (facilityId && !(await FacilityModel.exists({ _id: facilityId }).session(session))) throw NotFound('chi nhánh');
    const current = facilityId ? await effectivePolicy(facilityId, session) : await PolicyModel.findOne({ scope: 'GLOBAL', isActive: true }).session(session);
    if (!current) throw NotFound('chính sách hiện hành');

    const base = current.toObject() as unknown as Record<string, unknown>;
    for (const k of ['_id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', '__v']) delete base[k];
    // Bản cũ chưa có earlyTermination/abandonAfterLockedOutDays: điền mặc định để phiên bản mới luôn hợp lệ dù patch không nhắc tới.
    const next = { ...withPolicyDefaults(base), ...patch };
    if ((next.lockoutAfterDays as number) <= (next.gracePeriodDays as number)) throw Unprocessable('Số ngày khóa truy cập phải lớn hơn thời gian ân hạn');

    const last = await PolicyModel.findOne({ scope, facilityId: facilityId ?? null }).sort({ version: -1 }).session(session);
    await PolicyModel.updateMany({ scope, facilityId: facilityId ?? null, isActive: true }, { $set: { isActive: false } }, { session });
    const [pol] = await PolicyModel.create([{ ...next, scope, facilityId: facilityId ?? null, version: (last?.version ?? 0) + 1, isActive: true, effectiveFrom: new Date() }], { session });
    if (facilityId) await FacilityModel.updateOne({ _id: facilityId }, { $set: { policyId: pol._id } }, { session });
    await audit({ action: 'policy.publish', entityType: 'BusinessPolicy', entityId: pol._id, facilityId, changes: { before: { version: current.version }, after: { version: pol.version, ...patch } } }, session);
    return pol;
  });
}
