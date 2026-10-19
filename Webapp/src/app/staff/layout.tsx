import { AppShell } from '@/shared/layout/app-shell';

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="staff">{children}</AppShell>;
}
