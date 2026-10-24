import type {
  AccessRequest, CheckInShift, ContactWindow, PrivacyRequest, PrivacyRequestType, ClaimItem, ClaimType, DamageClaim, PaymentMethod, RentalContract, RentalPeriod, Reservation, ServiceOrder, SignatureMethod, StorageUnit,
  SupportTicket, SwapMethod, TicketCategory, TicketPriority, TicketStatus, UnitSwapRequest,
} from '@ssm/shared';
import { PRIVACY_VERSION, TERMS_VERSION } from '@ssm/shared';
import { api } from './client';

/**
 * Mỗi hành động trên app = đúng một lời gọi REST, y hệt Webapp.
 * Server mới là nơi kiểm quyền, phạm vi chi nhánh và state machine — app không tự suy diễn gì.
 *
 * Chỉ có hành động của KHÁCH HÀNG. App này không dành cho nhân viên: mọi endpoint của
 * STAFF/MANAGER đều bị BE chặn theo vai trò nên có gọi cũng nhận 403.
 */
const day = (iso: string) => iso.slice(0, 10);
export type BookingService = { serviceId: string; quantity: number; note?: string };
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export const actions = {
  // ---- đặt kho (bắt buộc chọn ô cụ thể trên sơ đồ + chu kỳ thuê tự chọn)
  // services: dịch vụ thêm chọn kèm (đơn riêng ngoài hợp đồng thuê) — thanh toán khi nhận kho.
  // contractAck: khách đã mở xem hợp đồng của từng kho và tick xác nhận đã đọc — server đóng dấu thời điểm.
  createReservation: async (p: { unitTypeId: string; unitId: string; startDate: string; rentalPeriod: RentalPeriod; periods: number; preferredCheckInShift: CheckInShift; useAirConditioning: boolean; services?: BookingService[]; contractAck: true }) =>
    api.post<Reservation>('/reservations', {
      unitTypeId: p.unitTypeId,
      unitId: p.unitId,
      startDate: day(p.startDate),
      rentalPeriod: p.rentalPeriod,
      periods: p.periods,
      preferredCheckInShift: p.preferredCheckInShift,
      useAirConditioning: p.useAirConditioning,
      services: p.services?.length ? p.services : undefined,
      source: 'MOBILE',
      // paymentScheduleAck: màn đặt chỗ bắt buộc khách tick xác nhận đã đọc lịch thanh toán (tiền giữ chân hôm nay + tiền thuê kỳ đầu khi nhận kho)
      consent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true, contractAck: p.contractAck },
    }, { 'idempotency-key': newKey() }),

  /** Đặt nhiều kho một lượt (các ô khách bấm chọn trên sơ đồ) — cùng một lần chấp thuận điều khoản; hoặc giữ được cả N ô, hoặc không ô nào. */
  createReservationsBatch: async (p: { items: { unitTypeId: string; unitId: string; startDate: string; rentalPeriod: RentalPeriod; periods: number; preferredCheckInShift: CheckInShift; useAirConditioning: boolean; services?: BookingService[] }[]; contractAck: true }) =>
    (await api.post<{ items: Reservation[] }>('/reservations/batch', {
      items: p.items.map((i) => ({ ...i, startDate: day(i.startDate), source: 'MOBILE' })),
      consent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true, contractAck: p.contractAck },
    }, { 'idempotency-key': newKey() })).items,

  payDeposit: async (p: { reservationId: string; method: PaymentMethod }) =>
    api.post<{ reservation: Reservation; qrPayload: string }>(`/reservations/${p.reservationId}/pay-deposit`, { method: p.method }),

  cancelReservation: async (p: { reservationId: string }) =>
    (await api.post<{ refund: { pct: number; amount: number } }>(`/reservations/${p.reservationId}/cancel`, { reason: 'CUSTOMER_REQUEST' })).refund.amount,

  /** Đổi ngày nhận kho (đã trả giữ chân, chưa nhận kho). Đã ký thì chữ ký cũ hết hiệu lực — phải ký lại. */
  rescheduleReservation: async (p: { reservationId: string; startDate: string; reason?: string }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/reschedule`, { startDate: day(p.startDate), reason: p.reason?.trim() || undefined }),

  /**
   * Cấp lại mã QR nhận kho. payDeposit chỉ trả payload đúng một lần rồi server giữ hash,
   * nên mở lại app là phải xin mã mới — mỗi lần gọi cũng vô hiệu hoá mã đã cấp trước đó.
   */
  reissueQr: async (p: { reservationId: string }) =>
    api.post<{ qrPayload: string; code: string; expiresAt: string }>(`/reservations/${p.reservationId}/qr`),

  // ---- hợp đồng đang thuê
  payBalance: async (p: { contractId: string; method: PaymentMethod }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/pay-balance`, { method: p.method })).amount,

  /** Gia hạn = cam kết mới. `method` chỉ cần khi phải trả ngay (thuê ngày / tuần). Trả về số tiền thu ngay. */
  extendContract: async (p: { contractId: string; periods: number; method?: PaymentMethod; acceptAppendix: boolean }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/extend`, { periods: p.periods, method: p.method, acceptAppendix: p.acceptAppendix })).amount,

  requestMoveOut: async (p: { contractId: string; date: string }) => {
    await api.post(`/contracts/${p.contractId}/move-out`, { date: day(p.date) });
  },
  cancelMoveOut: async (p: { contractId: string }) => { await api.post(`/contracts/${p.contractId}/move-out/cancel`); },

  // ---- hỗ trợ
  // Yêu cầu tư vấn trước khi đặt kho — phiếu CONSULTATION cho chi nhánh, không giữ ô.
  requestConsultation: async (p: { facilityId: string; unitTypeIds: string[]; rentalPeriod: RentalPeriod; periods: number; phone: string; contactWindow: ContactWindow; needs: { reviewContract: boolean; vatInvoice: boolean; customContract: boolean; multipleUnits: boolean }; note?: string }) =>
    api.post<SupportTicket>('/tickets/consultation', p),
  createTicket: async (p: { facilityId: string; category: TicketCategory; priority: TicketPriority; subject: string; description: string; contractId?: string | null; unitId?: string | null }) =>
    api.post<SupportTicket>('/tickets', { ...p, kind: 'CUSTOMER_ISSUE', description: p.description || undefined }),

  addTicketMessage: async (p: { ticketId: string; body: string }) => {
    await api.post(`/tickets/${p.ticketId}/messages`, { body: p.body, internal: false });
  },

  setTicketStatus: async (p: { ticketId: string; to: TicketStatus }) => {
    await api.post(`/tickets/${p.ticketId}/status`, { to: p.to });
  },

  // ---- bồi thường
  // incidentAt: khách chỉ chọn NGÀY → gửi ngày thuần YYYY-MM-DD (server so theo ngày Việt Nam), không gửi mốc ISO có giờ.
  createClaim: async (p: { contractId: string; type: ClaimType; incidentAt: string; description: string; items: ClaimItem[] }) =>
    api.post<DamageClaim>('/claims', { ...p, incidentAt: day(p.incidentAt) }),

  withdrawClaim: async (p: { claimId: string }) => {
    await api.post(`/claims/${p.claimId}/withdraw`, {});
  },

  // ---- yêu cầu đổi ô kho (A1b): gửi yêu cầu, chi nhánh xét duyệt
  requestUnitSwap: async (p: { contractId: string; toUnitId: string; method: SwapMethod; reason: string }) =>
    api.post<UnitSwapRequest>(`/contracts/${p.contractId}/swap-requests`, { toUnitId: p.toUnitId, method: p.method, reason: p.reason }),

  cancelSwapRequest: async (p: { swapRequestId: string }) => {
    await api.post(`/swap-requests/${p.swapRequestId}/cancel`);
  },

  // ---- dịch vụ thêm sau khi thuê
  orderService: async (p: { contractId: string; serviceId: string; quantity: number; preferredDate?: string; note?: string; method: PaymentMethod }) =>
    api.post<ServiceOrder>('/services/orders', { ...p, preferredDate: p.preferredDate ? day(p.preferredDate) : undefined, note: p.note || undefined }),

  cancelServiceOrder: async (p: { orderId: string }) => {
    await api.post(`/services/orders/${p.orderId}/cancel`, {});
  },

  // ---- xin cấp lại mật khẩu / thẻ / chìa (Quản lý chi nhánh xác nhận; làm lại thẻ có phí)
  requestAccess: async (p: { contractId: string; reason?: string; method?: PaymentMethod }) =>
    api.post<AccessRequest>('/access-requests', { contractId: p.contractId, reason: p.reason || undefined, method: p.method }),

  // ---- người được uỷ quyền ra vào kho (tối đa 3, chỉ chủ hợp đồng thêm / xoá)
  addAuthorizedPerson: async (p: { contractId: string; fullName: string; phone: string; idNumberLast4: string; relationship?: string }) => {
    await api.post(`/contracts/${p.contractId}/authorized-persons`, { fullName: p.fullName, phone: p.phone, idNumberLast4: p.idNumberLast4, relationship: p.relationship || undefined });
  },
  removeAuthorizedPerson: async (p: { contractId: string; personId: string }) => { await api.delete(`/contracts/${p.contractId}/authorized-persons/${p.personId}`); },

  cancelAccessRequest: async (p: { requestId: string }) => {
    await api.post(`/access-requests/${p.requestId}/cancel`, {});
  },

  // ---- hồ sơ: tự sửa họ tên (in vào hợp đồng / phụ lục)
  updateMyProfile: async (p: { fullName?: string; phone?: string; idType?: 'CCCD' | 'PASSPORT'; idNumberLast4?: string; payoutAccount?: { bankName: string; accountNumber: string; accountName: string } | null }) => api.patch<{ user: unknown }>('/auth/me', p),
  // ---- quyền dữ liệu cá nhân (Nghị định 13/2023)
  createPrivacyRequest: async (p: { type: PrivacyRequestType; note?: string }) => api.post<PrivacyRequest>('/privacy-requests', p),
  emailContract: async (p: { reservationId: string }) => api.post<{ sent: true; to: string }>(`/reservations/${p.reservationId}/contract/email`),

  // ---- ký hợp đồng (vẽ tay hoặc gõ họ tên) sau khi trả tiền giữ chân, trước khi nhận kho
  // Ký online cần mã OTP gửi qua email (requestSignOtp). demoCode chỉ có với tài khoản demo (email bị chặn gửi).
  requestSignOtp: async (p: { reservationId: string }) =>
    api.post<{ sentTo: string; expiresAt: string; demoCode?: string }>(`/reservations/${p.reservationId}/sign-otp`),
  signContract: async (p: { reservationId: string; signerName: string; method: Exclude<SignatureMethod, 'PAPER'>; image?: string | null; otp: string }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/sign`, { signerName: p.signerName, method: p.method, image: p.image ?? null, otp: p.otp }),
};

export type Actions = typeof actions;
export type ActionName = keyof Actions;
export type Payload<K extends ActionName> = Parameters<Actions[K]>[0];
export type Value<K extends ActionName> = Awaited<ReturnType<Actions[K]>>;

export type { RentalContract, Reservation, StorageUnit };
