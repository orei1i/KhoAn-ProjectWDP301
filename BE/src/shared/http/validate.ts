import type { RequestHandler } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { ID_LAST4_MESSAGE, ID_LAST4_RE, ID_TYPES, PERSON_NAME_MESSAGE, PROFILE_PHONE_MESSAGE, isValidPersonName, isValidProfilePhone, normalizeIdLast4, normalizePersonName, normalizePhone } from '@ssm/shared';
import type { RouteSchemas } from './tags';
import { SCHEMAS_TAG, tag } from './tags';
import './zod-vi'; // thông báo lỗi zod mặc định bằng tiếng Việt

/** Zod schema gắn ở đây vừa để kiểm tra dữ liệu, vừa là nguồn sinh OpenAPI (xem modules/openapi.ts). */
export const validate = (s: RouteSchemas): RequestHandler => tag<RequestHandler>((req, _res, next) => {
  if (s.params) req.valid.params = s.params.parse(req.params);
  if (s.query) req.valid.query = s.query.parse(req.query);
  if (s.body) req.valid.body = s.body.parse(req.body ?? {});
  next();
}, SCHEMAS_TAG, s);

export const zId = z.string().refine((v) => Types.ObjectId.isValid(v), 'ObjectId không hợp lệ').describe('ObjectId (24 ký tự hex)');
export const idParams = z.object({ id: zId });
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Ngày dạng YYYY-MM-DD').describe('YYYY-MM-DD');
export const zMoney = z.number().int().min(0).describe('Số nguyên VND');
/** Họ tên người thật (xem isValidPersonName) — trả về bản đã chuẩn hoá. */
export const zPersonName = z.string().max(120).refine(isValidPersonName, PERSON_NAME_MESSAGE).transform(normalizePersonName).describe('Họ tên: chữ cái, khoảng trắng, \' . - (≥ 2 chữ cái)');
/** Số điện thoại của hồ sơ — nhận "0901 234 567", lưu dạng gọn "0901234567". */
export const zProfilePhone = z.string().max(30).refine(isValidProfilePhone, PROFILE_PHONE_MESSAGE).transform(normalizePhone).describe('Số điện thoại 9–15 chữ số');
/** Loại giấy tờ tùy thân + 4 ký tự cuối (không bao giờ nhận số đầy đủ). */
export const zIdType = z.enum(ID_TYPES);
export const zIdLast4 = z.string().trim().refine((v) => ID_LAST4_RE.test(v), ID_LAST4_MESSAGE).transform(normalizeIdLast4).describe('4 ký tự cuối số giấy tờ');
/** Tài khoản nhận tiền hoàn: tên ngân hàng, số tài khoản (6–20 chữ số), chủ tài khoản. */
export const zPayoutAccount = z.object({
  bankName: z.string().trim().min(2).max(80), accountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Số tài khoản gồm 6–20 chữ số'),
  accountName: z.string().trim().min(2).max(100).transform((v) => v.toUpperCase()),
});
export const paging = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) });
