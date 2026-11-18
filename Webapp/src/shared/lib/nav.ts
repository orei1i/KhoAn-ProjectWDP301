import type { Role } from '@ssm/shared';
import {
  Boxes, Building2, CalendarCheck, ClipboardCheck, ClipboardList, ConciergeBell, CreditCard, FileText, HandCoins, KeyRound, LayoutDashboard, LayoutGrid, LifeBuoy,
  ListTodo, PackageCheck, PackageOpen, PackagePlus, Repeat, ScanLine, ScrollText, ShieldCheck, Tags, TrendingUp, UserPlus, UserX, Users, Warehouse, type LucideIcon,
} from 'lucide-react';

export type Area = 'portal' | 'staff' | 'manager' | 'ops' | 'admin';
/**
 * `roles`: chỉ hiện mục này với các vai trò nêu (mặc định: mọi vai trò của khu vực).
 * `section`: tên nhóm nhỏ trong khu vực; các mục liền nhau cùng `section` nằm dưới một tiêu đề.
 */
export interface NavItem { href: string; label: string; icon: LucideIcon; roles?: Role[]; section?: string }

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
      // Góp ý 18/11: quản lý chi nhánh chỉ thấy các mục có việc ĐÚNG vai trò quản lý (duyệt, phân ô, cập nhật giấy tờ, xử lý trường hợp đặc biệt);
      // việc thuần của nhân viên (quầy, nhập hàng, kiểm ô, dịch vụ, sơ đồ) chỉ hiện với nhân viên. Quản lý vẫn mở được các trang này qua liên kết.
      { href: '/staff', label: 'Hàng đợi hôm nay', icon: ClipboardList, roles: ['STAFF'] },
      { href: '/staff/walk-in', label: 'Đặt chỗ tại quầy', icon: UserPlus, roles: ['STAFF'] },
      { href: '/staff/check-in', label: 'Nhận kho (check-in)', icon: ScanLine, roles: ['STAFF'] },
      // Quản lý: phân / đổi ô cho đặt chỗ, cập nhật giấy tờ khách theo bản gốc.
      { href: '/staff/check-in', label: 'Phân ô & giấy tờ khách', icon: ScanLine, roles: ['FACILITY_MANAGER'] },
      { href: '/staff/intake', label: 'Nhập hàng', icon: PackageCheck, roles: ['STAFF'] },
      { href: '/staff/move-out', label: 'Trả kho & kiểm tra', icon: PackageOpen, roles: ['STAFF'] },
      // Quản lý không nhận lại ô / kiểm ô: đăng ký trả kho cho hợp đồng đang nợ, xác nhận khách vắng mặt, xử lý đồ để lại quá hạn giữ.
      { href: '/staff/move-out', label: 'Trả kho', icon: PackageOpen, roles: ['FACILITY_MANAGER'] },
      { href: '/staff/units', label: 'Sơ đồ kho', icon: LayoutGrid, roles: ['STAFF'] },
      { href: '/staff/swaps', label: 'Yêu cầu đổi ô', icon: Repeat },
      { href: '/staff/services', label: 'Dịch vụ yêu cầu', icon: ConciergeBell, roles: ['STAFF'] },
      { href: '/staff/access', label: 'Cấp lại thẻ / chìa, mở hộ', icon: KeyRound },
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
      // Đợt 17: biên bản trả kho nhân viên đã kiểm — quản lý ghi phí sửa chữa / phí khác rồi duyệt, khách xác nhận sau cùng bằng OTP.
      { href: '/manager/move-outs', label: 'Duyệt trả kho', icon: ClipboardCheck },
      { href: '/manager/tasks', label: 'Yêu cầu & công việc', icon: ListTodo },
      { href: '/manager/claims', label: 'Bồi thường', icon: HandCoins },
      { href: '/manager/reports', label: 'Báo cáo', icon: TrendingUp },
      { href: '/manager/audit', label: 'Nhật ký chi nhánh', icon: ShieldCheck },
    ],
  },
  ops: {
    title: 'Vận hành chuỗi', roles: ['OPS_MANAGER'],
    items: [
      { href: '/ops', label: 'Tổng quan chuỗi', icon: TrendingUp, section: 'Hằng ngày' },
      { href: '/ops/approvals', label: 'Duyệt & chi', icon: HandCoins, section: 'Hằng ngày' },
      { href: '/ops/contracts', label: 'Hợp đồng', icon: FileText, section: 'Hằng ngày' },
      { href: '/ops/facilities', label: 'Chi nhánh', icon: Building2, section: 'Danh mục' },
      { href: '/ops/inventory', label: 'Loại kho & ô kho', icon: Boxes, section: 'Danh mục' },
      { href: '/ops/services', label: 'Dịch vụ thêm', icon: PackagePlus, section: 'Danh mục' },
      { href: '/ops/policies', label: 'Chính sách', icon: ScrollText, section: 'Cấu hình' },
      { href: '/ops/contract-templates', label: 'Mẫu hợp đồng', icon: FileText, section: 'Cấu hình' },
      { href: '/ops/pricing', label: 'Bảng giá', icon: Tags, section: 'Cấu hình' },
      { href: '/ops/audit', label: 'Nhật ký', icon: ShieldCheck, section: 'Kiểm soát' },
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
