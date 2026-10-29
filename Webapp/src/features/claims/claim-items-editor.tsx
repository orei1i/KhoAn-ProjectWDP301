'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { ClaimItem, InventoryItem } from '@ssm/shared';
import { UNDECLARED_ITEM_NOTE } from '@ssm/shared';
import { vnd } from '@/shared/lib/format';
import { Badge, Button, inputCls } from '@/shared/ui';

const FREE_ITEM: ClaimItem = { name: '', quantity: 1, unitValue: 0 };
/** Dòng khởi đầu của form: có "đồ đang gửi" thì để khách chọn từ danh sách, chưa có thì một dòng tự khai. */
export const initialClaimItems = (inventory: InventoryItem[]): ClaimItem[] => (inventory.length ? [] : [{ ...FREE_ITEM }]);

/** Lỗi đầu tiên của các hạng mục (cùng quy tắc với BE), null = hợp lệ. */
export function claimItemsError(items: ClaimItem[], inventory: InventoryItem[]): string | null {
  if (items.length === 0) return 'Chọn đồ từ danh sách hoặc thêm đồ ngoài danh sách';
  for (const [i, it] of items.entries()) {
    if (!it.name.trim()) return `Dòng ${i + 1}: nhập tên tài sản`;
    if (!(it.quantity >= 1) || !(it.unitValue >= 0)) return `Dòng ${i + 1}: số lượng / giá trị không hợp lệ`;
    const inv = it.intakeItemId ? inventory.find((x) => x.itemId === it.intakeItemId) : undefined;
    if (it.intakeItemId && !inv) return `Dòng ${i + 1}: món đồ không còn trong danh sách đồ đang gửi`;
    if (inv && it.quantity > inv.quantity) return `Dòng ${i + 1}: tối đa ${inv.quantity} cái (số đã nhập kho)`;
    if (inv && it.unitValue > inv.estValue) return `Dòng ${i + 1}: không vượt giá trị đã khai ${vnd(inv.estValue)}/cái`;
  }
  return null;
}

/** Nhãn của một hạng mục bồi thường: đồ trong danh sách đã khai & xác nhận, hoặc đồ ngoài danh sách (cần chứng cứ). */
export function ClaimItemTag({ item }: { item: Pick<ClaimItem, 'intakeItemId' | 'undeclared'> }) {
  if (item.intakeItemId) return <Badge tone="green">Trong danh sách</Badge>;
  if (item.undeclared) return <span title={UNDECLARED_ITEM_NOTE}><Badge tone="amber">Ngoài danh sách</Badge></span>;
  return null;
}

/**
 * Hạng mục thiệt hại của hồ sơ bồi thường: chọn từ "Đồ đang gửi" của hợp đồng (tự điền tên, giá trị đã khai — được nhập thấp hơn, số
 * lượng không quá số đã nhập), hoặc thêm đồ ngoài danh sách (có nhãn — chi nhánh xét kỹ, cần chứng cứ).
 */
export function ClaimItemsEditor({ items, onChange, inventory }: { items: ClaimItem[]; onChange: (items: ClaimItem[]) => void; inventory: InventoryItem[] }) {
  const set = (i: number, patch: Partial<ClaimItem>) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const remaining = inventory.filter((x) => !items.some((it) => it.intakeItemId === x.itemId));
  const add = (itemId: string) => {
    const x = inventory.find((y) => y.itemId === itemId);
    if (x) onChange([...items, { name: x.name, quantity: 1, unitValue: x.estValue, intakeItemId: x.itemId }]);
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-stone-700">Hạng mục thiệt hại</p>
        <div className="flex flex-wrap items-center gap-2">
          {inventory.length > 0 && (
            <select className={`${inputCls} h-8 w-auto py-1 text-xs`} value="" disabled={remaining.length === 0} onChange={(e) => e.target.value && add(e.target.value)} aria-label="Chọn từ đồ đang gửi">
              <option value="">{remaining.length ? '+ Chọn từ đồ đang gửi…' : 'Đã chọn hết đồ đang gửi'}</option>
              {remaining.map((x) => <option key={x.itemId} value={x.itemId}>{x.name} · SL {x.quantity} · {vnd(x.estValue)}/cái · {x.batchCode}</option>)}
            </select>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...items, { ...FREE_ITEM }])}><Plus className="size-3.5" />Đồ ngoài danh sách</Button>
        </div>
      </div>
      {items.length === 0 && <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-500">{inventory.length ? 'Chọn đồ bị hư hỏng / mất từ danh sách đồ đang gửi.' : 'Thêm đồ bị hư hỏng / mất.'}</p>}
      <div className="space-y-2">
        {items.map((it, i) => {
          const inv = it.intakeItemId ? inventory.find((x) => x.itemId === it.intakeItemId) : undefined;
          return (
            <div key={it.intakeItemId ?? `free-${i}`}>
              <div className="grid grid-cols-[1fr_72px_140px_32px] items-center gap-2">
                {inv ? (
                  <div className="flex min-w-0 items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm ring-1 ring-inset ring-stone-200">
                    <span className="truncate font-medium">{it.name}</span><Badge tone="green">Trong danh sách</Badge>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <input className={inputCls} placeholder="Tên tài sản" value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Tên tài sản dòng ${i + 1}`} />
                    <Badge tone="amber">Ngoài danh sách</Badge>
                  </div>
                )}
                <input type="number" min={1} max={inv?.quantity ?? 999} className={inputCls} value={it.quantity} aria-label={`Số lượng dòng ${i + 1}`}
                  onChange={(e) => set(i, { quantity: Math.min(inv?.quantity ?? 999, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} />
                <input type="number" min={0} max={inv?.estValue} step={10_000} className={inputCls} placeholder="Giá trị / cái" value={it.unitValue} aria-label={`Giá trị dòng ${i + 1}`}
                  onChange={(e) => set(i, { unitValue: Math.min(inv?.estValue ?? Number.MAX_SAFE_INTEGER, Math.max(0, Number(e.target.value) || 0)) })} />
                <button type="button" aria-label="Xóa dòng" onClick={() => onChange(items.filter((_, k) => k !== i))}
                  className="grid size-8 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-600"><Trash2 className="size-4" /></button>
              </div>
              {inv ? (
                <p className="mt-0.5 text-[11px] text-stone-500">Đã nhập kho {inv.quantity} cái · khai {vnd(inv.estValue)}/cái · đợt {inv.batchCode}</p>
              ) : (
                <p className="mt-0.5 text-[11px] text-amber-700">{UNDECLARED_ITEM_NOTE}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
