'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import type { AccessMethod, AccessRequestType, PaymentMethod, RentalContract } from '@ssm/shared';
import { ACCESS_METHOD, ACCESS_REQUEST_STATUS, ACCESS_REQUEST_TYPE, accessFeeOf } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { fmtDateTime, vnd } from '@/shared/lib/format';
import { Button, StatusBadge, cx } from '@/shared/ui';
import { PayMethodPicker } from '@/features/payments/pay-method';

const TYPE_BY_METHOD: Record<AccessMethod, AccessRequestType> = { PIN: 'PIN_RESET', RFID_CARD: 'CARD_REISSUE', PHYSICAL_KEY: 'KEY_REISSUE' };
const REASONS: Record<AccessRequestType, string[]> = {
  PIN_RESET: ['Quên mật khẩu', 'Nghi lộ mật khẩu', 'Khác'],
  CARD_REISSUE: ['Làm mất thẻ', 'Thẻ hỏng', 'Khác'],
  KEY_REISSUE: ['Làm mất chìa', 'Chìa hỏng', 'Khác'],
};
interface AccessInfo { method: AccessMethod; keyTag: string | null; suspended: boolean; pin: string | null; reason: 'NOT_STORED' | 'SUSPENDED' | 'NOT_PIN' | null }

/**
 * Ô khoá mật khẩu là khoá số VẬT LÝ: khách tự đổi mật khẩu ngay trên ổ khoá, hệ thống chỉ giữ mật khẩu BAN ĐẦU lúc bàn giao
 * và không có luồng "đặt lại mật khẩu".
 *
 * Phương tiện vào kho của khách trên web — cùng nội dung với màn "Mã vào kho" của app: xem mật khẩu (ô khoá mật khẩu),
 * số thẻ / mã chìa, nhật ký mở kho hộ, và xin cấp lại khi quên / mất. Yêu cầu cấp lại cần Quản lý chi nhánh xác nhận;
 * có phí thì trả khi gửi, bị từ chối hoặc huỷ trước khi hoàn tất thì được hoàn đủ.
 */
export function AccessPanel({ c }: { c: RentalContract }) {
  const { db, run } = useStore();
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');

  const requests = db.accessRequests.filter((r) => r.contractId === c._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestKey = requests[0] ? `${requests[0]._id}:${requests[0].status}` : '';

  // Tải lại khi yêu cầu đổi trạng thái (VD vừa được duyệt → có mật khẩu mới) hoặc hình thức khoá đổi (đổi ô).
  const load = useCallback(async () => {
    try { setInfo(await api.get<AccessInfo>(`/contracts/${c._id}/access`)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không tải được thông tin vào kho'); }
  }, [c._id]);
  useEffect(() => { void load(); }, [load, latestKey, c.access.method]);
  // Tự ẩn mật khẩu sau 20 giây — đề phòng người khác nhìn qua vai.
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setReveal(false), 20_000);
    return () => clearTimeout(t);
  }, [reveal]);

  const lock = c.access.method;
  const type = TYPE_BY_METHOD[lock];
  const labels = ACCESS_REQUEST_TYPE[type];
  const active = db.policies.filter((p) => p.isActive);
  const policy = active.find((p) => p.facilityId === c.facilityId) ?? active.find((p) => p.scope === 'GLOBAL');
  const fee = accessFeeOf(policy ?? {}, type);
  const open = requests.find((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
  const requestable = ['ACTIVE', 'DELINQUENT', 'MOVE_OUT_PENDING'].includes(c.status);
  // Đã bàn giao kho lại cho chi nhánh (chờ kiểm tra trả kho): thẻ / chìa đã thu hồi, BE từ chối cấp lại (ALREADY_RETURNED).
  const returnedAt = c.access.revokedAt ?? null;
  const chosen = reason ?? REASONS[type][0];
  const opens = [...(c.access.assistedOpens ?? [])].reverse();

  return (
    <div className="space-y-5 text-sm">
      <section>
        <p className="font-semibold">{lock === 'PIN' ? 'Mật khẩu ban đầu của ổ khoá' : lock === 'RFID_CARD' ? 'Thẻ khoá' : 'Chìa khoá'}</p>
        <p className="text-xs text-stone-500">Hình thức khoá: {ACCESS_METHOD[lock]}</p>
        {error && <p className="mt-2 text-red-700">{error}</p>}
        {!info && !error && <p className="mt-2 text-stone-500">Đang tải…</p>}

        {info && lock === 'PIN' && (info.pin ? (
          <div className="mt-3">
            <div className="flex items-center gap-3">
              <p className={cx('rounded-lg bg-stone-100 px-4 py-2 font-mono text-xl tracking-[0.35em]', reveal && 'select-all')}>{reveal ? info.pin : '••••••'}</p>
              <Button size="sm" variant="secondary" onClick={() => setReveal((v) => !v)}>{reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}</Button>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-stone-500">Đây là mật khẩu nhân viên đặt lúc bàn giao kho (tự ẩn sau 20 giây). Ổ khoá là khoá số vật lý: <b>bạn tự đổi mật khẩu ngay trên ổ khoá</b> và nên đổi sau lần mở đầu tiên. Sau khi bạn đổi, hệ thống không biết mật khẩu mới — hãy tự ghi nhớ.</p>
          </div>
        ) : (
          <p className="mt-2 text-stone-600">{info.reason === 'SUSPENDED'
            ? 'Quyền vào kho đang bị tạm khoá do công nợ. Thanh toán công nợ để mở lại và xem mật khẩu.'
            : 'Ổ khoá là khoá số vật lý, bạn tự đặt và đổi mật khẩu ngay trên ổ khoá; hệ thống không lưu mật khẩu của ô này.'}</p>
        ))}

        {info && lock !== 'PIN' && (
          <div className="mt-3 space-y-2">
            <p className="flex items-center justify-between rounded-lg bg-stone-100 px-3 py-2"><span className="text-stone-500">{lock === 'RFID_CARD' ? 'Số thẻ' : 'Mã chìa'}</span><b>{info.keyTag ?? 'Chưa ghi nhận'}</b></p>
            {info.suspended && <p className="text-stone-600">Quyền vào kho đang bị tạm khoá do công nợ.</p>}
            {c.access.lostReportedAt && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-amber-900 ring-1 ring-amber-200"><ShieldAlert className="mt-0.5 size-4 shrink-0" />
                Bạn đã báo mất lúc {fmtDateTime(c.access.lostReportedAt)}{lock === 'RFID_CARD' ? ' — thẻ cũ đã bị khoá, không ai dùng được nữa.' : '.'}</p>
            )}
          </div>
        )}
      </section>

      {(
        <section className="border-t border-stone-100 pt-4">
          <p className="font-semibold">{lock === 'PIN' ? 'Quên mật khẩu?' : 'Cần vào kho gấp?'}</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            Đến quầy chi nhánh trong giờ hoạt động, mang giấy tờ tùy thân. Nhân viên xác minh danh tính rồi {lock === 'PIN' ? 'mở và đặt lại ổ khoá để bạn tự đặt mật khẩu mới' : `mở kho giúp bạn bằng ${lock === 'RFID_CARD' ? 'thẻ tổng' : 'chìa tổng'} của chi nhánh`} —
            bạn có mặt khi mở, nhân viên không vào trong ô kho. Mỗi lần mở hộ đều được ghi lại bên dưới.
          </p>
          {opens.length === 0 ? <p className="mt-2 text-xs text-stone-500">Chưa có lần mở hộ nào.</p> : (
            <ul className="mt-2 space-y-1.5">
              {opens.map((o) => (
                <li key={o.at} className="rounded-lg bg-stone-50 px-3 py-2 text-xs"><b>{fmtDateTime(o.at)}</b> · {o.forName ? `mở cho ${o.forName} (được uỷ quyền) · ` : ''}nhân viên {o.byName} · {o.reason}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {lock !== 'PIN' && <section className="border-t border-stone-100 pt-4">
        <p className="font-semibold">{labels.title}</p>
        {!returnedAt && <p className="mt-1 text-xs leading-relaxed text-stone-600">
          Yêu cầu cần <b>Quản lý chi nhánh xác nhận</b>{type === 'PIN_RESET' ? '. Duyệt xong, mật khẩu mới hiện ngay ở trên.' : `. Duyệt xong, nhân viên chi nhánh sẽ làm và bàn giao ${labels.what} cho bạn tại quầy.`}
          {' '}Phí: <b className={cx(fee === 0 && 'text-emerald-700')}>{fee > 0 ? vnd(fee) : 'miễn phí'}</b>{fee > 0 ? ' — trả khi gửi yêu cầu; bị từ chối hoặc bạn huỷ trước khi hoàn tất thì được hoàn đủ.' : '.'}
        </p>}
        {returnedAt ? (
          <p className="mt-2 text-stone-600">Bạn đã bàn giao kho lại cho chi nhánh lúc {fmtDateTime(returnedAt)} — {lock === 'RFID_CARD' ? 'thẻ' : 'chìa'} đã được thu hồi nên không cấp lại nữa. Có thắc mắc, hãy liên hệ chi nhánh.</p>
        ) : !requestable ? (
          <p className="mt-2 text-stone-600">Hợp đồng đang bị khoá truy cập hoặc đã kết thúc — hãy liên hệ chi nhánh.</p>
        ) : open ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-amber-900 ring-1 ring-amber-200">Bạn đang có một yêu cầu chưa xử lý xong ({ACCESS_REQUEST_STATUS[open.status].label}) — xem ở mục bên dưới.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {REASONS[type].map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className={cx('rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset', chosen === r ? 'bg-ink text-white ring-ink' : 'ring-stone-300 hover:bg-stone-50')}>{r}</button>
              ))}
            </div>
            {fee > 0 && <PayMethodPicker value={method} onChange={setMethod} />}
            <Button onClick={() => void run('requestAccess', { contractId: c._id, reason: chosen, method: fee > 0 ? method : undefined }, 'Đã gửi yêu cầu — chờ quản lý chi nhánh xác nhận')}>
              {fee > 0 ? `${labels.button} · trả ${vnd(fee)}` : labels.button}
            </Button>
          </div>
        )}
      </section>}

      {(lock !== 'PIN' || requests.length > 0) && <section className="border-t border-stone-100 pt-4">
        <p className="font-semibold">Yêu cầu của tôi</p>
        {requests.length === 0 ? <p className="mt-1 text-xs text-stone-500">Chưa có yêu cầu nào.</p> : (
          <ul className="mt-2 space-y-2">
            {requests.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2">
                <span>
                  <b>{ACCESS_REQUEST_TYPE[r.type].title}</b> <StatusBadge map={ACCESS_REQUEST_STATUS} value={r.status} />
                  <span className="block text-xs text-stone-500">{r.requestNumber} · {fmtDateTime(r.createdAt)}{r.reason ? ` · ${r.reason}` : ''}{r.fee > 0 ? ` · phí ${vnd(r.fee)}` : ''}</span>
                </span>
                {(r.status === 'REQUESTED' || r.status === 'APPROVED') && (
                  <Button size="sm" variant="ghost" onClick={() => void run('cancelAccessRequest', { requestId: r._id }, r.fee > 0 ? 'Đã huỷ yêu cầu — phí được hoàn lại' : 'Đã huỷ yêu cầu')}>Huỷ yêu cầu</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>}
    </div>
  );
}
