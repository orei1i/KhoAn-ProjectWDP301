'use client';

import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useStore } from '@/shared/store/store';
import { cx } from '@/shared/ui';

export function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cx('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1', t.tone === 'error' ? 'bg-red-50 text-red-800 ring-red-200' : t.tone === 'success' ? 'bg-white text-ink ring-emerald-200' : 'bg-white text-ink ring-stone-200')}>
          {t.tone === 'error' ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : t.tone === 'success' ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />}
          <p className="flex-1">{t.text}</p>
          <button onClick={() => dismiss(t.id)} className="text-stone-400 hover:text-stone-700" aria-label="Đóng"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
