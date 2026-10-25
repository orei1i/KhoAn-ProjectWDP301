import { Router } from 'express';
import { z } from 'zod';
import { CANCEL_NOTE_MAX, CANCEL_NOTE_MIN, CANCEL_REASONS_BY_ROLE, CancellationReason, CheckInShift, enumValues, PAPER_CONTRACT_TYPES, PaymentMethod, RentalPeriod, ReservationStatus } from '@ssm/shared';
import { ReservationModel } from '../../shared/db/models';
import { BadRequest, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { authenticate, optionalAuthenticate } from '../../shared/http/authenticate';
import { rateLimit } from '../../shared/http/rate-limit';
import { authorize } from '../../shared/http/authorize';
import { assertCanAccess, scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zDate, zId, zIdLast4, zIdType, zPersonName, zProfilePhone } from '../../shared/http/validate';
import { updateCustomerIdentity } from '../users/user.service';
import { contractPdfFor, contractPrintPdfFor, contractViewForUser, resendContractEmail } from './contract-document.service';
import {
  allocate, cancelReservation, checkIn, createReservation, createReservationsBatch, createWalkInBooking, lookupForCheckIn, payDeposit, requestWalkInEmailOtp,
  previewContract, previewContractPdf, reissueCheckInQr, requestSignOtp, rescheduleReservation, signContract, signedFileFor, signPaper, unallocate, type BookingItem,
} from './reservation.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);
const onlinePay = z.enum(['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER']);
/** Lý do chỉ hệ thống tự áp đúng hạn (hết giờ giữ chỗ / khách không đến / thanh toán lỗi) — không ai chọn tay. */
const SYSTEM_CANCEL_REASONS: CancellationReason[] = ['HOLD_EXPIRED', 'NO_SHOW', 'PAYMENT_FAILED'];

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
  // Dịch vụ thêm chọn kèm (mua thùng, vận chuyển…) — đơn RIÊNG ngoài hợp đồng thuê, thu tiền khi nhận kho.
  services: z.array(z.object({ serviceId: zId, quantity: z.number().int().min(1).max(99), note: z.string().trim().max(500).optional() })).max(10).optional(),
});
// Bắt buộc: không có chấp thuận thì không tạo được đặt chỗ. Client chỉ gửi số phiên bản,
// thời điểm và IP do server tự đóng dấu để khách không tự khai được.
const consentBody = z.object({
  termsVersion: z.string().min(1).max(20), privacyVersion: z.string().min(1).max(20),
  // Khách phải xác nhận đã được báo trước các khoản phải trả (tiền giữ chân hôm nay + tiền thuê kỳ đầu: trả THÊM khi nhận kho,
  // hoặc cùng lúc đặt chỗ với kho cỡ lớn) — tránh tranh chấp "không được báo". Chỉ dùng để chặn ở API; thời điểm xác nhận
  // do server đóng dấu (consent.paymentScheduleAckAt).
  paymentScheduleAck: z.literal(true, { errorMap: () => ({ message: 'Cần xác nhận đã đọc lịch thanh toán: tiền giữ chân + tiền thuê kỳ đầu (trả khi đặt chỗ hoặc khi nhận kho)' }) }),
  // Khách phải mở xem hợp đồng của kho trước khi trả tiền giữ chân — tránh "chưa được xem hợp đồng" khi huỷ mất tiền. Thời điểm do server
  // đóng dấu (consent.contractAckAt).
  contractAck: z.literal(true, { errorMap: () => ({ message: 'Cần mở xem và xác nhận đã đọc hợp đồng của kho trước khi đặt' }) }),
});
/** Bỏ các cờ xác nhận (chỉ để chặn ở API), đóng dấu ip / userAgent của máy gửi. */
const stampConsent = (c: z.infer<typeof consentBody>, req: { ip?: string; header(name: string): string | undefined }) => {
  const { paymentScheduleAck: _ack, contractAck: _contract, ...accepted } = c;
  return { ...accepted, ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 300) ?? null };
};

reservationsRouter.post('/', authorize('CUSTOMER'), validate({ body: bookingItemBody.extend({ consent: consentBody }) }), async (req, res) => {
  const { consent, ...item } = req.valid.body;
  res.status(201).json(await createReservation(req.auth!.user, {
    ...item,
    idempotencyKey: item.idempotencyKey ?? req.header('idempotency-key'),
    consent: stampConsent(consent, req),
  }));
});

/** Đặt nhiều kho một lần (giỏ hàng) — cùng một lần chấp thuận điều khoản cho toàn giỏ. */
reservationsRouter.post('/batch', authorize('CUSTOMER'), validate({ body: z.object({
  items: z.array(bookingItemBody).min(1).max(10),
  consent: consentBody,
}) }), async (req, res) => {
  const consent = stampConsent(req.valid.body.consent, req);
  const items: BookingItem[] = req.valid.body.items.map((item: Omit<BookingItem, 'consent'>) => ({ ...item, consent }));
  res.status(201).json({ items: await createReservationsBatch(req.auth!.user, items) });
});

/**
 * Đặt chỗ TẠI QUẦY cho khách vãng lai: nhân viên tạo đặt chỗ thay khách (khách mới thì tạo tài khoản) và thu ngay tiền giữ chân
 * (+ tiền thuê kỳ đầu với kho cỡ lớn) → ALLOCATED. Sau đó: in hợp đồng → khách ký giấy → nhận kho. Chống bấm hai lần bằng
 * header Idempotency-Key. consent: khách xác nhận trước mặt nhân viên (ip / userAgent là của máy quầy).
 */
const walkInCustomer = z.union([
  z.object({ customerId: zId, idType: zIdType.optional(), idNumberLast4: zIdLast4.optional() })
    .refine((c) => (c.idType === undefined) === (c.idNumberLast4 === undefined), 'Loại giấy tờ và 4 số cuối phải nhập cùng nhau'),
  z.object({
    email: z.string().trim().email('Email không hợp lệ').max(254).transform((v) => v.toLowerCase()), fullName: zPersonName, phone: zProfilePhone,
    idType: zIdType, idNumberLast4: zIdLast4,
    // Mã 6 số gửi tới email khách (POST /reservations/walk-in/email-otp) — bắt buộc với khách mới (EMAIL_OTP_REQUIRED / _INVALID / _EXPIRED).
    emailOtp: z.string().trim().max(10).optional(),
  }),
]);
/** Khách mới tại quầy: gửi mã xác minh tới email khách khai (10 phút, gửi lại sau 60 giây). Email đã có tài khoản → 409 EMAIL_EXISTS. */
// Giới hạn theo NHÂN VIÊN (10 lần / 10 phút / người — 429 RATE_LIMITED): chặn dùng quầy để gửi thư hàng loạt tới địa chỉ bất kỳ.
reservationsRouter.post('/walk-in/email-otp', authorize('STAFF', 'FACILITY_MANAGER'), rateLimit({ windowMs: 10 * 60_000, max: 10, key: 'user', name: 'walk-in-email-otp' }), validate({ body: z.object({
  email: z.string().trim().email('Email không hợp lệ').max(254).transform((v) => v.toLowerCase()),
}) }), async (req, res) => {
  res.json(await requestWalkInEmailOtp(req.auth!.user, req.valid.body.email));
});
reservationsRouter.post('/walk-in', authorize('STAFF', 'FACILITY_MANAGER'), validate({ body: z.object({
  customer: walkInCustomer,
  items: z.array(bookingItemBody.omit({ source: true, idempotencyKey: true })).min(1).max(10),
  payMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD']),
  txnRef: z.string().trim().max(64).optional().describe('Mã giao dịch chuyển khoản / chuẩn chi thẻ — bắt buộc khi payMethod ≠ CASH'),
  consent: consentBody,
}) }), async (req, res) => {
  const key = req.header('idempotency-key')?.trim() || undefined;
  if (key && (key.length < 8 || key.length > 80)) throw BadRequest('Idempotency-Key dài 8–80 ký tự');
  const { customer, items, payMethod, txnRef, consent } = req.valid.body;
  res.status(201).json(await createWalkInBooking(req.auth!.user, { customer, items, payMethod, txnRef, consent: stampConsent(consent, req), idempotencyKey: key }));
});

reservationsRouter.post('/:id/pay-deposit', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({ method: onlinePay }) }), async (req, res) => {
  res.json(await payDeposit(req.auth!.user, req.valid.params.id, req.valid.body.method));
});

/**
 * Ký xác nhận hợp đồng sau khi trả cọc — CHỈ chính khách (chủ đặt chỗ) ký, trên tài khoản của họ. Nhân viên
 * không ký thay: tránh việc nhân viên tự điền tên khách rồi bấm đồng ý. Ảnh chữ ký vẽ tay là PNG data URL
 * nhỏ (≤ ~60KB).
 */
/** Gửi mã OTP qua email trước khi ký online (hiệu lực 10 phút, gửi lại sau 60 giây). */
reservationsRouter.post('/:id/sign-otp', authorize('CUSTOMER'), validate({ params: idParams }), async (req, res) => {
  res.json(await requestSignOtp(req.auth!.user, req.valid.params.id));
});

reservationsRouter.post('/:id/sign', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({
  signerName: zPersonName, method: z.enum(['DRAWN', 'TYPED']), image: z.string().max(80_000).nullable().optional(),
  otp: z.string().regex(/^\d{6}$/, 'Mã xác nhận gồm 6 chữ số').optional(),
}) }), async (req, res) => {
  res.json(await signContract(req.auth!.user, req.valid.params.id, req.valid.body));
});

/** Khách ký GIẤY tại quầy: bản in để ký, rồi nhân viên tải bản scan lên. */
reservationsRouter.get('/:id/contract-print.pdf', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  const { pdf, filename } = await contractPrintPdfFor(req.auth!.user, req.valid.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});
reservationsRouter.post('/:id/sign-paper', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  signerName: zPersonName,
  file: z.object({ name: z.string().trim().min(1).max(200), contentType: z.enum([...PAPER_CONTRACT_TYPES]), base64: z.string().min(10).max(7_100_000) }),
}) }), async (req, res) => {
  res.json(await signPaper(req.auth!.user, req.valid.params.id, req.valid.body));
});
reservationsRouter.get('/:id/signed-file', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  const f = await signedFileFor(req.auth!.user, req.valid.params.id);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
  res.send(f.data);
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

/**
 * Huỷ đặt chỗ. Khách: luôn là "khách yêu cầu". Chi nhánh: lý do theo vai trò (CANCEL_REASONS_BY_ROLE — nhân viên chỉ "khách yêu cầu",
 * quản lý chi nhánh thêm "chi nhánh không đáp ứng", vận hành / quản trị thêm "quản trị huỷ"; khác → 403 CANCEL_REASON_FORBIDDEN) và
 * BẮT BUỘC ghi chú 5–300 ký tự (422 CANCEL_NOTE_REQUIRED) — lưu vào đặt chỗ + nhật ký, email báo khách kèm lý do và số tiền hoàn.
 */
reservationsRouter.post('/:id/cancel', validate({ params: idParams, body: z.object({ reason: e(CancellationReason).default('CUSTOMER_REQUEST'), note: z.string().max(500).optional() }) }), async (req, res) => {
  const u = req.auth!.user;
  const reason = u.role === 'CUSTOMER' ? 'CUSTOMER_REQUEST' : req.valid.body.reason; // customers can't pick staff-side reasons
  // Hết giờ giữ chỗ / khách không đến (hoàn 0%) chỉ hệ thống áp đúng hạn — chi nhánh huỷ thì là khách yêu cầu (hoàn theo chính sách)
  // hoặc chi nhánh không giao được ô (hoàn 100%, Điều 11).
  if (SYSTEM_CANCEL_REASONS.includes(reason)) throw Unprocessable('Lý do huỷ này do hệ thống tự áp khi đến hạn — chọn "Khách yêu cầu" hoặc "Chi nhánh không đáp ứng"', 'SYSTEM_ONLY_REASON');
  if (!CANCEL_REASONS_BY_ROLE[u.role].includes(reason)) throw Forbidden('Vai trò của bạn không được huỷ đặt chỗ với lý do này', 'CANCEL_REASON_FORBIDDEN');
  const note = req.valid.body.note?.trim() || undefined;
  if (u.role !== 'CUSTOMER' && (!note || note.length < CANCEL_NOTE_MIN || note.length > CANCEL_NOTE_MAX)) {
    throw Unprocessable(`Ghi rõ lý do huỷ (${CANCEL_NOTE_MIN}–${CANCEL_NOTE_MAX} ký tự) — nội dung được gửi kèm email báo khách`, 'CANCEL_NOTE_REQUIRED');
  }
  res.json(await cancelReservation(u, req.valid.params.id, reason, note));
});

/**
 * Đổi ngày nhận kho — khách (chủ đặt chỗ) hoặc nhân viên / quản lý chi nhánh (VD khách đến sớm tại quầy → dời về hôm nay). Chỉ
 * đặt chỗ đã trả giữ chân, chưa nhận kho; quy tắc ở `rescheduleCheck` (shared). Đã ký thì chữ ký hết hiệu lực, phải ký lại.
 */
reservationsRouter.post('/:id/reschedule', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  startDate: zDate, reason: z.string().trim().max(300).optional(),
}) }), async (req, res) => {
  const r = await rescheduleReservation(req.auth!.user, req.valid.params.id, req.valid.body);
  // Trả về giống GET /:id (populate loại kho + ô) để client thay thẳng bản đang hiển thị.
  res.json(await ReservationModel.findById(r._id).populate('unitTypeId', 'name code dimensions').populate('unitId', 'unitNumber location'));
});

reservationsRouter.post('/:id/allocate', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ unitId: zId.optional() }) }), async (req, res) => {
  res.json(await allocate(req.auth!.user, req.valid.params.id, req.valid.body.unitId));
});

reservationsRouter.post('/:id/unallocate', authorize('FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await unallocate(req.auth!.user, req.valid.params.id));
});

// Hình thức khoá do loại kho quyết định (server tự lấy) — nhân viên chỉ nhập mã thẻ/chìa nếu cần.
/** Quản lý chi nhánh sửa họ tên / giấy tờ của khách tại quầy (đã đối chiếu bản gốc) — nhân viên không tự sửa, để không lách được
 * bước chặn "giấy tờ không khớp" lúc nhận kho — khách có hợp đồng thì không tự sửa được. */
reservationsRouter.patch('/:id/customer-identity', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
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
  // Thu không bằng tiền mặt → bắt buộc mã giao dịch (4–64 ký tự) làm chứng từ (TXN_REF_REQUIRED).
  txnRef: z.string().trim().max(64).optional(),
  // Nhân viên phải đối chiếu giấy tờ tùy thân BẢN GỐC của khách trước khi bàn giao. idType / idNumberLast4: 4 số cuối trên giấy tờ
  // khách xuất trình — bắt buộc khi khách chưa khai trong tài khoản, có khai thì phải khớp.
  identityVerified: z.literal(true, { errorMap: () => ({ message: 'Đối chiếu giấy tờ tùy thân bản gốc của khách trước khi bàn giao kho' }) }),
  idType: zIdType.optional(), idNumberLast4: zIdLast4.optional(),
  // Kiểm tra hàng hoá (Điều 4): xác nhận đủ các nhóm hàng cấm KHÔNG có (INTAKE_CHECK_ITEMS), kèm ghi chú / link ảnh nếu có.
  goodsCheck: z.object({
    confirmed: z.array(z.string().max(30)).max(20),
    note: z.string().trim().max(500).optional(),
    photoUrls: z.array(z.string().url().max(500)).max(10).optional(),
  }, { errorMap: () => ({ message: 'Kiểm tra hàng hoá khách mang vào trước khi bàn giao kho' }) }),
}) }), async (req, res) => {
  res.json(await checkIn(req.auth!.user, req.valid.params.id, req.valid.body));
});
