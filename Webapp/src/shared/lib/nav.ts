import type { Role } from '@ssm/shared';
import {
  Boxes, Building2, CalendarCheck, ClipboardList, ConciergeBell, CreditCard, FileText, HandCoins, KeyRound, LayoutDashboard, LayoutGrid, LifeBuoy,
  ListTodo, PackageOpen, PackagePlus, Repeat, ScanLine, ScrollText, ShieldCheck, Tags, TrendingUp, UserPlus, UserX, Users, Warehouse, type LucideIcon,
} from 'lucide-react';

export type Area = 'portal' | 'staff' | 'manager' | 'ops' | 'admin';
/** `roles`: chỉ hiện mục này với các vai trò nêu (mặc định: mọi vai trò của khu vực). */
export interface NavItem { href: string; label: string; icon: LucideIcon; roles?: Role[] }

export const AREAS: Record<Area, { title: string; roles: Role[]; items: NavItem[] }> = {
  portal: {
    title: 'Khách hàng', roles: ['CUSTOMER'],
    items: [
      { href: '/portal', label: 'Tổng quan', icon: LayoutDashboard },
      { href: '/portal/reservations', label: 'Đặt chỗ của tôi', icon: CalendarCheck },
      { href: '/portal/units', label: 'Kho đang thuê', icon: Warehouse },
      { href: '/portal/services', label: 'Dịch vụ thêm', icon: PackagePlus },
      { href: '/portal/payments', label: 'Thanh toán', icon: CreditCard },
      { href: '/portal/tickets', label: 'Hỗ trợ', icon: LifeBuoy },
      { href: '/portal/claims', label: 'Bồi thường', icon: HandCoins },
      { href: '/portal/privacy', label: 'Dữ liệu cá nhân', icon: ShieldCheck },
    ],
  },
  staff: {
    title: 'Vận hành kho', roles: ['STAFF', 'FACILITY_MANAGER'],
    items: [
      { href: '/staff', label: 'Hàng đợi hôm nay', icon: ClipboardList },
      { href: '/staff/walk-in', label: 'Đặt chỗ tại quầy', icon: UserPlus },
      { href: '/staff/check-in', label: 'Nhận kho (check-in)', icon: ScanLine },
      { href: '/staff/move-out', label: 'Trả kho & kiểm tra', icon: PackageOpen },
      { href: '/staff/units', label: 'Sơ đồ kho', icon: LayoutGrid },
      { href: '/staff/swaps', label: 'Yêu cầu đổi ô', icon: Repeat },
      { href: '/staff/services', label: 'Dịch vụ yêu cầu', icon: ConciergeBell },
      { href: '/staff/access', label: 'Cấp lại mã / thẻ / chìa', icon: KeyRound },
      // Quản lý chi nhánh xử lý phiếu ở "Yêu cầu & công việc" và chi bồi thường ở "Bồi thường" — không cần trang riêng của nhân viên.
      { href: '/staff/tasks', label: 'Công việc của tôi', icon: ListTodo, roles: ['STAFF'] },
    ],
  },
  manager: {
    title: 'Quản lý chi nhánh', roles: ['FACILITY_MANAGER'],
    items: [
      { href: '/manager', label: 'Tổng quan', icon: LayoutDashboard },
      { href: '/manager/units', label: 'Quản lý kho', icon: LayoutGrid },
      { href: '/manager/contracts', label: 'Hợp đồng & công nợ', icon: FileText },
      { href: '/manager/tasks', label: 'Yêu cầu & công việc', icon: ListTodo },
      { href: '/manager/claims', label: 'Bồi thường', icon: HandCoins },
      { href: '/manager/reports', label: 'Báo cáo', icon: TrendingUp },
      { href: '/manager/audit', label: 'Nhật ký chi nhánh', icon: ShieldCheck },
    ],
  },
  ops: {
    title: 'Vận hành chuỗi', roles: ['OPS_MANAGER'],
    items: [
      { href: '/ops', label: 'Tổng quan chuỗi', icon: TrendingUp },
      { href: '/ops/approvals', label: 'Duyệt & chi', icon: HandCoins },
      { href: '/ops/facilities', label: 'Chi nhánh', icon: Building2 },
      { href: '/ops/inventory', label: 'Loại kho & ô kho', icon: Boxes },
      { href: '/ops/services', label: 'Dịch vụ thêm', icon: PackagePlus },
      { href: '/ops/policies', label: 'Chính sách', icon: ScrollText },
      { href: '/ops/contract-templates', label: 'Mẫu hợp đồng', icon: FileText },
      { href: '/ops/pricing', label: 'Bảng giá', icon: Tags },
      { href: '/ops/audit', label: 'Nhật ký', icon: ShieldCheck },
    ],
  },
  admin: {
    title: 'Quản trị hệ thống', roles: ['ADMIN'],
    items: [
      { href: '/admin/users', label: 'Người dùng & phân quyền', icon: Users },
      { href: '/admin/audit', label: 'Nhật ký kiểm toán', icon: ShieldCheck },
      { href: '/admin/privacy', label: 'Yêu cầu dữ liệu cá nhân', icon: UserX },
    ],
  },
};

export const HOME: Record<Role, string> = {
  CUSTOMER: '/portal', STAFF: '/staff', FACILITY_MANAGER: '/manager', OPS_MANAGER: '/ops', ADMIN: '/admin/users',
};
