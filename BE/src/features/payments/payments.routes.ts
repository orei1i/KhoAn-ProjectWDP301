import { Router } from 'express';
import { z } from 'zod';
import { GATEWAY_TXN_REF_RE, type PaymentConfig, type PaymentMethod } from '@ssm/shared';
import { env } from '../../shared/config/env';
import { PaymentModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { confirmPayout, paymentProjectionFor } from './payment.service';
import { handleIpn, viewGatewayOrder } from './gateway-settle.service';
import { resolveGatewayRefund } from './gateway-refund.service';
import { receiptPdfFor } from './receipt-pdf';
import { createReceiptLink, verifyReceiptLink } from './receipt-link';
import { requestContext } from '../../shared/core/request-context';
import { rateLimit } from '../../shared/http/rate-limit';
import { scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zId } from '../../shared/http/validate';

export const paymentsRouter = Router();

/**
 * Tải biên lai bằng LINK NGẮN HẠN (không cần token đăng nhập) — app di động mở link này bằng trình duyệt của máy. Link do
 * POST /payments/:id/receipt-link cấp (HMAC, 5 phút, gắn với người xin); quyền được kiểm lại lúc tải. Đặt TRƯỚC authenticate.
 */
paymentsRouter.get('/receipt-link/:token', rateLimit({ windowMs: 60_000, max: 30, name: 'receipt-link' }), validate({ params: z.object({ token: z.string().min(20).max(300) }) }), async (req, res) => {
  const { user, paymentId } = await verifyReceiptLink(req.valid.params.token);
  const ctx = requestContext.getStore();
  if (ctx) Object.assign(ctx, { userId: String(user._id), role: user.role, facilityIds: user.facilityIds.map(String) });
  const { pdf, filename } = await receiptPdfFor(user, paymentId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
});

/** Đợt VNPAY: chế độ thanh toán online để client chọn hiển thị. Công khai, không bao giờ chứa khoá. */
const METHODS_BY_MODE: Record<PaymentConfig['mode'], PaymentMethod[]> = { MOCK: ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'], VNPAY: ['VNPAY'], OFF: [] };
paymentsRouter.get('/config', (_req, res) => {
  const out: PaymentConfig = { mode: env.paymentMode, methods: METHODS_BY_MODE[env.paymentMode] };
  res.json(out);
});

/** Đợt VNPAY: IPN — chỉ VNPAY gọi, xác thực bằng chữ ký. Luôn HTTP 200 kèm { RspCode, Message }. Đăng ký với VNPAY: https://<api>/api/payments/vnpay/ipn */
paymentsRouter.get('/vnpay/ipn', async (req, res) => {
  res.json(await handleIpn(req.query as Record<string, unknown>));
});

paymentsRouter.use(authenticate);

/** Đợt VNPAY: trang kết quả poll theo mã giao dịch. Không thấy hoặc không có quyền đều 404. Chỉ khách chủ order mới kích hoạt hỏi VNPAY (tối đa một lần mỗi 15 giây). */
paymentsRouter.get('/gateway-orders/:txnRef', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), rateLimit({ windowMs: 60_000, max: 60, key: 'user', name: 'gateway-order' }), validate({ params: z.object({ txnRef: z.string().regex(GATEWAY_TXN_REF_RE, 'Mã giao dịch không hợp lệ') }) }), async (req, res) => {
  res.json(await viewGatewayOrder(req.auth!.user, req.valid.params.txnRef));
});

/** Đợt VNPAY: xử lý khoản hoàn VNPAY lỗi / chưa rõ kết quả. MARK_DONE chỉ OPS. */
paymentsRouter.post('/:id/gateway-refund/resolve', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  action: z.enum(['RETRY', 'TO_BANK_TRANSFER', 'MARK_DONE']),
  note: z.string().trim().min(5, 'Ghi chú ít nhất 5 ký tự').max(500),
}) }), async (req, res) => {
  res.json(await resolveGatewayRefund(req.auth!.user, req.valid.params.id, req.valid.body));
});

// Đợt 17 (C4): Quản trị viên không đọc giao dịch của khách (403).
paymentsRouter.get('/', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ query: paging.extend({ facilityId: zId.optional(), contractId: zId.optional(), status: z.string().optional() }) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, facilityId, contractId, status } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user, { customerField: 'customerId' }) };
  if (facilityId) filter.facilityId = facilityId;
  if (contractId) filter.contractId = contractId;
  if (status) filter.status = { $in: status.split(',') };
  const [items, total] = await Promise.all([
    PaymentModel.find(filter, paymentProjectionFor(req.auth!.user.role)).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    PaymentModel.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

/** Biên lai một khoản đã thu / khoản hoàn đã chi (PDF) — khách chủ khoản, STAFF / FM đúng chi nhánh, OPS. Đợt 17 (C4): bỏ ADMIN. */
paymentsRouter.get('/:id/receipt.pdf', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  const { pdf, filename } = await receiptPdfFor(req.auth!.user, req.valid.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

/** App di động xin link tải biên lai của CHÍNH MÌNH (5 phút) → mở bằng trình duyệt. Trả { path, expiresAt } — path tính từ /api. */
paymentsRouter.post('/:id/receipt-link', authorize('CUSTOMER'), validate({ params: idParams }), async (req, res) => {
  res.status(201).json(await createReceiptLink(req.auth!.user, req.valid.params.id));
});

/** Xác nhận đã chuyển khoản một khoản hoàn đang chờ (FM đúng chi nhánh / OPS). Người lập khoản chi không tự xác nhận (SAME_APPROVER);
 *  khách chưa khai tài khoản nhận tiền thì chỉ OPS xác nhận (PAYOUT_ACCOUNT_OPS). */
paymentsRouter.post('/:id/confirm-payout', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  reference: z.string().trim().min(3).max(100).describe('Mã giao dịch ngân hàng'),
  toAccount: z.string().trim().max(200).optional().describe('Tài khoản đã chuyển tới — bắt buộc khi khách chưa khai'),
}) }), async (req, res) => {
  res.json(await confirmPayout(req.auth!.user, req.valid.params.id, req.valid.body));
});
