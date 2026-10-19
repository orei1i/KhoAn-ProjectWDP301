'use client';

import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AuditLog } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { ROLE } from '@/shared/lib/labels';
import { facilityName, userName } from '@/shared/lib/domain';
import { fmtDateTime } from '@/shared/lib/format';
import { Badge, Card, Modal, PageHeader, Table, Tabs, cx, inputCls } from '@/shared/ui';

type Tab = 'ALL' | 'DENIED' | 'auth' | 'payment' | 'contract';

export default function Audit() {
  const { db } = useStore();
  const [tab, setTab] = useState<Tab>('ALL');
  const [q, setQ] = useState('');
  const [view, setView] = useState<AuditLog | null>(null);
  const rows = useMemo(() => db.audit.filter((a) => {
    if (tab === 'DENIED' && a.result !== 'DENIED') return false;
    if (tab !== 'ALL' && tab !== 'DENIED' && !a.action.startsWith(tab)) return false;
    return !q || `${a.action} ${a.reason ?? ''} ${a.actorId ? userName(db, a.actorId) : ''}`.toLowerCase().includes(q.toLowerCase());
  }), [db, tab, q]);

  return (
    <>
      <PageHeader title="Nhật ký kiểm toán" description="Chỉ ghi thêm (append-only): không thể sửa hay xóa từ ứng dụng. Mọi thao tác bị từ chối do phân quyền cũng được ghi lại." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={[
          { key: 'ALL', label: 'Tất cả', count: db.audit.length }, { key: 'DENIED', label: 'Bị từ chối', count: db.audit.filter((a) => a.result === 'DENIED').length },
          { key: 'auth', label: 'Đăng nhập' }, { key: 'payment', label: 'Thanh toán' }, { key: 'contract', label: 'Hợp đồng' },
        ]} value={tab} onChange={setTab} />
        <input className={cx(inputCls, 'w-full sm:w-64')} placeholder="Tìm hành động, người, lý do" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="mt-4">
        <Table rows={rows} rowKey={(a) => a._id} onRowClick={setView} columns={[
          { key: 't', header: 'Thời gian', cell: (a) => <span className="whitespace-nowrap text-xs">{fmtDateTime(a.at)}</span> },
          { key: 'r', header: 'Kết quả', cell: (a) => <Badge tone={a.result === 'SUCCESS' ? 'green' : 'red'} dot>{a.result === 'SUCCESS' ? 'Thành công' : a.result === 'DENIED' ? 'Từ chối' : 'Lỗi'}</Badge> },
          { key: 'a', header: 'Hành động', cell: (a) => <span className="font-mono text-xs">{a.action}</span> },
          { key: 'u', header: 'Người thực hiện', cell: (a) => <div><p className="text-sm">{a.actorId ? userName(db, a.actorId) : a.actorRole === 'SYSTEM' ? 'Hệ thống' : 'Ẩn danh'}</p>{a.actorRole && a.actorRole !== 'SYSTEM' && a.actorRole !== 'ANONYMOUS' && <p className="text-xs text-stone-500">{ROLE[a.actorRole].label}</p>}</div> },
          { key: 'f', header: 'Chi nhánh', cell: (a) => <span className="text-xs">{a.facilityId ? facilityName(db, a.facilityId) : '—'}</span> },
          { key: 'd', header: 'Chi tiết', cell: (a) => <span className="line-clamp-1 max-w-xs text-xs text-stone-600">{a.reason ?? (a.changes ? JSON.stringify(a.changes.after ?? a.changes) : '—')}</span> },
        ]} />
      </Card>

      <Modal open={!!view} onClose={() => setView(null)} title={view?.action ?? ''} description={view ? fmtDateTime(view.at) : ''} size="lg">
        {view && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-xs text-stone-500"><ShieldCheck className="size-4" />Bản ghi bất biến · requestId {view.requestId} · IP {view.ip}</p>
            <pre className="overflow-x-auto rounded-lg bg-ink p-4 text-xs leading-relaxed text-stone-100">{JSON.stringify(view, null, 2)}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}
