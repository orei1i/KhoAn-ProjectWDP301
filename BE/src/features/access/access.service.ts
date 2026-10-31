import { Types, type ClientSession } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { accessFeeOf, contractHoldsGoods, fmtDateTime, MAX_AUTHORIZED_PERSONS, normalizeIdLast4, vnd, type AccessMethod, type AccessRequestType, type IdPresenter, type IdType, type PaymentMethod } from '@ssm/shared';
import {
  FacilityModel, PaymentModel, RentalContractModel, TicketModel, UserModel, type RentalContractHydrated, type UserHydrated,
} from '../../shared/db/models';
import { mailCustomer } from '../contracts/contract-notice.service';
import { notifyStaff } from '../notify/staff-notify';
import { logTicketEmail } from '../tickets/ticket.service';
import { AccessRequestModel, type AccessRequestHydrated } from './access-request.model';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { decryptSecret, encryptSecret } from '../../shared/crypto/secret-box';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { assertOnlineGateway, createPayment, refundMethodFor, sha256, sixDigitPin } from '../payments/payment.service';
import { effectivePolicy } from '../policies/pricing';
import { assertIdCheckOpen, contractLabel, markIdCheckPassed, withIdCheckLog, type IdCheckTarget } from '../contracts/id-check';

/** Che tên người được uỷ quyền trong nhật ký (chỉ giữ chữ cái đầu mỗi từ) — nhật ký không lưu thô dữ liệu cá nhân người thứ ba. */
const maskName = (n: string) => n.trim().split(/\s+/).map((w) => `${w[0] ?? ''}.`).join(' ');

/** Loại yêu cầu theo hình thức khoá của ô — khách không tự chọn. */
const TYPE_BY_METHOD: Record<AccessMethod, AccessRequestType> = { PIN: 'PIN_RESET', RFID_CARD: 'CARD_REISSUE', PHYSICAL_KEY: 'KEY_REISSUE' };

/** Hợp đồng còn giữ ô và chưa bị khoá truy cập thì mới cấp lại được. */
const REQUESTABLE_CONTRACT_STATUS = ['ACTIVE', 'DELINQUENT', 'MOVE_OUT_PENDING'];

// ---------------------------------------------------------------- khách xem phương tiện vào kho
/**
 * Xem lại chỉ CHỦ hợp đồng (nhân viên chỉ thấy mật khẩu MỘT lần lúc bàn giao — phản hồi nhận kho / đổi ô — để cài ổ khoá, sau đó không xem lại
 * được; quản lý không xem được). Mỗi lần xem ghi nhật ký. PIN lưu mã hoá
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
  let reason: 'NOT_STORED' | 'SUSPENDED' | 'NOT_PIN' | 'ENDED' | null = null;
  if (method !== 'PIN') reason = 'NOT_PIN';
  // Đợt 16: đã bàn giao lại kho / hợp đồng đã đóng → không còn quyền vào kho, không trả mật khẩu nữa.
  else if (!contractHoldsGoods(c)) reason = 'ENDED';
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
    // Nhật ký không ghi thô họ tên / SĐT / 4 số cuối người được uỷ quyền — chỉ mã người, tên viết tắt (bản đầy đủ nằm trên hợp đồng).
    await audit({ action: 'contract.authorize_person', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { personId: person._id, fullName: maskName(fullName), idNumberLast4: '****' } } }, session);
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
    await audit({ action: 'contract.revoke_person', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { before: { personId: person._id, fullName: maskName(person.fullName), idNumberLast4: '****' } } }, session);
    return c;
  });
}

// ---------------------------------------------------------------- đối chiếu giấy tờ người đến quầy (mở hộ, giao thẻ / chìa mới)
/** Giấy tờ BẢN GỐC người đến quầy xuất trình — nhân viên đọc và nhập (màn hình quầy không hiện sẵn số đã khai). */
export interface PresentedId {
  presenter?: IdPresenter; authorizedPersonId?: string; idType?: IdType; idNumberLast4?: string;
}

/**
 * Như đối chiếu lúc nhận kho (check-in): nhân viên LUÔN nhập loại giấy tờ + 4 số cuối đọc từ giấy tờ gốc, server so với
 *  - chủ hợp đồng: giấy tờ trong hồ sơ khách (quản lý chi nhánh cập nhật khi khách đổi CCCD), chưa có thì lần đối chiếu lúc nhận kho
 *    ghi trong hợp đồng (`identity`) — khác loại hoặc khác số → ID_MISMATCH; không có gì để so → ID_NOT_ON_FILE (quản lý cập nhật trước);
 *  - người được uỷ quyền: 4 số cuối chủ hợp đồng đã đăng ký cho người đó (danh sách không lưu loại giấy tờ nên chỉ so số).
 * Thiếu thông tin → ID_REQUIRED. Trả người nhận để ghi nhật ký. Cờ `identityVerified` cũ không còn đủ.
 */
export async function verifyPresentedId(c: Pick<RentalContractHydrated, 'customerId' | 'identity' | 'authorizedPersons'>, input: PresentedId, session: ClientSession) {
  const presenter: IdPresenter = input.presenter ?? (input.authorizedPersonId ? 'AUTHORIZED' : 'CUSTOMER');
  if (presenter === 'AUTHORIZED' && !input.authorizedPersonId) throw Unprocessable('Chọn người được uỷ quyền đang xuất trình giấy tờ', 'ID_REQUIRED');
  if (presenter === 'CUSTOMER' && input.authorizedPersonId) throw Unprocessable('Người xuất trình là chủ hợp đồng thì không chọn người được uỷ quyền');
  const person = presenter === 'AUTHORIZED' ? (c.authorizedPersons ?? []).find((p) => p._id === input.authorizedPersonId) : null;
  if (presenter === 'AUTHORIZED' && !person) throw Unprocessable('Người này không có trong danh sách được uỷ quyền của hợp đồng', 'NOT_AUTHORIZED_PERSON');
  if (!input.idType || !input.idNumberLast4) throw Unprocessable('Nhập loại giấy tờ và 4 số cuối đọc từ giấy tờ tùy thân bản gốc người đến quầy xuất trình', 'ID_REQUIRED');
  const last4 = normalizeIdLast4(input.idNumberLast4);
  if (person) {
    if (last4 !== normalizeIdLast4(person.idNumberLast4)) throw Unprocessable('4 số cuối giấy tờ người được uỷ quyền xuất trình KHÁC thông tin chủ hợp đồng đã đăng ký — không mở kho / không giao', 'ID_MISMATCH');
    return { presenter, name: person.fullName, idType: input.idType, authorizedPersonId: person._id };
  }
  const customer = await UserModel.findById(c.customerId, { fullName: 1, 'customerProfile.idType': 1, 'customerProfile.idNumberLast4': 1 }).session(session).lean();
  const profile = customer?.customerProfile?.idNumberLast4 ? { idType: customer.customerProfile.idType ?? null, idNumberLast4: customer.customerProfile.idNumberLast4 } : null;
  const declared = profile ?? (c.identity ? { idType: c.identity.idType, idNumberLast4: c.identity.idNumberLast4 } : null);
  if (!declared) throw Unprocessable('Khách chưa có giấy tờ trong hồ sơ để đối chiếu — quản lý chi nhánh cập nhật giấy tờ (đã xem bản gốc) trước', 'ID_NOT_ON_FILE');
  if (last4 !== normalizeIdLast4(declared.idNumberLast4) || (declared.idType && input.idType !== declared.idType)) {
    throw Unprocessable('Giấy tờ khách xuất trình KHÁC thông tin đã khai / đã đối chiếu khi nhận kho — không mở kho / không giao, báo quản lý chi nhánh', 'ID_MISMATCH');
  }
  return { presenter, name: customer?.fullName ?? '—', idType: input.idType, authorizedPersonId: null };
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
export async function assistedOpen(user: UserHydrated, contractId: string, input: { reason: string } & PresentedId) {
  const ref: { target?: IdCheckTarget } = {};
  return withIdCheckLog(ref, () => withTxn(async (session) => {
    const c = await RentalContractModel.findById(contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertFacility(user, c.facilityId, 'contract.assisted_open');
    // Nhập sai giấy tờ nhiều lần → khoá đối chiếu của hợp đồng này cho tới khi quản lý mở khoá (id-check.ts).
    ref.target = { kind: 'contract', id: c._id, facilityId: c.facilityId, label: contractLabel(c) };
    assertIdCheckOpen(c);
    if (!REQUESTABLE_CONTRACT_STATUS.includes(c.status) || c.access.suspendedAt) {
      throw Unprocessable('Hợp đồng đang bị khoá truy cập do công nợ hoặc đã kết thúc — không mở hộ được', 'ACCESS_SUSPENDED');
    }
    // Đã nhận lại kho (chờ kiểm tra / quyết toán): khách không còn quyền vào kho.
    if (c.access.revokedAt) throw Unprocessable('Kho đã bàn giao lại cho chi nhánh — không mở hộ nữa', 'ALREADY_RETURNED');
    // Ô khoá mật khẩu là khoá số VẬT LÝ, khách tự đặt mật khẩu trên ổ khoá nên hệ thống không biết mật khẩu hiện tại. Khách quên
    // thì cũng ra quầy như mất chìa / mất thẻ: nhân viên xác minh danh tính rồi mở và đặt lại ổ khoá tại chỗ — vẫn ghi nhật ký ở đây.
    // Người đến quầy là chủ hợp đồng hoặc NGƯỜI ĐƯỢC UỶ QUYỀN đã đăng ký — giấy tờ gốc họ xuất trình phải khớp (verifyPresentedId).
    const who = await verifyPresentedId(c, input, session);
    markIdCheckPassed(c);
    const now = new Date();
    const forName = who.presenter === 'AUTHORIZED' ? who.name : null;
    const entry = { at: now, by: user._id, byName: user.fullName, reason: input.reason.trim(), forName, presenter: who.presenter, idType: who.idType };
    c.set('access.assistedOpens', [...(c.access.assistedOpens ?? []), entry].slice(-50));
    await c.save({ session });
    await audit({ action: 'contract.assisted_open', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: entry.reason, changes: { after: { method: c.access.method, by: user.fullName, presenter: who.presenter, forAuthorizedPerson: forName ? maskName(forName) : null, idType: who.idType, idChecked: true } } }, session);
    return c;
  }));
}

// ---------------------------------------------------------------- gửi yêu cầu (CUSTOMER chủ hợp đồng)
/**
 * Phí (nếu có) trả ngay khi gửi, như đặt dịch vụ; bị từ chối hoặc huỷ trước khi xong thì hoàn đủ. Đợt 16 (C6): `expectedFee` = phí khách
 * đang thấy — chính sách vừa đổi phí → 409 PRICE_CHANGED kèm phí mới, không thu; `idempotencyKey` (header Idempotency-Key) — gửi lại cùng
 * khoá trả đúng yêu cầu đã tạo (`replayed`), không thu lần hai.
 */
export async function createAccessRequest(user: UserHydrated, input: { contractId: string; reason?: string; method?: PaymentMethod; expectedFee?: number; idempotencyKey?: string }) {
  const out = await withTxn(async (session) => {
    const c = await RentalContractModel.findById(input.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    await assertCanAccess(user, c, 'access.request');
    const key = input.idempotencyKey?.trim() || null;
    if (key) {
      const done = await AccessRequestModel.findOne({ customerId: c.customerId, idempotencyKey: key }).session(session);
      if (done) return { req: Object.assign(done, { replayed: true }), lost: null };
    }
    // Đợt 16 (B3): quyền ra vào đang bị khoá do nợ → không cấp thẻ / chìa mới (như mở hộ).
    if (c.access.suspendedAt) throw Unprocessable('Quyền ra vào đang bị khoá do công nợ — thanh toán dư nợ trước khi xin cấp lại thẻ / chìa', 'ACCESS_SUSPENDED');
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
    if (input.expectedFee !== undefined && input.expectedFee !== fee) {
      throw new AppError(409, 'PRICE_CHANGED', `Phí cấp lại đã đổi thành ${fee.toLocaleString('vi-VN')} ₫ (bạn đang xem ${input.expectedFee.toLocaleString('vi-VN')} ₫) — xem lại rồi gửi`, { fee });
    }
    // Ghi chạm hợp đồng trong CÙNG giao dịch — hai lượt gửi cùng khoá song song xung đột ghi, lượt sau chạy lại và thấy yêu cầu đã có.
    if (key) await RentalContractModel.updateOne({ _id: c._id }, { $set: { updatedAt: new Date() } }, { session });
    let paymentId: Types.ObjectId | null = null;
    if (fee > 0) {
      if (!input.method) throw Unprocessable('Chọn hình thức thanh toán phí cấp lại', 'PAYMENT_METHOD_REQUIRED');
      if (user.role === 'CUSTOMER' && input.method === 'CASH') throw Unprocessable('Thanh toán tiền mặt chỉ thực hiện tại quầy');
      assertOnlineGateway(user);
      const pay = await createPayment({
        facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'ACCESS_FEE', amount: fee, status: 'SUCCEEDED', method: input.method,
      }, session);
      paymentId = pay._id;
    }

    const id = new Types.ObjectId();
    const now = new Date();
    // Đợt 16 (B2): báo mất thẻ / chìa → tạo việc "Vô hiệu thẻ <số> — <HĐ>" trong hàng việc chi nhánh (phiếu nội bộ, khẩn) — nhân viên / quản
    // lý khoá thẻ cũ rồi bấm xác nhận (confirmLostBlocked). Trước đó khách thấy "chi nhánh đang khoá thẻ cũ".
    const lost = type !== 'PIN_RESET';
    const oldKeyTag = c.access.keyTag ?? null;
    const what = type === 'CARD_REISSUE' ? 'thẻ' : 'chìa';
    // Thẻ / chìa đang ghi trên hợp đồng ĐÃ được chi nhánh khoá ở lần báo mất trước (yêu cầu cũ bị từ chối / huỷ): không tạo việc khoá lần hai.
    const blockedBefore = lost && !!c.access.lostReportedAt && !!c.access.lostBlockedAt;
    const task = lost && !blockedBefore ? (await TicketModel.create([{
      kind: 'OPS_TASK', facilityId: c.facilityId, reporterId: c.customerId, contractId: c._id, unitId: c.unitId, accessRequestId: id,
      category: 'ACCESS', priority: 'URGENT', status: 'OPEN', subject: `Vô hiệu ${what} ${oldKeyTag ?? '(chưa ghi số)'} — ${c.contractNumber}`,
      description: `Khách báo mất ${what} ${oldKeyTag ?? ''} của hợp đồng ${c.contractNumber} lúc ${fmtDateTime(now.toISOString())}. Khoá ${what} cũ ngay (trong giờ làm việc), rồi bấm "Xác nhận đã vô hiệu" — hệ thống báo lại cho khách.`,
      dueAt: new Date(now.getTime() + LOST_BLOCK_HOURS * 3_600_000), messages: [], statusHistory: [{ from: null, to: 'OPEN', at: now, by: null, reason: 'Khách báo mất' }],
    }], { session }))[0] : null;
    const [req] = await AccessRequestModel.create([{
      _id: id, facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, unitId: c.unitId,
      type, accessMethod: c.access.method, reason: input.reason?.trim() || undefined, fee, status: 'REQUESTED', paymentId, idempotencyKey: key,
      ...(lost ? { oldKeyTag } : {}),
      ...(task ? { blockTaskId: task._id } : {}),
      ...(blockedBefore ? { oldBlockedAt: c.access.lostBlockedAt, oldBlockedBy: c.access.lostBlockedBy ?? null, oldBlockedByName: c.access.lostBlockedByName ?? null } : {}),
    }], { session });
    if (lost && !blockedBefore) {
      c.set('access.lostReportedAt', now);
      c.set('access.lostBlockedAt', null); c.set('access.lostBlockedBy', null); c.set('access.lostBlockedByName', null);
      await c.save({ session });
    }
    await audit({ action: 'access.request', entityType: 'AccessRequest', entityId: id, facilityId: c.facilityId, changes: { after: { requestNumber: req.requestNumber, type, fee, lostReported: lost, blockTask: task?.ticketNumber ?? null } } }, session);
    return { req, lost: task ? { taskId: task._id, facilityId: c.facilityId, contractNumber: c.contractNumber, keyTag: oldKeyTag, what, at: now } : null };
  });
  // Email NGAY cho quản lý chi nhánh (sau commit, không chặn phản hồi) — ghi trạng thái vào nhật ký email của việc.
  const l = out.lost;
  if (l) {
    void (async () => {
      const [facility, customer] = await Promise.all([FacilityModel.findById(l.facilityId, { name: 1 }).lean(), UserModel.findById(out.req.customerId, { fullName: 1 }).lean()]);
      const status = await notifyStaff({ roles: ['FACILITY_MANAGER'], facilityId: l.facilityId }, `KhoAn — Khách báo mất ${l.what} ${l.keyTag ?? ''} — ${l.contractNumber}`, [
        `Khách ${customer?.fullName ?? '—'} báo mất ${l.what} ${l.keyTag ?? '(chưa ghi số)'} của hợp đồng ${l.contractNumber} tại ${facility?.name ?? 'chi nhánh'} lúc ${fmtDateTime(l.at.toISOString())} (yêu cầu ${out.req.requestNumber}).`,
        `Khoá ${l.what} cũ ngay (trong giờ làm việc), rồi bấm "Xác nhận đã vô hiệu" ở việc "Vô hiệu ${l.what} …" trong mục Yêu cầu & công việc — hệ thống báo lại cho khách.`,
      ]);
      await logTicketEmail(l.taskId, 'MANAGER_ALERT', status);
    })().catch((e) => console.error('[lost-card-alert]', e instanceof Error ? e.message : e));
  }
  return out.req;
}

/** Hạn xử lý việc "Vô hiệu thẻ …" (giờ) — chi nhánh khoá thẻ cũ ngay khi nhận báo, trong giờ làm việc. */
const LOST_BLOCK_HOURS = 24;

/** Việc "Vô hiệu thẻ …" của yêu cầu (nếu còn mở) → xong (RESOLVED) hoặc đóng (CLOSED, khách huỷ trước khi chi nhánh khoá). Trong transaction. */
async function finishLostTask(o: AccessRequestHydrated, to: 'RESOLVED' | 'CLOSED', by: Types.ObjectId | null, note: string, session: ClientSession) {
  if (!o.blockTaskId) return;
  const t = await TicketModel.findById(o.blockTaskId).session(session);
  if (!t || t.status === 'RESOLVED' || t.status === 'CLOSED') return;
  t.messages.push({ authorId: by ?? o.customerId, body: note, internal: true, at: new Date() });
  t.transitionTo(to, { actor: 'SYSTEM', by: by ?? undefined, reason: note });
  await t.save({ session });
}

/**
 * Đợt 17 (D8): khách đã trả kho / hàng bỏ lại → việc khẩn "Vô hiệu thẻ …" còn mở của hợp đồng không còn ý nghĩa (ô đã có việc thu chìa / thẻ, đặt lại
 * khoá — accessReset) nên đóng lại, kể cả việc của yêu cầu đã bị từ chối / huỷ trước đó. Đổi ô KHÔNG gọi hàm này: thẻ cũ chưa khoá thì việc vẫn mở.
 */
export async function closeOpenLostTasks(contractId: Types.ObjectId, note: string, by: Types.ObjectId | null, session: ClientSession) {
  const open = await TicketModel.find({ contractId, kind: 'OPS_TASK', accessRequestId: { $ne: null }, status: { $nin: ['RESOLVED', 'CLOSED'] } }).session(session);
  for (const t of open) {
    t.messages.push({ authorId: by ?? t.reporterId, body: note, internal: true, at: new Date() });
    t.transitionTo('CLOSED', { actor: 'SYSTEM', by: by ?? undefined, reason: note });
    await t.save({ session });
  }
}

/**
 * Đợt 16 (B2): nhân viên / quản lý chi nhánh XÁC NHẬN đã khoá thẻ / chìa khách báo mất — lưu ai, lúc nào (yêu cầu + hợp đồng nếu thẻ cũ vẫn
 * là thẻ đang ghi trên hợp đồng), việc "Vô hiệu thẻ …" → xong, ghi nhật ký; sau commit báo lại khách qua email. Một lần (đã xác nhận → 409).
 */
export async function confirmLostBlocked(user: UserHydrated, id: string, note?: string) {
  const r = await withTxn(async (session) => {
    const o = await AccessRequestModel.findById(id).session(session);
    if (!o) throw NotFound('yêu cầu');
    await assertFacility(user, o.facilityId, 'access.lost_block');
    if (o.type === 'PIN_RESET') throw Unprocessable('Yêu cầu này không có báo mất thẻ / chìa', 'NO_LOST_REPORT');
    if (o.oldBlockedAt) throw Conflict(`Đã xác nhận khoá ${o.type === 'CARD_REISSUE' ? 'thẻ' : 'chìa'} cũ lúc ${fmtDateTime(o.oldBlockedAt.toISOString())}`, 'ALREADY_BLOCKED');
    if (!o.blockTaskId) throw Unprocessable('Yêu cầu này không có báo mất thẻ / chìa', 'NO_LOST_REPORT');
    const task = await TicketModel.findById(o.blockTaskId, { status: 1 }).session(session).lean();
    if (task?.status === 'CLOSED') throw Unprocessable('Việc khoá thẻ đã đóng (khách đã huỷ báo mất hoặc đã trả kho) — không cần khoá nữa', 'LOST_REPORT_WITHDRAWN');
    const now = new Date();
    o.oldBlockedAt = now; o.oldBlockedBy = user._id; o.oldBlockedByName = user.fullName;
    await o.save({ session });
    const c = await RentalContractModel.findById(o.contractId).session(session);
    // Thẻ cũ vẫn là thẻ đang ghi trên hợp đồng (chưa giao thẻ mới / chưa đổi ô) → khách thấy "Thẻ cũ đã bị khoá lúc …".
    if (c && c.access.lostReportedAt && (c.access.keyTag ?? null) === (o.oldKeyTag ?? null)) {
      c.set('access.lostBlockedAt', now); c.set('access.lostBlockedBy', user._id); c.set('access.lostBlockedByName', user.fullName);
      await c.save({ session });
    }
    await finishLostTask(o, 'RESOLVED', user._id, `Đã khoá ${o.type === 'CARD_REISSUE' ? 'thẻ' : 'chìa'} cũ ${o.oldKeyTag ?? ''} — ${user.fullName}${note?.trim() ? `: ${note.trim()}` : ''}`, session);
    await audit({ action: 'access.lost_blocked', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, reason: note?.trim() || null, changes: { after: { requestNumber: o.requestNumber, keyTag: o.oldKeyTag ?? null, by: user.fullName, at: now } } }, session);
    return { o, contractNumber: c?.contractNumber ?? '' };
  });
  const what = r.o.type === 'CARD_REISSUE' ? 'Thẻ' : 'Chìa';
  void mailCustomer(r.o.customerId, `KhoAn — ${what} cũ ${r.o.oldKeyTag ?? ''} đã bị khoá`, [
    `${what} cũ ${r.o.oldKeyTag ?? ''} của hợp đồng ${r.contractNumber} (bạn đã báo mất) đã bị chi nhánh khoá lúc ${fmtDateTime(r.o.oldBlockedAt!.toISOString())}.`,
    'Yêu cầu cấp lại vẫn tiếp tục theo trạng thái trong tài khoản. Cần vào kho gấp trước khi nhận thẻ / chìa mới, hãy đến quầy để nhân viên xác minh danh tính và mở hộ.',
  ]);
  return r.o;
}

/**
 * KHÁCH tự huỷ yêu cầu cấp lại thẻ/chìa (tìm lại được) KHI chi nhánh CHƯA khoá thẻ cũ → gỡ cờ báo mất, việc "Vô hiệu thẻ …" đóng lại, thẻ /
 * chìa cũ dùng lại bình thường. Chi nhánh đã khoá (B2), hoặc chi nhánh từ chối / huỷ → KHÔNG gỡ: cờ báo mất chỉ xoá khi đã giao thẻ / chìa
 * mới — khách gửi yêu cầu mới hoặc nhân viên mở hộ tại quầy.
 */
async function clearLostFlag(o: AccessRequestHydrated, session: ClientSession) {
  if (o.type === 'PIN_RESET' || o.oldBlockedAt) return;
  await RentalContractModel.updateOne({ _id: o.contractId, 'access.lostBlockedAt': null }, { $set: { 'access.lostReportedAt': null } }, { session });
  await finishLostTask(o, 'CLOSED', null, 'Khách huỷ báo mất (đã tìm lại) trước khi chi nhánh khoá — không cần khoá nữa', session);
}

/** Hoàn đủ phí khi từ chối/huỷ. */
async function refundFee(o: AccessRequestHydrated, by: Types.ObjectId | null, reason: string, session: ClientSession) {
  if (!o.paymentId || o.fee <= 0) return;
  const paid = await PaymentModel.findById(o.paymentId).session(session);
  if (!paid || paid.status !== 'SUCCEEDED') return;
  const refund = await createPayment({
    facilityId: o.facilityId, customerId: o.customerId, contractId: o.contractId, type: 'REFUND', amount: o.fee,
    status: 'SUCCEEDED', method: refundMethodFor(paid), refundOf: paid._id,
  }, session);
  paid.refundedAmount = o.fee;
  paid.transitionTo('REFUNDED', { actor: 'SYSTEM', by, reason });
  await paid.save({ session });
  o.refundPaymentId = refund._id;
}

// ---------------------------------------------------------------- duyệt / từ chối (chỉ FACILITY_MANAGER)
export async function decideAccessRequest(user: UserHydrated, id: string, input: { approve: boolean; note?: string }) {
  const o = await withTxn(async (session) => {
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
    if (c?.access.suspendedAt) throw Unprocessable('Quyền ra vào của hợp đồng đang bị khoá do công nợ — không duyệt cấp thẻ / chìa mới', 'ACCESS_SUSPENDED'); // B3
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
  // Đợt 16 (C8): báo khách sau commit, không chặn phản hồi.
  const what = o.type === 'CARD_REISSUE' ? 'thẻ' : o.type === 'KEY_REISSUE' ? 'chìa' : 'mật khẩu';
  if (o.status === 'REJECTED') {
    void mailCustomer(o.customerId, `KhoAn — Yêu cầu cấp lại ${what} ${o.requestNumber} không được duyệt`, [
      `Chi nhánh không duyệt yêu cầu cấp lại ${what} ${o.requestNumber}. Lý do: ${o.decisionNote}`,
      o.fee > 0 ? `Phí ${vnd(o.fee)} đã được hoàn theo hình thức bạn đã trả (chuyển khoản thì KhoAn chuyển trong 7 ngày làm việc).` : '',
      o.type !== 'PIN_RESET' ? `${what === 'thẻ' ? 'Thẻ' : 'Chìa'} cũ bạn đã báo mất vẫn bị khoá. Cần vào kho, hãy đến quầy để nhân viên xác minh danh tính và mở hộ, hoặc gửi yêu cầu mới.` : '',
    ].filter(Boolean));
  } else {
    void mailCustomer(o.customerId, `KhoAn — Yêu cầu cấp lại ${what} ${o.requestNumber} đã được duyệt`, o.type === 'PIN_RESET'
      ? ['Mật khẩu mới đã được cấp — xem trong tài khoản (mục Kho đang thuê → Mở kho).']
      : [`Yêu cầu cấp lại ${what} ${o.requestNumber} đã được duyệt. Bạn (hoặc người được uỷ quyền đã đăng ký) mang giấy tờ tùy thân BẢN GỐC đến quầy chi nhánh để nhận ${what} mới.`]);
  }
  return o;
}

/**
 * Tự huỷ các yêu cầu cấp lại còn mở của hợp đồng và HOÀN PHÍ — khi kho đã bàn giao lại, đồ bỏ lại đã xử lý, hoặc đổi sang ô khác
 * hình thức khoá (`keepMethod` = hình thức khoá còn dùng được: yêu cầu cùng hình thức thì giữ). Khách không phải trả phí cho thẻ /
 * chìa không bao giờ nhận được, và nhân viên không thể "hoàn tất" ghi số thẻ lên hợp đồng đã đóng hay ô dùng khoá khác.
 * Đợt 16 (C4) `atSettlement`: trả kho / xử lý hàng bỏ lại — phí chưa hoàn ngay mà đi vào quyết toán (cấn công nợ, phần thiếu trước).
 */
export async function cancelOpenAccessRequests(contractId: Types.ObjectId, reason: string, session: ClientSession, keepMethod?: AccessMethod, opts: { atSettlement?: boolean } = {}) {
  const open = await AccessRequestModel.find({ contractId, status: { $in: ['REQUESTED', 'APPROVED'] } }).session(session);
  for (const o of open) {
    if (keepMethod && o.accessMethod === keepMethod) continue;
    o.transitionTo('CANCELLED', { actor: 'SYSTEM', reason });
    o.cancelReason = reason;
    if (opts.atSettlement && o.paymentId && o.fee > 0) o.refundAtSettlement = true;
    else await refundFee(o, null, reason, session);
    await o.save({ session });
    await audit({ action: 'access.cancel', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, reason, changes: { after: { refund: o.fee, auto: true } } }, session);
  }
}

// ---------------------------------------------------------------- bàn giao thẻ / chìa mới (STAFF, FM)
export async function completeAccessRequest(user: UserHydrated, id: string, input: { keyTag: string } & PresentedId) {
  const ref: { target?: IdCheckTarget } = {};
  return withIdCheckLog(ref, () => withTxn(async (session) => {
    const o = await AccessRequestModel.findById(id).session(session);
    if (!o) throw NotFound('yêu cầu');
    await assertFacility(user, o.facilityId, 'access.complete');
    if (o.type === 'PIN_RESET') throw Unprocessable('Mật khẩu được cấp tự động khi duyệt');
    const c = await RentalContractModel.findById(o.contractId).session(session);
    if (!c) throw NotFound('hợp đồng');
    if (!REQUESTABLE_CONTRACT_STATUS.includes(c.status)) throw Unprocessable('Hợp đồng không còn hiệu lực — không giao thẻ / chìa mới', 'CONTRACT_NOT_ACTIVE');
    if (c.access.suspendedAt) throw Unprocessable('Quyền ra vào đang bị khoá do công nợ — không giao thẻ / chìa mới', 'ACCESS_SUSPENDED'); // B3
    if (c.access.method !== o.accessMethod) throw Unprocessable('Ô kho hiện dùng hình thức khoá khác yêu cầu này — huỷ yêu cầu và tạo yêu cầu mới', 'ACCESS_METHOD_CHANGED');
    ref.target = { kind: 'contract', id: c._id, facilityId: c.facilityId, label: contractLabel(c) };
    assertIdCheckOpen(c);
    // Thẻ / chìa mới chỉ giao tận tay chủ hợp đồng hoặc người được uỷ quyền — đối chiếu giấy tờ gốc như khi mở hộ.
    const who = await verifyPresentedId(c, input, session);
    markIdCheckPassed(c);
    const now = new Date();
    o.transitionTo('DONE', { actor: user.role, by: user._id });
    o.completedAt = now; o.completedBy = user._id; o.newKeyTag = input.keyTag.trim();
    o.set('handedTo', who);
    c.set('access.keyTag', o.newKeyTag);
    // Đã có thẻ / chìa mới → xoá cờ báo mất. B2: chi nhánh chưa bấm xác nhận khoá thẻ cũ thì ghi nhận luôn lúc giao thẻ mới (người giao).
    if (o.blockTaskId && !o.oldBlockedAt) { o.oldBlockedAt = now; o.oldBlockedBy = user._id; o.oldBlockedByName = user.fullName; }
    await finishLostTask(o, 'RESOLVED', user._id, `Đã giao ${o.type === 'CARD_REISSUE' ? 'thẻ' : 'chìa'} mới ${o.newKeyTag} — ${o.type === 'CARD_REISSUE' ? 'thẻ' : 'chìa'} cũ đã vô hiệu`, session);
    c.set('access.lostReportedAt', null);
    c.set('access.lostBlockedAt', null); c.set('access.lostBlockedBy', null); c.set('access.lostBlockedByName', null);
    c.set('access.issuedAt', now);
    c.set('access.issuedBy', user._id);
    await c.save({ session });
    await o.save({ session });
    await audit({ action: 'access.complete', entityType: 'AccessRequest', entityId: o._id, facilityId: o.facilityId, changes: { after: { type: o.type, keyTag: o.newKeyTag, handedTo: who.presenter === 'AUTHORIZED' ? maskName(who.name) : who.name, presenter: who.presenter, idType: who.idType, idChecked: true } } }, session);
    return o;
  }));
}

// ---------------------------------------------------------------- huỷ (CUSTOMER; FM khi đã duyệt mà không làm được) → hoàn phí
export async function cancelAccessRequest(user: UserHydrated, id: string, reason?: string) {
  const o = await withTxn(async (session) => {
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
  // Đợt 16 (C8): chi nhánh huỷ → email khách kèm hoàn phí (sau commit).
  if (user.role !== 'CUSTOMER') {
    const what = o.type === 'CARD_REISSUE' ? 'thẻ' : o.type === 'KEY_REISSUE' ? 'chìa' : 'mật khẩu';
    void mailCustomer(o.customerId, `KhoAn — Chi nhánh huỷ yêu cầu cấp lại ${what} ${o.requestNumber}`, [
      `Chi nhánh đã huỷ yêu cầu cấp lại ${what} ${o.requestNumber}. Lý do: ${o.cancelReason}.`,
      o.fee > 0 ? `Phí ${vnd(o.fee)} đã được hoàn theo hình thức bạn đã trả (chuyển khoản thì KhoAn chuyển trong 7 ngày làm việc).` : '',
      'Cần hỗ trợ, vui lòng liên hệ chi nhánh hoặc gửi yêu cầu mới trong tài khoản.',
    ].filter(Boolean));
  }
  return o;
}
