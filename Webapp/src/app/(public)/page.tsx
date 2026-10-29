'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowRight, Check, Clock3, CreditCard, FileSignature, KeyRound, LockKeyhole, MapPin, ScanLine, Search, ShieldCheck, Store, Warehouse, type LucideIcon } from 'lucide-react';
import type { UnitCategory } from '@ssm/shared';
import { UNIT_CATEGORY_GUIDE } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { UNIT_CATEGORY } from '@/shared/lib/labels';
import { isActiveFacility, unitRate } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { HERO_PHOTO, categoryPhoto, facilityPhoto } from '@/shared/lib/images';
import { Button, ButtonLink, Card, SectionHeading, Skeleton, cx, inputCls } from '@/shared/ui';
import { SizeEstimator } from '@/features/facilities/size-estimator';
import { AvailabilityBar, CATEGORY_ICON, amenityIcon } from '@/features/facilities/visuals';

const CATS: UnitCategory[] = ['LOCKER', 'SMALL', 'MEDIUM', 'LARGE', 'XL'];

const STEPS: { icon: LucideIcon; t: string; d: string }[] = [
  { icon: Warehouse, t: 'Chọn ô & xem hợp đồng', d: 'Chọn chi nhánh, ô trên sơ đồ và thời hạn; xem hợp đồng trước khi giữ chỗ.' },
  { icon: KeyRound, t: 'Giữ chỗ & ký hợp đồng', d: 'Trả tiền giữ chân trong 30 phút, ký online bằng OTP hoặc ký giấy tại quầy.' },
  { icon: ScanLine, t: 'Quét QR nhận kho', d: 'Mang CCCD / hộ chiếu — nhân viên quét mã, bàn giao chìa / mã PIN / thẻ từ.' },
  { icon: CreditCard, t: 'Thanh toán & gia hạn', d: 'Trả theo kỳ, gia hạn hoặc đăng ký trả kho ngay trong tài khoản.' },
];

export default function Home() {
  const { catalog } = useStore();
  const router = useRouter();
  const loading = catalog === null; // catalog về từ /facilities/public, không cần đăng nhập
  const facilities = useMemo(() => (catalog?.facilities ?? []).filter(isActiveFacility), [catalog]);
  const unitTypes = useMemo(() => catalog?.unitTypes ?? [], [catalog]);
  const [fid, setFid] = useState('');
  const [cat, setCat] = useState<UnitCategory | ''>('');

  const sizes = useMemo(() => CATS.map((c) => {
    const types = unitTypes.filter((t) => t.category === c && facilities.some((f) => f._id === t.facilityId));
    const t = types[0];
    return { c, t, from: Math.min(...types.map((x) => unitRate(x, 'MONTH'))) };
  }), [unitTypes, facilities]);

  // Chỉ số thật lấy từ catalog — không bịa số liệu.
  const freeUnits = facilities.reduce((n, f) => n + f.availability.reduce((m, a) => m + a.available, 0), 0);
  const catCount = sizes.filter((s) => s.t).length;
  const hours = facilities.find((f) => f.accessHours)?.accessHours ?? { open: '06:00', close: '22:00' };
  const amenities = [...new Set(facilities.flatMap((f) => f.amenities))].slice(0, 4);
  const strengths: { icon: LucideIcon; t: string }[] = [
    { icon: LockKeyhole, t: 'Khoá riêng từng ô' },
    { icon: Clock3, t: `Ra vào ${hours.open}–${hours.close}` },
    ...amenities.map((a) => ({ icon: amenityIcon(a), t: a })),
    { icon: FileSignature, t: 'Ký online bằng OTP' },
    { icon: Store, t: 'Giữ chỗ, trả tại quầy' },
  ];

  const search = () => {
    const q = new URLSearchParams();
    if (fid) q.set('facility', fid);
    if (cat) q.set('cat', cat);
    router.push(`/facilities?${q}`);
  };

  return (
    <main>
      {/* ---- hero: ảnh lớn + tiêu đề ngắn */}
      <section className="relative isolate overflow-hidden bg-ink text-white">
        <img src={HERO_PHOTO} alt="" fetchPriority="high" className="absolute inset-0 -z-20 size-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-ink via-ink/85 to-ink/25" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-t from-ink/70 to-transparent" />
        <div className="mx-auto max-w-7xl px-4 pb-32 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-40 lg:pt-28">
          <div className="max-w-2xl motion-safe:animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-inset ring-white/15 backdrop-blur">
              <ShieldCheck className="size-3.5" />Bảo vệ trực đêm · Hợp đồng điện tử
            </p>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              Kho tự quản gần bạn.<br /><span className="text-brand-200">Đặt online, nhận kho trong ngày.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base text-stone-200 sm:text-lg">Từ tủ locker đến phòng kho cả gia đình. Xem chỗ trống thật, giữ chỗ trong vài phút.</p>
            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-4">
              {loading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-24 bg-white/10" />) : facilities.length > 0 && (
                [[facilities.length, 'chi nhánh'], [freeUnits, 'ô còn trống'], [catCount, 'cỡ kho']].map(([n, l]) => (
                  <div key={l}>
                    <dt className="sr-only">{l}</dt>
                    <dd><span className="block text-3xl font-bold tabular-nums text-white">{n}</span><span className="text-sm text-stone-300">{l}</span></dd>
                  </div>
                ))
              )}
            </dl>
          </div>
        </div>
      </section>

      {/* ---- ô tìm kho nổi lên trên mép ảnh */}
      <section className="relative z-10 mx-auto -mt-20 max-w-5xl px-4 sm:px-6 lg:px-8">
        <Card className="p-4 shadow-lift sm:p-5">
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone-600"><MapPin className="size-3.5 text-brand-700" />Chi nhánh</span>
              <select className={cx(inputCls, 'h-11')} value={fid} onChange={(e) => setFid(e.target.value)}>
                <option value="">Tất cả chi nhánh</option>
                {facilities.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone-600"><Warehouse className="size-3.5 text-brand-700" />Loại kho</span>
              <select className={cx(inputCls, 'h-11')} value={cat} onChange={(e) => setCat(e.target.value as UnitCategory | '')}>
                <option value="">Mọi kích thước</option>
                {CATS.map((c) => <option key={c} value={c}>{UNIT_CATEGORY[c]}</option>)}
              </select>
            </label>
            <Button size="lg" type="submit" className="h-11"><Search className="size-4" />Tìm kho trống</Button>
          </form>
        </Card>
      </section>

      {/* ---- dải điểm mạnh: icon + vài chữ */}
      <section className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {strengths.map((s) => (
            <li key={s.t} className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-stone-200">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><s.icon className="size-4" /></span>
              <span className="text-sm font-medium leading-tight text-stone-800">{s.t}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- các cỡ kho */}
      <section id="sizes" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Kích thước & giá" title="Chọn cỡ kho vừa đồ của bạn" description="Giá tham khảo theo tháng, thuê từ 3 tháng được giảm giá."
          action={<Link href="#uoc-tinh" className="text-sm font-medium text-brand-700 hover:underline">Chưa chắc cỡ nào? Ước tính ngay</Link>} />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {loading && Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="overflow-hidden"><Skeleton className="aspect-[16/10] rounded-none" /><div className="grid gap-2 p-5"><Skeleton className="h-4 w-40" /><Skeleton className="h-7 w-32" /><Skeleton className="h-3 w-full" /></div></Card>
          ))}
          {sizes.map(({ c, t, from }) => {
            if (!t) return null;
            const Icon = CATEGORY_ICON[c];
            const g = UNIT_CATEGORY_GUIDE[c];
            return (
              <Link key={c} href={`/facilities?cat=${c}`} className="group">
                <Card className="flex h-full flex-col overflow-hidden transition duration-200 group-hover:-translate-y-1 group-hover:shadow-lift">
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <img src={categoryPhoto(c)} alt={`Minh hoạ ${t.name}`} loading="lazy" decoding="async" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-linear-to-t from-ink/70 via-ink/0 to-transparent" />
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm"><Icon className="size-3.5 text-brand-700" />{UNIT_CATEGORY[c]}</span>
                    <span className="absolute bottom-3 left-3 rounded-md bg-ink/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">{t.dimensions.widthM}×{t.dimensions.depthM} m · {t.areaM2} m²</span>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-lg font-semibold">{t.name}</h3>
                    <p className="mt-1"><span className="text-xs text-stone-500">từ </span><b className="text-2xl font-bold tabular-nums text-brand-700">{vnd(from)}</b><span className="text-sm text-stone-500">/tháng</span></p>
                    <ul className="mt-3 grid gap-1.5 text-sm text-stone-600">
                      {g.examples.slice(0, 3).map((x) => <li key={x} className="flex items-center gap-2"><Check className="size-4 shrink-0 text-emerald-600" />{x}</li>)}
                    </ul>
                    <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-brand-700">Xem ô trống <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section id="uoc-tinh" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-20 sm:px-6 lg:px-8">
        <SizeEstimator />
      </section>

      {/* ---- 4 bước: dòng thời gian có icon */}
      <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Cách thuê" title="Thuê kho trong 4 bước" />
        <ol className="relative mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
          <span className="absolute left-6 top-[23px] hidden h-0.5 w-[calc(75%+1.125rem)] bg-linear-to-r from-brand-200 via-brand-300 to-brand-200 md:block" aria-hidden />
          <span className="absolute bottom-6 left-[23px] top-6 w-0.5 bg-brand-200 md:hidden" aria-hidden />
          {STEPS.map((s, i) => (
            <li key={s.t} className="relative flex gap-4 md:block">
              <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-ink text-white shadow-lift ring-4 ring-stone-50">
                <s.icon className="size-5" />
                <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-brand-500 text-[11px] font-bold">{i + 1}</span>
              </span>
              <div className="md:mt-5">
                <h3 className="font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-500">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- chi nhánh: ảnh + thanh còn trống */}
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Chi nhánh" title="Kho gần bạn" action={<ButtonLink href="/facilities" variant="secondary" size="sm">Xem tất cả <ArrowRight className="size-3.5" /></ButtonLink>} />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {loading && Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="overflow-hidden"><Skeleton className="aspect-[16/9] rounded-none" /><div className="grid gap-2 p-5"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-56" /><Skeleton className="mt-2 h-2 w-full" /></div></Card>
          ))}
          {facilities.map((f) => {
            const total = f.availability.reduce((m, a) => m + a.total, 0);
            const free = f.availability.reduce((m, a) => m + a.available, 0);
            return (
              <Link key={f._id} href={`/facilities/${f._id}/gioi-thieu`} className="group">
                <Card className="flex h-full flex-col overflow-hidden transition duration-200 group-hover:-translate-y-1 group-hover:shadow-lift">
                  <div className="relative aspect-[16/9] overflow-hidden">
                    <img src={facilityPhoto(f)} alt={`Minh hoạ ${f.name}`} loading="lazy" decoding="async" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm"><MapPin className="size-3.5 text-brand-700" />{f.address.district}</span>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="font-semibold group-hover:text-brand-700">{f.name}</h3>
                    <p className="mt-1 text-sm text-stone-500">{f.address.line1}, {f.address.district}</p>
                    <AvailabilityBar available={free} total={total} className="mt-4" />
                    <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-sm">
                      {f.fromPrice ? <span className="text-stone-500">từ <b className="text-ink">{vnd(f.fromPrice)}</b>/tháng</span> : <span />}
                      <span className="inline-flex items-center gap-1 font-semibold text-brand-700">Xem kho <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></span>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ---- lời mời cuối trang */}
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-8">
        <div className="relative isolate overflow-hidden rounded-3xl bg-brand-800 px-6 py-10 text-white sm:px-10">
          <div className="absolute -right-16 -top-16 -z-10 size-64 rounded-full bg-brand-600/50 blur-2xl" aria-hidden />
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sẵn sàng cất đồ?</h2>
              <p className="mt-2 text-brand-100">Chọn ô trên sơ đồ, xem trước mọi khoản phải trả.</p>
            </div>
            <ButtonLink href="/facilities" size="lg" variant="secondary">Tìm kho trống <ArrowRight className="size-4" /></ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}
