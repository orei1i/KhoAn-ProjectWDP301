'use client';

import type { ReactNode } from 'react';
import { BadgePercent, Banknote, CalendarCheck, CircleCheck, Clock, Hammer, Hourglass, Landmark, Receipt, TriangleAlert, Wallet } from 'lucide-react';
import { PAYMENT_METHOD, type InspectionLog, type PaymentTransaction, type RentalContract, type Tone } from '@ssm/shared';
import type { DB } from '@/shared/lib/mock-data';
import { byId } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Badge } from '@/shared/ui';
import { Ledger, LedgerRow } from '@/features/staff-ui';

/**
 * Góp ý 17/11: quản lý chi nhánh (và Vận hành, chỉ xem) xem TIỀN GIỮ CHÂN của từng hợp đồng — đang giữ bao nhiêu; trả kho xong thì đã cấn
 * trừ bao nhiêu, vì sao (hư hại, công nợ, giới hạn hoàn khi trả sớm, thu hồi ưu đãi), hoàn khách bao nhiêu và tới đâu (chờ chuyển khoản /
 * đã hoàn ngày nào, mã giao dịch nào). Chỉ đọc dữ liệu đã có: `contract.deposit`, `depositSettlement` của biên bản trả kho / xử lý hàng
 * bỏ lại, các khoản REFUND trong `db.payments`. Không có thao tác — chuyển khoản hoàn vẫn xác nhận ở "Chờ hoàn tiền".
 */

/** Biên bản có quyết toán tiền giữ chân mới nhất của hợp đồng (trả kho hoặc xử lý hàng bỏ lại). */
export const depositSettlementOf = (db: DB, c: RentalContract): InspectionLog | undefined =>
  db.inspections.filter((i) => i.contractId === c._id && !!i.depositSettlement).sort((a, b) => b.performedAt.localeCompare(a.performedAt))[0];

export interface DepositRefund { amount: number; payment?: PaymentTransaction; note?: string; at?: string }
export interface DepositView {
  held: number;
  inspection?: InspectionLog;
  /**
   * Lý do cấn trừ: phí sửa chữa hư hại + phí khác (vệ sinh, thay khoá… quản lý chi nhánh ghi lúc duyệt biên bản trả kho) + công nợ (dùng
   * chung một phần tiền giữ chân), giới hạn hoàn khi trả sớm, thu hồi ưu đãi. `damage` chỉ là phí sửa chữa hư hại; `otherFees` tách riêng.
   */
  damage: number; otherFees: number; otherFeeLabels: string[]; priorDebt: number | null; owedApplied: number; earlyCap: number; clawback: number; deductions: number;
  refunds: DepositRefund[];
  refundTotal: number; refundPending: number; refundDone: number;
  /** Khách còn nợ: phần thiếu lúc quyết toán và nợ hiện tại của hợp đồng đã đóng. */
  shortfall: number; outstanding: number;
  state: { label: string; tone: Tone };
}

const pendingRefund = (p?: PaymentTransaction) => p?.status === 'PENDING';
const failedRefund = (p?: PaymentTransaction) => p?.status === 'FAILED' || p?.status === 'CANCELLED';
/** Ngày đã hoàn / đã chuyển và mã giao dịch của một khoản hoàn. */
export const refundDoneAt = (p?: PaymentTransaction) => p?.payout?.confirmedAt ?? p?.paidAt ?? p?.gatewayRefund?.resolvedAt ?? null;
export const refundRef = (p?: PaymentTransaction) => p?.payout?.reference ?? p?.gatewayRefund?.transactionNo ?? p?.provider?.counterRef ?? p?.provider?.txnRef ?? null;

export function depositView(db: DB, c: RentalContract): DepositView {
  const held = c.deposit.amount;
  const inspection = depositSettlementOf(db, c);
  const ds = inspection?.depositSettlement;
  const outstanding = c.status === 'CLOSED' || c.status === 'ABANDONED' ? c.balance.outstanding : 0;
  if (!ds) {
    const state = held <= 0 ? { label: 'Không thu tiền giữ chân', tone: 'gray' as Tone }
      : c.deposit.status === 'HELD' ? { label: 'Đang giữ', tone: 'blue' as Tone }
      : c.deposit.status === 'REFUND_PENDING' ? { label: 'Chờ chuyển khoản', tone: 'amber' as Tone }
      : c.deposit.status === 'REFUNDED' ? { label: 'Đã hoàn', tone: 'green' as Tone }
      : c.deposit.status === 'FORFEITED' ? { label: 'Không hoàn', tone: 'red' as Tone }
      : { label: 'Đã cấn trừ', tone: 'gray' as Tone };
    return { held, damage: 0, otherFees: 0, otherFeeLabels: [], priorDebt: null, owedApplied: 0, earlyCap: 0, clawback: 0, deductions: 0, refunds: [], refundTotal: c.deposit.refundedAmount ?? 0, refundPending: 0, refundDone: 0, shortfall: 0, outstanding, state };
  }
  // totalDamageFee = phí sửa chữa hư hại + phí khác (moveOutFeeTotal) — góp ý 18/11: tách phí khác ra, không gọi chung là "hư hại".
  const feeTotal = inspection!.totalDamageFee;
  const fees = inspection!.otherFees ?? [];
  const otherFees = Math.min(feeTotal, fees.reduce((s, f) => s + (f.amount || 0), 0));
  const damage = feeTotal - otherFees;
  const priorDebt = ds.priorOutstanding ?? null;
  const owedApplied = Math.min(ds.depositHeld, feeTotal + (priorDebt ?? 0));
  const clawback = ds.earlyTermination?.discountClawback ?? 0;
  // Phần còn lại của khoản cấn trừ: giữ lại do trả sớm (trần hoàn) — biên bản cũ không lưu công nợ trước đó thì phần này gồm cả công nợ.
  const earlyCap = Math.max(0, ds.deductions - owedApplied - clawback);
  const refunds: DepositRefund[] = [
    ...(ds.refundAmount > 0 ? [{ amount: ds.refundAmount, payment: byId(db.payments, ds.refundPaymentId) }] : []),
    // Khách khiếu nại đúng → giảm hư hại, phần dư hoàn thêm (khoản hoàn riêng).
    ...(inspection!.adjustments ?? []).filter((a) => (a.refund ?? 0) > 0).map((a) => ({ amount: a.refund ?? 0, payment: byId(db.payments, a.refundPaymentId), note: `Hoàn thêm sau khiếu nại — ${a.reason}`, at: a.at })),
  ];
  // Khoản hoàn chưa thấy trong sổ (dữ liệu cũ): theo trạng thái tiền giữ chân trên hợp đồng.
  const isPending = (r: DepositRefund) => (r.payment ? pendingRefund(r.payment) : c.deposit.status === 'REFUND_PENDING');
  const live = refunds.filter((r) => !failedRefund(r.payment));
  const refundTotal = live.reduce((s, r) => s + r.amount, 0);
  const refundPending = live.filter(isPending).reduce((s, r) => s + r.amount, 0);
  const refundDone = refundTotal - refundPending;
  const viaGateway = live.some((r) => isPending(r) && r.payment?.method === 'VNPAY');
  const state = refundPending > 0 ? { label: viaGateway ? 'Đang hoàn qua VNPAY' : 'Chờ chuyển khoản', tone: 'amber' as Tone }
    : refundDone > 0 ? { label: 'Đã hoàn', tone: 'green' as Tone }
    : c.deposit.status === 'FORFEITED' ? { label: 'Không hoàn', tone: 'red' as Tone }
    : { label: 'Cấn trừ hết', tone: 'gray' as Tone };
  return { held, inspection, damage, otherFees, otherFeeLabels: fees.map((f) => f.label), priorDebt, owedApplied, earlyCap, clawback, deductions: ds.deductions, refunds, refundTotal, refundPending, refundDone, shortfall: ds.shortfall ?? 0, outstanding, state };
}

/** Một dòng lý do cấn trừ (ngắn) cho danh sách. */
export function deductionReasons(v: DepositView): string {
  const parts = [
    v.damage > 0 && `hư hại ${vnd(v.damage)}`,
    v.otherFees > 0 && `phí khác ${vnd(v.otherFees)}`,
    (v.priorDebt ?? 0) > 0 && `công nợ ${vnd(v.priorDebt ?? 0)}`,
    v.earlyCap > 0 && (v.priorDebt === null ? `trả sớm / công nợ ${vnd(v.earlyCap)}` : `trả sớm ${vnd(v.earlyCap)}`),
    v.clawback > 0 && `thu hồi ưu đãi ${vnd(v.clawback)}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Mô tả trạng thái một khoản hoàn: chờ chuyển khoản / đã hoàn ngày … · mã … · hình thức. */
export function refundStatusText(r: DepositRefund): ReactNode {
  const p = r.payment;
  if (!p) return 'Chưa có khoản hoàn trong sổ';
  if (failedRefund(p)) return 'Khoản hoàn không thành công';
  if (pendingRefund(p)) return p.method === 'VNPAY' ? 'Đang hoàn qua VNPAY' : `Chờ chuyển khoản · lập ${fmtDate(p.createdAt)}`;
  const ref = refundRef(p);
  return <>Đã hoàn {fmtDate(refundDoneAt(p))} · {PAYMENT_METHOD[p.method]}{ref ? <> · mã <span className="font-mono">{ref}</span></> : null}</>;
}

export function DepositStateBadge({ view }: { view: DepositView }) {
  return (
    <>
      <Badge tone={view.state.tone} dot>{view.state.label}</Badge>
      {view.outstanding > 0 && <Badge tone="red">Khách còn nợ {vnd(view.outstanding)}</Badge>}
    </>
  );
}

/** Mục "Tiền giữ chân" trong chi tiết hợp đồng — đã thu, cấn trừ vì sao, hoàn bao nhiêu và tới đâu. */
export function DepositBreakdown({ db, contract: c }: { db: DB; contract: RentalContract }) {
  const v = depositView(db, c);
  const collected = byId(db.payments, c.deposit.paymentId);
  const ds = v.inspection?.depositSettlement;
  const et = ds?.earlyTermination;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><DepositStateBadge view={v} /></div>
      <Ledger>
        <LedgerRow icon={<Wallet />} label={<>Tiền giữ chân{collected?.paidAt ? <span className="text-xs text-stone-500"> · thu {fmtDate(collected.paidAt)} ({PAYMENT_METHOD[collected.method]})</span> : null}</>} value={vnd(ds?.depositHeld ?? v.held)} />
        {!ds && <LedgerRow tone="muted" icon={<Clock />} label={c.deposit.status === 'HELD' ? 'Đang giữ — quyết toán khi khách trả kho' : 'Chưa có biên bản quyết toán'} value="—" />}
        {ds && <>
          {v.owedApplied > 0 && (
            <LedgerRow icon={<Hammer />} label={<>{v.otherFees > 0 ? 'Cấn trừ hư hại, phí khác & công nợ' : 'Cấn trừ hư hại & công nợ'}<span className="block text-xs text-stone-500">{[
              v.damage > 0 && `hư hại theo biên bản ${vnd(v.damage)}`,
              v.otherFees > 0 && `phí khác ${vnd(v.otherFees)}${v.otherFeeLabels.length ? ` (${v.otherFeeLabels.join(', ')})` : ''}`,
              (v.priorDebt ?? 0) > 0 && `công nợ trước khi trả kho ${vnd(v.priorDebt ?? 0)}`,
            ].filter(Boolean).join(' · ')}</span></>} value={`−${vnd(v.owedApplied)}`} tone="warn" />
          )}
          {v.earlyCap > 0 && (
            <LedgerRow icon={<Hourglass />} label={<>{v.priorDebt === null ? 'Giữ lại (trả sớm / công nợ)' : 'Giữ lại do trả kho sớm'}{et && <span className="block text-xs text-stone-500">đã dùng {et.elapsedPct}% kỳ hạn — hoàn tối đa {et.refundCapPct}%</span>}</>} value={`−${vnd(v.earlyCap)}`} tone="warn" />
          )}
          {v.clawback > 0 && <LedgerRow icon={<BadgePercent />} label="Thu hồi ưu đãi thuê dài hạn" value={`−${vnd(v.clawback)}`} tone="warn" />}
          {v.deductions === 0 && <LedgerRow tone="muted" icon={<CircleCheck />} label="Không cấn trừ khoản nào" value={vnd(0)} />}
          <LedgerRow total icon={<Banknote />} label="Hoàn lại khách" value={vnd(ds.refundAmount)} />
          {v.refunds.map((r, k) => (
            <LedgerRow key={k} tone={pendingRefund(r.payment) ? 'warn' : failedRefund(r.payment) ? 'bad' : 'good'} icon={pendingRefund(r.payment) ? <Landmark /> : <CalendarCheck />}
              label={<>{r.note ? <span className="block text-xs text-stone-500">{r.note}</span> : null}{refundStatusText(r)}</>} value={vnd(r.amount)} />
          ))}
          {(ds.prepaidRentRefund ?? 0) > 0 && <LedgerRow icon={<Receipt />} label="Hoàn tiền thuê trả trước chưa dùng (khoản riêng)" value={vnd(ds.prepaidRentRefund ?? 0)} tone="muted" />}
          {(v.shortfall > 0 || v.outstanding > 0) && (
            <LedgerRow icon={<TriangleAlert />} tone="bad" label={v.outstanding > 0 ? `Khách còn nợ (thiếu lúc quyết toán ${vnd(v.shortfall)})` : 'Thiếu lúc quyết toán (đã thu / xoá)'} value={vnd(v.outstanding > 0 ? v.outstanding : v.shortfall)} />
          )}
        </>}
      </Ledger>
      {v.inspection && <p className="text-xs text-stone-500">Quyết toán theo biên bản {v.inspection.type === 'ABANDONMENT' ? 'xử lý hàng bỏ lại' : 'trả kho'} ngày {fmtDate(v.inspection.performedAt)}.</p>}
    </div>
  );
}
