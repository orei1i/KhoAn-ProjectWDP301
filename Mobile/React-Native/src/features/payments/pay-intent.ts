import type { Href } from 'expo-router';
import type { ExtensionQuote, PaymentMethod } from '@ssm/shared';
import type { RunResult } from '../../shared/store/store';
import type { ActionName, Payload, Value } from '../../shared/api/actions';

/**
 * Một khoản khách trả online qua cổng thanh toán (giả lập). Cổng là route riêng (/pay) nên mọi thông tin đi qua tham số `intent`
 * dạng JSON. Mỗi `kind` ứng với ĐÚNG một API có sẵn — hình thức thanh toán khách chọn trên cổng, bấm xác nhận mới gọi.
 */
export type PayTarget =
  | { kind: 'DEPOSIT'; reservationId: string; /** C1: trả khi nhận kho mà trả online trước — khách đã tick cảnh báo. */ codAck?: boolean }
  | { kind: 'EXTEND'; contractId: string; periods: number; expected: Pick<ExtensionQuote, 'rate' | 'payNow' | 'from' | 'newEndDate' | 'policyVersion' | 'appendixHash'>; idempotencyKey: string }
  | { kind: 'SERVICE'; contractId: string; serviceId: string; quantity: number; preferredDate?: string; note?: string }
  | { kind: 'BALANCE'; contractId: string }
  | { kind: 'ACCESS_FEE'; contractId: string; reason?: string };

export interface PayIntent {
  target: PayTarget;
  /** Chi nhánh nhận tiền — hiện "KhoAn — <chi nhánh>". */
  facilityId: string;
  /** Mã đặt chỗ / hợp đồng ghi vào nội dung thanh toán. */
  code: string;
  /** Loại khoản: "Tiền giữ chân", "Gia hạn 3 tháng"… */
  purpose: string;
  amount: number;
  /** Một câu cho màn kết quả khi trả xong: "Truy cập kho được khôi phục", "Ký hợp đồng để nhận kho"… */
  doneNote?: string;
  /** Trả xong thì về đâu: dismissTo(href) — lùi về màn đó nếu đang ở dưới, không thì thay cổng bằng màn đó (không chồng thêm màn). */
  back: { label: string; href: string };
}

const KINDS: PayTarget['kind'][] = ['DEPOSIT', 'EXTEND', 'SERVICE', 'BALANCE', 'ACCESS_FEE'];

/** Mở cổng: `router.push(payHref({...}))`. */
export const payHref = (intent: PayIntent): Href => ({ pathname: '/pay', params: { intent: JSON.stringify(intent) } });

/** Đọc lại tham số `intent` — hỏng / thiếu (link cũ, gõ tay) thì null để màn cổng báo không có khoản nào. */
export function parseIntent(raw: string | string[] | undefined): PayIntent | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as PayIntent;
    if (!v || !KINDS.includes(v.target?.kind) || typeof v.amount !== 'number' || typeof v.back?.href !== 'string') return null;
    return v;
  } catch {
    return null;
  }
}

type Run = <K extends ActionName>(name: K, payload: Payload<K>) => Promise<RunResult<Value<K>>>;

/**
 * Gọi đúng API của khoản với hình thức khách chọn — qua `run()` của store (tự tải lại dữ liệu, tự báo lỗi). `shown`: số tiền đang hiện trên
 * cổng + `key` của lần trả — trả công nợ gửi kèm (expectedAmount, idempotencyKey) để server từ chối khi số dư vừa đổi (409 BALANCE_CHANGED,
 * đợt 15 — B5) và không thu hai lần khi thử lại.
 */
export function payTarget(run: Run, t: PayTarget, method: PaymentMethod, shown?: { amount: number; key: string }): Promise<RunResult<unknown>> {
  switch (t.kind) {
    // Đợt 17 (D6): khoản đã thu từ lần trước → 200 `replayed: true`, không thu thêm; cổng báo thành công. `qrPayload` (null khi đã nhận kho) không dùng ở đây —
    // màn mã nhận kho tự xin mã mới.
    case 'DEPOSIT': return run('payDeposit', { reservationId: t.reservationId, method, codAck: t.codAck });
    // Khách đã tick xác nhận Phụ lục gia hạn ở màn gia hạn trước khi mở cổng.
    case 'EXTEND': return run('extendContract', { contractId: t.contractId, periods: t.periods, method, acceptAppendix: true, expected: t.expected, idempotencyKey: t.idempotencyKey });
    // Đợt 16 (C6): tổng / phí đang hiện + khoá của lần trả — giá đổi thì 409 PRICE_CHANGED, thử lại không thu hai lần.
    case 'SERVICE': return run('orderService', { contractId: t.contractId, serviceId: t.serviceId, quantity: t.quantity, preferredDate: t.preferredDate, note: t.note, method, expectedTotal: shown?.amount, idempotencyKey: shown?.key });
    case 'BALANCE': return run('payBalance', { contractId: t.contractId, method, expectedAmount: shown?.amount, idempotencyKey: shown?.key });
    case 'ACCESS_FEE': return run('requestAccess', { contractId: t.contractId, reason: t.reason, method, expectedFee: shown?.amount, idempotencyKey: shown?.key });
  }
}
