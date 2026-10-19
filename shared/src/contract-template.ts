/**
 * MẪU HỢP ĐỒNG — Quản lý vận hành soạn lời văn từng điều, hệ thống điền số liệu.
 *
 * Mẫu là danh sách điều khoản cố định (không thêm/xoá/đổi thứ tự điều), mỗi điều gồm tiêu đề, các đoạn văn và các
 * gạch đầu dòng. Trong lời văn dùng BIẾN dạng `{{ten_bien}}`:
 *  - biến GIÁ TRỊ: thay bằng một giá trị (tên khách, số tiền, ngày…);
 *  - biến KHỐI: một hoặc nhiều câu do HỆ THỐNG soạn sẵn vì chứa con số ràng buộc (các khoản thanh toán, các mức hoàn tiền).
 *    Đặt biến khối một mình trên một dòng thì mỗi câu thành một dòng riêng. Người soạn không sửa được nội dung khối —
 *    nhờ vậy sửa lời văn không bao giờ làm sai số tiền hay mức hoàn.
 *
 * File này không phụ thuộc dữ liệu đặt chỗ: phần tính giá trị biến nằm ở contract-text.ts.
 */
export interface ContractTemplateClause {
  /** Mã cố định của điều — dùng để đối chiếu với mẫu mặc định, không hiển thị. */
  key: string;
  title: string;
  /** false: không đánh số "Điều N" (phần căn cứ ở đầu). */
  numbered: boolean;
  paragraphs: string[];
  bullets: string[];
}

export interface ContractTemplate<I = string, D = string> {
  _id: I;
  scope: 'GLOBAL' | 'FACILITY';
  facilityId?: I | null;
  /** 0 = mẫu mặc định của hệ thống (chưa ai phát hành mẫu riêng). */
  version: number;
  isActive: boolean;
  clauses: ContractTemplateClause[];
  /** Lý do / nội dung thay đổi do người phát hành ghi. */
  note?: string | null;
  effectiveFrom: D;
  createdBy?: I | null;
  createdAt?: D;
}

export interface ContractVariableInfo { key: string; label: string; kind: 'VALUE' | 'BLOCK'; required: boolean; example: string }

/** Danh mục biến — vừa để hiển thị cho người soạn, vừa để kiểm tra mẫu trước khi phát hành. */
export const CONTRACT_VARIABLES: readonly ContractVariableInfo[] = [
  { key: 'ben_cho_thue', label: 'Bên cho thuê (tên chi nhánh, địa chỉ)', kind: 'VALUE', required: true, example: 'KhoAn — KhoAn Quận 7, 88 Nguyễn Thị Thập' },
  { key: 'ben_thue', label: 'Họ tên bên thuê', kind: 'VALUE', required: true, example: 'Nguyễn Minh Anh' },
  { key: 'doi_tuong', label: 'Mô tả ô kho (loại, số ô, tầng, diện tích, khoá)', kind: 'VALUE', required: true, example: 'Phòng S, ô S1-08 (tầng 1), diện tích 3 m²' },
  { key: 'dieu_hoa', label: 'Có dùng điều hòa hay không', kind: 'VALUE', required: false, example: 'không sử dụng (không tính phụ phí)' },
  { key: 'ngay_bat_dau', label: 'Ngày bắt đầu', kind: 'VALUE', required: false, example: '12/10/2026' },
  { key: 'thoi_han', label: 'Thời hạn thuê', kind: 'VALUE', required: true, example: '3 tháng' },
  { key: 'ngay_ket_thuc', label: 'Ngày cuối cùng của thời hạn (dùng kho đến hết ngày này)', kind: 'VALUE', required: false, example: '11/01/2027' },
  { key: 'don_vi', label: 'Đơn vị kỳ thuê (ngày / tuần / tháng)', kind: 'VALUE', required: false, example: 'tháng' },
  { key: 'dai_dien_ben_a', label: 'Người đại diện Bên A ký hợp đồng (quản lý chi nhánh)', kind: 'VALUE', required: false, example: 'Bùi Thanh Tùng — Quản lý chi nhánh' },
  { key: 'gia_thue', label: 'Giá thuê mỗi kỳ', kind: 'VALUE', required: true, example: '990.000 ₫' },
  { key: 'tien_thue_moi_ky', label: 'Tiền thuê thực trả mỗi kỳ (sau phụ phí, ưu đãi)', kind: 'VALUE', required: false, example: '891.000 ₫' },
  { key: 'tien_giu_chan', label: 'Số tiền giữ chân', kind: 'VALUE', required: false, example: '990.000 ₫' },
  { key: 'tien_thue_ky_dau', label: 'Số tiền thuê kỳ đầu', kind: 'VALUE', required: false, example: '891.000 ₫' },
  { key: 'tong_truoc_khi_dung', label: 'Tổng phải trả trước khi dùng kho', kind: 'VALUE', required: false, example: '1.881.000 ₫' },
  { key: 'an_han_ngay', label: 'Số ngày ân hạn thanh toán', kind: 'VALUE', required: false, example: '5' },
  { key: 'khoa_sau_ngay', label: 'Quá hạn bao nhiêu ngày thì khoá truy cập', kind: 'VALUE', required: false, example: '15' },
  { key: 'bo_lai_sau_ngay', label: 'Bao nhiêu ngày sau thông báo cuối thì được xử lý hàng bỏ lại', kind: 'VALUE', required: false, example: '30' },
  { key: 'phien_ban_dieu_khoan', label: 'Phiên bản Điều khoản thuê kho', kind: 'VALUE', required: false, example: '1.3' },
  { key: 'phien_ban_chinh_sach', label: 'Phiên bản chính sách giá', kind: 'VALUE', required: false, example: '3' },
  { key: 'dong_phu_phi', label: 'Các dòng phụ phí (tên, số tiền, cách tính, lý do)', kind: 'BLOCK', required: false, example: 'Phụ phí điều hòa nhiệt độ: +99.000 ₫ mỗi tháng (10% giá thuê)…' },
  { key: 'dong_uu_dai', label: 'Dòng ưu đãi thuê dài hạn và tiền thuê thực trả', kind: 'BLOCK', required: false, example: 'Ưu đãi thuê dài hạn: −99.000 ₫ mỗi tháng.' },
  { key: 'khoan_giu_chan', label: 'Khoản 1 — tiền giữ chân (số tiền, khi trả, khi hoàn)', kind: 'BLOCK', required: true, example: 'Khoản 1 — Tiền giữ chân (còn gọi là tiền cọc): 990.000 ₫, trả khi đặt chỗ…' },
  { key: 'khoan_tien_thue_ky_dau', label: 'Khoản 2 — tiền thuê kỳ đầu (trả khi đặt hay khi nhận kho)', kind: 'BLOCK', required: true, example: 'Khoản 2 — Tiền thuê tháng đầu: 891.000 ₫, thanh toán THÊM khi nhận kho…' },
  { key: 'khoan_cac_ky_sau', label: 'Cách trả tiền thuê các kỳ sau (thuê tháng: từng kỳ; thuê ngày / tuần: đã trả trọn, không hoàn kỳ chưa dùng)', kind: 'BLOCK', required: true, example: 'Các kỳ sau thanh toán theo từng tháng vào đầu mỗi kỳ…' },
  { key: 'muc_hoan_khi_huy', label: 'Các mức hoàn tiền khi hủy đặt chỗ', kind: 'BLOCK', required: true, example: 'Hủy trước ngày nhận kho từ 72 giờ (3 ngày) trở lên: hoàn 100%…' },
  { key: 'muc_hoan_tra_som', label: 'Các mức hoàn tiền giữ chân khi trả kho sớm', kind: 'BLOCK', required: true, example: 'Trả kho sớm khi đã dùng đến 25% kỳ hạn: hoàn 0% tiền giữ chân…' },
];

/** Giá trị biến của một hợp đồng cụ thể (contract-text.ts tính từ đặt chỗ + chính sách). */
export interface ContractVariableValues { values: Record<string, string>; blocks: Record<string, string[]> }

/** Mẫu mặc định của hệ thống — cũng là "khung" quy định các điều bắt buộc có và thứ tự của chúng. */
export const DEFAULT_CONTRACT_CLAUSES: readonly ContractTemplateClause[] = [
  {
    key: 'can-cu', title: 'Căn cứ giao kết', numbered: false,
    paragraphs: ['Hợp đồng này được giao kết trên cơ sở tự nguyện, bình đẳng của hai bên, căn cứ Bộ luật Dân sự năm 2015 (các quy định về hợp đồng thuê tài sản và về đặt cọc), Luật Giao dịch điện tử năm 2023 và Luật Bảo vệ quyền lợi người tiêu dùng năm 2023.'],
    bullets: [],
  },
  {
    key: 'cac-ben', title: 'Các bên', numbered: true,
    paragraphs: [
      'BÊN A — BÊN CHO THUÊ: {{ben_cho_thue}}.',
      'BÊN B — BÊN THUÊ: {{ben_thue}}.',
      'Trong hợp đồng này và các phụ lục kèm theo, Bên A còn được gọi là "Bên cho thuê", Bên B còn được gọi là "Bên thuê". Bên B cam đoan thông tin về mình nêu trên là đúng và mình có đầy đủ năng lực hành vi dân sự để giao kết hợp đồng này.',
    ],
    bullets: [],
  },
  {
    key: 'doi-tuong', title: 'Đối tượng và mục đích thuê', numbered: true,
    paragraphs: [
      '{{doi_tuong}}. Điều hòa: {{dieu_hoa}}.',
      'Bên thuê thuê không gian nêu trên để tự lưu trữ tài sản hợp pháp của mình. Đây là hợp đồng thuê không gian lưu trữ, không phải hợp đồng gửi giữ tài sản: Bên cho thuê không kiểm đếm, không định giá và không quản lý tài sản bên trong ô kho.',
    ],
    bullets: [],
  },
  {
    key: 'thoi-han', title: 'Thời hạn', numbered: true,
    paragraphs: ['Từ ngày {{ngay_bat_dau}}, thời hạn {{thoi_han}} (đến hết ngày {{ngay_ket_thuc}}). Hết hạn mà chưa gia hạn hay bàn giao lại kho, từ ngày kế tiếp tiền thuê tiếp tục được tính theo từng {{don_vi}} với giá thuê CHƯA trừ ưu đãi thuê dài hạn, cho đến khi Bên thuê trả kho.'],
    bullets: [],
  },
  {
    key: 'gia', title: 'Giá và thanh toán', numbered: true, paragraphs: [],
    bullets: [
      'Giá thuê mỗi {{don_vi}}: {{gia_thue}}.',
      '{{dong_phu_phi}}',
      '{{dong_uu_dai}}',
      'Trước khi sử dụng kho, Bên thuê thanh toán tổng cộng {{tong_truoc_khi_dung}}, gồm HAI khoản riêng biệt dưới đây. Bên thuê xác nhận đã được thông báo rõ cả hai khoản này khi đặt chỗ:',
      '{{khoan_giu_chan}}',
      '{{khoan_tien_thue_ky_dau}}',
      '{{khoan_cac_ky_sau}}',
      'Quá hạn thanh toán quá {{an_han_ngay}} ngày bị tính phí trễ và Bên cho thuê gửi cảnh báo; quá {{khoa_sau_ngay}} ngày bị khoá quyền ra vào (đồ trong kho vẫn được giữ nguyên) và Bên cho thuê gửi thông báo khoá. Các thông báo được gửi qua email và hiển thị trong tài khoản của Bên thuê.',
      'Khi trả kho, nếu chi phí hư hại và công nợ lớn hơn tiền giữ chân thì Bên thuê phải thanh toán phần còn thiếu; chưa thanh toán xong thì chưa được đặt kho mới.',
    ],
  },
  {
    key: 'huy', title: 'Hủy đặt chỗ, chấm dứt trước hạn và hàng bỏ lại', numbered: true, paragraphs: [],
    bullets: [
      'Bên thuê có quyền hủy đặt chỗ hoặc trả kho trước hạn bất cứ lúc nào. Việc hủy, trả kho trước hạn là quyết định của Bên thuê; Bên thuê tự chịu trách nhiệm về quyết định đó và chỉ được hoàn tiền theo các mức dưới đây.',
      '{{muc_hoan_khi_huy}}',
      '{{muc_hoan_tra_som}}',
      'Tiền thuê của kỳ đang sử dụng không được hoàn khi Bên thuê trả kho trước hạn.',
      'Nếu Bên cho thuê không bàn giao được ô kho đã đặt do lỗi của mình: Bên cho thuê hoàn 100% số tiền Bên thuê đã thanh toán khi đặt chỗ. Hai bên thoả thuận đây là toàn bộ trách nhiệm của Bên cho thuê trong trường hợp này, thay cho mức phạt cọc quy định tại khoản 2 Điều 328 Bộ luật Dân sự.',
      'Bị khoá quyền ra vào mà vẫn không thanh toán: Bên cho thuê gửi THÔNG BÁO CUỐI nêu rõ dư nợ và hạn chót. Chỉ khi đã qua {{bo_lai_sau_ngay}} ngày kể từ thông báo cuối mà Bên thuê không thanh toán hay liên hệ, Bên cho thuê mới được mở kho, kiểm kê có lập biên bản và thanh lý đồ trong kho. Tiền giữ chân và tiền thu được từ thanh lý dùng để trừ công nợ và chi phí kiểm kê, thanh lý; phần còn dư trả lại Bên thuê, phần còn thiếu Bên thuê vẫn phải thanh toán.',
    ],
  },
  {
    key: 'dien-tu', title: 'Giao kết bằng phương thức điện tử', numbered: true, paragraphs: [],
    bullets: [
      'Hợp đồng này được lập và ký trực tuyến trên hệ thống KhoAn. Bên B (Bên thuê) tự ký bằng cách vẽ chữ ký hoặc gõ họ tên trên tài khoản đã đăng nhập của chính mình; nhân viên của Bên A không ký thay Bên B.',
      'Bên A (Bên cho thuê) giao kết hợp đồng thông qua hệ thống KhoAn do chính Bên A vận hành: việc hệ thống chấp nhận đặt chỗ, nhận tiền giữ chân và phát hành hợp đồng này là sự chấp nhận giao kết của Bên A, do người đại diện nêu tại Điều 1 chịu trách nhiệm thực hiện. Bên A không ký tay trên văn bản; xác nhận điện tử của hệ thống kèm thời điểm ký được in tại phần chữ ký.',
      'Hệ thống ghi nhận họ tên người ký, hình thức ký, thời điểm ký, phiên bản Điều khoản thuê kho và phiên bản chính sách áp dụng. Hai bên thừa nhận các dữ liệu này là chứng cứ về việc giao kết, và hợp đồng điện tử này có giá trị pháp lý như hợp đồng bằng văn bản giấy.',
      'Mọi thao tác thực hiện từ tài khoản của Bên thuê (đặt chỗ, thanh toán, ký, hủy) được coi là do Bên thuê thực hiện. Bên thuê có trách nhiệm bảo mật tài khoản và thông báo ngay cho Bên cho thuê khi nghi ngờ tài khoản bị người khác sử dụng.',
      'Sau khi ký, bản hợp đồng (PDF) được gửi tới email của Bên thuê và luôn tải lại được trong tài khoản. Hợp đồng có hiệu lực từ thời điểm Bên thuê ký.',
    ],
  },
  {
    key: 'xac-nhan', title: 'Xác nhận thuê kho và giới hạn trách nhiệm', numbered: true, paragraphs: [],
    bullets: [
      'Bên thuê (Quý khách) xác định sẽ thuê kho sau khi thanh toán tiền giữ chân (tiền cọc) và ký vào hợp đồng này. Việc thuê kho là quyết định tự nguyện, độc lập của Bên thuê.',
      'Bên thuê xác nhận đã được cung cấp đầy đủ thông tin về loại kho, kích thước, hình ảnh giới thiệu, hình thức khoá, giá, các khoản phải thanh toán và điều kiện hủy, hoàn tiền (Điều 4 và Điều 5) trước khi quyết định; đã có điều kiện đến xem kho trực tiếp tại chi nhánh trong giờ mở cửa; và tự chịu trách nhiệm đánh giá kho có phù hợp với nhu cầu của mình hay không.',
      'Nếu phát sinh bất trắc từ phía Bên thuê, hoặc kho không phù hợp với nhu cầu của Bên thuê, Bên cho thuê KHÔNG chịu trách nhiệm đối với mọi hoạt động của Bên thuê cũng như mọi hậu quả, chi phí, thiệt hại phát sinh từ việc Bên thuê tự quyết định thuê, hủy hoặc chấm dứt hợp đồng — bao gồm chi phí vận chuyển, đóng gói, nhân công, lưu kho nơi khác và mọi khoản Bên thuê đã chi cho bên thứ ba.',
      'Trong các trường hợp nêu trên, quyền lợi DUY NHẤT của Bên thuê đối với khoản đã thanh toán khi đặt chỗ là được hoàn tiền theo đúng mức hoàn ghi tại Điều 5 của hợp đồng này (thực hiện tối đa trong 7 ngày làm việc). Bên cho thuê không bồi thường, đền bù hay hỗ trợ thêm bất kỳ khoản nào khác.',
      'Thiệt hại đối với tài sản trong ô kho do lỗi trực tiếp của Bên cho thuê trong thời gian Bên thuê đang thuê kho được xử lý theo Điều 6 của Điều khoản thuê kho (có giới hạn mức bồi thường). Điều này không loại trừ các quyền mà pháp luật bắt buộc dành cho người tiêu dùng.',
      'Điều 5 và Điều này là toàn bộ thoả thuận của hai bên về việc hủy, hoàn tiền và trách nhiệm trong các trường hợp trên. Mọi lời giới thiệu, quảng cáo hay trao đổi bằng lời khác không làm thay đổi nội dung này.',
    ],
  },
  {
    key: 'chung', title: 'Điều khoản chung', numbered: true,
    paragraphs: ['Hai bên thực hiện theo Điều khoản thuê kho (v{{phien_ban_dieu_khoan}}) và chính sách phiên bản v{{phien_ban_chinh_sach}} áp dụng tại thời điểm đặt chỗ.'],
    bullets: [
      'Nếu một điều khoản của hợp đồng bị cơ quan có thẩm quyền tuyên vô hiệu, các điều khoản còn lại vẫn giữ nguyên hiệu lực.',
      'Tranh chấp được giải quyết trước hết bằng thương lượng; không thương lượng được thì giải quyết tại Tòa án có thẩm quyền theo pháp luật Việt Nam.',
    ],
  },
];

export const cloneDefaultClauses = (): ContractTemplateClause[] => DEFAULT_CONTRACT_CLAUSES.map((c) => ({ ...c, paragraphs: [...c.paragraphs], bullets: [...c.bullets] }));

/** Giới hạn độ dài — chặn mẫu phình to làm hỏng PDF / bản lưu lúc ký. */
export const TEMPLATE_LIMITS = { titleMax: 120, lineMax: 2000, linesPerClause: 20 } as const;

const VAR_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;
const ONLY_VAR_RE = /^\{\{\s*([a-z0-9_]+)\s*\}\}$/;
const INFO = new Map(CONTRACT_VARIABLES.map((v) => [v.key, v]));

/** Các biến xuất hiện trong một mẫu. */
export function templateVariables(clauses: readonly ContractTemplateClause[]): Set<string> {
  const used = new Set<string>();
  for (const c of clauses) for (const line of [c.title, ...c.paragraphs, ...c.bullets]) for (const m of line.matchAll(VAR_RE)) used.add(m[1]);
  return used;
}

/**
 * Kiểm tra mẫu trước khi phát hành. Trả về danh sách lỗi (rỗng = hợp lệ). Dùng ở cả trình soạn (báo ngay) và server (chặn).
 * Quy tắc: đủ và đúng thứ tự các điều của mẫu mặc định; không có biến lạ; không thiếu biến bắt buộc; không dòng trống / quá dài.
 */
export function validateContractTemplate(clauses: readonly ContractTemplateClause[]): string[] {
  const errors: string[] = [];
  const expected = DEFAULT_CONTRACT_CLAUSES.map((c) => c.key);
  if (clauses.length !== expected.length || clauses.some((c, i) => c.key !== expected[i])) {
    errors.push('Mẫu phải có đủ các điều của mẫu chuẩn, đúng thứ tự — không thêm, xoá hay đổi chỗ điều khoản.');
    return errors;
  }
  clauses.forEach((c, i) => {
    const base = DEFAULT_CONTRACT_CLAUSES[i];
    const name = c.title.trim() || base.title;
    if (!c.title.trim()) errors.push(`"${base.title}": chưa có tiêu đề.`);
    if (c.title.length > TEMPLATE_LIMITS.titleMax) errors.push(`"${name}": tiêu đề dài quá ${TEMPLATE_LIMITS.titleMax} ký tự.`);
    if (c.numbered !== base.numbered) errors.push(`"${name}": không đổi được cách đánh số điều.`);
    if (c.paragraphs.length + c.bullets.length === 0) errors.push(`"${name}": điều khoản đang trống.`);
    if (c.paragraphs.length > TEMPLATE_LIMITS.linesPerClause || c.bullets.length > TEMPLATE_LIMITS.linesPerClause) errors.push(`"${name}": tối đa ${TEMPLATE_LIMITS.linesPerClause} đoạn và ${TEMPLATE_LIMITS.linesPerClause} gạch đầu dòng.`);
    for (const line of [...c.paragraphs, ...c.bullets]) {
      if (!line.trim()) { errors.push(`"${name}": có dòng trống — hãy xoá hoặc điền nội dung.`); break; }
      if (line.length > TEMPLATE_LIMITS.lineMax) { errors.push(`"${name}": có dòng dài quá ${TEMPLATE_LIMITS.lineMax} ký tự.`); break; }
    }
    // Dấu ngoặc mở mà không thành biến hợp lệ (gõ sai, thiếu ngoặc) sẽ in nguyên ra hợp đồng → báo lỗi.
    for (const line of [c.title, ...c.paragraphs, ...c.bullets]) {
      if (/\{\{|\}\}/.test(line.replace(VAR_RE, ''))) { errors.push(`"${name}": có biến viết sai cú pháp — biến phải có dạng {{ten_bien}}.`); break; }
    }
  });
  const used = templateVariables(clauses);
  for (const k of used) if (!INFO.has(k)) errors.push(`Biến {{${k}}} không tồn tại.`);
  for (const v of CONTRACT_VARIABLES) if (v.required && !used.has(v.key)) errors.push(`Thiếu biến bắt buộc {{${v.key}}} — ${v.label}.`);
  return errors;
}

export interface RenderedClause { title: string; paragraphs: string[]; bullets: string[] }

/** Ghép mẫu với giá trị biến thành các điều khoản hoàn chỉnh. `hideKeys`: bỏ hẳn một số điều (hợp đồng đã ký bản cũ). */
export function renderContractTemplate(clauses: readonly ContractTemplateClause[], vars: ContractVariableValues, hideKeys: readonly string[] = []): RenderedClause[] {
  const fill = (text: string) => text.replace(VAR_RE, (whole, key: string) => {
    if (key in vars.values) return vars.values[key];
    if (key in vars.blocks) return vars.blocks[key].join(' ');
    return whole;
  });
  const expand = (lines: readonly string[]) => lines.flatMap((line) => {
    const only = ONLY_VAR_RE.exec(line.trim());
    if (only && only[1] in vars.blocks) return vars.blocks[only[1]]; // biến khối đứng riêng → mỗi câu một dòng (có thể 0 dòng)
    const out = fill(line).trim();
    return out ? [out] : [];
  });
  let n = 0;
  return clauses.filter((c) => !hideKeys.includes(c.key)).map((c) => ({
    title: c.numbered ? `Điều ${++n}. ${fill(c.title)}` : fill(c.title),
    paragraphs: expand(c.paragraphs),
    bullets: expand(c.bullets),
  }));
}
