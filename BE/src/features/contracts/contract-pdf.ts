import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import { LESSOR, lessorRepresentativeLine, type ContractClause, type SignatureMethod } from '@ssm/shared';

/** Font DejaVu (có đủ dấu tiếng Việt) lấy từ package dejavu-fonts-ttf — font chuẩn của PDF không có chữ có dấu. */
export const fontDir = () => join(dirname(createRequire(join(process.cwd(), 'package.json')).resolve('dejavu-fonts-ttf/package.json')), 'ttf');

export interface ContractPdfInput {
  code: string;
  contractNumber?: string | null;
  facilityName: string;
  customerName: string;
  clauses: ContractClause[];
  /** null = bản xem trước chưa ký: khối chữ ký để trống, ghi rõ chưa có giá trị. */
  signature: { signedAt: Date; signerName: string; method: SignatureMethod; image?: string | null; onBehalf: boolean } | null;
  generatedAt: Date;
  /** Quản lý chi nhánh đại diện Bên A; thiếu thì in người đại diện theo pháp luật. */
  lessorRepresentative?: string | null;
  lessorAuthorization?: string | null;
  /** Tiêu đề văn bản (mặc định HỢP ĐỒNG THUÊ KHO) — phụ lục gia hạn dùng lại cùng khuôn. */
  title?: string;
  subtitle?: string;
  /** Cách Bên B xác nhận, in dưới chữ ký (mặc định theo hình thức ký hợp đồng). */
  signedHow?: string;
  /** Ghi nhận đối chiếu giấy tờ tùy thân của Bên B khi bàn giao kho — in dưới khối chữ ký (không sửa nội dung đã ký). */
  identityNote?: string | null;
  /** Bản IN để khách ký giấy tại quầy: không ghi "bản xem trước", chừa chỗ ký tay cho Bên B. */
  printForSigning?: boolean;
}

const fmt = (d: Date) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** Dựng PDF hợp đồng đã ký (A4). Chữ ký vẽ tay chèn dạng ảnh PNG; ký bằng họ tên thì in họ tên kiểu chữ ký. */
export function buildContractPdf(input: ContractPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dir = fontDir();
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${input.title ?? 'Hợp đồng thuê kho'} ${input.code}`, Author: 'KhoAn', Subject: input.title ?? 'Hợp đồng thuê kho' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('regular', join(dir, 'DejaVuSans.ttf'));
    doc.registerFont('bold', join(dir, 'DejaVuSans-Bold.ttf'));
    doc.registerFont('italic', join(dir, 'DejaVuSans-Oblique.ttf'));

    doc.font('bold').fontSize(input.title ? 14 : 16).fillColor('#1c1917').text((input.title ?? 'HỢP ĐỒNG THUÊ KHO').toUpperCase(), { align: 'center' });
    doc.moveDown(0.3).font('regular').fontSize(9).fillColor('#78716c')
      .text(input.subtitle ?? `Mã đặt chỗ ${input.code}${input.contractNumber ? ` · Số hợp đồng ${input.contractNumber}` : ''}`, { align: 'center' });
    doc.moveDown(1.2);
    if (!input.signature && !input.printForSigning) {
      doc.font('bold').fontSize(10).fillColor('#b91c1c').text('BẢN XEM TRƯỚC — CHƯA KÝ, CHƯA CÓ GIÁ TRỊ PHÁP LÝ', { align: 'center' }).moveDown(1);
    }

    for (const c of input.clauses) {
      doc.font('bold').fontSize(11).fillColor('#1c1917').text(c.title);
      doc.moveDown(0.25).font('regular').fontSize(10).fillColor('#292524');
      for (const p of c.paragraphs) doc.text(p, { align: 'justify', lineGap: 2 }).moveDown(0.3);
      if (c.bullets.length) doc.list(c.bullets, { bulletRadius: 1.5, bulletIndent: 8, textIndent: 16, lineGap: 2, paragraphGap: 3 });
      doc.moveDown(0.7);
    }

    const colW = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;
    const left = doc.page.margins.left;
    // Dòng người đại diện Bên A dài ngắn tuỳ tên + giấy uỷ quyền → đáy khối chữ ký tính theo chiều cao thật.
    const repLine = lessorRepresentativeLine(input.lessorRepresentative, input.lessorAuthorization);
    const repH = doc.font('regular').fontSize(9).heightOfString(repLine, { width: colW - 12, align: 'center' });
    const blockH = Math.max(130, 90 + repH + 10);
    // Khối chữ ký không bị cắt đôi giữa hai trang.
    if (doc.y > doc.page.height - doc.page.margins.bottom - (blockH + 45)) doc.addPage();
    doc.moveDown(0.5);
    const top = doc.y;

    // BÊN A không ký tay: pháp nhân chấp nhận giao kết qua hệ thống do mình vận hành, người đại diện chịu trách nhiệm.
    doc.font('bold').fontSize(10).fillColor('#1c1917').text('ĐẠI DIỆN BÊN A (BÊN CHO THUÊ)', left, top, { width: colW, align: 'center' });
    doc.font('regular').fontSize(9).fillColor('#78716c').text(`${LESSOR.legalName} — ${input.facilityName}`, left, top + 16, { width: colW - 12, align: 'center' });
    const signed = input.signature;
    // Bản in để ký giấy tại quầy: để trống chỗ ký của Bên A (người đại diện ký tay trên giấy).
    if (signed || !input.printForSigning) {
      doc.fontSize(9).fillColor(signed ? '#047857' : '#a8a29e').text(signed ? 'Đã xác nhận điện tử qua hệ thống KhoAn' : '(chưa xác nhận)', left, top + 52, { width: colW, align: 'center' });
    }
    if (signed) doc.fontSize(8).fillColor('#78716c').text(fmt(signed.signedAt), left, top + 66, { width: colW, align: 'center' });
    doc.fontSize(9).fillColor('#292524').text(repLine, left + 6, top + 90, { width: colW - 12, align: 'center' });

    const rx = left + colW;
    doc.font('bold').fontSize(10).fillColor('#1c1917').text('BÊN B (BÊN THUÊ)', rx, top, { width: colW, align: 'center' });
    doc.font('regular').fontSize(9).fillColor('#78716c').text(input.customerName, rx, top + 16, { width: colW, align: 'center' });
    if (signed) {
      // Ảnh chữ ký hỏng (dữ liệu cũ trước khi kiểm PNG) không được làm hỏng cả PDF — bỏ ảnh, in tên + ghi chú.
      let drawn = false;
      if (signed.method === 'DRAWN' && signed.image) {
        try {
          const png = Buffer.from(signed.image.replace(/^data:image\/png;base64,/, ''), 'base64');
          doc.image(png, rx + (colW - 170) / 2, top + 34, { fit: [170, 56] });
          drawn = true;
        } catch {
          doc.font('regular').fontSize(7).fillColor('#a8a29e').text('(ảnh chữ ký không đọc được — xem bản lưu trên hệ thống)', rx, top + 30, { width: colW, align: 'center' });
        }
      }
      if (!drawn) {
        doc.font('italic').fontSize(18).fillColor('#1c1917').text(signed.signerName, rx, top + 44, { width: colW, align: 'center' });
      }
      doc.font('regular').fontSize(9).fillColor('#292524').text(signed.signerName, rx, top + 90, { width: colW, align: 'center' });
      const how = `${input.signedHow ?? (signed.method === 'DRAWN' ? 'Ký tay' : 'Ký bằng họ tên')} · ${fmt(signed.signedAt)}${signed.onBehalf ? ' · nhân viên thao tác tại quầy' : ''}`;
      doc.fontSize(8).fillColor('#78716c').text(how, rx, top + 103, { width: colW, align: 'center' });
    } else {
      doc.font('regular').fontSize(9).fillColor('#a8a29e').text(input.printForSigning ? '(ký, ghi rõ họ tên)' : '(chưa ký)', rx, top + (input.printForSigning ? 100 : 52), { width: colW, align: 'center' });
    }
    const sigBottom = top + blockH;

    doc.y = sigBottom;
    if (input.identityNote) {
      doc.moveDown(0.6).font('regular').fontSize(9).fillColor('#292524').text(input.identityNote, left, doc.y, { width: colW * 2, align: 'left' });
    }
    doc.moveDown(1).font('italic').fontSize(8).fillColor('#a8a29e')
      .text(`${input.signature ? 'Văn bản điện tử được lập' : input.printForSigning ? 'Bản in để ký tại quầy, lập' : 'Bản xem trước được dựng'} tự động từ hệ thống KhoAn lúc ${fmt(input.generatedAt)}.`, left, doc.y, { width: colW * 2, align: 'center' });
    doc.end();
  });
}
