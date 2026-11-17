'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, CalendarDays, TriangleAlert, Undo2, UserRound, Wallet } from 'lucide-react';
import type { CounterOrderRow } from '@ssm/shared';
import { actions } from '@/shared/api/actions';
import { useStore } from '@/shared/store/store';
import { facilityName } from '@/shared/lib/domain';
import { fmtDateTime, vnd } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, IconTile, Modal, inputCls } from '@/shared/ui';
import { Callout, Meta, PanelHeader, QueueRow } from '@/features/staff-ui';

const REFRESH_MS = 30_000;

/**
 * Góp ý 17/11 — các lệnh VNPAY tại quầy đã PAID mà chưa thao tác nào dùng, chưa trả lại khách (GET /payments/counter-orders, theo phạm vi người xem).
 * Tự tải lại mỗi 30 giây khi tab đang hiện. Không nằm trong ảnh chụp dữ liệu của store nên tải riêng.
 */
export function useUnusedCounterOrders(facilityId?: string) {
  const [rows, setRows] = useState<CounterOrderRow[]>([]);
  const reload = useCallback(async () => {
    try { setRows(await actions.counterOrders({ facilityId })); } catch { /* lần sau tải lại */ }
  }, [facilityId]);
  useEffect(() => {
    void reload();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);
  return { rows, reload };
}

/**
 * Danh sách + hộp "Trả lại khách" (Quản lý chi nhánh / vận hành). Trả lại: lệnh có khách + đặt chỗ / hợp đồng → khoản hoàn chuyển khoản chờ người khác xác nhận đã
 * chuyển; lượt đặt tại quầy cho khách mới bỏ dở → chỉ ghi chú cách đã hoàn ngoài hệ thống. `emptyText`: hiện khi không có dòng nào (không truyền thì không hiện gì).
 */
export function CounterOrdersList({ rows, onChanged, showFacility, emptyText }: { rows: CounterOrderRow[]; onChanged: () => void; showFacility?: boolean; emptyText?: string }) {
  const { db, user, run, busy } = useStore();
  const [release, setRelease] = useState<CounterOrderRow | null>(null);
  const [note, setNote] = useState('');
  if (!user) return null;
  if (rows.length === 0) return emptyText ? <EmptyState icon={<Wallet className="size-6" />} title={emptyText} /> : null;
  const canRelease = user.role === 'FACILITY_MANAGER' || user.role === 'OPS_MANAGER';

  const submit = () => release && void run('releaseCounterOrder', { txnRef: release.txnRef, note },
    (v) => (v.refundPaymentId ? `Đã lập khoản hoàn ${vnd(v.amount)} — chờ người khác xác nhận đã chuyển` : `Đã ghi nhận trả lại ${vnd(v.amount)} ngoài hệ thống`),
    () => { setRelease(null); setNote(''); onChanged(); });

  return (
    <>
      <ul className="divide-y divide-stone-100">
        {rows.map((o) => (
          <QueueRow key={o.txnRef}
            lead={<IconTile icon={<Wallet className="size-4" />} tone="red" />}
            title={<span className="tabular-nums">{vnd(o.amount)} · {o.label}</span>}
            meta={<>
              <Meta mono>{o.transactionNo ?? o.txnRef}</Meta>
              {o.paidAt && <Meta icon={<CalendarDays />}>Trả lúc {fmtDateTime(o.paidAt)}</Meta>}
              {o.openedByName && <Meta icon={<UserRound />}>Mở bởi {o.openedByName}</Meta>}
              {showFacility && <Meta icon={<Building2 />}>{facilityName(db, o.facilityId)}</Meta>}
            </>}
            actions={canRelease && <Button size="sm" variant="dangerOutline" disabled={busy} onClick={() => { setNote(''); setRelease(o); }}><Undo2 className="size-3.5" />Trả lại khách…</Button>}
          />
        ))}
      </ul>
      <Modal open={!!release} onClose={() => setRelease(null)} title="Trả lại khách khoản VNPAY tại quầy"
        description={release ? `${vnd(release.amount)} · ${release.label} · ${release.transactionNo ?? release.txnRef}` : ''}
        footer={<>
          <Button variant="secondary" onClick={() => setRelease(null)}>Đóng</Button>
          <Button variant="danger" disabled={busy || note.trim().length < 5} onClick={submit}><Undo2 className="size-4" />Trả lại khách</Button>
        </>}>
        <div className="space-y-3 text-sm">
          {release?.refundable
            ? <p>Hệ thống lập khoản hoàn <b>chuyển khoản</b> {vnd(release.amount)} cho khách — một người khác xác nhận đã chuyển (mục chờ chuyển khoản / chờ hoàn tiền).</p>
            : <Callout tone="amber" icon={<TriangleAlert />} title="Khách chưa có tài khoản (lượt đặt tại quầy bỏ dở)">Hoàn ngoài hệ thống (merchant VNPAY / chuyển khoản), ghi rõ cách đã hoàn vào ghi chú.</Callout>}
          <Field label="Lý do / cách trả lại (ít nhất 5 ký tự)">
            <textarea className={inputCls} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: khách đổi sang tiền mặt, đã thu tiền mặt ở lượt sau" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/**
 * Góp ý 17/11 — thẻ "VNPAY tại quầy đã thu, chưa ghi nhận" (trang chủ nhân viên, Hợp đồng & công nợ của quản lý chi nhánh): khách đã trả qua VNPAY tại quầy nhưng
 * chưa thao tác nào dùng khoản đó. Tiền không mất: bấm VNPAY lại đúng việc, đúng số tiền thì màn quầy dùng lại ngay; không dùng nữa thì quản lý trả lại khách.
 * Không có dòng nào thì không hiện gì.
 */
export function CounterOrdersQueue({ facilityId, className }: { facilityId?: string; className?: string }) {
  const { user } = useStore();
  const { rows, reload } = useUnusedCounterOrders(facilityId);
  if (!user || rows.length === 0) return null;
  const canRelease = user.role === 'FACILITY_MANAGER' || user.role === 'OPS_MANAGER';
  return (
    <Card className={className}>
      <PanelHeader icon={<Wallet className="size-4" />} tone="red" title="VNPAY tại quầy đã thu, chưa ghi nhận" count={rows.length} />
      <p className="border-b border-stone-100 px-4 pb-3 text-xs text-stone-600 sm:px-5">
        Khách đã trả nhưng chưa thao tác nào dùng khoản này. Bấm “Thanh toán qua VNPAY” lại đúng bước, đúng số tiền thì màn quầy dùng lại ngay{canRelease ? '; không dùng nữa thì trả lại khách.' : '; không dùng nữa thì báo Quản lý chi nhánh trả lại khách.'}
      </p>
      <CounterOrdersList rows={rows} onChanged={() => void reload()} showFacility={user.role === 'OPS_MANAGER'} />
    </Card>
  );
}
