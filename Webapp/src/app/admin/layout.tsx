import { AppShell } from '@/shared/layout/app-shell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="admin">{children}</AppShell>;
}
