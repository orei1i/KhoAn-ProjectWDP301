'use client';

import { useState } from 'react';
import { CANCEL_NOTE_MAX, CANCEL_NOTE_MIN, CANCEL_REASONS_BY_ROLE, CANCELLATION_REASON, type CancellationReason, type Reservation } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { vnd } from '@/shared/lib/format';
import { Button, Field, Modal, inputCls } from '@/shared/ui';

/**
 * Nhân sự huỷ đặt chỗ thay khách: chọn lý do theo vai trò (CANCEL_REASONS_BY_ROLE, như server) + ghi chú bắt buộc — server lưu vào
 * đặt chỗ, nhật ký và email báo khách kèm số tiền hoàn. `defaultReason`: lý do chọn sẵn nếu vai trò được phép.
 */
export function CancelReservationDialog({ reservation, defaultReason, onClose }: { reservation: Reservation | null; defaultReason?: CancellationReason; onClose: () => void }) {
  return reservation ? <Inner key={reservation._id} r={reservation} defaultReason={defaultReason} onClose={onClose} /> : null;
}

function Inner({ r, defaultReason, onClose }: { r: Reservation; defaultReason?: CancellationReason; onClose: () => void }) {
  const { user, run, busy } = useStore();
  const reasons = user ? CANCEL_REASONS_BY_ROLE[user.role] : [];
  const [reason, setReason] = useState<CancellationReason | ''>(defaultReason && reasons.includes(defaultReason) ? defaultReason : reasons.length === 1 ? reasons[0] : '');
  const [note, setNote] = useState('');
  const noteOk = note.trim().length >= CANCEL_NOTE_MIN && note.trim().length <= CANCEL_NOTE_MAX;
  const save = () => {
    if (!reason || !noteOk) return;
    void run('cancelReservation', { reservationId: r._id, reason, note: note.trim() }, (v) => `Đã huỷ ${r.code} — hoàn khách ${vnd(v)}`, onClose);
  };

  return (
    <Modal open onClose={onClose} title="Huỷ đặt chỗ" description={`${r.code} · khách được email báo lý do và số tiền hoàn`}
      footer={<><Button variant="secondary" onClick={onClose}>Đóng</Button><Button variant="danger" disabled={busy || !reason || !noteOk} onClick={save}>Xác nhận huỷ</Button></>}>
      <div className="space-y-3 text-sm">
        <Field label="Lý do">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value as CancellationReason | '')}>
            {reasons.length > 1 && <option value="">— Chọn lý do —</option>}
            {reasons.map((x) => <option key={x} value={x}>{CANCELLATION_REASON[x]}{x === 'FACILITY_UNAVAILABLE' ? ' — hoàn 100%' : ''}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú gửi khách (bắt buộc)" error={note && !noteOk ? `Từ ${CANCEL_NOTE_MIN} đến ${CANCEL_NOTE_MAX} ký tự` : undefined}>
          <textarea className={inputCls} rows={3} maxLength={CANCEL_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Khách gọi điện xin huỷ do đổi kế hoạch" />
        </Field>
      </div>
    </Modal>
  );
}
