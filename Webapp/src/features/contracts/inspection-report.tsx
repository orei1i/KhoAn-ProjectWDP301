'use client';

import { DAMAGE_SEVERITY_LABEL, ITEM_CONDITION_LABEL, type InspectionLog } from '@ssm/shared';
import { fmtDate, vnd } from '@/shared/lib/format';

/** Biên bản kiểm tra khi trả kho (Điều 9) — hiển thị cho khách ở cổng khách và cho quản lý khi điều chỉnh sau khiếu nại. */
export function InspectionReport({ inspection: i, inspectorName }: { inspection: InspectionLog; inspectorName?: string }) {
  const ds = i.depositSettlement;
  const adjustments = i.adjustments ?? [];
  return (
    <div className="space-y-4 text-sm">
      <p className="text-stone-600">Lập ngày {fmtDate(i.performedAt)}{inspectorName ? ` · ${inspectorName}` : ''}</p>
      <div>
        <h4 className="mb-1 font-semibold">Kiểm tra hiện trạng</h4>
        <ul className="grid gap-1 sm:grid-cols-2">
          {i.checklist.map((x) => (
            <li key={x.item} className="flex justify-between gap-2 rounded bg-stone-50 px-2 py-1">
              <span>{x.item}</span><span className={x.condition === 'OK' ? 'text-emerald-700' : 'text-red-700'}>{ITEM_CONDITION_LABEL[x.condition]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-1 font-semibold">Hư hỏng ghi nhận</h4>
        {i.damages.length === 0 ? <p className="text-stone-500">Không có hư hỏng.</p> : (
          <ul className="space-y-1.5">
            {i.damages.map((d, k) => (
              <li key={k} className="rounded-lg p-2 ring-1 ring-stone-200">
                <div className="flex justify-between gap-2">
                  <span>{d.description} <span className="text-xs text-stone-500">({DAMAGE_SEVERITY_LABEL[d.severity]})</span></span>
                  <b className="tabular-nums">{vnd(d.cost)}</b>
                </div>
                {d.photoUrls.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {d.photoUrls.map((u, n) => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">Ảnh {n + 1}</a>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {i.photoUrls.length > 0 && (
          <p className="mt-1 text-xs">Ảnh hiện trạng: {i.photoUrls.map((u, n) => <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 text-brand-700 underline">Ảnh {n + 1}</a>)}</p>
        )}
      </div>
      {ds && (
        <dl className="space-y-1 rounded-lg bg-stone-50 p-3">
          <div className="flex justify-between"><dt>Tiền giữ chân</dt><dd className="tabular-nums">{vnd(ds.depositHeld)}</dd></div>
          <div className="flex justify-between"><dt>Trừ hư hại và công nợ</dt><dd className="tabular-nums">−{vnd(ds.deductions)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Hoàn lại</dt><dd className="tabular-nums">{vnd(ds.refundAmount)}</dd></div>
          {(ds.shortfall ?? 0) > 0 && <div className="flex justify-between text-red-700"><dt>Còn thiếu (nợ sau quyết toán)</dt><dd className="tabular-nums">{vnd(ds.shortfall ?? 0)}</dd></div>}
        </dl>
      )}
      {adjustments.length > 0 && (
        <div>
          <h4 className="mb-1 font-semibold">Điều chỉnh sau khiếu nại</h4>
          <ul className="space-y-1">
            {adjustments.map((a, k) => (
              <li key={k} className="flex justify-between gap-2"><span>{fmtDate(a.at)} · {a.reason}</span><b className="tabular-nums text-emerald-700">−{vnd(a.amount)}</b></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
