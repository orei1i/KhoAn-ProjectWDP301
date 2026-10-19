import { Router } from 'express';
import { z } from 'zod';
import { FacilityModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { assertFacility, isScoped } from '../../shared/http/scope';
import { validate, zId } from '../../shared/http/validate';
import { occupancy, receivables, revenueByMonth } from './report.service';

// ---------------------------------------------------------------- reports (FM scoped, OPS chain-wide)
export const reportsRouter = Router();
reportsRouter.use(authenticate, authorize('FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'));
reportsRouter.get('/summary', validate({ query: z.object({ facilityId: zId.optional(), months: z.coerce.number().int().min(1).max(24).default(6) }) }), async (req, res) => {
  const u = req.auth!.user;
  let ids: string[];
  if (req.valid.query.facilityId) { await assertFacility(u, req.valid.query.facilityId); ids = [req.valid.query.facilityId]; }
  else ids = isScoped(u) ? u.facilityIds.map(String) : (await FacilityModel.find({ status: 'ACTIVE' }, { _id: 1 }).lean()).map((f) => String(f._id));
  const [occ, revenue, ar] = await Promise.all([occupancy(ids), revenueByMonth(ids, req.valid.query.months), receivables(ids)]);
  res.json({ facilityIds: ids, occupancy: occ, revenue, receivables: ar });
});
