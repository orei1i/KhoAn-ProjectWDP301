import { Router } from 'express';
import { z } from 'zod';
import { TEMPLATE_LIMITS } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { assertFacility } from '../../shared/http/scope';
import { idParams, validate, zId } from '../../shared/http/validate';
import { effectiveTemplate, listTemplates, publishTemplate, retireFacilityTemplate } from './contract-template.service';

/**
 * Mẫu hợp đồng: Quản lý vận hành soạn lời văn từng điều và phát hành thành phiên bản (toàn chuỗi hoặc riêng một chi nhánh).
 * Số liệu (tiền, mức hoàn…) luôn do hệ thống điền qua biến `{{...}}` — xem shared/contract-template.ts.
 */
export const contractTemplatesRouter = Router();
contractTemplatesRouter.use(authenticate);

const line = z.string().max(TEMPLATE_LIMITS.lineMax);
const clause = z.object({
  key: z.string().min(1).max(40), title: z.string().max(TEMPLATE_LIMITS.titleMax), numbered: z.boolean(),
  paragraphs: z.array(line).max(TEMPLATE_LIMITS.linesPerClause), bullets: z.array(line).max(TEMPLATE_LIMITS.linesPerClause),
});

/** Mẫu đang áp dụng (riêng chi nhánh → toàn chuỗi → mặc định hệ thống, version 0). */
contractTemplatesRouter.get('/effective', authorize('OPS_MANAGER', 'ADMIN', 'FACILITY_MANAGER'), validate({ query: z.object({ facilityId: zId.optional() }) }), async (req, res) => {
  const fid = req.valid.query.facilityId;
  if (fid) await assertFacility(req.auth!.user, fid);
  res.json(await effectiveTemplate(fid ?? null));
});

/** Lịch sử phiên bản của một phạm vi (toàn chuỗi, hoặc một chi nhánh). */
contractTemplatesRouter.get('/', authorize('OPS_MANAGER', 'ADMIN', 'FACILITY_MANAGER'), validate({ query: z.object({ facilityId: zId.optional() }) }), async (req, res) => {
  const fid = req.valid.query.facilityId;
  if (fid) await assertFacility(req.auth!.user, fid);
  res.json({ items: await listTemplates(fid ?? null) });
});

contractTemplatesRouter.post('/', authorize('OPS_MANAGER'), validate({ body: z.object({
  facilityId: zId.nullable().default(null), clauses: z.array(clause).min(1).max(20), note: z.string().trim().max(500).optional(),
}) }), async (req, res) => {
  const { facilityId, clauses, note } = req.valid.body;
  res.status(201).json(await publishTemplate(facilityId, { clauses, note }));
});

/** Chi nhánh bỏ mẫu riêng → dùng lại mẫu toàn chuỗi. */
contractTemplatesRouter.delete('/facility/:id', authorize('OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await retireFacilityTemplate(req.valid.params.id));
});
