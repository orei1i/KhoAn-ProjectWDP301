'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Archive, Ban, CalendarClock, CircleCheck, FileText, HandCoins, LogOut, MessageSquareWarning, Package, RefreshCw, ShieldAlert, Timer, Trash2, TriangleAlert, Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  ACCOUNT_DELETE_REASON_MIN, CLAIM_STATUS, CONTRACT_STATUS, PAYMENT_TYPE, RESERVATION_STATUS, TICKET_STATUS, fmtDate, vnd,
  type CustomerDeletionBlocker, type CustomerDeletionCheck, type User,
} from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { Button, Field, Modal, Skeleton, cx, inputCls } from '@/shared/ui';
import { Callout } from '@/features/staff-ui';
import { Section } from '@/features/backoffice-ui';

/** 'YYYY-MM-DD' (ngày theo giờ Việt Nam) → dd/mm/yyyy. */
const day = (ymd: string) => fmtDate(`${ymd}T00:00:00.000Z`);

/** Một lý do chặn → icon, tiêu đề ngắn, các dòng chi tiết cụ thể, việc cần làm. Mã lạ: hiện nguyên câu báo của máy chủ. */
function blockerView(b: CustomerDeletionBlocker): { icon: LucideIcon; title: string; lines: { icon: LucideIcon; text: string }[]; todo: string } {
  switch (b.code) {
    case 'HAS_OPEN_CONTRACT': return {
      icon: FileText, title: 'Còn hợp đồng / đặt chỗ đang mở',
      lines: [
        ...b.details.contracts.map((c) => ({ icon: FileText, text: `Đang thuê HĐ ${c.contractNumber} · ${CONTRACT_STATUS[c.status]?.label ?? c.status}` })),
        ...b.details.reservations.map((r) => ({ icon: CalendarClock, text: `Đặt chỗ ${r.code} · ${RESERVATION_STATUS[r.status]?.label ?? r.status}${r.startDate ? ` · nhận kho ${fmtDate(r.startDate)}` : ''}` })),
      ],
      todo: 'Kết thúc hợp đồng, huỷ hoặc hoàn tất đặt chỗ trước.',
    };
    case 'LEFTOVER_HELD': return {
      icon: Package, title: 'Chi nhánh còn giữ đồ khách để lại',
      lines: b.details.contracts.map((c) => ({ icon: Package, text: `HĐ ${c.contractNumber}${c.holdUntil ? ` · giữ đến ${fmtDate(c.holdUntil)}` : ''}` })),
      todo: 'Chi nhánh xử lý xong ở mục Đồ đang giữ.',
    };
    case 'HAS_DEBT': return {
      icon: Wallet, title: `Khách còn nợ ${vnd(b.details.total)}`,
      lines: b.details.contracts.map((c) => ({ icon: Wallet, text: `HĐ ${c.contractNumber} · ${vnd(c.outstanding)}` })),
      todo: 'Thu hoặc xoá nợ trước.',
    };
    case 'HAS_PENDING_PAYOUT': return {
      icon: HandCoins, title: `KhoAn còn phải hoàn ${vnd(b.details.total)}`,
      lines: b.details.payouts.map((p) => ({
        icon: HandCoins,
        text: `${PAYMENT_TYPE[p.type]?.label ?? p.type} ${vnd(p.amount)}${p.contractNumber ? ` · HĐ ${p.contractNumber}` : p.reservationCode ? ` · đặt chỗ ${p.reservationCode}` : ''}`,
      })),
      todo: 'Chuyển tiền cho khách rồi xác nhận đã chi.',
    };
    case 'HAS_OPEN_CLAIM': return {
      icon: ShieldAlert, title: 'Hồ sơ bồi thường đang xử lý',
      lines: b.details.claims.map((c) => ({ icon: ShieldAlert, text: `Bồi thường ${c.claimNumber} · ${CLAIM_STATUS[c.status]?.label ?? c.status}${c.claimedAmount ? ` · yêu cầu ${vnd(c.claimedAmount)}` : ''}` })),
      todo: 'Kết thúc hồ sơ bồi thường trước.',
    };
    case 'HAS_OPEN_TICKET': return {
      icon: MessageSquareWarning, title: 'Khiếu nại thanh toán / biên bản đang xử lý',
      lines: b.details.tickets.map((t) => ({ icon: MessageSquareWarning, text: `Khiếu nại ${t.ticketNumber} · ${TICKET_STATUS[t.status]?.label ?? t.status}` })),
      todo: 'Giải quyết xong khiếu nại trước.',
    };
    case 'DISPUTE_WINDOW_OPEN': return {
      icon: Timer, title: `Còn hạn khiếu nại đến hết ngày ${day(b.details.lastDay)}`,
      lines: b.details.inspections.map((i) => ({ icon: Timer, text: `${i.contractNumber ? `HĐ ${i.contractNumber} · ` : ''}biên bản trả kho ${fmtDate(i.performedAt)} · khiếu nại đến hết ngày ${day(i.lastDay)}` })),
      todo: 'Chờ hết hạn khiếu nại.',
    };
    default: {
      const x = b as { message?: string };
      return { icon: TriangleAlert, title: x.message ?? 'Chưa xoá được', lines: [], todo: '' };
    }
  }
}

function Line({ icon: Icon, tone = 'stone', children }: { icon: LucideIcon; tone?: 'stone' | 'red' | 'green'; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className={cx('mt-0.5 size-4 shrink-0', tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-stone-400')} aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * Xoá tài khoản KHÁCH ở trang Người dùng (= ẩn danh hoá, POST /users/:id/anonymize, nguồn USER_PAGE). Mở là gọi GET /users/:id/deletion-check:
 * còn lý do chặn thì liệt kê đủ kèm chi tiết, nút xoá tắt; không còn thì hiện việc sẽ làm / thứ được giữ, bắt buộc lý do (≥ 10 ký tự) và
 * tích xác nhận không hoàn tác được. Xoá bị chặn giữa chừng (422 kèm details.blockers) thì hiện lại danh sách mới.
 */
export function DeleteAccountDialog({ user, onClose, onDeleted }: { user: User | null; onClose: () => void; onDeleted?: () => void }) {
  const { run } = useStore();
  const [check, setCheck] = useState<CustomerDeletionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const userId = user?._id ?? null;

  const load = useCallback(async (id: string) => {
    setLoading(true); setError(null);
    try {
      setCheck(await api.get<CustomerDeletionCheck>(`/users/${id}/deletion-check`));
    } catch (e) {
      setCheck(null);
      setError(e instanceof Error ? e.message : 'Không kiểm tra được tài khoản');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCheck(null); setError(null); setReason(''); setAck(false);
    if (userId) void load(userId);
  }, [userId, load]);

  const reasonLen = reason.trim().length;
  const ready = !!check?.canDelete && reasonLen >= ACCOUNT_DELETE_REASON_MIN && ack && !busy;
  const blocked = !!check && !check.canDelete;

  const submit = async () => {
    if (!user || !ready) return;
    setBusy(true);
    const r = await run('anonymizeCustomer', { userId: user._id, reason: reason.trim(), source: 'USER_PAGE' }, 'Đã xoá tài khoản khách (ẩn danh hoá)');
    setBusy(false);
    if (r.ok) { onDeleted?.(); onClose(); return; }
    // Có việc mới phát sinh sau lúc kiểm: hiện lại danh sách lý do chặn từ phản hồi 422.
    const blockers = (r.details as { blockers?: CustomerDeletionBlocker[] } | undefined)?.blockers;
    if (blockers?.length && check) setCheck({ ...check, canDelete: false, blockers });
  };

  return (
    <Modal open={!!user} onClose={onClose} stacked size="lg" title="Xoá tài khoản khách"
      description={user ? `${user.fullName} · ${user.email}` : undefined}
      footer={<>
        {blocked && <p className="mr-auto self-center text-xs font-medium text-red-700">Xử lý xong các mục trên rồi mới xoá được</p>}
        <Button variant="secondary" onClick={onClose}>Huỷ</Button>
        {blocked && <Button variant="secondary" disabled={loading} onClick={() => userId && void load(userId)}><RefreshCw className="size-4" />Kiểm tra lại</Button>}
        <Button variant="danger" disabled={!ready} onClick={() => void submit()}><Trash2 className="size-4" />{busy ? 'Đang xoá…' : 'Xoá tài khoản'}</Button>
      </>}>
      {loading && !check ? (
        <div className="space-y-3" aria-busy><Skeleton className="h-16" /><Skeleton className="h-24" /></div>
      ) : error ? (
        <Callout tone="red" icon={<TriangleAlert />} title="Không mở được thao tác xoá">{error}</Callout>
      ) : check && blocked ? (
        <div className="space-y-4 text-sm">
          <Callout tone="red" icon={<Ban />} title={`Chưa xoá được — còn ${check.blockers.length} việc phải xử lý`}>
            Xoá tài khoản là ẩn danh hoá hồ sơ khách; còn việc dưới đây thì chi nhánh không liên hệ / đối chiếu / chuyển tiền cho khách được nữa.
          </Callout>
          <ul className="space-y-3">
            {check.blockers.map((b, i) => {
              const v = blockerView(b);
              return (
                <li key={`${b.code}-${i}`} className="rounded-xl px-4 py-3 ring-1 ring-inset ring-red-200">
                  <p className="flex items-start gap-2 font-semibold text-red-800"><v.icon className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />{v.title}</p>
                  {v.lines.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-6 text-stone-700">
                      {v.lines.map((l, j) => <Line key={j} icon={l.icon}>{l.text}</Line>)}
                    </ul>
                  )}
                  {v.todo && <p className="mt-2 pl-6 text-xs text-stone-500">{v.todo}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : check ? (
        <div className="space-y-5 text-sm">
          <Callout tone="amber" icon={<TriangleAlert />} title="Không hoàn tác được">
            Hồ sơ khách bị ẩn danh hoá, khách không đăng nhập được nữa. Hợp đồng, chứng từ và nhật ký vẫn giữ theo Chính sách bảo mật.
          </Callout>
          <div className="grid gap-4 sm:grid-cols-2">
            <Section icon={<Trash2 />} title="Sẽ thực hiện">
              <ul className="space-y-1.5 text-stone-700">
                {check.willDo.map((t, i) => <Line key={i} icon={i === 1 ? LogOut : Trash2} tone="red">{t}</Line>)}
              </ul>
            </Section>
            <Section icon={<Archive />} title="Được giữ lại">
              <ul className="space-y-1.5 text-stone-700">
                {check.keeps.map((t, i) => <Line key={i} icon={CircleCheck} tone="green">{t}</Line>)}
              </ul>
            </Section>
          </div>
          <Field label="Lý do xoá" tip="Ghi vào nhật ký kiểm toán cùng thao tác xoá."
            note={reasonLen < ACCOUNT_DELETE_REASON_MIN ? `Tối thiểu ${ACCOUNT_DELETE_REASON_MIN} ký tự (đang có ${reasonLen}).` : undefined}>
            <textarea className={inputCls} rows={3} maxLength={500} value={reason} placeholder="VD: Khách yêu cầu xoá tài khoản qua tổng đài ngày …"
              onChange={(e) => setReason(e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-red-50 px-4 py-3 font-medium text-red-900 ring-1 ring-inset ring-red-200">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-red-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Tôi hiểu thao tác này không hoàn tác được — hồ sơ khách bị ẩn danh hoá, khách không đăng nhập được nữa
          </label>
        </div>
      ) : null}
    </Modal>
  );
}
