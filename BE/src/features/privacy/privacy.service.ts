import { OPEN_CONTRACT_STATUSES, PRIVACY_REQUEST_TYPE, type PrivacyRequestType } from '@ssm/shared';
import {
  AccessRequestModel, DamageClaimModel, PaymentModel, PrivacyRequestModel, RentalContractModel, ReservationModel, ServiceOrderModel,
  TicketModel, UnitSwapRequestModel, UserModel, type UserHydrated,
} from '../../shared/db/models';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { firebaseAuth } from '../../shared/config/firebase';
import { audit } from '../audit/audit.service';
import { notifyStaff } from '../notify/staff-notify';

/**
 * QUYỀN CỦA CHỦ THỂ DỮ LIỆU (Nghị định 13/2023/NĐ-CP, Chính sách bảo mật mục quyền của khách):
 *  - được biết / truy cập: khách tự tải bản sao dữ liệu của mình bất cứ lúc nào (exportMyData);
 *  - các quyền còn lại (chỉnh sửa, xoá, rút lại đồng ý, phản đối): gửi yêu cầu, Quản trị viên xử lý trong 72 giờ;
 *  - xoá = ẩn danh hoá hồ sơ (anonymizeCustomer): xoá thông tin nhận diện, giữ chứng từ tài chính và nhật ký theo thời hạn luật định.
 * Gửi được kể cả khi khách không còn hợp đồng nào (khác phiếu hỗ trợ).
 */
const RESPONSE_HOURS = 72;
const MAX_OPEN = 3;

export async function createPrivacyRequest(user: UserHydrated, input: { type: PrivacyRequestType; note?: string }) {
  const open = await PrivacyRequestModel.countDocuments({ customerId: user._id, status: 'OPEN' });
  if (open >= MAX_OPEN) throw Conflict(`Bạn đang có ${open} yêu cầu chưa xử lý xong — chờ phản hồi trước khi gửi thêm`, 'TOO_MANY_PRIVACY_REQUESTS');
  const r = await PrivacyRequestModel.create({
    customerId: user._id, type: input.type, note: input.note?.trim() || null, status: 'OPEN',
    dueAt: new Date(Date.now() + RESPONSE_HOURS * 3_600_000),
  });
  await audit({ action: 'privacy.request', entityType: 'PrivacyRequest', entityId: r._id, changes: { after: { type: input.type } } });
  void notifyStaff({ roles: ['ADMIN'] }, `KhoAn — Yêu cầu dữ liệu cá nhân mới ${r.requestNumber}`, [
    `Khách ${user.fullName} (${user.email}) gửi yêu cầu: ${PRIVACY_REQUEST_TYPE[input.type]}.`,
    input.note?.trim() ? `Ghi chú: ${input.note.trim()}` : '',
    `Hạn phản hồi: ${r.dueAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (72 giờ). Xử lý ở trang Quản trị → Dữ liệu cá nhân.`,
  ].filter(Boolean));
  return r;
}

export async function listPrivacyRequests(user: UserHydrated, status?: string) {
  const filter: Record<string, unknown> = user.role === 'ADMIN' ? {} : { customerId: user._id };
  if (status) filter.status = { $in: status.split(',') };
  const items = await PrivacyRequestModel.find(filter).sort({ status: 1, dueAt: 1, createdAt: -1 }).limit(200).lean();
  if (user.role !== 'ADMIN') return items;
  const users = await UserModel.find({ _id: { $in: items.map((x) => x.customerId) } }, { fullName: 1, email: 1, phone: 1 }).lean();
  return items.map((x) => ({ ...x, customer: users.find((u) => String(u._id) === String(x.customerId)) ?? null }));
}

export async function resolvePrivacyRequest(admin: UserHydrated, id: string, input: { status: 'DONE' | 'REJECTED'; response: string }) {
  const r = await PrivacyRequestModel.findById(id);
  if (!r) throw NotFound('yêu cầu');
  if (r.status !== 'OPEN') throw Conflict('Yêu cầu đã được xử lý');
  r.status = input.status;
  r.response = input.response.trim();
  r.handledBy = admin._id;
  r.handledAt = new Date();
  await r.save();
  await audit({ action: 'privacy.resolve', entityType: 'PrivacyRequest', entityId: r._id, reason: input.response, changes: { after: { status: input.status } } });
  return r;
}

/** Bản sao dữ liệu của chính khách (JSON) — không kèm mã băm / mật khẩu kho mã hoá / ghi chú nội bộ của nhân viên. */
export async function exportMyData(user: UserHydrated) {
  const id = user._id;
  const [reservations, contracts, payments, tickets, claims, serviceOrders, accessRequests, swapRequests, privacyRequests] = await Promise.all([
    ReservationModel.find({ customerId: id }, { 'checkIn.qrTokenHash': 0 }).lean(),
    RentalContractModel.find({ customerId: id }, { 'access.credentialHash': 0, 'access.credentialEnc': 0 }).lean(),
    PaymentModel.find({ customerId: id }).lean(),
    TicketModel.find({ reporterId: id }).lean(),
    DamageClaimModel.find({ customerId: id }).lean(),
    ServiceOrderModel.find({ customerId: id }).lean(),
    AccessRequestModel.find({ customerId: id }).lean(),
    UnitSwapRequestModel.find({ customerId: id }).lean(),
    PrivacyRequestModel.find({ customerId: id }).lean(),
  ]);
  const { firebaseUid: _uid, tokenVersion: _tv, ...profile } = user.toObject();
  await audit({ action: 'privacy.export', entityType: 'User', entityId: id });
  return {
    exportedAt: new Date().toISOString(),
    note: 'Bản sao dữ liệu cá nhân KhoAn đang lưu về bạn (Nghị định 13/2023/NĐ-CP). Mật khẩu kho mã hoá và ghi chú nội bộ của nhân viên không nằm trong bản sao.',
    profile, reservations, contracts, payments,
    tickets: tickets.map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) })),
    claims, serviceOrders, accessRequests, swapRequests, privacyRequests,
  };
}

/**
 * XOÁ DỮ LIỆU = ẨN DANH HOÁ hồ sơ khách (Quản trị viên, theo yêu cầu DELETION): xoá họ tên, email, số điện thoại, giấy tờ, tài khoản
 * nhận tiền; xoá người được uỷ quyền trên các hợp đồng đã đóng; khoá và xoá tài khoản đăng nhập. Giữ hợp đồng, chứng từ thanh toán,
 * nhật ký (nghĩa vụ kế toán / thuế — Chính sách bảo mật nêu ngoại lệ này). Chỉ làm được khi khách không còn hợp đồng / đặt chỗ đang mở
 * và không còn nợ.
 */
export async function anonymizeCustomer(admin: UserHydrated, id: string, input: { reason: string; requestId?: string }) {
  const u = await UserModel.findById(id);
  if (!u) throw NotFound('người dùng');
  if (u.role !== 'CUSTOMER') throw Forbidden('Chỉ ẩn danh hoá tài khoản khách hàng');
  const [openContract, openRsv, debt] = await Promise.all([
    RentalContractModel.exists({ customerId: u._id, status: { $in: [...OPEN_CONTRACT_STATUSES] } }),
    ReservationModel.exists({ customerId: u._id, status: { $in: ['PENDING', 'CONFIRMED', 'ALLOCATED'] } }),
    RentalContractModel.exists({ customerId: u._id, 'balance.outstanding': { $gt: 0 } }),
  ]);
  if (openContract || openRsv) throw Unprocessable('Khách còn hợp đồng / đặt chỗ đang mở — kết thúc trước khi xoá dữ liệu', 'HAS_OPEN_CONTRACT');
  if (debt) throw Unprocessable('Khách còn nợ chưa tất toán — thu hoặc xoá nợ trước khi xoá dữ liệu', 'HAS_DEBT');

  const firebaseUid = u.firebaseUid;
  u.fullName = 'Khách đã xoá dữ liệu';
  u.email = `deleted-${String(u._id)}@deleted.invalid`;
  u.phone = null;
  u.customerProfile = null;
  u.firebaseUid = null;
  u.status = 'SUSPENDED';
  u.tokenVersion += 1;
  await u.save();
  await RentalContractModel.updateMany({ customerId: u._id }, { $set: { authorizedPersons: [] } });
  if (firebaseUid) await firebaseAuth.deleteUser(firebaseUid).catch((e) => console.error('[anonymize] firebase', e instanceof Error ? e.message : e));
  if (input.requestId) {
    await PrivacyRequestModel.updateOne({ _id: input.requestId, customerId: u._id, status: 'OPEN' }, { $set: { status: 'DONE', response: 'Đã xoá (ẩn danh hoá) dữ liệu nhận diện; chứng từ tài chính được giữ theo thời hạn luật định.', handledBy: admin._id, handledAt: new Date() } });
  }
  await audit({ action: 'user.anonymize', entityType: 'User', entityId: u._id, reason: input.reason });
  return u;
}
