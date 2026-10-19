import { Router } from 'express';
import { z } from 'zod';
import { enumValues, PaymentMethod } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { idParams, validate, zId } from '../../shared/http/validate';
import { cancelAccessRequest, completeAccessRequest, createAccessRequest, decideAccessRequest } from './access.service';

/**
 * Yêu cầu cấp lại mật khẩu / thẻ khoá / chìa khoá. Danh sách đi qua GET /bootstrap giống các thực thể khác;
 * xem mật khẩu hiện tại ở GET /contracts/:id/access (chỉ chủ hợp đồng).
 */
export const accessRouter = Router();
accessRouter.use(authenticate);

const pm = z.enum(enumValues(PaymentMethod) as [string, ...string[]]).refine((m) => m !== 'INTERNAL') as z.ZodType<PaymentMethod>;

accessRouter.post('/', authorize('CUSTOMER'), validate({ body: z.object({
  contractId: zId, reason: z.string().trim().max(300).optional(), method: pm.optional(),
}) }), async (req, res) => {
  res.status(201).json(await createAccessRequest(req.auth!.user, req.valid.body));
});
accessRouter.post('/:id/decide', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  approve: z.boolean(), note: z.string().trim().max(500).optional(),
}) }), async (req, res) => {
  res.json(await decideAccessRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});
accessRouter.post('/:id/complete', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  keyTag: z.string().trim().min(1, 'Nhập số thẻ / mã chìa mới').max(40),
}) }), async (req, res) => {
  res.json(await completeAccessRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});
accessRouter.post('/:id/cancel', authorize('CUSTOMER', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ reason: z.string().trim().max(500).optional() }) }), async (req, res) => {
  res.json(await cancelAccessRequest(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});
