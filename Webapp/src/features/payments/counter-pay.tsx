'use client';

import { useEffect, useRef, useState } from 'react';
import { Banknote, CircleCheck, CircleX, ExternalLink, Hourglass, Loader2, QrCode as QrIcon, RefreshCw, TriangleAlert } from 'lucide-react';
import type { CounterOrderStart, CounterPaySelection, CounterPurpose, GatewayOrderView } from '@ssm/shared';
import { api, ApiError } from '@/shared/api/client';
import { actions } from '@/shared/api/actions';
import { vnd } from '@/shared/lib/format';
import { Button } from '@/shared/ui';
import { Callout, CheckLine } from '@/features/staff-ui';
import { CounterPayPicker } from '@/features/payments/pay-method';
import { QrCode } from '@/features/reservations/qr';

/** Đích của một bước thu tại quầy — gửi nguyên cho POST /payments/counter-orders. WALK_IN: chi nhánh + khoá lượt đặt (+ khách cũ). */
export type CounterTarget =
  | { purpose: Exclude<CounterPurpose, 'WALK_IN'>; reservationId?: string; contractId?: string; swapRequestId?: string }
  | { purpose: 'WALK_IN'; facilityId: string; walkInKey: string; customerId?: string };

const POLL_MS = 2_500;
type Order = Pick<CounterOrderStart, 'txnRef' | 'amount' | 'expiresAt' | 'payUrl'> & { status: GatewayOrderView['status']; transactionNo: string | null; consumed: boolean };

const absolute = (url: string) => (typeof window === 'undefined' ? url : new URL(url, window.location.origin).toString());
/** Lệnh còn chờ khách trả: PENDING và chưa quá hạn (chế độ giả lập không có job đổi trạng thái hết hạn). */
const waiting = (o: Order) => o.status === 'PENDING' && new Date(o.expiresAt).getTime() > Date.now();

/**
 * Góp ý 17/11 — phần THU TẠI QUẦY dùng chung cho mọi chỗ nhân viên thu tiền: chỉ hai lựa chọn.
 *  - Tiền mặt: tick "Đã nhận đủ <số tiền> — không huỷ được sau khi xác nhận" (bắt buộc) → `{ payMethod: 'CASH' }`.
 *  - VNPAY: bấm "Thanh toán qua VNPAY" → server mở lệnh tại quầy đúng số phải thu của bước này → mở trang thanh toán ở tab mới (VNPAY sandbox; cục bộ là
 *    trang giả lập) + mã QR của link để khách trả bằng điện thoại → màn này tự hỏi trạng thái → "Đã thu qua VNPAY · <mã>" → `{ payMethod: 'VNPAY', gatewayTxnRef }`.
 *    Thất bại / hết hạn: "Tạo lại link" hoặc "Đổi sang tiền mặt". Không còn gõ tay mã giao dịch.
 * `value` null = chưa sẵn sàng thu (nút xác nhận của nơi gọi phải tắt). `lockedReason`: chưa tới bước thu (VD chưa đối chiếu CCCD) — chỉ hiện lý do.
 * Đổi số tiền / đích → làm lại từ đầu. Lệnh đã trả mà không dùng không mất: bấm VNPAY lại cho cùng việc, cùng số tiền thì dùng lại; còn lại nằm trong hàng
 * "VNPAY tại quầy đã thu, chưa ghi nhận" để quản lý trả lại khách.
 */
export function CounterPayment({ amount, target, value, onChange, lockedReason, label = 'Hình thức thu', error, icons = true, className }: {
  amount: number; target: CounterTarget; value: CounterPaySelection | null; onChange: (v: CounterPaySelection | null) => void;
  lockedReason?: string | null; label?: string; error?: string; icons?: boolean; className?: string;
}) {
  const [method, setMethod] = useState<'CASH' | 'VNPAY'>('CASH');
  const [order, setOrder] = useState<Order | null>(null);
  const [opening, setOpening] = useState(false);
  const [startError, setError] = useState('');
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [bigQr, setBigQr] = useState(false);
  const [, setTick] = useState(0); // vẽ lại khi lệnh vừa quá hạn
  const key = `${amount}|${JSON.stringify(target)}`;
  const keyRef = useRef(key);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Đổi số tiền / đích (dư nợ vừa đổi, khách bớt dịch vụ, đổi giỏ…) → bỏ lựa chọn cũ.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setOrder(null); setError(''); setPopupBlocked(false);
    onChangeRef.current(null);
  }, [key]);

  // Hỏi trạng thái lệnh khi còn chờ khách trả.
  const txnRef = order?.txnRef ?? null;
  const pending = !!order && waiting(order);
  useEffect(() => {
    if (!txnRef || !pending) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const v = await api.get<GatewayOrderView>(`/payments/gateway-orders/${txnRef}`);
        if (!alive) return;
        setOrder((o) => (o && o.txnRef === v.txnRef ? { ...o, status: v.status, transactionNo: v.transactionNo, payUrl: v.payUrl ?? o.payUrl, consumed: !!v.counter?.consumedAt } : o));
      } catch { /* lỗi tạm thời: lượt sau hỏi lại */ }
      setTick((n) => n + 1);
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [txnRef, pending]);

  // Báo lựa chọn hợp lệ cho nơi gọi.
  const paid = method === 'VNPAY' && order?.status === 'PAID' && !order.consumed ? order.txnRef : null;
  useEffect(() => {
    if (method !== 'VNPAY') return;
    const want = paid ? { payMethod: 'VNPAY' as const, gatewayTxnRef: paid } : null;
    if (JSON.stringify(want) !== JSON.stringify(value)) onChangeRef.current(want);
  }, [method, paid, value]);

  // KHÔNG bọc trong <Field> (thẻ <label>): bấm vào chữ / mã QR sẽ kích hoạt nút đầu tiên ("Tiền mặt"). Tự hiện nhãn trong một nhóm.
  const head = <p className="mb-1.5 block text-xs font-medium text-stone-700">{label}</p>;
  const err = error ? <p role="alert" className="mt-1 text-xs font-medium text-red-600">{error}</p> : null;
  if (lockedReason) return <div role="group" aria-label={label} className={className}>{head}<Callout tone="amber" icon={<TriangleAlert />} title={lockedReason} />{err}</div>;

  const pick = (m: 'CASH' | 'VNPAY') => {
    if (m === method) return;
    setMethod(m); setError('');
    onChange(null);
  };

  /** Mở tab trống NGAY trong lần bấm (không bị chặn popup), gắn link khi server trả về; cắt opener để trang ngoài không điều khiển được màn quầy. */
  const start = async () => {
    setError(''); setPopupBlocked(false); setOpening(true);
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (tab) tab.opener = null;
    try {
      const o = await actions.openCounterOrder({ ...target, ...(target.purpose === 'WALK_IN' ? { amount } : {}) });
      setOrder({ txnRef: o.txnRef, amount: o.amount, expiresAt: o.expiresAt, payUrl: o.payUrl, status: o.status, transactionNo: o.transactionNo, consumed: false });
      if (o.payUrl && o.status === 'PENDING') {
        if (tab) tab.location.href = absolute(o.payUrl);
        else setPopupBlocked(true);
      } else tab?.close();
    } catch (e) {
      tab?.close();
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Không tạo được lệnh VNPAY');
    } finally {
      setOpening(false);
    }
  };

  const link = order?.payUrl ? absolute(order.payUrl) : null;
  const failed = !!order && order.status !== 'PAID' && !waiting(order) && order.status !== 'PAID_UNAPPLIED';

  return (
    <div role="group" aria-label={label} className={className}>
    {head}
    <div className="space-y-3">
      <CounterPayPicker icons={icons} value={method} onChange={(m) => pick(m)} />

      {method === 'CASH' && (
        <CheckLine checked={value?.payMethod === 'CASH'} onChange={(v) => onChange(v ? { payMethod: 'CASH' } : null)}>
          Đã nhận đủ <b className="tabular-nums">{vnd(amount)}</b> tiền mặt — không huỷ được sau khi xác nhận.
        </CheckLine>
      )}

      {method === 'VNPAY' && (
        <div className="space-y-3">
          {!order && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sky-50/70 px-4 py-3 text-sm ring-1 ring-inset ring-sky-200">
              <p className="min-w-0 flex-1 basis-52 text-sky-950">Mở trang VNPAY để khách trả <b className="tabular-nums">{vnd(amount)}</b> — trên máy quầy hoặc quét mã bằng điện thoại.</p>
              <Button size="sm" disabled={opening || amount <= 0} onClick={() => void start()}>
                {opening ? <Loader2 className="size-3.5 animate-spin" /> : <QrIcon className="size-3.5" />}Thanh toán qua VNPAY
              </Button>
            </div>
          )}

          {order && waiting(order) && (
            <div className="space-y-3 rounded-xl bg-white p-4 text-sm ring-1 ring-inset ring-sky-200">
              <p className="flex items-center gap-2 font-semibold text-sky-900"><Loader2 className="size-4 animate-spin" />Đang chờ khách thanh toán… <span className="tabular-nums">{vnd(order.amount)}</span></p>
              {popupBlocked && <Callout tone="amber" icon={<TriangleAlert />} title="Trình duyệt chặn mở tab mới — bấm “Mở trang thanh toán”." />}
              <div className="flex flex-wrap items-start gap-4">
                {/* Link VNPAY thật dài (~700 ký tự) nên mã dày: bấm để phóng to cho điện thoại quét dễ. */}
                {link && (
                  <button type="button" onClick={() => setBigQr((v) => !v)} title={bigQr ? 'Thu nhỏ mã QR' : 'Phóng to mã QR'} aria-label={bigQr ? 'Thu nhỏ mã QR' : 'Phóng to mã QR'}
                    className="rounded-lg bg-white p-1 ring-1 ring-inset ring-stone-200 hover:ring-brand-400">
                    <QrCode value={link} size={bigQr ? 320 : link.length > 300 ? 200 : 148} label="Mã QR trang thanh toán VNPAY" />
                  </button>
                )}
                <div className="min-w-0 flex-1 basis-48 space-y-2 text-xs text-stone-600">
                  <p>Khách trả trên tab vừa mở, hoặc quét mã này bằng điện thoại (bấm vào mã để phóng to). Màn hình tự cập nhật khi khách trả xong.</p>
                  <p>Mã lệnh <span className="font-mono">{order.txnRef}</span> · hết hạn {new Date(order.expiresAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>
                  {link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><ExternalLink className="size-3.5" />Mở trang thanh toán</a>}
                </div>
              </div>
            </div>
          )}

          {order?.status === 'PAID' && !order.consumed && (
            <Callout tone="green" icon={<CircleCheck />} title={<>Đã thu qua VNPAY · <span className="font-mono">{order.transactionNo ?? order.txnRef}</span></>}>
              <span className="tabular-nums">{vnd(order.amount)}</span> — bấm xác nhận bên dưới để ghi nhận.
            </Callout>
          )}
          {order?.status === 'PAID' && order.consumed && (
            <Callout tone="gray" icon={<CircleCheck />} title="Khoản VNPAY này đã được ghi nhận." />
          )}

          {failed && (
            <Callout tone="red" icon={order!.status === 'FAILED' ? <CircleX /> : <Hourglass />}
              title={order!.status === 'FAILED' ? 'Khách chưa trả được trên VNPAY' : 'Link thanh toán đã hết hạn'}
              action={<>
                <Button size="sm" variant="secondary" disabled={opening} onClick={() => { setOrder(null); void start(); }}><RefreshCw className="size-3.5" />Tạo lại link</Button>
                <Button size="sm" variant="secondary" onClick={() => { setOrder(null); pick('CASH'); }}><Banknote className="size-3.5" />Đổi sang tiền mặt</Button>
              </>}>
              <span className="text-xs">Chưa thu được tiền qua VNPAY.</span>
            </Callout>
          )}

          {order && waiting(order) && (
            <p className="text-xs text-stone-500">
              Khách không trả được?{' '}
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => { setOrder(null); pick('CASH'); }}>Đổi sang tiền mặt</button>
              {' '}— nếu sau đó khách vẫn trả trên VNPAY, khoản đó vào hàng “VNPAY tại quầy chưa ghi nhận” để quản lý trả lại.
            </p>
          )}
          {startError && <Callout tone="red" icon={<TriangleAlert />} title={startError} />}
        </div>
      )}
    </div>
    {err}
    </div>
  );
}
