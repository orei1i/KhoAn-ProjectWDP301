import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { InvalidTransitionError } from '@ssm/shared';
import { env } from '../config/env';
import { fieldLabel, summarizeFieldErrors } from './field-labels';

export class AppError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export const BadRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const Unauthorized = (msg = 'Chưa đăng nhập hoặc phiên đã hết hạn') => new AppError(401, 'UNAUTHENTICATED', msg);
export const Forbidden = (msg = 'Không có quyền thực hiện thao tác này', code = 'FORBIDDEN') => new AppError(403, code, msg);
export const NotFound = (what: string) => new AppError(404, 'NOT_FOUND', `Không tìm thấy ${what}`);
export const Conflict = (msg: string, code = 'CONFLICT') => new AppError(409, code, msg);
export const Unprocessable = (msg: string, code = 'BUSINESS_RULE') => new AppError(422, code, msg);

/** Thông báo tiếng Việt cho lỗi validate của Mongoose (mặc định tiếng Anh: "Path `name` is required."). */
function mongooseMessage(e: { kind?: string; message: string; properties?: object }): string {
  const p = (e.properties ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'required': return 'Bắt buộc nhập';
    case 'minlength': return `Phải có ít nhất ${p.minlength} ký tự`;
    case 'maxlength': return `Tối đa ${p.maxlength} ký tự`;
    case 'min': return `Phải từ ${p.min} trở lên`;
    case 'max': return `Phải từ ${p.max} trở xuống`;
    case 'enum': return 'Giá trị không hợp lệ';
    case 'regexp': return 'Sai định dạng';
    default: return e.message;
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: { code: string; message: string; details?: unknown } = { code: 'INTERNAL', message: 'Lỗi hệ thống' };

  if (err instanceof AppError) {
    status = err.status; body = { code: err.code, message: err.message, details: err.details };
  } else if (err instanceof InvalidTransitionError) {
    status = 409; body = { code: err.code, message: err.message, details: { entity: err.entity, from: err.from, to: err.to } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = { code: 'VALIDATION', message: `Dữ liệu không hợp lệ — ${summarizeFieldErrors(err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))}`, details: err.flatten() };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    body = {
      code: 'VALIDATION',
      message: `Dữ liệu không hợp lệ — ${summarizeFieldErrors(Object.entries(err.errors).map(([k, v]) => ({ path: k, message: mongooseMessage(v) })))}`,
      details: Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message])),
    };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400; body = { code: 'BAD_ID', message: `Giá trị không hợp lệ cho ${err.path}` };
  } else if (err instanceof mongoose.Error.StrictModeError) {
    status = 400; body = { code: 'UNKNOWN_FIELD', message: err.message };
  } else if (typeof err === 'object' && err && 'code' in err && (err as { code: unknown }).code === 11000) {
    const kv = ((err as { keyValue?: Record<string, unknown> }).keyValue) ?? {};
    const [key, value] = Object.entries(kv).find(([k]) => !['facilityId', 'isDeleted'].includes(k)) ?? [];
    status = 409; body = { code: 'DUPLICATE', message: key ? `${fieldLabel(key)} "${String(value)}" đã tồn tại` : 'Dữ liệu bị trùng', details: kv };
  }

  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (status >= 500 && !env.isProd) body.details = String(err?.stack ?? err);
  res.status(status).json({ error: body });
};
