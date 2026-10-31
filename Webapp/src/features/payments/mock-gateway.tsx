'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, CreditCard, FlaskConical, Landmark, Loader2, QrCode as QrIcon } from 'lucide-react';
import { COLLECTED_PAYMENT_STATUSES, type GatewayStart, type PaymentMethod, type PaymentStatus } from '@ssm/shared';
import { useStore, type RunResult } from '@/shared/store/store';
import { PAYMENT_METHOD } from '@/shared/lib/labels';
import { facilityName } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Button, Modal, inputCls } from '@/shared/ui';
import { PayMethodPicker } from '@/features/payments/pay-method';
import { ReceiptButton, hasReceipt } from '@/features/payments/receipt-button';
import { QrCode } from '@/features/reservations/qr';

/** Hình thức khách tự trả online (không có tiền mặt — tiền mặt chỉ thu tại quầy). */
export const ONLINE_METHODS: PaymentMethod[] = ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'];
/** Tài khoản nhận tiền GIẢ ĐỊNH của KhoAn — chỉ để minh hoạ màn chuyển khoản. */
const DEMO_BANK = { bank: 'KhoAn Demo Bank (giả định)', account: '0123 4567 8901', holder: 'CONG TY KHOAN' };
const QR_METHODS: PaymentMethod[] = ['VNPAY', 'MOMO'];

/** Một khoản khách trả qua cổng: ai nhận, nội dung gì, bao nhiêu, và gọi API nào khi khách xác nhận. */
export interface GatewayOrder {
  /** Chi nhánh nhận tiền — hiện "KhoAn — <chi nhánh>". */
  facilityId: string;
  /** Mã đặt chỗ / hợp đồng ghi vào nội dung thanh toán. */
  code: string;
  /** Loại khoản: "Tiền giữ chân", "Gia hạn 3 tháng"… */
  purpose: string;
  amount: number;
  /** Các khoản cộng thành số tiền (không bắt buộc). */
  lines?: { label: string; amount: number }[];
  /** Hình thức chọn sẵn khi mở cổng. */
  method?: PaymentMethod;
  /** Gọi ĐÚNG API hiện có với hình thức khách chọn — qua `run()` của store (tự tải lại dữ liệu, tự báo lỗi). */
  pay: (method: PaymentMethod) => Promise<RunResult<unknown>>;
  /** Nút quay về sau khi trả xong ("Về đặt chỗ"…): có `href` thì chuyển trang, không thì chỉ đóng cổng. */
  back: { label: string; href?: string };
}

/** `before`: trạng thái các khoản trước khi trả — khoản vừa thu là khoản mới, hoặc khoản chờ (PENDING) vừa chuyển sang đã thu. */
type Phase = { kind: 'pay' } | { kind: 'processing' } | { kind: 'ok'; amount: number; before: Record<string, PaymentStatus>; replayed?: boolean } | { kind: 'fail'; error: string };

/**
 * Cổng thanh toán GIẢ LẬP dùng chung cho mọi khoản khách trả online trên web: tiền giữ chỗ, gia hạn, dịch vụ thêm, trả công nợ,
 * phí cấp lại thẻ / chìa. Chỉ là lớp giao diện — bấm xác nhận mới gọi API thật (server giả lập cổng, ghi mã giao dịch); "Huỷ" đóng
 * mà không gọi gì. Mở chồng được lên hộp thoại khác. Nhân viên thu tại quầy KHÔNG dùng màn này.
 * `onClose(paid)`: paid = true khi đóng sau lúc trả thành công — nơi gọi đóng luôn hộp của mình.
 *
 * Đợt VNPAY: `paymentMode === 'VNPAY'` thì màn này chỉ là bước xác nhận: bỏ chọn hình thức và thông tin mẫu, gửi method VNPAY, server trả 202 thì chuyển sang
 * trang VNPAY; kết quả xem ở /payment/return. Chuyển hay không theo phản hồi thật, không theo cấu hình. Chế độ khác giữ nguyên như cũ.
 */
export function MockGateway({ order, onClose }: { order: GatewayOrder | null; onClose: (paid: boolean) => void }) {
  const { db, user, catalog, paymentMode } = useStore();
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');
  const [phase, setPhase] = useState<Phase>({ kind: 'pay' });
  // Mỗi lần MỞ cổng → về bước chọn hình thức (theo lúc mở / đóng, không theo từng lần nơi gọi dựng lại `order`).
  const open = !!order;
  useEffect(() => {
    setPhase({ kind: 'pay' }); // cả lúc đóng — lần mở sau không loé lại kết quả cũ
    if (open) setMethod(order?.method && ONLINE_METHODS.includes(order.method) ? order.method : 'VNPAY');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Khách bấm Back từ trang VNPAY, trình duyệt khôi phục nguyên trang (bfcache): đừng kẹt ở "Đang xử lý…". Bấm tiếp nhận lại đúng giao dịch cũ (reused).
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setPhase((p) => (p.kind === 'processing' ? { kind: 'pay' } : p)); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  if (!order) return null;

  const vnpay = paymentMode === 'VNPAY';
  const payMethod: PaymentMethod = vnpay ? 'VNPAY' : method; // order.method có thể chọn sẵn hình thức khác
  const paid = phase.kind === 'ok';
  const close = () => { if (phase.kind !== 'processing') onClose(paid); };
  const branch = db.facilities.some((f) => f._id === order.facilityId) ? facilityName(db, order.facilityId) : catalog?.facilities.find((f) => f._id === order.facilityId)?.name ?? '';
  const note = `${order.code} ${order.purpose}`.toUpperCase();

  const confirm = async () => {
    const before = Object.fromEntries(db.payments.map((p) => [p._id, p.status]));
    setPhase({ kind: 'processing' });
    const res = await order.pay(payMethod);
    // Đợt VNPAY: giữ nguyên "Đang xử lý…" trong lúc trình duyệt rời trang.
    if (!res.ok && res.code === 'GATEWAY_REDIRECT') { window.location.assign((res.details as GatewayStart['gateway']).payUrl); return; }
    // Đợt 17 (D6): khoản đã thu từ lần trước (bấm lại, thử lại sau lỗi mạng) — server không thu thêm, vẫn báo thành công.
    if (res.ok) setPhase({ kind: 'ok', amount: typeof res.value === 'number' && res.value > 0 ? res.value : order.amount, before, replayed: !!(res.value as { replayed?: boolean } | null)?.replayed });
    else setPhase({ kind: 'fail', error: res.error });
  };

  // Khoản vừa thu (so với trước khi trả: khoản mới, hoặc khoản chờ vừa được thu) — lấy mã giao dịch và biên lai.
  const fresh = phase.kind === 'ok'
    ? db.payments.filter((p) => p.customerId === user?._id && p.direction === 'CHARGE' && hasReceipt(p)
      && !(phase.before[p._id] && COLLECTED_PAYMENT_STATUSES.includes(phase.before[p._id])))
    : [];
  const refs = fresh.map((p) => p.provider?.txnRef ?? p.provider?.counterRef).filter((x): x is string => !!x);
  const receipts = fresh;

  const footer = phase.kind === 'pay' || phase.kind === 'processing' ? (
    <>
      <Button variant="secondary" disabled={phase.kind === 'processing'} onClick={close}>Huỷ</Button>
      <Button disabled={phase.kind === 'processing'} onClick={() => void confirm()}>
        {phase.kind === 'processing' ? <><Loader2 className="size-4 animate-spin" />Đang xử lý…</> : vnpay ? 'Tiếp tục tới VNPAY' : QR_METHODS.includes(method) ? 'Tôi đã thanh toán' : 'Xác nhận thanh toán'}
      </Button>
    </>
  ) : phase.kind === 'fail' ? (
    <>
      <Button variant="secondary" onClick={close}>Huỷ</Button>
      <Button onClick={() => setPhase({ kind: 'pay' })}>Thử lại</Button>
    </>
  ) : (
    <Button onClick={() => { const href = order.back.href; onClose(true); if (href) router.push(href); }}>{order.back.label}</Button>
  );

  return (
    <Modal open stacked onClose={close} title={vnpay ? 'Thanh toán qua VNPAY' : 'Cổng thanh toán (giả lập)'}
      description={<span className="inline-flex items-center gap-1.5 text-xs text-amber-700"><FlaskConical className="size-3.5" />{vnpay ? 'Môi trường thử nghiệm VNPAY — dùng thẻ test' : 'Môi trường thử nghiệm — không trừ tiền thật'}</span>}
      footer={footer}>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl bg-stone-50 p-4 ring-1 ring-inset ring-stone-200">
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-4"><dt className="text-stone-500">Người nhận</dt><dd className="text-right font-medium">KhoAn{branch ? ` — ${branch}` : ''}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-500">Nội dung</dt><dd className="text-right"><span className="font-mono text-xs">{order.code}</span> · {order.purpose}</dd></div>
            {order.lines?.map((l) => (
              <div key={l.label} className="flex justify-between gap-4 text-xs text-stone-600"><dt>{l.label}</dt><dd className="tabular-nums">{vnd(l.amount)}</dd></div>
            ))}
          </dl>
          <p className="mt-3 border-t border-stone-200 pt-3 text-xs text-stone-500">Số tiền</p>
          <p className="text-3xl font-semibold tabular-nums text-ink">{vnd(phase.kind === 'ok' ? phase.amount : order.amount)}</p>
        </div>

        {!vnpay && (phase.kind === 'pay' || phase.kind === 'processing') && (
          <>
            <fieldset disabled={phase.kind === 'processing'}><PayMethodPicker value={method} onChange={setMethod} methods={ONLINE_METHODS} /></fieldset>
            {QR_METHODS.includes(method) && (
              <div className="flex flex-col items-center gap-2 rounded-xl p-4 ring-1 ring-inset ring-stone-200">
                <QrCode value={`KHOAN-DEMO|${method}|${order.code}|${order.amount}`} size={168} label={`Mã QR ${PAYMENT_METHOD[method]} mẫu`} />
                <p className="flex items-center gap-1.5 text-xs text-stone-500"><QrIcon className="size-3.5" />Mã mẫu — mở ứng dụng {PAYMENT_METHOD[method]} để quét</p>
              </div>
            )}
            {method === 'CARD' && (
              <div className="space-y-3 rounded-xl p-4 ring-1 ring-inset ring-stone-200">
                <p className="flex items-center gap-1.5 text-xs text-stone-500"><CreditCard className="size-3.5" />Thẻ mẫu, chỉ để hiển thị — không nhập thẻ thật</p>
                <input className={inputCls} readOnly tabIndex={-1} aria-label="Số thẻ mẫu" value="4111 1111 1111 1111" />
                <div className="grid grid-cols-[1fr_88px_72px] gap-2">
                  <input className={inputCls} readOnly tabIndex={-1} aria-label="Chủ thẻ mẫu" value="KHACH HANG THU NGHIEM" />
                  <input className={inputCls} readOnly tabIndex={-1} aria-label="Hết hạn" value="12/30" />
                  <input className={inputCls} readOnly tabIndex={-1} aria-label="CVV" value="•••" />
                </div>
              </div>
            )}
            {method === 'BANK_TRANSFER' && (
              <dl className="space-y-1.5 rounded-xl p-4 ring-1 ring-inset ring-stone-200">
                <p className="mb-1 flex items-center gap-1.5 text-xs text-stone-500"><Landmark className="size-3.5" />Tài khoản giả định của KhoAn</p>
                <div className="flex justify-between gap-4"><dt className="text-stone-500">Ngân hàng</dt><dd className="text-right">{DEMO_BANK.bank}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-stone-500">Số tài khoản</dt><dd className="font-mono">{DEMO_BANK.account}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-stone-500">Chủ tài khoản</dt><dd className="text-right">{DEMO_BANK.holder}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-stone-500">Nội dung CK</dt><dd className="text-right font-mono text-xs">{note}</dd></div>
              </dl>
            )}
          </>
        )}

        {phase.kind === 'fail' && (
          <div className="flex gap-2 rounded-lg bg-red-50 p-3 text-red-800 ring-1 ring-inset ring-red-200">
            <CircleX className="mt-0.5 size-4 shrink-0" />
            <div><p className="font-semibold">{vnpay ? 'Chưa mở được trang thanh toán' : 'Thanh toán không thành công'}</p><p className="mt-0.5">{phase.error}</p></div>
          </div>
        )}

        {phase.kind === 'ok' && (
          <div className="space-y-3 rounded-lg bg-emerald-50 p-4 text-emerald-900 ring-1 ring-inset ring-emerald-200">
            <p className="flex items-center gap-2 font-semibold"><CircleCheck className="size-5" />{phase.replayed ? 'Khoản này đã thanh toán trước đó — không thu thêm' : `Thanh toán thành công · ${PAYMENT_METHOD[payMethod]}`}</p>
            {refs.length > 0 && <p>Mã giao dịch: <span className="font-mono text-xs">{refs.join(', ')}</span></p>}
            {receipts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {receipts.map((p) => <ReceiptButton key={p._id} paymentId={p._id} print label={receipts.length > 1 ? `In / tải biên lai ${vnd(p.amount)}` : 'In / tải biên lai'} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
