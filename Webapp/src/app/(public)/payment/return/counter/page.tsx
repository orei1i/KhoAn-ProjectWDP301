'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Store } from 'lucide-react';
import { GATEWAY_TXN_REF_RE } from '@ssm/shared';
import { Card } from '@/shared/ui';

/**
 * Góp ý 17/11 — điểm quay về (vnp_ReturnUrl) của lệnh VNPAY TẠI QUẦY: khách trả trên tab của máy quầy hoặc trên điện thoại của mình (thường chưa đăng nhập).
 * Không gọi API, không kết luận kết quả (tham số trên URL ai cũng sửa được): BE chỉ tin IPN / QueryDr, màn quầy tự cập nhật. Chỉ nhắc khách quay lại quầy.
 */
function CounterReturnInner() {
  const sp = useSearchParams();
  const ref = sp.get('vnp_TxnRef') ?? '';
  const code = sp.get('vnp_ResponseCode');
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 sm:py-14">
      <Card className="p-6 text-sm text-stone-700">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink"><Store className="size-5 text-brand-700" />Quay lại quầy để hoàn tất</h1>
        <p className="mt-2">{code === '00' ? 'VNPAY đã báo giao dịch thành công.' : code ? 'VNPAY báo giao dịch chưa thành công.' : 'Đã rời trang VNPAY.'} Màn hình tại quầy sẽ tự cập nhật — nhân viên xác nhận và in biên lai cho bạn.</p>
        {GATEWAY_TXN_REF_RE.test(ref) && <p className="mt-3 text-xs text-stone-500">Mã giao dịch: <span className="font-mono">{ref}</span></p>}
        <p className="mt-3 text-xs text-stone-500">Bạn có thể đóng trang này.</p>
      </Card>
    </main>
  );
}

export default function CounterReturnPage() {
  return <Suspense fallback={null}><CounterReturnInner /></Suspense>;
}
