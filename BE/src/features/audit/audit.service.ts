import type { ClientSession, Types } from 'mongoose';
import type { AuditResult } from '@ssm/shared';
import { AuditLogModel } from '../../shared/db/models';
import { requestContext } from '../../shared/core/request-context';

type Id = Types.ObjectId | string | null | undefined;
export interface AuditEntry {
  action: string;
  result?: AuditResult;
  entityType?: string;
  entityId?: Id;
  facilityId?: Id;
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  reason?: string | null;
}

/** Append-only audit record. Pass the transaction session so the log commits (or rolls back) with the change. */
export async function audit(e: AuditEntry, session?: ClientSession) {
  const ctx = requestContext.getStore();
  await AuditLogModel.create([{
    at: new Date(),
    actorId: ctx?.userId ?? null,
    actorRole: ctx?.role ?? 'ANONYMOUS',
    requestId: ctx?.requestId, ip: ctx?.ip, userAgent: ctx?.userAgent,
    result: e.result ?? 'SUCCESS',
    action: e.action, entityType: e.entityType ?? null, entityId: e.entityId ?? null, facilityId: e.facilityId ?? null,
    changes: e.changes ?? null, reason: e.reason ?? null,
  }], { session });
}

/** Denied attempts are logged outside any transaction so they survive the rollback. Never throws. */
export async function auditDenied(action: string, reason: string, facilityId?: Id) {
  try { await audit({ action, result: 'DENIED', reason, facilityId }); } catch (err) { console.error('audit failed', err); }
}
