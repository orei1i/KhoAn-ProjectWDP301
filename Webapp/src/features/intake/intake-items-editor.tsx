'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { IntakeCheckKey, IntakeItemCondition } from '@ssm/shared';
import {
  INTAKE_CATEGORY_MAX, INTAKE_CATEGORY_SUGGESTIONS, INTAKE_CHECK_ITEMS, INTAKE_ITEM_CONDITION, INTAKE_ITEM_NAME_MAX, INTAKE_ITEM_NAME_MIN, INTAKE_MAX_ITEMS,
  INTAKE_NOTE_MAX, INTAKE_QTY_MAX, INTAKE_VALUE_MAX, intakeItemsValue,
} from '@ssm/shared';
import type { IntakeItemInput } from '@/shared/api/actions';
import { vnd } from '@/shared/lib/format';
import { Button, cx, inputCls } from '@/shared/ui';

export const EMPTY_INTAKE_ITEM: IntakeItemInput = { name: '', category: '', quantity: 1, estValue: 0, condition: 'GOOD', note: '' };
const CONDITIONS = Object.keys(INTAKE_ITEM_CONDITION) as IntakeItemCondition[];

/** Lỗi đầu tiên của danh sách đồ (cùng giới hạn với BE), null = hợp lệ. */
export function intakeItemsError(items: IntakeItemInput[]): string | null {
  if (items.length === 0) return 'Thêm ít nhất 1 món đồ';
  if (items.length > INTAKE_MAX_ITEMS) return `Tối đa ${INTAKE_MAX_ITEMS} dòng mỗi đợt`;
  for (const [i, it] of items.entries()) {
    const n = it.name.trim().length;
    if (n < INTAKE_ITEM_NAME_MIN || n > INTAKE_ITEM_NAME_MAX) return `Dòng ${i + 1}: tên đồ ${INTAKE_ITEM_NAME_MIN}–${INTAKE_ITEM_NAME_MAX} ký tự`;
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > INTAKE_QTY_MAX) return `Dòng ${i + 1}: số lượng 1–${INTAKE_QTY_MAX}`;
    if (!(it.estValue >= 0 && it.estValue <= INTAKE_VALUE_MAX)) return `Dòng ${i + 1}: giá trị không hợp lệ`;
  }
  return null;
}

/** Nhập số nguyên trong [min, max] từ ô input (rỗng / sai → min). */
const clampInt = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

/**
 * Bảng khai đồ nhiều dòng cho một đợt nhập hàng: tên, nhóm (gợi ý, tự do), số lượng, giá trị ước tính / 1 cái, tình trạng, ghi chú.
 * Dùng cho khách khai, nhân viên sửa danh sách thực tế khi xác nhận, và nhân viên khai thay khách tại quầy.
 */
export function IntakeItemsEditor({ items, onChange, error }: { items: IntakeItemInput[]; onChange: (items: IntakeItemInput[]) => void; error?: string | null }) {
  const set = (i: number, patch: Partial<IntakeItemInput>) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-2">
      <datalist id="intake-categories">{INTAKE_CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
      {items.map((it, i) => (
        <div key={it._id ?? `new-${i}`} className="space-y-2 rounded-lg bg-stone-50 p-2.5 ring-1 ring-inset ring-stone-200">
          <div className="grid gap-2 sm:grid-cols-[1fr_150px_32px]">
            <input className={inputCls} placeholder="Tên đồ (VD: Tủ lạnh Toshiba 180L)" maxLength={INTAKE_ITEM_NAME_MAX} value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Tên đồ dòng ${i + 1}`} />
            <input className={inputCls} placeholder="Nhóm" list="intake-categories" maxLength={INTAKE_CATEGORY_MAX} value={it.category ?? ''} onChange={(e) => set(i, { category: e.target.value })} aria-label={`Nhóm đồ dòng ${i + 1}`} />
            <button type="button" aria-label={`Xoá dòng ${i + 1}`} disabled={items.length === 1} onClick={() => onChange(items.filter((_, k) => k !== i))}
              className="hidden size-9 place-items-center rounded-md text-stone-400 hover:bg-stone-200 hover:text-red-600 disabled:opacity-30 sm:grid"><Trash2 className="size-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[80px_150px_150px_1fr]">
            <label className="text-[11px] text-stone-500">SL<input type="number" min={1} max={INTAKE_QTY_MAX} className={inputCls} value={it.quantity} onChange={(e) => set(i, { quantity: clampInt(e.target.value, 1, INTAKE_QTY_MAX) })} /></label>
            <label className="text-[11px] text-stone-500">Giá trị / 1 cái (₫)<input type="number" min={0} max={INTAKE_VALUE_MAX} step={10_000} className={inputCls} value={it.estValue} onChange={(e) => set(i, { estValue: clampInt(e.target.value, 0, INTAKE_VALUE_MAX) })} /></label>
            <label className="text-[11px] text-stone-500">Tình trạng
              <select className={inputCls} value={it.condition} onChange={(e) => set(i, { condition: e.target.value as IntakeItemCondition })}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{INTAKE_ITEM_CONDITION[c].label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-stone-500">Ghi chú<input className={inputCls} maxLength={INTAKE_NOTE_MAX} value={it.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} /></label>
          </div>
          {items.length > 1 && <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="text-xs font-medium text-red-600 sm:hidden">Xoá dòng</button>}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={items.length >= INTAKE_MAX_ITEMS} onClick={() => onChange([...items, { ...EMPTY_INTAKE_ITEM }])}><Plus className="size-3.5" />Thêm dòng</Button>
        <p className="text-sm">{items.length} dòng · tổng giá trị <b className="tabular-nums">{vnd(intakeItemsValue(items))}</b></p>
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

/** Kiểm hàng cấm (Điều 4) — nhân viên tick ĐỦ các mục trước khi xác nhận đợt nhập; có hàng cấm thì từ chối đợt đó. */
export function GoodsCheckFields({ value, onChange, note, onNote, showError }: { value: IntakeCheckKey[]; onChange: (v: IntakeCheckKey[]) => void; note: string; onNote: (v: string) => void; showError?: boolean }) {
  const missing = INTAKE_CHECK_ITEMS.length - value.length;
  return (
    <div className="space-y-2.5 rounded-lg bg-rose-50 p-4 text-sm ring-1 ring-inset ring-rose-200">
      <p className="font-semibold text-rose-950">Kiểm hàng cấm</p>
      <div className="space-y-2">
        {INTAKE_CHECK_ITEMS.map((i) => {
          const on = value.includes(i.key);
          return (
            <label key={i.key} className={cx('flex cursor-pointer gap-2.5', showError && !on ? 'font-medium text-red-700' : 'text-rose-950')}>
              <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={on} onChange={(e) => onChange(e.target.checked ? [...value, i.key] : value.filter((k) => k !== i.key))} />
              <span>{i.label}</span>
            </label>
          );
        })}
      </div>
      {showError && missing > 0 && <p role="alert" className="text-xs font-medium text-red-600">Còn {missing} mục chưa tick — có hàng cấm thì bấm “Từ chối”.</p>}
      <input className={inputCls} maxLength={500} value={note} onChange={(e) => onNote(e.target.value)} placeholder="Ghi chú kiểm hàng (không bắt buộc)" aria-label="Ghi chú kiểm hàng" />
    </div>
  );
}
