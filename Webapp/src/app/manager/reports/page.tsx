'use client';

import { useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarRange, CircleAlert, Gauge, HandCoins, Hourglass, PieChart, PiggyBank, TrendingDown, TrendingUp, TriangleAlert, Wallet } from 'lucide-react';
import { DEPOSITS_LABEL, REVENUE_LABEL, REVENUE_SOURCE_LABEL } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import type { CashReport } from '@/shared/api/actions';
import { PAYMENT_TYPE } from '@/shared/lib/labels';
import { agingOf, facilityStats, revenueByMonth, revenueMix } from '@/shared/lib/domain';
import { compactVnd, fmtMonth, monthKey, pct, todayISO, vnd } from '@/shared/lib/format';
import { Card, Disclosure, EmptyState, InfoTip, PageHeader, Skeleton, StatCard, Table, cx, inputCls } from '@/shared/ui';
import { BarChart, BarList } from '@/shared/ui/charts';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { Callout, PanelHeader } from '@/features/staff-ui';
import { PersonCell } from '@/features/backoffice-ui';

export default function Reports() {
  const { db } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const s = facilityStats(db, fid);
  const rev = useMemo(() => revenueByMonth(db, [fid], 6), [db, fid]);
  const thisMonth = monthKey(todayISO());

  // Tuổi nợ cùng định nghĩa "quá hạn" với ô Công nợ quá hạn ở trang Tổng quan và báo cáo ở BE (AGING_BUCKETS / pastDueDays).
  const aging = useMemo(() => agingOf(db, fid), [db, fid]);
  const agingTotal = aging.reduce((x, b) => x + b.amount, 0);

  // Cùng quy tắc thực thu với biểu đồ (khoản gốc đã hoàn vẫn tính gộp, dòng hoàn trừ ra; tháng theo giờ VN).
  const mix = useMemo(() => revenueMix(db, [fid], thisMonth), [db, fid, thisMonth]);

  // Chốt ca tiền mặt theo ngày: tiền mặt từng nhân viên đã thu / đã chi — đối chiếu với két cuối ngày.
  const [cashDate, setCashDate] = useState(todayISO().slice(0, 10));
  const [cash, setCash] = useState<CashReport | null>(null);
  const [cashErr, setCashErr] = useState('');
  useEffect(() => {
    if (!fid || !cashDate) return;
    let alive = true;
    setCash(null); setCashErr('');
    api.get<CashReport>(`/reports/cash?facilityId=${fid}&date=${cashDate}`)
      .then((r) => alive && setCash(r))
      .catch((e: Error) => alive && setCashErr(e.message));
    return () => { alive = false; };
  }, [fid, cashDate, db]);

  const last = rev.at(-1)?.total ?? 0;
  const prev = rev.at(-2)?.total ?? 0;

  return (
    <>
      <PageHeader
        title={<span className="inline-flex items-center gap-1.5">Báo cáo chi nhánh<InfoTip align="start">Doanh thu: thực thu đã trừ hoàn tiền, cộng tiền giữ chân bị giữ lại (huỷ sát ngày, không đến), phần tiền giữ chân cấn trừ khi quyết toán và tiền thanh lý trừ nợ. Lấp đầy và tuổi nợ.</InfoTip></span>}
        actions={<FacilityPicker scope={scope} />} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label={`${REVENUE_LABEL} ${fmtMonth(thisMonth)}`} value={compactVnd(last)} icon={last >= prev ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />} tone="green"
          sub={prev ? `${last >= prev ? '▲' : '▼'} ${pct(Math.abs(last - prev) / prev, 1)} so với tháng trước (tháng này chưa hết)` : undefined} />
        <StatCard label="Doanh thu định kỳ / tháng" value={compactVnd(s.mrr)} icon={<Banknote className="size-5" />} tone="teal" sub="Giá thuê hợp đồng đang mở, quy đổi theo tháng" />
        <StatCard label="Lấp đầy (số kho)" value={pct(s.occupancy)} icon={<Gauge className="size-5" />} tone="blue" sub={`Theo diện tích: ${pct(s.areaOccupancy)}`} />
        <StatCard label="Phải thu quá hạn" value={compactVnd(agingTotal)} icon={<TriangleAlert className="size-5" />} tone={agingTotal > 0 ? 'amber' : 'green'} sub={`${s.overdueCount} hợp đồng · tổng công nợ ${compactVnd(s.outstanding)}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="min-w-0">
          <PanelHeader icon={<TrendingUp className="size-4" />} tone="green" title={`${REVENUE_LABEL} · 6 tháng gần nhất`} tip="Đơn vị: VND · rê chuột lên cột để xem chi tiết." />
          <div className="px-4 pb-5 pt-8 sm:px-5"><BarChart data={rev.map((r) => ({ label: fmtMonth(r.key), value: r.total }))} format={compactVnd} /></div>
          {/* Tiền giữ chân là tiền khách gửi giữ — báo riêng; chỉ phần bị giữ lại / cấn trừ (đợt 15, C4) đã tính vào doanh thu. */}
          <Disclosure variant="plain" className="border-t border-stone-100 px-4 py-2 sm:px-5" icon={<PiggyBank className="size-4" />} title={DEPOSITS_LABEL} meta="Chỉ phần giữ lại / cấn trừ tính vào doanh thu">
            <ul className="grid gap-x-6 gap-y-1 pb-2 text-xs text-stone-600 sm:grid-cols-2">
              {rev.map((r) => (
                <li key={r.key} className="flex justify-between gap-3">
                  <span className="font-medium text-stone-700">{fmtMonth(r.key)}</span>
                  <span className="tabular-nums">thu <b className="font-medium text-emerald-700">{vnd(r.deposits.collected)}</b> · hoàn <b className="font-medium text-amber-700">{vnd(r.deposits.refunded)}</b> · giữ lại / cấn trừ <b className="font-medium text-violet-700">{vnd(r.deposits.retained)}</b></span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </Card>

        <Card className="min-w-0">
          <PanelHeader icon={<Hourglass className="size-4" />} tone="amber" title="Tuổi nợ" tip="Số ngày quá hạn tính từ hết ân hạn. Số trong ngoặc là số hợp đồng." />
          <div className="p-4 sm:p-5">
            {agingTotal === 0 && <Callout tone="green" icon={<HandCoins />} className="mb-4">Không có khoản phải thu quá hạn.</Callout>}
            <BarList max={agingTotal} format={vnd} data={aging.map((b) => ({ key: b.key, label: b.label, value: b.amount, sub: `(${b.count})`, tone: b.min > 15 ? 'red' : 'amber' }))} />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="min-w-0">
          <PanelHeader icon={<PieChart className="size-4" />} tone="teal" title={`Cơ cấu thu ${fmtMonth(thisMonth)}`} tip="Theo loại khoản thu, tiền giữ chân giữ lại / cấn trừ và tiền thanh lý trừ nợ. Thanh = tỷ trọng trên doanh thu tháng." />
          <div className="p-4 sm:p-5">
            {mix.length === 0 ? <EmptyState compact icon={<PieChart className="size-5" />} title="Chưa có khoản thu trong tháng" /> : (
              <BarList max={last} format={vnd} data={mix.map((r) => ({
                key: r.type, label: r.type in REVENUE_SOURCE_LABEL ? REVENUE_SOURCE_LABEL[r.type as keyof typeof REVENUE_SOURCE_LABEL] : PAYMENT_TYPE[r.type as keyof typeof PAYMENT_TYPE].label, value: r.amount,
                sub: last ? pct(Math.max(0, r.amount) / last) : undefined,
              }))} />
            )}
          </div>
        </Card>

        <Card className="min-w-0">
          <PanelHeader icon={<Wallet className="size-4" />} tone="blue" title="Chốt ca tiền mặt" tip="Tiền mặt từng nhân viên đã thu / đã chi trong ngày — đối chiếu với két cuối ngày."
            action={<label className="flex items-center gap-2"><CalendarRange className="size-4 text-stone-400" aria-hidden /><input type="date" aria-label="Ngày chốt ca" className={cx(inputCls, 'w-44')} max={todayISO().slice(0, 10)} value={cashDate} onChange={(e) => setCashDate(e.target.value)} /></label>} />
          {cashErr ? <div className="p-4 sm:p-5"><Callout tone="red" icon={<CircleAlert />}>{cashErr}</Callout></div> : !cash ? (
            <div className="space-y-2 p-4 sm:p-5" aria-label="Đang tải…"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          ) : (
            <Table rows={cash.byStaff} rowKey={(r) => r.staffId} empty={<EmptyState compact icon={<Wallet className="size-5" />} title="Không có giao dịch tiền mặt" />} columns={[
              { key: 'n', header: 'Nhân viên', cell: (r) => <PersonCell name={r.fullName} tone="blue" /> },
              { key: 'c', header: 'Đã thu', className: 'text-right tabular-nums', cell: (r) => <span className="text-emerald-700">{vnd(r.collected.total)} <span className="text-xs text-stone-500">({r.collected.count})</span></span> },
              { key: 'o', header: 'Đã chi', className: 'text-right tabular-nums', cell: (r) => <span className="text-amber-700">{vnd(r.paidOut.total)} <span className="text-xs text-stone-500">({r.paidOut.count})</span></span> },
              { key: 'b', header: 'Phải nộp', className: 'text-right font-semibold tabular-nums', cell: (r) => vnd(r.collected.total - r.paidOut.total) },
            ]} />
          )}
          {cash && cash.byStaff.length > 0 && (
            <dl className="grid grid-cols-3 divide-x divide-stone-100 border-t border-stone-100 text-center">
              <div className="px-2 py-3"><dt className="text-xs text-stone-500">Thu</dt><dd className="text-sm font-semibold tabular-nums text-emerald-700">{vnd(cash.totals.collected)}</dd></div>
              <div className="px-2 py-3"><dt className="text-xs text-stone-500">Chi</dt><dd className="text-sm font-semibold tabular-nums text-amber-700">{vnd(cash.totals.paidOut)}</dd></div>
              <div className="px-2 py-3"><dt className="text-xs text-stone-500">Tồn quỹ</dt><dd className="text-sm font-bold tabular-nums text-ink">{vnd(cash.totals.net)}</dd></div>
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}
