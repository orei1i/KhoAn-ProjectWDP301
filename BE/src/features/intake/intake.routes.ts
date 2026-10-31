import { Router } from 'express';
import { z } from 'zod';
import {
  enumValues, INTAKE_CATEGORY_MAX, INTAKE_ITEM_NAME_MAX, INTAKE_ITEM_NAME_MIN, INTAKE_MAX_ITEMS, INTAKE_NOTE_MAX, INTAKE_QTY_MAX, INTAKE_VALUE_MAX,
  IntakeBatchStatus, IntakeItemCondition, localMidnightMs, SEALED_DESC_MAX, SEALED_MAX_PACKAGES, SEALED_PACKAGE_KINDS, type SealedPackageKind,
} from '@ssm/shared';
import { IntakeBatchModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { scopeFilter, scopeQueryFacility } from '../../shared/http/scope';
import { idParams, paging, validate, zDate, zId } from '../../shared/http/validate';
import { cancelIntake, confirmIntake, getIntakeBatch, rejectIntake, sealedPledgePdf, updateDeclaredIntake, withdrawIntakeItem } from './intake.service';

/** Một dòng đồ khai trong đợt nhập — dùng chung cho khai (khách / nhân viên thay khách), sửa và xác nhận danh sách thực tế. */
export const intakeItemBody = z.object({
  _id: z.string().max(40).optional().describe('Mã dòng đang có — gửi kèm khi SỬA một dòng (giữ mã cho hồ sơ bồi thường); bỏ trống = dòng mới'),
  name: z.string().trim().min(INTAKE_ITEM_NAME_MIN).max(INTAKE_ITEM_NAME_MAX),
  category: z.string().trim().max(INTAKE_CATEGORY_MAX).nullish(),
  quantity: z.number().int().min(1).max(INTAKE_QTY_MAX),
  estValue: z.number().int().min(0).max(INTAKE_VALUE_MAX).describe('Giá trị ước tính cho MỘT cái (VND)'),
  condition: z.enum(enumValues(IntakeItemCondition) as [IntakeItemCondition, ...IntakeItemCondition[]]).default('GOOD'),
  note: z.string().trim().max(INTAKE_NOTE_MAX).nullish(),
});
export const intakeItemsBody = z.array(intakeItemBody).min(1, 'Khai ít nhất một món đồ').max(INTAKE_MAX_ITEMS, `Tối đa ${INTAKE_MAX_ITEMS} dòng mỗi đợt`);
/** Kết quả kiểm hàng cấm — đủ INTAKE_CHECK_ITEMS (thiếu → 422 GOODS_CHECK_REQUIRED ở service). */
export const goodsCheckBody = z.object({
  confirmed: z.array(z.string().max(30)).max(20),
  note: z.string().trim().max(500).optional(),
}, { errorMap: () => ({ message: 'Kiểm hàng cấm trước khi xác nhận đợt nhập' }) });
/** Đợt 16 (D2): khai GỬI KÍN — chỉ số kiện, loại kiện, niêm phong, mô tả chung, tổng giá trị khai (tuỳ chọn). */
export const sealedBody = z.object({
  packageCount: z.number().int().min(1).max(SEALED_MAX_PACKAGES),
  packageKind: z.enum(SEALED_PACKAGE_KINDS as [SealedPackageKind, ...SealedPackageKind[]]),
  hasSeal: z.boolean(),
  description: z.string().trim().max(SEALED_DESC_MAX).nullish(),
  declaredValue: z.number().int().min(0).max(INTAKE_VALUE_MAX * SEALED_MAX_PACKAGES).nullish().describe('TỔNG giá trị khai của mọi kiện (VND) — bỏ trống = không khai (bồi thường cần chứng cứ)'),
});
export const intakeUpdateBody = z.object({ items: intakeItemsBody.optional(), sealed: sealedBody.optional(), expectedDate: zDate.nullish() })
  .refine((b) => b.items !== undefined || b.sealed !== undefined || b.expectedDate !== undefined, 'Không có gì để sửa');
export const intakeCancelBody = z.object({ reason: z.string().trim().max(300).optional().describe('Khách: tuỳ chọn. Nhân viên / quản lý: BẮT BUỘC ≥ 5 ký tự (thiếu → 422 INTAKE_CANCEL_REASON_REQUIRED)') });
/** A4: `updatedAt` của đợt nhập lúc nhân viên mở — khác hiện tại → 409 INTAKE_CHANGED. Thiếu (client cũ) thì nhận như trước. */
const expectedUpdatedAt = z.string().max(40).optional().describe('updatedAt của đợt nhập lúc mở màn hình (A4) — khác → 409 INTAKE_CHANGED');

export const intakeRouter = Router();
intakeRouter.use(authenticate);

/**
 * Hàng chờ / lịch sử đợt nhập theo quyền: khách → của mình; nhân viên / quản lý → chi nhánh mình (facilityId ngoài phạm vi → 403);
 * vận hành → mọi chi nhánh. Lọc status (CSV), contractId, from (declaredAt ≥), code (tra mã đợt nhập IN-…, không phân biệt hoa thường).
 */
intakeRouter.get('/', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ query: paging.extend({
  facilityId: zId.optional(), status: z.string().optional(), contractId: zId.optional(), from: zDate.optional(),
  code: z.string().trim().min(4).max(40).optional(),
}) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, facilityId, status, contractId, from, code } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user, { customerField: 'customerId' }) };
  if (facilityId) filter.facilityId = facilityId;
  if (contractId) filter.contractId = contractId;
  if (status) filter.status = { $in: status.split(',').filter((s: string) => (enumValues(IntakeBatchStatus) as string[]).includes(s)) };
  if (from) filter.declaredAt = { $gte: new Date(localMidnightMs(from.slice(0, 10) + 'T00:00:00.000Z')) }; // 00:00 giờ VN của ngày đó
  if (code) filter.code = code.toUpperCase();
  const [items, total] = await Promise.all([
    IntakeBatchModel.find(filter).sort({ declaredAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('customerId', 'fullName phone').populate({ path: 'contractId', select: 'contractNumber unitId status', populate: { path: 'unitId', select: 'unitNumber' } }),
    IntakeBatchModel.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

intakeRouter.get('/:id', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await getIntakeBatch(req.auth!.user, req.valid.params.id));
});
/** Đợt 16 (D2): bản IN cam kết gửi kín (PDF) để khách ký giấy tại quầy — chỉ đợt gửi kín, nhân viên / quản lý đúng chi nhánh. */
intakeRouter.get('/:id/sealed-pledge.pdf', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams }), async (req, res) => {
  const { pdf, filename } = await sealedPledgePdf(req.auth!.user, req.valid.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

/** Khách sửa đợt còn chờ xác nhận (DECLARED — khác → 422 INTAKE_NOT_DECLARED): danh sách đồ (thay cả danh sách) và / hoặc ngày dự kiến. */
intakeRouter.patch('/:id', authorize('CUSTOMER'), validate({ params: idParams, body: intakeUpdateBody }), async (req, res) => {
  res.json(await updateDeclaredIntake(req.auth!.user, req.valid.params.id, req.valid.body));
});
/** Huỷ đợt còn chờ: khách tự huỷ; nhân viên / quản lý chi nhánh huỷ khi khách khai mà không mang đồ đến (bắt buộc lý do, email báo khách). */
intakeRouter.post('/:id/cancel', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: intakeCancelBody }), async (req, res) => {
  res.json(await cancelIntake(req.auth!.user, req.valid.params.id, req.valid.body.reason));
});

/** A7: ghi "khách lấy đồ ra" một món của đợt đã xác nhận — khách chủ hợp đồng hoặc nhân viên / quản lý chi nhánh. */
intakeRouter.post('/:id/items/:itemId/withdraw', authorize('CUSTOMER', 'STAFF', 'FACILITY_MANAGER'), validate({
  params: idParams.extend({ itemId: z.string().trim().min(1).max(40) }),
  body: z.object({ quantity: z.number().int().min(1).max(INTAKE_QTY_MAX), note: z.string().trim().max(INTAKE_NOTE_MAX).nullish() }),
}), async (req, res) => {
  res.json(await withdrawIntakeItem(req.auth!.user, req.valid.params.id, req.valid.params.itemId, req.valid.body));
});

/**
 * Nhân viên / quản lý chi nhánh XÁC NHẬN đợt nhập: kiểm đủ các nhóm hàng cấm (422 GOODS_CHECK_REQUIRED), có thể sửa danh sách theo thực
 * tế (`items` — thay cả danh sách; dòng giữ `_id` là sửa, không `_id` là thêm; bản khách khai lưu ở declaredItems), ghi chú. Đợt 15: dòng
 * khách khai chỉ sửa số lượng / tình trạng / ghi chú (đổi tên, giá trị → 422 INTAKE_LOCKED_FIELD), dòng thêm gắn addedByStaff; gửi kèm
 * expectedUpdatedAt (khác → 409 INTAKE_CHANGED); xác nhận xong email khách danh sách đã xác nhận.
 */
intakeRouter.post('/:id/confirm', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  goodsCheck: goodsCheckBody, items: intakeItemsBody.optional(), staffNote: z.string().trim().max(500).optional(), expectedUpdatedAt,
  pledgeSigned: z.boolean().optional().describe('Đợt 16 (D2) — đợt gửi kín: true = khách đã ký bản cam kết giấy tại quầy (thiếu → 422 SEALED_PLEDGE_REQUIRED)'),
}) }), async (req, res) => {
  res.json(await confirmIntake(req.auth!.user, req.valid.params.id, req.valid.body));
});
/** Từ chối đợt nhập (có hàng cấm — Điều 4): bắt buộc lý do, email báo khách. */
intakeRouter.post('/:id/reject', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({
  reason: z.string().trim().min(5, 'Ghi rõ lý do từ chối (ít nhất 5 ký tự)').max(500), expectedUpdatedAt,
}) }), async (req, res) => {
  res.json(await rejectIntake(req.auth!.user, req.valid.params.id, req.valid.body.reason, req.valid.body.expectedUpdatedAt));
});
