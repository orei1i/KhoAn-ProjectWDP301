import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `fn` in a multi-document transaction (snapshot reads, majority writes).
 * The driver retries the whole callback on TransientTransactionError — e.g. a WriteConflict caused by two
 * bookings bumping the same UnitType.inventoryVersion — so `fn` must be idempotent apart from its DB writes.
 */
export async function withTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  let result!: T;
  await mongoose.connection.transaction(async (session) => {
    result = await fn(session);
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  return result;
}
