import { Types, type ClientSession } from 'mongoose';
import type { PaymentMethod } from '@ssm/shared';
import { FacilityModel, PaymentModel, RentalContractModel, ServiceOfferingModel, ServiceOrderModel, type UserHydrated } from '../../shared/db/models';
import { Conflict, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment, refundMethodFor } from '../payments/payment.service';
import { todayUTC, toDateOnly } from '../../shared/utils/dates';

// ---------------------------------------------------------------- danh mục dịch vụ (OPS)
export async function createOffering(facilityId: string, input: { code: string; name: string; description?: string; price: number; unitLabel: string }) {
  const f = await FacilityModel.findById(facilityId);
  if (!f) throw NotFound('chi nhánh');
  const code = input.code.trim().toUpperCase();
  if (await ServiceOfferingModel.exists({ facilityId: f._id, code })) throw Conflict(`Mã dịch vụ ${code} đã tồn tại trong chi nhánh này`);
  const s = await ServiceOfferingModel.create({ facilityId: f._id, code, name: input.name.trim(), description: input.description, price: input.price, unitLabel: input.unitLabel.trim() });
  await audit({ action: 'service_offering.create', entityType: 'ServiceOffering', entityId: s._id, facilityId: f._id, changes: { after: { code, name: s.name, price: s.price } } });
  return s;
}

export async function updateOffering(id: string, patch: { name?: string; description?: string; price?: number; unitLabel?: string; isActive?: boolean }) {
  const s = await ServiceOfferingModel.findById(id);
  if (!s) throw NotFound('dịch vụ');
  const before = { name: s.name, price: s.price, unitLabel: s.unitLabel, isActive: s.isActive };
  if (patch.name !== undefined) s.name = patch.name.trim();
  if (patch.description !== undefined) s.description = patch.description;
  if (patch.price !== undefined) s.price = patch.price;
  if (patch.unitLabel !== undefined) s.unitLabel = patch.unitLabel.trim();
  if (patch.isActive !== undefined) s.isActive = patch.isActive;
  await s.save();
  await audit({ action: 'service_offering.update', entityType: 'ServiceOffering', entityId: s._id, facilityId: s.facilityId, changes: { before, after: { name: s.name, price: s.price, unitLabel: s.unitLabel, isActive: s.isActive } } });
  return s;
}

/** Xoá mềm — đơn đã đặt giữ nguyên tên/giá đã chốt nên xoá danh mục không ảnh hưởng lịch sử. */
export async function deleteOffering(id: string) {
  const s = await ServiceOfferingModel.findById(id);
  if (!s) throw NotFound('dịch vụ');
  s.set({ isDeleted: true, deletedAt: new Date() });
  await s.save();
  await audit({ action: 'service_offering.delete', entityType: 'ServiceOffering', entityId: s._id, facilityId: s.facilityId });
  return { id: String(s._id) };
}

// ---------------------------------------------------------------- đặt dịch vụ (CUSTOMER chủ hợp đồng)
/** Khách trả tiền ngay lúc đặt (như gia hạn); nhân viên xác nhận xong sau, hoặc huỷ để hoàn đủ tiền. */
export async function orderService(user: UserHydrated, input: {
  contractId: string; serviceId: string; quantity: number; preferredDate?: string; note?: string; method: PaymentMethod;
}) {
  return withTxn(async (session) => {
    const c = await RentalContractModel.findById(input.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertCanAccess(user, c, 'service.order');
    if (c.status !== 'ACTIVE') throw Unprocessable('Chỉ đặt dịch vụ cho hợp đồng đang hiệu lực, không có công nợ');
    if (user.role === 'CUSTOMER' && input.method === 'CASH') throw Unprocessable('Thanh toán tiền mặt chỉ thực hiện tại quầy');
    const svc = await ServiceOfferingModel.findOne({ _id: input.serviceId, facilityId: c.facilityId, isActive: true }).session(session);
    if (!svc) throw Unprocessable('Dịch vụ không còn được cung cấp tại chi nhánh này');
    const preferredDate = input.preferredDate ? toDateOnly(input.preferredDate) : null;
    if (preferredDate && preferredDate < todayUTC()) throw Unprocessable('Ngày mong muốn không được ở quá khứ');

    const total = svc.price * input.quantity;
    const pay = await createPayment({
      facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SERVICE', amount: total, status: 'SUCCEEDED', method: input.method,
      recordedBy: input.method === 'CASH' ? user._id : null,
    }, session);
    const id = new Types.ObjectId();
    const [order] = await ServiceOrderModel.create([{
      _id: id, facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, serviceId: svc._id,
      serviceName: svc.name, unitPrice: svc.price, unitLabel: svc.unitLabel, quantity: input.quantity, total,
      preferredDate, note: input.note, status: 'REQUESTED', paymentId: pay._id,
    }], { session });
    await audit({ action: 'service.order', entityType: 'ServiceOrder', entityId: id, facilityId: c.facilityId, changes: { after: { orderNumber: order.orderNumber, service: svc.name, quantity: input.quantity, total } } }, session);
    return order;
  });
}

// ---------------------------------------------------------------- xác nhận đã thực hiện (STAFF, FM)
export async function completeServiceOrder(user: UserHydrated, id: string) {
  return withTxn(async (session) => {
    const o = await ServiceOrderModel.findById(id).session(session);
    if (!o) throw NotFound('đơn dịch vụ');
    await assertFacility(user, o.facilityId, 'service.complete');
    o.transitionTo('DONE', { actor: user.role, by: user._id });
    o.completedAt = new Date();
    o.completedBy = user._id;
    await o.save({ session });
    await audit({ action: 'service.complete', entityType: 'ServiceOrder', entityId: o._id, facilityId: o.facilityId }, session);
    return o;
  });
}

// ---------------------------------------------------------------- huỷ trước khi thực hiện → hoàn đủ tiền
/**
 * Khách đã bàn giao kho / hợp đồng đóng: đơn dịch vụ còn chờ làm không thực hiện được nữa → huỷ và hoàn đủ tiền đã trả.
 * Gọi TRONG transaction của thao tác làm hợp đồng đổi trạng thái.
 */
export async function cancelOpenServiceOrders(contractId: Types.ObjectId, session: ClientSession, reason: string) {
  const open = await ServiceOrderModel.find({ contractId, status: 'REQUESTED' }).session(session);
  for (const o of open) {
    o.transitionTo('CANCELLED', { actor: 'SYSTEM', reason });
    o.cancelReason = reason;
    const paid = o.paymentId ? await PaymentModel.findById(o.paymentId).session(session) : null;
    if (paid && paid.status === 'SUCCEEDED') {
      const refund = await createPayment({
        facilityId: o.facilityId, customerId: o.customerId, contractId: o.contractId, type: 'REFUND', amount: o.total,
        status: 'SUCCEEDED', method: refundMethodFor(paid.method), refundOf: paid._id,
      }, session);
      paid.refundedAmount = o.total;
      paid.transitionTo('REFUNDED', { actor: 'SYSTEM', reason: 'Huỷ đơn dịch vụ' });
      await paid.save({ session });
      o.refundPaymentId = refund._id;
    }
    await o.save({ session });
    await audit({ action: 'service.cancel', entityType: 'ServiceOrder', entityId: o._id, facilityId: o.facilityId, reason, changes: { after: { refund: o.total } } }, session);
  }
  return open.length;
}

export async function cancelServiceOrder(user: UserHydrated, id: string, reason?: string) {
  return withTxn(async (session) => {
    const o = await ServiceOrderModel.findById(id).session(session);
    if (!o) throw NotFound('đơn dịch vụ');
    await assertCanAccess(user, o, 'service.cancel');
    o.transitionTo('CANCELLED', { actor: user.role, by: user._id, reason });
    o.cancelReason = reason ?? (user.role === 'CUSTOMER' ? 'Khách huỷ' : 'Chi nhánh huỷ');

    const paid = o.paymentId ? await PaymentModel.findById(o.paymentId).session(session) : null;
    if (paid && paid.status === 'SUCCEEDED') {
      const refund = await createPayment({
        facilityId: o.facilityId, customerId: o.customerId, contractId: o.contractId, type: 'REFUND', amount: o.total,
        status: 'SUCCEEDED', method: refundMethodFor(paid.method), refundOf: paid._id,
      }, session);
      paid.refundedAmount = o.total;
      paid.transitionTo('REFUNDED', { actor: 'SYSTEM', by: user._id, reason: 'Huỷ đơn dịch vụ' });
      await paid.save({ session });
      o.refundPaymentId = refund._id;
    }
    await o.save({ session });
    await audit({ action: 'service.cancel', entityType: 'ServiceOrder', entityId: o._id, facilityId: o.facilityId, reason: o.cancelReason ?? undefined, changes: { after: { refund: o.total } } }, session);
    return o;
  });
}
