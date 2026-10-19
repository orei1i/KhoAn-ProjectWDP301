'use client';

import { useState } from 'react';
import { FileSignature } from 'lucide-react';
import type { Reservation, SignatureMethod } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { userName } from '@/shared/lib/domain';
import { Button, Field, cx, inputCls } from '@/shared/ui';
import { ContractDocument } from './contract-document';
import { SignaturePad } from './signature-pad';

/**
 * Bước ký hợp đồng (sau khi trả tiền giữ chân, trước khi nhận kho). CHỈ khách ký, trên tài khoản của chính họ —
 * server từ chối nhân viên/quản lý, nên màn nhận kho của nhân viên không có form này.
 */
export function ContractSignForm({ reservation: r }: { reservation: Reservation }) {
  const { db, run } = useStore();
  const [method, setMethod] = useState<SignatureMethod>('DRAWN');
  const [name, setName] = useState(() => userName(db, r.customerId).replace('—', ''));
  const [image, setImage] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const valid = name.trim().length >= 2 && agree && (method === 'TYPED' || !!image);

  return (
    <div className="space-y-4">
      <ContractDocument reservation={r} />

      <div className="flex gap-1 rounded-lg bg-stone-100 p-1 text-sm">
        {([['DRAWN', 'Ký tay'], ['TYPED', 'Gõ họ tên']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMethod(k)} className={cx('flex-1 rounded-md px-3 py-1.5 font-medium', method === k ? 'bg-white shadow-sm' : 'text-stone-500 hover:text-stone-900')}>{label}</button>
        ))}
      </div>

      {method === 'DRAWN' && <SignaturePad onChange={setImage} />}
      <Field label={method === 'DRAWN' ? 'Họ tên người ký' : 'Gõ đầy đủ họ tên để ký'} hint={method === 'TYPED' ? 'Họ tên gõ vào có giá trị như chữ ký xác nhận hợp đồng.' : undefined}>
        <input className={cx(inputCls, method === 'TYPED' && 'font-serif text-lg italic')} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <label className="flex cursor-pointer gap-2.5 text-sm leading-relaxed text-stone-700">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>Tôi đã đọc và đồng ý toàn bộ nội dung hợp đồng trên.</span>
      </label>

      <Button className="w-full" disabled={!valid}
        onClick={() => void run('signContract', { reservationId: r._id, signerName: name.trim(), method, image: method === 'DRAWN' ? image : null }, 'Đã ký hợp đồng')}>
        <FileSignature className="size-4" />Ký & xác nhận hợp đồng
      </Button>
    </div>
  );
}
