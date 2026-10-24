'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CalendarClock, CircleCheck, KeyRound, PackageCheck, Printer, RefreshCw, Repeat, ScanLine, Search, TriangleAlert, Upload } from 'lucide-react';
import type { CheckInShift, PaymentMethod, Reservation } from '@ssm/shared';
import { addPeriods, bookingServicesDue, dueAtCheckIn, ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, INTAKE_CHECK_ITEMS, PAPER_CONTRACT_MAX_BYTES, PAPER_CONTRACT_TYPES, RESCHEDULE_STATUSES, paymentDueDate, paysWholeTerm, periodLabel, rescheduleCheck } from '@ssm/shared';
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

// Ảnh hàng hoá: link https, cách nhau dấu phẩy.
const parseUrls = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const HTTPS_RE = /^https:\/\/\S+$/;

/** Đọc file thành base64 (bỏ tiền tố data:...;base64,). */
const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(f);
});

function CheckInInner() {
  const { db, user, run, refresh, busy, toast } = useStore();
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
  // Kiểm tra hàng hoá (Điều 4) — phải xác nhận đủ mọi mục trước khi bàn giao.
  const [goods, setGoods] = useState<string[]>([]);
  const [goodsNote, setGoodsNote] = useState('');
  const [goodsPhotos, setGoodsPhotos] = useState('');
  // Ký giấy tại quầy: in hợp đồng → khách ký → tải bản scan lên.
  const [paperName, setPaperName] = useState('');
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperErr, setPaperErr] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
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
    setGoods([]); setGoodsNote(''); setGoodsPhotos(''); setPaperName(''); setPaperFile(null); setPaperErr('');
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

  // Tiền thu khi nhận kho = tiền thuê kỳ đầu + dịch vụ khách chọn kèm lúc đặt (chưa thu).
  const rentDue = r ? dueAtCheckIn(r.quote) : 0;
  const svcOrders = r ? db.serviceOrders.filter((o) => String(o.reservationId ?? '') === r._id && o.status === 'REQUESTED' && !o.paymentId) : [];
  const svcDue = r ? bookingServicesDue(db.serviceOrders, r._id) : 0;
  const totalDue = rentDue + svcDue;
  const photoUrls = parseUrls(goodsPhotos);
  const photosOk = photoUrls.every((u) => HTTPS_RE.test(u));
  const goodsOk = INTAKE_CHECK_ITEMS.every((i) => goods.includes(i.key)) && photosOk;

  const confirm = async () => {
    if (!r) return;
    const declared = byId(db.users, r.customerId)?.customerProfile;
    const id = declared?.idNumberLast4 ? {} : { idType: idInput.idType, idNumberLast4: idInput.idNumberLast4.trim() };
    const goodsCheck = { confirmed: goods, note: goodsNote.trim() || undefined, photoUrls: photoUrls.length ? photoUrls : undefined };
    const res = await run('checkIn', { reservationId: r._id, keyTag: method !== 'PIN' ? keyTag.trim() : undefined, payMethod: totalDue > 0 ? pay : undefined, ...id, goodsCheck }, 'Nhận kho thành công — hợp đồng đã kích hoạt');
    if (res.ok) setDone({ pin: res.value.pin, contract: res.value.contract.contractNumber, unit: res.value.unit.unitNumber });
  };

  // PDF hợp đồng chưa ký để in cho khách ký giấy (cần token nên tải qua blob).
  const printContract = async (x: Reservation) => {
    setFileBusy(true);
    try {
      const blob = await api.blob(`/reservations/${x._id}/contract-print.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `hop-dong-${x.code}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được hợp đồng', 'error');
    } finally {
      setFileBusy(false);
    }
  };

  const pickPaper = (f: File | null) => {
    setPaperErr(''); setPaperFile(null);
    if (!f) return;
    if (!(PAPER_CONTRACT_TYPES as readonly string[]).includes(f.type)) return setPaperErr('Chỉ nhận PDF, JPG hoặc PNG');
    if (f.size > PAPER_CONTRACT_MAX_BYTES) return setPaperErr(`File quá ${Math.round(PAPER_CONTRACT_MAX_BYTES / 1024 / 1024)}MB`);
    setPaperFile(f);
  };

  const savePaper = async () => {
    if (!r || !paperFile) return;
    let base64: string;
    try { base64 = await toBase64(paperFile); } catch { return setPaperErr('Không đọc được file'); }
    await run('signPaper', { reservationId: r._id, signerName: paperName.trim(), file: { name: paperFile.name, contentType: paperFile.type, base64 } }, 'Đã lưu hợp đồng giấy — đặt chỗ đã ký', () => { setPaperFile(null); setPaperName(''); });
  };

  // Khách đến sớm: chưa bàn giao được trước ngày nhận theo lịch — dời ngày nhận về hôm nay (ô đã giữ riêng cho khách),
  // chữ ký cũ hết hiệu lực nên khách ký lại (giấy tại quầy / online) rồi mới nhận kho.
  const early = !!r && r.startDate > todayISO() && RESCHEDULE_STATUSES.includes(r.status);
  const earlyCheck = r && early ? rescheduleCheck(r, todayISO()) : null;
  const receiveToday = () => { if (r) void run('rescheduleReservation', { reservationId: r._id, startDate: todayISO(), reason: 'Khách đến sớm tại quầy' }, 'Đã dời ngày nhận kho về hôm nay'); };
  const blockers: string[] = [];
  if (r) {
    if (r.status !== 'ALLOCATED') blockers.push(r.status === 'CONFIRMED' ? 'Đặt chỗ chưa được phân kho — cần Quản lý chi nhánh phân kho trước.' : `Trạng thái "${RESERVATION_STATUS[r.status].label}" không cho phép nhận kho.`);
    if (r.startDate > todayISO() && !early) blockers.push(`Chưa đến ngày nhận kho (${fmtDate(r.startDate)}).`);
    const c = byId(db.users, r.customerId);
    if (c?.status === 'SUSPENDED') blockers.push('Tài khoản khách đang bị tạm khóa.');
  }

  return (
    <>
      <PageHeader title="Nhận kho (check-in)" description="Quét QR hoặc nhập mã đặt chỗ." />
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
                {early && (
                  <div className="mt-5 rounded-lg bg-sky-50 p-3 text-sm text-sky-950 ring-1 ring-inset ring-sky-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4 shrink-0" />Khách đến sớm · lịch nhận {fmtDate(r.startDate)}</p>
                      {earlyCheck?.ok && <Button size="sm" disabled={busy} onClick={receiveToday}>Nhận kho từ hôm nay</Button>}
                    </div>
                    <p className="mt-1 text-xs">{earlyCheck?.ok ? `Chưa bàn giao được trước ngày nhận.${r.signature ? ' Đổi ngày thì khách phải ký lại hợp đồng.' : ''}` : earlyCheck?.message}</p>
                  </div>
                )}
                {early && blockers.length === 0 ? null : blockers.length === 0 && !r.signature ? (
                  <div className="mt-5 space-y-4 border-t border-stone-100 pt-5">
                    <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                      <p className="flex gap-2 font-semibold"><TriangleAlert className="mt-0.5 size-4 shrink-0" />Khách chưa ký hợp đồng — chưa bàn giao kho được.</p>
                      <p className="mt-2">Khách ký trên app / web (Đặt chỗ của tôi → Ký hợp đồng, mã <span className="font-mono">{r.code}</span>) rồi bấm “Kiểm tra lại”, hoặc ký giấy tại quầy.</p>
                      <Button className="mt-3" size="sm" variant="secondary" onClick={() => void refresh()}><RefreshCw className="size-4" />Kiểm tra lại</Button>
                    </div>
                    <div className="space-y-3 rounded-lg p-4 text-sm ring-1 ring-inset ring-stone-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">Ký giấy tại quầy</p>
                        <Button size="sm" variant="secondary" disabled={fileBusy} onClick={() => void printContract(r)}><Printer className="size-3.5" />In hợp đồng</Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Họ tên người ký"><input className={inputCls} value={paperName} maxLength={100} onChange={(e) => setPaperName(e.target.value)} placeholder={userName(db, r.customerId)} /></Field>
                        <Field label="Bản đã ký (PDF / JPG / PNG, ≤ 5MB)" error={paperErr || undefined}>
                          <input type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-stone-200"
                            onChange={(e) => pickPaper(e.target.files?.[0] ?? null)} />
                        </Field>
                      </div>
                      <Button disabled={busy || paperName.trim().length < 2 || !paperFile} onClick={() => void savePaper()}><Upload className="size-4" />Lưu bản đã ký</Button>
                    </div>
                  </div>
                ) : blockers.length > 0 ? (
                  <div className="mt-5 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{blockers.map((b) => <p key={b} className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{b}</p>)}</div>
                ) : (
                  <div className="mt-6 grid gap-5 border-t border-stone-100 pt-5 md:grid-cols-2">
                    {/* Ký giấy (PAPER): SignatureInfo ghi "Ký giấy tại quầy", ContractFileActions tải bản scan. */}
                    {r.signature && <div className="md:col-span-2"><SignatureInfo signature={r.signature} /><ContractFileActions reservation={r} /></div>}
                    <div className="space-y-4">
                      <Field label="Hình thức truy cập">
                        <div className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-stone-200">
                          <KeyRound className="size-4 text-stone-500" />{ACCESS_METHOD[method]}
                        </div>
                      </Field>
                      {method !== 'PIN' && <Field label={method === 'PHYSICAL_KEY' ? 'Mã chìa khoá (bắt buộc)' : 'Số thẻ khoá (bắt buộc)'} error={!keyTag.trim() ? `Nhập ${method === 'PHYSICAL_KEY' ? 'mã chìa' : 'số thẻ'} đã giao cho khách` : undefined}><input className={inputCls} value={keyTag} maxLength={50} onChange={(e) => setKeyTag(e.target.value)} placeholder={method === 'PHYSICAL_KEY' ? `K-${unitLabel(db, r.unitId)}` : 'RF-000123'} /></Field>}
                    </div>
                    <div className="rounded-lg bg-stone-50 p-4 text-sm ring-1 ring-inset ring-stone-200 md:col-span-2">
                      <p className="font-semibold">Thanh toán khi nhận kho</p>
                      <dl className="mt-2 space-y-1.5">
                        <div className="flex justify-between gap-4">
                          <dt className="text-stone-600">Tiền giữ chân <span className="text-xs text-stone-500">— đã thu lúc đặt, không trừ vào tiền thuê</span></dt>
                          <dd className={cx('shrink-0 tabular-nums', r.depositPaymentId ? 'text-emerald-700' : 'text-red-700')}>{vnd(r.quote.depositAmount)} · {r.depositPaymentId ? 'đã thu' : 'chưa thu'}</dd>
                        </div>
                        {r.quote.firstPeriodAtBooking ? (
                          <div className="flex justify-between gap-4">
                            <dt className="text-stone-600">Tiền thuê {PERIOD_UNIT[r.quote.rentalPeriod]} đầu <span className="text-xs text-stone-500">— đã trả lúc đặt</span></dt>
                            <dd className="shrink-0 tabular-nums text-emerald-700">{vnd(r.quote.firstPeriodRent)} · đã thu</dd>
                          </div>
                        ) : null}
                        {rentDue > 0 && (
                          <div className="flex justify-between gap-4 border-t border-stone-200 pt-1.5">
                            <dt>{paysWholeTerm(r.quote) ? `Tiền thuê cả thời hạn (${periodLabel(r.quote.rentalPeriod, r.periods)})` : `Tiền thuê ${PERIOD_UNIT[r.quote.rentalPeriod]} đầu`}</dt>
                            <dd className="shrink-0 tabular-nums">{vnd(rentDue)}</dd>
                          </div>
                        )}
                        {svcOrders.map((o) => (
                          <div key={o._id} className="flex justify-between gap-4 border-t border-stone-200 pt-1.5">
                            <dt>Dịch vụ kèm: {o.serviceName} × {o.quantity} {o.unitLabel} <span className="font-mono text-xs text-stone-500">{o.orderNumber}</span></dt>
                            <dd className="shrink-0 tabular-nums">{vnd(o.total)}</dd>
                          </div>
                        ))}
                        <div className="flex justify-between gap-4 border-t border-stone-300 pt-1.5 font-semibold">
                          <dt>Thu hôm nay</dt>
                          <dd className="shrink-0 tabular-nums">{vnd(totalDue)}</dd>
                        </div>
                      </dl>
                      {(() => {
                        const grace = db.policies.find((p) => p._id === r.quote.policyId)?.gracePeriodDays;
                        const next = addPeriods(todayISO(), r.quote.rentalPeriod, Math.max(1, r.quote.prepaidPeriods ?? 1));
                        return (
                          <p className="mt-2 text-xs text-stone-500">
                            {paysWholeTerm(r.quote) && 'Trả kho sớm không hoàn các kỳ chưa dùng. '}Kỳ kế tiếp từ {fmtDate(next)}
                            {grace !== undefined && <>, hạn trả <b>{fmtDate(paymentDueDate(next, grace))}</b> (quá hạn tính phí trễ)</>}.
                          </p>
                        );
                      })()}
                    </div>
                    {totalDue > 0 && (
                      <Field label="Hình thức thu tiền" className="md:col-span-2">
                        <PayMethodPicker value={pay} onChange={setPay} methods={['CASH', 'CARD', 'VNPAY', 'BANK_TRANSFER']} />
                      </Field>
                    )}
                    {(() => {
                      const declared = byId(db.users, r.customerId)?.customerProfile;
                      return (
                        <div className="space-y-3 rounded-lg bg-sky-50 p-4 text-sm ring-1 ring-inset ring-sky-200 md:col-span-2">
                          <p className="font-semibold text-sky-950">Đối chiếu giấy tờ tùy thân bản gốc</p>
                          {declared?.idNumberLast4 ? (
                            <p className="text-sky-950">Khách đã khai: <b>{ID_TYPE_LABEL[declared.idType ?? 'CCCD']}</b>, 4 số cuối <b className="font-mono">{declared.idNumberLast4}</b>, họ tên <b>{userName(db, r.customerId)}</b>.
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
                            <span>Đã đối chiếu bản gốc: đúng người, họ tên và 4 số cuối khớp.</span>
                          </label>
                        </div>
                      );
                    })()}
                    <div className="space-y-3 rounded-lg bg-rose-50 p-4 text-sm ring-1 ring-inset ring-rose-200 md:col-span-2">
                      <p className="flex items-center gap-2 font-semibold text-rose-950"><PackageCheck className="size-4" />Kiểm tra hàng hoá</p>
                      <p className="text-rose-900">Có hàng thuộc danh mục cấm → không bàn giao kho.</p>
                      <div className="space-y-2">
                        {INTAKE_CHECK_ITEMS.map((i) => (
                          <label key={i.key} className="flex cursor-pointer gap-2.5 text-rose-950">
                            <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={goods.includes(i.key)}
                              onChange={(e) => setGoods((g) => (e.target.checked ? [...g, i.key] : g.filter((k) => k !== i.key)))} />
                            <span>{i.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Ghi chú"><input className={inputCls} value={goodsNote} maxLength={500} onChange={(e) => setGoodsNote(e.target.value)} placeholder="VD: 12 thùng đồ gia dụng, 1 tủ gỗ" /></Field>
                        <Field label="Link ảnh (https, cách nhau dấu phẩy)" error={photosOk ? undefined : 'Link ảnh phải bắt đầu bằng https://'}>
                          <input className={inputCls} value={goodsPhotos} onChange={(e) => setGoodsPhotos(e.target.value)} placeholder="https://…, https://…" />
                        </Field>
                      </div>
                    </div>
                    <Button size="lg" className="md:col-span-2" disabled={busy || !idChecked || !goodsOk || (method !== 'PIN' && !keyTag.trim()) || (!byId(db.users, r.customerId)?.customerProfile?.idNumberLast4 && !ID_LAST4_RE.test(idInput.idNumberLast4.trim()))} onClick={() => void confirm()}><KeyRound className="size-4" />Xác nhận bàn giao kho</Button>
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
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Khách đã ký hợp đồng ghi ô {unitLabel(db, assign.unitId)} nên không đổi ô được. Ô không giao được thì huỷ đặt chỗ — hoàn khách 100%.</p>
        ) : assignCandidates.length === 0 ? <p className="text-sm text-amber-800">Không còn ô trống cùng loại ở chi nhánh này.</p> : (
          <Field label="Ô mới (cùng loại, đang trống)">
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
