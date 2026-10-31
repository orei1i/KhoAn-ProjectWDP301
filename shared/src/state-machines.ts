import type { AccessRequestStatus, ClaimStatus, ContractStatus, IntakeBatchStatus, PaymentStatus, ReservationStatus, Role, ServiceOrderStatus, SwapRequestStatus, TicketStatus, UnitStatus } from './enums';

/** Who may fire a transition. SYSTEM = webhooks, cron jobs, internal side effects. */
export type Actor = Role | 'SYSTEM';

/** from -> (to -> allowed actors). Missing key = illegal transition. */
export type StateMachine<S extends string> = { readonly [F in S]: Partial<Record<S, readonly Actor[]>> };

const FM = 'FACILITY_MANAGER', ST = 'STAFF', CU = 'CUSTOMER', SYS = 'SYSTEM', OPS = 'OPS_MANAGER', ADM = 'ADMIN';

export const RESERVATION_MACHINE = {
  // Huỷ: khách, chi nhánh (nhân viên / quản lý), vận hành / quản trị, hệ thống — lý do được chọn theo vai trò (CANCEL_REASONS_BY_ROLE).
  PENDING:    { CONFIRMED: [SYS], CANCELLED: [CU, ST, FM, OPS, ADM, SYS] },            // deposit webhook | hold expiry
  CONFIRMED:  { ALLOCATED: [FM, SYS], CANCELLED: [CU, ST, FM, OPS, ADM, SYS] },        // manual or auto-allocation
  ALLOCATED:  { CHECKED_IN: [ST, FM], CONFIRMED: [FM], CANCELLED: [CU, ST, FM, OPS, ADM, SYS] }, // ->CONFIRMED = unassign/re-allocate
  CHECKED_IN: { COMPLETED: [SYS] },                                      // fired when the contract closes
  COMPLETED:  {},
  CANCELLED:  {},
} as const satisfies StateMachine<ReservationStatus>;

export const UNIT_MACHINE = {
  // AVAILABLE -> OCCUPIED chỉ dùng cho đổi ô kho (contract.swapUnit): hợp đồng đã tồn tại,
  // ô mới được nhận thẳng chứ không đi qua bước giữ chỗ.
  AVAILABLE:          { RESERVED: [FM, SYS], OCCUPIED: [ST, FM], MAINTENANCE: [ST, FM] },
  RESERVED:           { AVAILABLE: [FM, SYS], OCCUPIED: [ST, FM] },     // release | check-in
  OCCUPIED:           { PENDING_INSPECTION: [ST, FM, SYS, OPS] },       // keys returned / lease ended / swapped out / OPS xử lý đồ bỏ lại
  PENDING_INSPECTION: { AVAILABLE: [ST, FM, OPS], MAINTENANCE: [ST, FM] }, // inspection pass | damage — OPS: xử lý đồ bỏ lại khoản lớn
  MAINTENANCE:        { AVAILABLE: [ST, FM, OPS] }, // OPS: xử lý đồ khách để lại phí lớn (resolveLeftover) nhả ô đang giữ
} as const satisfies StateMachine<UnitStatus>;

export const CONTRACT_MACHINE = {
  ACTIVE:           { DELINQUENT: [SYS], MOVE_OUT_PENDING: [CU, ST, FM] },
  DELINQUENT:       { ACTIVE: [SYS], LOCKED_OUT: [FM, SYS], MOVE_OUT_PENDING: [FM] },
  // paid in full -> access restored | khách bỏ hàng, không liên hệ (OPS: tiền thanh lý / chi phí trên ngưỡng duyệt)
  LOCKED_OUT:       { ACTIVE: [SYS, FM], MOVE_OUT_PENDING: [FM], ABANDONED: [FM, OPS] },
  // settled | rút đăng ký trả kho (trước khi bàn giao) → về ĐÚNG trạng thái trước đó: đăng ký lúc đang nợ / bị khoá thì rút xong vẫn
  // là nợ / bị khoá; SYS = job tự huỷ đăng ký khi khách để nợ quá ân hạn mà chưa bàn giao.
  MOVE_OUT_PENDING: { CLOSED: [ST, FM], ACTIVE: [CU, ST, FM, SYS], DELINQUENT: [CU, ST, FM, SYS], LOCKED_OUT: [CU, ST, FM, SYS] },
  ABANDONED:        {},
  CLOSED:           {},
} as const satisfies StateMachine<ContractStatus>;

export const PAYMENT_MACHINE = {
  // ST = thu tiền mặt tại quầy; FM / OPS = xác nhận đã chuyển khoản một khoản HOÀN (payout) đang chờ chuyển.
  PENDING:            { SUCCEEDED: [SYS, ST, FM, OPS], FAILED: [SYS], CANCELLED: [SYS, CU] },
  SUCCEEDED:          { PARTIALLY_REFUNDED: [SYS, FM, OPS], REFUNDED: [SYS, FM, OPS] },
  PARTIALLY_REFUNDED: { REFUNDED: [SYS, FM, OPS] },
  FAILED: {}, CANCELLED: {}, REFUNDED: {},
} as const satisfies StateMachine<PaymentStatus>;

// SYS về OPEN (ASSIGNED / IN_PROGRESS): người được giao bị khoá, chuyển chi nhánh hoặc đổi vai trò → hệ thống gỡ phân công,
// phiếu quay lại hàng chờ để quản lý giao người khác (users/user.service.updateUser). Người dùng không tự kích hoạt được.
// Đợt 16 (C3): quản lý đóng phiếu CHƯA giải quyết (đang chờ / đang xử lý → CLOSED) — bắt buộc lý do, email khách (ticket.service).
// B2: việc "Vô hiệu thẻ …" hệ thống tạo khi khách báo mất — SYS đánh dấu xong (RESOLVED) khi nhân viên xác nhận đã khoá thẻ cũ, hoặc
// đóng (CLOSED) khi khách huỷ yêu cầu trước khi chi nhánh khoá.
export const TICKET_MACHINE = {
  OPEN:        { ASSIGNED: [FM], CLOSED: [FM, CU, SYS], RESOLVED: [SYS] },
  ASSIGNED:    { IN_PROGRESS: [ST, FM], OPEN: [FM, SYS], CLOSED: [FM, SYS], RESOLVED: [SYS] },
  IN_PROGRESS: { RESOLVED: [ST, FM, SYS], OPEN: [SYS], CLOSED: [FM, SYS] },
  RESOLVED:    { CLOSED: [CU, FM, SYS], IN_PROGRESS: [CU, FM] },        // reopen
  CLOSED:      {},
} as const satisfies StateMachine<TicketStatus>;

/**
 * Yêu cầu bồi thường. Chỉ Quản lý chi nhánh được quyết số tiền và chi tiền —
 * Nhân viên chỉ tiếp nhận / xác minh hiện trường.
 */
export const CLAIM_MACHINE = {
  // Quản lý chi nhánh duyệt tới CLAIM_FM_APPROVAL_LIMIT, lớn hơn thì Quản lý vận hành. Chi: người KHÁC người duyệt — nhân viên chi
  // tiền mặt tại quầy, hoặc quản lý / vận hành xác nhận đã chuyển khoản (SYS = khi xác nhận khoản chuyển khoản đang chờ).
  SUBMITTED:    { UNDER_REVIEW: [ST, FM], REJECTED: [FM, OPS], WITHDRAWN: [CU] },
  UNDER_REVIEW: { APPROVED: [FM, OPS], REJECTED: [FM, OPS], WITHDRAWN: [CU] },
  APPROVED:     { PAID: [ST, FM, OPS, SYS] },
  REJECTED:     { UNDER_REVIEW: [FM, OPS] },   // khách khiếu nại lại, mở xem xét lần hai (vận hành đã quyết thì chỉ vận hành mở)
  PAID:         {},
  WITHDRAWN:    {},
} as const satisfies StateMachine<ClaimStatus>;

/**
 * Yêu cầu đổi ô kho của khách. Chỉ Quản lý chi nhánh duyệt/từ chối; nhân viên hoặc quản lý xác nhận
 * đã chuyển xong; hết hạn 7 ngày tự chuyển thì hệ thống tự hủy (EXPIRED), không cần ai thao tác.
 */
export const SWAP_REQUEST_MACHINE = {
  // SYS: CANCELLED = hợp đồng trả kho / đóng khi yêu cầu còn treo; EXPIRED = chi nhánh không xét trong SWAP_DECISION_DAYS ngày (nhả ô đích).
  SUBMITTED: { APPROVED: [FM], REJECTED: [FM], CANCELLED: [CU, SYS], EXPIRED: [SYS] },
  APPROVED:  { DONE: [ST, FM], EXPIRED: [SYS], CANCELLED: [CU, FM, SYS] }, // đã duyệt nhưng chưa chuyển vẫn huỷ được → nhả ô đang giữ
  REJECTED:  {}, DONE: {}, EXPIRED: {}, CANCELLED: {},
} as const satisfies StateMachine<SwapRequestStatus>;

/** Đơn dịch vụ thêm: nhân viên/quản lý xác nhận xong; khách, nhân viên hoặc quản lý đều huỷ được khi chưa thực hiện. */
export const SERVICE_ORDER_MACHINE = {
  REQUESTED: { DONE: [ST, FM], CANCELLED: [CU, ST, FM, SYS] },   // SYS = hợp đồng trả kho / đóng khi đơn chưa làm
  DONE: {}, CANCELLED: {},
} as const satisfies StateMachine<ServiceOrderStatus>;

/**
 * Yêu cầu cấp lại mã/thẻ/chìa. Chỉ Quản lý chi nhánh duyệt hoặc từ chối; mật khẩu được cấp ngay khi duyệt (SYSTEM đóng
 * yêu cầu), thẻ/chìa thì nhân viên hoặc quản lý bàn giao xong mới DONE. Huỷ ở mọi bước chưa DONE đều hoàn phí.
 */
export const ACCESS_REQUEST_MACHINE = {
  // SYS = tự huỷ (hoàn phí) khi kho đã bàn giao lại, đồ bỏ lại đã xử lý, hoặc đổi sang ô khác hình thức khoá.
  REQUESTED: { APPROVED: [FM], REJECTED: [FM], CANCELLED: [CU, SYS] },
  APPROVED:  { DONE: [ST, FM, SYS], CANCELLED: [CU, FM, SYS] },
  REJECTED: {}, DONE: {}, CANCELLED: {},
} as const satisfies StateMachine<AccessRequestStatus>;

/**
 * Đợt nhập hàng (đợt 14): khách khai → nhân viên / quản lý chi nhánh kiểm hàng cấm rồi xác nhận (hoặc từ chối khi có hàng cấm). Khách
 * tự huỷ khi chưa xác nhận; nhân viên / quản lý huỷ (kèm lý do) khi khách khai mà không mang đồ đến (đợt 15); SYS = tự huỷ khi hợp đồng
 * trả kho / đóng mà đợt còn chờ, hoặc quá INTAKE_DECLARED_EXPIRY_DAYS ngày sau ngày hẹn mang đến.
 */
export const INTAKE_BATCH_MACHINE = {
  DECLARED: { CONFIRMED: [ST, FM], REJECTED: [ST, FM], CANCELLED: [CU, ST, FM, SYS] },
  CONFIRMED: {}, REJECTED: {}, CANCELLED: {},
} as const satisfies StateMachine<IntakeBatchStatus>;

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(readonly entity: string, readonly from: string, readonly to: string, readonly actor?: Actor) {
    super(`${entity}: ${from} -> ${to} not allowed${actor ? ` for ${actor}` : ''}`);
  }
}

export function canTransition<S extends string>(m: StateMachine<S>, from: S, to: S, actor?: Actor): boolean {
  const actors = m[from][to];
  return !!actors && (actor === undefined || actors.includes(actor));
}

export function assertTransition<S extends string>(entity: string, m: StateMachine<S>, from: S, to: S, actor?: Actor): void {
  if (!canTransition(m, from, to, actor)) throw new InvalidTransitionError(entity, from, to, actor);
}

/** Drives UI buttons on web/mobile: which actions can this actor take right now? */
export function nextStates<S extends string>(m: StateMachine<S>, from: S, actor: Actor): S[] {
  return (Object.keys(m[from]) as S[]).filter((to) => canTransition(m, from, to, actor));
}

export const isTerminal = <S extends string>(m: StateMachine<S>, s: S) => Object.keys(m[s]).length === 0;
