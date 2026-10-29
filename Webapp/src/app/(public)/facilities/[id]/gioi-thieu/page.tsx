'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronDown, ChevronRight, Clock, FileSignature, KeyRound, MapPin, Phone, Repeat, Snowflake, Warehouse, type LucideIcon } from 'lucide-react';
import type { Facility, PriceQuote, UnitType } from '@ssm/shared';
import {
  FACILITY_PHOTOS, INTRO_FAQ, INTRO_HIGHLIGHTS, INTRO_STEPS, PHOTO_CREDIT, UNIT_CATEGORY_GUIDE, periodLabel,
  type FacilityPhotoKey, type IntroIcon,
} from '@ssm/shared';
import { api } from '@/shared/api/client';
import { FACILITY_STATUS, UNIT_CATEGORY } from '@/shared/lib/labels';
import { vnd } from '@/shared/lib/format';
import { categoryCutaway, photoSrc } from '@/shared/lib/images';
import { ButtonLink, Card, EmptyState, IconTile, SectionHeading, Skeleton, StatusBadge, cx } from '@/shared/ui';
import { AvailabilityBar, CATEGORY_ICON, amenityIcon } from '@/features/facilities/visuals';

type TypeRow = UnitType & { quote: PriceQuote; availability: { total: number; free: number; available: number } };
interface Detail { facility: Facility; unitTypes: TypeRow[] }

// Không còn icon camera — điểm nổi bật nào không có icon ở đây thì không hiện.
const ICONS: Partial<Record<IntroIcon, LucideIcon>> = { key: KeyRound, snow: Snowflake, contract: FileSignature, calendar: CalendarDays, swap: Repeat };
const HIGHLIGHTS = INTRO_HIGHLIGHTS.filter((h) => ICONS[h.icon]);

/**
 * Trang GIỚI THIỆU KHO: hình ảnh, tiện ích, từng cỡ kho vừa với gì, quy trình và câu hỏi thường gặp — để khách xem xét
 * trước rồi mới sang trang chọn ô & đặt kho. Nội dung tĩnh lấy từ @ssm/shared (dùng chung với app), số liệu lấy từ API công khai.
 */
export default function FacilityIntro() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<FacilityPhotoKey>(FACILITY_PHOTOS[0].key);

  useEffect(() => {
    let alive = true;
    api.get<Detail>(`/facilities/public/${id}?period=MONTH&periods=1&ac=false`)
      .then((d) => { if (alive) { setDetail(d); setError(''); } })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  if (error) return <main className="mx-auto max-w-7xl p-8"><EmptyState icon={<Warehouse className="size-6" />} title="Không tải được chi nhánh" description={error} action={<ButtonLink href="/facilities">Quay lại</ButtonLink>} /></main>;
  if (!detail) {
    return (
      <main aria-busy className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:px-8">
        <Skeleton className="aspect-[4/3] rounded-2xl" />
        <div className="grid content-start gap-3"><Skeleton className="h-9 w-64" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="mt-4 h-11 w-56" /></div>
      </main>
    );
  }

  const { facility: f, unitTypes: types } = detail;
  const bookable = f.status === 'ACTIVE';
  const address = `${f.address.line1}, ${f.address.district}, ${f.address.city}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const bookHref = `/facilities/${f._id}`;
  const current = FACILITY_PHOTOS.find((p) => p.key === photo) ?? FACILITY_PHOTOS[0];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <nav aria-label="Vị trí trang" className="flex items-center gap-1 text-xs text-stone-500">
        <Link href="/facilities" className="hover:text-ink">Tìm kho</Link><ChevronRight className="size-3.5" /><span className="truncate text-ink">{f.name}</span>
      </nav>

      {/* ---- giới thiệu + ảnh */}
      <div className="mt-4 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div>
          <figure className="relative overflow-hidden rounded-2xl ring-1 ring-stone-200">
            <img src={photoSrc(current.key)} alt={current.caption} className="aspect-[4/3] w-full object-cover" />
            <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-ink/80 to-transparent px-4 pb-3 pt-10 text-sm font-medium text-white">{current.caption}</figcaption>
          </figure>
          <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${FACILITY_PHOTOS.length}, minmax(0, 1fr))` }}>
            {FACILITY_PHOTOS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPhoto(p.key)} aria-label={p.caption} aria-pressed={p.key === photo}
                className={cx('overflow-hidden rounded-lg ring-2 transition', p.key === photo ? 'ring-brand-600' : 'ring-transparent opacity-70 hover:opacity-100')}>
                <img src={photoSrc(p.key)} alt="" loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-400">{PHOTO_CREDIT}</p>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{f.name}</h1>
            <StatusBadge map={FACILITY_STATUS} value={f.status} />
          </div>
          <p className="mt-3 text-base leading-relaxed text-stone-600">
            Kho tự quản tại {f.address.district}: bạn tự khoá, tự ra vào ô kho của mình trong giờ hoạt động. Có {types.length} cỡ kho, từ tủ locker cho đồ cá nhân đến kho tầng trệt cho hàng cồng kềnh — xem hình ảnh và kích thước bên dưới rồi hãy đặt.
          </p>
          <ul className="mt-5 grid gap-2.5 text-sm text-stone-700">
            <li className="flex items-center gap-3"><IconTile icon={<MapPin className="size-4" />} size="sm" />{address}</li>
            <li className="flex items-center gap-3"><IconTile icon={<Clock className="size-4" />} size="sm" />Ra vào kho {f.accessHours?.open ?? '06:00'}–{f.accessHours?.close ?? '22:00'} mỗi ngày</li>
            <li className="flex items-center gap-3"><IconTile icon={<Phone className="size-4" />} size="sm" />{f.contact.phone}</li>
          </ul>
          {f.amenities.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {f.amenities.map((a) => { const Icon = amenityIcon(a); return <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-700 ring-1 ring-inset ring-stone-200"><Icon className="size-3.5 text-brand-700" />{a}</li>; })}
            </ul>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {bookable
              ? <ButtonLink href={bookHref} size="lg">Xem chỗ trống & đặt kho <ArrowRight className="size-4" /></ButtonLink>
              : <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Chi nhánh chưa nhận đặt chỗ</p>}
            <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-stone-700 ring-1 ring-inset ring-stone-300 transition hover:bg-stone-50"><MapPin className="size-4" />Xem trên bản đồ</a>
          </div>
        </div>
      </div>

      {/* ---- điểm nổi bật */}
      <section className="mt-16">
        <SectionHeading eyebrow="Điểm nổi bật" title="Vì sao gửi đồ ở đây" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map((h) => {
            const Icon = ICONS[h.icon]!;
            return (
              <Card key={h.title} className="p-5 transition hover:shadow-lift">
                <IconTile icon={<Icon className="size-5" />} />
                <h3 className="mt-3 font-semibold">{h.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{h.text}</p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ---- các cỡ kho */}
      <section className="mt-16">
        <SectionHeading eyebrow="Các cỡ kho" title="Cỡ nào vừa với bạn?" description="Giá theo tháng, chưa gồm phụ phí điều hòa (tuỳ chọn)." />
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => {
            const g = UNIT_CATEGORY_GUIDE[t.category];
            const a = t.availability.available;
            const Icon = CATEGORY_ICON[t.category];
            return (
              <Card key={t._id} className="flex flex-col overflow-hidden">
                <div className="relative">
                  <img src={categoryCutaway(t.category)} alt={`Minh hoạ ${t.name}`} loading="lazy" decoding="async" className="aspect-[16/10] w-full bg-linear-to-b from-brand-50 to-stone-50 object-contain px-4 pb-7 pt-3" />
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm"><Icon className="size-3.5 text-brand-700" />{UNIT_CATEGORY[t.category]}</span>
                  <span className="absolute bottom-3 left-3 rounded-md bg-ink/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">{t.dimensions.widthM} × {t.dimensions.depthM} × {t.dimensions.heightM} m · {t.areaM2} m²</span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold">{t.name}</h3>
                    <p className="shrink-0 text-right text-xs text-stone-500">từ <b className="block text-lg font-bold tabular-nums text-brand-700">{vnd(t.rates.MONTH)}</b>/tháng</p>
                  </div>
                  <p className="mt-2 text-sm font-medium text-stone-800">Vừa với: {g.fits}</p>
                  <ul className="mt-2 grid gap-1 text-sm text-stone-600">{g.examples.map((x) => <li key={x} className="flex items-center gap-2"><Check className="size-4 shrink-0 text-emerald-600" />{x}</li>)}</ul>
                  {t.quote.firstPeriodAtBooking && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                      Kho cỡ lớn: giữ chân {periodLabel('MONTH', t.quote.depositPeriods ?? 1)} tiền thuê + trả tiền thuê tháng đầu ngay khi đặt.
                    </p>
                  )}
                  <div className="mt-auto pt-4">
                    {bookable && <AvailabilityBar available={a} total={t.availability.total} />}
                    {bookable && a > 0 && <ButtonLink href={bookHref} size="sm" variant="secondary" className="mt-3 w-full">Chọn loại này <ArrowRight className="size-3.5" /></ButtonLink>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ---- quy trình */}
      <section className="mt-16">
        <SectionHeading eyebrow="Quy trình" title="Thuê kho như thế nào" />
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {INTRO_STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl bg-white p-5 ring-1 ring-stone-200">
              <span className="grid size-9 place-items-center rounded-full bg-ink text-sm font-bold text-white ring-4 ring-brand-50">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- câu hỏi thường gặp */}
      <section className="mt-16 max-w-3xl">
        <SectionHeading eyebrow="Hỏi đáp" title="Câu hỏi thường gặp" />
        <div className="mt-6 divide-y divide-stone-200 rounded-2xl bg-white ring-1 ring-stone-200">
          {INTRO_FAQ.map((x) => (
            <details key={x.q} className="px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                {x.q}
                <ChevronDown className="size-4 shrink-0 text-stone-400 transition-transform [details[open]>summary>&]:rotate-180" aria-hidden />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{x.a}</p>
            </details>
          ))}
        </div>
      </section>

      {bookable && (
        <section className="relative isolate mt-16 overflow-hidden rounded-3xl bg-ink px-6 py-10 text-white sm:px-10">
          <div className="absolute -right-20 -top-20 -z-10 size-72 rounded-full bg-brand-600/40 blur-3xl" aria-hidden />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Đã xem xong? Chọn ô kho của bạn</h2>
              <p className="mt-1 text-sm text-stone-300">Chọn đúng ô trên sơ đồ, xem trước mọi khoản phải trả rồi mới thanh toán.</p>
            </div>
            <ButtonLink href={bookHref} size="lg">Xem chỗ trống & đặt kho <ArrowRight className="size-4" /></ButtonLink>
          </div>
        </section>
      )}
    </main>
  );
}
