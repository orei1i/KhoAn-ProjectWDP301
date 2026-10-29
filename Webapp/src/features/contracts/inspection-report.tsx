'use client';

import { DAMAGE_SEVERITY_LABEL, ITEM_CONDITION_LABEL, type InspectionLog, type RentalContract } from '@ssm/shared';
import { fmtDate, vnd } from '@/shared/lib/format';
import { HandoverInfo, LeftoverInfo } from '@/features/contracts/move-out-info';

/** Biên bản kiểm tra khi trả kho (Điều 9) — hiển thị cho khách ở cổng khách và cho quản lý / vận hành khi điều chỉnh sau khiếu nại. */
/** `contract` (không bắt buộc): kèm thông tin bàn giao kho và đồ để lại (giữ đến ngày nào, trạng thái) của hợp đồng. */
export function InspectionReport({ inspection: i, inspectorName, contract, handoverByName }: { inspection: InspectionLog; inspectorName?: string; contract?: RentalContract; handoverByName?: string }) {
  const ds = i.depositSettlement;
  const et = ds?.earlyTermination;
  const adjustments = i.adjustments ?? [];
  const handover = contract?.moveOut?.handover;
  // Đồ để lại: lấy trên hợp đồng (có hạn giữ, trạng thái); hợp đồng chưa có thì lấy theo biên bản.
  const leftover = contract?.leftover ?? (i.leftItems?.present ? { description: i.leftItems.description ?? '', photoUrls: i.leftItems.photoUrls ?? [] } : null);
  const row = (label: string, value: string, tone?: string) => (
    <div className={`flex justify-between gap-3 ${tone ?? ''}`}><dt>{label}</dt><dd className="shrink-0 tabular-nums">{value}</dd></div>
  );
  return (
    <div className="space-y-4 text-sm">
      <p className="text-stone-600">Lập ngày {fmtDate(i.performedAt)}{inspectorName ? ` · ${inspectorName}` : ''}</p>
      {handover && <HandoverInfo handover={handover} byName={handoverByName} />}
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
      {leftover && <LeftoverInfo leftover={leftover} />}
      {ds && (
        // Tách từng khoản để khách thấy vì sao bị giữ tiền: hư hại, công nợ, giới hạn hoàn khi trả sớm, thu hồi ưu đãi.
        <dl className="space-y-1 rounded-lg bg-stone-50 p-3">
          {row('Tiền giữ chân', vnd(ds.depositHeld))}
          {row('Chi phí hư hại', vnd(i.totalDamageFee))}
          {(ds.priorOutstanding ?? 0) > 0 && row('Công nợ chưa trả trước khi trả kho', vnd(ds.priorOutstanding ?? 0))}
          {et && row(`Trả kho sớm (đã dùng ${et.elapsedPct}% kỳ hạn) — hoàn tối đa`, `${et.refundCapPct}% tiền giữ chân`)}
          {(et?.discountClawback ?? 0) > 0 && row('Thu hồi ưu đãi thuê dài hạn', vnd(et?.discountClawback ?? 0))}
          {/* F5: phần tiền giữ chân dùng trừ hư hại / công nợ / thu hồi ưu đãi là "đã cấn trừ" — không phải bị mất. */}
          {row('Đã cấn trừ vào tiền giữ chân', `−${vnd(ds.deductions)}`)}
          {row('Hoàn lại tiền giữ chân', vnd(ds.refundAmount), 'font-semibold')}
          {(ds.prepaidRentRefund ?? 0) > 0 && row('Hoàn tiền thuê trả trước chưa dùng', vnd(ds.prepaidRentRefund ?? 0))}
          {(ds.prepaidRentOffset ?? 0) > 0 && row('Tiền thuê trả trước cấn vào hư hại / công nợ', vnd(ds.prepaidRentOffset ?? 0))}
          {(ds.shortfall ?? 0) > 0 && row('Còn thiếu (nợ sau quyết toán)', vnd(ds.shortfall ?? 0), 'text-red-700')}
        </dl>
      )}
      {adjustments.length > 0 && (
        <div>
          <h4 className="mb-1 font-semibold">Điều chỉnh sau khiếu nại</h4>
          <ul className="space-y-1">
            {adjustments.map((a, k) => (
              <li key={k} className="flex justify-between gap-2">
                <span>{fmtDate(a.at)} · giảm hư hại {vnd(a.amount)} · {a.reason}</span>
                <span className="shrink-0 tabular-nums text-emerald-700">{(a.debtCut ?? 0) > 0 ? `nợ −${vnd(a.debtCut ?? 0)} ` : ''}{(a.refund ?? 0) > 0 ? `hoàn ${vnd(a.refund ?? 0)}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
