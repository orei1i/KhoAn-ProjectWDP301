'use client';

import { useEffect, useState } from 'react';
import { PackageX, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { ClaimItem, DamageClaim, InventoryItem, SealedPackageState } from '@ssm/shared';
import { CLAIM_COUNTED_STATUSES, CLAIM_ITEM_FLAG, INTAKE_ITEM_CONDITION, SEALED_CLAIM_RULE, SEALED_PACKAGE_STATE, UNDECLARED_ITEM_NOTE, claimableQty, confirmedAfterIncident, fmtDate } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { vnd } from '@/shared/lib/format';
import { Badge, Button, inputCls } from '@/shared/ui';
import { Callout } from '@/features/staff-ui';

const FREE_ITEM: ClaimItem = { name: '', quantity: 1, unitValue: 0 };

/**
 * Đợt 17 (D1): màn xét duyệt — hồ sơ có đồ ngoài danh sách trên hợp đồng có đợt gửi kín đã xác nhận: cảnh báo đồ đó có thể nằm trong kiện. Không chặn.
 * Hỏi `GET /claims/:id` (chỉ nhân viên / quản lý / vận hành nhận cờ này; khách không thấy) thay vì suy từ snapshot.
 */
export function SealedPackagesWarning({ claimId }: { claimId: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    setOn(false);
    api.get<{ hasSealedPackages?: boolean }>(`/claims/${claimId}`).then((r) => { if (alive) setOn(!!r.hasSealedPackages); }).catch(() => {});
    return () => { alive = false; };
  }, [claimId]);
  if (!on) return null;
  return <Callout tone="amber" icon={<PackageX />} title="Hợp đồng có kiện gửi kín">Kiểm tra đồ khai ngoài danh sách có nằm trong kiện không (Điều 6): kiện còn nguyên niêm phong thì không nhận khiếu nại thiếu đồ bên trong.</Callout>;
}
/** Dòng khởi đầu của form: có "đồ đang gửi" thì để khách chọn từ danh sách, chưa có thì một dòng tự khai. */
export const initialClaimItems = (inventory: InventoryItem[]): ClaimItem[] => (inventory.length ? [] : [{ ...FREE_ITEM }]);

/** Số lượng mỗi món đã được yêu cầu ở các hồ sơ còn được tính của hợp đồng (chưa bị từ chối / rút — kể cả đã chi) — như BE (A1). */
export function claimedElsewhereOf(claims: readonly DamageClaim[], contractId: string) {
  const m = new Map<string, number>();
  for (const c of claims) {
    if (c.contractId !== contractId || !(CLAIM_COUNTED_STATUSES as readonly string[]).includes(c.status)) continue;
    for (const it of c.items) if (it.intakeItemId) m.set(it.intakeItemId, (m.get(it.intakeItemId) ?? 0) + it.quantity);
  }
  return m;
}

/** Ngữ cảnh đối chiếu: ngày sự cố ('YYYY-MM-DD') + số đã yêu cầu ở hồ sơ khác → "số còn đòi được" của từng món (A1 + A7). */
export type ClaimItemsContext = { incidentDay: string; claimedElsewhere: Map<string, number> };
const maxOf = (inv: InventoryItem, ctx?: ClaimItemsContext) => (ctx ? claimableQty(inv, ctx.incidentDay, ctx.claimedElsewhere.get(inv.itemId) ?? 0) : inv.quantity);
const afterIncident = (inv: InventoryItem, ctx?: ClaimItemsContext) => !!ctx && confirmedAfterIncident(inv.confirmedAt, ctx.incidentDay);

/** Lỗi đầu tiên của các hạng mục (cùng quy tắc với BE), null = hợp lệ. */
export function claimItemsError(items: ClaimItem[], inventory: InventoryItem[], ctx?: ClaimItemsContext): string | null {
  if (items.length === 0) return 'Chọn đồ từ danh sách hoặc thêm đồ ngoài danh sách';
  for (const [i, it] of items.entries()) {
    if (!it.name.trim()) return `Dòng ${i + 1}: nhập tên tài sản`;
    if (!(it.quantity >= 1) || !(it.unitValue >= 0)) return `Dòng ${i + 1}: số lượng / giá trị không hợp lệ`;
    const inv = it.intakeItemId ? inventory.find((x) => x.itemId === it.intakeItemId) : undefined;
    if (it.intakeItemId && !inv) return `Dòng ${i + 1}: món đồ không còn trong danh sách đồ đang gửi`;
    if (inv && it.quantity > maxOf(inv, ctx)) return `Dòng ${i + 1}: tối đa ${maxOf(inv, ctx)} cái (số còn đòi được)`;
    // Đợt 16 (D2): kiện gửi kín — chọn tình trạng kiện; kiện còn nguyên chỉ thiếu đồ bên trong thì không nhận; không khai giá trị → nhập giá trị.
    if (inv?.sealed && !it.packageState) return `Dòng ${i + 1}: chọn tình trạng kiện gửi kín`;
    if (inv?.sealed && it.packageState === 'CONTENTS_ONLY') return `Dòng ${i + 1}: kiện còn nguyên niêm phong — không nhận khiếu nại thiếu đồ bên trong`;
    if (inv?.sealed && inv.estValue === 0 && !(it.unitValue > 0)) return `Dòng ${i + 1}: kiện không khai giá trị — nhập giá trị yêu cầu và gửi kèm chứng cứ`;
    if (inv && !(inv.sealed && inv.estValue === 0) && it.unitValue > inv.estValue) return `Dòng ${i + 1}: không vượt giá trị đã khai ${vnd(inv.estValue)}/cái`;
  }
  return null;
}

/** Nhãn của một hạng mục bồi thường: đồ trong danh sách đã khai & xác nhận, hoặc đồ ngoài danh sách (cần chứng cứ), kèm cờ cảnh báo. */
export function ClaimItemTag({ item }: { item: Pick<ClaimItem, 'intakeItemId' | 'undeclared' | 'flag'> }) {
  const flag = item.flag ? <Badge tone={CLAIM_ITEM_FLAG[item.flag].tone}>{CLAIM_ITEM_FLAG[item.flag].label}</Badge> : null;
  if (item.intakeItemId) return <>{item.undeclared ? <Badge tone="amber">Xét như ngoài danh sách</Badge> : <Badge tone="green">Trong danh sách</Badge>}{flag}</>;
  if (item.undeclared) return <><span title={UNDECLARED_ITEM_NOTE}><Badge tone="amber">Ngoài danh sách</Badge></span>{flag}</>;
  return flag;
}

/** Thông tin đợt nhập chép vào dòng bồi thường + cảnh báo màu cho người xét (A5, A9). */
export function ClaimItemIntakeInfo({ item }: { item: ClaimItem }) {
  const facts = [
    item.batchCode && `Đợt ${item.batchCode}`,
    item.intakeConfirmedAt && `nhập ${fmtDate(item.intakeConfirmedAt)}`,
    item.intakeCondition && `lúc nhập: ${INTAKE_ITEM_CONDITION[item.intakeCondition].label.toLowerCase()}`,
  ].filter(Boolean).join(' · ');
  return (
    <>
      {facts && <p className="text-xs text-stone-500">{facts}</p>}
      {item.flag === 'AFTER_INCIDENT' && <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-700"><TriangleAlert className="size-3.5" />Món nhập kho SAU ngày sự cố — xét như đồ ngoài danh sách</p>}
      {item.flag === 'DAMAGED_AT_INTAKE' && <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700"><TriangleAlert className="size-3.5" />Món đã hư lúc nhập kho — đối chiếu tình trạng trước khi duyệt</p>}
      {item.sealedPackage && <p className="mt-0.5 text-xs text-violet-800">Kiện gửi kín{item.packageState ? ` · ${SEALED_PACKAGE_STATE[item.packageState].toLowerCase()}` : ''}</p>}
      {item.flag === 'SEALED_NO_VALUE' && <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-700"><TriangleAlert className="size-3.5" />Kiện không khai giá trị — cần chứng cứ về giá trị trước khi duyệt</p>}
      {item.flag === 'MATCHES_DECLARED' && item.matchedItem && (
        <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700"><TriangleAlert className="size-3.5" />Trùng món đã khai: {item.matchedItem.name} — giá trị khai {vnd(item.matchedItem.estValue)}</p>
      )}
    </>
  );
}

/**
 * Hạng mục thiệt hại của hồ sơ bồi thường: chọn từ "Đồ đang gửi" của hợp đồng (tự điền tên, giá trị đã khai — được nhập thấp hơn, số
 * lượng không quá số còn đòi được tại ngày sự cố), hoặc thêm đồ ngoài danh sách (có nhãn — chi nhánh xét kỹ, cần chứng cứ). Món nhập kho
 * sau ngày sự cố có nhãn riêng (server xét như đồ ngoài danh sách).
 */
export function ClaimItemsEditor({ items, onChange, inventory, ctx }: { items: ClaimItem[]; onChange: (items: ClaimItem[]) => void; inventory: InventoryItem[]; ctx?: ClaimItemsContext }) {
  const set = (i: number, patch: Partial<ClaimItem>) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const remaining = inventory.filter((x) => !items.some((it) => it.intakeItemId === x.itemId) && maxOf(x, ctx) > 0);
  const add = (itemId: string) => {
    const x = inventory.find((y) => y.itemId === itemId);
    if (x) onChange([...items, { name: x.name, quantity: 1, unitValue: x.estValue, intakeItemId: x.itemId, ...(x.sealed ? { packageState: null } : {}) }]);
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-stone-700">Hạng mục thiệt hại</p>
        <div className="flex flex-wrap items-center gap-2">
          {inventory.length > 0 && (
            <select className={`${inputCls} h-8 w-auto py-1 text-xs`} value="" disabled={remaining.length === 0} onChange={(e) => e.target.value && add(e.target.value)} aria-label="Chọn từ đồ đang gửi">
              <option value="">{remaining.length ? '+ Chọn từ đồ đang gửi…' : 'Không còn món nào để chọn'}</option>
              {remaining.map((x) => <option key={x.itemId} value={x.itemId}>{x.name} · còn đòi {maxOf(x, ctx)} · {vnd(x.estValue)}/cái · {x.batchCode}{afterIncident(x, ctx) ? ' · nhập sau ngày sự cố' : ''}</option>)}
            </select>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...items, { ...FREE_ITEM }])}><Plus className="size-3.5" />Đồ ngoài danh sách</Button>
        </div>
      </div>
      {items.length === 0 && <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-500">{inventory.length ? 'Chọn đồ bị hư hỏng / mất từ danh sách đồ đang gửi.' : 'Thêm đồ bị hư hỏng / mất.'}</p>}
      <div className="space-y-2">
        {items.map((it, i) => {
          const inv = it.intakeItemId ? inventory.find((x) => x.itemId === it.intakeItemId) : undefined;
          const max = inv ? maxOf(inv, ctx) : 999;
          const late = !!inv && afterIncident(inv, ctx);
          // Kiện gửi kín không khai giá trị: không có trần "giá trị khai" — khách nhập giá trị (cần chứng cứ).
          const capOf = inv && !(inv.sealed && inv.estValue === 0) ? inv.estValue : undefined;
          return (
            <div key={it.intakeItemId ?? `free-${i}`}>
              <div className="grid grid-cols-[1fr_72px_140px_32px] items-center gap-2">
                {inv ? (
                  <div className="flex min-w-0 items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm ring-1 ring-inset ring-stone-200">
                    <span className="truncate font-medium">{it.name}</span>{late ? <Badge tone="red">Nhập sau ngày sự cố</Badge> : <Badge tone="green">Trong danh sách</Badge>}
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <input className={inputCls} placeholder="Tên tài sản" value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Tên tài sản dòng ${i + 1}`} />
                    <Badge tone="amber">Ngoài danh sách</Badge>
                  </div>
                )}
                <input type="number" min={1} max={Math.max(1, max)} className={inputCls} value={it.quantity} aria-label={`Số lượng dòng ${i + 1}`}
                  onChange={(e) => set(i, { quantity: Math.min(Math.max(1, max), Math.max(1, Math.round(Number(e.target.value)) || 1)) })} />
                <input type="number" min={0} max={capOf} step={10_000} className={inputCls} placeholder="Giá trị / cái" value={it.unitValue} aria-label={`Giá trị dòng ${i + 1}`}
                  onChange={(e) => set(i, { unitValue: Math.min(capOf ?? Number.MAX_SAFE_INTEGER, Math.max(0, Number(e.target.value) || 0)) })} />
                <button type="button" aria-label="Xóa dòng" onClick={() => onChange(items.filter((_, k) => k !== i))}
                  className="grid size-8 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-600"><Trash2 className="size-4" /></button>
              </div>
              {inv?.sealed && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <select className={`${inputCls} h-8 w-auto py-1 text-xs`} value={it.packageState ?? ''} onChange={(e) => set(i, { packageState: (e.target.value || null) as SealedPackageState | null })} aria-label={`Tình trạng kiện dòng ${i + 1}`}>
                    <option value="">— Tình trạng kiện —</option>
                    <option value="MISSING">{SEALED_PACKAGE_STATE.MISSING}</option>
                    <option value="OUTER_DAMAGE">{SEALED_PACKAGE_STATE.OUTER_DAMAGE}</option>
                  </select>
                  <span className="text-[11px] text-violet-800">{SEALED_CLAIM_RULE}</span>
                </div>
              )}
              {inv ? (
                <p className={`mt-0.5 text-[11px] ${late ? 'text-red-700' : 'text-stone-500'}`}>
                  Đã nhập {inv.quantity} cái · còn đòi được {max} · khai {vnd(inv.estValue)}/cái · đợt {inv.batchCode}{late ? ' — món nhập kho sau ngày sự cố, xét như đồ ngoài danh sách (cần chứng cứ)' : ''}
                </p>
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
