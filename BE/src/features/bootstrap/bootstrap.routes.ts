import { Router } from 'express';
import {
  AccessRequestModel, AuditLogModel, DamageClaimModel, FacilityModel, InspectionModel, IntakeBatchModel, PaymentModel, PolicyModel, RentalContractModel,
  ReservationModel, ServiceOfferingModel, ServiceOrderModel, StorageUnitModel, TicketModel, UnitSwapRequestModel, UnitTypeModel, UserModel,
  ADMIN_USER_FIELDS,
} from '../../shared/db/models';
import { compensatedByItem, inStorageQty, OPEN_CLAIM_STATUSES, withPolicyDefaults } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { isScoped } from '../../shared/http/scope';
import { withLeftoverHeld } from '../facilities/inventory.service';
import { paymentProjectionFor } from '../payments/payment.service';
import { selfView } from '../users/user.service';
import { customerPolicy } from '../policies/policy.service';

/**
 * One scoped snapshot for the web dashboard. Every query below is filtered by what the caller may see:
 *   CUSTOMER → own records · STAFF/FM → their facilities · OPS → everything operational · ADMIN → users (ADMIN_USER_FIELDS; audit via GET /audit).
 * Mutations never go through here — they use the dedicated endpoints, which re-check rules server-side.
 */
/** Gộp hai danh sách theo _id, giữ thứ tự danh sách đầu. */
function mergeById<T extends { _id: unknown }>(a: T[], b: T[]): T[] {
  const seen = new Set(a.map((x) => String(x._id)));
  return [...a, ...b.filter((x) => !seen.has(String(x._id)))];
}

export const bootstrapRouter = Router();

// Bỏ cả nguyên văn hợp đồng đã ký (nặng) — client đọc qua GET /reservations/:id/contract khi cần.
const NO_QR_HASH = { 'checkIn.qrTokenHash': 0, 'signature.clauses': 0, signOtp: 0, 'scheduleChanges.voidedSignature.clauses': 0, 'scheduleChanges.voidedSignature.image': 0 } as const;
const PUBLIC_USER = { fullName: 1, role: 1, facilityIds: 1, status: 1 } as const;
// Ảnh chữ ký bàn giao khi nhận lại kho chỉ lưu làm chứng cứ — không gửi ra như các ảnh chữ ký khác.
const NO_SIGNATURE_IMAGE = { 'moveOut.handover.image': 0 } as const;
const ids = (xs: unknown[]) => [...new Set(xs.filter(Boolean).map(String))];

/**
 * Đợt 15 (A7): kèm vào từng món của đợt nhập số ĐANG GỬI (quantity − Σ removals) và số ĐÃ BỒI THƯỜNG (Σ dòng hồ sơ PAID trỏ tới món) —
 * tính ở server từ mọi hồ sơ đã chi của các hợp đồng đó (danh sách hồ sơ trong snapshot có thể không đủ). removals đã có sẵn trong món.
 */
async function withItemStock<B extends { contractId: unknown; items: { _id: string; quantity: number; removals?: { quantity: number; kind: string; at: unknown }[] | null }[] }>(batches: B[]): Promise<B[]> {
  if (!batches.length) return batches;
  const paid = await DamageClaimModel.find({ contractId: { $in: ids(batches.map((b) => b.contractId)) }, status: 'PAID', 'items.intakeItemId': { $ne: null } }, { status: 1, 'items.intakeItemId': 1, 'items.quantity': 1 }).lean();
  const comp = compensatedByItem(paid);
  return batches.map((b) => ({ ...b, items: b.items.map((it) => ({ ...it, inStorage: inStorageQty(it as Parameters<typeof inStorageQty>[0]), compensated: comp.get(it._id) ?? 0 })) }));
}

bootstrapRouter.get('/', authenticate, async (req, res) => {
  const me = req.auth!.user;
  const empty = { users: [], facilities: [], unitTypes: [], units: [], reservations: [], contracts: [], payments: [], inspections: [], tickets: [], claims: [], swapRequests: [], services: [], serviceOrders: [], accessRequests: [], intakeBatches: [], policies: [], audit: [] };

  if (me.role === 'CUSTOMER') {
    const [facilities, unitTypes, reservations, contracts, payments, rawTickets, claims, swapRequests, services, serviceOrders, accessRequests, intakeBatches] = await Promise.all([
      FacilityModel.find({}).lean(),
      UnitTypeModel.find({}).lean(),
      ReservationModel.find({ customerId: me._id }, NO_QR_HASH).sort({ createdAt: -1 }).lean(),
      RentalContractModel.find({ customerId: me._id }, NO_SIGNATURE_IMAGE).lean(),
      PaymentModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      TicketModel.find({ reporterId: me._id, kind: 'CUSTOMER_ISSUE' }).lean(), // đợt 16 (B2): không gửi việc nội bộ đứng tên khách
      DamageClaimModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      UnitSwapRequestModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      ServiceOfferingModel.find({ isActive: true }).lean(),
      ServiceOrderModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      AccessRequestModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      // Đợt nhập hàng của khách (mọi trạng thái) — "đồ đang gửi" = các đợt CONFIRMED (inventoryOf).
      IntakeBatchModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const tickets = rawTickets.map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) }));
    const unitIds = ids([...reservations.map((r) => r.unitId), ...contracts.map((c) => c.unitId), ...swapRequests.flatMap((s) => [s.fromUnitId, s.toUnitId])]);
    // Kèm chính sách CHỐT lúc gia hạn (từng kỳ cam kết) — xem trước hoàn tiền giữ chân / thu hồi ưu đãi phải theo đúng bản đó như server.
    const policyIds = ids([...reservations.map((r) => r.quote.policyId), ...contracts.map((c) => c.terms.policyId), ...contracts.flatMap((c) => (c.commitments ?? []).map((x) => x.policyId))]);
    const staffIds = ids(tickets.flatMap((t) => [t.assigneeId, ...t.messages.map((m) => m.authorId)])).filter((i) => i !== String(me._id));
    const [units, inspections, policies, others] = await Promise.all([
      StorageUnitModel.find({ _id: { $in: unitIds } }).lean(),
      InspectionModel.find({ contractId: { $in: contracts.map((c) => c._id) } }).lean(),
      PolicyModel.find({ $or: [{ isActive: true }, { _id: { $in: policyIds } }] }).lean(),
      UserModel.find({ _id: { $in: staffIds } }, PUBLIC_USER).lean(),
    ]);
    return res.json({ ...empty, me: selfView(me), users: [me, ...others], facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, intakeBatches: await withItemStock(intakeBatches), policies: policies.map((p) => customerPolicy(withPolicyDefaults(p))) });
  }

  if (me.role === 'ADMIN') {
    // Admin quản lý tài khoản, không xử lý hồ sơ khách → chỉ nhận ADMIN_USER_FIELDS (không giấy tờ, địa chỉ, tài khoản nhận tiền).
    // Nhật ký không gửi kèm ở đây nữa: trang Nhật ký tải theo trang qua GET /audit (trước đây chỉ thấy 500 bản ghi mới nhất).
    const [users, facilities, policies] = await Promise.all([
      UserModel.find({}, ADMIN_USER_FIELDS).sort({ createdAt: -1 }).lean(),
      FacilityModel.find({}).lean(),
      PolicyModel.find({ isActive: true }).lean(),
    ]);
    return res.json({ ...empty, me: selfView(me), users, facilities, policies: policies.map(withPolicyDefaults) });
  }

  // STAFF / FACILITY_MANAGER (scoped) and OPS_MANAGER (chain-wide)
  const scoped = isScoped(me);
  const byFacility = scoped ? { facilityId: { $in: me.facilityIds } } : {};
  // Nhân viên quầy KHÔNG thấy 4 số cuối giấy tờ khách (đã khai / đã đối chiếu): phải nhập từ giấy tờ bản gốc khi nhận kho / đặt tại
  // quầy để hệ thống so khớp — thấy sẵn số thì việc đối chiếu chỉ còn hình thức. Quản lý chi nhánh / vận hành giữ.
  const staff = me.role === 'STAFF';
  const [facilities, unitTypes, rawUnits, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, intakeBatches, policies, audit] = await Promise.all([
    FacilityModel.find(scoped ? { _id: { $in: me.facilityIds } } : {}).lean(),
    UnitTypeModel.find(byFacility).lean(),
    StorageUnitModel.find(byFacility).lean(),
    ReservationModel.find(byFacility, NO_QR_HASH).lean(),
    // … kể cả 4 số cuối của người được uỷ quyền: nhân viên nhập từ giấy tờ người đó xuất trình, server so khớp (mở hộ / giao thẻ).
    RentalContractModel.find(byFacility, staff ? { ...NO_SIGNATURE_IMAGE, 'identity.idNumberLast4': 0, 'authorizedPersons.idNumberLast4': 0 } : NO_SIGNATURE_IMAGE).lean(),
    PaymentModel.find(byFacility, paymentProjectionFor(me.role)).lean(), // nhân viên: không kèm số tài khoản khách nhận tiền hoàn
    // Vận hành xem cả chuỗi: ngoài 300 bản mới nhất, luôn kèm biên bản trả kho 90 ngày gần đây (còn khiếu nại / điều chỉnh được). Đợt 15
    // (C4): kèm mọi biên bản trả kho / xử lý hàng bỏ lại trong ~6 tháng — doanh thu tháng tính cả phần tiền giữ chân cấn trừ, tiền thanh lý.
    InspectionModel.find(byFacility).sort({ performedAt: -1 }).limit(300).lean()
      .then(async (latest) => mergeById(latest, await InspectionModel.find({ ...byFacility, type: { $in: ['MOVE_OUT', 'ABANDONMENT'] }, performedAt: { $gte: new Date(Date.now() - 190 * 86_400_000) } }).lean())),
    TicketModel.find(byFacility).lean(),
    // … và mọi hồ sơ bồi thường còn mở (trang Duyệt & chi không được sót hồ sơ cũ).
    // Việc CÒN MỞ luôn được gửi dù cũ hơn 300 bản mới nhất — nếu không, hàng đợi của chi nhánh đông sẽ "mất" việc cũ chưa xử lý.
    // … nhân viên quầy không thấy 4 số cuối giấy tờ của người nhận tiền bồi thường (đợt 15, A6).
    DamageClaimModel.find(byFacility, staff ? { 'settlement.recipient.idNumberLast4': 0 } : {}).sort({ createdAt: -1 }).limit(300).lean()
      .then(async (latest) => mergeById(latest, await DamageClaimModel.find({ ...byFacility, status: { $in: [...OPEN_CLAIM_STATUSES] } }, staff ? { 'settlement.recipient.idNumberLast4': 0 } : {}).lean())),
    UnitSwapRequestModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean()
      .then(async (latest) => mergeById(latest, await UnitSwapRequestModel.find({ ...byFacility, status: { $in: ['SUBMITTED', 'APPROVED'] } }).lean())),
    ServiceOfferingModel.find(byFacility).lean(),
    ServiceOrderModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean()
      .then(async (latest) => mergeById(latest, await ServiceOrderModel.find({ ...byFacility, status: 'REQUESTED' }).lean())),
    AccessRequestModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean()
      .then(async (latest) => mergeById(latest, await AccessRequestModel.find({ ...byFacility, status: { $in: ['REQUESTED', 'APPROVED'] } }).lean())),
    // Đợt nhập hàng của chi nhánh: 300 đợt mới nhất + mọi đợt CÒN CHỜ xác nhận (hàng chờ không được sót) + mọi đợt đã xác nhận của hợp đồng
    // còn mở (danh sách "đồ đang gửi" đầy đủ). Vận hành: cả chuỗi, cùng giới hạn.
    IntakeBatchModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean()
      .then(async (latest) => mergeById(latest, await IntakeBatchModel.find({ ...byFacility, status: 'DECLARED' }).lean())),
    PolicyModel.find(scoped ? { $or: [{ scope: 'GLOBAL' }, { facilityId: { $in: me.facilityIds } }] } : {}).lean(),
    me.role === 'FACILITY_MANAGER' ? AuditLogModel.find(byFacility).sort({ at: -1 }).limit(100).lean() : Promise.resolve([]),
  ]);

  // leftoverHeldUntil: ô đang giữ đồ khách để lại đến ngày nào — ô đó không mở cho thuê / hoàn tất bảo trì tay được (LEFTOVER_HELD).
  const units = await withLeftoverHeld(rawUnits);
  // Tài khoản nhận tiền chỉ gửi cho người XÁC NHẬN chuyển khoản (quản lý chi nhánh, vận hành) và chỉ của khách đang có khoản chờ
  // chuyển — nhân viên quầy không cần, vận hành không cần tài khoản của mọi khách trong chuỗi (Chính sách bảo mật: tối thiểu hoá).
  const payoutOwners = new Set(payments.filter((p) => p.direction === 'REFUND' && p.method === 'BANK_TRANSFER' && p.status === 'PENDING').map((p) => String(p.customerId)));
  const keepPayout = <U extends { _id: unknown; customerProfile?: { payoutAccount?: unknown } | null }>(list: U[]) => list.map((u) => (
    me.role !== 'STAFF' && payoutOwners.has(String(u._id)) || !u.customerProfile?.payoutAccount
      ? u
      : { ...u, customerProfile: { ...u.customerProfile, payoutAccount: null } }
  ));
  const users = keepPayout(scoped
    ? await UserModel.find({
      $or: [
        { facilityIds: { $in: me.facilityIds } }, // colleagues
        { _id: { $in: ids([...reservations.map((r) => r.customerId), ...contracts.map((c) => c.customerId), ...tickets.map((t) => t.reporterId)]) } },
      ],
    }, { ...PUBLIC_USER, phone: 1, 'customerProfile.idType': 1, ...(staff ? {} : { 'customerProfile.idNumberLast4': 1 }), 'customerProfile.payoutAccount': 1 }).lean()
    : await UserModel.find({}, { ...PUBLIC_USER, email: 1, authorization: 1, 'customerProfile.payoutAccount': 1 }).lean());

  // Đồ đang gửi của các hợp đồng còn mở: kèm mọi đợt CONFIRMED của chúng dù cũ hơn 300 đợt mới nhất.
  const openIds = contracts.filter((c) => ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT', 'MOVE_OUT_PENDING'].includes(c.status)).map((c) => c._id);
  const allIntake = mergeById(intakeBatches, openIds.length ? await IntakeBatchModel.find({ contractId: { $in: openIds }, status: 'CONFIRMED', _id: { $nin: intakeBatches.map((b) => b._id) } }).lean() : []);

  res.json({ me: selfView(me), users, facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, intakeBatches: await withItemStock(allIntake), policies: policies.map(withPolicyDefaults), audit });
});
