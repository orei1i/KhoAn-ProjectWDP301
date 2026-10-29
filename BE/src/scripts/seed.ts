/**
 * Resets the database and loads the SAME demo data the Webapp mock uses (Webapp/src/shared/lib/mock-data.ts),
 * then creates/links Firebase logins for the demo accounts.
 *   npm run seed            (from BE/)
 * ⚠ Wipes every collection of the configured database. Never point it at production.
 */
import mongoose, { Types, type Model } from 'mongoose';
import { env, isLocalMongoUri } from '../shared/config/env';
import { encryptSecret } from '../shared/crypto/secret-box';
import { sha256 } from '../features/payments/payment.service';
import { firebaseAuth } from '../shared/config/firebase';
import { connectMongo } from '../shared/db/connection';
import {
  ALL_MODELS, AccessRequestModel, AuditLogModel, DamageClaimModel, FacilityModel, InspectionModel, IntakeBatchModel, PaymentModel, PolicyModel,
  RentalContractModel, ReservationModel, ServiceOfferingModel, ServiceOrderModel, StorageUnitModel, TicketModel, UnitSwapRequestModel, UnitTypeModel, UserModel,
} from '../shared/db/models';
import { createSeed, DEMO_IDS } from '../../../Webapp/src/shared/lib/mock-data';
import { todayISO } from '@ssm/shared';

const DEMO_LOGINS: Record<string, string> = {
  [DEMO_IDS.customer]: 'khach.demo@khoan.dev',
  [DEMO_IDS.staff]: 'nhanvien.q7@khoan.dev',
  [DEMO_IDS.manager]: 'quanly.q7@khoan.dev',
  'u-fm-td': 'quanly.td@khoan.dev',
  'u-fm-tb': 'quanly.tb@khoan.dev',
  [DEMO_IDS.ops]: 'vanhanh@khoan.dev',
  [DEMO_IDS.admin]: 'admin@khoan.dev',
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

async function main() {
  // Seed XOÁ SẠCH database. NODE_ENV=production: từ chối trừ khi xác nhận rõ SEED_CONFIRM=yes (VD dựng lại dữ liệu demo có chủ đích).
  if (env.isProd && env.SEED_CONFIRM !== 'yes') throw new Error('Refusing to seed with NODE_ENV=production — set SEED_CONFIRM=yes to confirm wiping this database');
  if (!isLocalMongoUri(env.MONGODB_URI)) console.warn('⚠  MONGODB_URI is NOT a local mongod — this seed wipes a remote database.');
  await connectMongo();
  const dbName = mongoose.connection.name;
  console.log(`⚠  Wiping database "${dbName}" …`);
  for (const m of ALL_MODELS) await m.collection.deleteMany({}); // driver-level: bypasses append-only hooks on purpose
  for (const m of ALL_MODELS) await m.syncIndexes();

  const data = createSeed();

  // Hợp đồng khoá mật khẩu: PIN demo cố định theo số hợp đồng, lưu mã hoá để khách xem được trong app.
  for (const c of data.contracts) {
    if (c.access.method !== 'PIN') continue;
    const n = Number(c.contractNumber.replace(/\D/g, '').slice(-6) || '1');
    const pin = String(100_000 + ((n * 7919) % 900_000));
    c.access.credentialHash = sha256(pin);
    c.access.credentialEnc = encryptSecret(pin);
  }

  // mock string ids ('f-q7', 'u-c-01', …) → ObjectIds, applied everywhere they appear
  const idMap = new Map<string, Types.ObjectId>();
  for (const list of Object.values(data)) for (const d of list as { _id: string }[]) idMap.set(d._id, new Types.ObjectId());
  const convert = (v: unknown): unknown => {
    if (typeof v === 'string') return idMap.get(v) ?? (ISO.test(v) ? new Date(v) : v);
    if (Array.isArray(v)) return v.map(convert);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, convert(x)]));
    return v;
  };
  // Khoá chống trùng do job / luồng thật sinh ra có chứa id hợp đồng / đặt chỗ (rent-<hợp đồng>-<ngày>, late-<hợp đồng>-<paidThrough>,
  // lock-…, checkin-rent-<đặt chỗ>, walkin-dep-…) — đổi id mock trong khoá thành đúng ObjectId đã map, để job chạy lần đầu nhận ra
  // khoản đã có và KHÔNG thu trùng.
  const MOCK_ID_IN_KEY = /\b(?:ctr|rsv)-[0-9a-z]{4}\b/g;
  for (const p of data.payments) p.idempotencyKey = p.idempotencyKey.replace(MOCK_ID_IN_KEY, (m) => String(idMap.get(m) ?? m));

  // Demo logins: nice emails + Firebase accounts (created or reused), linked by uid
  for (const u of data.users) {
    const email = DEMO_LOGINS[u._id];
    if (!email) continue;
    u.email = email;
    const fb = await firebaseAuth.getUserByEmail(email).catch(() => null);
    const account = fb
      ? await firebaseAuth.updateUser(fb.uid, { password: env.SEED_PASSWORD, displayName: u.fullName, emailVerified: true, disabled: false })
      : await firebaseAuth.createUser({ email, password: env.SEED_PASSWORD, displayName: u.fullName, emailVerified: true });
    u.firebaseUid = account.uid;
  }

  const plan: [Model<any>, unknown[]][] = [
    [UserModel, data.users], [PolicyModel, data.policies], [FacilityModel, data.facilities], [UnitTypeModel, data.unitTypes],
    [StorageUnitModel, data.units], [ReservationModel, data.reservations], [RentalContractModel, data.contracts],
    [PaymentModel, data.payments], [InspectionModel, data.inspections], [TicketModel, data.tickets],
    [DamageClaimModel, data.claims], [UnitSwapRequestModel, data.swapRequests],
    [ServiceOfferingModel, data.services], [ServiceOrderModel, data.serviceOrders], [AccessRequestModel, data.accessRequests], [AuditLogModel, data.audit],
    [IntakeBatchModel, data.intakeBatches ?? []], // đợt 14: đợt nhập hàng (items[]._id là chuỗi 24 hex — giữ nguyên)
  ];
  for (const [model, docs] of plan) {
    await model.insertMany(docs.map(convert), { ordered: true });
    console.log(`  ${model.modelName.padEnd(20)} ${docs.length}`);
  }

  console.log('\n✅ Seed done. Demo logins (password: SEED_PASSWORD from .env):');
  for (const [id, email] of Object.entries(DEMO_LOGINS)) {
    const u = data.users.find((x) => x._id === id)!;
    console.log(`  ${u.role.padEnd(17)} ${email.padEnd(24)} ${u.fullName}`);
  }
  printDemoGuide(data);
  await mongoose.disconnect();
}

/** Hợp đồng / đặt chỗ dùng cho từng bước demo — số hợp đồng / mã đặt chỗ đổi theo ngày seed nên in ra sau mỗi lần seed. */
function printDemoGuide(data: ReturnType<typeof createSeed>) {
  const T = todayISO();
  const fac = (id: string) => data.facilities.find((f) => f._id === id)?.code ?? id;
  const unitNo = (id?: string | null) => data.units.find((u) => u._id === id)?.unitNumber ?? 'chưa phân ô';
  const who = (id: string) => {
    const u = data.users.find((x) => x._id === id);
    const p = u?.customerProfile;
    return `${u?.fullName ?? '—'} (${p?.idNumberLast4 ? `${p.idType ?? 'CCCD'} …${p.idNumberLast4}` : 'chưa khai giấy tờ'})`;
  };
  const c = (label: string, list: { contractNumber: string; facilityId: string; unitId: string; customerId: string }[]) =>
    list.forEach((x) => console.log(`  ${label.padEnd(30)} ${x.contractNumber}  ${fac(x.facilityId)} ô ${unitNo(x.unitId)} — ${who(x.customerId)}`));
  const r = (label: string, list: { code: string; facilityId: string; unitId?: string | null; customerId: string; signature?: unknown }[]) =>
    list.forEach((x) => console.log(`  ${label.padEnd(30)} ${x.code}  ${fac(x.facilityId)} ô ${unitNo(x.unitId)} — ${who(x.customerId)}${x.signature ? '' : ' · CHƯA ký'}`));
  console.log('\nGợi ý demo (chạy seed ngay trước buổi demo — giữ chỗ PENDING tự huỷ sau ~20 phút):');
  r('Nhận kho hôm nay', data.reservations.filter((x) => x.status === 'ALLOCATED' && x.startDate === T));
  r('Chờ phân ô (CONFIRMED)', data.reservations.filter((x) => x.status === 'CONFIRMED' && !x.unitId));
  r('Khách không đến (job huỷ)', data.reservations.filter((x) => x.status === 'ALLOCATED' && x.startDate < T));
  r('Chờ thu tiền tại quầy', data.reservations.filter((x) => x.status === 'PENDING' && x.payAtCounter));
  c('Trả kho — chờ nhận chìa/thẻ', data.contracts.filter((x) => x.status === 'MOVE_OUT_PENDING' && !x.access.revokedAt));
  c('Đã nhận lại — chờ biên bản', data.contracts.filter((x) => x.status === 'MOVE_OUT_PENDING' && !!x.access.revokedAt));
  c('Xử lý hàng bỏ lại', data.contracts.filter((x) => x.status === 'LOCKED_OUT' && !!x.delinquency?.finalNoticeAt));
  c('Mới khoá — gửi thông báo cuối', data.contracts.filter((x) => x.status === 'LOCKED_OUT' && !x.delinquency?.finalNoticeAt));
  c('Quá hạn (chưa khoá)', data.contracts.filter((x) => x.status === 'DELINQUENT'));
  const lost = data.accessRequests.filter((x) => x.status === 'REQUESTED').map((a) => data.contracts.find((k) => k._id === a.contractId)!).filter(Boolean);
  c('Báo mất thẻ — chờ duyệt', lost);
  // Đợt 14: đợt nhập hàng khách vừa khai, chờ nhân viên kiểm hàng cấm và xác nhận (trang "Nhập hàng").
  for (const b of (data.intakeBatches ?? []).filter((x) => x.status === 'DECLARED')) {
    const k = data.contracts.find((x) => x._id === b.contractId);
    if (k) console.log(`  ${'Đợt nhập chờ xác nhận'.padEnd(30)} ${b.code}  ${k.contractNumber} ${fac(k.facilityId)} ô ${unitNo(k.unitId)} — ${b.items.length} món, ${who(k.customerId)}`);
  }
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
