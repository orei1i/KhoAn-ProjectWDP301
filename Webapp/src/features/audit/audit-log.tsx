'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Building2, CircleCheck, Clock, CreditCard, FileText, Info, List, ListChecks, ScrollText, ShieldX, Tag, TriangleAlert, UserRound } from 'lucide-react';
import { AUDIT_ENTITY, auditActionLabel, auditChangeRows, auditSummary, fmtAuditTime, type AuditLog, type AuditNameResolver, type Role } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { ROLE } from '@/shared/lib/labels';
import { byId, facilityName, userName } from '@/shared/lib/domain';
import type { DB } from '@/shared/lib/mock-data';
import { Badge, Button, Card, Disclosure, EmptyState, IconTile, Modal, PageHeader, Table, Tabs, cx, inputCls } from '@/shared/ui';
import { Chip, ChipRow, Fact, FactGrid, Meta, PanelHeader, PillFilter, QueueRow } from '@/features/staff-ui';
import { SearchInput, Section, TextBlock } from '@/features/backoffice-ui';

type Tab = 'ALL' | 'DENIED' | 'auth' | 'payment' | 'contract';
/** GET /audit populate sẵn người thực hiện (họ tên, email, vai trò); tài khoản đã xoá thì null. `entityLabel`: tên đọc được của đối tượng. */
type Actor = { _id: string; fullName: string; email?: string; role?: Role };
type Row = Omit<AuditLog, 'actorId'> & { actorId?: Actor | string | null; entityLabel?: string | null };
const PAGE_SIZE = 100;

/** Mã nội bộ trong nội dung thay đổi → tên (chi nhánh, người dùng, ô kho); không biết thì ẩn mục đó. */
const nameResolver = (db: DB): AuditNameResolver => (key, id) => {
  if (key.startsWith('facility')) return byId(db.facilities, id)?.name ?? null;
  if (/unit(Id|s)?$/i.test(key) && !/type/i.test(key)) return byId(db.units, id)?.unitNumber ?? null;
  return byId(db.users, id)?.fullName ?? null;
};

const resultOf = (a: Row) => (a.result === 'SUCCESS' ? { tone: 'green' as const, label: 'Thành công', Icon: CircleCheck }
  : a.result === 'DENIED' ? { tone: 'red' as const, label: 'Bị từ chối', Icon: ShieldX } : { tone: 'amber' as const, label: 'Lỗi', Icon: TriangleAlert });
const roleOf = (role?: string | null) => (role && role !== 'SYSTEM' && role !== 'ANONYMOUS' && role in ROLE ? ROLE[role as Role].label : null);
/** "Hợp đồng CTR-261111-HUHYAH" — không bao giờ in ObjectId. */
const entityOf = (a: Row) => {
  if (!a.entityType) return null;
  const kind = AUDIT_ENTITY[a.entityType] ?? 'Đối tượng';
  return a.entityLabel ? `${kind} ${a.entityLabel}` : kind;
};

/**
 * Nhật ký tải theo trang từ GET /audit (mới nhất trước, mỗi lần 100 bản ghi, "Tải thêm" để xem cũ hơn). Tab lọc ngay trên máy chủ
 * (kết quả bị từ chối / tiền tố hành động); ô tìm kiếm lọc trong các bản ghi đã tải. Thông báo tự động thường lệ (nhắc hết hạn, dọn
 * dữ liệu — ROUTINE_AUDIT_ACTIONS) ẩn mặc định bằng `excludeRoutine=1`, bật "Hiện thông báo tự động" để xem.
 * Dùng chung cho Admin (toàn hệ thống), Vận hành chuỗi (toàn chuỗi) và Quản lý chi nhánh (server chỉ trả nhật ký chi nhánh mình).
 * Người đọc không rành kỹ thuật: tên hành động tiếng Việt, tóm tắt một dòng, bảng thay đổi đọc được. Dữ liệu gốc (JSON) chỉ Admin xem,
 * thu gọn ở cuối hộp chi tiết.
 * `variant="rich"`: danh sách dòng có icon kết quả; mặc định `table`: bảng.
 */
export function AuditLogView({ title, description, variant = 'table' }: { title: string; description?: string; variant?: 'table' | 'rich' }) {
  const { db, user } = useStore();
  const [tab, setTab] = useState<Tab>('ALL');
  const [fid, setFid] = useState('');
  const [routine, setRoutine] = useState(false); // hiện thông báo tự động — tắt mặc định
  const facilities = db.facilities.filter((f) => !f.isDeleted && (user?.role !== 'FACILITY_MANAGER' || user.facilityIds.includes(f._id)));
  const [q, setQ] = useState('');
  const [view, setView] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [page, setPage] = useState(0); // số trang đã tải
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0); // đổi bộ lọc khi lần tải trước chưa xong → bỏ kết quả cũ
  const names = useMemo(() => nameResolver(db), [db]);

  const load = useCallback(async (t: Tab, f: string, withRoutine: boolean, p: number) => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
    if (t === 'DENIED') qs.set('result', 'DENIED');
    else if (t !== 'ALL') qs.set('action', t);
    if (f) qs.set('facilityId', f);
    if (!withRoutine) qs.set('excludeRoutine', '1');
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
    void load(tab, fid, routine, 1);
  }, [tab, fid, routine, load]);

  const actorOf = useCallback((a: Row) => {
    const obj = a.actorId && typeof a.actorId === 'object' ? a.actorId : null;
    if (obj) return { name: obj.fullName, role: roleOf(obj.role ?? a.actorRole), email: obj.email ?? null };
    if (a.actorId) return { name: userName(db, a.actorId as string), role: roleOf(a.actorRole), email: byId(db.users, a.actorId as string)?.email ?? null };
    if (a.actorRole === 'SYSTEM') return { name: 'Hệ thống', role: null, email: null };
    // Có vai trò mà không còn tài khoản: người dùng đã bị xoá.
    return { name: a.actorRole && a.actorRole !== 'ANONYMOUS' ? 'Tài khoản đã xoá' : 'Ẩn danh', role: roleOf(a.actorRole), email: null };
  }, [db]);
  const actorText = (a: Row) => { const x = actorOf(a); return x.role ? `${x.name} · ${x.role}` : x.name; };
  const summaryOf = useCallback((a: Row) => auditSummary(a, names), [names]);

  const rows = useMemo(() => (q
    ? items.filter((a) => `${auditActionLabel(a.action)} ${a.action} ${summaryOf(a)} ${a.reason ?? ''} ${a.entityLabel ?? ''} ${actorOf(a).name}`.toLowerCase().includes(q.toLowerCase()))
    : items), [items, q, actorOf, summaryOf]);

  const routineToggle = (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
      <input type="checkbox" className="size-4" checked={routine} onChange={(e) => setRoutine(e.target.checked)} />
      Hiện thông báo tự động
    </label>
  );
  const facilitySelect = facilities.length > 1 && (
    <select className={cx(inputCls, 'w-full sm:w-52')} aria-label="Chi nhánh" value={fid} onChange={(e) => setFid(e.target.value)}>
      <option value="">Mọi chi nhánh</option>
      {facilities.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
    </select>
  );
  const footer = items.length > 0 && (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-xs text-stone-500">
      <span>Đã tải {items.length.toLocaleString('vi-VN')} bản ghi{q ? ` · khớp tìm kiếm ${rows.length.toLocaleString('vi-VN')}` : ''}{hasMore ? '' : ' · hết nhật ký'}</span>
      {error && <span className="text-red-600">{error}</span>}
      {hasMore && <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load(tab, fid, routine, page + 1)}>{loading ? 'Đang tải…' : 'Tải thêm'}</Button>}
    </div>
  );
  const detail = (
    <Modal open={!!view} onClose={() => setView(null)} title={view ? auditActionLabel(view.action) : ''} description={view ? fmtAuditTime(view.at) : ''} size="lg">
      {view && <AuditDetail a={view} actor={actorOf(view)} names={names} facility={view.facilityId ? facilityName(db, view.facilityId) : null} showRaw={user?.role === 'ADMIN'} />}
    </Modal>
  );

  if (variant === 'rich') {
    const okCount = items.filter((a) => a.result === 'SUCCESS').length;
    const deniedCount = items.filter((a) => a.result === 'DENIED').length;
    return (
      <>
        <PageHeader title={title} description={description ?? 'Chỉ ghi thêm, không sửa hay xoá được.'} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillFilter value={tab} onChange={setTab} options={[
            { key: 'ALL', label: 'Tất cả', icon: <List /> }, { key: 'DENIED', label: 'Bị từ chối', icon: <ShieldX /> },
            { key: 'auth', label: 'Tài khoản', icon: <UserRound /> }, { key: 'payment', label: 'Thanh toán', icon: <CreditCard /> }, { key: 'contract', label: 'Hợp đồng', icon: <FileText /> },
          ]} />
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {routineToggle}
            {facilitySelect}
            <SearchInput className="w-full sm:w-64" value={q} onChange={setQ} placeholder="Tìm trong các bản ghi đã tải" />
          </div>
        </div>
        <Card className="mt-4">
          <PanelHeader icon={<ScrollText className="size-4" />} tone="gray" title="Bản ghi" count={rows.length}
            tip="Mới nhất trước, mỗi lần tải 100 bản ghi. Ô tìm kiếm chỉ lọc trong các bản ghi đã tải. Nhắc hết hạn và dọn dữ liệu tự động đang ẩn, trừ khi bật Hiện thông báo tự động."
            action={items.length > 0 && (
              <ChipRow>
                <Chip icon={<CircleCheck />} tone="green">Thành công {okCount.toLocaleString('vi-VN')}</Chip>
                {deniedCount > 0 && <Chip icon={<ShieldX />} tone="red">Từ chối {deniedCount.toLocaleString('vi-VN')}</Chip>}
              </ChipRow>
            )} />
          {rows.length === 0 ? (
            <EmptyState icon={<ScrollText className="size-6" />} title={error ? 'Không tải được nhật ký' : loading ? 'Đang tải…' : 'Không có bản ghi'} description={error ?? undefined} />
          ) : (
            <ul className="divide-y divide-stone-100">
              {rows.map((a) => {
                const r = resultOf(a);
                const summary = summaryOf(a);
                const entity = entityOf(a);
                return (
                  <QueueRow key={a._id} onSelect={() => setView(a)}
                    lead={<IconTile icon={<r.Icon className="size-4" />} tone={r.tone} size="sm" />}
                    title={auditActionLabel(a.action)}
                    badges={a.result !== 'SUCCESS' && <Badge tone={r.tone} dot>{r.label}</Badge>}
                    meta={<>
                      <Meta icon={<UserRound />}>{actorText(a)}</Meta>
                      {entity && <Meta icon={<Tag />}>{entity}</Meta>}
                      {a.facilityId && <Meta icon={<Building2 />}>{facilityName(db, a.facilityId)}</Meta>}
                      <Meta icon={<Clock />}>{fmtAuditTime(a.at, false)}</Meta>
                      {summary && <Meta icon={<Info />} className="max-w-md">{summary}</Meta>}
                    </>}
                  />
                );
              })}
            </ul>
          )}
          {footer}
        </Card>
        {detail}
      </>
    );
  }

  return (
    <>
      <PageHeader title={title} description={description ?? 'Chỉ ghi thêm, không sửa hay xoá được.'} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={[
          { key: 'ALL', label: 'Tất cả' }, { key: 'DENIED', label: 'Bị từ chối' },
          { key: 'auth', label: 'Tài khoản' }, { key: 'payment', label: 'Thanh toán' }, { key: 'contract', label: 'Hợp đồng' },
        ]} value={tab} onChange={setTab} />
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {routineToggle}
          {facilitySelect}
          <input className={cx(inputCls, 'w-full sm:w-64')} placeholder="Tìm trong các bản ghi đã tải" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card className="mt-4">
        <Table rows={rows} rowKey={(a) => a._id} onRowClick={setView}
          empty={<EmptyState title={error ? 'Không tải được nhật ký' : loading ? 'Đang tải…' : 'Không có bản ghi'} description={error ?? undefined} />}
          columns={[
            { key: 't', header: 'Thời gian', cell: (a) => <span className="whitespace-nowrap text-xs">{fmtAuditTime(a.at, false)}</span> },
            { key: 'r', header: 'Kết quả', cell: (a) => { const r = resultOf(a); return <Badge tone={r.tone} dot>{r.label}</Badge>; } },
            { key: 'a', header: 'Hành động', cell: (a) => <div><p className="text-sm">{auditActionLabel(a.action)}</p>{entityOf(a) && <p className="text-xs text-stone-500">{entityOf(a)}</p>}</div> },
            { key: 'u', header: 'Người thực hiện', cell: (a) => { const x = actorOf(a); return <div><p className="text-sm">{x.name}</p>{x.role && <p className="text-xs text-stone-500">{x.role}</p>}</div>; } },
            { key: 'f', header: 'Chi nhánh', cell: (a) => <span className="text-xs">{a.facilityId ? facilityName(db, a.facilityId) : '—'}</span> },
            { key: 'd', header: 'Chi tiết', cell: (a) => <span className="line-clamp-1 max-w-xs text-xs text-stone-600">{summaryOf(a) || '—'}</span> },
          ]} />
        {footer}
      </Card>
      {detail}
    </>
  );
}

/**
 * Hộp chi tiết một bản ghi, cho người đọc không rành kỹ thuật: kết quả (kèm lý do), người thực hiện (tên · vai trò, email), đối tượng
 * (loại + mã đọc được), bảng thay đổi "Mục | Trước | Sau". Chi nhánh / IP / requestId gom thành một dòng "Thông tin kỹ thuật" ở cuối;
 * dữ liệu gốc (JSON) chỉ Admin thấy, thu gọn.
 */
function AuditDetail({ a, actor, names, facility, showRaw }: {
  a: Row; actor: { name: string; role: string | null; email: string | null }; names: AuditNameResolver; facility: string | null; showRaw: boolean;
}) {
  const r = resultOf(a);
  const entity = entityOf(a);
  const changes = auditChangeRows(a, names);
  const hasBefore = changes.some((x) => x.before !== null);
  const tech = [facility && `Chi nhánh ${facility}`, a.ip && `IP ${a.ip}`, a.requestId && `Mã yêu cầu ${a.requestId}`].filter(Boolean).join(' · ');
  return (
    <div className="space-y-4 text-sm">
      <FactGrid>
        <Fact icon={<r.Icon className="size-4" />} label="Kết quả" tone={r.tone}>{r.label}</Fact>
        <Fact icon={<UserRound className="size-4" />} label="Người thực hiện">
          <span>{actor.role ? `${actor.name} · ${actor.role}` : actor.name}</span>
          {actor.email && <span className="block text-xs font-normal text-stone-500">{actor.email}</span>}
        </Fact>
        {entity && <Fact icon={<Tag className="size-4" />} label="Đối tượng">{entity}</Fact>}
      </FactGrid>
      {a.reason && <Section icon={<Info />} title={a.result === 'SUCCESS' ? 'Lý do / ghi chú' : 'Lý do từ chối'}><TextBlock>{a.reason}</TextBlock></Section>}
      {changes.length > 0 && (
        <Section icon={<ListChecks />} title="Nội dung thay đổi">
          <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-stone-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500">
                <tr><th className="px-3 py-2 font-medium">Mục</th>{hasBefore && <th className="px-3 py-2 font-medium">Trước</th>}<th className="px-3 py-2 font-medium">{hasBefore ? 'Sau' : 'Giá trị'}</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {changes.map((x) => (
                  <tr key={x.key} className={cx(hasBefore && x.before !== x.after && 'bg-amber-50/40')}>
                    <td className="px-3 py-2 text-stone-600">{x.label}</td>
                    {hasBefore && <td className="px-3 py-2 tabular-nums text-stone-500">{x.before ?? '—'}</td>}
                    <td className="px-3 py-2 tabular-nums">{x.after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {a.anonymizedAt && <p className="text-xs text-stone-500">Bản ghi đã quá thời hạn lưu nên đã được ẩn danh (bỏ người thực hiện và nội dung).</p>}
      {tech && <p className="text-xs text-stone-400">Thông tin kỹ thuật: {tech}</p>}
      {showRaw && (
        <Disclosure icon={<Braces className="size-4" />} title="Dữ liệu kỹ thuật">
          <pre className="overflow-x-auto rounded-lg bg-ink p-4 text-xs leading-relaxed text-stone-100">{JSON.stringify(a, null, 2)}</pre>
        </Disclosure>
      )}
    </div>
  );
}
