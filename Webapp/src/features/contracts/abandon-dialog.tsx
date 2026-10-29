'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AbandonedItemsDisposal, RentalContract } from '@ssm/shared';
import { addDays, CLAIM_FM_APPROVAL_LIMIT } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { DISPOSAL_METHOD } from '@/shared/lib/labels';
import { unitLabel, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Button, Disclosure, Field, KV, Modal, inputCls } from '@/shared/ui';
import { GoodsReference } from '@/features/intake/contract-goods';

type AbandonItem = { description: string; quantity: number };
const HTTPS_RE = /^https:\/\/\S+$/;
const urlsOf = (s: string) => s.split(/[\s,]+/).filter(Boolean);

/** Thông báo cuối của đợt khoá hiện tại (gửi từ lúc `finalNoticeAt`). */
export const finalNoticeOf = (x: RentalContract) => {
  const at = x.delinquency?.finalNoticeAt;
  return at ? [...(x.notices ?? [])].reverse().find((k) => k.kind === 'FINAL_NOTICE' && k.at >= at) : undefined;
};
/** Thông báo cuối ĐÃ TỚI khách: email gửi được, hoặc quản lý ghi nhận đã báo bằng kênh khác — điều kiện xử lý đồ bỏ lại. */
export const noticeDelivered = (x: RentalContract) => { const n = finalNoticeOf(x); return !!n && (n.email.status === 'SENT' || !!n.manualDelivery); };
/** Ngày được xử lý đồ bỏ lại — đúng hạn ghi trong thông báo khách đã nhận; bản cũ không lưu hạn thì tính theo chính sách đã ký. */
export const abandonFrom = (x: RentalContract, abandonDays: number) => {
  const at = x.delinquency?.finalNoticeAt;
  return at ? (finalNoticeOf(x)?.deadline ?? addDays(at, abandonDays)).slice(0, 10) : null;
};

/**
 * Xử lý hàng bỏ lại (hợp đồng bị khoá, đã quá hạn chót của thông báo cuối): kiểm kê + ảnh, phương án xử lý, quyết toán.
 * Tiền thanh lý / chi phí trên ngưỡng duyệt của chi nhánh → chỉ Vận hành xử lý.
 */
export function AbandonDialog({ contract, onClose }: { contract: RentalContract | null; onClose: () => void }) {
  const { db, user, run } = useStore();
  const [id, setId] = useState<string | null>(null);
  const [items, setItems] = useState<AbandonItem[]>([]);
  const [disposalMethod, setDisposalMethod] = useState<AbandonedItemsDisposal>('DISCARD');
  const [notes, setNotes] = useState('');
  const [money, setMoney] = useState({ proceeds: 0, costs: 0 });
  const [photos, setPhotos] = useState('');
  // Mở cho hợp đồng khác → làm mới biểu mẫu.
  if ((contract?._id ?? null) !== id) {
    setId(contract?._id ?? null); setItems([{ description: '', quantity: 1 }]); setDisposalMethod('DISCARD'); setNotes(''); setMoney({ proceeds: 0, costs: 0 }); setPhotos('');
  }
  if (!contract) return null;
  const x = contract;

  const urls = urlsOf(photos);
  const photosOk = urls.length > 0 && urls.every((u) => HTTPS_RE.test(u));
  const overLimit = user?.role === 'FACILITY_MANAGER' && (money.proceeds > CLAIM_FM_APPROVAL_LIMIT || money.costs > CLAIM_FM_APPROVAL_LIMIT);
  // Xem trước quyết toán — cùng công thức với server: tiền giữ chân rồi tiền thanh lý trừ công nợ + chi phí.
  const owed = x.balance.outstanding + money.costs;
  const depositApplied = Math.min(x.deposit.amount, owed);
  const proceedsApplied = Math.min(money.proceeds, owed - depositApplied);
  const refund = x.deposit.amount - depositApplied + money.proceeds - proceedsApplied;
  const shortfall = owed - depositApplied - proceedsApplied;

  return (
    <Modal open onClose={onClose} size="lg"
      title="Xử lý hàng bỏ lại" description={`${userName(db, x.customerId)} · kho ${unitLabel(db, x.unitId)} · thông báo cuối ${fmtDate(x.delinquency?.finalNoticeAt)}`}
      footer={
        <Button variant="danger" disabled={items.length === 0 || items.some((it) => !it.description.trim()) || !photosOk || overLimit}
          onClick={() => void run('processAbandonment', { contractId: x._id, items, disposalMethod, notes, proceeds: money.proceeds, costs: money.costs, photoUrls: urls },
            'Đã xử lý hàng bỏ lại — hợp đồng đóng, ô kho đã giải phóng', () => onClose())}>
          Xác nhận xử lý
        </Button>
      }>
      <div className="space-y-4">
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
          Xác nhận sẽ quyết toán, đóng hợp đồng và giải phóng ô kho — không thể hoàn tác.
        </div>

        <Disclosure title="Đồ khách đã khai khi nhập kho — đối chiếu khi kiểm kê" defaultOpen>
          <GoodsReference contractId={x._id} onFill={(list) => setItems(list)} />
          <p className="mt-2 text-xs text-stone-500">Xác nhận xử lý: các món còn đang gửi được ghi “Đã thanh lý”.</p>
        </Disclosure>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Danh sách vật dụng</h4>
            <Button size="sm" variant="secondary" onClick={() => setItems((arr) => [...arr, { description: '', quantity: 1 }])}><Plus className="size-3.5" />Thêm</Button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_100px_auto]">
                <input className={inputCls} placeholder="Mô tả vật dụng" value={it.description}
                  onChange={(e) => setItems((arr) => arr.map((v, j) => (j === i ? { ...v, description: e.target.value } : v)))} />
                <input className={inputCls} type="number" min={1} step={1} placeholder="SL" value={it.quantity}
                  onChange={(e) => setItems((arr) => arr.map((v, j) => (j === i ? { ...v, quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) } : v)))} />
                <Button variant="ghost" size="sm" onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))} aria-label="Xóa"><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
        </div>

        <Field label="Ảnh kiểm kê (https, cách nhau dấu phẩy)" error={photos.trim() && !photosOk ? 'Link ảnh phải bắt đầu bằng https://' : undefined}>
          <input className={inputCls} value={photos} onChange={(e) => setPhotos(e.target.value)} placeholder="https://…, https://…" />
        </Field>

        <Field label="Phương án xử lý">
          <select className={inputCls} value={disposalMethod} onChange={(e) => setDisposalMethod(e.target.value as AbandonedItemsDisposal)}>
            {(Object.keys(DISPOSAL_METHOD) as AbandonedItemsDisposal[]).map((k) => <option key={k} value={k}>{DISPOSAL_METHOD[k]}</option>)}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tiền thu được khi thanh lý (VND)" hint="0 nếu quyên tặng / tiêu huỷ">
            <input type="number" min={0} step={10_000} className={inputCls} value={money.proceeds}
              onChange={(e) => setMoney((m) => ({ ...m, proceeds: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
          </Field>
          <Field label="Chi phí kiểm kê, vận chuyển, thanh lý (VND)">
            <input type="number" min={0} step={10_000} className={inputCls} value={money.costs}
              onChange={(e) => setMoney((m) => ({ ...m, costs: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
          </Field>
        </div>

        {overLimit && <p className="text-xs font-medium text-red-700">Trên {vnd(CLAIM_FM_APPROVAL_LIMIT)} — cần Vận hành xử lý (Duyệt & chi).</p>}

        <KV items={[
          ['Công nợ + chi phí', vnd(owed)], ['Trừ vào tiền giữ chân', `${vnd(depositApplied)} / ${vnd(x.deposit.amount)}`],
          ['Trả lại khách', vnd(refund)], ['Khách còn nợ', shortfall > 0 ? vnd(shortfall) : 'Không'],
        ]} />

        <Field label="Ghi chú" hint="Không bắt buộc">
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
