'use client';

import { useState } from 'react';
import type { Reservation } from '@ssm/shared';
import { lastDayOf, rescheduleChangesLeft, rescheduleCheck, rescheduledEndDate, rescheduleWindow } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { fmtDate } from '@/shared/lib/format';
import { Button, Field, Modal, inputCls } from '@/shared/ui';

/** Còn ngày nào đổi được không (trạng thái, số lần đổi, cửa sổ ngày) — không thì ẩn nút. Cùng quy tắc với server (shared). */
export function canReschedule(r: Reservation): boolean {
  const w = rescheduleWindow(r);
  return rescheduleCheck(r, w.min).ok || rescheduleCheck(r, w.max).ok;
}

/** Khách đổi ngày nhận kho: chọn ngày trong cửa sổ cho phép, xem ngày kết thúc mới. Số kỳ, giá giữ nguyên. */
export function RescheduleDialog({ reservation, onClose }: { reservation: Reservation | null; onClose: () => void }) {
  return reservation ? <Inner key={reservation._id} r={reservation} onClose={onClose} /> : null;
}

function Inner({ r, onClose }: { r: Reservation; onClose: () => void }) {
  const { run, busy } = useStore();
  const [date, setDate] = useState('');
  const w = rescheduleWindow(r);
  const check = date ? rescheduleCheck(r, date) : null;
  const save = () => void run('rescheduleReservation', { reservationId: r._id, startDate: date }, (v) => `Đã đổi ngày nhận kho sang ${fmtDate(v.startDate)}`, onClose);

  return (
    <Modal open onClose={onClose} title="Đổi ngày nhận kho" description={`${r.code} · còn đổi được ${rescheduleChangesLeft(r)} lần`}
      footer={<><Button variant="secondary" onClick={onClose}>Đóng</Button><Button disabled={busy || !check?.ok} onClick={save}>Xác nhận đổi</Button></>}>
      <div className="space-y-3 text-sm">
        <Field label={`Ngày nhận mới (hiện tại ${fmtDate(r.startDate)})`} error={check && !check.ok ? check.message : undefined}>
          <input type="date" className={inputCls} min={w.min.slice(0, 10)} max={w.max.slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {check?.ok && <p>Kết thúc: hết ngày <b>{fmtDate(lastDayOf(rescheduledEndDate(r, date)))}</b></p>}
        {r.signature && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-inset ring-amber-200">Đổi ngày thì phải ký lại hợp đồng.</p>}
      </div>
    </Modal>
  );
}
