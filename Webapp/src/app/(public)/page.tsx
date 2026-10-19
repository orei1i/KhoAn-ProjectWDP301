'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowRight, Camera, CreditCard, KeyRound, MapPin, ScanLine, ShieldCheck, Thermometer, Truck, Warehouse } from 'lucide-react';
import type { UnitCategory } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { UNIT_CATEGORY } from '@/shared/lib/labels';
import { isActiveFacility, unitRate } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { Button, Card, Field, Skeleton, inputCls } from '@/shared/ui';
import { SizeEstimator } from '@/features/facilities/size-estimator';

const CATS: UnitCategory[] = ['LOCKER', 'SMALL', 'MEDIUM', 'LARGE', 'XL'];

export default function Home() {
  const { catalog } = useStore();
  const router = useRouter();
  const loading = catalog === null; // catalog về từ /facilities/public, không cần đăng nhập
  const facilities = (catalog?.facilities ?? []).filter(isActiveFacility);
  const unitTypes = catalog?.unitTypes ?? [];
  const [fid, setFid] = useState('');
  const [cat, setCat] = useState<UnitCategory | ''>('');

  const sizes = useMemo(() => CATS.map((c) => {
    const types = unitTypes.filter((t) => t.category === c && facilities.some((f) => f._id === t.facilityId));
    const t = types[0];
    return { c, t, from: Math.min(...types.map((x) => unitRate(x, 'MONTH'))) };
  }), [unitTypes, facilities]);

  const totalUnits = facilities.reduce((n, f) => n + f.availability.reduce((m, a) => m + a.total, 0), 0);

  return (
    <main>
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:px-8 lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-brand-100"><ShieldCheck className="size-3.5" /> Camera 24/7 · Bảo vệ trực đêm · Hợp đồng điện tử</p>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Kho tự quản gần bạn.<br /><span className="text-brand-200">Đặt online, nhận kho trong ngày.</span></h1>
            <p className="mt-5 max-w-xl text-base text-stone-300">Từ tủ locker cho sinh viên đến kho drive-up cho doanh nghiệp. Xem chỗ trống theo thời gian thực, thanh toán giữ chỗ qua VNPay/MoMo và quét mã QR để nhận kho.</p>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-stone-300">
              {loading ? (
                <>
                  <Skeleton className="h-9 w-28 bg-white/10" />
                  <Skeleton className="h-9 w-24 bg-white/10" />
                  <Skeleton className="h-9 w-28 bg-white/10" />
                </>
              ) : (
                <>
                  <span><b className="text-2xl text-white">{facilities.length}</b> chi nhánh</span>
                  <span><b className="text-2xl text-white">{totalUnits}</b> kho</span>
                  <span><b className="text-2xl text-white">6</b> kích thước</span>
                </>
              )}
            </div>
          </div>
          <Card className="self-center p-5 text-ink shadow-2xl sm:p-6">
            <h2 className="text-lg font-semibold">Tìm kho trống</h2>
            <p className="mt-1 text-sm text-stone-500">Chọn khu vực và loại kho, xem giá ngay.</p>
            <form className="mt-5 grid gap-4" onSubmit={(e) => { e.preventDefault(); const q = new URLSearchParams(); if (fid) q.set('facility', fid); if (cat) q.set('cat', cat); router.push(`/facilities?${q}`); }}>
              <Field label="Chi nhánh">
                <select className={inputCls} value={fid} onChange={(e) => setFid(e.target.value)}>
                  <option value="">Tất cả chi nhánh</option>
                  {facilities.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
                </select>
              </Field>
              <Field label="Loại kho">
                <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value as UnitCategory | '')}>
                  <option value="">Mọi kích thước</option>
                  {CATS.map((c) => <option key={c} value={c}>{UNIT_CATEGORY[c]}</option>)}
                </select>
              </Field>
              <Button size="lg" type="submit">Xem kho trống <ArrowRight className="size-4" /></Button>
            </form>
          </Card>
        </div>
      </section>

      <section id="sizes" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-16 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-semibold tracking-tight">Chọn kích thước phù hợp</h2>
        <p className="mt-1 text-sm text-stone-500">Giá tham khảo theo tháng, chưa gồm ưu đãi khi thuê dài hạn (từ 3 tháng) — chọn thời gian thuê ở trang chi nhánh để xem mức tiết kiệm.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading && Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="flex gap-4 p-5"><Skeleton className="size-16 shrink-0" /><div className="flex-1 grid gap-2"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-full" /><Skeleton className="h-4 w-28" /></div></Card>
          ))}
          {sizes.map(({ c, t, from }) => t && (
            <Card key={c} className="flex gap-4 p-5">
              <div className="grid size-16 shrink-0 place-items-end rounded-lg bg-brand-50 p-2">
                <div className="rounded-sm border-2 border-brand-600 bg-brand-100" style={{ width: `${Math.min(100, 18 + t.areaM2 * 3)}%`, height: `${Math.min(100, 25 + t.dimensions.heightM * 22)}%` }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-700">{UNIT_CATEGORY[c]}</p>
                <h3 className="font-semibold">{t.name} · {t.dimensions.widthM}×{t.dimensions.depthM} m</h3>
                <p className="mt-1 text-sm text-stone-500">{t.description}</p>
                <p className="mt-2 text-sm">từ <b className="text-ink">{vnd(from)}</b>/tháng</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section id="uoc-tinh" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-16 sm:px-6 lg:px-8">
        <SizeEstimator />
      </section>

      <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-16 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-semibold tracking-tight">Thuê kho trong 4 bước</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Warehouse, t: 'Chọn kho & giữ chỗ', d: 'Chọn chi nhánh, loại kho, ngày bắt đầu. Giữ chỗ 30 phút để thanh toán tiền giữ chân.' },
            { icon: KeyRound, t: 'Chi nhánh phân kho', d: 'Quản lý chi nhánh gán một kho cụ thể cho bạn trước ngày nhận.' },
            { icon: ScanLine, t: 'Quét QR nhận kho', d: 'Nhân viên quét mã, bàn giao chìa khóa / mã PIN / thẻ từ.' },
            { icon: CreditCard, t: 'Thanh toán & gia hạn', d: 'Thanh toán hằng tháng, gia hạn hoặc đăng ký trả kho ngay trên ứng dụng.' },
          ].map((s, i) => (
            <li key={s.t}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-ink text-white"><s.icon className="size-4" /></span>
                  <span className="text-xs font-semibold text-stone-400">BƯỚC {i + 1}</span>
                </div>
                <h3 className="mt-3 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-stone-500">{s.d}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">Chi nhánh</h2>
          <Link href="/facilities" className="text-sm font-medium text-brand-700 hover:underline">Xem tất cả</Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {loading && Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-full p-5"><Skeleton className="h-5 w-40" /><Skeleton className="mt-2 h-3 w-56" /><Skeleton className="mt-4 h-3 w-48" /></Card>
          ))}
          {facilities.map((f) => (
            <Link key={f._id} href={`/facilities/${f._id}/gioi-thieu`} className="group">
              <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
                <h3 className="font-semibold group-hover:text-brand-700">{f.name}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500"><MapPin className="size-3.5" />{f.address.line1}, {f.address.district}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-stone-600">
                  <span className="inline-flex items-center gap-1"><Camera className="size-3.5" />Camera 24/7</span>
                  <span className="inline-flex items-center gap-1"><Thermometer className="size-3.5" />Kho điều hòa</span>
                  <span className="inline-flex items-center gap-1"><Truck className="size-3.5" />Drive-up</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
