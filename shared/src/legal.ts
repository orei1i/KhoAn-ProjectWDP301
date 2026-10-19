/**
 * Số phiên bản Điều khoản và Chính sách bảo mật.
 *
 * Đây là thứ được đóng dấu vào bằng chứng đồng ý của khách (`reservation.consent`, `user.consent`),
 * nên Webapp và app mobile BẮT BUỘC phải gửi cùng một giá trị — hai bên lệch phiên bản thì bằng
 * chứng trỏ tới hai văn bản khác nhau. Vì vậy con số nằm ở đây chứ không nằm riêng mỗi bên.
 *
 * Nội dung đầy đủ của hai văn bản vẫn ở Webapp/src/features/legal/legal-content.ts (chỉ web hiển thị toàn văn).
 * MỖI LẦN SỬA NỘI DUNG LÀ PHẢI TĂNG PHIÊN BẢN, không có ngoại lệ.
 */
// 1.1 (05/10/2026): Điều 3 nêu rõ hai khoản thanh toán trước khi dùng kho (cọc khi đặt chỗ + tiền thuê kỳ đầu khi nhận kho).
// 1.2 (12/10/2026): "tiền cọc" gọi là "tiền giữ chân"; kho cỡ lớn giữ chân ≥ 2 kỳ + trả tiền thuê kỳ đầu lúc đặt chỗ;
//                   Điều 11 mới: ký hợp đồng điện tử, xác nhận thuê kho, hủy/hoàn tiền và giới hạn trách nhiệm; Điều 8: phân công nhân viên chuyển đồ khi đổi ô.
// 1.3 (12/10/2026): Điều 1 và Điều 5 — chi nhánh giữ chìa tổng / thẻ tổng; mở kho hộ theo yêu cầu của khách có xác minh và ghi nhật ký;
//                   báo mất thẻ thì thẻ cũ bị khoá ngay.
// 1.4 (12/10/2026): Điều 5 — đăng ký người được uỷ quyền; Điều 10 — thu hồi ưu đãi thuê dài hạn khi trả kho sớm;
//                   Điều 11 — không đến nhận kho thì đặt chỗ tự hủy.
// 1.5 (13/10/2026): Điều 10 — giới hạn mức hoàn tiền giữ chân khi trả kho sớm chỉ áp cho hợp đồng có ưu đãi thuê dài hạn; mốc tính là ngày thực tế bàn giao kho; thuê theo ngày / tuần trả trọn tiền thuê cả thời hạn khi nhận kho, không hoàn kỳ chưa dùng; gia hạn là cam kết mới (giá niêm yết hiện hành, ưu đãi theo số tháng gia hạn, trả theo tháng); hết hạn không gia hạn thì tính giá chưa ưu đãi.
// 1.6 (14/10/2026): Điều 5 — ô khoá mật khẩu là khoá vật lý, khách tự đổi mật khẩu trên ổ khoá, hệ thống không đặt lại mật khẩu;
//                   gia hạn được lập thành Phụ lục hợp đồng, xác nhận điện tử.
// 1.7 (19/10/2026): Điều 7 — cảnh báo khi hết ân hạn, thông báo khi khoá, bắt buộc THÔNG BÁO CUỐI và chờ đủ số ngày theo chính sách
//                   kể từ thông báo cuối mới được xử lý đồ bỏ lại; tiền giữ chân + tiền thanh lý trừ nợ và chi phí, còn dư trả khách.
export const TERMS_VERSION = '1.7';
// Chính sách bảo mật 1.1 (19/10/2026): thêm tài khoản nhận tiền hoàn; gửi yêu cầu quyền dữ liệu ở mục Tài khoản → Dữ liệu cá nhân,
// tự tải bản sao dữ liệu; xoá dữ liệu = ẩn danh hoá hồ sơ (giữ chứng từ tài chính theo luật).
export const PRIVACY_VERSION = '1.1';
/** Ngày áp dụng Điều khoản (bản TERMS_VERSION). */
export const TERMS_EFFECTIVE = '19/10/2026';
/** Ngày áp dụng Chính sách bảo mật (bản PRIVACY_VERSION). */
export const LEGAL_EFFECTIVE = '19/10/2026';

/**
 * BÊN A (Bên cho thuê) trên mọi hợp đồng và phụ lục — pháp nhân vận hành hệ thống KhoAn.
 *
 * ĐỒ ÁN MÔN HỌC WDP301: pháp nhân, mã số doanh nghiệp, trụ sở dưới đây là GIẢ ĐỊNH (ghi rõ trong văn bản) — không trùng doanh
 * nghiệp có thật. Đưa vào hoạt động thật thì thay bằng thông tin trên Giấy chứng nhận đăng ký doanh nghiệp.
 * Người ký thay Bên A trên từng hợp đồng là Quản lý chi nhánh, theo giấy uỷ quyền của người đại diện theo pháp luật (Điều 138, 141
 * BLDS 2015) — số và ngày giấy uỷ quyền lưu ở tài khoản quản lý (User.authorization), hệ thống tự điền theo chi nhánh.
 */
export const LESSOR = {
  legalName: 'CÔNG TY TNHH KHOAN',
  brand: 'KhoAn',
  taxCode: '0000000000 (giả định — dự án môn học)',
  headOffice: '88 Nguyễn Thị Thập, Quận 7, TP. Hồ Chí Minh (giả định)',
  legalRepresentative: 'Nguyễn Văn A',
  legalRepresentativeTitle: 'Giám đốc',
  phone: '1900 0000',
  email: 'lienhe@khoan.dev',
} as const;
