import type { Metadata } from 'next';
import { LegalPage } from '@/features/legal/legal-page';
import { PRIVACY, PRIVACY_VERSION } from '@/features/legal/legal-content';

export const metadata: Metadata = { title: 'Chính sách bảo mật' };

export default function PrivacyPage() {
  return <LegalPage title="Chính sách bảo mật dữ liệu cá nhân" version={PRIVACY_VERSION} sections={PRIVACY} other={{ href: '/dieu-khoan', label: 'Xem Điều khoản thuê kho →' }} />;
}
