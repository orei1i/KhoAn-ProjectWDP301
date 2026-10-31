import { canDisputeInspection, INSPECTION_DISPUTE_DAYS, OPEN_CONTRACT_STATUSES, PRIVACY_REQUEST_TYPE, type PrivacyRequestType } from '@ssm/shared';
import { ContractFileModel } from '../reservations/contract-file.model';
import { GatewayOrderModel,
  AccessRequestModel, DamageClaimModel, InspectionModel, IntakeBatchModel, PaymentModel, PrivacyRequestModel, RentalContractModel, ReservationModel, ServiceOrderModel,
  TicketModel, UnitSwapRequestModel, UserModel, type UserHydrated,
} from '../../shared/db/models';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { firebaseAuth } from '../../shared/config/firebase';
import { audit } from '../audit/audit.service';
import { notifyStaff } from '../notify/staff-notify';
import { withTxn } from '../../shared/db/txn';

/**
 * QUYỀN CỦA CHỦ THỂ DỮ LIỆU (pháp luật về bảo vệ dữ liệu cá nhân — Chính sách bảo mật mục quyền của khách):
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

/**
 * Bản sao dữ liệu của chính khách (JSON) — không kèm mã băm / mật khẩu kho mã hoá / ghi chú nội bộ của nhân viên. Gồm cả biên bản trả kho /
 * kiểm tra (inspections), thông tin bản scan hợp đồng giấy (không kèm file — tải qua GET /reservations/:id/signed-file), biên bản bàn giao
 * khi nhận lại kho (không kèm ảnh chữ ký), yêu cầu cấp lại thẻ / chìa, đơn dịch vụ, phiếu hỗ trợ.
 */
export async function exportMyData(user: UserHydrated) {
  const id = user._id;
  const [reservations, contracts, payments, tickets, claims, serviceOrders, accessRequests, swapRequests, privacyRequests, contractFiles, intakeBatches] = await Promise.all([
    ReservationModel.find({ customerId: id }, { 'checkIn.qrTokenHash': 0, signOtp: 0 }).lean(),
    RentalContractModel.find({ customerId: id }, { 'access.credentialHash': 0, 'access.credentialEnc': 0, 'moveOut.handover.image': 0 }).lean(),
    PaymentModel.find({ customerId: id }).lean(),
    TicketModel.find({ reporterId: id, kind: 'CUSTOMER_ISSUE' }).lean(), // đợt 16: không kèm việc nội bộ đứng tên khách
    DamageClaimModel.find({ customerId: id }).lean(),
    ServiceOrderModel.find({ customerId: id }).lean(),
    AccessRequestModel.find({ customerId: id }).lean(),
    UnitSwapRequestModel.find({ customerId: id }).lean(),
    PrivacyRequestModel.find({ customerId: id }).lean(),
    ContractFileModel.find({ customerId: id }, { data: 0 }).lean(),
    IntakeBatchModel.find({ customerId: id }).lean(), // đợt 14: danh sách đồ gửi kho đã khai / xác nhận
  ]);
  const inspections = await InspectionModel.find({ contractId: { $in: contracts.map((c) => c._id) } }).lean();
  const handovers = contracts.filter((c) => c.moveOut?.handover).map((c) => {
    const h = c.moveOut!.handover!;
    return { contractId: c._id, contractNumber: c.contractNumber, method: h.method, at: h.at, signerName: h.signerName ?? null, reason: h.reason ?? null, signatureImage: h.method === 'CUSTOMER_SIGNATURE' ? 'Có (không kèm trong bản sao)' : null };
  });
  const { firebaseUid: _uid, tokenVersion: _tv, ...profile } = user.toObject();
  await audit({ action: 'privacy.export', entityType: 'User', entityId: id });
  return {
    exportedAt: new Date().toISOString(),
    note: 'Bản sao dữ liệu cá nhân KhoAn đang lưu về bạn (theo pháp luật về bảo vệ dữ liệu cá nhân). Mật khẩu kho mã hoá, ghi chú nội bộ của nhân viên, file bản scan hợp đồng và ảnh chữ ký bàn giao không nằm trong bản sao (bản scan tải riêng trong tài khoản).',
    profile, reservations, contracts, payments,
    tickets: tickets.map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) })),
    claims, serviceOrders, accessRequests, swapRequests, privacyRequests,
    inspections, contractFiles, handovers, intakeBatches,
  };
}

/**
 * XOÁ DỮ LIỆU = ẨN DANH HOÁ hồ sơ khách (Quản trị viên, theo yêu cầu DELETION): xoá họ tên, email, số điện thoại, giấy tờ, tài khoản
 * nhận tiền; xoá người được uỷ quyền trên các hợp đồng đã đóng; xoá ẢNH CHỮ KÝ vẽ tay (ký hợp đồng online, chữ ký đã huỷ hiệu lực khi đổi
 * ngày, ký nhận bàn giao kho) và số tài khoản nhận tiền ghi trên các khoản đã chi xong; khoá và xoá tài khoản đăng nhập. Giữ hợp đồng (lời
 * văn, họ tên người ký), BẢN SCAN hợp đồng giấy (chứng từ), chứng từ thanh toán, nhật ký — thời hạn lưu ghi trong Chính sách bảo mật.
 * Chỉ làm được khi khách không còn hợp đồng / đặt chỗ đang mở và không còn nợ.
 */
export async function anonymizeCustomer(admin: UserHydrated, id: string, input: { reason: string; requestId?: string }) {
  const u = await UserModel.findById(id);
  if (!u) throw NotFound('người dùng');
  if (u.role !== 'CUSTOMER') throw Forbidden('Chỉ ẩn danh hoá tài khoản khách hàng');
  const [openContract, openRsv, debt, owed, openClaim] = await Promise.all([
    RentalContractModel.exists({ customerId: u._id, status: { $in: [...OPEN_CONTRACT_STATUSES] } }),
    ReservationModel.exists({ customerId: u._id, status: { $in: ['PENDING', 'CONFIRMED', 'ALLOCATED'] } }),
    RentalContractModel.exists({ customerId: u._id, 'balance.outstanding': { $gt: 0 } }),
    // KhoAn còn nợ KHÁCH (hoàn tiền / bồi thường / tiền thanh lý dư đang chờ chuyển): xoá tài khoản nhận tiền + liên hệ thì tiền kẹt.
    PaymentModel.exists({ customerId: u._id, direction: 'REFUND', status: 'PENDING' }),
    DamageClaimModel.exists({ customerId: u._id, status: { $in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } }),
  ]);
  if (openContract || openRsv) throw Unprocessable('Khách còn hợp đồng / đặt chỗ đang mở — kết thúc trước khi xoá dữ liệu', 'HAS_OPEN_CONTRACT');
  // Chi nhánh còn giữ đồ khách để lại sau trả kho: ẩn danh lúc này thì không còn cách liên hệ / đối chiếu khi khách đến nhận đồ.
  if (await RentalContractModel.exists({ customerId: u._id, 'leftover.status': 'HELD' })) {
    throw Unprocessable('Chi nhánh còn giữ đồ khách để lại sau trả kho — xử lý xong ở mục Đồ đang giữ rồi mới xoá dữ liệu', 'LEFTOVER_HELD');
  }
  if (debt) throw Unprocessable('Khách còn nợ chưa tất toán — thu hoặc xoá nợ trước khi xoá dữ liệu', 'HAS_DEBT');
  if (owed) throw Unprocessable('KhoAn còn khoản phải chuyển cho khách (hoàn tiền / bồi thường đang chờ chuyển) — chuyển xong rồi mới xoá dữ liệu', 'HAS_PENDING_PAYOUT');
  if (openClaim) throw Unprocessable('Khách còn hồ sơ bồi thường đang xử lý — kết thúc hồ sơ trước khi xoá dữ liệu', 'HAS_OPEN_CLAIM');
  // Khiếu nại về tiền (phiếu BILLING — vd khiếu nại biên bản trả kho) còn đang xử lý, hoặc biên bản còn trong hạn khiếu nại: ẩn danh lúc
  // này là xoá mất nội dung khiếu nại và tài khoản nhận tiền trong khi chi nhánh vẫn có thể điều chỉnh, phát sinh khoản hoàn không chuyển
  // được cho ai. Phiếu khác (tư vấn, hỏi đáp) không chặn — xoá dữ liệu thì nội dung phiếu bị xoá trắng như thường.
  const [openTicket, contractIds] = await Promise.all([
    TicketModel.exists({ reporterId: u._id, category: 'BILLING', status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } }),
    RentalContractModel.find({ customerId: u._id }, { _id: 1 }).lean().then((cs) => cs.map((c) => c._id)),
  ]);
  if (openTicket) throw Unprocessable('Khách còn khiếu nại về thanh toán / biên bản trả kho đang xử lý — giải quyết xong trước khi xoá dữ liệu', 'HAS_OPEN_TICKET');
  const recentInspections = await InspectionModel.find({ contractId: { $in: contractIds }, type: 'MOVE_OUT', performedAt: { $gte: new Date(Date.now() - (INSPECTION_DISPUTE_DAYS + 2) * 86_400_000) } }, { performedAt: 1 }).lean();
  if (recentInspections.some((i) => canDisputeInspection(i.performedAt.toISOString()))) {
    throw Unprocessable(`Biên bản trả kho của khách còn trong hạn khiếu nại ${INSPECTION_DISPUTE_DAYS} ngày — chờ hết hạn rồi mới xoá dữ liệu`, 'DISPUTE_WINDOW_OPEN');
  }

  const firebaseUid = u.firebaseUid;
  // Lặt vặt đợt 16: mọi bước ẩn danh trong MỘT transaction — lỗi giữa chừng thì không còn hồ sơ "xoá nửa vời". Xoá đăng nhập Firebase sau commit.
  const done = await withTxn(async (session) => {
    const v = await UserModel.findById(u._id).session(session);
    if (!v) throw NotFound('người dùng');
    v.fullName = 'Khách đã xoá dữ liệu';
    v.email = `deleted-${String(v._id)}@deleted.invalid`;
    v.phone = null;
    v.customerProfile = null;
    v.firebaseUid = null;
    v.emailVerifiedAt = null; // email đã bị thay bằng địa chỉ không dùng được
    v.status = 'SUSPENDED';
    v.tokenVersion += 1;
    await v.save({ session });
    await RentalContractModel.updateMany({ customerId: v._id }, { $set: { authorizedPersons: [] } }, { session });
    // Ảnh chữ ký vẽ tay là dữ liệu sinh trắc học dạng ảnh — xoá; lời văn hợp đồng + họ tên người ký vẫn giữ làm chứng từ.
    await ReservationModel.updateMany({ customerId: v._id, 'signature.image': { $ne: null } }, { $set: { 'signature.image': null } }, { session });
    await ReservationModel.updateMany({ customerId: v._id, 'scheduleChanges.voidedSignature.image': { $ne: null } },
      { $set: { 'scheduleChanges.$[c].voidedSignature.image': null } }, { arrayFilters: [{ 'c.voidedSignature.image': { $ne: null } }], session });
    await RentalContractModel.updateMany({ customerId: v._id, 'moveOut.handover.image': { $ne: null } }, { $set: { 'moveOut.handover.image': null } }, { session });
    // Đợt VNPAY: lệnh thu qua cổng giữ làm chứng từ, bỏ tham số thanh toán và IP khách.
    await GatewayOrderModel.updateMany({ customerId: v._id }, { $set: { payload: null, payUrl: null, clientIp: null } }, { session });
    // Số tài khoản khách nhận tiền ghi trên khoản đã chi xong (không còn khoản chờ chuyển — đã chặn ở trên): thay bằng ghi chú, giữ mã giao dịch.
    await PaymentModel.updateMany({ customerId: v._id, payout: { $ne: null } }, { $set: { 'payout.toAccount': '(đã xoá theo yêu cầu xoá dữ liệu cá nhân)' } }, { session });
    // Đợt 15 (A6): người nhận tiền mặt bồi thường ghi trong hồ sơ — xoá họ tên, 4 số cuối giấy tờ (giữ loại giấy tờ, thời điểm, người chi).
    await DamageClaimModel.updateMany({ customerId: v._id, 'settlement.recipient': { $exists: true, $ne: null } },
      { $set: { 'settlement.recipient.name': 'Khách đã xoá dữ liệu', 'settlement.recipient.idNumberLast4': '****' } }, { session });
    // Nội dung khách tự viết (phiếu hỗ trợ / tư vấn có họ tên, số điện thoại; ghi chú yêu cầu dữ liệu; đợt 16: ghi chú đơn dịch vụ, lý do yêu cầu
    // cấp thẻ / đổi ô) cũng là dữ liệu cá nhân — xoá trắng, giữ loại, mốc thời gian, trạng thái. Hợp đồng đã ký, chứng từ, nhật ký thuộc ngoại
    // lệ lưu trữ (Chính sách mục 5).
    const erased = '(đã xoá theo yêu cầu xoá dữ liệu cá nhân)';
    await TicketModel.updateMany({ reporterId: v._id }, { $set: { subject: 'Phiếu của khách đã xoá dữ liệu', description: '' } }, { session });
    await TicketModel.updateMany({ 'messages.authorId': v._id }, { $set: { 'messages.$[m].body': erased } }, { arrayFilters: [{ 'm.authorId': v._id }], session });
    await PrivacyRequestModel.updateMany({ customerId: v._id }, { $set: { note: null } }, { session });
    await ServiceOrderModel.updateMany({ customerId: v._id, note: { $nin: [null, ''] } }, { $set: { note: erased } }, { session });
    await AccessRequestModel.updateMany({ customerId: v._id, reason: { $nin: [null, ''] } }, { $set: { reason: erased } }, { session });
    // `reason` của yêu cầu đổi ô là bất biến ở mức model (bằng chứng lúc gửi) — ẩn danh ghi thẳng collection có chủ đích.
    await UnitSwapRequestModel.collection.updateMany({ customerId: v._id }, { $set: { reason: erased } }, { session });
    if (input.requestId) {
      await PrivacyRequestModel.updateOne({ _id: input.requestId, customerId: v._id, status: 'OPEN' }, { $set: { status: 'DONE', response: 'Đã xoá (ẩn danh hoá) dữ liệu nhận diện; chứng từ tài chính được giữ theo thời hạn luật định.', handledBy: admin._id, handledAt: new Date() } }, { session });
    }
    await audit({ action: 'user.anonymize', entityType: 'User', entityId: v._id, reason: input.reason }, session);
    return v;
  });
  if (firebaseUid) await firebaseAuth.deleteUser(firebaseUid).catch((e) => console.error('[anonymize] firebase', e instanceof Error ? e.message : e));
  return done;
}
