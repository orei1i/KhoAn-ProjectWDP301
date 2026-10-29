import { Router } from 'express';
import { z } from 'zod';
import { ClaimStatus, ClaimType, enumValues } from '@ssm/shared';
import { DamageClaimModel } from '../../shared/db/models';
import { NotFound } from '../../shared/core/errors';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { assertCanAccess, scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zId, zIdLast4, zIdType, zMoney } from '../../shared/http/validate';
import { createClaim, decideClaim, liabilityCapOf, payClaim, startClaimReview, withdrawClaim } from './claim.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);
/** Nhân viên quầy không xem 4 số cuối giấy tờ khách — kể cả của người nhận tiền bồi thường đã ghi trong hồ sơ (A6). */
const hideRecipientId = (role: string) => (role === 'STAFF' ? { 'settlement.recipient.idNumberLast4': 0 } : {});

export const claimsRouter = Router();
claimsRouter.use(authenticate);

claimsRouter.get('/', validate({ query: paging.extend({ facilityId: zId.optional(), status: z.string().optional() }) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, facilityId, status } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user, { customerField: 'customerId' }) };
  if (facilityId) filter.facilityId = facilityId;
  if (status) filter.status = { $in: status.split(',').filter((s: string) => (enumValues(ClaimStatus) as string[]).includes(s)) };
  const [items, total] = await Promise.all([
    DamageClaimModel.find(filter, hideRecipientId(req.auth!.user.role)).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('customerId', 'fullName phone').populate('unitId', 'unitNumber location'),
    DamageClaimModel.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

claimsRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  const c = await DamageClaimModel.findById(req.valid.params.id, hideRecipientId(req.auth!.user.role)).lean();
  if (!c) throw NotFound('hồ sơ bồi thường');
  await assertCanAccess(req.auth!.user, c, 'claim.read');
  res.json({ claim: c, liabilityCap: c.review?.liabilityCap ?? await liabilityCapOf(c) });
});

// Đợt 14: chọn đồ từ "đồ đang gửi" bằng `intakeItemId` — server lấy tên theo danh sách, unitValue mặc định = giá trị đã khai (thấp hơn
// được, cao hơn → 422 CLAIM_OVER_DECLARED), quantity ≤ số đã nhập. Đồ ngoài danh sách: bắt buộc name + unitValue, server gắn undeclared.
const claimItem = z.object({
  name: z.string().min(1).max(200).optional(),
  quantity: z.number().int().min(1).max(999),
  unitValue: zMoney.optional().describe('Giá trị khai báo cho MỘT đơn vị — bỏ trống khi chọn đồ trong danh sách (lấy giá trị đã khai)'),
  note: z.string().max(500).optional(),
  intakeItemId: z.string().trim().min(1).max(40).nullish().describe('Mã dòng đồ đã khai & xác nhận (GET /contracts/:id/inventory → itemId)'),
}).refine((it) => !!it.intakeItemId || (!!it.name?.trim() && it.unitValue !== undefined), { message: 'Đồ ngoài danh sách: nhập tên và giá trị', path: ['name'] });

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

claimsRouter.post('/:id/review', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await startClaimReview(req.auth!.user, req.valid.params.id));
});

claimsRouter.post('/:id/decide', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  approve: z.boolean(),
  approvedAmount: zMoney.optional().describe('Bắt buộc khi approve = true. ≤ 10 × giá thuê tháng của ô kho; quản lý chi nhánh ≤ 5.000.000 ₫'),
  note: z.string().min(5).max(2000).describe('Căn cứ quyết định — hiển thị cho khách và ghi vào nhật ký'),
}) }), async (req, res) => {
  res.json(await decideClaim(req.auth!.user, req.valid.params.id, req.valid.body));
});

claimsRouter.post('/:id/pay', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  method: z.enum(['BANK_TRANSFER', 'CASH']).describe('Tiền mặt tại quầy (người khác người duyệt, khác người lập hồ sơ) hoặc lập lệnh chuyển khoản chờ xác nhận'),
  // Đợt 15 (A6): chi TIỀN MẶT bắt buộc đối chiếu giấy tờ bản gốc của chủ hợp đồng — thiếu → 422 ID_REQUIRED, sai → 422 ID_MISMATCH.
  idType: zIdType.optional().describe('Bắt buộc khi CASH — loại giấy tờ đọc từ bản gốc người nhận (chủ hợp đồng)'),
  idNumberLast4: zIdLast4.optional().describe('Bắt buộc khi CASH'),
  identityVerified: z.boolean().optional().describe('Bắt buộc true khi CASH — nhân viên đã xem giấy tờ bản gốc'),
}) }), async (req, res) => {
  const { method, ...presented } = req.valid.body;
  const r = await payClaim(req.auth!.user, req.valid.params.id, method, presented);
  res.json(r);
});

claimsRouter.post('/:id/withdraw', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({ reason: z.string().max(500).optional() }) }), async (req, res) => {
  res.json(await withdrawClaim(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});
