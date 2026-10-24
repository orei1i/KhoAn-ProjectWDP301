'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { create as createQr } from 'qrcode';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '@/shared/api/client';
import { fmtDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui';

/** Lề trắng quanh mã (đơn vị: module) — chuẩn QR yêu cầu 4, thiếu lề là máy quét hay trượt. */
const QUIET = 4;

/**
 * Mã QR thật, vẽ bằng SVG từ ma trận của thư viện `qrcode` (tính đồng bộ, không cần canvas).
 * Mỗi hàng gộp các module đen liền nhau thành một đoạn để path gọn. Mã đen trên nền trắng vì
 * máy quét ở quầy chạy jsQR với `inversionAttempts: 'dontInvert'` — không đọc được mã đảo màu.
 */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label?: string }) {
  const { d, n } = useMemo(() => {
    const m = createQr(value, { errorCorrectionLevel: 'M' }).modules;
    let path = '';
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        if (!m.get(y, x)) continue;
        let len = 1;
        while (x + len < m.size && m.get(y, x + len)) len++;
        path += `M${x + QUIET} ${y + QUIET}h${len}v1h-${len}z`;
        x += len - 1;
      }
    }
    return { d: path, n: m.size + QUIET * 2 };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label ?? 'Mã QR'} shapeRendering="crispEdges" className="rounded-lg">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={d} fill="#16201e" />
    </svg>
  );
}

type Issued = { qrPayload: string; expiresAt?: string | null };

/**
 * Mã QR nhận kho của một đặt chỗ (CONFIRMED / ALLOCATED) — payload `SSM:<code>:<token>` mà quầy tra
 * qua /reservations/lookup.
 *
 * payDeposit trả payload đúng MỘT lần rồi server chỉ giữ sha256 của token, nên mở lại trang thì không
 * "đọc lại" được mã cũ: giống app, xin cấp mã mới qua `POST /reservations/:id/qr`. Mỗi lần cấp mới vô
 * hiệu hoá mã trước đó (kể cả mã đang hiện trên app / ảnh chụp màn hình).
 *
 * - `initialPayload`: payload vừa nhận từ payDeposit — có thì dùng luôn, không cấp lại.
 * - Chưa có payload thì chỉ cấp khi khách BẤM "Hiện mã" — mở trang để ký / tải hợp đồng không làm mất hiệu lực mã trên app.
 * - `hold`: đang thanh toán dở — chưa được tự cấp mã, nếu không sẽ ghi đè token payDeposit vừa phát.
 */
export function CheckInQr({ reservationId, code, initialPayload, expiresAt, hold = false, size = 200 }: {
  reservationId: string; code: string; initialPayload?: string | null; expiresAt?: string | null; hold?: boolean; size?: number;
}) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const issue = useCallback(async () => {
    if (busy.current) return; // chặn bấm liên tiếp — hai mã cấp chồng nhau thì mã hiện ra có thể đã bị mã sau vô hiệu
    busy.current = true;
    setLoading(true); setError('');
    try {
      setIssued(await api.post<{ qrPayload: string; code: string; expiresAt: string }>(`/reservations/${reservationId}/qr`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lấy được mã QR');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [reservationId]);

  const payload = issued?.qrPayload ?? initialPayload ?? null;
  const until = issued?.expiresAt ?? expiresAt ?? null;

  return (
    <div className="mx-auto text-center">
      <div className="grid place-items-center rounded-xl bg-white p-2 ring-1 ring-stone-200" style={{ width: size + 16, height: size + 16 }}>
        {payload && !loading ? <QrCode value={payload} size={size} label={`Mã QR nhận kho ${code}`} />
          : error ? <p className="flex flex-col items-center gap-2 px-3 text-xs text-amber-800"><TriangleAlert className="size-5" />{error}</p>
          : loading ? <span className="text-xs text-stone-500">Đang lấy mã…</span>
          : <Button type="button" size="sm" disabled={hold} onClick={() => void issue()}>Hiện mã QR</Button>}
      </div>
      <p className="mt-2 font-mono text-xs text-stone-500">{code}</p>
      {until && payload && !loading && <p className="text-[11px] text-stone-400">Hiệu lực đến {fmtDateTime(until)}</p>}
      {(payload || error) && (
        <Button type="button" variant="ghost" size="sm" className="mt-1" disabled={loading || hold} onClick={() => void issue()}>
          <RefreshCw className="size-3.5" />{error ? 'Thử lại' : 'Cấp mã mới'}
        </Button>
      )}
    </div>
  );
}
