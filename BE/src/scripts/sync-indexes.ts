import mongoose from 'mongoose';
import { connectMongo } from '../shared/db/connection';
import { ALL_MODELS } from '../shared/db/models';

/** Creates missing indexes and drops ones no longer declared in the schemas. Run on deploy (autoIndex is off in prod). */
async function main() {
  await connectMongo();
  for (const m of ALL_MODELS) {
    const diff = await m.diffIndexes();
    await m.syncIndexes();
    console.log(`${m.modelName.padEnd(20)} +${diff.toCreate.length} -${diff.toDrop.length}`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
