import { Router } from 'express';
import type { Model } from 'mongoose';
import { z } from 'zod';
import { PAYMENT_TYPE, ROUTINE_AUDIT_ACTIONS, vnd, type PaymentType } from '@ssm/shared';
import {
  AccessRequestModel, AuditLogModel, ContractTemplateModel, DamageClaimModel, FacilityModel, GatewayOrderModel, InspectionModel, IntakeBatchModel, PaymentModel,
  PolicyModel, PrivacyRequestModel, RentalContractModel, ReservationModel, ServiceOfferingModel, ServiceOrderModel, StorageUnitModel, TicketModel,
  UnitSwapRequestModel, UnitTypeModel, UserModel,
} from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { paging, validate, zId } from '../../shared/http/validate';
import { scopeFilter, scopeQueryFacility } from '../../shared/http/scope';

// ---------------------------------------------------------------- audit log (ADMIN, OPS toàn chuỗi, FM chi nhánh mình)
export const auditRouter = Router();
auditRouter.use(authenticate, authorize('ADMIN', 'OPS_MANAGER', 'FACILITY_MANAGER'));

type Doc = Record<string, unknown> & { _id: unknown };
/**
 * Tên đọc được của đối tượng theo `entityType` — mã người đọc dùng hằng ngày (số hợp đồng, mã đặt chỗ, họ tên…), KHÔNG bao giờ là
 * ObjectId. Tra theo lô: mỗi loại đối tượng một truy vấn cho cả trang nhật ký.
 */
const ENTITY_LABEL: Record<string, { model: Model<any>; fields: string; label: (d: Doc) => string | null }> = {
  RentalContract: { model: RentalContractModel, fields: 'contractNumber', label: (d) => d.contractNumber as string },
  Reservation: { model: ReservationModel, fields: 'code', label: (d) => d.code as string },
  User: { model: UserModel, fields: 'fullName', label: (d) => d.fullName as string },
  DamageClaim: { model: DamageClaimModel, fields: 'claimNumber', label: (d) => d.claimNumber as string },
  IntakeBatch: { model: IntakeBatchModel, fields: 'code', label: (d) => d.code as string },
  UnitSwapRequest: { model: UnitSwapRequestModel, fields: 'requestNumber', label: (d) => d.requestNumber as string },
  ServiceOrder: { model: ServiceOrderModel, fields: 'orderNumber', label: (d) => d.orderNumber as string },
  ServiceOffering: { model: ServiceOfferingModel, fields: 'name', label: (d) => d.name as string },
  SupportTicket: { model: TicketModel, fields: 'ticketNumber', label: (d) => d.ticketNumber as string },
  AccessRequest: { model: AccessRequestModel, fields: 'requestNumber', label: (d) => d.requestNumber as string },
  PrivacyRequest: { model: PrivacyRequestModel, fields: 'requestNumber', label: (d) => d.requestNumber as string },
  GatewayOrder: { model: GatewayOrderModel, fields: 'txnRef', label: (d) => d.txnRef as string },
  StorageUnit: { model: StorageUnitModel, fields: 'unitNumber', label: (d) => d.unitNumber as string },
  UnitType: { model: UnitTypeModel, fields: 'name code', label: (d) => `${d.name as string} (${d.code as string})` },
  Facility: { model: FacilityModel, fields: 'name', label: (d) => d.name as string },
  BusinessPolicy: { model: PolicyModel, fields: 'version scope', label: (d) => `bản ${d.version as number} · ${d.scope === 'FACILITY' ? 'riêng chi nhánh' : 'toàn chuỗi'}` },
  ContractTemplate: { model: ContractTemplateModel, fields: 'version scope', label: (d) => `bản ${d.version as number} · ${d.scope === 'FACILITY' ? 'riêng chi nhánh' : 'toàn chuỗi'}` },
  PaymentTransaction: { model: PaymentModel, fields: 'type amount', label: (d) => `${PAYMENT_TYPE[d.type as PaymentType]?.label ?? 'Khoản'} ${vnd(d.amount as number)}` },
  // Biên bản: theo số hợp đồng của biên bản (tra thêm một lần).
  InspectionLog: { model: InspectionModel, fields: 'contractId', label: () => null },
};

async function entityLabels(items: { entityType?: string | null; entityId?: unknown }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byType = new Map<string, Set<string>>();
  for (const a of items) {
    if (!a.entityType || !a.entityId || !ENTITY_LABEL[a.entityType]) continue;
    if (!byType.has(a.entityType)) byType.set(a.entityType, new Set());
    byType.get(a.entityType)!.add(String(a.entityId));
  }
  await Promise.all([...byType].map(async ([type, ids]) => {
    const spec = ENTITY_LABEL[type];
    // Kể cả bản ghi đã xoá mềm — nhật ký vẫn phải gọi đúng tên đối tượng.
    const docs = await spec.model.find({ _id: { $in: [...ids] } }, spec.fields).setOptions({ withDeleted: true }).lean<Doc[]>();
    if (type === 'InspectionLog') {
      const contracts = await RentalContractModel.find({ _id: { $in: docs.map((d) => d.contractId).filter(Boolean) } }, 'contractNumber').lean<Doc[]>();
      const num = new Map(contracts.map((c) => [String(c._id), c.contractNumber as string]));
      for (const d of docs) { const n = num.get(String(d.contractId)); if (n) out.set(`${type}:${String(d._id)}`, `hợp đồng ${n}`); }
      return;
    }
    for (const d of docs) { const l = spec.label(d); if (l) out.set(`${type}:${String(d._id)}`, l); }
  }));
  return out;
}

/**
 * Nhật ký kiểm toán: Quản trị viên và Quản lý vận hành xem toàn chuỗi; Quản lý chi nhánh chỉ thấy bản ghi của chi nhánh mình (lọc theo
 * facilityId — bản ghi không gắn chi nhánh như thao tác tài khoản không hiện), `facilityId` ngoài phạm vi → 403 FACILITY_SCOPE.
 * `excludeRoutine=1`: bỏ bản ghi tự động thường lệ của hệ thống (ROUTINE_AUDIT_ACTIONS ở shared — nhắc hết hạn, dọn dữ liệu) ngay trong
 * truy vấn, nên phân trang vẫn đúng. Mỗi dòng kèm `entityLabel` (tên đọc được của đối tượng, null nếu không tra được).
 */
auditRouter.get('/', validate({ query: paging.extend({
  result: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(), action: z.string().max(60).optional(), facilityId: zId.optional(),
  excludeRoutine: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'),
}) }), scopeQueryFacility, async (req, res) => {
  const { page, limit, result, action, facilityId, excludeRoutine } = req.valid.query;
  const filter: Record<string, unknown> = { ...scopeFilter(req.auth!.user) };
  if (result) filter.result = result;
  const actionFilter: Record<string, unknown> = {};
  if (action) actionFilter.$regex = `^${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  if (excludeRoutine) actionFilter.$nin = [...ROUTINE_AUDIT_ACTIONS];
  if (Object.keys(actionFilter).length) filter.action = actionFilter;
  if (facilityId) filter.facilityId = facilityId;
  const docs = await AuditLogModel.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).populate('actorId', 'fullName email role');
  const labels = await entityLabels(docs);
  const items = docs.map((d) => ({ ...d.toJSON(), entityLabel: d.entityType && d.entityId ? labels.get(`${d.entityType}:${String(d.entityId)}`) ?? null : null }));
  res.json({ items, page, limit });
});
