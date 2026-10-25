import { Router } from 'express';
import { z } from 'zod';
import { AuditLogModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { paging, validate, zId } from '../../shared/http/validate';
import { scopeFilter, scopeQueryFacility } from '../../shared/http/scope';

// ---------------------------------------------------------------- audit log (ADMIN, OPS toàn chuỗi, FM chi nhánh mình)
export const auditRouter = Router();
auditRouter.use(authenticate, authorize('ADMIN', 'OPS_MANAGER', 'FACILITY_MANAGER'));
/**
 * Nhật ký kiểm toán: Quản trị viên và Quản lý vận hành xem toàn chuỗi; Quản lý chi nhánh chỉ thấy bản ghi của chi nhánh mình (lọc theo
 * facilityId — bản ghi không gắn chi nhánh như thao tác tài khoản không hiện), `facilityId` ngoài phạm vi → 403 FACILITY_SCOPE.
 */
auditRouter.get('/', validate({ query: paging.extend({ result: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(), action: z.string().max(60).optional(), facilityId: zId.optional() }) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, result, action, facilityId } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user) };
  if (result) filter.result = result;
  if (action) filter.action = { $regex: `^${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
  if (facilityId) filter.facilityId = facilityId;
  const items = await AuditLogModel.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).populate('actorId', 'fullName email role');
  res.json({ items, page, limit });
});
