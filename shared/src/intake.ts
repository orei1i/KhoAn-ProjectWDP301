import type { ContractStatus } from './enums';
import type { IntakeBatch, IntakeBatchItem } from './entities';

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

/** Gợi ý nhóm đồ cho form khai (tự do nhập — không bắt buộc chọn trong danh sách). */
export const INTAKE_CATEGORY_SUGGESTIONS = ['Nội thất', 'Điện tử', 'Gia dụng', 'Quần áo', 'Sách, tài liệu', 'Dụng cụ', 'Thể thao', 'Hàng hoá kinh doanh', 'Khác'] as const;

/** Tổng giá trị ước tính của một danh sách đồ = Σ quantity × estValue. */
export const intakeItemsValue = (items: readonly Pick<IntakeBatchItem, 'quantity' | 'estValue'>[]) =>
  items.reduce((s, it) => s + it.quantity * it.estValue, 0);

/** Một dòng "đồ đang gửi" (GET /contracts/:id/inventory). */
export interface InventoryItem {
  batchId: string;
  batchCode: string;
  itemId: string;
  name: string;
  category?: string | null;
  quantity: number;
  estValue: number;
  condition: IntakeBatchItem['condition'];
  note?: string | null;
  confirmedAt: string | null;
}
export interface ContractInventory {
  items: InventoryItem[];
  /** Σ quantity × estValue của mọi dòng. */
  totalValue: number;
  /** Số đợt nhập đã xác nhận. */
  batchCount: number;
}

type Iso = string | Date;
const iso = (d?: Iso | null) => (d == null ? null : typeof d === 'string' ? d : d.toISOString());

/**
 * Danh sách đồ đang gửi của MỘT hợp đồng = các dòng của mọi đợt nhập CONFIRMED (đợt cũ trước). Cùng một hàm cho endpoint ở BE và màn
 * hình web / app (truyền các đợt nhập của hợp đồng đó lấy từ bootstrap).
 */
export function inventoryOf(batches: readonly Pick<IntakeBatch<unknown, Iso>, '_id' | 'code' | 'status' | 'items' | 'confirmedAt'>[]): ContractInventory {
  const done = batches.filter((b) => b.status === 'CONFIRMED')
    .sort((a, b) => String(iso(a.confirmedAt) ?? '').localeCompare(String(iso(b.confirmedAt) ?? '')));
  const items: InventoryItem[] = done.flatMap((b) => b.items.map((it) => ({
    batchId: String(b._id), batchCode: b.code, itemId: String(it._id), name: it.name, category: it.category ?? null,
    quantity: it.quantity, estValue: it.estValue, condition: it.condition, note: it.note ?? null, confirmedAt: iso(b.confirmedAt),
  })));
  return { items, totalValue: intakeItemsValue(items), batchCount: done.length };
}

/** Câu ngắn cho dòng bồi thường gắn cờ đồ ngoài danh sách. */
export const UNDECLARED_ITEM_NOTE = 'Ngoài danh sách đồ đã khai — cần chứng cứ (ảnh, hoá đơn)';
