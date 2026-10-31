'use client';

import { useState } from 'react';
import { Banknote, Building2, CalendarDays, CircleCheck, FileText, Landmark, RotateCcw, TriangleAlert, Undo2 } from 'lucide-react';
import { GATEWAY_REFUND_STATE, type GatewayRefundAction, type PaymentTransaction } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { PAYMENT_TYPE } from '@/shared/lib/labels';
import { byId, facilityName, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Badge, Button, EmptyState, Field, IconTile, Modal, StatusBadge, inputCls } from '@/shared/ui';
import { Callout, Meta, QueueRow } from '@/features/staff-ui';

/** Khoản hoàn qua VNPAY phải có người quyết: bị từ chối, hoặc đã gửi mà không rõ kết quả (hệ thống không tự gửi lại, tránh hoàn hai lần). */
export const gatewayRefundsToResolve = (payments: PaymentTransaction[]) => payments
  .filter((p) => p.direction === 'REFUND' && p.method === 'VNPAY' && p.status === 'PENDING' && (p.gatewayRefund?.state === 'REJECTED' || p.gatewayRefund?.state === 'UNKNOWN'))
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const ACTION: Record<GatewayRefundAction, { button: string; title: string; done: string }> = {
  RETRY: { button: 'Gửi lại', title: 'Gửi lại yêu cầu hoàn qua VNPAY', done: 'Đã xếp hàng gửi lại yêu cầu hoàn' },
  TO_BANK_TRANSFER: { button: 'Chuyển sang chuyển khoản', title: 'Chuyển sang hoàn bằng chuyển khoản', done: 'Đã chuyển sang chuyển khoản — người khác xác nhận đã chuyển ở danh sách chờ chuyển khoản' },
  MARK_DONE: { button: 'Xác nhận đã hoàn', title: 'Xác nhận VNPAY đã hoàn xong', done: 'Đã ghi nhận khoản hoàn hoàn tất' },
};

/**
 * Khối "Hoàn qua VNPAY cần xử lý" dùng chung cho trang quản lý chi nhánh và Duyệt & chi của vận hành. Nút theo đúng BE (POST /payments/:id/gateway-refund/resolve):
 * RETRY, TO_BANK_TRANSFER khi REJECTED / UNKNOWN; MARK_DONE chỉ OPS, chỉ UNKNOWN. Ghi chú bắt buộc, làm chứng từ.
 */
export function GatewayRefundQueue({ rows, showFacility }: { rows: PaymentTransaction[]; showFacility?: boolean }) {
  const { db, user, run } = useStore();
  const [picked, setPicked] = useState<{ id: string; action: GatewayRefundAction } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const isOps = user?.role === 'OPS_MANAGER';
  // Theo dòng mới nhất: người khác đã xử lý xong thì dòng biến mất, hộp thoại tự đóng.
  const p = picked ? rows.find((x) => x._id === picked.id) : undefined;
  const action = p && picked ? picked.action : null;
  const unknown = p?.gatewayRefund?.state === 'UNKNOWN';
  const open = (id: string, a: GatewayRefundAction) => { setPicked({ id, action: a }); setNote(''); setError(''); };
  const noteOk = note.trim().length >= 5 && note.trim().length <= 500;

  const submit = async () => {
    if (!p || !action || !noteOk || sending) return;
    setSending(true);
    const res = await run('resolveGatewayRefund', { paymentId: p._id, action, note: note.trim() }, ACTION[action].done, () => setPicked(null));
    setSending(false);
    if (!res.ok) setError(res.error);
  };

  if (rows.length === 0) return <EmptyState icon={<Undo2 className="size-6" />} title="Không có khoản hoàn qua VNPAY nào cần xử lý" />;

  return (
    <>
      <ul className="divide-y divide-stone-100">
        {rows.map((x) => {
          const gr = x.gatewayRefund!;
          const contract = byId(db.contracts, x.contractId);
          return (
            <QueueRow key={x._id}
              lead={<IconTile icon={<Undo2 className="size-4" />} tone="red" />}
              title={userName(db, x.customerId)}
              badges={<>
                <Badge tone={PAYMENT_TYPE[x.type].tone}>{PAYMENT_TYPE[x.type].label}</Badge>
                <span className="text-sm font-semibold tabular-nums text-ink">{vnd(x.amount)}</span>
                <StatusBadge map={GATEWAY_REFUND_STATE} value={gr.state} />
              </>}
              meta={<>
                {showFacility && <Meta icon={<Building2 />}>{facilityName(db, x.facilityId)}</Meta>}
                {x.provider?.orderId && <Meta mono>KA{x.provider.orderId}</Meta>}
                {contract && <Meta icon={<FileText />}>{contract.contractNumber}</Meta>}
                <Meta icon={<CalendarDays />}>{fmtDate(x.createdAt)}</Meta>
                {gr.responseCode && <Meta icon={<TriangleAlert />} className="font-medium text-red-700">Mã lỗi {gr.responseCode}{gr.message ? ` · ${gr.message}` : ''}</Meta>}
              </>}
              actions={<>
                <Button size="sm" variant="secondary" onClick={() => open(x._id, 'RETRY')}><RotateCcw className="size-3.5" />{ACTION.RETRY.button}</Button>
                <Button size="sm" variant="secondary" onClick={() => open(x._id, 'TO_BANK_TRANSFER')}><Landmark className="size-3.5" />{ACTION.TO_BANK_TRANSFER.button}</Button>
                {gr.state === 'UNKNOWN' && (isOps
                  ? <Button size="sm" onClick={() => open(x._id, 'MARK_DONE')}><CircleCheck className="size-3.5" />{ACTION.MARK_DONE.button}</Button>
                  : <span className="self-center text-xs text-stone-500">Xác nhận đã hoàn: chỉ Vận hành</span>)}
              </>}
            />
          );
        })}
      </ul>

      <Modal open={!!p && !!action} onClose={() => setPicked(null)} title={action ? ACTION[action].title : ''}
        description={p ? `${userName(db, p.customerId)} · ${vnd(p.amount)}` : ''}
        footer={<Button disabled={!noteOk || sending} onClick={() => void submit()}>{action ? ACTION[action].button : 'Xác nhận'}</Button>}>
        {p && action && (
          <div className="space-y-4 text-sm">
            {unknown && <Callout tone="red" icon={<TriangleAlert />} title={GATEWAY_REFUND_STATE.UNKNOWN.label}>
              {action === 'MARK_DONE'
                ? 'Chỉ xác nhận khi merchant VNPAY cho thấy khoản này đã hoàn.'
                : 'Yêu cầu trước có thể đã tới VNPAY. Chỉ làm tiếp khi merchant VNPAY cho thấy khoản này chưa hoàn, nếu không khách sẽ được hoàn hai lần.'}
            </Callout>}
            {action === 'TO_BANK_TRANSFER' && <Callout tone="amber" icon={<Banknote />}>Khoản này chuyển vào danh sách chờ chuyển khoản. Bạn không tự xác nhận được: người khác xác nhận sau khi đã chuyển tiền.</Callout>}
            {error && <Callout tone="red" icon={<TriangleAlert />}>{error}</Callout>}
            <Field label="Ghi chú" hint="5–500 ký tự — ghi vào nhật ký kiểm toán, làm chứng từ.">
              <textarea className={inputCls} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={unknown ? 'VD: đã kiểm trên merchant VNPAY lúc 10:30, giao dịch chưa hoàn' : 'VD: VNPAY từ chối do giao dịch quá hạn hoàn'} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
