import type {
  AccessMethod, AccessRequest, AuditLog, BusinessPolicy, ContractStatus, DamageClaim, Facility, InspectionLog, PaymentMethod,
  PaymentTransaction, RentalContract, RentalPeriod, Reservation, ReservationStatus, ServiceOffering, ServiceOrder, StorageUnit, SupportTicket,
  UnitCategory, UnitStatus, UnitSwapRequest, UnitType, User,
} from '@ssm/shared';
import {
  ACCESS_METHOD, INTAKE_CHECK_ITEMS, LOCKOUT_MIN_NOTICE_DAYS, OUTBOUND_PAYMENT_TYPES, PRIVACY_VERSION, TERMS_VERSION, abandonDaysOf, cancellationRefundOf,
  claimCapOf, daysBetween, isMonthOnly, localMidnightMs, pickDiscount, prepaidPeriodsOf, rentBeforeUse, tierTermsOf,
} from '@ssm/shared';
import { addDays, addMonths, addPeriods, todayISO } from './format'; // đường dẫn tương đối: BE/src/scripts/seed.ts dùng lại file này, ngoài tầm alias @/ của Webapp

export interface DB {
  users: User[];
  facilities: Facility[];
  unitTypes: UnitType[];
  units: StorageUnit[];
  reservations: Reservation[];
  contracts: RentalContract[];
  payments: PaymentTransaction[];
  inspections: InspectionLog[];
  tickets: SupportTicket[];
  claims: DamageClaim[];
  swapRequests: UnitSwapRequest[];
  services: ServiceOffering[];
  serviceOrders: ServiceOrder[];
  accessRequests: AccessRequest[];
  policies: BusinessPolicy[];
  audit: AuditLog[];
}

// ---------- deterministic helpers ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260911);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function makeCode(prefix: string, r: () => number = rand) {
  const ymd = todayISO().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${ymd}-${Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(r() * 32)]).join('')}`;
}

const NOW = new Date().toISOString();
const base = (id: string, createdAt = NOW) => ({ _id: id, createdAt, updatedAt: createdAt, createdBy: null, updatedBy: null });
const alive = { isDeleted: false, deletedAt: null, deletedBy: null };
let seq = 0;
const nid = (p: string) => `${p}-${(++seq).toString(36).padStart(4, '0')}`;
/** id lồng bên trong document (VD contract.notices[]._id) — seed không đổi các id này nên phải là chuỗi ObjectId hợp lệ (24 hex). */
const subId = () => `ffff${(++seq).toString(16).padStart(20, '0')}`;

// ---------- users ----------
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const MID = ['Văn', 'Thị', 'Minh', 'Ngọc', 'Quốc', 'Thanh', 'Gia', 'Hoài', 'Đức', 'Thu', 'Bảo', 'Khánh'];
const FIRST = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hạnh', 'Khoa', 'Linh', 'My', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Thảo', 'Uyên', 'Việt', 'Yến', 'Khang', 'Nhi', 'Tâm', 'Hiếu', 'Trang'];

function user(id: string, fullName: string, role: User['role'], facilityIds: string[] = [], extra: Partial<User> = {}): User {
  const slug = fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().split(' ');
  const created = base(id, addDays(todayISO(), -int(30, 500)));
  return {
    ...created, ...alive,
    // Khách đã đồng ý Điều khoản + Chính sách bảo mật bản hiện hành — không hiện hộp thoại "đồng ý lại" khi demo.
    ...(role === 'CUSTOMER' ? { consent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: created.createdAt, method: 'SIGNUP_FORM' as const } } : {}),
    email: `${slug.at(-1)}.${slug[0]}${id.slice(-2)}@${role === 'CUSTOMER' ? 'gmail.com' : 'khoan.vn'}`,
    phone: `09${int(10000000, 99999999)}`,
    fullName, role, facilityIds, status: 'ACTIVE', tokenVersion: 0,
    lastLoginAt: addDays(NOW, -int(0, 6)), customerProfile: null, ...extra,
  };
}

export const DEMO_IDS = {
  customer: 'u-cus-demo',
  staff: 'u-staff-q7',
  manager: 'u-fm-q7',
  ops: 'u-ops-1',
  admin: 'u-admin-1',
} as const;

export function createSeed(): DB {
  seq = 0;
  const T = todayISO();

  const users: User[] = [
    user(DEMO_IDS.customer, 'Nguyễn Minh Anh', 'CUSTOMER', [], { customerProfile: { idType: 'CCCD', idNumberLast4: '4821', address: 'TP. Hồ Chí Minh' } }),
    user(DEMO_IDS.staff, 'Đỗ Văn Tài', 'STAFF', ['f-q7'], { shift: 'SHIFT_1' }),
    user('u-staff-q7b', 'Hồ Thị Lan', 'STAFF', ['f-q7'], { shift: 'SHIFT_3' }),
    user('u-staff-td', 'Ngô Đức Minh', 'STAFF', ['f-td'], { shift: 'SHIFT_2' }),
    user('u-staff-tb', 'Dương Thu Trang', 'STAFF', ['f-tb'], { shift: 'SHIFT_1' }),
    // Giấy uỷ quyền ký hợp đồng thay Bên A của Giám đốc Nguyễn Văn A — in vào hợp đồng / phụ lục của chi nhánh.
    user(DEMO_IDS.manager, 'Bùi Thanh Tùng', 'FACILITY_MANAGER', ['f-q7'], { authorization: { number: '01/2026/UQ-KHOAN', issuedOn: '2026-09-01T00:00:00.000Z' } }),
    // Mỗi chi nhánh đúng một quản lý — user.model.ts chặn FACILITY_MANAGER có số chi nhánh khác 1.
    user('u-fm-td', 'Lý Mỹ Duyên', 'FACILITY_MANAGER', ['f-td'], { authorization: { number: '02/2026/UQ-KHOAN', issuedOn: '2026-09-01T00:00:00.000Z' } }),
    user('u-fm-tb', 'Trần Quốc Bảo', 'FACILITY_MANAGER', ['f-tb'], { authorization: { number: '03/2026/UQ-KHOAN', issuedOn: '2026-09-15T00:00:00.000Z' } }),
    user(DEMO_IDS.ops, 'Phan Hoàng Nam', 'OPS_MANAGER'),
    user(DEMO_IDS.admin, 'Trịnh Khánh Linh', 'ADMIN'),
    user('u-staff-new', 'Vũ Gia Khang', 'STAFF', ['f-td'], { status: 'PENDING_VERIFICATION', lastLoginAt: null, shift: 'SHIFT_4' }),
  ];
  const pool: User[] = [];
  for (let i = 1; i <= 45; i++) {
    const u = user(`u-c-${String(i).padStart(2, '0')}`, `${pick(LAST)} ${pick(MID)} ${pick(FIRST)}`, 'CUSTOMER');
    if (i === 7) u.status = 'SUSPENDED';
    pool.push(u);
  }
  users.push(...pool);

  // ---------- facilities ----------
  const fac = (id: string, code: string, name: string, line1: string, district: string, lngLat: [number, number], status: Facility['status'] = 'ACTIVE', policyId: string | null = null): Facility => ({
    ...base(id, addDays(T, -900)), ...alive, code, name, status,
    address: { line1, district, city: 'TP. Hồ Chí Minh', country: 'VN' },
    location: { type: 'Point', coordinates: lngLat },
    timezone: 'Asia/Ho_Chi_Minh', currency: 'VND',
    operatingHours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, open: d === 0 ? '08:00' : '07:00', close: d === 0 ? '17:00' : '21:00' })),
    accessHours: { open: '06:00', close: '22:00' },
    contact: { phone: `028 3${int(1000000, 9999999)}`, email: `${code.toLowerCase()}@khoan.vn` },
    amenities: ['Kiểm soát ra vào', 'Xe đẩy miễn phí', 'Thang máy tải hàng', 'Bảo vệ trực đêm'],
    imageUrls: [], policyId,
  });
  const facilities: Facility[] = [
    fac('f-q7', 'HCM-Q7-01', 'KhoAn Quận 7', '88 Nguyễn Thị Thập', 'Khu Quận 7', [106.7009, 10.7385]),
    fac('f-td', 'HCM-TD-01', 'KhoAn Thủ Đức', '215 Võ Văn Ngân', 'Khu Thủ Đức', [106.7619, 10.8506], 'ACTIVE', 'pol-td-1'),
    fac('f-tb', 'HCM-TB-01', 'KhoAn Tân Bình', '42 Cộng Hòa', 'Khu Tân Bình', [106.6526, 10.8012]),
    fac('f-bt', 'HCM-BT-01', 'KhoAn Bình Thạnh', '19 Điện Biên Phủ', 'Khu Bình Thạnh', [106.7075, 10.8016], 'UNDER_CONSTRUCTION'),
  ];

  // ---------- policies ----------
  const policyBody = {
    deposit: { mode: 'PERIODS_OF_RENT' as const, value: 1 },
    reservationHoldMinutes: 30, allocationLeadDays: 3, noShowAfterHours: 24,
    gracePeriodDays: 5, lockoutAfterDays: 15, abandonAfterLockedOutDays: 30,
    lateFees: [
      { afterDays: 5, kind: 'PERCENT_OF_RENT' as const, value: 5, recurringEveryDays: null },
      { afterDays: 15, kind: 'FIXED' as const, value: 200_000, recurringEveryDays: 30 },
    ],
    cancellation: [
      { minHoursBeforeStart: 72, depositRefundPct: 100 },
      { minHoursBeforeStart: 24, depositRefundPct: 50 },
      { minHoursBeforeStart: 0, depositRefundPct: 0 },
    ],
    earlyTermination: [
      { maxElapsedPct: 25, depositRefundPct: 0 },
      { maxElapsedPct: 50, depositRefundPct: 50 },
      { maxElapsedPct: 100, depositRefundPct: 100 },
    ],
    minPeriods: 1, maxPeriods: 36,
    surcharges: [{ code: 'CLIMATE', label: 'Kho điều hòa nhiệt độ', kind: 'PERCENT' as const, value: 10, categories: ['SMALL', 'MEDIUM', 'LARGE', 'XL'] as UnitCategory[] }],
    discounts: [
      // Ưu đãi thuê dài hạn theo số THÁNG (chỉ chu kỳ THÁNG): 3 tháng −10%, 6 tháng −15%, 1 năm trở lên −20%.
      { code: 'DAI_HAN_3', kind: 'PERCENT' as const, value: 10, minPeriods: 3, validFrom: null, validTo: null, requiresApprovalRole: null },
      { code: 'DAI_HAN_6', kind: 'PERCENT' as const, value: 15, minPeriods: 6, validFrom: null, validTo: null, requiresApprovalRole: null },
      { code: 'DAI_HAN_12', kind: 'PERCENT' as const, value: 20, minPeriods: 12, validFrom: null, validTo: null, requiresApprovalRole: null },
    ],
    // Phí cấp lại mã/thẻ/chìa: mật khẩu miễn phí, thẻ 50.000đ, chìa miễn phí (Ops chỉnh ở trang Chính sách).
    accessFees: { PIN_RESET: 0, CARD_REISSUE: 50_000, KEY_REISSUE: 0 },
    waiverLimits: [{ role: 'FACILITY_MANAGER' as const, maxAmount: 500_000 }, { role: 'OPS_MANAGER' as const, maxAmount: 5_000_000 }],
  };
  const policies: BusinessPolicy[] = [
    { ...base('pol-g-2', addDays(T, -400)), scope: 'GLOBAL', facilityId: null, version: 2, isActive: false, effectiveFrom: addDays(T, -400), ...policyBody, gracePeriodDays: 3, lockoutAfterDays: 10 },
    { ...base('pol-g-3', addDays(T, -120)), scope: 'GLOBAL', facilityId: null, version: 3, isActive: true, effectiveFrom: addDays(T, -120), ...policyBody },
    { ...base('pol-td-1', addDays(T, -60)), scope: 'FACILITY', facilityId: 'f-td', version: 1, isActive: true, effectiveFrom: addDays(T, -60), ...policyBody, gracePeriodDays: 7, lockoutAfterDays: 20 },
  ];

  // ---------- unit types ----------
  // Khách tự chọn chu kỳ lúc đặt (ngày/tuần/tháng) — mỗi loại kho niêm yết sẵn cả 3 giá (giá GỐC,
  // ô không điều hòa). Điều hòa và hình thức khoá KHÔNG còn cố định theo loại kho — mỗi Ô VẬT LÝ tự
  // có (xem vòng lặp bên dưới), nên cùng một loại kho có cả ô thường/ô điều hòa, cả 3 hình thức khoá.
  const TYPE_DEFS = [
    { key: 'LK', code: 'LK-1x1', name: 'Tủ locker', category: 'LOCKER', dims: [1, 1, 1.2], rates: { DAY: 25_000, WEEK: 140_000, MONTH: 390_000 }, count: 18, floors: [1], prefix: 'T', minPeriods: 1, desc: 'Vừa vali, hồ sơ, đồ cá nhân. Phù hợp sinh viên. Không điều hòa, mở bằng mật khẩu.' },
    { key: 'S', code: 'S-1.5x2', name: 'Phòng S', category: 'SMALL', dims: [1.5, 2, 2.4], rates: { DAY: 60_000, WEEK: 350_000, MONTH: 990_000 }, count: 30, floors: [1, 2], prefix: 'S', minPeriods: 1, desc: 'Tương đương đồ đạc một phòng ngủ nhỏ. Có cả ô thường và ô điều hòa, đủ 3 hình thức khoá.' },
    { key: 'M', code: 'M-2x3', name: 'Phòng M', category: 'MEDIUM', dims: [2, 3, 2.4], rates: { DAY: 100_000, WEEK: 600_000, MONTH: 1_790_000 }, count: 24, floors: [2, 3], prefix: 'M', minPeriods: 1, desc: 'Đồ đạc căn hộ 1–2 phòng ngủ, hàng tồn kho shop online. Có cả ô thường và ô điều hòa, đủ 3 hình thức khoá.' },
    { key: 'L', code: 'L-3x4', name: 'Phòng L', category: 'LARGE', dims: [3, 4, 2.8], rates: { DAY: 180_000, WEEK: 1_050_000, MONTH: 3_200_000 }, count: 24, floors: [1, 2], prefix: 'L', minPeriods: 1, desc: 'Nội thất căn nhà 3 phòng ngủ, đồ đạc khi chuyển nhà. Có cả ô thường và ô điều hòa, đủ 3 hình thức khoá.' },
    { key: 'XL', code: 'XL-4x6', name: 'Phòng XL (drive-up)', category: 'XL', dims: [4, 6, 3], rates: { DAY: 320_000, WEEK: 1_850_000, MONTH: 5_600_000 }, count: 18, floors: [1], prefix: 'X', minPeriods: 3, desc: 'Xe tải lùi sát cửa kho, tầng trệt. Có cả ô thường và ô điều hòa, đủ 3 hình thức khoá.' },
  ] as const;
  const FAC_PRICE: Record<string, number> = { 'f-q7': 1, 'f-td': 0.9, 'f-tb': 1.05, 'f-bt': 1 };
  const OCC_TARGET: Record<string, number> = { 'f-q7': 0.62, 'f-td': 0.55, 'f-tb': 0.6 };
  // Chia sơ đồ theo khu khoá (thẻ/mật khẩu/chìa) liên tiếp — 2 ô kề nhau luôn cùng hình thức khoá,
  // dễ demo cho khách muốn thuê 2 ô giống hệt nhau nằm cạnh nhau. Điều hòa KHÔNG còn chia khu vật lý
  // nữa — giờ là add-on khách tự bật lúc đặt (UnitType.rates + Reservation.useAirConditioning), áp
  // dụng như nhau cho MỌI ô của loại kho hợp lệ (không phải một số ô mới có).
  const LOCK_CYCLE: readonly AccessMethod[] = ['RFID_CARD', 'PIN', 'PHYSICAL_KEY'];
  const lockFor = (i: number, count: number, isLocker: boolean): AccessMethod =>
    isLocker ? 'PIN' : LOCK_CYCLE[Math.min(2, Math.floor(i / Math.ceil(count / 3)))];
  // Rải đều theo tầng thành từng khối liên tiếp (không round-robin) để mỗi tầng gọn thành một khối
  // trên sơ đồ, dễ nhìn khi có nhiều tầng.
  const floorFor = (i: number, count: number, floors: readonly number[]) =>
    floors.length <= 1 ? floors[0] : floors[Math.min(floors.length - 1, Math.floor(i / Math.ceil(count / floors.length)))];

  const unitTypes: UnitType[] = [];
  const units: StorageUnit[] = [];
  for (const f of facilities) {
    for (const t of TYPE_DEFS) {
      const [w, d, h] = t.dims;
      const ut: UnitType = {
        ...base(`ut-${f._id.slice(2)}-${t.key}`, f.createdAt), ...alive,
        facilityId: f._id, code: t.code, name: t.name, category: t.category as UnitCategory, description: t.desc,
        dimensions: { widthM: w, depthM: d, heightM: h }, areaM2: Math.round(w * d * 100) / 100,
        features: { indoor: true },
        rates: {
          DAY: Math.round((t.rates.DAY * FAC_PRICE[f._id]) / 1_000) * 1_000,
          WEEK: Math.round((t.rates.WEEK * FAC_PRICE[f._id]) / 1_000) * 1_000,
          MONTH: Math.round((t.rates.MONTH * FAC_PRICE[f._id]) / 1_000) * 1_000,
        },
        depositOverride: null, minPeriods: t.minPeriods, imageUrls: [], isActive: true, inventoryVersion: 0,
      };
      unitTypes.push(ut);
      if (f.status !== 'ACTIVE') continue;
      // Deterministic mix per type: ~target occupied, 1 in maintenance for big rows, rest free.
      const occN = Math.floor(t.count * OCC_TARGET[f._id]);
      const maintN = t.count >= 10 ? 1 : 0;
      const order = Array.from({ length: t.count }, (_, k) => k).sort(() => rand() - 0.5);
      const isLocker = t.key === 'LK';
      for (let i = 0; i < t.count; i++) {
        const accessMethod = lockFor(i, t.count, isLocker);
        const floor = floorFor(i, t.count, t.floors);
        const rank = order.indexOf(i);
        const status: UnitStatus = rank < occN ? 'OCCUPIED' : rank < occN + maintN ? 'MAINTENANCE' : 'AVAILABLE';
        units.push({
          ...base(`su-${f._id.slice(2)}-${t.prefix}${i + 1}`, f.createdAt), ...alive,
          facilityId: f._id, unitTypeId: ut._id,
          unitNumber: `${t.prefix}${floor < 0 ? 'B' : floor}-${String(i + 1).padStart(2, '0')}`,
          location: { building: 'A', floor, zone: `Khu ${ACCESS_METHOD[accessMethod]}` },
          accessMethod,
          status, statusChangedAt: addDays(T, -int(1, 60)),
          statusReason: status === 'MAINTENANCE' ? pick(['Thay bản lề cửa cuốn', 'Sơn lại sàn', 'Kiểm tra rò rỉ trần']) : null,
          currentReservationId: null, currentContractId: null, overlockActive: false, notes: '',
        });
      }
    }
  }

  // Demo customer's two leases at Quận 7 must exist regardless of the random draw.
  for (const id of ['su-q7-M2', 'su-q7-T3']) {
    const u = units.find((x) => x._id === id);
    if (!u || u.status === 'OCCUPIED') continue;
    const swap = units.find((x) => x.unitTypeId === u.unitTypeId && x.status === 'OCCUPIED' && !['su-q7-M2', 'su-q7-T3'].includes(x._id));
    if (swap) { swap.status = u.status; swap.statusReason = u.statusReason; }
    u.status = 'OCCUPIED'; u.statusReason = null;
  }

  const typeOf = (id: string) => unitTypes.find((u) => u._id === id)!;
  const userOf = (id: string) => users.find((x) => x._id === id)!;
  const reservations: Reservation[] = [];
  const contracts: RentalContract[] = [];
  const payments: PaymentTransaction[] = [];

  // Người thao tác theo chi nhánh: nhân viên quầy (thu tiền, nhận kho, giao thẻ / chìa) và quản lý chi nhánh.
  const STAFF_OF: Record<string, readonly string[]> = { 'f-q7': [DEMO_IDS.staff, 'u-staff-q7b'], 'f-td': ['u-staff-td'], 'f-tb': ['u-staff-tb'] };
  const FM_OF: Record<string, string> = { 'f-q7': DEMO_IDS.manager, 'f-td': 'u-fm-td', 'f-tb': 'u-fm-tb' };

  /**
   * Chính sách khách ký tại một ngày — như effectivePolicy() lúc đặt chỗ: bản riêng của chi nhánh nếu đã có hiệu lực, không thì bản
   * chung đang áp dụng ngày đó. Ân hạn / ngày khoá / phí trễ của hợp đồng lấy theo bản này (signedPolicy ở BE), không hard-code.
   */
  const policyAt = (fid: string, at: string): BusinessPolicy => {
    const live = policies.filter((p) => p.effectiveFrom <= at).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return live.find((p) => p.scope === 'FACILITY' && p.facilityId === fid) ?? live.find((p) => p.scope === 'GLOBAL') ?? policies.find((p) => p.scope === 'GLOBAL' && p.isActive)!;
  };

  // useAirConditioning là add-on khách tự chọn lúc đặt (không phải thuộc tính của ô) — mirror công
  // thức BE (pricing.ts: quote() + climateEligible()).
  const quoteFor = (ut: UnitType, period: RentalPeriod, periods: number, useAirConditioning = false, signedAt: string = T) => {
    const rate = ut.rates[period];
    const surchargeAmount = useAirConditioning && ut.category !== 'LOCKER' ? Math.round(rate * 0.1) : 0;
    const gross = rate + surchargeAmount;
    const picked = pickDiscount(policyBody.discounts, period, periods, gross);
    const discountAmount = picked?.amount ?? 0;
    // Kho cỡ lớn (L, XL): giữ chân 2 kỳ + tiền thuê kỳ đầu thu cùng lúc đặt chỗ — xem tier-rules.ts.
    const tier = tierTermsOf(ut.category);
    const depositAmount = gross * tier.depositPeriods;
    const firstPeriodRent = gross - discountAmount;
    const pol = policyAt(ut.facilityId, signedAt);
    return {
      currency: 'VND' as const, rentalPeriod: period, rate, depositAmount, discountAmount, surchargeAmount,
      appliedRuleCodes: [...(surchargeAmount ? ['CLIMATE'] : []), ...(picked ? [picked.tier.code] : [])],
      firstPeriodRent, totalDueAtBooking: depositAmount + (tier.firstPeriodAtBooking ? firstPeriodRent : 0),
      depositPeriods: tier.depositPeriods, firstPeriodAtBooking: tier.firstPeriodAtBooking,
      prepaidPeriods: prepaidPeriodsOf(period, periods), // thuê ngày / tuần trả trọn cả thời hạn khi nhận kho
      policyId: pol._id, policyVersion: pol.version,
    };
  };

  // ---------- thanh toán: dựng như createPayment() / counterPay() / refundMethodFor() ở BE ----------
  const GATEWAY: readonly PaymentMethod[] = ['VNPAY', 'MOMO', 'CARD'];
  const ONLINE: readonly PaymentMethod[] = ['VNPAY', 'MOMO', 'BANK_TRANSFER', 'CARD'];
  type NewPay = Partial<PaymentTransaction> & Pick<PaymentTransaction, 'facilityId' | 'customerId' | 'type' | 'amount' | 'status'>;
  const pay = (p: NewPay): PaymentTransaction => {
    const id = p._id ?? nid('pay');
    const createdAt = p.createdAt ?? p.paidAt ?? NOW;
    const method = p.method ?? pick(ONLINE);
    // Tiền mặt / nội bộ: không có cổng. Thu tại quầy: chỉ có mã giao dịch nhân viên nhập (counterRef, truyền sẵn qua atCounter).
    // Còn lại: mã giả lập của cổng thanh toán (MOCK_PAYMENTS).
    const provider = p.provider !== undefined ? p.provider : method === 'CASH' || method === 'INTERNAL' ? null
      : { name: method, txnRef: `${method}-${id.toUpperCase()}`, rawStatus: p.status === 'PENDING' ? 'MOCK' : 'MOCK_SUCCESS' };
    return {
      ...base(id, createdAt), contractId: null, reservationId: null, direction: OUTBOUND_PAYMENT_TYPES.includes(p.type) ? 'REFUND' : 'CHARGE',
      currency: 'VND', period: null, idempotencyKey: `seed-${id}`, refundOf: null, refundedAmount: 0, waiver: null, recordedBy: null,
      paidAt: null, failureReason: null, payout: null, statusHistory: [], ...p, _id: id, method, provider,
    } as PaymentTransaction;
  };
  const COUNTER_METHODS: readonly PaymentMethod[] = ['CASH', 'CASH', 'BANK_TRANSFER', 'CARD', 'VNPAY'];
  /** Khoản NHÂN VIÊN thu tại quầy (counterPay): ghi người thu cho mọi hình thức; không phải tiền mặt thì có mã giao dịch (counterRef). */
  const atCounter = (staffId: string, method: PaymentMethod = pick(COUNTER_METHODS)) => ({
    method, recordedBy: staffId, createdBy: staffId,
    provider: method === 'CASH' ? null : { name: method, txnRef: null, counterRef: `${method === 'BANK_TRANSFER' ? 'FT' : method === 'CARD' ? 'POS' : 'QR'}${int(10_000_000, 99_999_999)}` },
  });
  /** refundMethodFor: chỉ khoản khách tự trả online qua cổng mới hoàn ngược qua cổng; thu tại quầy / chuyển khoản → hoàn bằng chuyển khoản. */
  const refundMethodOf = (p: PaymentTransaction): PaymentMethod => (GATEWAY.includes(p.method) && !p.recordedBy && !p.provider?.counterRef ? p.method : 'BANK_TRANSFER');
  /**
   * Khoản HOÀN của một khoản đã thu: qua cổng → SUCCEEDED ngay; chuyển khoản → PENDING (chờ chi) cho tới khi người KHÁC người tạo xác
   * nhận đã chuyển (`paidOut` = payout đã xác nhận). Cập nhật khoản gốc (REFUNDED / PARTIALLY_REFUNDED) như luồng thật.
   */
  const refund = (orig: PaymentTransaction, amount: number, at: string, createdBy: string | null, paidOut?: NonNullable<PaymentTransaction['payout']>) => {
    const method = refundMethodOf(orig);
    const transfer = method === 'BANK_TRANSFER';
    const done = !transfer || !!paidOut;
    const r = pay({
      facilityId: orig.facilityId, customerId: orig.customerId, contractId: orig.contractId ?? null, reservationId: orig.reservationId ?? null,
      type: 'REFUND', amount, method, refundOf: orig._id, createdAt: at, createdBy, status: done ? 'SUCCEEDED' : 'PENDING',
      paidAt: done ? (paidOut?.confirmedAt ?? at) : null, payout: transfer && paidOut ? paidOut : null,
    });
    orig.refundedAmount += amount;
    orig.status = orig.refundedAmount >= orig.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    payments.push(r);
    return r;
  };

  // Chữ ký xác nhận hợp đồng (gõ họ tên) — đặt chỗ đã nhận kho luôn có; đặt chỗ chờ nhận kho có một phần,
  // riêng khách demo cố ý CHƯA ký để thử luồng ký ngay trên web/mobile.
  const signatureOf = (customerId: string, at: string, policyVersion: number): NonNullable<Reservation['signature']> => ({
    signedAt: at, signerName: users.find((x) => x._id === customerId)?.fullName ?? 'Khách hàng', method: 'TYPED', image: null,
    termsVersion: TERMS_VERSION, policyVersion, signedBy: customerId, onBehalf: false,
  });
  // Chấp thuận Điều khoản + Chính sách bảo mật lúc đặt (route bắt buộc) — phiên bản hiện hành.
  const consentAt = (at: string): NonNullable<Reservation['consent']> => ({
    termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: at, paymentScheduleAckAt: at, contractAckAt: at, ip: null, userAgent: null,
  });
  // Ảnh chữ ký bàn giao lại kho (PNG 1×1) — chỉ lưu, không gửi ra bootstrap.
  const SIG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  // ---------- hợp đồng của các ô đang thuê — dựng ĐÚNG như luồng thật ----------
  // Đặt chỗ (tiền giữ chân [+ tiền thuê kỳ đầu với kho cỡ lớn]) → nhận kho tại quầy (thu tiền thuê trả trước: 1 tháng, hoặc TRỌN thời
  // hạn với thuê ngày / tuần; đối chiếu giấy tờ; kiểm tra hàng; giao thẻ / chìa) → job billing xuất hoá đơn từng kỳ (rent-<hợp đồng>-<ngày>)
  // → quá ân hạn: DELINQUENT + phí trễ (late-<hợp đồng>-<paidThrough>) + thông báo GRACE_EXPIRED ghi ngày khoá (= delinquency.lockFrom)
  // → tới ngày khoá: LOCKED_OUT + phí khoá (lock-<hợp đồng>-<paidThrough>), phí cố định lặp lại mỗi chu kỳ (…-1, -2). Khoá chống trùng
  // y hệt job (seed.ts đổi id mock trong khoá thành ObjectId) → chạy job lần đầu KHÔNG cộng thêm phí nào.
  // Không còn "gia hạn ngầm": hợp đồng seed đều đang trong thời hạn cam kết gốc (gia hạn thật thì khách tự làm trên web / app).
  type Special = 'DELINQUENT' | 'LOCKED_OUT' | 'ABANDON' | 'MOVE_OUT_WAIT' | 'MOVE_OUT_RETURNED';
  // Các hợp đồng demo đặc biệt của từng chi nhánh (thuê theo tháng). Q7:
  //  - ABANDON: khoá ~40 ngày, đã gửi THÔNG BÁO CUỐI và đã qua hạn chót; email không tới (SKIPPED) nên seed sẵn ghi nhận "đã báo khách
  //    bằng thư bảo đảm" (manualDelivery) → quản lý bấm "Xử lý hàng bỏ lại" được ngay sau seed;
  //  - LOCKED_OUT: mới khoá 1–4 ngày, chưa gửi thông báo cuối (thử nút "Gửi thông báo cuối");
  //  - MOVE_OUT_WAIT: đã đăng ký trả kho hôm nay, ô vẫn OCCUPIED, chưa thu hồi thẻ / chìa → demo bước khách ký bàn giao (nhận lại kho);
  //  - MOVE_OUT_RETURNED: đã nhận lại kho hôm qua (ô PENDING_INSPECTION), chờ lập biên bản kiểm tra + quyết toán tiền giữ chân.
  const SPECIALS: Record<string, Special[]> = {
    'f-q7': ['ABANDON', 'MOVE_OUT_WAIT', 'DELINQUENT', 'LOCKED_OUT', 'MOVE_OUT_RETURNED', 'DELINQUENT'],
    'f-td': ['DELINQUENT', 'LOCKED_OUT', 'DELINQUENT', 'MOVE_OUT_WAIT'],
    'f-tb': ['LOCKED_OUT', 'DELINQUENT', 'DELINQUENT'],
  };
  const slot: Record<string, number> = {};
  const takeSpecial = (u: StorageUnit): Special | null => {
    const queue = SPECIALS[u.facilityId] ?? [];
    const i = (slot[u.facilityId] = (slot[u.facilityId] ?? -1) + 1);
    if (!queue.length || i % 5 !== 2) return null;
    // Trả kho: chọn ô dùng thẻ / chìa để demo đủ bước thu lại thẻ / chìa.
    if (queue[0].startsWith('MOVE_OUT') && u.accessMethod === 'PIN') return null;
    return queue.shift()!;
  };
  /** Mốc kỳ tháng cách hôm nay `d` ngày phải có số ngày ≤ 28 (cộng / trừ tháng không bị dồn về cuối tháng) — chọn d đầu tiên thoả. */
  const alignedDays = (cands: number[]) => cands.find((d) => new Date(addDays(T, -d)).getUTCDate() <= 28) ?? cands[0];
  const rotate = (lo: number, hi: number) => { const n = hi - lo + 1; const s = int(0, n - 1); return Array.from({ length: n }, (_, i) => lo + ((s + i) % n)); };
  const sumOf = (list: PaymentTransaction[]) => list.reduce((s, p) => s + p.amount, 0);

  let poolIdx = 0;
  const occupied = units.filter((u) => u.status === 'OCCUPIED');
  for (const u of occupied) {
    const ut = typeOf(u.unitTypeId);
    const isDemoM = u._id === 'su-q7-M2';
    const isDemoLocker = u._id === 'su-q7-T3';
    const customer = isDemoM || isDemoLocker ? DEMO_IDS.customer : pool[poolIdx++ % pool.length]._id;
    const special: Special | null = isDemoLocker ? 'DELINQUENT' : isDemoM ? null : takeSpecial(u);
    const debt = special === 'DELINQUENT' || special === 'LOCKED_OUT' || special === 'ABANDON';
    const locked = special === 'LOCKED_OUT' || special === 'ABANDON';

    // Khách tự chọn chu kỳ lúc đặt — demo M / demo locker / hợp đồng demo đặc biệt cố định THÁNG cho dễ theo dõi.
    // Kho cỡ lớn (L, XL) chỉ thuê theo tháng — xem tier-rules.ts.
    const period: RentalPeriod = special || isDemoM || isDemoLocker || isMonthOnly(ut.category) ? 'MONTH' : pick(['DAY', 'WEEK', 'MONTH'] as const);
    const addP = (iso: string, n: number) => addPeriods(iso, period, n);
    const staff = pick(STAFF_OF[u.facilityId]);
    const fm = FM_OF[u.facilityId];
    const useAc = ut.category !== 'LOCKER' && rand() < 0.45;
    const fid = u.facilityId;

    // Ngày nhận kho + số kỳ. Hợp đồng thường: đang trong thời hạn cam kết (hết hạn > hôm nay). Hợp đồng nợ: kỳ chưa trả đầu tiên bắt
    // đầu đúng ngày A = hôm nay − số ngày quá hạn, là mốc kỳ thứ 2 của hợp đồng (khách đã trả đúng 1 kỳ — kỳ nhận kho).
    let start: string; let term: number;
    let overdue = 0; let lockAgo = 0; let fnAgo = 0;
    const polNow = policyAt(fid, T);
    if (debt) {
      const g = polNow.gracePeriodDays, lo = polNow.lockoutAfterDays;
      if (special === 'DELINQUENT') overdue = alignedDays(rotate(g + 1, Math.min(g + 8, lo)));
      else {
        // Khoá đúng ngày khoá đã báo (A + lockoutAfterDays + 1) → quá hạn = lockoutAfterDays + 1 + số ngày đã khoá.
        lockAgo = alignedDays(special === 'ABANDON' ? rotate(38, 45).map((x) => x + lo + 1) : rotate(1, 4).map((x) => x + lo + 1)) - lo - 1;
        overdue = lo + 1 + lockAgo;
        if (special === 'ABANDON') fnAgo = int(31, 34); // hạn chót = ngày gửi thông báo cuối + 30 ngày → đã qua
      }
      term = special === 'ABANDON' ? 12 : pick([3, 6, 12]);
      start = addMonths(addDays(T, -overdue), -1);
    } else {
      term = period === 'MONTH' ? pick([3, 6, 12]) : period === 'WEEK' ? pick([2, 4, 8]) : pick([5, 10, 20]);
      const termDays = daysBetween(T, addPeriods(T, period, term));
      start = addDays(T, -(period === 'MONTH' ? int(12, termDays - 6) : int(1, termDays - 2)));
    }
    const signedAt = addDays(start, -1);
    const q = quoteFor(ut, period, term, useAc, signedAt);
    const pol = policies.find((p) => p._id === q.policyId)!;
    if (debt && pol._id !== polNow._id) throw new Error(`seed: hợp đồng nợ demo ký trước chính sách hiện hành (${u._id})`);
    const g = pol.gracePeriodDays, lo = pol.lockoutAfterDays;
    const initialEnd = addP(start, term);
    const prepaid = prepaidPeriodsOf(period, term);
    let mNext = prepaid;
    while (addP(start, mNext) <= T) mNext++;
    const nextBilling = addP(start, mNext); // kỳ job sẽ xuất tiếp theo — luôn sau hôm nay (job lần đầu không xuất bù)
    const A = debt ? addDays(T, -overdue) : null;
    if (A && addP(start, 1) !== A) throw new Error(`seed: mốc kỳ nợ lệch (${u._id})`);
    // Hợp đồng thường: hoá đơn kỳ hiện tại có thể CHƯA trả nếu còn trong ân hạn (job chưa tính phí, chưa chuyển nợ quá hạn).
    const curStart = mNext > prepaid ? addP(start, mNext - 1) : null;
    const unpaidFrom = A ?? (!special && !isDemoM && curStart && daysBetween(curStart, T) < g && rand() < 0.3 ? curStart : null);
    const paidThrough = unpaidFrom ? addDays(unpaidFrom, -1) : addDays(nextBilling, -1);

    const cid = nid('ctr');
    const rid = nid('rsv');
    const source = pick(['WEB', 'MOBILE', 'WALK_IN'] as const);
    const walkIn = source === 'WALK_IN';
    const bookedAt = addDays(start, -int(2, 10));
    const own: PaymentTransaction[] = [];
    const add = (p: PaymentTransaction) => { payments.push(p); own.push(p); return p; };

    // Lúc đặt chỗ: tiền giữ chân (+ tiền thuê kỳ đầu của kho cỡ lớn) — chỉ gắn reservationId (hợp đồng chưa có), cùng một lần trả.
    const bookPay = walkIn ? atCounter(staff) : { method: pick(ONLINE) };
    const deposit = add(pay({ facilityId: fid, customerId: customer, reservationId: rid, type: 'DEPOSIT', amount: q.depositAmount, status: 'SUCCEEDED', paidAt: bookedAt, ...bookPay, ...(walkIn && { idempotencyKey: `walkin-dep-${rid}` }) }));
    if (q.firstPeriodAtBooking) add(pay({ facilityId: fid, customerId: customer, reservationId: rid, type: 'PREPAID_RENT', amount: q.firstPeriodRent, status: 'SUCCEEDED', paidAt: bookedAt, ...bookPay, ...(walkIn && { idempotencyKey: `walkin-rent-${rid}` }) }));
    // Nhận kho tại quầy: tiền thuê còn phải thu (1 tháng với kho thường; trọn thời hạn với thuê ngày / tuần; 0 với kho cỡ lớn).
    const dueNow = rentBeforeUse(q) - (q.firstPeriodAtBooking ? q.firstPeriodRent : 0);
    if (dueNow > 0) {
      add(pay({
        facilityId: fid, customerId: customer, contractId: cid, reservationId: rid, type: 'RENT', amount: dueNow, status: 'SUCCEEDED', ...atCounter(staff),
        period: { start, end: addDays(addP(start, prepaid), -1) }, paidAt: start, createdAt: start, idempotencyKey: `checkin-rent-${rid}`,
      }));
    }
    // Hoá đơn job xuất từng kỳ sau phần trả trước: đã trả (khách tự trả online trong ân hạn) hoặc còn nợ (PENDING, chuyển khoản).
    for (let m = prepaid; m < mNext; m++) {
      const ps = addP(start, m);
      const unpaid = !!unpaidFrom && ps >= unpaidFrom;
      add(pay({
        facilityId: fid, customerId: customer, contractId: cid, type: 'RENT', amount: q.firstPeriodRent, createdAt: ps,
        period: { start: ps, end: addDays(addP(start, m + 1), -1) }, idempotencyKey: `rent-${cid}-${ps.slice(0, 10)}`,
        ...(unpaid ? { status: 'PENDING' as const, method: 'BANK_TRANSFER' as const } : { status: 'SUCCEEDED' as const, paidAt: addDays(ps, Math.min(int(0, 3), daysBetween(ps, T))) }),
      }));
    }
    // Phí trễ đúng như accrueLateFees(): phí % một lần khi quá max(afterDays, ân hạn); phí cố định lần đầu thu lúc khoá (applyLockout), rồi
    // lặp lại mỗi recurringEveryDays ngày khi vẫn bị khoá. Cơ sở tính % = billing.rate (giá kỳ đang áp dụng).
    let lockDay: string | null = null;
    if (A) {
      const pt = paidThrough.slice(0, 10);
      lockDay = locked ? addDays(T, -lockAgo) : null;
      const fee = (key: string, amount: number, at: string) => add(pay({ facilityId: fid, customerId: customer, contractId: cid, type: 'LATE_FEE', amount, status: 'PENDING', method: 'BANK_TRANSFER', createdAt: at, idempotencyKey: key }));
      const fixedRule = pol.lateFees.find((f) => f.kind === 'FIXED');
      if (lockDay && fixedRule?.value) fee(`lock-${cid}-${pt}`, fixedRule.value, lockDay);
      for (const rule of pol.lateFees) {
        if (!rule.value) continue;
        const fixed = rule.kind === 'FIXED';
        if (fixed && !locked) continue;
        const threshold = fixed ? rule.afterDays : Math.max(rule.afterDays, g);
        if (overdue <= threshold) continue;
        const every = rule.recurringEveryDays ?? 0;
        const last = every > 0 ? Math.floor((overdue - threshold - 1) / every) : 0;
        const baseKey = `${fixed ? 'lock' : 'late'}-${cid}-${pt}`;
        for (let k = fixed ? 1 : 0; k <= last; k++) {
          fee(k === 0 ? baseKey : `${baseKey}-${k}`, fixed ? rule.value : Math.round((q.firstPeriodRent * rule.value) / 100), addDays(A, threshold + 1 + k * every));
        }
      }
    }
    const pending = own.filter((p) => p.contractId === cid && p.direction === 'CHARGE' && p.status === 'PENDING');
    const outstanding = sumOf(pending);
    const dueAt = (at: string) => sumOf(pending.filter((p) => p.createdAt <= at));
    const lastPaid = own.filter((p) => p.status === 'SUCCEEDED').map((p) => p.paidAt!).sort().at(-1) ?? start;

    // Thông báo công nợ (Điều 7): hết ân hạn (kèm ngày khoá) → khoá → thông báo cuối. Email khách demo / khách seed không gửi (SKIPPED).
    const jobAt = (day: string) => [addDays(day, 0.1), NOW].sort()[0]; // job chạy lúc ~9 giờ sáng giờ VN (không quá hiện tại)
    const notices: NonNullable<RentalContract['notices']> = [];
    let lockFrom: string | null = null;
    let finalNoticeAt: string | null = null;
    if (A) {
      const noticeDay = addDays(A, g + 1); // ngày job chuyển DELINQUENT (quá ân hạn)
      lockFrom = [addDays(A, lo + 1), addDays(noticeDay, LOCKOUT_MIN_NOTICE_DAYS)].sort().at(-1)!;
      const skipped = (at: string) => ({ status: 'SKIPPED' as const, to: null, at });
      notices.push({ _id: subId(), kind: 'GRACE_EXPIRED', at: jobAt(noticeDay), amountDue: dueAt(jobAt(noticeDay)), deadline: lockFrom, note: null, by: null, email: skipped(jobAt(noticeDay)) });
      if (lockDay) notices.push({ _id: subId(), kind: 'LOCKED_OUT', at: jobAt(lockDay), amountDue: dueAt(jobAt(lockDay)), deadline: null, note: null, by: null, email: skipped(jobAt(lockDay)) });
      if (fnAgo) {
        const fnDay = addDays(T, -fnAgo);
        finalNoticeAt = addDays(fnDay, 0.3);
        notices.push({
          _id: subId(), kind: 'FINAL_NOTICE', at: finalNoticeAt, amountDue: dueAt(finalNoticeAt), deadline: addDays(fnDay, abandonDaysOf(pol)),
          note: 'Đã gọi điện 2 lần, khách không nghe máy', by: fm, email: skipped(finalNoticeAt),
          manualDelivery: { channel: 'REGISTERED_MAIL', note: 'Đã gửi thư bảo đảm số RR026318840VN tới địa chỉ khách khai trong hợp đồng, kèm nội dung thông báo cuối', at: addDays(fnDay, 1), by: fm },
        });
      }
    }

    // Nhắc hết hạn (job sendExpiryNotices — mỗi mốc một lần cho một ngày hết hạn): còn ≤ 30 ngày → EXPIRY_30, còn ≤ 7 ngày → EXPIRY_7;
    // nhận kho khi đã trong mốc 7 ngày thì job chỉ gửi mốc 7. Hợp đồng đang bị khoá không nhận nhắc.
    if (!locked) {
      for (const w of [{ kind: 'EXPIRY_30' as const, days: 30 }, { kind: 'EXPIRY_7' as const, days: 7 }]) {
        if (w.days === 30 && daysBetween(start, initialEnd) <= 7) continue;
        const day = [start, addDays(initialEnd, -w.days)].sort().at(-1)!;
        if (day > T) continue;
        notices.push({ _id: subId(), kind: w.kind, at: jobAt(day), amountDue: dueAt(jobAt(day)), deadline: initialEnd, endDate: initialEnd, note: null, by: null, email: { status: 'SKIPPED', to: null, at: jobAt(day) } });
      }
    }

    // Trả kho: đăng ký hôm qua, hẹn hôm nay (chờ nhận chìa) — hoặc đã bàn giao hôm qua, chờ biên bản (receiveUnit đã ghi các trường).
    const returnedAt = special === 'MOVE_OUT_RETURNED' ? addDays(NOW, -1) : null;
    const moveOut: RentalContract['moveOut'] = special === 'MOVE_OUT_WAIT'
      ? { requestedAt: addDays(NOW, -1), scheduledFor: T, returnedOn: null, completedAt: null, inspectionId: null, reason: null, requestedBy: customer, handover: null }
      : special === 'MOVE_OUT_RETURNED'
        ? { requestedAt: addDays(NOW, -3), scheduledFor: addDays(T, -1), returnedOn: addDays(T, -1), completedAt: null, inspectionId: null, reason: null, requestedBy: customer,
          handover: { method: 'CUSTOMER_SIGNATURE', at: returnedAt!, by: staff, signerName: userOf(customer).fullName, image: SIG_PNG, reason: null } }
        : null;
    const status: ContractStatus = locked ? 'LOCKED_OUT' : debt ? 'DELINQUENT' : moveOut ? 'MOVE_OUT_PENDING' : 'ACTIVE';

    // Nhận kho: đối chiếu giấy tờ bản gốc — khách chưa khai thì số nhân viên nhập được lưu vào hồ sơ (như checkIn).
    const cu = userOf(customer);
    cu.customerProfile ??= { idType: 'CCCD', idNumberLast4: String(int(1000, 9999)) };
    const identity = { idType: cu.customerProfile.idType ?? 'CCCD', idNumberLast4: cu.customerProfile.idNumberLast4 ?? '0000', verifiedAt: start, verifiedBy: staff, verifiedByName: userOf(staff).fullName };
    // Ô dùng thẻ / chìa: nhân viên bắt buộc ghi số thẻ / mã chìa đã giao (KEYTAG_REQUIRED). Ô mật khẩu: seed.ts sinh PIN mã hoá.
    const keyTag = u.accessMethod === 'RFID_CARD' ? `THE-${int(100_000, 999_999)}` : u.accessMethod === 'PHYSICAL_KEY' ? `K-${u.unitNumber}` : null;

    const history: Reservation['statusHistory'] = [
      { from: null, to: 'PENDING', at: bookedAt }, { from: 'PENDING', to: 'CONFIRMED', at: bookedAt }, { from: 'CONFIRMED', to: 'ALLOCATED', at: bookedAt },
      { from: 'ALLOCATED', to: 'CHECKED_IN', at: start, by: staff },
    ];
    reservations.push({
      ...base(rid, bookedAt), code: makeCode('RSV'), facilityId: fid, customerId: customer, unitTypeId: ut._id,
      unitId: u._id, status: 'CHECKED_IN', startDate: start, periods: term, endDate: initialEnd, quote: q,
      preferredCheckInShift: pick(['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'SHIFT_4', 'UNKNOWN'] as const), useAirConditioning: useAc,
      holdExpiresAt: null, depositPaymentId: deposit._id, allocation: { allocatedAt: bookedAt, allocatedBy: null },
      checkIn: { qrTokenHash: null, qrExpiresAt: null, checkedInAt: start, checkedInBy: staff }, cancellation: null,
      contractId: cid, source, bookedBy: walkIn ? staff : null, idempotencyKey: null, consent: consentAt(bookedAt),
      signature: signatureOf(customer, signedAt, q.policyVersion), statusHistory: history,
    });

    const contractHistory: RentalContract['statusHistory'] = [{ from: null, to: 'ACTIVE', at: start, by: staff }];
    if (A) contractHistory.push({ from: 'ACTIVE', to: 'DELINQUENT', at: jobAt(addDays(A, g + 1)), reason: `Quá hạn ${g + 1} ngày` });
    if (lockDay) contractHistory.push({ from: 'DELINQUENT', to: 'LOCKED_OUT', at: jobAt(lockDay), reason: `Tự động theo chính sách — quá hạn ${lo + 1} ngày` });
    if (moveOut) contractHistory.push({ from: 'ACTIVE', to: 'MOVE_OUT_PENDING', at: moveOut.requestedAt, by: customer });

    contracts.push({
      ...base(cid, start), contractNumber: makeCode('CTR'), facilityId: fid, customerId: customer, unitId: u._id, unitTypeId: ut._id,
      reservationId: rid, status, startDate: start, endDate: initialEnd, autoRenew: false, useAirConditioning: useAc,
      commitments: [{ kind: 'INITIAL', startDate: start, endDate: initialEnd, periods: term, gross: q.rate + q.surchargeAmount, discountAmount: q.discountAmount, rate: q.firstPeriodRent, policyId: q.policyId, at: start }],
      billing: { currency: 'VND', rentalPeriod: period, rate: q.firstPeriodRent, nextBillingDate: nextBilling, paidThrough },
      deposit: { amount: q.depositAmount, status: 'HELD', paymentId: deposit._id, refundedAmount: 0 },
      balance: { outstanding, lastPaymentAt: lastPaid },
      delinquency: A ? { since: A, daysOverdue: overdue, lateFeesAccrued: sumOf(pending.filter((p) => p.type === 'LATE_FEE')), lockedOutAt: lockDay ? jobAt(lockDay) : null, finalNoticeAt, lockFrom } : null,
      notices,
      access: {
        method: u.accessMethod, keyTag, credentialHash: null, issuedAt: start, issuedBy: staff,
        suspendedAt: lockDay ? jobAt(lockDay) : null, revokedAt: returnedAt, lostReportedAt: null,
      },
      terms: { policyId: pol._id, policyVersion: pol.version, gracePeriodDays: g, lockoutAfterDays: lo, signedAt, signatureRef: `esign-${rid}`, signerName: cu.fullName },
      identity,
      intakeCheck: { checkedAt: start, checkedBy: staff, items: INTAKE_CHECK_ITEMS.map((i) => i.key), note: null, photoUrls: [] },
      renewals: [],
      moveOut,
      closedAt: null,
      statusHistory: contractHistory,
    });
    u.currentContractId = cid;
    if (returnedAt) { u.status = 'PENDING_INSPECTION'; u.statusChangedAt = returnedAt; u.statusReason = 'Khách bàn giao chìa khóa'; }
    if (lockDay) u.overlockActive = true;
  }

  // ---------- upcoming / pending / cancelled reservations ----------
  const availableOf = (fid: string, key: string) => units.filter((u) => u.facilityId === fid && u.unitTypeId === `ut-${fid.slice(2)}-${key}` && u.status === 'AVAILABLE');
  type BookOpts = {
    /** Đã ký hợp đồng (mặc định: ngẫu nhiên ~65%, khách demo luôn chưa ký). */
    signed?: boolean;
    /** Quản lý đã GỠ ô (unallocate) → CONFIRMED chưa có ô, chờ phân kho tay. Chỉ gỡ được khi khách chưa ký. */
    unallocated?: boolean;
    /** Đặt / trả tiền giữ chân tại quầy (nhân viên thu). */
    walkIn?: boolean;
    method?: PaymentMethod;
    cancel?: { reason: 'HOLD_EXPIRED' | 'CUSTOMER_REQUEST'; note?: string; at: string; payout?: boolean };
  };
  /**
   * Như bookOne() → payDeposit(): ô cụ thể giữ ngay lúc đặt (PENDING, ô RESERVED), trả tiền giữ chân xong là ALLOCATED (đã có ô) — không
   * còn ô thì CONFIRMED không ô. CONFIRMED luôn KHÔNG có ô. Huỷ: nhả ô; hết giờ giữ chỗ thì khoản chờ trả bị huỷ; khách tự huỷ thì hoàn
   * theo bậc giờ còn lại (cancellationRefundOf) trên mọi khoản đã trả lúc đặt, theo hình thức gốc (refundMethodFor).
   */
  const book = (fid: string, key: string, customerId: string, want: 'PENDING' | 'ALLOCATED' | 'CANCELLED', startOffset: number, periods: number, o: BookOpts = {}) => {
    const ut = typeOf(`ut-${fid.slice(2)}-${key}`);
    const id = nid('rsv');
    const start = addDays(T, startOffset);
    const period: RentalPeriod = isMonthOnly(ut.category) ? 'MONTH' : pick(['DAY', 'WEEK', 'MONTH'] as const);
    const createdAt = want === 'PENDING' ? NOW : addDays(T, -int(1, 9));
    const paidOrCancelledPaid = want === 'ALLOCATED' || o.cancel?.reason === 'CUSTOMER_REQUEST';
    let status: ReservationStatus = want;
    let unitId: string | null = null;
    if (want !== 'CANCELLED') {
      const u = o.unallocated ? undefined : availableOf(fid, key)[0];
      if (u) { u.status = 'RESERVED'; u.currentReservationId = id; u.statusReason = 'Giữ chỗ — đặt kho'; unitId = u._id; }
      else if (want === 'ALLOCATED') status = 'CONFIRMED';
    }
    // Add-on điều hòa khách tự chọn lúc đặt — không gắn với ô nào, chỉ loại LOCKER luôn false.
    const useAc = ut.category !== 'LOCKER' && rand() < 0.45;
    const q = quoteFor(ut, period, periods, useAc);
    const staff = pick(STAFF_OF[fid]);
    const payBy = o.walkIn ? atCounter(staff, o.method) : { method: o.method ?? (want === 'ALLOCATED' ? pick(ONLINE) : 'VNPAY' as const) };
    const paid = paidOrCancelledPaid ? 'SUCCEEDED' as const : want === 'PENDING' ? 'PENDING' as const : 'CANCELLED' as const;
    const booked: PaymentTransaction[] = [];
    const deposit = pay({ facilityId: fid, customerId, reservationId: id, type: 'DEPOSIT', amount: q.depositAmount, status: paid, createdAt, paidAt: paid === 'SUCCEEDED' ? createdAt : null, ...payBy, ...(o.walkIn && { idempotencyKey: `walkin-dep-${id}` }) });
    booked.push(deposit);
    // Kho cỡ lớn: tiền thuê kỳ đầu trả CÙNG LẦN với tiền giữ chân (check-in sẽ không thu lại).
    if (q.firstPeriodAtBooking) booked.push(pay({ facilityId: fid, customerId, reservationId: id, type: 'PREPAID_RENT', amount: q.firstPeriodRent, status: paid, createdAt, paidAt: paid === 'SUCCEEDED' ? createdAt : null, ...payBy, ...(o.walkIn && { idempotencyKey: `walkin-rent-${id}` }) }));
    payments.push(...booked);

    const ready = status === 'ALLOCATED' || status === 'CONFIRMED';
    const signed = ready && !o.unallocated && (o.signed ?? (customerId !== DEMO_IDS.customer && rand() < 0.65));
    const history: Reservation['statusHistory'] = [{ from: null, to: 'PENDING', at: createdAt }];
    if (paidOrCancelledPaid) history.push({ from: 'PENDING', to: 'CONFIRMED', at: createdAt }, ...(unitId || o.unallocated || o.cancel ? [{ from: 'CONFIRMED' as const, to: 'ALLOCATED' as const, at: createdAt }] : []));
    if (o.unallocated) history.push({ from: 'ALLOCATED', to: 'CONFIRMED', at: addDays(NOW, -0.5), by: FM_OF[fid], reason: 'Gỡ phân kho' });

    let cancellation: Reservation['cancellation'] = null;
    if (o.cancel) {
      const c = o.cancel;
      history.push({ from: paidOrCancelledPaid ? 'ALLOCATED' : 'PENDING', to: 'CANCELLED', at: c.at, by: c.reason === 'CUSTOMER_REQUEST' ? customerId : null, reason: c.note ?? c.reason });
      let refundAmount = 0;
      if (c.reason === 'CUSTOMER_REQUEST') {
        const { pct } = cancellationRefundOf({ status: 'ALLOCATED', depositPaymentId: deposit._id, startDate: start, quote: q }, policyAt(fid, createdAt).cancellation, c.at);
        for (const p of booked) {
          const amount = Math.round((p.amount * pct) / 100);
          if (amount <= 0) continue;
          refundAmount += amount;
          refund(p, amount, c.at, customerId, c.payout ? { reference: `FT26${int(10_000_000, 99_999_999)}`, toAccount: 'Vietcombank · 0071001234567 · ' + userOf(customerId).fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'D').toUpperCase(), confirmedBy: DEMO_IDS.ops, confirmedAt: addDays(c.at, 0.4) } : undefined);
        }
      }
      cancellation = { reason: c.reason, note: c.note, cancelledAt: c.at, cancelledBy: c.reason === 'CUSTOMER_REQUEST' ? customerId : null, refundAmount };
    }

    reservations.push({
      ...base(id, createdAt), code: makeCode('RSV'), facilityId: fid, customerId, unitTypeId: ut._id, unitId, status,
      startDate: start, periods, endDate: addPeriods(start, period, periods), quote: q,
      preferredCheckInShift: pick(['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'SHIFT_4', 'UNKNOWN'] as const), useAirConditioning: useAc,
      holdExpiresAt: status === 'PENDING' ? new Date(Date.now() + 22 * 60_000).toISOString() : null,
      allocation: unitId ? { allocatedAt: createdAt, allocatedBy: null } : null,
      depositPaymentId: deposit._id,
      checkIn: ready ? { qrTokenHash: 'sha256:demo', qrExpiresAt: addDays(start, 2), checkedInAt: null, checkedInBy: null } : null,
      cancellation, contractId: null, source: o.walkIn ? 'WALK_IN' : pick(['WEB', 'MOBILE'] as const), bookedBy: o.walkIn ? staff : null,
      idempotencyKey: null, consent: consentAt(createdAt),
      signature: signed ? signatureOf(customerId, createdAt, q.policyVersion) : null,
      statusHistory: history,
    });
  };
  const cust = (i: number) => pool[(i * 7) % pool.length]._id;

  book('f-q7', 'S', DEMO_IDS.customer, 'ALLOCATED', 0, 6); // khách demo: ký hợp đồng rồi nhận kho ngay hôm nay
  book('f-td', 'L', DEMO_IDS.customer, 'ALLOCATED', 6, 12);
  book('f-q7', 'M', cust(1), 'ALLOCATED', 0, 3, { signed: true });
  book('f-q7', 'LK', cust(2), 'ALLOCATED', 0, 1, { signed: true });
  book('f-q7', 'S', cust(4), 'ALLOCATED', 1, 3, { unallocated: true }); // CONFIRMED chưa có ô — demo quản lý phân kho tay
  book('f-q7', 'L', cust(5), 'ALLOCATED', 2, 12);
  book('f-q7', 'M', cust(6), 'ALLOCATED', 5, 6);
  book('f-q7', 'LK', cust(8), 'PENDING', 3, 1);
  book('f-q7', 'M', cust(17), 'ALLOCATED', -2, 3); // khách không đến (đã có ô) — job no-show huỷ NO_SHOW, không hoàn
  book('f-q7', 'S', cust(9), 'CANCELLED', 2, 3, { method: 'VNPAY', cancel: { reason: 'HOLD_EXPIRED', at: addDays(NOW, -1) } });
  // Khách tự huỷ sớm (≥ 72 giờ trước ngày nhận) → hoàn 100% qua đúng cổng đã trả.
  book('f-q7', 'M', cust(10), 'CANCELLED', 4, 6, { method: 'VNPAY', cancel: { reason: 'CUSTOMER_REQUEST', note: 'Đổi kế hoạch chuyển nhà', at: addDays(NOW, -2) } });
  // Khách đặt tại quầy (tiền mặt) rồi huỷ còn 36 giờ → hoàn 50% bằng chuyển khoản, Quản lý vận hành đã xác nhận chi (payout).
  book('f-tb', 'S', cust(13), 'CANCELLED', 1, 3, { walkIn: true, method: 'CASH', cancel: { reason: 'CUSTOMER_REQUEST', note: 'Nhà có việc gấp, không chuyển đồ nữa', at: new Date(localMidnightMs(addDays(T, 1)) - 36 * 3_600_000).toISOString(), payout: true } });
  book('f-td', 'M', cust(11), 'ALLOCATED', 0, 6, { signed: true });
  book('f-td', 'S', cust(12), 'ALLOCATED', 1, 3);
  book('f-tb', 'LK', cust(14), 'ALLOCATED', 1, 2);
  book('f-tb', 'M', cust(15), 'ALLOCATED', 0, 6, { signed: true });
  book('f-tb', 'XL', cust(16), 'PENDING', 7, 6);

  // ---------- tickets ----------
  const ticket = (fid: string, t: Partial<SupportTicket> & Pick<SupportTicket, 'subject' | 'kind' | 'category' | 'priority' | 'status' | 'reporterId'>): SupportTicket => {
    const createdAt = addDays(T, -int(0, 6));
    return {
      ...base(nid('tkt'), createdAt), ...alive, ticketNumber: makeCode('TKT'), facilityId: fid, contractId: null, unitId: null,
      description: t.subject, attachmentUrls: [], assigneeId: null, dueAt: null, resolvedAt: null, messages: [], statusHistory: [], ...t,
    };
  };
  const demoM = contracts.find((c) => c.unitId === 'su-q7-M2');

  // ---------- yêu cầu đổi ô (A1b) ----------
  const swapTarget = (c: RentalContract | undefined) => units.find((u) => u.unitTypeId === c?.unitTypeId && u.status === 'AVAILABLE');
  const otherActive = contracts.find((c) => c.facilityId === 'f-q7' && c.status === 'ACTIVE' && c._id !== demoM?._id);
  const swapRequests: UnitSwapRequest[] = [];
  if (demoM) {
    const toUnit = swapTarget(demoM);
    if (toUnit) {
      swapRequests.push({
        ...base(nid('swp'), addDays(NOW, -1)), requestNumber: makeCode('SWP'), facilityId: demoM.facilityId, customerId: demoM.customerId,
        contractId: demoM._id, unitTypeId: demoM.unitTypeId, fromUnitId: demoM.unitId, toUnitId: toUnit._id, method: 'SELF',
        reason: 'Muốn đổi sang ô gần cửa ra vào hơn cho dễ chở đồ.', status: 'SUBMITTED',
        fee: 0, facilityFault: null, scheduledFor: null, moveDeadline: null, decidedBy: null, decidedAt: null,
        rejectReason: null, completedAt: null, paymentId: null,
        statusHistory: [{ from: null, to: 'SUBMITTED', at: addDays(NOW, -1) }],
      });
      toUnit.status = 'RESERVED'; toUnit.currentSwapRequestId = swapRequests[swapRequests.length - 1]._id;
    }
  }
  if (otherActive) {
    const toUnit = swapTarget(otherActive);
    if (toUnit) {
      const decidedAt = addDays(NOW, -2);
      swapRequests.push({
        ...base(nid('swp'), addDays(NOW, -3)), requestNumber: makeCode('SWP'), facilityId: otherActive.facilityId, customerId: otherActive.customerId,
        contractId: otherActive._id, unitTypeId: otherActive.unitTypeId, fromUnitId: otherActive.unitId, toUnitId: toUnit._id, method: 'SELF',
        reason: 'Kho bị thấm nước sau mưa lớn, xin chuyển sang ô khô ráo.', status: 'APPROVED',
        fee: 0, facilityFault: true, scheduledFor: null, moveDeadline: addDays(NOW, 5), decidedBy: DEMO_IDS.manager, decidedAt,
        rejectReason: null, completedAt: null, paymentId: null,
        statusHistory: [{ from: null, to: 'SUBMITTED', at: addDays(NOW, -3) }, { from: 'SUBMITTED', to: 'APPROVED', at: decidedAt, by: DEMO_IDS.manager }],
      });
      toUnit.status = 'RESERVED'; toUnit.currentSwapRequestId = swapRequests[swapRequests.length - 1]._id;
    }
  }

  // Phiếu của khách demo nói ĐÚNG hình thức khoá của ô kho M đang thuê (ô thẻ từ → đầu đọc thẻ, ô chìa → ổ khoá, ô mật khẩu → ổ số).
  const demoLock = demoM?.access.method ?? 'RFID_CARD';
  const demoIssue = demoLock === 'RFID_CARD'
    ? { subject: 'Thẻ từ kho M quẹt không mở được cửa', said: 'Tối qua 20h tôi đến lấy đồ, quẹt thẻ thì đầu đọc báo đèn đỏ, cửa không mở.', reply: 'Em đã nhận, sáng nay sẽ kiểm tra đầu đọc thẻ của ô và báo lại anh/chị.' }
    : demoLock === 'PHYSICAL_KEY'
      ? { subject: 'Ổ khóa kho M bị kẹt, không mở được', said: 'Tối qua 20h tôi đến lấy đồ nhưng chìa không xoay được.', reply: 'Em đã nhận, sáng nay sẽ thay ổ khóa và báo lại anh/chị.' }
      : { subject: 'Ổ khoá số kho M bị kẹt', said: 'Tối qua 20h tôi nhập đúng mật khẩu nhưng ổ khoá số không bật ra.', reply: 'Em đã nhận, sáng nay sẽ kiểm tra ổ khoá số và báo lại anh/chị.' };
  const tickets: SupportTicket[] = [
    ticket('f-q7', { kind: 'CUSTOMER_ISSUE', reporterId: DEMO_IDS.customer, contractId: demoM?._id ?? null, unitId: 'su-q7-M2', subject: demoIssue.subject, description: `${demoIssue.said} Nhờ kiểm tra giúp.`, category: 'ACCESS', priority: 'HIGH', status: 'IN_PROGRESS', assigneeId: DEMO_IDS.staff, dueAt: addDays(T, 0),
      messages: [{ authorId: DEMO_IDS.customer, body: demoIssue.said, internal: false, at: addDays(NOW, -1) }, { authorId: DEMO_IDS.staff, body: demoIssue.reply, internal: false, at: addDays(NOW, -0.5) }] }),
    ticket('f-q7', { kind: 'CUSTOMER_ISSUE', reporterId: cust(3), subject: 'Thấy gián gần dãy S tầng 2', category: 'PEST', priority: 'MEDIUM', status: 'OPEN', dueAt: addDays(T, 2) }),
    ticket('f-q7', { kind: 'OPS_TASK', reporterId: DEMO_IDS.manager, subject: 'Kiểm tra định kỳ bình chữa cháy tầng 2', category: 'MAINTENANCE', priority: 'MEDIUM', status: 'ASSIGNED', assigneeId: 'u-staff-q7b', dueAt: addDays(T, 2) }),
    ticket('f-q7', { kind: 'OPS_TASK', reporterId: DEMO_IDS.manager, subject: 'Gắn khóa chặn (overlock) các kho quá hạn', category: 'SECURITY', priority: 'HIGH', status: 'OPEN', dueAt: addDays(T, 1) }),
    ticket('f-q7', { kind: 'CUSTOMER_ISSUE', reporterId: cust(5), subject: 'Xin xuất hóa đơn VAT tháng trước', category: 'BILLING', priority: 'LOW', status: 'RESOLVED', assigneeId: DEMO_IDS.manager, resolvedAt: addDays(T, -1) }),
    ticket('f-td', { kind: 'CUSTOMER_ISSUE', reporterId: cust(11), subject: 'Đèn hành lang dãy M chập chờn', category: 'MAINTENANCE', priority: 'MEDIUM', status: 'OPEN' }),
    ticket('f-td', { kind: 'OPS_TASK', reporterId: 'u-fm-td', subject: 'Vệ sinh kho sau khi khách trả', category: 'CLEANING', priority: 'LOW', status: 'ASSIGNED', assigneeId: 'u-staff-td', dueAt: addDays(T, 1) }),
    ticket('f-tb', { kind: 'CUSTOMER_ISSUE', reporterId: cust(15), subject: 'Cửa cuốn khu hầm xe không khoá được', category: 'SECURITY', priority: 'URGENT', status: 'OPEN', dueAt: addDays(T, 0) }),
  ];

  // ---------- inspections ----------
  const inspections: InspectionLog[] = [
    { ...base(nid('ins'), addDays(T, -9)), facilityId: 'f-q7', unitId: 'su-q7-S3', contractId: null, type: 'ROUTINE', status: 'APPROVED', inspectorId: DEMO_IDS.staff, performedAt: addDays(T, -9),
      checklist: [{ item: 'Cửa cuốn', condition: 'OK' }, { item: 'Sàn', condition: 'OK' }, { item: 'Trần / chống thấm', condition: 'OK' }], damages: [], photoUrls: [], outcome: 'PASS', totalDamageFee: 0, depositSettlement: null },
    { ...base(nid('ins'), addDays(T, -20)), facilityId: 'f-q7', unitId: 'su-q7-M5', contractId: null, type: 'MAINTENANCE', status: 'APPROVED', inspectorId: 'u-staff-q7b', performedAt: addDays(T, -20),
      checklist: [{ item: 'Cửa cuốn', condition: 'DAMAGED', note: 'Lò xo yếu' }, { item: 'Sàn', condition: 'OK' }], damages: [{ description: 'Thay lò xo cửa cuốn', severity: 'MINOR', cost: 350_000, photoUrls: [] }], photoUrls: [], outcome: 'MAINTENANCE_REQUIRED', totalDamageFee: 350_000, depositSettlement: null },
  ];

  // ---------- damage claims (A2) ----------
  const claim = (c: RentalContract | undefined, p: Partial<DamageClaim> & Pick<DamageClaim, 'type' | 'status' | 'description' | 'items'>): DamageClaim | null => {
    if (!c) return null;
    const id = nid('clm');
    const createdAt = p.createdAt ?? addDays(NOW, -3);
    return {
      ...base(id, createdAt), claimNumber: makeCode('CLM'), facilityId: c.facilityId, customerId: c.customerId,
      contractId: c._id, unitId: c.unitId, ticketId: null, incidentAt: addDays(createdAt, -1),
      claimedAmount: p.items.reduce((s, it) => s + it.quantity * it.unitValue, 0),
      photoUrls: [], review: null, settlement: null,
      statusHistory: [{ from: null, to: 'SUBMITTED', at: createdAt, by: c.customerId }],
      ...p,
    };
  };
  // Hồ sơ bồi thường gắn hợp đồng đang thuê bình thường (không phải hợp đồng nợ / đang trả kho).
  const q7Contracts = contracts.filter((c) => c.facilityId === 'f-q7' && c.status === 'ACTIVE');
  const claims: DamageClaim[] = [
    claim(demoM, {
      type: 'DAMAGE', status: 'SUBMITTED',
      description: 'Trần kho bị thấm sau trận mưa lớn, hai thùng carton đựng sách bị ướt và mốc.',
      items: [{ name: 'Sách chuyên ngành', quantity: 2, unitValue: 1_200_000, note: 'Thùng carton 50×40×50' }],
    }),
    claim(q7Contracts[1], {
      type: 'LOSS', status: 'UNDER_REVIEW', createdAt: addDays(NOW, -6),
      description: 'Sau khi mở kho phát hiện mất một máy khoan cầm tay để trong thùng dụng cụ.',
      items: [{ name: 'Máy khoan cầm tay Bosch', quantity: 1, unitValue: 3_500_000 }],
      statusHistory: [
        { from: null, to: 'SUBMITTED', at: addDays(NOW, -6), by: null },
        { from: 'SUBMITTED', to: 'UNDER_REVIEW', at: addDays(NOW, -5), by: DEMO_IDS.staff, reason: 'Đang đối chiếu nhật ký ra vào' },
      ],
    }),
    claim(q7Contracts[2], {
      type: 'DAMAGE', status: 'PAID', createdAt: addDays(NOW, -25),
      description: 'Xe nâng của kho va vào cửa cuốn làm móp thùng đồ gỗ của khách.',
      items: [{ name: 'Tủ gỗ 3 cánh', quantity: 1, unitValue: 4_000_000 }],
      review: { reviewedBy: DEMO_IDS.manager, reviewedAt: addDays(NOW, -22), approvedAmount: 3_200_000, liabilityCap: Math.max(3_200_000, claimCapOf(q7Contracts[2], unitTypes) ?? 0), decisionNote: 'Lỗi thuộc về kho, đã đối chiếu nhật ký ra vào. Duyệt 80% giá trị khai báo theo mức khấu hao.' },
      settlement: { paymentId: 'pay-claim-demo', paidAt: addDays(NOW, -20), method: 'BANK_TRANSFER' },
      statusHistory: [
        { from: null, to: 'SUBMITTED', at: addDays(NOW, -25), by: null },
        { from: 'SUBMITTED', to: 'UNDER_REVIEW', at: addDays(NOW, -24), by: DEMO_IDS.staff },
        { from: 'UNDER_REVIEW', to: 'APPROVED', at: addDays(NOW, -22), by: DEMO_IDS.manager },
        { from: 'APPROVED', to: 'PAID', at: addDays(NOW, -20), by: DEMO_IDS.ops, reason: 'Đã chuyển khoản — mã FT26DEMO0001' },
      ],
    }),
  ].filter((c): c is DamageClaim => c !== null);

  // Khoản chi bồi thường phải có mặt trong sổ thanh toán, nếu không báo cáo doanh thu sẽ lệch.
  const paidClaim = claims.find((c) => c.status === 'PAID');
  if (paidClaim?.settlement) {
    payments.push(pay({
      _id: paidClaim.settlement.paymentId, facilityId: paidClaim.facilityId, customerId: paidClaim.customerId,
      contractId: paidClaim.contractId, type: 'COMPENSATION', direction: 'REFUND', amount: paidClaim.review!.approvedAmount,
      status: 'SUCCEEDED', method: 'BANK_TRANSFER', paidAt: paidClaim.settlement.paidAt,
      payout: { reference: 'FT26DEMO0001', toAccount: 'Vietcombank · 0071000000001 · KHACH DEMO', confirmedBy: DEMO_IDS.ops, confirmedAt: paidClaim.settlement.paidAt },
    } as Partial<PaymentTransaction> & Pick<PaymentTransaction, 'facilityId' | 'customerId' | 'type' | 'amount' | 'status'>));
  }

  // ---------- audit ----------
  const log = (hoursAgo: number, a: Partial<AuditLog> & Pick<AuditLog, 'action' | 'result'>): AuditLog => ({
    _id: nid('aud'), at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), actorId: null, actorRole: 'SYSTEM', entityType: null, entityId: null,
    facilityId: null, changes: null, reason: null, requestId: `req_${int(100000, 999999)}`, ip: `113.161.${int(1, 254)}.${int(1, 254)}`, userAgent: 'Mozilla/5.0', ...a,
  });
  const audit: AuditLog[] = [
    log(0.2, { action: 'auth.login', result: 'SUCCESS', actorId: DEMO_IDS.manager, actorRole: 'FACILITY_MANAGER' }),
    log(0.6, { action: 'access.facility_scope', result: 'DENIED', actorId: DEMO_IDS.staff, actorRole: 'STAFF', facilityId: 'f-td', reason: 'STAFF@f-q7 truy cập danh sách kho f-td' }),
    log(1.5, { action: 'reservation.allocate', result: 'SUCCESS', actorId: DEMO_IDS.manager, actorRole: 'FACILITY_MANAGER', facilityId: 'f-q7', entityType: 'Reservation', changes: { before: { status: 'CONFIRMED' }, after: { status: 'ALLOCATED' } } }),
    log(3, { action: 'contract.lockout', result: 'SUCCESS', actorRole: 'SYSTEM', facilityId: 'f-q7', entityType: 'RentalContract', reason: 'Quá hạn 15 ngày theo chính sách v3' }),
    log(5, { action: 'auth.login', result: 'DENIED', actorRole: 'ANONYMOUS', reason: 'Sai mật khẩu 5 lần — tạm khóa 15 phút' }),
    log(9, { action: 'payment.waiver', result: 'SUCCESS', actorId: 'u-fm-td', actorRole: 'FACILITY_MANAGER', facilityId: 'f-td', entityType: 'PaymentTransaction', reason: 'Miễn phí trễ hạn do lỗi cổng thanh toán', changes: { after: { amount: 89_500 } } }),
    log(20, { action: 'policy.publish', result: 'SUCCESS', actorId: DEMO_IDS.ops, actorRole: 'OPS_MANAGER', entityType: 'BusinessPolicy', entityId: 'pol-td-1', changes: { after: { gracePeriodDays: 7 } } }),
    // Chuyển quản lý giữa hai chi nhánh — minh hoạ đúng luật 1 quản lý / 1 kho, không phải gán thêm kho.
    log(26, { action: 'user.role_change', result: 'SUCCESS', actorId: DEMO_IDS.admin, actorRole: 'ADMIN', entityType: 'User', entityId: 'u-fm-tb', changes: { before: { facilityIds: ['f-td'] }, after: { facilityIds: ['f-tb'] } } }),
    log(30, { action: 'contract.override', result: 'DENIED', actorId: DEMO_IDS.staff, actorRole: 'STAFF', facilityId: 'f-q7', reason: 'STAFF không có quyền sửa giá hợp đồng' }),
    log(48, { action: 'facility.update', result: 'SUCCESS', actorId: DEMO_IDS.ops, actorRole: 'OPS_MANAGER', entityType: 'Facility', entityId: 'f-bt', changes: { after: { status: 'UNDER_CONSTRUCTION' } } }),
  ];

  // ---------- dịch vụ thêm sau khi thuê — danh mục và GIÁ riêng từng chi nhánh ----------
  const SERVICE_DEFS: { code: string; name: string; desc: string; unitLabel: string; price: number; only: readonly string[] | null }[] = [
    { code: 'PACK-BOX', name: 'Thùng carton đóng gói', desc: 'Thùng carton 5 lớp kèm băng keo, giao tận ô kho.', unitLabel: 'thùng', price: 15_000, only: null },
    { code: 'PACK-SVC', name: 'Nhân viên đóng gói đồ đạc', desc: 'Đóng gói, chèn lót chống va đập trước khi cất vào kho.', unitLabel: 'giờ', price: 180_000, only: null },
    { code: 'MOVE-CITY', name: 'Vận chuyển nội thành', desc: 'Xe tải nhỏ + 2 nhân viên bốc xếp, bán kính 10 km quanh chi nhánh.', unitLabel: 'chuyến', price: 650_000, only: null },
    { code: 'CLEAN', name: 'Vệ sinh ô kho', desc: 'Quét dọn, lau sàn và xử lý côn trùng trong ô kho.', unitLabel: 'lần', price: 150_000, only: null },
    { code: 'HUMID', name: 'Giám sát độ ẩm / nhiệt độ', desc: 'Gắn cảm biến theo dõi, báo ngay khi vượt ngưỡng an toàn cho hàng nhạy cảm.', unitLabel: 'tháng', price: 120_000, only: ['f-q7', 'f-tb'] },
    { code: 'SHELF', name: 'Cho thuê kệ sắt 4 tầng', desc: 'Kệ sắt di động, tải trọng 200 kg mỗi tầng.', unitLabel: 'tháng', price: 90_000, only: ['f-q7', 'f-td'] },
  ];
  const SVC_FAC_PRICE: Record<string, number> = { 'f-q7': 1, 'f-td': 0.9, 'f-tb': 1.1 };
  const services: ServiceOffering[] = [];
  for (const f of facilities) {
    if (f.status !== 'ACTIVE') continue; // chi nhánh đang xây chưa có danh mục — để demo Ops thiết lập
    for (const d of SERVICE_DEFS) {
      if (d.only && !d.only.includes(f._id)) continue;
      services.push({
        ...base(`svc-${f._id.slice(2)}-${d.code.toLowerCase()}`, f.createdAt), ...alive, facilityId: f._id, code: d.code, name: d.name,
        description: d.desc, price: Math.round((d.price * SVC_FAC_PRICE[f._id]) / 1_000) * 1_000, unitLabel: d.unitLabel, isActive: true,
      });
    }
  }

  const serviceOrders: ServiceOrder[] = [];
  const makeOrder = (c: RentalContract, code: string, quantity: number, status: ServiceOrder['status'], daysAgo: number, note?: string, method?: PaymentMethod) => {
    const svc = services.find((x) => x.facilityId === c.facilityId && x.code === code);
    if (!svc) return;
    const createdAt = addDays(NOW, -daysAgo);
    const total = svc.price * quantity;
    // Khách trả online khi đặt dịch vụ; huỷ thì hoàn đủ theo hình thức gốc (refundMethodFor).
    const paid = pay({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SERVICE', amount: total, status: 'SUCCEEDED', paidAt: createdAt, ...(method && { method }) });
    payments.push(paid);
    const doneAt = addDays(createdAt, 1);
    const refundPaymentId = status === 'CANCELLED' ? refund(paid, total, doneAt, c.customerId)._id : null;
    serviceOrders.push({
      ...base(nid('svo'), createdAt), orderNumber: makeCode('SVC'), facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, serviceId: svc._id,
      serviceName: svc.name, unitPrice: svc.price, unitLabel: svc.unitLabel, quantity, total, preferredDate: addDays(createdAt, 2), note,
      status, paymentId: paid._id, refundPaymentId,
      completedAt: status === 'DONE' ? doneAt : null, completedBy: status === 'DONE' ? STAFF_OF[c.facilityId][0] : null,
      cancelReason: status === 'CANCELLED' ? 'Khách đổi lịch' : null,
      statusHistory: [{ from: null, to: 'REQUESTED', at: createdAt }, ...(status !== 'REQUESTED' ? [{ from: 'REQUESTED' as const, to: status, at: doneAt }] : [])],
    });
  };
  if (demoM && demoM.status === 'ACTIVE') {
    makeOrder(demoM, 'CLEAN', 1, 'DONE', 9);
    makeOrder(demoM, 'PACK-BOX', 10, 'REQUESTED', 1, 'Giao thùng vào sáng thứ Bảy');
    makeOrder(demoM, 'MOVE-CITY', 1, 'CANCELLED', 4, 'Chuyển đồ sang kho mới', 'MOMO'); // trả qua cổng → hoàn ngược qua cổng, không treo khoản chờ chi của khách demo
  }
  const ORDER_CODES = ['PACK-SVC', 'CLEAN', 'HUMID', 'PACK-BOX', 'SHELF', 'MOVE-CITY'];
  contracts.filter((c) => c.status === 'ACTIVE' && c._id !== demoM?._id).slice(0, 8)
    .forEach((c, i) => makeOrder(c, ORDER_CODES[i % ORDER_CODES.length], 1 + (i % 3), i % 3 === 0 ? 'DONE' : 'REQUESTED', i % 3 === 0 ? 6 : 1));

  // ---------- yêu cầu cấp lại mật khẩu / thẻ / chìa (khách gửi, Quản lý chi nhánh duyệt) ----------
  const accessRequests: AccessRequest[] = [];
  const makeAccessRequest = (c: RentalContract, status: AccessRequest['status'], daysAgo: number, reason: string, decisionNote?: string, method?: PaymentMethod) => {
    const type = c.access.method === 'PIN' ? 'PIN_RESET' as const : c.access.method === 'RFID_CARD' ? 'CARD_REISSUE' as const : 'KEY_REISSUE' as const;
    const fee = type === 'CARD_REISSUE' ? 50_000 : 0;
    const createdAt = addDays(NOW, -daysAgo);
    const decidedAt = addDays(createdAt, 1);
    const refunded = status === 'REJECTED' || status === 'CANCELLED';
    let paymentId: string | null = null;
    let refundPaymentId: string | null = null;
    const fm = FM_OF[c.facilityId];
    if (fee > 0) {
      const paid = pay({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'ACCESS_FEE', amount: fee, status: 'SUCCEEDED', paidAt: createdAt, ...(method && { method }) });
      payments.push(paid); paymentId = paid._id;
      // Từ chối / huỷ → hoàn đủ phí theo hình thức gốc (người lập khoản hoàn: quản lý từ chối).
      if (refunded) refundPaymentId = refund(paid, fee, decidedAt, status === 'REJECTED' ? fm : c.customerId)._id;
    }
    // Báo mất thẻ / chìa: đánh dấu NGAY lúc khách gửi yêu cầu (createAccessRequest); chỉ gỡ khi đã giao thẻ / chìa mới hoặc KHÁCH tự huỷ —
    // chi nhánh từ chối thì thẻ đã báo mất vẫn bị vô hiệu.
    if (type !== 'PIN_RESET' && status !== 'DONE' && status !== 'CANCELLED') c.access.lostReportedAt = createdAt;
    const trail: AccessRequest['statusHistory'] = [{ from: null, to: 'REQUESTED', at: createdAt }];
    if (status === 'APPROVED' || status === 'DONE') trail.push({ from: 'REQUESTED', to: 'APPROVED', at: decidedAt });
    if (status === 'DONE') trail.push({ from: 'APPROVED', to: 'DONE', at: decidedAt });
    if (refunded) trail.push({ from: 'REQUESTED', to: status, at: decidedAt });
    accessRequests.push({
      ...base(nid('acr'), createdAt), requestNumber: makeCode('ACC'), facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, unitId: c.unitId,
      type, accessMethod: c.access.method, reason, fee, status, paymentId, refundPaymentId,
      decidedBy: status === 'REQUESTED' ? null : fm, decidedAt: status === 'REQUESTED' ? null : decidedAt, decisionNote: decisionNote ?? null,
      completedAt: status === 'DONE' ? decidedAt : null, completedBy: status === 'DONE' && type !== 'PIN_RESET' ? fm : null,
      newKeyTag: status === 'DONE' && type !== 'PIN_RESET' ? `${type === 'CARD_REISSUE' ? 'CARD' : 'KEY'}-R${(seq % 900) + 100}` : null,
      cancelReason: null, statusHistory: trail,
    });
  };
  const q7Active = contracts.filter((c) => c.facilityId === 'f-q7' && c.status === 'ACTIVE' && c._id !== demoM?._id);
  const byMethod = (m: AccessMethod) => q7Active.filter((c) => c.access.method === m);
  const [pinA] = byMethod('PIN');
  const [cardA, cardB] = byMethod('RFID_CARD');
  const [keyA] = byMethod('PHYSICAL_KEY');
  void pinA; // ổ khoá mật khẩu là khoá vật lý, khách tự đổi trên ổ khoá — không còn yêu cầu đặt lại mật khẩu
  if (cardA) makeAccessRequest(cardA, 'REQUESTED', 1, 'Làm mất thẻ khoá');
  // Phí trả bằng chuyển khoản → khoản hoàn CHỜ CHI (khách chưa khai tài khoản nhận tiền → Quản lý vận hành xác nhận đã chuyển).
  if (cardB) makeAccessRequest(cardB, 'REJECTED', 5, 'Thẻ bị cong', 'Thẻ vẫn quẹt được, vui lòng ra quầy kiểm tra trực tiếp', 'BANK_TRANSFER');
  if (keyA) makeAccessRequest(keyA, 'APPROVED', 2, 'Làm mất chìa khoá');

  return { users, facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, policies, audit };
}
