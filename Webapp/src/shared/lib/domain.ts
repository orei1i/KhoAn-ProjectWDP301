import type { BusinessPolicy, DamageClaim, Facility, IntakeBatch, PriceQuote, RentalContract, RentalPeriod, Reservation, SupportTicket, UnitType, User } from '@ssm/shared';
import type { DB } from '@/shared/lib/mock-data';
import { AGING_BUCKETS, CLAIM_COUNTED_STATUSES, OPEN_CONTRACT_STATUSES, revenueRows, type RevenueSource, cancellationRefundOf, claimCapOf, claimNeedsOps, depositOf, dueAtBooking, exitCommitment, localMidnightMs, monthlyEquivalent, occupancyStats, pastDueDays, pickDiscount, sameIncident, prepaidPeriodsOf, tierTermsOf } from '@ssm/shared';
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
  const deposit = depositOf({ category: ut.category, gross, override: ut.depositOverride, policy: policy.deposit, period }); // C2: thuê ngày ≥ 7 ngày
  const depositAmount = deposit.amount;
  const firstPeriodRent = gross - discountAmount;
  return {
    currency: 'VND', rentalPeriod: period, rate, depositAmount, discountAmount, surchargeAmount: surcharge,
    appliedRuleCodes: [...(surcharge ? ['CLIMATE'] : []), ...(picked ? [picked.tier.code] : [])],
    firstPeriodRent, totalDueAtBooking: depositAmount + (tier.firstPeriodAtBooking ? firstPeriodRent : 0),
    depositPeriods: deposit.periods,
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

export function cancellationRefund(db: DB, r: Reservation, nowIso = new Date().toISOString()): ReturnType<typeof cancellationRefundOf> {
  const policy = db.policies.find((p) => p._id === r.quote.policyId) ?? effectivePolicy(db, r.facilityId);
  return cancellationRefundOf(r, policy?.cancellation ?? [], nowIso); // cùng công thức với server (shared)
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
  // Đợt 17 (D11): MỘT công thức với báo cáo ở BE — PENDING_INSPECTION chỉ tính khi còn gắn hợp đồng; số ô và diện tích cùng mẫu số (bỏ ô bảo trì).
  const occ = occupancyStats(units.map((u) => ({ status: u.status, currentContractId: u.currentContractId, area: byId(db.unitTypes, u.unitTypeId)?.areaM2 ?? 0 })));
  const contracts = db.contracts.filter((c) => c.facilityId === facilityId && OPEN_CONTRACT_STATUSES.includes(c.status));
  // Giá theo kỳ quy đổi ra tháng (thuê ngày / tuần không bị cộng như thuê tháng); cộng xong mới làm tròn — như báo cáo ở BE.
  const mrr = Math.round(contracts.reduce((s, c) => s + monthlyEquivalent(c.billing.rate, c.billing.rentalPeriod), 0));
  // Công nợ gồm cả hợp đồng đã đóng còn nợ sau quyết toán (như BE). "Quá hạn" cùng định nghĩa bảng tuổi nợ (pastDueDays ≥ 1: đã hết ân hạn; đợt 17
  // B2: hợp đồng đã đóng tính từ ngày đóng) — hoá đơn kỳ mới chưa đến hạn chỉ nằm trong tổng công nợ `outstanding`, không phải nợ quá hạn.
  const owed = db.contracts.filter((c) => c.facilityId === facilityId && c.balance.outstanding > 0);
  const pastDue = owed.filter((c) => pastDueDays(c) >= 1);
  const overdue = pastDue.reduce((s, c) => s + c.balance.outstanding, 0);
  const outstanding = owed.reduce((s, c) => s + c.balance.outstanding, 0);
  return {
    total: occ.total, available: occ.available, reserved: occ.reserved, occupied: occ.occupied, maintenance: occ.maintenance,
    pendingInspection: occ.pendingInspection,
    occupancy: occ.occupancy, areaOccupancy: occ.areaOccupancy,
    mrr, overdue, overdueCount: pastDue.length, outstanding, delinquentCount: contracts.filter((c) => c.status === 'DELINQUENT' || c.status === 'LOCKED_OUT').length,
    activeContracts: contracts.length,
  };
}

/**
 * Doanh thu theo tháng (giờ VN), `n` tháng gần nhất — MỘT công thức với báo cáo ở BE (revenueRows ở @ssm/shared, đợt 15 C4): thực thu −
 * hoàn của các khoản không phải tiền giữ chân + tiền giữ chân bị giữ lại khi đặt chỗ huỷ (huỷ sát ngày / không đến) + phần tiền giữ chân
 * cấn trừ khi quyết toán (hư hại, thu hồi ưu đãi, phí, nợ) + tiền thanh lý dùng trừ nợ. Tiền giữ chân thu / hoàn / chuyển thành doanh thu
 * báo riêng ở `deposits`; `breakdown` / `bySource` là cơ cấu (cộng lại đúng bằng `total`). Đợt 17 (B3): chi bồi thường là khoản chi, không trừ vào doanh
 * thu — báo riêng ở `claimPayouts`.
 */
export function revenueByMonth(db: DB, facilityIds: string[], n = 6) {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(monthKey(addMonths(todayISO().slice(0, 8) + '01T00:00:00.000Z', -i)));
  return revenueRows({ months: keys, facilityIds, payments: db.payments, reservations: db.reservations, inspections: db.inspections })
    .map((r) => ({ ...r, key: r.month }));
}

/** Cơ cấu doanh thu tháng `key` theo nguồn (loại khoản thu, tiền giữ chân giữ lại / cấn trừ, thanh lý) — cộng lại đúng bằng doanh thu tháng đó. */
export function revenueMix(db: DB, facilityIds: string[], key: string) {
  const [row] = revenueRows({ months: [key], facilityIds, payments: db.payments, reservations: db.reservations, inspections: db.inspections });
  return Object.entries(row?.bySource ?? {}).filter(([, amount]) => amount !== 0)
    .map(([type, amount]) => ({ type: type as RevenueSource, amount })).sort((a, b) => b.amount - a.amount);
}

/** Bảng tuổi nợ của một chi nhánh — các nhóm theo AGING_BUCKETS; tổng các nhóm = facilityStats().overdue. Hợp đồng đã đóng còn nợ tính tuổi từ ngày đóng (pastDueDays, đợt 17 B2). */
export function agingOf(db: DB, facilityId: string) {
  const cs = db.contracts.filter((c) => c.facilityId === facilityId && c.balance.outstanding > 0);
  return AGING_BUCKETS.map((b) => {
    const inB = cs.filter((c) => { const d = pastDueDays(c); return d >= b.min && (b.max === null || d <= b.max); });
    return { ...b, count: inB.length, amount: inB.reduce((x, c) => x + c.balance.outstanding, 0) };
  });
}

// Quy tắc bồi thường (Điều 6) dùng chung với BE / app: mức trách nhiệm theo giá thuê tháng của ô kho — xem claimCapOf ở @ssm/shared.
export { CLAIM_WINDOW_DAYS, claimTotal } from '@ssm/shared';

/** Mức trách nhiệm của hồ sơ (đã duyệt thì lấy mức chốt trong hồ sơ). */
export const claimLiability = (db: DB, x: DamageClaim) => x.review?.liabilityCap ?? claimCapOf(byId(db.contracts, x.contractId), db.unitTypes, x.incidentAt) ?? 0;
/** Tổng khách yêu cầu của cả SỰ VỤ (cùng hợp đồng, cùng ngày sự cố hoặc cùng phiếu sự cố) — tách hồ sơ không lách được hạn mức. */
export const claimIncidentTotal = (db: DB, x: DamageClaim) => x.claimedAmount + db.claims
  .filter((o) => o._id !== x._id && (CLAIM_COUNTED_STATUSES as readonly string[]).includes(o.status) && sameIncident(o, x))
  .reduce((s, o) => s + o.claimedAmount, 0);
/** Cùng quy tắc với BE (needsOps): sự vụ vượt hạn mức quản lý chi nhánh → chỉ Quản lý vận hành quyết. */
export const claimOpsOnly = (db: DB, x: DamageClaim) => claimNeedsOps(claimIncidentTotal(db, x), claimLiability(db, x));

/** Yêu cầu của khách mức Khẩn cấp / Cao lên đầu danh sách công việc: 0 = khẩn cấp, 1 = cao, 2 = còn lại. */
export const ticketUrgency = (t: SupportTicket) => (t.kind !== 'CUSTOMER_ISSUE' ? 2 : t.priority === 'URGENT' ? 0 : t.priority === 'HIGH' ? 1 : 2);

/** Đợt nhập hàng trong snapshot (bootstrap: khách — của mình; nhân viên / quản lý — của chi nhánh). Snapshot cũ chưa có thì rỗng. */
export const intakeBatchesOf = (db: DB): IntakeBatch[] => db.intakeBatches ?? [];
export const contractIntakeBatches = (db: DB, contractId: string) =>
  intakeBatchesOf(db).filter((b) => b.contractId === contractId).sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));

export const facilityName = (db: DB, id?: string | null) => byId(db.facilities, id)?.name ?? '—';
export const userName = (db: DB, id?: string | null) => byId(db.users, id)?.fullName ?? '—';
export const unitLabel = (db: DB, id?: string | null) => byId(db.units, id)?.unitNumber ?? 'Chưa phân';
export const typeName = (db: DB, id?: string | null) => byId(db.unitTypes, id)?.name ?? '—';
export const isActiveFacility = (f: Facility) => f.status === 'ACTIVE' && !f.isDeleted;
export const daysOverdue = (paidThrough: string) => Math.max(0, daysBetween(paidThrough, todayISO()) - 1);
