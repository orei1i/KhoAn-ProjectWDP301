import { CLAIM_CAUSE } from './protection';
import { lastDayOf } from './duration';
import { FACILITY_UTC_OFFSET_HOURS, fmtDate, vnd } from './format';
import {
  ACCESS_METHOD, ACCESS_REQUEST_STATUS, ACCESS_REQUEST_TYPE, CANCELLATION_REASON, CHECK_IN_SHIFT, CLAIM_STATUS, CLAIM_TYPE, CONTRACT_NOTICE, CONTRACT_STATUS, COUNTER_PURPOSE,
  DISPOSAL_METHOD, FACILITY_STATUS, GATEWAY_REFUND_STATE, HANDOVER_METHOD, INSPECTION_OUTCOME, INTAKE_BATCH_STATUS, LEFTOVER_STATUS, MANUAL_DELIVERY_CHANNEL,
  PAYMENT_METHOD, PAYMENT_TYPE, PERIOD_UNIT, PRIVACY_REQUEST_STATUS, PRIVACY_REQUEST_TYPE, RENTAL_PERIOD, RESERVATION_STATUS, ROLE, SERVICE_ORDER_STATUS,
  SIGNING_PREFERENCE, SWAP_METHOD, SWAP_REQUEST_STATUS, TICKET_PRIORITY, TICKET_STATUS, UNIT_CATEGORY, UNIT_STATUS, USER_STATUS,
} from './labels';

/**
 * Nhật ký kiểm toán cho NGƯỜI ĐỌC KHÔNG RÀNH KỸ THUẬT (Admin, Vận hành, Quản lý chi nhánh): một dòng tóm tắt theo từng loại hành động
 * và bảng "Mục | Trước | Sau" với tên mục tiếng Việt, giá trị đã định dạng (tiền ₫, ngày dd/mm/yyyy, nhãn trạng thái, Có/Không, tệp), mã
 * nội bộ (ObjectId) bị ẩn. Mục lạ vẫn hiện tên đọc được và giá trị — không bao giờ in nguyên JSON.
 */

type Obj = Record<string, unknown>;
export interface AuditLike {
  action: string;
  result?: string;
  reason?: string | null;
  changes?: { before?: Obj | null; after?: Obj | null } | null;
}
/** Đổi mã nội bộ (facilityIds, assigneeId…) ra tên người đọc được; không biết thì trả null → mục bị ẩn. */
export type AuditNameResolver = (key: string, id: string) => string | null | undefined;
export interface AuditChangeRow { key: string; label: string; before: string | null; after: string | null }

// ---------------------------------------------------------------- thời gian

const pad = (n: number) => String(n).padStart(2, '0');
/** "15/11/2026 20:45:59" (giờ Việt Nam) — `seconds = false` bỏ giây. */
export function fmtAuditTime(iso?: string | null, seconds = true): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const d = new Date(t + FACILITY_UTC_OFFSET_HOURS * 3_600_000);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${time}`;
}

// ---------------------------------------------------------------- tên mục

const FIELD: Record<string, string> = {
  amount: 'Số tiền', total: 'Tổng tiền', fee: 'Phí', refund: 'Hoàn', refundPct: 'Tỷ lệ hoàn', feeRefund: 'Hoàn phí', servicesRefund: 'Hoàn tiền dịch vụ',
  servicesPaid: 'Tiền dịch vụ', rentPaid: 'Tiền thuê trả trước', rent: 'Tiền thuê kỳ đầu', rentCollected: 'Tiền thuê đã thu', rentPrepaid: 'Đã trả tiền thuê lúc đặt',
  rate: 'Tiền thuê mỗi kỳ', gross: 'Giá niêm yết', discountAmount: 'Ưu đãi', paidNow: 'Trả ngay', payNow: 'Trả ngay', amountDue: 'Dư nợ',
  claimedAmount: 'Số tiền yêu cầu', approvedAmount: 'Số tiền duyệt', liabilityCap: 'Mức chi trả tối đa', capBasis: 'Căn cứ mức chi trả', lockFee: 'Phí khoá',
  damageFee: 'Chi phí hư hại', refundAmount: 'Hoàn tiền giữ chân', shortfall: 'Còn nợ', discountClawback: 'Thu hồi ưu đãi', debt: 'Công nợ', debtCut: 'Trừ vào nợ',
  depositApplied: 'Cấn trừ tiền giữ chân', depositRefund: 'Hoàn tiền giữ chân', prepaidRentRefund: 'Hoàn tiền thuê trả trước', prepaidRentOffset: 'Cấn trừ tiền thuê trả trước',
  creditRefund: 'Hoàn tiền dư', creditOffset: 'Cấn trừ tiền dư', proceeds: 'Tiền thanh lý', costs: 'Chi phí xử lý', expectedAmount: 'Số tiền khách đã xem',
  price: 'Giá', totalValue: 'Tổng giá trị khai', declaredValue: 'Giá trị khai', deposit: 'Tiền giữ chân', estimate: 'Ước tính',
  periods: 'Số kỳ', rentalPeriod: 'Chu kỳ thuê', from: 'Từ ngày', startDate: 'Ngày nhận kho', endDate: 'Dùng đến hết ngày', newEndDate: 'Dùng đến hết ngày', scheduledFor: 'Ngày hẹn',
  deadline: 'Hạn chót', moveDeadline: 'Hạn chuyển đồ', expectedDate: 'Ngày dự kiến', holdUntil: 'Giữ đồ đến', at: 'Lúc', days: 'Số ngày quá hạn',
  daysLeft: 'Còn lại (ngày)', daysSinceNotice: 'Số ngày từ thông báo cuối', lateArrivalDays: 'Đến trễ (ngày)', prepaidPeriods: 'Số kỳ trả trước',
  kind: 'Loại', type: 'Loại', method: 'Hình thức', txnRef: 'Mã giao dịch', reference: 'Mã chứng từ', source: 'Kênh', status: 'Trạng thái',
  role: 'Vai trò', byRole: 'Vai trò người đổi', facilityIds: 'Chi nhánh', facilityId: 'Chi nhánh', shift: 'Ca làm việc', unit: 'Ô kho', toUnit: 'Ô mới',
  unitType: 'Loại kho', unitStatus: 'Trạng thái ô', unitNumber: 'Mã ô', floor: 'Tầng', zone: 'Khu', count: 'Số ô', first: 'Từ ô', last: 'Đến ô',
  code: 'Mã', codes: 'Mã đặt chỗ', contract: 'Hợp đồng', requestNumber: 'Mã yêu cầu', claimNumber: 'Mã bồi thường', orderNumber: 'Mã đơn',
  blockTask: 'Việc khoá thẻ / chìa', service: 'Dịch vụ', services: 'Số dịch vụ kèm', quantity: 'Số lượng', items: 'Số món', itemCount: 'Số món',
  photos: 'Số ảnh', left: 'Còn lại', leftItems: 'Có đồ để lại', name: 'Tên', fullName: 'Họ tên', email: 'Email', phone: 'Số điện thoại',
  address: 'Địa chỉ', line1: 'Địa chỉ', district: 'Quận / huyện', city: 'Tỉnh / thành phố', dob: 'Ngày sinh', idType: 'Loại giấy tờ',
  idNumberLast4: '4 số cuối giấy tờ', idChecked: 'Đã đối chiếu giấy tờ', payoutAccount: 'Tài khoản nhận tiền', bankName: 'Ngân hàng',
  accountNumber: 'Số tài khoản', accountName: 'Chủ tài khoản', note: 'Ghi chú', reason: 'Lý do', cause: 'Nguyên nhân', causeBefore: 'Nguyên nhân trước đó',
  version: 'Phiên bản', scope: 'Phạm vi', termsVersion: 'Bản Điều khoản', privacyVersion: 'Bản Chính sách bảo mật', templateVersion: 'Bản mẫu hợp đồng',
  pledgeVersion: 'Bản cam kết gửi kín', appendix: 'Phụ lục số', onBehalf: 'Nhân viên làm thay', newCustomer: 'Khách mới', emailVerified: 'Email đã xác minh',
  idSupplemented: 'Bổ sung giấy tờ', payAtCounter: 'Trả tại quầy', payOnArrival: 'Trả khi nhận kho', codPaidOnline: 'Đã trả online trước',
  signingPreference: 'Cách ký', signatureVoided: 'Huỷ chữ ký cũ', changeNo: 'Lần đổi', earlyArrival: 'Khách đến sớm', revertEarly: 'Hoàn tác đến sớm',
  handover: 'Cách bàn giao', signerName: 'Người ký', accessReset: 'Cần đặt lại khoá', accessResetPending: 'Còn việc đặt lại khoá', access: 'Hình thức khoá',
  oldAccess: 'Hình thức khoá cũ', accessMethod: 'Hình thức khoá', accessChanged: 'Đổi hình thức khoá', accessReissued: 'Cấp lại thẻ / chìa',
  keyTag: 'Số thẻ / chìa', handedTo: 'Giao cho', presenter: 'Người đến', forAuthorizedPerson: 'Người được uỷ quyền', by: 'Người làm',
  performedBy: 'Người thực hiện', lostReported: 'Báo mất', outcome: 'Kết quả', disposalMethod: 'Cách xử lý', channel: 'Kênh báo', deadlineChanged: 'Đổi hạn chót',
  facilityFault: 'Lỗi do chi nhánh', feePrepay: 'Trả phí trước', feePrepaid: 'Đã trả phí trước', atCounter: 'Thu tại quầy', idempotent: 'Chống gửi trùng',
  auto: 'Tự động', undeclaredItems: 'Món chưa khai giá trị', flagged: 'Món cần lưu ý', recipient: 'Người nhận', sealed: 'Gửi kín', packages: 'Số kiện',
  hasSeal: 'Có niêm phong', edited: 'Nhân viên sửa', addedByStaff: 'Món nhân viên thêm', category: 'Cỡ kho', rates: 'Giá', DAY: 'Theo ngày',
  WEEK: 'Theo tuần', MONTH: 'Theo tháng', isActive: 'Đang mở bán', unitLabel: 'Đơn vị tính', coordinates: 'Toạ độ', openItemsAcknowledged: 'Việc còn mở đã xác nhận',
  gracePeriodDays: 'Ân hạn (ngày)', lockoutAfterDays: 'Khoá sau (ngày quá hạn)', abandonAfterLockedOutDays: 'Xử lý đồ sau khi khoá (ngày)',
  reservationHoldMinutes: 'Giữ chỗ (phút)', allocationLeadDays: 'Xếp ô trước (ngày)', noShowAfterHours: 'Huỷ khi không đến sau (giờ)', minPeriods: 'Số kỳ tối thiểu',
  maxPeriods: 'Số kỳ tối đa', lateFees: 'Phí trễ hạn', cancellation: 'Hoàn khi huỷ', earlyTermination: 'Trả kho sớm', surcharges: 'Phụ phí', discounts: 'Ưu đãi',
  protectionPlans: 'Gói bảo vệ', accessFees: 'Phí cấp lại thẻ / chìa', waiverLimits: 'Hạn mức miễn giảm', PIN_RESET: 'Đặt lại mật khẩu',
  CARD_REISSUE: 'Làm lại thẻ', KEY_REISSUE: 'Cấp lại chìa', mode: 'Cách tính', value: 'Giá trị', state: 'Trạng thái hoàn', action: 'Thao tác',
  transactionStatus: 'Trạng thái VNPAY', expected: 'Số tiền đúng (×100)', reported: 'Số VNPAY báo (×100)', releasedTickets: 'Yêu cầu hỗ trợ được trả về',
  releasedSwaps: 'Yêu cầu đổi ô được trả về', mover: 'Người chuyển đồ', to: 'Gửi tới', demo: 'Chế độ thử', pending: 'Đang chờ', found: 'Tìm thấy', q: 'Từ khoá',
  contractsPruned: 'Hợp đồng đã dọn nhật ký mở kho hộ', auditAnonymized: 'Bản ghi nhật ký đã ẩn danh', gatewayOrdersPurged: 'Giao dịch VNPAY đã dọn',
  accessCutoff: 'Mốc dọn nhật ký ra vào', auditCutoff: 'Mốc ẩn danh nhật ký', sizeChange: 'Đổi cỡ kho', file: 'Tệp',
  priority: 'Mức ưu tiên', dueAt: 'Hạn xử lý', resolution: 'Kết quả xử lý',
  // Xoá tài khoản khách (user.anonymize): số bản ghi đã xoá / sửa và số chứng từ giữ lại — không có dữ liệu cá nhân.
  loginRemoved: 'Xoá tài khoản đăng nhập', erased: 'Đã xoá', kept: 'Giữ lại', profile: 'Hồ sơ (họ tên, email, SĐT, giấy tờ)',
  authorizedPersons: 'Hợp đồng bỏ người được uỷ quyền', signatures: 'Ảnh chữ ký ký hợp đồng', voidedSignatures: 'Đặt chỗ có ảnh chữ ký đã huỷ hiệu lực',
  handoverSignatures: 'Ảnh chữ ký bàn giao kho', payoutAccounts: 'Khoản đã chi bỏ số tài khoản', claimRecipients: 'Hồ sơ bồi thường bỏ tên người nhận',
  gatewayOrders: 'Lệnh VNPAY bỏ tham số / IP', tickets: 'Phiếu hỗ trợ xoá nội dung', ticketMessages: 'Phiếu có tin nhắn của khách bị xoá',
  privacyNotes: 'Ghi chú yêu cầu dữ liệu', serviceOrderNotes: 'Ghi chú đơn dịch vụ', accessRequestReasons: 'Lý do yêu cầu cấp thẻ / chìa',
  swapRequestReasons: 'Lý do yêu cầu đổi ô', contracts: 'Hợp đồng', reservations: 'Đặt chỗ', payments: 'Chứng từ thanh toán', contractFiles: 'Bản scan hợp đồng giấy',
};
const MONEY = new Set([
  'amount', 'total', 'fee', 'refund', 'feeRefund', 'servicesRefund', 'servicesPaid', 'rentPaid', 'rent', 'rentCollected', 'rate', 'gross', 'discountAmount',
  'paidNow', 'payNow', 'amountDue', 'claimedAmount', 'approvedAmount', 'liabilityCap', 'lockFee', 'damageFee', 'refundAmount', 'shortfall', 'discountClawback',
  'debt', 'debtCut', 'depositApplied', 'depositRefund', 'prepaidRentRefund', 'prepaidRentOffset', 'creditRefund', 'creditOffset', 'proceeds', 'costs',
  'expectedAmount', 'price', 'totalValue', 'declaredValue', 'deposit', 'estimate', 'PIN_RESET', 'CARD_REISSUE', 'KEY_REISSUE', 'DAY', 'WEEK', 'MONTH',
]);
const readableKey = (k: string) => {
  const s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase().trim();
  return s ? s[0].toUpperCase() + s.slice(1) : k;
};
export const auditFieldLabel = (key: string) => FIELD[key] ?? readableKey(key);

// ---------------------------------------------------------------- giá trị

type Labels = Record<string, string | { label?: string; title?: string }>;
const pick = (m: Labels | undefined, v: string): string | undefined => {
  const x = m?.[v];
  return x === undefined ? undefined : typeof x === 'string' ? x : x.label ?? x.title;
};
const SIGN_METHOD: Labels = { DRAWN: 'Ký tay trên màn hình', TYPED: 'Gõ họ tên', PAPER: 'Ký giấy' };
const GATEWAY_KIND: Labels = { DEPOSIT: 'Tiền giữ chân', BALANCE: 'Công nợ', EXTEND: 'Gia hạn', SERVICE: 'Dịch vụ', ACCESS_FEE: 'Phí cấp lại thẻ / chìa', SWAP_FEE: 'Phí chuyển đồ', COUNTER: 'Thu tại quầy' };
const SCOPE: Labels = { GLOBAL: 'Toàn chuỗi', FACILITY: 'Riêng chi nhánh' };
const SOURCE: Labels = { WEB: 'Web', MOBILE: 'Ứng dụng', WALK_IN: 'Tại quầy', USER_PAGE: 'Trang Người dùng', PRIVACY_REQUEST: 'Yêu cầu dữ liệu cá nhân' };
const ID_TYPE: Labels = { CCCD: 'CCCD', PASSPORT: 'Hộ chiếu' };
const MODE: Labels = { PERIODS_OF_RENT: 'Theo số kỳ tiền thuê', FIXED: 'Số tiền cố định', PERCENT: 'Phần trăm', PERCENT_OF_RENT: 'Phần trăm tiền thuê' };
const SIDE: Labels = { STAFF: 'Nhân viên', CUSTOMER: 'Khách', AUTHORIZED: 'Người được uỷ quyền', EMAIL: 'Email', PHONE: 'Số điện thoại' };
const STATUS_BY_GROUP: Record<string, Labels> = {
  user: USER_STATUS, auth: USER_STATUS, unit: UNIT_STATUS, ticket: TICKET_STATUS, reservation: RESERVATION_STATUS, access: ACCESS_REQUEST_STATUS,
  privacy: PRIVACY_REQUEST_STATUS, contract: CONTRACT_STATUS, facility: FACILITY_STATUS, service: SERVICE_ORDER_STATUS, swap_request: SWAP_REQUEST_STATUS,
  claim: CLAIM_STATUS, intake: INTAKE_BATCH_STATUS,
};

function enumText(key: string, v: string, action: string): string | undefined {
  switch (key) {
    case 'status': return pick(STATUS_BY_GROUP[action.split('.')[0]], v);
    case 'unitStatus': return pick(UNIT_STATUS, v);
    case 'role': case 'byRole': return pick(ROLE, v);
    case 'method': return pick(PAYMENT_METHOD, v) ?? pick(ACCESS_METHOD, v) ?? pick(SIGN_METHOD, v) ?? pick(SWAP_METHOD, v);
    case 'access': case 'oldAccess': case 'accessMethod': return pick(ACCESS_METHOD, v);
    case 'rentalPeriod': return pick(RENTAL_PERIOD, v);
    case 'kind': return pick(CONTRACT_NOTICE, v) ?? pick(GATEWAY_KIND, v) ?? pick(MODE, v);
    case 'mode': return pick(MODE, v);
    case 'shift': return pick(CHECK_IN_SHIFT, v);
    case 'reason': return pick(CANCELLATION_REASON, v);
    case 'channel': return pick(MANUAL_DELIVERY_CHANNEL, v);
    case 'handover': return pick(HANDOVER_METHOD, v);
    case 'signingPreference': return pick(SIGNING_PREFERENCE, v);
    case 'disposalMethod': return pick(DISPOSAL_METHOD, v);
    case 'outcome': return pick(INSPECTION_OUTCOME, v) ?? pick(LEFTOVER_STATUS, v);
    case 'category': return pick(UNIT_CATEGORY, v);
    case 'type': return pick(CLAIM_TYPE, v) ?? pick(ACCESS_REQUEST_TYPE, v) ?? pick(PRIVACY_REQUEST_TYPE, v) ?? pick(PAYMENT_TYPE, v);
    case 'cause': case 'causeBefore': return pick(CLAIM_CAUSE, v);
    case 'priority': return pick(TICKET_PRIORITY, v);
    case 'scope': return pick(SCOPE, v);
    case 'source': return pick(SOURCE, v);
    case 'idType': return pick(ID_TYPE, v);
    case 'state': return pick(GATEWAY_REFUND_STATE, v);
    case 'by': case 'presenter': return pick(SIDE, v);
    default: return undefined;
  }
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isIdKey = (k: string) => k === '_id' || k === 'id' || /[a-z]Ids?$/.test(k);
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** "Ảnh PNG · 66 KB", "Tệp PDF · 1,2 MB". */
export function fileText(contentType: string, size?: number | null): string {
  const sub = (contentType.split('/')[1] ?? '').split(/[+;]/)[0].toUpperCase().replace('JPEG', 'JPG');
  const kind = contentType.startsWith('image/') ? `Ảnh ${sub}` : `Tệp ${sub || 'đính kèm'}`;
  if (typeof size !== 'number') return kind;
  const s = size < 1024 ? `${size} B` : size < 1_048_576 ? `${Math.round(size / 1024)} KB` : `${(size / 1_048_576).toFixed(1).replace('.', ',')} MB`;
  return `${kind} · ${s}`;
}
const isFileType = (v: unknown): v is string => typeof v === 'string' && /^(image|application|text)\/[\w.+-]+$/.test(v);

/** Giá trị đọc được của một mục; null = ẩn (mã nội bộ). */
function valueText(key: string, v: unknown, action: string, parent?: string): string | null {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (v instanceof Date) v = v.toISOString();
  if (typeof v === 'number') {
    if (MONEY.has(key) || parent === 'rates' || parent === 'accessFees') return vnd(v);
    if (key === 'refundPct') return `${v}%`;
    if (key === 'size') return fileText('application/octet-stream', v).split(' · ')[1];
    return v.toLocaleString('vi-VN');
  }
  if (typeof v === 'string') {
    if (OBJECT_ID.test(v)) return null;
    // Mốc kết thúc lưu kiểu nửa mở (xem lastDayOf): người đọc thấy NGÀY CUỐI được dùng kho, như mọi màn hình khác.
    if (ISO_TIME.test(v)) return (key === 'endDate' || key === 'newEndDate') ? fmtDate(lastDayOf(v)) : /T00:00:00(\.0+)?Z$/.test(v) ? fmtDate(v) : fmtAuditTime(v, false);
    if (isFileType(v)) return fileText(v);
    return enumText(key, v, action) ?? v;
  }
  return String(v);
}

/** Trải một lớp `before` / `after` ra các mục (lồng tối đa 2 cấp; mảng đối tượng ghi số mục). */
function flatten(o: Obj, action: string, names: AuditNameResolver | undefined, out: Map<string, { label: string; text: string }>, path = '', label = '', depth = 0) {
  // Tệp tải lên ({ fileId, size, type }) → một dòng "Ảnh PNG · 66 KB".
  const file = isFileType(o.type) && typeof o.size === 'number';
  if (file) out.set(path ? `${path}.file` : 'file', { label: label ? `${label} · Tệp` : 'Tệp', text: fileText(o.type as string, o.size as number) });
  for (const [k, raw] of Object.entries(o)) {
    if (raw === undefined || (file && (k === 'type' || k === 'size'))) continue;
    const key = path ? `${path}.${k}` : k;
    const lbl = label ? `${label} · ${auditFieldLabel(k)}` : auditFieldLabel(k);
    if (isIdKey(k)) {
      // Mã nội bộ: chỉ hiện khi đổi được ra tên (chi nhánh, người dùng…).
      const ids = (Array.isArray(raw) ? raw : [raw]).filter((x) => x !== null && x !== undefined).map(String);
      const resolved = names ? ids.map((id) => names(k, id)).filter((x): x is string => !!x) : [];
      if (raw === null) out.set(key, { label: lbl, text: '—' });
      else if (resolved.length && resolved.length === ids.length) out.set(key, { label: lbl, text: resolved.join(', ') });
      continue;
    }
    if (isObj(raw)) {
      if (depth < 2) flatten(raw, action, names, out, key, lbl, depth + 1);
      else out.set(key, { label: lbl, text: `${Object.keys(raw).length} mục` });
      continue;
    }
    if (Array.isArray(raw)) {
      if (raw.some((x) => isObj(x) || Array.isArray(x))) { out.set(key, { label: lbl, text: raw.length ? `${raw.length} mục` : '—' }); continue; }
      const parts = raw.map((x) => valueText(k, x, action, path.split('.').pop())).filter((x): x is string => x !== null);
      if (raw.length && !parts.length) continue; // toàn mã nội bộ
      out.set(key, { label: lbl, text: parts.length ? parts.join(', ') : '—' });
      continue;
    }
    const text = valueText(k, raw, action, path.split('.').pop());
    if (text !== null) out.set(key, { label: lbl, text });
  }
}

/** Bảng thay đổi "Mục | Trước | Sau" của một bản ghi. Không có `before` thì cột Trước là null ở mọi dòng. */
export function auditChangeRows(a: AuditLike, names?: AuditNameResolver): AuditChangeRow[] {
  const before = new Map<string, { label: string; text: string }>();
  const after = new Map<string, { label: string; text: string }>();
  if (isObj(a.changes?.before)) flatten(a.changes!.before!, a.action, names, before);
  if (isObj(a.changes?.after)) flatten(a.changes!.after!, a.action, names, after);
  const keys = [...after.keys(), ...[...before.keys()].filter((k) => !after.has(k))];
  return keys.map((k) => ({ key: k, label: (after.get(k) ?? before.get(k))!.label, before: before.get(k)?.text ?? null, after: after.get(k)?.text ?? null }));
}

// ---------------------------------------------------------------- tóm tắt một dòng

const NOTICE_DAYS: Record<string, number> = { EXPIRY_30: 30, EXPIRY_7: 7, EXPIRY_2: 2 };
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v: unknown) => (str(v) ? fmtDate(str(v)) : null);
const lastDay = (v: unknown) => (str(v) ? fmtDate(lastDayOf(str(v)!)) : null);
const money = (v: unknown) => (num(v) !== null ? vnd(num(v)!) : null);
const join = (...xs: (string | null | undefined | false | 0)[]) => xs.filter(Boolean).join(' · ');

/** Các mục khác nhau giữa `before` và `after` (đã bỏ mã nội bộ) — "Đổi vai trò, chi nhánh". */
function changedLabels(a: AuditLike, names?: AuditNameResolver): string[] {
  return auditChangeRows(a, names).filter((r) => r.before !== null && r.after !== null && r.before !== r.after).map((r) => r.label);
}

/**
 * Một dòng tóm tắt cho danh sách nhật ký / "Hoạt động gần đây". Hành động thường gặp có câu riêng (nhắc hết hạn, cập nhật tài khoản,
 * thanh toán, đặt chỗ, hợp đồng…); còn lại dùng lý do, rồi tới vài mục thay đổi đầu tiên. Không có gì để nói thì chuỗi rỗng.
 */
export function auditSummary(a: AuditLike, names?: AuditNameResolver): string {
  const af = (isObj(a.changes?.after) ? a.changes!.after : {}) as Obj;
  const bf = (isObj(a.changes?.before) ? a.changes!.before : {}) as Obj;
  const pay = join(money(af.amount), str(af.method) && pick(PAYMENT_METHOD, af.method as string), str(af.txnRef) && `mã ${af.txnRef}`);
  const specific = ((): string => {
    switch (a.action) {
      case 'contract.expiry_notice': {
        const d = NOTICE_DAYS[str(af.kind) ?? ''] ?? num(af.daysLeft);
        return join(d !== null && d !== undefined ? `Nhắc hết hạn ${d} ngày` : 'Nhắc hết hạn', lastDay(af.endDate) && `hết hạn ${lastDay(af.endDate)}`);
      }
      case 'contract.extend':
        return join(num(af.periods) && `Thêm ${af.periods} kỳ`, lastDay(af.endDate) && `đến hết ${lastDay(af.endDate)}`, num(af.paidNow) && `trả ${vnd(af.paidNow as number)}`);
      case 'contract.delinquent': return join(num(af.days) !== null && `Quá hạn ${af.days} ngày`, num(af.fee) && `phí trễ ${vnd(af.fee as number)}`);
      case 'contract.lockout': return num(af.lockFee) ? `Phí khoá ${vnd(af.lockFee as number)}` : '';
      case 'contract.final_notice': return join(money(af.amountDue) && `Dư nợ ${money(af.amountDue)}`, day(af.deadline) && `hạn chót ${day(af.deadline)}`);
      case 'contract.final_notice_delivery': return join(str(af.channel) && pick(MANUAL_DELIVERY_CHANNEL, af.channel as string), day(af.deadline) && `hạn chót ${day(af.deadline)}`);
      case 'contract.move_out_request': return join(day(af.scheduledFor) && `Hẹn trả kho ${day(af.scheduledFor)}`, af.onBehalf === true && 'nhân viên đăng ký thay');
      case 'contract.move_out_cancel': return day(bf.scheduledFor) ? `Bỏ lịch hẹn ${day(bf.scheduledFor)}` : '';
      case 'contract.move_out_otp': return join(str(af.contract) && `HĐ ${af.contract}`, str(af.to) && `gửi tới ${af.to}`, af.pending === true && 'thư đang gửi');
      case 'contract.move_out_otp_verify': return join(str(af.contract) && `HĐ ${af.contract}`, str(af.to) && `mã OTP gửi tới ${af.to}`);
      case 'unit.receive': return join(str(af.contract) && `HĐ ${af.contract}`, str(af.handover) && pick(HANDOVER_METHOD, af.handover as string), af.otp === 'EMAIL_OTP' && 'xác nhận OTP email', af.accessReset === true && 'đã thu chìa / thẻ');
      case 'contract.move_out_complete': return join(str(af.contract) && `HĐ ${af.contract}`, str(af.handover) && pick(HANDOVER_METHOD, af.handover as string), af.otp === 'EMAIL_OTP' && 'xác nhận OTP email');
      case 'contract.swap_unit': case 'swap_request.complete':
        return join(str(bf.unit) && str(af.unit) && `Ô ${bf.unit} → ${af.unit}`, num(af.fee) && `phí ${vnd(af.fee as number)}`);
      case 'swap_request.create': return join(str(af.requestNumber), str(af.toUnit) && `sang ô ${af.toUnit}`, str(af.method) && pick(SWAP_METHOD, af.method as string));
      case 'reservation.create':
        return join(str(af.code), str(af.unit) && `ô ${af.unit}`, num(af.periods) && str(af.rentalPeriod) && `${af.periods} ${PERIOD_UNIT[af.rentalPeriod as keyof typeof PERIOD_UNIT] ?? ''}`.trim());
      case 'reservation.walk_in': return join(Array.isArray(af.codes) && (af.codes as unknown[]).join(', '), pay);
      case 'reservation.cancel':
        return join(str(af.reason) && (pick(CANCELLATION_REASON, af.reason as string) ?? (af.reason as string)),
          num(af.refund) !== null && `hoàn ${vnd(af.refund as number)}${num(af.refundPct) !== null ? ` (${af.refundPct}% tiền giữ chân)` : ''}`);
      case 'reservation.reschedule': return day(bf.startDate) && day(af.startDate) ? `Ngày nhận ${day(bf.startDate)} → ${day(af.startDate)}` : '';
      case 'reservation.allocate': return str(af.unit) ? `Ô ${af.unit}` : '';
      case 'reservation.check_in': return join(str(af.unit) && `Ô ${af.unit}`, num(af.rentCollected) && `thu ${vnd(af.rentCollected as number)}`);
      case 'reservation.collect_deposit': return join(str(af.code), pay);
      case 'reservation.sign': return str(af.method) ? pick(SIGN_METHOD, af.method as string) ?? '' : '';
      case 'reservation.sign_paper': return isFileType(af.type) ? fileText(af.type, num(af.size)) : '';
      case 'reservation.signing_preference': return join(str(bf.signingPreference) && pick(SIGNING_PREFERENCE, bf.signingPreference as string), str(af.signingPreference) && pick(SIGNING_PREFERENCE, af.signingPreference as string)).replace(' · ', ' → ');
      case 'payment.deposit': return join(money(af.total ?? af.amount), str(af.method) && pick(PAYMENT_METHOD, af.method as string));
      case 'payment.gateway_paid': case 'payment.gateway_unapplied':
        return join(money(af.amount) && `${money(af.amount)} qua VNPAY`, str(af.kind) && pick(GATEWAY_KIND, af.kind as string), str(af.txnRef) && `mã ${af.txnRef}`);
      case 'payment.counter_order': case 'payment.counter_release':
        return join(money(af.amount) && `${money(af.amount)} VNPAY tại quầy`, str(af.purpose) && pick(COUNTER_PURPOSE, af.purpose as string), str(af.txnRef) && `mã ${af.txnRef}`);
      case 'user.update': case 'user.profile_update': case 'user.identity_update': case 'user.payout_account_update': {
        const changed = changedLabels(a, names);
        return changed.length ? `Đổi ${changed.map((x) => x.toLowerCase()).join(', ')}` : '';
      }
      case 'user.anonymize': {
        // "Từ trang Người dùng · ẩn danh hồ sơ, xoá đăng nhập, 2 ảnh chữ ký, … · giữ 3 hợp đồng, 7 chứng từ thanh toán" — chỉ số đếm, không dữ liệu cá nhân.
        const er = (isObj(af.erased) ? af.erased : {}) as Obj;
        const kp = (isObj(af.kept) ? af.kept : {}) as Obj;
        const n = (o: Obj, k: string) => num(o[k]) ?? 0;
        const sig = n(er, 'signatures') + n(er, 'voidedSignatures') + n(er, 'handoverSignatures');
        const text = n(er, 'tickets') + n(er, 'ticketMessages') + n(er, 'privacyNotes') + n(er, 'serviceOrderNotes') + n(er, 'accessRequestReasons') + n(er, 'swapRequestReasons');
        const src = af.source === 'PRIVACY_REQUEST' ? `Theo yêu cầu dữ liệu cá nhân${str(af.requestNumber) ? ` ${af.requestNumber}` : ''}` : af.source === 'USER_PAGE' ? 'Từ trang Người dùng' : null;
        const did = [
          isObj(af.erased) && 'ẩn danh hồ sơ', af.loginRemoved === true && 'xoá đăng nhập', sig > 0 && `${sig} ảnh chữ ký`,
          n(er, 'authorizedPersons') > 0 && `người được uỷ quyền trên ${n(er, 'authorizedPersons')} hợp đồng`,
          n(er, 'payoutAccounts') > 0 && `số tài khoản trên ${n(er, 'payoutAccounts')} khoản đã chi`, text > 0 && `${text} nội dung khách tự viết`,
        ].filter(Boolean).join(', ');
        const keep = [n(kp, 'contracts') > 0 && `${n(kp, 'contracts')} hợp đồng`, n(kp, 'payments') > 0 && `${n(kp, 'payments')} chứng từ thanh toán`].filter(Boolean).join(', ');
        return join(src, did, keep && `giữ ${keep}`);
      }
      case 'user.create': {
        const fac = Array.isArray(af.facilityIds) && names ? (af.facilityIds as unknown[]).map((id) => names('facilityIds', String(id))).filter(Boolean).join(', ') : '';
        return join(str(af.role) && pick(ROLE, af.role as string), fac);
      }
      case 'unit.status': case 'ticket.status': case 'privacy.resolve': {
        const g = STATUS_BY_GROUP[a.action.split('.')[0]];
        return join(str(bf.status) && pick(g, bf.status as string), str(af.status) && pick(g, af.status as string)).replace(' · ', ' → ');
      }
      case 'policy.publish': case 'contract_template.publish':
        return num(af.version) ? `${num(bf.version) ? `Bản ${bf.version} → ` : 'Bản '}${af.version}` : '';
      case 'claim.create': return join(str(af.claimNumber), money(af.claimedAmount) && `yêu cầu ${money(af.claimedAmount)}`);
      case 'claim.approve': return money(af.approvedAmount) ? `Duyệt ${money(af.approvedAmount)}` : '';
      case 'claim.pay': case 'claim.payout_request': return pay;
      case 'service.order': return join(str(af.orderNumber), str(af.service), money(af.total));
      case 'inspection.move_out': return join(money(af.damageFee) && `Hư hại ${money(af.damageFee)}`, money(af.refundAmount) && `hoàn ${money(af.refundAmount)}`, num(af.shortfall) && `còn nợ ${vnd(af.shortfall as number)}`);
      // Đợt 17 — biên bản trả kho ba bước: gửi → (trả lại) → duyệt (ghi phí) → khách xác nhận.
      case 'inspection.move_out_submit': return join(str(af.contract) && `HĐ ${af.contract}`, num(af.damages) !== null && `${af.damages} hư hại`, af.leftItems === true && 'có đồ để lại', af.resubmit === true && 'gửi lại sau khi sửa');
      case 'inspection.move_out_return': return join(str(af.contract) && `HĐ ${af.contract}`, str(af.note) && `Lý do: ${af.note}`);
      case 'inspection.move_out_reopen': return join(str(af.contract) && `HĐ ${af.contract}`, 'mở lại để sửa phí');
      case 'inspection.move_out_approve': return join(str(af.contract) && `HĐ ${af.contract}`, num(af.damageFee) !== null && `phí ${vnd(af.damageFee as number)}`, money(af.refundAmount) && `hoàn dự kiến ${money(af.refundAmount)}`, num(af.shortfall) && `khách trả thêm ${vnd(af.shortfall as number)}`);
      case 'system.retention': return join(num(af.auditAnonymized) && `Ẩn danh ${af.auditAnonymized} bản ghi`, num(af.contractsPruned) && `dọn ${af.contractsPruned} hợp đồng`);
      default: break;
    }
    if (a.action.startsWith('payment.')) return pay;
    if (a.action.startsWith('intake.')) return join(str(af.code), num(af.items) && `${af.items} món`, money(af.totalValue));
    return '';
  })();
  if (specific) return specific;
  if (a.reason) return a.reason;
  return auditChangeRows(a, names).filter((r) => r.after !== null).slice(0, 3).map((r) => `${r.label}: ${r.after}`).join(' · ');
}
