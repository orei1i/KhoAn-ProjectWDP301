'use client';

import Link from 'next/link';
import { LEGAL_EFFECTIVE, type LegalSection } from '@/features/legal/legal-content';
import { Card } from '@/shared/ui';

/** Khung chung cho trang Điều khoản và trang Bảo mật — hai trang chỉ khác nội dung truyền vào. */
export function LegalPage({ title, version, effective = LEGAL_EFFECTIVE, sections, other }: {
  title: string; version: string; effective?: string; sections: LegalSection[]; other: { href: string; label: string };
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-stone-500">Phiên bản {version} · Áp dụng từ {effective}</p>
      <p className="mt-1 text-sm"><Link href={other.href} className="text-brand-700 hover:underline">{other.label}</Link></p>

      <Card className="mt-6 p-6 sm:p-8">
        {sections.map((s) => (
          <section key={s.heading} className="mb-7 last:mb-0">
            <h2 className="font-semibold">{s.heading}</h2>
            {s.body.map((p, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-stone-700">{p}</p>)}
            {s.table && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>{s.table.head.map((h) => <th key={h} className="border-b border-stone-200 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-400">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((row, i) => (
                      <tr key={i}>{row.map((c, j) => <td key={j} className="border-b border-stone-100 px-2 py-1.5 align-top text-stone-700">{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </Card>

      <p className="mt-4 text-xs text-stone-500">
        Bản đã được khách hàng chấp thuận tại thời điểm đặt kho được lưu kèm số phiên bản trong hồ sơ đặt chỗ. Nội dung thay đổi sẽ phát hành ở phiên bản mới, không ảnh hưởng hợp đồng đang có hiệu lực.
      </p>
    </main>
  );
}
