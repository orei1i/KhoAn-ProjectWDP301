import type { ClientSession } from 'mongoose';
import { CONTACT_WINDOW, OPEN_CONTRACT_STATUSES, RENTAL_PERIOD, TICKET_CATEGORY, type ContactWindow, type NoticeEmailStatus, type RentalPeriod, type TicketCategory, type TicketEmailKind, type TicketKind, type TicketPriority, type TicketStatus } from '@ssm/shared';
import { FacilityModel, RentalContractModel, ReservationModel, StorageUnitModel, TICKET_EMAIL_LOG_MAX, TicketModel, UnitTypeModel, UserModel, type UserHydrated } from '../../shared/db/models';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { notifyStaff, type StaffNotifyStatus } from '../notify/staff-notify';
import { mailCustomer } from '../contracts/contract-notice.service';

// ---------------------------------------------------------------- email về phiếu (báo quản lý phiếu gấp, báo khách)
/** Ghi trạng thái một email về phiếu (không lưu nội dung) — giữ TICKET_EMAIL_LOG_MAX bản gần nhất. Không bao giờ ném lỗi. */
export async function logTicketEmail(ticketId: unknown, kind: TicketEmailKind, status: NoticeEmailStatus | StaffNotifyStatus) {
  try {
    await TicketModel.updateOne({ _id: ticketId }, { $push: { emailLog: { $each: [{ kind, status, at: new Date() }], $slice: -TICKET_EMAIL_LOG_MAX } } });
  } catch (e) {
    console.error('[ticket-email]', e instanceof Error ? e.message : e);
  }
}

/** Phiếu của KHÁCH (khách tự gửi hoặc chi nhánh ghi nhận thay) — phiếu nội bộ / nhân viên tự mở thì không email khách. */
async function customerReporter(t: { kind: string; reporterId: unknown }) {
  if (t.kind !== 'CUSTOMER_ISSUE') return false;
  return !!(await UserModel.exists({ _id: t.reporterId, role: 'CUSTOMER' }));
}

/**
 * Báo khách qua email khi chi nhánh TRẢ LỜI (tin nhắn không phải ghi chú nội bộ) hoặc đã GIẢI QUYẾT phiếu. Cùng quy tắc với thông báo
 * hợp đồng (canEmailCustomer qua mailCustomer); gửi sau khi thao tác đã lưu, lỗi gửi không làm hỏng thao tác — chỉ ghi trạng thái.
 */
async function emailReporter(t: { _id: unknown; kind: string; reporterId: unknown; facilityId: unknown; ticketNumber: string; subject: string }, kind: 'CUSTOMER_REPLY' | 'CUSTOMER_RESOLVED' | 'CUSTOMER_CLOSED', reply?: string) {
  if (!(await customerReporter(t))) return;
  const facility = await FacilityModel.findById(t.facilityId, { name: 1, contact: 1 }).lean();
  const where = 'Xem và trả lời trong mục Hỗ trợ trên trang web hoặc ứng dụng KhoAn.';
  const contact = facility?.contact?.phone ? `Cần gọi trực tiếp: ${facility.name} — ${facility.contact.phone}.` : null;
  const lines = kind === 'CUSTOMER_REPLY'
    ? [`${facility?.name ?? 'Chi nhánh'} đã trả lời yêu cầu hỗ trợ ${t.ticketNumber} — "${t.subject}":`, (reply ?? '').trim().slice(0, 1500), where, contact]
    : kind === 'CUSTOMER_CLOSED'
      // Đợt 16 (C3): chi nhánh đóng phiếu CHƯA giải quyết — báo khách kèm lý do.
      ? [`${facility?.name ?? 'Chi nhánh'} đã đóng yêu cầu hỗ trợ ${t.ticketNumber} — "${t.subject}" khi chưa giải quyết. Lý do: ${(reply ?? '').trim().slice(0, 500)}`, 'Nếu vấn đề vẫn còn, bạn gửi yêu cầu mới trong mục Hỗ trợ.', contact]
      : [`Yêu cầu hỗ trợ ${t.ticketNumber} — "${t.subject}" đã được ${facility?.name ?? 'chi nhánh'} giải quyết.`, 'Nếu vấn đề vẫn còn, bạn mở lại hoặc trả lời ngay trong yêu cầu đó (mục Hỗ trợ).', contact];
  const subject = kind === 'CUSTOMER_REPLY' ? `KhoAn — Chi nhánh đã trả lời yêu cầu ${t.ticketNumber}`
    : kind === 'CUSTOMER_CLOSED' ? `KhoAn — Yêu cầu ${t.ticketNumber} đã được đóng` : `KhoAn — Yêu cầu ${t.ticketNumber} đã được giải quyết`;
  await logTicketEmail(t._id, kind, await mailCustomer(t.reporterId, subject, lines.filter(Boolean) as string[]));
}

/** Đợt 16 (C3): khách nhắn vào phiếu đã giải quyết → phiếu tự mở lại; báo người phụ trách (còn hợp lệ) hoặc quản lý chi nhánh. */
async function emailReopened(t: { _id: unknown; facilityId: unknown; ticketNumber: string; subject: string; assigneeId?: unknown }, body: string) {
  const status = await notifyStaff(t.assigneeId ? { roles: ['STAFF', 'FACILITY_MANAGER'], facilityId: t.facilityId, userIds: [t.assigneeId] } : { roles: ['FACILITY_MANAGER'], facilityId: t.facilityId },
    `KhoAn — Khách mở lại yêu cầu ${t.ticketNumber}`, [
      `Khách vừa nhắn vào yêu cầu ${t.ticketNumber} — "${t.subject}" (đã giải quyết), yêu cầu tự mở lại${t.assigneeId ? ' và vẫn do bạn phụ trách' : ' và đang chờ giao người xử lý'}.`,
      `Tin nhắn: ${body.trim().slice(0, 1000)}`,
      'Xem trong mục Yêu cầu & công việc của chi nhánh.',
    ]);
  await logTicketEmail(t._id, 'STAFF_REOPENED', status);
}

/** Lặt vặt đợt 16: mỗi khách tối đa bấy nhiêu phiếu hỗ trợ / giờ (đếm trong DB — đúng cả khi chạy nhiều tiến trình). */
export const CUSTOMER_TICKETS_PER_HOUR = 5;

export async function createTicket(user: UserHydrated, input: {
  facilityId: string; kind: TicketKind; category: TicketCategory; priority: TicketPriority; subject: string; description?: string;
  unitId?: string | null; contractId?: string | null; assigneeId?: string | null; dueAt?: string | null; onBehalfOfCustomer?: boolean;
}) {
  if (input.kind === 'OPS_TASK' && user.role !== 'FACILITY_MANAGER') throw Forbidden('Chỉ Quản lý chi nhánh được giao việc nội bộ');
  if (user.role === 'CUSTOMER') {
    // Lặt vặt đợt 16: chống spam — tối đa CUSTOMER_TICKETS_PER_HOUR phiếu / giờ; khách không tự chọn "Khẩn cấp" (tối đa Cao).
    const recent = await TicketModel.countDocuments({ reporterId: user._id, kind: 'CUSTOMER_ISSUE', recordedBy: null, category: { $ne: 'CONSULTATION' }, createdAt: { $gte: new Date(Date.now() - 3_600_000) } });
    if (recent >= CUSTOMER_TICKETS_PER_HOUR) throw new AppError(429, 'TOO_MANY_TICKETS', `Bạn đã gửi ${recent} yêu cầu trong một giờ qua — vui lòng chờ chi nhánh phản hồi rồi gửi thêm`);
    if (input.priority === 'URGENT') input = { ...input, priority: 'HIGH' };
    const related = await RentalContractModel.exists({ customerId: user._id, facilityId: input.facilityId })
      ?? await ReservationModel.exists({ customerId: user._id, facilityId: input.facilityId });
    if (!related) throw Forbidden('Bạn chỉ gửi yêu cầu tới chi nhánh đang thuê hoặc đã đặt', 'OWNERSHIP');
    if (input.contractId) {
      const c = await RentalContractModel.findById(input.contractId);
      if (!c || String(c.customerId) !== String(user._id)) throw Forbidden('Hợp đồng không thuộc về bạn', 'OWNERSHIP');
      if (String(c.facilityId) !== String(input.facilityId)) throw Unprocessable('Hợp đồng không thuộc chi nhánh đã chọn');
    }
    // Ô kho phải đang thuộc một hợp đồng CÒN MỞ của khách ở đúng chi nhánh — ô của hợp đồng cũ có thể đã cho người khác thuê.
    if (input.unitId && !(await RentalContractModel.exists({ customerId: user._id, unitId: input.unitId, facilityId: input.facilityId, status: { $in: [...OPEN_CONTRACT_STATUSES] } }))) {
      throw Forbidden('Ô kho không thuộc hợp đồng đang thuê của bạn', 'OWNERSHIP');
    }
    // Người xử lý và hạn chót do chi nhánh phân công — khách không tự đặt.
    input = { ...input, kind: 'CUSTOMER_ISSUE', assigneeId: null, dueAt: null };
  } else {
    await assertFacility(user, input.facilityId, 'ticket.create');
    // Lặt vặt đợt 16: hợp đồng / ô kho gắn vào phiếu phải thuộc đúng chi nhánh của phiếu.
    if (input.contractId && !(await RentalContractModel.exists({ _id: input.contractId, facilityId: input.facilityId }))) throw Unprocessable('Hợp đồng không thuộc chi nhánh đã chọn', 'WRONG_FACILITY');
    if (input.unitId && !(await StorageUnitModel.exists({ _id: input.unitId, facilityId: input.facilityId }))) throw Unprocessable('Ô kho không thuộc chi nhánh đã chọn', 'WRONG_FACILITY');
  }
  // Khách khiếu nại TẠI CHI NHÁNH (Điều 9 cho phép): nhân viên ghi nhận thay — phiếu đứng tên khách của hợp đồng (để điều chỉnh biên bản
  // nhận như khiếu nại của khách), lưu lại ai đã nhập; khách thấy phiếu trong tài khoản của mình.
  let reporterId = user._id;
  let recordedBy = null;
  if (input.onBehalfOfCustomer) {
    if (user.role !== 'STAFF' && user.role !== 'FACILITY_MANAGER') throw Forbidden('Chỉ nhân viên / quản lý chi nhánh ghi nhận thay khách');
    if (!input.contractId) throw Unprocessable('Ghi nhận thay khách cần chọn hợp đồng');
    const c = await RentalContractModel.findById(input.contractId, { customerId: 1, facilityId: 1 }).lean();
    if (!c || String(c.facilityId) !== String(input.facilityId)) throw Unprocessable('Hợp đồng không thuộc chi nhánh đã chọn');
    reporterId = c.customerId;
    recordedBy = user._id;
    input = { ...input, kind: 'CUSTOMER_ISSUE' };
  }
  if (input.assigneeId) await assertAssignee(input.assigneeId, input.facilityId);

  const now = new Date();
  const status: TicketStatus = input.assigneeId ? 'ASSIGNED' : 'OPEN';
  const t = await TicketModel.create({
    kind: input.kind, facilityId: input.facilityId, reporterId, recordedBy, contractId: input.contractId ?? null, unitId: input.unitId ?? null,
    category: input.category, priority: input.priority, status, subject: input.subject, description: input.description ?? '',
    assigneeId: input.assigneeId ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null,
    messages: input.description?.trim() ? [{ authorId: user._id, body: input.description.trim(), internal: false, at: now }] : [],
    statusHistory: [{ from: null, to: status, at: now, by: user._id }],
  });
  await audit({ action: 'ticket.create', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId, changes: recordedBy ? { after: { onBehalfOf: String(reporterId) } } : undefined });
  // Phiếu của KHÁCH mức HIGH / URGENT: báo ngay quản lý chi nhánh (như phiếu tư vấn) — không chờ ai mở hàng chờ mới thấy.
  if (t.kind === 'CUSTOMER_ISSUE' && (t.priority === 'URGENT' || t.priority === 'HIGH') && (user.role === 'CUSTOMER' || recordedBy)) {
    const facility = await FacilityModel.findById(t.facilityId, { name: 1 }).lean();
    const customer = recordedBy ? await UserModel.findById(reporterId, { fullName: 1 }).lean() : user;
    const status = await notifyStaff({ roles: ['FACILITY_MANAGER'], facilityId: t.facilityId }, `KhoAn — Phiếu ${t.priority === 'URGENT' ? 'KHẨN' : 'ưu tiên cao'} ${t.ticketNumber} tại ${facility?.name ?? 'chi nhánh'}`, [
      `Khách ${customer?.fullName ?? '—'} gửi yêu cầu hỗ trợ mức ${t.priority === 'URGENT' ? 'Khẩn cấp' : 'Cao'} (${TICKET_CATEGORY[t.category]}): ${t.subject}.`,
      'Phân công người xử lý trong mục Yêu cầu & công việc của chi nhánh.',
    ]);
    await logTicketEmail(t._id, 'MANAGER_ALERT', status);
    return (await TicketModel.findById(t._id)) ?? t;
  }
  return t;
}

export interface ConsultationInput {
  facilityId: string; unitTypeIds: string[]; rentalPeriod?: RentalPeriod; periods?: number;
  phone: string; contactWindow: ContactWindow;
  needs: { reviewContract: boolean; vatInvoice: boolean; customContract: boolean; multipleUnits: boolean };
  note?: string;
}
const OPEN_TICKET: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'];
const MAX_OPEN_CONSULTATIONS = 3;
const CONSULT_RESPONSE_HOURS = 24;

/**
 * Khách muốn được TƯ VẤN trước khi đặt (xem hợp đồng cùng pháp lý / kế toán, cần hoá đơn VAT, hợp đồng riêng, thuê nhiều kho…).
 * Tạo phiếu "Tư vấn thuê kho" vào hàng chờ của chi nhánh — Quản lý chi nhánh phụ trách (vai "kinh doanh"), trả lời trong luồng
 * phiếu và gọi lại theo khung giờ khách chọn. KHÔNG giữ ô kho nào: tư vấn xong khách vẫn tự đặt và ký trên tài khoản của mình.
 * Không cần đã thuê / đặt ở chi nhánh đó (khác phiếu sự cố). Tối đa 3 phiếu tư vấn đang mở mỗi khách để chống spam.
 */
export async function createConsultation(user: UserHydrated, input: ConsultationInput) {
  const facility = await FacilityModel.findById(input.facilityId, { name: 1, status: 1 }).lean();
  if (!facility || facility.status === 'INACTIVE') throw NotFound('chi nhánh');
  const open = await TicketModel.countDocuments({ reporterId: user._id, category: 'CONSULTATION', status: { $in: OPEN_TICKET } });
  if (open >= MAX_OPEN_CONSULTATIONS) {
    throw Conflict(`Bạn đang có ${open} yêu cầu tư vấn chưa xử lý xong — chi nhánh sẽ liên hệ sớm, theo dõi ở mục Hỗ trợ`, 'TOO_MANY_CONSULTATIONS');
  }
  const types = input.unitTypeIds.length
    ? await UnitTypeModel.find({ _id: { $in: input.unitTypeIds }, facilityId: facility._id }, { name: 1 }).lean()
    : [];
  const needs = [
    input.needs.reviewContract && 'xem / thống nhất hợp đồng trước khi thanh toán',
    input.needs.vatInvoice && 'xuất hoá đơn VAT (công ty)',
    input.needs.customContract && 'hợp đồng / điều khoản riêng',
    input.needs.multipleUnits && 'thuê nhiều kho',
  ].filter(Boolean) as string[];
  const body = [
    `Khách cần tư vấn trước khi đặt kho tại ${facility.name}.`,
    `Liên hệ: ${input.phone} — ${CONTACT_WINDOW[input.contactWindow]}.`,
    types.length ? `Loại kho quan tâm: ${types.map((t) => t.name).join(', ')}.` : null,
    input.rentalPeriod && input.periods ? `Thời hạn dự kiến: ${input.periods} ${RENTAL_PERIOD[input.rentalPeriod].toLowerCase()}.` : null,
    needs.length ? `Nhu cầu: ${needs.join('; ')}.` : null,
    input.note?.trim() ? `Ghi chú của khách: ${input.note.trim()}` : null,
  ].filter(Boolean).join('\n');

  const now = new Date();
  const t = await TicketModel.create({
    kind: 'CUSTOMER_ISSUE', facilityId: facility._id, reporterId: user._id, contractId: null, unitId: null,
    category: 'CONSULTATION', priority: 'MEDIUM', status: 'OPEN', subject: `Tư vấn thuê kho — ${user.fullName}`.slice(0, 200), description: body,
    // Hạn xử lý: gọi lại khách trong 1 ngày — phiếu quá hạn nổi lên đầu hàng chờ (sắp theo dueAt).
    assigneeId: null, dueAt: new Date(now.getTime() + CONSULT_RESPONSE_HOURS * 3_600_000),
    messages: [{ authorId: user._id, body, internal: false, at: now }],
    statusHistory: [{ from: null, to: 'OPEN', at: now, by: user._id }],
  });
  await audit({ action: 'ticket.consultation', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId });
  void notifyStaff({ roles: ['FACILITY_MANAGER'], facilityId: facility._id }, `KhoAn — Yêu cầu tư vấn mới ${t.ticketNumber} tại ${facility.name}`, [
    `Khách ${user.fullName} cần tư vấn trước khi đặt kho — gọi lại trong 24 giờ.`, body.replace(/\n/g, ' | '),
    'Phiếu nằm trong mục Yêu cầu & công việc của chi nhánh.',
  ]);
  return t;
}

/** Người được giao phải là nhân viên / quản lý ĐANG HOẠT ĐỘNG của đúng chi nhánh — không giao cho tài khoản bị khoá (giống loadMover bên swaps). */
async function assertAssignee(assigneeId: string, facilityId: unknown, session?: ClientSession) {
  const staff = await UserModel.findById(assigneeId, { role: 1, status: 1, facilityIds: 1 }).session(session ?? null);
  if (!staff || !['STAFF', 'FACILITY_MANAGER'].includes(staff.role) || !staff.facilityIds.some((f) => String(f) === String(facilityId)))
    throw Unprocessable('Nhân viên không thuộc chi nhánh này');
  if (staff.status !== 'ACTIVE') throw Unprocessable('Nhân viên này đang không hoạt động (bị khoá / chưa kích hoạt) — chọn người khác', 'INACTIVE_ASSIGNEE');
  // Trong giao dịch: ghi chạm hồ sơ nhân viên để giao việc và admin khoá cùng lúc xung đột ghi (một bên chạy lại, thấy trạng thái mới).
  if (session) await UserModel.updateOne({ _id: staff._id, status: 'ACTIVE' }, { $set: { updatedAt: new Date() } }, { session });
}

/** Người phụ trách còn nhận được phiếu của chi nhánh này không (đang hoạt động, đúng vai trò, đúng chi nhánh). */
async function assigneeStillValid(assigneeId: unknown, facilityId: unknown, session: ClientSession) {
  const u = await UserModel.findById(assigneeId, { role: 1, status: 1, facilityIds: 1 }).session(session);
  return !!u && u.status === 'ACTIVE' && ['STAFF', 'FACILITY_MANAGER'].includes(u.role) && u.facilityIds.some((f) => String(f) === String(facilityId));
}

const load = async (id: string, session?: ClientSession) => {
  const t = await TicketModel.findById(id).session(session ?? null);
  if (!t) throw NotFound('yêu cầu');
  return t;
};

export async function assignTicket(user: UserHydrated, id: string, assigneeId: string) {
  return withTxn(async (session) => {
    const t = await load(id, session);
    await assertFacility(user, t.facilityId, 'ticket.assign');
    await assertAssignee(assigneeId, t.facilityId, session);
    t.set('assigneeId', assigneeId);
    if (t.status === 'OPEN') t.transitionTo('ASSIGNED', { actor: user.role, by: user._id });
    await t.save({ session });
    await audit({ action: 'ticket.assign', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId, changes: { after: { assigneeId } } }, session);
    return t;
  });
}

export async function setTicketStatus(user: UserHydrated, id: string, to: TicketStatus, reason?: string) {
  const why = reason?.trim() ?? '';
  let closedUnresolved = false;
  const t = await withTxn(async (session) => {
    const t = await load(id, session);
    await assertCanAccess(user, t, 'ticket.status');
    if (user.role === 'CUSTOMER' && t.kind !== 'CUSTOMER_ISSUE') throw NotFound('yêu cầu');
    const reopened = t.status === 'RESOLVED' && to === 'IN_PROGRESS';
    // Đợt 16 (C3): chi nhánh đóng phiếu CHƯA giải quyết → bắt buộc lý do (khách thấy trong phiếu + email).
    closedUnresolved = to === 'CLOSED' && user.role !== 'CUSTOMER' && t.status !== 'RESOLVED';
    if (closedUnresolved && why.length < 5) throw Unprocessable('Đóng yêu cầu chưa giải quyết — ghi lý do (ít nhất 5 ký tự), khách nhận được qua email', 'CLOSE_REASON_REQUIRED');
    t.transitionTo(to, { actor: user.role, by: user._id, reason: closedUnresolved ? why : undefined });
    if (closedUnresolved) {
      t.closeReason = why.slice(0, 500);
      t.messages.push({ authorId: user._id, body: `Chi nhánh đóng yêu cầu: ${why}`.slice(0, 5000), internal: false, at: new Date() });
    }
    // Quản lý trả phiếu về hàng chờ: bỏ người phụ trách — phiếu không còn nằm ở "Được giao cho tôi" của nhân viên.
    if (to === 'OPEN') t.set('assigneeId', null);
    // Mở lại phiếu mà người phụ trách đã nghỉ / bị khoá / chuyển chi nhánh: đưa về "chưa giao" để quản lý giao người khác,
    // thay vì phiếu đang xử lý lại đứng tên người không còn nhận việc. Còn hợp lệ thì ghi chạm hồ sơ của họ (như khi giao việc)
    // để admin khoá đúng lúc này thì hai giao dịch xung đột, không lọt.
    if (reopened && t.assigneeId) {
      if (await assigneeStillValid(t.assigneeId, t.facilityId, session)) {
        await UserModel.updateOne({ _id: t.assigneeId, status: 'ACTIVE' }, { $set: { updatedAt: new Date() } }, { session });
      } else {
        t.set('assigneeId', null);
        t.transitionTo('OPEN', { actor: 'SYSTEM', reason: 'Người phụ trách cũ không còn hoạt động ở chi nhánh — chờ giao lại' });
      }
    }
    await t.save({ session });
    await audit({ action: 'ticket.status', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId, changes: { after: { status: t.status } } }, session);
    return t;
  });
  // Chi nhánh giải quyết xong / đóng phiếu chưa giải quyết → báo khách (sau khi đã lưu).
  if ((to === 'RESOLVED' || closedUnresolved) && user.role !== 'CUSTOMER') {
    await emailReporter(t, closedUnresolved ? 'CUSTOMER_CLOSED' : 'CUSTOMER_RESOLVED', why);
    return (await TicketModel.findById(t._id)) ?? t;
  }
  return t;
}

export async function addTicketMessage(user: UserHydrated, id: string, body: string, internal: boolean) {
  const isInternal = user.role === 'CUSTOMER' ? false : internal;
  let reopened = false;
  // Đợt 16 (C3): khách nhắn vào phiếu ĐÃ GIẢI QUYẾT → phiếu tự mở lại (IN_PROGRESS; người phụ trách không còn hợp lệ thì về OPEN chờ giao) —
  // trong transaction như setTicketStatus.
  const t = await withTxn(async (session) => {
    const t = await load(id, session);
    await assertCanAccess(user, t, 'ticket.message');
    if (user.role === 'CUSTOMER' && t.kind !== 'CUSTOMER_ISSUE') throw NotFound('yêu cầu');
    if (t.status === 'CLOSED') throw Unprocessable('Yêu cầu đã đóng');
    t.messages.push({ authorId: user._id, body, internal: isInternal, at: new Date() });
    reopened = user.role === 'CUSTOMER' && t.status === 'RESOLVED';
    if (reopened) {
      const valid = !!t.assigneeId && await assigneeStillValid(t.assigneeId, t.facilityId, session);
      if (valid) {
        await UserModel.updateOne({ _id: t.assigneeId, status: 'ACTIVE' }, { $set: { updatedAt: new Date() } }, { session });
        t.transitionTo('IN_PROGRESS', { actor: user.role, by: user._id, reason: 'Khách nhắn thêm — mở lại yêu cầu' });
      } else {
        t.set('assigneeId', null);
        t.transitionTo('IN_PROGRESS', { actor: user.role, by: user._id, reason: 'Khách nhắn thêm — mở lại yêu cầu' });
        t.transitionTo('OPEN', { actor: 'SYSTEM', reason: 'Người phụ trách cũ không còn hoạt động ở chi nhánh — chờ giao lại' });
      }
      t.resolvedAt = null;
      await audit({ action: 'ticket.reopen', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId, changes: { after: { status: t.status, byCustomerMessage: true } } }, session);
    }
    await t.save({ session });
    return t;
  });
  if (reopened) {
    await emailReopened(t, body);
    return (await TicketModel.findById(t._id)) ?? t;
  }
  // Chi nhánh trả lời khách → email khách kèm nội dung trả lời. Ghi chú NỘI BỘ không bao giờ gửi đi.
  if (user.role !== 'CUSTOMER' && !isInternal) {
    await emailReporter(t, 'CUSTOMER_REPLY', body);
    return (await TicketModel.findById(t._id)) ?? t;
  }
  return t;
}

/** Customers never see internal staff notes. */
export const redactForCustomer = <T extends { messages: { internal: boolean }[] }>(t: T, isCustomer: boolean) =>
  isCustomer ? { ...t, messages: t.messages.filter((m) => !m.internal) } : t;
