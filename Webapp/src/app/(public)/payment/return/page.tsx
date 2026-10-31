'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Clock3, Loader2, SearchX, ShieldAlert, Undo2 } from 'lucide-react';
import { GATEWAY_REFUND_STATE, GATEWAY_REFUND_TRANSFERRED_LABEL, GATEWAY_TXN_REF_RE, LOST_KEY_URGENT_NOTE, lastDayOf, type GatewayOrderView } from '@ssm/shared';
import { api, ApiError } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, StatusBadge } from '@/shared/ui';
import { ReceiptButton } from '@/features/payments/receipt-button';

const POLL_MS = 3_000;
const POLL_FOR_MS = 90_000;

/** Về màn gốc theo loại khoản. Đặt chỗ: mã QR tự cấp ở trang đặt chỗ. */
function backOf(v: GatewayOrderView): { href: string; label: string } {
  if (v.kind === 'DEPOSIT' && v.reservationId) return { href: `/booking/${v.reservationId}`, label: 'Về đặt chỗ' };
  if (v.kind === 'SERVICE') return { href: '/portal/services', label: 'Về dịch vụ thêm' };
  return { href: '/portal/units', label: 'Về kho đang thuê' };
}

function RefundBadge({ refund }: { refund: NonNullable<GatewayOrderView['refund']> }) {
  return <StatusBadge map={refund.transferred ? { ...GATEWAY_REFUND_STATE, MOVED_TO_BANK: GATEWAY_REFUND_TRANSFERRED_LABEL } : GATEWAY_REFUND_STATE} value={refund.state} />;
}

function Panel({ icon, tone, title, children }: { icon: ReactNode; tone: 'green' | 'amber' | 'red' | 'gray'; title: string; children?: ReactNode }) {
  const tones = { green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700', gray: 'text-stone-500' };
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 sm:py-14">
      <Card className="p-6">
        <h1 className={`flex items-start gap-2 text-lg font-semibold ${tones[tone]}`}><span className="mt-0.5 shrink-0 [&>svg]:size-5" aria-hidden>{icon}</span>{title}</h1>
        {children && <div className="mt-3 space-y-3 text-sm text-stone-700">{children}</div>}
      </Card>
    </main>
  );
}

const Checking = () => <Panel icon={<Loader2 className="animate-spin" />} tone="gray" title="Đang kiểm tra giao dịch…" />;

/**
 * Trang kết quả sau khi khách rời VNPAY. Chỉ đọc mã giao dịch; mọi tham số khác trên URL đều bỏ qua (ai cũng sửa được): kết quả luôn lấy từ BE,
 * BE chỉ tin IPN và QueryDr đã kiểm chữ ký. Có thể mở lại bất cứ lúc nào, kể cả sau khi đăng nhập.
 */
function ReturnInner() {
  const ref = useSearchParams().get('vnp_TxnRef') ?? '';
  const valid = GATEWAY_TXN_REF_RE.test(ref);
  const { user, ready, syncing, refresh, reloadCatalog, db } = useStore();
  const uid = user?._id ?? null;
  const [view, setView] = useState<GatewayOrderView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [waitedOut, setWaitedOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const refreshed = useRef(false);

  /** Trả true nếu không cần hỏi tiếp. Lỗi tạm thời (mạng, BE đang khởi động, giới hạn tần suất) không kết luận gì, chờ lượt sau. */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const v = await api.get<GatewayOrderView>(`/payments/gateway-orders/${ref}`);
      setView(v);
      setNotFound(false);
      return v.status !== 'PENDING';
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) { setNotFound(true); return true; }
      return false;
    }
  }, [ref]);

  useEffect(() => {
    if (!valid || !uid) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const done = await load();
      if (!alive || done) return;
      if (Date.now() - started >= POLL_FOR_MS) { setWaitedOut(true); return; }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    setView(null); setNotFound(false); setWaitedOut(false);
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [valid, uid, load]);

  // Tiền đã vào: nạp lại dữ liệu để màn gốc hiện đúng ngay khi khách quay về.
  const settled = view?.status === 'PAID' || view?.status === 'PAID_UNAPPLIED';
  useEffect(() => {
    if (!settled || refreshed.current) return;
    refreshed.current = true;
    void refresh().catch(() => {});
    void reloadCatalog();
  }, [settled, refresh, reloadCatalog]);

  if (!valid) return <Panel icon={<SearchX />} tone="gray" title="Không tìm thấy giao dịch"><p>Đường dẫn không có mã giao dịch hợp lệ.</p></Panel>;
  if (!ready || syncing) return <Checking />;
  if (!user) {
    // Chỉ mang mã giao dịch theo: đủ để xem lại kết quả, không kéo các tham số khác của VNPAY sang trang đăng nhập.
    const next = `/payment/return?vnp_TxnRef=${ref}`;
    return (
      <Panel icon={<Clock3 />} tone="gray" title="Đăng nhập để xem kết quả giao dịch">
        <p>Kết quả chỉ hiện cho tài khoản đã thực hiện giao dịch. Nếu bạn đã trả, tiền vẫn được ghi nhận dù chưa đăng nhập.</p>
        <ButtonLink href={`/login?next=${encodeURIComponent(next)}`}>Đăng nhập</ButtonLink>
      </Panel>
    );
  }
  if (notFound) return <Panel icon={<SearchX />} tone="gray" title="Không tìm thấy giao dịch"><p>Mã giao dịch không tồn tại hoặc thuộc tài khoản khác. Kiểm tra lại tài khoản đang đăng nhập.</p></Panel>;

  const urgent = view?.kind === 'ACCESS_FEE' && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-amber-900 ring-1 ring-amber-200"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{LOST_KEY_URGENT_NOTE}</p>;

  if (!view || view.status === 'PENDING') {
    if (!waitedOut) return <Panel icon={<Loader2 className="animate-spin" />} tone="amber" title="Đang xử lý giao dịch"><p>Vui lòng giữ trang này, kết quả sẽ tự cập nhật.</p>{urgent}</Panel>;
    return (
      <Panel icon={<Clock3 />} tone="amber" title="Chưa nhận được kết quả">
        <p>Nếu đã trả, hệ thống tự cập nhật trong vài phút.</p>
        {urgent}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={checking} onClick={() => { setChecking(true); void load().finally(() => setChecking(false)); }}>
            {checking && <Loader2 className="size-4 animate-spin" />}Kiểm tra lại
          </Button>
          {view?.payUrl && <Button onClick={() => window.location.assign(view.payUrl!)}>Tiếp tục thanh toán</Button>}
          {view && <ButtonLink variant="ghost" href={backOf(view).href}>{backOf(view).label}</ButtonLink>}
        </div>
      </Panel>
    );
  }

  const back = backOf(view);
  if (view.status === 'PAID') {
    const paymentOf = (id: string) => db.payments.find((p) => p._id === id);
    return (
      <Panel icon={<CircleCheck />} tone="green" title="Thanh toán thành công">
        <p className="text-3xl font-semibold tabular-nums text-ink">{vnd(view.amount)}</p>
        {view.transactionNo && <p>Mã giao dịch VNPAY: <span className="font-mono text-xs">{view.transactionNo}</span></p>}
        {view.result?.newEndDate && <p>Hợp đồng được gia hạn đến hết ngày {fmtDate(lastDayOf(view.result.newEndDate))}.</p>}
        {/* Về sau khoản này có thể được hoàn (huỷ đặt chỗ, huỷ đơn...): không để khách đọc là tiền vẫn đang giữ nguyên. */}
        {view.refund && <p className="flex flex-wrap items-center gap-2">Hoàn tiền {vnd(view.refund.amount)}: <RefundBadge refund={view.refund} /></p>}
        <div className="flex flex-wrap gap-2">
          {view.paymentIds.map((id) => {
            const p = paymentOf(id);
            return <ReceiptButton key={id} paymentId={id} print label={view.paymentIds.length > 1 && p ? `In / tải biên lai ${vnd(p.amount)}` : 'In / tải biên lai'} />;
          })}
          <ButtonLink href={back.href}>{back.label}</ButtonLink>
        </div>
      </Panel>
    );
  }

  if (view.status === 'PAID_UNAPPLIED') {
    return (
      <Panel icon={<Undo2 />} tone="amber" title="KhoAn đã nhận tiền nhưng không thực hiện được">
        {view.unapplied?.message && <p>{view.unapplied.message}</p>}
        {view.refund?.transferred
          ? <p>KhoAn đã chuyển khoản hoàn tiền tới tài khoản nhận tiền bạn đã khai.</p>
          : view.refund?.state === 'MOVED_TO_BANK'
            ? <p>Tiền đang được hoàn bằng chuyển khoản, tới tài khoản nhận tiền bạn đã khai. Chưa khai thì vui lòng khai ở trang Lịch sử thanh toán hoặc liên hệ chi nhánh.</p>
            : <p>Tiền đang được hoàn về phương thức bạn đã trả (tối đa 7 ngày làm việc). Bạn không cần làm gì thêm.</p>}
        <p className="text-3xl font-semibold tabular-nums text-ink">{vnd(view.amount)}</p>
        {view.transactionNo && <p>Mã giao dịch VNPAY: <span className="font-mono text-xs">{view.transactionNo}</span></p>}
        {view.refund && <p className="flex flex-wrap items-center gap-2">Tình trạng hoàn tiền: <RefundBadge refund={view.refund} /></p>}
        <ButtonLink href={back.href}>{back.label}</ButtonLink>
      </Panel>
    );
  }

  return (
    <Panel icon={<CircleX />} tone="red" title="Giao dịch không thành công hoặc đã hết hạn">
      <p>Bạn có thể thử lại từ màn trước.</p>
      {urgent}
      <ButtonLink href={back.href}>{back.label}</ButtonLink>
    </Panel>
  );
}

export default function PaymentReturnPage() {
  return <Suspense fallback={<Checking />}><ReturnInner /></Suspense>;
}
