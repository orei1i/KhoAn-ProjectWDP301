import { Router } from 'express';
import { z } from 'zod';
import { enumValues, PrivacyRequestType } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { rateLimit } from '../../shared/http/rate-limit';
import { idParams, validate } from '../../shared/http/validate';
import { createPrivacyRequest, listPrivacyRequests, resolvePrivacyRequest } from './privacy.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);

export const privacyRouter = Router();
privacyRouter.use(authenticate);

/** Khách: các yêu cầu của mình. Quản trị viên: tất cả (kèm thông tin khách), lọc theo trạng thái. */
privacyRouter.get('/', authorize('CUSTOMER', 'ADMIN'), validate({ query: z.object({ status: z.string().optional() }) }), async (req, res) => {
  res.json({ items: await listPrivacyRequests(req.auth!.user, req.valid.query.status) });
});

/** Khách gửi yêu cầu thực hiện quyền dữ liệu cá nhân — không cần đang có hợp đồng. Tối đa 3 yêu cầu đang mở. */
privacyRouter.post('/', authorize('CUSTOMER'), rateLimit({ windowMs: 60_000, max: 5, key: 'user' }), validate({ body: z.object({
  type: e(PrivacyRequestType), note: z.string().trim().max(2000).optional(),
}) }), async (req, res) => {
  res.status(201).json(await createPrivacyRequest(req.auth!.user, req.valid.body));
});

/** Quản trị viên trả lời: đã xử lý / từ chối (kèm lý do). Xoá dữ liệu thì dùng POST /users/:id/anonymize. */
privacyRouter.post('/:id/resolve', authorize('ADMIN'), validate({ params: idParams, body: z.object({
  status: z.enum(['DONE', 'REJECTED']), response: z.string().trim().min(5).max(2000),
}) }), async (req, res) => {
  res.json(await resolvePrivacyRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});
