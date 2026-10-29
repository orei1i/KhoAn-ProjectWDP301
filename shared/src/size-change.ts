import type { RentalPeriod } from './enums';
import type { DiscountTier } from './duration';
import { lastDayOf, pickDiscount } from './duration';
import { coveredByPaidRenewal } from './billing';
import { addPeriods, daysBetween, fmtDate, vnd } from './format';
import { PERIOD_UNIT } from './labels';
import { partyALine, partyBLine, type ContractClause } from './contract-text';

/**
 * ĐỔI CỠ KHO (đợt 15, C3) — đổi sang LOẠI kho khác cùng chi nhánh qua yêu cầu đổi ô. Là SỬA ĐỔI hợp đồng, không chấm dứt: thời hạn, kỳ
 * cam kết, bậc ưu đãi, đồ đang gửi, hồ sơ giữ nguyên; từ ngày đổi áp giá loại mới (cùng chu kỳ, cùng bậc ưu đãi của từng kỳ cam kết);
 * phần chênh của các kỳ đã trả tính theo ngày (thu thêm / hoàn); tiền giữ chân tính lại theo cách tính của loại mới (nộp thêm / hoàn).
 * Không áp trần hoàn / thu hồi ưu đãi vì việc đổi cỡ. Quy tắc thuần — BE (báo giá, hoàn tất) và web / app (xem trước) dùng chung.
 */
type Iso = string | Date;
const ms = (d: Iso) => new Date(d).getTime();
const isoOf = (d: Iso) => (typeof d === 'string' ? d : d.toISOString());

/**
 * Ưu đãi của một kỳ cam kết khi giá gốc đổi thành `newGross` — CÙNG BẬC ưu đãi đã áp cho kỳ đó: tìm bậc (trong bảng ưu đãi của chính
 * sách lúc cam kết) cho ra đúng mức giảm hiện tại rồi áp lại trên giá mới (bậc % → % của giá mới; bậc số tiền → số tiền đó, không quá
 * giá mới). Không xác định được bậc (chính sách thiếu / đã đổi) → giữ đúng TỈ LỆ giảm hiện tại. Thuê ngày / tuần không có ưu đãi.
 */
export function sameTierDiscount(i: {
  discounts?: readonly DiscountTier[] | null; period: RentalPeriod; periods: number; oldGross: number; oldDiscount: number; newGross: number; at: Iso;
}): number {
  if (i.period !== 'MONTH' || !(i.oldDiscount > 0) || !(i.newGross > 0)) return 0;
  const amountOf = (d: DiscountTier, gross: number) => Math.min(gross, d.kind === 'PERCENT' ? Math.round((gross * d.value) / 100) : d.value);
  const list = i.discounts ?? [];
  const picked = pickDiscount(list, 'MONTH', i.periods, i.oldGross, new Date(i.at));
  const tier = picked && picked.amount === i.oldDiscount ? picked.tier
    : list.find((d) => !d.requiresApprovalRole && i.periods >= d.minPeriods && amountOf(d, i.oldGross) === i.oldDiscount);
  if (tier) return amountOf(tier, i.newGross);
  return i.oldGross > 0 ? Math.min(i.newGross, Math.round((i.oldDiscount * i.newGross) / i.oldGross)) : 0;
}

/** Một kỳ đã trả (hoặc đã xuất hoá đơn) tính từ mốc ngày nhận kho: [start, end). */
export interface BilledPeriod { start: string; end: string }

/**
 * Các kỳ ĐÃ TRẢ còn ngày chưa dùng tính từ ngày `from`: mọi kỳ đã xuất hoá đơn (bắt đầu trước `billing.nextBillingDate`, cùng mốc với job
 * billing — tính từ ngày nhận kho, không cộng nối) và các kỳ đã trả trước khi gia hạn (coveredByPaidRenewal) — kết thúc sau `from`.
 */
export function billedPeriodsFrom(
  c: { startDate: Iso; billing: { rentalPeriod: RentalPeriod; nextBillingDate: Iso }; renewals?: readonly { previousEndDate: Iso; newEndDate: Iso; paymentId?: unknown; prepaidUntil?: Iso | null }[] | null },
  from: Iso,
): BilledPeriod[] {
  const period = c.billing.rentalPeriod;
  const start = isoOf(c.startDate);
  const next = ms(c.billing.nextBillingDate);
  const renewals = c.renewals ?? [];
  const lastPrepaid = Math.max(0, ...renewals.filter((r) => !!r.paymentId).map((r) => ms(r.prepaidUntil ?? r.newEndDate)));
  const stop = Math.max(next, lastPrepaid);
  const out: BilledPeriod[] = [];
  for (let k = 0; k < 5000; k++) {
    const s = addPeriods(start, period, k);
    if (ms(s) >= stop) break;
    const e = addPeriods(start, period, k + 1);
    if (ms(s) >= next && !coveredByPaidRenewal(renewals, s)) continue;
    if (ms(e) > ms(from)) out.push({ start: s, end: e });
  }
  return out;
}

/** Phần chênh tiền thuê của một kỳ đã trả. */
export interface ProrationItem extends BilledPeriod { oldRate: number; newRate: number; days: number; len: number; amount: number }

/**
 * Phần chênh tiền thuê khi đổi cỡ từ ngày `from`: mỗi kỳ đã trả tính theo NGÀY — (giá mới − giá cũ) × số ngày từ ngày đổi (hoặc từ đầu
 * kỳ nếu kỳ bắt đầu sau ngày đổi) đến hết kỳ / số ngày của kỳ. Dương = khách trả thêm, âm = KhoAn hoàn lại.
 */
export function resizeProration(periods: readonly (BilledPeriod & { oldRate: number; newRate: number })[], from: Iso): { total: number; items: ProrationItem[] } {
  const f = ms(from);
  const items = periods.flatMap((p) => {
    if (ms(p.end) <= f) return [];
    const len = daysBetween(p.start, p.end);
    const days = daysBetween(ms(p.start) > f ? p.start : isoOf(from), p.end);
    const amount = len > 0 ? Math.round(((p.newRate - p.oldRate) * days) / len) : 0;
    return amount ? [{ ...p, days, len, amount }] : [];
  });
  return { total: items.reduce((s, x) => s + x.amount, 0), items };
}

export const sizeChangeAppendixTitle = (n?: number | null) => (n ? `Phụ lục số ${String(n).padStart(2, '0')} — Đổi cỡ kho` : 'Phụ lục — Đổi cỡ kho');

/** Mọi phụ lục đã xác nhận của một hợp đồng (gia hạn + đổi cỡ kho), theo số thứ tự. */
export function contractAppendices<A extends { number: number }>(c: {
  commitments?: readonly { appendix?: A | null }[] | null; sizeChanges?: readonly { appendix?: A | null }[] | null;
}): A[] {
  return [...(c.commitments ?? []), ...(c.sizeChanges ?? [])].flatMap((x) => (x.appendix ? [x.appendix] : [])).sort((a, b) => a.number - b.number);
}
/** Số thứ tự phụ lục kế tiếp của hợp đồng. */
export const nextAppendixNumber = (c: Parameters<typeof contractAppendices>[0]) => contractAppendices(c).reduce((m, a) => Math.max(m, a.number), 0) + 1;

export interface SizeChangeAppendixInput {
  contractNumber: string;
  contractSignedAt?: string | null;
  requestNumber?: string | null;
  facilityName: string; facilityAddress?: string | null; lessorRepresentative?: string | null; lessorAuthorization?: string | null;
  customerName: string; customerPhone?: string | null; customerEmail?: string | null; customerIdLast4?: string | null;
  fromTypeName: string; fromUnitNumber?: string | null; toTypeName: string; toUnitNumber?: string | null;
  rentalPeriod: RentalPeriod;
  endDate: string;
  currentRate: number; gross: number; discountAmount: number; rate: number;
  /** Giá mới của các kỳ cam kết SAU kỳ đang dùng (gia hạn đã xác nhận) — nếu có. */
  laterSegments?: readonly { startDate: string; rate: number }[];
  currentDeposit: number; deposit: number;
  /** Ước tính phần chênh tiền thuê nếu đổi vào ngày `estimateFrom`. */
  estimate: { from: string; rentDiff: number };
  servicesCancelled?: boolean;
  acDropped?: boolean;
  termsVersion: string;
}

/**
 * PHỤ LỤC "ĐỔI CỠ KHO" — khách đọc và xác nhận khi gửi yêu cầu đổi sang loại kho khác; có hiệu lực khi chi nhánh xác nhận đã chuyển sang
 * ô mới (Điều 403, 421 BLDS 2015 — như phụ lục gia hạn). Không ghi số thứ tự trong nội dung: số được cấp lúc có hiệu lực (tiêu đề).
 */
export function buildSizeChangeAppendix(i: SizeChangeAppendixInput): ContractClause[] {
  const unit = PERIOD_UNIT[i.rentalPeriod];
  const depDiff = i.deposit - i.currentDeposit;
  const est = i.estimate.rentDiff;
  return [
    {
      title: 'Căn cứ',
      paragraphs: [
        `Phụ lục này là một phần của Hợp đồng thuê kho số ${i.contractNumber}${i.contractSignedAt ? `, giao kết ngày ${fmtDate(i.contractSignedAt)}` : ''} (sau đây gọi là "Hợp đồng"), được lập theo Điều 403 và Điều 421 Bộ luật Dân sự năm 2015 và Luật Giao dịch điện tử năm 2023, trên cơ sở yêu cầu đổi cỡ kho của Bên B${i.requestNumber ? ` (yêu cầu số ${i.requestNumber})` : ''}.`,
      ],
      bullets: [],
    },
    { title: 'Điều 1. Các bên', paragraphs: [`BÊN A — BÊN CHO THUÊ: ${partyALine(i)}.`, `BÊN B — BÊN THUÊ: ${partyBLine(i)}.`], bullets: [] },
    {
      title: 'Điều 2. Nội dung thay đổi',
      paragraphs: [],
      bullets: [
        `Bên B chuyển từ ${i.fromTypeName}${i.fromUnitNumber ? ` (ô ${i.fromUnitNumber})` : ''} sang ${i.toTypeName}${i.toUnitNumber ? `, ô ${i.toUnitNumber}` : ''} tại ${i.facilityName}, kể từ ngày Bên A xác nhận Bên B đã chuyển xong sang ô mới ("ngày đổi"). Thời hạn thuê (đến hết ngày ${fmtDate(lastDayOf(i.endDate))}), các kỳ cam kết, chu kỳ và ngày thanh toán giữ nguyên.`,
        `Giá thuê từ ngày đổi: giá niêm yết của loại kho mới ${vnd(i.gross)}/${unit}${i.acDropped ? '' : ' (đã gồm phụ phí điều hòa nếu Bên B đang sử dụng)'}${i.discountAmount > 0 ? `, trừ ưu đãi thuê dài hạn ${vnd(i.discountAmount)}/${unit} — cùng bậc ưu đãi của kỳ cam kết hiện tại` : ', không có ưu đãi thuê dài hạn'}; tiền thuê Bên B trả là ${vnd(i.rate)}/${unit} (trước đây ${vnd(i.currentRate)}/${unit}).`,
        ...((i.laterSegments ?? []).map((s) => `Kỳ gia hạn đã xác nhận bắt đầu ngày ${fmtDate(s.startDate)}: tiền thuê ${vnd(s.rate)}/${unit} (cùng bậc ưu đãi của kỳ đó, theo giá loại kho mới).`)),
        `Phần chênh của các kỳ Bên B đã trả: tính theo ngày, từ ngày đổi đến hết kỳ đã trả — (giá mới − giá cũ) × số ngày còn lại / số ngày của kỳ. ${est > 0 ? 'Bên B trả thêm phần chênh (cộng vào khoản phải thanh toán)' : est < 0 ? 'Bên A hoàn lại phần chênh cho Bên B' : 'Phần chênh (nếu có)'} — ước tính nếu đổi ngày ${fmtDate(i.estimate.from)}: ${vnd(Math.abs(est))}; số chính xác tính theo ngày đổi thực tế.`,
        `Tiền giữ chân điều chỉnh theo cách tính của loại kho mới (Điều 3 Điều khoản thuê kho): từ ${vnd(i.currentDeposit)} thành ${vnd(i.deposit)}${depDiff > 0 ? ` — Bên B nộp thêm ${vnd(depDiff)} (cộng vào khoản phải thanh toán)` : depDiff < 0 ? ` — Bên A hoàn lại ${vnd(-depDiff)} cho Bên B` : ' — không thay đổi'}.`,
        'Khoản hoàn (nếu có) trả theo phương thức Bên B đã thanh toán; khoản đã trả tại quầy / chuyển khoản được chuyển khoản tới tài khoản nhận tiền Bên B đã khai.',
        ...(i.servicesCancelled ? ['Dịch vụ thêm chỉ áp dụng cho kho từ cỡ Vừa (M) trở lên: các đơn dịch vụ chưa thực hiện được huỷ và hoàn đủ tiền vào ngày đổi.'] : []),
        ...(i.acDropped ? ['Loại kho mới không có tuỳ chọn điều hòa: từ ngày đổi không tính phụ phí điều hòa.'] : []),
      ],
    },
    {
      title: 'Điều 3. Đổi cỡ kho không phải chấm dứt Hợp đồng',
      paragraphs: [],
      bullets: [
        'Việc đổi cỡ kho là sửa đổi Hợp đồng, không phải chấm dứt: không áp giới hạn mức hoàn tiền giữ chân khi trả kho sớm và không thu hồi ưu đãi thuê dài hạn vì việc đổi cỡ; đồ đang gửi, hồ sơ bồi thường, người được uỷ quyền giữ nguyên.',
        'Nếu sau này Bên B trả kho trước khi hết kỳ cam kết, mức hoàn và việc thu hồi ưu đãi vẫn theo Hợp đồng, tính trên tiền thuê và ưu đãi thực tế của từng tháng (trước và sau ngày đổi).',
      ],
    },
    {
      title: 'Điều 4. Hiệu lực',
      paragraphs: [],
      bullets: [
        'Phụ lục này là bộ phận không tách rời của Hợp đồng; mọi nội dung khác của Hợp đồng giữ nguyên hiệu lực.',
        `Phụ lục có hiệu lực từ ngày đổi. Yêu cầu đổi cỡ kho bị từ chối, huỷ hoặc hết hạn thì phụ lục không phát sinh hiệu lực. Hai bên thực hiện theo Điều khoản thuê kho (v${i.termsVersion}).`,
        'Phụ lục được giao kết bằng phương thức điện tử: Bên B xác nhận trên tài khoản đã đăng nhập của chính mình; Bên A chấp nhận thông qua hệ thống KhoAn do Bên A vận hành, do người đại diện nêu tại Điều 1 chịu trách nhiệm. Hệ thống ghi nhận họ tên người xác nhận và thời điểm xác nhận làm chứng cứ giao kết.',
      ],
    },
  ];
}

const signed = (n: number, more: string, back: string) => (n > 0 ? `${more} ${vnd(n)}` : n < 0 ? `${back} ${vnd(-n)}` : 'không đổi');

/**
 * Một câu tóm tắt ĐỔI CỠ KHO của một yêu cầu đổi ô — cùng câu trên web và app (khách, nhân viên). null = đổi ô cùng loại.
 * Đang chờ: giá mới, tiền giữ chân mới, phần chênh tiền thuê ước tính; đã đổi: số thật lúc hoàn tất.
 */
export function sizeChangeNote(s: {
  status: string;
  sizeChange?: { rentalPeriod: RentalPeriod; currentRate: number; rate: number; currentDeposit: number; deposit: number; depositDiff: number; estimate: { rentDiff: number }; rentDiff?: number | null } | null;
}): string | null {
  const x = s.sizeChange;
  if (!x) return null;
  const unit = PERIOD_UNIT[x.rentalPeriod];
  const head = `Tiền thuê ${vnd(x.currentRate)} → ${vnd(x.rate)}/${unit}; tiền giữ chân ${vnd(x.currentDeposit)} → ${vnd(x.deposit)} (${signed(x.depositDiff, 'nộp thêm', 'hoàn')})`;
  if (s.status === 'DONE') return `Đã đổi cỡ kho. ${head}; phần chênh tiền thuê kỳ đã trả: ${signed(x.rentDiff ?? 0, 'thu thêm', 'hoàn')}.`;
  if (s.status === 'SUBMITTED' || s.status === 'APPROVED') return `Đổi cỡ kho. ${head}; phần chênh tiền thuê kỳ đã trả tính theo ngày khi đổi xong (ước tính ${signed(x.estimate.rentDiff, 'thu thêm', 'hoàn')}).`;
  return null;
}
