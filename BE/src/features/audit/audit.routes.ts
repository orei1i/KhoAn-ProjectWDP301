import { Router } from 'express';
import { z } from 'zod';
import { AuditLogModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { paging, validate, zId } from '../../shared/http/validate';

// ---------------------------------------------------------------- audit log (ADMIN)
export const auditRouter = Router();
auditRouter.use(authenticate, authorize('ADMIN'));
auditRouter.get('/', validate({ query: paging.extend({ result: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(), action: z.string().max(60).optional(), facilityId: zId.optional() }) }), async (req, res) => {
  const { page, limit, result, action, facilityId } = req.valid.query;
  const filter: Record<string, unknown> = {};
  if (result) filter.result = result;
  if (action) filter.action = { $regex: `^${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
  if (facilityId) filter.facilityId = facilityId;
  const items = await AuditLogModel.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).populate('actorId', 'fullName email role');
  res.json({ items, page, limit });
});
