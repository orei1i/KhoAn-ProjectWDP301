'use client';

import { AuditLogView } from '@/features/audit/audit-log';

/** Vận hành chuỗi xem nhật ký toàn chuỗi (dùng lại trang nhật ký của Admin). */
export default function OpsAudit() {
  return <AuditLogView title="Nhật ký" description="Nhật ký thao tác toàn chuỗi — chỉ ghi thêm, không sửa hay xoá được." variant="rich" />;
}
