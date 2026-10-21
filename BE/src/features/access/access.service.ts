import { Types, type ClientSession } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { accessFeeOf, MAX_AUTHORIZED_PERSONS, type AccessMethod, type AccessRequestType, type PaymentMethod } from '@ssm/shared';
import {
  PaymentModel, RentalContractModel, type UserHydrated,
} from '../../shared/db/models';
import { AccessRequestModel, type AccessRequestHydrated } from './access-request.model';
import { Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { decryptSecret, encryptSecret } from '../../shared/crypto/secret-box';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment, refundMethodFor, sha256, sixDigitPin } from '../payments/payment.service';
import { effectivePolicy } from '../policies/pricing';

/** Loại yêu cầu theo hình thức khoá của ô — khách không tự chọn. */
const TYPE_BY_METHOD: Record<AccessMethod, AccessRequestType> = { PIN: 'PIN_RESET', RFID_CARD: 'CARD_REISSUE', PHYSICAL_KEY: 'KEY_REISSUE' };

/** Hợp đồng còn giữ ô và chưa bị khoá truy cập thì mới cấp lại được. */
const REQUESTABLE_CONTRACT_STATUS = ['ACTIVE', 'DELINQUENT', 'MOVE_OUT_PENDING'];

// ---------------------------------------------------------------- khách xem phương tiện vào kho
/**
 * Chỉ CHỦ hợp đồng xem được (nhân viên/quản lý không bao giờ thấy mật khẩu). Mỗi lần xem ghi nhật ký. PIN lưu mã hoá
 * AES-GCM; hợp đồng cũ chỉ có bản băm một chiều → `pin: null` + `reason: 'NOT_STORED'`, khách xin đặt lại để nhận mã mới.
 */
export async function getContractAccess(user: UserHydrated, contractId: string) {
  const c = await RentalContractModel.findById(contractId).select('+access.credentialEnc');
  if (!c) throw NotFound('hợp đồng');
  await assertCanAccess(user, c, 'contract.access_view');
  if (user.role !== 'CUSTOMER') throw Forbidden('Chỉ chủ hợp đồng xem được mã vào kho', 'OWNER_ONLY');

  const method = c.access.method;
  const suspended = !!c.access.suspendedAt || c.status === 'LOCKED_OUT';
  let pin: string | null = null;
  let reason: 'NOT_STORED' | 'SUSPENDED' | 'NOT_PIN' | null = null;
  if (method !== 'PIN') reason = 'NOT_PIN';
  else if (suspended) reason = 'SUSPENDED';
  else {
    pin = decryptSecret(c.access.credentialEnc);
    if (!pin) reason = 'NOT_STORED';
  }
  if (pin) await audit({ action: 'contract.access_view', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId });
  return { method, keyTag: c.access.keyTag ?? null, issuedAt: c.access.issuedAt ?? null, suspended, pin, reason };
}

// ---------------------------------------------------------------- người được uỷ quyền (CUSTOMER chủ hợp đồng)
/** Chỉ CHỦ hợp đồng thêm / xoá. Tối đa 3 người; trùng 4 số cuối giấy tờ + họ tên thì coi là đã có. Mỗi thay đổi ghi nhật ký. */
export async function addAuthorizedPerson(user: UserHydrated, contractId: string, input: { fullName: string; phone: string; idNumberLast4: string; relationship?: string }) {
  return withTxn(async (session) => {
    const c = await RentalContractModel.findById(contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertCanAccess(user, c, 'contract.authorize_person');
    if (user.role !== 'CUSTOMER') throw Forbidden('Chỉ chủ hợp đồng đăng ký người được uỷ quyền', 'OWNER_ONLY');
    if (c.status === 'CLOSED') throw Unprocessable('Hợp đồng đã kết thúc');
    const list = c.authorizedPersons ?? [];
    if (list.length >= MAX_AUTHORIZED_PERSONS) throw Unprocessable(`Mỗi hợp đồng tối đa ${MAX_AUTHORIZED_PERSONS} người được uỷ quyền`, 'AUTHORIZED_LIMIT');
    const fullName = input.fullName.trim();
    if (list.some((p) => p.idNumberLast4 === input.idNumberLast4 && p.fullName.toLowerCase() === fullName.toLowerCase())) throw Conflict('Người này đã có trong danh sách', 'AUTHORIZED_DUPLICATE');
    const person = { _id: randomUUID(), fullName, phone: input.phone.trim(), idNumberLast4: input.idNumberLast4, relationship: input.relationship?.trim() || null, addedAt: new Date() };
    c.authorizedPersons = [...list, person];
    await c.save({ session });
    await audit({ action: 'contract.authorize_person', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { fullName, idNumberLast4: person.idNumberLast4 } } }, session);
    return c;
  });
}

export async function removeAuthorizedPerson(user: UserHydrated, contractId: string, personId: string) {
  return withTxn(async (session) => {
    const c = await RentalContractModel.findById(contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertCanAccess(user, c, 'contract.revoke_person');
    if (user.role !== 'CUSTOMER') throw Forbidden('Chỉ chủ hợp đồng xoá người được uỷ quyền', 'OWNER_ONLY');
    const person = (c.authorizedPersons ?? []).find((p) => p._id === personId);
    if (!person) throw NotFound('người được uỷ quyền');
    c.authorizedPersons = (c.authorizedPersons ?? []).filter((p) => p._id !== personId);
    await c.save({ session });
    await audit({ action: 'contract.revoke_person', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { before: { fullName: person.fullName, idNumberLast4: person.idNumberLast4 } } }, session);
    return c;
  });
}

// ---------------------------------------------------------------- mở kho hộ khách (STAFF, FM)
/**
 * Khách mất chìa / mất thẻ mà cần vào kho GẤP: nhân viên xác minh danh tính tại quầy rồi mở bằng chìa tổng / thẻ tổng
 * của chi nhánh. Hệ thống không điều khiển ổ khoá — việc ở đây là GHI NHẬT KÝ không sửa xoá được (ai mở, lúc nào, vì sao),
 * khách xem được trong tài khoản. Đó là bằng chứng bảo vệ cả khách lẫn chi nhánh khi có tranh chấp.
 *
 * Không áp dụng cho ô khoá mật khẩu (không có "mã tổng": khách xem lại mã trong app hoặc xin đặt lại), và không dùng
 * để vượt lệnh khoá do công nợ.
 */
export async function assistedOpen(user: UserHydrated, contractId: string, input: { reason: string; authorizedPersonId?: string }) {
  return withTxn(async (session) => {
    const c = await RentalContractModel.findById(contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertFacility(user, c.facilityId, 'contract.assisted_open');
    if (!REQUESTABLE_CONTRACT_STATUS.includes(c.status) || c.access.suspendedAt) {
      throw Unprocessable('Hợp đồng đang bị khoá truy cập do công nợ hoặc đã kết thúc — không mở hộ được', 'ACCESS_SUSPENDED');
    }
    // Đã nhận lại kho (chờ kiểm tra / quyết toán): khách không còn quyền vào kho.
    if (c.access.revokedAt) throw Unprocessable('Kho đã bàn giao lại cho chi nhánh — không mở hộ nữa', 'ALREADY_RETURNED');
    // Ô khoá mật khẩu là khoá số VẬT LÝ, khách tự đặt mật khẩu trên ổ khoá nên hệ thống không biết mật khẩu hiện tại. Khách quên
    // thì cũng ra quầy như mất chìa / mất thẻ: nhân viên xác minh danh tính rồi mở và đặt lại ổ khoá tại chỗ — vẫn ghi nhật ký ở đây.
    // Người đến quầy là NGƯỜI ĐƯỢC UỶ QUYỀN chứ không phải chủ hợp đồng → phải có trong danh sách khách đã đăng ký.
    const person = input.authorizedPersonId ? (c.authorizedPersons ?? []).find((p) => p._id === input.authorizedPersonId) : null;
    if (input.authorizedPersonId && !person) throw Unprocessable('Người này không có trong danh sách được uỷ quyền của hợp đồng', 'NOT_AUTHORIZED_PERSON');
    const now = new Date();
    const entry = { at: now, by: user._id, byName: user.fullName, reason: input.reason.trim(), forName: person?.fullName ?? null };
    c.set('access.assistedOpens', [...(c.access.assistedOpens ?? []), entry].slice(-50));
    await c.save({ session });
    await audit({ action: 'contract.assisted_open', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: entry.reason, changes: { after: { method: c.access.method, by: user.fullName, forAuthorizedPerson: person?.fullName ?? null } } }, session);
    return c;
  });
}

// ---------------------------------------------------------------- gửi yêu cầu (CUSTOMER chủ hợp đồng)
/** Phí (nếu có) trả ngay khi gửi, như đặt dịch vụ; bị từ chối hoặc huỷ trước khi xong thì hoàn đủ. */
export async function createAccessRequest(user: UserHydrated, input: { contractId: string; reason?: string; method?: PaymentMethod }) {
  return withTxn(async (session) => {
    const c = await RentalContractModel.findById(input.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertCanAccess(user, c, 'access.request');
    if (!REQUESTABLE_CONTRACT_STATUS.includes(c.status)) throw Unprocessable('Hợp đồng đang bị khoá truy cập hoặc đã kết thúc — hãy liên hệ chi nhánh');
    if (c.access.revokedAt) throw Unprocessable('Kho đã bàn giao lại cho chi nhánh — không cấp lại thẻ / chìa nữa', 'ALREADY_RETURNED');
    if (await AccessRequestModel.exists({ contractId: c._id, status: { $in: ['REQUESTED', 'APPROVED'] } }).session(session)) {
      throw Conflict('Kho này đang có một yêu cầu cấp lại chưa xử lý xong', 'REQUEST_PENDING');
    }

    // Ổ khoá mật khẩu là khoá vật lý: khách tự đổi mật khẩu ngay trên ổ khoá, hệ thống không cấp / đặt lại mật khẩu.
    if (c.access.method === 'PIN') throw Unprocessable('Ô kho này dùng ổ khoá mật khẩu vật lý — bạn tự đổi mật khẩu ngay trên ổ khoá. Nếu quên mật khẩu, hãy đến quầy chi nhánh để nhân viên xác minh danh tính và mở, đặt lại ổ khoá giúp bạn.', 'PIN_SELF_SERVICE');
    const type = TYPE_BY_METHOD[c.access.method];
    const policy = await effectivePolicy(c.facilityId, session);
    const fee = accessFeeOf(policy, type);
    let paymentId: Types.ObjectId | null = null;
    if (fee > 0) {
      if (!input.method) throw Unprocessable('Chọn hình thức thanh toán phí cấp lại', 'PAYMENT_METHOD_REQUIRED');
      if (user.role === 'CUSTOMER' && input.method === 'CASH') throw Unprocessable('Thanh toán tiền mặt chỉ thực hiện tại quầy');
      const pay = await createPayment({
        facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'ACCESS_FEE', amount: fee, status: 'SUCCEEDED', method: input.method,
      }, session);
      paymentId = pay._id;
    }

    const id = new Types.ObjectId();
    const [req] = await AccessRequestModel.create([{
      _id: id, facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, unitId: c.unitId,
      type, accessMethod: c.access.method, reason: input.reason?.trim() || undefined, fee, status: 'REQUESTED', paymentId,
    }], { session });
    // Mất thẻ / chìa: đánh dấu NGAY lúc khách báo — thẻ cũ bị vô hiệu, không chờ tới lúc bàn giao thẻ mới.
    if (type !== 'PIN_RESET') { c.set('access.lostReportedAt', new Date()); await c.save({ session }); }
    await audit({ action: 'access.request', entityType: 'AccessRequest', entityId: id, facilityId: c.facilityId, changes: { after: { requestNumber: req.requestNumber, type, fee, oldCredentialBlocked: type !== 'PIN_RESET' } } }, session);
    return req;
  });
}

/**
 * KHÁCH tự huỷ yêu cầu cấp lại thẻ/chìa (tìm lại được) → thẻ/chìa cũ dùng lại bình thường. Chi nhánh từ chối / huỷ thì KHÔNG gỡ:
 * thẻ khách đã báo mất bị vô hiệu ngay (Điều 5) — khách gửi yêu cầu mới hoặc nhân viên mở hộ tại quầy.
 */
async function clearLostFlag(o: AccessRequestHydrated, session: ClientSession) {
  if (o.type === 'PIN_RESET') return;
  await RentalContractModel.updateOne({ _id: o.contractId }, { $set: { 'access.lostReportedAt': null } }, { session });
}

/** Hoàn đủ phí khi từ chối/huỷ. */
async function refundFee(o: AccessRequestHydrated, by: Types.ObjectId | null, reason: string, session: ClientSession) {
  if (!o.paymentId || o.fee <= 0) return;
  const paid = await PaymentModel.findById(o.paymentId).session(session);
  if (!paid || paid.status !== 'SUCCEEDED') return;
  const refund = await createPayment({
    facilityId: o.facilityId, customerId: o.customerId, contractId: o.contractId, type: 'REFUND', amount: o.fee,
    status: 'SUCCEEDED', method: refundMethodFor(paid.method), refundOf: paid._id,
  }, session);
  paid.refundedAmount = o.fee;
  paid.transitionTo('REFUNDED', { actor: 'SYSTEM', by, reason });
  await paid.save({ session });
  o.refundPaymentId = refund._id;
}

// ---------------------------------------------------------------- duyệt / từ chối (chỉ FACILITY_MANAGER)
export async function decideAccessRequest(user: UserHydrated, id: string, input: { approve: boolean; note?: string }) {
  return withTxn(async (session) => {
    const o = await AccessRequestModel.findById(id).session(session);
    if (!o) throw NotFound('yêu cầu');
    await assertFacility(user, o.facilityId, 'access.decide');
    const now = new Date();

    if (!input.approve) {
      if (!input.note?.trim()) throw Unprocessable('Cần ghi lý do từ chối');
      o.transitionTo('REJECTED', { actor: user.role, by: user._id, reason: input.note });
      o.decisionNote = input.note.trim();
      o.decidedBy = user._id; o.decidedAt = now;
      await refundFee(o, user._id, 'Yêu cầu cấp lại bị từ chối', session); // thẻ báo mất vẫn bị vô hiệu
      await o.save({ session });
      await audit({ action: 'access.reject', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, reason: o.decisionNote, changes: { after: { refund: o.fee } } }, session);
      return o;
    }

    const c = await RentalContractModel.findById(o.contractId).session(session);
    if (!c || !REQUESTABLE_CONTRACT_STATUS.includes(c.status)) throw Unprocessable('Hợp đồng không còn ở trạng thái cấp lại được');
    o.transitionTo('APPROVED', { actor: user.role, by: user._id });
    o.decidedBy = user._id; o.decidedAt = now;
    if (input.note?.trim()) o.decisionNote = input.note.trim();

    if (o.type === 'PIN_RESET') {
      // Mật khẩu: cấp mã mới ngay khi duyệt; người duyệt KHÔNG thấy mã — chỉ chủ hợp đồng xem được trong app.
      const pin = sixDigitPin();
      c.set('access.credentialHash', sha256(pin));
      c.set('access.credentialEnc', encryptSecret(pin));
      c.set('access.issuedAt', now);
      c.set('access.issuedBy', user._id);
      await c.save({ session });
      o.transitionTo('DONE', { actor: 'SYSTEM', by: user._id, reason: 'Đã cấp mật khẩu mới' });
      o.completedAt = now;
    }
    await o.save({ session });
    await audit({ action: 'access.approve', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, changes: { after: { type: o.type, status: o.status } } }, session);
    return o;
  });
}

/**
 * Tự huỷ các yêu cầu cấp lại còn mở của hợp đồng và HOÀN PHÍ — khi kho đã bàn giao lại, đồ bỏ lại đã xử lý, hoặc đổi sang ô khác
 * hình thức khoá (`keepMethod` = hình thức khoá còn dùng được: yêu cầu cùng hình thức thì giữ). Khách không phải trả phí cho thẻ /
 * chìa không bao giờ nhận được, và nhân viên không thể "hoàn tất" ghi số thẻ lên hợp đồng đã đóng hay ô dùng khoá khác.
 */
export async function cancelOpenAccessRequests(contractId: Types.ObjectId, reason: string, session: ClientSession, keepMethod?: AccessMethod) {
  const open = await AccessRequestModel.find({ contractId, status: { $in: ['REQUESTED', 'APPROVED'] } }).session(session);
  for (const o of open) {
    if (keepMethod && o.accessMethod === keepMethod) continue;
    o.transitionTo('CANCELLED', { actor: 'SYSTEM', reason });
    o.cancelReason = reason;
    await refundFee(o, null, reason, session);
    await o.save({ session });
    await audit({ action: 'access.cancel', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, reason, changes: { after: { refund: o.fee, auto: true } } }, session);
  }
}

// ---------------------------------------------------------------- bàn giao thẻ / chìa mới (STAFF, FM)
export async function completeAccessRequest(user: UserHydrated, id: string, input: { keyTag: string }) {
  return withTxn(async (session) => {
    const o = await AccessRequestModel.findById(id).session(session);
    if (!o) throw NotFound('yêu cầu');
    await assertFacility(user, o.facilityId, 'access.complete');
    if (o.type === 'PIN_RESET') throw Unprocessable('Mật khẩu được cấp tự động khi duyệt');
    const c = await RentalContractModel.findById(o.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    if (!REQUESTABLE_CONTRACT_STATUS.includes(c.status)) throw Unprocessable('Hợp đồng không còn hiệu lực — không giao thẻ / chìa mới', 'CONTRACT_NOT_ACTIVE');
    if (c.access.method !== o.accessMethod) throw Unprocessable('Ô kho hiện dùng hình thức khoá khác yêu cầu này — huỷ yêu cầu và tạo yêu cầu mới', 'ACCESS_METHOD_CHANGED');
    const now = new Date();
    o.transitionTo('DONE', { actor: user.role, by: user._id });
    o.completedAt = now; o.completedBy = user._id; o.newKeyTag = input.keyTag.trim();
    c.set('access.keyTag', o.newKeyTag);
    c.set('access.lostReportedAt', null); // đã có thẻ / chìa mới
    c.set('access.issuedAt', now);
    c.set('access.issuedBy', user._id);
    await c.save({ session });
    await o.save({ session });
    await audit({ action: 'access.complete', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, changes: { after: { type: o.type, keyTag: o.newKeyTag } } }, session);
    return o;
  });
}

// ---------------------------------------------------------------- huỷ (CUSTOMER; FM khi đã duyệt mà không làm được) → hoàn phí
export async function cancelAccessRequest(user: UserHydrated, id: string, reason?: string) {
  return withTxn(async (session) => {
    const o = await AccessRequestModel.findById(id).session(session);
    if (!o) throw NotFound('yêu cầu');
    await assertCanAccess(user, o, 'access.cancel');
    o.transitionTo('CANCELLED', { actor: user.role, by: user._id, reason });
    o.cancelReason = reason?.trim() || (user.role === 'CUSTOMER' ? 'Khách huỷ' : 'Chi nhánh huỷ');
    await refundFee(o, user._id, 'Huỷ yêu cầu cấp lại', session);
    if (user.role === 'CUSTOMER') await clearLostFlag(o, session);
    await o.save({ session });
    await audit({ action: 'access.cancel', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, reason: o.cancelReason, changes: { after: { refund: o.fee } } }, session);
    return o;
  });
}
