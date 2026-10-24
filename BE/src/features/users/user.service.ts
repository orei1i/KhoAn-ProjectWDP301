import { isValidPersonName, normalizePersonName, normalizePhone, OPEN_CONTRACT_STATUSES, profileGaps, type CheckInShift, type IdType, type Role, type UserStatus } from '@ssm/shared';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ClientSession } from 'mongoose';
import { firebaseAuth } from '../../shared/config/firebase';
import { RentalContractModel, ReservationModel, TicketModel, UnitSwapRequestModel, UserModel, type UserHydrated } from '../../shared/db/models';
import { withTxn } from '../../shared/db/txn';
import { assertFacility } from '../../shared/http/scope';
import { AppError, Conflict, NotFound, Unprocessable } from '../../shared/core/errors';
import { audit } from '../audit/audit.service';

/**
 * Called by web/mobile right after Firebase sign-in (email/password or Google).
 * 1) profile already linked → return it
 * 2) profile pre-created by admin/seed with the same *verified* email → link uid
 * 3) otherwise → self-signup as CUSTOMER
 */
export async function syncProfile(token: DecodedIdToken, input: {
  fullName?: string; phone?: string;
  consent?: { termsVersion: string; privacyVersion: string; method: 'SIGNUP_FORM' | 'GOOGLE' };
}) {
  const linked = await UserModel.findOne({ firebaseUid: token.uid });
  if (linked) {
    linked.lastLoginAt = new Date();
    // email/password signups start PENDING_VERIFICATION; activate once Firebase reports the email verified
    if (linked.status === 'PENDING_VERIFICATION' && token.email_verified) linked.status = 'ACTIVE';
    await linked.save();
    return { user: linked, created: false };
  }
  const email = token.email?.toLowerCase();
  if (!email) throw Unprocessable('Tài khoản Firebase không có email');

  const existing = await UserModel.findOne({ email });
  if (existing) {
    if (existing.firebaseUid && existing.firebaseUid !== token.uid) throw Conflict('Email đã gắn với một tài khoản đăng nhập khác');
    if (!token.email_verified) throw Unprocessable('Vui lòng xác minh email trước khi liên kết tài khoản', 'EMAIL_NOT_VERIFIED');
    existing.firebaseUid = token.uid;
    existing.lastLoginAt = new Date();
    if (existing.status === 'PENDING_VERIFICATION') existing.status = 'ACTIVE';
    await existing.save();
    await audit({ action: 'auth.link', entityType: 'User', entityId: existing._id, reason: token.firebase.sign_in_provider });
    return { user: existing, created: false };
  }

  const user = await UserModel.create({
    firebaseUid: token.uid, email, fullName: initialName(input.fullName, token.name as string | undefined, email),
    // Số điện thoại đã thuộc tài khoản khác thì bỏ qua (không làm hỏng đăng ký) — khách bổ sung sau trong tài khoản.
    phone: input.phone && !(await UserModel.exists({ phone: input.phone })) ? input.phone : null, role: 'CUSTOMER', facilityIds: [],
    consent: input.consent ? { ...input.consent, acceptedAt: new Date() } : null,
    // Google accounts arrive verified; email/password signups must verify before booking
    status: token.email_verified ? 'ACTIVE' : 'PENDING_VERIFICATION', lastLoginAt: new Date(),
  });
  await audit({ action: 'auth.signup', entityType: 'User', entityId: user._id, reason: token.firebase.sign_in_provider });
  return { user, created: true };
}

/**
 * Tên lúc tự đăng ký: tên khách nhập (đã kiểm ở route) → tên tài khoản Google nếu là tên thật → tạm phần trước @ của
 * email. Trường hợp cuối, khách phải tự sửa tên (PATCH /auth/me) trước khi đặt kho / ký — xem assertRealName.
 */
function initialName(typed: string | undefined, google: string | undefined, email: string) {
  for (const n of [typed, google]) if (n && isValidPersonName(n)) return normalizePersonName(n);
  return email.split('@')[0];
}

/** Họ tên được in vào hợp đồng / phụ lục → chặn đặt kho, ký, gia hạn khi hồ sơ chưa có tên thật. */
export function assertRealName(user: UserHydrated) {
  if (!isValidPersonName(user.fullName)) {
    throw Unprocessable('Họ tên trong tài khoản chưa hợp lệ — cập nhật họ tên thật trước khi tiếp tục (tên này được in vào hợp đồng)', 'PROFILE_NAME_INVALID');
  }
}

/**
 * Đủ thông tin nhận diện để lập hợp đồng chưa (họ tên thật; với khách thêm số điện thoại + loại giấy tờ & 4 số cuối) — chặn đặt kho,
 * ký, gia hạn khi còn thiếu. Họ tên sai báo riêng mã PROFILE_NAME_INVALID cho rõ.
 */
export function assertContractProfile(user: UserHydrated) {
  assertRealName(user);
  const gaps = profileGaps(user);
  if (gaps.length) {
    throw new AppError(422, 'PROFILE_INCOMPLETE', `Bổ sung ${gaps.join(', ')} trong tài khoản trước khi tiếp tục — các thông tin này được in vào hợp đồng`, { missing: gaps });
  }
}

/** Khách đang có đặt chỗ đã ký chưa kết thúc hoặc hợp đồng đang mở — họ tên / giấy tờ đã in vào hợp đồng (xem identityLocked ở shared). */
async function hasLiveContract(customerId: unknown) {
  return !!(await ReservationModel.exists({ customerId, status: { $in: ['PENDING', 'CONFIRMED', 'ALLOCATED'] }, 'signature.signedAt': { $ne: null } })
    ?? await RentalContractModel.exists({ customerId, status: { $in: [...OPEN_CONTRACT_STATUSES] } }));
}

type PayoutAccount = { bankName: string; accountNumber: string; accountName: string };

export async function updateMyProfile(user: UserHydrated, patch: { fullName?: string; phone?: string; idType?: IdType; idNumberLast4?: string; payoutAccount?: PayoutAccount | null }) {
  // Họ tên + giấy tờ đã in vào hợp đồng đang hiệu lực và đã được đối chiếu bản gốc → khách không tự đổi; đổi tại quầy (updateCustomerIdentity).
  // Chỉ chặn ĐỔI giá trị đã có (tên hợp lệ, giấy tờ đã khai); khai lần đầu / sửa tên chưa hợp lệ thì vẫn cho để khách bổ sung đủ.
  const nameChanged = patch.fullName !== undefined && patch.fullName !== user.fullName && isValidPersonName(user.fullName);
  const idChanged = patch.idType !== undefined && !!user.customerProfile?.idNumberLast4
    && (patch.idType !== user.customerProfile.idType || patch.idNumberLast4 !== user.customerProfile.idNumberLast4);
  if (user.role === 'CUSTOMER' && (nameChanged || idChanged) && await hasLiveContract(user._id)) {
    throw Unprocessable('Bạn đang có hợp đồng — đổi họ tên / giấy tờ tại quầy chi nhánh (nhân viên đối chiếu giấy tờ bản gốc). Số điện thoại và tài khoản nhận tiền vẫn tự sửa được.', 'PROFILE_LOCKED');
  }
  if (patch.payoutAccount !== undefined) {
    if (user.role !== 'CUSTOMER') throw Unprocessable('Chỉ tài khoản khách hàng khai tài khoản nhận tiền hoàn');
    user.customerProfile = { ...(user.customerProfile ?? {}), payoutAccount: patch.payoutAccount } as typeof user.customerProfile;
  }
  const before = { fullName: user.fullName, phone: user.phone ?? null, idType: user.customerProfile?.idType ?? null, idNumberLast4: user.customerProfile?.idNumberLast4 ?? null };
  if (patch.fullName !== undefined) user.fullName = patch.fullName;
  if (patch.phone !== undefined && patch.phone !== user.phone) {
    if (await UserModel.exists({ phone: patch.phone, _id: { $ne: user._id } })) throw Conflict('Số điện thoại này đã gắn với một tài khoản khác', 'PHONE_TAKEN');
    user.phone = patch.phone;
  }
  if (patch.idType !== undefined) {
    if (user.role !== 'CUSTOMER') throw Unprocessable('Chỉ tài khoản khách hàng khai giấy tờ tùy thân');
    user.customerProfile = { ...(user.customerProfile ?? {}), idType: patch.idType, idNumberLast4: patch.idNumberLast4 } as typeof user.customerProfile;
  }
  await user.save();
  const after = { fullName: user.fullName, phone: user.phone ?? null, idType: user.customerProfile?.idType ?? null, idNumberLast4: user.customerProfile?.idNumberLast4 ?? null };
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => after[k] !== before[k]);
  if (changed.length) {
    await audit({ action: 'user.profile_update', entityType: 'User', entityId: user._id, changes: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])) } });
  }
  return user;
}

/**
 * Nhân viên / quản lý SỬA HỌ TÊN, GIẤY TỜ của khách tại quầy sau khi đối chiếu giấy tờ bản gốc (khách đang có hợp đồng nên không tự sửa
 * được). Chỉ với khách có đặt chỗ / hợp đồng ở chi nhánh trong phạm vi của nhân viên. Bắt buộc lý do; ghi nhật ký. Hợp đồng đã ký
 * giữ nguyên văn lúc ký — tên mới áp dụng cho phụ lục / văn bản về sau.
 */
export async function updateCustomerIdentity(staff: UserHydrated, facilityId: unknown, customerId: unknown, input: { fullName?: string; idType?: IdType; idNumberLast4?: string; reason: string }) {
  await assertFacility(staff, facilityId as string, 'user.identity_update');
  const u = await UserModel.findById(customerId);
  if (!u || u.role !== 'CUSTOMER') throw NotFound('khách hàng');
  const before = { fullName: u.fullName, idType: u.customerProfile?.idType ?? null, idNumberLast4: u.customerProfile?.idNumberLast4 ?? null };
  if (input.fullName !== undefined) u.fullName = input.fullName;
  if (input.idType !== undefined) u.customerProfile = { ...(u.customerProfile ?? {}), idType: input.idType, idNumberLast4: input.idNumberLast4 } as typeof u.customerProfile;
  await u.save();
  const after = { fullName: u.fullName, idType: u.customerProfile?.idType ?? null, idNumberLast4: u.customerProfile?.idNumberLast4 ?? null };
  await audit({ action: 'user.identity_update', entityType: 'User', entityId: u._id, facilityId: facilityId as never, reason: input.reason, changes: { before, after } });
  return u;
}

/** Tra đúng một khách (CUSTOMER, chưa xoá) theo email (không phân biệt hoa thường) hoặc số điện thoại — khớp chính xác, cho đặt tại quầy. */
export async function lookupCustomer(q: string) {
  const s = q.trim();
  const filter = s.includes('@') ? { email: s.toLowerCase() } : { phone: normalizePhone(s) };
  const u = await UserModel.findOne({ ...filter, role: 'CUSTOMER' }, { fullName: 1, email: 1, phone: 1, status: 1, 'customerProfile.idType': 1, 'customerProfile.idNumberLast4': 1 }).lean();
  if (!u) return null;
  return {
    _id: u._id, fullName: u.fullName, email: u.email, phone: u.phone ?? null, status: u.status,
    idType: u.customerProfile?.idType ?? null, idNumberLast4: u.customerProfile?.idNumberLast4 ?? null,
  };
}

type Authorization = { number: string; issuedOn: string } | null;

export async function createStaffUser(input: { fullName: string; email: string; role: Role; facilityIds: string[]; status: UserStatus; shift?: CheckInShift | null; authorization?: Authorization }) {
  const email = input.email.toLowerCase();
  if (await UserModel.exists({ email })) throw Conflict('Email đã tồn tại');
  const fb = await firebaseAuth.getUserByEmail(email).catch(() => null)
    ?? await firebaseAuth.createUser({ email, displayName: input.fullName, emailVerified: false, disabled: input.status === 'SUSPENDED' });
  const user = await UserModel.create({
    firebaseUid: fb.uid, email, fullName: input.fullName, role: input.role, facilityIds: input.facilityIds, status: input.status,
    shift: input.role === 'STAFF' ? (input.shift ?? null) : null,
    authorization: input.role === 'FACILITY_MANAGER' && input.authorization ? { number: input.authorization.number, issuedOn: new Date(input.authorization.issuedOn) } : null,
  });
  const resetLink = await firebaseAuth.generatePasswordResetLink(email).catch(() => null);
  await audit({ action: 'user.create', entityType: 'User', entityId: user._id, changes: { after: { role: input.role, facilityIds: input.facilityIds } } });
  return { user, resetLink }; // send resetLink by email in production; returned here for the admin UI
}

export interface ReleasedAssignments { tickets: number; swaps: number }

/**
 * Nhân sự bị khoá / chưa kích hoạt, chuyển chi nhánh hoặc đổi vai trò → gỡ phân công các việc đang treo mà người đó KHÔNG CÒN được
 * nhận (cùng điều kiện với assertAssignee bên tickets và loadMover bên swaps), để việc không kẹt ở người đã đi:
 *  - phiếu hỗ trợ ASSIGNED / IN_PROGRESS → về hàng chờ OPEN, bỏ người phụ trách (SYSTEM, xem TICKET_MACHINE);
 *  - yêu cầu đổi ô "Thuê người chuyển" đã duyệt → bỏ người chuyển, quản lý chi nhánh giao lại (assignSwapMover).
 * Việc ở chi nhánh người đó vẫn đủ điều kiện nhận (vd nhân viên lên quản lý cùng chi nhánh vẫn giữ phiếu) thì giữ nguyên.
 * Gọi TRONG transaction của updateUser — mỗi việc gỡ có một dòng nhật ký riêng.
 */
async function releaseAssignments(u: UserHydrated, admin: UserHydrated, session: ClientSession): Promise<ReleasedAssignments> {
  const stillAt = (roles: Role[]) => (u.status === 'ACTIVE' && roles.includes(u.role) ? u.facilityIds : []);
  const reason = u.status !== 'ACTIVE' ? 'Người phụ trách bị khoá / ngừng hoạt động' : 'Người phụ trách đổi vai trò hoặc chuyển chi nhánh';

  const tickets = await TicketModel.find({ assigneeId: u._id, status: { $in: ['ASSIGNED', 'IN_PROGRESS'] }, facilityId: { $nin: stillAt(['STAFF', 'FACILITY_MANAGER']) } }).session(session);
  for (const t of tickets) {
    const from = t.status;
    t.set('assigneeId', null);
    t.transitionTo('OPEN', { actor: 'SYSTEM', by: admin._id, reason });
    await t.save({ session });
    await audit({ action: 'ticket.unassign', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId, reason, changes: { before: { status: from, assigneeId: String(u._id) }, after: { status: 'OPEN', assigneeId: null } } }, session);
  }

  const swaps = await UnitSwapRequestModel.find({ assignedStaffId: u._id, status: 'APPROVED', method: 'DELIVERY', facilityId: { $nin: stillAt(['STAFF']) } }).session(session);
  for (const s of swaps) {
    const before = { mover: s.assignedStaffName, assignedStaffId: String(u._id) };
    s.assignedStaffId = null;
    s.assignedStaffName = null;
    await s.save({ session });
    await audit({ action: 'swap_request.unassign', entityType: 'UnitSwapRequest', entityId: s._id, facilityId: s.facilityId, reason, changes: { before, after: { mover: null, assignedStaffId: null } } }, session);
  }
  return { tickets: tickets.length, swaps: swaps.length };
}

export async function updateUser(admin: UserHydrated, id: string, patch: { fullName?: string; role?: Role; facilityIds?: string[]; status?: UserStatus; shift?: CheckInShift | null; authorization?: Authorization }) {
  const self = String(id) === String(admin._id);
  if (self && patch.role && patch.role !== 'ADMIN') throw Unprocessable('Không thể tự hạ quyền quản trị của chính mình');
  if (self && patch.status && patch.status !== 'ACTIVE') throw Unprocessable('Không thể tự tạm khoá / vô hiệu hoá tài khoản của chính mình');

  // Đổi quyền + gỡ việc đang treo + nhật ký trong CÙNG transaction: không có lúc người đã bị khoá mà phiếu / lượt chuyển vẫn đứng tên họ.
  const { u, privilegeChanged, released } = await withTxn(async (session) => {
    const u = await UserModel.findById(id).session(session);
    if (!u) throw NotFound('người dùng');
    const before = { role: u.role, facilityIds: u.facilityIds.map(String), status: u.status, shift: u.shift };
    if (patch.fullName) u.fullName = patch.fullName;
    if (patch.role) u.role = patch.role;
    if (patch.facilityIds) u.set('facilityIds', patch.role === 'STAFF' || patch.role === 'FACILITY_MANAGER' || (!patch.role && (u.role === 'STAFF' || u.role === 'FACILITY_MANAGER')) ? patch.facilityIds : []);
    else if (patch.role && patch.role !== 'STAFF' && patch.role !== 'FACILITY_MANAGER') u.set('facilityIds', []);
    // Ca chỉ có ý nghĩa với STAFF — đổi sang vai trò khác thì gỡ, đổi sang STAFF thì cần chọn ca (patch.shift).
    const staffAfter = patch.role ? patch.role === 'STAFF' : u.role === 'STAFF';
    if (staffAfter) { if (patch.shift !== undefined) u.shift = patch.shift; }
    else u.shift = null;
    if (patch.status) u.status = patch.status;
    // Giấy uỷ quyền chỉ có nghĩa với Quản lý chi nhánh — đổi sang vai trò khác thì gỡ.
    const fmAfter = (patch.role ?? u.role) === 'FACILITY_MANAGER';
    if (!fmAfter && patch.authorization) throw Unprocessable('Chỉ Quản lý chi nhánh có giấy uỷ quyền ký hợp đồng');
    if (!fmAfter) u.authorization = null;
    else if (patch.authorization !== undefined) u.authorization = patch.authorization ? { number: patch.authorization.number, issuedOn: new Date(patch.authorization.issuedOn) } : null;
    const privilegeChanged = u.isModified('role') || u.isModified('facilityIds') || u.isModified('status');
    await u.save({ session });

    const released: ReleasedAssignments = privilegeChanged ? await releaseAssignments(u, admin, session) : { tickets: 0, swaps: 0 };
    await audit({
      action: 'user.update', entityType: 'User', entityId: u._id,
      changes: { before, after: { role: u.role, facilityIds: u.facilityIds.map(String), status: u.status, shift: u.shift, ...(released.tickets || released.swaps ? { releasedTickets: released.tickets, releasedSwaps: released.swaps } : {}) } },
    }, session);
    return { u, privilegeChanged, released };
  });

  if (u.firebaseUid && privilegeChanged) {
    // Kill every existing session: verifyIdToken(checkRevoked) rejects older tokens from now on.
    await firebaseAuth.revokeRefreshTokens(u.firebaseUid);
    if (patch.status) await firebaseAuth.updateUser(u.firebaseUid, { disabled: patch.status === 'SUSPENDED' });
  }
  return { user: u, released };
}
