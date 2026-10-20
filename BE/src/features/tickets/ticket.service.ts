import type { ClientSession } from 'mongoose';
import { CONTACT_WINDOW, OPEN_CONTRACT_STATUSES, RENTAL_PERIOD, type ContactWindow, type RentalPeriod, type TicketCategory, type TicketKind, type TicketPriority, type TicketStatus } from '@ssm/shared';
import { FacilityModel, RentalContractModel, ReservationModel, TicketModel, UnitTypeModel, UserModel, type UserHydrated } from '../../shared/db/models';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { notifyStaff } from '../notify/staff-notify';

export async function createTicket(user: UserHydrated, input: {
  facilityId: string; kind: TicketKind; category: TicketCategory; priority: TicketPriority; subject: string; description?: string;
  unitId?: string | null; contractId?: string | null; assigneeId?: string | null; dueAt?: string | null;
}) {
  if (input.kind === 'OPS_TASK' && user.role !== 'FACILITY_MANAGER') throw Forbidden('Chỉ Quản lý chi nhánh được giao việc nội bộ');
  if (user.role === 'CUSTOMER') {
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
  }
  if (input.assigneeId) await assertAssignee(input.assigneeId, input.facilityId);

  const now = new Date();
  const status: TicketStatus = input.assigneeId ? 'ASSIGNED' : 'OPEN';
  const t = await TicketModel.create({
    kind: input.kind, facilityId: input.facilityId, reporterId: user._id, contractId: input.contractId ?? null, unitId: input.unitId ?? null,
    category: input.category, priority: input.priority, status, subject: input.subject, description: input.description ?? '',
    assigneeId: input.assigneeId ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null,
    messages: input.description?.trim() ? [{ authorId: user._id, body: input.description.trim(), internal: false, at: now }] : [],
    statusHistory: [{ from: null, to: status, at: now, by: user._id }],
  });
  await audit({ action: 'ticket.create', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId });
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

export async function setTicketStatus(user: UserHydrated, id: string, to: TicketStatus) {
  return withTxn(async (session) => {
    const t = await load(id, session);
    await assertCanAccess(user, t, 'ticket.status');
    const reopened = t.status === 'RESOLVED' && to === 'IN_PROGRESS';
    t.transitionTo(to, { actor: user.role, by: user._id });
    // Mở lại phiếu mà người phụ trách đã nghỉ / bị khoá / chuyển chi nhánh: đưa về "chưa giao" để quản lý giao người khác,
    // thay vì phiếu đang xử lý lại đứng tên người không còn nhận việc.
    if (reopened && t.assigneeId && !(await assigneeStillValid(t.assigneeId, t.facilityId, session))) {
      t.set('assigneeId', null);
      t.transitionTo('OPEN', { actor: 'SYSTEM', reason: 'Người phụ trách cũ không còn hoạt động ở chi nhánh — chờ giao lại' });
    }
    await t.save({ session });
    await audit({ action: 'ticket.status', entityType: 'SupportTicket', entityId: t._id, facilityId: t.facilityId, changes: { after: { status: t.status } } }, session);
    return t;
  });
}

export async function addTicketMessage(user: UserHydrated, id: string, body: string, internal: boolean) {
  const t = await load(id);
  await assertCanAccess(user, t, 'ticket.message');
  if (t.status === 'CLOSED') throw Unprocessable('Yêu cầu đã đóng');
  t.messages.push({ authorId: user._id, body, internal: user.role === 'CUSTOMER' ? false : internal, at: new Date() });
  await t.save();
  return t;
}

/** Customers never see internal staff notes. */
export const redactForCustomer = <T extends { messages: { internal: boolean }[] }>(t: T, isCustomer: boolean) =>
  isCustomer ? { ...t, messages: t.messages.filter((m) => !m.internal) } : t;
