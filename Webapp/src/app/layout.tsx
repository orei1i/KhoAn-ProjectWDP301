import type { Metadata } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { StoreProvider } from '@/shared/store/store';
import { Toasts } from '@/shared/layout/toasts';
import { RequirePassword } from '@/features/auth/require-password';
import './globals.css';

const font = Be_Vietnam_Pro({ subsets: ['latin', 'vietnamese'], weight: ['400', '500', '600', '700'], variable: '--font-be-vietnam', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'KhoAn — Kho tự quản', template: '%s · KhoAn' },
  description: 'Hệ thống quản lý kho tự quản: đặt kho, nhận kho, thanh toán và vận hành chuỗi chi nhánh.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={font.variable} suppressHydrationWarning>
      <body className="font-sans">
        <StoreProvider>
          <RequirePassword />
          {children}
          <Toasts />
        </StoreProvider>
      </body>
    </html>
  );
}
