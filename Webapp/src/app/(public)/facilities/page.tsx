'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { Clock, MapPin, Search } from 'lucide-react';
import type { UnitCategory } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { FACILITY_STATUS, UNIT_CATEGORY } from '@/shared/lib/labels';
import { unitRate } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Badge, ButtonLink, Card, EmptyState, Field, StatusBadge, cx, inputCls } from '@/shared/ui';

const CATS: UnitCategory[] = ['LOCKER', 'SMALL', 'MEDIUM', 'LARGE', 'XL'];

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
      const avail = types.map((t) => ({ t, a: f.availability.find((x) => x.unitTypeId === t._id)?.available ?? 0 }));
      return { f, avail, from: types.length ? Math.min(...types.map((t) => unitRate(t, 'MONTH'))) : 0 };
    })
    .filter((r) => r.avail.length > 0), [catalog, q, cat, onlyFacility]);

  if (!catalog) return <main className="mx-auto max-w-7xl px-4 py-16 text-center text-sm text-stone-500">Đang tải danh sách chi nhánh…</main>;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Tìm kho trống</h1>
      <p className="mt-1 text-sm text-stone-500">Số lượng trống tính theo thời gian thực, đã trừ các lượt giữ chỗ chưa phân kho.</p>

      <Card className="mt-6 grid gap-4 p-4 sm:grid-cols-[1fr_220px]">
        <Field label="Tìm theo tên hoặc địa chỉ">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
            <input className={cx(inputCls, 'pl-9')} placeholder="VD: Thủ Đức, Cộng Hòa…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </Field>
        <Field label="Loại kho">
          <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value as UnitCategory | '')}>
            <option value="">Mọi kích thước</option>
            {CATS.map((c) => <option key={c} value={c}>{UNIT_CATEGORY[c]}</option>)}
          </select>
        </Field>
      </Card>

      {onlyFacility && <p className="mt-4 text-sm text-stone-500">Đang lọc 1 chi nhánh · <Link className="font-medium text-brand-700" href="/facilities">Bỏ lọc</Link></p>}

      <div className="mt-6 grid gap-4">
        {rows.length === 0 && <Card><EmptyState title="Không tìm thấy chi nhánh phù hợp" description="Thử bỏ bớt bộ lọc." /></Card>}
        {rows.map(({ f, avail, from }) => (
          <Card key={f._id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{f.name}</h2>
                  <StatusBadge map={FACILITY_STATUS} value={f.status} />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500"><MapPin className="size-3.5" />{f.address.line1}, {f.address.district}, {f.address.city}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500"><Clock className="size-3.5" />Văn phòng 07:00–21:00 · Ra vào kho {f.accessHours?.open}–{f.accessHours?.close}</p>
              </div>
              <div className="text-right">
                {from > 0 && <p className="text-sm text-stone-500">từ <b className="text-lg text-ink">{vnd(from)}</b>/tháng</p>}
                {/* Xem giới thiệu (hình ảnh, cỡ kho) trước, rồi mới sang trang chọn ô & đặt kho. */}
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <ButtonLink href={`/facilities/${f._id}/gioi-thieu`} variant={f.status === 'ACTIVE' ? 'secondary' : 'primary'}>Xem giới thiệu kho</ButtonLink>
                  {f.status === 'ACTIVE' && <ButtonLink href={`/facilities/${f._id}`}>Đặt kho</ButtonLink>}
                </div>
                {f.status !== 'ACTIVE' && <p className="mt-2 text-sm text-amber-700">Sắp khai trương — chưa nhận đặt chỗ</p>}
              </div>
            </div>
            {f.status === 'ACTIVE' && (
              <div className="mt-4 flex flex-wrap gap-2">
                {avail.map(({ t, a }) => (
                  <Badge key={t._id} tone={a === 0 ? 'red' : a <= 2 ? 'amber' : 'green'}>
                    {t.name}: {a === 0 ? 'hết chỗ' : `còn ${a}`}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </main>
  );
}

export default function FacilitiesPage() {
  return <Suspense><FacilityList /></Suspense>;
}
