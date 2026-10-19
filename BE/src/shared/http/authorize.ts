import type { RequestHandler } from 'express';
import type { Role } from '@ssm/shared';
import { Forbidden, Unauthorized } from '../core/errors';
import { auditDenied } from '../../features/audit/audit.service';
import { ROLES_TAG, tag } from './tags';

/** Role gate. Facility scoping is enforced separately (middleware + service-level checks). */
export const authorize = (...roles: Role[]): RequestHandler => tag<RequestHandler>(async (req, _res, next) => {
  const user = req.auth?.user;
  if (!user) throw Unauthorized();
  if (!roles.includes(user.role)) {
    await auditDenied(`access.${req.method.toLowerCase()}:${req.baseUrl}${req.route?.path ?? ''}`, `Vai trò ${user.role} không thuộc [${roles.join(', ')}]`);
    throw Forbidden();
  }
  next();
}, ROLES_TAG, roles);
