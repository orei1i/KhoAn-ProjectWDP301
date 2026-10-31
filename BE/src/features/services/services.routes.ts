import { gatewayStart } from '../payments/gateway-order.service';
import { settleOpenOrders } from '../payments/gateway-settle.service';
import { Router } from 'express';
import { z } from 'zod';
import { enumValues, PaymentMethod } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { idParams, validate, zDate, zId } from '../../shared/http/validate';
import { BadRequest } from '../../shared/core/errors';
import {
  cancelServiceOrder, completeServiceOrder, createOffering, deleteOffering, orderService, updateOffering,
} from './services.service';

/**
 * Dịch vụ thêm sau khi thuê. Danh sách (danh mục + đơn) đi qua GET /bootstrap giống các thực thể khác;
 * khách xem danh mục công khai ở GET /facilities/public/:id.
 */
export const servicesRouter = Router();
servicesRouter.use(authenticate);

const pm = z.enum(enumValues(PaymentMethod) as [string, ...string[]]).refine((m) => m !== 'INTERNAL') as z.ZodType<PaymentMethod>;
const offeringBody = z.object({
  code: z.string().regex(/^[A-Za-z0-9-]{2,30}$/, 'Mã 2–30 ký tự chữ/số/-'), name: z.string().min(2).max(100),
  description: z.string().max(1000).optional(), price: z.number().int().min(1_000), unitLabel: z.string().min(1).max(20),
});

// ---- danh mục (giá riêng từng chi nhánh — Quản lý vận hành)
servicesRouter.post('/offerings', authorize('OPS_MANAGER'), validate({ body: offeringBody.extend({ facilityId: zId }) }), async (req, res) => {
  const { facilityId, ...rest } = req.valid.body;
  res.status(201).json(await createOffering(facilityId, rest));
});
servicesRouter.patch('/offerings/:id', authorize('OPS_MANAGER'), validate({ params: idParams, body: offeringBody.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() }) }), async (req, res) => {
  res.json(await updateOffering(req.valid.params.id, req.valid.body));
});
servicesRouter.delete('/offerings/:id', authorize('OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await deleteOffering(req.valid.params.id));
});

// ---- đơn dịch vụ
// Đợt 16 (C6): `expectedTotal` = tổng tiền khách đang thấy (giá đổi → 409 PRICE_CHANGED { total, unitPrice }); header Idempotency-Key
// (8–100 ký tự) — gửi lại cùng khoá trả đúng đơn đã tạo (200, `replayed: true`), không thu lần hai.
servicesRouter.post('/orders', authorize('CUSTOMER'), validate({ body: z.object({
  contractId: zId, serviceId: zId, quantity: z.number().int().min(1).max(99), preferredDate: zDate.optional(), note: z.string().max(500).optional(), method: pm,
  expectedTotal: z.number().int().min(0).optional(),
}) }), async (req, res) => {
  const key = req.header('idempotency-key')?.trim() || undefined;
  if (key && (key.length < 8 || key.length > 100)) throw BadRequest('Idempotency-Key dài 8–100 ký tự');
  await settleOpenOrders({ contractId: req.valid.body.contractId, kind: 'SERVICE' }); // đợt VNPAY: có thể vừa trả mà IPN chưa tới
  const o = await orderService(req.auth!.user, { ...req.valid.body, idempotencyKey: key }, { start: gatewayStart(req) });
  if ('gateway' in o) return res.status(202).json(o);
  const replayed = (o as { replayed?: boolean }).replayed === true;
  res.status(replayed ? 200 : 201).json(replayed ? { ...o.toJSON(), replayed: true } : o);
});
servicesRouter.post('/orders/:id/complete', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await completeServiceOrder(req.auth!.user, req.valid.params.id));
});
servicesRouter.post('/orders/:id/cancel', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ reason: z.string().max(500).optional() }) }), async (req, res) => {
  res.json(await cancelServiceOrder(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});
