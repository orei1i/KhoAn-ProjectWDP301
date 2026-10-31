'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { GATEWAY_TXN_REF_RE } from '@ssm/shared';
import { Card } from '@/shared/ui';

/**
 * Điểm quay về của khách trả từ app: VNPAY mở trong trình duyệt của máy nên phải có trang web để đẩy khách về lại app. Không gọi API và không kết luận kết quả:
 * app tự hỏi BE theo mã giao dịch. Mã được kiểm trước khi đưa vào deep link.
 */
function ReturnToAppInner() {
  const ref = useSearchParams().get('vnp_TxnRef') ?? '';
  const href = GATEWAY_TXN_REF_RE.test(ref) ? `khoan://pay-result?ref=${ref}` : null;
  const tried = useRef(false);
  useEffect(() => {
    if (!href || tried.current) return;
    tried.current = true;
    window.location.href = href;
  }, [href]);
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 sm:py-14">
      <Card className="p-6 text-sm text-stone-700">
        <h1 className="text-lg font-semibold text-ink">Mở lại ứng dụng KhoAn để xem kết quả</h1>
        {href ? (
          <>
            <p className="mt-2">Nếu ứng dụng không tự mở, bấm nút bên dưới hoặc tự chuyển về ứng dụng KhoAn.</p>
            <a href={href} className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-800">Mở ứng dụng KhoAn</a>
          </>
        ) : <p className="mt-2">Đường dẫn không có mã giao dịch hợp lệ. Mở ứng dụng KhoAn để xem lịch sử thanh toán.</p>}
      </Card>
    </main>
  );
}

export default function PaymentReturnToAppPage() {
  return <Suspense fallback={null}><ReturnToAppInner /></Suspense>;
}
