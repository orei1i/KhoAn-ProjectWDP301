import { Router } from 'express';
import {
  AccessRequestModel, AuditLogModel, DamageClaimModel, FacilityModel, InspectionModel, PaymentModel, PolicyModel, RentalContractModel,
  ReservationModel, ServiceOfferingModel, ServiceOrderModel, StorageUnitModel, TicketModel, UnitSwapRequestModel, UnitTypeModel, UserModel,
} from '../../shared/db/models';
import { withPolicyDefaults } from '@ssm/shared';
import { authenticate } from '../../shared/http/authenticate';
import { isScoped } from '../../shared/http/scope';

/**
 * One scoped snapshot for the web dashboard. Every query below is filtered by what the caller may see:
 *   CUSTOMER → own records · STAFF/FM → their facilities · OPS → everything operational · ADMIN → users + audit.
 * Mutations never go through here — they use the dedicated endpoints, which re-check rules server-side.
 */
export const bootstrapRouter = Router();

// Bỏ cả nguyên văn hợp đồng đã ký (nặng) — client đọc qua GET /reservations/:id/contract khi cần.
const NO_QR_HASH = { 'checkIn.qrTokenHash': 0, 'signature.clauses': 0 } as const;
const PUBLIC_USER = { fullName: 1, role: 1, facilityIds: 1, status: 1 } as const;
const ids = (xs: unknown[]) => [...new Set(xs.filter(Boolean).map(String))];

bootstrapRouter.get('/', authenticate, async (req, res) => {
  const me = req.auth!.user;
  const empty = { users: [], facilities: [], unitTypes: [], units: [], reservations: [], contracts: [], payments: [], inspections: [], tickets: [], claims: [], swapRequests: [], services: [], serviceOrders: [], accessRequests: [], policies: [], audit: [] };

  if (me.role === 'CUSTOMER') {
    const [facilities, unitTypes, reservations, contracts, payments, rawTickets, claims, swapRequests, services, serviceOrders, accessRequests] = await Promise.all([
      FacilityModel.find({}).lean(),
      UnitTypeModel.find({}).lean(),
      ReservationModel.find({ customerId: me._id }, NO_QR_HASH).sort({ createdAt: -1 }).lean(),
      RentalContractModel.find({ customerId: me._id }).lean(),
      PaymentModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      TicketModel.find({ reporterId: me._id }).lean(),
      DamageClaimModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      UnitSwapRequestModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      ServiceOfferingModel.find({ isActive: true }).lean(),
      ServiceOrderModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
      AccessRequestModel.find({ customerId: me._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const tickets = rawTickets.map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) }));
    const unitIds = ids([...reservations.map((r) => r.unitId), ...contracts.map((c) => c.unitId), ...swapRequests.flatMap((s) => [s.fromUnitId, s.toUnitId])]);
    const policyIds = ids([...reservations.map((r) => r.quote.policyId), ...contracts.map((c) => c.terms.policyId)]);
    const staffIds = ids(tickets.flatMap((t) => [t.assigneeId, ...t.messages.map((m) => m.authorId)])).filter((i) => i !== String(me._id));
    const [units, inspections, policies, others] = await Promise.all([
      StorageUnitModel.find({ _id: { $in: unitIds } }).lean(),
      InspectionModel.find({ contractId: { $in: contracts.map((c) => c._id) } }).lean(),
      PolicyModel.find({ $or: [{ isActive: true }, { _id: { $in: policyIds } }] }).lean(),
      UserModel.find({ _id: { $in: staffIds } }, PUBLIC_USER).lean(),
    ]);
    return res.json({ ...empty, me, users: [me, ...others], facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, policies: policies.map(withPolicyDefaults) });
  }

  if (me.role === 'ADMIN') {
    const [users, facilities, policies, audit] = await Promise.all([
      UserModel.find({}).sort({ createdAt: -1 }).lean(),
      FacilityModel.find({}).lean(),
      PolicyModel.find({ isActive: true }).lean(),
      AuditLogModel.find({}).sort({ at: -1 }).limit(500).lean(),
    ]);
    return res.json({ ...empty, me, users, facilities, policies: policies.map(withPolicyDefaults), audit });
  }

  // STAFF / FACILITY_MANAGER (scoped) and OPS_MANAGER (chain-wide)
  const scoped = isScoped(me);
  const byFacility = scoped ? { facilityId: { $in: me.facilityIds } } : {};
  const [facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, policies, audit] = await Promise.all([
    FacilityModel.find(scoped ? { _id: { $in: me.facilityIds } } : {}).lean(),
    UnitTypeModel.find(byFacility).lean(),
    StorageUnitModel.find(byFacility).lean(),
    ReservationModel.find(byFacility, NO_QR_HASH).lean(),
    RentalContractModel.find(byFacility).lean(),
    PaymentModel.find(byFacility).lean(),
    InspectionModel.find(byFacility).sort({ performedAt: -1 }).limit(300).lean(),
    TicketModel.find(byFacility).lean(),
    DamageClaimModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean(),
    UnitSwapRequestModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean(),
    ServiceOfferingModel.find(byFacility).lean(),
    ServiceOrderModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean(),
    AccessRequestModel.find(byFacility).sort({ createdAt: -1 }).limit(300).lean(),
    PolicyModel.find(scoped ? { $or: [{ scope: 'GLOBAL' }, { facilityId: { $in: me.facilityIds } }] } : {}).lean(),
    me.role === 'FACILITY_MANAGER' ? AuditLogModel.find(byFacility).sort({ at: -1 }).limit(100).lean() : Promise.resolve([]),
  ]);

  const users = scoped
    ? await UserModel.find({
      $or: [
        { facilityIds: { $in: me.facilityIds } }, // colleagues
        { _id: { $in: ids([...reservations.map((r) => r.customerId), ...contracts.map((c) => c.customerId), ...tickets.map((t) => t.reporterId)]) } },
      ],
    }, { ...PUBLIC_USER, phone: 1, 'customerProfile.idType': 1, 'customerProfile.idNumberLast4': 1, 'customerProfile.payoutAccount': 1 }).lean()
    // Vận hành xác nhận chuyển khoản hoàn / bồi thường cho cả chuỗi → cần tài khoản nhận tiền khách đã khai.
    : await UserModel.find({}, { ...PUBLIC_USER, email: 1, phone: 1, authorization: 1, 'customerProfile.payoutAccount': 1 }).lean();

  res.json({ me, users, facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, policies: policies.map(withPolicyDefaults), audit });
});
