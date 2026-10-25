import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { env } from '../../shared/config/env';

/**
 * Trang tài liệu API (GET /api) + bản JSON máy đọc được (GET /api/docs.json).
 * Cố ý không dùng thêm thư viện nào: bảng route bên dưới là nguồn duy nhất, trang HTML
 * chỉ render lại nó ở phía trình duyệt. Khi thêm endpoint mới → thêm 1 dòng ở đây.
 */

type Role = 'CUSTOMER' | 'STAFF' | 'FACILITY_MANAGER' | 'OPS_MANAGER' | 'ADMIN';
type Auth = 'PUBLIC' | 'ANY' | Role[];

interface Field { name: string; type: string; required?: boolean; note?: string }
interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  auth: Auth;
  summary: string;
  query?: Field[];
  body?: Field[];
  notes?: string[];
}
interface Group { name: string; blurb: string; routes: Route[] }

const R = {
  CUS: ['CUSTOMER'] as Role[],
  STAFF: ['STAFF', 'FACILITY_MANAGER'] as Role[],
  FM: ['FACILITY_MANAGER'] as Role[],
  OPS: ['OPS_MANAGER'] as Role[],
  ADMIN: ['ADMIN'] as Role[],
};

export const API_GROUPS: Group[] = [
  {
    name: 'Xác thực',
    blurb: 'Đăng nhập bằng Firebase ở client, gửi ID token qua header Authorization. Vai trò và phạm vi chi nhánh luôn lấy từ MongoDB, không bao giờ tin client.',
    routes: [
      {
        method: 'POST', path: '/auth/sync', auth: 'PUBLIC', summary: 'Tạo hoặc liên kết hồ sơ trong MongoDB sau mỗi lần đăng nhập Firebase (email/password hoặc Google). Giới hạn 20 lần/phút mỗi TÀI KHOẢN (trần 600 lần/phút/IP chỉ để chặn spam) — nhiều người chung một mạng không chặn lẫn nhau.',
        body: [
          { name: 'fullName', type: 'họ tên', note: 'dùng khi Firebase chưa có displayName — chữ cái, khoảng trắng, dấu nháy, chấm, gạch ngang; ≥ 2 chữ cái' },
          { name: 'phone', type: 'string /^\\+?\\d{9,15}$/' },
        ],
        notes: [
          'Chỉ cần Firebase ID token hợp lệ, chưa cần hồ sơ trong DB.',
          'Trả 201 nếu vừa tạo mới, 200 nếu đã có. Gọi ngay sau onAuthStateChanged rồi mới gọi /bootstrap.',
        ],
      },
      { method: 'GET', path: '/auth/me', auth: 'ANY', summary: 'Hồ sơ người dùng hiện tại (role, facilityIds, status).' },
      {
        method: 'PATCH', path: '/auth/me', auth: 'ANY', summary: 'Tự cập nhật thông tin nhận diện in vào hợp đồng: họ tên, số điện thoại, loại giấy tờ + 4 số cuối.',
        body: [
          { name: 'fullName', type: 'họ tên', note: 'chữ cái, khoảng trắng, dấu nháy, chấm, gạch ngang; ≥ 2 chữ cái' },
          { name: 'phone', type: 'string', note: '9–15 chữ số, lưu dạng gọn; trùng tài khoản khác → 409 PHONE_TAKEN' },
          { name: 'idType / idNumberLast4', type: 'CCCD | PASSPORT / 4 ký tự', note: 'chỉ tài khoản khách; nhập cùng nhau; không bao giờ nhận số giấy tờ đầy đủ' },
          { name: 'payoutAccount', type: '{ bankName, accountNumber (6–20 số), accountName } | null', note: 'tài khoản nhận tiền hoàn; null = xoá' },
        ],
        notes: [
          'Gửi trường nào sửa trường đó (ít nhất một trường).',
          'Khách đang có đặt chỗ đã ký / hợp đồng mở: ĐỔI họ tên hoặc giấy tờ đã có → 422 PROFILE_LOCKED (đổi tại quầy qua PATCH /reservations|contracts/:id/customer-identity). Khai lần đầu thì vẫn được.',
          'Đặt kho, ký, gia hạn: họ tên sai → 422 PROFILE_NAME_INVALID; khách thiếu số điện thoại / giấy tờ → 422 PROFILE_INCOMPLETE (details.missing).',
        ],
      },
    ],
  },
  {
    name: 'Dữ liệu cá nhân & hoàn tiền',
    blurb: 'Quyền của chủ thể dữ liệu (Nghị định 13/2023), sửa thông tin khách tại quầy, chuyển khoản hoàn tiền có xác nhận. Mọi API có trần tần suất theo IP (1200/phút); route nhạy cảm có trần riêng → 429 RATE_LIMITED.',
    routes: [
      { method: 'GET', path: '/auth/me/export', auth: R.CUS, summary: 'Khách tự tải bản sao dữ liệu KhoAn đang lưu về mình (JSON) — không kèm mật khẩu kho mã hoá, ghi chú nội bộ.' },
      { method: 'GET', path: '/privacy-requests', auth: ['CUSTOMER', 'ADMIN'], summary: 'Khách: yêu cầu của mình. Quản trị viên: tất cả (kèm thông tin khách), ?status=OPEN.' },
      {
        method: 'POST', path: '/privacy-requests', auth: R.CUS, summary: 'Gửi yêu cầu quyền dữ liệu — không cần đang có hợp đồng. Hạn phản hồi 72 giờ; báo email cho Quản trị viên.',
        body: [{ name: 'type', type: 'ACCESS | CORRECTION | DELETION | WITHDRAW_CONSENT | OBJECTION', required: true }, { name: 'note', type: 'string ≤2000' }],
        notes: ['Tối đa 3 yêu cầu đang mở mỗi khách (409 TOO_MANY_PRIVACY_REQUESTS).'],
      },
      { method: 'POST', path: '/privacy-requests/:id/resolve', auth: ['ADMIN'], summary: 'Trả lời yêu cầu: DONE / REJECTED kèm phản hồi (≥ 5 ký tự).' },
      {
        method: 'POST', path: '/users/:id/anonymize', auth: ['ADMIN'], summary: 'Xoá dữ liệu = ẩn danh hoá khách: xoá họ tên, email, SĐT, giấy tờ, tài khoản nhận tiền, người được uỷ quyền, tài khoản đăng nhập; giữ chứng từ tài chính.',
        body: [{ name: 'reason', type: 'string 5..500', required: true }, { name: 'requestId', type: 'ObjectId', note: 'yêu cầu DELETION được đóng luôn' }],
        notes: ['Còn hợp đồng / đặt chỗ đang mở → 422 HAS_OPEN_CONTRACT; còn nợ → 422 HAS_DEBT; KhoAn còn khoản chờ chuyển cho khách → 422 HAS_PENDING_PAYOUT; hồ sơ bồi thường đang xử lý → 422 HAS_OPEN_CLAIM; khiếu nại thanh toán / biên bản (phiếu BILLING) chưa xong → 422 HAS_OPEN_TICKET; biên bản trả kho còn trong hạn khiếu nại 7 ngày → 422 DISPUTE_WINDOW_OPEN; chi nhánh còn giữ đồ khách để lại (leftover.status = HELD) → 422 LEFTOVER_HELD.'],
      },
      {
        method: 'PATCH', path: '/reservations/:id/customer-identity', auth: R.FM, summary: 'Quản lý chi nhánh sửa họ tên / giấy tờ của khách tại quầy theo bản gốc (cũng có PATCH /contracts/:id/customer-identity).',
        body: [{ name: 'fullName', type: 'họ tên' }, { name: 'idType / idNumberLast4', type: 'CCCD | PASSPORT / 4 ký tự' }, { name: 'reason', type: 'string 5..500', required: true }],
        notes: ['Chỉ chi nhánh của đặt chỗ / hợp đồng đó, và chỉ khi đặt chỗ / hợp đồng còn hiệu lực (đã huỷ / đã đóng → 422 NOT_OPEN); ghi nhật ký user.identity_update. Hợp đồng đã ký giữ nguyên văn.'],
      },
      {
        method: 'POST', path: '/payments/:id/confirm-payout', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Xác nhận ĐÃ CHUYỂN KHOẢN một khoản hoàn đang chờ (PENDING → SUCCEEDED) kèm mã giao dịch.',
        body: [{ name: 'reference', type: 'string 3..100', required: true }, { name: 'toAccount', type: 'string', note: 'bắt buộc khi khách chưa khai tài khoản nhận (422 PAYOUT_ACCOUNT_REQUIRED)' }],
        notes: [
          'Khoản hoàn bằng chuyển khoản (REFUND / LIQUIDATION_PAYOUT, BANK_TRANSFER) luôn được tạo ở PENDING = chờ chuyển: hoàn tiền giữ chân khi trả kho, tiền thanh lý còn dư, tiền thuê trả trước của kỳ gia hạn chưa dùng.',
          'Hoàn khoản đã thu qua cổng online (VNPay / MoMo / thẻ) đi ngược về đúng cổng đó (ghi nhận ngay).',
          'Chi bồi thường bằng chuyển khoản (COMPENSATION) cũng chờ xác nhận ở đây; người đã DUYỆT hồ sơ không được tự xác nhận (403 SAME_APPROVER). Xác nhận xong hồ sơ bồi thường sang PAID.',
          'Khoản hoàn do điều chỉnh biên bản: người điều chỉnh không tự xác nhận (403 SAME_APPROVER). Khách đã khai tài khoản nhận tiền thì không nhận `toAccount` khác (422 PAYOUT_ACCOUNT_FIXED).',
          'Tách quyền chi: người TẠO khoản chi (payment.createdBy — người thao tác: lập biên bản trả kho tạo REFUND, xử lý đồ bỏ lại tạo REFUND / LIQUIDATION_PAYOUT, huỷ đặt chỗ…) không tự xác nhận → 403 SAME_APPROVER. Chi bồi thường (COMPENSATION) áp quy tắc người DUYỆT hồ sơ thay cho quy tắc này.',
          'Khách CHƯA khai tài khoản nhận tiền (người xác nhận phải tự nhập `toAccount`): chỉ OPS_MANAGER xác nhận; FACILITY_MANAGER → 403 PAYOUT_ACCOUNT_OPS.',
        ],
      },
    ],
  },
  {
    name: 'Bootstrap',
    blurb: 'Một lần gọi, một ảnh chụp dữ liệu đã lọc theo quyền — Webapp dùng nó để dựng toàn bộ dashboard.',
    routes: [
      {
        method: 'GET', path: '/bootstrap', auth: 'ANY',
        summary: 'Snapshot theo vai trò: { me, users, facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, policies, audit }.',
        notes: [
          'CUSTOMER → chỉ dữ liệu của chính mình · STAFF/FACILITY_MANAGER → theo facilityIds · OPS_MANAGER → toàn chuỗi · ADMIN → thêm users + audit.',
          'Không bao giờ trả checkIn.qrTokenHash; tin nhắn nội bộ của ticket bị lược bỏ với khách hàng.',
          'STAFF: không kèm 4 số cuối giấy tờ khách (users[].customerProfile.idNumberLast4, contracts[].identity.idNumberLast4) và số tài khoản nhận tiền hoàn (payments[].payout.toAccount) — FACILITY_MANAGER / OPS_MANAGER giữ. Cũng áp cho GET /payments và GET /contracts/:id.',
          'units[].leftoverHeldUntil (nhân viên / quản lý / vận hành): ô đang giữ đồ khách để lại đến ngày này, null = không giữ.',
          'Endpoint này chỉ đọc. Mọi thay đổi phải đi qua endpoint riêng để server kiểm tra lại quy tắc.',
        ],
      },
    ],
  },
  {
    name: 'Chi nhánh & bảng giá',
    blurb: 'Hai endpoint /public không cần đăng nhập, phục vụ trang tra cứu kho của khách.',
    routes: [
      { method: 'GET', path: '/facilities/public', auth: 'PUBLIC', summary: 'Danh sách chi nhánh đang hoạt động kèm số ô trống theo loại.' },
      {
        method: 'GET', path: '/facilities/public/:id', auth: 'PUBLIC', summary: 'Chi tiết chi nhánh + tồn kho và báo giá do server tính.',
        query: [
          { name: 'start', type: 'date (YYYY-MM-DD)', note: 'ngày bắt đầu thuê dự kiến' },
          { name: 'months', type: 'int 1..60', note: 'mặc định 1' },
        ],
      },
      { method: 'GET', path: '/facilities', auth: ['STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'], summary: 'Danh sách chi nhánh trong phạm vi của người gọi.' },
      {
        method: 'POST', path: '/facilities', auth: ['OPS_MANAGER', 'ADMIN'], summary: 'Tạo chi nhánh mới.',
        body: [
          { name: 'code', type: 'string [A-Za-z0-9-]{3,20}', required: true },
          { name: 'name', type: 'string 3..150', required: true },
          { name: 'status', type: 'FacilityStatus', required: true },
          { name: 'line1', type: 'string', required: true },
          { name: 'district', type: 'string', required: true },
          { name: 'city', type: 'string' },
          { name: 'phone', type: 'string', required: true },
        ],
        notes: ['Toạ độ trên bản đồ do server tự xác định từ line1 / district / city (OpenStreetMap Nominatim) — không cần gửi lng / lat; nếu gửi sẽ bị bỏ qua. Không tra được địa chỉ thì vẫn lưu bình thường.'],
      },
      { method: 'PATCH', path: '/facilities/:id', auth: ['OPS_MANAGER', 'ADMIN'], summary: 'Cập nhật chi nhánh (không đổi được code). Đổi line1 / district / city thì toạ độ được tra lại từ địa chỉ.', notes: ['Đổi status sang INACTIVE / UNDER_CONSTRUCTION khi chi nhánh còn hợp đồng mở (không CLOSED / ABANDONED) hoặc đặt chỗ chưa nhận kho (PENDING / CONFIRMED / ALLOCATED) → 409 FACILITY_HAS_TENANTS, details = { contracts, reservations } (số lượng). Không tự huỷ hàng loạt.'] },
      {
        method: 'DELETE', path: '/facilities/:id', auth: ['OPS_MANAGER', 'ADMIN'], summary: 'Xoá mềm chi nhánh.',
        notes: ['Chỉ xoá được khi chưa có ô kho, đặt chỗ hay hợp đồng nào — ngược lại 409, dùng trạng thái "Tạm ngưng".'],
      },
      { method: 'GET', path: '/facilities/:id/unit-types', auth: 'ANY', summary: 'Các loại ô kho của chi nhánh, sắp theo giá tăng dần.', notes: ['Bị chặn nếu chi nhánh nằm ngoài phạm vi của người gọi.'] },
      {
        method: 'POST', path: '/facilities/:id/unit-types', auth: R.OPS, summary: 'Thêm loại tủ/phòng thuê cho chi nhánh.',
        body: [
          { name: 'code', type: 'string [A-Za-z0-9.-]{2,20}', required: true, note: 'duy nhất trong chi nhánh' },
          { name: 'name', type: 'string 2..100', required: true },
          { name: 'category', type: 'UnitCategory', required: true, note: 'quyết định loại kho có tuỳ chọn điều hòa hay không' },
          { name: 'widthM / depthM / heightM', type: 'number 0.3..30', required: true },
          { name: 'indoor', type: 'boolean', required: true },
          { name: 'rates', type: '{ DAY, WEEK, MONTH } int ≥ 1.000', required: true },
          { name: 'minPeriods', type: 'int 1..365', required: true },
          { name: 'depositOverride', type: 'int | null', note: 'bỏ trống = tính theo chính sách' },
        ],
      },
      {
        method: 'PATCH', path: '/facilities/unit-types/:id', auth: R.OPS, summary: 'Sửa loại kho (tên, kích thước, giá, ẩn/hiện).',
        notes: ['Không đổi được code và category. Ẩn (isActive=false) bị chặn nếu còn ô đang giữ chỗ/đang thuê.'],
      },
      {
        method: 'DELETE', path: '/facilities/unit-types/:id', auth: R.OPS, summary: 'Xoá mềm loại kho.',
        notes: ['Chỉ xoá được khi không còn ô nào và chưa từng có đặt chỗ/hợp đồng — ngược lại 409, dùng "ẩn".'],
      },
      {
        method: 'PATCH', path: '/facilities/unit-types/:id/price', auth: R.OPS, summary: 'Đổi giá thuê cơ bản theo tháng.',
        body: [{ name: 'rate', type: 'int ≥ 50.000 (VND)', required: true }],
        notes: ['Hợp đồng và đặt chỗ đang tồn tại giữ nguyên giá đã chốt (snapshot).'],
      },
    ],
  },
  {
    name: 'Ô kho',
    blurb: 'Ô kho vật lý. Trạng thái chỉ đổi qua các endpoint này hoặc qua nghiệp vụ (cấp ô, nhận kho, trả kho).',
    routes: [
      {
        method: 'GET', path: '/units', auth: ['STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Sơ đồ ô kho của một chi nhánh.',
        query: [
          { name: 'facilityId', type: 'ObjectId', required: true },
          { name: 'status', type: 'UnitStatus' },
          { name: 'unitTypeId', type: 'ObjectId' },
        ],
        notes: ['Mỗi ô kèm `leftoverHeldUntil` (chỉ đọc, cũng có trong GET /bootstrap của nhân viên / quản lý / vận hành): ô đang giữ đồ khách để lại sau trả kho đến ngày này (null = không giữ).'],
      },
      {
        method: 'POST', path: '/units', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Thêm ô kho mới.',
        body: [
          { name: 'unitTypeId', type: 'ObjectId', required: true },
          { name: 'unitNumber', type: 'string 1..20', required: true },
          { name: 'floor', type: 'int -5..100', required: true },
          { name: 'accessMethod', type: 'AccessMethod', note: 'mặc định PIN' },
          { name: 'zone', type: 'string' },
        ],
      },
      {
        method: 'POST', path: '/units/bulk', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Thêm nhiều ô liền mã cùng tầng/khu/hình thức khoá.',
        body: [
          { name: 'unitTypeId', type: 'ObjectId', required: true },
          { name: 'prefix', type: 'string [A-Za-z0-9-]{1,12}', required: true, note: 'VD "M2-"' },
          { name: 'start / count', type: 'int', required: true, note: 'count 1..200 — mã sinh ra là prefix + số đệm 0, VD M2-01…M2-12' },
          { name: 'floor', type: 'int -5..100', required: true },
          { name: 'accessMethod', type: 'AccessMethod', note: 'mặc định PIN' },
          { name: 'zone', type: 'string ≤50' },
        ],
        notes: ['Trùng mã với ô đã có trong chi nhánh → 409, không tạo ô nào.'],
      },
      {
        method: 'PATCH', path: '/units/:id', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Sửa mã/tầng/khu/hình thức khoá của ô.',
        notes: ['Chỉ sửa được ô đang AVAILABLE hoặc MAINTENANCE và không gắn đặt chỗ/hợp đồng.'],
      },
      {
        method: 'DELETE', path: '/units/:id', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Xoá mềm ô kho.',
        notes: ['Chỉ xoá ô AVAILABLE/MAINTENANCE chưa từng có đặt chỗ/hợp đồng — ngược lại 409, chuyển sang Bảo trì.'],
      },
      {
        method: 'PATCH', path: '/units/:id/status', auth: R.STAFF, summary: 'Đưa ô vào/ra bảo trì.',
        body: [
          { name: 'to', type: "'AVAILABLE' | 'MAINTENANCE'", required: true },
          { name: 'reason', type: 'string ≤500' },
        ],
        notes: [
          'Không dùng để chiếm ô — ô chỉ chuyển sang RESERVED/OCCUPIED qua luồng đặt chỗ.',
          'Ô đang giữ đồ khách để lại (hợp đồng leftover.status = HELD) → 409 LEFTOVER_HELD — chỉ POST /contracts/:id/leftover/resolve nhả ô.',
        ],
      },
    ],
  },
  {
    name: 'Đặt chỗ',
    blurb: 'Vòng đời: PENDING → CONFIRMED → ALLOCATED → CHECKED_IN → COMPLETED (hoặc CANCELLED / EXPIRED / NO_SHOW). Chống đặt trùng bằng 3 lớp: $inc inventoryVersion trong transaction, CAS trên ô kho, và partial unique index.',
    routes: [
      {
        method: 'GET', path: '/reservations', auth: 'ANY', summary: 'Danh sách đặt chỗ đã lọc theo quyền.',
        query: [
          { name: 'page / limit', type: 'int' },
          { name: 'facilityId', type: 'ObjectId' },
          { name: 'status', type: 'CSV ReservationStatus', note: 'ví dụ CONFIRMED,ALLOCATED' },
          { name: 'from / to', type: 'date', note: 'lọc theo startDate' },
        ],
      },
      {
        method: 'GET', path: '/reservations/lookup', auth: R.STAFF, summary: 'Tra mã đặt chỗ tại quầy trước khi nhận khách.',
        query: [{ name: 'code', type: 'string ≥6', required: true }],
        notes: [
          'Tra cứu ngoài phạm vi chi nhánh sẽ bị từ chối và ghi một dòng audit result=DENIED.',
          'Trả { reservation, customer: { _id, fullName, phone, status, idType, hasIdentity }, qrValid } — KHÔNG trả 4 số cuối giấy tờ khách đã khai (nhân viên nhập từ giấy tờ bản gốc lúc nhận kho); reservation không kèm nguyên văn hợp đồng đã ký (signature.clauses rỗng), mã OTP, mã QR băm.',
        ],
      },
      {
        method: 'GET', path: '/reservations/contract-preview', auth: 'PUBLIC', summary: 'Xem trước toàn văn hợp đồng của một dòng đặt kho, TRƯỚC khi đặt / trả tiền giữ chân.',
        query: [
          { name: 'unitTypeId', type: 'ObjectId', required: true },
          { name: 'unitId', type: 'ObjectId', note: 'tuỳ chọn — có thì ghi số ô, tầng, khu' },
          { name: 'startDate', type: 'date', required: true },
          { name: 'rentalPeriod / periods', type: 'RentalPeriod / int', required: true },
          { name: 'useAirConditioning', type: "'true' | 'false'" },
        ],
        notes: [
          'Dựng bằng đúng mẫu hợp đồng, chính sách và báo giá như khi đặt thật; không ghi DB, không giữ ô.',
          'Đăng nhập là khách thì điền sẵn Bên B theo hồ sơ; chưa đăng nhập hoặc là nhân viên (xem cho khách tại quầy) thì để trống Bên B (customerName = null) — không in tên nhân viên.',
          'Web / app bắt buộc khách mở bản xem trước này cho từng dòng trước khi đặt (gửi consent.contractAck = true).',
          'GET /reservations/contract-preview.pdf: cùng tham số, trả PDF ghi rõ "BẢN XEM TRƯỚC — chưa có giá trị pháp lý".',
        ],
      },
      { method: 'GET', path: '/reservations/:id', auth: 'ANY', summary: 'Chi tiết một đặt chỗ.' },
      {
        method: 'POST', path: '/reservations', auth: R.CUS, summary: 'Giữ chỗ một ô kho (kèm `services[]`: dịch vụ thêm chọn kèm — đơn riêng ngoài hợp đồng thuê, thu tiền khi nhận kho; huỷ đặt chỗ thì đơn tự huỷ) và sinh khoản thanh toán tiền giữ chân (kho cỡ lớn: thêm khoản tiền thuê kỳ đầu).',
        body: [
          { name: 'unitTypeId', type: 'ObjectId', required: true },
          { name: 'startDate', type: 'date', required: true },
          { name: 'months', type: 'int 1..60', required: true },
          { name: 'source', type: "'WEB' | 'MOBILE'", note: 'mặc định WEB' },
          { name: 'idempotencyKey', type: 'string 8..100', note: 'hoặc dùng header Idempotency-Key' },
          { name: 'consent', type: '{ termsVersion, privacyVersion, paymentScheduleAck: true, contractAck: true }', required: true, note: 'paymentScheduleAck = khách xác nhận đã đọc lịch thanh toán (tiền giữ chân khi đặt + tiền thuê kỳ đầu: trả THÊM khi nhận kho, hoặc cùng lúc đặt với kho cỡ lớn); contractAck = khách đã mở xem và đọc hợp đồng của kho (GET /reservations/contract-preview). Thiếu một trong hai → 400. Server đóng dấu consent.paymentScheduleAckAt, consent.contractAckAt.' },
        ],
        notes: [
          'Trả 201 với đặt chỗ ở trạng thái PENDING + payment DEPOSIT (tiền giữ chân) đang chờ.',
          'Kho cỡ lớn (category LARGE, XL — shared/tier-rules.ts): tiền giữ chân ≥ 2 kỳ tiền thuê (quote.depositPeriods) và tiền thuê kỳ đầu thu cùng lúc đặt (quote.firstPeriodAtBooking = true) → sinh thêm payment PREPAID_RENT; quote.totalDueAtBooking = giữ chân + tiền thuê kỳ đầu.',
          'Giá và chính sách được đóng băng (snapshot) ngay tại đây.',
          'Hết hạn giữ chỗ (reservationHoldMinutes) thì job nền tự chuyển sang EXPIRED.',
          'Hết ô trống → 409 SOLD_OUT.',
          'POST /reservations/batch: đặt nhiều kho một lần (giỏ hàng) — body { items: [...] (1..10), consent } với cùng consent như trên; tất cả trong một transaction, trả { items }.',
        ],
      },
      {
        method: 'GET', path: '/users/customers/lookup', auth: R.STAFF, summary: 'Tra đúng một khách theo email hoặc số điện thoại (khớp chính xác) trước khi đặt chỗ tại quầy.',
        query: [{ name: 'q', type: 'string 5..254', required: true, note: 'có @ → email (không phân biệt hoa thường), không có → số điện thoại; ngắn hơn 5 ký tự → 400' }],
        notes: ['Trả { customer: { _id, fullName, email, phone, status, idType, hasIdentity } | null } (CustomerLookupResult ở @ssm/shared) — KHÔNG trả 4 số cuối giấy tờ: nhân viên nhập từ giấy tờ bản gốc, hệ thống tự so khớp. null = chưa có tài khoản, tạo khách mới khi đặt tại quầy. Giới hạn 30 lần / phút / nhân viên.'],
      },
      {
        method: 'POST', path: '/reservations/walk-in/email-otp', auth: R.STAFF, summary: 'Khách mới tại quầy: gửi mã 6 số xác minh tới email khách khai — khách đọc lại mã cho nhân viên nhập vào POST /reservations/walk-in (customer.emailOtp).',
        body: [{ name: 'email', type: 'email', required: true }],
        notes: [
          'Trả { sentTo (đã che), expiresAt, demoCode? } — demoCode CHỈ có khi không gửi được thư ở môi trường không phải production (tên miền demo bị chặn / chưa cấu hình SMTP), giống /reservations/:id/sign-otp.',
          'Mã hiệu lực 10 phút, gửi lại sau 60 giây (429 OTP_COOLDOWN), nhập sai 5 lần thì phải gửi mã mới. Chỉ lưu sha256 của mã (collection emailVerifications), dùng xong thì xoá.',
          'Email đã thuộc tài khoản khác → 409 EMAIL_EXISTS ngay ở bước này. Gửi thư lỗi → 422 OTP_SEND_FAILED.',
          'Giới hạn 10 lần / 10 phút / nhân viên (mọi email) → 429 RATE_LIMITED.',
        ],
      },
      {
        method: 'POST', path: '/reservations/walk-in', auth: R.STAFF, summary: 'Đặt chỗ TẠI QUẦY cho khách vãng lai: nhân viên tạo đặt chỗ thay khách và thu ngay tiền giữ chân (+ tiền thuê kỳ đầu với kho cỡ lớn) → ALLOCATED.',
        body: [
          { name: 'customer', type: '{ customerId, idType, idNumberLast4 } | { email, fullName, phone, idType, idNumberLast4, emailOtp }', required: true, note: 'khách cũ (tra bằng /users/customers/lookup) — LUÔN gửi idType + idNumberLast4 nhân viên đọc từ giấy tờ bản gốc (thiếu → 422 ID_REQUIRED; khác giấy tờ đã khai → 422 ID_MISMATCH; khách chưa khai thì lưu vào hồ sơ); khách mới → tạo tài khoản CUSTOMER chưa gắn đăng nhập, emailVerifiedAt = lúc đặt (email đã có → 409 EMAIL_EXISTS, SĐT trùng → 409 PHONE_EXISTS). Khách mới BẮT BUỘC `emailOtp` = mã 6 số gửi bằng POST /reservations/walk-in/email-otp: thiếu / chưa gửi mã → 422 EMAIL_OTP_REQUIRED, sai (hoặc sai quá 5 lần) → 422 EMAIL_OTP_INVALID, hết hạn → 422 EMAIL_OTP_EXPIRED. Mã dùng một lần.' },
          { name: 'items', type: 'như POST /reservations (bỏ source, idempotencyKey) — 1..10, cùng chi nhánh', required: true, note: 'ô phải thuộc chi nhánh được gán cho nhân viên (403 FACILITY_SCOPE); ô đã bị giữ → 409 UNIT_NOT_AVAILABLE' },
          { name: 'payMethod', type: "'CASH' | 'BANK_TRANSFER' | 'CARD'", required: true, note: 'cách thu tại quầy — payment SUCCEEDED, recordedBy = nhân viên (mọi hình thức)' },
          { name: 'txnRef', type: 'string 4..64', note: 'mã giao dịch chuyển khoản / mã chuẩn chi thẻ — bắt buộc khi payMethod ≠ CASH (422 TXN_REF_REQUIRED), lưu payment.provider.txnRef' },
          { name: 'consent', type: '{ termsVersion, privacyVersion, paymentScheduleAck: true, contractAck: true }', required: true, note: 'khách xác nhận trước mặt nhân viên; ip / userAgent là của máy quầy' },
        ],
        notes: [
          'Trả 201 { customer: { _id, fullName, email, phone }, items: Reservation[], payments: { _id, type, amount, method, reservationId }[] } — đặt chỗ source = WALK_IN, bookedBy = nhân viên, đã cấp mã QR nhận kho (khách xem lại qua POST /reservations/:id/qr khi dùng app); `payments` để in biên lai (GET /payments/:id/receipt.pdf).',
          'Header Idempotency-Key (8..80 ký tự): gửi lại cùng khoá → trả đúng kết quả lần trước, không tạo / thu thêm.',
          'Khách còn nợ quyết toán → 422 SETTLEMENT_DEBT; tài khoản khách bị khoá → 403 ACCOUNT_SUSPENDED. Khách mới về sau đăng ký bằng đúng email (đã xác minh) thì tự liên kết vào tài khoản này.',
          'Tiếp theo: GET /reservations/:id/contract-print.pdf → khách ký giấy → POST /reservations/:id/sign-paper → POST /reservations/:id/check-in.',
        ],
      },
      {
        method: 'POST', path: '/reservations/:id/pay-deposit', auth: R.CUS, summary: 'Thanh toán khoản phải trả khi đặt chỗ: tiền giữ chân, cộng tiền thuê kỳ đầu nếu là kho cỡ lớn (cổng thanh toán giả lập).',
        body: [{ name: 'method', type: "'VNPAY' | 'MOMO' | 'CARD' | 'BANK_TRANSFER'", required: true }],
        notes: ['Thành công → CONFIRMED và trả qrPayload dạng SSM:<code>:<token> đúng một lần; server chỉ lưu SHA-256 của token.'],
      },
      {
        method: 'POST', path: '/reservations/:id/sign', auth: R.CUS, summary: 'Ký xác nhận hợp đồng sau khi trả tiền giữ chân, trước khi nhận kho.',
        body: [
          { name: 'signerName', type: 'string 2..100', required: true },
          { name: 'method', type: 'DRAWN | TYPED', required: true, note: 'DRAWN = vẽ tay (cần image), TYPED = gõ họ tên' },
          { name: 'image', type: 'PNG data URL ≤ ~60KB', note: 'bắt buộc khi DRAWN' },
          { name: 'otp', type: '6 chữ số', required: true, note: 'mã gửi qua email bằng POST /reservations/:id/sign-otp (hiệu lực 10 phút, sai 5 lần phải gửi mã mới) — 422 OTP_REQUIRED / OTP_INVALID / OTP_EXPIRED / OTP_LOCKED' },
        ],
        notes: [
          'Chỉ ký được khi đặt chỗ ở CONFIRMED/ALLOCATED và chưa ký; mỗi đặt chỗ ký một lần, không sửa.',
          'Chỉ chính khách ký trên tài khoản của họ — nhân viên/quản lý không ký thay (403). Chưa ký thì check-in bị chặn (422 CONTRACT_NOT_SIGNED).',
          'Ký xong server tự dựng PDF hợp đồng đã ký và gửi tới email của khách (chờ tối đa 10 giây; chưa cấu hình SMTP thì bỏ qua, việc ký vẫn thành công). Kết quả nằm ở signature.emailedAt/emailedTo.',
        ],
      },
      { method: 'POST', path: '/reservations/:id/sign-otp', auth: R.CUS, summary: 'Gửi mã OTP 6 số qua email trước khi ký online (gửi lại sau 60 giây — 429 OTP_COOLDOWN). Tài khoản demo bị chặn gửi thư thì trả `demoCode`.' },
      { method: 'GET', path: '/reservations/:id/contract-print.pdf', auth: R.STAFF, summary: 'Bản IN hợp đồng để khách ký giấy tại quầy (đặt chỗ đã trả giữ chân, chưa ký).' },
      {
        method: 'POST', path: '/reservations/:id/sign-paper', auth: R.STAFF, summary: 'Ghi nhận hợp đồng ký GIẤY tại quầy: tải bản scan (PDF / JPG / PNG ≤ 5MB) — signature.method = PAPER.',
        body: [{ name: 'signerName', type: 'string 2..100', required: true }, { name: 'file', type: '{ name, contentType, base64 }', required: true, note: 'base64 không kèm tiền tố data:' }],
      },
      { method: 'GET', path: '/reservations/:id/signed-file', auth: 'ANY', summary: 'Tải bản scan hợp đồng ký giấy (khách chủ đặt chỗ, nhân viên / quản lý chi nhánh, vận hành).' },
      {
        method: 'GET', path: '/reservations/:id/contract.pdf', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Tải PDF hợp đồng đã ký (có chữ ký).',
        notes: ['Cần đăng nhập (Bearer token) nên tải bằng fetch rồi lưu blob, không dùng thẻ <a href> trực tiếp. Chưa ký → 422.'],
      },
      {
        method: 'POST', path: '/reservations/:id/contract/email', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER'], summary: 'Gửi lại PDF hợp đồng đã ký tới email của khách.',
        notes: ['Tối thiểu 60 giây giữa hai lần (409 TOO_SOON). Chưa cấu hình SMTP → 503 MAIL_NOT_CONFIGURED; gửi lỗi → 502 MAIL_FAILED. Khách không có tài khoản đăng nhập và chưa xác minh email (user.emailVerifiedAt) → 422 EMAIL_UNVERIFIED.'],
      },
      {
        method: 'POST', path: '/reservations/:id/cancel', auth: 'ANY', summary: 'Hủy đặt chỗ; hoàn theo bậc trong chính sách, tính trên TẤT CẢ số tiền đã trả khi đặt chỗ (giữ chân + tiền thuê kỳ đầu trả trước).',
        body: [
          { name: 'reason', type: 'CancellationReason', note: 'khách hàng luôn bị ép về CUSTOMER_REQUEST; theo vai trò (CANCEL_REASONS_BY_ROLE ở @ssm/shared): STAFF chỉ CUSTOMER_REQUEST; FACILITY_MANAGER thêm FACILITY_UNAVAILABLE (hoàn 100%); OPS_MANAGER / ADMIN thêm ADMIN_OVERRIDE (hoàn 100%) — lý do khác → 403 CANCEL_REASON_FORBIDDEN; NO_SHOW, HOLD_EXPIRED, PAYMENT_FAILED do hệ thống tự áp (422 SYSTEM_ONLY_REASON)' },
          { name: 'note', type: 'string', note: 'người không phải khách huỷ: BẮT BUỘC 5..300 ký tự (422 CANCEL_NOTE_REQUIRED) — lưu vào reservation.cancellation.note + nhật ký, gửi kèm email báo khách; khách tự huỷ: tuỳ chọn' },
        ],
        notes: [
          'Hoàn tiền theo KHOẢN GỐC: khách trả online qua cổng (VNPAY / MOMO / CARD, không qua quầy) → hoàn qua chính cổng đó (SUCCEEDED ngay); khoản thu tại quầy (recordedBy / provider.counterRef — kể cả quẹt thẻ, quét mã) hoặc tiền mặt / chuyển khoản → REFUND BANK_TRANSFER PENDING, chờ người KHÁC xác nhận đã chuyển (POST /payments/:id/confirm-payout). Cùng quy tắc cho huỷ đơn dịch vụ, hoàn phí cấp lại thẻ / chìa, hoàn tiền gia hạn trả trước khi trả kho sớm.',
          'Chi nhánh huỷ → email báo khách (lý do, ghi chú, số tiền hoàn) theo quy tắc gửi thông báo (khách có tài khoản đăng nhập hoặc email đã xác minh, không gửi tới địa chỉ bị chặn); lỗi gửi không làm hỏng thao tác.',
        ],
      },
      {
        method: 'POST', path: '/reservations/:id/reschedule', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER'], summary: 'Đổi ngày nhận kho của đặt chỗ đã trả giữ chân, chưa nhận kho (CONFIRMED / ALLOCATED) — khách chủ đặt chỗ, hoặc nhân viên / quản lý chi nhánh mình (VD khách đến sớm tại quầy → dời về hôm nay). Trả về reservation như GET /reservations/:id.',
        body: [
          { name: 'startDate', type: 'YYYY-MM-DD', required: true, note: 'ngày nhận kho mới (hoặc ISO …T00:00:00.000Z)' },
          { name: 'reason', type: 'string ≤300' },
        ],
        notes: [
          'Quy tắc (rescheduleCheck / rescheduleWindow trong @ssm/shared): tối đa RESCHEDULE_MAX_CHANGES = 3 lần (422 RESCHEDULE_LIMIT); ngày mới ≥ hôm nay (422 RESCHEDULE_PAST), khác ngày hiện tại (422 RESCHEDULE_SAME), không muộn hơn ngày gốc lúc đặt quá 30 ngày và không quá 90 ngày kể từ hôm nay (422 RESCHEDULE_TOO_LATE); đã tới ngày nhận thì chỉ dời SỚM hơn (422 RESCHEDULE_LOCKED); sai trạng thái → 422 RESCHEDULE_STATE. Không phải chủ / ngoài chi nhánh → 403.',
          'Số kỳ, báo giá, chính sách giữ nguyên; endDate = ngày mới + số kỳ; checkIn.qrExpiresAt = ngày mới + 2 (mã QR cũ vẫn dùng được); đơn dịch vụ kèm (REQUESTED) dời preferredDate theo. originalStartDate ghi ngày gốc ở lần đổi đầu; scheduleChanges ghi { from, to, at, by, byRole, reason, voidedSignature? }.',
          'Đã ký hợp đồng thì chữ ký hết hiệu lực (chuyển vào scheduleChanges[].voidedSignature, xoá signature + signOtp) → khách phải ký lại (online có OTP, hoặc giấy tại quầy) trước khi nhận kho. Bản scan giấy cũ vẫn lưu.',
          'Hoàn tiền khi huỷ về sau tính theo ngày nhận SỚM NHẤT từng có (cancellationRefundOf) — dời ra xa rồi huỷ không được hoàn nhiều hơn. Nhân viên đổi thì email báo khách (lỗi gửi không ảnh hưởng). Audit reservation.reschedule.',
        ],
      },
      {
        method: 'POST', path: '/reservations/:id/allocate', auth: R.FM, summary: 'Gán ô cho đặt chỗ chưa có ô, hoặc ĐỔI sang ô khác cùng loại cho đặt chỗ đã phân (nhả ô cũ + giữ ô mới trong một giao dịch). Khách đã ký hợp đồng (ghi số ô) → 422 ALREADY_SIGNED.',
        body: [{ name: 'unitId', type: 'ObjectId', note: 'bỏ trống để hệ thống tự chọn ô phù hợp nhất' }],
        notes: ['Tự chọn theo thứ tự priceTier giảm dần → tầng thấp → số ô nhỏ, và dùng CAS trên status=AVAILABLE.'],
      },
      { method: 'POST', path: '/reservations/:id/unallocate', auth: R.FM, summary: 'Nhả ô đã gán, trả ô về AVAILABLE (khách đã ký → 422 ALREADY_SIGNED). Hiếm dùng — đổi ô dùng /allocate; đặt chỗ không có ô quá hạn nhận thì job huỷ FACILITY_UNAVAILABLE, hoàn 100%.' },
      {
        method: 'POST', path: '/reservations/:id/check-in', auth: R.STAFF, summary: 'Nhận khách: tạo hợp đồng thuê, thu tiền thuê (thuê tháng: kỳ đầu; thuê NGÀY / TUẦN: trọn cả thời hạn — quote.prepaidPeriods), cấp quyền vào kho.',
        body: [
          { name: 'accessMethod', type: 'AccessMethod', required: true },
          { name: 'keyTag', type: 'string ≤40', note: 'bắt buộc với ô chìa / thẻ (422 KEYTAG_REQUIRED)' },
          { name: 'goodsCheck', type: '{ confirmed: string[], note?, photoUrls? }', required: true, note: 'kiểm tra hàng hoá (Điều 4): xác nhận đủ INTAKE_CHECK_ITEMS — thiếu thì 422 GOODS_CHECK_REQUIRED; đơn dịch vụ kèm lúc đặt được thu cùng payMethod' },
          { name: 'payMethod', type: 'PaymentMethod (≠ INTERNAL)', note: 'cách thu tiền thuê kỳ đầu tại quầy — bắt buộc với kho thường (thiếu → 422 PAY_METHOD_REQUIRED); bỏ trống với kho cỡ lớn vì đã thu lúc đặt' },
          { name: 'txnRef', type: 'string 4..64', note: 'mã giao dịch — bắt buộc khi có thu tiền và payMethod ≠ CASH (422 TXN_REF_REQUIRED); mọi khoản thu ghi recordedBy = nhân viên' },
          { name: 'qrToken', type: 'string', note: 'token quét từ mã QR của khách' },
          { name: 'identityVerified', type: 'true', required: true, note: 'nhân viên xác nhận đã đối chiếu giấy tờ tùy thân bản gốc' },
          { name: 'idType / idNumberLast4', type: 'CCCD | PASSPORT / 4 ký tự', required: true, note: 'nhân viên đọc từ giấy tờ bản gốc khách xuất trình — LUÔN bắt buộc (thiếu → 422 ID_REQUIRED; màn hình quầy không được hiện sẵn số đã khai), khách đã khai thì phải khớp cả loại giấy tờ lẫn 4 số cuối (422 ID_MISMATCH), chưa khai thì lưu vào hồ sơ' },
        ],
        notes: [
          'Mã PIN chỉ trả về đúng một lần trong response này — không có endpoint nào đọc lại được.',
          'Ghi contract.identity (loại giấy tờ, 4 số cuối, nhân viên, thời điểm) — in kèm PDF hợp đồng.',
          'Chưa tới ngày nhận (startDate > hôm nay) → 422 CHECKIN_TOO_EARLY: dời ngày nhận về hôm nay (POST /reservations/:id/reschedule) rồi cho khách ký lại hợp đồng.',
          'Khách đến MUỘN (startDate < hôm nay, còn trong hạn no-show): hợp đồng vẫn bắt đầu từ reservation.startDate — endDate, kỳ cam kết, kỳ thu đầu (period.start), billing.nextBillingDate / paidThrough đều tính từ ngày đã ký, khớp PDF hợp đồng (khách giữ ô thì trả tiền các ngày đó). Đến đúng ngày thì như cũ.',
          'Trả { contract, unit, pin?, paymentIds } — paymentIds: các khoản vừa thu tại quầy, để in biên lai.',
        ],
      },
    ],
  },
  {
    name: 'Hợp đồng thuê',
    blurb: 'Vòng đời: ACTIVE → (DELINQUENT → LOCKED_OUT) → MOVE_OUT_PENDING → CLOSED, hoặc LOCKED_OUT → ABANDONED nếu khách bỏ hàng không liên hệ. Mọi khoản tiền là số nguyên VND.',
    routes: [
      {
        method: 'GET', path: '/contracts', auth: 'ANY', summary: 'Danh sách hợp đồng, ưu tiên hiển thị nợ quá hạn lâu nhất.',
        query: [
          { name: 'page / limit', type: 'int' },
          { name: 'facilityId', type: 'ObjectId' },
          { name: 'status', type: 'CSV ContractStatus' },
          { name: 'overdue', type: "'true' | 'false'", note: "true → chỉ hợp đồng còn dư nợ" },
        ],
      },
      { method: 'GET', path: '/contracts/:id', auth: 'ANY', summary: 'Chi tiết hợp đồng + 50 giao dịch gần nhất.' },
      {
        method: 'POST', path: '/contracts/:id/extend', auth: R.CUS, summary: 'Gia hạn = một kỳ cam kết mới (giá niêm yết hiện hành, ưu đãi theo số tháng gia hạn). Thuê tháng: không thu tiền, hoá đơn vẫn xuất từng tháng theo giá mới; thuê ngày / tuần: trả trọn kỳ gia hạn ngay (cần method). Xem trước bằng GET /contracts/:id/extension-quote.',
        body: [
          { name: 'periods', type: 'int 1..60', required: true },
          { name: 'method', type: 'PaymentMethod (≠ INTERNAL)', note: 'bắt buộc khi payNow > 0 (thuê ngày / tuần) — 422 PAY_METHOD_REQUIRED' },
          { name: 'acceptAppendix', type: 'true', required: true, note: 'xác nhận Phụ lục gia hạn (422 APPENDIX_NOT_ACCEPTED)' },
          { name: 'expected', type: '{ rate: VND, payNow: VND }', required: true, note: 'đúng `rate` và `payNow` của báo giá GET /contracts/:id/extension-quote khách đang xem (cùng periods). Báo giá tính lại lúc gia hạn khác → 409 PRICE_CHANGED (details = { rate, payNow } mới) — client tải lại báo giá cho khách xem lại.' },
        ],
      },
      {
        method: 'POST', path: '/contracts/:id/pay-balance', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER'], summary: 'Thanh toán dư nợ hiện tại.',
        body: [{ name: 'method', type: 'PaymentMethod (≠ INTERNAL)', required: true }, { name: 'txnRef', type: 'string 4..64', note: 'nhân viên thu tại quầy không bằng tiền mặt → bắt buộc (422 TXN_REF_REQUIRED); khách tự trả online thì bỏ qua' }],
        notes: [
          'Khoản PENDING → SUCCEEDED. Nếu khoản cũ đã FAILED thì sinh một khoản thu mới để thử lại (bản ghi tài chính chỉ ghi thêm, không sửa).',
          'Nhân viên thu: recordedBy = nhân viên cho MỌI hình thức, provider.txnRef = mã giao dịch nhập. Trả { contract, amount, paymentIds } — paymentIds để in biên lai.',
          'Hợp đồng đã đóng: thu các khoản nợ sau quyết toán (SETTLEMENT_DEBT, DISPOSAL_FEE phí xử lý đồ để lại…).',
        ],
      },
      { method: 'POST', path: '/contracts/:id/lockout', auth: R.FM, summary: 'Khóa ô kho khi quá hạn vượt lockoutAfterDays (job tính tiền cũng tự khoá). Cùng đường với job: thu phí cố định khi khoá theo chính sách khách đã ký (một lần mỗi đợt nợ), ghi thông báo LOCKED_OUT vào contract.notices và gửi email cho khách.', notes: ['Chỉ khoá khi: quá hạn > lockoutAfterDays ngày VÀ đợt nợ đã có thông báo hết ân hạn (GRACE_EXPIRED) ghi nhận ít nhất LOCKOUT_MIN_NOTICE_DAYS = 3 ngày VÀ đã tới ngày khoá ghi trong thông báo đó — ngược lại 422 LOCKOUT_TOO_EARLY. Job tính tiền theo đúng quy tắc này và không bao giờ khoá trong cùng lượt vừa chuyển DELINQUENT.', 'Job chạy bù (server ngủ / deploy): một lượt xuất ĐỦ các kỳ còn thiếu của mỗi hợp đồng (trần 36 kỳ / lượt, idempotent theo kỳ); quá hạn tính từ max(ngày đến hạn, ngày hoá đơn thật sự được xuất — createdAt của khoản RENT theo ngày VN); ngày khoá ghi trong thông báo GRACE_EXPIRED luôn ≥ hôm nay + 3 ngày.', 'Nhắc hết hạn (job hằng ngày): hợp đồng ACTIVE / DELINQUENT (chưa khoá) còn ≤ 30 ngày → thông báo EXPIRY_30, ≤ 7 ngày → EXPIRY_7 trong contract.notices (notices[].endDate = ngày hết hạn được nhắc) + email; mỗi mốc một lần cho một endDate — gia hạn đổi endDate thì nhắc lại.'] },
      {
        method: 'POST', path: '/contracts/:id/final-notice', auth: R.FM, summary: 'Gửi THÔNG BÁO CUỐI cho khách đang bị khoá (Điều 7 Điều khoản) — bắt buộc trước khi xử lý đồ bỏ lại.',
        body: [{ name: 'note', type: 'string ≤500', note: 'VD đã gọi điện, gửi thư bảo đảm số …' }],
        notes: [
          'Ghi delinquency.finalNoticeAt + thông báo FINAL_NOTICE (dư nợ, hạn chót = hôm nay + policy.abandonAfterLockedOutDays) vào contract.notices; gửi email sau khi lưu.',
          'Chỉ khi LOCKED_OUT (422 NOT_LOCKED_OUT); mỗi đợt nợ một lần (409 FINAL_NOTICE_SENT). Khách trả đủ nợ thì đợt nợ kết thúc, lần sau gửi lại từ đầu.',
          'Email thông báo (mọi loại) chỉ gửi khi khách có tài khoản đăng nhập (firebaseUid) HOẶC email đã xác minh (user.emailVerifiedAt); địa chỉ thuộc tên miền bị chặn không gửi. Không gửi được → notice.email.status SKIPPED / FAILED, thông báo vẫn hiện trong tài khoản.',
        ],
      },
      {
        method: 'POST', path: '/contracts/:id/notices/final/delivery', auth: R.FM, summary: 'Ghi nhận ĐÃ BÁO khách thông báo cuối bằng kênh khác khi email không tới được khách — lưu vào notice FINAL_NOTICE mới nhất (notices[].manualDelivery = { channel, note, at, by }).',
        body: [
          { name: 'channel', type: "'PHONE' | 'REGISTERED_MAIL' | 'IN_PERSON'", required: true },
          { name: 'note', type: 'string 5..500', required: true, note: 'VD gọi số 09… lúc 9:30, thư bảo đảm số …' },
          { name: 'at', type: 'ISO datetime', note: 'thời điểm đã báo, mặc định bây giờ — phải sau lúc lập thông báo cuối, không ở tương lai (422 INVALID_DELIVERY_TIME)' },
        ],
        notes: ['Chưa có thông báo cuối → 422 FINAL_NOTICE_REQUIRED. Ghi nhật ký contract.final_notice_delivery. Là điều kiện để POST /contracts/:id/abandonment khi email thông báo cuối không SENT.'],
      },
      {
        method: 'POST', path: '/contracts/:id/waive-late-fees', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Miễn phí phạt trễ hạn.',
        body: [{ name: 'reason', type: 'string 5..500', required: true }],
        notes: ['Vượt hạn mức miễn giảm trong chính sách → 422 WAIVER_LIMIT.'],
      },
      {
        method: 'POST', path: '/contracts/:id/move-out', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER'], summary: 'Đăng ký ngày trả kho (ngày HẸN). Tiền thuê vẫn được tính cho đến khi nhân viên nhận lại kho — bàn giao trước 00:00 ngày billing.nextBillingDate thì không phát sinh kỳ mới. Chưa bàn giao mà để nợ quá ân hạn (hoặc đã đăng ký lúc đang nợ mà quá ngày hẹn) thì job tự huỷ đăng ký, hợp đồng theo luồng nợ.',
        body: [
          { name: 'date', type: 'date', required: true, note: 'từ hôm nay đến tối đa 30 ngày tới (422 MOVE_OUT_TOO_FAR)' },
          { name: 'reason', type: 'string 5..300', note: 'BẮT BUỘC khi STAFF / FACILITY_MANAGER đăng ký thay khách (thiếu → 422 MOVE_OUT_REASON_REQUIRED, ngắn hơn 5 ký tự → 400) — lưu moveOut.reason / requestedBy, ghi nhật ký, email báo khách (lỗi gửi không làm hỏng thao tác). Khách tự đăng ký thì không cần.' },
        ],
      },
      { method: 'GET', path: '/contracts/:id/extension-quote', auth: R.CUS, summary: 'Báo giá một lần gia hạn (query periods). Gia hạn là cam kết mới: giá niêm yết hiện hành của loại kho, ưu đãi theo số tháng GIA HẠN, thuê tháng không trả trước (payNow = 0), tiền giữ chân giữ nguyên. Trần policy.maxPeriods áp cho TỪNG lần gia hạn (periods > maxPeriods → 422 EXTENSION_TOO_LONG), không cộng dồn thời gian từ ngày bắt đầu.' },
      { method: 'POST', path: '/contracts/:id/write-off-debt', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Xoá nợ còn lại sau quyết toán của hợp đồng ĐÃ ĐÓNG (hư hại + công nợ vượt tiền giữ chân). Trong hạn mức miễn giảm của vai trò (403 WAIVER_LIMIT). Khách trả khoản này qua /pay-balance như công nợ thường.', body: [{ name: 'reason', type: 'string 5..500', required: true }] },
      { method: 'POST', path: '/contracts/:id/damage-adjustment', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Khách khiếu nại biên bản trả kho đúng (Điều 9) → giảm chi phí hư hại của hợp đồng ĐÃ TRẢ KHO. Bắt buộc có phiếu BILLING của khách gắn hợp đồng, gửi trong 7 ngày kể từ ngày lập biên bản (422 NO_DISPUTE). Quyết toán được TÍNH LẠI với mức hư hại mới (trần hoàn trả sớm, thu hồi ưu đãi, tiền thuê trả trước) và đối chiếu tiền đã chuyển: giảm nợ còn lại trước (WAIVER), khách đã trả thừa thì hoàn chuyển khoản (REFUND chờ người KHÁC xác nhận); không đổi gì thì 422 NO_EFFECT. Tổng điều chỉnh ≤ chi phí hư hại (422 OVER_DAMAGE); hạn mức miễn giảm áp trên TỔNG xoá nợ + điều chỉnh của hợp đồng (403 WAIVER_LIMIT). Chỉ tính lại / huỷ / lập lại phần nợ QUYẾT TOÁN (SETTLEMENT_DEBT) và khoản hoàn — các khoản nợ khác sau trả kho (DISPOSAL_FEE phí xử lý đồ để lại…) giữ nguyên, không bị huỷ hay miễn ngầm.', body: [{ name: 'amount', type: 'VND', required: true }, { name: 'reason', type: 'string 5..500', required: true }] },
      { method: 'POST', path: '/contracts/:id/move-out/cancel', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER'], summary: 'Rút đăng ký trả kho, hợp đồng về lại trạng thái trước đó (ACTIVE, hoặc DELINQUENT / LOCKED_OUT nếu đăng ký lúc đang nợ). Chỉ khi kho CHƯA được bàn giao (422 ALREADY_RETURNED nếu nhân viên đã nhận lại).' },
      {
        method: 'POST', path: '/contracts/:id/receive', auth: R.STAFF, summary: 'Xác nhận đã nhận lại ô kho từ khách. Ghi moveOut.returnedOn = hôm nay — mốc quyết toán (trả sớm hay không, đã dùng bao lâu), không dùng ngày khách hẹn; từ đây ngừng tính tiền thuê.',
        body: [{ name: 'handover', type: "{ method: 'CUSTOMER_SIGNATURE', signerName, image } | { method: 'MANAGER_CONFIRM', reason }", required: true, note: 'khách có mặt ký tay trên màn hình (image = PNG data URL ≤ 80KB, như ký DRAWN); khách vắng mặt → CHỈ FACILITY_MANAGER, reason 5..300 (STAFF → 403 HANDOVER_FM_ONLY). Thiếu → 400.' }],
        notes: ['Lưu contract.moveOut.handover = { method, signerName?, image?, reason?, at, by }; ảnh chữ ký không bao giờ gửi ra (bootstrap / GET /contracts / response). Ghi nhật ký unit.receive.'],
      },
      {
        method: 'POST', path: '/contracts/:id/inspection', auth: R.STAFF, summary: 'Biên bản kiểm tra khi trả kho → quyết toán tiền giữ chân và đóng hợp đồng. Nhân viên chỉ ghi chi phí hư hại tối đa 2.000.000 ₫, lớn hơn do Quản lý chi nhánh lập (403 DAMAGE_NEEDS_FM); khách xem biên bản trong tài khoản và khiếu nại trong 7 ngày. Hoàn tiền thuê trả trước của các kỳ gia hạn CHƯA bắt đầu (thuê tháng; cấn vào hư hại / công nợ trước — depositSettlement.prepaidRentRefund / prepaidRentOffset). Bảng mức hoàn lấy theo chính sách đã chốt lúc đặt (quote.policyId). Trả sớm (chỉ với hợp đồng có ưu đãi thuê dài hạn — hợp đồng ngắn / theo ngày / theo tuần không bị giới hạn): áp trần hoàn theo % kỳ hạn đã dùng, rồi THU HỒI ƯU ĐÃI thuê dài hạn vượt mức của số tháng thực dùng (khoản DISCOUNT_CLAWBACK, trừ vào tiền giữ chân; depositSettlement.earlyTermination.discountClawback).',
        body: [
          { name: 'checklist[]', type: '{ item, condition: ItemCondition, note? } ≤100', required: true },
          { name: 'damages[]', type: '{ description, severity: MINOR|MODERATE|SEVERE, cost, photoUrls[] } ≤50', required: true },
          { name: 'notes', type: 'string ≤2000' },
          { name: 'leftItems', type: '{ present: boolean, description?, photoUrls?[] }', required: true, note: 'khách có để lại đồ trong ô không; present = true thì bắt buộc mô tả + ≥ 1 ảnh (422 LEFT_ITEMS_DETAIL_REQUIRED)' },
        ],
        notes: [
          'Kết thúc: hợp đồng CLOSED, đặt chỗ COMPLETED, ô kho về AVAILABLE (hoặc MAINTENANCE nếu có hư hỏng nặng).',
          'leftItems.present = true: ô KHÔNG về AVAILABLE mà sang MAINTENANCE (statusReason "Giữ đồ khách để lại đến dd/mm"), hợp đồng lưu leftover = { description, photoUrls, holdUntil = hôm nay + LEFTOVER_HOLD_DAYS (14), status: HELD }, email báo khách (giữ 14 ngày, sau đó xử lý và tính phí theo Điều 9). Xử lý tiếp bằng POST /contracts/:id/leftover/resolve.',
          'Khoản REFUND chuyển khoản tạo ra ghi createdBy = người lập biên bản — người này không tự xác nhận đã chuyển (403 SAME_APPROVER).',
        ],
      },
      {
        method: 'POST', path: '/contracts/:id/leftover/resolve', auth: ['STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Kết thúc việc giữ đồ khách để lại sau trả kho: khách đến lấy, hoặc quản lý xử lý khi đã hết hạn giữ.',
        body: [
          { name: 'outcome', type: "'PICKED_UP' | 'DISPOSED'", required: true, note: 'PICKED_UP: bất cứ lúc nào (STAFF / FM / OPS). DISPOSED: FACILITY_MANAGER hoặc OPS_MANAGER (STAFF → 403 DISPOSE_FM_ONLY) và chỉ từ ngày leftover.holdUntil (trước đó 422 LEFTOVER_HOLD)' },
          { name: 'fee', type: 'VND 0..50.000.000 (LEFTOVER_FEE_MAX)', note: 'bắt buộc với DISPOSED — trên CLAIM_FM_APPROVAL_LIMIT (5.000.000 ₫) chỉ OPS_MANAGER (FM → 403 DISPOSAL_LIMIT); > 0 thì tạo khoản DISPOSAL_FEE (PENDING) cộng vào balance.outstanding sau quyết toán (chặn đặt kho mới như SETTLEMENT_DEBT, thu qua /pay-balance, xoá nợ qua /write-off-debt)' },
          { name: 'note', type: 'string', note: 'DISPOSED: 3..500 bắt buộc; PICKED_UP: ≤ 500' },
        ],
        notes: ['Không có đồ đang giữ → 422 NO_LEFTOVER. Xong: leftover.status = outcome, ô về AVAILABLE (giữ MAINTENANCE nếu biên bản ghi hư hại cần sửa). Ghi nhật ký contract.leftover_resolve. Trả { contract, unit, fee, paymentId }.'],
      },
      {
        method: 'POST', path: '/contracts/:id/abandonment', auth: ['FACILITY_MANAGER', 'OPS_MANAGER'], summary: 'Xử lý đồ đạc bỏ lại sau hạn chót của thông báo cuối → quyết toán tiền giữ chân + tiền thanh lý, đóng hợp đồng, giải phóng ô.',
        body: [
          { name: 'items[]', type: '{ description, quantity } 1..200', required: true },
          { name: 'disposalMethod', type: 'AUCTION | DONATE | DISCARD', required: true },
          { name: 'notes', type: 'string ≤2000' },
          { name: 'proceeds', type: 'VND', note: 'tiền thu được khi thanh lý, mặc định 0' },
          { name: 'costs', type: 'VND', note: 'chi phí kiểm kê, vận chuyển, thanh lý, mặc định 0 (khoản DISPOSAL_FEE)' },
          { name: 'photoUrls[]', type: 'url 1..20', required: true, note: 'ảnh hiện trạng / kiểm kê khi mở kho — lưu vào inspection.abandonment.photoUrls (thiếu → 400)' },
        ],
        notes: [
          'Chỉ khi LOCKED_OUT, ĐÃ gửi thông báo cuối (422 FINAL_NOTICE_REQUIRED), thông báo cuối ĐÃ TỚI khách — email SENT hoặc có ghi nhận báo bằng kênh khác qua /notices/final/delivery (422 NOTICE_NOT_DELIVERED) — và đã tới hạn chót ghi trong thông báo đó (422 ABANDON_TOO_EARLY).',
          'proceeds hoặc costs > 5.000.000 ₫ (CLAIM_FM_APPROVAL_LIMIT) → chỉ OPS_MANAGER lập (FM → 403 ABANDON_LIMIT). REFUND / LIQUIDATION_PAYOUT tạo ra ghi createdBy = người lập — không tự xác nhận đã chuyển.',
          'Quyết toán: tiền giữ chân rồi tiền thanh lý trừ công nợ + chi phí. Dư → REFUND (tiền giữ chân) / LIQUIDATION_PAYOUT (tiền thanh lý); thiếu → SETTLEMENT_DEBT (chặn đặt kho mới, xoá nợ qua /write-off-debt).',
          'Ghi thông báo ABANDONED (kết quả quyết toán) cho khách.',
        ],
      },
      {
        method: 'GET', path: '/inspections', auth: ['STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER'], summary: '100 biên bản kiểm tra gần nhất của một chi nhánh.',
        query: [{ name: 'facilityId', type: 'ObjectId', required: true }],
      },
    ],
  },
  {
    name: 'Dịch vụ thêm',
    blurb: 'Dịch vụ tuỳ chọn khách đặt sau khi thuê (đóng gói, vận chuyển, vệ sinh...). Danh mục và đơn đi qua GET /bootstrap; danh mục công khai nằm trong GET /facilities/public/:id. Giá riêng từng chi nhánh.',
    routes: [
      {
        method: 'POST', path: '/services/offerings', auth: R.OPS, summary: 'Thêm dịch vụ vào danh mục của một chi nhánh.',
        body: [
          { name: 'facilityId', type: 'ObjectId', required: true },
          { name: 'code', type: 'string [A-Za-z0-9-]{2,30}', required: true, note: 'duy nhất trong chi nhánh' },
          { name: 'name', type: 'string 2..100', required: true },
          { name: 'price', type: 'int ≥ 1.000 (VND)', required: true },
          { name: 'unitLabel', type: 'string ≤20', required: true, note: 'lần, thùng, giờ, chuyến, tháng...' },
          { name: 'description', type: 'string ≤1000' },
        ],
      },
      { method: 'PATCH', path: '/services/offerings/:id', auth: R.OPS, summary: 'Sửa tên/mô tả/giá/đơn vị hoặc ẩn/hiện dịch vụ.', notes: ['Đơn đã đặt giữ nguyên tên và giá đã chốt.'] },
      { method: 'DELETE', path: '/services/offerings/:id', auth: R.OPS, summary: 'Xoá mềm dịch vụ khỏi danh mục.' },
      {
        method: 'POST', path: '/services/orders', auth: R.CUS, summary: 'Đặt dịch vụ cho hợp đồng đang hiệu lực và thanh toán ngay.',
        body: [
          { name: 'contractId', type: 'ObjectId', required: true },
          { name: 'serviceId', type: 'ObjectId', required: true },
          { name: 'quantity', type: 'int 1..99', required: true },
          { name: 'method', type: 'PaymentMethod (≠ INTERNAL, khách không dùng CASH)', required: true },
          { name: 'preferredDate', type: 'date' },
          { name: 'note', type: 'string ≤500' },
        ],
        notes: ['Hợp đồng phải ACTIVE (không công nợ); dịch vụ phải đang bán ở đúng chi nhánh của hợp đồng — ngược lại 422.'],
      },
      { method: 'POST', path: '/services/orders/:id/complete', auth: R.STAFF, summary: 'Xác nhận đã thực hiện xong đơn (REQUESTED → DONE).' },
      {
        method: 'POST', path: '/services/orders/:id/cancel', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER'], summary: 'Huỷ đơn chưa thực hiện, hoàn đủ tiền.',
        body: [{ name: 'reason', type: 'string ≤500' }],
        notes: ['Tạo khoản REFUND và chuyển khoản gốc sang REFUNDED.'],
      },
    ],
  },
  {
    name: 'Mẫu hợp đồng',
    blurb: 'Quản lý vận hành soạn lời văn từng điều của hợp đồng thuê kho và phát hành thành phiên bản (toàn chuỗi hoặc riêng một chi nhánh). Số liệu do hệ thống điền qua biến {{...}}; các câu chứa số tiền / mức hoàn là biến khối không sửa được. Mẫu bất biến; hợp đồng đã ký lưu nguyên văn lúc ký (reservation.signature.clauses).',
    routes: [
      { method: 'GET', path: '/contract-templates/effective', auth: ['OPS_MANAGER', 'ADMIN', 'FACILITY_MANAGER'], summary: 'Mẫu đang áp dụng: riêng chi nhánh (?facilityId) → toàn chuỗi → mặc định hệ thống (version 0).' },
      { method: 'GET', path: '/contract-templates', auth: ['OPS_MANAGER', 'ADMIN', 'FACILITY_MANAGER'], summary: 'Lịch sử phiên bản của một phạm vi (?facilityId, bỏ trống = toàn chuỗi).' },
      {
        method: 'POST', path: '/contract-templates', auth: ['OPS_MANAGER'], summary: 'Phát hành phiên bản mẫu mới.',
        body: [
          { name: 'facilityId', type: 'ObjectId | null', note: 'null = toàn chuỗi' },
          { name: 'clauses[]', type: '{ key, title, numbered, paragraphs[], bullets[] }', required: true, note: 'đủ và đúng thứ tự các điều của mẫu chuẩn' },
          { name: 'note', type: 'string ≤500', note: 'nội dung thay đổi, ghi vào lịch sử' },
        ],
        notes: ['Thiếu biến bắt buộc, có biến lạ / sai cú pháp, thêm-xoá-đổi chỗ điều khoản → 422 TEMPLATE_INVALID (details.errors liệt kê đủ lỗi).'],
      },
      { method: 'DELETE', path: '/contract-templates/facility/:id', auth: ['OPS_MANAGER'], summary: 'Chi nhánh bỏ mẫu riêng, dùng lại mẫu toàn chuỗi.' },
      {
        method: 'GET', path: '/reservations/:id/contract', auth: 'ANY', summary: 'Nội dung hợp đồng của một đặt chỗ để hiển thị (web/app).',
        notes: ['Chưa ký: dựng từ mẫu đang áp dụng. Đã ký: trả đúng NGUYÊN VĂN lúc ký, kể cả khi mẫu đã đổi. Trả { clauses, templateVersion, signed, contractNumber }.'],
      },
    ],
  },
  {
    name: 'Cấp lại mã / thẻ / chìa',
    blurb: 'Khách xin đặt lại mật khẩu, làm lại thẻ khoá hoặc cấp lại chìa khoá; Quản lý chi nhánh xác nhận. Loại yêu cầu do hình thức khoá của ô quyết định. Danh sách đi qua GET /bootstrap. Phí cấp lại theo chính sách (accessFees), trả khi gửi và hoàn đủ nếu bị từ chối/huỷ.',
    routes: [
      {
        method: 'GET', path: '/contracts/:id/access', auth: R.CUS, summary: 'Chủ hợp đồng xem phương tiện vào kho hiện tại (mật khẩu giải mã tại đây).',
        notes: [
          'Chỉ CHỦ hợp đồng — nhân viên/quản lý nhận 403, không ai ngoài chủ thấy mật khẩu. Mỗi lần giải mã ghi nhật ký contract.access_view.',
          'Trả { method, keyTag, suspended, pin, reason }. reason = NOT_PIN (thẻ/chìa), SUSPENDED (đang bị khoá do công nợ) hoặc NOT_STORED (hợp đồng cũ chỉ có bản băm → xin đặt lại).',
          'Mật khẩu lưu mã hoá AES-256-GCM (select:false) — không bao giờ có trong /bootstrap hay danh sách hợp đồng.',
        ],
      },
      {
        method: 'POST', path: '/contracts/:id/assisted-open', auth: R.STAFF, summary: 'Nhân viên mở kho HỘ khách bằng chìa tổng / thẻ tổng (khách mất chìa, mất thẻ, cần vào gấp).',
        body: [
          { name: 'reason', type: 'string 5..300', required: true },
          { name: 'identityVerified', type: 'true', required: true, note: 'nhân viên xác nhận đã đối chiếu tài khoản + giấy tờ của khách; thiếu → 400' },
        ],
        notes: [
          'Hệ thống không điều khiển ổ khoá — endpoint này GHI NHẬT KÝ vào contract.access.assistedOpens + audit (contract.assisted_open); khách xem được trong app.',
          'Ô khoá mật khẩu → 422 NO_MASTER_FOR_PIN (không có mã tổng). Hợp đồng bị khoá do công nợ / đã kết thúc → 422 ACCESS_SUSPENDED.',
        ],
      },
      {
        method: 'POST', path: '/contracts/:id/authorized-persons', auth: R.CUS, summary: 'Chủ hợp đồng đăng ký người được uỷ quyền ra vào / lấy đồ (tối đa 3).',
        body: [
          { name: 'fullName', type: 'string 2..100', required: true },
          { name: 'phone', type: 'số điện thoại VN', required: true },
          { name: 'idNumberLast4', type: '4 chữ số', required: true, note: '4 số cuối giấy tờ tùy thân — nhân viên đối chiếu tại quầy' },
          { name: 'relationship', type: 'string ≤60' },
        ],
        notes: ['Quá 3 người → 422 AUTHORIZED_LIMIT; trùng họ tên + 4 số cuối → 409. Nhân viên thấy danh sách qua contract.authorizedPersons và chọn được khi ghi "mở kho hộ" (authorizedPersonId).'],
      },
      { method: 'DELETE', path: '/contracts/:id/authorized-persons/:personId', auth: R.CUS, summary: 'Chủ hợp đồng xoá một người được uỷ quyền.' },
      {
        method: 'POST', path: '/access-requests', auth: R.CUS, summary: 'Gửi yêu cầu cấp lại (PIN_RESET / CARD_REISSUE / KEY_REISSUE) cho hợp đồng của mình.',
        body: [
          { name: 'contractId', type: 'ObjectId', required: true },
          { name: 'reason', type: 'string ≤300', note: 'VD "mất thẻ"' },
          { name: 'method', type: 'PaymentMethod (≠ INTERNAL, khách không dùng CASH)', note: 'bắt buộc khi phí > 0, ngược lại 422 PAYMENT_METHOD_REQUIRED' },
        ],
        notes: [
          'Hợp đồng ACTIVE / DELINQUENT / MOVE_OUT_PENDING (không LOCKED_OUT). Mỗi hợp đồng chỉ một yêu cầu đang mở — gửi thêm: 409 REQUEST_PENDING.',
          'Phí chốt theo chính sách lúc gửi (mặc định: mật khẩu 0, thẻ 50.000, chìa 0) → tạo khoản ACCESS_FEE.',
          'Mất thẻ / chìa: đặt contract.access.lostReportedAt ngay lúc gửi (thẻ cũ bị vô hiệu); xoá khi bàn giao thẻ mới, bị từ chối hoặc khách huỷ.',
        ],
      },
      {
        method: 'POST', path: '/access-requests/:id/decide', auth: ['FACILITY_MANAGER'], summary: 'Quản lý chi nhánh duyệt hoặc từ chối. Từ chối / chi nhánh huỷ thì thẻ / chìa khách đã báo mất VẪN bị vô hiệu (Điều 5); chỉ khách tự huỷ (tìm lại được) mới dùng lại.',
        body: [{ name: 'approve', type: 'boolean', required: true }, { name: 'note', type: 'string ≤500', note: 'bắt buộc khi từ chối' }],
        notes: [
          'Duyệt PIN_RESET: cấp mật khẩu mới ngay (người duyệt không thấy mã) → DONE. Duyệt thẻ/chìa → APPROVED, chờ nhân viên bàn giao.',
          'Từ chối: hoàn đủ phí (REFUND), yêu cầu REJECTED.',
        ],
      },
      {
        method: 'POST', path: '/access-requests/:id/complete', auth: R.STAFF, summary: 'Nhân viên/quản lý bàn giao thẻ hoặc chìa mới (APPROVED → DONE).',
        body: [{ name: 'keyTag', type: 'string 1..40', required: true, note: 'số thẻ / mã chìa mới — cập nhật vào hợp đồng' }],
      },
      {
        method: 'POST', path: '/access-requests/:id/cancel', auth: ['CUSTOMER', 'FACILITY_MANAGER'], summary: 'Huỷ yêu cầu chưa hoàn tất, hoàn đủ phí.',
        body: [{ name: 'reason', type: 'string ≤500' }],
      },
    ],
  },
  {
    name: 'Thanh toán',
    blurb: 'Bản ghi tài chính chỉ ghi thêm (append-only) — không sửa, không xóa. Mọi số tiền là số nguyên VND.',
    routes: [
      {
        method: 'GET', path: '/payments', auth: 'ANY', summary: 'Lịch sử giao dịch trong phạm vi của người gọi.',
        query: [
          { name: 'page / limit', type: 'int' },
          { name: 'facilityId / contractId', type: 'ObjectId' },
          { name: 'status', type: 'CSV PaymentStatus' },
        ],
        notes: ['Khoản thu tại quầy: recordedBy = nhân viên thu (mọi hình thức), provider.txnRef = mã giao dịch nhân viên nhập (không phải tiền mặt). createdBy = người dùng thao tác tạo ra khoản (khoản chi: không tự xác nhận được).'],
      },
      {
        method: 'GET', path: '/payments/:id/receipt.pdf', auth: ['CUSTOMER', 'STAFF', 'FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'], summary: 'Biên lai PDF ("BIÊN LAI THU TIỀN" / "BIÊN LAI CHI TIỀN") của một khoản: số biên lai (= mã payment), chi nhánh, khách, nội dung (loại khoản + hợp đồng / đặt chỗ + kỳ), số tiền bằng số và chữ, hình thức, mã giao dịch, người thu, thời điểm; ghi chú "Biên lai không thay thế hoá đơn GTGT".',
        notes: [
          'Khách chủ khoản, STAFF / FM đúng chi nhánh (403 FACILITY_SCOPE / OWNERSHIP), OPS, ADMIN.',
          'Chỉ khoản tiền thật đã thu (SUCCEEDED, kể cả đã hoàn về sau) hoặc khoản hoàn / chi đã chuyển (SUCCEEDED); khoản INTERNAL, PENDING, FAILED… → 422 RECEIPT_NOT_AVAILABLE.',
        ],
      },
    ],
  },
  {
    name: 'Yêu cầu hỗ trợ',
    blurb: 'Ticket của khách và việc nội bộ. Tin nhắn internal=true không bao giờ lộ cho khách hàng.',
    routes: [
      {
        method: 'GET', path: '/tickets', auth: 'ANY', summary: 'Danh sách ticket, sắp theo hạn xử lý.',
        query: [
          { name: 'page / limit', type: 'int' },
          { name: 'facilityId', type: 'ObjectId' },
          { name: 'status', type: 'CSV TicketStatus' },
          { name: 'mine', type: "'true' | 'false'", note: 'chỉ ticket được giao cho tôi (không áp dụng cho khách)' },
        ],
      },
      { method: 'GET', path: '/tickets/:id', auth: 'ANY', summary: 'Chi tiết ticket.' },
      {
        method: 'POST', path: '/tickets', auth: 'ANY', summary: 'Tạo ticket mới. Nhân viên / quản lý ghi nhận khiếu nại THAY khách tại quầy: `onBehalfOfCustomer: true` + `contractId` → người báo là khách của hợp đồng, `recordedBy` là người nhập (dùng được làm căn cứ điều chỉnh biên bản trả kho).',
        body: [
          { name: 'facilityId', type: 'ObjectId', required: true },
          { name: 'category', type: 'TicketCategory', required: true },
          { name: 'subject', type: 'string 5..200', required: true },
          { name: 'kind', type: 'TicketKind', note: 'mặc định CUSTOMER_ISSUE' },
          { name: 'priority', type: 'TicketPriority', note: 'mặc định MEDIUM' },
          { name: 'description', type: 'string ≤5000' },
          { name: 'unitId / contractId / assigneeId', type: 'ObjectId | null' },
          { name: 'dueAt', type: 'date | null' },
        ],
        notes: ['category không nhận CONSULTATION — phiếu tư vấn tạo qua POST /tickets/consultation.'],
      },
      {
        method: 'POST', path: '/tickets/consultation', auth: R.CUS, summary: 'Yêu cầu tư vấn trước khi đặt kho (bộ phận kinh doanh của chi nhánh gọi lại).',
        body: [
          { name: 'facilityId', type: 'ObjectId', required: true },
          { name: 'phone', type: 'string', required: true, note: '8–15 chữ số' },
          { name: 'contactWindow', type: 'ANY | MORNING | AFTERNOON | EVENING', note: 'mặc định ANY' },
          { name: 'unitTypeIds', type: 'ObjectId[] ≤5' },
          { name: 'rentalPeriod / periods', type: 'RentalPeriod / int' },
          { name: 'needs', type: '{ reviewContract, vatInvoice, customContract, multipleUnits }: boolean' },
          { name: 'note', type: 'string ≤2000' },
        ],
        notes: [
          'Tạo phiếu loại CONSULTATION vào hàng chờ của chi nhánh (Quản lý chi nhánh phụ trách), khách theo dõi và trả lời trong mục Hỗ trợ.',
          'Không giữ ô kho nào; không cần đã thuê / đặt ở chi nhánh đó. Tối đa 3 phiếu tư vấn đang mở mỗi khách (409 TOO_MANY_CONSULTATIONS).',
        ],
      },
      { method: 'POST', path: '/tickets/:id/assign', auth: R.FM, summary: 'Giao ticket cho nhân viên.', body: [{ name: 'assigneeId', type: 'ObjectId', required: true }] },
      { method: 'POST', path: '/tickets/:id/status', auth: 'ANY', summary: 'Đổi trạng thái ticket theo state machine.', body: [{ name: 'to', type: 'TicketStatus', required: true }] },
      {
        method: 'POST', path: '/tickets/:id/messages', auth: 'ANY', summary: 'Thêm tin nhắn vào ticket.',
        body: [{ name: 'body', type: 'string 1..5000', required: true }, { name: 'internal', type: 'boolean', note: 'mặc định false' }],
      },
    ],
  },
  {
    name: 'Chính sách',
    blurb: 'BusinessPolicy bất biến và có phiên bản: mỗi lần sửa là một version mới, bản cũ giữ nguyên để hợp đồng cũ vẫn tra được.',
    routes: [
      { method: 'GET', path: '/policies/effective/:id', auth: 'ANY', summary: 'Chính sách đang áp dụng cho một chi nhánh (đã trộn GLOBAL + FACILITY).' },
      {
        method: 'GET', path: '/policies', auth: ['OPS_MANAGER', 'ADMIN', 'FACILITY_MANAGER'], summary: 'Lịch sử phiên bản chính sách.',
        query: [{ name: 'facilityId', type: 'ObjectId', note: 'bỏ trống → xem chính sách GLOBAL' }],
      },
      {
        method: 'POST', path: '/policies', auth: R.OPS, summary: 'Xuất bản một phiên bản chính sách mới. Bỏ chính sách riêng của chi nhánh (dùng lại chính sách chung): POST /policies/facility/:facilityId/revert (422 NO_OWN_POLICY nếu không có).',
        body: [
          { name: 'facilityId', type: 'ObjectId | null', required: true, note: 'null = chính sách toàn chuỗi' },
          { name: 'patch.gracePeriodDays', type: 'int 0..60' },
          { name: 'patch.lockoutAfterDays', type: 'int 1..180' },
          { name: 'patch.abandonAfterLockedOutDays', type: 'int 1..365', note: 'sau bao lâu LOCKED_OUT thì FM được xử lý hàng bỏ lại' },
          { name: 'patch.reservationHoldMinutes', type: 'int 5..1440' },
          { name: 'patch.allocationLeadDays', type: 'int 0..60' },
          { name: 'patch.noShowAfterHours', type: 'int 1..168' },
          { name: 'patch.minRentalMonths / maxRentalMonths', type: 'int' },
          { name: 'patch.deposit', type: "{ mode: 'MONTHS_OF_RENT' | 'FIXED', value }" },
          { name: 'patch.lateFees[]', type: '{ afterDays, kind, value, recurringEveryDays } ≤10', note: 'job tính tiền áp đúng chính sách khách đã ký: PERCENT_OF_RENT thu lần đầu khi quá hạn hơn max(afterDays, ân hạn) ngày, lặp lại mỗi recurringEveryDays ngày nếu còn nợ (idempotencyKey late-<hợp đồng>-<paidThrough>[-<chu kỳ>]); FIXED: lần đầu là phí khoá khi khoá truy cập, lặp lại mỗi recurringEveryDays ngày khi vẫn bị khoá (lock-…-<chu kỳ>)' },
          { name: 'patch.cancellation[]', type: '{ minHoursBeforeStart, depositRefundPct } ≤10', note: 'huỷ Reservation trước khi nhận kho' },
          { name: 'patch.earlyTermination[]', type: '{ maxElapsedPct, depositRefundPct } ≤10', note: 'trả kho sớm khi hợp đồng đang OCCUPIED, trần hoàn tiền giữ chân theo % thời gian kỳ hạn đã dùng' },
          { name: 'patch.discounts[]', type: '{ code, kind, value, minPeriods (số THÁNG tối thiểu, chỉ áp cho chu kỳ MONTH; khách hưởng bậc giảm cao nhất đủ điều kiện), validFrom, validTo, requiresApprovalRole } ≤20' },
        ],
        notes: ['patch là strict: gửi field lạ sẽ bị 400 UNKNOWN_FIELD.'],
      },
    ],
  },
  {
    name: 'Quản trị',
    blurb: 'Chỉ ADMIN. Đổi vai trò hoặc phạm vi chi nhánh sẽ thu hồi refresh token trên Firebase → phiên cũ chết ngay.',
    routes: [
      {
        method: 'GET', path: '/users', auth: R.ADMIN, summary: 'Danh sách người dùng.',
        query: [{ name: 'page / limit', type: 'int' }, { name: 'role', type: 'Role' }, { name: 'q', type: 'string ≤100', note: 'tìm theo tên hoặc email' }],
      },
      {
        method: 'POST', path: '/users', auth: R.ADMIN, summary: 'Tạo tài khoản nội bộ.',
        body: [
          { name: 'fullName', type: 'string 2..120', required: true },
          { name: 'email', type: 'email', required: true },
          { name: 'role', type: 'Role', required: true },
          { name: 'facilityIds', type: 'ObjectId[]', note: 'bắt buộc ≥1 với STAFF và FACILITY_MANAGER' },
          { name: 'status', type: 'UserStatus', note: 'mặc định ACTIVE' },
        ],
      },
      {
        method: 'PATCH', path: '/users/:id', auth: R.ADMIN, summary: 'Cập nhật tên, vai trò, phạm vi chi nhánh, ca, giấy uỷ quyền hoặc khóa tài khoản. Khoá / đổi vai trò / chuyển chi nhánh nhân sự thì tự gỡ việc đang giao ở chi nhánh cũ (phiếu về "Chưa giao", lượt chuyển đồ đổi ô bỏ người chuyển) — trả về `releasedAssignments`. Admin không tự khoá chính mình.',
        body: [{ name: 'authorization', type: '{ number, issuedOn: date } | null', note: 'chỉ FACILITY_MANAGER: giấy uỷ quyền của người đại diện theo pháp luật cho quản lý ký hợp đồng thay Bên A — in vào hợp đồng / phụ lục của chi nhánh (cũng nhận ở POST /users)' }],
        notes: ['Đổi role từ CUSTOMER sang vai trò nhân sự hoặc ngược lại → 422 ROLE_CHANGE_FORBIDDEN (tài khoản khách và nhân sự phải tách riêng). Đổi giữa các vai trò nhân sự giữ như cũ.'],
      },
      {
        method: 'GET', path: '/audit', auth: ['ADMIN', 'OPS_MANAGER', 'FACILITY_MANAGER'], summary: 'Nhật ký kiểm toán (chỉ ghi thêm). ADMIN / OPS_MANAGER: toàn chuỗi; FACILITY_MANAGER: chỉ bản ghi của chi nhánh mình (facilityId ngoài phạm vi → 403 FACILITY_SCOPE; bản ghi không gắn chi nhánh không hiện).',
        query: [
          { name: 'page / limit', type: 'int' },
          { name: 'result', type: "'SUCCESS' | 'DENIED' | 'FAILED'" },
          { name: 'action', type: 'string ≤60', note: 'khớp theo tiền tố, ví dụ reservation.' },
          { name: 'facilityId', type: 'ObjectId' },
        ],
      },
    ],
  },
  {
    name: 'Báo cáo',
    blurb: 'FACILITY_MANAGER chỉ thấy chi nhánh của mình; OPS_MANAGER và ADMIN thấy toàn chuỗi.',
    routes: [
      {
        method: 'GET', path: '/reports/summary', auth: ['FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'], summary: 'Tỷ lệ lấp đầy, MRR (giá ngày / tuần quy ra tháng), doanh thu theo tháng (giờ Việt Nam), công nợ: `outstanding` = tổng còn nợ, `overdue` / `overdueContracts` = chỉ phần đã quá hạn (cùng định nghĩa bảng tuổi nợ).',
        query: [
          { name: 'facilityId', type: 'ObjectId', note: 'bỏ trống → toàn bộ chi nhánh trong phạm vi' },
          { name: 'months', type: 'int 1..24', note: 'mặc định 6' },
        ],
        notes: [
          'Trả { facilityIds, occupancyFacilityIds, occupancyScope: ALL | ACTIVE_ONLY, occupancy, revenue, receivables }. Toàn chuỗi (OPS / ADMIN, không facilityId): doanh thu và công nợ tính MỌI chi nhánh kể cả INACTIVE; công suất (occupancy) chỉ chi nhánh ACTIVE (occupancyScope = ACTIVE_ONLY).',
          'revenue[] = { month: YYYY-MM, total, byFacility, deposits: { collected, refunded } } (RevenueMonthRow ở @ssm/shared): total = thực thu − hoàn, KHÔNG gồm tiền giữ chân (DEPOSIT) và khoản hoàn tiền giữ chân; tiền giữ chân thu / hoàn trong tháng báo riêng ở deposits.',
        ],
      },
      {
        method: 'GET', path: '/reports/cash', auth: ['FACILITY_MANAGER', 'OPS_MANAGER', 'ADMIN'], summary: 'Chốt ca tiền mặt theo ngày (giờ VN) của một chi nhánh, nhóm theo nhân viên thu / chi (recordedBy).',
        query: [
          { name: 'facilityId', type: 'ObjectId', required: true, note: 'FM chỉ chi nhánh của mình (403 FACILITY_SCOPE)' },
          { name: 'date', type: 'YYYY-MM-DD', note: 'mặc định hôm nay' },
        ],
        notes: ['Trả { date, facilityId, byStaff: [{ staffId, fullName, collected: { count, total }, paidOut: { count, total } }], totals: { collected, paidOut, net } }. Chỉ payment method CASH: thu = các khoản thu đã nhận (SUCCEEDED, kể cả đã hoàn về sau); chi = REFUND / COMPENSATION / LIQUIDATION_PAYOUT tiền mặt đã chi; net = thu − chi.'],
      },
    ],
  },
];

export const ERROR_CODES: { status: number; code: string; meaning: string }[] = [
  { status: 400, code: 'VALIDATION', meaning: 'Body hoặc query không qua được Zod. details chứa lỗi từng field.' },
  { status: 400, code: 'BAD_ID', meaning: 'ObjectId sai định dạng.' },
  { status: 400, code: 'UNKNOWN_FIELD', meaning: 'Gửi field không có trong schema (strict mode).' },
  { status: 401, code: 'UNAUTHENTICATED', meaning: 'Thiếu hoặc sai Bearer token.' },
  { status: 401, code: 'TOKEN_EXPIRED', meaning: 'ID token hết hạn — lấy token mới bằng getIdToken().' },
  { status: 401, code: 'TOKEN_REVOKED', meaning: 'Phiên bị thu hồi (đổi quyền hoặc khóa tài khoản) — bắt đăng nhập lại.' },
  { status: 403, code: 'PROFILE_NOT_LINKED', meaning: 'Firebase hợp lệ nhưng chưa có hồ sơ — gọi POST /api/auth/sync.' },
  { status: 403, code: 'ACCOUNT_SUSPENDED', meaning: 'Tài khoản đang bị tạm khóa.' },
  { status: 403, code: 'FACILITY_SCOPE', meaning: 'Truy cập chi nhánh ngoài phạm vi được giao (có ghi audit DENIED).' },
  { status: 403, code: 'OWNERSHIP', meaning: 'Khách hàng truy cập bản ghi không phải của mình.' },
  { status: 403, code: 'FORBIDDEN', meaning: 'Vai trò không được phép gọi endpoint này.' },
  { status: 404, code: 'NOT_FOUND', meaning: 'Không tìm thấy bản ghi.' },
  { status: 409, code: 'SOLD_OUT', meaning: 'Loại ô kho đã hết trong khoảng thời gian yêu cầu.' },
  { status: 409, code: 'UNIT_NOT_AVAILABLE', meaning: 'Ô kho vừa bị người khác chiếm (CAS thất bại) — thử lại hoặc chọn ô khác.' },
  { status: 409, code: 'INVALID_STATE_TRANSITION', meaning: 'Chuyển trạng thái không hợp lệ. details có { entity, from, to }.' },
  { status: 409, code: 'DUPLICATE', meaning: 'Vi phạm unique index (đặt trùng ô, trùng mã...).' },
  { status: 409, code: 'CONFLICT', meaning: 'Xung đột nghiệp vụ chung.' },
  { status: 409, code: 'EMAIL_EXISTS', meaning: 'Đặt tại quầy cho khách mới nhưng email đã có tài khoản — tra khách bằng /users/customers/lookup.' },
  { status: 409, code: 'PHONE_EXISTS', meaning: 'Đặt tại quầy cho khách mới nhưng số điện thoại đã gắn với tài khoản khác.' },
  { status: 422, code: 'BUSINESS_RULE', meaning: 'Vi phạm quy tắc nghiệp vụ (mô tả ở message).' },
  { status: 422, code: 'HOLD_EXPIRED', meaning: 'Hết thời gian giữ chỗ — tạo đặt chỗ mới.' },
  { status: 422, code: 'CHECKIN_TOO_EARLY', meaning: 'Nhận kho trước ngày nhận theo lịch — dời ngày nhận về hôm nay (POST /reservations/:id/reschedule) rồi khách ký lại.' },
  { status: 422, code: 'RESCHEDULE_*', meaning: 'Đổi ngày nhận kho bị từ chối: RESCHEDULE_STATE / _PAST / _SAME / _TOO_LATE / _LIMIT / _LOCKED (xem POST /reservations/:id/reschedule).' },
  { status: 422, code: 'WAIVER_LIMIT', meaning: 'Vượt hạn mức miễn giảm phí phạt trong chính sách.' },
  { status: 422, code: 'EMAIL_OTP_REQUIRED', meaning: 'Đặt tại quầy cho khách mới: thiếu mã xác minh email (gửi bằng POST /reservations/walk-in/email-otp).' },
  { status: 422, code: 'EMAIL_OTP_INVALID', meaning: 'Mã xác minh email sai, hoặc đã sai quá 5 lần — gửi mã mới.' },
  { status: 422, code: 'EMAIL_OTP_EXPIRED', meaning: 'Mã xác minh email đã hết hạn (10 phút) — gửi mã mới.' },
  { status: 429, code: 'OTP_COOLDOWN', meaning: 'Vừa gửi mã (ký hợp đồng / xác minh email) — chờ 60 giây rồi gửi lại.' },
  { status: 422, code: 'TXN_REF_REQUIRED', meaning: 'Nhân viên thu tại quầy không bằng tiền mặt mà thiếu mã giao dịch (4..64 ký tự).' },
  { status: 422, code: 'NOTICE_NOT_DELIVERED', meaning: 'Thông báo cuối chưa tới khách (email không SENT, chưa ghi nhận báo bằng kênh khác) — chưa được xử lý đồ bỏ lại.' },
  { status: 422, code: 'MOVE_OUT_REASON_REQUIRED', meaning: 'Nhân viên / quản lý đăng ký trả kho thay khách mà không ghi lý do.' },
  { status: 403, code: 'HANDOVER_FM_ONLY', meaning: 'Nhận lại kho khi khách vắng mặt (MANAGER_CONFIRM) chỉ Quản lý chi nhánh làm.' },
  { status: 422, code: 'LEFT_ITEMS_DETAIL_REQUIRED', meaning: 'Biên bản trả kho ghi khách để lại đồ nhưng thiếu mô tả / ảnh.' },
  { status: 422, code: 'LEFTOVER_HOLD', meaning: 'Đồ khách để lại còn trong thời hạn giữ (đến leftover.holdUntil) — chưa xử lý được.' },
  { status: 422, code: 'NO_LEFTOVER', meaning: 'Hợp đồng không có đồ khách để lại đang giữ.' },
  { status: 403, code: 'DISPOSE_FM_ONLY', meaning: 'Chỉ Quản lý chi nhánh xử lý đồ khách để lại.' },
  { status: 403, code: 'SAME_APPROVER', meaning: 'Người lập / duyệt khoản chi không tự xác nhận đã chi — nhờ người khác.' },
  { status: 403, code: 'PAYOUT_ACCOUNT_OPS', meaning: 'Khách chưa khai tài khoản nhận tiền — chỉ Quản lý vận hành xác nhận chuyển tới tài khoản tự nhập.' },
  { status: 403, code: 'ABANDON_LIMIT', meaning: 'Xử lý đồ bỏ lại có tiền thanh lý / chi phí trên 5.000.000 ₫ — Quản lý vận hành lập.' },
  { status: 422, code: 'RECEIPT_NOT_AVAILABLE', meaning: 'Khoản chưa thu / nội bộ — không có biên lai.' },
  { status: 422, code: 'EMAIL_UNVERIFIED', meaning: 'Gửi lại hợp đồng qua email cho khách chưa có tài khoản đăng nhập và chưa xác minh email.' },
  { status: 422, code: 'EXTENSION_TOO_LONG', meaning: 'Số kỳ của một lần gia hạn vượt policy.maxPeriods.' },
  { status: 409, code: 'LEFTOVER_HELD', meaning: 'Ô đang giữ đồ khách để lại — không đổi trạng thái tay được (xử lý ở mục Đồ đang giữ). Ẩn danh hoá khách còn đồ đang giữ cũng bị chặn (422 LEFTOVER_HELD).' },
  { status: 403, code: 'CANCEL_REASON_FORBIDDEN', meaning: 'Vai trò không được huỷ đặt chỗ với lý do này (CANCEL_REASONS_BY_ROLE).' },
  { status: 422, code: 'CANCEL_NOTE_REQUIRED', meaning: 'Chi nhánh huỷ đặt chỗ phải ghi chú 5–300 ký tự (gửi kèm email báo khách).' },
  { status: 403, code: 'DISPOSAL_LIMIT', meaning: 'Phí xử lý đồ khách để lại trên 5.000.000 ₫ — chỉ Quản lý vận hành.' },
  { status: 409, code: 'FACILITY_HAS_TENANTS', meaning: 'Ngừng hoạt động chi nhánh khi còn hợp đồng mở / đặt chỗ chưa nhận kho — details { contracts, reservations }.' },
  { status: 422, code: 'ID_REQUIRED', meaning: 'Nhận kho / đặt tại quầy khách cũ: thiếu loại giấy tờ + 4 số cuối đọc từ giấy tờ bản gốc.' },
  { status: 422, code: 'ID_MISMATCH', meaning: 'Giấy tờ khách xuất trình khác thông tin khách đã khai — không bàn giao, báo quản lý chi nhánh.' },
  { status: 422, code: 'ROLE_CHANGE_FORBIDDEN', meaning: 'Không đổi vai trò giữa tài khoản khách và nhân sự.' },
  { status: 409, code: 'PRICE_CHANGED', meaning: 'Giá gia hạn đã đổi so với báo giá khách đang xem (expected) — tải lại báo giá.' },
  { status: 422, code: 'LOCKOUT_TOO_EARLY', meaning: 'Chưa đủ ngày quá hạn theo hợp đồng, hoặc chưa tới ngày khoá ghi trong thông báo hết ân hạn (≥ 3 ngày sau khi báo).' },
  { status: 429, code: 'RATE_LIMITED', meaning: 'Thao tác quá nhanh (vd gửi mã xác minh email tại quầy quá 10 lần / 10 phút / nhân viên) — thử lại sau, xem header Retry-After.' },
  { status: 500, code: 'INTERNAL', meaning: 'Lỗi hệ thống. Ngoài production, details có stack trace.' },
];

const docsPayload = (baseUrl: string) => ({
  name: 'Self-Storage Management API',
  version: 1,
  baseUrl,
  auth: {
    scheme: 'Bearer <Firebase ID token>',
    header: 'Authorization: Bearer eyJhbGciOi...',
    flow: ['Đăng nhập Firebase ở client', 'POST /auth/sync một lần', 'GET /bootstrap để dựng màn hình', 'Gọi các endpoint nghiệp vụ'],
    devBypass: 'Khi AUTH_DEV_BYPASS=true (chỉ ở môi trường dev), có thể thay token bằng header x-dev-user: <email>. Bị bỏ qua hoàn toàn khi NODE_ENV=production.',
  },
  conventions: [
    'Mọi số tiền là số nguyên VND (không có phần thập phân).',
    'Ngày dạng YYYY-MM-DD được lưu theo ngày địa phương của chi nhánh lúc 00:00Z.',
    'Danh sách trả { items, total, page, limit }; query page bắt đầu từ 1.',
    'Lỗi luôn có dạng { error: { code, message, details? } } với message tiếng Việt.',
    'POST /reservations và POST /reservations/walk-in nhận header Idempotency-Key để chống bấm hai lần.',
  ],
  groups: API_GROUPS,
  errors: ERROR_CODES,
  // Trình duyệt gọi thẳng Firebase để lấy token — server không bao giờ nhìn thấy mật khẩu.
  login: {
    enabled: Boolean(env.FIREBASE_WEB_API_KEY),
    apiKey: env.FIREBASE_WEB_API_KEY ?? null,
  },
});

const PAGE = (json: string, nonce: string) => `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API · Self-Storage Management</title>
<style nonce="${nonce}">
  :root{--bg:#f7f8fa;--card:#fff;--ink:#16181d;--muted:#6b7280;--line:#e5e7eb;--blue:#2a78d6;--orange:#eb6834;--green:#1baf7a;--code:#f3f4f6}
  @media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#161a21;--ink:#e7e9ee;--muted:#9aa3b2;--line:#252b35;--code:#1c222b}}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.6 ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  a{color:var(--blue)}
  .wrap{display:flex;min-height:100vh;align-items:flex-start}
  aside{position:sticky;top:0;width:250px;flex:none;height:100vh;overflow:auto;padding:20px 12px 40px;border-right:1px solid var(--line)}
  aside h1{font-size:15px;margin:0 8px 4px}
  aside p{margin:0 8px 14px;color:var(--muted);font-size:12px}
  aside a{display:block;padding:6px 8px;border-radius:7px;text-decoration:none;color:var(--ink);font-size:13px}
  aside a:hover{background:var(--code)}
  main{flex:1;min-width:0;padding:26px 30px 80px;max-width:1000px}
  .search{width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);margin-bottom:14px;font-size:13px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:18px}
  h2{font-size:19px;margin:30px 0 6px;scroll-margin-top:16px}
  h2:first-child{margin-top:0}
  .blurb{color:var(--muted);margin:0 0 14px}
  .route{border:1px solid var(--line);border-radius:11px;background:var(--card);padding:13px 15px;margin-bottom:9px}
  .head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .m{font:600 11px/1 ui-monospace,monospace;padding:5px 8px;border-radius:6px;color:#fff;letter-spacing:.4px}
  .GET{background:var(--blue)}.POST{background:var(--green)}.PATCH{background:var(--orange)}.PUT{background:var(--orange)}.DELETE{background:#d33}
  .p{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600}
  .roles{margin-left:auto;display:flex;gap:5px;flex-wrap:wrap}
  .chip{font-size:11px;padding:3px 8px;border-radius:20px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
  .chip.pub{border-color:var(--green);color:var(--green)}
  .chip.any{border-color:var(--blue);color:var(--blue)}
  .sum{margin:8px 0 0;color:var(--ink)}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600}
  td.k{font-family:ui-monospace,monospace;white-space:nowrap}
  td.t{font-family:ui-monospace,monospace;color:var(--muted)}
  .req{color:var(--orange);font-weight:700}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:12px 0 0}
  ul.notes{margin:6px 0 0;padding-left:18px;color:var(--muted)}
  code{background:var(--code);padding:2px 6px;border-radius:5px;font-family:ui-monospace,monospace;font-size:12.5px}
  pre{background:var(--code);padding:11px 13px;border-radius:9px;overflow:auto;font-size:12.5px;margin:8px 0 0}
  .hide{display:none}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .f{flex:1 1 200px;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-size:13px}
  .btn{padding:9px 15px;border:0;border-radius:8px;background:var(--blue);color:#fff;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
  .btn:disabled{opacity:.5;cursor:default}
  .btn.alt{background:var(--green)}
  .tok{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--code);font-family:ui-monospace,monospace;font-size:11.5px;word-break:break-all;max-height:96px;overflow:auto}
  .who{margin-top:8px;font-size:13px}
  .err{color:var(--orange);margin-top:8px;font-size:13px}
  .mt{margin-top:10px}
  .btn.ghost{background:var(--muted)}
  @media (max-width:860px){aside{display:none}main{padding:18px 14px 60px}}
</style></head><body>
<div class="wrap">
  <aside><h1>API Reference</h1><p id="base"></p><nav id="nav"></nav></aside>
  <main>
    <input class="search" id="q" placeholder="Lọc nhanh: gõ đường dẫn, vai trò hoặc từ khóa…" autocomplete="off">
    <div class="panel" id="intro"></div>
    <div class="panel" id="auth"></div>
    <div id="body"></div>
    <h2 id="errors">Mã lỗi</h2>
    <p class="blurb">Mọi lỗi đều trả về <code>{ "error": { "code", "message", "details?" } }</code>.</p>
    <div class="panel"><table id="errtable"><thead><tr><th>HTTP</th><th>Code</th><th>Ý nghĩa</th></tr></thead><tbody></tbody></table></div>
  </main>
</div>
<script id="doc" type="application/json" nonce="${nonce}">${json}</script>
<script nonce="${nonce}">
const D = JSON.parse(document.getElementById('doc').textContent);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const slug = s => s.replace(/\u0111/g,'d').replace(/\u0110/g,'D').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').toLowerCase();

document.getElementById('base').textContent = D.baseUrl;
document.getElementById('intro').innerHTML =
  '<p class="label">Xác thực</p><p>' + esc(D.auth.scheme) + '</p>' +
  '<pre>' + esc(D.auth.header) + '</pre>' +
  '<ul class="notes">' + D.auth.flow.map((f,i) => '<li>' + (i+1) + '. ' + esc(f) + '</li>').join('') + '</ul>' +
  '<p class="label">Dev bypass</p><p class="blurb">' + esc(D.auth.devBypass) + '</p>' +
  '<p class="label">Quy ước</p><ul class="notes">' + D.conventions.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul>' +
  '<p class="label">Thử API trực tiếp</p><p><a href="/api/docs"><strong>Swagger UI</strong> — có nút Try it out</a></p>' +
  '<p class="label">Máy đọc</p><p><a href="/api/openapi.json">OpenAPI 3.0</a> · <a href="/api/docs.json">bản JSON gọn</a> · <a href="/health">GET /health</a></p>';

// ---------------------------------------------------------------- ô lấy token
// Trình duyệt gọi THẲNG Firebase; server này không bao giờ nhận mật khẩu.
const TKEY = 'ssm_api_token';
const A = document.getElementById('auth');
const load = () => { try { return JSON.parse(localStorage.getItem(TKEY) || 'null'); } catch (e) { return null; } };
const alive = t => t && t.token && t.exp > Date.now();
const mins = t => Math.max(0, Math.round((t.exp - Date.now()) / 60000));

if (!D.login.enabled) {
  A.innerHTML = '<p class="label">Lấy token để thử API</p>' +
    '<p class="blurb">Chưa bật. Đặt biến môi trường <code>FIREBASE_WEB_API_KEY</code> cho server ' +
    '(Firebase Console → Project settings → General → Your apps → Web app → <code>apiKey</code>) rồi khởi động lại. ' +
    'Key này vốn public — nó đã nằm trong bundle trình duyệt của Webapp.</p>';
} else {
  A.innerHTML =
    '<p class="label">Lấy token để thử API</p>' +
    '<div class="row">' +
      '<input id="em" class="f" placeholder="email" autocomplete="username">' +
      '<input id="pw" class="f" type="password" placeholder="mật khẩu" autocomplete="current-password">' +
      '<button id="go" class="btn">Đăng nhập</button>' +
    '</div>' +
    '<div id="out"></div>';

  const em = document.getElementById('em');
  const pw = document.getElementById('pw');
  const go = document.getElementById('go');
  const out = document.getElementById('out');

  let timer = null;
  function show(t, who) {
    if (timer) clearInterval(timer);
    out.innerHTML =
      '<div class="who" id="who"></div>' +
      '<div class="tok" id="tk"></div>' +
      '<div class="row">' +
        '<button class="btn" id="cp">Sao chép token</button>' +
        '<button class="btn alt" id="sw">Mở Swagger đã đăng nhập</button>' +
        '<button class="btn ghost" id="out2">Xóa token</button>' +
      '</div>';
    document.getElementById('tk').textContent = t.token;
    const whoEl = document.getElementById('who');
    const tick = () => { whoEl.innerHTML = who + ' · còn <strong>' + mins(t) + ' phút</strong>'; };
    tick(); timer = setInterval(tick, 30000);

    document.getElementById('cp').addEventListener('click', function () {
      navigator.clipboard.writeText(t.token).then(() => { this.textContent = 'Đã sao chép ✓'; setTimeout(() => { this.textContent = 'Sao chép token'; }, 1500); });
    });
    document.getElementById('sw').addEventListener('click', () => { location.href = '/api/docs'; });
    document.getElementById('out2').addEventListener('click', () => {
      localStorage.removeItem(TKEY); if (timer) clearInterval(timer); out.innerHTML = '';
    });
  }

  async function whoami(token) {
    try {
      const r = await fetch(D.baseUrl + '/auth/me', { headers: { authorization: 'Bearer ' + token } });
      const j = await r.json();
      if (r.ok && j.user) return '✅ ' + esc(j.user.fullName || j.user.email || '') + ' — <strong>' + esc(j.user.role) + '</strong>';
      return '⚠️ Firebase OK nhưng API trả ' + r.status + ' ' + esc((j.error && j.error.code) || '');
    } catch (e) { return '⚠️ Không gọi được /auth/me'; }
  }

  async function login() {
    out.innerHTML = ''; go.disabled = true; go.textContent = 'Đang đăng nhập…';
    try {
      const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(D.login.apiKey), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: em.value.trim(), password: pw.value, returnSecureToken: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || 'ĐĂNG NHẬP THẤT BẠI');
      const t = { token: j.idToken, exp: Date.now() + Number(j.expiresIn || 3600) * 1000, email: em.value.trim() };
      localStorage.setItem(TKEY, JSON.stringify(t));
      show(t, await whoami(t.token));
    } catch (e) {
      const m = { EMAIL_NOT_FOUND: 'Email không tồn tại', INVALID_PASSWORD: 'Sai mật khẩu', INVALID_LOGIN_CREDENTIALS: 'Email hoặc mật khẩu không đúng',
        USER_DISABLED: 'Tài khoản bị khóa', TOO_MANY_ATTEMPTS_TRY_LATER: 'Thử quá nhiều lần, đợi ít phút' };
      out.innerHTML = '<div class="err">' + esc(m[e.message] || e.message) + '</div>';
    } finally { go.disabled = false; go.textContent = 'Đăng nhập'; }
  }

  go.addEventListener('click', login);
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  const saved = load();
  if (alive(saved)) { em.value = saved.email || ''; whoami(saved.token).then(w => show(saved, w)); }
}

const roleHtml = a => a === 'PUBLIC' ? '<span class="chip pub">công khai</span>'
  : a === 'ANY' ? '<span class="chip any">mọi vai trò đã đăng nhập</span>'
  : a.map(r => '<span class="chip">' + esc(r) + '</span>').join('');

const fieldTable = (title, rows) => !rows || !rows.length ? '' :
  '<p class="label">' + title + '</p><table><thead><tr><th>Tên</th><th>Kiểu</th><th>Ghi chú</th></tr></thead><tbody>' +
  rows.map(f => '<tr><td class="k">' + esc(f.name) + (f.required ? ' <span class="req">*</span>' : '') +
    '</td><td class="t">' + esc(f.type) + '</td><td>' + esc(f.note || '') + '</td></tr>').join('') + '</tbody></table>';

document.getElementById('body').innerHTML = D.groups.map(g =>
  '<section data-group><h2 id="' + slug(g.name) + '">' + esc(g.name) + '</h2><p class="blurb">' + esc(g.blurb) + '</p>' +
  g.routes.map(r => '<article class="route" data-text="' + esc((r.method + ' ' + r.path + ' ' + r.summary + ' ' + (Array.isArray(r.auth) ? r.auth.join(' ') : r.auth)).toLowerCase()) + '">' +
    '<div class="head"><span class="m ' + r.method + '">' + r.method + '</span>' +
    '<span class="p">' + esc(D.baseUrl.replace(/^https?:\\/\\/[^/]+/, '')) + esc(r.path) + '</span>' +
    '<span class="roles">' + roleHtml(r.auth) + '</span></div>' +
    '<p class="sum">' + esc(r.summary) + '</p>' +
    fieldTable('Query', r.query) + fieldTable('Body', r.body) +
    (r.notes ? '<ul class="notes">' + r.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
    '</article>').join('') + '</section>').join('');

document.getElementById('nav').innerHTML = D.groups.map(g =>
  '<a href="#' + slug(g.name) + '">' + esc(g.name) + '</a>').join('') + '<a href="#errors">Mã lỗi</a>';

document.querySelector('#errtable tbody').innerHTML = D.errors.map(e =>
  '<tr><td class="k">' + e.status + '</td><td class="k">' + esc(e.code) + '</td><td>' + esc(e.meaning) + '</td></tr>').join('');

document.getElementById('q').addEventListener('input', ev => {
  const q = ev.target.value.trim().toLowerCase();
  document.querySelectorAll('#body section').forEach(sec => {
    let any = false;
    sec.querySelectorAll('.route').forEach(r => {
      const hit = !q || r.dataset.text.includes(q);
      r.classList.toggle('hide', !hit);
      any = any || hit;
    });
    sec.classList.toggle('hide', !any);
  });
});
</script></body></html>`;

export const docsRouter = Router();

const baseUrl = (req: { protocol: string; get(h: string): string | undefined }) => `${req.protocol}://${req.get('host') ?? 'localhost'}/api`;

docsRouter.get('/docs.json', (req, res) => {
  res.json(docsPayload(baseUrl(req)));
});

docsRouter.get('/', (req, res) => {
  // JSON nhúng trong <script>: chặn "</script>" và U+2028/2029 để không vỡ trang
  const json = JSON.stringify(docsPayload(baseUrl(req)))
    .replace(/</g, '\\u003c').replace(/\\u2028/g, '\\u2028').replace(/\\u2029/g, '\\u2029');
  // helmet đặt CSP mặc định chặn inline script → nới đúng cho trang này bằng nonce, không dùng 'unsafe-inline'
  const nonce = randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self' https://identitytoolkit.googleapis.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.type('html').send(PAGE(json, nonce));
});
