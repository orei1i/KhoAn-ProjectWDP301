'use client';

import { useState } from 'react';
import { Printer, ReceiptText } from 'lucide-react';
import { COLLECTED_PAYMENT_STATUSES, type PaymentTransaction } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { vnd } from '@/shared/lib/format';
import { Button } from '@/shared/ui';

/** Có biên lai: khoản thu đã thu tiền, hoặc khoản hoàn đã chi xong (không tính bút toán nội bộ). */
export const hasReceipt = (p: Pick<PaymentTransaction, 'direction' | 'status' | 'method'>) =>
  p.method !== 'INTERNAL' && (p.direction === 'CHARGE' ? COLLECTED_PAYMENT_STATUSES.includes(p.status) : p.status === 'SUCCEEDED');

/**
 * Biên lai PDF của một khoản thanh toán (GET /payments/:id/receipt.pdf, cần token nên tải qua blob).
 * `print`: mở tab mới để in ngay tại quầy; mặc định tải file về máy.
 */
export function ReceiptButton({ paymentId, print, label, size = 'sm', variant = 'secondary' }: {
  paymentId: string; print?: boolean; label?: string; size?: 'sm' | 'md'; variant?: 'secondary' | 'ghost' | 'primary';
}) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    // Mở tab ngay trong lúc bấm — mở sau khi tải xong thì trình duyệt chặn popup.
    const w = print ? window.open('', '_blank') : null;
    setBusy(true);
    try {
      const blob = await api.blob(`/payments/${paymentId}/receipt.pdf`);
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url;
      else { const a = document.createElement('a'); a.href = url; a.download = `bien-lai-${paymentId}.pdf`; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      w?.close();
      toast(e instanceof Error ? e.message : 'Không tải được biên lai', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size={size} variant={variant} disabled={busy} onClick={() => void open()}>
      {print ? <Printer className="size-3.5" /> : <ReceiptText className="size-3.5" />}{label ?? (print ? 'In biên lai' : 'Biên lai')}
    </Button>
  );
}

/** Nút in biên lai cho các khoản vừa thu (so với danh sách mã khoản trước khi thu). */
export function NewReceipts({ payments, before }: { payments: PaymentTransaction[]; before: string[] }) {
  const fresh = payments.filter((p) => !before.includes(p._id) && p.direction === 'CHARGE' && hasReceipt(p));
  if (!fresh.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {fresh.map((p) => <ReceiptButton key={p._id} paymentId={p._id} print label={fresh.length > 1 ? `In biên lai ${vnd(p.amount)}` : undefined} />)}
    </div>
  );
}
