import type { ClientSession, Types } from 'mongoose';
import { depositOf, dueAtBooking, earlyTerminationOf, localMidnightMs, pickDiscount, prepaidPeriodsOf, tierTermsOf, type PriceQuote, type RentalPeriod, type UnitCategory } from '@ssm/shared';
import { FacilityModel, PolicyModel, type PolicyDoc, type UnitTypeDoc, type ReservationDoc } from '../../shared/db/models';

/** Facility override if active, otherwise the active GLOBAL policy. */
export async function effectivePolicy(facilityId: Types.ObjectId | string, session?: ClientSession | null) {
  const f = await FacilityModel.findById(facilityId, { policyId: 1 }).session(session ?? null).lean();
  const own = f?.policyId ? await PolicyModel.findOne({ _id: f.policyId, isActive: true }).session(session ?? null) : null;
  const policy = own ?? (await PolicyModel.findOne({ scope: 'GLOBAL', isActive: true }).session(session ?? null));
  if (!policy) throw new Error('No active GLOBAL policy — run the seed script');
  return policy;
}

/**
 * Chính sách ĐÃ CHỐT với khách — phiên bản lúc đặt chỗ, được in vào hợp đồng khách ký (ân hạn, ngày khoá, phí trễ, số ngày chờ
 * trước khi xử lý đồ bỏ lại, giờ chờ nhận kho…). Phiên bản chính sách không bao giờ bị sửa (phát hành = tạo bản mới) nên tra
 * theo id là đủ; Quản lý vận hành phát hành chính sách mới chỉ áp cho đặt chỗ mới. Thiếu id (dữ liệu cũ) → chính sách hiện hành.
 */
export async function signedPolicy(policyId: Types.ObjectId | string | null | undefined, facilityId: Types.ObjectId | string, session?: ClientSession | null) {
  return (policyId ? await PolicyModel.findById(policyId).session(session ?? null) : null) ?? (await effectivePolicy(facilityId, session));
}

/** Giá một chu kỳ của loại kho, theo chu kỳ KHÁCH CHỌN (không cố định theo loại kho). */
export function unitRate(ut: Pick<UnitTypeDoc, 'rates'>, period: RentalPeriod) {
  return ut.rates[period];
}

/** Loại kho này có tuỳ chọn điều hòa (add-on) hay không — theo đúng danh mục cỡ kho khai báo ở
 * policy.surcharges[CLIMATE].categories (VD SMALL/MEDIUM/LARGE/XL, không có LOCKER). */
export function climateEligible(policy: Pick<PolicyDoc, 'surcharges'>, category: UnitCategory) {
  return policy.surcharges.some((s) => s.code === 'CLIMATE' && s.categories.includes(category));
}

/**
 * Same formula as the Webapp mock (lib/domain.ts) so quotes match across clients. `periods` = số chu kỳ thuê.
 * `useAirConditioning` là add-on KHÁCH TỰ CHỌN lúc đặt (không phải thuộc tính của ô) — mọi ô của loại
 * kho hợp lệ đều sẵn có máy lạnh, chỉ tính phụ phí CLIMATE khi khách chọn dùng.
 */
export function quote(
  ut: Pick<UnitTypeDoc, 'rates' | 'category' | 'depositOverride'>,
  policy: PolicyDoc & { _id: Types.ObjectId },
  period: RentalPeriod,
  periods: number,
  useAirConditioning: boolean,
): PriceQuote<Types.ObjectId> {
  const rate = unitRate(ut, period);
  const surcharge = policy.surcharges
    .filter((s) => s.categories.includes(ut.category) && (s.code !== 'CLIMATE' || useAirConditioning))
    .reduce((sum, s) => sum + (s.kind === 'PERCENT' ? Math.round((rate * s.value) / 100) : s.value), 0);
  const gross = rate + surcharge;
  // Ưu đãi thuê dài hạn theo số THÁNG — chỉ chu kỳ THÁNG được hưởng (xem pickDiscount trong @ssm/shared).
  const picked = pickDiscount(policy.discounts, period, periods, gross);
  const discountAmount = picked?.amount ?? 0;
  // Tiền giữ chân (cọc): bằng N chu kỳ tiền thuê (mặc định 1) hoặc số tiền cố định của chính sách, hoặc số tiền riêng
  // của loại kho (`depositOverride`). Kho cỡ lớn (xem tier-rules.ts): tối thiểu 2 chu kỳ, và tiền thuê kỳ đầu thu cùng lúc đặt chỗ.
  const tier = tierTermsOf(ut.category);
  const deposit = depositOf({ category: ut.category, gross, override: ut.depositOverride, policy: policy.deposit });
  const depositAmount = deposit.amount;
  const firstPeriodRent = gross - discountAmount;
  return {
    currency: 'VND', rentalPeriod: period, rate, depositAmount, discountAmount, surchargeAmount: surcharge,
    appliedRuleCodes: [...(surcharge ? ['CLIMATE'] : []), ...(picked ? [picked.tier.code] : [])],
    firstPeriodRent,
    totalDueAtBooking: depositAmount + (tier.firstPeriodAtBooking ? firstPeriodRent : 0),
    depositPeriods: deposit.periods,
    firstPeriodAtBooking: tier.firstPeriodAtBooking,
    // Thuê theo ngày / tuần: thu trọn tiền thuê cả thời hạn khi nhận kho (xem payment-schedule.ts trong @ssm/shared).
    prepaidPeriods: prepaidPeriodsOf(period, periods),
    policyId: policy._id, policyVersion: policy.version,
  };
}

/** Hoàn khi HỦY ĐẶT CHỖ: % theo bậc giờ trước ngày nhận, tính trên TẤT CẢ số tiền đã trả lúc đặt chỗ (giữ chân + tiền thuê kỳ đầu nếu kho cỡ lớn). */
export async function cancellationRefund(r: Pick<ReservationDoc, 'status' | 'depositPaymentId' | 'startDate' | 'quote' | 'facilityId'>, session?: ClientSession) {
  if (r.status === 'PENDING' || !r.depositPaymentId) return { pct: 0, amount: 0 };
  const policy = await signedPolicy(r.quote.policyId, r.facilityId, session);
  // Tính đến 00:00 giờ chi nhánh của ngày nhận (startDate lưu 00:00Z = 07:00 sáng VN — dùng thẳng sẽ lệch 7 tiếng).
  const hours = (localMidnightMs(r.startDate) - Date.now()) / 3_600_000;
  const tier = [...policy.cancellation].sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart).find((t) => hours >= t.minHoursBeforeStart);
  const pct = tier?.depositRefundPct ?? 0;
  return { pct, amount: Math.round((dueAtBooking(r.quote) * pct) / 100) };
}

/** % thời gian kỳ hạn hiện tại đã dùng tại ngày khách bàn giao kho, kẹp về [0, 100]. */
export function elapsedTermPct(startDate: Date, endDate: Date, scheduledFor: Date) {
  const span = endDate.getTime() - startDate.getTime();
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, ((scheduledFor.getTime() - startDate.getTime()) / span) * 100));
}

/**
 * TRẦN % hoàn cọc khi trả kho SỚM (trước `endDate` của kỳ hạn hiện tại), theo % thời gian kỳ hạn đã
 * dùng (`elapsedTermPct`). Dùng min() với phần hoàn còn lại sau khi trừ hư hỏng/công nợ ở
 * contract.service — không cộng dồn phạt. CHỈ áp dụng khi trả kho trước `endDate`; trả đúng/quá hạn
 * là move-out bình thường, không bị phạt.
 */
export function earlyTerminationRefundPct(policy: Pick<PolicyDoc, 'earlyTermination'>, elapsedPct: number) {
  const tier = [...earlyTerminationOf(policy)].sort((a, b) => a.maxElapsedPct - b.maxElapsedPct).find((t) => elapsedPct <= t.maxElapsedPct);
  return tier?.depositRefundPct ?? 0;
}
