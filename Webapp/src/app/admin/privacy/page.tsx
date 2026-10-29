'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Ban, CalendarClock, FileSearch, Files, Inbox, List, Mail, MessageSquareText, PenLine, Send, ShieldCheck, Timer, TimerOff, TriangleAlert, Undo2, UserRound, UserX, type LucideIcon } from 'lucide-react';
import { PRIVACY_REQUEST_STATUS, PRIVACY_REQUEST_TYPE, type PrivacyRequest } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { fmtDateTime } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, IconTile, Modal, PageHeader, StatCard, StatusBadge, inputCls } from '@/shared/ui';
import { Callout, ChipRow, Fact, FactGrid, Meta, PillFilter, QueueRow } from '@/features/staff-ui';
import { Section, TextBlock } from '@/features/backoffice-ui';

/** Loại yêu cầu → icon (chỉ để trình bày). */
const TYPE_ICON: Record<PrivacyRequest['type'], LucideIcon> = {
  ACCESS: FileSearch, CORRECTION: PenLine, DELETION: UserX, WITHDRAW_CONSENT: Undo2, OBJECTION: Ban,
};

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

  // ---- Chỉ để trình bày: số yêu cầu đang chờ / quá hạn cho thẻ số liệu.
  const openCount = (items ?? []).filter((r) => r.status === 'OPEN').length;
  const overdueCount = (items ?? []).filter(overdue).length;

  return (
    <>
      <PageHeader title="Yêu cầu dữ liệu cá nhân" description="Phản hồi trong 72 giờ (NĐ 13/2023)." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label="Đang chờ xử lý" value={items === null ? '…' : openCount} icon={<Inbox className="size-5" />} tone={openCount ? 'amber' : 'green'} />
        <StatCard label="Quá hạn phản hồi" value={items === null ? '…' : overdueCount} icon={<TimerOff className="size-5" />} tone={overdueCount ? 'red' : 'green'} sub="Quá 72 giờ mà chưa xử lý" />
        <StatCard label="Tổng yêu cầu" value={items === null ? '…' : items.length} icon={<Files className="size-5" />} tone="gray" className="col-span-2 lg:col-span-1" />
      </div>
      <PillFilter value={tab} onChange={setTab} options={[
        { key: 'OPEN', label: 'Đang chờ', icon: <Inbox />, count: (items ?? []).filter((r) => r.status === 'OPEN').length },
        { key: 'ALL', label: 'Tất cả', icon: <List />, count: items?.length ?? 0 },
      ]} />
      <Card className="mt-4">
        {rows.length === 0 ? <EmptyState icon={<ShieldCheck className="size-6" />} title={items === null ? 'Đang tải…' : 'Không có yêu cầu'} /> : (
          <ul className="divide-y divide-stone-100">
            {rows.map((r) => {
              const Icon = TYPE_ICON[r.type] ?? FileSearch;
              const late = overdue(r);
              return (
                <QueueRow key={r._id} onSelect={() => { setView(r); setResponse(''); }}
                  lead={<IconTile icon={<Icon className="size-4" />} tone={late ? 'red' : r.status === 'OPEN' ? (r.type === 'DELETION' ? 'amber' : 'violet') : 'gray'} />}
                  title={PRIVACY_REQUEST_TYPE[r.type]}
                  badges={<><StatusBadge map={PRIVACY_REQUEST_STATUS} value={r.status} />{late && <Badge tone="red" dot>Quá hạn</Badge>}</>}
                  meta={<>
                    <Meta mono>{r.requestNumber}</Meta>
                    <Meta icon={<UserRound />}>{r.customer?.fullName ?? '—'}</Meta>
                    {r.customer?.email && <Meta icon={<Mail />}>{r.customer.email}</Meta>}
                    <Meta icon={<Timer />} className={late ? 'font-medium text-red-700' : undefined}>Hạn {fmtDateTime(r.dueAt)}</Meta>
                  </>}
                  actions={<ArrowRight className="size-4 text-stone-300" aria-hidden />}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${PRIVACY_REQUEST_TYPE[view.type]} · ${view.requestNumber}` : ''}
        description={view?.customer ? `${view.customer.fullName} · ${view.customer.email}${view.customer.phone ? ` · ${view.customer.phone}` : ''}` : undefined}
        footer={view?.status === 'OPEN' ? <>
          {view.type === 'DELETION' && <Button variant="danger" onClick={() => void anonymize()}><UserX className="size-4" />Ẩn danh hoá tài khoản</Button>}
          <Button variant="secondary" disabled={response.trim().length < 5} onClick={() => void resolve('REJECTED')}>Từ chối</Button>
          <Button disabled={response.trim().length < 5} onClick={() => void resolve('DONE')}>Đã xử lý</Button>
        </> : <Button variant="secondary" onClick={() => setView(null)}>Đóng</Button>}>
        {view && (
          <div className="space-y-4 text-sm">
            <ChipRow>
              <StatusBadge map={PRIVACY_REQUEST_STATUS} value={view.status} />
              {overdue(view) && <Badge tone="red" dot>Quá hạn phản hồi</Badge>}
            </ChipRow>
            <FactGrid>
              <Fact icon={<CalendarClock className="size-4" />} label="Gửi lúc">{fmtDateTime(view.createdAt)}</Fact>
              <Fact icon={<Timer className="size-4" />} label="Hạn phản hồi" tone={overdue(view) ? 'red' : view.status === 'OPEN' ? 'amber' : 'gray'}>{fmtDateTime(view.dueAt)}</Fact>
            </FactGrid>
            <Section icon={<MessageSquareText />} title="Nội dung khách gửi">
              <TextBlock>{view.note || '(khách không ghi nội dung)'}</TextBlock>
            </Section>
            {view.status === 'OPEN' ? (
              <Field label="Phản hồi cho khách" tip="Khách đọc được.">
                <textarea className={inputCls} rows={3} value={response} onChange={(e) => setResponse(e.target.value)} />
              </Field>
            ) : (
              <Section icon={<Send />} title="Phản hồi">
                <TextBlock>{view.response}</TextBlock>
              </Section>
            )}
            {view.type === 'DELETION' && view.status === 'OPEN' && (
              <Callout tone="amber" icon={<TriangleAlert />}>Chỉ ẩn danh hoá được khi khách không còn hợp đồng / đặt chỗ đang mở và không còn nợ. Không thể hoàn tác.</Callout>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
