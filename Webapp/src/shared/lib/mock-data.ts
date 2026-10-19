import type {
  AccessMethod, AccessRequest, AuditLog, BusinessPolicy, ContractStatus, DamageClaim, Facility, InspectionLog, PaymentMethod,
  PaymentTransaction, RentalContract, RentalPeriod, Reservation, ReservationStatus, ServiceOffering, ServiceOrder, StorageUnit, SupportTicket,
  UnitCategory, UnitStatus, UnitSwapRequest, UnitType, User,
} from '@ssm/shared';
import { ACCESS_METHOD, TERMS_VERSION, claimCapOf, isMonthOnly, pickDiscount, prepaidPeriodsOf, tierTermsOf } from '@ssm/shared';
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
  return {
    ...base(id, addDays(todayISO(), -int(30, 500))), ...alive,
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
    amenities: ['Camera 24/7', 'Xe đẩy miễn phí', 'Thang máy tải hàng', 'Bảo vệ trực đêm'],
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
    { key: 'L', code: 'L-3x4', name: 'Phòng L', category: 'LARGE', dims: [3, 4, 2.8], rates: { DAY: 180_000, WEEK: 1_050_000, MONTH: 3_200_000 }, count: 24, floors: [1, 2], prefix: 'L', minPeriods: 1, desc: 'Nội thất căn nhà 3 phòng ngủ, kho hàng doanh nghiệp nhỏ. Có cả ô thường và ô điều hòa, đủ 3 hình thức khoá.' },
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
  const reservations: Reservation[] = [];
  const contracts: RentalContract[] = [];
  const payments: PaymentTransaction[] = [];

  // useAirConditioning là add-on khách tự chọn lúc đặt (không phải thuộc tính của ô) — mirror công
  // thức BE (pricing.ts: quote() + climateEligible()).
  const quoteFor = (ut: UnitType, period: RentalPeriod, periods: number, useAirConditioning = false) => {
    const rate = ut.rates[period];
    const surchargeAmount = useAirConditioning && ut.category !== 'LOCKER' ? Math.round(rate * 0.1) : 0;
    const gross = rate + surchargeAmount;
    const picked = pickDiscount(policyBody.discounts, period, periods, gross);
    const discountAmount = picked?.amount ?? 0;
    // Kho cỡ lớn (L, XL): giữ chân 2 kỳ + tiền thuê kỳ đầu thu cùng lúc đặt chỗ — xem tier-rules.ts.
    const tier = tierTermsOf(ut.category);
    const depositAmount = gross * tier.depositPeriods;
    const firstPeriodRent = gross - discountAmount;
    return {
      currency: 'VND' as const, rentalPeriod: period, rate, depositAmount, discountAmount, surchargeAmount,
      appliedRuleCodes: [...(surchargeAmount ? ['CLIMATE'] : []), ...(picked ? [picked.tier.code] : [])],
      firstPeriodRent, totalDueAtBooking: depositAmount + (tier.firstPeriodAtBooking ? firstPeriodRent : 0),
      depositPeriods: tier.depositPeriods, firstPeriodAtBooking: tier.firstPeriodAtBooking,
      prepaidPeriods: prepaidPeriodsOf(period, periods), // thuê ngày / tuần trả trọn cả thời hạn khi nhận kho
      policyId: ut.facilityId === 'f-td' ? 'pol-td-1' : 'pol-g-3', policyVersion: ut.facilityId === 'f-td' ? 1 : 3,
    };
  };

  const pay = (p: Partial<PaymentTransaction> & Pick<PaymentTransaction, 'facilityId' | 'customerId' | 'type' | 'amount' | 'status'>): PaymentTransaction => {
    const id = nid('pay');
    const createdAt = p.paidAt ?? p.createdAt ?? NOW;
    return {
      ...base(id, createdAt), contractId: null, reservationId: null, direction: p.type === 'REFUND' ? 'REFUND' : 'CHARGE',
      currency: 'VND', method: pick<PaymentMethod>(['VNPAY', 'MOMO', 'BANK_TRANSFER', 'CARD']), period: null, provider: null,
      idempotencyKey: `seed-${id}`, refundOf: null, refundedAmount: 0, waiver: null, recordedBy: null, paidAt: null, failureReason: null,
      statusHistory: [], ...p,
    } as PaymentTransaction;
  };

  // Chữ ký xác nhận hợp đồng (gõ họ tên) — đặt chỗ đã nhận kho luôn có; đặt chỗ chờ nhận kho có một phần,
  // riêng khách demo cố ý CHƯA ký để thử luồng ký ngay trên web/mobile.
  const signatureOf = (customerId: string, at: string, policyVersion: number): NonNullable<Reservation['signature']> => ({
    signedAt: at, signerName: users.find((x) => x._id === customerId)?.fullName ?? 'Khách hàng', method: 'TYPED', image: null,
    termsVersion: TERMS_VERSION, policyVersion, signedBy: customerId, onBehalf: false,
  });

  // ---------- contracts for occupied units ----------
  let poolIdx = 0;
  const occupied = units.filter((u) => u.status === 'OCCUPIED');
  const specialByFacility: Record<string, { delinquent: number; locked: boolean; moveOut: boolean }> = {};
  // Đúng một hợp đồng LOCKED_OUT trong demo đã gửi THÔNG BÁO CUỐI và đã qua hạn chót, để "Xử lý hàng bỏ lại" bấm được ngay sau seed;
  // các hợp đồng bị khoá khác mới khoá 1 ngày, chưa gửi thông báo cuối (để thử nút "Gửi thông báo cuối").
  let abandonDemoUsed = false;
  for (const u of occupied) {
    const ut = typeOf(u.unitTypeId);
    const sp = (specialByFacility[u.facilityId] ??= { delinquent: 0, locked: false, moveOut: false });
    const isDemoM = u._id === 'su-q7-M2';
    const isDemoLocker = u._id === 'su-q7-T3';
    const customer = isDemoM || isDemoLocker ? DEMO_IDS.customer : pool[poolIdx++ % pool.length]._id;

    // Khách tự chọn chu kỳ lúc đặt — demo M / demo locker cố định THÁNG cho dễ theo dõi khi test.
    // Kho cỡ lớn (L, XL) chỉ thuê theo tháng — xem tier-rules.ts.
    const period: RentalPeriod = isDemoM || isDemoLocker || isMonthOnly(ut.category) ? 'MONTH' : pick(['DAY', 'WEEK', 'MONTH'] as const);
    const addP = (iso: string, n: number) => addPeriods(iso, period, n);
    // Số chu kỳ + độ lùi ngày tạo hợp đồng tùy chu kỳ, để kho thuê theo ngày không sinh hàng trăm kỳ tiền thuê.
    const term = period === 'MONTH' ? pick([3, 6, 12]) : period === 'WEEK' ? pick([2, 4, 8]) : pick([5, 10, 20]);
    const backMax = period === 'MONTH' ? 420 : period === 'WEEK' ? 60 : 25;
    const start = addDays(T, -int(12, backMax));
    const initialEnd = addP(start, term);
    let end = initialEnd;
    const renewals: RentalContract['renewals'] = [];
    while (end <= addDays(T, 4)) {
      const next = addP(end, term);
      renewals.push({ previousEndDate: end, newEndDate: next, periods: term, paymentId: null, at: end });
      end = next;
    }
    // Add-on điều hòa khách tự chọn lúc đặt — không gắn với ô nào, chỉ loại LOCKER luôn false.
    const useAc = ut.category !== 'LOCKER' && rand() < 0.45;
    const q = quoteFor(ut, period, term, useAc);
    let nextBilling = start;
    while (nextBilling <= T) nextBilling = addP(nextBilling, 1);

    let status: ContractStatus = 'ACTIVE';
    if (isDemoLocker) status = 'DELINQUENT';
    else if (!isDemoM && !sp.moveOut && rand() < 0.08) { status = 'MOVE_OUT_PENDING'; sp.moveOut = true; }
    else if (!isDemoM && !sp.locked && rand() < 0.1) { status = 'LOCKED_OUT'; sp.locked = true; }
    else if (!isDemoM && sp.delinquent < 3 && rand() < 0.12) { status = 'DELINQUENT'; sp.delinquent++; }

    const abandonDemo = status === 'LOCKED_OUT' && !abandonDemoUsed;
    if (abandonDemo) abandonDemoUsed = true;
    const lockedOutDaysAgo = abandonDemo ? int(38, 42) : 1;
    const finalNoticeDaysAgo = abandonDemo ? int(31, 34) : null; // hạn chót = thông báo cuối + 30 ngày → đã qua
    const overdueDays = status === 'LOCKED_OUT' ? (abandonDemo ? lockedOutDaysAgo + 16 : int(16, 24)) : status === 'DELINQUENT' ? int(6, 13) : 0;
    const paidThrough = overdueDays ? addDays(T, -overdueDays - 1) : addDays(nextBilling, -1);
    const lateFee = overdueDays ? Math.round(q.rate * 0.05) + (overdueDays >= 15 ? 200_000 : 0) : 0;
    const cid = nid('ctr');
    const rid = nid('rsv');
    const access: AccessMethod = u.accessMethod;

    reservations.push({
      ...base(rid, addDays(start, -int(2, 10))), code: makeCode('RSV'), facilityId: u.facilityId, customerId: customer, unitTypeId: ut._id,
      unitId: u._id, status: 'CHECKED_IN', startDate: start, periods: term, endDate: addP(start, term), quote: q,
      preferredCheckInShift: pick(['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'SHIFT_4', 'UNKNOWN'] as const), useAirConditioning: useAc,
      holdExpiresAt: null, depositPaymentId: null, allocation: { allocatedAt: addDays(start, -1), allocatedBy: null },
      checkIn: { qrTokenHash: null, qrExpiresAt: null, checkedInAt: start, checkedInBy: null }, cancellation: null,
      contractId: cid, source: pick(['WEB', 'MOBILE', 'WALK_IN'] as const), idempotencyKey: null,
      signature: signatureOf(customer, addDays(start, -1), q.policyVersion),
      statusHistory: [{ from: null, to: 'PENDING', at: start }, { from: 'ALLOCATED', to: 'CHECKED_IN', at: start }],
    });

    const deposit = pay({ facilityId: u.facilityId, customerId: customer, contractId: cid, reservationId: rid, type: 'DEPOSIT', amount: q.depositAmount, status: 'SUCCEEDED', paidAt: addDays(start, -2) });
    payments.push(deposit);
    for (let m = 0; ; m++) {
      const ps = addP(start, m);
      if (ps > T) break;
      const pe = addDays(addP(start, m + 1), -1);
      const unpaid = overdueDays > 0 && ps > paidThrough;
      payments.push(pay({
        facilityId: u.facilityId, customerId: customer, contractId: cid, type: m === 0 ? 'RENT' : renewals.length && m % term === 0 ? 'RENEWAL' : 'RENT',
        amount: q.firstPeriodRent, status: unpaid ? (rand() < 0.5 ? 'FAILED' : 'PENDING') : 'SUCCEEDED',
        period: { start: ps, end: pe }, paidAt: unpaid ? null : addDays(ps, int(0, 3)), createdAt: ps,
        failureReason: unpaid ? 'Tài khoản không đủ số dư' : null,
      }));
    }
    if (lateFee) payments.push(pay({ facilityId: u.facilityId, customerId: customer, contractId: cid, type: 'LATE_FEE', amount: lateFee, status: 'PENDING', createdAt: addDays(T, -1) }));

    contracts.push({
      ...base(cid, start), contractNumber: makeCode('CTR'), facilityId: u.facilityId, customerId: customer, unitId: u._id, unitTypeId: ut._id,
      reservationId: rid, status, startDate: start, endDate: end, autoRenew: false, useAirConditioning: useAc,
      // Các kỳ cam kết nối tiếp: kỳ gốc + từng lần gia hạn (mỗi lần gia hạn cùng số kỳ nên cùng bậc ưu đãi).
      commitments: [{ previousEndDate: start, newEndDate: initialEnd }, ...renewals].map((x, i) => ({ kind: i === 0 ? 'INITIAL' as const : 'RENEWAL' as const, startDate: x.previousEndDate, endDate: x.newEndDate, periods: term, gross: q.rate + q.surchargeAmount, discountAmount: q.discountAmount, rate: q.firstPeriodRent, policyId: q.policyId, at: x.previousEndDate })),
      billing: { currency: 'VND', rentalPeriod: period, rate: q.firstPeriodRent, nextBillingDate: nextBilling, paidThrough },
      deposit: { amount: q.depositAmount, status: 'HELD', paymentId: deposit._id, refundedAmount: 0 },
      balance: { outstanding: overdueDays ? q.firstPeriodRent + lateFee : 0, lastPaymentAt: addDays(paidThrough, -28) },
      delinquency: overdueDays ? { since: addDays(T, -overdueDays), daysOverdue: overdueDays, lateFeesAccrued: lateFee, lockedOutAt: status === 'LOCKED_OUT' ? addDays(T, -lockedOutDaysAgo) : null, finalNoticeAt: finalNoticeDaysAgo ? addDays(T, -finalNoticeDaysAgo) : null } : null,
      // Thông báo công nợ đã gửi (Điều 7 Điều khoản): hết ân hạn → khoá → thông báo cuối.
      notices: overdueDays ? [
        { _id: subId(), kind: 'GRACE_EXPIRED' as const, at: addDays(T, -(overdueDays - 6)), amountDue: q.firstPeriodRent + Math.round(q.rate * 0.05), deadline: addDays(paidThrough, 17), note: null, by: null, email: { status: 'SKIPPED' as const, to: null, at: addDays(T, -(overdueDays - 6)) } },
        ...(status === 'LOCKED_OUT' ? [{ _id: subId(), kind: 'LOCKED_OUT' as const, at: addDays(T, -lockedOutDaysAgo), amountDue: q.firstPeriodRent + lateFee, deadline: null, note: null, by: null, email: { status: 'SKIPPED' as const, to: null, at: addDays(T, -lockedOutDaysAgo) } }] : []),
        ...(finalNoticeDaysAgo ? [{ _id: subId(), kind: 'FINAL_NOTICE' as const, at: addDays(T, -finalNoticeDaysAgo), amountDue: q.firstPeriodRent + lateFee, deadline: addDays(T, 30 - finalNoticeDaysAgo), note: 'Đã gọi điện 2 lần, khách không nghe máy', by: null, email: { status: 'SKIPPED' as const, to: null, at: addDays(T, -finalNoticeDaysAgo) } }] : []),
      ] : [],
      access: { method: access, keyTag: access === 'PHYSICAL_KEY' ? `K-${u.unitNumber}` : null, credentialHash: access === 'PHYSICAL_KEY' ? null : 'sha256:••••', issuedAt: start, issuedBy: null, suspendedAt: status === 'LOCKED_OUT' ? addDays(T, -lockedOutDaysAgo) : null, revokedAt: null },
      terms: { policyId: q.policyId, policyVersion: q.policyVersion, gracePeriodDays: 5, lockoutAfterDays: 15, signedAt: addDays(start, -1), signatureRef: `esign-${rid}`, signerName: users.find((x) => x._id === customer)?.fullName ?? null },
      renewals,
      moveOut: status === 'MOVE_OUT_PENDING' ? { requestedAt: addDays(T, -1), scheduledFor: T, completedAt: null, inspectionId: null } : null,
      closedAt: null,
      statusHistory: [{ from: null, to: 'ACTIVE', at: start }, ...(status !== 'ACTIVE' ? [{ from: 'ACTIVE' as const, to: status, at: addDays(T, -Math.max(1, overdueDays - 5)) }] : [])],
    });
    u.currentContractId = cid;
    if (status === 'MOVE_OUT_PENDING') u.status = 'PENDING_INSPECTION';
    if (status === 'LOCKED_OUT') u.overlockActive = true;
  }

  // ---------- upcoming / pending / cancelled reservations ----------
  const availableOf = (fid: string, key: string) => units.filter((u) => u.facilityId === fid && u.unitTypeId === `ut-${fid.slice(2)}-${key}` && u.status === 'AVAILABLE');
  const book = (fid: string, key: string, customerId: string, status: ReservationStatus, startOffset: number, periods: number, extra: Partial<Reservation> = {}) => {
    const ut = typeOf(`ut-${fid.slice(2)}-${key}`);
    const id = nid('rsv');
    const start = addDays(T, startOffset);
    const period: RentalPeriod = isMonthOnly(ut.category) ? 'MONTH' : pick(['DAY', 'WEEK', 'MONTH'] as const);
    // Ô cụ thể được giữ ngay từ PENDING (khách chọn trên sơ đồ lúc đặt) — chỉ CANCELLED là không giữ
    // (đã nhả lại trong thực tế). Hết ô trống cho ALLOCATED thì hạ xuống CONFIRMED — model bắt buộc
    // ALLOCATED phải có unitId, còn CONFIRMED thì không.
    let unitId: string | null = null;
    if (status !== 'CANCELLED') {
      const u = availableOf(fid, key)[0];
      if (!u) { if (status === 'ALLOCATED') status = 'CONFIRMED'; }
      else { u.status = 'RESERVED'; u.currentReservationId = id; unitId = u._id; }
    }
    // Add-on điều hòa khách tự chọn lúc đặt — không gắn với ô nào, chỉ loại LOCKER luôn false.
    const useAc = ut.category !== 'LOCKER' && rand() < 0.45;
    const q = quoteFor(ut, period, periods, useAc);
    const createdAt = addDays(T, -int(1, 9));
    let depositPaymentId: string | null = null;
    if (status !== 'PENDING' && status !== 'CANCELLED') {
      const p = pay({ facilityId: fid, customerId, reservationId: id, type: 'DEPOSIT', amount: q.depositAmount, status: 'SUCCEEDED', paidAt: createdAt });
      payments.push(p); depositPaymentId = p._id;
      // Kho cỡ lớn: tiền thuê kỳ đầu đã trả cùng lúc đặt chỗ (check-in sẽ không thu lại).
      if (q.firstPeriodAtBooking) payments.push(pay({ facilityId: fid, customerId, reservationId: id, type: 'PREPAID_RENT', amount: q.firstPeriodRent, status: 'SUCCEEDED', paidAt: createdAt }));
    }
    reservations.push({
      ...base(id, createdAt), code: makeCode('RSV'), facilityId: fid, customerId, unitTypeId: ut._id, unitId, status,
      startDate: start, periods, endDate: addPeriods(start, period, periods), quote: q,
      preferredCheckInShift: pick(['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'SHIFT_4', 'UNKNOWN'] as const), useAirConditioning: useAc,
      holdExpiresAt: status === 'PENDING' ? new Date(Date.now() + 22 * 60_000).toISOString() : null,
      allocation: unitId ? { allocatedAt: addDays(T, -1), allocatedBy: null } : null,
      depositPaymentId,
      checkIn: status === 'ALLOCATED' || status === 'CONFIRMED' ? { qrTokenHash: 'sha256:demo', qrExpiresAt: addDays(start, 2), checkedInAt: null, checkedInBy: null } : null,
      cancellation: null, contractId: null, source: pick(['WEB', 'MOBILE'] as const), idempotencyKey: null,
      signature: (status === 'ALLOCATED' || status === 'CONFIRMED') && customerId !== DEMO_IDS.customer && rand() < 0.65 ? signatureOf(customerId, createdAt, q.policyVersion) : null,
      statusHistory: [{ from: null, to: 'PENDING', at: createdAt }, ...(status !== 'PENDING' ? [{ from: 'PENDING' as const, to: status, at: createdAt }] : [])],
      ...extra,
    });
  };
  const cust = (i: number) => pool[(i * 7) % pool.length]._id;

  book('f-q7', 'S', DEMO_IDS.customer, 'ALLOCATED', 0, 6);
  book('f-td', 'L', DEMO_IDS.customer, 'CONFIRMED', 6, 12);
  book('f-q7', 'M', cust(1), 'ALLOCATED', 0, 3);
  book('f-q7', 'LK', cust(2), 'ALLOCATED', 0, 1);
  book('f-q7', 'S', cust(4), 'CONFIRMED', 1, 3);
  book('f-q7', 'L', cust(5), 'CONFIRMED', 2, 12);
  book('f-q7', 'M', cust(6), 'CONFIRMED', 5, 6);
  book('f-q7', 'LK', cust(8), 'PENDING', 3, 1);
  book('f-q7', 'M', cust(17), 'CONFIRMED', -2, 3); // no-show candidate
  book('f-q7', 'S', cust(9), 'CANCELLED', 2, 3, { cancellation: { reason: 'HOLD_EXPIRED', cancelledAt: addDays(T, -1), cancelledBy: null, refundAmount: 0 } });
  book('f-q7', 'M', cust(10), 'CANCELLED', 4, 6, { cancellation: { reason: 'CUSTOMER_REQUEST', note: 'Đổi kế hoạch chuyển nhà', cancelledAt: addDays(T, -2), cancelledBy: cust(10), refundAmount: 1_790_000 } });
  book('f-td', 'M', cust(11), 'ALLOCATED', 0, 6);
  book('f-td', 'S', cust(12), 'CONFIRMED', 1, 3);
  book('f-tb', 'LK', cust(14), 'ALLOCATED', 1, 2);
  book('f-tb', 'M', cust(15), 'CONFIRMED', 0, 6);
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

  const tickets: SupportTicket[] = [
    ticket('f-q7', { kind: 'CUSTOMER_ISSUE', reporterId: DEMO_IDS.customer, contractId: demoM?._id ?? null, unitId: 'su-q7-M2', subject: 'Ổ khóa kho M bị kẹt, không mở được', description: 'Tối qua 20h tôi đến lấy đồ nhưng chìa không xoay được. Nhờ kiểm tra giúp.', category: 'ACCESS', priority: 'HIGH', status: 'IN_PROGRESS', assigneeId: DEMO_IDS.staff, dueAt: addDays(T, 0),
      messages: [{ authorId: DEMO_IDS.customer, body: 'Tối qua 20h tôi đến lấy đồ nhưng chìa không xoay được.', internal: false, at: addDays(NOW, -1) }, { authorId: DEMO_IDS.staff, body: 'Em đã nhận, sáng nay sẽ thay ổ khóa và báo lại anh/chị.', internal: false, at: addDays(NOW, -0.5) }] }),
    ticket('f-q7', { kind: 'CUSTOMER_ISSUE', reporterId: cust(3), subject: 'Thấy gián gần dãy S tầng 2', category: 'PEST', priority: 'MEDIUM', status: 'OPEN', dueAt: addDays(T, 2) }),
    ticket('f-q7', { kind: 'OPS_TASK', reporterId: DEMO_IDS.manager, subject: 'Kiểm tra định kỳ bình chữa cháy tầng 2', category: 'MAINTENANCE', priority: 'MEDIUM', status: 'ASSIGNED', assigneeId: 'u-staff-q7b', dueAt: addDays(T, 2) }),
    ticket('f-q7', { kind: 'OPS_TASK', reporterId: DEMO_IDS.manager, subject: 'Gắn khóa chặn (overlock) các kho quá hạn', category: 'SECURITY', priority: 'HIGH', status: 'OPEN', dueAt: addDays(T, 1) }),
    ticket('f-q7', { kind: 'CUSTOMER_ISSUE', reporterId: cust(5), subject: 'Xin xuất hóa đơn VAT tháng trước', category: 'BILLING', priority: 'LOW', status: 'RESOLVED', assigneeId: DEMO_IDS.manager, resolvedAt: addDays(T, -1) }),
    ticket('f-td', { kind: 'CUSTOMER_ISSUE', reporterId: cust(11), subject: 'Đèn hành lang dãy M chập chờn', category: 'MAINTENANCE', priority: 'MEDIUM', status: 'OPEN' }),
    ticket('f-td', { kind: 'OPS_TASK', reporterId: 'u-fm-td', subject: 'Vệ sinh kho sau khi khách trả', category: 'CLEANING', priority: 'LOW', status: 'ASSIGNED', assigneeId: 'u-staff-td', dueAt: addDays(T, 1) }),
    ticket('f-tb', { kind: 'CUSTOMER_ISSUE', reporterId: cust(15), subject: 'Camera khu hầm xe không hoạt động', category: 'SECURITY', priority: 'URGENT', status: 'OPEN', dueAt: addDays(T, 0) }),
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
  const q7Contracts = contracts.filter((c) => c.facilityId === 'f-q7' && c.status !== 'CLOSED');
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
        { from: 'SUBMITTED', to: 'UNDER_REVIEW', at: addDays(NOW, -5), by: DEMO_IDS.staff, reason: 'Đang trích xuất camera' },
      ],
    }),
    claim(q7Contracts[2], {
      type: 'DAMAGE', status: 'PAID', createdAt: addDays(NOW, -25),
      description: 'Xe nâng của kho va vào cửa cuốn làm móp thùng đồ gỗ của khách.',
      items: [{ name: 'Tủ gỗ 3 cánh', quantity: 1, unitValue: 4_000_000 }],
      review: { reviewedBy: DEMO_IDS.manager, reviewedAt: addDays(NOW, -22), approvedAmount: 3_200_000, liabilityCap: Math.max(3_200_000, claimCapOf(q7Contracts[2], unitTypes) ?? 0), decisionNote: 'Lỗi thuộc về kho, đã đối chiếu camera. Duyệt 80% giá trị khai báo theo mức khấu hao.' },
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
  const makeOrder = (c: RentalContract, code: string, quantity: number, status: ServiceOrder['status'], daysAgo: number, note?: string) => {
    const svc = services.find((x) => x.facilityId === c.facilityId && x.code === code);
    if (!svc) return;
    const createdAt = addDays(NOW, -daysAgo);
    const total = svc.price * quantity;
    const paid = pay({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'SERVICE', amount: total, status: status === 'CANCELLED' ? 'REFUNDED' : 'SUCCEEDED', paidAt: createdAt, refundedAmount: status === 'CANCELLED' ? total : 0 });
    payments.push(paid);
    let refundPaymentId: string | null = null;
    if (status === 'CANCELLED') {
      const refund = pay({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: total, status: 'SUCCEEDED', paidAt: createdAt, refundOf: paid._id, method: 'BANK_TRANSFER' });
      payments.push(refund); refundPaymentId = refund._id;
    }
    const doneAt = addDays(createdAt, 1);
    serviceOrders.push({
      ...base(nid('svo'), createdAt), orderNumber: makeCode('SVC'), facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, serviceId: svc._id,
      serviceName: svc.name, unitPrice: svc.price, unitLabel: svc.unitLabel, quantity, total, preferredDate: addDays(createdAt, 2), note,
      status, paymentId: paid._id, refundPaymentId,
      completedAt: status === 'DONE' ? doneAt : null, completedBy: status === 'DONE' && c.facilityId === 'f-q7' ? DEMO_IDS.staff : null,
      cancelReason: status === 'CANCELLED' ? 'Khách đổi lịch' : null,
      statusHistory: [{ from: null, to: 'REQUESTED', at: createdAt }, ...(status !== 'REQUESTED' ? [{ from: 'REQUESTED' as const, to: status, at: doneAt }] : [])],
    });
  };
  if (demoM && demoM.status === 'ACTIVE') {
    makeOrder(demoM, 'CLEAN', 1, 'DONE', 9);
    makeOrder(demoM, 'PACK-BOX', 10, 'REQUESTED', 1, 'Giao thùng vào sáng thứ Bảy');
    makeOrder(demoM, 'MOVE-CITY', 1, 'CANCELLED', 4, 'Chuyển đồ sang kho mới');
  }
  const ORDER_CODES = ['PACK-SVC', 'CLEAN', 'HUMID', 'PACK-BOX', 'SHELF', 'MOVE-CITY'];
  contracts.filter((c) => c.status === 'ACTIVE' && c._id !== demoM?._id).slice(0, 8)
    .forEach((c, i) => makeOrder(c, ORDER_CODES[i % ORDER_CODES.length], 1 + (i % 3), i % 3 === 0 ? 'DONE' : 'REQUESTED', i % 3 === 0 ? 6 : 1));

  // ---------- yêu cầu cấp lại mật khẩu / thẻ / chìa (khách gửi, Quản lý chi nhánh duyệt) ----------
  const accessRequests: AccessRequest[] = [];
  const makeAccessRequest = (c: RentalContract, status: AccessRequest['status'], daysAgo: number, reason: string, decisionNote?: string) => {
    const type = c.access.method === 'PIN' ? 'PIN_RESET' as const : c.access.method === 'RFID_CARD' ? 'CARD_REISSUE' as const : 'KEY_REISSUE' as const;
    const fee = type === 'CARD_REISSUE' ? 50_000 : 0;
    const createdAt = addDays(NOW, -daysAgo);
    const decidedAt = addDays(createdAt, 1);
    const refunded = status === 'REJECTED' || status === 'CANCELLED';
    let paymentId: string | null = null;
    let refundPaymentId: string | null = null;
    if (fee > 0) {
      const paid = pay({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'ACCESS_FEE', amount: fee, status: refunded ? 'REFUNDED' : 'SUCCEEDED', paidAt: createdAt, refundedAmount: refunded ? fee : 0 });
      payments.push(paid); paymentId = paid._id;
      if (refunded) {
        const refund = pay({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'REFUND', amount: fee, status: 'SUCCEEDED', paidAt: decidedAt, refundOf: paid._id, method: 'BANK_TRANSFER' });
        payments.push(refund); refundPaymentId = refund._id;
      }
    }
    const fm = c.facilityId === 'f-q7' ? DEMO_IDS.manager : null;
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
  if (cardB) makeAccessRequest(cardB, 'REJECTED', 5, 'Thẻ bị cong', 'Thẻ vẫn quẹt được, vui lòng ra quầy kiểm tra trực tiếp');
  if (keyA) makeAccessRequest(keyA, 'APPROVED', 2, 'Làm mất chìa khoá');

  return { users, facilities, unitTypes, units, reservations, contracts, payments, inspections, tickets, claims, swapRequests, services, serviceOrders, accessRequests, policies, audit };
}
