'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { LEGAL_CHANGE_SUMMARY } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/features/legal/legal-content';
import { Button } from '@/shared/ui';

/** Trang đọc điều khoản không bị che — khách cần đọc được thứ mình đồng ý. */
const ALLOWED = ['/dieu-khoan', '/bao-mat'];

/**
 * Cổng chặn: Điều khoản / Chính sách bảo mật đổi phiên bản mà khách chưa đồng ý bản mới (`user.consentRequired` do server tính) → hộp
 * thoại bắt buộc: xem tóm tắt thay đổi, mở đọc bản đầy đủ, tick đồng ý rồi mới dùng tiếp (POST /auth/me/consent). Không đóng được —
 * không đồng ý thì chỉ có thể đăng xuất. Đặt trong RootLayout nên áp cho mọi trang.
 */
export function RequireConsent() {
  const { user, run, busy, logout } = useStore();
  const pathname = usePathname();
  const [agree, setAgree] = useState(false);
  if (!user?.consentRequired || ALLOWED.some((p) => pathname.startsWith(p))) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-stone-100 px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><ScrollText className="size-5" /></span>
          <div>
            <h2 id="consent-title" className="text-base font-semibold text-ink">Điều khoản đã được cập nhật</h2>
            <p className="mt-0.5 text-sm text-stone-500">Điều khoản thuê kho v{TERMS_VERSION} · Chính sách bảo mật v{PRIVACY_VERSION}. Vui lòng xem và đồng ý để tiếp tục.</p>
          </div>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div>
            <p className="font-medium">Thay đổi chính</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-stone-700">
              {LEGAL_CHANGE_SUMMARY.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <p className="text-stone-600">
            Đọc bản đầy đủ: <Link href="/dieu-khoan" target="_blank" className="font-medium text-brand-700 hover:underline">Điều khoản thuê kho</Link> ·{' '}
            <Link href="/bao-mat" target="_blank" className="font-medium text-brand-700 hover:underline">Chính sách bảo mật</Link>
          </p>
          <label className="flex cursor-pointer gap-2.5 leading-relaxed text-stone-700">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>Tôi đã đọc và đồng ý với Điều khoản thuê kho (v{TERMS_VERSION}) và cho KhoAn xử lý dữ liệu cá nhân theo Chính sách bảo mật (v{PRIVACY_VERSION}).</span>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 px-5 py-3">
          <Button variant="ghost" onClick={() => void logout()}>Đăng xuất</Button>
          <Button disabled={!agree || busy} onClick={() => void run('acceptLegal', { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }, 'Đã ghi nhận đồng ý — cảm ơn bạn', () => setAgree(false))}>
            Đồng ý và tiếp tục
          </Button>
        </div>
      </div>
    </div>
  );
}
