'use client';

import { useState } from 'react';
import {
  ID_LAST4_MESSAGE, ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, PERSON_NAME_MESSAGE, PROFILE_PHONE_MESSAGE, identityLocked, isValidPersonName, isValidProfilePhone,
  type IdType,
} from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { Button, Field, Modal, inputCls } from '@/shared/ui';

type Form = { fullName: string; phone: string; idType: IdType; idNumberLast4: string; bankName: string; accountNumber: string; accountName: string };

/**
 * Thông tin nhận diện in vào hợp đồng / phụ lục (PATCH /auth/me): họ tên, số điện thoại và — với khách — loại giấy tờ tùy thân +
 * 4 số cuối (không bao giờ hỏi số đầy đủ), cùng tài khoản nhận tiền hoàn. Khách đang có hợp đồng thì họ tên + giấy tờ bị khoá (đổi tại
 * quầy, nhân viên đối chiếu bản gốc); số điện thoại và tài khoản nhận tiền vẫn tự sửa được.
 */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, db, run } = useStore();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const customer = user.role === 'CUSTOMER';
  const acc = user.customerProfile?.payoutAccount;
  // Khoá khi đã có giá trị hợp lệ và đang có hợp đồng — khai lần đầu / sửa tên chưa hợp lệ thì vẫn cho (khớp quy tắc ở BE).
  const live = customer && identityLocked(user._id, db.reservations, db.contracts);
  const nameLocked = live && isValidPersonName(user.fullName);
  const idLocked = live && !!user.customerProfile?.idNumberLast4;

  const f: Form = form ?? {
    fullName: isValidPersonName(user.fullName) ? user.fullName : '', phone: user.phone ?? '',
    idType: user.customerProfile?.idType ?? 'CCCD', idNumberLast4: user.customerProfile?.idNumberLast4 ?? '',
    bankName: acc?.bankName ?? '', accountNumber: acc?.accountNumber ?? '', accountName: acc?.accountName ?? '',
  };
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const accFilled = !!(f.bankName.trim() || f.accountNumber.trim() || f.accountName.trim());
  const accValid = !accFilled || (f.bankName.trim().length >= 2 && /^\d{6,20}$/.test(f.accountNumber.trim()) && f.accountName.trim().length >= 2);
  const errors = {
    fullName: form && !isValidPersonName(f.fullName) ? PERSON_NAME_MESSAGE : undefined,
    phone: form && f.phone.trim() && !isValidProfilePhone(f.phone) ? PROFILE_PHONE_MESSAGE : undefined,
    idNumberLast4: form && f.idNumberLast4.trim() && !ID_LAST4_RE.test(f.idNumberLast4.trim()) ? ID_LAST4_MESSAGE : undefined,
    account: form && !accValid ? 'Nhập đủ tên ngân hàng, số tài khoản (6–20 chữ số) và tên chủ tài khoản — hoặc để trống cả ba' : undefined,
  };
  const valid = isValidPersonName(f.fullName) && accValid
    && (customer ? isValidProfilePhone(f.phone) && ID_LAST4_RE.test(f.idNumberLast4.trim()) : !f.phone.trim() || isValidProfilePhone(f.phone));

  const close = () => { setForm(null); onClose(); };
  const save = async () => {
    setBusy(true);
    const r = await run('updateMyProfile', {
      ...(nameLocked ? {} : { fullName: f.fullName }),
      ...(f.phone.trim() ? { phone: f.phone } : {}),
      ...(customer && !idLocked ? { idType: f.idType, idNumberLast4: f.idNumberLast4.trim() } : {}),
      ...(customer ? { payoutAccount: accFilled ? { bankName: f.bankName.trim(), accountNumber: f.accountNumber.trim(), accountName: f.accountName.trim() } : null } : {}),
    }, 'Đã cập nhật thông tin cá nhân');
    setBusy(false);
    if (r.ok) close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Thông tin cá nhân"
      description={customer
        ? 'In vào hợp đồng bạn ký. Nhân viên đối chiếu giấy tờ bản gốc khi bàn giao kho.'
        : 'Họ tên và số điện thoại liên hệ của bạn.'}
      footer={<>
        <Button variant="secondary" onClick={close}>Huỷ</Button>
        <Button disabled={busy || !valid} onClick={() => void save()}>Lưu thông tin</Button>
      </>}
    >
      <div className="grid gap-4">
        {(nameLocked || idLocked) && (
          <p className="rounded-lg bg-stone-50 p-3 text-xs leading-relaxed text-stone-600 ring-1 ring-inset ring-stone-200">
            Bạn đang có hợp đồng nên họ tên và giấy tờ không tự sửa được — mang giấy tờ bản gốc tới quầy chi nhánh để nhân viên cập nhật.
          </p>
        )}
        <Field label="Họ và tên (đúng như trên giấy tờ)" error={errors.fullName} hint="VD Nguyễn Minh Anh">
          <input className={inputCls} value={f.fullName} disabled={nameLocked} autoComplete="name" maxLength={100} onChange={(e) => set({ fullName: e.target.value })} />
        </Field>
        <Field label="Số điện thoại" error={errors.phone}>
          <input className={inputCls} value={f.phone} inputMode="tel" autoComplete="tel" maxLength={30} placeholder="0901 234 567" onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        {customer && (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Loại giấy tờ tùy thân">
                <select className={inputCls} value={f.idType} disabled={idLocked} onChange={(e) => set({ idType: e.target.value as IdType })}>
                  {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field label="4 số cuối" error={errors.idNumberLast4}>
                <input className={`${inputCls} font-mono uppercase`} value={f.idNumberLast4} disabled={idLocked} maxLength={4} placeholder="4821" onChange={(e) => set({ idNumberLast4: e.target.value })} />
              </Field>
            </div>
            <fieldset className="space-y-3 border-t border-stone-100 pt-4">
              <legend className="text-sm font-semibold">Tài khoản nhận tiền hoàn <span className="font-normal text-stone-500">(tuỳ chọn)</span></legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ngân hàng"><input className={inputCls} value={f.bankName} maxLength={80} placeholder="Vietcombank" onChange={(e) => set({ bankName: e.target.value })} /></Field>
                <Field label="Số tài khoản"><input className={`${inputCls} font-mono`} value={f.accountNumber} inputMode="numeric" maxLength={20} onChange={(e) => set({ accountNumber: e.target.value })} /></Field>
              </div>
              <Field label="Chủ tài khoản" error={errors.account}><input className={`${inputCls} uppercase`} value={f.accountName} maxLength={100} placeholder="NGUYEN MINH ANH" onChange={(e) => set({ accountName: e.target.value })} /></Field>
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  );
}
