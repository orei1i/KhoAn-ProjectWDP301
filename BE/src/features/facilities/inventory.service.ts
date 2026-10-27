import { earlyTerminationOf, fmtDate, RATES_ORDER_MESSAGE, ratesOrdered, type AccessMethod, type FacilityStatus, type PublicFloorPlanUnit, type RentalPeriod, type UnitCategory, type UnitStatus } from '@ssm/shared';
import { FacilityModel, RentalContractModel, ReservationModel, ServiceOfferingModel, StorageUnitModel, UnitTypeModel, type UserHydrated } from '../../shared/db/models';
import { withTxn } from '../../shared/db/txn';
import { currentActorId } from '../../shared/core/request-context';
import { AppError, Conflict, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertFacility } from '../../shared/http/scope';
import { geocodeAddress } from '../../shared/geo/geocode';
import { availability } from './availability';
import { climateEligible, effectivePolicy, quote } from '../policies/pricing';
import { audit } from '../audit/audit.service';


/** Facility/UnitType dùng softDeletePlugin nhưng không khai báo method trong kiểu — đặt cờ trực tiếp, cùng hiệu ứng softDelete(). */
async function softDeleteDoc(doc: { set: (v: Record<string, unknown>) => unknown; save: () => Promise<unknown> }) {
  doc.set({ isDeleted: true, deletedAt: new Date(), deletedBy: currentActorId() ?? null });
  await doc.save();
}

// ---------------------------------------------------------------- public catalogue
export async function listFacilitiesPublic() {
  const facilities = await FacilityModel.find({ status: { $in: ['ACTIVE', 'UNDER_CONSTRUCTION'] } }).sort({ name: 1 }).lean();
  const types = await UnitTypeModel.find({ isActive: true }).lean();
  const items = await Promise.all(facilities.map(async (f) => {
    const ft = types.filter((t) => String(t.facilityId) === String(f._id));
    const avail = f.status === 'ACTIVE'
      ? await Promise.all(ft.map(async (t) => ({ unitTypeId: t._id, name: t.name, category: t.category, ...(await availability(f._id, t._id)) })))
      : [];
    // "Từ X đ/tháng" mốc quen thuộc để so sánh chi nhánh — giá thuê ngày/tuần vẫn xem ở trang chi tiết.
    return { ...f, fromPrice: ft.length ? Math.min(...ft.map((t) => t.rates.MONTH)) : null, availability: avail };
  }));
  return { items, unitTypes: types };
}

export async function facilityDetailPublic(id: string, period: RentalPeriod = 'MONTH', periods = 1, useAirConditioning = false) {
  // Chỉ chi nhánh đang hoạt động mới có trang công khai (giá, sơ đồ) — chi nhánh tạm ngưng / đang xây chỉ hiện ở danh sách.
  const f = await FacilityModel.findOne({ _id: id, status: 'ACTIVE' }).lean();
  if (!f) throw NotFound('chi nhánh');
  const policy = await effectivePolicy(f._id);
  const types = await UnitTypeModel.find({ facilityId: f._id, isActive: true }).sort({ 'rates.MONTH': 1 }).lean();
  // Điều hòa là add-on khách tự bật lúc đặt, không phải thuộc tính của ô — mọi ô của loại kho hợp lệ
  // đều dùng chung một giá. Loại kho không hợp lệ (VD Locker) luôn bỏ qua cờ này (không có phụ phí).
  const unitTypes = await Promise.all(types.map(async (t) => {
    const acEligible = climateEligible(policy, t.category);
    return { ...t, acEligible, quote: quote(t, policy, period, periods, acEligible && useAirConditioning), availability: await availability(f._id, t._id) };
  }));
  // Dịch vụ thêm (đặt sau khi thuê) — giá riêng từng chi nhánh, chỉ để khách tham khảo trước khi đặt kho.
  const services = await ServiceOfferingModel.find({ facilityId: f._id, isActive: true }, { code: 1, name: 1, description: 1, price: 1, unitLabel: 1 }).sort({ price: 1 }).lean();
  return {
    facility: f, unitTypes, services,
    policy: {
      version: policy.version, scope: policy.scope, reservationHoldMinutes: policy.reservationHoldMinutes, gracePeriodDays: policy.gracePeriodDays,
      cancellation: policy.cancellation, earlyTermination: earlyTerminationOf(policy), minPeriods: policy.minPeriods, maxPeriods: policy.maxPeriods,
      // Bậc giảm giá theo số tháng — web/app dùng để hiện nhãn "Tiết kiệm x%" trên bộ chọn thời gian thuê.
      discounts: policy.discounts.map((d) => ({ code: d.code, kind: d.kind, value: d.value, minPeriods: d.minPeriods, validFrom: d.validFrom, validTo: d.validTo, requiresApprovalRole: d.requiresApprovalRole })),
      // Phụ phí của chính sách — web/app dùng để GIẢI THÍCH phụ phí trong báo giá (tên, cách tính, lý do), không chỉ ghi "Phụ phí".
      surcharges: policy.surcharges.map((s) => ({ code: s.code, label: s.label, kind: s.kind, value: s.value, categories: s.categories })),
    },
  };
}

/**
 * Sơ đồ 2D cơ bản: toàn bộ ô của một loại kho, đủ để khách bấm chọn ô còn trống lúc đặt. Công khai nên công chúng chỉ thấy ô
 * CÒN TRỐNG (AVAILABLE) hay KHÔNG THUÊ ĐƯỢC (UNAVAILABLE) — không phân biệt đang thuê / đang giữ chỗ / bảo trì (không lộ tình trạng thuê
 * của người khác). Chi nhánh không hoạt động → 404. Nhân viên xem trạng thái chi tiết qua bootstrap / GET /facilities/:id/units.
 *
 * Chỉ hình thức khoá khác nhau giữa các ô — điều hòa là add-on chung cho cả loại kho (xem
 * facilityDetailPublic), không cần báo giá riêng cho từng ô nữa.
 */
export async function floorPlan(facilityId: string, unitTypeId: string): Promise<{ items: PublicFloorPlanUnit<unknown>[] }> {
  if (!(await FacilityModel.exists({ _id: facilityId, status: 'ACTIVE' }))) throw NotFound('chi nhánh');
  const units = await StorageUnitModel.find(
    { facilityId, unitTypeId },
    { unitNumber: 1, 'location.floor': 1, 'location.zone': 1, status: 1, accessMethod: 1 },
  ).sort({ 'location.floor': 1, unitNumber: 1 }).lean();
  const items = units.map((u) => ({
    _id: u._id, unitNumber: u.unitNumber, location: { floor: u.location.floor, ...(u.location.zone ? { zone: u.location.zone } : {}) },
    status: u.status === 'AVAILABLE' ? 'AVAILABLE' as const : 'UNAVAILABLE' as const, accessMethod: u.accessMethod,
  }));
  return { items };
}

// ---------------------------------------------------------------- ô đang giữ đồ khách để lại
/** Hạn giữ đồ khách để lại (hợp đồng có leftover.status = HELD) theo id ô — ô có trong Map là ô đang giữ đồ. */
export async function leftoverHolds(unitIds: unknown[]): Promise<Map<string, Date>> {
  if (!unitIds.length) return new Map();
  const rows = await RentalContractModel.find({ unitId: { $in: unitIds }, 'leftover.status': 'HELD' }, { unitId: 1, 'leftover.holdUntil': 1 }).lean();
  return new Map(rows.map((c) => [String(c.unitId), c.leftover!.holdUntil]));
}

/** Gắn `leftoverHeldUntil` (chỉ đọc) vào danh sách ô trả về cho nhân viên / quản lý — UI biết ô đang giữ đồ đến ngày nào. */
export async function withLeftoverHeld<T extends { _id: unknown }>(units: T[]): Promise<(T & { leftoverHeldUntil: Date | null })[]> {
  const held = await leftoverHolds(units.map((u) => u._id));
  return units.map((u) => ({ ...u, leftoverHeldUntil: held.get(String(u._id)) ?? null }));
}

// ---------------------------------------------------------------- facilities CRUD (OPS, ADMIN)
/** Toạ độ dự phòng (trung tâm TP.HCM) khi chi nhánh mới mà không tra được địa chỉ. */
const DEFAULT_COORDINATES: [number, number] = [106.7, 10.78];

/**
 * Toạ độ trên bản đồ KHÔNG do người dùng nhập: tự tra từ địa chỉ (line1/district/city) khi tạo mới hoặc khi
 * địa chỉ đổi. Tra thất bại thì không chặn lưu — giữ toạ độ cũ, chi nhánh mới dùng toạ độ mặc định.
 * Lời gọi mạng nằm ngoài mọi transaction/ghi DB (xong mới ghi).
 */
export async function saveFacility(id: string | null, input: { code?: string; name: string; status: FacilityStatus; line1: string; district: string; city?: string; phone: string }) {
  if (id) {
    const f = await FacilityModel.findById(id);
    if (!f) throw NotFound('chi nhánh');
    // Ngừng hoạt động / chuyển "đang xây dựng" khi chi nhánh còn khách (hợp đồng mở, đặt chỗ chưa xong) → chặn, kèm số lượng: khách sẽ
    // không đặt / gia hạn / thanh toán được ở chi nhánh "đã đóng". Không tự huỷ hàng loạt — chi nhánh xử lý từng khách trước.
    if (input.status !== 'ACTIVE' && input.status !== f.status) {
      const [contracts, reservations] = await Promise.all([
        RentalContractModel.countDocuments({ facilityId: f._id, status: { $nin: ['CLOSED', 'ABANDONED'] } }),
        ReservationModel.countDocuments({ facilityId: f._id, status: { $in: ['PENDING', 'CONFIRMED', 'ALLOCATED'] } }),
      ]);
      if (contracts || reservations) {
        throw new AppError(409, 'FACILITY_HAS_TENANTS', `Chi nhánh còn ${contracts} hợp đồng đang mở và ${reservations} đặt chỗ chưa nhận kho — kết thúc / chuyển hết khách trước khi ngừng hoạt động`, { contracts, reservations });
      }
    }
    const city = input.city || f.address.city;
    const addressChanged = input.line1 !== f.address.line1 || input.district !== f.address.district || city !== f.address.city;
    const coordinates = addressChanged ? await geocodeAddress({ line1: input.line1, district: input.district, city }) : null;
    f.set({ name: input.name, status: input.status, 'address.line1': input.line1, 'address.district': input.district, 'contact.phone': input.phone });
    if (input.city) f.set('address.city', input.city);
    if (coordinates) f.set('location.coordinates', coordinates);
    await f.save();
    await audit({ action: 'facility.update', entityType: 'Facility', entityId: f._id, facilityId: f._id, changes: { after: coordinates ? { ...input, coordinates } : input } });
    return f;
  }
  if (!input.code) throw Unprocessable('Thiếu mã chi nhánh');
  const city = input.city || 'TP. Hồ Chí Minh';
  const coordinates = (await geocodeAddress({ line1: input.line1, district: input.district, city })) ?? DEFAULT_COORDINATES;
  const f = await FacilityModel.create({
    code: input.code, name: input.name, status: input.status,
    address: { line1: input.line1, district: input.district, city, country: 'VN' },
    location: { type: 'Point', coordinates }, contact: { phone: input.phone },
  });
  await audit({ action: 'facility.create', entityType: 'Facility', entityId: f._id, facilityId: f._id });
  return f;
}

/** Xoá mềm — chỉ khi chi nhánh chưa từng phát sinh ô kho/đặt chỗ/hợp đồng; còn lại dùng "Tạm ngưng". */
export async function deleteFacility(id: string) {
  const f = await FacilityModel.findById(id);
  if (!f) throw NotFound('chi nhánh');
  const [units, contract, reservation] = await Promise.all([
    StorageUnitModel.countDocuments({ facilityId: f._id }),
    RentalContractModel.exists({ facilityId: f._id }),
    ReservationModel.exists({ facilityId: f._id }),
  ]);
  if (units) throw Conflict(`Chi nhánh còn ${units} ô kho — xoá hết ô trước, hoặc chuyển trạng thái Tạm ngưng`);
  if (contract || reservation) throw Conflict('Chi nhánh đã có đặt chỗ/hợp đồng — chỉ tạm ngưng, không xoá');
  await UnitTypeModel.updateMany({ facilityId: f._id }, { $set: { isDeleted: true, deletedAt: new Date() } });
  await softDeleteDoc(f);
  await audit({ action: 'facility.delete', entityType: 'Facility', entityId: f._id, facilityId: f._id });
  return { id: String(f._id) };
}

// ---------------------------------------------------------------- pricing (OPS)
/** Giá cuối cùng (sau khi gộp bản sửa với giá đang lưu) vẫn phải tăng dần ngày ≤ tuần ≤ tháng. */
function assertRatesOrdered(r: { DAY: number; WEEK: number; MONTH: number }) {
  if (!ratesOrdered(r)) throw Unprocessable(`${RATES_ORDER_MESSAGE} (hiện: ${r.DAY} / ${r.WEEK} / ${r.MONTH})`, 'RATES_NOT_ORDERED');
}

/** Sửa 1-3 giá chu kỳ của loại kho (khách tự chọn chu kỳ nào thì tính theo giá đó). */
export async function setUnitTypeRates(unitTypeId: string, rates: Partial<Record<RentalPeriod, number>>) {
  const ut = await UnitTypeModel.findById(unitTypeId);
  if (!ut) throw NotFound('loại kho');
  const before = { ...ut.rates };
  for (const [period, rate] of Object.entries(rates) as [RentalPeriod, number | undefined][]) {
    if (rate !== undefined) ut.set(`rates.${period}`, rate);
  }
  assertRatesOrdered(ut.rates);
  await ut.save();
  await audit({ action: 'pricing.update', entityType: 'UnitType', entityId: ut._id, facilityId: ut.facilityId, changes: { before, after: ut.rates } });
  return ut;
}

// ---------------------------------------------------------------- unit types (OPS)
export interface UnitTypeInput {
  code: string; name: string; category: UnitCategory; description?: string;
  widthM: number; depthM: number; heightM: number; indoor: boolean;
  rates: Record<RentalPeriod, number>; depositOverride?: number | null; minPeriods: number;
}

export async function createUnitType(facilityId: string, input: UnitTypeInput) {
  const f = await FacilityModel.findById(facilityId);
  if (!f) throw NotFound('chi nhánh');
  const code = input.code.trim().toUpperCase();
  if (await UnitTypeModel.exists({ facilityId: f._id, code })) throw Conflict(`Mã loại kho ${code} đã tồn tại trong chi nhánh này`);
  const ut = await UnitTypeModel.create({
    facilityId: f._id, code, name: input.name.trim(), category: input.category, description: input.description,
    dimensions: { widthM: input.widthM, depthM: input.depthM, heightM: input.heightM }, areaM2: Math.round(input.widthM * input.depthM * 100) / 100,
    features: { indoor: input.indoor }, rates: input.rates, depositOverride: input.depositOverride ?? null, minPeriods: input.minPeriods,
  });
  await audit({ action: 'unit_type.create', entityType: 'UnitType', entityId: ut._id, facilityId: f._id, changes: { after: { code, name: ut.name, category: ut.category, rates: ut.rates } } });
  return ut;
}

export interface UnitTypePatch {
  name?: string; description?: string; widthM?: number; depthM?: number; heightM?: number; indoor?: boolean;
  depositOverride?: number | null; minPeriods?: number; isActive?: boolean; rates?: Partial<Record<RentalPeriod, number>>;
}

/** Mã và nhóm cỡ (category) cố định sau khi tạo — nhóm cỡ quyết định điều hòa add-on, đổi sẽ lệch hợp đồng cũ. */
export async function updateUnitType(id: string, patch: UnitTypePatch) {
  const ut = await UnitTypeModel.findById(id);
  if (!ut) throw NotFound('loại kho');
  if (patch.isActive === false && ut.isActive) {
    const busy = await StorageUnitModel.exists({ unitTypeId: ut._id, status: { $in: ['RESERVED', 'OCCUPIED', 'PENDING_INSPECTION'] } });
    if (busy) throw Conflict('Loại kho còn ô đang giữ chỗ/đang thuê — chưa ẩn được');
  }
  const before = { name: ut.name, rates: { ...ut.rates }, isActive: ut.isActive, areaM2: ut.areaM2 };
  if (patch.name !== undefined) ut.name = patch.name.trim();
  if (patch.description !== undefined) ut.description = patch.description;
  if (patch.widthM !== undefined || patch.depthM !== undefined || patch.heightM !== undefined) {
    ut.set('dimensions', { widthM: patch.widthM ?? ut.dimensions.widthM, depthM: patch.depthM ?? ut.dimensions.depthM, heightM: patch.heightM ?? ut.dimensions.heightM });
  }
  if (patch.indoor !== undefined) ut.set('features.indoor', patch.indoor);
  if (patch.depositOverride !== undefined) ut.depositOverride = patch.depositOverride;
  if (patch.minPeriods !== undefined) ut.minPeriods = patch.minPeriods;
  if (patch.isActive !== undefined) ut.isActive = patch.isActive;
  for (const [period, rate] of Object.entries(patch.rates ?? {}) as [RentalPeriod, number | undefined][]) {
    if (rate !== undefined) ut.set(`rates.${period}`, rate);
  }
  if (patch.rates && Object.keys(patch.rates).length) assertRatesOrdered(ut.rates); // chỉ kiểm khi người dùng đổi giá — dữ liệu cũ không bị chặn oan
  await ut.save();
  await audit({ action: 'unit_type.update', entityType: 'UnitType', entityId: ut._id, facilityId: ut.facilityId, changes: { before, after: { name: ut.name, rates: ut.rates, isActive: ut.isActive, areaM2: ut.areaM2 } } });
  return ut;
}

/** Xoá mềm — chỉ khi loại kho chưa có ô nào và chưa từng có đặt chỗ/hợp đồng; còn lại dùng "ẩn". */
export async function deleteUnitType(id: string) {
  const ut = await UnitTypeModel.findById(id);
  if (!ut) throw NotFound('loại kho');
  const [units, contract, reservation] = await Promise.all([
    StorageUnitModel.countDocuments({ unitTypeId: ut._id }),
    RentalContractModel.exists({ unitTypeId: ut._id }),
    ReservationModel.exists({ unitTypeId: ut._id }),
  ]);
  if (units) throw Conflict(`Loại kho còn ${units} ô — xoá hết ô trước, hoặc chỉ ẩn loại kho`);
  if (contract || reservation) throw Conflict('Loại kho đã có đặt chỗ/hợp đồng — chỉ ẩn, không xoá');
  await softDeleteDoc(ut);
  await audit({ action: 'unit_type.delete', entityType: 'UnitType', entityId: ut._id, facilityId: ut.facilityId });
  return { id: String(ut._id) };
}

// ---------------------------------------------------------------- units (STAFF, FM)
export async function addUnit(user: UserHydrated, input: {
  unitTypeId: string; unitNumber: string; floor: number; zone?: string; accessMethod: AccessMethod;
}) {
  const ut = await UnitTypeModel.findById(input.unitTypeId);
  if (!ut) throw NotFound('loại kho');
  await assertFacility(user, ut.facilityId, 'unit.create');
  const u = await StorageUnitModel.create({
    facilityId: ut.facilityId, unitTypeId: ut._id, unitNumber: input.unitNumber, location: { building: 'A', floor: input.floor, zone: input.zone || undefined },
    accessMethod: input.accessMethod,
  });
  await audit({ action: 'unit.create', entityType: 'StorageUnit', entityId: u._id, facilityId: ut.facilityId });
  return u;
}

/** Thêm nhiều ô liền mã (VD tiền tố "M2-" từ 1 đến 12 → M2-01 … M2-12) cùng tầng/khu/hình thức khoá. */
export async function addUnitsBulk(user: UserHydrated, input: {
  unitTypeId: string; floor: number; zone?: string; accessMethod: AccessMethod; prefix: string; start: number; count: number;
}) {
  const ut = await UnitTypeModel.findById(input.unitTypeId);
  if (!ut) throw NotFound('loại kho');
  await assertFacility(user, ut.facilityId, 'unit.create');
  const width = Math.max(2, String(input.start + input.count - 1).length);
  const numbers = Array.from({ length: input.count }, (_, i) => `${input.prefix.toUpperCase()}${String(input.start + i).padStart(width, '0')}`);
  if (numbers.some((n) => n.length > 20)) throw Unprocessable('Mã kho quá dài (tối đa 20 ký tự) — rút ngắn tiền tố');
  const dup = await StorageUnitModel.find({ facilityId: ut.facilityId, unitNumber: { $in: numbers } }, { unitNumber: 1 }).lean();
  if (dup.length) throw Conflict(`Mã kho đã tồn tại: ${dup.slice(0, 5).map((d) => d.unitNumber).join(', ')}${dup.length > 5 ? '…' : ''}`);
  const created = await withTxn(async (session) => StorageUnitModel.create(
    numbers.map((n) => ({
      facilityId: ut.facilityId, unitTypeId: ut._id, unitNumber: n,
      location: { building: 'A', floor: input.floor, zone: input.zone || undefined }, accessMethod: input.accessMethod,
    })),
    { session, ordered: true },
  ));
  await audit({ action: 'unit.bulk_create', entityType: 'UnitType', entityId: ut._id, facilityId: ut.facilityId, changes: { after: { count: created.length, first: numbers[0], last: numbers[numbers.length - 1] } } });
  return { count: created.length };
}

const EDITABLE_UNIT_STATUS: UnitStatus[] = ['AVAILABLE', 'MAINTENANCE'];

/** Chỉ sửa/xoá được ô đang Trống hoặc Bảo trì — ô có đặt chỗ/hợp đồng phải đi qua quy trình nghiệp vụ. */
async function loadEditableUnit(user: UserHydrated, id: string, action: string) {
  const u = await StorageUnitModel.findById(id);
  if (!u) throw NotFound('kho');
  await assertFacility(user, u.facilityId, action);
  if (!EDITABLE_UNIT_STATUS.includes(u.status) || u.currentReservationId || u.currentContractId || u.currentSwapRequestId) {
    throw Conflict('Chỉ sửa/xoá được ô đang Trống hoặc Bảo trì', 'FLOW_ONLY');
  }
  return u;
}

export async function updateUnit(user: UserHydrated, id: string, patch: { unitNumber?: string; floor?: number; zone?: string; accessMethod?: AccessMethod }) {
  const u = await loadEditableUnit(user, id, 'unit.update');
  const before = { unitNumber: u.unitNumber, floor: u.location.floor, zone: u.location.zone, accessMethod: u.accessMethod };
  if (patch.unitNumber !== undefined) {
    const next = patch.unitNumber.trim().toUpperCase();
    if (next !== u.unitNumber && await StorageUnitModel.exists({ facilityId: u.facilityId, unitNumber: next })) throw Conflict(`Mã kho ${next} đã tồn tại`);
    u.unitNumber = next;
  }
  if (patch.floor !== undefined) u.set('location.floor', patch.floor);
  if (patch.zone !== undefined) u.set('location.zone', patch.zone || undefined);
  if (patch.accessMethod !== undefined) u.accessMethod = patch.accessMethod;
  await u.save();
  await audit({ action: 'unit.update', entityType: 'StorageUnit', entityId: u._id, facilityId: u.facilityId, changes: { before, after: { unitNumber: u.unitNumber, floor: u.location.floor, zone: u.location.zone, accessMethod: u.accessMethod } } });
  return u;
}

/** Xoá mềm — ô đã từng có đặt chỗ/hợp đồng thì giữ lại để không mất lịch sử, chuyển Bảo trì thay vì xoá. */
export async function deleteUnit(user: UserHydrated, id: string) {
  const u = await loadEditableUnit(user, id, 'unit.delete');
  const [contract, reservation] = await Promise.all([RentalContractModel.exists({ unitId: u._id }), ReservationModel.exists({ unitId: u._id })]);
  if (contract || reservation) throw Conflict('Ô đã có lịch sử đặt/thuê — chuyển sang Bảo trì thay vì xoá');
  await u.softDelete();
  await audit({ action: 'unit.delete', entityType: 'StorageUnit', entityId: u._id, facilityId: u.facilityId });
  return { id: String(u._id) };
}

/**
 * Đổi trạng thái thủ công. Đích luôn là AVAILABLE hoặc MAINTENANCE; mọi thứ còn lại đi qua quy trình
 * đặt chỗ / nhận kho / trả kho.
 *
 * Nguồn được phép có thêm PENDING_INSPECTION khi ô KHÔNG còn gắn hợp đồng — đó chính là ô vừa nhả ra
 * do đổi ô kho (contract.service → swapUnit). Ô đang chờ tất toán trả kho vẫn còn currentContractId
 * nên vẫn buộc phải đi qua biên bản kiểm tra, không lách được đường này.
 */
export async function setUnitStatus(user: UserHydrated, id: string, to: UnitStatus, reason?: string) {
  const u = await StorageUnitModel.findById(id);
  if (!u) throw NotFound('kho');
  await assertFacility(user, u.facilityId, 'unit.status');
  // Ô đang giữ đồ khách để lại sau trả kho (B3): chỉ việc xử lý ở mục Đồ đang giữ (resolveLeftover) mới nhả ô — không "hoàn tất bảo
  // trì" / mở cho thuê tay được, kẻo khách mới nhận ô còn đồ của khách cũ.
  const held = (await leftoverHolds([u._id])).get(String(u._id));
  if (held) throw Conflict(`Ô đang giữ đồ khách để lại đến ${fmtDate(held.toISOString()).slice(0, 5)} — xử lý ở mục Đồ đang giữ`, 'LEFTOVER_HELD');
  const canLeave = ['AVAILABLE', 'MAINTENANCE'].includes(u.status)
    || (u.status === 'PENDING_INSPECTION' && !u.currentContractId);
  if (!canLeave || !['AVAILABLE', 'MAINTENANCE'].includes(to))
    throw Conflict('Trạng thái này chỉ đổi qua quy trình phân kho / nhận kho / trả kho', 'FLOW_ONLY');
  const from = u.status;
  u.transitionTo(to, { actor: user.role, by: user._id, reason }); // kiểm tra bước chuyển hợp lệ (ném lỗi rõ ràng)
  // Compare-and-swap theo trạng thái + các con trỏ: luồng giữ ô của khách cũng CAS (không tăng __v) nên save() không phát hiện được
  // tranh chấp — nhân viên bấm "Bảo trì" đúng lúc khách giữ ô sẽ ra ô MAINTENANCE còn dính đặt chỗ, kẹt hẳn.
  const updated = await StorageUnitModel.findOneAndUpdate(
    { _id: u._id, status: from, currentReservationId: null, currentContractId: null, currentSwapRequestId: null },
    { $set: { status: to, statusChangedAt: new Date(), statusReason: reason ?? null } },
    { new: true },
  );
  if (!updated) throw Conflict('Ô kho vừa thay đổi (có khách giữ / đổi ô) — tải lại rồi thử lại', 'UNIT_CHANGED');
  await audit({ action: 'unit.status', entityType: 'StorageUnit', entityId: u._id, facilityId: u.facilityId, reason, changes: { before: { status: from }, after: { status: to } } });
  return updated;
}
