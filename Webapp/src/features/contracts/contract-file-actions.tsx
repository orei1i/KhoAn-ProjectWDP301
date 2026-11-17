'use client';

import { useState } from 'react';
import { Download, Mail } from 'lucide-react';
import type { Reservation } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { fmtDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui';

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * Tải PDF hợp đồng đã ký, hoặc gửi lại bản PDF tới email của khách. Chỉ hiện khi đã ký.
 * Ký giấy tại quầy (PAPER): tải bản scan đã ký (signed-file).
 */
export function ContractFileActions({ reservation: r }: { reservation: Reservation }) {
  const { run, toast } = useStore();
  const [busy, setBusy] = useState(false);
  if (!r.signature) return null;
  const s = r.signature;
  const paper = s.method === 'PAPER';

  const download = async () => {
    setBusy(true);
    try {
      const blob = await api.blob(paper ? `/reservations/${r._id}/signed-file` : `/reservations/${r._id}/contract.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = paper ? `hop-dong-da-ky-${r.code}.${EXT[blob.type] ?? 'pdf'}` : `hop-dong-${r.code}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được hợp đồng', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (paper) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void download()} disabled={busy}><Download className="size-3.5" />Tải bản hợp đồng đã ký</Button>
        <span className="text-xs text-stone-500">Ký giấy tại quầy{s.emailedAt ? ` · đã gửi tới ${s.emailedTo ?? 'email khách'} lúc ${fmtDateTime(s.emailedAt)}` : ''}</span>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void download()} disabled={busy}><Download className="size-3.5" />Tải PDF hợp đồng</Button>
      <Button size="sm" variant="secondary" onClick={() => void run('emailContract', { reservationId: r._id }, (v) => `Đã gửi PDF tới ${v.to}`)}><Mail className="size-3.5" />{s.emailedAt ? 'Gửi lại qua email' : 'Gửi qua email'}</Button>
      {s.emailedAt && <span className="text-xs text-stone-500">Đã gửi tới {s.emailedTo ?? 'email khách'} lúc {fmtDateTime(s.emailedAt)}</span>}
    </div>
  );
}
