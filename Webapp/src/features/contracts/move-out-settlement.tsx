'use client';

import { CircleCheck, ImageIcon, Package, TriangleAlert } from 'lucide-react';
import {
  contractClawback, DAMAGE_SEVERITY_LABEL, MOVE_OUT_STAGE, moveOutStageOf, storageFeeOf, unusedRenewalRefunds,
  type InspectionLog, type MoveOutSettlementPreview, type RentalContract,
} from '@ssm/shared';
import type { DB } from '@/shared/lib/mock-data';
import { byId, earlyTerminationCap, settlementDateOf } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Badge } from '@/shared/ui';
import { PhotoLinks } from '@/shared/ui/photo-links';
import { Ledger, LedgerRow } from '@/features/staff-ui';

/** Biên bản trả kho (MOVE_OUT) của hợp đồng — mỗi hợp đồng tối đa một bản. */
export const moveOutReportOf = (db: DB, contractId: string) => db.inspections.find((i) => i.contractId === contractId && i.type === 'MOVE_OUT');

/** Bước hiện tại của lượt trả kho đang mở (null nếu hợp đồng không đang trả kho) + nhãn cho nhân viên / quản lý. */
export function moveOutStage(db: DB, c: RentalContract) {
  const stage = moveOutStageOf(c, moveOutReportOf(db, c._id));
  return stage ? { stage, ...MOVE_OUT_STAGE[stage] } : null;
}

/**
 * Quyết toán ƯỚC TÍNH theo phí đang nhập (quản lý xem trước khi bấm duyệt) — cùng công thức với server (shared: trần hoàn khi trả sớm, thu
 * hồi ưu đãi, tiền thuê gia hạn chưa dùng, tiền dịch vụ / phí cấp lại đã huỷ). Số chốt là số server tính lúc duyệt (review.settlementPreview).
 */
export function estimateMoveOutSettlement(db: DB, c: RentalContract, damageFee: number): MoveOutSettlementPreview {
  const earlyTermination = earlyTerminationCap(db, c);
  // Điều khoản 1.24: phí lưu giữ từ ngày hết hạn tới hết ngày bàn giao — trừ như công nợ (settleDeposit ở server).
  const storage = storageFeeOf(c, settlementDateOf(c));
  const owed = damageFee + storage.amount + c.balance.outstanding;
  const normalRefund = c.deposit.amount - Math.min(c.deposit.amount, owed);
  const rawShortfall = Math.max(0, owed - c.deposit.amount);
  // Tiền thuê khách trả trước khi gia hạn cho các kỳ chưa bắt đầu (phần RENEWAL còn lại + phần SIZE_CHANGE) — cấn phần thiếu trước, còn lại hoàn.
  const unusedRent = unusedRenewalRefunds({
    period: c.billing.rentalPeriod, contract: c, returnedOn: settlementDateOf(c),
    renewals: c.renewals.flatMap((x) => {
      const p = x.paymentId ? db.payments.find((y) => y._id === x.paymentId && ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(y.status)) : undefined;
      return p ? [{ key: p._id, previousEndDate: x.previousEndDate, periods: x.periods, amount: p.amount, refundedAmount: p.refundedAmount ?? 0, prepaidUntil: x.prepaidUntil ?? null }] : [];
    }),
    sizeCharges: db.payments.filter((p) => p.contractId === c._id && p.type === 'SIZE_CHANGE' && ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'PENDING'].includes(p.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ key: p._id, amount: p.amount, refundedAmount: p.refundedAmount ?? 0 })),
  }).total;
  // Đợt 16 (C4): tiền đơn dịch vụ / phí cấp lại bị huỷ lúc nhận lại ô — hoàn trong quyết toán, cùng thứ tự cấn trừ (sau tiền gia hạn).
  const credits = [...db.serviceOrders.filter((o) => o.contractId === c._id).map((o) => ({ o, due: o.total })), ...db.accessRequests.filter((o) => o.contractId === c._id).map((o) => ({ o, due: o.fee }))]
    .filter(({ o }) => o.status === 'CANCELLED' && o.refundAtSettlement && !o.refundPaymentId && o.paymentId).reduce((sum, x) => sum + x.due, 0);
  const rentOffset = Math.min(unusedRent, rawShortfall);
  const creditOffset = Math.min(credits, rawShortfall - rentOffset);
  const shortfall = rawShortfall - rentOffset - creditOffset;
  const cappedRefund = earlyTermination ? Math.min(normalRefund, Math.round((c.deposit.amount * earlyTermination.refundCapPct) / 100)) : normalRefund;
  const rsv = byId(db.reservations, c.reservationId);
  const claw = c.moveOut ? contractClawback(c, rsv?.quote, db.policies, settlementDateOf(c)) : null;
  const clawback = claw ? Math.min(cappedRefund, claw.amount) : 0;
  const refundAmount = cappedRefund - clawback;
  return {
    depositHeld: c.deposit.amount, damageFee, priorOutstanding: c.balance.outstanding, deductions: c.deposit.amount - refundAmount, refundAmount, shortfall,
    prepaidRentRefund: unusedRent - rentOffset, prepaidRentOffset: rentOffset, creditRefund: credits - creditOffset, creditOffset,
    earlyTermination: earlyTermination ? { ...earlyTermination, ...(claw ? { discountClawback: clawback, usedPeriods: claw.usedPeriods } : {}) } : null,
    storageFee: storage.amount, storageDays: storage.days,
  };
}

/** Tổng khách được hoàn: tiền giữ chân + tiền thuê trả trước chưa dùng + tiền dịch vụ / phí cấp lại đã huỷ (phần không cấn nợ). */
export const settlementRefundTotal = (p: MoveOutSettlementPreview) => p.refundAmount + p.prepaidRentRefund + p.creditRefund;

/** Bảng quyết toán của biên bản trả kho (xem trước lúc duyệt, hoặc ước tính khi quản lý đang nhập phí). */
export function SettlementLedger({ p, estimate }: { p: MoveOutSettlementPreview; estimate?: boolean }) {
  const et = p.earlyTermination;
  const refundTotal = settlementRefundTotal(p);
  return (
    <Ledger>
      <LedgerRow label="Tiền giữ chân đang giữ" value={vnd(p.depositHeld)} />
      <LedgerRow label="Phí sửa chữa & phí khác" tone={p.damageFee > 0 ? 'bad' : 'default'} value={`−${vnd(p.damageFee)}`} />
      {(p.storageFee ?? 0) > 0 && (
        <LedgerRow label={`Phí lưu giữ (${p.storageDays ?? 0} ngày × ${vnd(Math.round((p.storageFee ?? 0) / Math.max(1, p.storageDays ?? 1)))})`} tone="bad" value={`−${vnd(p.storageFee ?? 0)}`}
          tip="Điều khoản 1.24: hết hạn mà chưa gia hạn — phí lưu giữ từ ngày hết hạn tới hết ngày bàn giao, trừ vào tiền giữ chân." />
      )}
      {p.priorOutstanding > 0 && <LedgerRow label="Công nợ chưa trả" tone="bad" value={`−${vnd(p.priorOutstanding)}`} />}
      {et && <LedgerRow label="Trả kho sớm" tone="warn" tip={`Trả trước khi hết kỳ cam kết (có ưu đãi thuê dài hạn): đã thuê ${et.elapsedPct}% thời hạn nên tiền giữ chân được hoàn tối đa ${et.refundCapPct}%.`} value={`đã thuê ${et.elapsedPct}% thời hạn`} />}
      {(et?.discountClawback ?? 0) > 0 && <LedgerRow label="Thu hồi ưu đãi thuê dài hạn" tone="warn" tip={et?.usedPeriods ? `Mới dùng ${et.usedPeriods} tháng.` : undefined} value={`−${vnd(et?.discountClawback ?? 0)}`} />}
      {p.prepaidRentRefund + p.prepaidRentOffset > 0 && (
        <LedgerRow label="Tiền thuê trả trước chưa dùng" tone="good" value={`+${vnd(p.prepaidRentRefund)}`}
          tip={p.prepaidRentOffset > 0 ? `Cấn ${vnd(p.prepaidRentOffset)} vào phần vượt tiền giữ chân.` : undefined} />
      )}
      {p.creditRefund + p.creditOffset > 0 && (
        <LedgerRow label="Dịch vụ / phí cấp lại đã huỷ" tone="good" value={`+${vnd(p.creditRefund)}`}
          tip={p.creditOffset > 0 ? `Cấn ${vnd(p.creditOffset)} vào phần vượt tiền giữ chân.` : undefined} />
      )}
      <LedgerRow total label={estimate ? 'Hoàn lại khách (ước tính)' : 'Hoàn lại khách'} value={vnd(refundTotal)} />
      {p.shortfall > 0 && <LedgerRow total label={estimate ? 'Khách cần trả thêm (ước tính)' : 'Khách cần trả thêm'} tone="bad" value={vnd(p.shortfall)} />}
    </Ledger>
  );
}

/** Nội dung nhân viên ghi ở biên bản (danh mục, hư hại + ảnh, đồ để lại, ghi chú) — chỉ đọc. `costs`: hiện phí quản lý đã ghi. */
export function MoveOutReportBody({ i, costs }: { i: InspectionLog; costs?: boolean }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h4 className="mb-1.5 font-semibold text-ink">Danh mục kiểm tra</h4>
        <ul className="grid gap-1 sm:grid-cols-2">
          {i.checklist.map((x) => (
            <li key={x.item} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-2.5 py-1.5">
              <span>{x.item}</span>
              <span className={x.checked || x.condition === 'OK' ? 'text-emerald-700' : 'text-stone-500'}>{x.checked ? 'Đã kiểm' : x.condition ?? 'Chưa kiểm'}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-1.5 font-semibold text-ink">Hư hại ({i.damages.length})</h4>
        {i.damages.length === 0 ? (
          <p className="flex items-center gap-2 text-stone-600"><CircleCheck className="size-4 text-emerald-600" />Không ghi nhận hư hại.</p>
        ) : (
          <ul className="space-y-2">
            {i.damages.map((d, k) => (
              <li key={k} className="rounded-xl p-3 ring-1 ring-inset ring-stone-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-red-100 text-[11px] font-bold text-red-700">{k + 1}</span>
                    <span className="min-w-0 break-words">{d.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={d.severity === 'SEVERE' ? 'red' : d.severity === 'MODERATE' ? 'amber' : 'gray'}>Mức {DAMAGE_SEVERITY_LABEL[d.severity]}</Badge>
                    {costs && <b className="tabular-nums">{vnd(d.cost)}</b>}
                  </span>
                </div>
                {d.photoUrls.length > 0 ? <div className="mt-2"><PhotoLinks urls={d.photoUrls} /></div>
                  : <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500"><ImageIcon className="size-3.5" />Không có ảnh</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {costs && (i.otherFees?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-1.5 font-semibold text-ink">Phí khác</h4>
          <ul className="space-y-1">
            {i.otherFees!.map((f, k) => <li key={k} className="flex justify-between gap-2 rounded-lg bg-stone-50 px-2.5 py-1.5"><span>{f.label}</span><b className="tabular-nums">{vnd(f.amount)}</b></li>)}
          </ul>
        </div>
      )}
      <div>
        <h4 className="mb-1.5 flex items-center gap-1.5 font-semibold text-ink"><Package className="size-4 text-stone-400" />Đồ khách để lại</h4>
        {i.leftItems?.present ? (
          <div className="space-y-1.5 rounded-xl bg-amber-50 p-3 text-amber-950 ring-1 ring-inset ring-amber-200">
            <p className="flex items-center gap-1.5 font-medium"><TriangleAlert className="size-4" />Có — {i.leftItems.description}</p>
            <PhotoLinks urls={i.leftItems.photoUrls ?? []} />
          </div>
        ) : <p className="text-stone-600">Không — khách đã mang hết đồ về.</p>}
      </div>
      {i.notes && <p className="whitespace-pre-line rounded-lg bg-stone-50 px-3 py-2 text-stone-700"><span className="font-medium">Ghi chú: </span>{i.notes}</p>}
    </div>
  );
}
