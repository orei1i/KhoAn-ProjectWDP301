'use client';

import { useCallback, useEffect, useState } from 'react';
import { PRIVACY_REQUEST_STATUS, PRIVACY_REQUEST_TYPE, type PrivacyRequest } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { fmtDateTime } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Table, Tabs, inputCls } from '@/shared/ui';

type Row = PrivacyRequest & { customer: { _id: string; fullName: string; email: string; phone?: string | null } | null };
type Tab = 'OPEN' | 'ALL';

/**
 * Quản trị viên xử lý yêu cầu quyền dữ liệu cá nhân (Nghị định 13/2023) trong 72 giờ: trả lời đã xử lý / từ chối; yêu cầu xoá thì ẩn
 * danh hoá tài khoản (giữ chứng từ tài chính). Quá hạn phản hồi được tô đỏ.
 */
export default function PrivacyRequests() {
  const { run } = useStore();
  const [items, setItems] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<Tab>('OPEN');
  const [view, setView] = useState<Row | null>(null);
  const [response, setResponse] = useState('');

  const load = useCallback(() => {
    api.get<{ items: Row[] }>('/privacy-requests').then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);
  const rows = (items ?? []).filter((r) => tab === 'ALL' || r.status === 'OPEN');
  const overdue = (r: Row) => r.status === 'OPEN' && new Date(r.dueAt) < new Date();

  const resolve = async (status: 'DONE' | 'REJECTED') => {
    if (!view) return;
    const r = await run('resolvePrivacyRequest', { id: view._id, status, response }, status === 'DONE' ? 'Đã đánh dấu đã xử lý' : 'Đã từ chối yêu cầu');
    if (r.ok) { setView(null); load(); }
  };
  const anonymize = async () => {
    if (!view?.customer) return;
    if (!window.confirm(`Ẩn danh hoá tài khoản ${view.customer.fullName} (${view.customer.email})? Không thể hoàn tác.`)) return;
    const r = await run('anonymizeCustomer', { userId: view.customer._id, reason: response.trim() || `Theo yêu cầu ${view.requestNumber}`, requestId: view._id }, 'Đã xoá (ẩn danh hoá) dữ liệu khách');
    if (r.ok) { setView(null); load(); }
  };

  return (
    <>
      <PageHeader title="Yêu cầu dữ liệu cá nhân" description="Khách gửi theo Nghị định 13/2023/NĐ-CP — phản hồi trong 72 giờ. Xoá dữ liệu = ẩn danh hoá hồ sơ, giữ chứng từ tài chính." />
      <Tabs tabs={[{ key: 'OPEN', label: 'Đang chờ', count: (items ?? []).filter((r) => r.status === 'OPEN').length }, { key: 'ALL', label: 'Tất cả', count: items?.length ?? 0 }]} value={tab} onChange={setTab} />
      <Card className="mt-4">
        <Table rows={rows} rowKey={(r) => r._id} onRowClick={(r) => { setView(r); setResponse(''); }} empty={<EmptyState title={items === null ? 'Đang tải…' : 'Không có yêu cầu'} />} columns={[
          { key: 'n', header: 'Yêu cầu', cell: (r) => <div><p className="font-medium">{PRIVACY_REQUEST_TYPE[r.type]}</p><p className="font-mono text-xs text-stone-500">{r.requestNumber}</p></div> },
          { key: 'c', header: 'Khách hàng', cell: (r) => <div><p>{r.customer?.fullName ?? '—'}</p><p className="text-xs text-stone-500">{r.customer?.email}</p></div> },
          { key: 'd', header: 'Hạn phản hồi', cell: (r) => overdue(r) ? <Badge tone="red">Quá hạn · {fmtDateTime(r.dueAt)}</Badge> : <span className="text-xs">{fmtDateTime(r.dueAt)}</span> },
          { key: 's', header: 'Trạng thái', cell: (r) => <StatusBadge map={PRIVACY_REQUEST_STATUS} value={r.status} /> },
        ]} />
      </Card>

      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${PRIVACY_REQUEST_TYPE[view.type]} · ${view.requestNumber}` : ''}
        description={view?.customer ? `${view.customer.fullName} · ${view.customer.email}${view.customer.phone ? ` · ${view.customer.phone}` : ''}` : undefined}
        footer={view?.status === 'OPEN' ? <>
          {view.type === 'DELETION' && <Button variant="danger" onClick={() => void anonymize()}>Ẩn danh hoá tài khoản</Button>}
          <Button variant="secondary" disabled={response.trim().length < 5} onClick={() => void resolve('REJECTED')}>Từ chối</Button>
          <Button disabled={response.trim().length < 5} onClick={() => void resolve('DONE')}>Đã xử lý</Button>
        </> : <Button variant="secondary" onClick={() => setView(null)}>Đóng</Button>}>
        {view && (
          <div className="space-y-4 text-sm">
            <p><span className="text-stone-500">Gửi lúc</span> {fmtDateTime(view.createdAt)} · <span className="text-stone-500">hạn phản hồi</span> {fmtDateTime(view.dueAt)}</p>
            <p className="whitespace-pre-line rounded-lg bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">{view.note || '(khách không ghi nội dung)'}</p>
            {view.status === 'OPEN' ? (
              <Field label="Phản hồi cho khách" hint="Tối thiểu 5 ký tự — khách thấy trong mục Dữ liệu cá nhân; ghi vào nhật ký.">
                <textarea className={inputCls} rows={3} value={response} onChange={(e) => setResponse(e.target.value)} />
              </Field>
            ) : (
              <p><span className="text-stone-500">Phản hồi:</span> {view.response}</p>
            )}
            {view.type === 'DELETION' && view.status === 'OPEN' && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">Ẩn danh hoá chỉ chạy khi khách không còn hợp đồng / đặt chỗ đang mở và không còn nợ; xong thì yêu cầu tự đóng.</p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
