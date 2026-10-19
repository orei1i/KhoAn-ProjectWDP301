'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Camera, Clock, FileSignature, KeyRound, MapPin, Phone, Repeat, Snowflake, type LucideIcon } from 'lucide-react';
import type { Facility, PriceQuote, UnitType } from '@ssm/shared';
import {
  FACILITY_PHOTOS, INTRO_FAQ, INTRO_HIGHLIGHTS, INTRO_STEPS, PHOTO_CREDIT, UNIT_CATEGORY_GUIDE, periodLabel,
  type FacilityPhotoKey, type IntroIcon,
} from '@ssm/shared';
import { api } from '@/shared/api/client';
import { FACILITY_STATUS, UNIT_CATEGORY } from '@/shared/lib/labels';
import { vnd } from '@/shared/lib/format';
import { Badge, ButtonLink, Card, EmptyState, StatusBadge, cx } from '@/shared/ui';

type TypeRow = UnitType & { quote: PriceQuote; availability: { total: number; free: number; available: number } };
interface Detail { facility: Facility; unitTypes: TypeRow[] }

const photoSrc = (key: FacilityPhotoKey) => `/images/kho/${key}.jpg`;
const ICONS: Record<IntroIcon, LucideIcon> = { camera: Camera, key: KeyRound, snow: Snowflake, contract: FileSignature, calendar: CalendarDays, swap: Repeat };

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

  if (error) return <main className="mx-auto max-w-7xl p-8"><EmptyState title="Không tải được chi nhánh" description={error} action={<ButtonLink href="/facilities">Quay lại</ButtonLink>} /></main>;
  if (!detail) return <main className="mx-auto max-w-7xl p-16 text-center text-sm text-stone-500">Đang tải…</main>;

  const { facility: f, unitTypes: types } = detail;
  const bookable = f.status === 'ACTIVE';
  const address = `${f.address.line1}, ${f.address.district}, ${f.address.city}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const bookHref = `/facilities/${f._id}`;
  const current = FACILITY_PHOTOS.find((p) => p.key === photo) ?? FACILITY_PHOTOS[0];

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* ---- giới thiệu + ảnh */}
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div>
          <figure>
            <img src={photoSrc(current.key)} alt={current.caption} className="aspect-[4/3] w-full rounded-2xl object-cover ring-1 ring-stone-200" />
            <figcaption className="mt-2 text-sm text-stone-600">{current.caption}</figcaption>
          </figure>
          <div className="mt-3 grid grid-cols-7 gap-2">
            {FACILITY_PHOTOS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPhoto(p.key)} aria-label={p.caption} aria-pressed={p.key === photo}
                className={cx('overflow-hidden rounded-lg ring-2 transition', p.key === photo ? 'ring-brand-600' : 'ring-transparent opacity-70 hover:opacity-100')}>
                <img src={photoSrc(p.key)} alt="" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-400">{PHOTO_CREDIT}</p>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{f.name}</h1>
            <StatusBadge map={FACILITY_STATUS} value={f.status} />
          </div>
          <p className="mt-3 text-base leading-relaxed text-stone-600">
            Kho tự quản tại {f.address.district}: bạn tự khoá, tự ra vào ô kho của mình trong giờ hoạt động. Có {types.length} cỡ kho, từ tủ locker cho đồ cá nhân đến kho tầng trệt cho hàng cồng kềnh — xem hình ảnh và kích thước bên dưới rồi hãy đặt.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-stone-700">
            <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-stone-400" />{address}</li>
            <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-stone-400" />Ra vào kho {f.accessHours?.open ?? '06:00'}–{f.accessHours?.close ?? '22:00'} mỗi ngày</li>
            <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0 text-stone-400" />{f.contact.phone}</li>
          </ul>
          {f.amenities.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{f.amenities.map((a) => <Badge key={a}>{a}</Badge>)}</div>}
          <div className="mt-6 flex flex-wrap gap-3">
            {bookable
              ? <ButtonLink href={bookHref} size="lg">Xem chỗ trống & đặt kho <ArrowRight className="size-4" /></ButtonLink>
              : <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Chi nhánh chưa nhận đặt chỗ</p>}
            <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-stone-700 ring-1 ring-inset ring-stone-300 hover:bg-stone-50"><MapPin className="size-4" />Xem trên bản đồ</a>
          </div>
          <p className="mt-3 text-xs text-stone-500">Muốn xem tận nơi? Bạn có thể ghé chi nhánh trong giờ hoạt động để xem kho trước khi đặt.</p>
        </div>
      </div>

      {/* ---- điểm nổi bật */}
      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight">Vì sao gửi đồ ở đây</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INTRO_HIGHLIGHTS.map((h) => {
            const Icon = ICONS[h.icon];
            return (
              <Card key={h.title} className="p-5">
                <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-5" /></span>
                <h3 className="mt-3 font-semibold">{h.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{h.text}</p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ---- các cỡ kho */}
      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight">Các cỡ kho — cỡ nào vừa với bạn?</h2>
        <p className="mt-1 text-sm text-stone-500">Giá niêm yết theo tháng, chưa gồm phụ phí điều hòa (tuỳ chọn). Thuê theo ngày hoặc tuần xem ở trang đặt kho.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => {
            const g = UNIT_CATEGORY_GUIDE[t.category];
            const a = t.availability.available;
            return (
              <Card key={t._id} className="flex flex-col overflow-hidden">
                <img src={photoSrc(g.photo)} alt={`Minh hoạ ${t.name}`} className="aspect-[16/10] w-full object-cover" />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{t.name}</h3>
                    <Badge>{UNIT_CATEGORY[t.category]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">{t.dimensions.widthM} × {t.dimensions.depthM} × {t.dimensions.heightM} m · {t.areaM2} m²</p>
                  <p className="mt-3 text-sm font-medium text-stone-800">Vừa với: {g.fits}</p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-stone-600">{g.examples.map((x) => <li key={x}>{x}</li>)}</ul>
                  {t.quote.firstPeriodAtBooking && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                      Kho cỡ lớn: giữ chân {periodLabel('MONTH', t.quote.depositPeriods ?? 1)} tiền thuê + trả tiền thuê tháng đầu ngay khi đặt.
                    </p>
                  )}
                  <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                    <div>
                      <p className="text-sm text-stone-500">từ <b className="text-lg text-ink">{vnd(t.rates.MONTH)}</b>/tháng</p>
                      {bookable && <p className={cx('text-xs font-medium', a === 0 ? 'text-red-600' : a <= 2 ? 'text-amber-700' : 'text-emerald-700')}>{a === 0 ? 'Hết chỗ' : `Còn ${a} ô trống`}</p>}
                    </div>
                    {bookable && a > 0 && <ButtonLink href={bookHref} size="sm" variant="secondary">Chọn loại này</ButtonLink>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ---- quy trình */}
      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight">Thuê kho như thế nào</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {INTRO_STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl bg-white p-5 ring-1 ring-stone-200">
              <span className="grid size-8 place-items-center rounded-full bg-ink text-sm font-semibold text-white">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- câu hỏi thường gặp */}
      <section className="mt-14 max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">Câu hỏi thường gặp</h2>
        <div className="mt-5 divide-y divide-stone-200 rounded-xl bg-white ring-1 ring-stone-200">
          {INTRO_FAQ.map((x) => (
            <details key={x.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">{x.q}</summary>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{x.a}</p>
            </details>
          ))}
        </div>
      </section>

      {bookable && (
        <section className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-ink px-6 py-8 text-white">
          <div>
            <h2 className="text-xl font-semibold">Đã xem xong? Chọn ô kho của bạn</h2>
            <p className="mt-1 text-sm text-stone-300">Chọn đúng ô trên sơ đồ, xem trước mọi khoản phải trả rồi mới thanh toán.</p>
          </div>
          <ButtonLink href={bookHref} size="lg">Xem chỗ trống & đặt kho <ArrowRight className="size-4" /></ButtonLink>
        </section>
      )}
    </main>
  );
}
