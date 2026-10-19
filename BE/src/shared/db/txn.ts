import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `fn` in a multi-document transaction (snapshot reads, majority writes).
 * The driver retries the whole callback on TransientTransactionError — e.g. a WriteConflict caused by two
 * bookings bumping the same UnitType.inventoryVersion — so `fn` must be idempotent apart from its DB writes.
 */
export async function withTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  let result!: T;
  let failure: unknown;
  try {
    await mongoose.connection.transaction(async (session) => {
      failure = undefined; // mỗi lần thử lại bắt đầu sạch — chỉ giữ lỗi của lần chạy cuối
      try { result = await fn(session); } catch (e) { failure = e; throw e; }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } catch (e) {
    // Giao dịch hỏng hẳn thì mongoose khôi phục trạng thái các document đã lưu trong phiên; với strict: 'throw', bước khôi phục đó
    // có thể tự ném StrictModeError (`__v` trên subdocument lồng) và che mất lỗi thật → trả về đúng lỗi của callback.
    throw failure ?? e;
  }
  return result;
}
