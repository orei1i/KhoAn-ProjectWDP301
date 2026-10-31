import type { UnitCategory } from './enums';

/**
 * Nội dung trang GIỚI THIỆU KHO — dùng chung web và app để hai bên không lệch nhau. Khách xem hình ảnh, kích thước,
 * tiện ích và quy trình TRƯỚC khi đặt kho.
 *
 * Hình là tranh minh hoạ isometric tự vẽ (cùng một phong cách cho cả bộ), không phải ảnh chụp chi nhánh — mỗi nơi
 * hiển thị bộ cảnh phải kèm dòng `PHOTO_CREDIT`. File: Webapp/public/images/kho/<key>.svg (cảnh), o-kho/<loại>.svg
 * (cut-away từng cỡ kho), do/<id>.svg (icon đồ vật của bảng ước tính); app dùng bản PNG ở Mobile/React-Native/assets/kho
 * và assets/o-kho (require tĩnh).
 */
export type FacilityPhotoKey = 'kho-drive-up' | 'mat-tien-cua-cuon' | 'hanh-lang-kho' | 'cua-o-kho' | 'ben-trong-kho' | 'tu-locker';

export const FACILITY_PHOTOS: readonly { key: FacilityPhotoKey; caption: string }[] = [
  { key: 'mat-tien-cua-cuon', caption: 'Hành lang trong nhà, mỗi ô một cửa cuốn riêng' },
  { key: 'kho-drive-up', caption: 'Dãy kho tầng trệt — xe lùi sát cửa để bốc dỡ' },
  { key: 'hanh-lang-kho', caption: 'Ô kho đang sử dụng — xếp thùng gọn theo chiều cao' },
  { key: 'cua-o-kho', caption: 'Mỗi ô có khoá riêng, chỉ người thuê mở được' },
  { key: 'ben-trong-kho', caption: 'Lối đi rộng, sáng, dễ đẩy xe hàng' },
  { key: 'tu-locker', caption: 'Tủ locker cho đồ cá nhân, mở bằng mật khẩu' },
];

export const PHOTO_CREDIT = 'Ảnh minh hoạ — không phải ảnh chụp chi nhánh.';

/** "Cỡ này vừa với gì" — giúp khách chọn đúng cỡ kho trước khi đặt. */
export const UNIT_CATEGORY_GUIDE: Record<UnitCategory, { photo: FacilityPhotoKey; fits: string; examples: string[] }> = {
  LOCKER: { photo: 'tu-locker', fits: 'Đồ cá nhân, gọn như một ngăn tủ', examples: ['1–2 vali', 'Hồ sơ, sách vở', 'Balo, đồ dùng học tập'] },
  SMALL: { photo: 'cua-o-kho', fits: 'Đồ đạc của một phòng ngủ nhỏ', examples: ['20–30 thùng carton', 'Nệm, tủ nhỏ, bàn học', 'Xe đạp, đồ theo mùa'] },
  MEDIUM: { photo: 'hanh-lang-kho', fits: 'Căn hộ 1–2 phòng ngủ hoặc hàng shop online', examples: ['Sofa, giường, tủ lạnh', '60–80 thùng hàng', 'Kệ hàng tồn kho'] },
  LARGE: { photo: 'mat-tien-cua-cuon', fits: 'Nội thất cả căn nhà 3 phòng ngủ', examples: ['Trọn bộ nội thất gia đình', 'Kho hàng doanh nghiệp nhỏ', 'Thiết bị, máy móc vừa'] },
  XL: { photo: 'kho-drive-up', fits: 'Hàng cồng kềnh, cần xe tải lùi sát cửa', examples: ['Pallet hàng, vật liệu', 'Nội thất văn phòng', 'Hàng dự án, hàng sự kiện'] },
};

export type IntroIcon = 'key' | 'snow' | 'contract' | 'calendar' | 'swap';

/** Chỉ nêu những gì hệ thống thật sự có — không hứa bảo hiểm hay ra vào 24/7 (giờ ra vào lấy theo chi nhánh). */
export const INTRO_HIGHLIGHTS: readonly { icon: IntroIcon; title: string; text: string }[] = [
  { icon: 'key', title: 'Khoá riêng từng ô', text: 'Chọn ô mở bằng ổ khoá mật khẩu (tự đặt, tự đổi mật khẩu trên ổ khoá), thẻ từ hoặc chìa khoá. Mất thẻ, mất chìa thì xin cấp lại ngay trong tài khoản.' },
  { icon: 'snow', title: 'Điều hòa tuỳ chọn', text: 'Ô kho có sẵn máy lạnh; bật thì tính phụ phí điều hòa, tắt thì không mất phí.' },
  { icon: 'contract', title: 'Đặt và ký hợp đồng online', text: 'Xem giá, chọn đúng ô trên sơ đồ, thanh toán và ký hợp đồng điện tử — không cần đến quầy trước.' },
  { icon: 'calendar', title: 'Trả tiền theo từng kỳ', text: 'Thuê theo ngày, tuần hoặc tháng; thuê dài hạn được giảm giá. Không phải trả trước cả thời hạn.' },
  { icon: 'swap', title: 'Đổi ô, đổi cỡ khi cần', text: 'Đổi sang ô khác cùng loại, hoặc đổi cỡ kho lớn hơn / nhỏ hơn mà không cần làm hợp đồng mới — tự chuyển hoặc nhờ nhân viên chi nhánh chuyển giúp.' },
];

export const INTRO_STEPS: readonly { title: string; text: string }[] = [
  { title: 'Xem kho và chọn ô', text: 'Xem hình ảnh, kích thước, giá; chọn một hoặc nhiều ô còn trống ngay trên sơ đồ.' },
  { title: 'Thanh toán tiền giữ chân', text: 'Kho thường: giữ chân bằng 1 kỳ tiền thuê (thuê theo ngày: tối thiểu 7 ngày). Kho cỡ lớn (L, XL): giữ chân 2 kỳ và trả luôn tiền thuê kỳ đầu. Đặt 1 kho nhỏ nhận trong 3 ngày có thể chọn trả khi nhận kho.' },
  { title: 'Ký hợp đồng online', text: 'Đọc hợp đồng rồi ký bằng chữ ký vẽ tay hoặc gõ họ tên; bản PDF được gửi về email.' },
  { title: 'Đến quầy nhận kho', text: 'Đưa mã QR cho nhân viên vào ngày nhận. Kho thường trả tiền thuê kỳ đầu tại quầy; kho cỡ lớn không phải trả thêm.' },
  { title: 'Dùng kho, trả tiền từng kỳ', text: 'Ra vào trong giờ của chi nhánh. Gia hạn, đổi ô, đặt dịch vụ thêm hoặc trả kho ngay trong tài khoản.' },
];

export const INTRO_FAQ: readonly { q: string; a: string }[] = [
  { q: 'Tôi có được xem kho trước khi đặt không?', a: 'Có. Bạn có thể đến chi nhánh trong giờ mở cửa để xem trực tiếp loại kho mình quan tâm trước khi đặt. Hình ảnh trên trang này là ảnh minh hoạ.' },
  { q: 'Tiền giữ chân là gì, khi nào được hoàn?', a: 'Là khoản trả khi đặt chỗ để giữ ô kho bạn chọn. Khoản này được giữ đến khi trả kho, không trừ vào tiền thuê, và hoàn lại sau khi trừ công nợ hay chi phí hư hại nếu có — phần đã dùng để trừ được ghi là "đã cấn trừ".' },
  { q: 'Trả kho sớm thì có mất tiền giữ chân không?', a: 'Gói không có ưu đãi thuê dài hạn: hoàn đủ tiền giữ chân (sau khi trừ công nợ, hư hại). Gói có ưu đãi thuê dài hạn: tiền giữ chân được hoàn theo bậc thời gian đã dùng và phần ưu đãi đã hưởng vượt mức bị thu lại — các bậc hiện ngay trên lịch thanh toán khi bạn đặt và ghi trong hợp đồng.' },
  { q: 'Có thể đặt trước, trả tiền khi đến nhận kho không?', a: 'Có — chọn "Trả khi nhận kho" khi đặt 1 tủ locker / phòng S / phòng M nhận trong 3 ngày tới (tài khoản đã xác minh email và khai CCCD). Hôm nay chưa trả gì; ô được giữ đến hết ngày nhận. Đến quầy mang CCCD: ký hợp đồng, trả tiền giữ chân + tiền thuê kỳ đầu rồi nhận kho. Huỷ lúc nào cũng miễn phí; không đến nhận kho thì đặt chỗ tự huỷ và tài khoản tạm không chọn được cách này 90 ngày.' },
  { q: 'Thuê theo ngày cần lưu ý gì?', a: 'Tiền giữ chân tối thiểu bằng 7 ngày tiền thuê (hoàn khi trả kho như mọi gói) và chỉ đặt trước tối đa 14 ngày. Tiền thuê cả thời hạn trả một lần khi nhận kho.' },
  { q: 'Hủy đặt chỗ thì được hoàn bao nhiêu?', a: 'Theo chính sách của chi nhánh, mặc định: hủy trước ngày nhận kho từ 72 giờ trở lên hoàn 100%, từ 24 đến dưới 72 giờ hoàn 50%, dưới 24 giờ hoặc không đến nhận kho thì không hoàn. Mức cụ thể ghi rõ trong hợp đồng của bạn.' },
  { q: 'Phụ phí điều hòa là gì?', a: 'Là chi phí điện và vận hành máy lạnh trong ô kho, tính theo phần trăm giá thuê mỗi kỳ. Chỉ tính khi bạn chọn sử dụng điều hòa; không chọn thì không mất phí này.' },
  { q: 'Những gì không được gửi trong kho?', a: 'Chất dễ cháy nổ, hoá chất độc hại, hàng cấm, hàng không rõ nguồn gốc, thực phẩm tươi sống, động vật sống và tiền mặt, vàng bạc, giấy tờ gốc có giá trị cao.' },
  { q: 'Tôi muốn đổi sang ô khác thì sao?', a: 'Gửi yêu cầu đổi ô trong tài khoản — cùng loại thì giá giữ nguyên; muốn kho lớn hơn / nhỏ hơn thì chọn loại khác (đổi cỡ kho): xem giá mới, phần chênh và tiền giữ chân mới rồi xác nhận phụ lục, không phải làm hợp đồng mới. Bạn có thể tự chuyển trong 7 ngày sau khi được duyệt, hoặc thuê người chuyển — quản lý chi nhánh sẽ phân công nhân viên và hẹn ngày. Chuyển xong bạn nhận phương tiện mở MỚI của ô mới (mật khẩu mới trong tài khoản, hoặc chìa / thẻ mới) và trả lại chìa / thẻ ô cũ.' },
  { q: 'Tôi không muốn kê khai chi tiết đồ gửi được không?', a: 'Được — chọn "gửi kín" khi khai đợt nhập: chỉ ghi số kiện, loại kiện, có niêm phong không và tổng giá trị (nếu muốn). Nhân viên không mở kiện, chỉ kiểm tra bên ngoài; bạn ký bản cam kết không gửi hàng cấm bằng giấy tại quầy. Bồi thường tính theo kiện (tổng giá trị khai chia số kiện), chỉ khi kiện bị mất hoặc hư hại bên ngoài do lỗi kho; kiện còn nguyên niêm phong thì không nhận khiếu nại thiếu đồ bên trong.' },
];
