'use client';

import type {
  AbandonedItemsDisposal, AccessMethod, CustomerLookupResult, ExtensionQuote, ContactWindow, ContractTemplate, PrivacyRequest, PrivacyRequestType, ContractTemplateClause, BusinessPolicy, CancellationReason, CheckInShift, ClaimItem, ClaimType, DamageClaim, Facility, InspectionLog,
  IntakeBatch, IntakeBatchItem, IntakeCheckKey,
  PaymentMethod, RentalContract, RentalPeriod, Reservation, Role, StorageUnit, SupportTicket, SwapMethod,
  ManualDeliveryChannel, ServiceOffering, ServiceOrder, SignatureMethod, SigningPreference, TicketCategory, TicketKind, TicketPriority, TicketStatus, UnitCategory, UnitStatus, UnitSwapRequest, User,
} from '@ssm/shared';
import { api } from '@/shared/api/client';

/** Giấy tờ BẢN GỐC người đến quầy xuất trình (mở kho hộ, nhận thẻ / chìa mới): chủ hợp đồng hoặc người được uỷ quyền. */
export type PresentedId = { presenter: 'CUSTOMER' | 'AUTHORIZED'; authorizedPersonId?: string; idType: 'CCCD' | 'PASSPORT'; idNumberLast4: string };

/**
 * Every UI action → one REST call. The server enforces roles, facility scope and state machines;
 * the store refreshes its snapshot afterwards, so pages never patch local state by hand.
 */
const day = (iso: string) => iso.slice(0, 10);
export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export interface BookingLine {
  unitTypeId: string; unitId: string; startDate: string; rentalPeriod: RentalPeriod; periods: number;
  /** Ca giờ khách dự kiến đến nhận kho — chọn ngay lúc đặt; 'UNKNOWN' = "Chưa rõ giờ". */
  preferredCheckInShift: CheckInShift;
  /** Add-on điều hòa khách tự chọn lúc đặt — không gắn với ô cụ thể nào. */
  useAirConditioning: boolean;
  /** Dịch vụ thêm chọn kèm (đơn riêng ngoài hợp đồng thuê) — thanh toán khi nhận kho. */
  services?: { serviceId: string; quantity: number; note?: string }[];
}

/** Một dòng đồ khi khai / sửa đợt nhập hàng — `_id` có khi sửa dòng đã có (server sinh cho dòng mới). */
export type IntakeItemInput = Omit<IntakeBatchItem, '_id'> & { _id?: string };
const intakeItems = (items: IntakeItemInput[]) => items.map((it) => ({
  ...(it._id ? { _id: it._id } : {}), name: it.name.trim(), category: it.category?.trim() || undefined, quantity: it.quantity, estValue: it.estValue,
  condition: it.condition, note: it.note?.trim() || undefined,
}));

/** Chấp thuận lúc đặt chỗ. contractAck: đã mở xem và xác nhận đọc hợp đồng của từng kho — server đóng dấu thời điểm. */
export interface BookingConsent { termsVersion: string; privacyVersion: string; paymentScheduleAck: true; contractAck: true }

/** Khách tra theo email / SĐT tại quầy (GET /users/customers/lookup) — không có 4 số cuối giấy tờ, chỉ biết đã khai hay chưa. */
export type CounterCustomer = CustomerLookupResult;
/** Khách đã có tài khoản hoặc khách mới tạo tại quầy — luôn kèm giấy tờ nhân viên nhập từ bản gốc (server so với số khách đã khai). */
export type WalkInCustomerInput =
  | { customerId: string; idType: 'CCCD' | 'PASSPORT'; idNumberLast4: string }
  | { email: string; fullName: string; phone: string; idType: 'CCCD' | 'PASSPORT'; idNumberLast4: string; emailOtp: string };

/** Mã giao dịch bắt buộc khi thu tại quầy KHÔNG phải tiền mặt (mã chuyển khoản / mã chuẩn chi thẻ / mã VNPay-MoMo). */
const txn = (method: PaymentMethod | undefined, txnRef?: string) => (method && method !== 'CASH' && txnRef?.trim() ? txnRef.trim() : undefined);
export const isTxnRef = (s: string) => { const t = s.trim(); return t.length >= 4 && t.length <= 64; };

/** Bàn giao lúc nhận lại kho: khách ký tay trên màn hình, hoặc Quản lý chi nhánh xác nhận khi khách vắng mặt. */
export type MoveOutHandoverInput =
  | { method: 'CUSTOMER_SIGNATURE'; signerName: string; image: string }
  | { method: 'MANAGER_CONFIRM'; reason: string };

/** Chốt ca tiền mặt theo ngày (GET /reports/cash) — chỉ khoản tiền mặt đã thu / đã chi, theo người thu. */
export interface CashReport {
  date: string; facilityId: string;
  byStaff: { staffId: string; fullName: string; collected: { count: number; total: number }; paidOut: { count: number; total: number } }[];
  totals: { collected: number; paidOut: number; net: number };
}

export const actions = {
  // Khách bắt buộc chọn ô cụ thể (unitId) trên sơ đồ và chu kỳ thuê (rentalPeriod) lúc đặt.
  // payAtCounter: "Giữ chỗ, trả tại quầy" — giữ ô COUNTER_HOLD_HOURS giờ, khách đến quầy trả tiền giữ chân và ký giấy (mỗi khách 1 đặt chỗ như vậy).
  createReservation: async (p: BookingLine & { source?: Reservation['source']; consent: BookingConsent; payAtCounter?: boolean }) =>
    api.post<Reservation>('/reservations', {
      unitTypeId: p.unitTypeId, unitId: p.unitId, startDate: day(p.startDate), rentalPeriod: p.rentalPeriod, periods: p.periods,
      preferredCheckInShift: p.preferredCheckInShift, useAirConditioning: p.useAirConditioning, services: p.services?.length ? p.services : undefined,
      source: p.source === 'MOBILE' ? 'MOBILE' : 'WEB', consent: p.consent, payAtCounter: p.payAtCounter || undefined,
    }, { 'idempotency-key': newKey() }),

  /** Đặt nhiều kho một lần (giỏ hàng) — cùng một lần chấp thuận điều khoản cho toàn giỏ. */
  createReservationsBatch: async (p: { items: BookingLine[]; consent: BookingConsent; payAtCounter?: boolean }) =>
    (await api.post<{ items: Reservation[] }>('/reservations/batch', { items: p.items, consent: p.consent, payAtCounter: p.payAtCounter || undefined }, { 'idempotency-key': newKey() })).items,

  // ---- đặt chỗ tại quầy (walk-in): nhân viên tra / tạo khách, đặt kho và thu tiền giữ chân ngay
  lookupCustomer: async (p: { q: string }) =>
    (await api.get<{ customer: CounterCustomer | null }>(`/users/customers/lookup?q=${encodeURIComponent(p.q.trim())}`)).customer,
  /** Khách mới tại quầy: gửi mã 6 số tới email để xác minh trước khi tạo tài khoản. demoCode chỉ có khi không gửi được mail (môi trường thử). */
  requestWalkInEmailOtp: async (p: { email: string }) =>
    api.post<{ sentTo: string; expiresAt: string; demoCode?: string }>('/reservations/walk-in/email-otp', { email: p.email.trim().toLowerCase() }),
  /** `idempotencyKey` giữ nguyên giữa các lần bấm của cùng một lượt đặt — bấm 2 lần không tạo 2 đặt chỗ. */
  walkInBooking: async (p: { customer: WalkInCustomerInput; items: BookingLine[]; payMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD'; txnRef?: string; consent: BookingConsent; idempotencyKey: string }) =>
    api.post<{ customer: Pick<CounterCustomer, '_id' | 'fullName' | 'email' | 'phone'>; items: Reservation[] }>('/reservations/walk-in', {
      customer: p.customer, payMethod: p.payMethod, txnRef: txn(p.payMethod, p.txnRef), consent: p.consent,
      items: p.items.map((i) => ({ ...i, startDate: day(i.startDate), services: i.services?.length ? i.services : undefined })),
    }, { 'idempotency-key': p.idempotencyKey }),

  payDeposit: async (p: { reservationId: string; method: PaymentMethod }) =>
    api.post<{ reservation: Reservation; qrPayload: string }>(`/reservations/${p.reservationId}/pay-deposit`, { method: p.method }),

  /**
   * Nhân viên thu tiền giữ chân (+ tiền thuê kỳ đầu kho cỡ lớn) của đặt chỗ "trả tại quầy" — đặt chỗ chuyển CONFIRMED → ALLOCATED.
   * Hết hạn giữ → 422 HOLD_EXPIRED. `paymentIds`: các khoản vừa thu, để in biên lai.
   */
  collectDeposit: async (p: { reservationId: string; payMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD'; txnRef?: string }) =>
    api.post<{ reservation: Reservation; qrPayload: string; amount: number; paymentIds: string[] }>(`/reservations/${p.reservationId}/collect-deposit`, { payMethod: p.payMethod, txnRef: txn(p.payMethod, p.txnRef) }),

  cancelReservation: async (p: { reservationId: string; reason: CancellationReason; note?: string }) =>
    (await api.post<{ refund: { pct: number; amount: number } }>(`/reservations/${p.reservationId}/cancel`, { reason: p.reason, note: p.note })).refund.amount,

  /** Đổi ngày nhận kho (khách, hoặc nhân viên khi khách đến sớm). Đã ký thì chữ ký cũ hết hiệu lực — phải ký lại. */
  rescheduleReservation: async (p: { reservationId: string; startDate: string; reason?: string }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/reschedule`, { startDate: day(p.startDate), reason: p.reason?.trim() || undefined }),

  allocate: async (p: { reservationId: string; unitId?: string }) =>
    (await api.post<{ unit: StorageUnit }>(`/reservations/${p.reservationId}/allocate`, p.unitId ? { unitId: p.unitId } : {})).unit,

  unallocate: async (p: { reservationId: string }) => { await api.post(`/reservations/${p.reservationId}/unallocate`); },

  /** `payMethod`: cách thu tiền thuê kỳ đầu tại quầy — bỏ trống với kho cỡ lớn (đã thu cùng lúc đặt chỗ). */
  // identityVerified: nhân viên đã đối chiếu giấy tờ bản gốc; idType / idNumberLast4 LUÔN nhập theo giấy tờ khách xuất trình — server so với số khách đã khai.
  // goodsCheck: KHÔNG còn dùng ở nhận kho (kiểm hàng cấm làm ở từng đợt nhập hàng) — giữ tham số cho tương thích, màn nhận kho không gửi.
  checkIn: async (p: { reservationId: string; keyTag?: string; payMethod?: PaymentMethod; txnRef?: string; idType: 'CCCD' | 'PASSPORT'; idNumberLast4: string; goodsCheck?: { confirmed: string[]; note?: string; photoUrls?: string[] } }) =>
    api.post<{ contract: RentalContract; unit: StorageUnit; pin?: string }>(`/reservations/${p.reservationId}/check-in`, { keyTag: p.keyTag, payMethod: p.payMethod, txnRef: txn(p.payMethod, p.txnRef), identityVerified: true, idType: p.idType, idNumberLast4: p.idNumberLast4, goodsCheck: p.goodsCheck }),

  /** `reason`: bắt buộc khi nhân viên / quản lý đăng ký trả kho THAY khách (khách được email báo). */
  requestMoveOut: async (p: { contractId: string; date: string; reason?: string }) => { await api.post(`/contracts/${p.contractId}/move-out`, { date: day(p.date), reason: p.reason?.trim() || undefined }); },
  /** Xoá nợ còn lại sau quyết toán của hợp đồng đã đóng (FM / Ops, trong hạn mức miễn giảm). */
  writeOffDebt: async (p: { contractId: string; reason: string }) => (await api.post<{ amount: number }>(`/contracts/${p.contractId}/write-off-debt`, { reason: p.reason })).amount,
  // Khiếu nại biên bản trả kho đúng → giảm chi phí hư hại: trừ nợ còn lại trước, phần dư hoàn khách (chuyển khoản chờ xác nhận).
  adjustDamage: async (p: { contractId: string; amount: number; reason: string }) =>
    api.post<{ debtCut: number; refund: number }>(`/contracts/${p.contractId}/damage-adjustment`, { amount: p.amount, reason: p.reason }),
  cancelMoveOut: async (p: { contractId: string }) => { await api.post(`/contracts/${p.contractId}/move-out/cancel`); },
  receiveUnit: async (p: { contractId: string; handover: MoveOutHandoverInput }) => { await api.post(`/contracts/${p.contractId}/receive`, { handover: p.handover }); },

  // leftItems: đồ khách để lại trong ô (bắt buộc khai) — có thì mô tả + ít nhất 1 ảnh, ô được giữ LEFTOVER_HOLD_DAYS ngày.
  submitInspection: async (p: { contractId: string; checklist: InspectionLog['checklist']; damages: InspectionLog['damages']; notes?: string; leftItems: { present: boolean; description?: string; photoUrls?: string[] } }) =>
    (await api.post<{ inspection: InspectionLog }>(`/contracts/${p.contractId}/inspection`, { checklist: p.checklist, damages: p.damages, notes: p.notes || undefined, leftItems: p.leftItems })).inspection,
  /** Đồ để lại sau trả kho: khách đã lấy (bất cứ lúc nào), hoặc Quản lý xử lý từ ngày hết hạn giữ (kèm phí, có thể 0). */
  resolveLeftover: async (p: { contractId: string; outcome: 'PICKED_UP' } | { contractId: string; outcome: 'DISPOSED'; fee: number; note: string }) => {
    const { contractId, ...body } = p; await api.post(`/contracts/${contractId}/leftover/resolve`, body);
  },

  /** Hàng bỏ lại khi LOCKED_OUT quá lâu (FM) — kiểm kê + phương án xử lý, mất tiền giữ chân, đóng hợp đồng. */
  processAbandonment: async (p: { contractId: string; items: { description: string; quantity: number }[]; disposalMethod: AbandonedItemsDisposal; notes?: string; proceeds: number; costs: number; photoUrls: string[] }) =>
    (await api.post<{ inspection: InspectionLog }>(`/contracts/${p.contractId}/abandonment`, { items: p.items, disposalMethod: p.disposalMethod, notes: p.notes || undefined, proceeds: p.proceeds, costs: p.costs, photoUrls: p.photoUrls })).inspection,
  /** Thông báo cuối trước khi được xử lý đồ bỏ lại (hợp đồng đang bị khoá, mỗi đợt nợ một lần). */
  sendFinalNotice: async (p: { contractId: string; note?: string }) => { await api.post(`/contracts/${p.contractId}/final-notice`, { note: p.note?.trim() || undefined }); },
  /** Email thông báo cuối không tới được khách → quản lý ghi nhận đã báo bằng kênh khác (gọi điện / thư bảo đảm / trực tiếp). */
  recordFinalNoticeDelivery: async (p: { contractId: string; channel: ManualDeliveryChannel; note: string; at?: string }) => {
    await api.post(`/contracts/${p.contractId}/notices/final/delivery`, { channel: p.channel, note: p.note.trim(), at: p.at || undefined });
  },

  /**
   * Gia hạn = cam kết mới. `method` chỉ cần khi phải trả ngay (thuê ngày / tuần); thuê tháng trả theo từng tháng. Trả về số tiền thu ngay.
   * `expected`: giá mỗi kỳ (`rate`), số phải trả ngay (`payNow`), ngày bắt đầu (`from`) và ngày hết hạn mới (`newEndDate`) của báo giá khách
   * đang xem — giá đổi hoặc hợp đồng vừa được gia hạn thì server trả PRICE_CHANGED.
   * `idempotencyKey`: giữ nguyên cho cùng một báo giá — bấm 2 lần / mạng chập chờn gửi lại không gia hạn 2 lần.
   */
  extendContract: async (p: { contractId: string; periods: number; method?: PaymentMethod; acceptAppendix: boolean; expected: Pick<ExtensionQuote, 'rate' | 'payNow' | 'from' | 'newEndDate'>; idempotencyKey: string }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/extend`, {
      periods: p.periods, method: p.method, acceptAppendix: p.acceptAppendix,
      expected: { rate: p.expected.rate, payNow: p.expected.payNow, from: p.expected.from, newEndDate: p.expected.newEndDate },
    }, { 'idempotency-key': p.idempotencyKey })).amount,

  payBalance: async (p: { contractId: string; method: PaymentMethod; txnRef?: string }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/pay-balance`, { method: p.method, txnRef: txn(p.method, p.txnRef) })).amount,

  lockout: async (p: { contractId: string }) => { await api.post(`/contracts/${p.contractId}/lockout`); },

  /** Đổi ô kho cùng loại. Giá thuê và tiền giữ chân của hợp đồng không đổi — server từ chối nếu ô mới khác loại. */
  swapUnit: async (p: { contractId: string; toUnitId: string; reason: string; keyTag?: string; fee?: number; facilityFault?: boolean }) =>
    (await api.post<{ fromUnit: StorageUnit; toUnit: StorageUnit; fee: number }>(`/contracts/${p.contractId}/swap-unit`, {
      toUnitId: p.toUnitId, reason: p.reason, keyTag: p.keyTag || undefined, fee: p.fee || undefined, facilityFault: p.facilityFault || undefined,
    })).toUnit,

  waiveLateFees: async (p: { contractId: string; reason: string }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/waive-late-fees`, { reason: p.reason })).amount,

  setUnitStatus: async (p: { unitId: string; to: UnitStatus; reason?: string }) => { await api.patch(`/units/${p.unitId}/status`, { to: p.to, reason: p.reason }); },

  addUnit: async (p: { unitTypeId: string; unitNumber: string; floor: number; zone?: string; accessMethod: AccessMethod }) => { await api.post('/units', { ...p, zone: p.zone || undefined }); },

  /** Thêm nhiều ô liền mã (VD "M2-" từ 1, 12 ô → M2-01…M2-12) cùng tầng/khu/hình thức khoá. */
  addUnitsBulk: async (p: { unitTypeId: string; prefix: string; start: number; count: number; floor: number; zone?: string; accessMethod: AccessMethod }) =>
    (await api.post<{ count: number }>('/units/bulk', { ...p, zone: p.zone || undefined })).count,

  updateUnit: async (p: { unitId: string; unitNumber: string; floor: number; zone?: string; accessMethod: AccessMethod }) => {
    await api.patch(`/units/${p.unitId}`, { unitNumber: p.unitNumber, floor: p.floor, zone: p.zone ?? '', accessMethod: p.accessMethod });
  },

  deleteUnit: async (p: { unitId: string }) => { await api.delete(`/units/${p.unitId}`); },

  // ---- loại tủ/phòng thuê (Quản lý vận hành)
  createUnitType: async (p: { facilityId: string; code: string; name: string; category: UnitCategory; description?: string; widthM: number; depthM: number; heightM: number; indoor: boolean; rates: Record<RentalPeriod, number>; minPeriods: number; depositOverride?: number | null }) => {
    const { facilityId, ...body } = p;
    await api.post(`/facilities/${facilityId}/unit-types`, { ...body, description: body.description || undefined });
  },

  updateUnitType: async (p: { unitTypeId: string; name?: string; description?: string; widthM?: number; depthM?: number; heightM?: number; indoor?: boolean; rates?: Partial<Record<RentalPeriod, number>>; minPeriods?: number; depositOverride?: number | null; isActive?: boolean }) => {
    const { unitTypeId, ...body } = p;
    await api.patch(`/facilities/unit-types/${unitTypeId}`, body);
  },

  deleteUnitType: async (p: { unitTypeId: string }) => { await api.delete(`/facilities/unit-types/${p.unitTypeId}`); },

  deleteFacility: async (p: { facilityId: string }) => { await api.delete(`/facilities/${p.facilityId}`); },

  // ---- dịch vụ thêm sau khi thuê: danh mục giá riêng từng chi nhánh (Ops) + đơn của khách
  createServiceOffering: async (p: { facilityId: string; code: string; name: string; description?: string; price: number; unitLabel: string }) =>
    api.post<ServiceOffering>('/services/offerings', { ...p, description: p.description || undefined }),

  updateServiceOffering: async (p: { serviceId: string; name?: string; description?: string; price?: number; unitLabel?: string; isActive?: boolean }) => {
    const { serviceId, ...body } = p;
    await api.patch(`/services/offerings/${serviceId}`, body);
  },

  deleteServiceOffering: async (p: { serviceId: string }) => { await api.delete(`/services/offerings/${p.serviceId}`); },

  orderService: async (p: { contractId: string; serviceId: string; quantity: number; preferredDate?: string; note?: string; method: PaymentMethod }) =>
    api.post<ServiceOrder>('/services/orders', { ...p, preferredDate: p.preferredDate ? day(p.preferredDate) : undefined, note: p.note || undefined }),

  completeServiceOrder: async (p: { orderId: string }) => { await api.post(`/services/orders/${p.orderId}/complete`); },

  cancelServiceOrder: async (p: { orderId: string; reason?: string }) => { await api.post(`/services/orders/${p.orderId}/cancel`, { reason: p.reason || undefined }); },

  // Yêu cầu cấp lại mật khẩu / thẻ / chìa — Quản lý chi nhánh duyệt, nhân viên bàn giao thẻ/chìa.
  decideAccessRequest: async (p: { requestId: string; approve: boolean; note?: string }) => { await api.post(`/access-requests/${p.requestId}/decide`, { approve: p.approve, note: p.note || undefined }); },

  /** Phát hành phiên bản mẫu hợp đồng mới (facilityId null = toàn chuỗi). Server kiểm tra lại đủ điều khoản + biến bắt buộc. */
  publishContractTemplate: async (p: { facilityId: string | null; clauses: ContractTemplateClause[]; note?: string }) =>
    api.post<ContractTemplate>('/contract-templates', { facilityId: p.facilityId, clauses: p.clauses, note: p.note }),

  /** Chi nhánh bỏ mẫu hợp đồng riêng, dùng lại mẫu toàn chuỗi. */
  retireFacilityTemplate: async (p: { facilityId: string }) => { await api.delete(`/contract-templates/facility/${p.facilityId}`); },

  /**
   * Nhân viên mở kho hộ khách bằng chìa tổng / thẻ tổng — kèm giấy tờ bản gốc người đến quầy xuất trình (server so khớp, sai → ID_MISMATCH)
   * và ghi nhật ký vào hợp đồng.
   */
  assistedOpen: async (p: { contractId: string; reason: string } & PresentedId) => { const { contractId, ...body } = p; await api.post(`/contracts/${contractId}/assisted-open`, body); },

  /**
   * Quản lý chi nhánh mở khoá đối chiếu giấy tờ (nhập sai nhiều lần → 423 ID_CHECK_LOCKED) của hợp đồng (mở hộ / giao thẻ, chìa) hoặc
   * đặt chỗ (nhận kho). Bắt buộc lý do — ghi nhật ký.
   */
  unlockIdCheck: async (p: { kind: 'contracts' | 'reservations'; id: string; reason: string }) => { await api.post(`/${p.kind}/${p.id}/id-check/unlock`, { reason: p.reason.trim() }); },

  /** Chủ hợp đồng đăng ký / xoá người được uỷ quyền ra vào kho (tối đa 3). */
  addAuthorizedPerson: async (p: { contractId: string; fullName: string; phone: string; idNumberLast4: string; relationship?: string }) => {
    await api.post(`/contracts/${p.contractId}/authorized-persons`, { fullName: p.fullName, phone: p.phone, idNumberLast4: p.idNumberLast4, relationship: p.relationship || undefined });
  },
  removeAuthorizedPerson: async (p: { contractId: string; personId: string }) => { await api.delete(`/contracts/${p.contractId}/authorized-persons/${p.personId}`); },

  /** Bàn giao thẻ / chìa mới — người nhận xuất trình giấy tờ bản gốc như khi mở hộ. */
  completeAccessRequest: async (p: { requestId: string; keyTag: string } & PresentedId) => { const { requestId, ...body } = p; await api.post(`/access-requests/${requestId}/complete`, body); },

  /** Khách xin cấp lại phương tiện vào kho (đặt lại mật khẩu / làm lại thẻ / cấp lại chìa). Có phí thì trả ngay khi gửi. */
  requestAccess: async (p: { contractId: string; reason?: string; method?: PaymentMethod }) =>
    api.post<{ requestNumber: string }>('/access-requests', { contractId: p.contractId, reason: p.reason || undefined, method: p.method }),
  cancelAccessRequest: async (p: { requestId: string; reason?: string }) => { await api.post(`/access-requests/${p.requestId}/cancel`, { reason: p.reason || undefined }); },

  /** Khách đồng ý lại bản Điều khoản + Chính sách bảo mật hiện hành (khi `user.consentRequired`) — server lưu thời điểm, IP. */
  acceptLegal: async (p: { termsVersion: string; privacyVersion: string }) => { await api.post('/auth/me/consent', { termsVersion: p.termsVersion, privacyVersion: p.privacyVersion }); },
  updateMyProfile: async (p: { fullName?: string; phone?: string; idType?: 'CCCD' | 'PASSPORT'; idNumberLast4?: string; payoutAccount?: { bankName: string; accountNumber: string; accountName: string } | null }) => api.patch<{ user: User }>('/auth/me', p),
  /** Nhân viên / quản lý sửa họ tên, giấy tờ khách tại quầy (đã đối chiếu bản gốc) — theo đặt chỗ hoặc hợp đồng của khách. */
  updateCustomerIdentity: async (p: { kind: 'reservations' | 'contracts'; id: string; fullName?: string; idType?: 'CCCD' | 'PASSPORT'; idNumberLast4?: string; reason: string }) => {
    const { kind, id, ...body } = p; await api.patch(`/${kind}/${id}/customer-identity`, body);
  },
  /** Xác nhận đã chuyển khoản một khoản hoàn đang chờ (mã giao dịch ngân hàng). */
  confirmPayout: async (p: { paymentId: string; reference: string; toAccount?: string }) => { await api.post(`/payments/${p.paymentId}/confirm-payout`, { reference: p.reference, toAccount: p.toAccount || undefined }); },
  // ---- quyền dữ liệu cá nhân (Nghị định 13/2023)
  createPrivacyRequest: async (p: { type: PrivacyRequestType; note?: string }) => api.post<PrivacyRequest>('/privacy-requests', { type: p.type, note: p.note || undefined }),
  resolvePrivacyRequest: async (p: { id: string; status: 'DONE' | 'REJECTED'; response: string }) => { await api.post(`/privacy-requests/${p.id}/resolve`, { status: p.status, response: p.response }); },
  anonymizeCustomer: async (p: { userId: string; reason: string; requestId?: string }) => { await api.post(`/users/${p.userId}/anonymize`, { reason: p.reason, requestId: p.requestId }); },
  emailContract: async (p: { reservationId: string }) => api.post<{ sent: true; to: string }>(`/reservations/${p.reservationId}/contract/email`),

  // ---- ký hợp đồng sau khi trả tiền giữ chân (khách tự ký, hoặc nhân viên cho khách ký tại quầy)
  // Ký online cần mã OTP gửi qua email (requestSignOtp). demoCode chỉ có với tài khoản demo (email bị chặn gửi).
  requestSignOtp: async (p: { reservationId: string }) =>
    api.post<{ sentTo: string; expiresAt: string; demoCode?: string }>(`/reservations/${p.reservationId}/sign-otp`),
  signContract: async (p: { reservationId: string; signerName: string; method: Exclude<SignatureMethod, 'PAPER'>; image?: string | null; otp: string }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/sign`, { signerName: p.signerName, method: p.method, image: p.image ?? null, otp: p.otp }),
  /** Khách chọn ký online (OTP) hay ký giấy tại quầy khi đến nhận kho — chỉ khi đã trả giữ chân, chưa ký, chưa nhận kho. */
  setSigningPreference: async (p: { reservationId: string; preference: SigningPreference }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/signing-preference`, { preference: p.preference }),
  /** Khách ký hợp đồng GIẤY tại quầy: nhân viên tải bản scan (PDF / JPG / PNG ≤ 5MB, base64 không kèm tiền tố data:). */
  signPaper: async (p: { reservationId: string; signerName: string; file: { name: string; contentType: string; base64: string } }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/sign-paper`, { signerName: p.signerName, file: p.file }),

  // Khách yêu cầu tư vấn trước khi đặt kho — tạo phiếu CONSULTATION cho chi nhánh, không giữ ô.
  requestConsultation: async (p: { facilityId: string; unitTypeIds: string[]; rentalPeriod: RentalPeriod; periods: number; phone: string; contactWindow: ContactWindow; needs: { reviewContract: boolean; vatInvoice: boolean; customContract: boolean; multipleUnits: boolean }; note?: string }) =>
    api.post<SupportTicket>('/tickets/consultation', p),
  // onBehalfOfCustomer: nhân viên / quản lý ghi nhận THAY khách tại quầy (cần contractId) — phiếu đứng tên khách của hợp đồng.
  createTicket: async (p: { facilityId: string; kind: TicketKind; category: TicketCategory; priority: TicketPriority; subject: string; description: string; unitId?: string | null; contractId?: string | null; assigneeId?: string | null; dueAt?: string | null; onBehalfOfCustomer?: boolean }) =>
    api.post<SupportTicket>('/tickets', { ...p, description: p.description || undefined }),

  assignTicket: async (p: { ticketId: string; assigneeId: string }) => { await api.post(`/tickets/${p.ticketId}/assign`, { assigneeId: p.assigneeId }); },
  setTicketStatus: async (p: { ticketId: string; to: TicketStatus }) => { await api.post(`/tickets/${p.ticketId}/status`, { to: p.to }); },
  addTicketMessage: async (p: { ticketId: string; body: string; internal?: boolean }) => { await api.post(`/tickets/${p.ticketId}/messages`, { body: p.body, internal: !!p.internal }); },

  // ---- bồi thường hư hỏng / mất mát
  // photoUrls: link ảnh chứng cứ (https) — chưa có tải ảnh lên. items[].intakeItemId: đồ chọn từ "Đồ đang gửi"; thiếu = đồ ngoài danh sách
  // (server tự gắn cờ undeclared — không gửi cờ này lên).
  createClaim: async (p: { contractId: string; type: ClaimType; incidentAt: string; description: string; items: ClaimItem[]; ticketId?: string | null; photoUrls?: string[] }) =>
    api.post<DamageClaim>('/claims', {
      ...p, ticketId: p.ticketId || undefined, photoUrls: p.photoUrls?.length ? p.photoUrls : undefined,
      items: p.items.map(({ name, quantity, unitValue, note, intakeItemId }) => ({ name, quantity, unitValue, note: note || undefined, ...(intakeItemId ? { intakeItemId } : {}) })),
    }),

  // ---- nhập hàng nhiều đợt: khách khai đồ mỗi lần mang vào, nhân viên kiểm hàng cấm rồi xác nhận
  /**
   * Khai đợt nhập cho hợp đồng. Nhân viên / quản lý tạo THAY khách tại quầy: `onBehalf` + `goodsCheck` (đủ INTAKE_CHECK_ITEMS) → khai và
   * xác nhận một bước.
   */
  declareIntake: async (p: { contractId: string; items: IntakeItemInput[]; expectedDate?: string; onBehalf?: boolean; goodsCheck?: { confirmed: IntakeCheckKey[]; note?: string }; staffNote?: string }) =>
    api.post<IntakeBatch>(`/contracts/${p.contractId}/intake-batches`, {
      items: intakeItems(p.items), expectedDate: p.expectedDate ? day(p.expectedDate) : undefined,
      onBehalf: p.onBehalf || undefined, goodsCheck: p.goodsCheck ? { confirmed: p.goodsCheck.confirmed, note: p.goodsCheck.note?.trim() || undefined } : undefined,
      staffNote: p.staffNote?.trim() || undefined,
    }),
  /** Khách sửa đợt nhập còn chờ xác nhận. */
  updateIntake: async (p: { batchId: string; items: IntakeItemInput[]; expectedDate?: string | null }) =>
    api.patch<IntakeBatch>(`/intake-batches/${p.batchId}`, { items: intakeItems(p.items), expectedDate: p.expectedDate ? day(p.expectedDate) : p.expectedDate }),
  cancelIntake: async (p: { batchId: string }) => { await api.post(`/intake-batches/${p.batchId}/cancel`); },
  /** Nhân viên xác nhận đợt nhập: đủ mục kiểm hàng cấm; `items` = danh sách THỰC TẾ (sửa số lượng / tình trạng / thêm dòng) nếu khác bản khai. */
  confirmIntake: async (p: { batchId: string; goodsCheck: { confirmed: IntakeCheckKey[]; note?: string }; items?: IntakeItemInput[]; staffNote?: string }) =>
    api.post<IntakeBatch>(`/intake-batches/${p.batchId}/confirm`, {
      goodsCheck: { confirmed: p.goodsCheck.confirmed, note: p.goodsCheck.note?.trim() || undefined },
      items: p.items ? intakeItems(p.items) : undefined, staffNote: p.staffNote?.trim() || undefined,
    }),
  /** Có hàng cấm → từ chối nhập đợt này (bắt buộc lý do). */
  rejectIntake: async (p: { batchId: string; reason: string }) => { await api.post(`/intake-batches/${p.batchId}/reject`, { reason: p.reason.trim() }); },

  reviewClaim: async (p: { claimId: string }) => { await api.post(`/claims/${p.claimId}/review`); },

  decideClaim: async (p: { claimId: string; approve: boolean; approvedAmount?: number; note: string }) =>
    api.post<DamageClaim>(`/claims/${p.claimId}/decide`, { approve: p.approve, approvedAmount: p.approve ? p.approvedAmount : undefined, note: p.note }),

  // Tiền mặt → chi xong ngay; chuyển khoản → lệnh chờ chuyển (pending), người khác người duyệt xác nhận sau.
  payClaim: async (p: { claimId: string; method: 'BANK_TRANSFER' | 'CASH' }) => {
    const { payment } = await api.post<{ payment: { amount: number; status: string } }>(`/claims/${p.claimId}/pay`, { method: p.method });
    return { amount: payment.amount, pending: payment.status === 'PENDING' };
  },

  withdrawClaim: async (p: { claimId: string; reason?: string }) => { await api.post(`/claims/${p.claimId}/withdraw`, { reason: p.reason || undefined }); },

  // Toạ độ không gửi lên — BE tự tra từ địa chỉ (line1 / district / city).
  saveFacility: async (p: Pick<Facility, 'name' | 'code' | 'status'> & { _id?: string; line1: string; district: string; city: string; phone: string }) => {
    const body = { name: p.name, status: p.status, line1: p.line1, district: p.district, city: p.city, phone: p.phone };
    if (p._id) await api.patch(`/facilities/${p._id}`, body);
    else await api.post('/facilities', { ...body, code: p.code });
  },

  publishPolicy: async (p: { facilityId: string | null; patch: Partial<BusinessPolicy> }) => api.post<BusinessPolicy>('/policies', p),
  /** Chi nhánh bỏ chính sách riêng, dùng lại chính sách chung toàn chuỗi (chỉ áp cho đặt chỗ mới). */
  revertFacilityPolicy: async (p: { facilityId: string }) => { await api.post(`/policies/facility/${p.facilityId}/revert`); },

  setUnitTypeRates: async (p: { unitTypeId: string; rates: Partial<Record<RentalPeriod, number>> }) => { await api.patch(`/facilities/unit-types/${p.unitTypeId}/price`, { rates: p.rates }); },

  // ---- yêu cầu đổi ô kho (A1b): khách gửi yêu cầu, FM xét duyệt
  requestUnitSwap: async (p: { contractId: string; toUnitId: string; method: SwapMethod; reason: string }) =>
    api.post<UnitSwapRequest>(`/contracts/${p.contractId}/swap-requests`, { toUnitId: p.toUnitId, method: p.method, reason: p.reason }),

  cancelSwapRequest: async (p: { swapRequestId: string }) => { await api.post(`/swap-requests/${p.swapRequestId}/cancel`); },

  decideSwapRequest: async (p: { swapRequestId: string; approve: boolean; facilityFault?: boolean; fee?: number; scheduledFor?: string; assignedStaffId?: string; rejectReason?: string }) =>
    api.post<UnitSwapRequest>(`/swap-requests/${p.swapRequestId}/decide`, {
      approve: p.approve, facilityFault: p.facilityFault, fee: p.fee, scheduledFor: p.scheduledFor, assignedStaffId: p.assignedStaffId, rejectReason: p.rejectReason,
    }),

  /** FM đổi nhân viên chuyển đồ / dời ngày hẹn cho yêu cầu "Thuê người chuyển" đã duyệt. */
  assignSwapMover: async (p: { swapRequestId: string; assignedStaffId: string; scheduledFor?: string }) =>
    api.post<UnitSwapRequest>(`/swap-requests/${p.swapRequestId}/assign`, { assignedStaffId: p.assignedStaffId, scheduledFor: p.scheduledFor }),

  /** `keyTag`: nhãn chìa / số thẻ vừa giao khi ô mới khoá bằng chìa hoặc thẻ. Ô mới khoá mật khẩu khác ô cũ → server trả `pin` đúng một lần. */
  completeSwapRequest: async (p: { swapRequestId: string; keyTag?: string }) =>
    api.post<{ contract: RentalContract; accessChanged: boolean; pin?: string }>(`/swap-requests/${p.swapRequestId}/complete`, { keyTag: p.keyTag || undefined }),

  // authorization: giấy uỷ quyền ký hợp đồng thay Bên A — chỉ Quản lý chi nhánh (null = chưa có / gỡ).
  saveUser: async (p: { _id?: string; fullName: string; email: string; role: Role; facilityIds: string[]; status: User['status']; shift?: CheckInShift | null; authorization?: { number: string; issuedOn: string } | null }) => {
    const authorization = p.role === 'FACILITY_MANAGER' ? (p.authorization ?? null) : null;
    if (p._id) { await api.patch(`/users/${p._id}`, { fullName: p.fullName, role: p.role, facilityIds: p.facilityIds, status: p.status, shift: p.role === 'STAFF' ? p.shift : null, authorization }); return { resetLink: null as string | null }; }
    return api.post<{ resetLink: string | null }>('/users', { fullName: p.fullName, email: p.email, role: p.role, facilityIds: p.facilityIds, status: p.status, shift: p.role === 'STAFF' ? p.shift : undefined, authorization: authorization ?? undefined });
  },
};

export type Actions = typeof actions;
export type ActionName = keyof Actions;
export type Payload<K extends ActionName> = Parameters<Actions[K]>[0];
export type Value<K extends ActionName> = Awaited<ReturnType<Actions[K]>>;
