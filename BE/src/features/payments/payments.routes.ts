import { Router } from 'express';
import { z } from 'zod';
import { PaymentModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { confirmPayout } from './payment.service';
import { receiptPdfFor } from './receipt-pdf';
import { scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zId } from '../../shared/http/validate';

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

paymentsRouter.get('/', validate({ query: paging.extend({ facilityId: zId.optional(), contractId: zId.optional(), status: z.string().optional() }) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, facilityId, contractId, status } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user, { customerField: 'customerId' }) };
  if (facilityId) filter.facilityId = facilityId;
  if (contractId) filter.contractId = contractId;
  if (status) filter.status = { $in: status.split(',') };
  const [items, total] = await Promise.all([
    PaymentModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    PaymentModel.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

/** Biên lai một khoản đã thu / khoản hoàn đã chi (PDF) — khách chủ khoản, STAFF / FM đúng chi nhánh, OPS, ADMIN. */
paymentsRouter.get('/:id/receipt.pdf', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'), validate({ params: idParams }), async (req, res) => {
  const { pdf, filename } = await receiptPdfFor(req.auth!.user, req.valid.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

/** Xác nhận đã chuyển khoản một khoản hoàn đang chờ (FM đúng chi nhánh / OPS). Người lập khoản chi không tự xác nhận (SAME_APPROVER);
 *  khách chưa khai tài khoản nhận tiền thì chỉ OPS xác nhận (PAYOUT_ACCOUNT_OPS). */
paymentsRouter.post('/:id/confirm-payout', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  reference: z.string().trim().min(3).max(100).describe('Mã giao dịch ngân hàng'),
  toAccount: z.string().trim().max(200).optional().describe('Tài khoản đã chuyển tới — bắt buộc khi khách chưa khai'),
}) }), async (req, res) => {
  res.json(await confirmPayout(req.auth!.user, req.valid.params.id, req.valid.body));
});
