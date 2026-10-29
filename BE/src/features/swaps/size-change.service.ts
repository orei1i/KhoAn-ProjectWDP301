import type { ClientSession, Types } from 'mongoose';
import {
  allowsRentalPeriod, billedPeriodsFrom, buildSizeChangeAppendix, MONTH_ONLY_MESSAGE, nextAppendixNumber, PERIOD_UNIT, priceAt, rentForPeriod,
  resizeProration, sameTierDiscount, servicesAllowedFor, sizeChangeAppendixTitle, TERMS_VERSION, type PricedSegment,
} from '@ssm/shared';
import { PaymentModel, PolicyModel, RentalContractModel, ReservationModel, ServiceOrderModel, StorageUnitModel, UnitTypeModel, type UserHydrated } from '../../shared/db/models';
import { assertCanAccess } from '../../shared/http/scope';
import { Conflict, NotFound, Unprocessable } from '../../shared/core/errors';
import { climateEligible, effectivePolicy, quote } from '../policies/pricing';
import { addDays, todayUTC } from '../../shared/utils/dates';
import { contractParties } from '../reservations/contract-document.service';
import { createPayment, refundMethodFor } from '../payments/payment.service';
import { cancelOpenServiceOrders } from '../services/services.service';
import { ensureInitialCommitment } from '../contracts/commitments';
import type { RentalContractHydrated } from '../contracts/rental-contract.model';
import type { UnitSwapRequestHydrated } from './unit-swap-request.model';

/**
 * ĐỔI CỠ KHO (đợt 15, C3) — yêu cầu đổi ô sang LOẠI kho khác cùng chi nhánh. Sửa đổi hợp đồng, KHÔNG chấm dứt: thời hạn, kỳ cam kết, bậc
 * ưu đãi, đồ đang gửi, hồ sơ giữ nguyên; từ ngày đổi áp giá loại mới (cùng chu kỳ, cùng bậc ưu đãi của từng kỳ cam kết — ghi vào
 * commitments[].repricings nên job billing / gia hạn / màn khách tự dùng giá mới); phần chênh của các kỳ đã trả tính theo ngày; tiền giữ
 * chân tính lại theo cách tính của loại mới. Không áp trần hoàn / thu hồi ưu đãi vì việc đổi cỡ. Quy tắc thuần ở @ssm/shared (size-change).
 */
type Contract = RentalContractHydrated;
type Seg = NonNullable<Contract['commitments']>[number];

const plainSeg = (s: Seg): { startDate: Date; endDate: Date } & PricedSegment => ({
  startDate: s.startDate, endDate: s.endDate, gross: s.gross, discountAmount: s.discountAmount, rate: s.rate,
  repricings: (s.repricings ?? []).map((r) => ({ from: r.from, gross: r.gross, discountAmount: r.discountAmount, rate: r.rate })),
});

/**
 * Báo giá đổi cỡ sang loại `toUnitTypeId` nếu đổi vào ngày `at`. `locked` = giá khách đã xác nhận trong phụ lục lúc gửi yêu cầu (giá gốc
 * loại mới mỗi kỳ + tiền giữ chân mới) — lúc hoàn tất dùng đúng giá đó, chỉ tính lại phần chênh theo ngày đổi thật.
 * Không ghi gì (hợp đồng cũ chưa có `commitments` được dựng kỳ gốc trong bộ nhớ, chỉ lưu khi hoàn tất).
 */
export async function sizeChangeQuote(c: Contract, toUnitTypeId: Types.ObjectId | string, at: Date, session: ClientSession | null = null, locked?: { gross: number; deposit: number }) {
  if (String(c.unitTypeId) === String(toUnitTypeId)) throw Unprocessable('Ô mới cùng loại với ô đang thuê — đổi ô cùng loại không đổi giá', 'SAME_UNIT_TYPE');
  const [from, to] = await Promise.all([
    UnitTypeModel.findById(c.unitTypeId).session(session).lean(),
    UnitTypeModel.findOne({ _id: toUnitTypeId, facilityId: c.facilityId, isActive: true }).session(session).lean(),
  ]);
  if (!to) throw Unprocessable('Loại kho này không có ở chi nhánh của hợp đồng hoặc đã ngừng cho thuê', 'UNIT_TYPE_NOT_ALLOWED');
  const period = c.billing.rentalPeriod;
  // Ràng buộc theo cỡ áp lại theo loại mới: kho cỡ lớn chỉ thuê theo tháng.
  if (!allowsRentalPeriod(to.category, period)) throw Unprocessable(`${MONTH_ONLY_MESSAGE} — hợp đồng thuê theo ${PERIOD_UNIT[period]} không đổi sang ${to.name} được`, 'PERIOD_NOT_ALLOWED');
  const policy = await effectivePolicy(c.facilityId, session);
  // Điều hòa là add-on của khách: loại mới không có tuỳ chọn điều hòa thì thôi tính phụ phí.
  const useAc = !!c.useAirConditioning && climateEligible(policy, to.category);
  const q = quote(to, policy, period, 1, useAc);
  const gross = locked?.gross ?? q.rate + q.surchargeAmount;
  // Tiền giữ chân theo cách tính của loại mới (depositOf — gồm sàn kho cỡ lớn 2 kỳ, sàn thuê ngày 7 ngày).
  const deposit = locked?.deposit ?? q.depositAmount;

  await ensureInitialCommitment(c, session);
  const segs = (c.commitments ?? []) as Seg[];
  const lastEnd = Math.max(...segs.map((s) => s.endDate.getTime()));
  const policyIds = [...new Set(segs.map((s) => String(s.policyId ?? '')).filter(Boolean))];
  const discountsOf = new Map((await PolicyModel.find({ _id: { $in: policyIds } }, { discounts: 1 }).session(session).lean()).map((p) => [String(p._id), p.discounts]));
  // Kỳ bị đổi giá: kỳ đang dùng + các kỳ gia hạn đã xác nhận (kết thúc sau ngày đổi), và kỳ cuối (giá chưa ưu đãi khi hết hạn mà chưa gia hạn).
  const repriced = segs.flatMap((s, idx) => {
    if (s.endDate.getTime() <= at.getTime() && s.endDate.getTime() !== lastEnd) return [];
    const cur = priceAt(plainSeg(s), s.startDate.getTime() > at.getTime() ? s.startDate : at);
    const ended = s.endDate.getTime() <= at.getTime();
    const discountAmount = ended ? 0 : sameTierDiscount({
      discounts: discountsOf.get(String(s.policyId ?? '')) ?? policy.discounts, period, periods: s.periods,
      oldGross: cur.gross, oldDiscount: cur.discountAmount, newGross: gross, at: s.startDate,
    });
    return [{ idx, startDate: s.startDate, endDate: s.endDate, old: cur, gross, discountAmount, rate: gross - discountAmount }];
  });

  const before = { billing: c.billing, commitments: segs.map(plainSeg) };
  const after = { billing: c.billing, commitments: segs.map((s, i) => {
    const p = plainSeg(s);
    const r = repriced.find((x) => x.idx === i);
    return r ? { ...p, repricings: [...(p.repricings ?? []), { from: at, gross: r.gross, discountAmount: r.discountAmount, rate: r.rate }] } : p;
  }) };
  const currentRate = rentForPeriod(before, at);
  const rate = rentForPeriod(after, at);
  const discountAmount = gross - rate;
  // Phần chênh của các kỳ đã trả (đã xuất hoá đơn / trả trước khi gia hạn), tính theo ngày từ ngày đổi.
  const periods = billedPeriodsFrom(c, at).map((p) => ({
    ...p, oldRate: rentForPeriod(before, p.start), newRate: rentForPeriod(after, new Date(p.start).getTime() > at.getTime() ? p.start : at),
  }));
  const proration = resizeProration(periods, at);
  const servicesCancelled = !servicesAllowedFor(to.category) && !!(await ServiceOrderModel.exists({ contractId: c._id, status: 'REQUESTED' }).session(session));
  return {
    from, to, period, useAc, acDropped: !!c.useAirConditioning && !useAc, gross, discountAmount, rate, currentRate,
    currentDeposit: c.deposit.amount, deposit, depositDiff: deposit - c.deposit.amount,
    segments: repriced, proration, servicesCancelled, at,
  };
}
export type SizeChangeQuote = Awaited<ReturnType<typeof sizeChangeQuote>>;

/** Phụ lục "Đổi cỡ kho" của báo giá `x` — bản xem trước và bản khách xác nhận dùng CÙNG hàm (nguyên văn khớp). */
export async function sizeChangeAppendixFor(c: Contract, x: SizeChangeQuote, opts: { requestNumber?: string | null; toUnitId?: Types.ObjectId | string | null }, session: ClientSession | null = null) {
  const [parties, fromUnit, toUnit, rsv] = await Promise.all([
    contractParties(c.facilityId, c.customerId),
    StorageUnitModel.findById(c.unitId, { unitNumber: 1 }).session(session).lean(),
    opts.toUnitId ? StorageUnitModel.findById(opts.toUnitId, { unitNumber: 1 }).session(session).lean() : null,
    ReservationModel.findById(c.reservationId, { 'signature.signedAt': 1 }).session(session).lean(),
  ]);
  const curIdx = x.segments.find((s) => s.startDate.getTime() <= x.at.getTime() && x.at.getTime() < s.endDate.getTime())?.idx;
  const clauses = buildSizeChangeAppendix({
    contractNumber: c.contractNumber, contractSignedAt: (rsv?.signature?.signedAt ?? c.terms.signedAt ?? c.startDate).toISOString(), requestNumber: opts.requestNumber ?? null,
    ...parties, fromTypeName: x.from?.name ?? '—', fromUnitNumber: fromUnit?.unitNumber ?? null, toTypeName: x.to.name, toUnitNumber: toUnit?.unitNumber ?? null,
    rentalPeriod: x.period, endDate: c.endDate.toISOString(), currentRate: x.currentRate, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate,
    laterSegments: x.segments.filter((s) => s.idx !== curIdx && s.startDate.getTime() > x.at.getTime()).map((s) => ({ startDate: s.startDate.toISOString(), rate: s.rate })),
    currentDeposit: x.currentDeposit, deposit: x.deposit, estimate: { from: x.at.toISOString(), rentDiff: x.proration.total },
    servicesCancelled: x.servicesCancelled, acDropped: x.acDropped, termsVersion: TERMS_VERSION,
  });
  return { number: nextAppendixNumber(c), clauses, parties };
}

/** Kết quả báo giá gửi cho web / app (GET /contracts/:id/resize-quote). */
export function sizeChangeQuoteView(x: SizeChangeQuote, appendix: { number: number; clauses: unknown }) {
  return {
    fromUnitType: x.from ? { _id: x.from._id, name: x.from.name, category: x.from.category } : null,
    toUnitType: { _id: x.to._id, name: x.to.name, category: x.to.category, areaM2: x.to.areaM2 },
    rentalPeriod: x.period, currentRate: x.currentRate, gross: x.gross, discountAmount: x.discountAmount, rate: x.rate,
    currentDeposit: x.currentDeposit, deposit: x.deposit, depositDiff: x.depositDiff,
    estimate: { from: x.at, rentDiff: x.proration.total, items: x.proration.items },
    segments: x.segments.map((s) => ({ startDate: s.startDate, endDate: s.endDate, currentRate: s.old.rate, gross: s.gross, discountAmount: s.discountAmount, rate: s.rate })),
    servicesCancelled: x.servicesCancelled, acDropped: x.acDropped,
    appendix: { number: appendix.number, title: sizeChangeAppendixTitle(appendix.number), clauses: appendix.clauses },
  };
}

/**
 * Hoàn tất đổi cỡ kho (trong transaction của completeSwapRequest, SAU khi đã chiếm ô mới / nhả ô cũ): ghi giá mới từ hôm nay vào các kỳ
 * cam kết, thu thêm / hoàn phần chênh tiền thuê đã trả (theo ngày) và tiền giữ chân, đổi loại kho của hợp đồng, áp lại ràng buộc theo cỡ
 * (dịch vụ thêm, điều hòa), lưu phụ lục khách đã xác nhận. Người gọi tự lưu hợp đồng.
 */
export async function applySizeChange(c: Contract, req: UnitSwapRequestHydrated, user: UserHydrated, session: ClientSession) {
  const sc = req.sizeChange!;
  // Có công nợ (VD hoá đơn kỳ mới vừa xuất) → thu xong trước: phần chênh chỉ tính trên các kỳ khách đã thật sự trả.
  if (c.balance.outstanding > 0) throw Unprocessable('Hợp đồng còn công nợ — thu xong công nợ rồi mới hoàn tất đổi cỡ kho', 'SWAP_OUTSTANDING');
  const at = todayUTC();
  const x = await sizeChangeQuote(c, sc.toUnitTypeId, at, session, { gross: sc.gross, deposit: sc.deposit });
  const now = new Date();
  const paymentIds: Types.ObjectId[] = [];

  // (1) Giá mới từ ngày đổi cho các kỳ cam kết bị ảnh hưởng — job billing, gia hạn, màn khách đọc qua rentForPeriod / priceAt.
  for (const r of x.segments) {
    const seg = c.commitments![r.idx];
    c.set(`commitments.${r.idx}.repricings`, [...(seg.repricings ?? []), { from: at, gross: r.gross, discountAmount: r.discountAmount, rate: r.rate, unitTypeId: sc.toUnitTypeId }]);
  }

  // (2) Phần chênh tiền thuê của các kỳ đã trả: thu thêm một khoản SIZE_CHANGE; hoàn thì hoàn theo từng khoản tiền thuê đã trả cho kỳ đó.
  const rentDiff = x.proration.total;
  if (rentDiff > 0) {
    const lastEnd = x.proration.items.reduce((m, it) => (it.end > m ? it.end : m), x.proration.items[0].end);
    const p = await createPayment({
      facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SIZE_CHANGE', amount: rentDiff, status: 'PENDING', method: 'BANK_TRANSFER',
      period: { start: at, end: addDays(new Date(lastEnd), -1) }, idempotencyKey: `resize-rent-${req._id}`,
    }, session);
    c.balance.outstanding += rentDiff;
    paymentIds.push(p._id);
  } else if (rentDiff < 0) {
    const rentPays = await PaymentModel.find({
      $or: [{ contractId: c._id, type: { $in: ['RENT', 'RENEWAL', 'SIZE_CHANGE'] } }, { reservationId: c.reservationId, type: 'PREPAID_RENT' }],
      status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] },
    }).sort({ paidAt: -1 }).session(session);
    const sourceOf = (start: string) => {
      const t = new Date(start).getTime();
      return rentPays.find((p) => (p.type === 'RENT' || p.type === 'RENEWAL') && p.period && p.period.start.getTime() <= t && t <= p.period.end.getTime())
        ?? (t === c.startDate.getTime() ? rentPays.find((p) => p.type === 'PREPAID_RENT') : undefined)
        ?? rentPays[0];
    };
    const groups = new Map<string, { pay: (typeof rentPays)[number]; amount: number }>();
    for (const it of x.proration.items) {
      const src = sourceOf(it.start);
      if (!src) throw Conflict('Không tìm thấy khoản tiền thuê đã trả để hoàn phần chênh — liên hệ quản trị viên', 'NO_ORIGINAL_PAYMENT');
      const g = groups.get(String(src._id)) ?? { pay: src, amount: 0 };
      g.amount += it.amount;
      groups.set(String(src._id), g);
    }
    for (const { pay, amount } of groups.values()) {
      if (amount >= 0) continue;
      const refund = await createPayment({
        facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: -amount, status: 'SUCCEEDED',
        method: refundMethodFor(pay), refundOf: pay._id, createdBy: user._id, idempotencyKey: `resize-refund-${req._id}-${pay._id}`,
      }, session);
      paymentIds.push(refund._id);
      pay.refundedAmount = Math.min(pay.amount, (pay.refundedAmount ?? 0) - amount);
      const next = pay.refundedAmount >= pay.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      if (pay.status !== next) pay.transitionTo(next, { actor: 'SYSTEM', by: user._id, reason: 'Đổi cỡ kho — hoàn phần chênh tiền thuê' });
      await pay.save({ session });
    }
  }

  // (3) Tiền giữ chân theo cách tính của loại mới: nộp thêm (cộng vào công nợ) hoặc hoàn phần chênh theo khoản giữ chân gốc.
  const depositDiff = sc.deposit - c.deposit.amount;
  if (depositDiff > 0) {
    const p = await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'DEPOSIT', amount: depositDiff, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `resize-dep-${req._id}` }, session);
    c.balance.outstanding += depositDiff;
    paymentIds.push(p._id);
  } else if (depositDiff < 0) {
    const dep = c.deposit.paymentId ? await PaymentModel.findById(c.deposit.paymentId).session(session) : null;
    if (!dep) throw Conflict('Hợp đồng thiếu tham chiếu khoản tiền giữ chân', 'NO_ORIGINAL_PAYMENT');
    const refund = await createPayment({
      facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: -depositDiff, status: 'SUCCEEDED',
      method: refundMethodFor(dep), refundOf: dep._id, createdBy: user._id, idempotencyKey: `resize-dep-refund-${req._id}`,
    }, session);
    paymentIds.push(refund._id);
    if (dep.status === 'SUCCEEDED' || dep.status === 'PARTIALLY_REFUNDED') {
      dep.refundedAmount = Math.min(dep.amount, (dep.refundedAmount ?? 0) - depositDiff);
      const next = dep.refundedAmount >= dep.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      if (dep.status !== next) dep.transitionTo(next, { actor: 'SYSTEM', by: user._id, reason: 'Đổi cỡ kho — hoàn phần chênh tiền giữ chân' });
      await dep.save({ session });
    }
  }
  const previousDeposit = c.deposit.amount;
  c.deposit.amount = sc.deposit;

  // (4) Hợp đồng sang loại mới; giá đang áp dụng; điều hòa chỉ còn khi loại mới có.
  const previousRate = x.currentRate;
  const fromUnitTypeId = c.unitTypeId;
  c.unitTypeId = sc.toUnitTypeId;
  c.useAirConditioning = x.useAc;
  c.billing.rate = x.rate;

  // (5) Ràng buộc theo cỡ: loại mới không có dịch vụ thêm → huỷ đơn chưa làm, hoàn đủ tiền.
  if (!servicesAllowedFor(x.to.category)) await cancelOpenServiceOrders(c._id, session, 'Đã đổi sang kho cỡ nhỏ — dịch vụ thêm không áp dụng, hoàn tiền');

  // (6) Phụ lục khách đã xác nhận lúc gửi — có hiệu lực từ hôm nay, cấp số thứ tự chung của hợp đồng.
  const number = nextAppendixNumber(c);
  const a = sc.appendix;
  const appendix = {
    number, title: sizeChangeAppendixTitle(number), acceptedAt: a.acceptedAt, signerName: a.signerName, signedBy: a.signedBy ?? null, termsVersion: a.termsVersion,
    ip: a.ip ?? null, userAgent: a.userAgent ?? null, clauses: a.clauses.map((k) => ({ title: k.title, paragraphs: [...k.paragraphs], bullets: [...k.bullets] })),
    lessorSignatory: a.lessorSignatory ? { name: a.lessorSignatory.name, authorization: a.lessorSignatory.authorization } : null,
  };
  c.sizeChanges = [...(c.sizeChanges ?? []), {
    swapRequestId: req._id, effectiveFrom: at, at: now, by: user._id, fromUnitTypeId, toUnitTypeId: sc.toUnitTypeId, fromUnitId: req.fromUnitId, toUnitId: req.toUnitId,
    previousRate, rate: x.rate, gross: x.gross, discountAmount: x.discountAmount, previousDeposit, deposit: sc.deposit, rentDiff, depositDiff, paymentIds, appendix,
  }] as Contract['sizeChanges'];
  req.set('sizeChange.effectiveFrom', at);
  req.set('sizeChange.rentDiff', rentDiff);
  req.set('sizeChange.appendixNumber', number);
  req.set('sizeChange.paymentIds', paymentIds);
  req.set('sizeChange.appendix.number', number);
  req.set('sizeChange.appendix.title', appendix.title);
  return { rentDiff, depositDiff, rate: x.rate, deposit: sc.deposit, appendixNumber: number, paymentIds, fromUnitTypeId };
}

/**
 * GET /contracts/:id/resize-quote — báo giá đổi cỡ sang loại `unitTypeId` nếu đổi hôm nay, kèm PHỤ LỤC khách sẽ xác nhận (không ghi
 * gì). Chủ hợp đồng, hoặc nhân viên / quản lý đúng chi nhánh.
 */
export async function resizeQuote(user: UserHydrated, contractId: string, unitTypeId: string, toUnitId?: string) {
  const c = await RentalContractModel.findById(contractId);
  if (!c) throw NotFound('hợp đồng');
  await assertCanAccess(user, c, 'contract.resize_quote');
  if (c.status !== 'ACTIVE') throw Unprocessable('Chỉ đổi cỡ kho cho hợp đồng đang hiệu lực');
  const x = await sizeChangeQuote(c, unitTypeId, todayUTC());
  const appendix = await sizeChangeAppendixFor(c, x, { toUnitId: toUnitId ?? null });
  const available = await StorageUnitModel.countDocuments({ facilityId: c.facilityId, unitTypeId, status: 'AVAILABLE', isDeleted: false });
  return { ...sizeChangeQuoteView(x, appendix), available };
}
