'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CONTACT_WINDOW, ContactWindow, enumValues, isValidPhone, PHONE_MESSAGE, type RentalPeriod } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { Button, Field, Modal, inputCls } from '@/shared/ui';

export interface ConsultationContext {
  facilityId: string; facilityName: string;
  /** Loại kho khách đang xem / đã chọn — gửi kèm để chi nhánh chuẩn bị báo giá. */
  unitTypeIds: string[]; rentalPeriod: RentalPeriod; periods: number;
}

const NEEDS = [
  ['reviewContract', 'Pháp lý / kế toán bên tôi cần xem hợp đồng trước khi thanh toán'],
  ['vatInvoice', 'Cần xuất hoá đơn VAT cho công ty'],
  ['customContract', 'Cần hợp đồng / điều khoản riêng'],
  ['multipleUnits', 'Thuê nhiều kho hoặc kho cỡ lớn lâu dài'],
] as const;
type Needs = Record<(typeof NEEDS)[number][0], boolean>;

/**
 * Yêu cầu TƯ VẤN trước khi đặt — tạo phiếu "Tư vấn thuê kho" cho chi nhánh (POST /tickets/consultation); quản lý chi nhánh gọi lại
 * và trao đổi trong mục Hỗ trợ. Không giữ ô kho nào trong lúc chờ: tư vấn xong khách vẫn tự đặt và ký trên tài khoản của mình.
 */
export function ConsultationDialog({ ctx, onClose }: { ctx: ConsultationContext | null; onClose: () => void }) {
  const { user, run } = useStore();
  const [phone, setPhone] = useState<string | null>(null);
  const [contactWindow, setContactWindow] = useState<ContactWindow>('ANY');
  const [needs, setNeeds] = useState<Needs>({ reviewContract: true, vatInvoice: false, customContract: false, multipleUnits: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);

  const phoneValue = phone ?? user?.phone ?? '';
  const phoneError = phone !== null && !isValidPhone(phoneValue.trim()) ? PHONE_MESSAGE : undefined;
  const close = () => { setSentId(null); setNote(''); setPhone(null); onClose(); };

  const submit = async () => {
    if (!ctx) return;
    setBusy(true);
    const r = await run('requestConsultation', {
      facilityId: ctx.facilityId, unitTypeIds: ctx.unitTypeIds, rentalPeriod: ctx.rentalPeriod, periods: ctx.periods,
      phone: phoneValue.trim(), contactWindow, needs, note: note.trim() || undefined,
    });
    setBusy(false);
    if (r.ok) setSentId(r.value._id);
  };

  const loggedOut = !user;
  const notCustomer = !!user && user.role !== 'CUSTOMER';

  return (
    <Modal
      open={!!ctx}
      onClose={close}
      title="Cần tư vấn trước khi đặt?"
      description={ctx ? `${ctx.facilityName} sẽ gọi lại theo khung giờ bạn chọn. Không giữ kho trong lúc chờ.` : undefined}
      footer={sentId ? <Button onClick={close}>Đóng</Button> : loggedOut || notCustomer ? <Button variant="secondary" onClick={close}>Đóng</Button> : <>
        <Button variant="secondary" onClick={close}>Huỷ</Button>
        <Button disabled={busy || !isValidPhone(phoneValue.trim())} onClick={() => void submit()}>Gửi yêu cầu tư vấn</Button>
      </>}
    >
      {sentId ? (
        <div className="space-y-2 text-sm text-stone-700">
          <p className="font-medium text-emerald-700">Đã gửi yêu cầu tư vấn.</p>
          <p>Chi nhánh sẽ liên hệ số {phoneValue.trim()} ({CONTACT_WINDOW[contactWindow].toLowerCase()}). Bạn theo dõi và nhắn thêm trong mục Hỗ trợ.</p>
          <Link href={`/portal/tickets?open=${sentId}`} className="inline-block font-medium text-brand-700 hover:underline">Mở yêu cầu trong mục Hỗ trợ</Link>
        </div>
      ) : loggedOut ? (
        <p className="text-sm text-stone-700">
          Đăng nhập (hoặc tạo tài khoản) để gửi yêu cầu — chi nhánh trả lời ngay trong tài khoản của bạn.{' '}
          <Link href={`/login?next=${encodeURIComponent(`/facilities/${ctx?.facilityId ?? ''}`)}`} className="font-medium text-brand-700 hover:underline">Đăng nhập</Link>
          <span className="mt-2 block text-xs text-stone-500">Hoặc gọi thẳng hotline chi nhánh ở đầu trang.</span>
        </p>
      ) : notCustomer ? (
        <p className="text-sm text-stone-700">Yêu cầu tư vấn dành cho tài khoản khách hàng.</p>
      ) : (
        <div className="grid gap-4">
          <Field label="Số điện thoại liên hệ" error={phoneError}>
            <input className={inputCls} inputMode="tel" autoComplete="tel" value={phoneValue} onChange={(e) => setPhone(e.target.value)} placeholder="0901 234 567" />
          </Field>
          <Field label="Gọi lại vào">
            <select className={inputCls} value={contactWindow} onChange={(e) => setContactWindow(e.target.value as ContactWindow)}>
              {enumValues(ContactWindow).map((w) => <option key={w} value={w}>{CONTACT_WINDOW[w]}</option>)}
            </select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-stone-700">Bạn cần tư vấn về</legend>
            {NEEDS.map(([k, label]) => (
              <label key={k} className="flex cursor-pointer gap-2.5 text-sm text-stone-700">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={needs[k]} onChange={(e) => setNeeds({ ...needs, [k]: e.target.checked })} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Ghi chú (tuỳ chọn)">
            <textarea className={inputCls} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD tên công ty, mã số thuế, thời gian muốn bắt đầu thuê…" />
          </Field>
        </div>
      )}
    </Modal>
  );
}
