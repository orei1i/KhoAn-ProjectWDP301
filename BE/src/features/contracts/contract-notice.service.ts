import { Types } from 'mongoose';
import { abandonDaysOf, DISPOSAL_METHOD, expiryHoldUntil, expiryLockFrom, fmtDate, storageFeeOf, usesGraceHold, vnd, type AbandonedItemsDisposal, type ContractNoticeKind, type NoticeEmailStatus } from '@ssm/shared';
import { FacilityModel, RentalContractModel, StorageUnitModel, UserModel } from '../../shared/db/models';
import { isBlockedAddress, sendMail } from '../../shared/mail/mailer';
import { signedPolicy } from '../policies/pricing';

/**
 * THÔNG BÁO CÔNG NỢ cho khách — đúng các mốc Điều 7 của Điều khoản: hết ân hạn (cảnh báo), khoá quyền ra vào, THÔNG BÁO CUỐI
 * (bắt buộc trước khi xử lý đồ bỏ lại) và kết quả xử lý đồ bỏ lại.
 *
 * Hai bước tách rời:
 *  1. `addNotice` — ghi thông báo vào hợp đồng TRONG transaction của nghiệp vụ (khoá kho, gửi thông báo cuối…): khách thấy ngay trong
 *     tài khoản, và đây là chứng cứ "đã báo" (thời điểm, dư nợ, hạn chót) — gửi email lỗi cũng không làm mất.
 *  2. `deliverNotices` — gửi email SAU khi transaction đã commit (không gửi thư cho một thao tác có thể bị rollback), rồi ghi kết quả gửi.
 */

/** Thông tin phụ cho nội dung email — không lưu vào hợp đồng. */
export interface NoticeExtra {
  disposalMethod?: AbandonedItemsDisposal; itemCount?: number;
  depositApplied?: number; proceeds?: number; costs?: number; refund?: number; shortfall?: number;
  /** Điều khoản 1.24: phí lưu giữ đã tính vào quyết toán; `byExpiry` = xử lý đồ sau khi khoá do hết hạn (không phải do nợ). */
  storageFee?: number; byExpiry?: boolean;
}
/** Thông báo vừa ghi, chờ gửi email sau khi transaction commit. */
export interface PendingNotice { contractId: string; noticeId: string; extra?: NoticeExtra }

interface NoticeTarget {
  _id: unknown;
  notices?: unknown[] | null;
}

const NOTICES_MAX = 200;

export function addNotice(
  c: NoticeTarget & { set: (path: string, v: unknown) => unknown },
  kind: ContractNoticeKind,
  data: { amountDue: number; deadline?: Date | null; note?: string | null; by?: unknown; extra?: NoticeExtra; endDate?: Date | null },
): PendingNotice {
  const _id = new Types.ObjectId();
  // Giữ NOTICES_MAX thông báo gần nhất (giới hạn của schema) — hợp đồng thuê nhiều năm không bị kẹt vì đầy danh sách.
  c.set('notices', [...(c.notices ?? []).slice(-(NOTICES_MAX - 1)), {
    _id, kind, at: new Date(), amountDue: Math.max(0, Math.round(data.amountDue)), deadline: data.deadline ?? null,
    note: data.note?.trim() || null, by: data.by ?? null, email: { status: 'PENDING', to: null, at: null },
    endDate: data.endDate ?? null, manualDelivery: null,
  }]);
  return { contractId: String(c._id), noticeId: String(_id), extra: data.extra };
}

const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, '$1***$2');
const iso = (d?: Date | null) => (d ? d.toISOString() : null);

/**
 * Có được gửi email thông báo hợp đồng tới khách này không (A4): khách có tài khoản đăng nhập (tự đăng ký / đã liên kết) HOẶC email
 * đã được xác minh (mã 6 số khi tạo tài khoản tại quầy). Hồ sơ nhập tay chưa xác minh hay dữ liệu seed có thể mang địa chỉ của người
 * lạ → không gửi (thông báo vẫn lưu trong hệ thống). Địa chỉ thuộc tên miền bị chặn (tài khoản demo) cũng không gửi.
 */
export const canEmailCustomer = (u: { email?: string | null; firebaseUid?: string | null; emailVerifiedAt?: Date | null } | null | undefined) =>
  !!u?.email && (!!u.firebaseUid || !!u.emailVerifiedAt) && !isBlockedAddress(u.email);

/**
 * Gửi một email thông tin cho khách theo đúng quy tắc trên (VD nhân viên đăng ký trả kho thay khách, chi nhánh giữ đồ khách để lại).
 * Không bao giờ ném lỗi — lỗi gửi không làm hỏng thao tác nghiệp vụ; trả trạng thái gửi.
 */
export async function mailCustomer(customerId: unknown, subject: string, lines: string[]): Promise<NoticeEmailStatus> {
  try {
    const customer = await UserModel.findById(customerId, { fullName: 1, email: 1, firebaseUid: 1, emailVerifiedAt: 1 }).lean();
    if (!customer?.email) return 'NO_EMAIL';
    if (!canEmailCustomer(customer)) return 'SKIPPED';
    const all = [`Xin chào ${customer.fullName},`, ...lines];
    const r = await sendMail({ to: customer.email, subject, text: [...all, '', 'KhoAn'].join('\n\n'), html: all.map((l) => `<p>${l.replace(/[<>&]/g, '')}</p>`).join('') + '<p>KhoAn</p>' });
    return r.sent ? 'SENT' : r.reason === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : r.reason === 'BLOCKED' ? 'SKIPPED' : 'FAILED';
  } catch (e) {
    console.error('[mail-customer]', e instanceof Error ? e.message : e);
    return 'FAILED';
  }
}

export function composeNotice(kind: ContractNoticeKind, v: {
  name: string; contractNumber: string; facility: string; phone: string; unit: string; amountDue: number; deadline: Date | null;
  lockAfterDays: number; waitDays: number; note: string | null; extra: NoticeExtra; endDate?: Date | null;
  /** Đợt 16 (C7): trạng thái hợp đồng lúc gửi — không ACTIVE (đang nợ…) thì nhắc thanh toán dư nợ để gia hạn được. */
  contractStatus?: string | null;
  /**
   * Điều khoản 1.24 — quy tắc hết hạn của hợp đồng (null = hợp đồng cũ: hết hạn vẫn tính tiền thuê). `lockFrom` / `holdUntil`: ngày khoá đã báo,
   * ngày đầu tiên được xử lý đồ; `feeSoFar`: phí lưu giữ tạm tính tới hôm nay.
   */
  expiry?: { graceDays: number; holdDays: number; dailyFee: number; lockFrom: Date | null; holdUntil: Date | null; feeSoFar: number } | null;
}) {
  const head = `Xin chào ${v.name},`;
  const day = (d: Date | null | undefined) => fmtDate(iso(d ?? null));
  const prev = (d: Date | null | undefined) => (d ? fmtDate(iso(new Date(d.getTime() - 86_400_000))) : '—');
  const x = v.expiry ?? null;
  const ref = `Hợp đồng ${v.contractNumber} — ô kho ${v.unit}, ${v.facility}.`;
  const pay = 'Bạn thanh toán ngay trên trang web KhoAn (mục Kho đang thuê) hoặc ứng dụng KhoAn (tab Kho của tôi), hoặc tại quầy chi nhánh.';
  const contact = `Cần hỗ trợ, vui lòng gọi chi nhánh: ${v.phone}.`;
  switch (kind) {
    case 'GRACE_EXPIRED':
      return {
        subject: `KhoAn — Nhắc thanh toán quá hạn hợp đồng ${v.contractNumber}`,
        lines: [head, ref, `Tiền thuê đã quá thời gian ân hạn. Dư nợ hiện tại: ${vnd(v.amountDue)} (đã gồm phí trễ hạn theo chính sách).`,
          `Nếu chưa thanh toán, quyền ra vào kho sẽ bị khoá từ ngày ${fmtDate(iso(v.deadline))} (quá hạn trên ${v.lockAfterDays} ngày, theo hợp đồng).`, pay, contact],
      };
    case 'LOCKED_OUT':
      return {
        subject: `KhoAn — Đã tạm khoá quyền ra vào kho (hợp đồng ${v.contractNumber})`,
        lines: [head, ref, `Do quá hạn thanh toán trên ${v.lockAfterDays} ngày, quyền ra vào ô kho đã bị tạm khoá. Đồ trong kho vẫn được giữ nguyên.`,
          `Dư nợ hiện tại: ${vnd(v.amountDue)}. Thanh toán đủ dư nợ là được mở lại quyền ra vào ngay.`,
          `Nếu vẫn chưa thanh toán, KhoAn sẽ gửi THÔNG BÁO CUỐI; sau ${v.waitDays} ngày kể từ thông báo cuối, chi nhánh được mở kho, kiểm kê và thanh lý đồ trong kho để bù công nợ.`, pay, contact],
      };
    case 'FINAL_NOTICE':
      return {
        subject: `KhoAn — THÔNG BÁO CUỐI về công nợ hợp đồng ${v.contractNumber}`,
        lines: [head, ref, 'Đây là THÔNG BÁO CUỐI về khoản nợ quá hạn của bạn.',
          `Dư nợ hiện tại: ${vnd(v.amountDue)}. Hạn chót thanh toán hoặc liên hệ chi nhánh: hết ngày ${fmtDate(iso(v.deadline ? new Date(v.deadline.getTime() - 86_400_000) : null))}.`,
          `Từ ngày ${fmtDate(iso(v.deadline))}, nếu bạn chưa thanh toán hay liên hệ, chi nhánh được mở kho, kiểm kê (có lập biên bản, chụp ảnh) và thanh lý đồ trong kho.`,
          'Tiền giữ chân và tiền thu được từ thanh lý sẽ dùng để trừ công nợ và chi phí kiểm kê, thanh lý; phần còn dư được trả lại bạn, phần còn thiếu bạn vẫn phải thanh toán.',
          ...(v.note ? [`Ghi chú của chi nhánh: ${v.note}`] : []), pay, contact],
      };
    // Điều khoản 1.24 — hết hạn mà chưa gia hạn / bàn giao: báo ân hạn + ngày khoá (EXPIRY_GRACE), rồi báo đã khoá — thông báo cuối (EXPIRY_LOCKED).
    case 'EXPIRY_GRACE': {
      const lockFrom = x?.lockFrom ?? v.deadline;
      return {
        subject: `KhoAn — Hợp đồng ${v.contractNumber} đã hết hạn: gia hạn hoặc trả kho trước ngày ${day(lockFrom)}`,
        lines: [head, ref, `Thời hạn thuê kho của bạn đã kết thúc hết ngày ${prev(v.endDate)}. Từ ngày ${day(v.endDate)} KHÔNG tính thêm tiền thuê.`,
          `Bạn có ân hạn đến hết ngày ${prev(lockFrom)}: ${v.contractStatus === 'LOCKED_OUT' ? 'quyền ra vào đang bị khoá do quá hạn thanh toán — thanh toán dư nợ để mở lại' : 'vẫn ra vào kho bình thường'}. Muốn thuê tiếp: chọn Gia hạn trên trang web KhoAn (mục Kho đang thuê) hoặc ứng dụng KhoAn (tab Kho của tôi) — thời gian gia hạn tính từ ngày ${day(v.endDate)}, không tính phí lưu giữ. Không thuê tiếp: đăng ký trả kho và bàn giao kho trước ngày ${day(lockFrom)}.`,
          `Nếu không gia hạn, phí lưu giữ ${vnd(x?.dailyFee ?? 0)}/ngày tính từ ngày ${day(v.endDate)} tới ngày bạn bàn giao kho, trừ vào tiền giữ chân khi quyết toán.`,
          `Từ ngày ${day(lockFrom)}, nếu chưa gia hạn hay bàn giao: quyền ra vào bị khoá, đồ được giữ ${x?.holdDays ?? 14} ngày và chỉ lấy được tại quầy chi nhánh; quá hạn giữ đồ, chi nhánh xử lý đồ theo quy định về hàng bỏ lại.`,
          ...(v.amountDue > 0 ? [`Dư nợ hiện tại: ${vnd(v.amountDue)}.`, pay] : []), contact],
      };
    }
    case 'EXPIRY_LOCKED': {
      const holdUntil = x?.holdUntil ?? v.deadline;
      return {
        subject: `KhoAn — THÔNG BÁO CUỐI: đã khoá kho hết hạn ${v.contractNumber}, giữ đồ đến hết ngày ${prev(holdUntil)}`,
        lines: [head, ref, 'Đây là THÔNG BÁO CUỐI.',
          `Hợp đồng đã hết hạn (hết ngày ${prev(v.endDate)}) mà chưa gia hạn hay bàn giao kho nên quyền ra vào ô kho đã bị khoá; hợp đồng không gia hạn được nữa.`,
          `Vui lòng mang giấy tờ tùy thân đến quầy chi nhánh trước hết ngày ${prev(holdUntil)} để lấy đồ và làm thủ tục trả kho (nhân viên kiểm ô, quản lý duyệt biên bản, bạn xác nhận bằng mã OTP).`,
          `Phí lưu giữ ${vnd(x?.dailyFee ?? 0)}/ngày tính từ ngày ${day(v.endDate)} (tạm tính đến hôm nay: ${vnd(x?.feeSoFar ?? 0)}), trừ vào tiền giữ chân khi quyết toán; vượt tiền giữ chân thì bạn thanh toán phần còn thiếu.`,
          `Từ ngày ${day(holdUntil)}, nếu bạn không đến, chi nhánh được mở kho, kiểm kê (có lập biên bản, chụp ảnh) và thanh lý / quyên tặng / tiêu huỷ đồ trong kho. Tiền giữ chân và tiền thu từ thanh lý dùng để trừ công nợ, phí lưu giữ và chi phí; phần còn dư trả lại bạn, phần còn thiếu bạn vẫn phải thanh toán.`,
          ...(v.note ? [`Ghi chú: ${v.note}`] : []),
          ...(v.amountDue > 0 ? [`Dư nợ hiện tại: ${vnd(v.amountDue)} (trả nợ không mở lại quyền ra vào).`] : []), contact],
      };
    }
    case 'ABANDONED': {
      const x = v.extra;
      return {
        subject: `KhoAn — Đã xử lý đồ bỏ lại và quyết toán hợp đồng ${v.contractNumber}`,
        lines: [head, ref, `${x.byExpiry ? 'Đã hết thời hạn giữ đồ sau khi kho bị khoá do hết hạn' : 'Đã hết hạn chót trong thông báo cuối'} mà chưa nhận được thanh toán hay liên hệ, chi nhánh đã mở kho, kiểm kê ${x.itemCount ?? 0} hạng mục và xử lý theo phương án: ${x.disposalMethod ? DISPOSAL_METHOD[x.disposalMethod] : '—'}.`,
          `Quyết toán: công nợ ${vnd(v.amountDue)};${(x.storageFee ?? 0) > 0 ? ` phí lưu giữ ${vnd(x.storageFee ?? 0)};` : ''} chi phí kiểm kê, thanh lý ${vnd(x.costs ?? 0)}; tiền giữ chân dùng bù ${vnd(x.depositApplied ?? 0)}; tiền thu từ thanh lý ${vnd(x.proceeds ?? 0)}.`,
          (x.refund ?? 0) > 0 ? `KhoAn sẽ chuyển khoản trả lại bạn ${vnd(x.refund ?? 0)} tới tài khoản nhận tiền hoàn bạn khai trong hồ sơ (web: mục Dữ liệu cá nhân; ứng dụng: tab Tài khoản → Sửa thông tin). Chưa khai thì vui lòng khai ngay hoặc liên hệ chi nhánh.` : null,
          (x.shortfall ?? 0) > 0 ? `Bạn còn nợ ${vnd(x.shortfall ?? 0)} — cần thanh toán trước khi thuê kho mới.` : null,
          'Biên bản kiểm kê được lưu trong hệ thống; bạn có thể yêu cầu xem tại chi nhánh.', contact].filter(Boolean) as string[],
      };
    }
    case 'EXPIRY_30':
    case 'EXPIRY_7':
    case 'EXPIRY_2': {
      // endDate là ngày ĐẦU TIÊN ngoài thời hạn → ngày cuối được dùng kho là hôm trước.
      const last = v.endDate ? fmtDate(iso(new Date(v.endDate.getTime() - 86_400_000))) : '—';
      return {
        subject: `KhoAn — Hợp đồng ${v.contractNumber} sắp hết hạn (${last})`,
        lines: [head, ref, `Thời hạn thuê kho của bạn kết thúc hết ngày ${last}.`,
          v.contractStatus && v.contractStatus !== 'ACTIVE'
            ? 'Muốn tiếp tục thuê: thanh toán dư nợ để có thể gia hạn (trên trang web KhoAn — mục Kho đang thuê, ứng dụng KhoAn — tab Kho của tôi, hoặc tại quầy), sau đó chọn Gia hạn và xác nhận phụ lục gia hạn. Không thuê tiếp: đăng ký trả kho và hẹn ngày bàn giao (trong vòng 30 ngày).'
            : 'Muốn tiếp tục thuê: vào trang web KhoAn (mục Kho đang thuê) hoặc ứng dụng KhoAn (tab Kho của tôi) chọn Gia hạn và xác nhận phụ lục gia hạn. Không thuê tiếp: đăng ký trả kho và hẹn ngày bàn giao (trong vòng 30 ngày).',
          x
            // Điều khoản 1.24 — hợp đồng theo quy tắc hết hạn mới.
            ? `Hết hạn mà chưa gia hạn: KHÔNG tính thêm tiền thuê; bạn có ${x.graceDays} ngày ân hạn (đến hết ngày ${prev(x.lockFrom)}) để gia hạn hoặc bàn giao kho. Nếu không gia hạn, phí lưu giữ ${vnd(x.dailyFee)}/ngày tính từ ngày ${day(v.endDate)} tới ngày bàn giao, trừ vào tiền giữ chân. Hết ân hạn: khoá quyền ra vào, giữ đồ ${x.holdDays} ngày, chỉ lấy đồ tại quầy.`
            : 'Hết hạn mà chưa gia hạn và chưa bàn giao kho thì tiền thuê vẫn tiếp tục được tính theo từng kỳ, theo giá niêm yết CHƯA ưu đãi thuê dài hạn (đúng Điều khoản thuê kho).',
          ...(v.amountDue > 0 ? [`Dư nợ hiện tại: ${vnd(v.amountDue)}.`, pay] : []), contact],
      };
    }
  }
}

/**
 * Gửi email thông báo SAU commit nhưng chỉ chờ tối đa `ms` (mặc định 8 giây): đa số trường hợp kết quả gửi (SENT / SKIPPED / FAILED) đã
 * ghi vào thông báo khi phản hồi trả về — màn hình quản lý biết ngay có phải báo khách bằng kênh khác không; kênh gửi thư chậm thì phản hồi
 * không bị treo, việc gửi chạy tiếp ở nền và vẫn ghi kết quả.
 */
export async function deliverNoticesSoon(list: PendingNotice[], ms = 8_000) {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([deliverNotices(list), new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
  clearTimeout(timer);
}

/** Gửi email cho các thông báo vừa ghi (gọi SAU khi transaction commit). Không bao giờ ném lỗi — chỉ ghi kết quả gửi. */
export async function deliverNotices(list: PendingNotice[]) {
  for (const p of list) {
    try {
      const c = await RentalContractModel.findById(p.contractId, { contractNumber: 1, customerId: 1, facilityId: 1, unitId: 1, notices: 1, terms: 1, status: 1, endDate: 1, expiry: 1 }).lean();
      const n = c?.notices?.find((x) => String(x._id) === p.noticeId);
      if (!c || !n) continue;
      const [customer, facility, unit] = await Promise.all([
        UserModel.findById(c.customerId, { fullName: 1, email: 1, firebaseUid: 1, emailVerifiedAt: 1 }).lean(),
        FacilityModel.findById(c.facilityId, { name: 1, contact: 1 }).lean(),
        StorageUnitModel.findById(c.unitId, { unitNumber: 1 }).lean(),
      ]);
      let status: NoticeEmailStatus;
      let to: string | null = null;
      if (!customer?.email) status = 'NO_EMAIL';
      // Chỉ gửi cho khách có tài khoản đăng nhập HOẶC email đã xác minh (canEmailCustomer). Hồ sơ nhập tay chưa xác minh hoặc dữ liệu
      // seed chưa từng đăng nhập có thể mang địa chỉ của người lạ → không gửi, thông báo vẫn lưu trong hệ thống.
      else if (!canEmailCustomer(customer)) status = 'SKIPPED';
      else {
        const policy = await signedPolicy(c.terms.policyId, c.facilityId);
        const m = composeNotice(n.kind, {
          name: customer.fullName, contractNumber: c.contractNumber, facility: facility?.name ?? 'KhoAn', phone: facility?.contact?.phone ?? '1900 0000',
          unit: unit?.unitNumber ?? '—', amountDue: n.amountDue, deadline: n.deadline ?? null, lockAfterDays: c.terms.lockoutAfterDays,
          waitDays: abandonDaysOf(policy), note: n.note ?? null, extra: p.extra ?? {}, endDate: n.endDate ?? null, contractStatus: c.status,
          // Điều khoản 1.24: quy tắc hết hạn của hợp đồng (ngày khoá / ngày xử lý đồ theo đúng lần hết hạn được báo).
          expiry: c.expiry && usesGraceHold(c) ? {
            graceDays: c.expiry.graceDays, holdDays: c.expiry.holdDays, dailyFee: c.expiry.dailyFee,
            lockFrom: new Date(expiryLockFrom({ endDate: n.endDate ?? c.endDate, expiry: c.expiry })),
            holdUntil: new Date(expiryHoldUntil({ endDate: n.endDate ?? c.endDate, expiry: c.expiry })),
            feeSoFar: storageFeeOf(c, new Date()).amount,
          } : null,
        });
        const text = [...m.lines, '', 'KhoAn'].join('\n\n');
        const html = m.lines.map((l) => `<p>${l.replace(/[<>&]/g, '')}</p>`).join('') + '<p>KhoAn</p>';
        const r = await sendMail({ to: customer.email, subject: m.subject, text, html });
        status = r.sent ? 'SENT' : r.reason === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : r.reason === 'BLOCKED' ? 'SKIPPED' : 'FAILED';
        to = maskEmail(customer.email);
      }
      await RentalContractModel.updateOne({ _id: c._id, 'notices._id': n._id }, { $set: { 'notices.$.email': { status, to, at: new Date() } } });
    } catch (e) {
      console.error('[notice]', p, e instanceof Error ? e.message : e);
    }
  }
}
