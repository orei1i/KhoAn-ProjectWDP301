import type { RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { FACILITY_SCOPED_ROLES } from '@ssm/shared';
import { Forbidden, Unauthorized } from '../core/errors';
import type { UserHydrated } from '../db/models';
import { auditDenied } from '../../features/audit/audit.service';

type Id = Types.ObjectId | string;
export const isScoped = (u: UserHydrated) => FACILITY_SCOPED_ROLES.includes(u.role);

/** Mongo filter fragment restricting a query to the caller's data. Spread into every list query. */
export function scopeFilter(u: UserHydrated, opts: { customerField?: string } = {}): Record<string, unknown> {
  if (u.role === 'CUSTOMER') return opts.customerField ? { [opts.customerField]: u._id } : { _id: null };
  if (isScoped(u)) return { facilityId: { $in: u.facilityIds } };
  return {};
}

export async function assertFacility(u: UserHydrated, facilityId: Id, action = 'access.facility_scope') {
  if (!isScoped(u)) return;
  if (!u.facilityIds.some((f) => String(f) === String(facilityId))) {
    await auditDenied(action, `${u.role} không được phân quyền cho chi nhánh ${facilityId}`, facilityId);
    throw Forbidden('Bạn không được phân quyền cho chi nhánh này', 'FACILITY_SCOPE');
  }
}

/** Entity-level guard: customers must own it, facility staff must be scoped to it, ops/admin pass. */
export async function assertCanAccess(u: UserHydrated, doc: { facilityId: Id; customerId?: Id; reporterId?: Id }, action?: string) {
  if (u.role === 'CUSTOMER') {
    const owner = doc.customerId ?? doc.reporterId;
    if (!owner || String(owner) !== String(u._id)) {
      await auditDenied(action ?? 'access.ownership', 'Khách truy cập dữ liệu không thuộc về mình', doc.facilityId);
      throw Forbidden('Bạn chỉ thao tác được trên dữ liệu của mình', 'OWNERSHIP');
    }
    return;
  }
  await assertFacility(u, doc.facilityId, action);
}

/** For list endpoints taking ?facilityId= : reject out-of-scope ids up front. */
export const scopeQueryFacility: RequestHandler = async (req, _res, next) => {
  const u = req.auth?.user;
  if (!u) throw Unauthorized();
  const fid = (req.valid.query?.facilityId ?? req.query.facilityId) as string | undefined;
  if (fid) await assertFacility(u, fid);
  next();
};
