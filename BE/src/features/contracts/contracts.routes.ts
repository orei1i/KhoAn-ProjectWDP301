import { Router } from 'express';
import { z } from 'zod';
import { enumValues, AbandonedItemsDisposal, ContractStatus, isValidPhone, ItemCondition, LEFTOVER_FEE_MAX, OPEN_CONTRACT_STATUSES, PaymentMethod, PHONE_MESSAGE } from '@ssm/shared';
import { InspectionModel, PaymentModel, RentalContractModel } from '../../shared/db/models';
import { BadRequest, NotFound, Unprocessable } from '../../shared/core/errors';
import { unlockIdCheck } from './id-check';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { assertCanAccess, scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, presentedIdBody, validate, zDate, zId, zIdLast4, zIdType, zMoney, zPersonName } from '../../shared/http/validate';
import { updateCustomerIdentity } from '../users/user.service';
import {
  adjustDamage, appendixPdfFor, cancelMoveOut, extendContract, extensionQuote, lockout, payBalance, sendFinalNotice, writeOffDebt, processAbandonment, receiveUnit, requestMoveOut, submitMoveOutInspection,
  recordFinalNoticeDelivery, resolveLeftover, swapCandidates, swapUnit, SWAP_FEE_MAX, waiveLateFees,
} from './contract.service';
import { createSwapRequest, listSwapRequestsForContract } from '../swaps/unit-swap-request.service';
import { paymentProjectionFor } from '../payments/payment.service';
import { addAuthorizedPerson, assistedOpen, getContractAccess, removeAuthorizedPerson } from '../access/access.service';
import { cancelIntake, contractInventory, declareIntake, intakeBatchesOfContract, inventoryFor, updateDeclaredIntake } from '../intake/intake.service';
import { goodsCheckBody, intakeCancelBody, intakeItemsBody, intakeUpdateBody } from '../intake/intake.routes';

export const contractsRouter = Router();
contractsRouter.use(authenticate);

/** Ảnh chữ ký bàn giao (nhận lại kho) chỉ lưu làm chứng cứ — không gửi ra danh sách / chi tiết, như các ảnh chữ ký khác. */
const HIDDEN = { 'moveOut.handover.image': 0 } as const;
/**
 * Nhân viên quầy KHÔNG thấy 4 số cuối giấy tờ (của khách đã đối chiếu lúc nhận kho, của người được uỷ quyền) — phải nhập từ giấy tờ
 * bản gốc để server so khớp khi mở hộ / giao thẻ, chìa mới (như bootstrap). Quản lý chi nhánh / vận hành giữ.
 */
const hiddenFor = (role: string) => (role === 'STAFF' ? { ...HIDDEN, 'identity.idNumberLast4': 0, 'authorizedPersons.idNumberLast4': 0 } : HIDDEN);
/** Cùng quy tắc cho hợp đồng trả về sau một thao tác (đã nạp đủ trường). */
type Scrubbable = { moveOut?: { handover?: { image?: unknown } | null } | null; identity?: { idNumberLast4?: string } | null; authorizedPersons?: { idNumberLast4?: string }[] };
const scrubForRole = (c: { toObject: () => object }, role: string) => {
  const o = c.toObject() as Scrubbable;
  if (o.moveOut?.handover) delete o.moveOut.handover.image;
  if (role === 'STAFF') {
    if (o.identity) delete o.identity.idNumberLast4;
    o.authorizedPersons = (o.authorizedPersons ?? []).map(({ idNumberLast4: _x, ...p }) => p);
  }
  return o;
};

contractsRouter.get('/', validate({ query: paging.extend({ facilityId: zId.optional(), status: z.string().optional(), overdue: z.enum(['true', 'false']).optional() }) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, facilityId, status, overdue } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user, { customerField: 'customerId' }) };
  if (facilityId) filter.facilityId = facilityId;
  if (status) filter.status = { $in: status.split(',').filter((s: string) => (enumValues(ContractStatus) as string[]).includes(s)) };
  if (overdue === 'true') filter['balance.outstanding'] = { $gt: 0 };
  const [items, total] = await Promise.all([
    RentalContractModel.find(filter, hiddenFor(req.auth!.user.role)).sort({ 'delinquency.daysOverdue': -1, endDate: 1 }).skip((page - 1) * limit).limit(limit)
      .populate('customerId', 'fullName phone').populate('unitId', 'unitNumber location').populate('unitTypeId', 'name'),
    RentalContractModel.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

contractsRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  const c = await RentalContractModel.findById(req.valid.params.id, hiddenFor(req.auth!.user.role)).populate('unitId', 'unitNumber location').populate('unitTypeId', 'name');
  if (!c) throw NotFound('hợp đồng');
  await assertCanAccess(req.auth!.user, { facilityId: c.facilityId, customerId: c.customerId }, 'contract.read');
  const [payments, inventory] = await Promise.all([
    PaymentModel.find({ contractId: c._id }, paymentProjectionFor(req.auth!.user.role)).sort({ createdAt: -1 }).limit(50),
    inventoryFor(c._id), // "đồ đang gửi" (đợt 14) — tổng các đợt nhập đã xác nhận
  ]);
  res.json({ contract: c, payments, inventory });
});

// ---- nhập hàng nhiều đợt (đợt 14) — xem thêm /intake-batches
/** "Đồ đang gửi" = mọi dòng của các đợt nhập CONFIRMED + tổng giá trị ước tính. */
contractsRouter.get('/:id/inventory', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json({ contractId: req.valid.params.id, ...(await contractInventory(req.auth!.user, req.valid.params.id)) });
});
contractsRouter.get('/:id/intake-batches', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json({ items: await intakeBatchesOfContract(req.auth!.user, req.valid.params.id) });
});
/**
 * Khai đợt nhập hàng. Khách (chủ hợp đồng ACTIVE / DELINQUENT): DECLARED, chờ chi nhánh kiểm hàng. Nhân viên / quản lý chi nhánh tạo THAY
 * khách tại quầy: bắt buộc `onBehalf: true` + `goodsCheck` đủ mục → CONFIRMED ngay (khai + xác nhận một bước).
 */
contractsRouter.post('/:id/intake-batches', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  items: intakeItemsBody,
  expectedDate: zDate.nullish().describe('Ngày khách dự kiến mang đồ đến'),
  onBehalf: z.boolean().optional().describe('Nhân viên tạo thay khách — bắt buộc true với STAFF / FACILITY_MANAGER'),
  goodsCheck: goodsCheckBody.optional().describe('Bắt buộc khi onBehalf (đủ INTAKE_CHECK_ITEMS)'),
  staffNote: z.string().trim().max(500).optional(),
}) }), async (req, res) => {
  res.status(201).json(await declareIntake(req.auth!.user, req.valid.params.id, req.valid.body));
});
// Cùng thao tác với PATCH /intake-batches/:id và POST /intake-batches/:id/cancel, theo đường dẫn của hợp đồng.
contractsRouter.patch('/:id/intake-batches/:batchId', authorize('CUSTOMER'), validate({ params: idParams.extend({ batchId: zId }), body: intakeUpdateBody }), async (req, res) => {
  res.json(await updateDeclaredIntake(req.auth!.user, req.valid.params.batchId, req.valid.body, req.valid.params.id));
});
contractsRouter.post('/:id/intake-batches/:batchId/cancel', authorize('CUSTOMER'), validate({ params: idParams.extend({ batchId: zId }), body: intakeCancelBody }), async (req, res) => {
  res.json(await cancelIntake(req.auth!.user, req.valid.params.batchId, req.valid.body.reason, req.valid.params.id));
});

const pm = z.enum(enumValues(PaymentMethod) as [string, ...string[]]).refine((m) => m !== 'INTERNAL') as z.ZodType<PaymentMethod>;

// Chủ hợp đồng xem phương tiện vào kho hiện tại (mật khẩu giải mã tại đây, mỗi lần xem ghi nhật ký).
contractsRouter.get('/:id/access', authorize('CUSTOMER'), validate({ params: idParams }), async (req, res) => {
  res.json(await getContractAccess(req.auth!.user, req.valid.params.id));
});

// Nhân viên mở kho HỘ khách bằng chìa tổng / thẻ tổng (khách mất chìa, mất thẻ, cần vào gấp). Bắt buộc ghi lý do và nhập giấy tờ
// BẢN GỐC người đến quầy xuất trình (presenter + idType + idNumberLast4) — server so với hồ sơ khách / người được uỷ quyền
// (ID_REQUIRED / ID_MISMATCH). Mỗi lần mở được ghi vào hợp đồng + nhật ký kiểm toán, khách xem được.
contractsRouter.post('/:id/assisted-open', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  reason: z.string().trim().min(5, 'Ghi lý do mở hộ (ít nhất 5 ký tự)').max(300),
  ...presentedIdBody,
}) }), async (req, res) => {
  const { identityVerified: _v, ...body } = req.valid.body;
  res.json(scrubForRole(await assistedOpen(req.auth!.user, req.valid.params.id, body), req.auth!.user.role));
});

// Người được uỷ quyền ra vào / lấy đồ — chỉ chủ hợp đồng thêm, xoá (tối đa 3). Nhân viên đối chiếu tại quầy.
contractsRouter.post('/:id/authorized-persons', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({
  fullName: zPersonName,
  phone: z.string().trim().refine(isValidPhone, PHONE_MESSAGE),
  idNumberLast4: z.string().regex(/^\d{4}$/, 'Nhập đúng 4 số cuối giấy tờ tùy thân'),
  relationship: z.string().trim().max(60).optional(),
}) }), async (req, res) => {
  res.status(201).json(await addAuthorizedPerson(req.auth!.user, req.valid.params.id, req.valid.body));
});
contractsRouter.delete('/:id/authorized-persons/:personId', authorize('CUSTOMER'), validate({ params: idParams.extend({ personId: z.string().min(1).max(60) }) }), async (req, res) => {
  res.json(await removeAuthorizedPerson(req.auth!.user, req.valid.params.id, req.valid.params.personId));
});

// Xem trước giá gia hạn: gia hạn là cam kết mới — giá niêm yết hiện hành, ưu đãi theo số tháng gia hạn.
contractsRouter.get('/:id/extension-quote', authorize('CUSTOMER'), validate({ params: idParams, query: z.object({ periods: z.coerce.number().int().min(1).max(60) }) }), async (req, res) => {
  res.json(await extensionQuote(req.auth!.user, req.valid.params.id, req.valid.query.periods));
});
// `method` chỉ cần khi thuê theo ngày / tuần (trả trọn kỳ gia hạn ngay); thuê tháng không thu tiền lúc gia hạn.
// `acceptAppendix`: Bên B xác nhận Phụ lục gia hạn (bản xem trước ở /extension-quote) — bắt buộc, kèm ip / user-agent làm dấu vết.
// `expected`: chép đúng `rate`, `payNow`, `from`, `newEndDate` của báo giá /extension-quote khách đang xem — giá đổi (bảng giá / chính
// sách vừa sửa) hoặc mốc đổi (hợp đồng vừa được gia hạn: gửi trùng, hai thiết bị) → 409 PRICE_CHANGED, client tải lại báo giá; không gia
// hạn theo báo giá khách chưa thấy. Header Idempotency-Key (8–80 ký tự): gửi lại cùng khoá → trả lại kết quả lần trước (`replayed: true`).
contractsRouter.post('/:id/extend', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({
  periods: z.number().int().min(1).max(60), method: pm.optional(), acceptAppendix: z.boolean().default(false),
  expected: z.object({ rate: zMoney, payNow: zMoney, from: zDate, newEndDate: zDate }, { errorMap: () => ({ message: 'Gửi kèm báo giá gia hạn đã xem (rate, payNow, from, newEndDate)' }) }),
}) }), async (req, res) => {
  const key = req.header('idempotency-key')?.trim() || undefined;
  if (key && (key.length < 8 || key.length > 80)) throw BadRequest('Idempotency-Key dài 8–80 ký tự');
  res.json(await extendContract(req.auth!.user, req.valid.params.id, req.valid.body.periods, req.valid.body.method,
    { accepted: req.valid.body.acceptAppendix, ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 300) ?? null }, req.valid.body.expected, key));
});
// Quản lý chi nhánh mở khoá đối chiếu giấy tờ (bị khoá do nhập sai ID_CHECK_MAX_FAILURES lần trong 24 giờ khi mở hộ / giao thẻ, chìa).
contractsRouter.post('/:id/id-check/unlock', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  reason: z.string().trim().min(5, 'Ghi lý do mở khoá (ít nhất 5 ký tự)').max(300),
}) }), async (req, res) => {
  res.json(await unlockIdCheck(req.auth!.user, 'contract', req.valid.params.id, req.valid.body.reason));
});
/** PDF phụ lục gia hạn đã xác nhận. */
contractsRouter.get('/:id/appendices/:number.pdf', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams.extend({ number: z.coerce.number().int().min(1).max(200) }) }), async (req, res) => {
  const { pdf, filename } = await appendixPdfFor(req.auth!.user, req.valid.params.id, req.valid.params.number);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});
// Nhân viên thu tại quầy: không phải tiền mặt thì bắt buộc `txnRef` (mã giao dịch chuyển khoản / chuẩn chi thẻ / VNPay-MoMo, 4–64 ký tự).
contractsRouter.post('/:id/pay-balance', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  method: pm,
  txnRef: z.string().trim().max(64).optional().describe('Mã giao dịch — bắt buộc khi nhân viên thu không bằng tiền mặt'),
}) }), async (req, res) => {
  res.json(await payBalance(req.auth!.user, req.valid.params.id, req.valid.body.method, req.valid.body.txnRef));
});
// Khách khiếu nại biên bản trả kho đúng → giảm chi phí hư hại: trừ nợ còn lại trước, phần dư hoàn chuyển khoản (chờ xác nhận).
contractsRouter.post('/:id/damage-adjustment', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({ amount: zMoney, reason: z.string().min(5).max(500) }) }), async (req, res) => {
  res.json(await adjustDamage(req.auth!.user, req.valid.params.id, req.valid.body));
});
contractsRouter.post('/:id/write-off-debt', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({ reason: z.string().min(5).max(500) }) }), async (req, res) => {
  res.json(await writeOffDebt(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});
/** Nhân viên / quản lý sửa họ tên / giấy tờ của khách tại quầy (đã đối chiếu bản gốc). */
contractsRouter.patch('/:id/customer-identity', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  fullName: zPersonName.optional(), idType: zIdType.optional(), idNumberLast4: zIdLast4.optional(),
  reason: z.string().trim().min(5).max(500).describe('VD đổi CCCD mới, sai chính tả tên — đã đối chiếu bản gốc'),
}).refine((b) => b.fullName !== undefined || b.idType !== undefined, 'Không có thông tin nào để sửa')
  .refine((b) => (b.idType === undefined) === (b.idNumberLast4 === undefined), 'Loại giấy tờ và 4 số cuối phải nhập cùng nhau') }), async (req, res) => {
  const c = await RentalContractModel.findById(req.valid.params.id, { facilityId: 1, customerId: 1, status: 1 }).lean();
  if (!c) throw NotFound('hợp đồng');
  // Hợp đồng đã đóng không còn là căn cứ: nếu không, nhân viên chi nhánh cũ sửa được danh tính khách đang thuê ở chi nhánh khác.
  if (!OPEN_CONTRACT_STATUSES.includes(c.status)) throw Unprocessable('Hợp đồng đã kết thúc — sửa danh tính qua hợp đồng / đặt chỗ đang hiệu lực của khách', 'NOT_OPEN');
  const { reason, ...patch } = req.valid.body;
  res.json({ user: await updateCustomerIdentity(req.auth!.user, c.facilityId, c.customerId, { ...patch, reason }) });
});
contractsRouter.post('/:id/lockout', authorize('FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await lockout(req.auth!.user, req.valid.params.id));
});
// Email thông báo cuối không tới được khách → quản lý ghi nhận đã báo bằng kênh khác (điều kiện để xử lý đồ bỏ lại).
contractsRouter.post('/:id/notices/final/delivery', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  channel: z.enum(['PHONE', 'REGISTERED_MAIL', 'IN_PERSON']),
  note: z.string().trim().min(5).max(500).describe('VD gọi số 09… lúc 9:30, khách xác nhận đã nghe; thư bảo đảm số …'),
  at: z.string().datetime({ offset: true }).optional().describe('Thời điểm đã báo khách (mặc định: bây giờ)'),
}) }), async (req, res) => {
  res.json(await recordFinalNoticeDelivery(req.auth!.user, req.valid.params.id, req.valid.body));
});
// Thông báo cuối trước khi được xử lý đồ bỏ lại (Điều 7 Điều khoản) — chỉ khi đang bị khoá, mỗi đợt nợ một lần.
contractsRouter.post('/:id/final-notice', authorize('FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  note: z.string().trim().max(500).optional().describe('VD đã gọi điện lúc …, đã gửi thư bảo đảm số …'),
}) }), async (req, res) => {
  res.json(await sendFinalNotice(req.auth!.user, req.valid.params.id, req.valid.body));
});
contractsRouter.post('/:id/waive-late-fees', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({ reason: z.string().min(5).max(500) }) }), async (req, res) => {
  res.json(await waiveLateFees(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});
// ---- đổi ô kho cùng loại (A1)
// Nhân viên/FM đổi NGAY (sự cố khẩn cấp — kho hỏng, cần di dời gấp) và khách gửi YÊU CẦU (chờ FM
// duyệt) đều cần xem danh sách ô trống cùng loại, nên route này mở cho cả CUSTOMER (đã đổi sang
// assertCanAccess trong service để kiểm tra đúng vai — khách phải là chủ hợp đồng).
contractsRouter.get('/:id/swap-candidates', validate({ params: idParams }), async (req, res) => {
  res.json(await swapCandidates(req.auth!.user, req.valid.params.id));
});
contractsRouter.post('/:id/swap-unit', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  toUnitId: zId,
  reason: z.string().min(5).max(500).describe('Lý do đổi ô — ghi vào hợp đồng và nhật ký kiểm toán'),
  keyTag: z.string().max(50).optional().describe('Nhãn chìa khóa / thẻ mới, nếu đổi luôn khóa'),
  fee: zMoney.max(SWAP_FEE_MAX).optional().describe('Phí thao tác, chỉ Quản lý chi nhánh được đặt > 0 — lần đổi đầu của hợp đồng / lỗi chi nhánh luôn miễn phí (Điều 8)'),
  facilityFault: z.boolean().optional().describe('Đổi do lỗi từ chi nhánh (ô hư hỏng, mất an ninh…) → miễn phí'),
}) }), async (req, res) => {
  res.json(await swapUnit(req.auth!.user, req.valid.params.id, req.valid.body));
});

// ---- yêu cầu đổi ô (A1b): khách gửi yêu cầu, FM xét duyệt (xem POST/GET /swap-requests cho phần FM)
contractsRouter.post('/:id/swap-requests', authorize('CUSTOMER'), validate({ params: idParams, body: z.object({
  toUnitId: zId,
  method: z.enum(['SELF', 'DELIVERY']).describe('Tự chuyển (7 ngày) hoặc thuê nhân viên chi nhánh chuyển hộ'),
  reason: z.string().min(5).max(500),
}) }), async (req, res) => {
  res.status(201).json(await createSwapRequest(req.auth!.user, req.valid.params.id, req.valid.body));
});
contractsRouter.get('/:id/swap-requests', validate({ params: idParams }), async (req, res) => {
  res.json({ items: await listSwapRequestsForContract(req.auth!.user, req.valid.params.id) });
});

// Nhân viên / quản lý đăng ký THAY khách: bắt buộc `reason` (5–300 ký tự) — lưu, ghi nhật ký, email báo khách. Khách tự đăng ký thì không cần.
contractsRouter.post('/:id/move-out', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  date: zDate,
  reason: z.string().trim().min(5, 'Lý do ít nhất 5 ký tự').max(300).optional(),
}) }), async (req, res) => {
  res.json(await requestMoveOut(req.auth!.user, req.valid.params.id, req.valid.body.date, req.valid.body.reason));
});
contractsRouter.post('/:id/move-out/cancel', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await cancelMoveOut(req.auth!.user, req.valid.params.id));
});
// Nhận lại kho: bắt buộc xác nhận bàn giao — khách ký tay trên màn hình, hoặc (chỉ Quản lý chi nhánh) khách vắng mặt + lý do.
const handoverBody = z.discriminatedUnion('method', [
  z.object({ method: z.literal('CUSTOMER_SIGNATURE'), signerName: zPersonName, image: z.string().min(30).max(80_000).describe('PNG data URL chữ ký tay') }),
  z.object({ method: z.literal('MANAGER_CONFIRM'), reason: z.string().trim().min(5).max(300).describe('VD khách đã gửi chìa qua bưu điện, khách bỏ đi không quay lại') }),
], { errorMap: () => ({ message: 'Cần xác nhận bàn giao: khách ký nhận hoặc quản lý xác nhận khách vắng mặt' }) });
contractsRouter.post('/:id/receive', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ handover: handoverBody }) }), async (req, res) => {
  res.json(await receiveUnit(req.auth!.user, req.valid.params.id, req.valid.body.handover));
});
contractsRouter.post('/:id/inspection', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  checklist: z.array(z.object({ item: z.string().min(1), condition: z.enum(enumValues(ItemCondition) as [string, ...string[]]), note: z.string().optional() })).max(100),
  damages: z.array(z.object({ description: z.string().min(2), severity: z.enum(['MINOR', 'MODERATE', 'SEVERE']), cost: zMoney, photoUrls: z.array(z.string().url()).default([]) })).max(50),
  notes: z.string().max(2000).optional(),
  // Bắt buộc: khách có để lại đồ trong ô không. Có → mô tả + ít nhất 1 ảnh; ô được giữ LEFTOVER_HOLD_DAYS ngày (MAINTENANCE).
  leftItems: z.object({
    present: z.boolean(),
    description: z.string().trim().max(1000).optional(),
    photoUrls: z.array(z.string().url().max(500)).max(10).optional(),
  }, { errorMap: () => ({ message: 'Ghi rõ khách có để lại đồ trong ô hay không' }) }),
}) }), async (req, res) => {
  res.status(201).json(await submitMoveOutInspection(req.auth!.user, req.valid.params.id, req.valid.body));
});
// Đồ khách để lại sau trả kho: khách đến lấy (bất cứ lúc nào) hoặc Quản lý chi nhánh xử lý từ ngày hết hạn giữ (kèm phí ≥ 0). Phí trên
// CLAIM_FM_APPROVAL_LIMIT chỉ Quản lý vận hành (403 DISPOSAL_LIMIT); trần tuyệt đối LEFTOVER_FEE_MAX.
contractsRouter.post('/:id/leftover/resolve', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('PICKED_UP'), note: z.string().trim().max(500).optional() }),
  z.object({ outcome: z.literal('DISPOSED'), fee: zMoney.max(LEFTOVER_FEE_MAX, `Phí xử lý tối đa ${LEFTOVER_FEE_MAX.toLocaleString('vi-VN')} ₫`), note: z.string().trim().min(3).max(500) }),
]) }), async (req, res) => {
  res.json(await resolveLeftover(req.auth!.user, req.valid.params.id, req.valid.body));
});
// ---- hàng bỏ lại (FM; tiền thanh lý / chi phí trên ngưỡng duyệt thì OPS): đang khoá + thông báo cuối ĐÃ TỚI khách + tới hạn chót —
// kiểm kê có ảnh, phương án xử lý, quyết toán tiền giữ chân + tiền thanh lý
contractsRouter.post('/:id/abandonment', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  items: z.array(z.object({ description: z.string().min(1).max(300), quantity: z.number().int().min(1) })).min(1).max(200),
  disposalMethod: z.enum(enumValues(AbandonedItemsDisposal) as [string, ...string[]]),
  notes: z.string().max(2000).optional(),
  proceeds: zMoney.default(0).describe('Tiền thu được khi thanh lý (0 nếu quyên tặng / tiêu huỷ)'),
  costs: zMoney.default(0).describe('Chi phí kiểm kê, vận chuyển, thanh lý'),
  photoUrls: z.array(z.string().url().max(500)).min(1, 'Cần ít nhất 1 ảnh hiện trạng / kiểm kê').max(20),
}) }), async (req, res) => {
  res.status(201).json(await processAbandonment(req.auth!.user, req.valid.params.id, req.valid.body));
});

// ---- inspections history
export const inspectionsRouter = Router();
inspectionsRouter.use(authenticate, authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'));
inspectionsRouter.get('/', validate({ query: z.object({ facilityId: zId }) }), scopeQueryFacility, async (req, res) => {
  res.json({ items: await InspectionModel.find({ facilityId: req.valid.query.facilityId }).sort({ performedAt: -1 }).limit(100).populate('unitId', 'unitNumber').populate('inspectorId', 'fullName') });
});
