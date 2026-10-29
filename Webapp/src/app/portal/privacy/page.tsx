'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Download, FileJson, ListChecks, ShieldCheck } from 'lucide-react';
import { enumValues, PRIVACY_REQUEST_STATUS, PRIVACY_REQUEST_TYPE, PrivacyRequestType, type PrivacyRequest } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { fmtDateTime } from '@/shared/lib/format';
import { Button, Card, CardHeader, EmptyState, Field, IconTile, PageHeader, StatusBadge, Table, inputCls } from '@/shared/ui';

/**
 * Quyền của chủ thể dữ liệu (Nghị định 13/2023/NĐ-CP): tự tải bản sao dữ liệu ngay; các quyền khác gửi yêu cầu để Quản trị viên xử lý
 * trong 72 giờ. Không cần đang có hợp đồng.
 */
export default function MyPrivacy() {
  const { run, toast } = useStore();
  const [items, setItems] = useState<PrivacyRequest[] | null>(null);
  const [type, setType] = useState<PrivacyRequestType>('ACCESS');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ items: PrivacyRequest[] }>('/privacy-requests').then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const exportData = async () => {
    setBusy(true);
    try {
      const blob = await api.blob('/auth/me/export');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `khoan-du-lieu-ca-nhan-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được dữ liệu', 'error');
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    const r = await run('createPrivacyRequest', { type, note: note.trim() }, 'Đã gửi yêu cầu — KhoAn phản hồi trong 72 giờ');
    if (r.ok) { setNote(''); load(); }
  };

  return (
    <>
      <PageHeader title="Dữ liệu cá nhân" description="Quyền của bạn theo Nghị định 13/2023/NĐ-CP: xem, sửa, xoá hoặc hạn chế xử lý dữ liệu." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <IconTile icon={<FileJson className="size-5" />} />
            <div>
              <h2 className="font-semibold">Tải bản sao dữ liệu</h2>
              <p className="mt-0.5 text-sm text-stone-600">Toàn bộ dữ liệu KhoAn đang lưu về bạn, dạng tệp JSON.</p>
            </div>
          </div>
          <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => void exportData()}><Download className="size-4" />Tải dữ liệu của tôi</Button>
          <p className="mt-4 text-xs text-stone-500">Sửa họ tên, số điện thoại, giấy tờ ở <b>Thông tin cá nhân</b>. Xem <Link href="/bao-mat" className="font-medium text-brand-700 hover:underline">Chính sách bảo mật</Link>.</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <IconTile icon={<ShieldCheck className="size-5" />} tone="violet" />
            <div>
              <h2 className="font-semibold">Gửi yêu cầu</h2>
              <p className="mt-0.5 text-sm text-stone-600">KhoAn phản hồi trong 72 giờ.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4">
            <Field label="Loại yêu cầu">
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as PrivacyRequestType)}>
                {enumValues(PrivacyRequestType).map((t) => <option key={t} value={t}>{PRIVACY_REQUEST_TYPE[t]}</option>)}
              </select>
            </Field>
            {type === 'DELETION' && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                Xoá dữ liệu = ẩn danh hồ sơ và xoá tài khoản đăng nhập; chỉ làm được khi bạn không còn hợp đồng, đặt chỗ, công nợ, khoản chờ hoàn hay hồ sơ đang xử lý.
                Hợp đồng đã ký và chứng từ tài chính được giữ theo luật định.
              </p>
            )}
            <Field label="Nội dung (tuỳ chọn)">
              <textarea className={inputCls} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD thông tin cần chỉnh sửa, lý do phản đối…" />
            </Field>
            <Button onClick={() => void send()}>Gửi yêu cầu</Button>
          </div>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Yêu cầu đã gửi" />
        <Table rows={items ?? []} rowKey={(r) => r._id} empty={<EmptyState icon={<ListChecks className="size-6" />} title={items === null ? 'Đang tải…' : 'Chưa có yêu cầu nào'} />} columns={[
          { key: 'n', header: 'Yêu cầu', cell: (r) => <div><p className="font-medium">{PRIVACY_REQUEST_TYPE[r.type]}</p><p className="font-mono text-xs text-stone-500">{r.requestNumber}</p></div> },
          { key: 'd', header: 'Gửi lúc', cell: (r) => <span className="text-xs">{fmtDateTime(r.createdAt)}</span> },
          { key: 's', header: 'Trạng thái', cell: (r) => <StatusBadge map={PRIVACY_REQUEST_STATUS} value={r.status} /> },
          { key: 'r', header: 'Phản hồi', cell: (r) => <span className="text-sm text-stone-600">{r.response ?? (r.status === 'OPEN' ? `Hạn phản hồi ${fmtDateTime(r.dueAt)}` : '—')}</span> },
        ]} />
      </Card>
    </>
  );
}
