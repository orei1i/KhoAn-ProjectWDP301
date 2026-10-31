import mongoose, { type ClientSession } from 'mongoose';

/** Số lần chạy lại cả giao dịch khi lỗi tạm thời bị bước khôi phục của mongoose che mất (xem withTxn). */
const MAX_TXN_RETRIES = 3;
const isTransient = (e: unknown) => !!e && typeof (e as { hasErrorLabel?: unknown }).hasErrorLabel === 'function'
  && (e as { hasErrorLabel: (l: string) => boolean }).hasErrorLabel('TransientTransactionError');

/**
 * Runs `fn` in a multi-document transaction (snapshot reads, majority writes).
 * The driver retries the whole callback on TransientTransactionError — e.g. a WriteConflict caused by two
 * bookings bumping the same UnitType.inventoryVersion — so `fn` must be idempotent apart from its DB writes.
 *
 * Đợt 16: khi giao dịch hỏng, mongoose khôi phục trạng thái các document đã lưu trong phiên; với strict: 'throw', bước khôi phục đó có thể
 * tự ném StrictModeError (`__v` trên subdocument lồng) — lỗi này không mang nhãn TransientTransactionError nên driver KHÔNG chạy lại, dù lỗi
 * thật (vd WriteConflict do một lệnh ghi khác — như ghi nhật ký email sau commit — chạm cùng document) là lỗi tạm thời. Gặp trường hợp đó
 * thì tự chạy lại cả giao dịch (tối đa MAX_TXN_RETRIES lần); `fn` nạp lại mọi document trong mỗi lần chạy.
 */
export async function withTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let result!: T;
    let failure: unknown;
    try {
      await mongoose.connection.transaction(async (session) => {
        failure = undefined; // mỗi lần thử lại bắt đầu sạch — chỉ giữ lỗi của lần chạy cuối
        try { result = await fn(session); } catch (e) { failure = e; throw e; }
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
      return result;
    } catch (e) {
      // Trả về đúng lỗi của callback (không phải lỗi khôi phục của mongoose); lỗi tạm thời bị che thì chạy lại cả giao dịch.
      const err = failure ?? e;
      if (attempt < MAX_TXN_RETRIES && isTransient(err) && !isTransient(e)) continue;
      throw err;
    }
  }
}
