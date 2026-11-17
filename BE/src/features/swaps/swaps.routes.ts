import { Router } from 'express';
import { z } from 'zod';
import { enumValues, GATEWAY_TXN_REF_RE, PaymentMethod, SwapRequestStatus } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { idParams, paging, validate, zDate, zId } from '../../shared/http/validate';
import { gatewayStart } from '../payments/gateway-order.service';
import { settleOpenOrders } from '../payments/gateway-settle.service';
import { cancelSwapRequest, completeSwapRequest, decideSwapRequest, getSwapRequest, listSwapRequestsQueue, paySwapFee, rescheduleSwapDelivery } from './unit-swap-request.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);
const pm = z.enum(enumValues(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]]).refine((m) => m !== 'INTERNAL') as z.ZodType<PaymentMethod>;

/**
 * Hàng đợi yêu cầu đổi ô cho FM/nhân viên (song song với `/contracts/:id/swap-requests` — nơi khách
 * gửi yêu cầu và xem yêu cầu của chính mình). Xem BE/README.md mục A1b.
 */
export const swapsRouter = Router();
swapsRouter.use(authenticate);

// Đợt 17 (C4): bỏ ADMIN — yêu cầu đổi ô là dữ liệu hợp đồng của khách (phụ lục đổi cỡ có thông tin Bên B).
swapsRouter.get('/', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({
  query: paging.extend({ facilityId: zId.optional(), status: e(SwapRequestStatus).optional() }),
}), async (req, res) => {
  const { page, limit, facilityId, status } = req.valid.query;
  res.json(await listSwapRequestsQueue(req.auth!.user, { facilityId, status }, page, limit));
});

swapsRouter.get('/:id', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await getSwapRequest(req.auth!.user, req.valid.params.id));
});

swapsRouter.post('/:id/decide', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  approve: z.boolean(),
  facilityFault: z.boolean().optional().describe('Có phải lỗi từ chi nhánh không — quyết định miễn phí'),
  fee: z.number().int().min(0).optional().describe('Sửa phí đề xuất, trong trần SWAP_FEE_MAX — lần đổi đầu / lỗi chi nhánh luôn miễn phí (bỏ qua giá trị này)'),
  scheduledFor: zDate.optional().describe('Bắt buộc khi method = DELIVERY — ngày chi nhánh cử người chuyển; quản lý chia việc ngoài hệ thống'),
  rejectReason: z.string().min(5).max(500).optional().describe('Bắt buộc khi approve = false'),
}) }), async (req, res) => {
  res.json(await decideSwapRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});

/**
 * Dời ngày hẹn của yêu cầu DELIVERY đã duyệt. Quản lý chi nhánh: ngày bất kỳ từ hôm nay. Góp ý 17/11 — khách chủ yêu cầu tự đổi: từ ngày mai tới
 * SWAP_SELF_MOVE_DAYS ngày, tối đa SWAP_CUSTOMER_RESCHEDULE_MAX lần (422 SWAP_RESCHEDULE_WINDOW / SWAP_RESCHEDULE_LIMIT / SWAP_SAME_DATE / SWAP_NOT_RESCHEDULABLE).
 */
swapsRouter.post('/:id/reschedule', authorize('CUSTOMER', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ scheduledFor: zDate }) }), async (req, res) => {
  res.json(await rescheduleSwapDelivery(req.auth!.user, req.valid.params.id, req.valid.body));
});

/**
 * Trả trước phí thuê người chuyển. Khách: MOCK trả 200, VNPAY trả 202 { gateway }. Nhân viên / quản lý: thu tại quầy — tiền mặt, hoặc VNPAY kèm gatewayTxnRef (lệnh tại quầy đã trả).
 * Đã trả rồi: 200 `replayed: true`, không thu thêm.
 */
swapsRouter.post('/:id/pay-fee', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  method: pm,
  // Góp ý 17/11: nhân viên thu tại quầy chỉ CASH hoặc VNPAY (khác → 422 METHOD_NOT_AVAILABLE); VNPAY kèm mã lệnh tại quầy việc SWAP_FEE đã PAID.
  gatewayTxnRef: z.string().regex(GATEWAY_TXN_REF_RE, 'Mã lệnh VNPAY không hợp lệ').optional().describe('Nhân viên thu VNPAY tại quầy: mã lệnh (POST /payments/counter-orders, việc SWAP_FEE) đã PAID'),
  expectedFee: z.number().int().min(0).optional().describe('Số phí đang thấy — lệch → 409 PRICE_CHANGED'),
}) }), async (req, res) => {
  const user = req.auth!.user;
  // Khách có thể vừa trả qua cổng mà IPN chưa tới: đối soát trước để không thu lần hai.
  await settleOpenOrders({ targetKey: `SWAP_FEE:${req.valid.params.id}`, kind: 'SWAP_FEE' }, { force: user.role !== 'CUSTOMER' });
  const out = await paySwapFee(user, req.valid.params.id, req.valid.body, { start: gatewayStart(req) });
  if ('gateway' in out) return res.status(202).json(out);
  res.json(out);
});

swapsRouter.post('/:id/complete', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  keyTag: z.string().max(50).optional().describe('Đợt 16 (B1): BẮT BUỘC khi ô mới khoá bằng chìa / thẻ — mã chìa / số thẻ MỚI vừa giao (thiếu → 422 KEYTAG_REQUIRED); ô mật khẩu: hệ thống sinh mật khẩu mới'),
  oldAccessReset: z.boolean().optional().describe('Đợt 16 (B1): đã thu chìa / thẻ cũ (hoặc đặt lại ổ khoá ô mật khẩu) ngay lúc đổi'),
  performedBy: z.string().max(1000).optional().describe('BẮT BUỘC khi method = DELIVERY: người thực hiện, chữ tự do 2–200 ký tự, được nhiều người (thiếu → 422 PERFORMED_BY_REQUIRED). Tự chuyển: bỏ qua'),
  moveCheck: z.object({
    packages: z.number().int().min(1).max(999),
    photoUrls: z.array(z.string().url().max(500)).min(1).max(20),
    note: z.string().trim().max(500).optional(),
    movedItemIds: z.array(z.string().min(1).max(40)).max(500).optional()
      .describe('Góp ý 17/11 — yêu cầu có moveItems: itemId các món nhân viên tick đã chuyển (thiếu / rỗng → 422 MOVE_ITEMS_REQUIRED, lạ → 422 MOVE_ITEMS_INVALID; chưa tick hết thì bắt buộc note → 422 MOVE_ITEMS_NOTE_REQUIRED)'),
  }).optional().describe('RV3 — BẮT BUỘC khi method = DELIVERY: biên bản chuyển đồ (số kiện, ảnh đồ tại ô mới, ghi chú) — thiếu → 422 MOVE_CHECK_REQUIRED'),
}) }), async (req, res) => {
  // Phí có thể vừa trả qua cổng mà IPN chưa tới: đối soát trước khi xét SWAP_FEE_UNPAID.
  await settleOpenOrders({ targetKey: `SWAP_FEE:${req.valid.params.id}`, kind: 'SWAP_FEE' }, { force: true });
  res.json(await completeSwapRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});

// Khách rút yêu cầu của mình; Quản lý chi nhánh huỷ yêu cầu không thực hiện được. Cả khi đã duyệt nhưng chưa chuyển.
swapsRouter.post('/:id/cancel', authorize('CUSTOMER', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await cancelSwapRequest(req.auth!.user, req.valid.params.id));
});
