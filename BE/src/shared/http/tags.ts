import type { ZodTypeAny } from 'zod';

/**
 * Nhãn gắn lên chính hàm middleware để sinh OpenAPI từ code thật.
 * Dùng Symbol.for để không đụng key nào của Express, và enumerable:false để không lộ khi log.
 */
export const SCHEMAS_TAG = Symbol.for('ssm.route.schemas');
export const ROLES_TAG = Symbol.for('ssm.route.roles');

export interface RouteSchemas { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }

export const tag = <T extends object>(fn: T, key: symbol, value: unknown): T => {
  Object.defineProperty(fn, key, { value, enumerable: false, configurable: true });
  return fn;
};

export const readTag = <T>(fn: unknown, key: symbol): T | undefined =>
  typeof fn === 'function' ? ((fn as unknown as Record<symbol, unknown>)[key] as T | undefined) : undefined;
