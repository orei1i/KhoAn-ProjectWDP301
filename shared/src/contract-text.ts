import type { AccessMethod, RentalPeriod } from './enums';
import type { BusinessPolicy, PriceQuote } from './entities';
import { lastDayOf } from './duration';
import { fmtDate, vnd } from './format';
import { ACCESS_METHOD, PERIOD_UNIT, periodLabel } from './labels';
import { LESSOR, TERMS_VERSION } from './legal';
import { abandonDaysOf, earlyTerminationOf } from './policy-defaults';
import { hasTermCommitment } from './duration';
import { pickDiscount, type DiscountTier } from './duration';
import { surchargeLines } from './surcharge';
import { DEFAULT_CONTRACT_CLAUSES, PAPER_SIGNING_CLAUSE, renderContractTemplate, type ContractTemplateClause, type ContractVariableValues, type RenderedClause } from './contract-template';

/**
 * Nội dung hợp đồng thuê kho — MỘT nguồn duy nhất cho bản xem trên web, trên mobile và file PDF gửi email.
 * Lời văn nằm ở MẪU HỢP ĐỒNG (contract-template.ts — Quản lý vận hành soạn được); file này tính GIÁ TRỊ các biến
 * từ đặt chỗ + chính sách rồi ghép vào mẫu. Chỉ nhận dữ liệu thuần (không đọc DB).
 */
export interface ContractTextInput {
  code: string;                              // mã đặt chỗ
  contractNumber?: string | null;            // chỉ có sau khi nhận kho
  facilityName: string;
  facilityAddress?: string | null;
  customerName: string;
  /** Thông tin nhận diện Bên B in trên hợp đồng (đều tuỳ chọn — thiếu thì bỏ qua dòng đó). */
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerIdLast4?: string | null;
  /** Người đại diện Bên A trên hợp đồng này: quản lý chi nhánh (theo uỷ quyền). Thiếu thì ghi người đại diện theo pháp luật. */
  lessorRepresentative?: string | null;
  /** Căn cứ uỷ quyền của người đại diện (authorizationText) — thiếu thì ghi "số giấy uỷ quyền: đang cập nhật". */
  lessorAuthorization?: string | null;
  unitTypeName: string;
  unitNumber?: string | null;
  floor?: number | null;
  zone?: string | null;
  areaM2?: number | null;
  accessMethod?: AccessMethod | null;
  useAirConditioning: boolean;
  rentalPeriod: RentalPeriod;
  periods: number;
  startDate: string;
  endDate: string;
  quote: Pick<PriceQuote, 'rate' | 'surchargeAmount' | 'discountAmount' | 'firstPeriodRent' | 'depositAmount' | 'policyVersion'>
    & Partial<Pick<PriceQuote, 'appliedRuleCodes' | 'depositPeriods' | 'firstPeriodAtBooking' | 'prepaidPeriods'>>;
  depositPaid: boolean;
  /** Phiên bản Điều khoản khách đã ký (signature.termsVersion). Bỏ trống = phiên bản hiện hành (hợp đồng chưa ký). */
  termsVersion?: string | null;
  /** PAPER: hợp đồng in ra để ký giấy tại quầy — điều "Giao kết" dùng bản ký giấy (PAPER_SIGNING_CLAUSE). Mặc định ký trực tuyến. */
  signing?: 'ONLINE' | 'PAPER';
  policy: Pick<BusinessPolicy, 'gracePeriodDays' | 'lockoutAfterDays' | 'cancellation'>
    & Partial<Pick<BusinessPolicy, 'earlyTermination' | 'abandonAfterLockedOutDays' | 'surcharges' | 'noShowAfterHours'>>
    // Bậc ưu đãi của chính sách lúc đặt — để ghi rõ mức thu hồi khi trả kho sớm (ngày ở dạng chuỗi hoặc Date đều được).
    & { discounts?: readonly DiscountTier[] };
}

export type ContractClause = RenderedClause;

const orPending = (v: string | null | undefined) => (v && v.trim() ? v.trim() : '(đang cập nhật)');

/** Người đại diện Bên A trên một hợp đồng: quản lý chi nhánh theo uỷ quyền; không có thì người đại diện theo pháp luật. */
/** Căn cứ uỷ quyền in sau tên Quản lý chi nhánh, VD "Giấy uỷ quyền số 01/2026/UQ-KHOAN ngày 01/09/2026 của Giám đốc Nguyễn Văn A". */
export function authorizationText(a?: { number: string; issuedOn: string | Date } | null): string | null {
  if (!a?.number) return null;
  const by = LESSOR.legalRepresentative ? ` của ${LESSOR.legalRepresentativeTitle} ${LESSOR.legalRepresentative}` : '';
  return `Giấy uỷ quyền số ${a.number} ngày ${fmtDate(new Date(a.issuedOn).toISOString())}${by}`;
}

export function lessorRepresentativeLine(branchManager?: string | null, authorization?: string | null): string {
  if (branchManager && branchManager.trim()) {
    return authorization
      ? `${branchManager.trim()} — Quản lý chi nhánh, đại diện theo ${authorization}`
      : `${branchManager.trim()} — Quản lý chi nhánh (theo uỷ quyền của người đại diện theo pháp luật; số giấy uỷ quyền: đang cập nhật)`;
  }
  return `${orPending(LESSOR.legalRepresentative)} — ${LESSOR.legalRepresentativeTitle} (người đại diện theo pháp luật)`;
}

/** Dòng mô tả đầy đủ BÊN A: pháp nhân, mã số doanh nghiệp, trụ sở, chi nhánh thực hiện hợp đồng, người đại diện. */
export function partyALine(i: { facilityName: string; facilityAddress?: string | null; lessorRepresentative?: string | null; lessorAuthorization?: string | null }): string {
  return [
    `${LESSOR.legalName} (thương hiệu ${LESSOR.brand})`,
    `mã số doanh nghiệp: ${orPending(LESSOR.taxCode)}`,
    `trụ sở chính: ${orPending(LESSOR.headOffice)}`,
    `chi nhánh thực hiện hợp đồng: ${i.facilityName}${i.facilityAddress ? `, ${i.facilityAddress}` : ''}`,
    ...(LESSOR.phone ? [`điện thoại: ${LESSOR.phone}`] : []),
    `người đại diện: ${lessorRepresentativeLine(i.lessorRepresentative, i.lessorAuthorization)}`,
  ].join('; ');
}

/** Dòng mô tả BÊN B: họ tên và các thông tin nhận diện khách đã khai trong tài khoản. */
export function partyBLine(i: { customerName: string; customerIdLast4?: string | null; customerPhone?: string | null; customerEmail?: string | null }): string {
  return [
    i.customerName,
    ...(i.customerIdLast4 ? [`giấy tờ tùy thân có 4 số cuối ${i.customerIdLast4}`] : []),
    ...(i.customerPhone ? [`điện thoại: ${i.customerPhone}`] : []),
    ...(i.customerEmail ? [`email (cũng là tài khoản dùng để ký): ${i.customerEmail}`] : []),
  ].join('; ');
}

/**
 * Che 4 số / ký tự cuối giấy tờ tùy thân trong lời văn hợp đồng, phụ lục, ghi chú đối chiếu ("4 số cuối 4821", "4 ký tự cuối B7K2")
 * thành `****` — dùng cho NHÂN VIÊN QUẦY (STAFF): họ phải nhập số từ giấy tờ bản gốc khách xuất trình để hệ thống so khớp, đọc được
 * số trong hợp đồng thì việc đối chiếu chỉ còn hình thức. So theo CỤM TỪ đứng trước số (lời văn do partyBLine / ghi chú đối chiếu sinh ra)
 * nên không che nhầm số tiền, ngày, mã hợp đồng; che cả số đã cũ (khách đổi giấy tờ sau khi ký). Quản lý chi nhánh / vận hành / khách
 * xem bản đầy đủ.
 */
const LAST4_PHRASE = /(4\s+(?:số|ký\s+tự|chữ\s+số)\s+cuối(?:\s+là)?\s*:?\s*)([A-Za-z0-9]{4})(?![A-Za-z0-9])/giu;
export function maskIdLast4Text(text: string): string {
  return text.replace(LAST4_PHRASE, (_m, head: string) => `${head}****`);
}
/** Che 4 số cuối trong mọi đoạn / gạch đầu dòng / tiêu đề của các điều khoản (trả bản sao, không sửa bản gốc). */
export function maskIdLast4Clauses<C extends { title: string; paragraphs: readonly string[]; bullets: readonly string[] }>(clauses: readonly C[]): C[] {
  const mask = (xs: readonly string[] | undefined) => (Array.isArray(xs) ? xs.map((x) => (typeof x === 'string' ? maskIdLast4Text(x) : x)) : xs);
  return clauses.map((c) => (c && typeof c === 'object'
    ? { ...c, title: typeof c.title === 'string' ? maskIdLast4Text(c.title) : c.title, paragraphs: mask(c.paragraphs), bullets: mask(c.bullets) }
    : c)) as C[];
}

/** Các điều có từ Điều khoản v1.2 — hợp đồng đã ký bản cũ (và không có bản lưu nguyên văn) không hiện điều khoản khách chưa từng thấy. */
const ACK_CLAUSE_SINCE = '1.2';
const CLAUSES_SINCE_1_2 = ['can-cu', 'dien-tu', 'xac-nhan'];
const versionGte = (a: string, b: string) => {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
};

const hoursText = (h: number) => (h >= 24 && h % 24 === 0 ? `${h} giờ (${h / 24} ngày)` : `${h} giờ`);

/** Các bậc hoàn tiền khi HỦY ĐẶT CHỖ (trước ngày nhận kho), viết thành khoảng thời gian rõ ràng. */
function cancellationLines(policy: ContractTextInput['policy'], base: string) {
  const tiers = [...policy.cancellation].sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart);
  const lines = tiers.map((t, i) => {
    const upper = tiers[i - 1]?.minHoursBeforeStart;
    const when = t.minHoursBeforeStart > 0
      ? upper === undefined
        ? `Hủy trước ngày nhận kho từ ${hoursText(t.minHoursBeforeStart)} trở lên`
        : `Hủy trước ngày nhận kho từ ${hoursText(t.minHoursBeforeStart)} đến dưới ${hoursText(upper)}`
      : upper === undefined ? 'Hủy bất kỳ lúc nào trước ngày nhận kho' : `Hủy trước ngày nhận kho dưới ${hoursText(upper)}`;
    return `${when}: ${t.depositRefundPct > 0 ? `hoàn ${t.depositRefundPct}%` : 'KHÔNG hoàn'} ${base}.`;
  });
  // Hệ thống tự hủy đặt chỗ khi khách không đến: quá `noShowAfterHours` giờ sau khi hết ngày nhận kho.
  const noShow = policy.noShowAfterHours;
  lines.push(`Không đến nhận kho${noShow ? ` trong vòng ${hoursText(noShow)} sau ngày nhận kho đã đặt` : ' theo lịch đã đặt'} và không hủy trước: đặt chỗ bị hủy, ô kho được giải phóng và KHÔNG hoàn ${base}.`);
  return lines;
}

/** Khoảng % kỳ hạn đã dùng của từng bậc hoàn tiền giữ chân khi trả kho sớm, theo thứ tự tăng dần. */
function earlyTerminationLines(policy: ContractTextInput['policy'], committed: boolean) {
  // Hợp đồng không có cam kết thời hạn (không được ưu đãi thuê dài hạn): trả sớm không bị giới hạn mức hoàn.
  if (!committed) {
    return [
      'Hợp đồng này không hưởng ưu đãi thuê dài hạn nên Bên thuê trả kho trước hạn KHÔNG bị giới hạn mức hoàn: tiền giữ chân được hoàn đủ sau khi trừ chi phí hư hại và công nợ (nếu có).',
      'Tiền thuê tiếp tục được tính cho đến ngày Bên thuê THỰC TẾ bàn giao lại ô kho cho nhân viên; tiền thuê của kỳ đang sử dụng không được hoàn.',
    ];
  }
  const tiers = [...earlyTerminationOf(policy)].sort((a, b) => a.maxElapsedPct - b.maxElapsedPct);
  return tiers.map((t, i) => {
    const prev = tiers[i - 1]?.maxElapsedPct;
    const range = prev === undefined ? `đã dùng đến ${t.maxElapsedPct}% kỳ hạn` : i === tiers.length - 1 ? `đã dùng trên ${prev}% kỳ hạn` : `đã dùng trên ${prev}% đến ${t.maxElapsedPct}% kỳ hạn`;
    return `Trả kho sớm khi ${range}: hoàn ${t.depositRefundPct}% tiền giữ chân.`;
  }).concat([
    'Thời gian đã dùng tính đến ngày Bên thuê THỰC TẾ bàn giao lại ô kho cho nhân viên, không tính theo ngày hẹn trả. Tiền thuê tiếp tục được tính cho đến ngày bàn giao.',
  ]);
}

/** Điều khoản thu hồi ưu đãi thuê dài hạn khi trả kho sớm — chỉ có khi hợp đồng này thật sự được giảm giá. */
function clawbackLines(i: ContractTextInput) {
  const q = i.quote;
  if (i.rentalPeriod !== 'MONTH' || !(q.discountAmount > 0)) return [];
  const gross = q.rate + q.surchargeAmount;
  const tiers = (i.policy.discounts ?? []).filter((d) => !d.requiresApprovalRole && d.minPeriods <= i.periods).map((d) => d.minPeriods).sort((a, b) => a - b);
  const steps = [...new Set(tiers)].map((m) => `dùng từ ${m} tháng: giảm ${vnd(Math.min(q.discountAmount, pickDiscount(i.policy.discounts ?? [], 'MONTH', m, gross, new Date(i.startDate))?.amount ?? 0))}/tháng`);
  return [
    `Ưu đãi thuê dài hạn ${vnd(q.discountAmount)}/tháng được áp dụng vì Bên thuê cam kết thuê ${periodLabel(i.rentalPeriod, i.periods)}. Nếu trả kho trước khi dùng đủ thời hạn đó, Bên thuê chỉ được hưởng mức ưu đãi của số tháng thực dùng${steps.length ? ` (${steps.join('; ')}; ít hơn thì không giảm)` : ''}; phần ưu đãi đã hưởng vượt mức bị thu hồi và trừ vào tiền giữ chân khi quyết toán.`,
  ];
}

/**
 * Giá trị mọi biến của mẫu hợp đồng cho một đặt chỗ. Các biến KHỐI (khoản thanh toán, mức hoàn…) là câu do hệ thống
 * soạn vì chứa con số ràng buộc — người soạn mẫu chỉ đặt vị trí, không sửa nội dung.
 */
export function contractVariables(i: ContractTextInput): ContractVariableValues {
  const unit = PERIOD_UNIT[i.rentalPeriod];
  const q = i.quote;
  const prepaid = !!q.firstPeriodAtBooking;
  const holdPeriods = q.depositPeriods ?? 1;
  // Thuê theo ngày / tuần: tiền thuê của CẢ thời hạn trả trọn trước khi dùng kho (báo giá cũ chưa có prepaidPeriods = 1 kỳ).
  const wholeTerm = i.rentalPeriod !== 'MONTH' && q.prepaidPeriods != null;
  const rentUpfront = q.firstPeriodRent * Math.max(1, q.prepaidPeriods ?? 1);
  const total = q.depositAmount + rentUpfront;
  // Khoản hoàn khi hủy đặt chỗ tính trên TẤT CẢ số tiền đã thanh toán lúc đặt chỗ.
  const refundBase = prepaid ? 'số tiền đã thanh toán khi đặt chỗ (tiền giữ chân và tiền thuê kỳ đầu)' : 'tiền giữ chân';

  const unitBits = [
    i.unitTypeName,
    i.unitNumber ? `ô ${i.unitNumber}${i.floor != null ? ` (tầng ${i.floor}${i.zone ? `, ${i.zone}` : ''})` : ''}` : null,
    i.areaM2 ? `diện tích ${i.areaM2} m²` : null,
    i.accessMethod ? `hình thức khoá: ${ACCESS_METHOD[i.accessMethod]}` : null,
  ].filter(Boolean).join(', ');

  // Phụ phí luôn kèm tên gọi, cách tính và lý do — không ghi trơ trọi "phụ phí".
  const surcharges = surchargeLines({ rate: q.rate, surchargeAmount: q.surchargeAmount, appliedRuleCodes: q.appliedRuleCodes ?? ['CLIMATE'] }, i.policy.surcharges)
    .map((s) => `${s.label}: +${vnd(s.amount)} mỗi ${unit}${s.basis ? ` (${s.basis})` : ''}. ${s.reason}`);

  return {
    values: {
      ben_cho_thue: partyALine(i),
      ben_thue: partyBLine(i),
      dai_dien_ben_a: lessorRepresentativeLine(i.lessorRepresentative, i.lessorAuthorization),
      doi_tuong: unitBits,
      dieu_hoa: i.useAirConditioning ? 'có sử dụng (tính phụ phí điều hòa nhiệt độ nêu tại Điều 4)' : 'không sử dụng (không tính phụ phí)',
      ngay_bat_dau: fmtDate(i.startDate),
      thoi_han: periodLabel(i.rentalPeriod, i.periods),
      ngay_ket_thuc: fmtDate(lastDayOf(i.endDate)), // ngày cuối được dùng kho — endDate là 00:00 kỳ kế tiếp
      don_vi: unit,
      gia_thue: vnd(q.rate),
      tien_thue_moi_ky: vnd(q.firstPeriodRent),
      tien_giu_chan: vnd(q.depositAmount),
      tien_thue_ky_dau: vnd(rentUpfront),
      tong_truoc_khi_dung: vnd(total),
      an_han_ngay: String(i.policy.gracePeriodDays),
      khoa_sau_ngay: String(i.policy.lockoutAfterDays),
      bo_lai_sau_ngay: String(abandonDaysOf(i.policy)),
      phien_ban_dieu_khoan: i.termsVersion ?? TERMS_VERSION,
      phien_ban_chinh_sach: String(q.policyVersion),
    },
    blocks: {
      dong_phu_phi: surcharges,
      dong_uu_dai: [
        ...(q.discountAmount > 0 ? [`Ưu đãi thuê dài hạn: −${vnd(q.discountAmount)} mỗi ${unit}.`] : []),
        ...(q.surchargeAmount > 0 || q.discountAmount > 0 ? [`Tiền thuê Bên thuê phải trả mỗi ${unit} (sau phụ phí và ưu đãi): ${vnd(q.firstPeriodRent)}.`] : []),
      ],
      khoan_giu_chan: [
        `Khoản 1 — Tiền giữ chân (còn gọi là tiền cọc): ${vnd(q.depositAmount)}${i.depositPaid ? ' (đã thanh toán)' : ''}, trả khi đặt chỗ${holdPeriods > 1 ? `, bằng ${holdPeriods} ${unit} tiền thuê (kho cỡ lớn)` : ''}. Khoản này giữ ô kho đã chọn cho Bên thuê và bảo đảm việc thực hiện hợp đồng; được giữ đến khi trả kho — không trừ vào tiền thuê — và hoàn lại sau khi trừ chi phí hư hại, công nợ (nếu có), theo mức hoàn nêu tại Điều 5.`,
      ],
      khoan_tien_thue_ky_dau: wholeTerm ? [
        `Khoản 2 — Tiền thuê cả thời hạn (${periodLabel(i.rentalPeriod, i.periods)} × ${vnd(q.firstPeriodRent)}): ${vnd(rentUpfront)}, thanh toán TRỌN MỘT LẦN${prepaid ? `, trong đó ${vnd(q.firstPeriodRent)} trả cùng lúc đặt chỗ (kho cỡ lớn) và ${vnd(rentUpfront - q.firstPeriodRent)} trả` : ''} tại quầy khi nhân viên bàn giao kho, ngoài tiền giữ chân. Thuê theo ${unit} không trả theo từng kỳ.`,
      ] : [
        prepaid
          ? `Khoản 2 — Tiền thuê ${unit} đầu: ${vnd(q.firstPeriodRent)}, thanh toán CÙNG LÚC đặt chỗ (kho cỡ lớn), nên tổng trả khi đặt chỗ là ${vnd(total)}. Bên thuê không phải trả thêm tiền thuê kỳ đầu khi nhận kho.`
          : `Khoản 2 — Tiền thuê ${unit} đầu: ${vnd(q.firstPeriodRent)}, thanh toán THÊM ngoài tiền giữ chân, tại quầy khi nhân viên bàn giao kho.`,
      ],
      khoan_cac_ky_sau: wholeTerm ? [
        `Bên thuê trả kho trước khi hết thời hạn thì KHÔNG được hoàn tiền thuê của các ${unit} chưa dùng.`,
        `Hết thời hạn đã đặt mà chưa trả kho: tiền thuê tiếp tục được tính theo từng ${unit} với giá cũ, hoá đơn xuất vào đầu mỗi kỳ.`,
      ] : [
        `Các kỳ sau thanh toán theo từng ${unit} vào đầu mỗi kỳ — không phải trả trước toàn bộ thời hạn.`,
        ...(i.rentalPeriod === 'MONTH' ? ['Gia hạn là một cam kết thời hạn mới: giá thuê là giá niêm yết tại thời điểm gia hạn, ưu đãi thuê dài hạn tính theo số tháng GIA HẠN (không cộng dồn thời gian đã thuê); tiền thuê vẫn trả theo từng tháng, không phải trả trước. Mức hoàn tiền giữ chân và việc thu hồi ưu đãi khi trả kho sớm được tính trên kỳ cam kết đang dở. Hết hạn mà không gia hạn thì không còn ưu đãi.'] : []),
        ...(i.rentalPeriod === 'MONTH' ? ['Tiền thuê Bên thuê đã trả trước khi gia hạn cho các tháng CHƯA bắt đầu tại ngày bàn giao kho được hoàn lại khi trả kho, sau khi cấn trừ chi phí hư hại và công nợ (nếu có). Tiền thuê của tháng đang sử dụng không được hoàn.'] : []),
      ],
      muc_hoan_khi_huy: cancellationLines(i.policy, refundBase),
      muc_hoan_tra_som: [...earlyTerminationLines(i.policy, hasTermCommitment({ rentalPeriod: i.rentalPeriod, discountAmount: i.quote.discountAmount })), ...clawbackLines(i)],
    },
  };
}

/** Dựng các điều khoản của một hợp đồng từ mẫu (`clauses`, mặc định = mẫu chuẩn của hệ thống). */
export function buildContractClauses(i: ContractTextInput, clauses: readonly ContractTemplateClause[] = DEFAULT_CONTRACT_CLAUSES): ContractClause[] {
  const legacy = !!i.termsVersion && !versionGte(i.termsVersion, ACK_CLAUSE_SINCE);
  const used = i.signing === 'PAPER' ? clauses.map((c) => (c.key === PAPER_SIGNING_CLAUSE.key ? PAPER_SIGNING_CLAUSE : c)) : clauses;
  return renderContractTemplate(used, contractVariables(i), legacy ? CLAUSES_SINCE_1_2 : []);
}

const SAMPLE_POLICY: ContractTextInput['policy'] = {
  gracePeriodDays: 5, lockoutAfterDays: 15, abandonAfterLockedOutDays: 30,
  cancellation: [{ minHoursBeforeStart: 72, depositRefundPct: 100 }, { minHoursBeforeStart: 24, depositRefundPct: 50 }, { minHoursBeforeStart: 0, depositRefundPct: 0 }],
  surcharges: [{ code: 'CLIMATE', label: 'Kho điều hòa nhiệt độ', kind: 'PERCENT', value: 10, categories: ['SMALL', 'MEDIUM', 'LARGE', 'XL'] }],
};

/** Hai hợp đồng mẫu để XEM TRƯỚC khi soạn mẫu: kho thường (có điều hòa + ưu đãi) và kho cỡ lớn (trả tiền thuê kỳ đầu lúc đặt). */
export const SAMPLE_CONTRACT_INPUTS: Record<'STANDARD' | 'LARGE', ContractTextInput> = {
  STANDARD: {
    code: 'RSV-MẪU', facilityName: 'KhoAn Quận 7', facilityAddress: '88 Nguyễn Thị Thập, Quận 7', customerName: 'Nguyễn Văn A', customerPhone: '0901 234 567', customerEmail: 'khach@example.com', customerIdLast4: '4821', lessorRepresentative: 'Bùi Thanh Tùng', lessorAuthorization: 'Giấy uỷ quyền số 01/2026/UQ-KHOAN ngày 01/09/2026 của Giám đốc Nguyễn Văn A',
    unitTypeName: 'Phòng S', unitNumber: 'S1-08', floor: 1, zone: 'Khu Thẻ khoá', areaM2: 3, accessMethod: 'RFID_CARD', useAirConditioning: true,
    rentalPeriod: 'MONTH', periods: 3, startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-02-01T00:00:00.000Z',
    quote: { rate: 990_000, surchargeAmount: 99_000, discountAmount: 108_900, firstPeriodRent: 980_100, depositAmount: 1_089_000, policyVersion: 3, appliedRuleCodes: ['CLIMATE', 'DAI_HAN_3'], depositPeriods: 1, firstPeriodAtBooking: false },
    depositPaid: false, policy: SAMPLE_POLICY,
  },
  LARGE: {
    code: 'RSV-MẪU', facilityName: 'KhoAn Quận 7', facilityAddress: '88 Nguyễn Thị Thập, Quận 7', customerName: 'Nguyễn Văn A', customerPhone: '0901 234 567', customerEmail: 'khach@example.com', customerIdLast4: '4821', lessorRepresentative: 'Bùi Thanh Tùng', lessorAuthorization: 'Giấy uỷ quyền số 01/2026/UQ-KHOAN ngày 01/09/2026 của Giám đốc Nguyễn Văn A',
    unitTypeName: 'Phòng L', unitNumber: 'L2-13', floor: 2, zone: 'Khu Mật khẩu', areaM2: 12, accessMethod: 'PIN', useAirConditioning: false,
    rentalPeriod: 'MONTH', periods: 1, startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-12-01T00:00:00.000Z',
    quote: { rate: 3_200_000, surchargeAmount: 0, discountAmount: 0, firstPeriodRent: 3_200_000, depositAmount: 6_400_000, policyVersion: 3, appliedRuleCodes: [], depositPeriods: 2, firstPeriodAtBooking: true },
    depositPaid: false, policy: SAMPLE_POLICY,
  },
};
