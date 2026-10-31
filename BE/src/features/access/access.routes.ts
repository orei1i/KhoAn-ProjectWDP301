import { gatewayStart } from '../payments/gateway-order.service';
import { settleOpenOrders } from '../payments/gateway-settle.service';
import { Router } from 'express';
import { z } from 'zod';
import { enumValues, PaymentMethod } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { idParams, presentedIdBody, validate, zId } from '../../shared/http/validate';
import { BadRequest } from '../../shared/core/errors';
import { cancelAccessRequest, completeAccessRequest, confirmLostBlocked, createAccessRequest, decideAccessRequest } from './access.service';

/**
 * Yêu cầu cấp lại mật khẩu / thẻ khoá / chìa khoá. Danh sách đi qua GET /bootstrap giống các thực thể khác;
 * xem mật khẩu hiện tại ở GET /contracts/:id/access (chỉ chủ hợp đồng).
 */
export const accessRouter = Router();
accessRouter.use(authenticate);

const pm = z.enum(enumValues(PaymentMethod) as [string, ...string[]]).refine((m) => m !== 'INTERNAL') as z.ZodType<PaymentMethod>;

// Đợt 16 (C6): `expectedFee` = phí khách đang thấy (đổi → 409 PRICE_CHANGED { fee }); header Idempotency-Key (8–100 ký tự) — gửi lại cùng
// khoá trả đúng yêu cầu đã tạo (200, `replayed: true`), không thu phí lần hai.
accessRouter.post('/', authorize('CUSTOMER'), validate({ body: z.object({
  contractId: zId, reason: z.string().trim().max(300).optional(), method: pm.optional(), expectedFee: z.number().int().min(0).optional(),
}) }), async (req, res) => {
  const key = req.header('idempotency-key')?.trim() || undefined;
  if (key && (key.length < 8 || key.length > 100)) throw BadRequest('Idempotency-Key dài 8–100 ký tự');
  await settleOpenOrders({ contractId: req.valid.body.contractId, kind: 'ACCESS_FEE' }); // đợt VNPAY: có thể vừa trả mà IPN chưa tới
  const o = await createAccessRequest(req.auth!.user, { ...req.valid.body, idempotencyKey: key }, { start: gatewayStart(req) });
  if ('gateway' in o) return res.status(202).json(o);
  const replayed = (o as { replayed?: boolean }).replayed === true;
  res.status(replayed ? 200 : 201).json(replayed ? { ...o.toJSON(), replayed: true } : o);
});
accessRouter.post('/:id/decide', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  approve: z.boolean(), note: z.string().trim().max(500).optional(),
}) }), async (req, res) => {
  res.json(await decideAccessRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});
// Bàn giao thẻ / chìa mới: nhập giấy tờ BẢN GỐC người nhận (chủ hợp đồng hoặc người được uỷ quyền) — server so khớp như mở hộ.
accessRouter.post('/:id/complete', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  keyTag: z.string().trim().min(1, 'Nhập số thẻ / mã chìa mới').max(40),
  ...presentedIdBody,
}) }), async (req, res) => {
  const { identityVerified: _v, ...body } = req.valid.body;
  res.json(await completeAccessRequest(req.auth!.user, req.valid.params.id, body));
});
// Đợt 16 (B2): nhân viên / quản lý xác nhận đã khoá thẻ / chìa khách báo mất (ai, lúc nào) — việc "Vô hiệu thẻ …" xong, email báo khách.
accessRouter.post('/:id/confirm-blocked', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ note: z.string().trim().max(300).optional() }) }), async (req, res) => {
  res.json(await confirmLostBlocked(req.auth!.user, req.valid.params.id, req.valid.body.note));
});
accessRouter.post('/:id/cancel', authorize('CUSTOMER', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ reason: z.string().trim().max(500).optional() }) }), async (req, res) => {
  res.json(await cancelAccessRequest(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});
