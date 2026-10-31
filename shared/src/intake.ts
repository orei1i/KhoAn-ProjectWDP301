import type { ContractStatus, UnitCategory } from './enums';
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

/**
 * Đợt 16 (D1): NHÓM ĐỒ theo cỡ kho của hợp đồng (loại kho đang thuê — tính cả đổi cỡ). Ô "Nhóm" là ô CHỌN, một nguồn cho web + app + BE:
 * đợt nhập MỚI chỉ nhận nhóm thuộc danh sách của cỡ kho (422 INTAKE_CATEGORY_NOT_ALLOWED); dữ liệu cũ nhóm tự do vẫn đọc / hiển thị được.
 * Cỡ lớn hơn gồm cả các nhóm của cỡ nhỏ hơn; "Khác" luôn ở cuối.
 */
const CAT_LOCKER = ['Giấy tờ, hồ sơ', 'Đồ cá nhân', 'Quần áo, vali', 'Sách', 'Điện tử nhỏ (laptop, máy ảnh)'];
const CAT_SMALL = [...CAT_LOCKER, 'Thùng đồ', 'Đồ theo mùa', 'Nội thất nhỏ', 'Xe đạp, đồ thể thao'];
const CAT_MEDIUM = [...CAT_SMALL, 'Nội thất', 'Điện máy (tủ lạnh, máy giặt)', 'Hàng hoá kinh doanh'];
const CAT_LARGE = [...CAT_MEDIUM, 'Nội thất cả nhà', 'Máy móc, thiết bị', 'Pallet hàng', 'Vật liệu'];
export const INTAKE_OTHER_CATEGORY = 'Khác';
export const INTAKE_CATEGORIES_BY_SIZE: Record<UnitCategory, readonly string[]> = {
  LOCKER: [...CAT_LOCKER, INTAKE_OTHER_CATEGORY],
  SMALL: [...CAT_SMALL, INTAKE_OTHER_CATEGORY],
  MEDIUM: [...CAT_MEDIUM, INTAKE_OTHER_CATEGORY],
  LARGE: [...CAT_LARGE, INTAKE_OTHER_CATEGORY],
  XL: [...CAT_LARGE, INTAKE_OTHER_CATEGORY],
};
/** Danh sách nhóm của cỡ kho (không rõ cỡ → danh sách của cỡ lớn nhất, để không chặn nhầm). */
export const intakeCategoriesFor = (size?: UnitCategory | null): readonly string[] => INTAKE_CATEGORIES_BY_SIZE[size ?? 'XL'] ?? INTAKE_CATEGORIES_BY_SIZE.XL;
/** Nhóm có thuộc danh sách của cỡ kho không — trống (null) là "chưa chọn nhóm", vẫn nhận. */
export const intakeCategoryAllowed = (size: UnitCategory | null | undefined, category: string | null | undefined) =>
  !category?.trim() || intakeCategoriesFor(size).includes(category.trim());

/** Gợi ý tên đồ theo nhóm (chip / datalist) — chọn nhanh, vẫn gõ tên tự do được. */
export const INTAKE_ITEM_SUGGESTIONS: Record<string, readonly string[]> = {
  'Giấy tờ, hồ sơ': ['Thùng hồ sơ', 'Bìa hồ sơ công ty (bản sao)', 'Hộp tài liệu'],
  'Đồ cá nhân': ['Hộp đồ cá nhân', 'Túi xách', 'Đồ lưu niệm'],
  'Quần áo, vali': ['Vali quần áo', 'Thùng quần áo', 'Túi chăn mền'],
  'Sách': ['Thùng sách', 'Chồng sách', 'Truyện tranh'],
  'Điện tử nhỏ (laptop, máy ảnh)': ['Laptop', 'Máy ảnh', 'Ổ cứng di động', 'Loa bluetooth'],
  'Thùng đồ': ['Thùng carton', 'Thùng nhựa', 'Thùng đồ bếp'],
  'Đồ theo mùa': ['Thùng quần áo mùa đông', 'Cây thông Noel', 'Quạt đứng', 'Đồ trang trí Tết'],
  'Nội thất nhỏ': ['Ghế gấp', 'Kệ nhỏ', 'Bàn gấp', 'Đèn bàn'],
  'Xe đạp, đồ thể thao': ['Xe đạp', 'Lều cắm trại', 'Vợt, bóng', 'Máy tập'],
  'Nội thất': ['Sofa 3 chỗ', 'Tủ quần áo', 'Bàn làm việc', 'Kệ sách', 'Giường đôi + nệm'],
  'Điện máy (tủ lạnh, máy giặt)': ['Tủ lạnh', 'Máy giặt', 'TV', 'Điều hòa (tháo rời)'],
  'Hàng hoá kinh doanh': ['Thùng hàng', 'Kiện hàng online', 'Hàng mẫu'],
  'Nội thất cả nhà': ['Bàn ăn + 4 ghế', 'Giường đôi + nệm', 'Tủ quần áo', 'Sofa 3 chỗ'],
  'Máy móc, thiết bị': ['Máy khoan', 'Máy phát điện', 'Thiết bị văn phòng'],
  'Pallet hàng': ['Pallet hàng', 'Pallet thùng giấy'],
  'Vật liệu': ['Gạch men', 'Gỗ tấm', 'Ống nước, phụ kiện'],
  [INTAKE_OTHER_CATEGORY]: [],
};

/**
 * Bảng THỂ TÍCH tham khảo (m³) — dùng chung cho công cụ ước tính cỡ kho (web) và cảnh báo mềm khi khai đợt nhập (D1). `keys`: từ khoá
 * (chữ thường, đã bỏ dấu) nhận ra món trong tên đồ khách gõ.
 */
export interface VolumeItem { id: string; label: string; m3: number; hint?: string; keys: readonly string[] }
export const ITEM_VOLUME_GROUPS: { group: string; items: VolumeItem[] }[] = [
  { group: 'Đồ đóng gói', items: [
    { id: 'box', label: 'Thùng carton', m3: 0.1, hint: '50×40×50 cm', keys: ['thung carton', 'thung'] },
    { id: 'suitcase', label: 'Vali lớn', m3: 0.15, keys: ['vali'] },
    { id: 'files', label: 'Thùng hồ sơ', m3: 0.05, keys: ['ho so', 'tai lieu'] },
  ] },
  { group: 'Nội thất', items: [
    { id: 'sofa', label: 'Sofa 3 chỗ', m3: 1.5, keys: ['sofa'] },
    { id: 'bed', label: 'Giường đôi + nệm', m3: 1.6, keys: ['giuong', 'nem'] },
    { id: 'wardrobe', label: 'Tủ quần áo', m3: 1.2, keys: ['tu quan ao', 'tu ao'] },
    { id: 'table', label: 'Bàn ăn + 4 ghế', m3: 1.2, keys: ['ban an'] },
    { id: 'desk', label: 'Bàn làm việc', m3: 0.6, keys: ['ban lam viec'] },
    { id: 'shelf', label: 'Kệ sách', m3: 0.6, keys: ['ke sach', 'ke go'] },
  ] },
  { group: 'Điện máy', items: [
    { id: 'fridge', label: 'Tủ lạnh', m3: 0.8, keys: ['tu lanh'] },
    { id: 'washer', label: 'Máy giặt', m3: 0.5, keys: ['may giat'] },
    { id: 'tv', label: 'TV', m3: 0.2, keys: ['tivi', 'tv'] },
    { id: 'ac', label: 'Điều hòa (tháo rời)', m3: 0.2, keys: ['dieu hoa', 'may lanh'] },
  ] },
  { group: 'Khác', items: [
    { id: 'bike', label: 'Xe đạp', m3: 0.5, keys: ['xe dap'] },
    { id: 'gym', label: 'Máy tập / đồ thể thao', m3: 0.7, keys: ['may tap'] },
  ] },
];
/** Chiều cao xếp đồ an toàn (m) — thấp hơn chiều cao kho vì không ai xếp kịch trần — và hệ số chừa lối đi. */
export const STACK_HEIGHT_M = 1.8;
export const AISLE_FACTOR = 1.35;
const VOLUME_ITEMS = ITEM_VOLUME_GROUPS.flatMap((g) => g.items);
/** Thể tích tham khảo của MỘT món theo tên (khớp từ khoá dài nhất); không nhận ra → null (không tính vào cảnh báo). */
export function estimateItemVolume(name: string): number | null {
  const n = normalizeItemName(name);
  if (!n) return null;
  let best: { len: number; m3: number } | null = null;
  for (const it of VOLUME_ITEMS) for (const k of it.keys) if (n.includes(k) && (!best || k.length > best.len)) best = { len: k.length, m3: it.m3 };
  return best?.m3 ?? null;
}
/** Sức chứa ước tính của ô (m³ đồ xếp được) = diện tích ÷ hệ số lối đi × chiều cao xếp (không quá chiều cao ô). */
export const unitCapacityM3 = (t: { areaM2: number; dimensions?: { heightM: number } | null }) =>
  (t.areaM2 / AISLE_FACTOR) * Math.min(STACK_HEIGHT_M, t.dimensions?.heightM ?? STACK_HEIGHT_M);
/**
 * Cảnh báo MỀM (không chặn) khi khai đợt nhập: tổng thể tích ước tính (chỉ các món nhận ra được) RÕ RÀNG vượt sức chứa ô, hoặc một món quá
 * to so với cỡ kho (VD sofa vào tủ locker — một món chiếm quá nửa sức chứa). Trả các câu cảnh báo (rỗng = không có gì đáng lưu ý).
 */
export function intakeVolumeWarnings(
  items: readonly { name: string; quantity: number }[],
  unitType: { areaM2: number; dimensions?: { heightM: number } | null; name?: string } | null | undefined,
): string[] {
  if (!unitType || !(unitType.areaM2 > 0)) return [];
  const cap = unitCapacityM3(unitType);
  const where = unitType.name ?? 'ô kho này';
  const out: string[] = [];
  let total = 0;
  for (const it of items) {
    const v = estimateItemVolume(it.name);
    if (v === null) continue;
    total += v * Math.max(0, it.quantity);
    if (v > cap / 2) out.push(`"${it.name.trim()}" (~${v} m³) có vẻ quá to so với ${where}.`);
  }
  if (total > cap) out.push(`Tổng đồ ước tính ~${total.toFixed(1)} m³, vượt sức chứa ~${cap.toFixed(1)} m³ của ${where} — kiểm tra lại số lượng hoặc cân nhắc đổi cỡ kho.`);
  return out;
}

/**
 * Đợt 16 (D2): GỬI KÍN theo kiện — khách không kê khai chi tiết: chỉ số kiện, loại kiện, có niêm phong hay không, mô tả chung và TỔNG giá trị
 * khai (tuỳ chọn). Mỗi kiện là một dòng đánh số "Kiện 1..N" (theo dõi rút / trạng thái như món thường). Không mở kiện: kiểm hàng cấm chỉ là
 * quan sát bên ngoài (INTAKE_SEALED_CHECK_ITEMS) + khách ký BẢN CAM KẾT GIẤY tại quầy (nhân viên tick đã ký mới xác nhận được).
 */
export const SEALED_PACKAGE_KIND = { BOX: 'Thùng', SUITCASE: 'Vali', BAG: 'Túi', OTHER: 'Khác' } as const;
export type SealedPackageKind = keyof typeof SEALED_PACKAGE_KIND;
export const SEALED_PACKAGE_KINDS = Object.keys(SEALED_PACKAGE_KIND) as SealedPackageKind[];
export const SEALED_MAX_PACKAGES = 50;
export const SEALED_DESC_MAX = 300;
/** Phiên bản mẫu bản cam kết gửi kín (in ra giấy) — lưu vào đợt nhập khi nhân viên xác nhận khách đã ký. Đổi lời văn mẫu thì tăng. */
export const SEALED_PLEDGE_VERSION = '1.0';
/** Kiểm bên ngoài thay cho kiểm hàng cấm khi gửi kín — nhân viên KHÔNG mở kiện. */
export const INTAKE_SEALED_CHECK_ITEMS = [
  { key: 'SEALED_ODOR', label: 'Không có mùi lạ (hoá chất, xăng dầu, thực phẩm hỏng)' },
  { key: 'SEALED_LEAK', label: 'Không rò rỉ, thấm ướt, chảy dịch' },
  { key: 'SEALED_NOISE', label: 'Không có tiếng động / dấu hiệu sinh vật sống' },
  { key: 'SEALED_WEIGHT', label: 'Khối lượng, hình dạng không bất thường' },
] as const;
export type SealedCheckKey = (typeof INTAKE_SEALED_CHECK_ITEMS)[number]['key'];
/** Tên dòng của kiện thứ i (từ 1). */
export const sealedPackageName = (i: number) => `Kiện ${i}`;
/** Giá trị MỖI kiện = tổng giá trị khai ÷ số kiện (làm tròn xuống; phần lẻ dồn vào Kiện 1 để Σ đúng bằng tổng). Không khai → toàn 0. */
export function sealedPackageValues(total: number | null | undefined, count: number): number[] {
  const n = Math.max(0, Math.trunc(count));
  if (!n) return [];
  const t = Math.max(0, Math.trunc(total ?? 0));
  const each = Math.floor(t / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? t - each * (n - 1) : each));
}
/** Câu ngắn về bồi thường kiện gửi kín (màn hình khai, xác nhận, bồi thường và bản cam kết). */
export const SEALED_CLAIM_RULE = 'Bồi thường theo KIỆN, chỉ khi kiện bị mất hoặc hư hại bên ngoài do lỗi kho; giá trị mỗi kiện = tổng giá trị khai ÷ số kiện (không khai giá trị thì cần chứng cứ); luôn trong mức trần chung (10 tháng tiền thuê). Kiện còn nguyên niêm phong thì không nhận khiếu nại thiếu đồ bên trong.';
/** Tình trạng kiện khi khiếu nại: mất cả kiện / hư hại bên ngoài (gồm niêm phong bị phá) — nhận; kiện còn nguyên, chỉ thiếu đồ bên trong → không nhận. */
export const SEALED_PACKAGE_STATE = {
  MISSING: 'Mất cả kiện',
  OUTER_DAMAGE: 'Kiện hư hại bên ngoài / niêm phong bị phá',
  CONTENTS_ONLY: 'Kiện còn nguyên, chỉ thiếu / hư đồ bên trong',
} as const;
export type SealedPackageState = keyof typeof SEALED_PACKAGE_STATE;

/** Tổng giá trị ước tính của một danh sách đồ = Σ quantity × estValue. */
export const intakeItemsValue = (items: readonly Pick<IntakeBatchItem, 'quantity' | 'estValue'>[]) =>
  items.reduce((s, it) => s + it.quantity * it.estValue, 0);

type Iso = string | Date;
const iso = (d?: Iso | null) => (d == null ? null : typeof d === 'string' ? d : d.toISOString());
type RemovalLike = Pick<IntakeItemRemoval<unknown, Iso>, 'kind' | 'quantity' | 'at'>;
type ItemLike = { quantity: number; removals?: readonly RemovalLike[] | null; compensated?: number | null };

/** Σ số lượng đã ra khỏi kho (mọi lần) — theo loại nếu truyền `kind`. */
export const removedQty = (it: ItemLike, kind?: RemovalLike['kind']) =>
  (it.removals ?? []).filter((r) => !kind || r.kind === kind).reduce((s, r) => s + r.quantity, 0);
/** Số ĐANG GỬI = quantity − Σ removals − phần đã bồi thường (dòng hồ sơ PAID — đợt 17 D7), không âm. Dữ liệu cũ đã ghi trả cả phần đó thì vẫn ra 0. */
export const inStorageQty = (it: ItemLike) => Math.max(0, it.quantity - removedQty(it) - (it.compensated ?? 0));
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
export function itemStateOf(it: ItemLike): IntakeItemState {
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
  /** Đợt 16 (D2): dòng là một KIỆN của đợt gửi kín (giá trị = phần chia của tổng giá trị khai; 0 = không khai giá trị). */
  sealed?: boolean;
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

/** Đợt 17 (D7): nhãn số lượng một món, VD "3 Ghế: 1 đã bồi thường, 2 đã trả" — dùng chung web + app. */
export function itemStockLabel(it: Pick<InventoryItem, 'name' | 'quantity' | 'inStorage' | 'withdrawn' | 'returned' | 'disposed' | 'compensated'>) {
  const parts = [[it.inStorage, 'đang gửi'], [it.compensated, 'đã bồi thường'], [it.withdrawn, 'đã lấy ra'], [it.returned, 'đã trả'], [it.disposed, 'đã thanh lý']] as const;
  const text = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(', ');
  return `${it.quantity} ${it.name}${text ? `: ${text}` : ''}`;
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
  batches: readonly (Pick<IntakeBatch<unknown, Iso>, '_id' | 'code' | 'status' | 'items' | 'confirmedAt'> & { sealed?: unknown })[],
  claims?: readonly ClaimForInventory[],
): ContractInventory {
  const paid = claims ? compensatedByItem(claims) : null;
  const done = batches.filter((b) => b.status === 'CONFIRMED')
    .sort((a, b) => String(iso(a.confirmedAt) ?? '').localeCompare(String(iso(b.confirmedAt) ?? '')));
  const items: InventoryItem[] = done.flatMap((b) => b.items.map((it): InventoryItem => {
    const removals = (it.removals ?? []).map((r) => ({ kind: r.kind, quantity: r.quantity, at: String(iso(r.at)), by: r.by == null ? null : String(r.by), note: r.note ?? null }));
    const compensated = paid ? paid.get(String(it._id)) ?? 0 : it.compensated ?? 0;
    const base = { quantity: it.quantity, removals, compensated };
    // Hồ sơ đã chi SAU khi ghi "đã trả" cả món (sự cố trước ngày trả, chi sau) hoặc dữ liệu cũ: phần đã bồi thường không tính là đã trả.
    const overflow = Math.max(0, removedQty(base) + compensated - it.quantity);
    return {
      batchId: String(b._id), batchCode: b.code, itemId: String(it._id), name: it.name, category: it.category ?? null,
      quantity: it.quantity, estValue: it.estValue, condition: it.condition, note: it.note ?? null, confirmedAt: iso(b.confirmedAt),
      ...(it.addedByStaff ? { addedByStaff: true } : {}),
      ...(b.sealed ? { sealed: true } : {}),
      removals, inStorage: inStorageQty(base), withdrawn: removedQty(base, 'WITHDRAWN'), returned: Math.max(0, removedQty(base, 'RETURNED') - overflow), disposed: removedQty(base, 'DISPOSED'),
      compensated, state: itemStateOf(base),
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
