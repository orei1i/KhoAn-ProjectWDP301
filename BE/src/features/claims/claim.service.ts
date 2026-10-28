import type { ClaimItem, ClaimType, PaymentMethod } from '@ssm/shared';
import { OPEN_CLAIM_STATUSES } from '@ssm/shared';
import type { ClientSession, Types } from 'mongoose';
import { DamageClaimModel, IntakeBatchModel, RentalContractModel, TicketModel, UnitTypeModel, UserModel, type DamageClaimHydrated, type UserHydrated } from '../../shared/db/models';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { CLAIM_COUNTED_STATUSES, CLAIM_FM_APPROVAL_LIMIT, CLAIM_WINDOW_DAYS, claimCapOf, claimNeedsOps, claimTotal, MAX_OPEN_CLAIMS_PER_CONTRACT, sameIncident } from './claim-rules';
import { daysBetween, localDay, todayUTC } from '../../shared/utils/dates';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment } from '../payments/payment.service';

const load = async (id: string, session?: ClientSession) => {
  const c = await DamageClaimModel.findById(id).session(session ?? null);
  if (!c) throw NotFound('hồ sơ bồi thường');
  return c;
};
const money = (n: number) => `${n.toLocaleString('vi-VN')} ₫`;

/**
 * Mức trách nhiệm của hồ sơ theo Điều 6: 10 × tiền thuê một tháng của ô kho THEO HỢP ĐỒNG (thuê tháng: giá của kỳ cam kết chứa
 * thời điểm sự cố, đã gồm phụ phí điều hoà; thuê ngày / tuần: giá tháng niêm yết) — cùng công thức với màn hình (claimCapOf).
 */
export async function liabilityCapOf(claim: { contractId: Types.ObjectId | string; incidentAt: Date | string }, session?: ClientSession | null) {
  const c = await RentalContractModel.findById(claim.contractId, { unitTypeId: 1, billing: 1, commitments: 1 }).session(session ?? null).lean();
  const ut = c ? await UnitTypeModel.findById(c.unitTypeId, { rates: 1 }).session(session ?? null).lean() : null;
  const cap = c ? claimCapOf(c, ut ? [ut] : [], claim.incidentAt) : null;
  if (!cap) throw Unprocessable('Không xác định được giá thuê tháng của ô kho để tính mức trách nhiệm');
  return cap;
}

/** Các hồ sơ KHÁC cùng sự vụ (cùng hợp đồng, cùng ngày sự cố hoặc cùng phiếu sự cố) còn được tính — tách hồ sơ không lách được trần. */
async function incidentSiblings(claim: DamageClaimHydrated, session?: ClientSession) {
  const others = await DamageClaimModel.find({ contractId: claim.contractId, _id: { $ne: claim._id }, status: { $in: [...CLAIM_COUNTED_STATUSES] } }).session(session ?? null).lean();
  return others.filter((o) => sameIncident(o, claim));
}

/** Sự vụ có giá trị xét bồi thường (tổng khách yêu cầu, tối đa bằng mức trách nhiệm) vượt hạn mức chi nhánh → chỉ vận hành quyết. */
async function needsOps(claim: DamageClaimHydrated, cap: number, session?: ClientSession) {
  const siblings = await incidentSiblings(claim, session);
  return claimNeedsOps(claim.claimedAmount + siblings.reduce((s, o) => s + o.claimedAmount, 0), cap);
}

/** Dòng khai bồi thường client gửi: chọn từ danh sách đồ đang gửi (`intakeItemId`) hoặc đồ ngoài danh sách (name + unitValue). */
export type ClaimItemInput = { name?: string; quantity: number; unitValue?: number; note?: string; intakeItemId?: string | null };

/**
 * Đợt 14 — đối chiếu các dòng bồi thường với "đồ đang gửi" (đợt nhập CONFIRMED của CHÍNH hợp đồng): có `intakeItemId` thì tên lấy theo
 * danh sách, giá trị mặc định = giá trị đã khai (nhập thấp hơn được; cao hơn → 422 CLAIM_OVER_DECLARED), tổng số lượng các dòng cùng món
 * ≤ số đã nhập (vượt → 422 CLAIM_OVER_DECLARED); không tìm thấy món → 422 INTAKE_ITEM_NOT_FOUND. Đồ ngoài danh sách vẫn khai được, server
 * gắn `undeclared: true` để nhân viên xét kỹ. Trần bồi thường giữ nguyên quy tắc hiện có.
 */
async function resolveClaimItems(contractId: Types.ObjectId, input: ClaimItemInput[]): Promise<ClaimItem[]> {
  const refIds = [...new Set(input.map((i) => i.intakeItemId?.trim()).filter((x): x is string => !!x))];
  const batches = refIds.length ? await IntakeBatchModel.find({ contractId, status: 'CONFIRMED', 'items._id': { $in: refIds } }, { items: 1 }).lean() : [];
  const declared = new Map(batches.flatMap((b) => b.items.map((it) => [it._id, it] as const)));
  const used = new Map<string, number>();
  return input.map((it): ClaimItem => {
    const ref = it.intakeItemId?.trim();
    if (!ref) {
      return { name: (it.name ?? '').trim(), quantity: it.quantity, unitValue: it.unitValue ?? 0, ...(it.note !== undefined && { note: it.note }), intakeItemId: null, undeclared: true };
    }
    const d = declared.get(ref);
    if (!d) throw Unprocessable('Món đồ đã chọn không có trong danh sách đồ đang gửi (đã khai và được xác nhận) của hợp đồng này', 'INTAKE_ITEM_NOT_FOUND');
    const unitValue = it.unitValue ?? d.estValue;
    if (unitValue > d.estValue) {
      throw new AppError(422, 'CLAIM_OVER_DECLARED', `"${d.name}": giá trị yêu cầu ${money(unitValue)}/cái cao hơn giá trị đã khai khi nhập kho ${money(d.estValue)}/cái`, { intakeItemId: ref, field: 'unitValue', max: d.estValue });
    }
    const qty = (used.get(ref) ?? 0) + it.quantity;
    used.set(ref, qty);
    if (qty > d.quantity) {
      throw new AppError(422, 'CLAIM_OVER_DECLARED', `"${d.name}": số lượng yêu cầu (${qty}) nhiều hơn số đã nhập kho (${d.quantity})`, { intakeItemId: ref, field: 'quantity', max: d.quantity });
    }
    return { name: d.name, quantity: it.quantity, unitValue, ...(it.note !== undefined && { note: it.note }), intakeItemId: ref, undeclared: false };
  });
}

// ---------------------------------------------------------------- gửi hồ sơ (CUSTOMER chủ hợp đồng; STAFF/FM lập hộ tại quầy)
export async function createClaim(user: UserHydrated, input: {
  contractId: string; type: ClaimType; incidentAt: string; description: string;
  items: ClaimItemInput[]; photoUrls?: string[]; ticketId?: string | null;
}) {
  const c = await RentalContractModel.findById(input.contractId);
  if (!c) throw NotFound('hợp đồng');
  await assertCanAccess(user, c, 'claim.create'); // khách phải là chủ hợp đồng, nhân viên phải đúng chi nhánh

  const now = new Date();
  const incidentAt = new Date(input.incidentAt);
  if (Number.isNaN(incidentAt.getTime())) throw Unprocessable('Thời điểm sự cố không hợp lệ');
  // Khách chỉ chọn NGÀY (theo giờ Việt Nam): so theo ngày — 00:00–07:00 sáng VN thì "hôm nay" (00:00 UTC) vẫn chưa tới theo giờ UTC.
  // Nhận cả dạng ngày thuần lẫn ngày thuần kèm giờ 00:00Z (bản web / app cũ gửi `YYYY-MM-DDT00:00:00.000Z`).
  const dateOnly = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(input.incidentAt);
  if (dateOnly ? incidentAt > todayUTC() : incidentAt > now) throw Unprocessable('Thời điểm sự cố không được ở tương lai');
  // Ngày bắt đầu thuê lưu theo NGÀY Việt Nam → so cùng đơn vị ngày (sự cố lúc 00:00–07:00 sáng ngày nhận kho vẫn hợp lệ).
  if ((dateOnly ? incidentAt : localDay(incidentAt)) < c.startDate) throw Unprocessable('Thời điểm sự cố trước ngày bắt đầu thuê kho');
  // Hạn 30 ngày đếm theo NGÀY Việt Nam (đếm theo giờ thì sau 19:00 ngày sớm nhất được chọn bị làm tròn thành 31 ngày).
  if (daysBetween(dateOnly ? incidentAt : localDay(incidentAt), todayUTC()) > CLAIM_WINDOW_DAYS) throw Unprocessable(`Chỉ nhận yêu cầu trong ${CLAIM_WINDOW_DAYS} ngày kể từ khi xảy ra sự cố`);
  if (c.status === 'ABANDONED') throw Unprocessable('Hợp đồng đã đóng do hàng bỏ lại (đã thanh lý), không nhận yêu cầu bồi thường');
  if (c.status === 'CLOSED' && c.closedAt && daysBetween(c.closedAt, now) > CLAIM_WINDOW_DAYS) {
    throw Unprocessable(`Hợp đồng đã kết thúc quá ${CLAIM_WINDOW_DAYS} ngày, không còn nhận yêu cầu bồi thường`);
  }

  const items = await resolveClaimItems(c._id, input.items);
  const total = claimTotal(items);
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
    description: input.description, items, photoUrls: input.photoUrls ?? [],
    claimedAmount: total, // pre('validate') tính lại từ items, đây chỉ là giá trị khởi tạo
    statusHistory: [{ from: null, to: 'SUBMITTED', at: now, by: user._id }],
  });

  await audit({
    action: 'claim.create', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId,
    changes: { after: { claimNumber: claim.claimNumber, type: claim.type, claimedAmount: claim.claimedAmount, undeclaredItems: items.filter((i) => i.undeclared).length } },
  });
  return claim;
}

// ---------------------------------------------------------------- tiếp nhận xác minh (STAFF, FACILITY_MANAGER)
export async function startClaimReview(user: UserHydrated, id: string) {
  // Trong giao dịch: tiếp nhận đúng lúc khách rút / người khác quyết thì một bên chạy lại và thấy trạng thái mới.
  return withTxn(async (session) => {
    const claim = await load(id, session);
    await assertFacility(user, claim.facilityId, 'claim.review');
    if (claim.status === 'REJECTED' && user.role !== 'OPS_MANAGER') {
      const decider = claim.review?.reviewedBy ? await UserModel.findById(claim.review.reviewedBy, { role: 1 }).session(session).lean() : null;
      if (decider?.role === 'OPS_MANAGER' || await needsOps(claim, await liabilityCapOf(claim, session), session)) {
        throw Forbidden('Hồ sơ do Quản lý vận hành quyết định — chỉ Quản lý vận hành mở lại', 'CLAIM_NEEDS_OPS');
      }
    }
    claim.transitionTo('UNDER_REVIEW', { actor: user.role, by: user._id });
    await claim.save({ session });
    await audit({ action: 'claim.review', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId }, session);
    return claim;
  });
}

// ---------------------------------------------------------------- duyệt / từ chối (FACILITY_MANAGER tới hạn mức, OPS_MANAGER mọi mức)
export async function decideClaim(user: UserHydrated, id: string, input: { approve: boolean; approvedAmount?: number; note: string }) {
  return withTxn((session) => decideClaimTxn(user, id, input, session));
}

async function decideClaimTxn(user: UserHydrated, id: string, input: { approve: boolean; approvedAmount?: number; note: string }, session: ClientSession) {
  const claim = await load(id, session);
  await assertFacility(user, claim.facilityId, 'claim.decide');
  // Ghi chạm hợp đồng: các quyết định trên CÙNG hợp đồng (hồ sơ cùng sự vụ, quản lý và vận hành cùng lúc) xung đột ghi và chạy lần
  // lượt — trần của cả sự vụ không bị vượt vì hai bên cùng đọc tổng đã duyệt cũ.
  await RentalContractModel.updateOne({ _id: claim.contractId }, { $set: { updatedAt: new Date() } }, { session });
  if (input.approve && claim.status !== 'UNDER_REVIEW') {
    throw Unprocessable('Phải chuyển hồ sơ sang "Đang xác minh" trước khi duyệt chi');
  }

  const cap = await liabilityCapOf(claim, session); // chốt vào hồ sơ để sau này đổi điều khoản / giá thuê không hồi tố
  // Sự vụ lớn: cả duyệt lẫn từ chối đều do vận hành — quản lý chi nhánh không "duyệt một phần" hay từ chối để vận hành không thấy.
  if (user.role === 'FACILITY_MANAGER' && await needsOps(claim, cap, session)) {
    throw Forbidden(`Sự vụ có giá trị xét bồi thường trên ${money(CLAIM_FM_APPROVAL_LIMIT)} — Quản lý vận hành quyết định`, 'CLAIM_NEEDS_OPS');
  }
  const amount = input.approve ? Math.trunc(input.approvedAmount ?? 0) : 0;
  if (input.approve) {
    if (amount <= 0) throw Unprocessable('Số tiền duyệt phải lớn hơn 0');
    if (amount > claim.claimedAmount) throw Unprocessable('Không duyệt quá số tiền khách yêu cầu');
    // Trần áp cho CẢ sự vụ: cộng các hồ sơ cùng sự vụ đã duyệt / đã chi.
    const approvedSiblings = (await incidentSiblings(claim, session)).filter((o) => o.status === 'APPROVED' || o.status === 'PAID').reduce((s, o) => s + (o.review?.approvedAmount ?? 0), 0);
    if (approvedSiblings + amount > cap) {
      throw Unprocessable(`Vượt mức trách nhiệm ${money(cap)} của sự vụ theo Điều 6 (10 lần tiền thuê một tháng của ô kho)${approvedSiblings ? ` — đã duyệt ${money(approvedSiblings)} ở hồ sơ khác cùng sự vụ` : ''}`, 'OVER_LIABILITY_CAP');
    }
    if (user.role === 'FACILITY_MANAGER' && amount > CLAIM_FM_APPROVAL_LIMIT) {
      throw Forbidden(`Khoản trên ${money(CLAIM_FM_APPROVAL_LIMIT)} cần Quản lý vận hành duyệt`, 'CLAIM_NEEDS_OPS');
    }
    // Người lập hồ sơ HỘ khách (nhân viên / quản lý tại quầy) không tự duyệt hồ sơ đó.
    const creator = claim.statusHistory[0]?.by;
    if (creator && String(creator) === String(user._id)) throw Forbidden('Người lập hồ sơ hộ khách không tự duyệt — nhờ quản lý khác hoặc Quản lý vận hành', 'SAME_CREATOR');
  }

  claim.review = { reviewedBy: user._id, reviewedAt: new Date(), approvedAmount: amount, liabilityCap: cap, decisionNote: input.note };
  claim.transitionTo(input.approve ? 'APPROVED' : 'REJECTED', { actor: user.role, by: user._id, reason: input.note });
  await claim.save({ session });

  await audit({
    action: input.approve ? 'claim.approve' : 'claim.reject', entityType: 'DamageClaim', entityId: claim._id,
    facilityId: claim.facilityId, reason: input.note,
    changes: { after: { approvedAmount: amount, claimedAmount: claim.claimedAmount, liabilityCap: cap } },
  }, session);
  return claim;
}

// ---------------------------------------------------------------- chi tiền (STAFF tiền mặt, FACILITY_MANAGER, OPS_MANAGER)
/**
 * Hai người cho mỗi khoản chi: tiền mặt do người KHÁC người duyệt chi tại quầy (nhân viên / quản lý khác); chuyển khoản thì tạo lệnh
 * chờ chuyển (PENDING) — hồ sơ chỉ sang "Đã chi" khi người khác người duyệt xác nhận đã chuyển (POST /payments/:id/confirm-payout).
 */
export async function payClaim(user: UserHydrated, id: string, method: PaymentMethod) {
  return withTxn(async (session) => {
    const claim = await DamageClaimModel.findById(id).session(session);
    if (!claim) throw NotFound('hồ sơ bồi thường');
    await assertFacility(user, claim.facilityId, 'claim.pay');
    if (claim.status !== 'APPROVED') throw Unprocessable('Chỉ chi tiền cho hồ sơ đã duyệt');
    if (user.role === 'STAFF' && method !== 'CASH') throw Forbidden('Nhân viên chỉ chi tiền mặt tại quầy — chuyển khoản do quản lý lập', 'STAFF_CASH_ONLY');
    if (claim.settlement?.paymentId) throw Conflict('Đã lập lệnh chuyển khoản cho hồ sơ này — chờ xác nhận đã chuyển', 'PAYOUT_PENDING');
    if (method === 'CASH' && String(claim.review?.reviewedBy) === String(user._id)) {
      throw Forbidden('Người duyệt hồ sơ không tự chi tiền — nhờ nhân viên hoặc quản lý khác chi', 'SAME_APPROVER');
    }
    const amount = claim.review?.approvedAmount ?? 0;
    if (amount <= 0) throw Unprocessable('Hồ sơ không có số tiền đã duyệt');

    // idempotencyKey theo hồ sơ + chỉ mục unique trên PaymentTransaction → không thể chi hai lần.
    // Chuyển khoản: createPayment tự đưa về PENDING (chờ chuyển).
    const pay = await createPayment({
      facilityId: claim.facilityId, customerId: claim.customerId, contractId: claim.contractId,
      type: 'COMPENSATION', amount, status: 'SUCCEEDED', method,
      recordedBy: method === 'CASH' ? user._id : null,
      idempotencyKey: `claim-${claim._id}`,
    }, session);
    const paid = pay.status === 'SUCCEEDED';

    claim.settlement = { paymentId: pay._id, paidAt: paid ? new Date() : null, method };
    if (paid) claim.transitionTo('PAID', { actor: user.role, by: user._id });
    await claim.save({ session });

    await audit({
      action: paid ? 'claim.pay' : 'claim.payout_request', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId,
      changes: { after: { amount, method, paymentId: pay._id } },
    }, session);
    return { claim, payment: pay };
  });
}

// ---------------------------------------------------------------- khách rút hồ sơ (CUSTOMER)
export async function withdrawClaim(user: UserHydrated, id: string, reason?: string) {
  // Trong giao dịch: rút đúng lúc chi nhánh duyệt thì một bên chạy lại — không ra kết quả "đã duyệt" sau khi khách đã rút.
  return withTxn(async (session) => {
    const claim = await load(id, session);
    await assertCanAccess(user, claim, 'claim.withdraw');
    claim.transitionTo('WITHDRAWN', { actor: user.role, by: user._id, reason });
    await claim.save({ session });
    await audit({ action: 'claim.withdraw', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId, reason }, session);
    return claim;
  });
}
