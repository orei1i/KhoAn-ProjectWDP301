import type { ClaimItem, ClaimType, PaymentMethod } from '@ssm/shared';
import { OPEN_CLAIM_STATUSES } from '@ssm/shared';
import { DamageClaimModel, RentalContractModel, TicketModel, type UserHydrated } from '../../shared/db/models';
import { Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { CLAIM_LIABILITY_CAP, CLAIM_WINDOW_DAYS, claimTotal, MAX_OPEN_CLAIMS_PER_CONTRACT } from './claim-rules';
import { daysBetween } from '../../shared/utils/dates';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment } from '../payments/payment.service';

const load = async (id: string) => {
  const c = await DamageClaimModel.findById(id);
  if (!c) throw NotFound('hồ sơ bồi thường');
  return c;
};

// ---------------------------------------------------------------- gửi hồ sơ (CUSTOMER chủ hợp đồng; STAFF/FM lập hộ tại quầy)
export async function createClaim(user: UserHydrated, input: {
  contractId: string; type: ClaimType; incidentAt: string; description: string;
  items: ClaimItem[]; photoUrls?: string[]; ticketId?: string | null;
}) {
  const c = await RentalContractModel.findById(input.contractId);
  if (!c) throw NotFound('hợp đồng');
  await assertCanAccess(user, c, 'claim.create'); // khách phải là chủ hợp đồng, nhân viên phải đúng chi nhánh

  const now = new Date();
  const incidentAt = new Date(input.incidentAt);
  if (Number.isNaN(incidentAt.getTime())) throw Unprocessable('Thời điểm sự cố không hợp lệ');
  if (incidentAt > now) throw Unprocessable('Thời điểm sự cố không được ở tương lai');
  if (incidentAt < c.startDate) throw Unprocessable('Thời điểm sự cố trước ngày bắt đầu thuê kho');
  if (daysBetween(incidentAt, now) > CLAIM_WINDOW_DAYS) throw Unprocessable(`Chỉ nhận yêu cầu trong ${CLAIM_WINDOW_DAYS} ngày kể từ khi xảy ra sự cố`);
  if (c.status === 'ABANDONED') throw Unprocessable('Hợp đồng đã đóng do hàng bỏ lại (đã thanh lý), không nhận yêu cầu bồi thường');
  if (c.status === 'CLOSED' && c.closedAt && daysBetween(c.closedAt, now) > CLAIM_WINDOW_DAYS) {
    throw Unprocessable(`Hợp đồng đã kết thúc quá ${CLAIM_WINDOW_DAYS} ngày, không còn nhận yêu cầu bồi thường`);
  }

  const total = claimTotal(input.items);
  if (total <= 0) throw Unprocessable('Tổng giá trị khai báo phải lớn hơn 0');

  const open = await DamageClaimModel.countDocuments({ contractId: c._id, status: { $in: [...OPEN_CLAIM_STATUSES] } });
  if (open >= MAX_OPEN_CLAIMS_PER_CONTRACT) {
    throw Unprocessable(`Hợp đồng đang có ${open} hồ sơ chờ xử lý — đợi kết quả rồi hãy gửi thêm`);
  }

  if (input.ticketId) {
    const t = await TicketModel.findById(input.ticketId);
    if (!t || String(t.facilityId) !== String(c.facilityId)) throw Unprocessable('Sự cố tham chiếu không thuộc chi nhánh của hợp đồng');
    if (user.role === 'CUSTOMER' && String(t.reporterId) !== String(user._id)) throw Forbidden('Sự cố này không thuộc về bạn', 'OWNERSHIP');
  }

  const claim = await DamageClaimModel.create({
    facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, unitId: c.unitId,
    ticketId: input.ticketId ?? null, type: input.type, status: 'SUBMITTED', incidentAt,
    description: input.description, items: input.items, photoUrls: input.photoUrls ?? [],
    claimedAmount: total, // pre('validate') tính lại từ items, đây chỉ là giá trị khởi tạo
    statusHistory: [{ from: null, to: 'SUBMITTED', at: now, by: user._id }],
  });

  await audit({
    action: 'claim.create', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId,
    changes: { after: { claimNumber: claim.claimNumber, type: claim.type, claimedAmount: claim.claimedAmount } },
  });
  return claim;
}

// ---------------------------------------------------------------- tiếp nhận xác minh (STAFF, FACILITY_MANAGER)
export async function startClaimReview(user: UserHydrated, id: string) {
  const claim = await load(id);
  await assertFacility(user, claim.facilityId, 'claim.review');
  claim.transitionTo('UNDER_REVIEW', { actor: user.role, by: user._id });
  await claim.save();
  await audit({ action: 'claim.review', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId });
  return claim;
}

// ---------------------------------------------------------------- duyệt / từ chối (FACILITY_MANAGER)
export async function decideClaim(user: UserHydrated, id: string, input: { approve: boolean; approvedAmount?: number; note: string }) {
  const claim = await load(id);
  await assertFacility(user, claim.facilityId, 'claim.decide');
  if (input.approve && claim.status !== 'UNDER_REVIEW') {
    throw Unprocessable('Phải chuyển hồ sơ sang "Đang xác minh" trước khi duyệt chi');
  }

  const cap = CLAIM_LIABILITY_CAP; // chốt vào hồ sơ để sau này đổi điều khoản không hồi tố
  const amount = input.approve ? Math.trunc(input.approvedAmount ?? 0) : 0;
  if (input.approve) {
    if (amount <= 0) throw Unprocessable('Số tiền duyệt phải lớn hơn 0');
    if (amount > claim.claimedAmount) throw Unprocessable('Không duyệt quá số tiền khách yêu cầu');
    if (amount > cap) throw Unprocessable(`Vượt hạn mức trách nhiệm ${cap.toLocaleString('vi-VN')} ₫ theo Điều khoản dịch vụ`);
  }

  claim.review = { reviewedBy: user._id, reviewedAt: new Date(), approvedAmount: amount, liabilityCap: cap, decisionNote: input.note };
  claim.transitionTo(input.approve ? 'APPROVED' : 'REJECTED', { actor: user.role, by: user._id, reason: input.note });
  await claim.save();

  await audit({
    action: input.approve ? 'claim.approve' : 'claim.reject', entityType: 'DamageClaim', entityId: claim._id,
    facilityId: claim.facilityId, reason: input.note,
    changes: { after: { approvedAmount: amount, claimedAmount: claim.claimedAmount, liabilityCap: cap } },
  });
  return claim;
}

// ---------------------------------------------------------------- chi tiền (FACILITY_MANAGER)
export async function payClaim(user: UserHydrated, id: string, method: PaymentMethod) {
  return withTxn(async (session) => {
    const claim = await DamageClaimModel.findById(id).session(session);
    if (!claim) throw NotFound('hồ sơ bồi thường');
    await assertFacility(user, claim.facilityId, 'claim.pay');
    if (claim.status !== 'APPROVED') throw Unprocessable('Chỉ chi tiền cho hồ sơ đã duyệt');
    const amount = claim.review?.approvedAmount ?? 0;
    if (amount <= 0) throw Unprocessable('Hồ sơ không có số tiền đã duyệt');

    // idempotencyKey theo hồ sơ + chỉ mục unique trên PaymentTransaction → không thể chi hai lần.
    const pay = await createPayment({
      facilityId: claim.facilityId, customerId: claim.customerId, contractId: claim.contractId,
      type: 'COMPENSATION', amount, status: 'SUCCEEDED', method,
      recordedBy: method === 'CASH' ? user._id : null,
      idempotencyKey: `claim-${claim._id}`,
    }, session);

    claim.settlement = { paymentId: pay._id, paidAt: new Date(), method };
    claim.transitionTo('PAID', { actor: user.role, by: user._id });
    await claim.save({ session });

    await audit({
      action: 'claim.pay', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId,
      changes: { after: { amount, method, paymentId: pay._id } },
    }, session);
    return { claim, payment: pay };
  });
}

// ---------------------------------------------------------------- khách rút hồ sơ (CUSTOMER)
export async function withdrawClaim(user: UserHydrated, id: string, reason?: string) {
  const claim = await load(id);
  await assertCanAccess(user, claim, 'claim.withdraw');
  claim.transitionTo('WITHDRAWN', { actor: user.role, by: user._id, reason });
  await claim.save();
  await audit({ action: 'claim.withdraw', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId, reason });
  return claim;
}
