import { Router } from 'express';
import { z } from 'zod';
import { ContactWindow, enumValues, isValidPhone, ISSUE_TICKET_CATEGORIES, PHONE_MESSAGE, RentalPeriod, TicketKind, TicketPriority, TicketStatus, type TicketCategory } from '@ssm/shared';
import { TicketModel } from '../../shared/db/models';
import { NotFound } from '../../shared/core/errors';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { rateLimit } from '../../shared/http/rate-limit';
import { assertCanAccess, scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zDate, zId } from '../../shared/http/validate';
import { addTicketMessage, assignTicket, createConsultation, createTicket, redactForCustomer, setTicketStatus } from './ticket.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

// Đợt 17 (C4): nội dung phiếu là lời khách viết (có thể gồm địa chỉ, giấy tờ, số tài khoản) — Quản trị viên không đọc (403).
ticketsRouter.get('/', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ query: paging.extend({ facilityId: zId.optional(), status: z.string().optional(), mine: z.enum(['true', 'false']).optional() }) }), scopeQueryFacility, async (req, res) => {
  const u = req.auth!.user;
  const { page, limit, facilityId, status, mine } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(u, { customerField: 'reporterId' }) };
  if (u.role === 'CUSTOMER') filter.kind = 'CUSTOMER_ISSUE'; // đợt 16 (B2): việc nội bộ "Vô hiệu thẻ …" đứng tên khách nhưng khách không thấy
  if (facilityId) filter.facilityId = facilityId;
  if (status) filter.status = { $in: status.split(',') };
  if (mine === 'true' && u.role !== 'CUSTOMER') filter.assigneeId = u._id;
  const items = await TicketModel.find(filter).sort({ dueAt: 1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  res.json({ items: items.map((t) => redactForCustomer(t, u.role === 'CUSTOMER')), page, limit });
});

ticketsRouter.get('/:id', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  const t = await TicketModel.findById(req.valid.params.id).lean();
  if (!t || (req.auth!.user.role === 'CUSTOMER' && t.kind !== 'CUSTOMER_ISSUE')) throw NotFound('yêu cầu');
  await assertCanAccess(req.auth!.user, t, 'ticket.read');
  res.json(redactForCustomer(t, req.auth!.user.role === 'CUSTOMER'));
});

ticketsRouter.post('/', validate({ body: z.object({
  // Phiếu tư vấn (CONSULTATION) chỉ tạo qua POST /tickets/consultation — có dữ liệu riêng và không cần đã thuê ở chi nhánh.
  facilityId: zId, kind: e(TicketKind).default('CUSTOMER_ISSUE'), category: z.enum(ISSUE_TICKET_CATEGORIES as [TicketCategory, ...TicketCategory[]]), priority: e(TicketPriority).default('MEDIUM'),
  subject: z.string().min(5).max(200), description: z.string().max(5000).optional(), unitId: zId.nullish(), contractId: zId.nullish(),
  assigneeId: zId.nullish(), dueAt: zDate.nullish(),
  onBehalfOfCustomer: z.boolean().optional().describe('Nhân viên / quản lý ghi nhận THAY khách tại quầy (cần contractId) — phiếu đứng tên khách của hợp đồng'),
}) }), async (req, res) => {
  res.status(201).json(await createTicket(req.auth!.user, req.valid.body));
});

/** Khách yêu cầu tư vấn trước khi đặt kho (gặp bộ phận kinh doanh của chi nhánh) — không giữ ô kho nào. */
ticketsRouter.post('/consultation', authorize('CUSTOMER'), rateLimit({ windowMs: 60_000, max: 5, key: 'user', name: 'consult' }), validate({ body: z.object({
  facilityId: zId, unitTypeIds: z.array(zId).max(5).default([]),
  rentalPeriod: e(RentalPeriod).optional(), periods: z.number().int().min(1).max(365).optional(),
  phone: z.string().trim().refine(isValidPhone, PHONE_MESSAGE), contactWindow: e(ContactWindow).default('ANY'),
  needs: z.object({ reviewContract: z.boolean().default(false), vatInvoice: z.boolean().default(false), customContract: z.boolean().default(false), multipleUnits: z.boolean().default(false) }).default({}),
  note: z.string().max(2000).optional(),
}) }), async (req, res) => {
  res.status(201).json(await createConsultation(req.auth!.user, req.valid.body));
});

ticketsRouter.post('/:id/assign', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ assigneeId: zId }) }), async (req, res) => {
  res.json(await assignTicket(req.auth!.user, req.valid.params.id, req.valid.body.assigneeId));
});
// Đợt 16 (C3): chi nhánh đóng phiếu chưa giải quyết (OPEN / ASSIGNED / IN_PROGRESS → CLOSED) bắt buộc `reason` ≥ 5 ký tự (422 CLOSE_REASON_REQUIRED).
ticketsRouter.post('/:id/status', validate({ params: idParams, body: z.object({ to: e(TicketStatus), reason: z.string().trim().max(500).optional() }) }), async (req, res) => {
  const t = await setTicketStatus(req.auth!.user, req.valid.params.id, req.valid.body.to, req.valid.body.reason);
  res.json(redactForCustomer(t.toObject(), req.auth!.user.role === 'CUSTOMER'));
});
ticketsRouter.post('/:id/messages', validate({ params: idParams, body: z.object({ body: z.string().min(1).max(5000), internal: z.boolean().default(false) }) }), async (req, res) => {
  const t = await addTicketMessage(req.auth!.user, req.valid.params.id, req.valid.body.body, req.valid.body.internal);
  res.status(201).json(redactForCustomer(t.toObject(), req.auth!.user.role === 'CUSTOMER'));
});
