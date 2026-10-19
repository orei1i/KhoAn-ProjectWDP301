import type { Types } from 'mongoose';
import { assertTransition, type Actor, type StateMachine } from '@ssm/shared';

export interface TransitionCtx { actor: Actor; by?: Types.ObjectId | string | null; reason?: string }

interface Transitionable<S extends string> {
  status: S;
  statusHistory?: { from: S | null; to: S; at: Date; by?: Types.ObjectId | null; reason?: string }[];
}

export function applyTransition<S extends string>(entity: string, doc: Transitionable<S>, m: StateMachine<S>, to: NoInfer<S>, ctx: TransitionCtx) {
  assertTransition(entity, m, doc.status, to, ctx.actor);
  doc.statusHistory?.push({ from: doc.status, to, at: new Date(), by: (ctx.by ?? null) as Types.ObjectId | null, reason: ctx.reason });
  doc.status = to;
}
