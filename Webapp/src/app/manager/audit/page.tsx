'use client';

import { AuditLogView } from '@/features/audit/audit-log';

/** Quản lý chi nhánh xem nhật ký thao tác thuộc chi nhánh mình — server tự lọc theo chi nhánh được gán. */
export default function ManagerAudit() {
  return <AuditLogView title="Nhật ký chi nhánh" description="Nhật ký thao tác tại chi nhánh — chỉ ghi thêm, không sửa hay xoá được." />;
}
