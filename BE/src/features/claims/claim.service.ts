import type { ClaimItem, ClaimType, IdType, PaymentMethod, SealedPackageState } from '@ssm/shared';
import { claimableQty, claimHoldEnd, confirmedAfterIncident, fmtDate, heldOnDay, matchDeclaredName, normalizeIdLast4, OPEN_CLAIM_STATUSES } from '@ssm/shared';
import type { ClientSession, Types } from 'mongoose';
import { DamageClaimModel, IntakeBatchModel, RentalContractModel, TicketModel, UnitTypeModel, UserModel, type DamageClaimHydrated, type UserHydrated } from '../../shared/db/models';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { CLAIM_COUNTED_STATUSES, CLAIM_FM_APPROVAL_LIMIT, CLAIM_WINDOW_DAYS, claimCapOf, claimNeedsOps, claimTotal, MAX_OPEN_CLAIMS_PER_CONTRACT, sameIncident, unitTypeAt } from './claim-rules';
import { daysBetween, localDay, todayUTC } from '../../shared/utils/dates';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment } from '../payments/payment.service';
import { verifyPresentedId } from '../access/access.service';
import { mailCustomer } from '../contracts/contract-notice.service';
import { assertIdCheckOpen, contractLabel, markIdCheckPassed, withIdCheckLog, type IdCheckTarget } from '../contracts/id-check';

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
  const c = await RentalContractModel.findById(claim.contractId, { unitTypeId: 1, billing: 1, commitments: 1, sizeChanges: 1 }).session(session ?? null).lean();
  // Đợt 16 (A6): thuê ngày / tuần lấy giá tháng của loại kho có hiệu lực TẠI ngày sự cố (đã đổi cỡ thì loại trước / sau ngày đổi).
  const ut = c ? await UnitTypeModel.findById(unitTypeAt(c, claim.incidentAt), { rates: 1 }).session(session ?? null).lean() : null;
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
export type ClaimItemInput = { name?: string; quantity: number; unitValue?: number; note?: string; intakeItemId?: string | null; packageState?: SealedPackageState | null };

/** A1: số lượng mỗi món đã được yêu cầu ở MỌI hồ sơ cùng hợp đồng còn được tính (chưa bị từ chối / khách rút — gồm cả đã chi). */
async function claimedByItem(contractId: Types.ObjectId, session: ClientSession) {
  const others = await DamageClaimModel.find({ contractId, status: { $in: [...CLAIM_COUNTED_STATUSES] } }, { 'items.intakeItemId': 1, 'items.quantity': 1 }).session(session).lean();
  const m = new Map<string, number>();
  for (const o of others) for (const it of o.items) if (it.intakeItemId) m.set(it.intakeItemId, (m.get(it.intakeItemId) ?? 0) + it.quantity);
  return m;
}

/**
 * Đối chiếu các dòng bồi thường với "đồ đang gửi" (đợt nhập CONFIRMED của CHÍNH hợp đồng) — đợt 14 + đợt 15:
 *  - có `intakeItemId`: tên theo danh sách, giá trị mặc định = giá trị đã khai (thấp hơn được; cao hơn → 422 CLAIM_OVER_DECLARED field unitValue);
 *    tổng số lượng của món (dòng mới + mọi hồ sơ khác còn được tính) ≤ số còn trong kho vào NGÀY SỰ CỐ (A1 + A7) — vượt → 422
 *    CLAIM_OVER_DECLARED field quantity, max = số còn đòi được; không tìm thấy món → 422 INTAKE_ITEM_NOT_FOUND. Chép mã đợt, lúc xác nhận,
 *    tình trạng lúc nhập. Món nhập SAU ngày sự cố → vẫn giữ liên kết + trần giá trị nhưng undeclared + flag AFTER_INCIDENT (A5); món đã hư
 *    lúc nhập (hồ sơ hư hỏng) → flag DAMAGED_AT_INTAKE;
 *  - đồ ngoài danh sách: vẫn khai được, server gắn `undeclared: true`; tên trùng / gần trùng một món còn trong kho vào ngày sự cố → flag
 *    MATCHES_DECLARED + matchedItem (A9).
 * Gọi TRONG transaction lập hồ sơ (đọc các hồ sơ khác cùng lúc với ghi hồ sơ mới).
 */
async function resolveClaimItems(contractId: Types.ObjectId, type: ClaimType, incidentDay: string, input: ClaimItemInput[], session: ClientSession): Promise<ClaimItem<Date>[]> {
  const batches = await IntakeBatchModel.find({ contractId, status: 'CONFIRMED' }, { code: 1, items: 1, confirmedAt: 1, sealed: 1 }).session(session).lean();
  const declared = new Map(batches.flatMap((b) => b.items.map((it) => [it._id, { it, b }] as const)));
  const anyRef = input.some((i) => !!i.intakeItemId?.trim());
  const claimed = anyRef ? await claimedByItem(contractId, session) : new Map<string, number>();
  // Ứng viên trùng tên (A9): món còn trong kho vào ngày sự cố.
  const candidates = batches.flatMap((b) => b.items.filter((it) => heldOnDay(it, incidentDay) > 0).map((it) => ({ intakeItemId: it._id, name: it.name, estValue: it.estValue })));
  const used = new Map<string, number>();
  return input.map((it): ClaimItem<Date> => {
    const ref = it.intakeItemId?.trim();
    const note = it.note !== undefined ? { note: it.note } : {};
    if (!ref) {
      const name = (it.name ?? '').trim();
      const m = matchDeclaredName(name, candidates);
      return { name, quantity: it.quantity, unitValue: it.unitValue ?? 0, ...note, intakeItemId: null, undeclared: true, ...(m ? { flag: 'MATCHES_DECLARED' as const, matchedItem: m } : {}) };
    }
    const hit = declared.get(ref);
    if (!hit) throw Unprocessable('Món đồ đã chọn không có trong danh sách đồ đang gửi (đã khai và được xác nhận) của hợp đồng này', 'INTAKE_ITEM_NOT_FOUND');
    const d = hit.it;
    // Đợt 16 (D2): KIỆN gửi kín — bồi thường theo kiện, chỉ khi mất cả kiện / hư hại bên ngoài; kiện còn nguyên thì không nhận thiếu đồ bên trong.
    const sealed = hit.b.sealed ?? null;
    if (sealed) {
      if (!it.packageState) throw new AppError(422, 'PACKAGE_STATE_REQUIRED', `"${d.name}" là kiện gửi kín — chọn tình trạng kiện (mất cả kiện / hư hại bên ngoài)`, { intakeItemId: ref });
      if (it.packageState === 'CONTENTS_ONLY') {
        throw new AppError(422, 'SEALED_CONTENTS_NOT_COVERED', sealed.hasSeal
          ? `"${d.name}" còn nguyên niêm phong — KhoAn không nhận khiếu nại thiếu / hư đồ bên trong kiện gửi kín`
          : `"${d.name}" là kiện gửi kín — chỉ bồi thường khi mất cả kiện hoặc kiện hư hại bên ngoài do lỗi kho`, { intakeItemId: ref });
      }
    }
    // Kiện của đợt KHÔNG khai giá trị: không áp mặc định / trần "giá trị khai" — khách nhập giá trị, cần chứng cứ (như đồ ngoài danh sách).
    const noValue = !!sealed && !(sealed.declaredValue && sealed.declaredValue > 0);
    if (noValue && !(it.unitValue && it.unitValue > 0)) throw new AppError(422, 'SEALED_VALUE_REQUIRED', `"${d.name}": đợt gửi kín không khai giá trị — nhập giá trị yêu cầu và gửi kèm chứng cứ (hoá đơn, ảnh…)`, { intakeItemId: ref, field: 'unitValue' });
    const unitValue = it.unitValue ?? d.estValue;
    if (!noValue && unitValue > d.estValue) {
      throw new AppError(422, 'CLAIM_OVER_DECLARED', `"${d.name}": giá trị yêu cầu ${money(unitValue)}/cái cao hơn giá trị đã khai khi nhập kho ${money(d.estValue)}/cái`, { intakeItemId: ref, field: 'unitValue', max: d.estValue });
    }
    const qty = (used.get(ref) ?? 0) + it.quantity;
    used.set(ref, qty);
    const elsewhere = claimed.get(ref) ?? 0;
    const max = claimableQty(d, incidentDay, elsewhere);
    if (qty > max) {
      const out = d.quantity - heldOnDay(d, incidentDay);
      const why = [`đã nhập ${d.quantity}`, out > 0 ? `đã ra khỏi kho trước ngày sự cố ${out}` : '', elsewhere > 0 ? `đã yêu cầu ở hồ sơ khác ${elsewhere}` : ''].filter(Boolean).join(', ');
      throw new AppError(422, 'CLAIM_OVER_DECLARED', `"${d.name}": số lượng yêu cầu (${qty}) vượt số còn đòi được (${max}) — ${why}`, { intakeItemId: ref, field: 'quantity', max });
    }
    const after = confirmedAfterIncident(hit.b.confirmedAt, incidentDay);
    const flag = after ? 'AFTER_INCIDENT' as const
      : sealed ? (noValue ? 'SEALED_NO_VALUE' as const : 'SEALED_PACKAGE' as const)
        : d.condition === 'DAMAGED' && type === 'DAMAGE' ? 'DAMAGED_AT_INTAKE' as const : null;
    return {
      name: d.name, quantity: it.quantity, unitValue, ...note, intakeItemId: ref, undeclared: after || noValue, ...(flag ? { flag } : {}),
      batchCode: hit.b.code, intakeConfirmedAt: hit.b.confirmedAt ?? null, intakeCondition: d.condition,
      ...(sealed ? { sealedPackage: true, packageState: it.packageState ?? null } : {}),
    };
  });
}

// ---------------------------------------------------------------- gửi hồ sơ (CUSTOMER chủ hợp đồng; STAFF/FM lập hộ tại quầy)
export async function createClaim(user: UserHydrated, input: {
  contractId: string; type: ClaimType; incidentAt: string; description: string;
  items: ClaimItemInput[]; photoUrls?: string[]; ticketId?: string | null;
}) {
  const now = new Date();
  const incidentAt = new Date(input.incidentAt);
  if (Number.isNaN(incidentAt.getTime())) throw Unprocessable('Thời điểm sự cố không hợp lệ');
  // Khách chỉ chọn NGÀY (theo giờ Việt Nam): so theo ngày — 00:00–07:00 sáng VN thì "hôm nay" (00:00 UTC) vẫn chưa tới theo giờ UTC.
  // Nhận cả dạng ngày thuần lẫn ngày thuần kèm giờ 00:00Z (bản web / app cũ gửi `YYYY-MM-DDT00:00:00.000Z`).
  const dateOnly = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(input.incidentAt);
  const incidentDate = dateOnly ? incidentAt : localDay(incidentAt);
  const incidentDay = incidentDate.toISOString().slice(0, 10);

  // Trong transaction (A1): đọc số đã yêu cầu ở các hồ sơ khác và ghi hồ sơ mới cùng lúc; ghi chạm hợp đồng để hai hồ sơ gửi đồng thời trên
  // CÙNG hợp đồng xung đột ghi và chạy lần lượt — không cùng "thấy" số còn đòi được cũ.
  const claim = await withTxn(async (session) => {
    const c = await RentalContractModel.findById(input.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertCanAccess(user, c, 'claim.create'); // khách phải là chủ hợp đồng, nhân viên phải đúng chi nhánh

    if (dateOnly ? incidentAt > todayUTC() : incidentAt > now) throw Unprocessable('Thời điểm sự cố không được ở tương lai');
    // Ngày bắt đầu thuê lưu theo NGÀY Việt Nam → so cùng đơn vị ngày (sự cố lúc 00:00–07:00 sáng ngày nhận kho vẫn hợp lệ).
    if (incidentDate < c.startDate) throw Unprocessable('Thời điểm sự cố trước ngày bắt đầu thuê kho');
    // Hạn 30 ngày đếm theo NGÀY Việt Nam (đếm theo giờ thì sau 19:00 ngày sớm nhất được chọn bị làm tròn thành 31 ngày).
    if (daysBetween(incidentDate, todayUTC()) > CLAIM_WINDOW_DAYS) throw Unprocessable(`Chỉ nhận yêu cầu trong ${CLAIM_WINDOW_DAYS} ngày kể từ khi xảy ra sự cố`);
    if (c.status === 'ABANDONED') throw Unprocessable('Hợp đồng đã đóng do hàng bỏ lại (đã thanh lý), không nhận yêu cầu bồi thường');
    if (c.status === 'CLOSED' && c.closedAt && daysBetween(c.closedAt, now) > CLAIM_WINDOW_DAYS) {
      throw Unprocessable(`Hợp đồng đã kết thúc quá ${CLAIM_WINDOW_DAYS} ngày, không còn nhận yêu cầu bồi thường`);
    }
    // A2: KhoAn chỉ chịu trách nhiệm trong thời gian thuê — sự cố SAU ngày khách bàn giao lại kho (không có thì ngày thu hồi quyền ra vào /
    // ngày đóng hợp đồng) không nhận.
    const holdEnd = claimHoldEnd(c);
    if (holdEnd && incidentDay > holdEnd) {
      throw Unprocessable(`Sự cố sau ngày trả kho ${fmtDate(holdEnd)} — KhoAn chỉ chịu trách nhiệm trong thời gian thuê`, 'INCIDENT_AFTER_RETURN');
    }

    await RentalContractModel.updateOne({ _id: c._id }, { $set: { updatedAt: new Date() } }, { session });
    const items = await resolveClaimItems(c._id, input.type, incidentDay, input.items, session);
    const total = claimTotal(items);
    if (total <= 0) throw Unprocessable('Tổng giá trị khai báo phải lớn hơn 0');

    const open = await DamageClaimModel.countDocuments({ contractId: c._id, status: { $in: [...OPEN_CLAIM_STATUSES] } }).session(session);
    if (open >= MAX_OPEN_CLAIMS_PER_CONTRACT) {
      throw Unprocessable(`Hợp đồng đang có ${open} hồ sơ chờ xử lý — đợi kết quả rồi hãy gửi thêm`);
    }

    if (input.ticketId) {
      const t = await TicketModel.findById(input.ticketId).session(session);
      if (!t || String(t.facilityId) !== String(c.facilityId)) throw Unprocessable('Sự cố tham chiếu không thuộc chi nhánh của hợp đồng');
      if (user.role === 'CUSTOMER' && String(t.reporterId) !== String(user._id)) throw Forbidden('Sự cố này không thuộc về bạn', 'OWNERSHIP');
    }

    const [claim] = await DamageClaimModel.create([{
      facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, unitId: c.unitId,
      ticketId: input.ticketId ?? null, type: input.type, status: 'SUBMITTED', incidentAt,
      description: input.description, items, photoUrls: input.photoUrls ?? [],
      claimedAmount: total, // pre('validate') tính lại từ items, đây chỉ là giá trị khởi tạo
      statusHistory: [{ from: null, to: 'SUBMITTED', at: now, by: user._id }],
    }], { session });

    await audit({
      action: 'claim.create', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId,
      changes: { after: { claimNumber: claim.claimNumber, type: claim.type, claimedAmount: claim.claimedAmount, undeclaredItems: items.filter((i) => i.undeclared).length, flagged: items.filter((i) => i.flag).map((i) => i.flag) } },
    }, session);
    return claim;
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
  const claim = await withTxn((session) => decideClaimTxn(user, id, input, session));
  // Đợt 16 (C8): báo khách kết quả xét (sau commit, không chặn phản hồi).
  void mailCustomer(claim.customerId, `KhoAn — Hồ sơ bồi thường ${claim.claimNumber} ${input.approve ? 'đã được duyệt' : 'không được duyệt'}`, input.approve
    ? [`Hồ sơ bồi thường ${claim.claimNumber} đã được duyệt ${money(claim.review?.approvedAmount ?? 0)} (khách yêu cầu ${money(claim.claimedAmount)}).`, `Căn cứ: ${input.note}`,
      'Tiền bồi thường chi bằng chuyển khoản tới tài khoản nhận tiền bạn đã khai, hoặc tiền mặt tại quầy cho chính chủ hợp đồng (mang giấy tờ tùy thân bản gốc).']
    : [`Hồ sơ bồi thường ${claim.claimNumber} không được duyệt.`, `Căn cứ: ${input.note}`, 'Cần trao đổi thêm, vui lòng liên hệ chi nhánh.']);
  return claim;
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
/** Giấy tờ BẢN GỐC của người nhận tiền mặt (chủ hợp đồng) — nhân viên đọc và nhập, tick đã kiểm (A6). */
export interface CashPayoutId { idType?: IdType; idNumberLast4?: string; identityVerified?: boolean }

/** Người lập hồ sơ: người đầu tiên trong statusHistory (hồ sơ cũ thiếu thì người tạo — createdBy). */
const claimCreator = (claim: DamageClaimHydrated) => claim.statusHistory[0]?.by ?? (claim.get('createdBy') as Types.ObjectId | null | undefined) ?? null;

/**
 * Hai người cho mỗi khoản chi: tiền mặt do người KHÁC người duyệt chi tại quầy (nhân viên / quản lý khác); chuyển khoản thì tạo lệnh
 * chờ chuyển (PENDING) — hồ sơ chỉ sang "Đã chi" khi người khác người duyệt xác nhận đã chuyển (POST /payments/:id/confirm-payout).
 * Đợt 15 (A6): người LẬP hồ sơ không ghi nhận chi tiền (403 SELF_PAYOUT); chi tiền mặt bắt buộc đối chiếu giấy tờ bản gốc của CHỦ hợp đồng
 * (loại giấy tờ + 4 số cuối + tick đã kiểm — thiếu 422 ID_REQUIRED, sai 422 ID_MISMATCH, sai nhiều lần khoá đối chiếu như nơi khác) và lưu
 * người nhận vào hồ sơ. Chuyển khoản giữ như cũ.
 */
export async function payClaim(user: UserHydrated, id: string, method: PaymentMethod, presented: CashPayoutId = {}) {
  const ref: { target?: IdCheckTarget } = {};
  return withIdCheckLog(ref, () => withTxn(async (session) => {
    const claim = await DamageClaimModel.findById(id).session(session);
    if (!claim) throw NotFound('hồ sơ bồi thường');
    await assertFacility(user, claim.facilityId, 'claim.pay');
    if (claim.status !== 'APPROVED') throw Unprocessable('Chỉ chi tiền cho hồ sơ đã duyệt');
    if (user.role === 'STAFF' && method !== 'CASH') throw Forbidden('Nhân viên chỉ chi tiền mặt tại quầy — chuyển khoản do quản lý lập', 'STAFF_CASH_ONLY');
    if (claim.settlement?.paymentId) throw Conflict('Đã lập lệnh chuyển khoản cho hồ sơ này — chờ xác nhận đã chuyển', 'PAYOUT_PENDING');
    if (method === 'CASH' && String(claim.review?.reviewedBy) === String(user._id)) {
      throw Forbidden('Người duyệt hồ sơ không tự chi tiền — nhờ nhân viên hoặc quản lý khác chi', 'SAME_APPROVER');
    }
    const creator = claimCreator(claim);
    if (method === 'CASH' && creator && String(creator) === String(user._id)) {
      throw Forbidden('Người lập hồ sơ không tự ghi nhận chi tiền bồi thường — nhờ nhân viên hoặc quản lý khác chi', 'SELF_PAYOUT');
    }
    const amount = claim.review?.approvedAmount ?? 0;
    if (amount <= 0) throw Unprocessable('Hồ sơ không có số tiền đã duyệt');

    // A6: tiền mặt → đối chiếu giấy tờ bản gốc của chủ hợp đồng (cùng quy tắc mở kho hộ / giao thẻ: nhập sai nhiều lần thì khoá đối chiếu).
    let recipient: { name: string; idType: IdType; idNumberLast4: string; at: Date; by: Types.ObjectId } | null = null;
    if (method === 'CASH') {
      const c = await RentalContractModel.findById(claim.contractId).session(session);
      if (!c) throw NotFound('hợp đồng');
      ref.target = { kind: 'contract', id: c._id, facilityId: c.facilityId, label: contractLabel(c) };
      assertIdCheckOpen(c);
      if (presented.identityVerified !== true) throw Unprocessable('Xem giấy tờ tùy thân bản gốc của người nhận (chủ hợp đồng), nhập loại giấy tờ, 4 số cuối và tick đã kiểm trước khi chi tiền mặt', 'ID_REQUIRED');
      const who = await verifyPresentedId(c, { presenter: 'CUSTOMER', idType: presented.idType, idNumberLast4: presented.idNumberLast4 }, session);
      markIdCheckPassed(c);
      await c.save({ session });
      recipient = { name: who.name, idType: who.idType, idNumberLast4: normalizeIdLast4(presented.idNumberLast4 ?? ''), at: new Date(), by: user._id };
    }

    // idempotencyKey theo hồ sơ + chỉ mục unique trên PaymentTransaction → không thể chi hai lần.
    // Chuyển khoản: createPayment tự đưa về PENDING (chờ chuyển).
    const pay = await createPayment({
      facilityId: claim.facilityId, customerId: claim.customerId, contractId: claim.contractId,
      type: 'COMPENSATION', amount, status: 'SUCCEEDED', method,
      recordedBy: method === 'CASH' ? user._id : null,
      idempotencyKey: `claim-${claim._id}`,
    }, session);
    const paid = pay.status === 'SUCCEEDED';

    claim.settlement = { paymentId: pay._id, paidAt: paid ? new Date() : null, method, ...(recipient ? { recipient } : {}) };
    if (paid) claim.transitionTo('PAID', { actor: user.role, by: user._id });
    await claim.save({ session });

    await audit({
      action: paid ? 'claim.pay' : 'claim.payout_request', entityType: 'DamageClaim', entityId: claim._id, facilityId: claim.facilityId,
      // Không ghi 4 số cuối giấy tờ vào nhật ký (Chính sách bảo mật) — chỉ loại giấy tờ và việc đã đối chiếu.
      changes: { after: { amount, method, paymentId: pay._id, ...(recipient ? { recipient: recipient.name, idType: recipient.idType, idChecked: true } : {}) } },
    }, session);
    return { claim, payment: pay };
  })).then((r) => {
    // Đợt 16 (C8): đã chi tiền mặt → báo khách (chuyển khoản: báo khi xác nhận đã chuyển — payment.service confirmPayout).
    if (r.payment.status === 'SUCCEEDED') {
      void mailCustomer(r.claim.customerId, `KhoAn — Đã chi bồi thường hồ sơ ${r.claim.claimNumber}`, [
        `KhoAn đã chi ${money(r.payment.amount)} tiền mặt tại quầy cho hồ sơ bồi thường ${r.claim.claimNumber}${r.claim.settlement?.recipient?.name ? ` (người nhận: ${r.claim.settlement.recipient.name})` : ''}.`,
        'Nếu bạn không nhận khoản này, vui lòng liên hệ ngay chi nhánh.',
      ]);
    }
    return r;
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
