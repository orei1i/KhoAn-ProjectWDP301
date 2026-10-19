import { Router } from 'express';
import { z } from 'zod';
import { enumValues, SwapRequestStatus } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { idParams, paging, validate, zDate, zId } from '../../shared/http/validate';
import { assignSwapMover, cancelSwapRequest, completeSwapRequest, decideSwapRequest, getSwapRequest, listSwapRequestsQueue } from './unit-swap-request.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);

/**
 * Hàng đợi yêu cầu đổi ô cho FM/nhân viên (song song với `/contracts/:id/swap-requests` — nơi khách
 * gửi yêu cầu và xem yêu cầu của chính mình). Xem BE/README.md mục A1b.
 */
export const swapsRouter = Router();
swapsRouter.use(authenticate);

swapsRouter.get('/', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'), validate({
  query: paging.extend({ facilityId: zId.optional(), status: e(SwapRequestStatus).optional() }),
}), async (req, res) => {
  const { page, limit, facilityId, status } = req.valid.query;
  res.json(await listSwapRequestsQueue(req.auth!.user, { facilityId, status }, page, limit));
});

swapsRouter.get('/:id', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'), validate({ params: idParams }), async (req, res) => {
  res.json(await getSwapRequest(req.auth!.user, req.valid.params.id));
});

swapsRouter.post('/:id/decide', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  approve: z.boolean(),
  facilityFault: z.boolean().optional().describe('Có phải lỗi từ chi nhánh không — quyết định miễn phí'),
  fee: z.number().int().min(0).optional().describe('Sửa phí đề xuất, trong trần SWAP_FEE_MAX'),
  scheduledFor: zDate.optional().describe('Bắt buộc khi method = DELIVERY — ngày chi nhánh cử người chuyển'),
  assignedStaffId: zId.optional().describe('Bắt buộc khi method = DELIVERY — nhân viên của chi nhánh được phân công chuyển đồ'),
  rejectReason: z.string().min(5).max(500).optional().describe('Bắt buộc khi approve = false'),
}) }), async (req, res) => {
  res.json(await decideSwapRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});

/** Đổi nhân viên chuyển đồ / dời ngày hẹn cho yêu cầu DELIVERY đã duyệt. */
swapsRouter.post('/:id/assign', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ assignedStaffId: zId, scheduledFor: zDate.optional() }) }), async (req, res) => {
  res.json(await assignSwapMover(req.auth!.user, req.valid.params.id, req.valid.body));
});

swapsRouter.post('/:id/complete', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  keyTag: z.string().max(50).optional().describe('Nhãn chìa / số thẻ vừa giao cho khách, khi ô mới khoá bằng chìa hoặc thẻ'),
}) }), async (req, res) => {
  res.json(await completeSwapRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});

// Khách rút yêu cầu của mình; Quản lý chi nhánh huỷ yêu cầu không thực hiện được. Cả khi đã duyệt nhưng chưa chuyển.
swapsRouter.post('/:id/cancel', authorize('CUSTOMER', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await cancelSwapRequest(req.auth!.user, req.valid.params.id));
});
