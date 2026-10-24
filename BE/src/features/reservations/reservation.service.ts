import { Types, type ClientSession } from 'mongoose';
import { allowsRentalPeriod, buildContractClauses, dueAtCheckIn, INTAKE_CHECK_ITEMS, PAPER_CONTRACT_MAX_BYTES, PAPER_CONTRACT_TYPES, MONTH_ONLY_MESSAGE, PERIOD_UNIT, TERMS_VERSION, type CancellationReason, type CheckInShift, type IdType, type PaymentMethod, type RentalPeriod, type Reservation, type SignatureMethod } from '@ssm/shared';
import {
  FacilityModel, PaymentModel, RentalContractModel, ReservationModel, ServiceOfferingModel, ServiceOrderModel, StorageUnitModel, UnitTypeModel, UserModel,
  type ReservationHydrated, type UserHydrated,
} from '../../shared/db/models';
import { AppError, Conflict, Forbidden, NotFound, Unprocessable } from '../../shared/core/errors';
import { sendMail } from '../../shared/mail/mailer';
import { ContractFileModel } from './contract-file.model';
import { env } from '../../shared/config/env';
import { assertContractProfile } from '../users/user.service';
import { assertCanAccess, assertFacility } from '../../shared/http/scope';
import { cancellationRefund, climateEligible, effectivePolicy, quote, signedPolicy } from '../policies/pricing';
import { addDays, addPeriodsUTC, todayUTC, toDateOnly } from '../../shared/utils/dates';
import { audit } from '../audit/audit.service';
import { withTxn } from '../../shared/db/txn';
import { createPayment, randomToken, refundMethodFor, sha256, sixDigitPin } from '../payments/payment.service';
import { encryptSecret } from '../../shared/crypto/secret-box';
import { contractParties, contractViewFor, emailContract } from './contract-document.service';
import { effectiveTemplate } from '../contract-templates/contract-template.service';
import { buildContractPdf } from '../contracts/contract-pdf';

const loadReservation = async (id: string, session?: ClientSession) => {
  const r = await ReservationModel.findById(id).session(session ?? null);
  if (!r) throw NotFound('đặt chỗ');
  return r;
};

export interface BookingItem {
  unitTypeId: string; unitId: string; startDate: string; rentalPeriod: RentalPeriod; periods: number;
  source: Reservation['source']; idempotencyKey?: string;
  /** Ca giờ khách dự kiến đến nhận kho, chọn ngay lúc đặt — UNKNOWN ("Chưa rõ giờ") là lựa chọn hợp lệ. */
  preferredCheckInShift: CheckInShift;
  /** Add-on điều hòa khách tự chọn lúc đặt — không gắn với ô cụ thể nào. Server tự ép về false nếu
   * loại kho không hợp lệ (VD Locker), không báo lỗi, để client không phải biết trước danh sách cỡ hợp lệ. */
  useAirConditioning: boolean;
  /** Bằng chứng đã đồng ý Điều khoản + Chính sách bảo mật — bắt buộc, đóng dấu ip/userAgent ở route. */
  consent: { termsVersion: string; privacyVersion: string; acceptedAt?: string; ip: string | null; userAgent: string | null };
  /** Dịch vụ thêm chọn kèm — đơn riêng ngoài hợp đồng thuê, thu tiền khi nhận kho. */
  services?: { serviceId: string; quantity: number; note?: string }[];
}

/**
 * Đặt MỘT ô kho cụ thể — khách bắt buộc chọn ô trên sơ đồ trước (không đặt theo "loại kho" trừu
 * tượng rồi chờ phân sau). Ô chuyển sang RESERVED ngay trong transaction này bằng compare-and-swap
 * trên `status: 'AVAILABLE'`, nên hai khách cùng bấm một ô thì chỉ một người khớp filter, người kia
 * nhận 409 — không cần đếm số lượng như thiết kế cũ.
 *
 * Dùng chung cho đặt lẻ (createReservation) và đặt nhiều kho một lần (createReservationsBatch).
 */
type BookingTerms = Pick<BookingItem, 'unitTypeId' | 'startDate' | 'rentalPeriod' | 'periods' | 'useAirConditioning'>;

/**
 * Kiểm tra điều kiện đặt và tính báo giá cho MỘT dòng đặt kho — dùng chung cho đặt thật (bookOne) và bản xem trước hợp đồng
 * (previewContract), nên hợp đồng khách đọc trước khi trả tiền khớp đúng hợp đồng sẽ phát sinh khi đặt.
 */
async function resolveBookingTerms(input: BookingTerms, session?: ClientSession) {
  const start = toDateOnly(input.startDate);
  if (start < todayUTC()) throw Unprocessable('Ngày bắt đầu không được ở quá khứ');
  if (start > addDays(todayUTC(), 90)) throw Unprocessable('Chỉ nhận đặt trước tối đa 90 ngày');

  const ut = await UnitTypeModel.findOne({ _id: input.unitTypeId, isActive: true }).session(session ?? null);
  if (!ut) throw NotFound('loại kho');
  if (!allowsRentalPeriod(ut.category, input.rentalPeriod)) throw Unprocessable(`${MONTH_ONLY_MESSAGE} — ${ut.name} không thuê theo ngày / tuần được`, 'PERIOD_NOT_ALLOWED');
  const facility = await FacilityModel.findById(ut.facilityId).session(session ?? null);
  if (!facility || facility.status !== 'ACTIVE') throw Unprocessable('Chi nhánh chưa nhận đặt chỗ');
  const policy = await effectivePolicy(facility._id, session);
  const minP = Math.max(policy.minPeriods, ut.minPeriods);
  const unitLabel = PERIOD_UNIT[input.rentalPeriod];
  if (input.periods < minP || input.periods > policy.maxPeriods) throw Unprocessable(`Thời hạn thuê phải từ ${minP} đến ${policy.maxPeriods} ${unitLabel}`);
  // Điều hòa là add-on khách tự chọn — ép về false nếu loại kho không hợp lệ (VD Locker), không cần
  // client tự biết trước danh sách cỡ hợp lệ.
  const useAc = input.useAirConditioning && climateEligible(policy, ut.category);
  const q = quote(ut, policy, input.rentalPeriod, input.periods, useAc);
  return { start, end: addPeriodsUTC(start, input.rentalPeriod, input.periods), ut, facility, policy, useAc, q };
}

/** Đặt tại quầy (walk-in): nhân viên thu ngay khoản phải trả khi đặt bằng tiền mặt / chuyển khoản / thẻ thay vì khách trả online. */
interface CounterSale { staff: UserHydrated; payMethod: PaymentMethod }

async function bookOne(user: UserHydrated, input: BookingItem, session: ClientSession, counter?: CounterSale) {
  if (input.idempotencyKey) {
    const existing = await ReservationModel.findOne({ customerId: user._id, idempotencyKey: input.idempotencyKey }).session(session);
    if (existing) return existing;
  }
  const { start, end, ut, facility, policy, useAc, q } = await resolveBookingTerms(input, session);

  const id = new Types.ObjectId();
  const now = new Date();
  const unit = await StorageUnitModel.findOneAndUpdate(
    { _id: input.unitId, facilityId: ut.facilityId, unitTypeId: ut._id, status: 'AVAILABLE', isDeleted: false },
    { $set: { status: 'RESERVED', currentReservationId: id, statusChangedAt: now, statusReason: 'Giữ chỗ — đặt kho' } },
    { new: true, session },
  );
  if (!unit) throw Conflict('Ô kho đã chọn không còn trống — vui lòng chọn ô khác trên sơ đồ', 'UNIT_NOT_AVAILABLE');
  // Token chống race cho khách khác đang xem cùng loại kho này (đếm chỗ trống trên trang danh mục).
  await UnitTypeModel.updateOne({ _id: ut._id }, { $inc: { inventoryVersion: 1 } }, { session });

  // Online: khoản chờ khách trả qua cổng (payDeposit). Tại quầy: nhân viên đã thu → ghi SUCCEEDED ngay, tiền mặt ghi người thu (như nhận kho).
  const pay = counter
    ? { status: 'SUCCEEDED' as const, method: counter.payMethod, recordedBy: counter.payMethod === 'CASH' ? counter.staff._id : null }
    : { status: 'PENDING' as const, method: 'VNPAY' as const };
  const deposit = await createPayment({ facilityId: facility._id, customerId: user._id, reservationId: id, type: 'DEPOSIT', amount: q.depositAmount, ...pay, ...(counter && { idempotencyKey: `walkin-dep-${id}` }) }, session);
  // Kho cỡ lớn: tiền thuê kỳ đầu thu CÙNG LÚC đặt chỗ — ghi thành khoản riêng (PREPAID_RENT) để sổ sách tách bạch với tiền giữ chân
  // (tiền giữ chân hoàn khi trả kho, tiền thuê thì không). Hai khoản được thanh toán trong cùng một lần ở payDeposit (hoặc tại quầy).
  if (q.firstPeriodAtBooking) {
    await createPayment({ facilityId: facility._id, customerId: user._id, reservationId: id, type: 'PREPAID_RENT', amount: q.firstPeriodRent, ...pay, ...(counter && { idempotencyKey: `walkin-rent-${id}` }) }, session);
  }
  const [r] = await ReservationModel.create([{
    _id: id, facilityId: facility._id, customerId: user._id, unitTypeId: ut._id, unitId: unit._id, status: 'PENDING',
    startDate: start, periods: input.periods, endDate: end, quote: q,
    preferredCheckInShift: input.preferredCheckInShift, useAirConditioning: useAc,
    holdExpiresAt: new Date(now.getTime() + policy.reservationHoldMinutes * 60_000),
    // Ô đã được chọn đúng lúc đặt — không còn bước "Quản lý chi nhánh phân kho" riêng như thiết kế cũ.
    allocation: { allocatedAt: now, allocatedBy: null },
    depositPaymentId: deposit._id, source: input.source, bookedBy: counter?.staff._id ?? null, idempotencyKey: input.idempotencyKey ?? null,
    // Route đã bắt buộc xác nhận lịch thanh toán + đã xem hợp đồng — server đóng dấu thời điểm.
    consent: { ...input.consent, acceptedAt: now, paymentScheduleAckAt: now, contractAckAt: now },
  }], { session });
  if (counter) confirmBooked(r, { by: counter.staff._id, reason: `Thu tại quầy (${counter.payMethod})` });
  // Dịch vụ chọn kèm: tạo đơn RIÊNG (ngoài hợp đồng thuê), chốt tên / giá lúc đặt, CHƯA thu tiền — thu cùng lúc nhận kho.
  for (const s of input.services ?? []) {
    const svc = await ServiceOfferingModel.findOne({ _id: s.serviceId, facilityId: facility._id, isActive: true }).session(session);
    if (!svc) throw Unprocessable('Dịch vụ đã chọn không còn được cung cấp tại chi nhánh này', 'SERVICE_UNAVAILABLE');
    await ServiceOrderModel.create([{
      facilityId: facility._id, customerId: user._id, reservationId: id, contractId: null, serviceId: svc._id,
      serviceName: svc.name, unitPrice: svc.price, unitLabel: svc.unitLabel, quantity: s.quantity, total: svc.price * s.quantity,
      preferredDate: start, note: s.note, status: 'REQUESTED', paymentId: null,
    }], { session });
  }
  await audit({
    action: 'reservation.create', entityType: 'Reservation', entityId: id, facilityId: facility._id,
    changes: { after: { code: r.code, unitType: ut.code, unit: unit.unitNumber, rentalPeriod: input.rentalPeriod, periods: input.periods, services: input.services?.length ?? 0, source: input.source } },
  }, session);
  if (counter) await r.save({ session });
  return r;
}

/**
 * Đã thu đủ khoản phải trả khi đặt → CONFIRMED + cấp mã QR nhận kho (chỉ lưu sha256). Ô đã chọn ngay lúc đặt (bookOne) — không còn
 * bước Quản lý chi nhánh phân kho riêng, nên chuyển thẳng sang ALLOCATED để màn "sẵn sàng nhận kho" nhận đúng đặt chỗ này.
 * Trả token bản rõ (chỉ để dựng qrPayload trong response, không lưu). Người gọi tự save.
 */
function confirmBooked(r: ReservationHydrated, ctx: { by?: Types.ObjectId | null; reason: string }) {
  const qrToken = randomToken(12);
  r.transitionTo('CONFIRMED', { actor: 'SYSTEM', by: ctx.by ?? null, reason: ctx.reason });
  r.checkIn = { qrTokenHash: sha256(qrToken), qrExpiresAt: addDays(r.startDate, 2), checkedInAt: null, checkedInBy: null };
  if (r.unitId) r.transitionTo('ALLOCATED', { actor: 'SYSTEM', reason: 'Ô đã chọn lúc đặt' });
  return qrToken;
}

/** Khách còn nợ sau quyết toán của một hợp đồng đã đóng (hư hại + công nợ vượt tiền giữ chân) thì chưa được thuê kho mới. */
async function assertNoSettlementDebt(user: UserHydrated, session?: ClientSession) {
  const debt = await RentalContractModel.findOne({ customerId: user._id, status: { $in: ['CLOSED', 'ABANDONED'] }, 'balance.outstanding': { $gt: 0 } }, { contractNumber: 1, 'balance.outstanding': 1 }).session(session ?? null).lean();
  if (debt) throw Unprocessable(`Bạn còn nợ ${debt.balance.outstanding.toLocaleString('vi-VN')} ₫ sau quyết toán hợp đồng ${debt.contractNumber} — thanh toán xong mới đặt kho mới được`, 'SETTLEMENT_DEBT');
}

// ---------------------------------------------------------------- xem trước hợp đồng (trước khi đặt / trả tiền)
const PREVIEW_CUSTOMER = '(họ tên Bên thuê — lấy theo tài khoản đặt chỗ)';

/**
 * Toàn văn hợp đồng sẽ phát sinh nếu đặt dòng này NGAY BÂY GIỜ — dựng bằng đúng mẫu, chính sách, báo giá và thông tin hai bên như
 * khi đặt thật, để khách (hoặc bộ phận pháp lý của khách) đọc trước khi trả tiền giữ chân. Không ghi gì vào DB, không giữ ô.
 * Chưa đăng nhập thì Bên B để trống; ô cụ thể (unitId) là tuỳ chọn.
 */
export async function previewContract(user: UserHydrated | null, input: BookingTerms & { unitId?: string }) {
  if (user?.role !== 'CUSTOMER') user = null; // nhân viên xem thì Bên B để trống, không in tên nhân viên
  const { start, end, ut, facility, policy, useAc, q } = await resolveBookingTerms(input);
  const [parties, unit, template] = await Promise.all([
    contractParties(facility._id, user?._id ?? null),
    input.unitId ? StorageUnitModel.findOne({ _id: input.unitId, unitTypeId: ut._id, isDeleted: false }).lean() : null,
    effectiveTemplate(facility._id),
  ]);
  const clauses = buildContractClauses({
    code: 'BẢN XEM TRƯỚC', ...parties, customerName: user ? parties.customerName : PREVIEW_CUSTOMER,
    unitTypeName: ut.name, unitNumber: unit?.unitNumber, floor: unit?.location.floor, zone: unit?.location.zone, areaM2: ut.areaM2, accessMethod: unit?.accessMethod,
    useAirConditioning: useAc, rentalPeriod: input.rentalPeriod, periods: input.periods,
    startDate: start.toISOString(), endDate: end.toISOString(), quote: q, depositPaid: false, termsVersion: TERMS_VERSION,
    policy: policy.toObject(),
  }, template.clauses);
  return {
    clauses, templateVersion: template.version, signed: false, contractNumber: null,
    facilityName: parties.facilityName, lessorRepresentative: parties.lessorRepresentative, lessorAuthorization: parties.lessorAuthorization, customerName: user ? parties.customerName : null,
  };
}

/** PDF bản xem trước (chưa ký, ghi rõ "chưa có giá trị") — để khách gửi bộ phận pháp lý / kế toán của mình đọc trước. */
export async function previewContractPdf(user: UserHydrated | null, input: BookingTerms & { unitId?: string }) {
  const v = await previewContract(user, input);
  const pdf = await buildContractPdf({
    code: 'BẢN XEM TRƯỚC', facilityName: v.facilityName, customerName: v.customerName ?? PREVIEW_CUSTOMER, clauses: v.clauses,
    lessorRepresentative: v.lessorRepresentative, lessorAuthorization: v.lessorAuthorization, signature: null, generatedAt: new Date(),
    subtitle: 'BẢN XEM TRƯỚC — chưa ký, chưa có giá trị pháp lý. Hợp đồng chỉ được giao kết khi Bên thuê đặt chỗ và ký trên tài khoản.',
  });
  return { pdf, filename: 'hop-dong-xem-truoc.pdf' };
}

// ---------------------------------------------------------------- create (CUSTOMER)
export async function createReservation(user: UserHydrated, input: BookingItem) {
  if (user.status !== 'ACTIVE') throw Forbidden('Tài khoản chưa được kích hoạt', 'ACCOUNT_INACTIVE');
  assertContractProfile(user);
  await assertNoSettlementDebt(user);
  return withTxn((session) => bookOne(user, input, session));
}

/**
 * Đặt nhiều kho trong một lần bấm (giỏ hàng) — tất cả cùng một transaction: hoặc cả N ô đều giữ
 * được, hoặc không ô nào bị giữ (ô nào tranh chấp sẽ báo rõ trong lỗi để khách bỏ dòng đó ra).
 */
export async function createReservationsBatch(user: UserHydrated, items: BookingItem[]) {
  if (user.status !== 'ACTIVE') throw Forbidden('Tài khoản chưa được kích hoạt', 'ACCOUNT_INACTIVE');
  assertContractProfile(user);
  await assertNoSettlementDebt(user);
  if (items.length === 0) throw Unprocessable('Giỏ hàng trống');
  if (items.length > 10) throw Unprocessable('Chỉ đặt tối đa 10 kho một lần');
  const unitIds = new Set(items.map((i) => i.unitId));
  if (unitIds.size !== items.length) throw Unprocessable('Không thể đặt cùng một ô kho hai lần trong một lượt');

  return withTxn(async (session) => {
    const results: ReservationHydrated[] = [];
    for (const item of items) results.push(await bookOne(user, item, session));
    return results;
  });
}

// ---------------------------------------------------------------- đặt tại quầy cho khách vãng lai (STAFF, FM)
type WalkInCustomer =
  | { customerId: string; idType?: IdType; idNumberLast4?: string }
  | { email: string; fullName: string; phone: string; idType: IdType; idNumberLast4: string };

export interface WalkInInput {
  customer: WalkInCustomer;
  items: Omit<BookingItem, 'source' | 'idempotencyKey' | 'consent'>[];
  payMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD';
  consent: BookingItem['consent'];
  idempotencyKey?: string;
}

const walkInView = (c: UserHydrated) => ({ _id: c._id, fullName: c.fullName, email: c.email, phone: c.phone ?? null });

/**
 * Khách của lượt đặt tại quầy (trong transaction đặt chỗ — đặt hỏng thì tài khoản mới cũng không được tạo):
 *  - khách cũ: phải là CUSTOMER, không bị khoá; chưa khai giấy tờ thì nhân viên bổ sung theo bản gốc (không ghi đè giấy tờ đã khai,
 *    khác giấy tờ đã khai → ID_MISMATCH); còn nợ quyết toán thì chặn như đặt online.
 *  - khách mới: tạo tài khoản CUSTOMER chưa gắn đăng nhập (firebaseUid null), ACTIVE vì nhân viên đã đối chiếu giấy tờ gốc. Sau này
 *    khách đăng ký Firebase cùng email (đã xác minh) thì syncProfile tự liên kết vào tài khoản này.
 */
async function walkInCustomer(c: WalkInCustomer, consent: BookingItem['consent'], session: ClientSession) {
  if ('customerId' in c) {
    const u = await UserModel.findById(c.customerId).session(session);
    if (!u || u.role !== 'CUSTOMER') throw NotFound('khách hàng');
    if (u.status === 'SUSPENDED') throw Forbidden('Tài khoản khách đang bị tạm khoá', 'ACCOUNT_SUSPENDED');
    const declared = u.customerProfile?.idType && u.customerProfile.idNumberLast4 ? u.customerProfile : null;
    if (declared && c.idNumberLast4 && (c.idType !== declared.idType || c.idNumberLast4 !== declared.idNumberLast4!.toUpperCase())) {
      throw Unprocessable('Giấy tờ khách xuất trình KHÁC thông tin khách đã khai — kiểm tra lại, sửa giấy tờ do quản lý chi nhánh làm', 'ID_MISMATCH');
    }
    let idSupplemented = false;
    if (!declared) {
      if (!c.idType || !c.idNumberLast4) throw Unprocessable('Khách chưa khai giấy tờ tùy thân — nhập loại giấy tờ và 4 số cuối theo bản gốc khách xuất trình', 'ID_REQUIRED');
      u.customerProfile = { ...(u.customerProfile ?? {}), idType: c.idType, idNumberLast4: c.idNumberLast4 } as typeof u.customerProfile;
      await u.save({ session });
      idSupplemented = true;
    }
    assertContractProfile(u);
    await assertNoSettlementDebt(u, session);
    return { customer: u, created: false, idSupplemented };
  }
  if (await UserModel.exists({ email: c.email }).session(session)) throw Conflict('Email này đã có tài khoản — tìm khách theo email / số điện thoại để đặt', 'EMAIL_EXISTS');
  if (await UserModel.exists({ phone: c.phone }).session(session)) throw Conflict('Số điện thoại này đã gắn với một tài khoản khác', 'PHONE_EXISTS');
  const [u] = await UserModel.create([{
    firebaseUid: null, email: c.email, fullName: c.fullName, phone: c.phone, role: 'CUSTOMER', facilityIds: [], status: 'ACTIVE',
    customerProfile: { idType: c.idType, idNumberLast4: c.idNumberLast4 },
    consent: { termsVersion: consent.termsVersion, privacyVersion: consent.privacyVersion, acceptedAt: new Date(), method: 'WALK_IN' },
  }], { session });
  return { customer: u, created: true, idSupplemented: false };
}

/**
 * Khách đến thẳng quầy (chưa đặt online / không có ví điện tử): nhân viên tạo đặt chỗ thay khách — cùng logic đặt online (giữ ô CAS,
 * báo giá, dịch vụ kèm, chính sách) — và thu ngay khoản phải trả khi đặt (giữ chân + tiền thuê kỳ đầu với kho cỡ lớn) → ALLOCATED.
 * Sau đó dùng luồng sẵn có: in hợp đồng → khách ký giấy (sign-paper) → nhận kho (check-in).
 * Chỉ ô của chi nhánh nhân viên được gán; tất cả trong một transaction. Cùng Idempotency-Key → trả lại đúng kết quả lần trước.
 */
export async function createWalkInBooking(staff: UserHydrated, input: WalkInInput) {
  const { items } = input;
  if (new Set(items.map((i) => i.unitId)).size !== items.length) throw Unprocessable('Không thể đặt cùng một ô kho hai lần trong một lượt');
  const keys = input.idempotencyKey ? items.map((_, i) => `walkin:${input.idempotencyKey}:${i}`) : [];
  if (keys.length) {
    const done = await ReservationModel.find({ bookedBy: staff._id, idempotencyKey: { $in: keys } });
    if (done.length) {
      const customer = await UserModel.findById(done[0].customerId);
      return { customer: customer ? walkInView(customer) : null, items: keys.map((k) => done.find((r) => r.idempotencyKey === k)).filter(Boolean) };
    }
  }
  // Cùng một chi nhánh và thuộc phạm vi nhân viên — kiểm trước transaction để lượt bị từ chối vẫn được ghi audit DENIED.
  const typeIds = [...new Set(items.map((i) => i.unitTypeId))];
  const types = await UnitTypeModel.find({ _id: { $in: typeIds } }, { facilityId: 1 }).lean();
  if (types.length !== typeIds.length) throw NotFound('loại kho');
  if (new Set(types.map((t) => String(t.facilityId))).size > 1) throw Unprocessable('Mỗi lượt đặt tại quầy chỉ gồm các kho của cùng một chi nhánh', 'MIXED_FACILITY');
  await assertFacility(staff, types[0].facilityId, 'reservation.walk_in');

  return withTxn(async (session) => {
    const { customer, created, idSupplemented } = await walkInCustomer(input.customer, input.consent, session);
    const results: ReservationHydrated[] = [];
    for (const [i, item] of items.entries()) {
      results.push(await bookOne(customer, { ...item, source: 'WALK_IN', idempotencyKey: keys[i], consent: input.consent }, session, { staff, payMethod: input.payMethod }));
    }
    const amount = results.reduce((sum, r) => sum + r.quote.totalDueAtBooking, 0);
    await audit({
      action: 'reservation.walk_in', entityType: 'Reservation', entityId: results[0]._id, facilityId: types[0].facilityId,
      changes: { after: { codes: results.map((r) => r.code), customerId: String(customer._id), newCustomer: created, idSupplemented, amount, method: input.payMethod } },
    }, session);
    return { customer: walkInView(customer), items: results };
  });
}

// ---------------------------------------------------------------- deposit (mock gateway success)
export async function payDeposit(user: UserHydrated, id: string, method: PaymentMethod) {
  return withTxn(async (session) => {
    const r = await loadReservation(id, session);
    await assertCanAccess(user, r, 'reservation.pay_deposit');
    if (r.holdExpiresAt && r.holdExpiresAt < new Date()) throw Conflict('Đã hết thời gian giữ chỗ, vui lòng đặt lại', 'HOLD_EXPIRED');
    const pay = await PaymentModel.findById(r.depositPaymentId).session(session);
    if (!pay) throw NotFound('khoản tiền giữ chân');
    pay.method = method;
    pay.provider = { name: method, txnRef: `${method}-${randomToken(9)}`, rawStatus: 'MOCK_SUCCESS' };
    pay.transitionTo('SUCCEEDED', { actor: 'SYSTEM', reason: 'Gateway callback (mock)' });
    await pay.save({ session });
    // Kho cỡ lớn: tiền thuê kỳ đầu trả CÙNG LẦN với tiền giữ chân (một lần bấm thanh toán, hai khoản ghi sổ riêng).
    if (r.quote.firstPeriodAtBooking) {
      const rentPay = await PaymentModel.findOne({ reservationId: r._id, type: 'PREPAID_RENT', status: 'PENDING' }).session(session);
      if (!rentPay) throw Conflict('Thiếu khoản tiền thuê kỳ đầu của đặt chỗ — liên hệ quản lý', 'PREPAID_RENT_MISSING');
      rentPay.method = method;
      rentPay.provider = { name: method, txnRef: `${method}-${randomToken(9)}`, rawStatus: 'MOCK_SUCCESS' };
      rentPay.transitionTo('SUCCEEDED', { actor: 'SYSTEM', reason: 'Gateway callback (mock)' });
      await rentPay.save({ session });
    }

    const qrToken = confirmBooked(r, { reason: `Thanh toán giữ chân qua ${method}` });
    await r.save({ session });
    await audit({ action: 'payment.deposit', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId, changes: { after: { amount: pay.amount, rentPaid: r.quote.firstPeriodAtBooking ? r.quote.firstPeriodRent : 0, method } } }, session);
    // QR payload shown to the customer; only its hash is stored.
    return { reservation: r, qrPayload: `SSM:${r.code}:${qrToken}` };
  });
}

// ---------------------------------------------------------------- cấp lại mã QR nhận kho (CUSTOMER chủ đặt chỗ)
/**
 * payDeposit trả `qrPayload` đúng MỘT lần rồi server chỉ giữ lại sha256 — đóng trang là mất.
 * App mobile phải hiện được mã bất cứ lúc nào (cài lại app, đổi máy, hoặc đã trả cọc bên web),
 * nên cần đường cấp lại.
 *
 * Mỗi lần gọi sinh token MỚI và ghi đè hash cũ, nên ảnh chụp màn hình mã cũ lập tức vô hiệu.
 * Đó cũng là lý do cấp mới chứ không lưu token bản rõ ở đâu để "đọc lại".
 */
export async function reissueCheckInQr(user: UserHydrated, id: string) {
  const r = await loadReservation(id);
  await assertCanAccess(user, r, 'reservation.qr_reissue');
  if (r.status !== 'CONFIRMED' && r.status !== 'ALLOCATED') {
    throw Unprocessable('Chỉ cấp mã cho đặt chỗ đã xác nhận và chưa nhận kho');
  }
  const token = randomToken(12);
  const qrExpiresAt = addDays(r.startDate, 2);
  r.checkIn = {
    qrTokenHash: sha256(token),
    qrExpiresAt,
    checkedInAt: r.checkIn?.checkedInAt ?? null,
    checkedInBy: r.checkIn?.checkedInBy ?? null,
  };
  await r.save();
  await audit({ action: 'reservation.qr_reissue', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId });
  // Payload chỉ tồn tại trong response này; server không giữ bản rõ.
  return { qrPayload: `SSM:${r.code}:${token}`, code: r.code, expiresAt: qrExpiresAt };
}

// ---------------------------------------------------------------- cancel
export async function cancelReservation(actorUser: UserHydrated | null, id: string, reason: CancellationReason, note?: string) {
  return withTxn(async (session) => {
    const r = await loadReservation(id, session);
    if (actorUser) await assertCanAccess(actorUser, r, 'reservation.cancel');
    const actor = actorUser ? actorUser.role : 'SYSTEM';
    const wasPending = r.status === 'PENDING';
    // Các khoản đã thu lúc đặt chỗ: tiền giữ chân (+ tiền thuê kỳ đầu của kho cỡ lớn). Hoàn theo cùng một %.
    const booked = await PaymentModel.find({ reservationId: r._id, type: { $in: ['DEPOSIT', 'PREPAID_RENT'] } }).session(session);
    const refundPct = reason === 'CUSTOMER_REQUEST' ? (await cancellationRefund(r, session)).pct
      : reason === 'HOLD_EXPIRED' || reason === 'NO_SHOW' || wasPending ? 0
      : 100; // facility-side cancellation: full refund
    const toRefund = booked.filter((p) => p.status === 'SUCCEEDED').map((p) => ({ p, amount: Math.round((p.amount * refundPct) / 100) }));
    const refund = { pct: refundPct, amount: toRefund.reduce((s, x) => s + x.amount, 0) };

    const unitId = r.unitId;
    r.transitionTo('CANCELLED', { actor, by: actorUser?._id ?? null, reason: note ?? reason });
    r.cancellation = { reason, note, cancelledAt: new Date(), cancelledBy: actorUser?._id ?? null, refundAmount: refund.amount };
    r.unitId = null;
    await r.save({ session });

    if (unitId) {
      const released = await StorageUnitModel.updateOne(
        { _id: unitId, status: 'RESERVED', currentReservationId: r._id },
        { $set: { status: 'AVAILABLE', currentReservationId: null, statusChangedAt: new Date(), statusReason: 'Đặt chỗ đã hủy' } },
        { session },
      );
      if (released.matchedCount !== 1) throw Conflict('Trạng thái kho không khớp đặt chỗ — liên hệ quản lý');
    }

    for (const p of booked) {
      if (p.status === 'PENDING') { p.transitionTo('CANCELLED', { actor: 'SYSTEM' }); await p.save({ session }); }
    }
    // Đơn dịch vụ chọn kèm (chưa thu tiền) không còn ý nghĩa khi đặt chỗ huỷ.
    for (const o of await ServiceOrderModel.find({ reservationId: r._id, status: 'REQUESTED' }).session(session)) {
      o.transitionTo('CANCELLED', { actor: 'SYSTEM', reason: 'Đặt chỗ đã huỷ' });
      o.cancelReason = 'Đặt chỗ đã huỷ';
      await o.save({ session });
    }
    for (const { p, amount } of toRefund) {
      if (amount <= 0) continue;
      await createPayment({ facilityId: r.facilityId, customerId: r.customerId, reservationId: r._id, type: 'REFUND', amount, status: 'SUCCEEDED', method: refundMethodFor(p.method), refundOf: p._id }, session);
      p.refundedAmount = amount;
      p.transitionTo(amount >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED', { actor: 'SYSTEM' });
      await p.save({ session });
    }
    await audit({ action: 'reservation.cancel', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId, reason, changes: { after: { refund: refund.amount } } }, session);
    return { reservation: r, refund };
  });
}

// ---------------------------------------------------------------- allocate / unallocate (FACILITY_MANAGER)
/** Hợp đồng khách đã ký ghi đích danh số ô — đổi ô sau khi ký là giao ô khác với văn bản đã ký. */
const assertUnitNotSigned = (r: ReservationHydrated) => {
  if (r.signature) throw Unprocessable('Khách đã ký hợp đồng ghi ô này — không đổi ô trước khi nhận kho. Không giao được ô thì huỷ đặt chỗ (hoàn 100%), hoặc nhận kho rồi đổi ô (Điều 8)', 'ALREADY_SIGNED');
};

/**
 * Phân ô cho đặt chỗ chưa có ô, hoặc ĐỔI sang ô khác cùng loại cho đặt chỗ đã phân (khách chưa ký hợp đồng) — đổi ô thì nhả ô cũ và
 * giữ ô mới trong CÙNG giao dịch, đặt chỗ không lúc nào rơi về trạng thái chưa có ô.
 */
export async function allocate(user: UserHydrated, id: string, unitId?: string) {
  return withTxn(async (session) => {
    const r = await loadReservation(id, session);
    await assertFacility(user, r.facilityId, 'reservation.allocate');
    const previousUnitId = r.status === 'ALLOCATED' ? r.unitId : null;
    if (previousUnitId) {
      assertUnitNotSigned(r);
      if (!unitId) throw Unprocessable('Chọn ô mới để đổi', 'UNIT_REQUIRED');
      if (String(previousUnitId) === unitId) throw Unprocessable('Ô mới trùng ô đang phân', 'SAME_UNIT');
    } else if (r.status !== 'CONFIRMED') r.transitionTo('ALLOCATED', { actor: user.role }); // throws a precise InvalidTransitionError

    // Compare-and-swap: only an AVAILABLE unit of the same facility + type can be taken.
    const filter: Record<string, unknown> = { facilityId: r.facilityId, unitTypeId: r.unitTypeId, status: 'AVAILABLE' };
    if (unitId) filter._id = unitId;
    const unit = await StorageUnitModel.findOneAndUpdate(
      filter,
      { $set: { status: 'RESERVED', currentReservationId: r._id, statusChangedAt: new Date(), statusReason: `Giữ cho ${r.code}` } },
      { new: true, session, sort: { 'location.floor': 1, unitNumber: 1 } },
    );
    if (!unit) throw Conflict(unitId ? 'Kho đã chọn không còn trống hoặc không đúng loại' : 'Không còn kho trống cùng loại để phân', 'UNIT_NOT_AVAILABLE');

    if (previousUnitId) {
      const released = await StorageUnitModel.updateOne({ _id: previousUnitId, status: 'RESERVED', currentReservationId: r._id },
        { $set: { status: 'AVAILABLE', currentReservationId: null, statusChangedAt: new Date(), statusReason: null } }, { session });
      if (released.matchedCount !== 1) throw Conflict('Trạng thái ô cũ không khớp đặt chỗ — liên hệ quản lý');
    } else {
      r.transitionTo('ALLOCATED', { actor: user.role, by: user._id, reason: `Phân kho ${unit.unitNumber}` });
    }
    r.unitId = unit._id;
    r.allocation = { allocatedAt: new Date(), allocatedBy: user._id };
    await r.save({ session }); // partial unique index {unitId} is the last line of defence
    await UnitTypeModel.updateOne({ _id: r.unitTypeId }, { $inc: { inventoryVersion: 1 } }, { session });
    await audit({ action: 'reservation.allocate', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId, changes: { before: previousUnitId ? { unitId: String(previousUnitId) } : { status: 'CONFIRMED' }, after: { status: 'ALLOCATED', unit: unit.unitNumber } } }, session);
    return { reservation: r, unit };
  });
}

export async function unallocate(user: UserHydrated, id: string) {
  return withTxn(async (session) => {
    const r = await loadReservation(id, session);
    await assertFacility(user, r.facilityId, 'reservation.unallocate');
    assertUnitNotSigned(r);
    const unitId = r.unitId;
    r.transitionTo('CONFIRMED', { actor: user.role, by: user._id, reason: 'Gỡ phân kho' });
    r.unitId = null; r.allocation = null;
    await r.save({ session });
    if (unitId) {
      await StorageUnitModel.updateOne({ _id: unitId, status: 'RESERVED', currentReservationId: r._id },
        { $set: { status: 'AVAILABLE', currentReservationId: null, statusChangedAt: new Date(), statusReason: null } }, { session });
    }
    await audit({ action: 'reservation.unallocate', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId }, session);
    return r;
  });
}

// ---------------------------------------------------------------- lookup by code / QR (STAFF, FM)
export async function lookupForCheckIn(user: UserHydrated, codeOrQr: string) {
  const [code, token] = codeOrQr.startsWith('SSM:') ? codeOrQr.slice(4).split(':') : [codeOrQr, undefined];
  const r = await ReservationModel.findOne({ code: code.trim().toUpperCase() });
  if (!r) throw NotFound('mã đặt chỗ');
  await assertFacility(user, r.facilityId, 'reservation.lookup'); // out-of-scope lookups are audited as DENIED
  const tokenValid = token ? r.checkIn?.qrTokenHash === sha256(token) : null;
  const customer = await UserModel.findById(r.customerId, { fullName: 1, phone: 1, status: 1, 'customerProfile.idNumberLast4': 1 }).lean();
  return { reservation: r, customer, qrValid: tokenValid };
}

// ---------------------------------------------------------------- ký hợp đồng (CUSTOMER chủ đặt chỗ — nhân viên không ký thay)
/**
 * Khách ký xác nhận hợp đồng SAU khi đã trả cọc (CONFIRMED/ALLOCATED) và TRƯỚC khi nhận kho — check-in
 * bị chặn nếu chưa ký. Ký bằng cách vẽ tay (ảnh PNG nhỏ) hoặc gõ họ tên. CHỈ chính khách ký trên tài khoản
 * của họ (route chỉ mở cho CUSTOMER) — nhân viên không ký thay. Mỗi đặt chỗ chỉ ký một lần, không sửa lại.
 */
// ---------------------------------------------------------------- OTP trước khi ký online (CUSTOMER chủ đặt chỗ)
const OTP_TTL_MS = 10 * 60_000;
const OTP_COOLDOWN_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;
const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, '$1***$2');

/**
 * Gửi mã 6 số qua email trước khi khách ký hợp đồng online — bước xác nhận khách chủ động ký (Điều 11), không phải ai cầm phiên đăng
 * nhập cũng ký thay được. Mã hết hạn sau 10 phút, sai 5 lần thì phải gửi mã mới, gửi lại sau 60 giây. Chỉ lưu sha256 của mã.
 * Tài khoản demo (tên miền bị chặn gửi thư) không nhận được email → trả mã về để demo; tài khoản thật thì không bao giờ trả mã.
 */
export async function requestSignOtp(user: UserHydrated, id: string) {
  const r = await loadReservation(id);
  await assertCanAccess(user, r, 'reservation.sign_otp');
  if (r.status !== 'CONFIRMED' && r.status !== 'ALLOCATED') throw Unprocessable('Chỉ ký hợp đồng sau khi đã trả tiền giữ chân và trước khi nhận kho');
  if (r.signature) throw Conflict('Hợp đồng này đã được ký', 'ALREADY_SIGNED');
  const now = Date.now();
  if (r.signOtp && now - r.signOtp.sentAt.getTime() < OTP_COOLDOWN_MS) {
    throw new AppError(429, 'OTP_COOLDOWN', `Vừa gửi mã — thử lại sau ${Math.ceil((OTP_COOLDOWN_MS - (now - r.signOtp.sentAt.getTime())) / 1000)} giây`);
  }
  const code = sixDigitPin();
  const expiresAt = new Date(now + OTP_TTL_MS);
  const sent = await sendMail({
    to: user.email, subject: `Mã xác nhận ký hợp đồng ${r.code}`,
    text: `Mã xác nhận ký hợp đồng thuê kho ${r.code}: ${code}
Mã có hiệu lực 10 phút. Không chia sẻ mã này với bất kỳ ai, kể cả nhân viên KhoAn.`,
  });
  const demo = !sent.sent && (sent.reason === 'BLOCKED' || (sent.reason === 'NOT_CONFIGURED' && env.NODE_ENV !== 'production'));
  if (!sent.sent && !demo) throw Unprocessable('Chưa gửi được email mã xác nhận — thử lại sau ít phút', 'OTP_SEND_FAILED');
  r.signOtp = { codeHash: sha256(code), expiresAt, attempts: 0, sentAt: new Date(now) };
  await r.save();
  await audit({ action: 'reservation.sign_otp', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId, changes: { after: { to: maskEmail(user.email), demo } } });
  return { sentTo: maskEmail(user.email), expiresAt: expiresAt.toISOString(), ...(demo ? { demoCode: code } : {}) };
}

/** Kiểm mã OTP NGOÀI giao dịch ký — lần nhập sai phải được ghi lại (giao dịch ký rollback thì mất). */
async function verifySignOtp(id: string, otp?: string) {
  const r = await ReservationModel.findById(id, { signOtp: 1, signature: 1 }).lean();
  if (r?.signature) throw Conflict('Hợp đồng này đã được ký', 'ALREADY_SIGNED');
  if (!otp) throw Unprocessable('Nhập mã xác nhận đã gửi tới email của bạn', 'OTP_REQUIRED');
  const o = r?.signOtp;
  if (!o) throw Unprocessable('Bấm "Gửi mã xác nhận" để nhận mã qua email', 'OTP_REQUIRED');
  if (o.attempts >= OTP_MAX_ATTEMPTS) throw Unprocessable('Nhập sai quá số lần — gửi mã mới', 'OTP_LOCKED');
  if (o.expiresAt.getTime() < Date.now()) throw Unprocessable('Mã đã hết hạn — gửi mã mới', 'OTP_EXPIRED');
  if (sha256(otp) !== o.codeHash) {
    await ReservationModel.updateOne({ _id: id, 'signOtp.codeHash': o.codeHash }, { $inc: { 'signOtp.attempts': 1 } });
    const left = OTP_MAX_ATTEMPTS - o.attempts - 1;
    throw Unprocessable(left > 0 ? `Mã không đúng — còn ${left} lần thử` : 'Nhập sai quá số lần — gửi mã mới', left > 0 ? 'OTP_INVALID' : 'OTP_LOCKED');
  }
}

export async function signContract(user: UserHydrated, id: string, input: { signerName: string; method: SignatureMethod; image?: string | null; otp?: string }) {
  assertContractProfile(user); // thông tin Bên B in trong hợp đồng lấy từ hồ sơ
  if (input.method === 'PAPER') throw Unprocessable('Ký giấy do nhân viên ghi nhận tại quầy');
  await verifySignOtp(id, input.otp);
  await signInTxn(user, id, input);
  // Gửi ngay PDF hợp đồng đã ký tới email khách — lỗi/thiếu cấu hình SMTP không làm hỏng việc ký; chờ tối đa 10 giây rồi trả kết quả.
  await Promise.race([emailContract(null, id).catch((e) => console.error('[contract-email]', e)), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  return loadReservation(id);
}

async function signInTxn(user: UserHydrated, id: string, input: { signerName: string; method: SignatureMethod; image?: string | null }) {
  return withTxn(async (session) => {
    const r = await loadReservation(id, session);
    await assertCanAccess(user, r, 'reservation.sign');
    if (r.status !== 'CONFIRMED' && r.status !== 'ALLOCATED') throw Unprocessable('Chỉ ký hợp đồng sau khi đã trả tiền giữ chân và trước khi nhận kho');
    if (r.signature) throw Conflict('Hợp đồng này đã được ký', 'ALREADY_SIGNED');
    if (input.method === 'DRAWN' && !input.image) throw Unprocessable('Cần vẽ chữ ký');
    if (input.image && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.image)) throw Unprocessable('Ảnh chữ ký không hợp lệ');
    // Chốt NGUYÊN VĂN hợp đồng khách đang ký (dựng từ mẫu đang áp dụng) — về sau mẫu đổi thì hợp đồng này vẫn giữ đúng bản đã ký.
    const view = await contractViewFor(r, { forSigning: true });
    r.signOtp = null; // mã chỉ dùng một lần
    r.signature = {
      signedAt: new Date(), signerName: input.signerName.trim(), method: input.method, image: input.method === 'DRAWN' ? input.image ?? null : null, otpVerifiedAt: new Date(),
      termsVersion: TERMS_VERSION, policyVersion: r.quote.policyVersion, signedBy: user._id, onBehalf: false,
      clauses: view.clauses, templateVersion: view.templateVersion,
      lessorSignatory: { name: view.lessorRepresentative ?? null, authorization: view.lessorAuthorization ?? null },
    };
    await r.save({ session });
    await audit({ action: 'reservation.sign', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId, changes: { after: { method: input.method, templateVersion: view.templateVersion } } }, session);
    return r;
  });
}

// ---------------------------------------------------------------- ký GIẤY tại quầy (STAFF, FM)
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

/**
 * Khách không ký online được: in hợp đồng (GET /reservations/:id/contract-print.pdf), khách ký giấy tại quầy, nhân viên tải bản scan
 * lên (PDF / JPG / PNG ≤ 5MB). Hợp đồng lưu NGUYÊN VĂN điều khoản như bản in + bản scan; nhân viên chỉ ghi nhận, không ký thay.
 */
export async function signPaper(user: UserHydrated, id: string, input: { signerName: string; file: { name: string; contentType: string; base64: string } }) {
  const data = Buffer.from(input.file.base64, 'base64');
  if (!data.length) throw Unprocessable('File bản scan trống');
  if (data.length > PAPER_CONTRACT_MAX_BYTES) throw Unprocessable(`File bản scan tối đa ${PAPER_CONTRACT_MAX_BYTES / 1024 / 1024}MB`, 'FILE_TOO_LARGE');
  if (!(PAPER_CONTRACT_TYPES as readonly string[]).includes(input.file.contentType) || !MAGIC[input.file.contentType]?.(data)) {
    throw Unprocessable('Chỉ nhận file PDF, JPG hoặc PNG của bản hợp đồng đã ký', 'FILE_TYPE');
  }
  return withTxn(async (session) => {
    const r = await loadReservation(id, session);
    await assertFacility(user, r.facilityId, 'reservation.sign_paper');
    if (r.status !== 'CONFIRMED' && r.status !== 'ALLOCATED') throw Unprocessable('Chỉ ghi nhận hợp đồng ký giấy cho đặt chỗ đã trả tiền giữ chân, chưa nhận kho');
    if (r.signature) throw Conflict('Hợp đồng này đã được ký', 'ALREADY_SIGNED');
    const customer = await UserModel.findById(r.customerId).session(session);
    if (!customer) throw NotFound('khách hàng');
    assertContractProfile(customer); // hợp đồng in thông tin Bên B từ hồ sơ khách
    const view = await contractViewFor(r, { forSigning: true });
    const [file] = await ContractFileModel.create([{
      reservationId: r._id, facilityId: r.facilityId, customerId: r.customerId, fileName: input.file.name.slice(0, 200) || `hop-dong-${r.code}`,
      contentType: input.file.contentType, size: data.length, sha256: sha256(data.toString('base64')), data, uploadedBy: user._id,
    }], { session });
    r.signOtp = null;
    r.signature = {
      signedAt: new Date(), signerName: input.signerName.trim(), method: 'PAPER', image: null, fileId: file._id,
      termsVersion: TERMS_VERSION, policyVersion: r.quote.policyVersion, signedBy: user._id, onBehalf: true,
      clauses: view.clauses, templateVersion: view.templateVersion,
      lessorSignatory: { name: view.lessorRepresentative ?? null, authorization: view.lessorAuthorization ?? null },
    };
    await r.save({ session });
    await audit({ action: 'reservation.sign_paper', entityType: 'Reservation', entityId: r._id, facilityId: r.facilityId, changes: { after: { fileId: String(file._id), size: data.length, type: input.file.contentType } } }, session);
    return r;
  });
}

/** Bản scan hợp đồng ký giấy — khách chủ đặt chỗ, nhân viên / quản lý đúng chi nhánh, vận hành. */
export async function signedFileFor(user: UserHydrated, id: string) {
  const r = await loadReservation(id);
  await assertCanAccess(user, r, 'reservation.signed_file');
  if (!r.signature?.fileId) throw NotFound('bản scan hợp đồng');
  const f = await ContractFileModel.findById(r.signature.fileId); // không lean: lean trả Binary của driver, không phải Buffer
  if (!f) throw NotFound('bản scan hợp đồng');
  const ext = f.contentType === 'application/pdf' ? 'pdf' : f.contentType === 'image/png' ? 'png' : 'jpg';
  return { data: f.data, contentType: f.contentType, filename: `hop-dong-${r.code}-da-ky.${ext}` };
}

// ---------------------------------------------------------------- check-in (STAFF, FM)
export async function checkIn(user: UserHydrated, id: string, input: {
  keyTag?: string; payMethod?: PaymentMethod; qrToken?: string; idType?: 'CCCD' | 'PASSPORT'; idNumberLast4?: string;
  goodsCheck: { confirmed: string[]; note?: string; photoUrls?: string[] };
}) {
  return withTxn(async (session) => {
    const r = await loadReservation(id, session);
    await assertFacility(user, r.facilityId, 'reservation.check_in');
    if (r.startDate > todayUTC()) throw Unprocessable('Chưa đến ngày nhận kho theo lịch đặt');
    // Thứ tự: đặt cọc → ký hợp đồng → nhận kho. Chưa ký thì chưa tạo hợp đồng.
    if (!r.signature) throw Unprocessable('Khách chưa ký hợp đồng — cho khách ký xác nhận trước khi nhận kho', 'CONTRACT_NOT_SIGNED');
    if (input.qrToken && r.checkIn?.qrTokenHash !== sha256(input.qrToken)) throw Forbidden('Mã QR không hợp lệ', 'QR_INVALID');
    const customer = await UserModel.findById(r.customerId).session(session);
    if (!customer || customer.status === 'SUSPENDED') throw Unprocessable('Tài khoản khách đang bị tạm khóa');
    // Kiểm tra hàng hoá khách mang vào (Điều 4): nhân viên xác nhận ĐỦ các nhóm hàng cấm đều không có — có hàng cấm thì không bàn giao.
    const missing = INTAKE_CHECK_ITEMS.filter((i) => !input.goodsCheck?.confirmed?.includes(i.key));
    if (missing.length) throw Unprocessable(`Chưa kiểm tra hàng hoá: ${missing.map((i) => i.label.replace(/^Không có /, '')).join('; ')} — có hàng cấm thì không bàn giao kho`, 'GOODS_CHECK_REQUIRED');
    // Đối chiếu giấy tờ tùy thân BẢN GỐC (route bắt buộc nhân viên xác nhận đã đối chiếu): 4 số cuối khách xuất trình phải khớp
    // thông tin khách đã khai (in trong hợp đồng đã ký). Đặt chỗ cũ khách chưa khai → nhân viên nhập tại quầy và lưu vào hồ sơ.
    const declared = customer.customerProfile?.idNumberLast4 ? { idType: customer.customerProfile.idType ?? 'CCCD', idNumberLast4: customer.customerProfile.idNumberLast4.toUpperCase() } : null;
    if (declared && input.idNumberLast4 && input.idNumberLast4 !== declared.idNumberLast4) {
      throw Unprocessable('4 số cuối giấy tờ khách xuất trình KHÁC thông tin khách đã khai khi ký hợp đồng — không bàn giao kho, báo quản lý chi nhánh', 'ID_MISMATCH');
    }
    if (!declared && (!input.idType || !input.idNumberLast4)) throw Unprocessable('Khách chưa khai giấy tờ tùy thân — nhập loại giấy tờ và 4 số cuối theo bản gốc khách xuất trình', 'ID_REQUIRED');
    const identity = declared ?? { idType: input.idType!, idNumberLast4: input.idNumberLast4! };
    if (!declared) {
      customer.customerProfile = { ...(customer.customerProfile ?? {}), ...identity } as typeof customer.customerProfile;
      await customer.save({ session });
    }

    // Chu kỳ thuê là khách đã chọn lúc đặt, chốt sẵn trong quote — không suy ra từ loại kho.
    const period = r.quote.rentalPeriod;

    // Kho cỡ lớn: tiền thuê kỳ đầu đã thu CÙNG LÚC đặt chỗ → không thu lại. Kho thường: thu tại quầy bằng phương thức nhân viên chọn.
    if (r.quote.firstPeriodAtBooking) {
      const prepaid = await PaymentModel.exists({ reservationId: r._id, type: 'PREPAID_RENT', status: 'SUCCEEDED' }).session(session);
      if (!prepaid) throw Unprocessable('Chưa ghi nhận tiền thuê kỳ đầu đã trả khi đặt chỗ — liên hệ quản lý', 'PREPAID_RENT_MISSING');
    }
    // Tiền thuê còn phải thu tại quầy: 1 kỳ (thuê tháng, kho thường) hoặc trọn cả thời hạn (thuê ngày / tuần).
    const dueNow = dueAtCheckIn(r.quote);
    // Dịch vụ khách chọn kèm lúc đặt (đơn riêng) — thu cùng lúc nhận kho.
    const bookedServices = await ServiceOrderModel.find({ reservationId: r._id, status: 'REQUESTED', paymentId: null }).session(session);
    if ((dueNow > 0 || bookedServices.length) && !input.payMethod) throw Unprocessable('Chọn phương thức thu tiền khi nhận kho', 'PAY_METHOD_REQUIRED');

    // Điều khoản hợp đồng (ân hạn, ngày khoá) theo đúng chính sách khách đã ký lúc đặt chỗ, không theo bản mới phát hành sau đó.
    const policy = await signedPolicy(r.quote.policyId, r.facilityId, session);
    const now = new Date();
    const today = todayUTC();
    const contractId = new Types.ObjectId();

    const unit = await StorageUnitModel.findOneAndUpdate(
      { _id: r.unitId, status: 'RESERVED', currentReservationId: r._id },
      { $set: { status: 'OCCUPIED', currentReservationId: null, currentContractId: contractId, statusChangedAt: now, statusReason: null } },
      { new: true, session },
    );
    if (!unit) throw Conflict('Kho được phân không còn ở trạng thái giữ chỗ', 'UNIT_STATE_MISMATCH');
    // Ô dùng chìa / thẻ: phải ghi đã giao chìa / thẻ nào — để đối chiếu khi trả kho, báo mất, mở hộ.
    if (unit.accessMethod !== 'PIN' && !input.keyTag?.trim()) {
      throw Unprocessable(`Ô ${unit.unitNumber} dùng ${unit.accessMethod === 'RFID_CARD' ? 'thẻ' : 'chìa'} — nhập mã chìa / số thẻ đã giao cho khách`, 'KEYTAG_REQUIRED');
    }

    // Hình thức khoá đến từ chính ô khách nhận (unit.accessMethod), không phải loại kho — mỗi ô có
    // thể khác nhau trong cùng một loại. Nhân viên không tự chọn tại quầy.
    const pin = unit.accessMethod === 'PIN' ? sixDigitPin() : undefined;
    // Kỳ thu tiền kế tiếp bắt đầu sau các kỳ đã trả trước: thuê tháng là tháng sau; thuê ngày / tuần là hết thời hạn đã đặt
    // (đến lúc đó mà chưa trả kho thì job mới tính tiếp từng kỳ).
    const nextBilling = addPeriodsUTC(today, period, Math.max(1, r.quote.prepaidPeriods ?? 1));
    const periodEnd = addDays(nextBilling, -1);
    if (dueNow > 0 && input.payMethod) {
      await createPayment({
        facilityId: r.facilityId, customerId: r.customerId, contractId, reservationId: r._id, type: 'RENT',
        amount: dueNow, status: 'SUCCEEDED', method: input.payMethod,
        recordedBy: input.payMethod === 'CASH' ? user._id : null, period: { start: today, end: periodEnd },
        // Mỗi đặt chỗ chỉ có đúng một khoản thu tiền thuê kỳ đầu — bấm nhận kho hai lần cũng không thu thêm được.
        idempotencyKey: `checkin-rent-${r._id}`,
      }, session);
    }

    const [contract] = await RentalContractModel.create([{
      _id: contractId, facilityId: r.facilityId, customerId: r.customerId, unitId: unit._id, unitTypeId: r.unitTypeId, reservationId: r._id,
      status: 'ACTIVE', startDate: today, endDate: addPeriodsUTC(today, period, r.periods),
      // Không tự gia hạn ngầm: hết hạn mà khách không gia hạn thì tính tiếp theo giá chưa ưu đãi (xem jobs/runBilling).
      autoRenew: false,
      commitments: [{ kind: 'INITIAL', startDate: today, endDate: addPeriodsUTC(today, period, r.periods), periods: r.periods, gross: r.quote.rate + r.quote.surchargeAmount, discountAmount: r.quote.discountAmount, rate: r.quote.firstPeriodRent, policyId: r.quote.policyId, at: now }],
      useAirConditioning: r.useAirConditioning,
      billing: { currency: 'VND', rentalPeriod: period, rate: r.quote.firstPeriodRent, nextBillingDate: nextBilling, paidThrough: periodEnd },
      deposit: { amount: r.quote.depositAmount, status: 'HELD', paymentId: r.depositPaymentId ?? null, refundedAmount: 0 },
      balance: { outstanding: 0, lastPaymentAt: now },
      access: { method: unit.accessMethod, keyTag: input.keyTag ?? null, credentialHash: pin ? sha256(pin) : null, credentialEnc: pin ? encryptSecret(pin) : null, issuedAt: now, issuedBy: user._id },
      terms: { policyId: policy._id, policyVersion: policy.version, gracePeriodDays: policy.gracePeriodDays, lockoutAfterDays: policy.lockoutAfterDays, signedAt: r.signature.signedAt, signatureRef: `esign-${r._id}`, signerName: r.signature.signerName },
      statusHistory: [{ from: null, to: 'ACTIVE', at: now, by: user._id }],
      identity: { ...identity, verifiedAt: now, verifiedBy: user._id, verifiedByName: user.fullName },
      intakeCheck: {
        checkedAt: now, checkedBy: user._id, items: INTAKE_CHECK_ITEMS.map((i) => i.key),
        note: input.goodsCheck.note?.trim() || null, photoUrls: input.goodsCheck.photoUrls ?? [],
      },
    }], { session });

    // Thu tiền các đơn dịch vụ chọn kèm và gắn đơn vào hợp đồng (từ đây đi theo luồng dịch vụ thường: làm xong / huỷ hoàn đủ).
    for (const o of bookedServices) {
      const pay = await createPayment({
        facilityId: r.facilityId, customerId: r.customerId, contractId, reservationId: r._id, type: 'SERVICE', amount: o.total, status: 'SUCCEEDED',
        method: input.payMethod!, recordedBy: input.payMethod === 'CASH' ? user._id : null, idempotencyKey: `checkin-svc-${o._id}`,
      }, session);
      o.contractId = contractId;
      o.paymentId = pay._id;
      await o.save({ session });
    }

    r.transitionTo('CHECKED_IN', { actor: user.role, by: user._id });
    r.contractId = contractId;
    r.checkIn = { qrTokenHash: r.checkIn?.qrTokenHash ?? null, qrExpiresAt: r.checkIn?.qrExpiresAt ?? null, checkedInAt: now, checkedInBy: user._id };
    await r.save({ session });
    await audit({ action: 'reservation.check_in', entityType: 'RentalContract', entityId: contractId, facilityId: r.facilityId, changes: { after: { unit: unit.unitNumber, access: unit.accessMethod, rent: r.quote.firstPeriodRent, rentCollected: dueNow, prepaidPeriods: r.quote.prepaidPeriods ?? 1, rentPrepaid: !!r.quote.firstPeriodAtBooking } } }, session);
    return { contract, unit, pin }; // PIN is returned exactly once; only its hash is stored
  });
}

export type { ReservationHydrated };
