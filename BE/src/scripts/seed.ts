/**
 * Resets the database and loads the SAME demo data the Webapp mock uses (Webapp/src/shared/lib/mock-data.ts),
 * then creates/links Firebase logins for the demo accounts.
 *   npm run seed            (from BE/)
 * ⚠ Wipes every collection of the configured database. Never point it at production.
 */
import mongoose, { Types, type Model } from 'mongoose';
import { env } from '../shared/config/env';
import { encryptSecret } from '../shared/crypto/secret-box';
import { sha256 } from '../features/payments/payment.service';
import { firebaseAuth } from '../shared/config/firebase';
import { connectMongo } from '../shared/db/connection';
import {
  ALL_MODELS, AccessRequestModel, AuditLogModel, DamageClaimModel, FacilityModel, InspectionModel, PaymentModel, PolicyModel,
  RentalContractModel, ReservationModel, ServiceOfferingModel, ServiceOrderModel, StorageUnitModel, TicketModel, UnitSwapRequestModel, UnitTypeModel, UserModel,
} from '../shared/db/models';
import { createSeed, DEMO_IDS } from '../../../Webapp/src/shared/lib/mock-data';

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
  if (env.isProd) throw new Error('Refusing to seed with NODE_ENV=production');
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
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
