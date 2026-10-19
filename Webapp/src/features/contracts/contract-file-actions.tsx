'use client';

import { useState } from 'react';
import { Download, Mail } from 'lucide-react';
import type { Reservation } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { fmtDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui';

/** Tải PDF hợp đồng đã ký, hoặc gửi lại bản PDF tới email của khách. Chỉ hiện khi đã ký. */
export function ContractFileActions({ reservation: r }: { reservation: Reservation }) {
  const { run, toast } = useStore();
  const [busy, setBusy] = useState(false);
  if (!r.signature) return null;
  const s = r.signature;

  const download = async () => {
    setBusy(true);
    try {
      const blob = await api.blob(`/reservations/${r._id}/contract.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `hop-dong-${r.code}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được PDF', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void download()} disabled={busy}><Download className="size-3.5" />Tải PDF hợp đồng</Button>
      <Button size="sm" variant="secondary" onClick={() => void run('emailContract', { reservationId: r._id }, (v) => `Đã gửi PDF tới ${v.to}`)}><Mail className="size-3.5" />Gửi lại qua email</Button>
      <span className="text-xs text-stone-500">{s.emailedAt ? `Đã gửi tới ${s.emailedTo ?? 'email khách'} lúc ${fmtDateTime(s.emailedAt)}` : 'Chưa gửi email'}</span>
    </div>
  );
}
