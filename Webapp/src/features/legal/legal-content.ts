/**
 * Nội dung Điều khoản thuê kho và Chính sách bảo mật, kèm số phiên bản.
 *
 * Phiên bản là thứ được lưu vào bằng chứng đồng ý của khách (`reservation.consent`).
 * Sửa nội dung mà không tăng phiên bản = bằng chứng cũ trỏ tới văn bản đã khác → vô giá trị.
 * Vậy nên: MỖI LẦN SỬA NỘI DUNG LÀ PHẢI TĂNG PHIÊN BẢN, không có ngoại lệ.
 */

// Số phiên bản nằm ở @ssm/shared để app mobile gửi đúng cùng giá trị khi lấy chấp thuận của khách.
export { TERMS_VERSION, TERMS_EFFECTIVE, PRIVACY_VERSION, LEGAL_EFFECTIVE } from '@ssm/shared';

export interface LegalSection { heading: string; body: string[]; table?: { head: string[]; rows: string[][] } }

export const TERMS: LegalSection[] = [
  {
    heading: 'Điều 1. Bản chất dịch vụ',
    body: [
      'KhoAn cho thuê không gian lưu trữ tự quản. Đây là hợp đồng thuê không gian, không phải hợp đồng gửi giữ tài sản.',
      'KhoAn không kiểm đếm, không định giá và không quản lý tài sản bên trong ô kho. Khách hàng tự khóa, tự quản lý và tự chịu rủi ro đối với tài sản của mình.',
      'Mỗi chi nhánh giữ chìa khóa tổng (cho ô khóa bằng chìa) và thẻ tổng (cho ô khóa bằng thẻ từ), chỉ dùng trong các trường hợp nêu tại Điều 5. Ô khóa bằng mật khẩu dùng ổ khóa số vật lý: khách hàng tự đặt và tự đổi mật khẩu ngay trên ổ khóa, KhoAn không biết và không lưu mật khẩu khách hàng đã đổi (hệ thống chỉ hiển thị cho khách hàng mật khẩu ban đầu lúc bàn giao).',
      'Khách hàng cam kết là chủ sở hữu hợp pháp hoặc được chủ sở hữu ủy quyền đối với toàn bộ tài sản gửi vào.',
    ],
  },
  {
    heading: 'Điều 2. Điều kiện khách hàng',
    body: [
      'Từ đủ 18 tuổi, có năng lực hành vi dân sự đầy đủ.',
      'Cung cấp thông tin định danh chính xác: họ tên, số điện thoại, email, giấy tờ tùy thân.',
      'Thông tin sai lệch là căn cứ để KhoAn đơn phương chấm dứt hợp đồng và không hoàn tiền giữ chân.',
    ],
  },
  {
    heading: 'Điều 3. Thời hạn, giá và thanh toán',
    body: [
      'Thời hạn thuê tối thiểu và tối đa theo chính sách đang áp dụng tại thời điểm ký.',
      'Giá thuê và toàn bộ điều khoản được chốt tại thời điểm xác nhận hợp đồng. KhoAn điều chỉnh bảng giá không làm thay đổi hợp đồng đang có hiệu lực.',
      'Trước khi sử dụng kho, khách hàng thanh toán hai khoản riêng biệt: (1) tiền giữ chân (còn gọi là tiền cọc), trả khi đặt chỗ để giữ ô kho đã chọn; (2) tiền thuê kỳ đầu. Số tiền từng khoản được hiển thị trên màn hình đặt chỗ và ghi trong hợp đồng; khách hàng xác nhận đã đọc trước khi giữ chỗ. Các kỳ sau thanh toán theo từng kỳ vào đầu mỗi kỳ.',
      'Kho thường (tủ locker, phòng S, phòng M): tiền giữ chân theo chính sách của chi nhánh, mặc định bằng một kỳ tiền thuê; tiền thuê kỳ đầu trả thêm tại quầy khi nhận kho.',
      'Kho cỡ lớn (phòng L, phòng XL): tiền giữ chân tối thiểu bằng hai kỳ tiền thuê, và tiền thuê kỳ đầu thanh toán cùng lúc đặt chỗ; khi nhận kho không phải trả thêm tiền thuê kỳ đầu.',
      'Phụ phí (nếu có) luôn được ghi rõ tên, cách tính và lý do trên báo giá và trong hợp đồng. Hiện chỉ có phụ phí điều hòa nhiệt độ: chi phí điện và vận hành máy lạnh, chỉ tính khi khách hàng chọn sử dụng điều hòa.',
      'Tiền giữ chân được giữ đến khi trả kho, không trừ vào tiền thuê, và được hoàn khi trả kho sau khi trừ dư nợ và chi phí khắc phục hư hỏng nếu có.',
      'Thanh toán chậm phát sinh phí trễ hạn theo biểu phí trong chính sách khách hàng đã ký: phí tính khi quá hạn quá số ngày quy định và có thể lặp lại theo chu kỳ ghi trong chính sách nếu vẫn còn nợ; phí khoá thu khi khoá quyền ra vào (Điều 7).',
      'Mỗi khoản đã thanh toán có biên lai tải được trong tài khoản (hoặc in tại quầy). Thanh toán tại quầy bằng chuyển khoản, thẻ hoặc ví điện tử được ghi mã giao dịch; mọi khoản thu tại quầy ghi tên nhân viên thu. Biên lai không thay thế hoá đơn GTGT.',
      'Dịch vụ thêm (mua thùng, vận chuyển…) là đơn riêng, không thuộc hợp đồng thuê kho. Chọn kèm khi đặt kho thì thanh toán khi nhận kho; huỷ đặt chỗ thì đơn dịch vụ tự huỷ. Dịch vụ chưa thực hiện được huỷ và hoàn đủ tiền.',
    ],
  },
  {
    heading: 'Điều 4. Hàng hóa bị cấm lưu trữ',
    body: [
      'Mỗi lần mang đồ vào kho là một đợt nhập hàng: khách hàng khai danh sách đồ (tên, số lượng, giá trị ước tính, tình trạng) trong tài khoản, hoặc nhờ nhân viên khai thay tại quầy; nhân viên kiểm tra hàng hoá theo danh mục dưới đây và xác nhận danh sách thực tế. Có hàng thuộc danh mục cấm thì KhoAn từ chối nhận đợt hàng đó.',
      'Danh sách đồ đã được nhân viên xác nhận là "đồ đang gửi" của hợp đồng, hiển thị trong tài khoản của khách hàng và là căn cứ khi xét bồi thường (Điều 6). Giá trị khách hàng tự khai chỉ là ước tính, KhoAn không định giá và không kiểm đếm bên trong bao bì.',
      'Vi phạm điều này, KhoAn được quyền chấm dứt hợp đồng theo Điều 10, thông báo cơ quan chức năng khi cần, và khách hàng chịu toàn bộ chi phí xử lý.',
    ],
    table: {
      head: ['Nhóm', 'Ví dụ'],
      rows: [
        ['Vi phạm pháp luật', 'Ma túy, vũ khí, hàng cấm, hàng giả, hàng không rõ nguồn gốc'],
        ['Nguy hiểm', 'Chất dễ cháy nổ, hóa chất độc hại, khí nén, pin lithium hỏng, vật liệu phóng xạ'],
        ['Sinh vật', 'Người, động vật sống, cây trồng'],
        ['Dễ phân hủy', 'Thực phẩm tươi sống, rác thải, chất thải y tế'],
        ['Giá trị cao không khai báo', 'Tiền mặt, kim loại quý, đá quý, chứng khoán, bản gốc giấy tờ pháp lý'],
      ],
    },
  },
  {
    heading: 'Điều 5. Quyền ra vào',
    body: [
      'Khách hàng ra vào trong giờ quy định của chi nhánh, bằng phương thức được cấp: chìa khóa, mã PIN hoặc thẻ từ.',
      'Không chuyển giao phương thức truy cập cho người thứ ba khi chưa đăng ký với KhoAn. Khách hàng đăng ký người được ủy quyền (tối đa 3 người: họ tên, số điện thoại, 4 số cuối giấy tờ tùy thân) ngay trong tài khoản; nhân viên đối chiếu thông tin này khi người được ủy quyền đến chi nhánh. Khách hàng chịu trách nhiệm về mọi việc người được ủy quyền thực hiện tại ô kho, và có thể xóa ủy quyền bất cứ lúc nào.',
      'Mất chìa hoặc mất thẻ: khách hàng gửi yêu cầu cấp lại trong tài khoản; quản lý chi nhánh xác nhận, phí cấp lại (nếu có) theo chính sách. Khi khách hàng báo mất thẻ, thẻ cũ bị vô hiệu ngay.',
      'Mật khẩu ổ khóa do khách hàng tự quản lý và tự đổi trên ổ khóa; KhoAn không đặt lại mật khẩu từ xa. Quên mật khẩu: khách hàng (hoặc người được ủy quyền đã đăng ký) đến chi nhánh, nhân viên xác minh danh tính rồi mở và đặt lại ổ khóa để khách hàng tự đặt mật khẩu mới; việc mở hộ được ghi nhật ký.',
      'Cần mở kho gấp khi chưa kịp cấp lại: khách hàng đến quầy trong giờ hoạt động và yêu cầu mở hộ. Nhân viên xác minh danh tính (tài khoản của khách hàng và giấy tờ tùy thân), mở bằng chìa tổng hoặc thẻ tổng với sự có mặt của khách hàng và không vào bên trong ô kho. Mỗi lần mở hộ được ghi vào nhật ký hệ thống (người mở, thời điểm, lý do) và khách hàng xem được trong tài khoản.',
      'KhoAn được quyền mở ô kho mà không cần sự có mặt của khách hàng trong các trường hợp: (a) tình huống khẩn cấp như cháy, ngập, rò rỉ; (b) có căn cứ hợp lý cho rằng bên trong chứa hàng hóa bị cấm tại Điều 4; (c) có yêu cầu bằng văn bản hoặc quyết định của cơ quan nhà nước có thẩm quyền; (d) khách hàng quá hạn thanh toán vượt ngưỡng tại Điều 7.',
      'Trường hợp (a), (b), (c): quản lý chi nhánh trực tiếp mở kho, lập biên bản giấy có ít nhất một người chứng kiến ký tên và chụp ảnh hiện trạng trước, sau khi mở; chi nhánh báo cho khách hàng qua email hoặc điện thoại trong vòng 24 giờ, trừ trường hợp cơ quan chức năng yêu cầu giữ bí mật điều tra. Biên bản được lưu tại chi nhánh, khách hàng được xem khi yêu cầu. Trường hợp (d) thực hiện theo đúng các bước tại Điều 7.',
    ],
  },
  {
    heading: 'Điều 6. Trách nhiệm và giới hạn trách nhiệm',
    body: [
      'KhoAn bảo đảm: kết cấu kho an toàn, hệ thống khóa hoạt động, kiểm soát ra vào.',
      'KhoAn không chịu trách nhiệm đối với: hư hỏng do tính chất tự nhiên của tài sản (ẩm mốc, gỉ sét, côn trùng, hao mòn); thiệt hại do khách hàng đóng gói hoặc sắp xếp không đúng cách; sự kiện bất khả kháng; tài sản thuộc nhóm giá trị cao không khai báo tại Điều 4.',
      'Giới hạn bồi thường: trường hợp KhoAn có lỗi trực tiếp, mức bồi thường tối đa cho mỗi sự cố là mười (10) lần tiền thuê một tháng của ô kho đó theo hợp đồng, hoặc giá trị thiệt hại thực tế được chứng minh — lấy giá trị nhỏ hơn. Các yêu cầu về cùng một sự cố được cộng chung.',
      'Tài sản có giá trị vượt mức trên, khách hàng nên tự mua bảo hiểm. KhoAn không bán và không làm đại lý bảo hiểm.',
      'Yêu cầu bồi thường gửi trong vòng 30 ngày kể từ ngày xảy ra hoặc phát hiện sự cố — kể cả khi hợp đồng đã kết thúc không quá 30 ngày — kèm mô tả sự việc và danh mục tài sản thiệt hại. KhoAn xác minh trước khi quyết định số tiền bồi thường; khoản lớn do Quản lý vận hành duyệt.',
      'Tài sản thiệt hại chọn từ danh sách đồ đang gửi (Điều 4): giá trị yêu cầu không vượt giá trị đã khai khi nhập kho và số lượng không vượt số đã nhập. Đồ không có trong danh sách vẫn được xét nhưng khách hàng cần cung cấp chứng cứ (ảnh, hoá đơn…) về việc đã gửi đồ vào kho và giá trị của đồ.',
    ],
  },
  {
    heading: 'Điều 7. Trễ hạn và xử lý',
    body: [
      'Số ngày ân hạn, số ngày quá hạn thì khoá và số ngày chờ sau thông báo cuối theo chính sách áp dụng lúc đặt chỗ và được ghi cụ thể trong hợp đồng của từng khách hàng (mặc định hiện hành: 5 ngày, 15 ngày và 30 ngày).',
      'Mọi thông báo dưới đây hiển thị trong tài khoản của khách hàng và được gửi qua email khi email của khách hàng đã được xác minh (khách hàng tự đăng ký tài khoản, hoặc nhập mã xác minh KhoAn gửi tới email khi đăng ký tại quầy); KhoAn có thể gọi điện hoặc gửi thư kèm theo. Khách hàng có trách nhiệm giữ email liên lạc đúng và thường xuyên kiểm tra tài khoản.',
      'Thông báo cuối phải TỚI được khách hàng: nếu email không gửi được, chi nhánh báo cho khách hàng qua điện thoại, thư bảo đảm hoặc trực tiếp và ghi nhận kênh, thời điểm báo trên hệ thống; chưa báo được thì chưa được xử lý đồ.',
      'Khách hàng lấy lại quyền ra vào bất cứ lúc nào trước khi thanh lý bằng cách thanh toán toàn bộ dư nợ.',
      'KhoAn chỉ được mở kho, kiểm kê và thanh lý khi thông báo cuối ĐÃ tới khách hàng và đã qua đủ số ngày chờ kể từ thông báo cuối. Việc kiểm kê được lập biên bản kèm ảnh chụp và ghi nhật ký hệ thống; tiền thanh lý hoặc chi phí xử lý trên 5.000.000 ₫ do Quản lý vận hành lập.',
      'Tiền giữ chân và số tiền thu được từ thanh lý dùng để trừ công nợ và chi phí kiểm kê, vận chuyển, thanh lý; phần còn dư được hoàn trả cho khách hàng, phần còn thiếu khách hàng vẫn có nghĩa vụ thanh toán.',
    ],
    table: {
      head: ['Mốc', 'Xử lý'],
      rows: [
        ['Đến hạn mà chưa thanh toán', 'Trong thời gian ân hạn: chưa tính phí trễ'],
        ['Hết thời gian ân hạn', 'Tính phí trễ hạn theo chính sách; gửi cảnh báo kèm ngày sẽ bị khoá nếu chưa thanh toán'],
        ['Quá hạn vượt ngưỡng khoá kho', 'Khoá quyền ra vào, tài sản vẫn được giữ nguyên; gửi thông báo khoá'],
        ['Sau khi khoá mà vẫn chưa thanh toán', 'KhoAn gửi THÔNG BÁO CUỐI nêu rõ dư nợ và hạn chót'],
        ['Hết số ngày chờ kể từ thông báo cuối', 'KhoAn được quyền mở kho, kiểm kê và thanh lý tài sản để bù đắp công nợ; gửi thông báo kết quả quyết toán'],
      ],
    },
  },
  {
    heading: 'Điều 8. Đổi ô kho',
    body: [
      'Khách hàng được đổi sang ô kho khác cùng loại, cùng diện tích, khi chi nhánh còn ô trống.',
      'Khách hàng tự chuyển đồ, hoặc thuê người chuyển: khi đó quản lý chi nhánh phân công một nhân viên của chi nhánh và hẹn ngày chuyển; tên nhân viên và ngày chuyển hiển thị trong tài khoản của khách hàng.',
      'Đổi sang loại kho khác diện tích không phải là đổi ô — đây là chấm dứt hợp đồng cũ và ký hợp đồng mới theo bảng giá hiện hành.',
      'Giá thuê giữ nguyên theo hợp đồng gốc, không tính lại theo bảng giá tại thời điểm đổi.',
      'Phí đổi ô: lần đổi đầu tiên của mỗi hợp đồng, hoặc đổi do lỗi từ chi nhánh (ô hư hỏng, mất an ninh…), được miễn phí. Từ lần thứ hai: phí thao tác 150.000 ₫, thuê người chuyển cộng thêm 300.000 ₫; quản lý chi nhánh có thể điều chỉnh nhưng không quá 1.000.000 ₫. Phí hiển thị khi yêu cầu được duyệt và cộng vào khoản phải thanh toán.',
      'Chi nhánh xét yêu cầu đổi ô trong 7 ngày; quá hạn chưa xét thì yêu cầu tự hết hạn, ô đang giữ cho yêu cầu được nhả và khách hàng có thể gửi lại.',
    ],
  },
  {
    heading: 'Điều 9. Trả kho',
    body: [
      'Khách hàng tự đăng ký ngày hẹn trả kho trên hệ thống khi không còn khoản nợ, trong vòng 30 ngày tới; đang còn nợ thì thanh toán trước, hoặc đến chi nhánh để nhân viên làm thủ tục trả kho. Nhân viên đăng ký trả kho thay khách hàng (theo yêu cầu tại quầy / qua điện thoại) phải ghi lý do, và hệ thống báo cho khách hàng qua email; khách hàng không yêu cầu thì rút đăng ký trong tài khoản hoặc báo chi nhánh. Tiền thuê được tính đến ngày bàn giao thực tế; bàn giao trước ngày thu tiền kỳ kế tiếp thì không phát sinh kỳ mới.',
      'Khi bàn giao lại kho, khách hàng ký xác nhận trên màn hình của nhân viên. Khách hàng vắng mặt (đã gửi lại chìa, bỏ đi không quay lại…) thì chỉ quản lý chi nhánh được xác nhận nhận lại kho và phải ghi lý do.',
      'Đã đăng ký trả kho mà chưa bàn giao, nếu để quá hạn thanh toán quá thời gian ân hạn thì đăng ký trả kho tự huỷ và hợp đồng được xử lý như nợ quá hạn theo Điều 7.',
      'Ô kho phải được dọn sạch, không để lại rác hoặc tài sản.',
      'Khi nhận lại kho, KhoAn lập biên bản kiểm tra ghi hiện trạng từng hạng mục và chi phí hư hại, kèm ảnh chụp khi có. Chi phí hư hại trên 2.000.000 ₫ do Quản lý chi nhánh lập. Biên bản hiển thị trong tài khoản của khách hàng ngay khi lập.',
      'Khách hàng có 7 ngày kể từ ngày lập biên bản để khiếu nại (trong tài khoản hoặc tại chi nhánh). Khiếu nại đúng thì KhoAn tính lại quyết toán với chi phí hư hại đã giảm: trừ vào khoản còn nợ trước, phần khách đã trả thừa được hoàn bằng chuyển khoản.',
      'Tiền giữ chân được quyết toán trong vòng 7 ngày làm việc kể từ ngày lập biên bản.',
      'Đồ khách hàng còn để lại trong ô được ghi vào biên bản trả kho (mô tả, ảnh chụp) và chi nhánh giữ 14 ngày kể từ ngày lập biên bản; hệ thống báo cho khách hàng qua email. Khách hàng đến nhận lại trong thời gian này. Quá 14 ngày, số đồ đó được coi là khách hàng từ bỏ quyền sở hữu: quản lý chi nhánh xử lý và tính chi phí xử lý cho khách hàng (cộng vào khoản còn nợ sau quyết toán).',
    ],
  },
  {
    heading: 'Điều 10. Chấm dứt hợp đồng',
    body: [
      'Khách hàng chấm dứt trước hạn: hợp đồng được giảm giá vì cam kết thuê dài hạn thì hoàn tiền giữ chân theo bậc thời gian trong chính sách (càng gần hết hạn càng được hoàn nhiều); hợp đồng không có ưu đãi đó thì hoàn đủ tiền giữ chân sau khi trừ hư hại và công nợ. Mốc tính là ngày thực tế bàn giao kho. Tiền thuê đã thanh toán cho kỳ đang sử dụng không được hoàn; tiền thuê trả trước khi gia hạn (thuê theo tháng) cho các tháng chưa bắt đầu tại ngày bàn giao kho được hoàn lại sau khi cấn trừ hư hại và công nợ.',
      'Gia hạn hợp đồng là một cam kết thời hạn mới: giá thuê là giá niêm yết tại thời điểm gia hạn, ưu đãi thuê dài hạn tính theo số tháng gia hạn (không cộng dồn thời gian đã thuê), mỗi lần gia hạn tối đa theo số kỳ tối đa của chính sách, khách hàng thanh toán ngay tiền thuê tháng đầu của thời gian gia hạn khi xác nhận gia hạn (các tháng sau trả theo từng tháng như hợp đồng) và tiền giữ chân giữ nguyên. KhoAn nhắc khách hàng trước 30 ngày và 7 ngày khi hợp đồng sắp hết hạn (trong tài khoản và qua email). Hết hạn mà không gia hạn, khách hàng vẫn được tiếp tục thuê nhưng tiền thuê tính theo giá chưa trừ ưu đãi thuê dài hạn; KhoAn không tự động gia hạn cam kết thay khách hàng.',
      'Thuê theo ngày hoặc theo tuần: tiền thuê của cả thời hạn được thanh toán trọn một lần khi nhận kho; trả kho trước hạn không hoàn tiền các ngày / tuần chưa dùng. Quá thời hạn đã đặt mà chưa trả kho thì tiền thuê tiếp tục được tính theo từng kỳ.',
      'Ưu đãi thuê dài hạn được áp dụng vì khách hàng cam kết thuê đủ thời hạn. Trả kho trước khi dùng đủ thời hạn đó, khách hàng chỉ được hưởng mức ưu đãi tương ứng với số tháng thực dùng; phần ưu đãi đã hưởng vượt mức bị thu hồi và trừ vào tiền giữ chân khi quyết toán. Cách tính ghi rõ trong hợp đồng.',
      'KhoAn được chấm dứt hợp đồng nếu khách hàng vi phạm Điều 4 hoặc cung cấp thông tin gian dối: chi nhánh báo cho khách hàng (email, điện thoại hoặc trực tiếp) lý do chấm dứt và yêu cầu dọn hàng ra khỏi ô trong thời hạn ghi trong thông báo; quá thời hạn mà khách hàng không dọn thì đồ trong ô được xử lý theo quy trình đồ bỏ lại (lập biên bản, chụp ảnh, giữ và xử lý có tính chi phí như Điều 9). Hàng hóa nguy hiểm hoặc vi phạm pháp luật được xử lý theo yêu cầu của cơ quan chức năng.',
    ],
  },
  {
    heading: 'Điều 11. Xác nhận thuê kho, hủy đặt chỗ và giới hạn trách nhiệm',
    body: [
      'Sau khi thanh toán tiền giữ chân, khách hàng CHỌN một trong hai cách ký hợp đồng thuê kho, có giá trị như nhau: (a) ký trực tuyến trên hệ thống KhoAn — ký bằng chữ ký vẽ tay hoặc gõ họ tên trên tài khoản đã đăng nhập của chính mình, sau khi nhập mã xác nhận (OTP) KhoAn gửi tới email của khách hàng; hoặc (b) ký hợp đồng giấy tại quầy khi đến nhận kho (mang theo giấy tờ tùy thân bản gốc) — hợp đồng in ra ghi rõ hình thức ký giấy, khách hàng nhận một bản giấy, nhân viên lưu bản scan hợp đồng đã ký lên hệ thống và khách hàng tải lại được trong tài khoản. Khách hàng đã chọn ký giấy vẫn có thể đổi sang ký trực tuyến bất cứ lúc nào trước khi ký; nhân viên không ký thay. Hợp đồng điện tử có giá trị như hợp đồng bằng văn bản giấy theo Luật Giao dịch điện tử; mọi thao tác thực hiện từ tài khoản của khách hàng được coi là do khách hàng thực hiện.',
      'Khi Điều khoản này hoặc Chính sách bảo mật được cập nhật (đổi phiên bản), khách hàng được thông báo tóm tắt thay đổi và cần đọc, đồng ý bản mới trước khi tiếp tục đặt kho hay thực hiện thao tác trên tài khoản; hợp đồng đã ký vẫn giữ đúng phiên bản Điều khoản tại thời điểm ký.',
      'Khách hàng xác định sẽ thuê kho sau khi thanh toán tiền giữ chân và ký hợp đồng. Việc thuê kho là quyết định tự nguyện, độc lập của khách hàng, sau khi đã được cung cấp đầy đủ thông tin về loại kho, kích thước, hình thức khoá, giá, các khoản phải thanh toán và điều kiện hủy, hoàn tiền.',
      'Khách hàng tự chịu trách nhiệm đánh giá kho có phù hợp với nhu cầu của mình hay không. Nếu phát sinh bất trắc, hoặc kho không phù hợp với khách hàng, KhoAn không chịu trách nhiệm đối với mọi hoạt động của khách hàng cũng như mọi hậu quả, chi phí, thiệt hại phát sinh từ việc khách hàng tự quyết định thuê kho, bao gồm chi phí vận chuyển, đóng gói, nhân công, lưu kho nơi khác và mọi khoản đã chi cho bên thứ ba.',
      'Khách hàng có quyền hủy đặt chỗ hoặc trả kho trước hạn bất cứ lúc nào và tự chịu trách nhiệm về quyết định đó. Trước khi khách hàng ký hợp đồng, nếu ô đã chọn không bàn giao được (hư hỏng, bảo trì), chi nhánh có thể giao ô khác cùng loại, cùng giá; khách hàng thấy ô mới trong tài khoản trước khi ký. Nếu KhoAn không bàn giao được ô kho do lỗi của mình — kể cả quá ngày nhận mà chi nhánh chưa giao được ô — đặt chỗ được hủy và KhoAn hoàn 100% số tiền khách hàng đã thanh toán khi đặt chỗ; hai bên thoả thuận đây là toàn bộ trách nhiệm của KhoAn trong trường hợp này.',
      'Khi đặt chỗ trực tuyến, khách hàng có thể chọn "giữ chỗ, trả tại quầy": ô kho được giữ 24 giờ để khách hàng mang giấy tờ tùy thân đến quầy thanh toán tiền giữ chân (và tiền thuê kỳ đầu với kho cỡ lớn) và ký hợp đồng giấy; trong thời gian giữ, khách hàng vẫn có thể thanh toán trực tuyến. Quá 24 giờ chưa thanh toán thì đặt chỗ tự hủy (không phát sinh khoản phải hoàn). Mỗi tài khoản giữ tối đa một đặt chỗ theo cách này cùng lúc.',
      'Hủy đặt chỗ trước ngày nhận kho: tiền giữ chân được hoàn theo các mốc thời gian ghi trong hợp đồng và chính sách đang áp dụng; hủy sát ngày nhận thì không được hoàn tiền giữ chân. Không đến nhận kho trong thời gian quy định sau ngày nhận đã đặt (mặc định 24 giờ) và không hủy trước: hệ thống tự hủy đặt chỗ, giải phóng ô kho và không hoàn tiền giữ chân. Tiền thuê kỳ đầu đã trả cùng lúc đặt chỗ (kho cỡ lớn) luôn được hoàn đủ trong các trường hợp trên, vì khách hàng chưa nhận kho. Đến nhận kho muộn hơn ngày nhận đã đặt (còn trong thời gian quy định): thời hạn thuê, các kỳ thu tiền và tiền thuê vẫn tính từ ngày nhận đã ghi trong hợp đồng đã ký, vì ô kho đã được giữ cho khách hàng từ ngày đó. Việc hoàn tiền thực hiện tối đa trong 7 ngày làm việc.',
      'Trong các trường hợp trên, quyền lợi duy nhất của khách hàng đối với khoản đã thanh toán là được hoàn tiền theo đúng mức ghi trong hợp đồng. KhoAn không bồi thường, đền bù hay hỗ trợ thêm bất kỳ khoản nào khác.',
      'Thiệt hại đối với tài sản trong ô kho do lỗi trực tiếp của KhoAn trong thời gian thuê vẫn được xử lý theo Điều 6.',
    ],
  },
  {
    heading: 'Điều 12. Giải quyết tranh chấp',
    body: ['Hai bên thương lượng trước. Không đạt được thỏa thuận trong 30 ngày thì đưa ra Tòa án có thẩm quyền tại TP. Hồ Chí Minh. Áp dụng pháp luật Việt Nam.'],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    heading: '1. Dữ liệu thu thập',
    body: ['KhoAn không lưu số giấy tờ đầy đủ và không lưu số thẻ ngân hàng.'],
    table: {
      head: ['Nhóm', 'Cụ thể', 'Mục đích'],
      rows: [
        ['Định danh', 'Họ tên, email, số điện thoại', 'Lập hợp đồng, liên hệ'],
        ['Giấy tờ', 'Loại giấy tờ và 4 số cuối', 'Xác minh danh tính khi nhận kho'],
        ['Địa chỉ', 'Địa chỉ liên hệ, người liên hệ khẩn cấp', 'Giao dịch, xử lý sự cố'],
        ['Giao dịch', 'Lịch sử đặt chỗ, hợp đồng, thanh toán', 'Thực hiện hợp đồng, kế toán'],
        ['Tài khoản nhận tiền hoàn', 'Tên ngân hàng, số tài khoản, chủ tài khoản (khách tự khai)', 'Chuyển khoản hoàn tiền giữ chân, tiền thanh lý còn dư, chi bồi thường, hoàn tiền sau khiếu nại biên bản trả kho — chỉ quản lý chi nhánh và Quản lý vận hành xem khi có khoản đang chờ chuyển'],
        ['Nhật ký ra vào', 'Thời điểm quét mã, mở kho', 'An ninh, đối chiếu khi tranh chấp'],
        ['Hợp đồng đã ký', 'Lời văn hợp đồng / phụ lục, họ tên người ký, ảnh chữ ký vẽ tay (ký trực tuyến), bản scan hợp đồng ký giấy tại quầy', 'Lưu bằng chứng giao kết hợp đồng'],
        ['Xác minh email', 'Mã xác minh gửi tới email khi đăng ký tại quầy (chỉ lưu dạng băm, xoá sau khi dùng)', 'Bảo đảm thông báo hợp đồng gửi đúng email của khách hàng'],
        ['Bàn giao, trả kho', 'Chữ ký tay khi bàn giao lại kho, ảnh biên bản trả kho / đồ để lại / kiểm kê', 'Chứng cứ bàn giao, quyết toán và xử lý tranh chấp'],
        ['Danh sách đồ gửi kho', 'Tên, nhóm, số lượng, giá trị ước tính, tình trạng từng món đồ khách hàng khai mỗi lần nhập hàng; kết quả nhân viên kiểm hàng cấm và xác nhận', 'Kiểm soát hàng cấm (Điều 4), làm căn cứ khi xét bồi thường (Điều 6) — chỉ khách hàng và nhân viên chi nhánh đang cho thuê xem'],
        ['Kỹ thuật', 'Địa chỉ IP, loại trình duyệt', 'Bảo mật, chống gian lận'],
      ],
    },
  },
  {
    heading: '2. Cơ sở xử lý dữ liệu',
    body: [
      'Thực hiện hợp đồng thuê kho đã giao kết với khách hàng.',
      'Tuân thủ nghĩa vụ pháp luật về thuế, kế toán và yêu cầu của cơ quan nhà nước có thẩm quyền.',
      'Lợi ích hợp pháp: bảo đảm an ninh cơ sở và phòng chống gian lận (gồm mã xác nhận OTP gửi qua email khi ký hợp đồng).',
    ],
  },
  {
    heading: '3. Chia sẻ với bên thứ ba',
    body: ['KhoAn không bán, không trao đổi và không cho thuê dữ liệu cá nhân cho mục đích quảng cáo.'],
    table: {
      head: ['Bên nhận', 'Dữ liệu', 'Lý do'],
      rows: [
        ['Cổng thanh toán (VNPay, MoMo)', 'Số tiền, mã đơn hàng', 'Xử lý giao dịch. KhoAn không nhận và không lưu thông tin thẻ'],
        ['Google Firebase', 'Email, định danh đăng nhập', 'Xác thực tài khoản'],
        ['MongoDB Atlas', 'Dữ liệu nghiệp vụ', 'Lưu trữ'],
        ['Cơ quan nhà nước', 'Theo phạm vi yêu cầu', 'Khi có yêu cầu hợp pháp bằng văn bản'],
      ],
    },
  },
  {
    heading: '4. Thời gian lưu trữ',
    body: ['Hết thời hạn dưới đây, hoặc khi khách hàng yêu cầu xóa dữ liệu và đủ điều kiện (mục 5), dữ liệu được xóa hoặc ẩn danh hóa. Thời hạn lưu chứng từ áp dụng theo pháp luật về kế toán (ví dụ 10 năm đối với chứng từ dùng ghi sổ kế toán).'],
    table: {
      head: ['Loại dữ liệu', 'Thời hạn', 'Khi khách hàng yêu cầu xóa dữ liệu'],
      rows: [
        ['Hồ sơ tài khoản (họ tên, email, số điện thoại, loại giấy tờ và 4 số cuối, địa chỉ)', 'Trong thời gian còn tài khoản hoặc còn hợp đồng', 'Xóa (ẩn danh hóa)'],
        ['Tài khoản nhận tiền hoàn', 'Đến khi khách hàng tự xóa', 'Xóa, kể cả số tài khoản ghi trên các khoản đã chi xong'],
        ['Chứng từ tài chính (khoản thu, hoàn tiền, biên lai)', '10 năm kể từ ngày kết thúc hợp đồng', 'Giữ (ngoại lệ lưu trữ chứng từ)'],
        ['Hợp đồng đã ký, phụ lục, bản scan hợp đồng giấy', '10 năm kể từ ngày kết thúc hợp đồng', 'Giữ (chứng từ giao kết hợp đồng)'],
        ['Ảnh chữ ký vẽ tay (ký trực tuyến, ký nhận bàn giao kho)', 'Cùng thời hạn với hợp đồng', 'Xóa ảnh; giữ họ tên người ký và thời điểm ký'],
        ['Biên bản trả kho, ảnh đồ để lại / kiểm kê', '10 năm kể từ ngày kết thúc hợp đồng', 'Giữ (chứng cứ quyết toán)'],
        ['Danh sách đồ gửi kho (các đợt nhập hàng)', '10 năm kể từ ngày kết thúc hợp đồng', 'Giữ (căn cứ xét bồi thường, chứng cứ kiểm hàng cấm)'],
        ['Mã OTP ký hợp đồng, mã xác minh email', 'Chỉ lưu dạng băm, tối đa 10 phút, xóa sau khi dùng', '—'],
        ['Phiếu hỗ trợ / tư vấn', 'Trong thời gian còn tài khoản', 'Xóa nội dung khách hàng tự viết'],
        ['Nhật ký ra vào', '12 tháng', 'Giữ đến hết thời hạn'],
        ['Nhật ký hệ thống / kiểm toán', '24 tháng', 'Giữ đến hết thời hạn (không ghi thô số điện thoại, 4 số cuối giấy tờ)'],
      ],
    },
  },
  {
    heading: '5. Quyền của khách hàng',
    body: [
      'Theo pháp luật về bảo vệ dữ liệu cá nhân (Luật Bảo vệ dữ liệu cá nhân 2025 và Nghị định 13/2023/NĐ-CP), khách hàng có quyền: được biết, truy cập, chỉnh sửa, rút lại sự đồng ý, xóa dữ liệu, hạn chế xử lý, phản đối xử lý và khiếu nại.',
      'Tự tải bản sao dữ liệu KhoAn đang lưu về mình bất cứ lúc nào tại mục Dữ liệu cá nhân trong tài khoản (web) — gồm hồ sơ, đặt chỗ, hợp đồng, thanh toán, biên bản trả kho, thông tin bản scan hợp đồng và biên bản bàn giao (không kèm file scan và ảnh chữ ký; bản scan tải riêng trong tài khoản), yêu cầu cấp lại thẻ / chìa, đơn dịch vụ, phiếu hỗ trợ.',
      'Các yêu cầu khác (chỉnh sửa, xóa, rút lại đồng ý, phản đối) gửi tại mục Dữ liệu cá nhân trong tài khoản (web hoặc ứng dụng) — kể cả khi không còn hợp đồng. KhoAn phản hồi trong vòng 72 giờ.',
      'Xóa dữ liệu được thực hiện bằng cách ẩn danh hóa hồ sơ: xóa họ tên, email, số điện thoại, giấy tờ, tài khoản nhận tiền (kể cả số tài khoản ghi trên các khoản đã chi), ảnh chữ ký vẽ tay (ký hợp đồng trực tuyến, ký nhận bàn giao kho), người được ủy quyền, tài khoản đăng nhập và nội dung khách hàng tự viết trong phiếu hỗ trợ / tư vấn. Chỉ thực hiện được khi không còn hợp đồng, đặt chỗ đang mở, khoản nợ chưa tất toán, hồ sơ bồi thường hoặc khiếu nại về thanh toán / biên bản trả kho đang xử lý, biên bản trả kho còn trong hạn khiếu nại, hoặc khoản KhoAn đang chờ chuyển trả cho khách hàng.',
      'Ngoại lệ: hợp đồng đã ký (nội dung, họ tên người ký, bản scan hợp đồng giấy, thông tin đối chiếu giấy tờ khi bàn giao), biên bản trả kho, chứng từ tài chính và nhật ký kiểm toán được lưu theo thời hạn ở mục 4, kể cả khi khách hàng yêu cầu xóa.',
    ],
  },
  {
    heading: '6. Biện pháp bảo mật',
    body: [
      'Mật khẩu do Firebase Authentication quản lý — hệ thống KhoAn không bao giờ nhìn thấy mật khẩu của bạn.',
      'Mã QR nhận kho chỉ lưu bản băm SHA-256. Mật khẩu ban đầu của ổ khóa số được mã hóa (AES-GCM) để chỉ chủ hợp đồng xem lại được trong tài khoản.',
      'Phân quyền theo vai trò: nhân viên chỉ truy cập được dữ liệu của chi nhánh mình phụ trách. Nhân viên quầy không xem được 4 số cuối giấy tờ của khách hàng (kể cả trong nội dung hợp đồng) — phải nhập từ giấy tờ bản gốc để hệ thống so khớp; nhập sai nhiều lần thì việc đối chiếu bị tạm khóa và quản lý chi nhánh được báo.',
      'Mọi truy cập bị từ chối đều được ghi vào nhật ký kiểm toán.',
      'Nhật ký kiểm toán chỉ ghi thêm, không sửa và không xóa.',
      'Toàn bộ kết nối được mã hóa TLS.',
    ],
  },
  {
    heading: '7. Thông báo sự cố',
    body: ['Phát hiện lộ lọt dữ liệu, KhoAn thông báo cho khách hàng bị ảnh hưởng và cơ quan có thẩm quyền trong vòng 72 giờ.'],
  },
];
