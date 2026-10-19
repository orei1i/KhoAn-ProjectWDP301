import { AppShell } from '@/shared/layout/app-shell';

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="manager">{children}</AppShell>;
}
