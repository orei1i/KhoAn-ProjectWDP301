import type { BusinessPolicy, Facility, PriceQuote, RentalContract, RentalPeriod, Reservation, StorageUnit, UnitType, User } from '@ssm/shared';
import type { DB } from '@/shared/lib/mock-data';
import { OPEN_CONTRACT_STATUSES, dueAtBooking, exitCommitment, localMidnightMs, pickDiscount, prepaidPeriodsOf, tierTermsOf } from '@ssm/shared';
import { addMonths, daysBetween, monthKey, todayISO } from '@/shared/lib/format';

export class DomainError extends Error {
  constructor(message: string, readonly kind: 'RULE' | 'SCOPE' | 'FORBIDDEN' = 'RULE') { super(message); }
}

export const byId = <T extends { _id: string }>(arr: T[], id: string | null | undefined) => (id ? arr.find((x) => x._id === id) : undefined);

export function mustGet<T extends { _id: string }>(arr: T[], id: string | null | undefined, what: string): T {
  const x = byId(arr, id);
  if (!x) throw new DomainError(`Không tìm thấy ${what}`);
  return x;
}

/** STAFF / FACILITY_MANAGER only see their facilities; other roles see everything. */
export function scopeIds(db: DB, user: User | null | undefined): string[] {
  if (!user) return [];
  if (user.role === 'STAFF' || user.role === 'FACILITY_MANAGER') return user.facilityIds;
  return db.facilities.map((f) => f._id);
}
export const inScope = (db: DB, user: User | null | undefined, facilityId: string) => scopeIds(db, user).includes(facilityId);

export function effectivePolicy(db: DB, facilityId: string): BusinessPolicy {
  const f = byId(db.facilities, facilityId);
  const own = f?.policyId ? db.policies.find((p) => p._id === f.policyId && p.isActive) : undefined;
  return own ?? db.policies.find((p) => p.scope === 'GLOBAL' && p.isActive)!;
}

/** Giá một chu kỳ của loại kho, theo chu kỳ KHÁCH CHỌN (không cố định theo loại kho). */
export function unitRate(ut: UnitType, period: RentalPeriod) {
  return ut.rates[period];
}

/**
 * `period`/`periods` = chu kỳ và số chu kỳ khách chọn lúc đặt. Cùng công thức với BE để báo giá khớp.
 * `useAirConditioning` là add-on khách tự chọn lúc đặt (không phải thuộc tính của ô hay loại kho).
 */
export function quote(db: DB, ut: UnitType, period: RentalPeriod, periods: number, useAirConditioning: boolean): PriceQuote & { discountPct: number; periods: number } {
  const policy = effectivePolicy(db, ut.facilityId);
  const rate = unitRate(ut, period);
  const surcharge = policy.surcharges
    .filter((s) => s.categories.includes(ut.category) && (s.code !== 'CLIMATE' || useAirConditioning))
    .reduce((sum, s) => sum + (s.kind === 'PERCENT' ? Math.round((rate * s.value) / 100) : s.value), 0);
  const gross = rate + surcharge;
  const picked = pickDiscount(policy.discounts, period, periods, gross);
  const discountAmount = picked?.amount ?? 0;
  // Tiền giữ chân: kho cỡ lớn tối thiểu 2 kỳ + thu tiền thuê kỳ đầu cùng lúc đặt (xem tier-rules.ts trong @ssm/shared).
  const tier = tierTermsOf(ut.category);
  const rentPeriods = policy.deposit.mode === 'PERIODS_OF_RENT' ? Math.max(policy.deposit.value, tier.depositPeriods) : 1;
  const depositAmount = ut.depositOverride ?? (policy.deposit.mode === 'FIXED' ? policy.deposit.value * tier.depositPeriods : Math.round(gross * rentPeriods));
  const firstPeriodRent = gross - discountAmount;
  return {
    currency: 'VND', rentalPeriod: period, rate, depositAmount, discountAmount, surchargeAmount: surcharge,
    appliedRuleCodes: [...(surcharge ? ['CLIMATE'] : []), ...(picked ? [picked.tier.code] : [])],
    firstPeriodRent, totalDueAtBooking: depositAmount + (tier.firstPeriodAtBooking ? firstPeriodRent : 0),
    depositPeriods: ut.depositOverride == null && policy.deposit.mode === 'PERIODS_OF_RENT' ? rentPeriods : 1,
    firstPeriodAtBooking: tier.firstPeriodAtBooking,
    prepaidPeriods: prepaidPeriodsOf(period, periods),
    policyId: policy._id, policyVersion: policy.version,
    discountPct: picked?.tier.kind === 'PERCENT' ? picked.tier.value : 0, periods,
  };
}

/**
 * Mỗi ô kho là một vật lý duy nhất và khách bắt buộc chọn đúng ô đó trên sơ đồ lúc đặt — ô chuyển
 * sang RESERVED ngay lúc đặt, nên "còn trống" chỉ đơn giản đếm theo `status` hiện tại (không cần
 * tính chồng lấn theo khoảng ngày như thiết kế cũ). Cùng cách đơn giản hoá với BE/availability.ts.
 */
export function availability(db: DB, facilityId: string, unitTypeId: string) {
  const typeUnits = db.units.filter((u) => u.facilityId === facilityId && u.unitTypeId === unitTypeId && !u.isDeleted);
  const free = typeUnits.filter((u) => u.status === 'AVAILABLE').length;
  return { total: typeUnits.length, free, available: free };
}

export function cancellationRefund(db: DB, r: Reservation, nowIso = new Date().toISOString()): { pct: number; amount: number } {
  if (r.status === 'PENDING' || !r.depositPaymentId) return { pct: 0, amount: 0 };
  const hours = (localMidnightMs(r.startDate) - new Date(nowIso).getTime()) / 3_600_000; // tính đến 00:00 giờ chi nhánh, như server
  const policy = db.policies.find((p) => p._id === r.quote.policyId) ?? effectivePolicy(db, r.facilityId);
  const tier = [...policy.cancellation].sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart).find((t) => hours >= t.minHoursBeforeStart);
  const pct = tier?.depositRefundPct ?? 0;
  return { pct, amount: Math.round((dueAtBooking(r.quote) * pct) / 100) };
}

/** % thời gian kỳ hạn hiện tại đã dùng tại ngày trả kho, kẹp về [0, 100]. Cùng công thức với BE. */
export function elapsedTermPct(startDate: string, endDate: string, scheduledFor: string) {
  const span = new Date(endDate).getTime() - new Date(startDate).getTime();
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, ((new Date(scheduledFor).getTime() - new Date(startDate).getTime()) / span) * 100));
}

/**
 * TRẦN % hoàn tiền giữ chân nếu trả kho vào ngày `scheduledForIso` — dùng để xem trước lúc khách CHỌN NGÀY
 * (chưa gửi đăng ký) lẫn lúc nhân viên quyết toán (contract đã có `moveOut.scheduledFor`). Trả kho
 * đúng/quá hạn (scheduledFor >= endDate) không bị phạt — trả về null. Cùng công thức với BE
 * (`earlyTerminationRefundPct` ở BE/src/features/policies/pricing.ts) để hai bên khớp nhau.
 */
export function earlyTerminationPreview(db: DB, c: Pick<RentalContract, 'facilityId' | 'startDate' | 'endDate' | 'reservationId' | 'commitments'>, scheduledForIso: string): { elapsedPct: number; refundCapPct: number } | null {
  // Chỉ hợp đồng có cam kết thời hạn (được giảm giá thuê dài hạn) mới bị giới hạn mức hoàn — như server.
  // Kỳ cam kết đang dở tại ngày đó (kỳ gốc hoặc một lần gia hạn). Không trong kỳ nào, hoặc kỳ đó không có ưu đãi → không giới hạn.
  const seg = exitCommitment(c, db.reservations.find((r) => r._id === c.reservationId)?.quote, scheduledForIso);
  if (!seg || !(seg.discountAmount > 0)) return null;
  // Bảng mức hoàn của chính sách ĐÃ CHỐT lúc cam kết — như server.
  const policy = db.policies.find((p) => p._id === seg.policyId) ?? effectivePolicy(db, c.facilityId);
  const elapsedPct = elapsedTermPct(seg.startDate, seg.endDate, scheduledForIso);
  const tier = [...policy.earlyTermination].sort((a, b) => a.maxElapsedPct - b.maxElapsedPct).find((t) => elapsedPct <= t.maxElapsedPct);
  return { elapsedPct: Math.round(elapsedPct), refundCapPct: tier?.depositRefundPct ?? 0 };
}

/**
 * Ngày dùng để quyết toán: ngày khách THỰC TẾ bàn giao kho (server ghi `returnedOn` khi nhân viên nhận lại);
 * chưa bàn giao thì tạm tính theo hôm nay. KHÔNG dùng ngày khách tự hẹn — cùng quy tắc với BE.
 */
export const settlementDateOf = (c: Pick<RentalContract, 'moveOut'>) => c.moveOut?.returnedOn ?? todayISO();

export function earlyTerminationCap(db: DB, c: RentalContract): { elapsedPct: number; refundCapPct: number } | null {
  return c.moveOut ? earlyTerminationPreview(db, c, settlementDateOf(c)) : null;
}

export function facilityStats(db: DB, facilityId: string) {
  const units = db.units.filter((u) => u.facilityId === facilityId && !u.isDeleted);
  const count = (s: StorageUnit['status']) => units.filter((u) => u.status === s).length;
  const rentable = units.length - count('MAINTENANCE');
  const occupied = count('OCCUPIED') + count('PENDING_INSPECTION');
  const contracts = db.contracts.filter((c) => c.facilityId === facilityId && OPEN_CONTRACT_STATUSES.includes(c.status));
  const mrr = contracts.reduce((s, c) => s + c.billing.rate, 0);
  const overdue = contracts.reduce((s, c) => s + c.balance.outstanding, 0);
  const area = units.reduce((s, u) => s + (byId(db.unitTypes, u.unitTypeId)?.areaM2 ?? 0), 0);
  const occArea = units.filter((u) => u.status === 'OCCUPIED' || u.status === 'PENDING_INSPECTION').reduce((s, u) => s + (byId(db.unitTypes, u.unitTypeId)?.areaM2 ?? 0), 0);
  return {
    total: units.length, available: count('AVAILABLE'), reserved: count('RESERVED'), occupied, maintenance: count('MAINTENANCE'),
    pendingInspection: count('PENDING_INSPECTION'),
    occupancy: rentable ? occupied / rentable : 0, areaOccupancy: area ? occArea / area : 0,
    mrr, overdue, delinquentCount: contracts.filter((c) => c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT').length,
    activeContracts: contracts.length,
  };
}

/** Net collected revenue per month (charges - refunds), last `n` months. */
export function revenueByMonth(db: DB, facilityIds: string[], n = 6) {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(monthKey(addMonths(todayISO().slice(0, 8) + '01T00:00:00.000Z', -i)));
  const rows = keys.map((k) => ({ key: k, total: 0, byFacility: {} as Record<string, number> }));
  for (const p of db.payments) {
    if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIALLY_REFUNDED' && p.status !== 'REFUNDED') continue;
    if (!p.paidAt || !facilityIds.includes(p.facilityId) || p.method === 'INTERNAL') continue;
    const row = rows.find((r) => r.key === monthKey(p.paidAt!));
    if (!row) continue;
    const v = p.direction === 'REFUND' ? -p.amount : p.amount;
    row.total += v;
    row.byFacility[p.facilityId] = (row.byFacility[p.facilityId] ?? 0) + v;
  }
  return rows;
}

// Quy tắc bồi thường (Điều 6) dùng chung với BE / app: mức trách nhiệm theo giá thuê tháng của ô kho — xem claimCapOf ở @ssm/shared.
export { CLAIM_WINDOW_DAYS, claimTotal } from '@ssm/shared';

export const facilityName = (db: DB, id?: string | null) => byId(db.facilities, id)?.name ?? '—';
export const userName = (db: DB, id?: string | null) => byId(db.users, id)?.fullName ?? '—';
export const unitLabel = (db: DB, id?: string | null) => byId(db.units, id)?.unitNumber ?? 'Chưa phân';
export const typeName = (db: DB, id?: string | null) => byId(db.unitTypes, id)?.name ?? '—';
export const isActiveFacility = (f: Facility) => f.status === 'ACTIVE' && !f.isDeleted;
export const daysOverdue = (paidThrough: string) => Math.max(0, daysBetween(paidThrough, todayISO()) - 1);
