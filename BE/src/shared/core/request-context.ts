import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@ssm/shared';

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  role?: Role | 'SYSTEM';
  facilityIds?: string[];
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const currentActorId = () => requestContext.getStore()?.userId;

/** Run background work (jobs, seed) with a SYSTEM actor so audit + actor stamps are consistent. */
export const runAsSystem = <T>(fn: () => Promise<T>) =>
  requestContext.run({ requestId: `sys_${Date.now().toString(36)}`, role: 'SYSTEM' }, fn);
