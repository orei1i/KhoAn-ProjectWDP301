import { Schema, model, type Model } from 'mongoose';
import { enumValues, TICKET_MACHINE, TicketCategory, TicketKind, TicketPriority, TicketStatus, type SupportTicket } from '@ssm/shared';
import { baseOptions, enumOf, humanCode, maxLen, refOpt, refReq, statusHistorySchema, subOptions, type OID } from '../../shared/db/schema-kit';
import { actorStampPlugin, softDeletePlugin } from '../../shared/db/plugins';
import { applyTransition, type TransitionCtx } from '../../shared/db/apply-transition';

export type TicketDoc = SupportTicket<OID, Date>;
interface Methods { transitionTo(to: TicketStatus, ctx: TransitionCtx): void; softDelete(by?: string): Promise<unknown> }
export type TicketModelType = Model<TicketDoc, {}, Methods>;

const schema = new Schema<TicketDoc, TicketModelType, Methods>({
  ticketNumber: { type: String, required: true, immutable: true },
  kind: { ...enumOf(enumValues(TicketKind)), immutable: true },
  facilityId: { ...refReq('Facility'), immutable: true },
  reporterId: { ...refReq('User'), immutable: true },
  contractId: refOpt('RentalContract'),
  unitId: refOpt('StorageUnit'),
  category: enumOf(enumValues(TicketCategory)),
  priority: enumOf(enumValues(TicketPriority), 'MEDIUM'),
  status: enumOf(enumValues(TicketStatus), 'OPEN'),
  subject: { type: String, required: true, trim: true, minlength: 5, maxlength: 200 },
  description: { type: String, default: '', maxlength: 5000 },
  attachmentUrls: { type: [String], default: [], validate: maxLen(20) },
  assigneeId: refOpt('User'),
  dueAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  messages: {
    type: [new Schema({
      authorId: refReq('User'), body: { type: String, required: true, maxlength: 5000 },
      internal: { type: Boolean, default: false },
      at: { type: Date, default: Date.now },
    }, subOptions)],
    default: [], validate: maxLen(200),
  },
  statusHistory: { type: [statusHistorySchema(enumValues(TicketStatus))], default: [], validate: maxLen(50) },
}, { ...baseOptions, collection: 'supportTickets' });

schema.plugin(actorStampPlugin);
schema.plugin(softDeletePlugin);

schema.method('transitionTo', function (to: TicketStatus, ctx: TransitionCtx) {
  applyTransition('SupportTicket', this, TICKET_MACHINE, to, ctx);
  if (to === 'RESOLVED') this.resolvedAt = new Date();
});

schema.pre('validate', function () {
  if (this.isNew && !this.ticketNumber) this.ticketNumber = humanCode('TKT');
  if (['ASSIGNED', 'IN_PROGRESS'].includes(this.status) && !this.assigneeId) this.invalidate('assigneeId', `required when ${this.status}`);
});

schema.index({ ticketNumber: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, dueAt: 1 });
schema.index({ assigneeId: 1, status: 1, dueAt: 1 });
schema.index({ facilityId: 1, kind: 1, createdAt: -1 });
schema.index({ reporterId: 1, createdAt: -1 });

export const TicketModel = model<TicketDoc, TicketModelType>('SupportTicket', schema);
