import type { SwapMoveItem } from './entities';

/**
 * Quy tắc phí đổi ô kho theo yêu cầu (A1b) — dùng chung server và màn duyệt của chi nhánh.
 *
 * Các con số ở đây là quy tắc vận hành cố định trong code (không nằm trong BusinessPolicy) —
 * cùng cách mức trách nhiệm bồi thường nằm trong claim-rules: đổi phí là quyết định sản phẩm cần
 * phát hành có chủ đích, không phải cấu hình Quản lý vận hành sửa được bất cứ lúc nào.
 *
 * - Đổi do LỖI CƠ SỞ (FM xác nhận lúc duyệt) → luôn miễn phí.
 * - LẦN ĐẦU khách đổi ô trên một hợp đồng → miễn phí (thiện chí).
 * - Từ lần thứ 2, không phải lỗi cơ sở → phí thao tác cố định.
 * - Chọn thuê người chuyển → cộng thêm phí chuyển đồ.
 * - FM được sửa phí trong trần SWAP_FEE_MAX (bao gồm cả phí chuyển đồ nếu có) kèm lý do.
 */
export const SWAP_FEE_DEFAULT = 150_000;
export const DELIVERY_FEE_DEFAULT = 300_000;
export const SWAP_FEE_MAX = 1_000_000;

/** Khách tự chuyển có 7 ngày kể từ lúc được duyệt để lên chuyển đồ; quá hạn thì yêu cầu tự hủy. */
export const SWAP_SELF_MOVE_DAYS = 7;
/** Chi nhánh không duyệt / từ chối trong bấy nhiêu ngày thì yêu cầu tự hết hạn — ô đích không bị giữ vô thời hạn. */
export const SWAP_DECISION_DAYS = 7;
/** Thuê người chuyển: quá ngày hẹn chuyển bấy nhiêu ngày mà chưa xác nhận xong thì yêu cầu hết hạn, ô đích được nhả. */
export const SWAP_DELIVERY_GRACE_DAYS = 3;

/** Đổi do lỗi chi nhánh hoặc lần đổi đầu tiên của hợp đồng: miễn phí — đúng lời hứa trên màn hình khách, FM không đặt phí khác. */
export const isFreeSwap = (input: { facilityFault: boolean; isFirstSwap: boolean }) => input.facilityFault || input.isFirstSwap;

/**
 * RV3 — AI CHỊU HƯ HẠI / MẤT MÁT KHI CHUYỂN ĐỒ ĐỔI Ô (giống cách các kho tự quản và dịch vụ chuyển đồ đang làm):
 *  - Tự chuyển: khách tự vận chuyển → khách tự chịu rủi ro trong lúc chuyển; KhoAn chỉ chịu phần do kho gây ra (Điều 6).
 *  - Thuê người chuyển: chi nhánh cử người → trước khi bàn giao, nhân viên ĐẾM SỐ KIỆN + CHỤP ẢNH (biên bản chuyển đồ, khách xem được).
 *    Hư hại / mất mát trong lúc chi nhánh chuyển do KhoAn chịu: khách gửi yêu cầu bồi thường như thường lệ, chi nhánh đối chiếu biên bản
 *    chuyển đồ; mức bồi thường theo Điều 6 (thiệt hại thực tế, tối đa CLAIM_CAP_MONTHS lần tiền thuê một tháng).
 */
export const SWAP_LIABILITY: Record<'SELF' | 'DELIVERY', string> = {
  SELF: 'Tự chuyển: hư hại, mất mát lúc chuyển do bạn tự chịu.',
  DELIVERY: 'Chi nhánh chuyển: nhân viên đếm kiện, chụp ảnh (bạn xem được); hư hại, mất mát lúc chuyển do KhoAn chịu.',
};
/** Báo hư hại / mất mát trong vòng bấy nhiêu ngày sau khi chi nhánh chuyển đồ thì coi là có thể do việc chuyển — chi nhánh đối chiếu biên bản. */
export const SWAP_DELIVERY_CLAIM_DAYS = 7;
/**
 * Lần CHI NHÁNH chuyển đồ (DELIVERY, đã xong) của hợp đồng mà ngày sự cố rơi vào [ngày chuyển, ngày chuyển + SWAP_DELIVERY_CLAIM_DAYS] —
 * màn xét bồi thường nhắc người duyệt: trách nhiệm của KhoAn, đối chiếu biên bản chuyển đồ (số kiện, ảnh).
 */
export function deliveryMoveFor<S extends { contractId: string; method: string; status: string; completedAt?: string | null }>(swaps: readonly S[], contractId: string, incidentAt: string): S | null {
  const day = incidentAt.slice(0, 10);
  return swaps.find((s) => {
    if (s.contractId !== contractId || s.method !== 'DELIVERY' || s.status !== 'DONE' || !s.completedAt) return false;
    const from = s.completedAt.slice(0, 10);
    const to = new Date(new Date(`${from}T00:00:00Z`).getTime() + SWAP_DELIVERY_CLAIM_DAYS * 86_400_000).toISOString().slice(0, 10);
    return from <= day && day <= to;
  }) ?? null;
}
/** Số kiện / món tối đa ghi trong biên bản chuyển đồ. */
export const MOVE_CHECK_PACKAGES_MAX = 999;

/** Phí mặc định hệ thống đề xuất khi FM mở màn duyệt — ngoài trường hợp miễn phí, FM có thể sửa trong trần SWAP_FEE_MAX. */
export function defaultSwapFee(input: { facilityFault: boolean; isFirstSwap: boolean; method: 'SELF' | 'DELIVERY' }): number {
  if (isFreeSwap(input)) return 0;
  return SWAP_FEE_DEFAULT + (input.method === 'DELIVERY' ? DELIVERY_FEE_DEFAULT : 0);
}

// ---------------------------------------------------------------- góp ý 17/11: đồ cần chuyển, khách đổi ngày chuyển

/** Thuê người chuyển chỉ khi kho đã có đồ được nhân viên xác nhận nhập — không thì không có gì để chi nhánh chuyển (422 SWAP_NO_STORED_GOODS). */
export const SWAP_NO_GOODS_TEXT = 'Kho chưa có đồ đã nhập — cần ít nhất một đợt nhập đã được nhân viên xác nhận';
/** Một dòng "đồ đang gửi" đủ để chọn đồ cần chuyển — khớp InventoryItem (inventoryOf ở intake.ts). */
export interface SwapGoodsLine { itemId: string; batchCode: string; name: string; inStorage: number; sealed?: boolean }
/** Đồ chuyển được = dòng còn trong kho (số đang gửi > 0): món của đợt nhập CONFIRMED sau khi trừ lấy ra / trả / bồi thường, và kiện gửi kín. */
export const swapMovableGoods = <T extends { inStorage: number }>(items: readonly T[]): T[] => items.filter((it) => it.inStorage > 0);

export type SwapItemsCode = 'SWAP_NO_STORED_GOODS' | 'SWAP_ITEMS_INVALID';
/**
 * Danh sách đồ cần chuyển lưu trên yêu cầu DELIVERY, từ đồ đang gửi và lựa chọn của khách. `picks` thiếu (null / undefined) = chuyển TẤT CẢ
 * đồ đang gửi với đủ số lượng. Mỗi món một lần, số lượng 1..số đang gửi; thứ tự theo danh sách đồ đang gửi. Dùng chung BE (kiểm) và web / app.
 */
export function swapMoveItemsFrom(goods: readonly SwapGoodsLine[], picks?: readonly { itemId: string; quantity: number }[] | null):
  { ok: true; items: SwapMoveItem[] } | { ok: false; code: SwapItemsCode; message: string } {
  const movable = swapMovableGoods(goods);
  if (!movable.length) return { ok: false, code: 'SWAP_NO_STORED_GOODS', message: SWAP_NO_GOODS_TEXT };
  const line = (g: SwapGoodsLine, quantity: number): SwapMoveItem => ({ itemId: g.itemId, batchCode: g.batchCode, name: g.name, quantity, ...(g.sealed ? { sealed: true } : {}), moved: null });
  if (!picks) return { ok: true, items: movable.map((g) => line(g, g.inStorage)) };
  if (!picks.length) return { ok: false, code: 'SWAP_ITEMS_INVALID', message: 'Chọn ít nhất một món cần chuyển' };
  const want = new Map<string, number>();
  for (const p of picks) {
    const g = movable.find((x) => x.itemId === p.itemId);
    if (!g || want.has(p.itemId)) return { ok: false, code: 'SWAP_ITEMS_INVALID', message: 'Danh sách đồ cần chuyển không khớp đồ đang gửi — tải lại rồi chọn lại' };
    if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > g.inStorage) {
      return { ok: false, code: 'SWAP_ITEMS_INVALID', message: `"${g.name}" chỉ còn ${g.inStorage} trong kho — chọn từ 1 đến ${g.inStorage}` };
    }
    want.set(p.itemId, p.quantity);
  }
  return { ok: true, items: movable.flatMap((g) => (want.has(g.itemId) ? [line(g, want.get(g.itemId)!)] : [])) };
}
/**
 * Chốt lại danh sách đồ cần chuyển lúc quản lý DUYỆT yêu cầu "Thuê người chuyển". Đợt nhập được nhân viên xác nhận SAU khi khách gửi yêu cầu
 * (yêu cầu đổi ô chặn duyệt tới khi đợt nhập đang chờ được xác nhận) là đồ khách chưa thể chọn → thêm đủ số lượng đang gửi. Món đã có trong danh
 * sách giữ số khách chọn nhưng không vượt số còn trong kho (khách lấy bớt ra trước đó); món không còn trong kho thì bỏ.
 */
export function swapMoveItemsRefresh(
  current: readonly SwapMoveItem[],
  goods: readonly (SwapGoodsLine & { confirmedAt?: string | null })[],
  requestedAt: Date | string,
): SwapMoveItem[] {
  const since = new Date(requestedAt).getTime();
  const movable = swapMovableGoods(goods);
  const kept = current.flatMap((it) => {
    const g = movable.find((x) => x.itemId === it.itemId);
    return g ? [{ ...it, quantity: Math.min(it.quantity, g.inStorage), moved: null }] : [];
  });
  const added = movable
    .filter((g) => !current.some((it) => it.itemId === g.itemId) && g.confirmedAt && new Date(g.confirmedAt).getTime() > since)
    .map((g): SwapMoveItem => ({ itemId: g.itemId, batchCode: g.batchCode, name: g.name, quantity: g.inStorage, ...(g.sealed ? { sealed: true } : {}), moved: null }));
  return [...kept, ...added];
}
/** Tổng số món / kiện của danh sách đồ cần chuyển. */
export const swapMoveItemsCount = (items: readonly Pick<SwapMoveItem, 'quantity'>[] | null | undefined) => (items ?? []).reduce((s, it) => s + it.quantity, 0);
/** Nhãn một dòng: "2 Thùng carton" / "Kiện 1 (gửi kín)". */
export const swapMoveItemLabel = (it: Pick<SwapMoveItem, 'quantity' | 'name' | 'sealed'>) => (it.sealed ? `${it.name} (gửi kín)` : `${it.quantity} ${it.name}`);

/**
 * LÝ DO CÒN MÓN CHƯA CHUYỂN lúc xác nhận đã chuyển xong (nhân viên không tick hết danh sách đồ cần chuyển):
 * - CUSTOMER_KEPT — khách giữ lại / mang về, không còn gì phải làm.
 * - NOT_YET — chưa chuyển kịp: đồ vẫn ở ô cũ, chi nhánh phải chuyển nốt.
 * - NOT_FOUND — chưa tìm thấy: phải tìm lại; không thấy thì báo khách và xét bồi thường.
 * NOT_YET / NOT_FOUND tự tạo việc nội bộ mức Cao, chờ quản lý chi nhánh phân công (`swapUnmovedNeedsTask`).
 * Yêu cầu cũ (trước khi có lý do): chỉ có ghi chú, `unmovedReason` = null.
 */
export const SWAP_UNMOVED_REASONS = ['CUSTOMER_KEPT', 'NOT_YET', 'NOT_FOUND'] as const;
export type SwapUnmovedReason = (typeof SWAP_UNMOVED_REASONS)[number];
export const SWAP_UNMOVED_REASON: Record<SwapUnmovedReason, string> = {
  CUSTOMER_KEPT: 'Khách giữ lại / mang về',
  NOT_YET: 'Chưa chuyển kịp',
  NOT_FOUND: 'Chưa tìm thấy',
};
export const swapUnmovedNeedsTask = (r: SwapUnmovedReason | null | undefined): r is 'NOT_YET' | 'NOT_FOUND' => r === 'NOT_YET' || r === 'NOT_FOUND';

/**
 * KHÁCH ĐỔI NGÀY CHUYỂN của yêu cầu "Thuê người chuyển" đã duyệt, chưa chuyển xong. Ngày mới từ NGÀY MAI (chi nhánh cần ít nhất một ngày để sắp
 * người) tới tối đa SWAP_SELF_MOVE_DAYS ngày kể từ hôm nay — cùng khung 7 ngày ô mới được giữ khi khách tự chuyển, để ô đích không bị giữ vô
 * thời hạn. Mỗi yêu cầu khách tự đổi tối đa SWAP_CUSTOMER_RESCHEDULE_MAX lần; quản lý chi nhánh dời ngày (POST /swap-requests/:id/reschedule)
 * không tính vào số lần này. Phí, ô mới, đồ cần chuyển giữ nguyên.
 */
export const SWAP_CUSTOMER_RESCHEDULE_MAX = 2;
export type SwapRescheduleCode = 'SWAP_NOT_RESCHEDULABLE' | 'SWAP_SAME_DATE' | 'SWAP_RESCHEDULE_WINDOW' | 'SWAP_RESCHEDULE_LIMIT';
type DayIso = string; // ngày date-only 'YYYY-MM-DDT00:00:00.000Z' (hoặc 'YYYY-MM-DD')
const dayOf = (d: DayIso | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
const plusDays = (d: DayIso, n: number) => new Date(Date.parse(`${dayOf(d)}T00:00:00.000Z`) + n * 86_400_000).toISOString();
/** Khung ngày khách được chọn, tính từ hôm nay (date-only ISO, như todayISO). */
export const swapRescheduleWindow = (today: DayIso) => ({ min: plusDays(today, 1), max: plusDays(today, SWAP_SELF_MOVE_DAYS) });
/** Số lần khách còn được tự đổi ngày chuyển. */
export const swapCustomerReschedulesLeft = (s: { scheduleChanges?: readonly { byRole: string }[] | null }) =>
  Math.max(0, SWAP_CUSTOMER_RESCHEDULE_MAX - (s.scheduleChanges ?? []).filter((x) => x.byRole === 'CUSTOMER').length);
/** Kiểm lần khách đổi ngày chuyển sang `newDate` (date-only) — cùng quy tắc ở server và nút "Đổi ngày chuyển" trên web / app. */
export function swapRescheduleCheck(
  s: { method: string; status: string; scheduledFor?: string | Date | null; scheduleChanges?: readonly { byRole: string }[] | null },
  newDate: DayIso, today: DayIso,
): { ok: true } | { ok: false; code: SwapRescheduleCode; message: string } {
  if (s.method !== 'DELIVERY' || s.status !== 'APPROVED') return { ok: false, code: 'SWAP_NOT_RESCHEDULABLE', message: 'Chỉ đổi ngày cho yêu cầu "Thuê người chuyển" đã duyệt, chưa chuyển xong' };
  if (swapCustomerReschedulesLeft(s) <= 0) return { ok: false, code: 'SWAP_RESCHEDULE_LIMIT', message: `Bạn đã đổi ngày chuyển ${SWAP_CUSTOMER_RESCHEDULE_MAX} lần — cần đổi nữa, vui lòng liên hệ chi nhánh` };
  if (s.scheduledFor && dayOf(s.scheduledFor) === dayOf(newDate)) return { ok: false, code: 'SWAP_SAME_DATE', message: 'Ngày mới trùng ngày hẹn hiện tại' };
  const w = swapRescheduleWindow(today);
  if (dayOf(newDate) < dayOf(w.min) || dayOf(newDate) > dayOf(w.max)) {
    return { ok: false, code: 'SWAP_RESCHEDULE_WINDOW', message: `Chọn ngày từ ngày mai đến tối đa ${SWAP_SELF_MOVE_DAYS} ngày kể từ hôm nay — chi nhánh cần một ngày để sắp người, ô mới chỉ được giữ trong khung này` };
  }
  return { ok: true };
}
