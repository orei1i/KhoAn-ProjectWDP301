'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { ContractClause, RentalPeriod } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { Button, Modal } from '@/shared/ui';

export interface ContractPreviewParams {
  unitTypeId: string; unitId?: string; startDate: string; rentalPeriod: RentalPeriod; periods: number; useAirConditioning: boolean;
  /** Dòng mô tả ở tiêu đề, VD "Phòng S · ô S1-08". */
  label: string;
}
interface PreviewView { clauses: ContractClause[]; customerName: string | null }

const query = (p: ContractPreviewParams) => new URLSearchParams({
  unitTypeId: p.unitTypeId, ...(p.unitId && { unitId: p.unitId }), startDate: p.startDate.slice(0, 10),
  rentalPeriod: p.rentalPeriod, periods: String(p.periods), useAirConditioning: String(p.useAirConditioning),
}).toString();

/**
 * Toàn văn hợp đồng sẽ phát sinh nếu đặt dòng này — đọc TRƯỚC khi giữ chỗ / trả tiền giữ chân. Server dựng bằng đúng mẫu,
 * chính sách và báo giá như khi đặt thật (GET /reservations/contract-preview), không giữ ô. Có PDF để gửi pháp lý / kế toán đọc.
 */
export function ContractPreviewDialog({ params, onClose }: { params: ContractPreviewParams | null; onClose: () => void }) {
  const { toast } = useStore();
  const [view, setView] = useState<PreviewView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const qs = params ? query(params) : '';

  useEffect(() => {
    if (!qs) return;
    let alive = true;
    setView(null); setError('');
    api.get<PreviewView>(`/reservations/contract-preview?${qs}`).then((v) => alive && setView(v)).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [qs]);

  const download = async () => {
    setBusy(true);
    try {
      const blob = await api.blob(`/reservations/contract-preview.pdf?${qs}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'hop-dong-xem-truoc.pdf'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được PDF', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!params}
      onClose={onClose}
      size="lg"
      title="Xem trước hợp đồng"
      description={params ? `${params.label} — bản xem trước, chưa ký, chưa có giá trị. Hợp đồng chỉ được giao kết khi bạn đặt chỗ và ký trên tài khoản.` : undefined}
      footer={<>
        <Button variant="secondary" onClick={() => void download()} disabled={busy || !view}><Download className="size-4" />Tải PDF bản xem trước</Button>
        <Button onClick={onClose}>Đã đọc</Button>
      </>}
    >
      <article className="space-y-4 text-sm leading-relaxed text-stone-700">
        {view && !view.customerName && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">Bạn chưa đăng nhập nên phần Bên thuê đang để trống — khi đặt, hợp đồng ghi theo họ tên và email tài khoản của bạn.</p>
        )}
        {error && <p className="text-red-700">Không dựng được bản xem trước: {error}</p>}
        {!view && !error && <p className="text-stone-500">Đang dựng hợp đồng…</p>}
        {view?.clauses.map((c, i) => (
          <section key={`${i}-${c.title}`}>
            <h4 className="font-semibold text-ink">{c.title}</h4>
            {c.paragraphs.map((p, k) => <p key={k}>{p}</p>)}
            {c.bullets.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{c.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>}
          </section>
        ))}
        {view && <p><Link href="/dieu-khoan" target="_blank" className="font-medium text-brand-700 hover:underline">Xem Điều khoản thuê kho đầy đủ</Link></p>}
      </article>
    </Modal>
  );
}
