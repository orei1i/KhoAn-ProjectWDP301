'use client';

import { useState } from 'react';
import { ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, isValidPersonName, PERSON_NAME_MESSAGE, type IdType, type User } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { Button, Field, Modal, inputCls } from '@/shared/ui';

/**
 * Nhân viên / quản lý sửa HỌ TÊN, GIẤY TỜ của khách tại quầy sau khi đối chiếu giấy tờ bản gốc (khách đang có hợp đồng thì không tự
 * sửa được — VD đổi CCCD mới, tên sai chính tả). Bắt buộc ghi lý do; hợp đồng đã ký giữ nguyên văn.
 */
export function CustomerIdentityDialog({ target, customer, onClose }: {
  target: { kind: 'reservations' | 'contracts'; id: string } | null; customer: User | null; onClose: () => void;
}) {
  const { run } = useStore();
  const [form, setForm] = useState<{ fullName: string; idType: IdType; idNumberLast4: string; reason: string } | null>(null);
  if (!target || !customer) return null;
  const f = form ?? { fullName: customer.fullName, idType: customer.customerProfile?.idType ?? 'CCCD', idNumberLast4: customer.customerProfile?.idNumberLast4 ?? '', reason: '' };
  const set = (p: Partial<typeof f>) => setForm({ ...f, ...p });
  const valid = isValidPersonName(f.fullName) && ID_LAST4_RE.test(f.idNumberLast4.trim()) && f.reason.trim().length >= 5;
  const close = () => { setForm(null); onClose(); };
  const save = async () => {
    const r = await run('updateCustomerIdentity', { kind: target.kind, id: target.id, fullName: f.fullName, idType: f.idType, idNumberLast4: f.idNumberLast4.trim(), reason: f.reason.trim() }, 'Đã cập nhật họ tên / giấy tờ của khách');
    if (r.ok) close();
  };

  return (
    <Modal open onClose={close} title="Sửa họ tên / giấy tờ của khách" description="Chỉ sửa theo giấy tờ BẢN GỐC khách xuất trình tại quầy. Hợp đồng đã ký giữ nguyên văn; thông tin mới dùng cho văn bản về sau."
      footer={<><Button variant="secondary" onClick={close}>Huỷ</Button><Button disabled={!valid} onClick={() => void save()}>Lưu</Button></>}>
      <div className="grid gap-4">
        <Field label="Họ và tên" error={form && !isValidPersonName(f.fullName) ? PERSON_NAME_MESSAGE : undefined}>
          <input className={inputCls} value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="Loại giấy tờ">
            <select className={inputCls} value={f.idType} onChange={(e) => set({ idType: e.target.value as IdType })}>
              {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="4 số cuối"><input className={`${inputCls} font-mono uppercase`} maxLength={4} value={f.idNumberLast4} onChange={(e) => set({ idNumberLast4: e.target.value })} /></Field>
        </div>
        <Field label="Lý do (ghi nhật ký)" hint="Tối thiểu 5 ký tự — VD khách đổi sang CCCD gắn chip, đã đối chiếu bản gốc">
          <textarea className={inputCls} rows={2} value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
