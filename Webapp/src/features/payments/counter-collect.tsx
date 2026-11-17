'use client';

import { useState } from 'react';
import { Banknote, CircleCheck, TriangleAlert } from 'lucide-react';
import type { CounterPaySelection, RentalContract } from '@ssm/shared';
import { paymentsOfContract } from '@ssm/shared';
import { newKey } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { CONTRACT_STATUS, COUNTER_PAY_METHOD } from '@/shared/lib/labels';
import { unitLabel, userName } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Button, Modal } from '@/shared/ui';
import { CounterPayment } from '@/features/payments/counter-pay';
import { NewReceipts } from '@/features/payments/receipt-button';

/**
 * Thu công nợ của hợp đồng tại quầy (nhân viên / quản lý chi nhánh) — POST /contracts/:id/pay-balance.
 * Số tiền chốt LÚC MỞ hộp; server thu đúng dư nợ hiện tại, nên dư nợ đổi trong lúc mở (job tính phí trễ, khách vừa trả online)
 * thì bắt cập nhật số mới trước khi xác nhận. Gồm cả nợ còn lại sau quyết toán của hợp đồng đã đóng.
 */
export function CounterCollectDialog({ contract, onClose }: { contract: RentalContract | null; onClose: () => void }) {
  const { db, run, busy } = useStore();
  // Góp ý 17/11: `sel` = tiền mặt đã tick "Đã nhận đủ", hoặc VNPAY tại quầy khách đã trả xong (mã lệnh) — null thì chưa xác nhận được.
  const [form, setForm] = useState<{ id: string | null; amount: number; sel: CounterPaySelection | null; key: string }>({ id: null, amount: 0, sel: null, key: '' });
  // Mã các khoản của hợp đồng trước khi thu — thu xong thì khoản mới là khoản cần in biên lai.
  const [before, setBefore] = useState<string[] | null>(null);
  // Mở cho hợp đồng khác → chốt lại số tiền tại thời điểm mở.
  if ((contract?._id ?? null) !== form.id) { setForm({ id: contract?._id ?? null, amount: contract?.balance.outstanding ?? 0, sel: null, key: newKey() }); setBefore(null); }
  if (!contract) return null;

  const c = db.contracts.find((x) => x._id === contract._id) ?? contract;
  const live = c.balance.outstanding;
  const changed = live !== form.amount;
  const sel = form.sel;
  const label = sel ? COUNTER_PAY_METHOD[sel.payMethod] : '';

  const confirm = () => {
    if (!sel) return;
    const ids = paymentsOfContract(db.payments, c).map((p) => p._id);
    // Đợt 15 (B5): gửi số đã báo khách — dư nợ vừa đổi thì server từ chối (409 BALANCE_CHANGED), hộp hiện số mới để cập nhật; cùng key
    // nên bấm lại sau khi mạng chập chờn không thu hai lần.
    void run('payBalance', { contractId: c._id, method: sel.payMethod, gatewayTxnRef: sel.payMethod === 'VNPAY' ? sel.gatewayTxnRef : undefined, expectedAmount: form.amount, idempotencyKey: form.key },
      (v) => (v === form.amount ? `Đã thu ${vnd(v)} tại quầy (${label})` : `Đã thu ${vnd(v)} tại quầy (${label}) — khác số đã báo khách ${vnd(form.amount)}`),
      () => setBefore(ids));
  };

  if (before) {
    return (
      <Modal open onClose={onClose} title="Đã thu công nợ" description={`${userName(db, c.customerId)} · HĐ ${c.contractNumber}`}
        footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
        <div className="space-y-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-emerald-800"><CircleCheck className="size-4" />Đã ghi nhận khoản thu.</p>
          <NewReceipts payments={paymentsOfContract(db.payments, c)} before={before} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Thu công nợ tại quầy" description={`${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · HĐ ${c.contractNumber}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Đóng</Button>
        <Button disabled={busy || changed || live <= 0 || !sel} onClick={confirm}><Banknote className="size-4" />Xác nhận đã thu {vnd(form.amount)}</Button>
      </>}>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-stone-50 p-4 ring-1 ring-inset ring-stone-200">
          <p className="text-xs text-stone-500">Dư nợ lúc mở · {CONTRACT_STATUS[c.status].label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{vnd(form.amount)}</p>
          {(c.delinquency?.lateFeesAccrued ?? 0) > 0 && <p className="mt-1 text-xs text-stone-500">Gồm phí trễ {vnd(c.delinquency!.lateFeesAccrued)}</p>}
        </div>

        {changed && (
          <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p>Dư nợ đã đổi thành <b>{vnd(live)}</b>.</p>
              {live > 0 && <Button size="sm" variant="secondary" className="mt-2" onClick={() => setForm((f) => ({ ...f, amount: live, sel: null, key: newKey() }))}>Dùng số mới</Button>}
            </div>
          </div>
        )}

        <CounterPayment amount={form.amount} target={{ purpose: 'BALANCE', contractId: c._id }} value={sel} onChange={(v) => setForm((f) => ({ ...f, sel: v }))}
          lockedReason={changed ? 'Dư nợ vừa đổi — bấm “Dùng số mới” trước khi thu' : null} />
      </div>
    </Modal>
  );
}
