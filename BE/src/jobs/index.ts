import { AuditLogModel, FacilityModel, GatewayOrderModel, PaymentModel, RentalContractModel, ReservationModel, StorageUnitModel } from '../shared/db/models';
import { runAsSystem } from '../shared/core/request-context';
import { addDays, addMonthsUTC, daysBetween, localDay, todayUTC } from '../shared/utils/dates';
import { fmtDate, fmtDateTime, LOCKOUT_MIN_NOTICE_DAYS, statusBeforeMoveOut, storageFeeOf, usesGraceHold } from '@ssm/shared';
import { signedPolicy } from '../features/policies/pricing';
import { cancelReservation, noShowDeadlineMs } from '../features/reservations/reservation.service';
import { expireSwapRequests, releaseOpenSwapRequests } from '../features/swaps/unit-swap-request.service';
import { audit } from '../features/audit/audit.service';
import { createPayment } from '../features/payments/payment.service';
import { coveredByPaidRenewal, nextBillingAfter, rentForPeriod } from '../features/contracts/billing-rules';
import { withTxn } from '../shared/db/txn';
import { addNotice, deliverNotices, mailCustomer, type PendingNotice } from '../features/contracts/contract-notice.service';
import { addGraceNotice, applyLockout, lockoutFrom } from '../features/contracts/lockout';
import type { RentalContractHydrated } from '../features/contracts/rental-contract.model';
import type { ClientSession } from 'mongoose';
import { cancelOpenIntakes, expireDeclaredIntakes } from '../features/intake/intake.service';
import { setExpiryOverlock } from '../features/contracts/expiry-rules';
import { env } from '../shared/config/env';
import { reconcileGatewayOrders } from '../features/payments/gateway-settle.service';
import { drainGatewayRefunds } from '../features/payments/gateway-refund.service';

// Đợt 15 (A8): đợt nhập khách khai mà không mang đến — quá hạn thì tự huỷ (định nghĩa ở intake.service, gắn lịch ở đây).
export { expireDeclaredIntakes };

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
    // Điều khoản 1.24: hết hạn chưa gia hạn — báo ân hạn, tới ngày khoá thì khoá + giữ đồ. Chạy 5 giây sau khi khởi động → chạy bù.
    every(60 * 60_000, 'expiry', async () => { await runExpiry(); }),
    every(60 * 60_000, 'swap-expiry', expireSwapRequests),
    every(30 * 60_000, 'no-show', cancelNoShows),
    every(6 * 60 * 60_000, 'expiry-notices', sendExpiryNotices), // idempotent theo (loại, ngày hết hạn) — chạy nhiều lần trong ngày vô hại
    every(6 * 60 * 60_000, 'intake-expiry', async () => { await expireDeclaredIntakes(); }), // chỉ huỷ đợt còn DECLARED — chạy lại vô hại
    every(24 * 60 * 60_000, 'retention', async () => { await applyRetention(); }), // đợt 16 (C9): hằng ngày + lúc khởi động (chạy bù)
    // Đợt VNPAY: đối soát order đang mở + gửi yêu cầu hoàn. Server thức lại thì every() chạy sau 5 giây nên tự chạy bù.
    ...(env.paymentMode === 'VNPAY' && env.VNPAY_JOBS !== 'off' ? [
      every(2 * 60_000, 'gateway-reconcile', async () => { await reconcileGatewayOrders(); }),
      every(60_000, 'gateway-refunds', async () => { await drainGatewayRefunds(); }),
    ] : []),
  ];
  return () => timers.forEach(clearInterval);
}

/**
 * PENDING bookings whose deposit window lapsed → CANCELLED(HOLD_EXPIRED), releasing capacity. Đợt 15 (B2): cancelReservation kiểm lại
 * trong transaction (còn PENDING, đã hết hạn giữ) — khách vừa trả tiền / được thu tại quầy giữa lúc job đọc và lúc huỷ thì bỏ qua.
 * Đợt 15 (C1): đặt chỗ "trả khi nhận kho" (cũ — lựa chọn này đã ngừng nhận đặt mới) chưa trả mà hết ngày nhận → huỷ lý do NO_SHOW (khách
 * không đến nhận kho), không còn tạm khoá tài khoản; vẫn kiểm lại trạng thái trong transaction như B2.
 */
export async function expireHolds() {
  const stale = await ReservationModel.find({ status: 'PENDING', holdExpiresAt: { $lte: new Date() } }, { _id: 1, payOnArrival: 1 }).limit(100).lean();
  let cancelled = 0;
  for (const r of stale) {
    const [reason, note] = r.payOnArrival
      ? ['NO_SHOW', 'Không đến nhận kho trong ngày nhận (trả khi nhận kho)'] as const
      : ['HOLD_EXPIRED', undefined] as const;
    try { if (!(await cancelReservation(null, String(r._id), reason, note)).skipped) cancelled++; } catch (e) { console.error('expire hold', r._id, e); }
  }
  if (cancelled) console.log(`[job:hold-expiry] cancelled ${cancelled}`);
}

/**
 * Khách đã trả tiền giữ chân nhưng KHÔNG đến nhận kho: quá `noShowAfterHours` giờ sau khi hết ngày nhận đã đặt thì hủy
 * đặt chỗ (lý do NO_SHOW — không hoàn tiền, đúng điều khoản hợp đồng) và nhả ô kho cho người khác thuê.
 * Hạn tính từ CUỐI ngày nhận (startDate là 00:00 của ngày đó) để khách đến trong ngày không bao giờ bị hủy oan.
 * Đợt 15: lần đổi gần nhất là "khách đến sớm" (B1) → hạn tính theo ngày nhận TRƯỚC lần đổi đó (noShowDeadlineMs); cancelReservation kiểm
 * lại trạng thái + hạn trong transaction (B2) — khách vừa nhận kho / nhân viên vừa dời ngày thì bỏ qua.
 */
export async function cancelNoShows() {
  const now = Date.now();
  // Lọc thô theo ngày (ít nhất đã qua hết ngày nhận), rồi mới xét hạn chính xác theo chính sách của từng chi nhánh.
  const candidates = await ReservationModel.find({ status: { $in: ['CONFIRMED', 'ALLOCATED'] }, startDate: { $lt: addDays(todayUTC(), 0) } }, { _id: 1, facilityId: 1, startDate: 1, status: 1, 'quote.policyId': 1, scheduleChanges: 1, noShowReminderAt: 1 }).limit(200).lean();
  const hoursByPolicy = new Map<string, number>();
  let cancelled = 0;
  for (const r of candidates) {
    // Số giờ chờ theo chính sách khách đã đặt (in trong hợp đồng), không theo bản mới phát hành sau đó.
    const key = `${String(r.quote?.policyId ?? '')}|${String(r.facilityId)}`;
    if (!hoursByPolicy.has(key)) hoursByPolicy.set(key, (await signedPolicy(r.quote?.policyId, r.facilityId)).noShowAfterHours);
    // Hết ngày nhận = 00:00 giờ chi nhánh của ngày kế tiếp (ngày nhận trước lần "khách đến sớm" nếu có).
    const deadline = noShowDeadlineMs(r, hoursByPolicy.get(key)!);
    if (now < deadline) {
      // Góp ý 18/11: đã hết ngày nhận nhưng còn trong thời gian chờ → nhắc khách một lần (chỉ đặt chỗ đã có ô; CONFIRMED chưa có ô là lỗi phía chi nhánh).
      if (r.status === 'ALLOCATED' && !r.noShowReminderAt) await remindNoShow(String(r._id), deadline);
      continue;
    }
    // Chỉ là "khách không đến" khi đã có ô chờ sẵn. Đặt chỗ còn CONFIRMED (chi nhánh gỡ ô mà chưa phân lại) thì khách có đến cũng
    // không nhận được kho — lỗi phía KhoAn, hoàn 100% (Điều 11).
    const [reason, note] = r.status === 'ALLOCATED'
      ? ['NO_SHOW', 'Khách không đến nhận kho trong thời gian quy định'] as const
      : ['FACILITY_UNAVAILABLE', 'Chi nhánh chưa phân ô kho trước hạn nhận — huỷ và hoàn 100%'] as const;
    try { if (!(await cancelReservation(null, String(r._id), reason, note)).skipped) cancelled++; } catch (e) { console.error('no-show', r._id, e); }
  }
  if (cancelled) console.log(`[job:no-show] cancelled ${cancelled}`);
}

/**
 * Góp ý 18/11 — khách đến giờ nào cũng được trong ngày nhận (bỏ chọn ca khi đặt). Hết ngày nhận mà khách đã trả tiền giữ chân vẫn chưa
 * nhận kho → email nhắc MỘT lần: ô còn giữ tới hạn chót, quá hạn thì đặt chỗ tự huỷ, không hoàn tiền giữ chân. Ghi `noShowReminderAt`
 * bằng lệnh có điều kiện trước khi gửi — hai lượt job chạy chồng (hoặc chạy bù) không gửi hai lần. Lỗi gửi thư không làm hỏng job.
 */
async function remindNoShow(id: string, deadline: number) {
  try {
    const r = await ReservationModel.findOneAndUpdate(
      { _id: id, status: 'ALLOCATED', noShowReminderAt: null },
      { $set: { noShowReminderAt: new Date() } },
      { new: true, projection: { code: 1, customerId: 1, facilityId: 1, unitId: 1, startDate: 1 } },
    ).lean();
    if (!r) return;
    const [facility, unit] = await Promise.all([
      FacilityModel.findById(r.facilityId, { name: 1, contact: 1 }).lean(),
      r.unitId ? StorageUnitModel.findById(r.unitId, { unitNumber: 1 }).lean() : null,
    ]);
    const where = `${unit?.unitNumber ? `ô ${unit.unitNumber}, ` : ''}${facility?.name ?? 'chi nhánh KhoAn'}`;
    await mailCustomer(r.customerId, `KhoAn — Bạn chưa đến nhận kho ${r.code}`, [
      `Ngày nhận kho ${fmtDate(r.startDate.toISOString())} của đặt chỗ ${r.code} (${where}) đã qua nhưng bạn chưa đến nhận.`,
      `Chi nhánh vẫn giữ ô cho bạn đến ${fmtDateTime(new Date(deadline).toISOString())}. Mang giấy tờ đã khai và mã QR nhận kho (trong ứng dụng hoặc trang web KhoAn) đến quầy trước thời điểm này.`,
      `Quá thời điểm trên, đặt chỗ tự huỷ và tiền giữ chân không được hoàn, theo hợp đồng bạn đã ký.${facility?.contact?.phone ? ` Cần hỗ trợ, gọi chi nhánh: ${facility.contact.phone}.` : ''}`,
    ]);
  } catch (e) { console.error('no-show reminder', id, e); }
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
  // Điều khoản 1.24: hợp đồng theo quy tắc hết hạn mới KHÔNG phát sinh tiền thuê sau endDate — không chọn lại hợp đồng đã xuất tới endDate
  // (nếu không, mỗi giờ job chọn lại chúng và có thể chiếm hết giới hạn 500 của lượt). Hợp đồng cũ (không có expiry) giữ nguyên như trước.
  const due = await RentalContractModel.find({
    'billing.nextBillingDate': { $lte: today },
    $and: [
      { $or: [{ status: { $in: ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT'] } }, { status: 'MOVE_OUT_PENDING', 'access.revokedAt': null }] },
      { $or: [{ expiry: null }, { 'expiry.rule': { $ne: 'GRACE_HOLD' } }, { $expr: { $lt: ['$billing.nextBillingDate', '$endDate'] } }] },
    ],
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
        // Điều khoản 1.24: hết thời hạn → không xuất kỳ nào nữa (ân hạn, khoá, phí lưu giữ do runExpiry / quyết toán lo). Hợp đồng cũ vẫn tính tiếp.
        if (usesGraceHold(c) && start.getTime() >= c.endDate.getTime()) break;
        const next = nextBillingAfter(c.startDate, period, start); // theo mốc ngày nhận kho, không trôi về ngày 28
        const end = addDays(next, -1);
        // Kỳ này khách đã trả trước khi gia hạn (RENEWAL — thuê tháng: chỉ tháng đầu của kỳ gia hạn, theo renewals[].prepaidUntil) → không
        // xuất hoá đơn RENT lần nữa, chỉ đẩy lịch sang kỳ sau; các tháng sau của kỳ gia hạn vẫn xuất bình thường ở nhánh dưới.
        if (coveredByPaidRenewal(c.renewals, start)) {
          c.billing.rate = rentForPeriod(c, start); // đã sang kỳ cam kết mới — màn hình hiện đúng giá đang áp dụng
          c.billing.nextBillingDate = next;
          // Đợt 15 (B3): cả khi đã đăng ký trả kho mà chưa bàn giao (MOVE_OUT_PENDING) — tháng đó khách đã trả, không được tính là nợ.
          if (c.balance.outstanding <= 0 && (c.status === 'ACTIVE' || c.status === 'MOVE_OUT_PENDING')) c.billing.paidThrough = end;
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
        const back = statusBeforeMoveOut(c);
        c.transitionTo(back, { actor: 'SYSTEM', reason: `Quá hạn thanh toán ${days} ngày khi chưa bàn giao kho — huỷ đăng ký trả kho` });
        c.moveOut = null;
        // Điều khoản 1.24: đăng ký lấy đồ tại quầy của hợp đồng hết hạn đã khoá bị huỷ → gắn lại khoá chặn ô.
        if (back === 'EXPIRED') await setExpiryOverlock(c.unitId, true, session);
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
  // Đã khoá mà vẫn nợ: không còn bước chuyển trạng thái nào — số ngày quá hạn tiếp tục tăng (báo cáo tuổi nợ, danh sách quá hạn) và phí
  // trễ lặp lại theo chu kỳ của chính sách đã ký (phí % và phí cố định lặp lại). Đợt 15 (B3): số ngày tính như nhánh ACTIVE / DELINQUENT —
  // từ max(ngày đến hạn, ngày hoá đơn thật sự được xuất) (overdueFrom) — kỳ xuất muộn do chạy bù không sinh thêm chu kỳ phí trễ ảo.
  // Điều khoản 1.24: hợp đồng HẾT HẠN đã khoá (EXPIRED) mà còn nợ trong thời hạn — đợt nợ giữ nguyên, tuổi nợ và phí trễ lặp lại như LOCKED_OUT.
  const locked = await RentalContractModel.find({ status: { $in: ['LOCKED_OUT', 'EXPIRED'] }, delinquency: { $ne: null }, 'balance.outstanding': { $gt: 0 }, 'billing.paidThrough': { $lt: today } }, { _id: 1 }).limit(500).lean();
  for (const { _id } of locked) {
    await withTxn(async (session) => {
      const c = await RentalContractModel.findById(_id).session(session);
      if (!c || (c.status !== 'LOCKED_OUT' && c.status !== 'EXPIRED') || !c.delinquency) return;
      const days = Math.max(0, daysBetween(await overdueFrom(c, session), today));
      let changed = c.delinquency.daysOverdue !== days;
      c.delinquency.daysOverdue = days;
      const policy = await signedPolicy(c.terms.policyId, c.facilityId, session);
      if (policy.lateFees.some((f) => f.recurringEveryDays) && await accrueLateFees(c, policy, days, session)) changed = true;
      if (changed) await c.save({ session });
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
    // Phí cố định chỉ áp khi đã khoá VÌ NỢ (lần đầu do applyLockout thu) — kể cả khi sau đó hợp đồng bị khoá do hết hạn (EXPIRED, đợt nợ đã khoá).
    if (fixed && !(c.status === 'LOCKED_OUT' || (c.status === 'EXPIRED' && !!c.delinquency?.lockedOutAt))) continue;
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

/**
 * Điều khoản 1.24 — HẾT HẠN mà chưa gia hạn / bàn giao (chỉ hợp đồng có `expiry`, rule GRACE_HOLD). Mỗi lượt (mỗi giờ, chạy bù khi khởi động):
 *  1. lần đầu thấy hợp đồng đã qua endDate → ghi thông báo EXPIRY_GRACE (một lần cho MỘT endDate) với ngày khoá `lockFrom` = max(endDate + ân
 *     hạn, hôm nay + LOCKOUT_MIN_NOTICE_DAYS) — chạy bù sau khi server ngủ, khách vẫn có ít nhất 3 ngày; KHÔNG khoá trong cùng lượt;
 *  2. tới ngày khoá mà chưa gia hạn / bàn giao → EXPIRED: khoá quyền ra vào + khoá chặn ô, giữ đồ `holdDays` ngày (holdUntil), huỷ đăng ký
 *     trả kho chưa bàn giao, nhả yêu cầu đổi ô / đợt nhập còn mở, ghi thông báo EXPIRY_LOCKED (thông báo cuối). Khách đang trả tiền gia hạn
 *     qua cổng (lệnh EXTEND đang chờ) → hoãn sang lượt sau.
 * Đọc lại hợp đồng trong transaction (gia hạn chen giữa đổi endDate → bỏ qua); khoá lạc quan của hợp đồng chặn ghi đè. Email gửi sau commit.
 */
const EXPIRY_OPEN = ['ACTIVE', 'DELINQUENT', 'LOCKED_OUT', 'MOVE_OUT_PENDING'] as const;
export async function runExpiry() {
  const today = todayUTC();
  // Bỏ ngay ở truy vấn: đã bàn giao (chờ quyết toán) và đang lấy đồ tại quầy sau khi khoá — không chiếm giới hạn 500 của lượt.
  const candidates = await RentalContractModel.find({
    'expiry.rule': 'GRACE_HOLD', 'expiry.lockedAt': null, 'access.revokedAt': null, status: { $in: [...EXPIRY_OPEN] }, endDate: { $lte: today },
  }, { _id: 1 }).sort({ endDate: 1 }).limit(500).lean();
  let graced = 0;
  let locked = 0;
  for (const { _id } of candidates) {
    const pending = await withTxn(async (session) => {
      const out: PendingNotice[] = [];
      const c = await RentalContractModel.findById(_id).session(session);
      if (!c || !c.expiry || !usesGraceHold(c) || !(EXPIRY_OPEN as readonly string[]).includes(c.status) || c.endDate > today) return out;
      if (c.status === 'MOVE_OUT_PENDING' && c.access.revokedAt) return out; // đã bàn giao — chờ quyết toán, phí lưu giữ dừng ở ngày bàn giao
      if (c.expiry.lockedAt) return out; // đang lấy đồ tại quầy sau khi đã khoá (đăng ký từ EXPIRED)
      const end = c.endDate.getTime();
      if (!(c.notices ?? []).some((n) => n.kind === 'EXPIRY_GRACE' && n.endDate?.getTime() === end)) {
        const byRule = addDays(c.endDate, c.expiry.graceDays);
        const minDay = addDays(today, LOCKOUT_MIN_NOTICE_DAYS);
        const lockFrom = minDay > byRule ? minDay : byRule;
        c.set('expiry.lockFrom', lockFrom);
        out.push(addNotice(c, 'EXPIRY_GRACE', { amountDue: c.balance.outstanding, deadline: lockFrom, endDate: c.endDate }));
        await c.save({ session });
        await audit({ action: 'contract.expiry_grace', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, changes: { after: { endDate: c.endDate, lockFrom, graceDays: c.expiry.graceDays, dailyFee: c.expiry.dailyFee } } }, session);
        graced++;
        return out; // không khoá trong cùng lượt vừa báo
      }
      const lockFrom = c.expiry.lockFrom ?? addDays(c.endDate, c.expiry.graceDays);
      if (today < lockFrom) return out;
      // Khách đang trả tiền gia hạn qua cổng → chờ kết quả (lượt sau khoá nếu không gia hạn được).
      if (await GatewayOrderModel.exists({ targetKey: `EXTEND:${c._id}`, status: 'PENDING' }).session(session)) return out;
      let note: string | undefined;
      if (c.status === 'MOVE_OUT_PENDING') {
        const before = { scheduledFor: c.moveOut?.scheduledFor ?? null };
        c.moveOut = null;
        note = `Đăng ký trả kho${before.scheduledFor ? ` hẹn ngày ${fmtDate(before.scheduledFor.toISOString())}` : ''} đã tự huỷ vì chưa bàn giao kho trước ngày khoá — đến quầy chi nhánh để lấy đồ và làm thủ tục trả kho.`;
        await audit({ action: 'contract.expiry_move_out_cancel', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: 'Tự động: tới ngày khoá do hết hạn mà chưa bàn giao kho', changes: { before } }, session);
      }
      const now = new Date();
      const holdUntil = addDays(today, c.expiry.holdDays);
      c.set('expiry.lockFrom', lockFrom);
      c.set('expiry.lockedAt', now);
      c.set('expiry.holdUntil', holdUntil);
      c.transitionTo('EXPIRED', { actor: 'SYSTEM', reason: 'Hết hạn, quá ân hạn chưa gia hạn / bàn giao' });
      c.access.suspendedAt = now;
      await setExpiryOverlock(c.unitId, true, session);
      await releaseOpenSwapRequests(c._id, session, 'Hợp đồng hết hạn — đã khoá');
      await cancelOpenIntakes(c._id, 'Hợp đồng hết hạn — đã khoá, đợt nhập chưa xác nhận tự huỷ', session);
      const feeSoFar = storageFeeOf(c, today).amount;
      out.push(addNotice(c, 'EXPIRY_LOCKED', { amountDue: c.balance.outstanding, deadline: holdUntil, endDate: c.endDate, note }));
      await c.save({ session });
      await audit({ action: 'contract.expiry_lock', entityType: 'RentalContract', entityId: c._id, facilityId: c.facilityId, reason: 'Hết hạn, quá ân hạn chưa gia hạn / bàn giao', changes: { after: { lockFrom, holdUntil, dailyFee: c.expiry.dailyFee, feeSoFar, moveOutCancelled: !!note } } }, session);
      locked++;
      return out;
    }).catch((e) => { console.error('expiry', _id, e); return [] as PendingNotice[]; });
    if (pending.length) await deliverNotices(pending); // email gửi SAU khi transaction đã commit
  }
  if (graced || locked) console.log(`[job:expiry] grace notices ${graced}, locked ${locked}`);
  return { graced, locked };
}

/**
 * Kỳ cam kết đang chứa ngày hết hạn (B8): kỳ trong `commitments` kết thúc đúng endDate (kỳ gốc hoặc lần gia hạn cuối); dữ liệu cũ chưa có
 * `commitments` (hoặc không khớp) thì lần gia hạn kết thúc đúng endDate (`renewals`), không có thì cả hợp đồng.
 */
function commitmentSpanOf(c: Pick<RentalContractHydrated, 'startDate' | 'endDate' | 'commitments' | 'renewals'>): [Date, Date] {
  const end = c.endDate.getTime();
  const seg = (c.commitments ?? []).find((s) => s.endDate.getTime() === end);
  if (seg) return [seg.startDate, c.endDate];
  const rn = [...(c.renewals ?? [])].reverse().find((x) => x.newEndDate.getTime() === end);
  return rn ? [rn.previousEndDate, c.endDate] : [c.startDate, c.endDate];
}

/**
 * Số ngày trước ngày hết hạn gửi nhắc, xét mốc đầu khớp theo đúng thứ tự này: thời hạn ≥ 2 tháng nhắc trước 30 và 7 ngày; từ 14 ngày đến dưới 2 tháng
 * trước 7 ngày; từ 4 đến dưới 14 ngày trước 2 ngày (đợt 17 B1); dưới 4 ngày không nhắc riêng. Mốc 7 xét trước mốc 2: thuê 1 tháng khi còn 2 ngày vẫn
 * khớp mốc 7 (đã gửi) nên không nhắc thêm.
 */
const EXPIRY_WINDOWS = [{ kind: 'EXPIRY_7', days: 7 }, { kind: 'EXPIRY_2', days: 2 }, { kind: 'EXPIRY_30', days: 30 }] as const;

/**
 * NHẮC HẾT HẠN hợp đồng (F1): hợp đồng đang hiệu lực (ACTIVE, hoặc đang nợ nhưng CHƯA bị khoá) còn ≤ 30 / ≤ 7 / ≤ 2 ngày là hết hạn →
 * ghi thông báo EXPIRY_30 / EXPIRY_7 / EXPIRY_2 (hiện trong tài khoản) và gửi email theo quy tắc gửi thông báo. Mỗi mốc gửi một lần cho MỘT ngày
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
      // thuê từ 4 đến dưới 14 ngày nhắc trước 2 ngày, thuê 1 tháng chỉ nhắc trước 7 ngày, thuê từ 2 tháng mới nhắc cả trước 30 ngày. Đợt 15 (B8): "thời hạn" là KỲ CAM KẾT đang chứa
      // endDate (lần gia hạn cuối nếu có) — gia hạn 1 tháng thì chỉ nhắc trước 7 ngày, không tính cả thời gian đã thuê trước đó.
      const span = daysBetween(...commitmentSpanOf(c));
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

/**
 * Đợt 16 (C9): THỜI HẠN LƯU theo Chính sách bảo mật mục 4 — job hằng ngày (chạy cả lúc khởi động, nên server ngủ / deploy bao lâu thì lượt
 * sau vẫn xử lý đủ mọi bản ghi đã quá hạn — chạy bù theo ngưỡng thời gian, chạy lại vô hại):
 *  - nhật ký ra vào (các lần mở kho hộ `contract.access.assistedOpens`) quá RETENTION.accessLogMonths tháng → xoá;
 *  - nhật ký kiểm toán quá RETENTION.auditMonths tháng → ẩn danh: bỏ người thao tác, IP, trình duyệt, mã yêu cầu, nội dung thay đổi, lý do;
 *    giữ hành động, thời điểm, kết quả, vai trò, mã đối tượng, chi nhánh. Ghi thẳng collection (đi vòng plugin chỉ-ghi-thêm có chủ đích —
 *    đây là việc lưu trữ của hệ thống, không phải sửa nội dung nhật ký).
 */
export const RETENTION = { accessLogMonths: 12, auditMonths: 24, gatewayOrderDays: 7 } as const;
export async function applyRetention(now = new Date()) {
  const accessCutoff = addMonthsUTC(now, -RETENTION.accessLogMonths);
  const auditCutoff = addMonthsUTC(now, -RETENTION.auditMonths);
  const opens = await RentalContractModel.updateMany(
    { 'access.assistedOpens.at': { $lt: accessCutoff } },
    { $pull: { 'access.assistedOpens': { at: { $lt: accessCutoff } } } },
  );
  const audits = await AuditLogModel.collection.updateMany(
    { at: { $lt: auditCutoff }, anonymizedAt: { $exists: false } },
    { $set: { actorId: null, changes: null, reason: null, anonymizedAt: now }, $unset: { ip: '', userAgent: '', requestId: '' } },
  );
  // Đợt VNPAY: order đã kết thúc quá 7 ngày — bỏ tham số thanh toán và IP khách, giữ phần còn lại làm chứng từ.
  const gatewayCutoff = new Date(now.getTime() - RETENTION.gatewayOrderDays * 86_400_000);
  const gateway = await GatewayOrderModel.updateMany(
    { status: { $ne: 'PENDING' }, updatedAt: { $lt: gatewayCutoff }, $or: [{ payload: { $ne: null } }, { payUrl: { $ne: null } }, { clientIp: { $ne: null } }] },
    { $set: { payload: null, payUrl: null, clientIp: null } },
    { timestamps: false },
  );
  const result = { contractsPruned: opens.modifiedCount, auditAnonymized: audits.modifiedCount, gatewayOrdersPurged: gateway.modifiedCount, accessCutoff, auditCutoff };
  if (result.contractsPruned || result.auditAnonymized || result.gatewayOrdersPurged) {
    await audit({ action: 'system.retention', changes: { after: result } });
    console.log(`[job:retention] mở kho hộ: ${result.contractsPruned} hợp đồng; nhật ký ẩn danh: ${result.auditAnonymized}`);
  }
  return result;
}
