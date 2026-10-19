import { AppShell } from '@/shared/layout/app-shell';

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="ops">{children}</AppShell>;
}
