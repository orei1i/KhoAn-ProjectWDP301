import { Router } from 'express';
import { z } from 'zod';
import { ClaimStatus, ClaimType, enumValues } from '@ssm/shared';
import { DamageClaimModel } from '../../shared/db/models';
import { NotFound } from '../../shared/core/errors';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { assertCanAccess, scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zId, zMoney } from '../../shared/http/validate';
import { CLAIM_LIABILITY_CAP } from './claim-rules';
import { createClaim, decideClaim, payClaim, startClaimReview, withdrawClaim } from './claim.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);

export const claimsRouter = Router();
claimsRouter.use(authenticate);

claimsRouter.get('/', validate({ query: paging.extend({ facilityId: zId.optional(), status: z.string().optional() }) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, facilityId, status } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user, { customerField: 'customerId' }) };
  if (facilityId) filter.facilityId = facilityId;
  if (status) filter.status = { $in: status.split(',').filter((s: string) => (enumValues(ClaimStatus) as string[]).includes(s)) };
  const [items, total] = await Promise.all([
    DamageClaimModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('customerId', 'fullName phone').populate('unitId', 'unitNumber location'),
    DamageClaimModel.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, liabilityCap: CLAIM_LIABILITY_CAP });
});

claimsRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  const c = await DamageClaimModel.findById(req.valid.params.id).lean();
  if (!c) throw NotFound('hồ sơ bồi thường');
  await assertCanAccess(req.auth!.user, c, 'claim.read');
  res.json({ claim: c, liabilityCap: CLAIM_LIABILITY_CAP });
});

const claimItem = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(999),
  unitValue: zMoney.describe('Giá trị khai báo cho MỘT đơn vị'),
  note: z.string().max(500).optional(),
});

claimsRouter.post('/', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ body: z.object({
  contractId: zId,
  type: e(ClaimType),
  incidentAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).describe('Thời điểm xảy ra sự cố (ISO)'),
  description: z.string().min(10).max(5000),
  items: z.array(claimItem).min(1).max(50),
  photoUrls: z.array(z.string().url()).max(20).default([]),
  ticketId: zId.nullish().describe('Sự cố đã báo trước đó, nếu có'),
}) }), async (req, res) => {
  res.status(201).json(await createClaim(req.auth!.user, req.valid.body));
});

claimsRouter.post('/:id/review', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await startClaimReview(req.auth!.user, req.valid.params.id));
});

claimsRouter.post('/:id/decide', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  approve: z.boolean(),
  approvedAmount: zMoney.max(CLAIM_LIABILITY_CAP).optional().describe('Bắt buộc khi approve = true'),
  note: z.string().min(5).max(2000).describe('Căn cứ quyết định — hiển thị cho khách và ghi vào nhật ký'),
}) }), async (req, res) => {
  res.json(await decideClaim(req.auth!.user, req.valid.params.id, req.valid.body));
});

claimsRouter.post('/:id/pay', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  method: z.enum(['BANK_TRANSFER', 'CASH']).describe('Bồi thường chỉ chi bằng chuyển khoản hoặc tiền mặt tại quầy'),
}) }), async (req, res) => {
  res.json(await payClaim(req.auth!.user, req.valid.params.id, req.valid.body.method));
});

claimsRouter.post('/:id/withdraw', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({ reason: z.string().max(500).optional() }) }), async (req, res) => {
  res.json(await withdrawClaim(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});
