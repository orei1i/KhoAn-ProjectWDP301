import type { RentalPeriod } from './enums';
import type { DiscountTier } from './duration';
import { pickDiscount } from './duration';
import { lastDayOf } from './duration';
import { fmtDate, vnd } from './format';
import { PERIOD_UNIT, periodLabel } from './labels';
import { earlyTerminationOf } from './policy-defaults';
import { partyALine, partyBLine, type ContractClause } from './contract-text';

/**
 * PHỤ LỤC GIA HẠN của hợp đồng thuê kho — văn bản khách xác nhận mỗi lần gia hạn.
 *
 * Cơ sở: Điều 403 Bộ luật Dân sự 2015 (phụ lục hợp đồng có hiệu lực như hợp đồng, nội dung không được trái với hợp đồng; nếu các
 * bên chấp nhận phụ lục có điều khoản khác hợp đồng thì coi như điều khoản đó trong hợp đồng đã được sửa đổi) và Điều 421
 * (các bên có thể thoả thuận sửa đổi hợp đồng; sửa đổi phải theo hình thức của hợp đồng ban đầu) — hợp đồng gốc giao kết bằng
 * phương thức điện tử nên phụ lục cũng được xác nhận điện tử trên cùng tài khoản. Chỉ nhận dữ liệu thuần, không đọc DB.
 */
export interface RenewalAppendixInput {
  /** Số thứ tự phụ lục của hợp đồng này (1, 2, …). */
  number: number;
  contractNumber: string;
  /** Ngày giao kết hợp đồng gốc (ngày Bên B ký). */
  contractSignedAt?: string | null;
  facilityName: string;
  facilityAddress?: string | null;
  lessorRepresentative?: string | null;
  lessorAuthorization?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerIdLast4?: string | null;
  unitTypeName: string;
  unitNumber?: string | null;
  rentalPeriod: RentalPeriod;
  periods: number;
  /** Thời gian gia hạn: [from, newEndDate). */
  from: string;
  newEndDate: string;
  gross: number;
  discountAmount: number;
  rate: number;
  /** Phải trả ngay khi gia hạn (thuê ngày / tuần); 0 với thuê tháng. */
  payNow: number;
  depositAmount: number;
  gracePeriodDays: number;
  policyVersion: number;
  policy: { earlyTermination?: { maxElapsedPct: number; depositRefundPct: number }[]; discounts?: readonly DiscountTier[] };
  termsVersion: string;
}

export const appendixTitle = (n: number) => `Phụ lục số ${String(n).padStart(2, '0')} — Gia hạn thời hạn thuê`;

export function buildRenewalAppendix(i: RenewalAppendixInput): ContractClause[] {
  const unit = PERIOD_UNIT[i.rentalPeriod];
  const term = periodLabel(i.rentalPeriod, i.periods);
  const monthly = i.rentalPeriod === 'MONTH';
  const committed = monthly && i.discountAmount > 0;

  const tiers = [...earlyTerminationOf(i.policy)].sort((a, b) => a.maxElapsedPct - b.maxElapsedPct);
  const exitLines = committed ? [
    ...tiers.map((t, k) => {
      const prev = tiers[k - 1]?.maxElapsedPct;
      const range = prev === undefined ? `đã dùng đến ${t.maxElapsedPct}% thời gian gia hạn` : k === tiers.length - 1 ? `đã dùng trên ${prev}% thời gian gia hạn` : `đã dùng trên ${prev}% đến ${t.maxElapsedPct}% thời gian gia hạn`;
      return `Trả kho khi ${range}: hoàn ${t.depositRefundPct}% tiền giữ chân.`;
    }),
    (() => {
      const steps = [...new Set((i.policy.discounts ?? []).filter((d) => !d.requiresApprovalRole && d.minPeriods <= i.periods).map((d) => d.minPeriods))].sort((a, b) => a - b)
        .map((m) => `dùng từ ${m} tháng: giảm ${vnd(Math.min(i.discountAmount, pickDiscount(i.policy.discounts ?? [], 'MONTH', m, i.gross, new Date(i.from))?.amount ?? 0))}/tháng`);
      return `Ưu đãi ${vnd(i.discountAmount)}/tháng nêu tại Điều 2 được áp dụng vì Bên B cam kết thuê thêm ${term}. Nếu trả kho trước khi dùng đủ thời gian gia hạn, Bên B chỉ được hưởng mức ưu đãi của số tháng thực dùng trong thời gian gia hạn${steps.length ? ` (${steps.join('; ')}; dưới mức thấp nhất: không được giảm)` : ''}; phần ưu đãi đã hưởng vượt mức bị thu hồi và trừ vào tiền giữ chân khi quyết toán.`;
    })(),
    'Thời gian đã dùng tính từ ngày bắt đầu gia hạn đến ngày Bên B THỰC TẾ bàn giao lại ô kho cho nhân viên.',
  ] : monthly ? [
    'Thời gian gia hạn này không được hưởng ưu đãi thuê dài hạn nên Bên B trả kho trước khi hết thời gian gia hạn KHÔNG bị giới hạn mức hoàn: tiền giữ chân được hoàn đủ sau khi trừ chi phí hư hại và công nợ (nếu có).',
  ] : [
    `Bên B trả kho trước khi hết thời gian gia hạn thì KHÔNG được hoàn tiền thuê của các ${unit} chưa dùng; tiền giữ chân vẫn được hoàn đủ sau khi trừ chi phí hư hại và công nợ (nếu có).`,
  ];

  return [
    {
      title: 'Căn cứ',
      paragraphs: [
        `Phụ lục này là một phần của Hợp đồng thuê kho số ${i.contractNumber}${i.contractSignedAt ? `, giao kết ngày ${fmtDate(i.contractSignedAt)}` : ''} (sau đây gọi là "Hợp đồng") giữa hai bên dưới đây, được lập theo Điều 403 và Điều 421 Bộ luật Dân sự năm 2015 và Luật Giao dịch điện tử năm 2023, trên cơ sở đề nghị gia hạn của Bên B.`,
      ],
      bullets: [],
    },
    {
      title: 'Điều 1. Các bên',
      paragraphs: [`BÊN A — BÊN CHO THUÊ: ${partyALine(i)}.`, `BÊN B — BÊN THUÊ: ${partyBLine(i)}.`],
      bullets: [],
    },
    {
      title: 'Điều 2. Nội dung gia hạn',
      paragraphs: [],
      bullets: [
        `Hai bên thống nhất gia hạn thời hạn thuê ${i.unitTypeName}${i.unitNumber ? `, ô ${i.unitNumber}` : ''} tại ${i.facilityName} thêm ${term}, từ ngày ${fmtDate(i.from)} đến hết ngày ${fmtDate(lastDayOf(i.newEndDate))}. Ô kho, mục đích thuê và hình thức khoá giữ nguyên như Hợp đồng.`,
        `Giá thuê trong thời gian gia hạn: giá niêm yết tại thời điểm gia hạn ${vnd(i.gross)}/${unit} (đã gồm phụ phí điều hòa nếu Bên B đang sử dụng)${i.discountAmount > 0 ? `, trừ ưu đãi thuê dài hạn ${vnd(i.discountAmount)}/${unit} tính theo số tháng gia hạn` : ', không có ưu đãi thuê dài hạn'}; tiền thuê Bên B phải trả là ${vnd(i.rate)}/${unit}.`,
        monthly
          ? `Thanh toán: Bên B KHÔNG phải trả trước tiền thuê của thời gian gia hạn. Tiền thuê được xuất hoá đơn vào đầu mỗi tháng và thanh toán trong vòng ${i.gracePeriodDays} ngày, như quy định về thanh toán của Hợp đồng.`
          : `Thanh toán: thuê theo ${unit}, Bên B thanh toán trọn ${vnd(i.payNow)} cho cả thời gian gia hạn ngay khi xác nhận phụ lục này.`,
        `Tiền giữ chân ${vnd(i.depositAmount)} Bên B đã đặt theo Hợp đồng được giữ nguyên, không thu thêm, và tiếp tục bảo đảm nghĩa vụ của Bên B trong thời gian gia hạn.`,
      ],
    },
    { title: 'Điều 3. Trả kho trước khi hết thời gian gia hạn', paragraphs: [], bullets: exitLines },
    {
      title: 'Điều 4. Hết thời gian gia hạn',
      paragraphs: [
        `Hết ngày ${fmtDate(lastDayOf(i.newEndDate))} mà Bên B chưa gia hạn tiếp hoặc chưa trả kho, tiền thuê tiếp tục được tính theo từng ${unit} với giá ${vnd(i.gross)}/${unit} (giá chưa trừ ưu đãi thuê dài hạn) cho đến khi Bên B bàn giao lại ô kho. Bên A không tự động gia hạn cam kết thay Bên B.`,
      ],
      bullets: [],
    },
    {
      title: 'Điều 5. Hiệu lực và quan hệ với Hợp đồng',
      paragraphs: [],
      bullets: [
        'Phụ lục này là bộ phận không tách rời của Hợp đồng và có hiệu lực như Hợp đồng. Trong thời gian gia hạn, các nội dung về thời hạn, giá thuê, ưu đãi và mức hoàn khi trả kho sớm thực hiện theo phụ lục này; mọi nội dung khác của Hợp đồng (quyền và nghĩa vụ của các bên, hàng cấm, quá hạn thanh toán, khoá truy cập, hàng bỏ lại, giới hạn trách nhiệm, giải quyết tranh chấp) giữ nguyên hiệu lực.',
        `Hai bên thực hiện theo Điều khoản thuê kho (v${i.termsVersion}) và chính sách phiên bản v${i.policyVersion} áp dụng tại thời điểm gia hạn.`,
        'Phụ lục được giao kết bằng phương thức điện tử: Bên B xác nhận trên tài khoản đã đăng nhập của chính mình; Bên A chấp nhận thông qua hệ thống KhoAn do Bên A vận hành, do người đại diện nêu tại Điều 1 chịu trách nhiệm. Hệ thống ghi nhận họ tên người xác nhận và thời điểm xác nhận làm chứng cứ giao kết. Phụ lục có hiệu lực từ thời điểm Bên B xác nhận và luôn xem lại được trong tài khoản của Bên B.',
      ],
    },
  ];
}
