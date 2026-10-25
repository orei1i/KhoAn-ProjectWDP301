import { Router } from 'express';
import { z } from 'zod';
import {
  AccessMethod, enumValues, FACILITY_CODE_MESSAGE, FACILITY_CODE_RE, FacilityStatus, isValidPhone, PHONE_MESSAGE, RATE_MAX, RATE_MIN, RATES_ORDER_MESSAGE,
  RentalPeriod, ratesOrdered, UNIT_NUMBER_MESSAGE, UNIT_NUMBER_RE, UnitCategory, UnitStatus,
} from '@ssm/shared';
import { FacilityModel, StorageUnitModel, UnitTypeModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { scopeFilter, scopeQueryFacility, assertFacility } from '../../shared/http/scope';
import { idParams, validate, zId, zMoney } from '../../shared/http/validate';
import {
  addUnit, addUnitsBulk, createUnitType, deleteFacility, deleteUnit, deleteUnitType, facilityDetailPublic, floorPlan, listFacilitiesPublic,
  saveFacility, setUnitTypeRates, setUnitStatus, updateUnit, updateUnitType, withLeftoverHeld,
} from './inventory.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);

export const facilitiesRouter = Router();

// ---- public catalogue (no auth) — khách chọn CHU KỲ (ngày/tuần/tháng) lúc xem giá, không cố định theo loại kho.
facilitiesRouter.get('/public', async (_req, res) => {
  res.json(await listFacilitiesPublic());
});
// ac = khách có muốn dùng điều hòa (add-on) không — áp cho mọi loại kho hợp lệ trong response, không
// gắn với ô cụ thể nào; loại kho không hợp lệ (VD Locker) tự bỏ qua cờ này (facilityDetailPublic).
facilitiesRouter.get('/public/:id', validate({ params: idParams, query: z.object({
  period: e(RentalPeriod).default('MONTH'), periods: z.coerce.number().int().min(1).max(365).default(1),
  // KHÔNG dùng z.coerce.boolean(): nó coi chuỗi "false" là true → báo giá luôn cộng phụ phí điều hòa dù khách tắt công tắc.
  ac: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}) }), async (req, res) => {
  res.json(await facilityDetailPublic(req.valid.params.id, req.valid.query.period, req.valid.query.periods, req.valid.query.ac));
});
/** Sơ đồ 2D cơ bản để khách bấm chọn ô còn trống — công khai, không cần đăng nhập. */
facilitiesRouter.get('/public/:id/unit-types/:typeId/floor-plan', validate({ params: idParams.extend({ typeId: zId }) }), async (req, res) => {
  res.json(await floorPlan(req.valid.params.id, req.valid.params.typeId));
});

// ---- back office
facilitiesRouter.use(authenticate);

facilitiesRouter.get('/', authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'), async (req, res) => {
  const u = req.auth!.user;
  const filter = u.role === 'STAFF' || u.role === 'FACILITY_MANAGER' ? { _id: { $in: u.facilityIds } } : {};
  res.json({ items: await FacilityModel.find(filter).sort({ name: 1 }) });
});

// Không nhận toạ độ từ client: saveFacility tự tra từ địa chỉ. Client cũ vẫn gửi lng/lat thì zod bỏ qua (không strict) — không 422.
const facilityBody = z.object({
  code: z.string().trim().regex(FACILITY_CODE_RE, FACILITY_CODE_MESSAGE).optional(), name: z.string().trim().min(3).max(150),
  status: z.enum(enumValues(FacilityStatus) as [FacilityStatus, ...FacilityStatus[]]),
  line1: z.string().trim().min(3).max(200), district: z.string().trim().min(2).max(80), city: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().refine(isValidPhone, PHONE_MESSAGE),
});
facilitiesRouter.post('/', authorize('OPS_MANAGER', 'ADMIN'), validate({ body: facilityBody.required({ code: true }) }), async (req, res) => {
  res.status(201).json(await saveFacility(null, req.valid.body));
});
facilitiesRouter.patch('/:id', authorize('OPS_MANAGER', 'ADMIN'), validate({ params: idParams, body: facilityBody.omit({ code: true }) }), async (req, res) => {
  res.json(await saveFacility(req.valid.params.id, req.valid.body));
});
facilitiesRouter.delete('/:id', authorize('OPS_MANAGER', 'ADMIN'), validate({ params: idParams }), async (req, res) => {
  res.json(await deleteFacility(req.valid.params.id));
});

// ---- unit types & pricing
facilitiesRouter.get('/:id/unit-types', validate({ params: idParams }), async (req, res) => {
  await assertFacility(req.auth!.user, req.valid.params.id);
  res.json({ items: await UnitTypeModel.find({ facilityId: req.valid.params.id }).sort({ 'rates.MONTH': 1 }) });
});
const dim = z.number().min(0.3).max(30);
const rate = z.number().int().min(RATE_MIN).max(RATE_MAX);
// Giá phải tăng dần ngày ≤ tuần ≤ tháng. Khi sửa một phần, service kiểm lại trên giá cuối cùng (gộp với giá đang lưu).
const ratesFull = z.object({ DAY: rate, WEEK: rate, MONTH: rate }).refine(ratesOrdered, RATES_ORDER_MESSAGE);
const ratesPartial = z.object({ DAY: rate.optional(), WEEK: rate.optional(), MONTH: rate.optional() }).refine(ratesOrdered, RATES_ORDER_MESSAGE);
const unitTypeBody = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9.-]{2,20}$/, 'Mã 2–20 ký tự chữ/số/./-'), name: z.string().trim().min(2).max(100), category: e(UnitCategory),
  description: z.string().trim().max(2000).optional(), widthM: dim, depthM: dim, heightM: dim, indoor: z.boolean(),
  rates: ratesFull, depositOverride: zMoney.max(RATE_MAX).nullable().optional(), minPeriods: z.number().int().min(1).max(365),
});
const unitTypePatch = unitTypeBody.omit({ code: true, category: true, rates: true }).partial().extend({
  rates: ratesPartial.optional(), isActive: z.boolean().optional(),
});
facilitiesRouter.post('/:id/unit-types', authorize('OPS_MANAGER'), validate({ params: idParams, body: unitTypeBody }), async (req, res) => {
  res.status(201).json(await createUnitType(req.valid.params.id, req.valid.body));
});
facilitiesRouter.patch('/unit-types/:id', authorize('OPS_MANAGER'), validate({ params: idParams, body: unitTypePatch }), async (req, res) => {
  res.json(await updateUnitType(req.valid.params.id, req.valid.body));
});
facilitiesRouter.delete('/unit-types/:id', authorize('OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await deleteUnitType(req.valid.params.id));
});
facilitiesRouter.patch('/unit-types/:id/price', authorize('OPS_MANAGER'), validate({ params: idParams, body: z.object({ rates: ratesPartial }) }), async (req, res) => {
  res.json(await setUnitTypeRates(req.valid.params.id, req.valid.body.rates));
});

// ---- physical units
export const unitsRouter = Router();
unitsRouter.use(authenticate, authorize('STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'));

unitsRouter.get('/', validate({ query: z.object({ facilityId: zId, status: z.enum(enumValues(UnitStatus) as [UnitStatus, ...UnitStatus[]]).optional(), unitTypeId: zId.optional() }) }), scopeQueryFacility, async (req, res) => {
  const { facilityId, status, unitTypeId } = req.valid.query;
  const items = await StorageUnitModel.find({ ...scopeFilter(req.auth!.user), facilityId, ...(status && { status }), ...(unitTypeId && { unitTypeId }) })
    .sort({ 'location.floor': 1, unitNumber: 1 }).lean();
  // leftoverHeldUntil: ô đang giữ đồ khách để lại đến ngày nào (null = không giữ) — UI không hiện "Hoàn tất bảo trì" cho ô đó.
  res.json({ items: await withLeftoverHeld(items) });
});

// Quản lý chi nhánh (trong phạm vi) và Quản lý vận hành (toàn chuỗi) cùng thêm/sửa/xoá ô kho.
const unitNumber = z.string().trim().regex(UNIT_NUMBER_RE, UNIT_NUMBER_MESSAGE);
unitsRouter.post('/', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ body: z.object({
  unitTypeId: zId, unitNumber, floor: z.number().int().min(-5).max(100), zone: z.string().trim().max(50).optional(),
  accessMethod: e(AccessMethod).default('PIN'),
}) }), async (req, res) => {
  res.status(201).json(await addUnit(req.auth!.user, req.valid.body));
});
unitsRouter.post('/bulk', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ body: z.object({
  unitTypeId: zId, floor: z.number().int().min(-5).max(100), zone: z.string().trim().max(50).optional(), accessMethod: e(AccessMethod).default('PIN'),
  prefix: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/, 'Tiền tố chỉ gồm chữ/số/-'), start: z.number().int().min(0).max(9999), count: z.number().int().min(1).max(200),
}) }), async (req, res) => {
  res.status(201).json(await addUnitsBulk(req.auth!.user, req.valid.body));
});
unitsRouter.patch('/:id', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams, body: z.object({
  unitNumber: unitNumber.optional(), floor: z.number().int().min(-5).max(100).optional(),
  zone: z.string().trim().max(50).optional(), accessMethod: e(AccessMethod).optional(),
}) }), async (req, res) => {
  res.json(await updateUnit(req.auth!.user, req.valid.params.id, req.valid.body));
});
unitsRouter.delete('/:id', authorize('FACILITY_MANAGER', 'OPS_MANAGER'), validate({ params: idParams }), async (req, res) => {
  res.json(await deleteUnit(req.auth!.user, req.valid.params.id));
});

unitsRouter.patch('/:id/status', authorize('STAFF', 'FACILITY_MANAGER'), validate({ params: idParams, body: z.object({ to: z.enum(['AVAILABLE', 'MAINTENANCE']), reason: z.string().max(500).optional() }) }), async (req, res) => {
  res.json(await setUnitStatus(req.auth!.user, req.valid.params.id, req.valid.body.to, req.valid.body.reason));
});
