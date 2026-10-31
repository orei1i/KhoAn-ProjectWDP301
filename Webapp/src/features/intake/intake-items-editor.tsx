'use client';

import { Lock, PackageCheck, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { IntakeCheckKey, IntakeItemCondition, SealedCheckKey, SealedPackageKind, UnitCategory } from '@ssm/shared';
import {
  INTAKE_CHECK_ITEMS, INTAKE_ITEM_CONDITION, INTAKE_ITEM_NAME_MAX, INTAKE_ITEM_NAME_MIN, INTAKE_ITEM_SUGGESTIONS, INTAKE_MAX_ITEMS,
  INTAKE_NOTE_MAX, INTAKE_QTY_MAX, INTAKE_SEALED_CHECK_ITEMS, INTAKE_VALUE_MAX, SEALED_CLAIM_RULE, SEALED_DESC_MAX, SEALED_MAX_PACKAGES, SEALED_PACKAGE_KIND,
  SEALED_PACKAGE_KINDS, intakeCategoriesFor, intakeItemsValue, intakeVolumeWarnings, sealedPackageValues,
} from '@ssm/shared';
import type { IntakeItemInput, SealedIntakeInput } from '@/shared/api/actions';
import { vnd } from '@/shared/lib/format';
import { Button, cx, inputCls } from '@/shared/ui';

export const EMPTY_INTAKE_ITEM: IntakeItemInput = { name: '', category: '', quantity: 1, estValue: 0, condition: 'GOOD', note: '' };
export const EMPTY_SEALED: SealedIntakeInput = { packageCount: 1, packageKind: 'BOX', hasSeal: true, description: '', declaredValue: null };
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

/** Lỗi khai gửi kín (cùng giới hạn với BE), null = hợp lệ. */
export function sealedError(s: SealedIntakeInput): string | null {
  if (!Number.isInteger(s.packageCount) || s.packageCount < 1 || s.packageCount > SEALED_MAX_PACKAGES) return `Số kiện 1–${SEALED_MAX_PACKAGES}`;
  if (s.declaredValue != null && !(s.declaredValue >= 0 && s.declaredValue <= INTAKE_VALUE_MAX * SEALED_MAX_PACKAGES)) return 'Tổng giá trị khai không hợp lệ';
  return null;
}

/** Nhập số nguyên trong [min, max] từ ô input (rỗng / sai → min). */
const clampInt = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

/** Loại kho của hợp đồng (cỡ kho quyết định danh sách nhóm đồ — đợt 16 D1) + kích thước để cảnh báo thể tích. */
export type IntakeUnitType = { category: UnitCategory; name?: string; areaM2: number; dimensions?: { heightM: number } | null } | null | undefined;

/**
 * Bảng khai đồ nhiều dòng cho một đợt nhập hàng: tên, nhóm, số lượng, giá trị ước tính / 1 cái, tình trạng, ghi chú.
 * Dùng cho khách khai, nhân viên sửa danh sách thực tế khi xác nhận, và nhân viên khai thay khách tại quầy.
 * Đợt 16 (D1): "Nhóm" là ô CHỌN theo cỡ kho của hợp đồng (`unitType`); mỗi nhóm có gợi ý tên đồ (vẫn gõ tự do được); cảnh báo mềm khi đồ
 * ước tính vượt sức chứa ô hoặc một món quá to so với cỡ. Dòng cũ có nhóm tự do (dữ liệu trước đợt 16) vẫn hiện và giữ nguyên.
 * `lockedIds` (nhân viên xác nhận đợt khách khai — A3): dòng khách khai chỉ sửa số lượng, tình trạng, ghi chú; tên / nhóm / giá trị khoá.
 * Dòng mới thêm lúc đó là "nhân viên thêm tại quầy" (giá trị theo lời khách).
 */
export function IntakeItemsEditor({ items, onChange, error, lockedIds, unitType }: { items: IntakeItemInput[]; onChange: (items: IntakeItemInput[]) => void; error?: string | null; lockedIds?: ReadonlySet<string>; unitType?: IntakeUnitType }) {
  const set = (i: number, patch: Partial<IntakeItemInput>) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const cats = intakeCategoriesFor(unitType?.category ?? null);
  const warnings = intakeVolumeWarnings(items.filter((it) => it.name.trim()), unitType);
  return (
    <div className="space-y-2">
      {lockedIds && lockedIds.size > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-stone-500"><Lock className="size-3.5" />Tên và giá trị do khách khai — chỉ sửa số lượng thực tế, tình trạng, ghi chú. Món khác thì thêm dòng.</p>
      )}
      {items.map((it, i) => {
        const locked = !!it._id && !!lockedIds?.has(it._id);
        const added = !!lockedIds && !locked;
        const cat = it.category?.trim() ?? '';
        const legacy = !!cat && !cats.includes(cat); // nhóm tự do của dữ liệu cũ — giữ nguyên, không chọn lại được
        const tips = (INTAKE_ITEM_SUGGESTIONS[cat] ?? []).filter((s) => s !== it.name);
        return (
        <div key={it._id ?? `new-${i}`} className={cx('space-y-2 rounded-lg p-2.5 ring-1 ring-inset', added ? 'bg-amber-50/60 ring-amber-200' : 'bg-stone-50 ring-stone-200')}>
          {added && <p className="text-[11px] font-medium text-amber-800">Nhân viên thêm tại quầy — giá trị theo lời khách</p>}
          <div className="grid gap-2 sm:grid-cols-[180px_1fr_32px]">
            <select className={cx(inputCls, locked && 'bg-stone-100 text-stone-600')} disabled={locked} value={cat} onChange={(e) => set(i, { category: e.target.value })} aria-label={`Nhóm đồ dòng ${i + 1}`}>
              <option value="">— Nhóm —</option>
              {legacy && <option value={cat}>{cat} (nhóm cũ)</option>}
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className={cx(inputCls, locked && 'bg-stone-100 text-stone-600')} readOnly={locked} title={locked ? 'Khách đã khai — không sửa tên' : undefined} placeholder="Tên đồ (VD: Tủ lạnh Toshiba 180L)" maxLength={INTAKE_ITEM_NAME_MAX} value={it.name} list={tips.length ? `intake-names-${i}` : undefined} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Tên đồ dòng ${i + 1}`} />
            <button type="button" aria-label={`Xoá dòng ${i + 1}`} disabled={items.length === 1} onClick={() => onChange(items.filter((_, k) => k !== i))}
              className="hidden size-9 place-items-center rounded-md text-stone-400 hover:bg-stone-200 hover:text-red-600 disabled:opacity-30 sm:grid"><Trash2 className="size-4" /></button>
          </div>
          {tips.length > 0 && <datalist id={`intake-names-${i}`}>{tips.map((s) => <option key={s} value={s} />)}</datalist>}
          {!locked && tips.length > 0 && !it.name.trim() && (
            <div className="flex flex-wrap gap-1.5">
              {tips.slice(0, 5).map((s) => (
                <button key={s} type="button" onClick={() => set(i, { name: s })} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-stone-600 ring-1 ring-inset ring-stone-200 hover:bg-stone-100">{s}</button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[80px_150px_150px_1fr]">
            <label className="text-[11px] text-stone-500">SL<input type="number" min={1} max={INTAKE_QTY_MAX} className={inputCls} value={it.quantity} onChange={(e) => set(i, { quantity: clampInt(e.target.value, 1, INTAKE_QTY_MAX) })} /></label>
            <label className="text-[11px] text-stone-500">Giá trị / 1 cái (₫){locked && <Lock className="ml-1 inline size-3" />}<input type="number" min={0} max={INTAKE_VALUE_MAX} step={10_000} className={cx(inputCls, locked && 'bg-stone-100 text-stone-600')} readOnly={locked} value={it.estValue} onChange={(e) => set(i, { estValue: clampInt(e.target.value, 0, INTAKE_VALUE_MAX) })} /></label>
            <label className="text-[11px] text-stone-500">Tình trạng
              <select className={inputCls} value={it.condition} onChange={(e) => set(i, { condition: e.target.value as IntakeItemCondition })}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{INTAKE_ITEM_CONDITION[c].label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-stone-500">Ghi chú<input className={inputCls} maxLength={INTAKE_NOTE_MAX} value={it.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} /></label>
          </div>
          {items.length > 1 && <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="text-xs font-medium text-red-600 sm:hidden">Xoá dòng</button>}
        </div>
        );
      })}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          {warnings.map((w) => <p key={w} className="flex gap-1.5"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{w}</p>)}
          <p className="text-amber-700">Chỉ là ước tính để bạn lưu ý — vẫn khai được.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={items.length >= INTAKE_MAX_ITEMS} onClick={() => onChange([...items, { ...EMPTY_INTAKE_ITEM }])}><Plus className="size-3.5" />Thêm dòng</Button>
        <p className="text-sm">{items.length} dòng · tổng giá trị <b className="tabular-nums">{vnd(intakeItemsValue(items))}</b></p>
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Đợt 16 (D2): khai GỬI KÍN — không kê khai chi tiết: số kiện, loại kiện, có niêm phong không, mô tả chung, tổng giá trị khai (tuỳ chọn).
 * Mỗi kiện thành một dòng "Kiện 1..N"; giá trị mỗi kiện = tổng ÷ số kiện.
 */
export function SealedFields({ value, onChange, error }: { value: SealedIntakeInput; onChange: (v: SealedIntakeInput) => void; error?: string | null }) {
  const per = value.declaredValue ? sealedPackageValues(value.declaredValue, value.packageCount)[value.packageCount > 1 ? 1 : 0] : null;
  return (
    <div className="space-y-3 rounded-lg bg-violet-50/60 p-3 text-sm ring-1 ring-inset ring-violet-200">
      <div className="grid gap-2 sm:grid-cols-[110px_150px_1fr]">
        <label className="text-[11px] text-stone-500">Số kiện<input type="number" min={1} max={SEALED_MAX_PACKAGES} className={inputCls} value={value.packageCount} onChange={(e) => onChange({ ...value, packageCount: clampInt(e.target.value, 1, SEALED_MAX_PACKAGES) })} /></label>
        <label className="text-[11px] text-stone-500">Loại kiện
          <select className={inputCls} value={value.packageKind} onChange={(e) => onChange({ ...value, packageKind: e.target.value as SealedPackageKind })}>
            {SEALED_PACKAGE_KINDS.map((k) => <option key={k} value={k}>{SEALED_PACKAGE_KIND[k]}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-stone-500">Tổng giá trị khai (₫, không bắt buộc)
          <input type="number" min={0} step={100_000} className={inputCls} value={value.declaredValue ?? ''} placeholder="Bỏ trống = không khai" onChange={(e) => onChange({ ...value, declaredValue: e.target.value === '' ? null : clampInt(e.target.value, 0, INTAKE_VALUE_MAX * SEALED_MAX_PACKAGES) })} />
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-stone-800"><input type="checkbox" className="size-4" checked={value.hasSeal} onChange={(e) => onChange({ ...value, hasSeal: e.target.checked })} />Các kiện có niêm phong</label>
      <input className={inputCls} maxLength={SEALED_DESC_MAX} value={value.description ?? ''} onChange={(e) => onChange({ ...value, description: e.target.value })} placeholder="Mô tả chung (không bắt buộc) — VD: đồ cá nhân, giấy tờ gia đình" aria-label="Mô tả chung" />
      <p className="text-xs text-stone-600">
        {value.packageCount} dòng "Kiện 1…{value.packageCount}" · {per !== null ? <>mỗi kiện <b>{vnd(per)}</b></> : 'không khai giá trị — bồi thường cần chứng cứ'}. {SEALED_CLAIM_RULE}
      </p>
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Kiểm hàng cấm (Điều 4) — nhân viên tick ĐỦ các mục trước khi xác nhận đợt nhập; có hàng cấm thì từ chối đợt đó. Đợt 16 (D2): đợt GỬI KÍN —
 * không mở kiện, chỉ quan sát bên ngoài (mùi, rò rỉ, tiếng động, khối lượng bất thường).
 */
export function GoodsCheckFields({ value, onChange, note, onNote, showError, sealed }: { value: (IntakeCheckKey | SealedCheckKey)[]; onChange: (v: (IntakeCheckKey | SealedCheckKey)[]) => void; note: string; onNote: (v: string) => void; showError?: boolean; sealed?: boolean }) {
  const list: readonly { key: IntakeCheckKey | SealedCheckKey; label: string }[] = sealed ? INTAKE_SEALED_CHECK_ITEMS : INTAKE_CHECK_ITEMS;
  const missing = list.filter((i) => !value.includes(i.key)).length;
  return (
    <div className="space-y-2.5 rounded-lg bg-rose-50 p-4 text-sm ring-1 ring-inset ring-rose-200">
      <p className="flex items-center gap-1.5 font-semibold text-rose-950">{sealed && <PackageCheck className="size-4" />}{sealed ? 'Kiểm bên ngoài — KHÔNG mở kiện' : 'Kiểm hàng cấm'}</p>
      <div className="space-y-2">
        {list.map((i) => {
          const on = value.includes(i.key);
          return (
            <label key={i.key} className={cx('flex cursor-pointer gap-2.5', showError && !on ? 'font-medium text-red-700' : 'text-rose-950')}>
              <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={on} onChange={(e) => onChange(e.target.checked ? [...value, i.key] : value.filter((k) => k !== i.key))} />
              <span>{i.label}</span>
            </label>
          );
        })}
      </div>
      {showError && missing > 0 && <p role="alert" className="text-xs font-medium text-red-600">Còn {missing} mục chưa tick — {sealed ? 'kiện có dấu hiệu bất thường' : 'có hàng cấm'} thì bấm “Từ chối”.</p>}
      <input className={inputCls} maxLength={500} value={note} onChange={(e) => onNote(e.target.value)} placeholder="Ghi chú kiểm hàng (không bắt buộc)" aria-label="Ghi chú kiểm hàng" />
    </div>
  );
}
