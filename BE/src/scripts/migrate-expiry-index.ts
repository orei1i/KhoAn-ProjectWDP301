/**
 * Điều khoản 1.24 — thêm trạng thái hợp đồng EXPIRED (hết hạn đã khoá, đồ còn trong ô) vào OPEN_CONTRACT_STATUSES. Chỉ mục duy nhất
 * `rentalContracts.unitId_1` lọc theo danh sách trạng thái mở (partialFilterExpression) nên phải XOÁ và DỰNG LẠI — autoIndex (dev) gặp chỉ
 * mục cùng tên khác tuỳ chọn thì báo IndexOptionsConflict và giữ nguyên chỉ mục cũ (không có EXPIRED). Mất chỉ mục này không làm hỏng dữ
 * liệu (trạng thái ô kho vẫn chặn cho thuê trùng), đây là lớp chặn cuối.
 *
 * Chạy lại bao nhiêu lần cũng được (chỉ mục đã đúng thì không làm gì):
 *   cd BE && npx tsx src/scripts/migrate-expiry-index.ts
 * Chỉ chạy được với mongod cục bộ; database khác (VD Atlas) phải thêm `--allow-remote` — CHỈ khi chủ sản phẩm đã đồng ý.
 */
import mongoose from 'mongoose';
import { OPEN_CONTRACT_STATUSES } from '@ssm/shared';
import { env, isLocalMongoUri } from '../shared/config/env';
import { connectMongo } from '../shared/db/connection';
import { RentalContractModel } from '../shared/db/models';

const INDEX = 'unitId_1';

async function main() {
  if (!isLocalMongoUri(env.MONGODB_URI) && !process.argv.includes('--allow-remote')) {
    throw new Error('MONGODB_URI không phải mongod cục bộ — chạy trên database xa cần chủ sản phẩm đồng ý và thêm --allow-remote');
  }
  await connectMongo();
  const coll = RentalContractModel.collection;
  const want = [...OPEN_CONTRACT_STATUSES].sort();
  const current = (await coll.indexes()).find((i) => i.name === INDEX);
  const filter = current?.partialFilterExpression as { status?: { $in?: unknown[] } } | undefined;
  const have = (filter?.status?.$in ?? []).map(String).sort();
  const same = !!current && current.unique === true && have.length === want.length && have.every((s, k) => s === want[k]);
  if (same) {
    console.log(`[migrate-expiry-index] ${mongoose.connection.name}.rentalContracts.${INDEX} đã đúng (${want.join(', ')}) — không đổi`);
  } else {
    if (current) {
      await coll.dropIndex(INDEX);
      console.log(`[migrate-expiry-index] đã xoá ${INDEX} cũ (${have.join(', ') || 'không lọc'})`);
    }
    await coll.createIndex({ unitId: 1 }, { name: INDEX, unique: true, partialFilterExpression: { status: { $in: [...OPEN_CONTRACT_STATUSES] } } });
    console.log(`[migrate-expiry-index] đã dựng ${mongoose.connection.name}.rentalContracts.${INDEX} với ${want.join(', ')}`);
  }
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('[migrate-expiry-index]', e instanceof Error ? e.message : e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
