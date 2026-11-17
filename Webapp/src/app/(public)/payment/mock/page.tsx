'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { CircleCheck, CircleX, FlaskConical, Hourglass, Loader2, SearchX } from 'lucide-react';
import { GATEWAY_TXN_REF_RE, type GatewayOrderStatus } from '@ssm/shared';
import { api, ApiError } from '@/shared/api/client';
import { vnd } from '@/shared/lib/format';
import { Button, Card } from '@/shared/ui';

interface MockInfo { txnRef: string; amount: number; purposeLabel: string; facility: string; status: GatewayOrderStatus; expiresAt: string; transactionNo: string | null }

/**
 * Góp ý 17/11 — TRANG THANH TOÁN GIẢ LẬP cho lệnh VNPAY tại quầy khi chạy cục bộ (MOCK_PAYMENTS). Đóng vai trang VNPAY: nhân viên mở ở tab mới, hoặc khách quét
 * mã QR trên màn quầy. Link có chữ ký do server cấp; "Thanh toán thành công" đi đúng đường IPN ở BE. Ở chế độ VNPAY trang này không được dùng (BE trả 404).
 */
function MockPayInner() {
  const sp = useSearchParams();
  const ref = sp.get('ref') ?? '';
  const sig = sp.get('sig') ?? '';
  const valid = GATEWAY_TXN_REF_RE.test(ref) && sig.length >= 16;
  const [info, setInfo] = useState<MockInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setInfo(await api.get<MockInfo>(`/payments/mock-gateway/${ref}?sig=${encodeURIComponent(sig)}`)); setError(''); }
    catch (e) { setError(e instanceof ApiError && e.status === 404 ? 'Không tìm thấy giao dịch (hoặc máy chủ không ở chế độ giả lập).' : e instanceof Error ? e.message : 'Lỗi'); }
  }, [ref, sig]);
  useEffect(() => { if (valid) void load(); }, [valid, load]);

  const pay = async (outcome: 'SUCCESS' | 'FAIL') => {
    setBusy(true);
    try { await api.post(`/payments/mock-gateway/${ref}`, { sig, outcome }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Lỗi'); await load(); }
    finally { setBusy(false); }
  };

  const expired = !!info && info.status === 'PENDING' && new Date(info.expiresAt).getTime() < Date.now();
  const open = !!info && (info.status === 'PENDING' || info.status === 'SUPERSEDED') && !expired;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 sm:py-14">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 bg-[#005baa] px-5 py-3 text-white">
          <span className="text-lg font-bold tracking-wide">VNPAY</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs"><FlaskConical className="size-3.5" />Giả lập — không trừ tiền thật</span>
        </div>
        <div className="space-y-4 p-5 text-sm">
          {!valid ? <p className="flex items-center gap-2 text-stone-600"><SearchX className="size-4" />Đường dẫn thanh toán không hợp lệ.</p>
            : !info && !error ? <p className="flex items-center gap-2 text-stone-500"><Loader2 className="size-4 animate-spin" />Đang tải giao dịch…</p>
              : !info ? <p className="flex items-center gap-2 text-red-700"><CircleX className="size-4" />{error}</p> : (
                <>
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-4"><dt className="text-stone-500">Đơn vị nhận</dt><dd className="text-right font-medium">KhoAn{info.facility ? ` — ${info.facility}` : ''}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-stone-500">Nội dung</dt><dd className="text-right">{info.purposeLabel}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-stone-500">Mã giao dịch</dt><dd className="font-mono text-xs">{info.txnRef}</dd></div>
                  </dl>
                  <div className="border-t border-stone-200 pt-3">
                    <p className="text-xs text-stone-500">Số tiền</p>
                    <p className="text-3xl font-semibold tabular-nums text-ink">{vnd(info.amount)}</p>
                  </div>
                  {open && (
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy} onClick={() => void pay('SUCCESS')}>{busy && <Loader2 className="size-4 animate-spin" />}Thanh toán thành công</Button>
                      <Button variant="secondary" disabled={busy} onClick={() => void pay('FAIL')}>Huỷ giao dịch</Button>
                    </div>
                  )}
                  {(info.status === 'PAID' || info.status === 'PAID_UNAPPLIED') && (
                    <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-emerald-900 ring-1 ring-inset ring-emerald-200"><CircleCheck className="mt-0.5 size-4 shrink-0" />
                      <span>Thanh toán thành công{info.transactionNo ? <> · mã <span className="font-mono text-xs">{info.transactionNo}</span></> : null}. Quay lại quầy — nhân viên sẽ xác nhận.</span></p>
                  )}
                  {info.status === 'FAILED' && <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-800 ring-1 ring-inset ring-red-200"><CircleX className="size-4" />Giao dịch đã huỷ. Báo nhân viên tạo link mới hoặc trả tiền mặt.</p>}
                  {(expired || info.status === 'EXPIRED') && <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-inset ring-amber-200"><Hourglass className="size-4" />Link đã hết hạn — báo nhân viên tạo link mới.</p>}
                  {error && info && <p className="text-xs text-red-700">{error}</p>}
                </>
              )}
        </div>
      </Card>
    </main>
  );
}

export default function MockPayPage() {
  return <Suspense fallback={null}><MockPayInner /></Suspense>;
}
