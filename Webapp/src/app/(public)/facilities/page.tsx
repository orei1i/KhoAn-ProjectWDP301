'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ArrowRight, Clock3, MapPin, Search, SearchX, X } from 'lucide-react';
import type { UnitCategory } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { FACILITY_STATUS, UNIT_CATEGORY } from '@/shared/lib/labels';
import { unitRate } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { facilityPhoto } from '@/shared/lib/images';
import { ButtonLink, Card, EmptyState, Skeleton, StatusBadge, cx, inputCls } from '@/shared/ui';
import { AvailabilityBar, CATEGORY_ICON, availabilityTone } from '@/features/facilities/visuals';

const CATS: UnitCategory[] = ['LOCKER', 'SMALL', 'MEDIUM', 'LARGE', 'XL'];
const CHIP_TONE = { red: 'bg-red-50 text-red-700 ring-red-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200' } as const;

function FacilityList() {
  const { catalog } = useStore();
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<UnitCategory | ''>((sp.get('cat') as UnitCategory) ?? '');
  const onlyFacility = sp.get('facility');

  const rows = useMemo(() => (catalog?.facilities ?? [])
    .filter((f) => !f.isDeleted && (!onlyFacility || f._id === onlyFacility))
    .filter((f) => !q || `${f.name} ${f.address.line1} ${f.address.district}`.toLowerCase().includes(q.toLowerCase()))
    .map((f) => {
      const types = (catalog?.unitTypes ?? []).filter((t) => t.facilityId === f._id && t.isActive && (!cat || t.category === cat));
      const avail = types.map((t) => ({ t, a: f.availability.find((x) => x.unitTypeId === t._id)?.available ?? 0, total: f.availability.find((x) => x.unitTypeId === t._id)?.total ?? 0 }));
      return { f, avail, from: types.length ? Math.min(...types.map((t) => unitRate(t, 'MONTH'))) : 0 };
    })
    .filter((r) => r.avail.length > 0), [catalog, q, cat, onlyFacility]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Chi nhánh</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Tìm kho trống</h1>
        </div>
        {catalog && <p className="text-sm text-stone-500"><b className="text-ink">{rows.length}</b> chi nhánh phù hợp</p>}
      </div>

      {/* ---- bộ lọc: ô tìm + chip cỡ kho */}
      <Card className="mt-6 p-4">
        <label className="relative block">
          <span className="sr-only">Tìm theo tên hoặc địa chỉ</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <input className={cx(inputCls, 'h-11 pl-9')} placeholder="Tìm theo tên hoặc địa chỉ — VD: Thủ Đức, Cộng Hòa…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Loại kho">
          {([['', 'Mọi kích thước'] as const, ...CATS.map((c) => [c, UNIT_CATEGORY[c]] as const)]).map(([v, label]) => {
            const Icon = v ? CATEGORY_ICON[v] : null;
            return (
              <button key={label} type="button" aria-pressed={cat === v} onClick={() => setCat(v)}
                className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors', cat === v ? 'bg-ink text-white ring-ink' : 'bg-white text-stone-600 ring-stone-300 hover:bg-stone-50')}>
                {Icon && <Icon className="size-3.5" />}{label}
              </button>
            );
          })}
        </div>
      </Card>

      {onlyFacility && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-800">
          Đang lọc 1 chi nhánh <Link className="inline-flex items-center gap-0.5 font-medium hover:underline" href="/facilities"><X className="size-3.5" />Bỏ lọc</Link>
        </p>
      )}

      <div className="mt-6 grid gap-5">
        {!catalog && Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="grid overflow-hidden md:grid-cols-[280px_1fr]"><Skeleton className="aspect-[16/9] rounded-none md:aspect-auto md:h-full" /><div className="grid gap-2 p-5"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-72" /><Skeleton className="mt-3 h-2 w-full" /><Skeleton className="h-7 w-64" /></div></Card>
        ))}
        {catalog && rows.length === 0 && <Card><EmptyState icon={<SearchX className="size-6" />} title="Không tìm thấy chi nhánh phù hợp" description="Thử bỏ bớt bộ lọc." /></Card>}
        {rows.map(({ f, avail, from }) => {
          const active = f.status === 'ACTIVE';
          const free = avail.reduce((n, x) => n + x.a, 0);
          const total = avail.reduce((n, x) => n + x.total, 0);
          return (
            <Card key={f._id} className="grid overflow-hidden transition hover:shadow-lift md:grid-cols-[300px_1fr]">
              <Link href={`/facilities/${f._id}/gioi-thieu`} className="group relative block aspect-[16/9] overflow-hidden md:aspect-auto md:min-h-56" tabIndex={-1} aria-hidden>
                <img src={facilityPhoto(f)} alt="" loading="lazy" decoding="async" className={cx('absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105', !active && 'grayscale-[40%]')} />
                <span className="absolute left-3 top-3"><StatusBadge map={FACILITY_STATUS} value={f.status} /></span>
              </Link>
              <div className="flex flex-col p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">{f.name}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500"><MapPin className="size-3.5 shrink-0" />{f.address.line1}, {f.address.district}, {f.address.city}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-stone-500"><Clock3 className="size-3.5 shrink-0" />Văn phòng 07:00–21:00 · Ra vào kho {f.accessHours?.open}–{f.accessHours?.close}</p>
                  </div>
                  {from > 0 && <p className="text-right text-sm text-stone-500">từ <b className="block text-2xl font-bold tabular-nums text-brand-700">{vnd(from)}</b>/tháng</p>}
                </div>

                {active ? (
                  <>
                    <AvailabilityBar available={free} total={total} className="mt-4 max-w-md" />
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {avail.map(({ t, a }) => {
                        const Icon = CATEGORY_ICON[t.category];
                        return (
                          <li key={t._id} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', CHIP_TONE[availabilityTone(a)])}>
                            <Icon className="size-3.5" />{t.name}: {a === 0 ? 'hết chỗ' : `còn ${a}`}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : <p className="mt-4 inline-flex w-fit rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Sắp khai trương — chưa nhận đặt chỗ</p>}

                {/* Xem giới thiệu (hình ảnh, cỡ kho) trước, rồi mới sang trang chọn ô & đặt kho. */}
                <div className="mt-auto flex flex-wrap justify-end gap-2 pt-5">
                  <ButtonLink href={`/facilities/${f._id}/gioi-thieu`} variant={active ? 'secondary' : 'primary'}>Xem giới thiệu kho</ButtonLink>
                  {active && <ButtonLink href={`/facilities/${f._id}`}>Đặt kho <ArrowRight className="size-4" /></ButtonLink>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </main>
  );
}

export default function FacilitiesPage() {
  return <Suspense><FacilityList /></Suspense>;
}
