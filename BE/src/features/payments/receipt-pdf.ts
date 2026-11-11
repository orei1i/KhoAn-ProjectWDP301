import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { COLLECTED_PAYMENT_STATUSES, fmtDate, LESSOR, PAYMENT_TYPE, paymentMethodLabel, vnd } from '@ssm/shared';
import { FacilityModel, PaymentModel, RentalContractModel, ReservationModel, UserModel, type UserHydrated } from '../../shared/db/models';
import { NotFound, Unprocessable } from '../../shared/core/errors';
import { assertCanAccess } from '../../shared/http/scope';
import { fontDir } from '../contracts/contract-pdf';

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc một nhóm 3 chữ số. `full`: nhóm không đứng đầu thì luôn đọc đủ trăm ("không trăm …"). */
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out: string[] = [];
  if (h || full) out.push(`${DIGITS[h]} trăm`);
  if (t > 1) out.push(`${DIGITS[t]} mươi`);
  else if (t === 1) out.push('mười');
  else if (u && (h || full)) out.push('linh');
  if (u) out.push(u === 1 && t > 1 ? 'mốt' : u === 5 && t > 0 ? 'lăm' : u === 4 && t > 1 ? 'tư' : DIGITS[u]);
  return out.join(' ');
}

/** Số tiền bằng chữ tiếng Việt, VD 1.250.000 → "Một triệu hai trăm năm mươi nghìn đồng". */
export function vndInWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ', ' triệu tỷ'];
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    parts.push(readTriple(groups[i], i < groups.length - 1) + units[i]);
  }
  const s = parts.join(' ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} đồng`;
}

const when = (d: Date) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

interface ReceiptLine { content: string; amount: number }
interface ReceiptData {
  number: string; outbound: boolean; facility: string; facilityAddress: string | null; customer: string;
  /** Một lần thu có thể gồm nhiều khoản (VD tiền giữ chân + tiền thuê kỳ đầu) — MỘT biên lai liệt kê từng khoản, số tiền là tổng. */
  lines: ReceiptLine[];
  amount: number; method: string; txnRef: string | null; collector: string; at: Date; generatedAt: Date;
}

function buildReceiptPdf(d: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dir = fontDir();
    const title = d.outbound ? 'BIÊN LAI CHI TIỀN' : 'BIÊN LAI THU TIỀN';
    const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 36, info: { Title: `${title} ${d.number}`, Author: 'KhoAn', Subject: title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('regular', join(dir, 'DejaVuSans.ttf'));
    doc.registerFont('bold', join(dir, 'DejaVuSans-Bold.ttf'));
    doc.registerFont('italic', join(dir, 'DejaVuSans-Oblique.ttf'));

    doc.font('bold').fontSize(10).fillColor('#1c1917').text(`${LESSOR.legalName} — ${d.facility}`);
    if (d.facilityAddress) doc.font('regular').fontSize(8).fillColor('#57534e').text(d.facilityAddress);
    doc.moveDown(0.6).font('bold').fontSize(15).fillColor('#1c1917').text(title, { align: 'center' });
    doc.font('regular').fontSize(8).fillColor('#78716c').text(`Số biên lai: ${d.number}`, { align: 'center' });
    doc.moveDown(0.8);
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font('regular').fontSize(9.5).fillColor('#57534e').text(label, 36, y, { width: 130 });
      doc.font(bold ? 'bold' : 'regular').fontSize(9.5).fillColor('#1c1917').text(value, 170, y, { width: doc.page.width - 206 });
      doc.moveDown(0.35);
    };
    row(d.outbound ? 'Người nhận tiền' : 'Khách hàng', d.customer);
    if (d.lines.length === 1) row('Nội dung', d.lines[0].content);
    else d.lines.forEach((l, i) => row(i === 0 ? 'Nội dung' : '', `${i + 1}. ${l.content}: ${vnd(l.amount)}`));
    row(d.lines.length > 1 ? 'Tổng số tiền' : 'Số tiền', vnd(d.amount), true);
    row('Bằng chữ', vndInWords(d.amount));
    row('Hình thức', d.method);
    row('Mã giao dịch', d.txnRef ?? '—');
    row(d.outbound ? 'Người chi' : 'Người thu', d.collector);
    row('Thời điểm', when(d.at));
    doc.moveDown(0.8).font('italic').fontSize(8).fillColor('#78716c')
      .text('Biên lai không thay thế hoá đơn GTGT. Hoá đơn (nếu cần) được xuất theo yêu cầu tại chi nhánh.', 36, doc.y, { align: 'left' });
    doc.text(`In lúc ${when(d.generatedAt)} từ hệ thống ${LESSOR.brand}.`);
    doc.end();
  });
}

/**
 * Biên lai của MỘT khoản đã thu (hoặc khoản hoàn đã chi) — khách chủ khoản, nhân viên / quản lý đúng chi nhánh, vận hành, quản trị (C2).
 * Chỉ khoản tiền thật: thu đã thành công (kể cả đã hoàn một phần / toàn bộ về sau) hoặc khoản chi đã chuyển; khoản nội bộ (cấn trừ,
 * miễn giảm) và khoản chưa thanh toán không có biên lai.
 */
export async function assertReceiptAvailable(user: UserHydrated, id: string) {
  const p = await PaymentModel.findById(id).lean();
  if (!p) throw NotFound('khoản thanh toán');
  await assertCanAccess(user, { facilityId: p.facilityId, customerId: p.customerId }, 'payment.receipt');
  const outbound = p.direction === 'REFUND';
  const ok = p.method !== 'INTERNAL' && (outbound ? p.status === 'SUCCEEDED' : COLLECTED_PAYMENT_STATUSES.includes(p.status));
  if (!ok) throw Unprocessable('Chỉ in biên lai cho khoản đã thu (hoặc khoản hoàn đã chi) bằng tiền thật', 'RECEIPT_NOT_AVAILABLE');
  return p;
}

/** Tối đa số khoản gộp trong một biên lai (một lần thu: tiền giữ chân, tiền thuê kỳ đầu, dịch vụ kèm…). */
export const RECEIPT_MAX_PAYMENTS = 10;

/**
 * Các khoản in chung MỘT biên lai: mỗi khoản phải có biên lai (assertReceiptAvailable), và cùng khách, cùng chi nhánh, cùng chiều tiền
 * (thu / chi) — không ghép khoản không liên quan vào một chứng từ. Trả các khoản theo thứ tự id gửi lên (khoản chính đứng đầu).
 */
export async function assertReceiptGroup(user: UserHydrated, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > RECEIPT_MAX_PAYMENTS) throw Unprocessable(`Một biên lai gồm 1–${RECEIPT_MAX_PAYMENTS} khoản`, 'RECEIPT_GROUP_INVALID');
  const rows = [];
  for (const id of unique) rows.push(await assertReceiptAvailable(user, id));
  const [head] = rows;
  const same = rows.every((p) => String(p.customerId) === String(head.customerId) && String(p.facilityId) === String(head.facilityId) && p.direction === head.direction);
  if (!same) throw Unprocessable('Chỉ gộp biên lai cho các khoản của cùng khách, cùng chi nhánh trong một lần thu', 'RECEIPT_GROUP_INVALID');
  return rows;
}

/**
 * Dựng PDF biên lai — cùng điều kiện quyền / trạng thái như trên (dùng chung cho tải trực tiếp và link ngắn hạn của app). Nhiều `id`
 * → MỘT biên lai cho cả lần thu (RV3: không in hai tờ cho một lần trả tiền).
 */
export async function receiptPdfFor(user: UserHydrated, id: string | string[]) {
  const rows = await assertReceiptGroup(user, Array.isArray(id) ? id : [id]);
  const [p] = rows;
  const outbound = p.direction === 'REFUND';
  const oid = (v: unknown) => (v ? String(v) : null);
  const contractIds = [...new Set(rows.map((x) => oid(x.contractId)).filter((x): x is string => !!x))];
  const reservationIds = [...new Set(rows.map((x) => oid(x.reservationId)).filter((x): x is string => !!x))];
  const collectorId = rows.map((x) => x.recordedBy ?? x.payout?.confirmedBy).find(Boolean);
  const [facility, customer, contracts, reservations, collector] = await Promise.all([
    FacilityModel.findById(p.facilityId, { name: 1, address: 1 }).lean(),
    UserModel.findById(p.customerId, { fullName: 1 }).lean(),
    contractIds.length ? RentalContractModel.find({ _id: { $in: contractIds } }, { contractNumber: 1 }).lean() : [],
    reservationIds.length ? ReservationModel.find({ _id: { $in: reservationIds } }, { code: 1 }).lean() : [],
    collectorId ? UserModel.findById(collectorId, { fullName: 1 }).lean() : null,
  ]);
  const contractNo = new Map(contracts.map((c) => [String(c._id), c.contractNumber]));
  const rsvCode = new Map(reservations.map((r) => [String(r._id), r.code]));
  // Liệt kê theo thứ tự đã thu (VD tiền giữ chân trước, tiền thuê sau); số biên lai vẫn là khoản chính (khoản đầu tiên gửi lên).
  const byTime = [...rows].sort((a, b) => (a.paidAt ?? a.createdAt).getTime() - (b.paidAt ?? b.createdAt).getTime());
  const lines = byTime.map((x) => {
    const c = contractNo.get(oid(x.contractId) ?? '');
    const r = rsvCode.get(oid(x.reservationId) ?? '');
    const refs = [c ? `hợp đồng ${c}` : null, r ? `đặt chỗ ${r}` : null].filter(Boolean).join(', ');
    const period = x.period ? `, kỳ ${fmtDate(x.period.start.toISOString())} – ${fmtDate(x.period.end.toISOString())}` : '';
    return { content: `${PAYMENT_TYPE[x.type].label}${refs ? ` — ${refs}` : ''}${period}`, amount: x.amount };
  });
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const refs = uniq(rows.map((x) => x.payout?.reference ?? x.provider?.counterRef ?? x.provider?.transactionNo ?? x.provider?.txnRef ?? null));
  const at = rows.map((x) => x.paidAt ?? x.updatedAt ?? new Date()).reduce((a, b) => (b > a ? b : a));
  const pdf = await buildReceiptPdf({
    number: String(p._id).toUpperCase() + (rows.length > 1 ? ` (gồm ${rows.length} khoản)` : ''), outbound,
    facility: facility?.name ?? '—', facilityAddress: facility ? `${facility.address.line1}, ${facility.address.district}, ${facility.address.city}` : null,
    customer: customer?.fullName ?? '—',
    lines, amount: rows.reduce((s, x) => s + x.amount, 0), method: uniq(rows.map(paymentMethodLabel)).join(', '),
    txnRef: refs.length ? refs.join(', ') : null,
    collector: collector?.fullName ?? (outbound ? 'Hoàn qua cổng thanh toán' : 'Thanh toán trực tuyến'),
    at, generatedAt: new Date(),
  });
  return { pdf, filename: `bien-lai-${String(p._id)}.pdf` };
}
