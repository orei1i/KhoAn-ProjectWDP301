'use client';

import { KeyRound, RectangleEllipsis, UserRound } from 'lucide-react';
import type { AccessMethod, StorageUnit } from '@ssm/shared';
import { ACCESS_METHOD } from '@/shared/lib/labels';
import { useStore } from '@/shared/store/store';
import { fmtDate } from '@/shared/lib/format';
import { userName } from '@/shared/lib/domain';
import { Button, Card, Field, Modal, inputCls } from '@/shared/ui';
import { Callout, CheckLine, Meta, PanelHeader, QueueRow, UnitTag } from '@/features/staff-ui';

/** Việc với ô cũ khi khách chuyển đi: thu chìa / thẻ cũ, hoặc đặt lại ổ khoá mật khẩu. */
export const accessResetLabel = (method: AccessMethod, keyTag?: string | null) =>
  method === 'PIN' ? 'Đã đặt lại ổ khoá mật khẩu của ô cũ' : `Đã thu ${method === 'RFID_CARD' ? 'thẻ' : 'chìa'} cũ${keyTag ? ` ${keyTag}` : ''} của khách`;

/** Đợt 17 (A1): câu việc còn thiếu khi khách rời ô (đổi ô, trả kho, hàng bỏ lại) — cùng lời với `accessResetTask` server trả về. */
export const accessResetTaskText = (method: AccessMethod, keyTag?: string | null) =>
  method === 'PIN' ? 'đặt lại ổ khoá mật khẩu' : `thu ${method === 'RFID_CARD' ? 'thẻ' : 'chìa'} cũ${keyTag ? ` ${keyTag}` : ''}`;
/** Đợt 17 (A1): câu tick / nút ghi nhận khi khách trả kho hoặc bỏ hàng (không nói "ô cũ" như lúc đổi ô). */
export const accessResetDoneText = (method: AccessMethod, keyTag?: string | null) =>
  method === 'PIN' ? 'Đã đặt lại ổ khoá mật khẩu' : `Đã thu ${method === 'RFID_CARD' ? 'thẻ' : 'chìa'}${keyTag ? ` ${keyTag}` : ''} của khách`;

/** Đợt 17 (A1): tick "đã thu chìa / thẻ hoặc đặt lại khoá" ở các màn khách rời ô; không tick thì ô chờ ghi nhận, chưa mở cho thuê lại. */
export function AccessResetCheck({ method, keyTag, checked, onChange }: { method: AccessMethod; keyTag?: string | null; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <CheckLine checked={checked} onChange={onChange}>
      {accessResetDoneText(method, keyTag)} <span className="text-stone-500">(không tick thì ghi nhận sau — ô chưa mở cho thuê lại được)</span>
    </CheckLine>
  );
}

/**
 * Popup nhắc nhân viên nhận lại chìa / thẻ (hoặc đặt lại ổ khoá mật khẩu) ngay ở bước khách rời ô — hiện khi bấm hoàn tất mà chưa tick.
 * "Đã thu" = tick rồi làm tiếp; "Để sau" = làm tiếp, ô vào mục "Ô chờ thu chìa / thẻ" (trang Cấp lại thẻ / chìa) và chưa mở cho thuê lại.
 */
export function AccessResetReminder({ open, method, keyTag, unit, customer, onCollected, onLater, onClose }: {
  open: boolean; method?: AccessMethod | null; keyTag?: string | null; unit: string; customer?: string;
  onCollected: () => void; onLater: () => void; onClose: () => void;
}) {
  if (!method) return null;
  const thing = method === 'RFID_CARD' ? 'thẻ' : 'chìa';
  return (
    <Modal open={open} onClose={onClose} stacked title={method === 'PIN' ? 'Nhắc đặt lại ổ khoá' : `Nhắc nhận lại ${thing}`}
      footer={<>
        <Button variant="secondary" onClick={onLater}>Để sau</Button>
        <Button onClick={onCollected}><KeyRound className="size-4" />{method === 'PIN' ? 'Đã đặt lại ổ khoá' : `Đã nhận ${thing}`}</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-base text-ink">
          {method === 'PIN'
            ? <>Ô <b>{unit}</b> khoá mật khẩu: đặt lại ổ khoá (đổi mật khẩu) trước khi cho thuê lại.</>
            : <>{customer ? <>Khách <b>{customer}</b></> : 'Khách'} đang giữ {thing}{keyTag ? <> <b>{keyTag}</b></> : ''} của ô <b>{unit}</b>. Nhận lại {thing} trước khi khách về.</>}
        </p>
        <p className="text-stone-500">Bấm “Để sau” nếu chưa nhận được: ô chưa cho thuê lại và nằm ở mục Ô chờ thu chìa / thẻ (trang Cấp lại thẻ / chìa, mở hộ).</p>
      </div>
    </Modal>
  );
}

/** Ô đang chờ thu chìa / thẻ hoặc đặt lại khoá (chưa ghi nhận) — dùng cho mục riêng và số đếm ở trang chủ nhân viên. */
export const isAccessResetPending = (u: StorageUnit) => !!u.accessReset && !u.accessReset.doneAt;

/**
 * Đợt 17 (A1): mục riêng ở trang Cấp lại thẻ / chìa — các ô khách đã rời mà chưa thu chìa / thẻ hoặc chưa đặt lại khoá, và các ô đã ghi nhận xong
 * đang chờ mở cho thuê (ô đã nhả hợp đồng, người dùng chủ động mở như đường đổi ô). Ghi nguồn: trả kho hay đổi ô. Không có việc thì không hiện gì.
 */
export function AccessResetQueue({ facilityIds, className }: { facilityIds: string[]; className?: string }) {
  const { db, run, busy } = useStore();
  const rows = db.units.filter((u) => facilityIds.includes(u.facilityId) && !u.isDeleted
    && (isAccessResetPending(u) || (u.status === 'PENDING_INSPECTION' && !u.currentContractId && !u.leftoverHeldUntil)))
    .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber));
  if (rows.length === 0) return null;
  return (
    <Card className={className}>
      <PanelHeader icon={<KeyRound className="size-4" />} tone="violet" title="Ô chờ thu chìa / thẻ, đặt lại khoá" count={rows.length} tip="Khách đã rời ô. Ô chỉ cho thuê lại sau khi ghi nhận đã thu chìa / thẻ hoặc đã đặt lại ổ khoá." />
      <ul className="divide-y divide-stone-100">
        {rows.map((u) => {
          const r = u.accessReset;
          const pending = !!r && !r.doneAt;
          const contract = r ? db.contracts.find((c) => c._id === r.contractId) : undefined;
          return (
            <QueueRow key={u._id}
              lead={<UnitTag label={u.unitNumber} tone="violet" size="sm" />}
              title={pending && r ? `Chưa ${accessResetTaskText(r.method, r.keyTag)}` : 'Đã ghi nhận — chờ mở cho thuê'}
              meta={<>
                {contract && <Meta>{contract.unitId === u._id ? 'Trả kho' : 'Đổi ô — ô cũ'}</Meta>}
                {r?.contractNumber && <Meta mono>HĐ {r.contractNumber}</Meta>}
                {contract && <Meta icon={<UserRound />}>{userName(db, contract.customerId)}</Meta>}
                {r && <Meta>Từ {fmtDate(r.requiredAt)}</Meta>}
              </>}
              actions={pending && r
                ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run('recordUnitAccessReset', { unitId: u._id }, 'Đã ghi nhận — ô mở cho thuê lại được')}><KeyRound className="size-3.5" />{accessResetDoneText(r.method, r.keyTag)}</Button>
                : <Button size="sm" disabled={busy} onClick={() => void run('setUnitStatus', { unitId: u._id, to: 'AVAILABLE', reason: 'Kiểm tra đạt, đã thu chìa / thẻ hoặc đặt lại khoá' }, `Ô ${u.unitNumber} đã sẵn sàng cho thuê`)}>Mở cho thuê</Button>}
            />
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Đợt 16 (B1): đổi ô (cùng loại hay đổi cỡ, tại quầy hay theo yêu cầu) làm như nhận kho cho ô mới — ô mật khẩu: hệ thống cấp mật khẩu MỚI;
 * ô chìa / thẻ: BẮT BUỘC nhập mã chìa / số thẻ mới vừa giao. Ô cũ chỉ mở cho thuê lại sau khi ghi nhận thu chìa / thẻ cũ hoặc đặt lại ổ khoá —
 * tick ngay ở đây, hoặc ghi nhận sau ở trang Kho.
 */
export function NewAccessFields({ oldMethod, oldKeyTag, newMethod, keyTag, onKeyTag, oldReset, onOldReset, showError }: {
  oldMethod?: AccessMethod; oldKeyTag?: string | null; newMethod?: AccessMethod; keyTag: string; onKeyTag: (v: string) => void;
  oldReset: boolean; onOldReset: (v: boolean) => void; showError?: boolean;
}) {
  if (!newMethod) return null;
  return (
    <div className="space-y-3">
      {newMethod === 'PIN' ? (
        <Callout tone="teal" icon={<RectangleEllipsis />}>Ô mới khoá mật khẩu — hệ thống cấp <b>mật khẩu mới</b> khi xác nhận; khách xem trong tài khoản (như lúc nhận kho).</Callout>
      ) : (
        <Field label={newMethod === 'RFID_CARD' ? 'Số thẻ MỚI giao cho khách (bắt buộc)' : 'Mã chìa MỚI giao cho khách (bắt buộc)'}
          error={showError && !keyTag.trim() ? `Nhập ${newMethod === 'RFID_CARD' ? 'số thẻ' : 'mã chìa'} mới — đổi ô luôn cấp phương tiện mở mới` : undefined}>
          <input className={inputCls} value={keyTag} maxLength={50} onChange={(e) => onKeyTag(e.target.value)} placeholder={newMethod === 'RFID_CARD' ? 'VD: CARD-0217' : 'VD: K-217'} />
        </Field>
      )}
      {oldMethod && (
        <CheckLine checked={oldReset} onChange={onOldReset}>
          {accessResetLabel(oldMethod, oldKeyTag)} <span className="text-stone-500">(không tick thì ô cũ chờ ghi nhận ở mục Ô chờ thu chìa / thẻ mới mở cho thuê lại)</span>
        </CheckLine>
      )}
      {oldMethod && oldMethod !== newMethod && <p className="flex items-center gap-1.5 text-xs text-stone-500"><KeyRound className="size-3.5" />Ô mới khoá bằng {ACCESS_METHOD[newMethod].toLowerCase()}, khác ô cũ ({ACCESS_METHOD[oldMethod].toLowerCase()}).</p>}
    </div>
  );
}
