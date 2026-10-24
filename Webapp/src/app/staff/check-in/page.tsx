'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CircleCheck, KeyRound, RefreshCw, Repeat, ScanLine, Search, TriangleAlert } from 'lucide-react';
import type { CheckInShift, PaymentMethod, Reservation } from '@ssm/shared';
import { addPeriods, dueAtCheckIn, ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, paymentDueDate, paysWholeTerm, periodLabel } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { api } from '@/shared/api/client';
import { ACCESS_METHOD, CHECK_IN_SHIFT, PERIOD_UNIT, RESERVATION_STATUS } from '@/shared/lib/labels';
import { byId, facilityName, inScope, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Button, ButtonLink, Card, CardHeader, Field, KV, Modal, PageHeader, StatusBadge, cx, inputCls } from '@/shared/ui';
import { PayMethodPicker } from '@/features/payments/pay-method';
import { QrScanButton } from '@/features/reservations/qr-scanner';
import { SignatureInfo } from '@/features/contracts/contract-document';
import { ContractFileActions } from '@/features/contracts/contract-file-actions';
import { CustomerIdentityDialog } from '@/features/auth/customer-identity-dialog';

function CheckInInner() {
  const { db, user, run, refresh, busy } = useStore();
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get('code') ?? '');
  const [found, setFound] = useState<Reservation | null>(null);
  const [error, setError] = useState('');
  const [keyTag, setKeyTag] = useState('');
  const [pay, setPay] = useState<PaymentMethod>('CASH');
  // Đối chiếu giấy tờ tùy thân bản gốc — bắt buộc trước khi bàn giao. Khách chưa khai thì nhân viên nhập theo giấy tờ khách xuất trình.
  const [idChecked, setIdChecked] = useState(false);
  const [editIdentity, setEditIdentity] = useState(false);
  const [idInput, setIdInput] = useState<{ idType: 'CCCD' | 'PASSPORT'; idNumberLast4: string }>({ idType: 'CCCD', idNumberLast4: '' });
  const [done, setDone] = useState<{ pin?: string; contract: string; unit: string } | null>(null);
  // Nhân viên chia theo ca cố định — mặc định lọc đúng ca của mình, có thể bấm xem "Tất cả ca".
  const [shiftFilter, setShiftFilter] = useState<CheckInShift | 'ALL'>(() => user?.shift ?? 'ALL');
  // Quản lý chi nhánh phân / đổi ô cho đặt chỗ (khách chưa ký hợp đồng ghi số ô) — đổi là nhả ô cũ, giữ ô mới cùng lúc.
  const [assign, setAssign] = useState<Reservation | null>(null);
  const [assignUnit, setAssignUnit] = useState('');
  useEffect(() => { const c = sp.get('code'); if (c) void lookup(c); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;

  const r = found ? db.reservations.find((x) => x._id === found._id) ?? null : null;
  // Hình thức khoá là thuộc tính của chính ô đã chọn (không còn theo loại kho).
  const method = (r ? db.units.find((u) => u._id === r.unitId)?.accessMethod : null) ?? 'PIN';
  const arrivals = db.reservations.filter((x) => x.status === 'ALLOCATED' && x.startDate <= todayISO() && inScope(db, user, x.facilityId)
    && (shiftFilter === 'ALL' || x.preferredCheckInShift === shiftFilter));
  // Đã trả tiền giữ chân nhưng chưa có ô (chi nhánh gỡ ô mà chưa phân lại) — quá hạn nhận mà vẫn chưa có ô thì hệ thống huỷ, hoàn 100%.
  const unassigned = db.reservations.filter((x) => x.status === 'CONFIRMED' && !x.unitId && inScope(db, user, x.facilityId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const isFM = user.role === 'FACILITY_MANAGER';
  // Đặt chỗ đã có ô, nhận trong 14 ngày tới — quản lý đổi ô (khách chưa ký) hoặc huỷ hoàn 100% TRƯỚC ngày nhận khi ô có vấn đề.
  const upcoming = isFM ? db.reservations.filter((x) => x.status === 'ALLOCATED' && x.startDate > todayISO() && x.startDate <= addDays(todayISO(), 14) && inScope(db, user, x.facilityId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
  const assignFromMethod = assign?.unitId ? byId(db.units, assign.unitId)?.accessMethod : undefined;
  // Ưu tiên ô cùng hình thức khoá với ô khách đã chọn — khách chọn ô mật khẩu thì không âm thầm chuyển sang ô chìa.
  const assignCandidates = assign
    ? db.units.filter((u) => u.facilityId === assign.facilityId && u.unitTypeId === assign.unitTypeId && u.status === 'AVAILABLE' && !u.isDeleted)
      .sort((a, b) => Number(a.accessMethod !== assignFromMethod) - Number(b.accessMethod !== assignFromMethod) || a.location.floor - b.location.floor || a.unitNumber.localeCompare(b.unitNumber))
    : [];
  const openAssign = (x: Reservation) => { setAssignUnit(''); setAssign(x); };
  const cancelUnavailable = (x: Reservation) => {
    if (!window.confirm(`Huỷ đặt chỗ ${x.code} vì chi nhánh không giao được ô?
Khách được hoàn 100% tiền đã trả (Điều 11).`)) return;
    void run('cancelReservation', { reservationId: x._id, reason: 'FACILITY_UNAVAILABLE', note: 'Chi nhánh không giao được ô kho' }, (v) => `Đã huỷ — hoàn khách ${vnd(v)}`, () => setAssign(null));
  };

  // Server-side lookup: enforces facility scope (out-of-scope codes are written to the audit log as DENIED)
  const lookup = async (c = code) => {
    setDone(null); setError(''); setIdChecked(false); setIdInput({ idType: 'CCCD', idNumberLast4: '' }); setKeyTag('');
    if (!c.trim()) return;
    try {
      const res = await api.get<{ reservation: Reservation; qrValid: boolean | null }>(`/reservations/lookup?code=${encodeURIComponent(c.trim())}`);
      if (!db.reservations.some((x) => x._id === res.reservation._id)) await refresh();
      setFound(res.reservation);
      if (res.qrValid === false) setError('Mã QR không khớp — kiểm tra giấy tờ khách trước khi bàn giao');
    } catch (e) {
      setFound(null);
      setError(e instanceof Error ? e.message : 'Không tra cứu được');
    }
  };

  const confirm = async () => {
    if (!r) return;
    const declared = byId(db.users, r.customerId)?.customerProfile;
    const id = declared?.idNumberLast4 ? {} : { idType: idInput.idType, idNumberLast4: idInput.idNumberLast4.trim() };
    const res = await run('checkIn', { reservationId: r._id, keyTag: method !== 'PIN' ? keyTag.trim() : undefined, payMethod: dueAtCheckIn(r.quote) > 0 ? pay : undefined, ...id }, 'Nhận kho thành công — hợp đồng đã kích hoạt');
    if (res.ok) setDone({ pin: res.value.pin, contract: res.value.contract.contractNumber, unit: res.value.unit.unitNumber });
  };

  const blockers: string[] = [];
  if (r) {
    if (r.status !== 'ALLOCATED') blockers.push(r.status === 'CONFIRMED' ? 'Đặt chỗ chưa được phân kho — cần Quản lý chi nhánh phân kho trước.' : `Trạng thái "${RESERVATION_STATUS[r.status].label}" không cho phép nhận kho.`);
    if (r.startDate > todayISO()) blockers.push(`Chưa đến ngày nhận kho (${fmtDate(r.startDate)}).`);
    const c = byId(db.users, r.customerId);
    if (c?.status === 'SUSPENDED') blockers.push('Tài khoản khách đang bị tạm khóa.');
  }

  return (
    <>
      <PageHeader title="Nhận kho (check-in)" description="Quét mã QR của khách hoặc nhập mã đặt chỗ, xác minh giấy tờ và bàn giao quyền truy cập." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
              <div className="relative min-w-60 flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <input className={cx(inputCls, 'pl-9 font-mono uppercase')} placeholder="RSV-260911-XXXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <Button type="submit"><Search className="size-4" />Tra cứu</Button>
              <QrScanButton onResult={(text) => { setCode(text); void lookup(text); }} />
            </form>
            {error && <p className="mt-3 flex items-center gap-2 text-sm text-red-700"><TriangleAlert className="size-4" />{error}</p>}
          </Card>

          {done && (
            <Card className="border-emerald-200 bg-emerald-50 p-5">
              <p className="flex items-center gap-2 font-semibold text-emerald-800"><CircleCheck className="size-5" />Đã bàn giao kho {done.unit}</p>
              <p className="mt-1 text-sm text-emerald-900">Hợp đồng {done.contract} đã kích hoạt, tiền thuê kỳ đầu đã ghi nhận.</p>
              {done.pin && <p className="mt-3 text-sm">Mã PIN truy cập (chỉ hiển thị một lần): <span className="ml-1 rounded-md bg-white px-2 py-1 font-mono text-lg font-bold tracking-[0.3em] text-ink ring-1 ring-emerald-200">{done.pin}</span></p>}
              <div className="mt-4"><ButtonLink href="/staff" variant="secondary" size="sm">Về hàng đợi</ButtonLink></div>
            </Card>
          )}

          {r && !done && (
            <Card>
              <CardHeader title={`Đặt chỗ ${r.code}`} actions={<StatusBadge map={RESERVATION_STATUS} value={r.status} />} />
              <div className="p-5">
                <KV items={[
                  ['Khách hàng', userName(db, r.customerId)],
                  ['Giấy tờ khách khai', (() => { const p = byId(db.users, r.customerId)?.customerProfile; return p?.idNumberLast4 ? `${ID_TYPE_LABEL[p.idType ?? 'CCCD']} · 4 số cuối ${p.idNumberLast4}` : 'Chưa khai — nhập theo giấy tờ bản gốc bên dưới'; })()],
                  ['Số điện thoại', byId(db.users, r.customerId)?.phone ?? '—'],
                  ['Chi nhánh', facilityName(db, r.facilityId)], ['Loại kho', typeName(db, r.unitTypeId)],
                  ['Kho được phân', unitLabel(db, r.unitId)], ['Ngày nhận', fmtDate(r.startDate)],
                  ['Ca dự kiến đến', <StatusBadge key="shift" map={CHECK_IN_SHIFT} value={r.preferredCheckInShift} />],
                  ['Thời hạn', periodLabel(r.quote.rentalPeriod, r.periods)], ['Tiền giữ chân', r.depositPaymentId ? `${vnd(r.quote.depositAmount)} · đã thu` : 'Chưa thu'],
                ]} />
                {blockers.length === 0 && !r.signature ? (
                  <div className="mt-5 space-y-3 border-t border-stone-100 pt-5">
                    <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                      <p className="flex gap-2 font-semibold"><TriangleAlert className="mt-0.5 size-4 shrink-0" />Khách chưa ký hợp đồng — chưa bàn giao kho được.</p>
                      <p className="mt-2 leading-relaxed">Hợp đồng phải do <b>chính khách</b> ký trên tài khoản của họ; nhân viên không ký thay. Hướng dẫn khách mở web hoặc app KhoAn → <b>Đặt chỗ của tôi</b> → <b>Ký hợp đồng</b> (đặt chỗ <span className="font-mono">{r.code}</span>), ký xong bấm “Kiểm tra lại”.</p>
                    </div>
                    <Button variant="secondary" onClick={() => void refresh()}><RefreshCw className="size-4" />Kiểm tra lại</Button>
                  </div>
                ) : blockers.length > 0 ? (
                  <div className="mt-5 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{blockers.map((b) => <p key={b} className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{b}</p>)}</div>
                ) : (
                  <div className="mt-6 grid gap-5 border-t border-stone-100 pt-5 md:grid-cols-2">
                    {r.signature && <div className="md:col-span-2"><SignatureInfo signature={r.signature} /><ContractFileActions reservation={r} /></div>}
                    <div className="space-y-4">
                      <Field label="Hình thức truy cập (theo loại kho)">
                        <div className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-stone-200">
                          <KeyRound className="size-4 text-stone-500" />{ACCESS_METHOD[method]}
                          {method === 'PIN' && <span className="text-xs text-stone-500">· hệ thống sinh mật khẩu ban đầu để đặt lên ổ khoá; khách tự đổi trên ổ khoá sau đó</span>}
                        </div>
                      </Field>
                      {method !== 'PIN' && <Field label={method === 'PHYSICAL_KEY' ? 'Mã chìa khoá (bắt buộc)' : 'Số thẻ khoá (bắt buộc)'} error={!keyTag.trim() ? `Nhập ${method === 'PHYSICAL_KEY' ? 'mã chìa' : 'số thẻ'} đã giao cho khách` : undefined}><input className={inputCls} value={keyTag} maxLength={50} onChange={(e) => setKeyTag(e.target.value)} placeholder={method === 'PHYSICAL_KEY' ? `K-${unitLabel(db, r.unitId)}` : 'RF-000123'} /></Field>}
                    </div>
                    <div className="rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-inset ring-stone-200 md:col-span-2">
                      <p className="font-semibold">Thanh toán khi nhận kho</p>
                      <dl className="mt-2 space-y-1.5">
                        <div className="flex justify-between gap-4">
                          <dt className="text-stone-600">Tiền giữ chân <span className="text-xs text-stone-500">— đã thu lúc đặt chỗ, giữ đến khi trả kho, không thu lại và không trừ vào tiền thuê</span></dt>
                          <dd className={cx('shrink-0 tabular-nums', r.depositPaymentId ? 'text-emerald-700' : 'text-red-700')}>{vnd(r.quote.depositAmount)} · {r.depositPaymentId ? 'đã thu' : 'chưa thu'}</dd>
                        </div>
                        {r.quote.firstPeriodAtBooking ? (
                          <div className="flex justify-between gap-4 border-t border-stone-200 pt-1.5 font-semibold">
                            <dt>Tiền thuê {PERIOD_UNIT[r.quote.rentalPeriod]} đầu <span className="text-xs font-normal text-stone-500">— kho cỡ lớn: khách đã trả cùng lúc đặt chỗ, KHÔNG thu lại</span></dt>
                            <dd className="shrink-0 tabular-nums text-emerald-700">{vnd(r.quote.firstPeriodRent)} · đã thu</dd>
                          </div>
                        ) : null}
                        {dueAtCheckIn(r.quote) > 0 && (
                          <div className="flex justify-between gap-4 border-t border-stone-200 pt-1.5 font-semibold">
                            <dt>Thu hôm nay: {paysWholeTerm(r.quote) ? `tiền thuê cả thời hạn (${periodLabel(r.quote.rentalPeriod, r.periods)})` : `tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`} <span className="text-xs font-normal text-stone-500">(khoản riêng với tiền giữ chân{paysWholeTerm(r.quote) ? ' — thuê theo ngày / tuần trả trọn một lần' : ''})</span></dt>
                            <dd className="shrink-0 tabular-nums">{vnd(dueAtCheckIn(r.quote))}</dd>
                          </div>
                        )}
                      </dl>
                      {(() => {
                        const grace = db.policies.find((p) => p._id === r.quote.policyId)?.gracePeriodDays;
                        const next = addPeriods(todayISO(), r.quote.rentalPeriod, Math.max(1, r.quote.prepaidPeriods ?? 1));
                        return (
                          <p className="mt-2 text-xs text-stone-500">
                            {dueAtCheckIn(r.quote) === 0 ? 'Hôm nay KHÔNG thu thêm khoản nào — khách đã trả đủ khi đặt chỗ.' : paysWholeTerm(r.quote) ? 'Hôm nay thu trọn tiền thuê của cả thời hạn; khách trả kho sớm không được hoàn các kỳ chưa dùng.' : `Hôm nay chỉ thu tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu, không thu thêm khoản nào khác.`} {paysWholeTerm(r.quote) ? 'Nếu hết thời hạn mà khách chưa trả kho, kỳ tính tiếp bắt đầu' : 'Kỳ kế tiếp bắt đầu'} {fmtDate(next)}
                            {grace !== undefined && <>, khách trả trước <b>{fmtDate(paymentDueDate(next, grace))}</b> (quá hạn bị tính phí trễ)</>}.
                          </p>
                        );
                      })()}
                    </div>
                    {dueAtCheckIn(r.quote) > 0 && (
                      <Field label={paysWholeTerm(r.quote) ? 'Hình thức thu tiền thuê cả thời hạn' : `Hình thức thu tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`}>
                        <PayMethodPicker value={pay} onChange={setPay} methods={['CASH', 'CARD', 'VNPAY', 'BANK_TRANSFER']} />
                      </Field>
                    )}
                    {(() => {
                      const declared = byId(db.users, r.customerId)?.customerProfile;
                      return (
                        <div className="space-y-3 rounded-lg bg-sky-50 p-4 text-sm ring-1 ring-inset ring-sky-200 md:col-span-2">
                          <p className="font-semibold text-sky-950">Đối chiếu giấy tờ tùy thân bản gốc</p>
                          {declared?.idNumberLast4 ? (
                            <p className="text-sky-950">Khách đã khai: <b>{ID_TYPE_LABEL[declared.idType ?? 'CCCD']}</b>, 4 số cuối <b className="font-mono">{declared.idNumberLast4}</b> (in trong hợp đồng đã ký). Kiểm tra giấy tờ bản gốc khớp họ tên <b>{userName(db, r.customerId)}</b> và 4 số cuối này.
                              {' '}{isFM
                                ? <>Khách đã đổi giấy tờ hợp lệ? <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setEditIdentity(true)}>Cập nhật theo bản gốc</button>.</>
                                : <b>Không khớp — KHÔNG bàn giao, báo quản lý chi nhánh.</b>}</p>
                          ) : (
                            <div className="grid gap-3 xl:grid-cols-[1fr_140px]">
                              <Field label="Loại giấy tờ khách xuất trình">
                                <select className={inputCls} value={idInput.idType} onChange={(e) => setIdInput((x) => ({ ...x, idType: e.target.value as 'CCCD' | 'PASSPORT' }))}>
                                  {ID_TYPES.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t]}</option>)}
                                </select>
                              </Field>
                              <Field label="4 số cuối"><input className={cx(inputCls, 'font-mono uppercase')} maxLength={4} value={idInput.idNumberLast4} onChange={(e) => setIdInput((x) => ({ ...x, idNumberLast4: e.target.value }))} placeholder="4821" /></Field>
                            </div>
                          )}
                          <label className="flex cursor-pointer gap-2.5 text-sky-950">
                            <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} />
                            <span>Tôi đã đối chiếu giấy tờ tùy thân bản gốc: đúng người, họ tên và 4 số cuối khớp. KhoAn không chụp / lưu số giấy tờ đầy đủ.</span>
                          </label>
                        </div>
                      );
                    })()}
                    <Button size="lg" className="md:col-span-2" disabled={busy || !idChecked || (method !== 'PIN' && !keyTag.trim()) || (!byId(db.users, r.customerId)?.customerProfile?.idNumberLast4 && !ID_LAST4_RE.test(idInput.idNumberLast4.trim()))} onClick={() => void confirm()}><KeyRound className="size-4" />Xác nhận bàn giao kho</Button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title="Sẵn sàng nhận kho" description="Đã phân kho, đến ngày" />
          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
            <button type="button" onClick={() => setShiftFilter('ALL')} className={cx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', shiftFilter === 'ALL' ? 'bg-ink text-white ring-ink' : 'text-stone-600 ring-stone-300 hover:bg-stone-50')}>Tất cả ca</button>
            {user.shift && <button type="button" onClick={() => setShiftFilter(user.shift!)} className={cx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', shiftFilter === user.shift ? 'bg-ink text-white ring-ink' : 'text-stone-600 ring-stone-300 hover:bg-stone-50')}>Ca của tôi ({CHECK_IN_SHIFT[user.shift].label})</button>}
          </div>
          <ul className="divide-y divide-stone-100">
            {arrivals.length === 0 && <li className="px-5 py-6 text-sm text-stone-500">Không có lượt nào.</li>}
            {arrivals.map((x) => (
              <li key={x._id} className="flex items-center">
                <button onClick={() => { setCode(x.code); void lookup(x.code); }} className="min-w-0 flex-1 px-5 py-3 text-left hover:bg-stone-50">
                  <p className="text-sm font-medium">{userName(db, x.customerId)}</p>
                  <p className="font-mono text-xs text-stone-500">{x.code} · {unitLabel(db, x.unitId)}</p>
                  <div className="mt-1"><StatusBadge map={CHECK_IN_SHIFT} value={x.preferredCheckInShift} /></div>
                </button>
                {isFM && (
                  <button type="button" title={x.signature ? 'Khách đã ký — huỷ hoàn 100% nếu không giao được ô' : 'Đổi sang ô khác cùng loại (khách chưa ký hợp đồng)'} onClick={() => openAssign(x)}
                    className="mr-3 shrink-0 rounded-md p-2 text-stone-400 hover:bg-stone-100 hover:text-brand-700">
                    <Repeat className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {upcoming.length > 0 && (
            <div className="border-t border-stone-100">
              <p className="px-5 pt-4 text-sm font-semibold">Sắp nhận kho (14 ngày tới)</p>
              <p className="px-5 text-xs text-stone-500">Ô có vấn đề thì đổi trước khi khách ký, hoặc huỷ hoàn 100% nếu không giao được ô.</p>
              <ul className="divide-y divide-stone-100">
                {upcoming.map((x) => (
                  <li key={x._id} className="flex items-center justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{userName(db, x.customerId)}</p>
                      <p className="font-mono text-xs text-stone-500">{x.code} · {unitLabel(db, x.unitId)} · nhận {fmtDate(x.startDate)}{x.signature ? ' · đã ký' : ''}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => openAssign(x)}>{x.signature ? 'Huỷ…' : 'Đổi ô'}</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="border-t border-stone-100">
              <p className="px-5 pt-4 text-sm font-semibold">Chưa có ô — cần phân</p>
              <p className="px-5 text-xs text-stone-500">{isFM ? 'Quá hạn nhận mà vẫn chưa có ô thì hệ thống tự huỷ và hoàn khách 100%.' : 'Báo Quản lý chi nhánh phân ô trước khi khách đến.'}</p>
              <ul className="divide-y divide-stone-100">
                {unassigned.map((x) => (
                  <li key={x._id} className="flex items-center justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{userName(db, x.customerId)}</p>
                      <p className="font-mono text-xs text-stone-500">{x.code} · {typeName(db, x.unitTypeId)} · nhận {fmtDate(x.startDate)}</p>
                    </div>
                    {isFM && <Button size="sm" variant="secondary" onClick={() => openAssign(x)}>Phân ô</Button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
      <Modal open={!!assign} onClose={() => setAssign(null)} title={assign?.unitId ? 'Đổi ô cho đặt chỗ' : 'Phân ô cho đặt chỗ'}
        description={assign ? `${userName(db, assign.customerId)} · ${assign.code} · ${typeName(db, assign.unitTypeId)}${assign.unitId ? ` · đang giữ ô ${unitLabel(db, assign.unitId)}` : ''}` : ''}
        footer={<>
          {assign && <Button variant="danger" onClick={() => cancelUnavailable(assign)}>Không giao được ô — huỷ, hoàn 100%</Button>}
          {!assign?.signature && <Button disabled={!assignUnit} onClick={() => assign && void run('allocate', { reservationId: assign._id, unitId: assignUnit }, (u) => `Đã ${assign.unitId ? 'đổi sang' : 'phân'} ô ${u.unitNumber}`, () => setAssign(null))}>Xác nhận</Button>}
        </>}>
        {assign?.signature ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Khách đã ký hợp đồng ghi đích danh ô {unitLabel(db, assign.unitId)} nên không đổi sang ô khác được. Nếu ô không giao được (hư hỏng, bảo trì), huỷ đặt chỗ — khách được hoàn 100% (Điều 11). Khách vẫn muốn thuê thì nhận kho rồi đổi ô theo Điều 8.</p>
        ) : assignCandidates.length === 0 ? <p className="text-sm text-amber-800">Không còn ô trống cùng loại ở chi nhánh này.</p> : (
          <Field label="Ô mới (cùng loại, đang trống)" hint="Khách thấy ô mới ở mục Đặt chỗ và ký hợp đồng theo ô này. Khách đã ký thì không đổi ô được nữa. Ô cùng hình thức khoá được xếp trước.">
            <select className={inputCls} value={assignUnit} onChange={(e) => setAssignUnit(e.target.value)}>
              <option value="">— Chọn ô —</option>
              {assignCandidates.map((u) => <option key={u._id} value={u._id}>{u.unitNumber} · tầng {u.location.floor} · {ACCESS_METHOD[u.accessMethod]}{assignFromMethod && u.accessMethod !== assignFromMethod ? ' (khác khoá ô cũ)' : ''}</option>)}
            </select>
          </Field>
        )}
      </Modal>
      <CustomerIdentityDialog target={isFM && editIdentity && r ? { kind: 'reservations', id: r._id } : null} customer={r ? byId(db.users, r.customerId) ?? null : null} onClose={() => setEditIdentity(false)} />
    </>
  );
}

export default function CheckInPage() {
  return <Suspense><CheckInInner /></Suspense>;
}
