'use client';

import { ShieldOff } from 'lucide-react';
import { ID_CHECK_MAX_FAILURES, ID_CHECK_WINDOW_HOURS, idCheckLocked } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { Button } from '@/shared/ui';

/**
 * Nhập sai giấy tờ ID_CHECK_MAX_FAILURES lần trong ID_CHECK_WINDOW_HOURS giờ → server khoá đối chiếu của hợp đồng (mở hộ / giao thẻ,
 * chìa) hoặc đặt chỗ (nhận kho) và trả 423 ID_CHECK_LOCKED. Chỉ Quản lý chi nhánh mở khoá, bắt buộc ghi lý do; hết 24 giờ tự mở.
 * Người khác chỉ thấy nhãn đang khoá.
 */
export function IdCheckUnlock({ kind, target, label, size = 'sm' }: {
  kind: 'contracts' | 'reservations'; target: { _id: string; idCheck?: { lockedAt?: string | null } | null }; label: string; size?: 'sm' | 'md';
}) {
  const { user, run, busy } = useStore();
  if (!idCheckLocked(target)) return null;
  if (user?.role !== 'FACILITY_MANAGER') {
    return <span className="self-center text-xs font-medium text-red-700">Đang khoá đối chiếu giấy tờ — báo Quản lý chi nhánh</span>;
  }
  const unlock = () => {
    const why = window.prompt(`Mở khoá đối chiếu giấy tờ của ${label}?\nĐã nhập sai giấy tờ ${ID_CHECK_MAX_FAILURES} lần trong ${ID_CHECK_WINDOW_HOURS} giờ — kiểm tra lại với khách / nhân viên trước.\nNhập lý do (tối thiểu 5 ký tự) — được ghi vào nhật ký:`);
    if (why && why.trim().length >= 5) void run('unlockIdCheck', { kind, id: target._id, reason: why.trim() }, 'Đã mở khoá đối chiếu giấy tờ');
  };
  return <Button size={size} variant="danger" disabled={busy} onClick={unlock}><ShieldOff className="size-3.5" />Mở khoá đối chiếu giấy tờ</Button>;
}
