import { PaymentModel, RentalContractModel, ReservationModel, StorageUnitModel } from '../shared/db/models';
import { runAsSystem } from '../shared/core/request-context';
import { addDays, daysBetween, localDay, todayUTC } from '../shared/utils/dates';
import { fmtDate, localMidnightMs, statusBeforeMoveOut } from '@ssm/shared';
import { signedPolicy } from '../features/policies/pricing';
import { cancelReservation } from '../features/reservations/reservation.service';
import { expireSwapRequests } from '../features/swaps/unit-swap-request.service';
import { audit } from '../features/audit/audit.service';
import { createPayment } from '../features/payments/payment.service';
import { coveredByPaidRenewal, nextBillingAfter, rentForPeriod } from '../features/contracts/billing-rules';
import { withTxn } from '../shared/db/txn';
import { addNotice, deliverNotices, type PendingNotice } from '../features/contracts/contract-notice.service';
import { addGraceNotice, applyLockout, lockoutFrom } from '../features/contracts/lockout';
import type { RentalContractHydrated } from '../features/contracts/rental-contract.model';
import type { ClientSession } from 'mongoose';

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
    every(6 * 60 * 60_000, 'expiry-notices', sendExpiryNotices), // idempotent theo (loại, ngày hết hạn) — chạy nhiều lần trong ngày vô hại
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

/** Trần số kỳ xuất cho MỘT hợp đồng trong một lượt chạy (chạy bù sau khi server ngủ lâu) — lượt sau làm tiếp phần còn lại. */
const MAX_PERIODS_PER_RUN = 36;

/**
 * Ngày BẮT ĐẦU tính quá hạn của đợt nợ hiện tại (D): kỳ chưa trả đầu tiên đến hạn ngày paidThrough + 1, nhưng nếu hoá đơn của kỳ đó
 * được xuất MUỘN (server ngủ / deploy — job chạy bù) thì khách được đủ ân hạn kể từ NGÀY XUẤT (createdAt của khoản RENT, theo ngày
 * VN): quá hạn tính từ max(ngày đến hạn, ngày xuất hoá đơn).
 */
export async function overdueFrom(c: Pick<RentalContractHydrated, '_id' | 'billing'>, session?: ClientSession): Promise<Date> {
  const due = addDays(c.billing.paidThrough, 1);
  const rent = await PaymentModel.findOne(
    { contractId: c._id, type: 'RENT', status: { $in: ['PENDING', 'FAILED'] }, 'period.start': { $gte: due } },
    { createdAt: 1 },
  ).sort({ 'period.start': 1 }).session(session ?? null).lean();
  const issued = rent?.createdAt ? localDay(rent.createdAt) : null;
  return issued && issued > due ? issued : due;
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
      // CHẠY BÙ (D): server ngủ / deploy lỡ nhiều kỳ → một lượt xuất ĐỦ các kỳ còn thiếu (tới khi nextBillingDate > hôm nay, trần
      // MAX_PERIODS_PER_RUN kỳ), mỗi kỳ vẫn idempotent theo ngày bắt đầu kỳ. Chỉ xuất một kỳ mỗi lượt thì khách trả hết nợ sau lượt
      // đó sẽ lại bị quá hạn ngay vì các kỳ cũ chưa xuất.
      for (let i = 0; i < MAX_PERIODS_PER_RUN && c.billing.nextBillingDate <= today; i++) {
        const start = c.billing.nextBillingDate;
        const period = c.billing.rentalPeriod;
        const next = nextBillingAfter(c.startDate, period, start); // theo mốc ngày nhận kho, không trôi về ngày 28
        const end = addDays(next, -1);
        // Kỳ này khách đã trả trước khi gia hạn (RENEWAL — thuê tháng: chỉ tháng đầu của kỳ gia hạn, theo renewals[].prepaidUntil) → không
        // xuất hoá đơn RENT lần nữa, chỉ đẩy lịch sang kỳ sau; các tháng sau của kỳ gia hạn vẫn xuất bình thường ở nhánh dưới.
        if (coveredByPaidRenewal(c.renewals, start)) {
          c.billing.rate = rentForPeriod(c, start); // đã sang kỳ cam kết mới — màn hình hiện đúng giá đang áp dụng
          c.billing.nextBillingDate = next;
          if (c.balance.outstanding <= 0 && c.status === 'ACTIVE') c.billing.paidThrough = end;
          continue;
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
      }
      await c.save({ session });
    }).catch((e) => console.error('billing', _id, e));
  }

  // Đã khoá (LOCKED_OUT): không còn bước chuyển trạng thái nào ở đây, chỉ cần số ngày quá hạn tiếp tục tăng (báo cáo tuổi nợ, danh sách
  // quá hạn) — cập nhật một lượt bằng phép tính ngày, KHÔNG chiếm chỗ trong vòng xử lý từng hợp đồng bên dưới.
  await RentalContractModel.collection.updateMany(
    { status: 'LOCKED_OUT', 'balance.outstanding': { $gt: 0 }, 'billing.paidThrough': { $lt: today } },
    [{ $set: { 'delinquency.daysOverdue': { $max: [0, { $subtract: [{ $dateDiff: { startDate: '$billing.paidThrough', endDate: today, unit: 'day' } }, 1] }] } } }],
  ).catch((e) => console.error('locked-out days', e)); // lỗi ở đây không được chặn vòng xử lý nợ bên dưới
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
      // Quá hạn tính từ max(ngày đến hạn, ngày hoá đơn thật sự được xuất) — kỳ xuất muộn do chạy bù vẫn được đủ ân hạn (D).
      const from = await overdueFrom(c, session);
      const days = Math.max(0, daysBetween(from, today));
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
      let justDelinquent = false;
      if (c.status === 'ACTIVE' && days > c.terms.gracePeriodDays) {
        justDelinquent = true;
        c.delinquency = { since: addDays(c.billing.paidThrough, 1), daysOverdue: days, lateFeesAccrued: 0, lockedOutAt: null };
        c.transitionTo('DELINQUENT', { actor: 'SYSTEM', reason: `Quá hạn ${days} ngày` });
        const fee = await accrueLateFees(c, policy, days, session);
        // Điều 7 Điều khoản: hết ân hạn → cảnh báo, kèm ngày sẽ bị khoá nếu chưa thanh toán ("quá N ngày" → ngày thứ N+1 kể từ ngày bắt
        // đầu quá hạn). Ngày khoá luôn ở TƯƠNG LAI, cách hôm nay ít nhất LOCKOUT_MIN_NOTICE_DAYS ngày (addGraceNotice) — chạy bù sau khi
        // server ngủ cũng không khoá ngay khi khách vừa được báo.
        pending.push(addGraceNotice(c, from, today,
          cancelledMoveOut ? `Đăng ký trả kho ngày ${fmtDate(cancelledMoveOut.toISOString())} đã tự huỷ vì quá hạn thanh toán khi chưa bàn giao kho — thanh toán rồi đăng ký lại, hoặc đến chi nhánh để được hỗ trợ.` : undefined));
        await audit({ action: 'contract.delinquent', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { days, fee } } }, session);
      } else if (c.delinquency) {
        c.delinquency.daysOverdue = days;
        await accrueLateFees(c, policy, days, session); // phí trễ lặp lại theo chu kỳ (recurringEveryDays) khi vẫn còn nợ
      }
      // "quá N ngày" đúng như lời văn hợp đồng — nhưng KHÔNG khoá trong cùng lượt vừa chuyển DELINQUENT, và chỉ từ ngày khoá đã ghi
      // trong thông báo hết ân hạn gửi khách (delinquency.lockFrom, ≥ ngày báo + LOCKOUT_MIN_NOTICE_DAYS).
      if (c.status === 'DELINQUENT' && !justDelinquent && days > c.terms.lockoutAfterDays) {
        const lockDay = lockoutFrom(c);
        if (!lockDay) {
          // Đợt nợ chưa được báo ngày khoá (dữ liệu cũ): báo trước, khoá ở lượt sau khi tới ngày đó.
          pending.push(addGraceNotice(c, from, today));
        } else if (today >= lockDay) {
          pending.push(await applyLockout(c, policy, { role: 'SYSTEM', reason: `Tự động theo chính sách — quá hạn ${days} ngày` }, session));
        }
      }
      await c.save({ session });
      return pending;
    }).catch((e) => { console.error('delinquency', _id, e); return [] as PendingNotice[]; });
    await deliverNotices(notices); // email gửi SAU khi transaction đã commit
  }
  // Đã khoá mà vẫn nợ: chỉ còn phí trễ lặp lại theo chu kỳ của chính sách đã ký (phí % và phí cố định lặp lại).
  const locked = await RentalContractModel.find({ status: 'LOCKED_OUT', 'balance.outstanding': { $gt: 0 }, 'billing.paidThrough': { $lt: today } }, { _id: 1 }).limit(500).lean();
  for (const { _id } of locked) {
    await withTxn(async (session) => {
      const c = await RentalContractModel.findById(_id).session(session);
      if (!c || c.status !== 'LOCKED_OUT' || !c.delinquency) return;
      const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
      if (!policy.lateFees.some((f) => f.recurringEveryDays)) return;
      const days = Math.max(0, daysBetween(c.billing.paidThrough, today) - 1);
      if (await accrueLateFees(c, policy, days, session)) await c.save({ session });
    }).catch((e) => console.error('late-fee recurring', _id, e));
  }
  if (due.length || overdue.length) console.log(`[job:billing] billed ${due.length}, checked overdue ${overdue.length}`);
}

type LateFeeRule = { afterDays: number; kind: string; value: number; recurringEveryDays?: number | null };
/**
 * Phí trễ hạn theo ĐÚNG cấu hình `lateFees` của chính sách khách đã ký (J). Mỗi dòng phí:
 *  - phí % tiền thuê: thu lần đầu khi quá hạn hơn `afterDays` ngày (không sớm hơn hết ân hạn), rồi lặp lại mỗi `recurringEveryDays`
 *    ngày nếu vẫn còn nợ;
 *  - phí cố định: lần đầu là PHÍ KHOÁ thu lúc khoá truy cập (applyLockout — giữ như cũ), rồi lặp lại mỗi `recurringEveryDays` ngày khi
 *    vẫn đang bị khoá.
 * Mỗi lần thu có idempotencyKey theo đợt nợ (paidThrough) + chu kỳ — job chạy lại bao nhiêu lần cũng không thu trùng; khoản đã miễn
 * (CANCELLED) cũng không bị thu lại. Trả về tổng phí vừa cộng thêm. Gọi trong transaction, người gọi tự save hợp đồng.
 */
async function accrueLateFees(
  c: RentalContractHydrated,
  policy: { lateFees: LateFeeRule[] },
  days: number,
  session: ClientSession,
) {
  // Mốc của ĐỢT NỢ (ngày cuối đã trả trước khi quá hạn = delinquency.since − 1): không đổi trong suốt đợt nợ, trùng với khoá cũ
  // `late-<hợp đồng>-<paidThrough>` của lần thu đầu trước đây → phí đã thu trước khi đổi cách tính không bị thu lại.
  const pt = (c.delinquency?.since ? addDays(c.delinquency.since, -1) : c.billing.paidThrough).toISOString().slice(0, 10);
  let added = 0;
  for (const rule of policy.lateFees) {
    if (!rule.value) continue;
    const fixed = rule.kind === 'FIXED';
    if (fixed && c.status !== 'LOCKED_OUT') continue; // phí cố định chỉ áp khi đã khoá (lần đầu do applyLockout thu)
    const threshold = fixed ? rule.afterDays : Math.max(rule.afterDays, c.terms.gracePeriodDays);
    if (days <= threshold) continue;
    const every = rule.recurringEveryDays ?? 0;
    const lastCycle = every > 0 ? Math.floor((days - threshold - 1) / every) : 0;
    const base = fixed ? `lock-${c._id}-${pt}` : `late-${c._id}-${pt}`; // chu kỳ 0 giữ khoá cũ — dữ liệu đã thu trước đây không bị thu lại
    for (let k = fixed ? 1 : 0; k <= lastCycle; k++) {
      const key = k === 0 ? base : `${base}-${k}`;
      if (await PaymentModel.exists({ idempotencyKey: key }).session(session)) continue;
      const amount = fixed ? rule.value : Math.round((c.billing.rate * rule.value) / 100);
      if (amount <= 0) continue;
      await createPayment({ facilityId: c.facilityId, customerId: c.customerId, contractId: c._id, type: 'LATE_FEE', amount, status: 'PENDING', method: 'BANK_TRANSFER', idempotencyKey: key }, session);
      added += amount;
    }
  }
  if (added) {
    c.balance.outstanding += added;
    if (c.delinquency) c.delinquency.lateFeesAccrued += added;
  }
  return added;
}

/** Số ngày trước ngày hết hạn gửi nhắc: EXPIRY_30 khi còn ≤ 30 ngày, EXPIRY_7 khi còn ≤ 7 ngày. */
const EXPIRY_WINDOWS = [{ kind: 'EXPIRY_7', days: 7 }, { kind: 'EXPIRY_30', days: 30 }] as const;

/**
 * NHẮC HẾT HẠN hợp đồng (F1): hợp đồng đang hiệu lực (ACTIVE, hoặc đang nợ nhưng CHƯA bị khoá) còn ≤ 30 ngày / ≤ 7 ngày là hết hạn →
 * ghi thông báo EXPIRY_30 / EXPIRY_7 (hiện trong tài khoản) và gửi email theo quy tắc gửi thông báo. Mỗi mốc gửi một lần cho MỘT ngày
 * hết hạn (khoá chống trùng: loại + endDate) — gia hạn đổi endDate thì nhắc lại cho mốc mới. Job lỡ một ngày vẫn nhắc ở lần chạy sau.
 */
export async function sendExpiryNotices() {
  const today = todayUTC();
  const candidates = await RentalContractModel.find({
    status: { $in: ['ACTIVE', 'DELINQUENT'] }, endDate: { $gt: today, $lte: addDays(today, 30) },
  }, { _id: 1 }).limit(1000).lean();
  let sent = 0;
  for (const { _id } of candidates) {
    const pending = await withTxn(async (session) => {
      const c = await RentalContractModel.findById(_id).session(session);
      if (!c || !['ACTIVE', 'DELINQUENT'].includes(c.status)) return [] as PendingNotice[];
      const left = daysBetween(today, c.endDate);
      // Chỉ nhắc khi thời hạn thuê dài ít nhất gấp đôi khoảng nhắc: thuê 7 ngày không bị nhắc "sắp hết hạn" ngay lúc vừa nhận kho,
      // thuê 1 tháng chỉ nhắc trước 7 ngày, thuê từ 2 tháng mới nhắc cả trước 30 ngày.
      const span = daysBetween(c.startDate, c.endDate);
      const w = EXPIRY_WINDOWS.find((x) => left > 0 && left <= x.days && span >= x.days * 2);
      if (!w) return [] as PendingNotice[];
      const end = c.endDate.getTime();
      if ((c.notices ?? []).some((n) => n.kind === w.kind && n.endDate?.getTime() === end)) return [] as PendingNotice[];
      const notice = addNotice(c, w.kind, { amountDue: c.balance.outstanding, deadline: c.endDate, endDate: c.endDate });
      await c.save({ session });
      await audit({ action: 'contract.expiry_notice', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { kind: w.kind, endDate: c.endDate, daysLeft: left } } }, session);
      return [notice];
    }).catch((e) => { console.error('expiry-notice', _id, e); return [] as PendingNotice[]; });
    if (pending.length) { sent++; await deliverNotices(pending); }
  }
  if (sent) console.log(`[job:expiry-notices] sent ${sent}`);
}
