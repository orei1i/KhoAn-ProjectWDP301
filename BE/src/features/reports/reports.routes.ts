import { Router } from 'express';
import { z } from 'zod';
import { FacilityModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { assertFacility, isScoped } from '../../shared/http/scope';
import { validate, zId } from '../../shared/http/validate';
import { todayUTC } from '../../shared/utils/dates';
import { cashReport, occupancy, receivables, revenueByMonth } from './report.service';

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

/** Chốt ca tiền mặt một ngày (giờ VN) của một chi nhánh: tiền mặt từng nhân viên đã thu / đã chi (C3). */
reportsRouter.get('/cash', validate({ query: z.object({
  facilityId: zId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD').optional().describe('Mặc định hôm nay (giờ VN)'),
}) }), async (req, res) => {
  await assertFacility(req.auth!.user, req.valid.query.facilityId, 'report.cash');
  const date = req.valid.query.date ?? todayUTC().toISOString().slice(0, 10);
  res.json(await cashReport(req.valid.query.facilityId, date));
});
