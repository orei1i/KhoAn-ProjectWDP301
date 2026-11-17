import { Router } from 'express';
import { z } from 'zod';
import { CounterPurpose, enumValues, GATEWAY_TXN_REF_RE, type PaymentConfig, type PaymentMethod } from '@ssm/shared';
import { env } from '../../shared/config/env';
import { PaymentModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { confirmPayout, paymentProjectionFor } from './payment.service';
import { handleIpn, mockGatewayPay, viewGatewayOrder } from './gateway-settle.service';
import { listUnusedCounterOrders, mockOrderInfo, openCounterOrder, releaseCounterOrder } from './counter-gateway.service';
import { gatewayStart } from './gateway-order.service';
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
paymentsRouter.get('/receipt-link/:token', rateLimit({ windowMs: 60_000, max: 30, name: 'receipt-link' }), validate({ params: z.object({ token: z.string().min(20).max(400) }) }), async (req, res) => {
  const { user, paymentIds } = await verifyReceiptLink(req.valid.params.token);
  const ctx = requestContext.getStore();
  if (ctx) Object.assign(ctx, { userId: String(user._id), role: user.role, facilityIds: user.facilityIds.map(String) });
  const { pdf, filename } = await receiptPdfFor(user, paymentIds);
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

/**
 * Góp ý 17/11 — TRANG THANH TOÁN GIẢ LẬP của lệnh VNPAY tại quầy, chỉ khi MOCK_PAYMENTS (chế độ khác: 404). Link có chữ ký `sig` do server cấp trong payUrl
 * (/payment/mock?ref=…&sig=…) — mở trên tab mới ở máy quầy hoặc bằng điện thoại khách quét QR. Không cần đăng nhập. Thành công đi đúng đường IPN (settleSuccess).
 */
const mockRef = z.object({ txnRef: z.string().regex(GATEWAY_TXN_REF_RE, 'Mã giao dịch không hợp lệ') });
paymentsRouter.get('/mock-gateway/:txnRef', rateLimit({ windowMs: 60_000, max: 60, name: 'mock-gateway' }), validate({ params: mockRef, query: z.object({ sig: z.string().min(16).max(64) }) }), async (req, res) => {
  res.json(await mockOrderInfo(req.valid.params.txnRef, req.valid.query.sig));
});
paymentsRouter.post('/mock-gateway/:txnRef', rateLimit({ windowMs: 60_000, max: 30, name: 'mock-gateway-pay' }), validate({ params: mockRef, body: z.object({ sig: z.string().min(16).max(64), outcome: z.enum(['SUCCESS', 'FAIL']) }) }), async (req, res) => {
  res.json(await mockGatewayPay(req.valid.params.txnRef, req.valid.body.sig, req.valid.body.outcome));
});

paymentsRouter.use(authenticate);

/**
 * Góp ý 17/11 — nhân viên mở (hoặc dùng lại) lệnh VNPAY TẠI QUẦY cho đúng một bước thu. Số tiền server tự tính: CHECK_IN (reservationId — tiền thuê còn thu + dịch vụ
 * kèm chưa trả), HOLD_DEPOSIT (reservationId — giữ chân + tiền thuê kỳ đầu kho lớn), BALANCE (contractId — dư nợ), SWAP_FEE (swapRequestId — phí trả trước);
 * WALK_IN dùng `amount` nhân viên đang thu + `walkInKey` (Idempotency-Key của lượt đặt), kiểm lại khi đặt. 201 lệnh mới · 200 dùng lại (cùng việc + số tiền: đang
 * chờ còn hạn, hoặc ĐÃ TRẢ chưa dùng). Chế độ OFF → 501 GATEWAY_NOT_CONFIGURED. Màn quầy mở payUrl ở tab mới + hiện QR, rồi poll GET /payments/gateway-orders/:txnRef.
 */
paymentsRouter.post('/counter-orders', authorize('STAFF', 'FACILITY_MANAGER'), rateLimit({ windowMs: 60_000, max: 30, key: 'user', name: 'counter-order' }), validate({ body: z.object({
  purpose: z.enum(enumValues(CounterPurpose) as [CounterPurpose, ...CounterPurpose[]]),
  reservationId: zId.optional(), contractId: zId.optional(), swapRequestId: zId.optional(),
  facilityId: zId.optional(), customerId: zId.optional(),
  walkInKey: z.string().trim().min(8).max(80).optional(),
  amount: z.number().int().positive().optional(),
}) }), async (req, res) => {
  const out = await openCounterOrder(req.auth!.user, req.valid.body, gatewayStart(req));
  res.status(out.reused ? 200 : 201).json(out);
});

/** Góp ý 17/11 — hàng "VNPAY tại quầy đã thu, chưa ghi nhận": lệnh đã PAID mà chưa thao tác nào dùng, chưa trả lại khách. Nhân sự chi nhánh; OPS lọc theo chi nhánh. */
paymentsRouter.get('/counter-orders', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ query: z.object({ facilityId: zId.optional() }) }), async (req, res) => {
  res.json({ items: await listUnusedCounterOrders(req.auth!.user, req.valid.query.facilityId) });
});

/**
 * Góp ý 17/11 — trả lại khách khoản VNPAY tại quầy đã thu mà không dùng (409 NOT_RELEASABLE nếu đã dùng / đã trả lại / chưa trả). Có khách + đặt chỗ / hợp đồng:
 * ghi sổ GATEWAY_UNAPPLIED (đã hoàn) + khoản HOÀN chuyển khoản chờ người KHÁC xác nhận (confirm-payout). Không có (đặt tại quầy cho khách mới bỏ dở): chỉ ghi chú.
 */
paymentsRouter.post('/counter-orders/:txnRef/release', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: mockRef, body: z.object({
  note: z.string().trim().min(5, 'Ghi lý do / cách trả lại (ít nhất 5 ký tự)').max(500),
}) }), async (req, res) => {
  res.json(await releaseCounterOrder(req.auth!.user, req.valid.params.txnRef, req.valid.body.note));
});

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

/**
 * Biên lai một khoản đã thu / khoản hoàn đã chi (PDF) — khách chủ khoản, STAFF / FM đúng chi nhánh, OPS. Đợt 17 (C4): bỏ ADMIN.
 * `?with=id2,id3`: các khoản khác của CÙNG lần thu → in chung MỘT biên lai (cùng khách, cùng chi nhánh — 422 RECEIPT_GROUP_INVALID).
 */
const receiptWith = z.object({
  with: z.string().max(260).optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])).pipe(z.array(zId).max(9)),
});
paymentsRouter.get('/:id/receipt.pdf', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, query: receiptWith }), async (req, res) => {
  const { pdf, filename } = await receiptPdfFor(req.auth!.user, [req.valid.params.id, ...req.valid.query.with]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

/** App di động xin link tải biên lai của CHÍNH MÌNH (5 phút) → mở bằng trình duyệt. Trả { path, expiresAt } — path tính từ /api. */
paymentsRouter.post('/:id/receipt-link', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({ with: z.array(zId).max(9).optional() }).optional() }), async (req, res) => {
  res.status(201).json(await createReceiptLink(req.auth!.user, req.valid.params.id, req.valid.body?.with ?? []));
});

/** Xác nhận đã chuyển khoản một khoản hoàn đang chờ (FM đúng chi nhánh / OPS). Người lập khoản chi không tự xác nhận (SAME_APPROVER);
 *  khách chưa khai tài khoản nhận tiền thì chỉ OPS xác nhận (PAYOUT_ACCOUNT_OPS). */
paymentsRouter.post('/:id/confirm-payout', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  reference: z.string().trim().min(3).max(100).describe('Mã giao dịch ngân hàng'),
  toAccount: z.string().trim().max(200).optional().describe('Tài khoản đã chuyển tới — bắt buộc khi khách chưa khai'),
}) }), async (req, res) => {
  res.json(await confirmPayout(req.auth!.user, req.valid.params.id, req.valid.body));
});
