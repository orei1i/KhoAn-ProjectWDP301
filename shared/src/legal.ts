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
// 1.8 (19/10/2026): Điều 9 — hẹn trả kho trong vòng 30 ngày, bàn giao trước ngày thu kỳ kế tiếp thì không phát sinh kỳ mới, chưa bàn
//                   giao mà nợ quá ân hạn thì đăng ký tự huỷ; biên bản trả kho có ảnh, hiện trong tài khoản khách, chi phí hư hại lớn
//                   do Quản lý chi nhánh lập, khách khiếu nại trong 7 ngày (khiếu nại đúng thì giảm nợ / hoàn tiền).
// 1.9 (20/10/2026): Điều 6 — mức bồi thường tối đa tính cho mỗi SỰ CỐ (các yêu cầu cùng sự cố cộng chung), theo tiền thuê tháng
//                   trong hợp đồng; Điều 9 — còn nợ thì thanh toán trước khi tự đăng ký trả kho (hoặc làm thủ tục tại quầy); biên bản
//                   kèm ảnh khi có; khiếu nại đúng thì tính lại quyết toán, chỉ hoàn phần khách đã trả thừa.
// 1.10 (20/10/2026): Điều 3 — tiền giữ chân kho thường theo chính sách chi nhánh (mặc định một kỳ), kho cỡ lớn luôn tối thiểu hai kỳ;
//                    Điều 8 — biểu phí đổi ô (lần đầu / lỗi chi nhánh miễn phí), chi nhánh xét yêu cầu trong 7 ngày; Điều 11 — trước khi
//                    khách ký, chi nhánh có thể giao ô khác cùng loại cùng giá; quá ngày nhận mà chưa giao được ô thì huỷ, hoàn 100%.
// 1.11 (20/10/2026): Điều 6 — ghi rõ hạn 30 ngày gửi yêu cầu bồi thường (kể cả khi hợp đồng vừa kết thúc), xác minh trước khi duyệt.
// 1.12 (21/10/2026): Điều 3 — dịch vụ thêm là đơn riêng ngoài hợp đồng thuê; Điều 4 — kiểm tra hàng hoá khi nhận kho; Điều 6 — bỏ cam
//                    kết camera; Điều 11 — ký online cần mã OTP qua email, hoặc ký giấy tại quầy (lưu bản scan).
// 1.13 (25/10/2026): Điều 3 — biên lai cho mỗi khoản đã thu, thu tại quầy bằng chuyển khoản / thẻ ghi mã giao dịch, phí trễ theo biểu
//                    phí (có thể lặp lại theo chu kỳ); Điều 5 — mở kho khi khách vắng mặt: quản lý lập biên bản giấy có người chứng
//                    kiến, chụp ảnh, báo khách qua email / điện thoại trong 24 giờ; Điều 7 — thông báo gửi email khi email đã xác minh,
//                    thông báo cuối phải tới được khách (email hoặc kênh khác có ghi nhận); Điều 9 — bàn giao có chữ ký khách (vắng mặt
//                    thì quản lý xác nhận), nhân viên đăng ký trả kho thay khách phải ghi lý do, đồ để lại giữ 14 ngày rồi xử lý có tính
//                    phí; Điều 10 — mỗi lần gia hạn tối đa theo chính sách, nhắc trước 30 / 7 ngày khi sắp hết hạn, chấm dứt do vi phạm
//                    Điều 4 theo quy trình báo khách → dọn hàng → đồ bỏ lại; Điều 11 — nhận kho muộn vẫn tính từ ngày đã ký, hợp đồng ký
//                    giấy ghi rõ hình thức ký giấy.
// 1.14 (27/10/2026): Điều 11 — khách CHỌN ký online (mã OTP qua email) hoặc ký hợp đồng giấy tại quầy khi đến nhận kho, hai cách có giá
//                    trị như nhau; đã chọn ký giấy vẫn đổi sang ký online được trước khi ký; khách đồng ý lại khi Điều khoản / Chính
//                    sách bảo mật đổi phiên bản (hợp đồng đã ký giữ phiên bản lúc ký).
// 28/10/2026 (KHÔNG tăng phiên bản — làm rõ / có lợi cho khách, tránh bắt mọi khách đồng ý lại trước buổi bảo vệ): Điều 4 — nhập hàng nhiều
//                    đợt, khách khai danh sách đồ, nhân viên kiểm hàng cấm và xác nhận; Điều 6 — bồi thường căn cứ danh sách đồ đã xác nhận
//                    (không vượt giá trị / số lượng đã khai), đồ ngoài danh sách vẫn xét nhưng cần chứng cứ; Điều 10 — gia hạn theo tháng trả
//                    ngay tiền thuê tháng đầu; Điều 11 — "giữ chỗ, trả tại quầy" (giữ ô 24 giờ, tối đa 1 đặt chỗ). Chính sách bảo mật: thêm
//                    nhóm dữ liệu danh sách đồ gửi kho và thời hạn lưu.
// 1.15 (28/10/2026): Điều 1 / Điều 4 — nhân viên chỉ đối chiếu số lượng và tình trạng bên ngoài khi nhập, KhoAn không kiểm định, không định
//                    giá; giá trị do Bên thuê tự khai, là mức trần bồi thường; ghi nhận danh sách không biến hợp đồng thành hợp đồng gửi giữ;
//                    nhân viên không sửa tên / giá trị khách khai, khách nhận email danh sách đã xác nhận; ghi nhận từng món khách lấy ra,
//                    trả khi trả kho, thanh lý; đợt khai mà không mang đến bị huỷ (quá 7 ngày sau ngày hẹn tự huỷ); Điều 6 — chỉ bồi thường
//                    sự cố trong thời gian thuê (không sau ngày trả kho), không quá số còn trong kho tại ngày sự cố (cộng dồn mọi hồ sơ), món
//                    nhập sau ngày sự cố xét như đồ ngoài danh sách; chi tiền mặt bồi thường đối chiếu giấy tờ người nhận.
//                    Cùng bản 1.15 (phần B): Điều 2 — bỏ "không hoàn tiền giữ chân" khi khai sai thông tin (chấm dứt theo Điều 10); Điều 3 —
//                    một tên "tiền giữ chân" (còn gọi là tiền cọc), trả tại quầy trước hạn giữ ô, phần cấn trừ / đang hoàn sau quyết toán,
//                    gói có ưu đãi trả kho sớm hoàn theo bậc + thu lại ưu đãi (nêu ngay khi đặt); Điều 7 — xử lý hàng bỏ lại cấn cả tiền gia
//                    hạn trả trước chưa dùng; Điều 10 — tháng gia hạn trả trước chỉ hoàn khi bàn giao TRƯỚC ngày bắt đầu tháng đó; Điều 11 —
//                    giữ chỗ trả tại quầy tối đa 24 giờ, không quá hết ngày nhận kho; khách đến nhận kho sớm không mất quyền lợi hoàn.
//                    Cùng bản 1.15 (phần C): Điều 3 / Điều 11 — "trả khi nhận kho" (1 kho Locker / S / M, nhận trong 3 ngày, giữ ô đến hết
//                    ngày nhận, ký rồi trả tại quầy, huỷ miễn phí, không đến thì tạm mất lựa chọn 90 ngày, trả online trước thì như đặt chỗ đã
//                    trả); Điều 3 — thuê theo ngày giữ chân tối thiểu 7 ngày tiền thuê, đặt trước tối đa 14 ngày.
//                    Cùng bản 1.15 (phần C3): Điều 8 — đổi cỡ kho (sang loại khác cùng chi nhánh) là sửa đổi hợp đồng qua Phụ lục "Đổi
//                    cỡ kho": giá loại mới từ ngày đổi (cùng chu kỳ, cùng bậc ưu đãi), phần chênh kỳ đã trả tính theo ngày, tiền giữ chân
//                    tính lại theo loại mới, không áp trần hoàn / thu hồi ưu đãi; ràng buộc theo cỡ (L/XL chỉ thuê tháng, dịch vụ thêm từ M).
export const TERMS_VERSION = '1.15';
// Chính sách bảo mật 1.1 (19/10/2026): thêm tài khoản nhận tiền hoàn; gửi yêu cầu quyền dữ liệu ở mục Tài khoản → Dữ liệu cá nhân,
// tự tải bản sao dữ liệu; xoá dữ liệu = ẩn danh hoá hồ sơ (giữ chứng từ tài chính theo luật).
// Chính sách bảo mật 1.2 (19/10/2026): xoá dữ liệu cũng xoá nội dung khách viết trong phiếu hỗ trợ / tư vấn; không xoá khi còn hồ sơ
// bồi thường đang xử lý hoặc khoản KhoAn đang chờ chuyển trả khách; hợp đồng đã ký thuộc ngoại lệ lưu trữ.
// Chính sách bảo mật 1.3 (20/10/2026): tài khoản nhận tiền còn dùng để chi bồi thường và hoàn tiền sau khiếu nại biên bản trả kho;
// chỉ người xác nhận chuyển khoản (quản lý chi nhánh, Quản lý vận hành) xem, và chỉ khi có khoản đang chờ chuyển.
// Chính sách bảo mật 1.4 (20/10/2026): chưa xoá dữ liệu khi còn khiếu nại về thanh toán / biên bản đang xử lý hoặc biên bản trả kho còn trong
// hạn khiếu nại; Quản trị viên không xem giấy tờ, địa chỉ, tài khoản nhận tiền của khách.
// Chính sách bảo mật 1.5 (21/10/2026): bỏ dữ liệu hình ảnh camera; thêm bản scan hợp đồng ký giấy và mã OTP xác nhận ký qua email.
// Chính sách bảo mật 1.6 (25/10/2026): thêm mã xác minh email khi đăng ký tại quầy, chữ ký tay khi bàn giao kho, ảnh đồ để lại / kiểm kê.
// Chính sách bảo mật 1.7 (27/10/2026): bảng thời hạn lưu trữ từng nhóm dữ liệu; xoá dữ liệu thì xoá cả ảnh chữ ký tay (hợp đồng, bàn
// giao) và số tài khoản nhận tiền trên các khoản đã chi xong, bản scan hợp đồng giấy giữ như chứng từ; bản sao dữ liệu kèm biên bản trả
// kho, thông tin bản scan, bàn giao; nhân viên quầy không xem 4 số cuối giấy tờ; căn cứ ghi chung "pháp luật về bảo vệ dữ liệu cá nhân".
// Chính sách bảo mật 1.8 (28/10/2026): danh sách đồ gửi kho — Quản lý vận hành cũng xem (xét bồi thường, giám sát); thêm lịch sử lấy đồ ra /
// trả / thanh lý từng món và thông tin người nhận tiền bồi thường (loại giấy tờ, 4 số cuối đã đối chiếu tại quầy).
export const PRIVACY_VERSION = '1.8';
/** Ngày áp dụng Điều khoản (bản TERMS_VERSION). */
export const TERMS_EFFECTIVE = '28/10/2026';
/** Ngày áp dụng Chính sách bảo mật (bản PRIVACY_VERSION). */
export const LEGAL_EFFECTIVE = '28/10/2026';

/**
 * Tóm tắt thay đổi của bản Điều khoản / Chính sách HIỆN HÀNH — web / app hiện trong hộp thoại "đồng ý lại" khi `user.consentRequired`.
 * Cập nhật cùng lúc với TERMS_VERSION / PRIVACY_VERSION.
 */
export const LEGAL_CHANGE_SUMMARY: readonly string[] = [
  'Nhập hàng: nhân viên chỉ đối chiếu số lượng và tình trạng bên ngoài, không kiểm định, không định giá. Giá trị bạn tự khai là mức trần bồi thường; nhân viên không sửa tên hay giá trị bạn khai, và bạn nhận email danh sách đã xác nhận.',
  'Đồ đang gửi: ghi nhận từng món bạn lấy ra, món trả lại khi trả kho hoặc bị thanh lý. Đợt khai mà không mang đồ đến bị huỷ (tự huỷ sau 7 ngày kể từ ngày hẹn).',
  'Bồi thường: chỉ xét sự cố trong thời gian thuê (không sau ngày trả kho), không quá số đồ còn trong kho tại ngày sự cố (cộng dồn mọi hồ sơ); món nhập sau ngày sự cố được xét như đồ ngoài danh sách. Nhận tiền mặt tại quầy cần xuất trình giấy tờ tùy thân.',
  'Dữ liệu cá nhân: Quản lý vận hành cũng xem danh sách đồ gửi kho (để xét bồi thường, giám sát); lưu thêm lịch sử lấy đồ ra và thông tin người nhận tiền bồi thường.',
  'Đặt kho: "giữ chỗ, trả tại quầy" giữ ô tối đa 24 giờ và không quá hết ngày nhận kho; lịch thanh toán ghi rõ hạn trả tại quầy. Gói có ưu đãi thuê dài hạn nêu ngay lúc đặt mức hoàn tiền giữ chân khi trả kho sớm và việc thu lại ưu đãi.',
  'Đến nhận kho sớm: nếu chi nhánh dời ngày nhận về hôm đó mà bạn không nhận kho, mốc hoàn tiền khi huỷ vẫn theo ngày đã đặt và bạn có thể trả về ngày cũ.',
  'Trả khi nhận kho: đặt 1 tủ locker / phòng S / phòng M nhận trong 3 ngày tới mà chưa trả gì — ô giữ đến hết ngày nhận; đến quầy ký hợp đồng rồi trả tiền giữ chân và tiền thuê kỳ đầu. Huỷ lúc nào cũng miễn phí; không đến nhận kho thì đặt chỗ tự huỷ và tài khoản tạm không chọn được cách này 90 ngày. Trả online trước thì áp quy tắc tiền giữ chân như đặt chỗ thường.',
  'Thuê theo ngày: tiền giữ chân tối thiểu bằng 7 ngày tiền thuê, chỉ đặt trước tối đa 14 ngày. Thuê theo tuần giữ chân một tuần như cũ.',
  'Đổi cỡ kho: đổi sang loại kho khác (lớn hơn hay nhỏ hơn) cùng chi nhánh mà không phải chấm dứt hợp đồng — xác nhận Phụ lục "Đổi cỡ kho"; từ ngày đổi tính giá loại mới cùng bậc ưu đãi, phần chênh kỳ đã trả tính theo ngày, tiền giữ chân tính lại theo loại mới (nộp thêm hoặc được hoàn); không bị giới hạn mức hoàn hay thu lại ưu đãi vì việc đổi cỡ.',
  'Tiền giữ chân sau quyết toán: phần dùng trả nợ / hư hại ghi "Đã cấn trừ", phần hoàn chuyển khoản ghi "Đang hoàn (chờ chuyển)" tới khi chuyển xong. Tháng gia hạn đã trả trước chỉ hoàn khi bàn giao kho trước ngày bắt đầu tháng đó; xử lý hàng bỏ lại cũng tính phần tiền này. Khai sai thông tin không còn kèm "không hoàn tiền giữ chân".',
];

/** Phiên bản khách đã đồng ý gần nhất (lần đồng ý lại / đặt chỗ, không có thì lúc tạo tài khoản). */
export function acceptedLegalVersions(u: {
  consent?: { termsVersion: string; privacyVersion: string } | null; consentLatest?: { termsVersion: string; privacyVersion: string } | null;
}) {
  return u.consentLatest ?? u.consent ?? null;
}

/** Khách phải đồng ý lại: chưa từng đồng ý, hoặc bản đã đồng ý khác bản Điều khoản / Chính sách hiện hành. Nhân sự thì không áp dụng. */
export function consentRequiredFor(u: {
  role: string; consent?: { termsVersion: string; privacyVersion: string } | null; consentLatest?: { termsVersion: string; privacyVersion: string } | null;
}) {
  if (u.role !== 'CUSTOMER') return false;
  const v = acceptedLegalVersions(u);
  return !v || v.termsVersion !== TERMS_VERSION || v.privacyVersion !== PRIVACY_VERSION;
}

/** Số phiên bản client gửi kèm đồng ý có đúng bản hiện hành không — khác thì server từ chối (409 CONSENT_OUTDATED). */
export const isCurrentLegalVersion = (c: { termsVersion: string; privacyVersion: string }) =>
  c.termsVersion === TERMS_VERSION && c.privacyVersion === PRIVACY_VERSION;

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
