'use client';

import type { RentalContract } from '@ssm/shared';
import { lastDayOf } from '@ssm/shared';
import { CONTRACT_NOTICE, MANUAL_DELIVERY_CHANNEL, NOTICE_EMAIL_STATUS } from '@/shared/lib/labels';
import { fmtDate, fmtDateTime, vnd } from '@/shared/lib/format';
import { StatusBadge } from '@/shared/ui';

/**
 * Các thông báo đã gửi cho khách của một hợp đồng: nhắc sắp hết hạn (30 / 7 ngày), và công nợ (Điều 7 Điều khoản): nhắc quá hạn,
 * khoá quyền ra vào, thông báo cuối, kết quả xử lý đồ bỏ lại — mới nhất trước. Khách thấy trong "Kho đang thuê", quản lý thấy trong chi tiết hợp đồng.
 */
export function ContractNotices({ contract: c, empty, limit }: { contract: RentalContract; empty?: string; limit?: number }) {
  const list = [...(c.notices ?? [])].reverse().slice(0, limit ?? 20);
  if (!list.length) return empty ? <p className="text-sm text-stone-500">{empty}</p> : null;
  return (
    <ol className="space-y-2">
      {list.map((n) => (
        <li key={n._id} className="rounded-lg bg-stone-50 p-3 text-sm ring-1 ring-inset ring-stone-200">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge map={CONTRACT_NOTICE} value={n.kind} />
            <span className="text-xs text-stone-500">{fmtDateTime(n.at)}</span>
            <span className="ml-auto"><StatusBadge map={NOTICE_EMAIL_STATUS} value={n.email.status} /></span>
          </div>
          {n.kind === 'EXPIRY_30' || n.kind === 'EXPIRY_7' ? (
            <p className="mt-1.5 text-stone-700">Hết hạn ngày <b>{fmtDate(lastDayOf(n.endDate ?? c.endDate))}</b> — gia hạn hoặc đăng ký trả kho.</p>
          ) : (
            <p className="mt-1.5 text-stone-700">
              Dư nợ lúc gửi <b className="tabular-nums">{vnd(n.amountDue)}</b>
              {n.kind === 'GRACE_EXPIRED' && n.deadline && <> · khoá quyền ra vào từ ngày <b>{fmtDate(n.deadline)}</b> nếu chưa thanh toán</>}
              {n.kind === 'FINAL_NOTICE' && n.deadline && <> · hạn chót hết ngày <b>{fmtDate(new Date(new Date(n.deadline).getTime() - 86_400_000).toISOString())}</b>, từ ngày <b>{fmtDate(n.deadline)}</b> chi nhánh được xử lý đồ bỏ lại</>}
            </p>
          )}
          {n.manualDelivery && <p className="mt-1 text-xs text-stone-600">Đã báo khách ({MANUAL_DELIVERY_CHANNEL[n.manualDelivery.channel]}) {fmtDate(n.manualDelivery.at)}: {n.manualDelivery.note}</p>}
          {n.note && <p className="mt-1 text-xs text-stone-500">Ghi chú: {n.note}</p>}
        </li>
      ))}
    </ol>
  );
}
