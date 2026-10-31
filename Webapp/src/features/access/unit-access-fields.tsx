'use client';

import { KeyRound, RectangleEllipsis } from 'lucide-react';
import type { AccessMethod } from '@ssm/shared';
import { ACCESS_METHOD } from '@/shared/lib/labels';
import { Field, inputCls } from '@/shared/ui';
import { Callout, CheckLine } from '@/features/staff-ui';

/** Việc với ô cũ khi khách chuyển đi: thu chìa / thẻ cũ, hoặc đặt lại ổ khoá mật khẩu. */
export const accessResetLabel = (method: AccessMethod, keyTag?: string | null) =>
  method === 'PIN' ? 'Đã đặt lại ổ khoá mật khẩu của ô cũ' : `Đã thu ${method === 'RFID_CARD' ? 'thẻ' : 'chìa'} cũ${keyTag ? ` ${keyTag}` : ''} của khách`;

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
          {accessResetLabel(oldMethod, oldKeyTag)} <span className="text-stone-500">(không tick thì ô cũ chờ ghi nhận ở trang Kho mới mở cho thuê lại)</span>
        </CheckLine>
      )}
      {oldMethod && oldMethod !== newMethod && <p className="flex items-center gap-1.5 text-xs text-stone-500"><KeyRound className="size-3.5" />Ô mới khoá bằng {ACCESS_METHOD[newMethod].toLowerCase()}, khác ô cũ ({ACCESS_METHOD[oldMethod].toLowerCase()}).</p>}
    </div>
  );
}
