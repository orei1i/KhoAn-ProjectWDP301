'use client';

import Link from 'next/link';
import { ArrowRight, CalendarCheck, ScrollText } from 'lucide-react';
import { LEGAL_EFFECTIVE, type LegalSection } from '@/features/legal/legal-content';
import { Card, IconTile } from '@/shared/ui';

/** Mã neo cho từng mục (dùng cho mục lục bên cạnh). */
const anchor = (i: number) => `muc-${i + 1}`;

/**
 * Khung chung cho trang Điều khoản và trang Bảo mật — hai trang chỉ khác nội dung truyền vào.
 * Nội dung hiển thị ĐẦY ĐỦ (văn bản pháp lý không thu gọn); mục lục dính bên trái giúp nhảy nhanh tới từng mục.
 */
export function LegalPage({ title, version, effective = LEGAL_EFFECTIVE, sections, other }: {
  title: string; version: string; effective?: string; sections: LegalSection[]; other: { href: string; label: string };
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-start gap-4">
        <IconTile icon={<ScrollText className="size-6" />} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-stone-600 ring-1 ring-inset ring-stone-200">Phiên bản {version}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-stone-600 ring-1 ring-inset ring-stone-200"><CalendarCheck className="size-3.5 text-brand-700" />Áp dụng từ {effective}</span>
            <Link href={other.href} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 font-medium text-brand-800 ring-1 ring-inset ring-brand-200 hover:bg-brand-100">{other.label.replace(/\s*→\s*$/, '')}<ArrowRight className="size-3.5" /></Link>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Mục lục" className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl bg-white p-3 ring-1 ring-stone-200">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Mục lục</p>
            <ol className="grid gap-0.5 text-sm">
              {sections.map((s, i) => (
                <li key={s.heading}><a href={`#${anchor(i)}`} className="block rounded-lg px-2 py-1.5 leading-snug text-stone-600 transition-colors hover:bg-stone-100 hover:text-ink">{s.heading}</a></li>
              ))}
            </ol>
          </div>
        </nav>

        <Card className="p-6 sm:p-8">
          {sections.map((s, i) => (
            <section key={s.heading} id={anchor(i)} className="mb-8 scroll-mt-24 border-b border-stone-100 pb-8 last:mb-0 last:border-0 last:pb-0">
              <h2 className="text-lg font-semibold">{s.heading}</h2>
              {s.body.map((p, j) => <p key={j} className="mt-2 text-sm leading-relaxed text-stone-700">{p}</p>)}
              {s.table && (
                <div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-stone-200">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-stone-50">
                      <tr>{s.table.head.map((h) => <th key={h} className="border-b border-stone-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {s.table.rows.map((row, r) => (
                        <tr key={r} className="even:bg-stone-50/50">{row.map((c, k) => <td key={k} className="border-b border-stone-100 px-3 py-2 align-top text-stone-700">{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </Card>
      </div>

      <p className="mt-4 text-xs text-stone-500 lg:ml-[264px]">
        Bản đã được khách hàng chấp thuận tại thời điểm đặt kho được lưu kèm số phiên bản trong hồ sơ đặt chỗ. Nội dung thay đổi sẽ phát hành ở phiên bản mới, không ảnh hưởng hợp đồng đang có hiệu lực.
      </p>
    </main>
  );
}
