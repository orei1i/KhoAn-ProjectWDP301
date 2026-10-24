'use client';

import type {
  AbandonedItemsDisposal, AccessMethod, ContactWindow, ContractTemplate, PrivacyRequest, PrivacyRequestType, ContractTemplateClause, BusinessPolicy, CancellationReason, CheckInShift, ClaimItem, ClaimType, DamageClaim, Facility, InspectionLog,
  PaymentMethod, RentalContract, RentalPeriod, Reservation, Role, StorageUnit, SupportTicket, SwapMethod,
  ServiceOffering, ServiceOrder, SignatureMethod, TicketCategory, TicketKind, TicketPriority, TicketStatus, UnitCategory, UnitStatus, UnitSwapRequest, User,
} from '@ssm/shared';
import { api } from '@/shared/api/client';

/**
 * Every UI action → one REST call. The server enforces roles, facility scope and state machines;
 * the store refreshes its snapshot afterwards, so pages never patch local state by hand.
 */
const day = (iso: string) => iso.slice(0, 10);
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export interface BookingLine {
  unitTypeId: string; unitId: string; startDate: string; rentalPeriod: RentalPeriod; periods: number;
  /** Ca giờ khách dự kiến đến nhận kho — chọn ngay lúc đặt; 'UNKNOWN' = "Chưa rõ giờ". */
  preferredCheckInShift: CheckInShift;
  /** Add-on điều hòa khách tự chọn lúc đặt — không gắn với ô cụ thể nào. */
  useAirConditioning: boolean;
}

export const actions = {
  // Khách bắt buộc chọn ô cụ thể (unitId) trên sơ đồ và chu kỳ thuê (rentalPeriod) lúc đặt.
  createReservation: async (p: BookingLine & { source?: Reservation['source']; consent: { termsVersion: string; privacyVersion: string; paymentScheduleAck: true } }) =>
    api.post<Reservation>('/reservations', {
      unitTypeId: p.unitTypeId, unitId: p.unitId, startDate: day(p.startDate), rentalPeriod: p.rentalPeriod, periods: p.periods,
      preferredCheckInShift: p.preferredCheckInShift, useAirConditioning: p.useAirConditioning,
      source: p.source === 'MOBILE' ? 'MOBILE' : 'WEB', consent: p.consent,
    }, { 'idempotency-key': newKey() }),

  /** Đặt nhiều kho một lần (giỏ hàng) — cùng một lần chấp thuận điều khoản cho toàn giỏ. */
  createReservationsBatch: async (p: { items: BookingLine[]; consent: { termsVersion: string; privacyVersion: string; paymentScheduleAck: true } }) =>
    (await api.post<{ items: Reservation[] }>('/reservations/batch', p, { 'idempotency-key': newKey() })).items,

  payDeposit: async (p: { reservationId: string; method: PaymentMethod }) =>
    api.post<{ reservation: Reservation; qrPayload: string }>(`/reservations/${p.reservationId}/pay-deposit`, { method: p.method }),

  cancelReservation: async (p: { reservationId: string; reason: CancellationReason; note?: string }) =>
    (await api.post<{ refund: { pct: number; amount: number } }>(`/reservations/${p.reservationId}/cancel`, { reason: p.reason, note: p.note })).refund.amount,

  allocate: async (p: { reservationId: string; unitId?: string }) =>
    (await api.post<{ unit: StorageUnit }>(`/reservations/${p.reservationId}/allocate`, p.unitId ? { unitId: p.unitId } : {})).unit,

  unallocate: async (p: { reservationId: string }) => { await api.post(`/reservations/${p.reservationId}/unallocate`); },

  /** `payMethod`: cách thu tiền thuê kỳ đầu tại quầy — bỏ trống với kho cỡ lớn (đã thu cùng lúc đặt chỗ). */
  // identityVerified: nhân viên đã đối chiếu giấy tờ bản gốc; idType / idNumberLast4 theo giấy tờ khách xuất trình (bắt buộc nếu khách chưa khai).
  checkIn: async (p: { reservationId: string; keyTag?: string; payMethod?: PaymentMethod; idType?: 'CCCD' | 'PASSPORT'; idNumberLast4?: string }) =>
    api.post<{ contract: RentalContract; unit: StorageUnit; pin?: string }>(`/reservations/${p.reservationId}/check-in`, { keyTag: p.keyTag, payMethod: p.payMethod, identityVerified: true, idType: p.idType, idNumberLast4: p.idNumberLast4 }),

  requestMoveOut: async (p: { contractId: string; date: string }) => { await api.post(`/contracts/${p.contractId}/move-out`, { date: day(p.date) }); },
  /** Xoá nợ còn lại sau quyết toán của hợp đồng đã đóng (FM / Ops, trong hạn mức miễn giảm). */
  writeOffDebt: async (p: { contractId: string; reason: string }) => (await api.post<{ amount: number }>(`/contracts/${p.contractId}/write-off-debt`, { reason: p.reason })).amount,
  // Khiếu nại biên bản trả kho đúng → giảm chi phí hư hại: trừ nợ còn lại trước, phần dư hoàn khách (chuyển khoản chờ xác nhận).
  adjustDamage: async (p: { contractId: string; amount: number; reason: string }) =>
    api.post<{ debtCut: number; refund: number }>(`/contracts/${p.contractId}/damage-adjustment`, { amount: p.amount, reason: p.reason }),
  cancelMoveOut: async (p: { contractId: string }) => { await api.post(`/contracts/${p.contractId}/move-out/cancel`); },
  receiveUnit: async (p: { contractId: string }) => { await api.post(`/contracts/${p.contractId}/receive`); },

  submitInspection: async (p: { contractId: string; checklist: InspectionLog['checklist']; damages: InspectionLog['damages']; notes?: string }) =>
    (await api.post<{ inspection: InspectionLog }>(`/contracts/${p.contractId}/inspection`, { checklist: p.checklist, damages: p.damages, notes: p.notes || undefined })).inspection,

  /** Hàng bỏ lại khi LOCKED_OUT quá lâu (FM) — kiểm kê + phương án xử lý, mất tiền giữ chân, đóng hợp đồng. */
  processAbandonment: async (p: { contractId: string; items: { description: string; quantity: number }[]; disposalMethod: AbandonedItemsDisposal; notes?: string; proceeds: number; costs: number }) =>
    (await api.post<{ inspection: InspectionLog }>(`/contracts/${p.contractId}/abandonment`, { items: p.items, disposalMethod: p.disposalMethod, notes: p.notes || undefined, proceeds: p.proceeds, costs: p.costs })).inspection,
  /** Thông báo cuối trước khi được xử lý đồ bỏ lại (hợp đồng đang bị khoá, mỗi đợt nợ một lần). */
  sendFinalNotice: async (p: { contractId: string; note?: string }) => { await api.post(`/contracts/${p.contractId}/final-notice`, { note: p.note?.trim() || undefined }); },

  /** Gia hạn = cam kết mới. `method` chỉ cần khi phải trả ngay (thuê ngày / tuần); thuê tháng trả theo từng tháng. Trả về số tiền thu ngay. */
  extendContract: async (p: { contractId: string; periods: number; method?: PaymentMethod; acceptAppendix: boolean }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/extend`, { periods: p.periods, method: p.method, acceptAppendix: p.acceptAppendix })).amount,

  payBalance: async (p: { contractId: string; method: PaymentMethod }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/pay-balance`, { method: p.method })).amount,

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

  /** Nhân viên mở kho hộ khách bằng chìa tổng / thẻ tổng sau khi xác minh danh tính — server ghi nhật ký vào hợp đồng. */
  assistedOpen: async (p: { contractId: string; reason: string; authorizedPersonId?: string }) => { await api.post(`/contracts/${p.contractId}/assisted-open`, { reason: p.reason, identityVerified: true, authorizedPersonId: p.authorizedPersonId }); },

  /** Chủ hợp đồng đăng ký / xoá người được uỷ quyền ra vào kho (tối đa 3). */
  addAuthorizedPerson: async (p: { contractId: string; fullName: string; phone: string; idNumberLast4: string; relationship?: string }) => {
    await api.post(`/contracts/${p.contractId}/authorized-persons`, { fullName: p.fullName, phone: p.phone, idNumberLast4: p.idNumberLast4, relationship: p.relationship || undefined });
  },
  removeAuthorizedPerson: async (p: { contractId: string; personId: string }) => { await api.delete(`/contracts/${p.contractId}/authorized-persons/${p.personId}`); },

  completeAccessRequest: async (p: { requestId: string; keyTag: string }) => { await api.post(`/access-requests/${p.requestId}/complete`, { keyTag: p.keyTag }); },

  /** Khách xin cấp lại phương tiện vào kho (đặt lại mật khẩu / làm lại thẻ / cấp lại chìa). Có phí thì trả ngay khi gửi. */
  requestAccess: async (p: { contractId: string; reason?: string; method?: PaymentMethod }) =>
    api.post<{ requestNumber: string }>('/access-requests', { contractId: p.contractId, reason: p.reason || undefined, method: p.method }),
  cancelAccessRequest: async (p: { requestId: string; reason?: string }) => { await api.post(`/access-requests/${p.requestId}/cancel`, { reason: p.reason || undefined }); },

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
  signContract: async (p: { reservationId: string; signerName: string; method: SignatureMethod; image?: string | null }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/sign`, { signerName: p.signerName, method: p.method, image: p.image ?? null }),

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
  createClaim: async (p: { contractId: string; type: ClaimType; incidentAt: string; description: string; items: ClaimItem[]; ticketId?: string | null }) =>
    api.post<DamageClaim>('/claims', { ...p, ticketId: p.ticketId || undefined }),

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
