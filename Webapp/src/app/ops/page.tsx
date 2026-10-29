'use client';

import type { ReactNode } from 'react';
import {
  ArrowRight, Banknote, Boxes, Building2, CircleCheck, FileText, Gauge, HandCoins, Landmark, ListChecks, PackagePlus, PiggyBank, ScrollText, ShieldCheck, Tags, TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { DEPOSITS_LABEL, REVENUE_LABEL } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { FACILITY_STATUS, type Tone } from '@/shared/lib/labels';
import { claimOpsOnly, facilityStats, revenueByMonth } from '@/shared/lib/domain';
import { addDays, compactVnd, fmtMonth, pct, todayISO, vnd } from '@/shared/lib/format';
import { facilityPhoto } from '@/shared/lib/images';
import { Card, EmptyState, IconTile, InfoTip, PageHeader, Progress, StatCard, StatusBadge } from '@/shared/ui';
import { StackedBarChart } from '@/shared/ui/charts';
import { Chip, ChipRow, Meta, PanelHeader, QueueRow, QuickTile } from '@/features/staff-ui';

export default function OpsHome() {
  const { db } = useStore();
  // Doanh thu, công nợ, khách tính MỌI chi nhánh (kể cả đã ngừng hoạt động — vẫn còn tiền thu / nợ); lấp đầy chỉ tính chi nhánh đang hoạt động.
  const all = db.facilities.filter((f) => !f.isDeleted);
  const active = all.filter((f) => f.status === 'ACTIVE');
  const ids = all.map((f) => f._id);
  const rows = all.map((f) => {
    const s = facilityStats(db, f._id);
    const area = db.units.filter((u) => u.facilityId === f._id).reduce((x, u) => x + (db.unitTypes.find((t) => t._id === u.unitTypeId)?.areaM2 ?? 0), 0);
    return { f, s, area, perM2: area ? s.mrr / area : 0 };
  });
  const rev = revenueByMonth(db, ids, 6);
  const occ = rows.filter((r) => r.f.status === 'ACTIVE').reduce((a, r) => ({ occ: a.occ + r.s.occupied, rentable: a.rentable + r.s.total - r.s.maintenance }), { occ: 0, rentable: 0 });
  const dep = rev.at(-1)?.deposits ?? { collected: 0, refunded: 0, retained: 0 };
  const tot = rows.reduce((a, r) => ({ units: a.units + r.s.total, mrr: a.mrr + r.s.mrr, overdue: a.overdue + r.s.overdue, overdueCount: a.overdueCount + r.s.overdueCount, outstanding: a.outstanding + r.s.outstanding }), { units: 0, mrr: 0, overdue: 0, overdueCount: 0, outstanding: 0 });

  // ---- Chỉ để trình bày (không đổi dữ liệu / luồng): số việc đang chờ ở Duyệt & chi — cùng điều kiện lọc với trang đó.
  const reviewClaims = db.claims.filter((x) => x.status === 'UNDER_REVIEW');
  const opsClaims = reviewClaims.filter((x) => claimOpsOnly(db, x)).length;
  const pendingPayouts = db.payments.filter((p) => p.direction === 'REFUND' && p.method === 'BANK_TRANSFER' && p.status === 'PENDING');
  const latePayouts = pendingPayouts.filter((p) => p.createdAt < addDays(todayISO(), -7)).length;
  const notActive = all.filter((f) => f.status !== 'ACTIVE');
  const todo = reviewClaims.length + pendingPayouts.length + notActive.length;

  const quick: { href: string; icon: ReactNode; label: string; count?: number; tone: Tone }[] = [
    { href: '/ops/approvals', icon: <HandCoins className="size-5" />, label: 'Duyệt & chi', count: reviewClaims.length + pendingPayouts.length, tone: 'violet' },
    { href: '/ops/facilities', icon: <Building2 className="size-5" />, label: 'Chi nhánh', tone: 'teal' },
    { href: '/ops/inventory', icon: <Boxes className="size-5" />, label: 'Loại kho & ô kho', tone: 'blue' },
    { href: '/ops/services', icon: <PackagePlus className="size-5" />, label: 'Dịch vụ thêm', tone: 'green' },
    { href: '/ops/policies', icon: <ScrollText className="size-5" />, label: 'Chính sách', tone: 'amber' },
    { href: '/ops/contract-templates', icon: <FileText className="size-5" />, label: 'Mẫu hợp đồng', tone: 'gray' },
    { href: '/ops/pricing', icon: <Tags className="size-5" />, label: 'Bảng giá', tone: 'teal' },
    { href: '/ops/audit', icon: <ShieldCheck className="size-5" />, label: 'Nhật ký', tone: 'gray' },
  ];

  return (
    <>
      <PageHeader
        title={<span className="inline-flex items-center gap-1.5">Tổng quan chuỗi<InfoTip align="start">Doanh thu và công nợ gồm cả chi nhánh đã ngừng hoạt động; lấp đầy chỉ tính chi nhánh đang hoạt động.</InfoTip></span>} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Chi nhánh hoạt động" value={`${active.length}/${all.length}`} sub={`${tot.units} kho`} icon={<Building2 className="size-5" />} href="/ops/facilities" />
        <StatCard label="Lấp đầy (chi nhánh hoạt động)" value={pct(occ.rentable ? occ.occ / occ.rentable : 0)} sub={`${occ.occ}/${occ.rentable} kho khả dụng`} icon={<Gauge className="size-5" />} tone="blue" href="/ops/inventory" />
        <StatCard label="Doanh thu định kỳ / tháng" value={compactVnd(tot.mrr)} sub="Giá thuê quy đổi theo tháng" icon={<Banknote className="size-5" />} tone="green" />
        {/* Chỉ nợ đã quá ân hạn — cùng định nghĩa bảng tuổi nợ ở trang Báo cáo; tổng công nợ (gồm hoá đơn chưa đến hạn) ghi riêng. */}
        <StatCard label="Công nợ quá hạn" value={compactVnd(tot.overdue)} sub={`${tot.overdueCount} hợp đồng · tổng công nợ ${compactVnd(tot.outstanding)}`} icon={<TriangleAlert className="size-5" />} tone={tot.overdue > 0 ? 'amber' : 'green'} />
      </div>

      <nav aria-label="Lối tắt" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quick.map((q) => <QuickTile key={q.href} {...q} />)}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="min-w-0">
          <PanelHeader icon={<TrendingUp className="size-4" />} tone="green" title={`${REVENUE_LABEL} theo chi nhánh`} tip="6 tháng gần nhất · rê chuột lên cột để xem từng chi nhánh." />
          <div className="p-4 sm:p-5">
            <StackedBarChart
              data={rev.map((r) => ({ label: fmtMonth(r.key), parts: r.byFacility }))}
              series={all.map((f) => ({ key: f._id, label: f.name }))}
              format={compactVnd}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-stone-100 px-4 py-3 text-sm sm:px-5">
            <span className="inline-flex items-center gap-1.5 font-medium text-stone-700"><PiggyBank className="size-4 text-stone-400" aria-hidden />{DEPOSITS_LABEL} {fmtMonth(rev.at(-1)?.key ?? '')}</span>
            <Chip tone="green">Thu {vnd(dep.collected)}</Chip>
            <Chip tone="amber">Hoàn {vnd(dep.refunded)}</Chip>
            {/* Đợt 15 (C4): phần giữ lại khi huỷ / cấn trừ khi quyết toán đã tính vào doanh thu; phần còn lại là tiền khách gửi giữ. */}
            <Chip tone="violet">Giữ lại / cấn trừ {vnd(dep.retained)}</Chip>
            <span className="text-xs text-stone-500">(chỉ phần giữ lại / cấn trừ tính vào doanh thu)</span>
          </div>
        </Card>

        <Card className="min-w-0">
          <PanelHeader icon={<ListChecks className="size-4" />} tone="amber" title="Cần xử lý" count={todo} tip="Hồ sơ bồi thường đang xác minh, khoản hoàn chờ chuyển khoản và chi nhánh chưa hoạt động." />
          {todo === 0 ? <EmptyState icon={<CircleCheck className="size-6" />} title="Không có việc chờ" /> : (
            <ul className="divide-y divide-stone-100">
              {reviewClaims.length > 0 && (
                <QueueRow href="/ops/approvals"
                  lead={<IconTile icon={<HandCoins className="size-4" />} tone="violet" />}
                  title="Bồi thường chờ duyệt"
                  meta={opsClaims > 0 ? <Meta icon={<TriangleAlert />} className="font-medium text-amber-700">{opsClaims} hồ sơ vượt hạn mức chi nhánh</Meta> : <Meta>Chi nhánh tự duyệt được</Meta>}
                  actions={<><span className="text-lg font-semibold tabular-nums text-ink">{reviewClaims.length}</span><ArrowRight className="size-4 text-stone-300" aria-hidden /></>}
                />
              )}
              {pendingPayouts.length > 0 && (
                <QueueRow href="/ops/approvals"
                  lead={<IconTile icon={<Landmark className="size-4" />} tone={latePayouts ? 'red' : 'blue'} />}
                  title="Chờ chuyển khoản"
                  meta={latePayouts > 0 ? <Meta icon={<TriangleAlert />} className="font-medium text-red-700">{latePayouts} khoản quá 7 ngày</Meta> : <Meta>Trong hạn 7 ngày</Meta>}
                  actions={<><span className="text-lg font-semibold tabular-nums text-ink">{pendingPayouts.length}</span><ArrowRight className="size-4 text-stone-300" aria-hidden /></>}
                />
              )}
              {notActive.map((f) => (
                <QueueRow key={f._id} href="/ops/facilities"
                  lead={<IconTile icon={<Building2 className="size-4" />} tone={FACILITY_STATUS[f.status].tone} />}
                  title={f.name}
                  badges={<StatusBadge map={FACILITY_STATUS} value={f.status} />}
                  meta={<Meta mono>{f.code}</Meta>}
                  actions={<ArrowRight className="size-4 text-stone-300" aria-hidden />}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <PanelHeader icon={<Building2 className="size-4" />} title="So sánh chi nhánh" count={rows.length} tip="Lấp đầy theo số ô khả dụng; doanh thu là giá thuê hợp đồng đang mở quy đổi theo tháng." />
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.f._id} className="overflow-hidden rounded-xl ring-1 ring-inset ring-stone-200">
              <div className="flex items-center gap-3 p-3">
                <img src={facilityPhoto(r.f)} alt="" loading="lazy" decoding="async" className="size-12 shrink-0 rounded-lg object-cover ring-1 ring-stone-200" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{r.f.name}</p>
                  <p className="font-mono text-[11px] text-stone-500">{r.f.code}</p>
                </div>
                <StatusBadge map={FACILITY_STATUS} value={r.f.status} />
              </div>
              <div className="border-t border-stone-100 px-3 py-3">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-stone-600">Lấp đầy</span>
                  <span className="font-semibold tabular-nums text-ink">{pct(r.s.occupancy)}</span>
                </div>
                <Progress value={r.s.occupancy} tone={r.s.occupancy >= 0.9 ? 'red' : r.s.occupancy >= 0.75 ? 'amber' : 'teal'} className="mt-1.5" />
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-stone-50 px-1 py-1.5"><dt className="text-[11px] text-stone-500">Kho</dt><dd className="text-sm font-semibold tabular-nums text-ink">{r.s.total}</dd></div>
                  <div className="rounded-lg bg-stone-50 px-1 py-1.5" title={vnd(r.s.mrr)}><dt className="text-[11px] text-stone-500">Doanh thu / tháng</dt><dd className="text-sm font-semibold tabular-nums text-ink">{compactVnd(r.s.mrr)}</dd></div>
                  <div className="rounded-lg bg-stone-50 px-1 py-1.5" title={vnd(r.perM2)}><dt className="text-[11px] text-stone-500">Doanh thu / m²</dt><dd className="text-sm font-semibold tabular-nums text-ink">{compactVnd(r.perM2)}</dd></div>
                </dl>
                <ChipRow className="mt-3">
                  {r.s.overdue > 0
                    ? <Chip icon={<TriangleAlert />} tone="red">Nợ quá hạn {vnd(r.s.overdue)}</Chip>
                    : <Chip icon={<CircleCheck />} tone="green">Không nợ quá hạn</Chip>}
                </ChipRow>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
