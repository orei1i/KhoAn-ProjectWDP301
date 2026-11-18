'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/shared/ui';

/**
 * Khung xám theo đúng bố cục trang sau đăng nhập (thanh bên, tiêu đề, thẻ số liệu, danh sách) — dùng khi Firebase đang khôi phục phiên
 * hoặc vừa đăng nhập mà dữ liệu chưa về. Trang thật hiện ra đúng chỗ, không nhảy bố cục.
 * Chờ quá `slowAfterMs` (máy chủ Render ngủ, lần đầu trong ngày) thì hiện một dòng nhỏ ở cuối để người dùng biết không bị treo.
 */
export function AppShellSkeleton({ slowAfterMs = 6000, overlay = false }: { slowAfterMs?: number; overlay?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(t);
  }, [slowAfterMs]);

  return (
    // `overlay`: phủ cả trang (trang đăng nhập nằm trong khung trang công khai có header / footer riêng).
    <div className={overlay ? 'fixed inset-0 z-50 flex overflow-hidden bg-stone-50' : 'flex min-h-screen'} aria-busy aria-label="Đang tải">
      <aside className="hidden w-64 shrink-0 flex-col bg-ink p-4 lg:flex">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-lg bg-white/10" />
          <Skeleton className="h-5 w-24 bg-white/10" />
        </div>
        <Skeleton className="mt-8 h-3 w-20 bg-white/10" />
        <div className="mt-3 grid gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-4 rounded bg-white/10" />
              <Skeleton className={`h-3.5 bg-white/10 ${i % 3 === 0 ? 'w-32' : i % 3 === 1 ? 'w-24' : 'w-28'}`} />
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-3 border-t border-white/10 pt-4">
          <Skeleton className="size-9 rounded-full bg-white/10" />
          <div className="grid gap-1.5"><Skeleton className="h-3.5 w-28 bg-white/10" /><Skeleton className="h-3 w-20 bg-white/10" /></div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex h-14 items-center justify-between border-b border-stone-200/70 bg-white px-4 lg:hidden">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div className="grid gap-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80 max-w-[70vw]" /></div>
            <Skeleton className="hidden h-9 w-36 rounded-lg sm:block" />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-white p-5 ring-1 ring-stone-200/70">
                <div className="flex items-center gap-3"><Skeleton className="size-10 rounded-xl" /><Skeleton className="h-4 w-28" /></div>
                <Skeleton className="mt-4 h-7 w-24" />
                <Skeleton className="mt-2 h-3 w-36" />
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="rounded-2xl bg-white ring-1 ring-stone-200/70">
              <div className="flex items-center gap-3 border-b border-stone-100 p-4"><Skeleton className="size-8 rounded-lg" /><Skeleton className="h-4 w-40" /></div>
              <div className="divide-y divide-stone-100">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <Skeleton className="size-10 rounded-xl" />
                    <div className="grid flex-1 gap-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /></div>
                    <Skeleton className="hidden h-8 w-24 rounded-lg sm:block" />
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden rounded-2xl bg-white p-4 ring-1 ring-stone-200/70 lg:block">
              <div className="flex items-center gap-3"><Skeleton className="size-8 rounded-lg" /><Skeleton className="h-4 w-28" /></div>
              <div className="mt-5 grid gap-4">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="grid gap-2"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-2 w-full rounded-full" /></div>)}
              </div>
            </div>
          </div>

          <p role="status" className={`mt-6 text-center text-xs text-stone-500 transition-opacity duration-500 ${slow ? 'opacity-100' : 'opacity-0'}`}>
            Máy chủ đang khởi động — lần đầu trong ngày có thể mất 30–60 giây.
          </p>
        </div>
      </div>
    </div>
  );
}
