'use client';

import { useState } from 'react';
import type { RentalPeriod } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { RENTAL_PERIOD, UNIT_CATEGORY } from '@/shared/lib/labels';
import { pct, vnd } from '@/shared/lib/format';
import { Button, Card, CardHeader, PageHeader, cx, inputCls } from '@/shared/ui';

const PERIODS: RentalPeriod[] = ['DAY', 'WEEK', 'MONTH'];

export default function Pricing() {
  const { db, run, toast } = useStore();
  const facilities = db.facilities.filter((f) => !f.isDeleted && f.status !== 'INACTIVE');
  const codes = [...new Set(db.unitTypes.map((t) => t.code))];
  // Khách tự chọn chu kỳ lúc đặt — mỗi loại kho có 3 giá, sửa từng mức một qua nút chọn chu kỳ này.
  const [period, setPeriod] = useState<RentalPeriod>('MONTH');
  const [edits, setEdits] = useState<Record<string, string>>({});

  const occ = (utId: string) => {
    const us = db.units.filter((u) => u.unitTypeId === utId && u.status !== 'MAINTENANCE');
    return us.length ? us.filter((u) => u.status === 'OCCUPIED' || u.status === 'PENDING_INSPECTION').length / us.length : null;
  };
  const changePeriod = (p: RentalPeriod) => { setPeriod(p); setEdits({}); }; // đổi chu kỳ thì bỏ nháp đang sửa dở của chu kỳ cũ
  const save = async () => {
    let n = 0;
    for (const [id, v] of Object.entries(edits)) {
      const res = await run('setUnitTypeRates', { unitTypeId: id, rates: { [period]: Math.round(Number(v.replace(/\D/g, ''))) } });
      if (res.ok) n++;
    }
    setEdits({});
    if (n) toast(`Đã cập nhật ${n} mức giá — áp dụng cho báo giá mới`, 'success');
  };

  return (
    <>
      <PageHeader title="Bảng giá" description="Giá theo loại kho, chi nhánh và chu kỳ thuê. Hợp đồng đang chạy giữ nguyên giá đã ký." actions={<Button disabled={!Object.keys(edits).length} onClick={() => void save()}>Lưu {Object.keys(edits).length || ''} thay đổi</Button>} />
      <Card>
        <CardHeader title="Giá theo chu kỳ" description="Màu nền theo tỷ lệ lấp đầy: đỏ ≥ 90% (cân nhắc tăng giá), xanh < 60% (cân nhắc khuyến mãi)"
          actions={
            <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
              {PERIODS.map((p) => (
                <button key={p} type="button" onClick={() => changePeriod(p)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', period === p ? 'bg-white shadow-sm' : 'text-stone-500 hover:text-stone-900')}>{RENTAL_PERIOD[p]}</button>
              ))}
            </div>
          } />
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-4 py-2.5 font-medium">Loại kho</th>
                {facilities.map((f) => <th key={f._id} className="px-4 py-2.5 font-medium">{f.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {codes.map((code) => {
                const sample = db.unitTypes.find((t) => t.code === code)!;
                return (
                  <tr key={code}>
                    <td className="px-4 py-3"><p className="font-medium">{sample.name}</p><p className="text-xs text-stone-500">{UNIT_CATEGORY[sample.category]} · {sample.areaM2} m²</p></td>
                    {facilities.map((f) => {
                      const ut = db.unitTypes.find((t) => t.facilityId === f._id && t.code === code);
                      if (!ut) return <td key={f._id} className="px-4 py-3 text-stone-400">—</td>;
                      const o = occ(ut._id);
                      return (
                        <td key={f._id} className={cx('px-4 py-3', o !== null && o >= 0.9 && 'bg-red-50', o !== null && o < 0.6 && 'bg-emerald-50')}>
                          <input className={cx(inputCls, 'w-36 tabular-nums', edits[ut._id] !== undefined && 'ring-2 ring-amber-400')} value={edits[ut._id] ?? new Intl.NumberFormat('vi-VN').format(ut.rates[period])} onChange={(e) => setEdits({ ...edits, [ut._id]: e.target.value })} />
                          <p className="mt-1 text-[11px] text-stone-500">{o === null ? 'Chưa có kho' : `Lấp đầy ${pct(o)}`}</p>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
