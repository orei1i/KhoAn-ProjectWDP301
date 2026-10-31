import type {
  AccessRequest, CheckInShift, ContactWindow, ExtensionQuote, IntakeBatch, IntakeItemCondition, SealedPackageKind, PrivacyRequest, PrivacyRequestType, ClaimItem, ClaimType, DamageClaim, PaymentMethod, RentalContract, RentalPeriod, Reservation, ServiceOrder, SignatureMethod, SigningPreference, StorageUnit,
  SupportTicket, SwapMethod, TicketCategory, TicketPriority, TicketStatus, UnitSwapRequest,
} from '@ssm/shared';
import { PRIVACY_VERSION, TERMS_VERSION } from '@ssm/shared';
import { api, SLOW_TIMEOUT_MS } from './client';

/**
 * Mỗi hành động trên app = đúng một lời gọi REST, y hệt Webapp.
 * Server mới là nơi kiểm quyền, phạm vi chi nhánh và state machine — app không tự suy diễn gì.
 *
 * Chỉ có hành động của KHÁCH HÀNG. App này không dành cho nhân viên: mọi endpoint của
 * STAFF/MANAGER đều bị BE chặn theo vai trò nên có gọi cũng nhận 403.
 */
const day = (iso: string) => iso.slice(0, 10);
export type BookingService = { serviceId: string; quantity: number; note?: string };
export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export const actions = {
  // ---- đặt kho (bắt buộc chọn ô cụ thể trên sơ đồ + chu kỳ thuê tự chọn)
  // services: dịch vụ thêm chọn kèm (đơn riêng ngoài hợp đồng thuê) — thanh toán khi nhận kho.
  // contractAck: khách đã mở xem hợp đồng của từng kho và tick xác nhận đã đọc — server đóng dấu thời điểm.
  // payAtCounter: "Giữ chỗ, trả tại quầy" — giữ ô COUNTER_HOLD_HOURS giờ thay cho thời gian giữ chỗ thường, trả tiền + ký giấy tại quầy.
  // payOnArrival (đợt 15, C1): "Trả khi nhận kho" — hôm nay không trả gì, giữ ô tới hết ngày nhận (server kiểm điều kiện: 422 COD_NOT_ALLOWED).
  createReservation: async (p: { unitTypeId: string; unitId: string; startDate: string; rentalPeriod: RentalPeriod; periods: number; preferredCheckInShift: CheckInShift; useAirConditioning: boolean; services?: BookingService[]; contractAck: true; payAtCounter?: boolean; payOnArrival?: boolean; expectedTotal?: number }) =>
    api.post<Reservation>('/reservations', {
      unitTypeId: p.unitTypeId,
      unitId: p.unitId,
      startDate: day(p.startDate),
      rentalPeriod: p.rentalPeriod,
      periods: p.periods,
      preferredCheckInShift: p.preferredCheckInShift,
      useAirConditioning: p.useAirConditioning,
      services: p.services?.length ? p.services : undefined,
      payAtCounter: p.payAtCounter || undefined,
      payOnArrival: p.payOnArrival || undefined,
      source: 'MOBILE',
      // Đợt 17 (C2): Σ tiền phải trả khi đặt của báo giá đang xem — giá đổi → 409 PRICE_CHANGED, không ghi gì.
      expectedTotal: p.expectedTotal,
      // paymentScheduleAck: màn đặt chỗ bắt buộc khách tick xác nhận đã đọc lịch thanh toán (tiền giữ chân hôm nay + tiền thuê kỳ đầu khi nhận kho)
      consent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true, contractAck: p.contractAck },
    }, { 'idempotency-key': newKey() }, SLOW_TIMEOUT_MS),

  /** Đặt nhiều kho một lượt (các ô khách bấm chọn trên sơ đồ) — cùng một lần chấp thuận điều khoản; hoặc giữ được cả N ô, hoặc không ô nào. */
  createReservationsBatch: async (p: { items: { unitTypeId: string; unitId: string; startDate: string; rentalPeriod: RentalPeriod; periods: number; preferredCheckInShift: CheckInShift; useAirConditioning: boolean; services?: BookingService[] }[]; contractAck: true; expectedTotal?: number }) =>
    (await api.post<{ items: Reservation[] }>('/reservations/batch', {
      items: p.items.map((i) => ({ ...i, startDate: day(i.startDate), source: 'MOBILE' })),
      expectedTotal: p.expectedTotal,
      consent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, paymentScheduleAck: true, contractAck: p.contractAck },
    }, { 'idempotency-key': newKey() }, SLOW_TIMEOUT_MS)).items,

  /**
   * codAck (C1): đặt chỗ "trả khi nhận kho" trả online trước — khách đã đọc cảnh báo (thiếu → 422 COD_PAY_ACK_REQUIRED).
   * Đợt 17 (D6): khoản đã thu trước đó (thử lại sau lỗi mạng) → `replayed: true`, không thu thêm; `qrPayload` là mã MỚI, hoặc null nếu đã nhận kho.
   */
  payDeposit: async (p: { reservationId: string; method: PaymentMethod; codAck?: boolean }) =>
    api.post<{ reservation: Reservation; qrPayload: string | null; replayed: boolean }>(`/reservations/${p.reservationId}/pay-deposit`, { method: p.method, codAck: p.codAck || undefined }),

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
  /**
   * Trả công nợ. Đợt 15 (B5): `expectedAmount` = số đang hiển thị trên cổng — số dư vừa đổi thì server trả 409 BALANCE_CHANGED (không thu),
   * cổng hiện số mới để khách bấm lại; `idempotencyKey` giữ nguyên khi thử lại sau lỗi mạng → không thu hai lần.
   */
  payBalance: async (p: { contractId: string; method: PaymentMethod; expectedAmount?: number; idempotencyKey?: string }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/pay-balance`, { method: p.method, expectedAmount: p.expectedAmount, idempotencyKey: p.idempotencyKey })).amount,

  /**
   * Gia hạn = cam kết mới. `method` chỉ cần khi phải trả ngay (thuê ngày / tuần). Trả về số tiền thu ngay.
   * `expected`: giá mỗi kỳ, số phải trả ngay, ngày bắt đầu (`from`) và ngày hết hạn mới (`newEndDate`) của báo giá khách đang xem —
   * giá đổi hoặc hợp đồng vừa được gia hạn thì server trả PRICE_CHANGED.
   * `idempotencyKey`: giữ nguyên cho cùng một báo giá — bấm 2 lần / mạng chập chờn gửi lại không gia hạn 2 lần.
   * Đợt 16 (C2): kèm `policyVersion` + `appendixHash` của phụ lục đang xem — phụ lục đổi thì server trả APPENDIX_CHANGED để khách đọc lại.
   */
  extendContract: async (p: { contractId: string; periods: number; method?: PaymentMethod; acceptAppendix: boolean; expected: Pick<ExtensionQuote, 'rate' | 'payNow' | 'from' | 'newEndDate' | 'policyVersion' | 'appendixHash'>; idempotencyKey: string }) =>
    (await api.post<{ amount: number }>(`/contracts/${p.contractId}/extend`, {
      periods: p.periods, method: p.method, acceptAppendix: p.acceptAppendix,
      expected: { rate: p.expected.rate, payNow: p.expected.payNow, from: p.expected.from, newEndDate: p.expected.newEndDate, policyVersion: p.expected.policyVersion, appendixHash: p.expected.appendixHash },
    }, { 'idempotency-key': p.idempotencyKey }, SLOW_TIMEOUT_MS)).amount,

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
  // photoUrls: link ảnh chứng cứ (https) — chưa có tải ảnh lên.
  createClaim: async (p: { contractId: string; type: ClaimType; incidentAt: string; description: string; items: ClaimItem[]; photoUrls?: string[] }) =>
    api.post<DamageClaim>('/claims', { ...p, incidentAt: day(p.incidentAt), photoUrls: p.photoUrls?.length ? p.photoUrls : undefined }),

  withdrawClaim: async (p: { claimId: string }) => {
    await api.post(`/claims/${p.claimId}/withdraw`, {});
  },

  // ---- nhập hàng nhiều đợt: khách khai đồ mỗi lần mang vào kho, nhân viên chi nhánh kiểm hàng cấm rồi xác nhận
  // expectedDate: ngày dự kiến mang đồ đến (ngày thuần YYYY-MM-DD).
  // Đợt 16: `category` theo danh sách của cỡ kho (D1); `sealed` = gửi kín theo kiện thay cho `items` (D2 — ký bản cam kết giấy tại quầy).
  declareIntake: async (p: { contractId: string; items?: { name: string; category?: string | null; quantity: number; estValue: number; condition: IntakeItemCondition; note?: string }[]; sealed?: { packageCount: number; packageKind: SealedPackageKind; hasSeal: boolean; description?: string; declaredValue?: number | null }; expectedDate?: string }) =>
    api.post<IntakeBatch>(`/contracts/${p.contractId}/intake-batches`, {
      ...(p.sealed
        ? { sealed: { ...p.sealed, description: p.sealed.description?.trim() || undefined, declaredValue: p.sealed.declaredValue && p.sealed.declaredValue > 0 ? p.sealed.declaredValue : undefined } }
        : { items: (p.items ?? []).map((i) => ({ ...i, category: i.category || undefined, note: i.note?.trim() || undefined })) }),
      expectedDate: p.expectedDate ? day(p.expectedDate) : undefined,
    }),
  /** Huỷ đợt nhập khi còn chờ xác nhận (DECLARED). */
  cancelIntake: async (p: { batchId: string }) => { await api.post(`/intake-batches/${p.batchId}/cancel`, {}); },
  /** Ghi "đã lấy ra" một món đang gửi (số lượng ≤ số đang gửi; chỉ khi hợp đồng còn giữ đồ). */
  withdrawIntakeItem: async (p: { batchId: string; itemId: string; quantity: number; note?: string }) =>
    api.post<IntakeBatch>(`/intake-batches/${p.batchId}/items/${p.itemId}/withdraw`, { quantity: p.quantity, note: p.note?.trim() || undefined }),

  // ---- yêu cầu đổi ô kho (A1b): gửi yêu cầu, chi nhánh xét duyệt
  // Đợt 15 (C3): ô mới khác loại = đổi cỡ kho — gửi kèm xác nhận Phụ lục "Đổi cỡ kho" + báo giá đã xem (rate, deposit).
  requestUnitSwap: async (p: { contractId: string; toUnitId: string; method: SwapMethod; reason: string; acceptAppendix?: boolean; expected?: { rate: number; deposit: number } }) =>
    api.post<UnitSwapRequest>(`/contracts/${p.contractId}/swap-requests`, { toUnitId: p.toUnitId, method: p.method, reason: p.reason, acceptAppendix: p.acceptAppendix, expected: p.expected }),

  cancelSwapRequest: async (p: { swapRequestId: string }) => {
    await api.post(`/swap-requests/${p.swapRequestId}/cancel`);
  },

  // ---- dịch vụ thêm sau khi thuê
  // Đợt 16 (C6): `expectedTotal` = tổng đang hiện trên cổng (giá đổi → PRICE_CHANGED, không thu); `idempotencyKey` = khoá của lần trả — thử lại
  // không tạo đơn / thu tiền lần hai.
  orderService: async ({ idempotencyKey, ...p }: { contractId: string; serviceId: string; quantity: number; preferredDate?: string; note?: string; method: PaymentMethod; expectedTotal?: number; idempotencyKey?: string }) =>
    api.post<ServiceOrder>('/services/orders', { ...p, preferredDate: p.preferredDate ? day(p.preferredDate) : undefined, note: p.note || undefined }, { 'idempotency-key': idempotencyKey ?? newKey() }),

  cancelServiceOrder: async (p: { orderId: string }) => {
    await api.post(`/services/orders/${p.orderId}/cancel`, {});
  },

  // ---- xin cấp lại mật khẩu / thẻ / chìa (Quản lý chi nhánh xác nhận; làm lại thẻ có phí)
  // Đợt 16 (C6): `expectedFee` = phí đang hiện (đổi → PRICE_CHANGED); `idempotencyKey` — gửi lại không thu phí lần hai.
  requestAccess: async (p: { contractId: string; reason?: string; method?: PaymentMethod; expectedFee?: number; idempotencyKey?: string }) =>
    api.post<AccessRequest>('/access-requests', { contractId: p.contractId, reason: p.reason || undefined, method: p.method, expectedFee: p.expectedFee }, { 'idempotency-key': p.idempotencyKey ?? newKey() }),

  // ---- người được uỷ quyền ra vào kho (tối đa 3, chỉ chủ hợp đồng thêm / xoá)
  addAuthorizedPerson: async (p: { contractId: string; fullName: string; phone: string; idNumberLast4: string; relationship?: string }) => {
    await api.post(`/contracts/${p.contractId}/authorized-persons`, { fullName: p.fullName, phone: p.phone, idNumberLast4: p.idNumberLast4, relationship: p.relationship || undefined });
  },
  removeAuthorizedPerson: async (p: { contractId: string; personId: string }) => { await api.delete(`/contracts/${p.contractId}/authorized-persons/${p.personId}`); },

  cancelAccessRequest: async (p: { requestId: string }) => {
    await api.post(`/access-requests/${p.requestId}/cancel`, {});
  },

  // ---- đồng ý lại Điều khoản + Chính sách bảo mật bản hiện hành (khi user.consentRequired) — server lưu thời điểm, IP
  acceptLegal: async () => { await api.post('/auth/me/consent', { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }); },

  // ---- hồ sơ: tự sửa họ tên (in vào hợp đồng / phụ lục)
  updateMyProfile: async (p: { fullName?: string; phone?: string; idType?: 'CCCD' | 'PASSPORT'; idNumberLast4?: string; payoutAccount?: { bankName: string; accountNumber: string; accountName: string } | null }) => api.patch<{ user: unknown }>('/auth/me', p),
  // ---- quyền dữ liệu cá nhân (Nghị định 13/2023)
  createPrivacyRequest: async (p: { type: PrivacyRequestType; note?: string }) => api.post<PrivacyRequest>('/privacy-requests', p),
  emailContract: async (p: { reservationId: string }) => api.post<{ sent: true; to: string }>(`/reservations/${p.reservationId}/contract/email`),

  // ---- khách chọn ký online (OTP) hay ký giấy tại quầy khi nhận kho — chỉ khi đã trả giữ chân, chưa ký, chưa nhận kho
  setSigningPreference: async (p: { reservationId: string; preference: SigningPreference }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/signing-preference`, { preference: p.preference }),

  // ---- ký hợp đồng (vẽ tay hoặc gõ họ tên) sau khi trả tiền giữ chân, trước khi nhận kho
  // Ký online cần mã OTP gửi qua email (requestSignOtp). demoCode chỉ có với tài khoản demo (email bị chặn gửi).
  // Gửi OTP chờ mail server trả lời, ký thì lưu chữ ký + dựng PDF — dùng thời gian chờ dài (SLOW_TIMEOUT_MS) thay vì 10s mặc định.
  requestSignOtp: async (p: { reservationId: string }) =>
    api.post<{ sentTo: string; expiresAt: string; demoCode?: string }>(`/reservations/${p.reservationId}/sign-otp`, {}, undefined, SLOW_TIMEOUT_MS),
  signContract: async (p: { reservationId: string; signerName: string; method: Exclude<SignatureMethod, 'PAPER'>; image?: string | null; otp: string }) =>
    api.post<Reservation>(`/reservations/${p.reservationId}/sign`, { signerName: p.signerName, method: p.method, image: p.image ?? null, otp: p.otp }, undefined, SLOW_TIMEOUT_MS),
};

export type Actions = typeof actions;
export type ActionName = keyof Actions;
export type Payload<K extends ActionName> = Parameters<Actions[K]>[0];
export type Value<K extends ActionName> = Awaited<ReturnType<Actions[K]>>;

export type { RentalContract, Reservation, StorageUnit };
