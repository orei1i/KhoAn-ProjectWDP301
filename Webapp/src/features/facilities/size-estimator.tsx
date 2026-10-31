'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, Minus, Plus, RotateCcw, Ruler } from 'lucide-react';
import { AISLE_FACTOR, ITEM_VOLUME_GROUPS as ITEMS, STACK_HEIGHT_M as STACK_HEIGHT, type UnitCategory, type UnitType } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { UNIT_CATEGORY } from '@/shared/lib/labels';
import { unitRate } from '@/shared/lib/domain';
import { vnd } from '@/shared/lib/format';
import { categoryCutaway, itemIcon } from '@/shared/lib/images';
import { Button, Card, Skeleton, cx } from '@/shared/ui';

/**
 * Ước tính kích thước kho từ danh sách đồ đạc.
 *
 * Cách tính, cố ý đơn giản và nói rõ với người dùng là "ước tính":
 *   thể tích đồ  →  chia cho chiều cao xếp được  →  nhân hệ số lối đi  =  diện tích sàn cần
 * Rồi chọn loại kho nhỏ nhất còn đủ chỗ. Không gọi API, chạy hoàn toàn ở trình duyệt.
 */

// Bảng thể tích tham khảo + chiều cao xếp / hệ số lối đi: một nguồn ở @ssm/shared (đợt 16 — dùng chung với cảnh báo khi khai đồ nhập kho).
// id cũng là tên icon: public/images/do/<id>.svg — thêm món mới thì vẽ thêm icon cùng tên.
const ALL = ITEMS.flatMap((g) => g.items);

export function SizeEstimator() {
  const { catalog } = useStore();
  const [qty, setQty] = useState<Record<string, number>>({});

  const unitTypes = catalog?.unitTypes ?? [];

  const volume = useMemo(
    () => ALL.reduce((sum, it) => sum + (qty[it.id] ?? 0) * it.m3, 0),
    [qty],
  );
  const areaNeeded = volume > 0 ? (volume / STACK_HEIGHT) * AISLE_FACTOR : 0;

  /** Loại kho rẻ nhất theo từng nhóm kích thước, dùng chung cho cả gợi ý lẫn thanh so sánh. */
  const byCategory = useMemo(() => {
    const map = new Map<UnitCategory, { type: UnitType; from: number }>();
    for (const t of unitTypes) {
      const rate = unitRate(t, 'MONTH');
      const cur = map.get(t.category);
      if (!cur || t.areaM2 < cur.type.areaM2 || (t.areaM2 === cur.type.areaM2 && rate < cur.from)) {
        map.set(t.category, { type: t, from: Math.min(rate, cur?.from ?? rate) });
      }
    }
    return map;
  }, [unitTypes]);

  const storageTypes = useMemo(
    () => [...byCategory.values()].sort((a, b) => a.type.areaM2 - b.type.areaM2),
    [byCategory],
  );

  const pick = storageTypes.find((x) => x.type.areaM2 >= areaNeeded) ?? null;
  const biggest = storageTypes[storageTypes.length - 1] ?? null;
  const overflow = areaNeeded > 0 && !pick && biggest ? Math.ceil(areaNeeded / biggest.type.areaM2) : 0;

  const bump = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(99, (q[id] ?? 0) + d)) }));
  const reset = () => setQty({});
  const chosenCount = ALL.reduce((n, it) => n + (qty[it.id] ?? 0), 0);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-stone-200 bg-stone-50 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Ruler className="size-6 text-brand-700" />Không biết cần kho bao lớn?</h2>
        <p className="mt-1 text-sm text-stone-500">Chọn những thứ bạn định gửi, hệ thống gợi ý loại kho vừa đủ.</p>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-6">
          {ITEMS.map((g) => (
            <div key={g.group}>
              <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">{g.group}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {g.items.map((it) => {
                  const n = qty[it.id] ?? 0;
                  return (
                    <div key={it.id} className={cx('flex items-center gap-3 rounded-lg px-3 py-2 ring-1 transition', n > 0 ? 'bg-brand-50 ring-brand-300' : 'ring-stone-200')}>
                      <img src={itemIcon(it.id)} alt="" loading="lazy" decoding="async" className="size-12 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{it.label}</p>
                        <p className="text-xs text-stone-500">{it.hint ?? `${it.m3} m³`}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label={`Bớt ${it.label}`} onClick={() => bump(it.id, -1)} disabled={n === 0}
                          className="grid size-7 place-items-center rounded-md ring-1 ring-stone-300 disabled:opacity-30"><Minus className="size-3.5" /></button>
                        <span className="w-6 text-center text-sm tabular-nums">{n}</span>
                        <button type="button" aria-label={`Thêm ${it.label}`} onClick={() => bump(it.id, 1)}
                          className="grid size-7 place-items-center rounded-md ring-1 ring-stone-300"><Plus className="size-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

        </div>

        {/* ---- kết quả ---- */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl bg-ink p-5 text-white">
            {!catalog ? (
              <div className="grid gap-3">
                <Skeleton className="h-4 w-24 bg-white/10" />
                <Skeleton className="h-7 w-40 bg-white/10" />
                <Skeleton className="h-20 bg-white/10" />
              </div>
            ) : chosenCount === 0 ? (
              <>
                <p className="text-sm text-stone-300">Chưa chọn món nào</p>
                <p className="mt-2 text-sm text-stone-400">Bấm dấu <b className="text-white">+</b> ở danh sách bên cạnh. Kết quả hiện ngay tại đây.</p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wider text-stone-400">Ước tính</p>
                <p className="mt-1 text-sm text-stone-300">
                  Tổng đồ khoảng <b className="text-white">{volume.toFixed(1)} m³</b> → cần sàn <b className="text-white">~{areaNeeded.toFixed(1)} m²</b>
                </p>

                {pick && (
                  <div className="mt-4 rounded-lg bg-white/10 p-4">
                    <img src={categoryCutaway(pick.type.category)} alt={`Minh hoạ ${pick.type.name}`} className="mb-3 aspect-[4/3] w-full rounded-md bg-white object-contain p-2" />
                    <p className="text-xs uppercase tracking-wider text-brand-200">{UNIT_CATEGORY[pick.type.category]}</p>
                    <p className="mt-1 text-lg font-semibold">{pick.type.name}</p>
                    <p className="text-sm text-stone-300">{pick.type.dimensions.widthM}×{pick.type.dimensions.depthM} m · {pick.type.areaM2} m²</p>
                    <p className="mt-2 text-sm">từ <b>{vnd(pick.from)}</b>/tháng</p>
                  </div>
                )}

                {!pick && overflow > 0 && biggest && (
                  <div className="mt-4 rounded-lg bg-amber-400/15 p-4 text-sm ring-1 ring-amber-300/30">
                    <p className="font-medium text-amber-200">Vượt kho lớn nhất</p>
                    <p className="mt-1 text-stone-300">Cần khoảng <b className="text-white">{overflow} kho {biggest.type.name}</b>. Liên hệ chi nhánh để được xếp kho liền nhau.</p>
                  </div>
                )}

                <div className="mt-5 grid gap-2">
                  <Link href={pick ? `/facilities?cat=${pick.type.category}` : '/facilities'}>
                    <Button size="lg" className="w-full">Xem chi nhánh còn trống <ArrowRight className="size-4" /></Button>
                  </Link>
                  <button type="button" onClick={reset} className="inline-flex items-center justify-center gap-1.5 text-sm text-stone-400 hover:text-white">
                    <RotateCcw className="size-3.5" />Chọn lại
                  </button>
                </div>
              </>
            )}
          </div>

          <p className="mt-3 text-xs text-stone-500">
            Đây là ước tính, không phải cam kết. Kết quả đã trừ hao lối đi và giả định xếp cao tối đa {STACK_HEIGHT} m.
            Đồ cồng kềnh khó xếp chồng thì nên chọn lên một cỡ.
          </p>
        </div>
      </div>
    </Card>
  );
}
