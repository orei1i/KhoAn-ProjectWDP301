'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Eraser } from 'lucide-react';
import { Button, cx } from '@/shared/ui';

const W = 480;
const H = 160;

/**
 * Khung vẽ chữ ký bằng chuột/ngón tay. Trả về PNG data URL (nền trong suốt) khi vẽ xong một nét,
 * hoặc null khi xoá. Ảnh nhỏ (vài KB) vì chỉ có nét mảnh trên canvas 480×160.
 */
export function SignaturePad({ onChange, className }: { onChange: (dataUrl: string | null) => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1c1917';
  }, []);

  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current!.getContext('2d')!;
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y + 0.01); ctx.stroke(); // chấm một điểm khi chỉ chạm
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y); ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(ref.current!.toDataURL('image/png'));
  };
  const clear = () => {
    ref.current!.getContext('2d')!.clearRect(0, 0, W, H);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className={className}>
      <canvas ref={ref} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className={cx('w-full touch-none cursor-crosshair rounded-lg bg-white ring-1 ring-inset ring-stone-300')} style={{ aspectRatio: `${W} / ${H}` }} />
      <div className="mt-1.5 flex items-center justify-between text-xs text-stone-500">
        <span>{empty ? 'Dùng chuột hoặc ngón tay ký vào khung trên' : 'Đã có chữ ký'}</span>
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={empty}><Eraser className="size-3.5" />Xoá ký lại</Button>
      </div>
    </div>
  );
}
