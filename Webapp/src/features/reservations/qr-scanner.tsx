'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, TriangleAlert } from 'lucide-react';
import { Button, Modal } from '@/shared/ui';

/**
 * Quét mã QR nhận kho bằng camera máy tính của nhân viên.
 *
 * Mở camera qua getUserMedia, mỗi ~200ms vẽ một khung hình ra canvas rồi để jsQR giải mã. Đọc được
 * chuỗi thì gọi onResult và tắt camera ngay (dừng mọi track) — không giữ camera chạy nền. Truyền
 * nguyên chuỗi decode cho nơi gọi vì endpoint /reservations/lookup nhận cả "SSM:<code>:<token>" lẫn mã trần.
 */
export function QrScanButton({ onResult }: { onResult: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}><Camera className="size-4" />Quét mã</Button>
      {open && <ScannerModal onClose={() => setOpen(false)} onResult={(t) => { setOpen(false); onResult(t); }} />}
    </>
  );
}

function ScannerModal({ onClose, onResult }: { onClose: () => void; onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    const stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth, h = video.videoHeight;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
          if (code?.data) { stop(); onResult(code.data.trim()); return; }
        }
      }
      // ~5 khung/giây là đủ để đọc QR, đỡ tốn CPU hơn quét mỗi frame.
      raf = requestAnimationFrame(() => setTimeout(tick, 200));
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play(); tick(); }
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(name === 'NotAllowedError'
          ? 'Trình duyệt chưa được cấp quyền camera. Bấm biểu tượng camera trên thanh địa chỉ để cho phép, rồi thử lại.'
          : name === 'NotFoundError'
          ? 'Không tìm thấy camera trên máy này.'
          : 'Không mở được camera. Kiểm tra thiết bị và thử lại.');
      }
    })();

    return stop;
  }, [onResult]);

  return (
    <Modal open onClose={onClose} title="Quét mã QR nhận kho" description="Đưa mã QR của khách vào khung hình">
      {error ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
          <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/70" />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      <p className="mt-3 text-xs text-stone-500">Không quét được? Đóng cửa sổ này và nhập mã đặt chỗ bằng tay.</p>
    </Modal>
  );
}
