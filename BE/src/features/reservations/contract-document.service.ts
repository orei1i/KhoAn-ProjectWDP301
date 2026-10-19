import { authorizationText, buildContractClauses, ID_TYPE_LABEL, TERMS_VERSION, type ContractClause } from '@ssm/shared';
import {
  FacilityModel, PolicyModel, RentalContractModel, ReservationModel, StorageUnitModel, UnitTypeModel, UserModel,
  type ReservationHydrated, type UserHydrated,
} from '../../shared/db/models';
import { AppError, Conflict, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess } from '../../shared/http/scope';
import { sendMail } from '../../shared/mail/mailer';
import { effectivePolicy } from '../policies/pricing';
import { buildContractPdf } from '../contracts/contract-pdf';
import { effectiveTemplate } from '../contract-templates/contract-template.service';

/**
 * Thông tin hai bên in trên hợp đồng và phụ lục: Bên B lấy từ hồ sơ khách; người đại diện Bên A là Quản lý chi nhánh đang hoạt
 * động của chi nhánh đó (theo uỷ quyền) — chưa gán quản lý thì hợp đồng ghi người đại diện theo pháp luật của công ty.
 */
export async function contractParties(facilityId: unknown, customerId: unknown) {
  const [facility, customer, manager] = await Promise.all([
    FacilityModel.findById(facilityId).lean(),
    UserModel.findById(customerId, { fullName: 1, phone: 1, email: 1, 'customerProfile.idNumberLast4': 1 }).lean(),
    UserModel.findOne({ role: 'FACILITY_MANAGER', facilityIds: facilityId, status: 'ACTIVE' }, { fullName: 1, authorization: 1 }).sort({ createdAt: 1 }).lean(),
  ]);
  return {
    facilityName: facility?.name ?? '—', facilityAddress: facility ? `${facility.address.line1}, ${facility.address.district}, ${facility.address.city}` : null,
    lessorRepresentative: manager?.fullName ?? null,
    lessorAuthorization: manager ? authorizationText(manager.authorization) : null,
    customerName: customer?.fullName ?? '—', customerPhone: customer?.phone ?? null, customerEmail: customer?.email ?? null,
    customerIdLast4: customer?.customerProfile?.idNumberLast4 ?? null,
  };
}

const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, '$1***$2');

async function loadSigned(id: string) {
  const r = await ReservationModel.findById(id);
  if (!r) throw NotFound('đặt chỗ');
  return r;
}

export interface ContractView {
  clauses: ContractClause[]; templateVersion: number; signed: boolean;
  /** Dữ liệu tiêu đề để nơi hiển thị không phải tự tra lại. */
  facilityName: string; contractNumber: string | null;
  /** Quản lý chi nhánh đại diện Bên A (để in ở khối chữ ký). */
  lessorRepresentative?: string | null;
  lessorAuthorization?: string | null;
}

/**
 * Điều khoản của một đặt chỗ — MỘT chỗ duy nhất cho bản xem (web/app), bản lưu lúc ký và PDF:
 *  - đã ký và có bản lưu → trả NGUYÊN VĂN lúc ký (mẫu / mã nguồn đổi về sau không ảnh hưởng);
 *  - chưa ký (hoặc ký trước khi có bản lưu) → dựng từ mẫu đang áp dụng cho chi nhánh.
 * `forSigning`: dựng bản sẽ được lưu khi khách ký ngay bây giờ (Điều khoản hiện hành, khoản giữ chân đã thanh toán).
 */
export async function contractViewFor(r: ReservationHydrated, opts: { forSigning?: boolean } = {}): Promise<ContractView> {
  const [parties, unit, type, contract] = await Promise.all([
    contractParties(r.facilityId, r.customerId),
    r.unitId ? StorageUnitModel.findById(r.unitId).lean() : null,
    UnitTypeModel.findById(r.unitTypeId).lean(),
    r.contractId ? RentalContractModel.findById(r.contractId, { contractNumber: 1 }).lean() : null,
  ]);
  // Đã ký → đại diện Bên A như lúc ký (bản ký cũ chưa lưu thì lấy quản lý hiện hành).
  const frozen = !opts.forSigning ? r.signature?.lessorSignatory : null;
  const head = {
    facilityName: parties.facilityName, contractNumber: contract?.contractNumber ?? null,
    lessorRepresentative: frozen ? frozen.name : parties.lessorRepresentative, lessorAuthorization: frozen ? frozen.authorization : parties.lessorAuthorization,
  };
  if (!opts.forSigning && r.signature?.clauses?.length) {
    return { ...head, clauses: r.signature.clauses.map((c) => ({ title: c.title, paragraphs: [...c.paragraphs], bullets: [...c.bullets] })), templateVersion: r.signature.templateVersion ?? 0, signed: true };
  }
  const policy = (await PolicyModel.findById(r.quote.policyId)) ?? (await effectivePolicy(r.facilityId));
  const template = await effectiveTemplate(r.facilityId);
  const clauses = buildContractClauses({
    code: r.code, contractNumber: contract?.contractNumber,
    ...parties, unitTypeName: type?.name ?? '—',
    unitNumber: unit?.unitNumber, floor: unit?.location.floor, zone: unit?.location.zone, areaM2: type?.areaM2, accessMethod: unit?.accessMethod,
    useAirConditioning: r.useAirConditioning, rentalPeriod: r.quote.rentalPeriod, periods: r.periods,
    startDate: r.startDate.toISOString(), endDate: r.endDate.toISOString(), quote: r.quote, depositPaid: !!r.depositPaymentId,
    termsVersion: opts.forSigning ? TERMS_VERSION : r.signature?.termsVersion, // hợp đồng đã ký giữ đúng phiên bản Điều khoản lúc ký
    policy: policy.toObject(),
  }, template.clauses);
  return { ...head, clauses, templateVersion: template.version, signed: !!r.signature };
}

/** Bản xem hợp đồng cho chủ đặt chỗ hoặc nhân viên/quản lý đúng chi nhánh (cả khi chưa ký — để đọc trước khi ký). */
export async function contractViewForUser(user: UserHydrated, id: string) {
  const r = await loadSigned(id);
  await assertCanAccess(user, r, 'reservation.contract_view');
  return contractViewFor(r);
}

/** Dựng PDF hợp đồng đã ký — cùng điều khoản với bản xem trên web/mobile. */
async function renderPdf(r: ReservationHydrated, customer: { fullName: string; email: string }) {
  if (!r.signature) throw Unprocessable('Hợp đồng chưa được ký');
  const { clauses, facilityName, contractNumber, lessorRepresentative, lessorAuthorization } = await contractViewFor(r);
  const facility = { name: facilityName };
  const contract = { contractNumber };
  // Lần đối chiếu giấy tờ tùy thân bản gốc lúc bàn giao kho (có từ khi nhận kho) — in thêm, không đụng nội dung đã ký.
  const id = r.contractId ? (await RentalContractModel.findById(r.contractId, { identity: 1 }).lean())?.identity : null;
  const when = (d: Date) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const identityNote = id ? `Khi bàn giao kho lúc ${when(id.verifiedAt)}, nhân viên ${id.verifiedByName} đã đối chiếu giấy tờ tùy thân bản gốc của Bên B: ${ID_TYPE_LABEL[id.idType]}, 4 ký tự cuối ${id.idNumberLast4}.` : null;
  const pdf = await buildContractPdf({
    code: r.code, contractNumber: contract?.contractNumber, facilityName: facility?.name ?? '—', customerName: customer.fullName, clauses, lessorRepresentative, lessorAuthorization,
    signature: { signedAt: r.signature.signedAt, signerName: r.signature.signerName, method: r.signature.method, image: r.signature.image, onBehalf: r.signature.onBehalf },
    generatedAt: new Date(), identityNote,
  });
  return { pdf, filename: `hop-dong-${r.code}.pdf` };
}

/** Tải PDF hợp đồng đã ký (khách là chủ đặt chỗ, hoặc nhân viên/quản lý đúng chi nhánh). */
export async function contractPdfFor(user: UserHydrated, id: string) {
  const r = await loadSigned(id);
  await assertCanAccess(user, r, 'reservation.contract_pdf');
  const customer = await UserModel.findById(r.customerId, { fullName: 1, email: 1 }).lean();
  return renderPdf(r, { fullName: customer?.fullName ?? '—', email: customer?.email ?? '' });
}

export type EmailOutcome = { sent: true; to: string } | { sent: false; reason: 'NOT_CONFIGURED' | 'FAILED' | 'NO_EMAIL' | 'BLOCKED' };

/**
 * Gửi PDF hợp đồng đã ký tới email của khách. `user = null` là lần gửi tự động ngay sau khi ký;
 * có `user` là gửi lại theo yêu cầu (chặn gửi dồn dập). Không bao giờ ném lỗi vì SMTP — chỉ trả kết quả.
 */
export async function emailContract(user: UserHydrated | null, id: string, opts: { resend?: boolean } = {}): Promise<EmailOutcome> {
  const r = await loadSigned(id);
  if (user) await assertCanAccess(user, r, 'reservation.contract_email');
  if (!r.signature) throw Unprocessable('Hợp đồng chưa được ký');
  const last = r.signature.emailedAt;
  if (opts.resend && last && Date.now() - last.getTime() < 60_000) throw Conflict('Vừa gửi xong, hãy thử lại sau ít phút', 'TOO_SOON');

  const customer = await UserModel.findById(r.customerId, { fullName: 1, email: 1 }).lean();
  if (!customer?.email) return { sent: false, reason: 'NO_EMAIL' };
  const { pdf, filename } = await renderPdf(r, { fullName: customer.fullName, email: customer.email });

  const result = await sendMail({
    to: customer.email,
    subject: `KhoAn — Hợp đồng thuê kho ${r.code} đã ký`,
    text: `Xin chào ${customer.fullName},\n\nCảm ơn bạn đã ký hợp đồng thuê kho (mã đặt chỗ ${r.code}). Bản PDF hợp đồng đã ký được đính kèm email này — vui lòng lưu lại.\n\nKhoAn`,
    html: `<p>Xin chào <b>${customer.fullName.replace(/[<>&]/g, '')}</b>,</p><p>Cảm ơn bạn đã ký hợp đồng thuê kho (mã đặt chỗ <b>${r.code}</b>). Bản PDF hợp đồng đã ký được đính kèm email này — vui lòng lưu lại.</p><p>KhoAn</p>`,
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  });
  if (!result.sent) return { sent: false, reason: result.reason };

  r.signature.emailedAt = new Date();
  r.signature.emailedTo = maskEmail(customer.email);
  await r.save();
  return { sent: true, to: maskEmail(customer.email) };
}

/** Dùng cho route gửi lại: chưa cấu hình/gửi lỗi thì báo rõ cho người bấm thay vì im lặng. */
export async function resendContractEmail(user: UserHydrated, id: string) {
  const out = await emailContract(user, id, { resend: true });
  if (out.sent) return out;
  if (out.reason === 'NOT_CONFIGURED') throw new AppError(503, 'MAIL_NOT_CONFIGURED', 'Hệ thống chưa cấu hình gửi email — hãy tải PDF thay thế');
  if (out.reason === 'NO_EMAIL') throw Unprocessable('Khách chưa có địa chỉ email');
  if (out.reason === 'BLOCKED') throw Unprocessable('Địa chỉ email thuộc tài khoản demo — hệ thống không gửi thư tới tên miền này', 'MAIL_BLOCKED');
  throw new AppError(502, 'MAIL_FAILED', 'Gửi email không thành công, vui lòng thử lại sau');
}
