'use client';

import { useState } from 'react';
import { Banknote, CircleCheck, TriangleAlert } from 'lucide-react';
import type { PaymentMethod, RentalContract } from '@ssm/shared';
import { paymentsOfContract } from '@ssm/shared';
import { isTxnRef, newKey } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { CONTRACT_STATUS, PAYMENT_METHOD } from '@/shared/lib/labels';
import { unitLabel, userName } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Button, Field, Modal, inputCls } from '@/shared/ui';
import { PayMethodPicker } from '@/features/payments/pay-method';
import { NewReceipts } from '@/features/payments/receipt-button';

/** Hình thức thu tại quầy: tiền mặt, chuyển khoản vào tài khoản chi nhánh, quẹt thẻ (POS). */
const COUNTER_METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CARD'];

/**
 * Thu công nợ của hợp đồng tại quầy (nhân viên / quản lý chi nhánh) — POST /contracts/:id/pay-balance.
 * Số tiền chốt LÚC MỞ hộp; server thu đúng dư nợ hiện tại, nên dư nợ đổi trong lúc mở (job tính phí trễ, khách vừa trả online)
 * thì bắt cập nhật số mới trước khi xác nhận. Gồm cả nợ còn lại sau quyết toán của hợp đồng đã đóng.
 */
export function CounterCollectDialog({ contract, onClose }: { contract: RentalContract | null; onClose: () => void }) {
  const { db, run, busy } = useStore();
  const [form, setForm] = useState<{ id: string | null; amount: number; method: PaymentMethod; txnRef: string; received: boolean; key: string }>({ id: null, amount: 0, method: 'CASH', txnRef: '', received: false, key: '' });
  // Mã các khoản của hợp đồng trước khi thu — thu xong thì khoản mới là khoản cần in biên lai.
  const [before, setBefore] = useState<string[] | null>(null);
  // Mở cho hợp đồng khác → chốt lại số tiền tại thời điểm mở.
  if ((contract?._id ?? null) !== form.id) { setForm({ id: contract?._id ?? null, amount: contract?.balance.outstanding ?? 0, method: 'CASH', txnRef: '', received: false, key: newKey() }); setBefore(null); }
  if (!contract) return null;

  const c = db.contracts.find((x) => x._id === contract._id) ?? contract;
  const live = c.balance.outstanding;
  const changed = live !== form.amount;
  const label = PAYMENT_METHOD[form.method];
  // Không phải tiền mặt → bắt buộc mã giao dịch (mã chuyển khoản / mã chuẩn chi thẻ) làm chứng từ.
  const needTxn = form.method !== 'CASH';
  const txnOk = !needTxn || isTxnRef(form.txnRef);

  const confirm = () => {
    const ids = paymentsOfContract(db.payments, c).map((p) => p._id);
    // Đợt 15 (B5): gửi số đã báo khách — dư nợ vừa đổi thì server từ chối (409 BALANCE_CHANGED), hộp hiện số mới để cập nhật; cùng key
    // nên bấm lại sau khi mạng chập chờn không thu hai lần.
    void run('payBalance', { contractId: c._id, method: form.method, txnRef: form.txnRef, expectedAmount: form.amount, idempotencyKey: form.key },
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
        <Button disabled={busy || changed || live <= 0 || !form.received || !txnOk} onClick={confirm}><Banknote className="size-4" />Xác nhận đã thu {vnd(form.amount)}</Button>
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
              {live > 0 && <Button size="sm" variant="secondary" className="mt-2" onClick={() => setForm((f) => ({ ...f, amount: live, received: false, key: newKey() }))}>Dùng số mới</Button>}
            </div>
          </div>
        )}

        <Field label="Hình thức thu">
          <PayMethodPicker value={form.method} onChange={(m) => setForm((f) => ({ ...f, method: m, received: false }))} methods={COUNTER_METHODS} />
        </Field>
        {needTxn && (
          <Field label="Mã giao dịch">
            <input className={inputCls} value={form.txnRef} maxLength={64} onChange={(e) => setForm((f) => ({ ...f, txnRef: e.target.value }))} placeholder={form.method === 'CARD' ? 'Mã chuẩn chi' : 'FT26292xxxxx'} />
          </Field>
        )}

        <label className="flex cursor-pointer gap-2.5">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={form.received} onChange={(e) => setForm((f) => ({ ...f, received: e.target.checked }))} />
          <span>Đã nhận đủ <b>{vnd(form.amount)}</b> ({label.toLowerCase()}) — không huỷ được sau khi xác nhận.</span>
        </label>
      </div>
    </Modal>
  );
}
