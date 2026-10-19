import type { ClientSession, Types } from 'mongoose';
import { cloneDefaultClauses, validateContractTemplate, type ContractTemplateClause } from '@ssm/shared';
import { FacilityModel } from '../../shared/db/models';
import { ContractTemplateModel } from './contract-template.model';
import { AppError, NotFound, Unprocessable } from '../../shared/core/errors';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';

export interface EffectiveTemplate { version: number; scope: 'GLOBAL' | 'FACILITY' | 'DEFAULT'; clauses: ContractTemplateClause[]; _id: Types.ObjectId | null }

/**
 * Mẫu đang áp dụng cho một chi nhánh: mẫu riêng của chi nhánh → mẫu toàn chuỗi → mẫu mặc định của hệ thống (version 0).
 * Chưa ai phát hành mẫu nào thì mọi thứ chạy y như trước (không cần seed).
 */
export async function effectiveTemplate(facilityId: Types.ObjectId | string | null, session?: ClientSession | null): Promise<EffectiveTemplate> {
  const own = facilityId ? await ContractTemplateModel.findOne({ scope: 'FACILITY', facilityId, isActive: true }).session(session ?? null).lean() : null;
  const t = own ?? (await ContractTemplateModel.findOne({ scope: 'GLOBAL', isActive: true }).session(session ?? null).lean());
  if (!t) return { version: 0, scope: 'DEFAULT', clauses: cloneDefaultClauses(), _id: null };
  return { version: t.version, scope: t.scope, clauses: t.clauses, _id: t._id };
}

/** Phát hành phiên bản mới (toàn chuỗi khi `facilityId` null). Mẫu bất biến: bản đang dùng chuyển sang không dùng, không sửa tại chỗ. */
export async function publishTemplate(facilityId: string | null, input: { clauses: ContractTemplateClause[]; note?: string }) {
  const errors = validateContractTemplate(input.clauses);
  if (errors.length) throw new AppError(422, 'TEMPLATE_INVALID', `Mẫu hợp đồng chưa hợp lệ: ${errors[0]}`, { errors });
  return withTxn(async (session) => {
    const scope = facilityId ? 'FACILITY' : 'GLOBAL';
    if (facilityId && !(await FacilityModel.exists({ _id: facilityId }).session(session))) throw NotFound('chi nhánh');
    const filter = { scope, facilityId: facilityId ?? null };
    const last = await ContractTemplateModel.findOne(filter).sort({ version: -1 }).session(session);
    await ContractTemplateModel.updateMany({ ...filter, isActive: true }, { $set: { isActive: false } }, { session });
    const [t] = await ContractTemplateModel.create([{
      ...filter, version: (last?.version ?? 0) + 1, isActive: true, note: input.note?.trim() || null, effectiveFrom: new Date(),
      clauses: input.clauses.map((c) => ({ key: c.key, title: c.title.trim(), numbered: c.numbered, paragraphs: c.paragraphs.map((x) => x.trim()), bullets: c.bullets.map((x) => x.trim()) })),
    }], { session });
    await audit({ action: 'contract_template.publish', entityType: 'ContractTemplate', entityId: t._id, facilityId, reason: t.note ?? undefined, changes: { before: { version: last?.version ?? 0 }, after: { version: t.version, scope } } }, session);
    return t;
  });
}

/** Chi nhánh bỏ mẫu riêng, quay về dùng mẫu toàn chuỗi. */
export async function retireFacilityTemplate(facilityId: string) {
  return withTxn(async (session) => {
    const r = await ContractTemplateModel.updateMany({ scope: 'FACILITY', facilityId, isActive: true }, { $set: { isActive: false } }, { session });
    if (r.modifiedCount === 0) throw Unprocessable('Chi nhánh này đang không dùng mẫu riêng');
    await audit({ action: 'contract_template.retire', entityType: 'ContractTemplate', entityId: facilityId, facilityId }, session);
    return { retired: r.modifiedCount };
  });
}

export async function listTemplates(facilityId: string | null) {
  return ContractTemplateModel.find(facilityId ? { scope: 'FACILITY', facilityId } : { scope: 'GLOBAL' }).sort({ version: -1 }).limit(50).lean();
}
