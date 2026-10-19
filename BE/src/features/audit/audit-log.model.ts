import { Schema, model } from 'mongoose';
import { AuditResult, enumValues, Role, type AuditLog } from '@ssm/shared';
import { enumOf, refOpt, type OID } from '../../shared/db/schema-kit';
import { appendOnlyPlugin } from '../../shared/db/plugins';

export type AuditLogDoc = AuditLog<OID, Date>;

const schema = new Schema<AuditLogDoc>({
  at: { type: Date, required: true, default: Date.now },
  actorId: refOpt('User'),
  actorRole: { type: String, enum: [...enumValues(Role), 'SYSTEM', 'ANONYMOUS'], default: 'ANONYMOUS' },
  action: { type: String, required: true, maxlength: 100 },
  entityType: { type: String, default: null },
  entityId: { type: Schema.Types.ObjectId, default: null },
  facilityId: refOpt('Facility'),
  result: enumOf(enumValues(AuditResult)),
  changes: { type: Schema.Types.Mixed, default: null },
  reason: { type: String, default: null, maxlength: 1000 },
  requestId: String, ip: String, userAgent: String,
}, { collection: 'auditLogs', strict: 'throw', timestamps: false, versionKey: false });

schema.plugin(appendOnlyPlugin, { allowUpdates: false });

schema.index({ facilityId: 1, at: -1 });
schema.index({ entityType: 1, entityId: 1, at: -1 });
schema.index({ actorId: 1, at: -1 });
schema.index({ action: 1, result: 1, at: -1 });
schema.index({ at: -1 });

export const AuditLogModel = model<AuditLogDoc>('AuditLog', schema);
