import { Router } from 'express';
import { z } from 'zod';
import { enumValues, Role, STAFF_SHIFTS, UserStatus, type CheckInShift } from '@ssm/shared';
import { FacilityModel, UserModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { idParams, paging, validate, zDate, zId, zPersonName } from '../../shared/http/validate';
import { Unprocessable } from '../../shared/core/errors';
import { createStaffUser, updateUser } from './user.service';
import { anonymizeCustomer } from '../privacy/privacy.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);

// ---------------------------------------------------------------- users & RBAC (ADMIN)
export const usersRouter = Router();
usersRouter.use(authenticate, authorize('ADMIN'));

usersRouter.get('/', validate({ query: paging.extend({ role: e(Role).optional(), q: z.string().max(100).optional() }) }), async (req, res) => {
  const { page, limit, role, q } = req.valid.query;
  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (q) filter.$or = [{ fullName: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
  const [items, total] = await Promise.all([UserModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), UserModel.countDocuments(filter)]);
  res.json({ items, total, page, limit });
});

const scopedRoles = (r: string) => r === 'STAFF' || r === 'FACILITY_MANAGER';
const shiftBody = z.enum(STAFF_SHIFTS as [CheckInShift, ...CheckInShift[]]);
/** Giấy uỷ quyền của Quản lý chi nhánh (số, ngày ký) — không được là ngày tương lai. */
const authorizationBody = z.object({
  number: z.string().trim().min(3).max(60).describe('VD 01/2026/UQ-KHOAN'),
  issuedOn: zDate.refine((d) => new Date(d) <= new Date(), 'Ngày uỷ quyền không được ở tương lai'),
});
usersRouter.post('/', validate({ body: z.object({
  fullName: zPersonName, email: z.string().email(), role: e(Role), facilityIds: z.array(zId).default([]), status: e(UserStatus).default('ACTIVE'),
  shift: shiftBody.optional(), authorization: authorizationBody.nullable().optional(),
}) }), async (req, res) => {
  const b = req.valid.body;
  if (b.authorization && b.role !== 'FACILITY_MANAGER') throw Unprocessable('Chỉ Quản lý chi nhánh có giấy uỷ quyền ký hợp đồng');
  if (scopedRoles(b.role) && b.facilityIds.length === 0) throw Unprocessable('Vai trò này phải được gán ít nhất 1 chi nhánh');
  if (b.role === 'FACILITY_MANAGER' && b.facilityIds.length !== 1) throw Unprocessable('Quản lý chi nhánh chỉ phụ trách đúng 1 chi nhánh');
  if (b.role === 'STAFF' && !b.shift) throw Unprocessable('Nhân viên phải được gán một ca làm việc cố định');
  if (b.facilityIds.length && (await FacilityModel.countDocuments({ _id: { $in: b.facilityIds } })) !== b.facilityIds.length) throw Unprocessable('Chi nhánh không tồn tại');
  res.status(201).json(await createStaffUser({ ...b, facilityIds: scopedRoles(b.role) ? b.facilityIds : [] }));
});

usersRouter.patch('/:id', validate({ params: idParams, body: z.object({
  fullName: zPersonName.optional(), role: e(Role).optional(), facilityIds: z.array(zId).optional(), status: e(UserStatus).optional(),
  shift: shiftBody.nullable().optional(), authorization: authorizationBody.nullable().optional(),
}) }), async (req, res) => {
  const b = req.valid.body;
  // Model cũng chặn, nhưng báo ở đây thì thông báo dễ hiểu hơn lỗi validation của Mongoose.
  if (b.role === 'FACILITY_MANAGER' && b.facilityIds && b.facilityIds.length !== 1) throw Unprocessable('Quản lý chi nhánh chỉ phụ trách đúng 1 chi nhánh');
  if (b.role === 'STAFF' && b.shift === null) throw Unprocessable('Nhân viên phải được gán một ca làm việc cố định');
  res.json(await updateUser(req.auth!.user, req.valid.params.id, b));
});

/** Xoá dữ liệu cá nhân (ẩn danh hoá) theo yêu cầu của khách — giữ chứng từ tài chính, nhật ký. `requestId`: yêu cầu DELETION được đóng luôn. */
usersRouter.post('/:id/anonymize', validate({ params: idParams, body: z.object({ reason: z.string().trim().min(5).max(500), requestId: zId.optional() }) }), async (req, res) => {
  res.json({ user: await anonymizeCustomer(req.auth!.user, req.valid.params.id, req.valid.body) });
});
