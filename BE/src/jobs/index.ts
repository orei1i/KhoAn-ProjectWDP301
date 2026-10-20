import { RentalContractModel, ReservationModel, StorageUnitModel } from '../shared/db/models';
import { runAsSystem } from '../shared/core/request-context';
import { addDays, daysBetween, todayUTC } from '../shared/utils/dates';
import { fmtDate, localMidnightMs, statusBeforeMoveOut } from '@ssm/shared';
import { signedPolicy } from '../features/policies/pricing';
import { cancelReservation } from '../features/reservations/reservation.service';
import { expireSwapRequests } from '../features/swaps/unit-swap-request.service';
import { audit } from '../features/audit/audit.service';
import { createPayment } from '../features/payments/payment.service';
import { coveredByPaidRenewal, nextBillingAfter, rentForPeriod } from '../features/contracts/billing-rules';
import { withTxn } from '../shared/db/txn';
import { addNotice, deliverNotices, type PendingNotice } from '../features/contracts/contract-notice.service';
import { applyLockout } from '../features/contracts/lockout';

/**
 * In-process schedulers — fine for one API instance. With several instances, move these to a single worker
 * (or Atlas Triggers / a queue) so two processes don't race; the unique indexes still prevent double billing.
 */
export function startJobs() {
  const every = (ms: number, name: string, fn: () => Promise<void>) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await runAsSystem(fn); } catch (e) { console.error(`[job:${name}]`, e); } finally { running = false; }
    };
    setTimeout(tick, 5_000);
    return setInterval(tick, ms);
  };
  const timers = [
    every(60_000, 'hold-expiry', expireHolds),
    every(60 * 60_000, 'billing', runBilling),
    every(60 * 60_000, 'swap-expiry', expireSwapRequests),
    every(30 * 60_000, 'no-show', cancelNoShows),
  ];
  return () => timers.forEach(clearInterval);
}

/** PENDING bookings whose deposit window lapsed → CANCELLED(HOLD_EXPIRED), releasing capacity. */
export async function expireHolds() {
  const stale = await ReservationModel.find({ status: 'PENDING', holdExpiresAt: { $lte: new Date() } }, { _id: 1 }).limit(100).lean();
  for (const r of stale) {
    try { await cancelReservation(null, String(r._id), 'HOLD_EXPIRED'); } catch (e) { console.error('expire hold', r._id, e); }
  }
  if (stale.length) console.log(`[job:hold-expiry] cancelled ${stale.length}`);
}

/**
 * Khách đã trả tiền giữ chân nhưng KHÔNG đến nhận kho: quá `noShowAfterHours` giờ sau khi hết ngày nhận đã đặt thì hủy
 * đặt chỗ (lý do NO_SHOW — không hoàn tiền, đúng điều khoản hợp đồng) và nhả ô kho cho người khác thuê.
 * Hạn tính từ CUỐI ngày nhận (startDate là 00:00 của ngày đó) để khách đến trong ngày không bao giờ bị hủy oan.
 */
export async function cancelNoShows() {
  const now = Date.now();
  // Lọc thô theo ngày (ít nhất đã qua hết ngày nhận), rồi mới xét hạn chính xác theo chính sách của từng chi nhánh.
  const candidates = await ReservationModel.find({ status: { $in: ['CONFIRMED', 'ALLOCATED'] }, startDate: { $lt: addDays(todayUTC(), 0) } }, { _id: 1, facilityId: 1, startDate: 1, status: 1, 'quote.policyId': 1 }).limit(200).lean();
  const hoursByPolicy = new Map<string, number>();
  let cancelled = 0;
  for (const r of candidates) {
    // Số giờ chờ theo chính sách khách đã đặt (in trong hợp đồng), không theo bản mới phát hành sau đó.
    const key = `${String(r.quote?.policyId ?? '')}|${String(r.facilityId)}`;
    if (!hoursByPolicy.has(key)) hoursByPolicy.set(key, (await signedPolicy(r.quote?.policyId, r.facilityId)).noShowAfterHours);
    // Hết ngày nhận = 00:00 giờ chi nhánh của ngày kế tiếp.
    const deadline = localMidnightMs(addDays(r.startDate, 1)) + hoursByPolicy.get(key)! * 3_600_000;
    if (now < deadline) continue;
    // Chỉ là "khách không đến" khi đã có ô chờ sẵn. Đặt chỗ còn CONFIRMED (chi nhánh gỡ ô mà chưa phân lại) thì khách có đến cũng
    // không nhận được kho — lỗi phía KhoAn, hoàn 100% (Điều 11).
    const [reason, note] = r.status === 'ALLOCATED'
      ? ['NO_SHOW', 'Khách không đến nhận kho trong thời gian quy định'] as const
      : ['FACILITY_UNAVAILABLE', 'Chi nhánh chưa phân ô kho trước hạn nhận — huỷ và hoàn 100%'] as const;
    try { await cancelReservation(null, String(r._id), reason, note); cancelled++; } catch (e) { console.error('no-show', r._id, e); }
  }
  if (cancelled) console.log(`[job:no-show] cancelled ${cancelled}`);
}

/** Issues rent for due periods, then escalates overdue contracts ACTIVE → DELINQUENT → LOCKED_OUT per policy. */
export async function runBilling() {
  const today = todayUTC();

  // Hợp đồng đã đăng ký trả kho nhưng CHƯA bàn giao (quyền truy cập chưa thu hồi) vẫn đang giữ ô và ra vào được →
  // vẫn tính tiền thuê; nếu không, khách chỉ cần đăng ký trả kho với ngày hẹn thật xa là dùng kho miễn phí.
  const due = await RentalContractModel.find({
    'billing.nextBillingDate': { $lte: today },
    $or: [{ status: { $in: ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT'] } }, { status: 'MOVE_OUT_PENDING', 'access.revokedAt': null }],
  }, { _id: 1 }).limit(500).lean();
  for (const { _id } of due) {
    await withTxn(async (session) => {
      const c = await RentalContractModel.findById(_id).session(session);
      if (!c || c.billing.nextBillingDate > today) return;
      if (c.status === 'MOVE_OUT_PENDING' && c.access.revokedAt) return; // vừa bàn giao xong — không tính thêm kỳ nào
      const start = c.billing.nextBillingDate;
      const period = c.billing.rentalPeriod;
      const next = nextBillingAfter(c.startDate, period, start); // theo mốc ngày nhận kho, không trôi về ngày 28
      const end = addDays(next, -1);
      // Kỳ này khách đã trả trước khi gia hạn (RENEWAL) → không xuất hoá đơn RENT lần nữa, chỉ đẩy lịch sang kỳ sau.
      if (coveredByPaidRenewal(c.renewals, start)) {
        c.billing.nextBillingDate = next;
        if (c.balance.outstanding <= 0 && c.status === 'ACTIVE') c.billing.paidThrough = end;
        await c.save({ session });
        return;
      }
      // Giá của kỳ này theo KỲ CAM KẾT chứa nó (kỳ gốc hoặc một lần gia hạn, mỗi kỳ ưu đãi riêng). Hết hạn mà không gia hạn — hoặc
      // đã đăng ký trả kho nhưng chưa bàn giao sau ngày hết hạn — thì vẫn giữ đồ trong kho nên tiếp tục tính tiền, nhưng theo giá
      // CHƯA ưu đãi: không còn cam kết thì không còn ưu đãi. Hệ thống KHÔNG tự gia hạn cam kết thay khách (endDate giữ nguyên).
      // Nếu khách không đóng tiền, luồng DELINQUENT → LOCKED_OUT bên dưới tự xử lý như nợ thông thường.
      const amount = rentForPeriod(c, start);
      c.billing.rate = amount; // giá đang áp dụng — để mọi màn hình hiện đúng số khách đang trả
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'RENT', amount, status: 'PENDING', method: 'BANK_TRANSFER', period: { start, end }, idempotencyKey: `rent-${c._id}-${start.toISOString().slice(0, 10)}` }, session);
      c.balance.outstanding += amount;
      c.billing.nextBillingDate = next;
      await c.save({ session });
    }).catch((e) => console.error('billing', _id, e));
  }

  // Đã khoá (LOCKED_OUT): không còn bước chuyển trạng thái nào ở đây, chỉ cần số ngày quá hạn tiếp tục tăng (báo cáo tuổi nợ, danh sách
  // quá hạn) — cập nhật một lượt bằng phép tính ngày, KHÔNG chiếm chỗ trong vòng xử lý từng hợp đồng bên dưới.
  await RentalContractModel.collection.updateMany(
    { status: 'LOCKED_OUT', 'balance.outstanding': { $gt: 0 }, 'billing.paidThrough': { $lt: today } },
    [{ $set: { 'delinquency.daysOverdue': { $max: [0, { $subtract: [{ $dateDiff: { startDate: '$billing.paidThrough', endDate: today, unit: 'day' } }, 1] }] } } }],
  );
  // Gồm cả hợp đồng đã đăng ký trả kho nhưng CHƯA bàn giao: vẫn giữ ô, vẫn bị tính tiền thì cũng phải theo luồng nợ như mọi hợp đồng.
  // Nợ lâu nhất xử lý trước; giới hạn mỗi lượt để job không chạy quá lâu, lượt sau (mỗi giờ) làm tiếp phần còn lại.
  const overdue = await RentalContractModel.find({
    $or: [{ status: { $in: ['ACTIVE', 'DELINQUENT'] } }, { status: 'MOVE_OUT_PENDING', 'access.revokedAt': null }],
    'balance.outstanding': { $gt: 0 }, 'billing.paidThrough': { $lt: today },
  }, { _id: 1 }).sort({ 'billing.paidThrough': 1 }).limit(500).lean();
  for (const { _id } of overdue) {
    const notices = await withTxn(async (session) => {
      const pending: PendingNotice[] = [];
      const c = await RentalContractModel.findById(_id).session(session);
      if (!c) return pending;
      const days = Math.max(0, daysBetween(c.billing.paidThrough, today) - 1);
      const policy = await signedPolicy(c.terms.policyId, c.facilityId, session); // phí trễ theo chính sách khách đã ký
      // Đăng ký trả kho mà chưa bàn giao, lại để nợ quá ân hạn (hoặc đã đăng ký lúc đang nợ mà quá ngày hẹn vẫn chưa bàn giao) →
      // tự huỷ đăng ký, hợp đồng về đúng trạng thái nợ trước đó để luồng phí trễ → khoá → thông báo cuối chạy như mọi hợp đồng.
      let cancelledMoveOut: Date | null = null;
      if (c.status === 'MOVE_OUT_PENDING') {
        if (c.access.revokedAt) return pending;
        const missed = !!c.moveOut?.scheduledFor && c.moveOut.scheduledFor < today;
        if (c.delinquency ? !missed : days <= c.terms.gracePeriodDays) {
          if (c.delinquency) { c.delinquency.daysOverdue = days; await c.save({ session }); }
          return pending;
        }
        const before = { scheduledFor: c.moveOut?.scheduledFor ?? null };
        cancelledMoveOut = before.scheduledFor;
        c.transitionTo(statusBeforeMoveOut(c), { actor: 'SYSTEM', reason: `Quá hạn thanh toán ${days} ngày khi chưa bàn giao kho — huỷ đăng ký trả kho` });
        c.moveOut = null;
        await audit({ action: 'contract.move_out_cancel', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: 'Tự động: quá hạn thanh toán khi chưa bàn giao kho', changes: { before } }, session);
      }
      if (c.status === 'ACTIVE' && days > c.terms.gracePeriodDays) {
        const pctRule = policy.lateFees.find((f) => f.kind === 'PERCENT_OF_RENT');
        const fee = pctRule ? Math.round((c.billing.rate * pctRule.value) / 100) : 0;
        if (fee) await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'LATE_FEE', amount: fee, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: `late-${c._id}-${c.billing.paidThrough.toISOString().slice(0, 10)}` }, session);
        c.balance.outstanding += fee;
        c.delinquency = { since: addDays(c.billing.paidThrough, 1), daysOverdue: days, lateFeesAccrued: fee, lockedOutAt: null };
        c.transitionTo('DELINQUENT', { actor: 'SYSTEM', reason: `Quá hạn ${days} ngày` });
        // Điều 7 Điều khoản: hết ân hạn → cảnh báo, kèm ngày sẽ bị khoá nếu chưa thanh toán ("quá N ngày" → ngày N+2 tính từ paidThrough).
        pending.push(addNotice(c, 'GRACE_EXPIRED', {
          amountDue: c.balance.outstanding, deadline: addDays(c.billing.paidThrough, c.terms.lockoutAfterDays + 2),
          note: cancelledMoveOut ? `Đăng ký trả kho ngày ${fmtDate(cancelledMoveOut.toISOString())} đã tự huỷ vì quá hạn thanh toán khi chưa bàn giao kho — thanh toán rồi đăng ký lại, hoặc đến chi nhánh để được hỗ trợ.` : undefined,
        }));
        await audit({ action: 'contract.delinquent', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { days, fee } } }, session);
      } else if (c.delinquency) {
        c.delinquency.daysOverdue = days;
      }
      if (c.status === 'DELINQUENT' && days > c.terms.lockoutAfterDays) { // "quá N ngày" đúng như lời văn hợp đồng
        pending.push(await applyLockout(c, policy, { role: 'SYSTEM', reason: `Tự động theo chính sách — quá hạn ${days} ngày` }, session));
      }
      await c.save({ session });
      return pending;
    }).catch((e) => { console.error('delinquency', _id, e); return [] as PendingNotice[]; });
    await deliverNotices(notices); // email gửi SAU khi transaction đã commit
  }
  if (due.length || overdue.length) console.log(`[job:billing] billed ${due.length}, checked overdue ${overdue.length}`);
}
