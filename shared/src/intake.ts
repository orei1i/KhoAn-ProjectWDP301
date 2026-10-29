import type { ContractStatus } from './enums';
import type { IntakeBatch, IntakeBatchItem, IntakeItemRemoval } from './entities';
import type { IntakeItemState } from './labels';
import { vnDayOf } from './format';

/**
 * NHẬP HÀNG nhiều đợt (đợt 14) — quy tắc dùng chung BE (kiểm), Webapp, app (form khai, danh sách đồ đang gửi, chọn đồ khi bồi thường).
 * Nhận kho (check-in) chỉ còn đối chiếu giấy tờ, ký, thu tiền, giao chìa / thẻ / PIN; mỗi lần mang đồ vào là một đợt nhập riêng.
 */
export const INTAKE_MAX_ITEMS = 100;
export const INTAKE_ITEM_NAME_MIN = 2;
export const INTAKE_ITEM_NAME_MAX = 100;
export const INTAKE_QTY_MAX = 999;
/** Giá trị ước tính tối đa cho MỘT cái (VND). */
export const INTAKE_VALUE_MAX = 1_000_000_000;
export const INTAKE_NOTE_MAX = 300;
export const INTAKE_CATEGORY_MAX = 60;

/** Hợp đồng nhận khai đợt nhập: đang thuê, kể cả đang quá hạn thanh toán nhưng CHƯA bị khoá quyền ra vào. */
export const INTAKE_CONTRACT_STATUSES: readonly ContractStatus[] = ['ACTIVE', 'DELINQUENT'];
export const canDeclareIntake = (c: { status: ContractStatus }) => INTAKE_CONTRACT_STATUSES.includes(c.status);

/**
 * Đợt 15 (A8): đợt khách KHAI mà không mang đồ đến — quá ngày hẹn mang đến (không hẹn thì ngày khai) bấy nhiêu ngày thì hệ thống tự huỷ
 * (lý do INTAKE_EXPIRED_REASON). Nhân viên / quản lý chi nhánh cũng huỷ được bất cứ lúc nào, kèm lý do (≥ INTAKE_CANCEL_REASON_MIN ký tự).
 */
export const INTAKE_DECLARED_EXPIRY_DAYS = 7;
export const INTAKE_EXPIRED_REASON = 'Quá hạn mang hàng đến';
export const INTAKE_CANCEL_REASON_MIN = 5;

/**
 * Hợp đồng còn GIỮ ĐỒ của khách (A7): chưa bàn giao lại kho, chưa đóng. Chỉ khi đó mới ghi "khách lấy đồ ra"; khi trả kho, mọi món còn lại
 * tự ghi "trả khi trả kho" (RETURNED), khi thanh lý hàng bỏ lại thì "thanh lý" (DISPOSED).
 */
export const INTAKE_HOLDING_STATUSES: readonly ContractStatus[] = ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT', 'MOVE_OUT_PENDING'];
export const contractHoldsGoods = (c: { status: ContractStatus; access?: { revokedAt?: string | Date | null } | null; moveOut?: { returnedOn?: string | Date | null } | null }) =>
  INTAKE_HOLDING_STATUSES.includes(c.status) && !c.access?.revokedAt && !c.moveOut?.returnedOn;

/** Gợi ý nhóm đồ cho form khai (tự do nhập — không bắt buộc chọn trong danh sách). */
export const INTAKE_CATEGORY_SUGGESTIONS = ['Nội thất', 'Điện tử', 'Gia dụng', 'Quần áo', 'Sách, tài liệu', 'Dụng cụ', 'Thể thao', 'Hàng hoá kinh doanh', 'Khác'] as const;

/** Tổng giá trị ước tính của một danh sách đồ = Σ quantity × estValue. */
export const intakeItemsValue = (items: readonly Pick<IntakeBatchItem, 'quantity' | 'estValue'>[]) =>
  items.reduce((s, it) => s + it.quantity * it.estValue, 0);

type Iso = string | Date;
const iso = (d?: Iso | null) => (d == null ? null : typeof d === 'string' ? d : d.toISOString());
type RemovalLike = Pick<IntakeItemRemoval<unknown, Iso>, 'kind' | 'quantity' | 'at'>;
type ItemLike = { quantity: number; removals?: readonly RemovalLike[] | null };

/** Σ số lượng đã ra khỏi kho (mọi lần) — theo loại nếu truyền `kind`. */
export const removedQty = (it: ItemLike, kind?: RemovalLike['kind']) =>
  (it.removals ?? []).filter((r) => !kind || r.kind === kind).reduce((s, r) => s + r.quantity, 0);
/** Số ĐANG GỬI = quantity − Σ removals (không âm). */
export const inStorageQty = (it: ItemLike) => Math.max(0, it.quantity - removedQty(it));
/**
 * Số còn trong kho VÀO NGÀY `day` ('YYYY-MM-DD', ngày VN): chỉ trừ các lần ra khỏi kho có ngày TRƯỚC ngày đó (cùng ngày vẫn tính là còn —
 * sự cố đúng ngày trả kho / ngày lấy ra vẫn được xét).
 */
export const heldOnDay = (it: ItemLike, day: string) =>
  Math.max(0, it.quantity - (it.removals ?? []).filter((r) => String(iso(r.at)).slice(0, 10) < day).reduce((s, r) => s + r.quantity, 0));
/**
 * "Số còn đòi được" của một món cho sự cố ngày `incidentDay` (A1 + A7) = số còn trong kho vào ngày đó − số đã yêu cầu ở các hồ sơ khác
 * (mọi hồ sơ chưa bị từ chối / rút, kể cả đã chi). Không âm.
 */
export const claimableQty = (it: ItemLike, incidentDay: string, claimedElsewhere: number) => Math.max(0, heldOnDay(it, incidentDay) - claimedElsewhere);

/** Món nhập kho SAU ngày sự cố (A5): ngày VN của lúc xác nhận > ngày sự cố ('YYYY-MM-DD'). */
export const confirmedAfterIncident = (confirmedAt: Iso | null | undefined, incidentDay: string) => !!confirmedAt && vnDayOf(confirmedAt) > incidentDay;

/** Trạng thái hiển thị của một món đồ đã xác nhận (A7). Bồi thường một phần vẫn là "Đang gửi" (màn hình ghi thêm số đã bồi thường). */
export function itemStateOf(it: ItemLike & { compensated?: number | null }): IntakeItemState {
  const left = inStorageQty(it);
  if ((it.compensated ?? 0) >= it.quantity && it.quantity > 0) return 'COMPENSATED';
  if (removedQty(it, 'DISPOSED') > 0) return 'DISPOSED';
  if (removedQty(it, 'RETURNED') > 0) return 'RETURNED';
  if (removedQty(it, 'WITHDRAWN') > 0) return left === 0 ? 'WITHDRAWN' : 'PARTLY_WITHDRAWN';
  return 'IN_STORAGE';
}

/** Một dòng "đồ đang gửi" (GET /contracts/:id/inventory). */
export interface InventoryItem {
  batchId: string;
  batchCode: string;
  itemId: string;
  name: string;
  category?: string | null;
  /** Số đã xác nhận nhập kho. */
  quantity: number;
  estValue: number;
  condition: IntakeBatchItem['condition'];
  note?: string | null;
  confirmedAt: string | null;
  /** Đợt 15: dòng nhân viên thêm lúc xác nhận. */
  addedByStaff?: boolean;
  /** Đợt 15 (A7): lịch sử ra khỏi kho, số ĐANG GỬI, số đã lấy ra / trả / thanh lý, số đã bồi thường (dòng hồ sơ PAID), trạng thái hiển thị. */
  removals: IntakeItemRemoval<string, string>[];
  inStorage: number;
  withdrawn: number;
  returned: number;
  disposed: number;
  compensated: number;
  state: IntakeItemState;
}
export interface ContractInventory {
  items: InventoryItem[];
  /** Đợt 15: Σ SỐ ĐANG GỬI × estValue (món đã lấy ra / trả / thanh lý không còn tính). */
  totalValue: number;
  /** Σ số đang gửi của mọi dòng. */
  inStorageCount: number;
  /** Σ quantity × estValue của mọi dòng đã xác nhận (kể cả đã ra khỏi kho). */
  declaredValue: number;
  /** Số đợt nhập đã xác nhận. */
  batchCount: number;
}

/** Hồ sơ bồi thường tối thiểu để đếm số đã bồi thường của từng món (dòng của hồ sơ PAID có intakeItemId). */
export type ClaimForInventory = { status: string; items: readonly { intakeItemId?: string | null; quantity: number }[] };
export function compensatedByItem(claims: readonly ClaimForInventory[]) {
  const m = new Map<string, number>();
  for (const c of claims) {
    if (c.status !== 'PAID') continue;
    for (const it of c.items) if (it.intakeItemId) m.set(it.intakeItemId, (m.get(it.intakeItemId) ?? 0) + it.quantity);
  }
  return m;
}

/**
 * Danh sách đồ đang gửi của MỘT hợp đồng = các dòng của mọi đợt nhập CONFIRMED (đợt cũ trước). Cùng một hàm cho endpoint ở BE và màn
 * hình web / app (truyền các đợt nhập của hợp đồng đó lấy từ bootstrap). Số đã bồi thường: đếm từ `claims` nếu truyền, không thì lấy
 * `items[].compensated` server đã tính sẵn trong bootstrap.
 */
export function inventoryOf(
  batches: readonly Pick<IntakeBatch<unknown, Iso>, '_id' | 'code' | 'status' | 'items' | 'confirmedAt'>[],
  claims?: readonly ClaimForInventory[],
): ContractInventory {
  const paid = claims ? compensatedByItem(claims) : null;
  const done = batches.filter((b) => b.status === 'CONFIRMED')
    .sort((a, b) => String(iso(a.confirmedAt) ?? '').localeCompare(String(iso(b.confirmedAt) ?? '')));
  const items: InventoryItem[] = done.flatMap((b) => b.items.map((it): InventoryItem => {
    const removals = (it.removals ?? []).map((r) => ({ kind: r.kind, quantity: r.quantity, at: String(iso(r.at)), by: r.by == null ? null : String(r.by), note: r.note ?? null }));
    const compensated = paid ? paid.get(String(it._id)) ?? 0 : it.compensated ?? 0;
    const base = { quantity: it.quantity, removals };
    return {
      batchId: String(b._id), batchCode: b.code, itemId: String(it._id), name: it.name, category: it.category ?? null,
      quantity: it.quantity, estValue: it.estValue, condition: it.condition, note: it.note ?? null, confirmedAt: iso(b.confirmedAt),
      ...(it.addedByStaff ? { addedByStaff: true } : {}),
      removals, inStorage: inStorageQty(base), withdrawn: removedQty(base, 'WITHDRAWN'), returned: removedQty(base, 'RETURNED'), disposed: removedQty(base, 'DISPOSED'),
      compensated, state: itemStateOf({ ...base, compensated }),
    };
  }));
  return {
    items,
    totalValue: items.reduce((s, it) => s + it.inStorage * it.estValue, 0),
    inStorageCount: items.reduce((s, it) => s + it.inStorage, 0),
    declaredValue: intakeItemsValue(items),
    batchCount: done.length,
  };
}

/** Chuẩn hoá tên đồ để so trùng (A9): chữ thường, bỏ dấu tiếng Việt (kể cả đ), gộp khoảng trắng. */
export const normalizeItemName = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
/** Tên chứa / nằm trong nhau chỉ tính khi tên ngắn hơn có ít nhất bấy nhiêu ký tự (tránh "ao" khớp mọi thứ). */
const MATCH_MIN_LEN = 3;
/** A9: đồ "ngoài danh sách" có tên trùng, chứa hoặc nằm trong tên một món đã khai (đã chuẩn hoá) → món đó (ưu tiên trùng hẳn). Không có → null. */
export function matchDeclaredName<T extends { name: string }>(name: string, candidates: readonly T[]): T | null {
  const a = normalizeItemName(name);
  if (!a) return null;
  const norm = candidates.map((c) => ({ c, b: normalizeItemName(c.name) }));
  const exact = norm.find((x) => x.b === a);
  if (exact) return exact.c;
  const part = norm.find((x) => x.b && Math.min(a.length, x.b.length) >= MATCH_MIN_LEN && (x.b.includes(a) || a.includes(x.b)));
  return part?.c ?? null;
}

/** Câu ngắn cho dòng bồi thường gắn cờ đồ ngoài danh sách. */
export const UNDECLARED_ITEM_NOTE = 'Ngoài danh sách đồ đã khai — cần chứng cứ (ảnh, hoá đơn)';
