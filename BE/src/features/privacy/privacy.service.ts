import type { ClientSession } from 'mongoose';
import {
  ANONYMIZED_EMAIL_DOMAIN, ANONYMIZED_NAME, CLAIM_STATUS, canDisputeInspection, CONTRACT_STATUS, fmtDate, handoverOtpText, inspectionDisputeDeadline, INSPECTION_DISPUTE_DAYS,
  isAnonymizedEmail, OPEN_CLAIM_STATUSES, OPEN_CONTRACT_STATUSES, PAYMENT_TYPE, PRIVACY_REQUEST_TYPE, RESERVATION_STATUS, TICKET_STATUS, vnd, vnDayOf,
  type AnonymizeSource, type CustomerDeletionBlocker, type CustomerDeletionCheck, type PrivacyRequestType,
} from '@ssm/shared';
import { ContractFileModel } from '../reservations/contract-file.model';
import { GatewayOrderModel,
  AccessRequestModel, DamageClaimModel, InspectionModel, IntakeBatchModel, PaymentModel, PrivacyRequestModel, RentalContractModel, ReservationModel, ServiceOrderModel,
  TicketModel, UnitSwapRequestModel, UserModel, type UserHydrated,
} from '../../shared/db/models';
import { AppError, Conflict, NotFound, Unprocessable } from '../../shared/core/errors';
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
    return {
      contractId: c._id, contractNumber: c.contractNumber, method: h.method, at: h.at, signerName: h.signerName ?? null, reason: h.reason ?? null,
      signatureImage: h.image ? 'Có (không kèm trong bản sao)' : null, // biên bản từ 16/11 chỉ xác nhận bằng OTP, không có chữ ký tay
      otpConfirmation: h.otp ? { method: h.otp.method, at: h.otp.at, sentTo: h.otp.sentTo, text: handoverOtpText(h.otp) } : null,
    };
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

// ---------------------------------------------------------------- xoá tài khoản khách = ẩn danh hoá

const OPEN_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'ALLOCATED'] as const;
const OPEN_TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] as const;
const ERASED_TEXT = '(đã xoá theo yêu cầu xoá dữ liệu cá nhân)';
const iso = (d?: Date | string | null) => (d ? new Date(d).toISOString() : null);
/** "A, B, C và 2 mục khác" — câu báo lỗi không dài vô hạn khi khách có nhiều mục. */
const listText = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(', ')} và ${xs.length - max} mục khác` : xs.join(', '));
const statusText = (m: Record<string, { label: string }>, v: string) => (m[v]?.label ?? v).toLowerCase();

/**
 * MỌI lý do chưa xoá (ẩn danh hoá) được tài khoản khách, theo thứ tự kiểm — không dừng ở lý do đầu tiên. Mỗi mục có mã (giữ nguyên các mã
 * cũ), câu báo tiếng Việt và chi tiết cụ thể (số hợp đồng, mã đặt chỗ, số tiền, mã hồ sơ / phiếu, hạn khiếu nại) để quản trị viên biết phải
 * xử lý gì. Không trả họ tên, giấy tờ, nội dung phiếu hay tài khoản nhận tiền.
 *
 * Khoản THU còn chờ (CHARGE PENDING) không thành mục riêng: khoản gắn hợp đồng luôn được cộng vào balance.outstanding (→ HAS_DEBT), khoản
 * gắn đặt chỗ chỉ tồn tại khi đặt chỗ còn mở (→ HAS_OPEN_CONTRACT); đặt chỗ huỷ / nhận kho thì khoản đó bị huỷ / thu.
 */
export async function customerDeletionBlockers(customerId: unknown, session?: ClientSession): Promise<CustomerDeletionBlocker[]> {
  const s = session ?? null;
  const [contracts, reservations, payouts, claims, tickets] = await Promise.all([
    RentalContractModel.find({ customerId }, { contractNumber: 1, status: 1, 'balance.outstanding': 1, 'leftover.status': 1, 'leftover.holdUntil': 1 }).sort({ createdAt: 1 }).session(s).lean(),
    ReservationModel.find({ customerId, status: { $in: [...OPEN_RESERVATION_STATUSES] } }, { code: 1, status: 1, startDate: 1 }).sort({ startDate: 1 }).session(s).lean(),
    // KhoAn còn nợ KHÁCH (hoàn tiền / bồi thường / tiền thanh lý dư đang chờ chuyển): xoá tài khoản nhận tiền + liên hệ thì tiền kẹt.
    PaymentModel.find({ customerId, direction: 'REFUND', status: 'PENDING' }, { type: 1, amount: 1, method: 1, contractId: 1, reservationId: 1, createdAt: 1 }).sort({ createdAt: 1 }).session(s).lean(),
    DamageClaimModel.find({ customerId, status: { $in: [...OPEN_CLAIM_STATUSES] } }, { claimNumber: 1, status: 1, claimedAmount: 1 }).sort({ createdAt: 1 }).session(s).lean(),
    // Khiếu nại về tiền (phiếu BILLING — vd khiếu nại biên bản trả kho) còn đang xử lý: chi nhánh vẫn có thể điều chỉnh, phát sinh khoản hoàn.
    // Phiếu khác (tư vấn, hỏi đáp) không chặn — xoá dữ liệu thì nội dung phiếu bị xoá trắng như thường.
    TicketModel.find({ reporterId: customerId, category: 'BILLING', status: { $in: [...OPEN_TICKET_STATUSES] } }, { ticketNumber: 1, status: 1 }).sort({ createdAt: 1 }).session(s).lean(),
  ]);
  const numberOf = new Map(contracts.map((c) => [String(c._id), c.contractNumber]));
  const blockers: CustomerDeletionBlocker[] = [];

  const open = contracts.filter((c) => (OPEN_CONTRACT_STATUSES as readonly string[]).includes(c.status));
  if (open.length || reservations.length) {
    const parts = [
      open.length ? `${open.length} hợp đồng đang thuê (${listText(open.map((c) => `${c.contractNumber} — ${statusText(CONTRACT_STATUS, c.status)}`))})` : '',
      reservations.length ? `${reservations.length} đặt chỗ đang mở (${listText(reservations.map((r) => `${r.code} — ${statusText(RESERVATION_STATUS, r.status)}`))})` : '',
    ].filter(Boolean);
    blockers.push({
      code: 'HAS_OPEN_CONTRACT', message: `Khách còn ${parts.join(' và ')} — kết thúc trước khi xoá dữ liệu`,
      details: {
        contracts: open.map((c) => ({ contractNumber: c.contractNumber, status: c.status })),
        reservations: reservations.map((r) => ({ code: r.code, status: r.status, startDate: iso(r.startDate) })),
      },
    });
  }
  // Chi nhánh còn giữ đồ khách để lại sau trả kho: ẩn danh lúc này thì không còn cách liên hệ / đối chiếu khi khách đến nhận đồ.
  const held = contracts.filter((c) => c.leftover?.status === 'HELD');
  if (held.length) {
    blockers.push({
      code: 'LEFTOVER_HELD',
      message: `Chi nhánh còn giữ đồ khách để lại sau trả kho (${listText(held.map((c) => `HĐ ${c.contractNumber}${c.leftover?.holdUntil ? ` — giữ đến ${fmtDate(iso(c.leftover.holdUntil))}` : ''}`))}) — xử lý xong ở mục Đồ đang giữ rồi mới xoá dữ liệu`,
      details: { contracts: held.map((c) => ({ contractNumber: c.contractNumber, holdUntil: iso(c.leftover?.holdUntil) })) },
    });
  }
  const debts = contracts.filter((c) => (c.balance?.outstanding ?? 0) > 0);
  if (debts.length) {
    const total = debts.reduce((sum, c) => sum + c.balance.outstanding, 0);
    blockers.push({
      code: 'HAS_DEBT',
      message: `Khách còn nợ ${vnd(total)} chưa tất toán (${listText(debts.map((c) => `HĐ ${c.contractNumber}: ${vnd(c.balance.outstanding)}`))}) — thu hoặc xoá nợ trước khi xoá dữ liệu`,
      details: { total, contracts: debts.map((c) => ({ contractNumber: c.contractNumber, status: c.status, outstanding: c.balance.outstanding })) },
    });
  }
  if (payouts.length) {
    const rsvIds = payouts.filter((p) => p.reservationId && !p.contractId).map((p) => p.reservationId);
    const rsvCode = new Map((rsvIds.length ? await ReservationModel.find({ _id: { $in: rsvIds } }, { code: 1 }).session(s).lean() : []).map((r) => [String(r._id), r.code]));
    const rows = payouts.map((p) => ({
      type: p.type, amount: p.amount, method: p.method,
      contractNumber: p.contractId ? numberOf.get(String(p.contractId)) ?? null : null,
      reservationCode: p.reservationId ? rsvCode.get(String(p.reservationId)) ?? null : null,
      createdAt: iso(p.createdAt),
    }));
    const total = rows.reduce((sum, p) => sum + p.amount, 0);
    blockers.push({
      code: 'HAS_PENDING_PAYOUT',
      message: `KhoAn còn phải chuyển cho khách ${vnd(total)} (${listText(rows.map((p) => `${PAYMENT_TYPE[p.type]?.label ?? p.type} ${vnd(p.amount)}${p.contractNumber ? ` — HĐ ${p.contractNumber}` : p.reservationCode ? ` — đặt chỗ ${p.reservationCode}` : ''}`))}) — chuyển xong rồi mới xoá dữ liệu`,
      details: { total, payouts: rows },
    });
  }
  if (claims.length) {
    blockers.push({
      code: 'HAS_OPEN_CLAIM',
      message: `Khách còn ${claims.length} hồ sơ bồi thường đang xử lý (${listText(claims.map((c) => `${c.claimNumber} — ${statusText(CLAIM_STATUS, c.status)}`))}) — kết thúc hồ sơ trước khi xoá dữ liệu`,
      details: { claims: claims.map((c) => ({ claimNumber: c.claimNumber, status: c.status, claimedAmount: c.claimedAmount ?? null })) },
    });
  }
  if (tickets.length) {
    blockers.push({
      code: 'HAS_OPEN_TICKET',
      message: `Khách còn ${tickets.length} khiếu nại về thanh toán / biên bản trả kho đang xử lý (${listText(tickets.map((t) => `${t.ticketNumber} — ${statusText(TICKET_STATUS, t.status)}`))}) — giải quyết xong trước khi xoá dữ liệu`,
      details: { tickets: tickets.map((t) => ({ ticketNumber: t.ticketNumber, status: t.status })) },
    });
  }
  // Biên bản trả kho còn trong hạn khiếu nại: ẩn danh lúc này là xoá mất tài khoản nhận tiền trong khi chi nhánh vẫn có thể điều chỉnh.
  const recent = contracts.length ? await InspectionModel.find({
    contractId: { $in: contracts.map((c) => c._id) }, type: 'MOVE_OUT', performedAt: { $gte: new Date(Date.now() - (INSPECTION_DISPUTE_DAYS + 2) * 86_400_000) },
  }, { performedAt: 1, contractId: 1 }).session(s).lean() : [];
  const disputable = recent.filter((i) => canDisputeInspection(i.performedAt.toISOString())).map((i) => {
    const until = inspectionDisputeDeadline(i.performedAt);
    return { contractNumber: numberOf.get(String(i.contractId)) ?? null, performedAt: i.performedAt.toISOString(), until: new Date(until).toISOString(), lastDay: vnDayOf(new Date(until - 1)) };
  }).sort((a, b) => a.until.localeCompare(b.until));
  if (disputable.length) {
    const last = disputable[disputable.length - 1];
    blockers.push({
      code: 'DISPUTE_WINDOW_OPEN',
      message: `Biên bản trả kho của khách còn trong hạn khiếu nại ${INSPECTION_DISPUTE_DAYS} ngày (${listText(disputable.map((i) => `${i.contractNumber ? `HĐ ${i.contractNumber}` : 'biên bản'} đến hết ngày ${fmtDate(`${i.lastDay}T00:00:00.000Z`)}`))}) — chờ hết hạn rồi mới xoá dữ liệu`,
      details: { until: last.until, lastDay: last.lastDay, inspections: disputable },
    });
  }
  return blockers;
}

/** Tài khoản xoá được không: tồn tại, là khách, chưa bị xoá trước đó. Trả bản ghi để dùng tiếp. */
async function loadDeletableCustomer(id: string) {
  const u = await UserModel.findById(id);
  if (!u) throw NotFound('người dùng');
  if (u.role !== 'CUSTOMER') throw Unprocessable('Chỉ xoá được tài khoản khách hàng — tài khoản nhân sự dùng Tạm khoá để tên vẫn còn trên phê duyệt và nhật ký', 'NOT_A_CUSTOMER');
  if (isAnonymizedEmail(u.email)) throw Conflict('Tài khoản này đã được xoá (ẩn danh hoá) trước đó', 'ALREADY_ANONYMIZED');
  return u;
}

/**
 * GET /users/:id/deletion-check (Quản trị viên, trước khi bấm xoá): mọi lý do chặn kèm chi tiết, việc thao tác xoá sẽ làm (kèm số lượng)
 * và thứ được giữ lại. Chỉ đọc, không ghi nhật ký.
 */
export async function customerDeletionCheck(id: string): Promise<CustomerDeletionCheck> {
  const u = await loadDeletableCustomer(id);
  const cid = u._id;
  const [blockers, signatures, voided, handovers, persons, paidOut, gatewayOrders, tickets, notes, contracts, payments, files] = await Promise.all([
    customerDeletionBlockers(cid),
    ReservationModel.countDocuments({ customerId: cid, 'signature.image': { $ne: null } }),
    ReservationModel.aggregate<{ n: number }>([
      { $match: { customerId: cid, scheduleChanges: { $elemMatch: { 'voidedSignature.image': { $ne: null } } } } }, { $unwind: '$scheduleChanges' },
      { $match: { 'scheduleChanges.voidedSignature.image': { $ne: null } } }, { $count: 'n' },
    ]).then((r) => r[0]?.n ?? 0),
    RentalContractModel.countDocuments({ customerId: cid, 'moveOut.handover.image': { $ne: null } }),
    RentalContractModel.aggregate<{ n: number }>([
      { $match: { customerId: cid, 'authorizedPersons.0': { $exists: true } } }, { $group: { _id: null, n: { $sum: { $size: '$authorizedPersons' } } } },
    ]).then((r) => r[0]?.n ?? 0),
    PaymentModel.countDocuments({ customerId: cid, payout: { $ne: null } }),
    GatewayOrderModel.countDocuments({ customerId: cid }),
    TicketModel.countDocuments({ reporterId: cid }),
    Promise.all([
      ServiceOrderModel.countDocuments({ customerId: cid, note: { $nin: [null, ''] } }),
      AccessRequestModel.countDocuments({ customerId: cid, reason: { $nin: [null, ''] } }),
      UnitSwapRequestModel.countDocuments({ customerId: cid }),
      PrivacyRequestModel.countDocuments({ customerId: cid, note: { $nin: [null, ''] } }),
    ]).then((xs) => xs.reduce((a, b) => a + b, 0)),
    RentalContractModel.countDocuments({ customerId: cid }),
    PaymentModel.countDocuments({ customerId: cid }),
    ContractFileModel.countDocuments({ customerId: cid }),
  ]);
  const sig = signatures + voided + handovers;
  const willDo = [
    'Ẩn danh hoá hồ sơ: họ tên, email, số điện thoại, giấy tờ, địa chỉ, tài khoản nhận tiền',
    u.firebaseUid ? 'Xoá tài khoản đăng nhập và khoá tài khoản — khách không đăng nhập được nữa' : 'Khoá tài khoản (khách chưa có tài khoản đăng nhập)',
    sig ? `Xoá ${sig} ảnh chữ ký vẽ tay (ký hợp đồng online, ký nhận bàn giao kho)` : '',
    persons ? `Xoá ${persons} người được uỷ quyền trên hợp đồng đã đóng` : '',
    paidOut ? `Xoá số tài khoản nhận tiền ghi trên ${paidOut} khoản đã chi (giữ mã giao dịch)` : '',
    tickets || notes ? `Xoá trắng nội dung khách tự viết${tickets ? ` trên ${tickets} phiếu hỗ trợ` : ''}${notes ? `${tickets ? ' và' : ''} ${notes} ghi chú / lý do (đơn dịch vụ, cấp thẻ, đổi ô, yêu cầu dữ liệu)` : ''}` : '',
    gatewayOrders ? `Bỏ tham số thanh toán và địa chỉ IP trên ${gatewayOrders} lệnh thanh toán VNPAY` : '',
  ].filter(Boolean);
  const keeps = [
    contracts ? `Giữ ${contracts} hợp đồng (lời văn, họ tên người ký)${files ? ` và ${files} bản scan hợp đồng giấy` : ''}` : '',
    payments ? `Giữ ${payments} chứng từ thanh toán` : '',
    'Giữ nhật ký thao tác theo thời hạn lưu trong Chính sách bảo mật',
  ].filter(Boolean);
  return { customer: { _id: String(u._id), fullName: u.fullName, email: u.email, status: u.status }, canDelete: blockers.length === 0, blockers, willDo, keeps };
}

/**
 * XOÁ TÀI KHOẢN KHÁCH = ẨN DANH HOÁ hồ sơ (Quản trị viên — ở trang Người dùng, hoặc theo yêu cầu DELETION): xoá họ tên, email, số điện thoại,
 * giấy tờ, tài khoản nhận tiền; xoá người được uỷ quyền trên các hợp đồng đã đóng; xoá ẢNH CHỮ KÝ vẽ tay (ký hợp đồng online, chữ ký đã huỷ
 * hiệu lực khi đổi ngày, ký nhận bàn giao kho) và số tài khoản nhận tiền ghi trên các khoản đã chi xong; khoá và xoá tài khoản đăng nhập. Giữ
 * hợp đồng (lời văn, họ tên người ký), BẢN SCAN hợp đồng giấy (chứng từ), chứng từ thanh toán, nhật ký — thời hạn lưu ghi trong Chính sách
 * bảo mật. Không xoá cứng, không cờ xoá mềm: bản ghi người dùng ở lại để mọi tham chiếu cũ vẫn mở được.
 * Còn lý do chặn (customerDeletionBlockers) → 422 với mã / câu báo của lý do ĐẦU TIÊN, details.blockers = cả danh sách.
 * Nhật ký `user.anonymize` ghi lý do, nguồn (trang Người dùng / yêu cầu dữ liệu cá nhân), số bản ghi đã xoá / sửa (modifiedCount của từng
 * lệnh) và số chứng từ được giữ — KHÔNG ghi dữ liệu cá nhân đã xoá.
 */
export async function anonymizeCustomer(admin: UserHydrated, id: string, input: { reason: string; requestId?: string; source?: AnonymizeSource }) {
  const u = await loadDeletableCustomer(id);
  const blockers = await customerDeletionBlockers(u._id);
  if (blockers.length) throw new AppError(422, blockers[0].code, blockers[0].message, { blockers });

  const source: AnonymizeSource = input.requestId ? 'PRIVACY_REQUEST' : input.source ?? 'USER_PAGE';
  const firebaseUid = u.firebaseUid;
  // Lặt vặt đợt 16: mọi bước ẩn danh trong MỘT transaction — lỗi giữa chừng thì không còn hồ sơ "xoá nửa vời". Xoá đăng nhập Firebase sau commit.
  // Bộ lọc của từng lệnh chỉ khớp bản ghi thật sự có dữ liệu cần xoá — modifiedCount (ghi nhật ký) là số bản ghi đã xoá / sửa.
  const done = await withTxn(async (session) => {
    const v = await UserModel.findById(u._id).session(session);
    if (!v) throw NotFound('người dùng');
    const before = { status: v.status };
    v.fullName = ANONYMIZED_NAME;
    v.email = `deleted-${String(v._id)}@${ANONYMIZED_EMAIL_DOMAIN}`;
    v.phone = null;
    v.customerProfile = null;
    v.firebaseUid = null;
    v.emailVerifiedAt = null; // email đã bị thay bằng địa chỉ không dùng được
    v.status = 'SUSPENDED';
    v.tokenVersion += 1;
    await v.save({ session });
    const persons = await RentalContractModel.updateMany({ customerId: v._id, 'authorizedPersons.0': { $exists: true } }, { $set: { authorizedPersons: [] } }, { session });
    // Ảnh chữ ký vẽ tay là dữ liệu sinh trắc học dạng ảnh — xoá; lời văn hợp đồng + họ tên người ký vẫn giữ làm chứng từ.
    const signatures = await ReservationModel.updateMany({ customerId: v._id, 'signature.image': { $ne: null } }, { $set: { 'signature.image': null } }, { session });
    // $elemMatch (không phải 'scheduleChanges.voidedSignature.image': { $ne: null }): $ne trên mảng chỉ khớp khi MỌI lần đổi ngày đều có
    // chữ ký bị huỷ — đặt chỗ đổi ngày cả trước lẫn sau khi ký sẽ bị bỏ sót ảnh chữ ký.
    const voided = await ReservationModel.updateMany({ customerId: v._id, scheduleChanges: { $elemMatch: { 'voidedSignature.image': { $ne: null } } } },
      { $set: { 'scheduleChanges.$[c].voidedSignature.image': null } }, { arrayFilters: [{ 'c.voidedSignature.image': { $ne: null } }], session });
    const handovers = await RentalContractModel.updateMany({ customerId: v._id, 'moveOut.handover.image': { $ne: null } }, { $set: { 'moveOut.handover.image': null } }, { session });
    // Đợt VNPAY: lệnh thu qua cổng giữ làm chứng từ, bỏ tham số thanh toán và IP khách.
    const gateway = await GatewayOrderModel.updateMany({ customerId: v._id, $or: [{ payload: { $ne: null } }, { payUrl: { $ne: null } }, { clientIp: { $ne: null } }] },
      { $set: { payload: null, payUrl: null, clientIp: null } }, { session });
    // Số tài khoản khách nhận tiền ghi trên khoản đã chi xong (không còn khoản chờ chuyển — đã chặn ở trên): thay bằng ghi chú, giữ mã giao dịch.
    const payouts = await PaymentModel.updateMany({ customerId: v._id, payout: { $ne: null } }, { $set: { 'payout.toAccount': ERASED_TEXT } }, { session });
    // Đợt 15 (A6): người nhận tiền mặt bồi thường ghi trong hồ sơ — xoá họ tên, 4 số cuối giấy tờ (giữ loại giấy tờ, thời điểm, người chi).
    const recipients = await DamageClaimModel.updateMany({ customerId: v._id, 'settlement.recipient': { $exists: true, $ne: null } },
      { $set: { 'settlement.recipient.name': ANONYMIZED_NAME, 'settlement.recipient.idNumberLast4': '****' } }, { session });
    // Nội dung khách tự viết (phiếu hỗ trợ / tư vấn có họ tên, số điện thoại; ghi chú yêu cầu dữ liệu; đợt 16: ghi chú đơn dịch vụ, lý do yêu cầu
    // cấp thẻ / đổi ô) cũng là dữ liệu cá nhân — xoá trắng, giữ loại, mốc thời gian, trạng thái. Hợp đồng đã ký, chứng từ, nhật ký thuộc ngoại
    // lệ lưu trữ (Chính sách mục 5).
    const tickets = await TicketModel.updateMany({ reporterId: v._id }, { $set: { subject: 'Phiếu của khách đã xoá dữ liệu', description: '' } }, { session });
    const messages = await TicketModel.updateMany({ 'messages.authorId': v._id }, { $set: { 'messages.$[m].body': ERASED_TEXT } }, { arrayFilters: [{ 'm.authorId': v._id }], session });
    const privacyNotes = await PrivacyRequestModel.updateMany({ customerId: v._id, note: { $nin: [null, ''] } }, { $set: { note: null } }, { session });
    const serviceNotes = await ServiceOrderModel.updateMany({ customerId: v._id, note: { $nin: [null, ''] } }, { $set: { note: ERASED_TEXT } }, { session });
    const accessReasons = await AccessRequestModel.updateMany({ customerId: v._id, reason: { $nin: [null, ''] } }, { $set: { reason: ERASED_TEXT } }, { session });
    // `reason` của yêu cầu đổi ô là bất biến ở mức model (bằng chứng lúc gửi) — ẩn danh ghi thẳng collection có chủ đích.
    const swapReasons = await UnitSwapRequestModel.collection.updateMany({ customerId: v._id }, { $set: { reason: ERASED_TEXT } }, { session });
    let requestNumber: string | null = null;
    if (input.requestId) {
      requestNumber = (await PrivacyRequestModel.findOne({ _id: input.requestId, customerId: v._id }, { requestNumber: 1 }).session(session).lean())?.requestNumber ?? null;
      await PrivacyRequestModel.updateOne({ _id: input.requestId, customerId: v._id, status: 'OPEN' }, { $set: { status: 'DONE', response: 'Đã xoá (ẩn danh hoá) dữ liệu nhận diện; chứng từ tài chính được giữ theo thời hạn luật định.', handledBy: admin._id, handledAt: new Date() } }, { session });
    }
    const erased = {
      profile: 1,
      authorizedPersons: persons.modifiedCount,
      signatures: signatures.modifiedCount,
      voidedSignatures: voided.modifiedCount,
      handoverSignatures: handovers.modifiedCount,
      payoutAccounts: payouts.modifiedCount,
      claimRecipients: recipients.modifiedCount,
      gatewayOrders: gateway.modifiedCount,
      tickets: tickets.modifiedCount,
      ticketMessages: messages.modifiedCount,
      privacyNotes: privacyNotes.modifiedCount,
      serviceOrderNotes: serviceNotes.modifiedCount,
      accessRequestReasons: accessReasons.modifiedCount,
      swapRequestReasons: swapReasons.modifiedCount,
    };
    const kept = {
      contracts: await RentalContractModel.countDocuments({ customerId: v._id }).session(session),
      reservations: await ReservationModel.countDocuments({ customerId: v._id }).session(session),
      payments: await PaymentModel.countDocuments({ customerId: v._id }).session(session),
      contractFiles: await ContractFileModel.countDocuments({ customerId: v._id }).session(session),
    };
    const after = { status: v.status, source, ...(requestNumber ? { requestNumber } : {}), loginRemoved: !!firebaseUid, erased, kept };
    await audit({ action: 'user.anonymize', entityType: 'User', entityId: v._id, reason: input.reason, changes: { before, after } }, session);
    return { user: v, source, erased, kept };
  });
  if (firebaseUid) await firebaseAuth.deleteUser(firebaseUid).catch((e) => console.error('[anonymize] firebase', e instanceof Error ? e.message : e));
  return done;
}
