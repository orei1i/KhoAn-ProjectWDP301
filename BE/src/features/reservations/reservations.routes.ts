import { Router } from 'express';
import { z } from 'zod';
import { CancellationReason, CheckInShift, enumValues, PaymentMethod, RentalPeriod, ReservationStatus, SignatureMethod } from '@ssm/shared';
import { ReservationModel } from '../../shared/db/models';
import { NotFound, Unprocessable } from '../../shared/core/errors';
import { authenticate, optionalAuthenticate } from '../../shared/http/authenticate';
import { rateLimit } from '../../shared/http/rate-limit';
import { authorize } from '../../shared/http/authorize';
import { assertCanAccess, scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zDate, zId, zIdLast4, zIdType, zPersonName } from '../../shared/http/validate';
import { updateCustomerIdentity } from '../users/user.service';
import { contractPdfFor, contractViewForUser, resendContractEmail } from './contract-document.service';
import {
  allocate, cancelReservation, checkIn, createReservation, createReservationsBatch, lookupForCheckIn, payDeposit,
  previewContract, previewContractPdf, reissueCheckInQr, signContract, unallocate, type BookingItem,
} from './reservation.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);
const onlinePay = z.enum(['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER']);
const STAFF_CANCEL_REASONS: CancellationReason[] = ['CUSTOMER_REQUEST', 'FACILITY_UNAVAILABLE', 'ADMIN_OVERRIDE'];

export const reservationsRouter = Router();

/**
 * XEM TRƯỚC toàn văn hợp đồng cho một dòng đặt kho, TRƯỚC khi đặt / trả tiền giữ chân — công khai (đăng nhập thì điền sẵn Bên B).
 * Không ghi gì, không giữ ô. Khai báo trước `use(authenticate)` để khách chưa đăng nhập cũng đọc được.
 */
const previewQuery = z.object({
  unitTypeId: zId, unitId: zId.optional(), startDate: zDate, rentalPeriod: e(RentalPeriod), periods: z.coerce.number().int().min(1).max(365),
  useAirConditioning: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
reservationsRouter.get('/contract-preview', rateLimit({ windowMs: 60_000, max: 30, name: 'preview' }), optionalAuthenticate, validate({ query: previewQuery }), async (req, res) => {
  res.json(await previewContract(req.auth?.user ?? null, req.valid.query));
});
reservationsRouter.get('/contract-preview.pdf', rateLimit({ windowMs: 60_000, max: 10, name: 'preview-pdf' }), optionalAuthenticate, validate({ query: previewQuery }), async (req, res) => {
  const { pdf, filename } = await previewContractPdf(req.auth?.user ?? null, req.valid.query);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

reservationsRouter.use(authenticate);

reservationsRouter.get('/', validate({ query: paging.extend({ facilityId: zId.optional(), status: z.string().optional(), from: zDate.optional(), to: zDate.optional() }) }), scopeQueryFacility, async (req, res) => {
  const u = req.auth!.user;
  const { page, limit, facilityId, status, from, to } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(u, { customerField: 'customerId' }) };
  if (facilityId) filter.facilityId = facilityId;
  if (status) filter.status = { $in: status.split(',').filter((s: string) => (enumValues(ReservationStatus) as string[]).includes(s)) };
  if (from || to) filter.startDate = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) };
  const [items, total] = await Promise.all([
    ReservationModel.find(filter).sort({ startDate: 1 }).skip((page - 1) * limit).limit(limit)
      .populate('customerId', 'fullName phone').populate('unitTypeId', 'name code').populate('unitId', 'unitNumber'),
    ReservationModel.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

reservationsRouter.get('/lookup', authorize('STAFF', 'FACILITY_MANAGER'), validate({ query: z.object({ code: z.string().min(6) }) }), async (req, res) => {
  res.json(await lookupForCheckIn(req.auth!.user, req.valid.query.code));
});

reservationsRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  const r = await ReservationModel.findById(req.valid.params.id).populate('unitTypeId', 'name code dimensions').populate('unitId', 'unitNumber location');
  if (!r) throw NotFound('đặt chỗ');
  await assertCanAccess(req.auth!.user, { facilityId: r.facilityId, customerId: r.customerId }, 'reservation.read');
  res.json(r);
});

// Khách bắt buộc chọn ô cụ thể (unitId) trên sơ đồ và chu kỳ thuê (rentalPeriod) — không đặt theo
// "loại kho" trừu tượng rồi chờ phân sau nữa.
const bookingItemBody = z.object({
  unitTypeId: zId, unitId: zId, startDate: zDate, rentalPeriod: e(RentalPeriod), periods: z.number().int().min(1).max(365),
  preferredCheckInShift: e(CheckInShift).default('UNKNOWN'), useAirConditioning: z.boolean().default(false),
  source: z.enum(['WEB', 'MOBILE']).default('WEB'), idempotencyKey: z.string().min(8).max(100).optional(),
});
// Bắt buộc: không có chấp thuận thì không tạo được đặt chỗ. Client chỉ gửi số phiên bản,
// thời điểm và IP do server tự đóng dấu để khách không tự khai được.
const consentBody = z.object({
  termsVersion: z.string().min(1).max(20), privacyVersion: z.string().min(1).max(20),
  // Khách phải xác nhận đã được báo trước các khoản phải trả (tiền giữ chân hôm nay + tiền thuê kỳ đầu: trả THÊM khi nhận kho,
  // hoặc cùng lúc đặt chỗ với kho cỡ lớn) — tránh tranh chấp "không được báo". Chỉ dùng để chặn ở API; thời điểm xác nhận
  // do server đóng dấu (consent.paymentScheduleAckAt).
  paymentScheduleAck: z.literal(true, { errorMap: () => ({ message: 'Cần xác nhận đã đọc lịch thanh toán: tiền giữ chân + tiền thuê kỳ đầu (trả khi đặt chỗ hoặc khi nhận kho)' }) }),
});

reservationsRouter.post('/', authorize('CUSTOMER'), validate({ body: bookingItemBody.extend({ consent: consentBody }) }), async (req, res) => {
  const { consent: { paymentScheduleAck: _ack, ...consent }, ...item } = req.valid.body;
  res.status(201).json(await createReservation(req.auth!.user, {
    ...item,
    idempotencyKey: item.idempotencyKey ?? req.header('idempotency-key'),
    consent: { ...consent, ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 300) ?? null },
  }));
});

/** Đặt nhiều kho một lần (giỏ hàng) — cùng một lần chấp thuận điều khoản cho toàn giỏ. */
reservationsRouter.post('/batch', authorize('CUSTOMER'), validate({ body: z.object({
  items: z.array(bookingItemBody).min(1).max(10),
  consent: consentBody,
}) }), async (req, res) => {
  const { paymentScheduleAck: _ack, ...accepted } = req.valid.body.consent;
  const consent = { ...accepted, ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 300) ?? null };
  const items: BookingItem[] = req.valid.body.items.map((item: Omit<BookingItem, 'consent'>) => ({ ...item, consent }));
  res.status(201).json({ items: await createReservationsBatch(req.auth!.user, items) });
});

reservationsRouter.post('/:id/pay-deposit', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({ method: onlinePay }) }), async (req, res) => {
  res.json(await payDeposit(req.auth!.user, req.valid.params.id, req.valid.body.method));
});

/**
 * Ký xác nhận hợp đồng sau khi trả cọc — CHỈ chính khách (chủ đặt chỗ) ký, trên tài khoản của họ. Nhân viên
 * không ký thay: tránh việc nhân viên tự điền tên khách rồi bấm đồng ý. Ảnh chữ ký vẽ tay là PNG data URL
 * nhỏ (≤ ~60KB).
 */
reservationsRouter.post('/:id/sign', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({
  signerName: zPersonName, method: e(SignatureMethod), image: z.string().max(80_000).nullable().optional(),
}) }), async (req, res) => {
  res.json(await signContract(req.auth!.user, req.valid.params.id, req.valid.body));
});

/** Nội dung hợp đồng để xem: chưa ký → dựng từ mẫu đang áp dụng; đã ký → đúng nguyên văn lúc ký. */
reservationsRouter.get('/:id/contract', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await contractViewForUser(req.auth!.user, req.valid.params.id));
});

/** PDF hợp đồng đã ký (có chữ ký) — khách chủ đặt chỗ hoặc nhân viên/quản lý đúng chi nhánh. */
reservationsRouter.get('/:id/contract.pdf', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  const { pdf, filename } = await contractPdfFor(req.auth!.user, req.valid.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

/** Gửi lại PDF hợp đồng đã ký tới email của khách (tối thiểu 60 giây giữa hai lần). */
reservationsRouter.post('/:id/contract/email', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await resendContractEmail(req.auth!.user, req.valid.params.id));
});

/** Cấp lại mã QR nhận kho cho app mobile. Mỗi lần gọi vô hiệu hoá mã đã cấp trước đó. */
reservationsRouter.post('/:id/qr', authorize('CUSTOMER'), validate({ params: idParams }), async (req, res) => {
  res.json(await reissueCheckInQr(req.auth!.user, req.valid.params.id));
});

reservationsRouter.post('/:id/cancel', validate({ params: idParams, body: z.object({ reason: e(CancellationReason).default('CUSTOMER_REQUEST'), note: z.string().max(500).optional() }) }), async (req, res) => {
  const u = req.auth!.user;
  const reason = u.role === 'CUSTOMER' ? 'CUSTOMER_REQUEST' : req.valid.body.reason; // customers can't pick staff-side reasons
  // Hết giờ giữ chỗ / khách không đến (hoàn 0%) chỉ hệ thống áp đúng hạn — chi nhánh huỷ thì là khách yêu cầu (hoàn theo chính sách)
  // hoặc chi nhánh không giao được ô (hoàn 100%, Điều 11).
  if (!STAFF_CANCEL_REASONS.includes(reason)) throw Unprocessable('Lý do huỷ này do hệ thống tự áp khi đến hạn — chọn "Khách yêu cầu" hoặc "Chi nhánh không đáp ứng"', 'SYSTEM_ONLY_REASON');
  res.json(await cancelReservation(u, req.valid.params.id, reason, req.valid.body.note));
});

reservationsRouter.post('/:id/allocate', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ unitId: zId.optional() }) }), async (req, res) => {
  res.json(await allocate(req.auth!.user, req.valid.params.id, req.valid.body.unitId));
});

reservationsRouter.post('/:id/unallocate', authorize('FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await unallocate(req.auth!.user, req.valid.params.id));
});

// Hình thức khoá do loại kho quyết định (server tự lấy) — nhân viên chỉ nhập mã thẻ/chìa nếu cần.
/** Nhân viên sửa họ tên / giấy tờ của khách tại quầy (đã đối chiếu bản gốc) — khách có hợp đồng thì không tự sửa được. */
reservationsRouter.patch('/:id/customer-identity', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  fullName: zPersonName.optional(), idType: zIdType.optional(), idNumberLast4: zIdLast4.optional(),
  reason: z.string().trim().min(5).max(500).describe('VD đổi CCCD mới, sai chính tả tên — đã đối chiếu bản gốc'),
}).refine((b) => b.fullName !== undefined || b.idType !== undefined, 'Không có thông tin nào để sửa')
  .refine((b) => (b.idType === undefined) === (b.idNumberLast4 === undefined), 'Loại giấy tờ và 4 số cuối phải nhập cùng nhau') }), async (req, res) => {
  const r = await ReservationModel.findById(req.valid.params.id, { facilityId: 1, customerId: 1, status: 1 }).lean();
  if (!r) throw NotFound('đặt chỗ');
  // Chỉ qua đặt chỗ còn hiệu lực ở chi nhánh mình — đặt chỗ đã huỷ / đã kết thúc không còn là căn cứ để sửa danh tính khách.
  if (!['PENDING', 'CONFIRMED', 'ALLOCATED', 'CHECKED_IN'].includes(r.status)) throw Unprocessable('Đặt chỗ đã huỷ hoặc đã kết thúc — sửa danh tính qua hợp đồng / đặt chỗ đang hiệu lực của khách', 'NOT_OPEN');
  const { reason, ...patch } = req.valid.body;
  res.json({ user: await updateCustomerIdentity(req.auth!.user, r.facilityId, r.customerId, { ...patch, reason }) });
});

reservationsRouter.post('/:id/check-in', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  // payMethod: phương thức thu tiền thuê kỳ đầu — bắt buộc với kho thường; kho cỡ lớn đã thu lúc đặt chỗ nên có thể bỏ trống.
  keyTag: z.string().max(40).optional(), payMethod: e(PaymentMethod).refine((m) => m !== 'INTERNAL').optional(), qrToken: z.string().optional(),
  // Nhân viên phải đối chiếu giấy tờ tùy thân BẢN GỐC của khách trước khi bàn giao. idType / idNumberLast4: 4 số cuối trên giấy tờ
  // khách xuất trình — bắt buộc khi khách chưa khai trong tài khoản, có khai thì phải khớp.
  identityVerified: z.literal(true, { errorMap: () => ({ message: 'Đối chiếu giấy tờ tùy thân bản gốc của khách trước khi bàn giao kho' }) }),
  idType: zIdType.optional(), idNumberLast4: zIdLast4.optional(),
}) }), async (req, res) => {
  res.json(await checkIn(req.auth!.user, req.valid.params.id, req.valid.body));
});
