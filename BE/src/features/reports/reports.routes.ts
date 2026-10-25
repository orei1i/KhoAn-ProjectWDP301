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
  let occIds: string[];
  if (req.valid.query.facilityId) { await assertFacility(u, req.valid.query.facilityId); ids = [req.valid.query.facilityId]; occIds = ids; }
  else if (isScoped(u)) { ids = u.facilityIds.map(String); occIds = ids; }
  else {
    // Toàn chuỗi (F): doanh thu, công nợ, khách tính MỌI chi nhánh — kể cả chi nhánh đã ngừng hoạt động (nợ / tiền của khách ở đó vẫn
    // là của chuỗi); công suất chỉ tính chi nhánh đang hoạt động (occupancyScope).
    const all = await FacilityModel.find({}, { _id: 1, status: 1 }).lean();
    ids = all.map((f) => String(f._id));
    occIds = all.filter((f) => f.status === 'ACTIVE').map((f) => String(f._id));
  }
  const [occ, revenue, ar] = await Promise.all([occupancy(occIds), revenueByMonth(ids, req.valid.query.months), receivables(ids)]);
  res.json({ facilityIds: ids, occupancyFacilityIds: occIds, occupancyScope: occIds.length === ids.length ? 'ALL' : 'ACTIVE_ONLY', occupancy: occ, revenue, receivables: ar });
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
