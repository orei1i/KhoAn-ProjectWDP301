'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AuditLog, Role } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { ROLE } from '@/shared/lib/labels';
import { facilityName, userName } from '@/shared/lib/domain';
import { fmtDateTime } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Table, Tabs, cx, inputCls } from '@/shared/ui';

type Tab = 'ALL' | 'DENIED' | 'auth' | 'payment' | 'contract';
/** GET /audit populate sẵn người thực hiện (họ tên, email, vai trò); tài khoản đã xoá thì null. */
type Actor = { _id: string; fullName: string; email?: string; role?: Role };
type Row = Omit<AuditLog, 'actorId'> & { actorId?: Actor | string | null };
const PAGE_SIZE = 100;

/**
 * Nhật ký tải theo trang từ GET /audit (mới nhất trước, mỗi lần 100 bản ghi, "Tải thêm" để xem cũ hơn) — trước đây chỉ thấy 500 bản
 * ghi mới nhất gửi kèm bootstrap. Tab lọc ngay trên máy chủ (kết quả bị từ chối / tiền tố hành động); ô tìm kiếm lọc trong các bản ghi đã tải.
 */
export default function Audit() {
  const { db } = useStore();
  const [tab, setTab] = useState<Tab>('ALL');
  const [q, setQ] = useState('');
  const [view, setView] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [page, setPage] = useState(0); // số trang đã tải
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0); // đổi tab khi lần tải trước chưa xong → bỏ kết quả cũ

  const load = useCallback(async (t: Tab, p: number) => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
    if (t === 'DENIED') qs.set('result', 'DENIED');
    else if (t !== 'ALL') qs.set('action', t);
    try {
      const res = await api.get<{ items: Row[] }>(`/audit?${qs.toString()}`);
      if (id !== reqId.current) return;
      // Phân trang theo skip: có bản ghi mới chen vào đầu thì trang sau lặp lại vài dòng cuối trang trước → bỏ trùng theo _id.
      setItems((prev) => {
        if (p === 1) return res.items;
        const seen = new Set(prev.map((a) => a._id));
        return [...prev, ...res.items.filter((a) => !seen.has(a._id))];
      });
      setPage(p);
      setHasMore(res.items.length === PAGE_SIZE);
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : 'Không tải được nhật ký');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItems([]); setPage(0); setHasMore(false);
    void load(tab, 1);
  }, [tab, load]);

  const actorName = useCallback((a: Row) => {
    if (a.actorId && typeof a.actorId === 'object') return a.actorId.fullName;
    if (a.actorId) return userName(db, a.actorId);
    if (a.actorRole === 'SYSTEM') return 'Hệ thống';
    return a.actorRole && a.actorRole !== 'ANONYMOUS' ? '—' : 'Ẩn danh'; // có vai trò mà không còn tài khoản: người dùng đã bị xoá
  }, [db]);

  const rows = useMemo(() => (q
    ? items.filter((a) => `${a.action} ${a.reason ?? ''} ${actorName(a)}`.toLowerCase().includes(q.toLowerCase()))
    : items), [items, q, actorName]);

  return (
    <>
      <PageHeader title="Nhật ký kiểm toán" description="Chỉ ghi thêm (append-only): không thể sửa hay xóa từ ứng dụng. Mọi thao tác bị từ chối do phân quyền cũng được ghi lại." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={[
          { key: 'ALL', label: 'Tất cả' }, { key: 'DENIED', label: 'Bị từ chối' },
          { key: 'auth', label: 'Đăng nhập' }, { key: 'payment', label: 'Thanh toán' }, { key: 'contract', label: 'Hợp đồng' },
        ]} value={tab} onChange={setTab} />
        <input className={cx(inputCls, 'w-full sm:w-64')} placeholder="Tìm trong các bản ghi đã tải" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="mt-4">
        <Table rows={rows} rowKey={(a) => a._id} onRowClick={setView}
          empty={<EmptyState title={error ? 'Không tải được nhật ký' : loading ? 'Đang tải…' : 'Không có bản ghi'} description={error ?? undefined} />}
          columns={[
            { key: 't', header: 'Thời gian', cell: (a) => <span className="whitespace-nowrap text-xs">{fmtDateTime(a.at)}</span> },
            { key: 'r', header: 'Kết quả', cell: (a) => <Badge tone={a.result === 'SUCCESS' ? 'green' : 'red'} dot>{a.result === 'SUCCESS' ? 'Thành công' : a.result === 'DENIED' ? 'Từ chối' : 'Lỗi'}</Badge> },
            { key: 'a', header: 'Hành động', cell: (a) => <span className="font-mono text-xs">{a.action}</span> },
            { key: 'u', header: 'Người thực hiện', cell: (a) => <div><p className="text-sm">{actorName(a)}</p>{a.actorRole && a.actorRole !== 'SYSTEM' && a.actorRole !== 'ANONYMOUS' && <p className="text-xs text-stone-500">{ROLE[a.actorRole].label}</p>}</div> },
            { key: 'f', header: 'Chi nhánh', cell: (a) => <span className="text-xs">{a.facilityId ? facilityName(db, a.facilityId) : '—'}</span> },
            { key: 'd', header: 'Chi tiết', cell: (a) => <span className="line-clamp-1 max-w-xs text-xs text-stone-600">{a.reason ?? (a.changes ? JSON.stringify(a.changes.after ?? a.changes) : '—')}</span> },
          ]} />
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-xs text-stone-500">
            <span>Đã tải {items.length.toLocaleString('vi-VN')} bản ghi{q ? ` · khớp tìm kiếm ${rows.length.toLocaleString('vi-VN')}` : ''}{hasMore ? '' : ' · hết nhật ký'}</span>
            {error && <span className="text-red-600">{error}</span>}
            {hasMore && <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load(tab, page + 1)}>{loading ? 'Đang tải…' : 'Tải thêm'}</Button>}
          </div>
        )}
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
