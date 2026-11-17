'use client';

import { useEffect, useState } from 'react';
import { Download, Eye, FileSignature, FileText } from 'lucide-react';
import { contractAppendices, type RentalContract, type Reservation } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { fmtDateTime } from '@/shared/lib/format';
import { Button, EmptyState, Modal } from '@/shared/ui';
import { SignatureInfo } from './contract-document';

type Doc = { key: string; title: string; note?: string; path: string; fileName: string };
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * Văn bản hợp đồng cho Quản lý chi nhánh / Vận hành: ai ký, lúc nào, cách ký; xem ngay (ảnh hoặc PDF) hoặc tải bản đã ký — bản scan
 * nếu ký giấy tại quầy, PDF nếu ký online — và từng phụ lục (gia hạn, đổi cỡ kho). Server đã cho STAFF / FACILITY_MANAGER / OPS_MANAGER
 * đọc các file này (GET /reservations/:id/signed-file, /reservations/:id/contract.pdf, /contracts/:id/appendices/:n.pdf).
 */
export function ContractPapers({ contract: c, reservation }: { contract?: RentalContract | null; reservation?: Reservation | null }) {
  const { db, toast } = useStore();
  const r = reservation ?? (c ? db.reservations.find((x) => x._id === c.reservationId) : undefined);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<{ title: string; url: string; type: string } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const docs: Doc[] = [];
  if (r?.signature) {
    const paper = r.signature.method === 'PAPER';
    docs.push(paper
      ? { key: 'main', title: 'Hợp đồng ký giấy — bản scan', note: 'Nhân viên tải lên khi khách ký tại quầy', path: `/reservations/${r._id}/signed-file`, fileName: `hop-dong-da-ky-${r.code}` }
      : { key: 'main', title: 'Hợp đồng ký online — PDF', note: 'Bản đúng như khách đã đọc và xác nhận bằng mã OTP', path: `/reservations/${r._id}/contract.pdf`, fileName: `hop-dong-${r.code}` });
  }
  if (c) {
    for (const a of contractAppendices(c)) {
      docs.push({ key: `a${a.number}`, title: a.title, note: `${a.signerName} xác nhận lúc ${fmtDateTime(a.acceptedAt)}`, path: `/contracts/${c._id}/appendices/${a.number}.pdf`, fileName: `phu-luc-${String(a.number).padStart(2, '0')}-${c.contractNumber}` });
    }
  }

  const open = async (d: Doc, mode: 'view' | 'download') => {
    setBusy(d.key + mode);
    try {
      const blob = await api.blob(d.path);
      const url = URL.createObjectURL(blob);
      if (mode === 'view') { setPreview({ title: d.title, url, type: blob.type }); return; }
      const a = document.createElement('a');
      a.href = url; a.download = `${d.fileName}.${EXT[blob.type] ?? 'pdf'}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được văn bản', 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-3">
      {r?.signature ? <SignatureInfo signature={r.signature} /> : (
        <EmptyState compact icon={<FileSignature className="size-5" />} title="Chưa có văn bản đã ký" description={r ? 'Khách chưa ký hợp đồng.' : 'Không tìm thấy đặt chỗ gốc của hợp đồng này.'} />
      )}
      {docs.length > 0 && (
        <ul className="divide-y divide-stone-100 rounded-xl ring-1 ring-inset ring-stone-200">
          {docs.map((d) => (
            <li key={d.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <FileText className="size-4 shrink-0 text-stone-400" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{d.title}</p>
                {d.note && <p className="text-xs text-stone-500">{d.note}</p>}
              </div>
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void open(d, 'view')}><Eye className="size-3.5" />Xem</Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void open(d, 'download')}><Download className="size-3.5" />Tải</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!preview} onClose={() => setPreview(null)} size="lg" stacked title={preview?.title ?? ''}>
        {preview && (preview.type.startsWith('image/')
          ? <img src={preview.url} alt={preview.title} className="mx-auto max-h-[75vh] rounded-lg ring-1 ring-stone-200" />
          : <iframe src={preview.url} title={preview.title} className="h-[75vh] w-full rounded-lg ring-1 ring-stone-200" />)}
      </Modal>
    </div>
  );
}
