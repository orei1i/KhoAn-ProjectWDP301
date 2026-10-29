'use client';

import { useMemo, useState } from 'react';
import { BadgePercent, CalendarX, History, KeyRound, Link2, Lock, ScrollText, Send, ShieldCheck, Undo2, Wallet } from 'lucide-react';
import type { BusinessPolicy } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { effectivePolicy, facilityName, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, IconTile, PageHeader, cx, inputCls } from '@/shared/ui';
import { Callout, PanelHeader } from '@/features/staff-ui';
import { ROLE_ICON } from '@/features/backoffice-ui';

export default function Policies() {
  const { db, run } = useStore();
  const [target, setTarget] = useState<string>('GLOBAL');
  const facilityId = target === 'GLOBAL' ? null : target;
  const current: BusinessPolicy = facilityId ? effectivePolicy(db, facilityId) : db.policies.find((p) => p.scope === 'GLOBAL' && p.isActive)!;
  const inherits = !!facilityId && current.scope === 'GLOBAL';
  const globalPolicy = db.policies.find((p) => p.scope === 'GLOBAL' && p.isActive);
  // Chi nhánh đang có chính sách riêng — phát hành bản chung không áp cho các chi nhánh này.
  const ownPolicyFacilities = db.facilities.filter((f) => !f.isDeleted && effectivePolicy(db, f._id)?.scope !== 'GLOBAL');

  const [draft, setDraft] = useState(() => toDraft(current));
  const [draftFor, setDraftFor] = useState(current._id);
  if (draftFor !== current._id) { setDraftFor(current._id); setDraft(toDraft(current)); }

  const history = useMemo(() => db.policies.filter((p) => (facilityId ? p.facilityId === facilityId : p.scope === 'GLOBAL')).sort((a, b) => b.version - a.version), [db.policies, facilityId]);

  const publish = () => {
    const where = facilityId
      ? `riêng cho chi nhánh ${facilityName(db, facilityId)}`
      : `toàn chuỗi${ownPolicyFacilities.length ? ` (trừ ${ownPolicyFacilities.length} chi nhánh có chính sách riêng: ${ownPolicyFacilities.map((f) => f.name).join(', ')})` : ''}`;
    if (!window.confirm(`Phát hành chính sách ${where}?\nChỉ áp cho đặt chỗ mới — hợp đồng đã ký giữ nguyên.`)) return;
    void doPublish();
  };
  const revert = () => {
    if (!facilityId || !window.confirm(`Bỏ chính sách riêng của ${facilityName(db, facilityId)}, dùng chính sách chung${globalPolicy ? ` v${globalPolicy.version}` : ''}?\nChỉ áp cho đặt chỗ mới — hợp đồng đã ký giữ nguyên.`)) return;
    void run('revertFacilityPolicy', { facilityId }, 'Đã bỏ chính sách riêng — chi nhánh dùng chính sách chung');
  };
  const doPublish = () => run('publishPolicy', {
    facilityId,
    patch: {
      gracePeriodDays: draft.grace, lockoutAfterDays: draft.lockout, abandonAfterLockedOutDays: draft.abandonAfter, reservationHoldMinutes: draft.hold,
      deposit: { mode: 'PERIODS_OF_RENT', value: draft.depositPeriods },
      lateFees: [{ afterDays: draft.grace, kind: 'PERCENT_OF_RENT', value: draft.latePct, recurringEveryDays: null }, { afterDays: draft.lockout, kind: 'FIXED', value: draft.lateFixed, recurringEveryDays: 30 }],
      cancellation: [{ minHoursBeforeStart: 72, depositRefundPct: draft.refund72 }, { minHoursBeforeStart: 24, depositRefundPct: draft.refund24 }, { minHoursBeforeStart: 0, depositRefundPct: 0 }],
      surcharges: current.surcharges.map((x) => (x.code === 'CLIMATE' ? { ...x, value: draft.climatePct } : x)),
      earlyTermination: [{ maxElapsedPct: 25, depositRefundPct: draft.earlyRefund25 }, { maxElapsedPct: 50, depositRefundPct: draft.earlyRefund50 }, { maxElapsedPct: 100, depositRefundPct: draft.earlyRefund100 }],
      accessFees: { PIN_RESET: draft.feePin, CARD_REISSUE: draft.feeCard, KEY_REISSUE: draft.feeKey },
      discounts: [
        { code: 'DAI_HAN_3', kind: 'PERCENT', value: draft.disc3, minPeriods: 3, validFrom: null, validTo: null, requiresApprovalRole: null },
        { code: 'DAI_HAN_6', kind: 'PERCENT', value: draft.disc6, minPeriods: 6, validFrom: null, validTo: null, requiresApprovalRole: null },
        { code: 'DAI_HAN_12', kind: 'PERCENT', value: draft.disc12, minPeriods: 12, validFrom: null, validTo: null, requiresApprovalRole: null },
      ],
    },
  }, (p) => `Đã phát hành chính sách v${p.version} — áp dụng cho đặt chỗ mới`);

  // ---- Chỉ để trình bày: so bản nháp với bản đang áp dụng để tô các ô đã sửa và đếm số mục đã sửa.
  const base = toDraft(current);
  const changedCount = (Object.keys(draft) as (keyof typeof draft)[]).filter((k) => draft[k] !== base[k]).length;
  const num = (k: keyof typeof draft, label: string, hint?: string, suffix?: string) => {
    const changed = draft[k] !== base[k]; // chỉ để tô ô đã sửa so với bản đang áp dụng
    return (
      <Field label={label} tip={hint}>
        <div className="relative">
          <input type="number" min={0} className={cx(inputCls, 'tabular-nums', suffix && 'pr-14', changed && 'bg-amber-50/60 ring-2 ring-amber-400')} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} />
          {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-stone-500">{suffix}</span>}
        </div>
      </Field>
    );
  };

  return (
    <>
      <PageHeader title="Chính sách vận hành" description="Hợp đồng đã ký giữ nguyên phiên bản lúc ký." actions={
        <select className={cx(inputCls, 'w-auto min-w-56')} aria-label="Phạm vi chính sách" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="GLOBAL">Toàn chuỗi (mặc định)</option>
          {db.facilities.filter((f) => !f.isDeleted).map((f) => <option key={f._id} value={f._id}>Riêng: {f.name}</option>)}
        </select>
      } />
      {inherits && <Callout tone="blue" icon={<Link2 />} className="mb-4">{facilityName(db, facilityId)} đang dùng chính sách toàn chuỗi v{current.version}.</Callout>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <IconTile icon={<ScrollText className="size-5" />} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Đang áp dụng: v{current.version}</p>
              <p className="text-xs text-stone-500">Hiệu lực từ {fmtDate(current.effectiveFrom)}</p>
            </div>
            {changedCount > 0 && <Badge tone="amber" dot>{changedCount} mục đã sửa</Badge>}
            <div className="flex flex-wrap gap-2">
              {facilityId && !inherits && <Button variant="secondary" onClick={revert}>Bỏ chính sách riêng — dùng chính sách chung</Button>}
              <Button onClick={publish}><Send className="size-4" />Phát hành phiên bản mới</Button>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <PanelHeader icon={<Wallet className="size-4" />} title="Đặt chỗ & tiền giữ chân" />
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                {num('hold', 'Thời gian giữ chỗ', 'Chờ thanh toán tiền giữ chân', 'phút')}
                {num('depositPeriods', 'Tiền giữ chân', 'Tính theo số chu kỳ tiền thuê', 'chu kỳ')}
                {num('climatePct', 'Phụ phí điều hòa (add-on)', 'Trên giá thuê một chu kỳ', '%')}
              </div>
            </Card>
            <Card>
              <PanelHeader icon={<Lock className="size-4" />} tone="red" title="Quá hạn & khóa truy cập" />
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                {num('grace', 'Thời gian ân hạn', undefined, 'ngày')}
                {num('lockout', 'Khóa truy cập sau', undefined, 'ngày')}
                {num('latePct', 'Phí trễ (sau ân hạn)', 'Trên tiền thuê tháng', '%')}
                {num('lateFixed', 'Phí cố định (khi khóa)', undefined, '₫')}
                {num('abandonAfter', 'Xử lý hàng bỏ lại sau', 'Kể từ thông báo cuối', 'ngày')}
              </div>
            </Card>
            <Card>
              <PanelHeader icon={<CalendarX className="size-4" />} tone="blue" title="Hủy đặt chỗ — hoàn tiền giữ chân" tip="Dưới 24 giờ: không hoàn." />
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                {num('refund72', 'Hủy trước ≥ 72 giờ', undefined, '%')}
                {num('refund24', 'Hủy trước ≥ 24 giờ', 'Dưới 24 giờ: không hoàn', '%')}
              </div>
            </Card>
            <Card>
              <PanelHeader icon={<Undo2 className="size-4" />} tone="violet" title="Trả kho sớm — hoàn tiền giữ chân" tip="Áp khi khách trả kho sớm trong lúc đang thuê." />
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                {num('earlyRefund25', 'Đã dùng ≤ 25% kỳ hạn', undefined, '%')}
                {num('earlyRefund50', 'Đã dùng ≤ 50% kỳ hạn', undefined, '%')}
                {num('earlyRefund100', 'Đã dùng trên 50% kỳ hạn', undefined, '%')}
              </div>
            </Card>
            <Card>
              <PanelHeader icon={<KeyRound className="size-4" />} tone="amber" title="Phí cấp lại phương tiện vào kho" tip="Từ chối / huỷ thì hoàn đủ. 0 = miễn phí." />
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                {num('feeCard', 'Làm lại thẻ khoá', undefined, '₫')}
                {num('feeKey', 'Cấp lại chìa khoá', undefined, '₫')}
              </div>
            </Card>
            <Card>
              <PanelHeader icon={<BadgePercent className="size-4" />} tone="green" title="Ưu đãi thuê dài hạn" tip="Chỉ áp cho thuê theo tháng." />
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                {num('disc3', 'Từ 3 tháng', undefined, '%')}
                {num('disc6', 'Từ 6 tháng', undefined, '%')}
                {num('disc12', 'Từ 12 tháng (1+ năm)', undefined, '%')}
              </div>
            </Card>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <PanelHeader icon={<History className="size-4" />} tone="gray" title="Lịch sử phiên bản" count={history.length} />
            {history.length === 0 ? <EmptyState compact icon={<History className="size-5" />} title="Chưa có phiên bản riêng" /> : (
              <ul className="divide-y divide-stone-100">
                {history.map((p) => (
                  <li key={p._id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <span className={cx('grid h-9 min-w-9 shrink-0 place-items-center rounded-lg px-1.5 text-xs font-bold tabular-nums', p.isActive ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600')}>v{p.version}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{fmtDate(p.effectiveFrom)} <span className="text-xs text-stone-500">· {p.createdBy ? userName(db, p.createdBy) : 'Seed'}</span></p>
                      <p className="text-xs text-stone-500">Ân hạn / khóa: {p.gracePeriodDays} / {p.lockoutAfterDays} ngày</p>
                    </div>
                    {p.isActive ? <Badge tone="green" dot>Đang dùng</Badge> : <Badge>Cũ</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <PanelHeader icon={<ShieldCheck className="size-4" />} tone="teal" title="Hạn mức miễn giảm" tip="Số tiền tối đa mỗi vai trò được miễn / xoá nợ / điều chỉnh cho một hợp đồng." />
            <ul className="divide-y divide-stone-100">
              {current.waiverLimits.map((w) => {
                const Icon = ROLE_ICON[w.role === 'FACILITY_MANAGER' ? 'FACILITY_MANAGER' : 'OPS_MANAGER'];
                return (
                  <li key={w.role} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <IconTile icon={<Icon className="size-4" />} size="sm" tone={w.role === 'FACILITY_MANAGER' ? 'teal' : 'violet'} />
                    <span className="min-w-0 flex-1 text-sm text-stone-700">{w.role === 'FACILITY_MANAGER' ? 'QL chi nhánh' : 'QL vận hành'}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{vnd(w.maxAmount)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function toDraft(p: BusinessPolicy) {
  const pctFee = p.lateFees.find((f) => f.kind === 'PERCENT_OF_RENT');
  const fixed = p.lateFees.find((f) => f.kind === 'FIXED');
  return {
    hold: p.reservationHoldMinutes, depositPeriods: p.deposit.value, grace: p.gracePeriodDays, lockout: p.lockoutAfterDays, abandonAfter: p.abandonAfterLockedOutDays,
    latePct: pctFee?.value ?? 0, lateFixed: fixed?.value ?? 0, climatePct: p.surcharges.find((x) => x.code === 'CLIMATE')?.value ?? 0,
    refund72: p.cancellation.find((c) => c.minHoursBeforeStart === 72)?.depositRefundPct ?? 100,
    refund24: p.cancellation.find((c) => c.minHoursBeforeStart === 24)?.depositRefundPct ?? 50,
    earlyRefund25: p.earlyTermination.find((t) => t.maxElapsedPct === 25)?.depositRefundPct ?? 0,
    earlyRefund100: p.earlyTermination.find((t) => t.maxElapsedPct === 100)?.depositRefundPct ?? 100,
    earlyRefund50: p.earlyTermination.find((t) => t.maxElapsedPct === 50)?.depositRefundPct ?? 50,
    feePin: p.accessFees?.PIN_RESET ?? 0, feeCard: p.accessFees?.CARD_REISSUE ?? 50_000, feeKey: p.accessFees?.KEY_REISSUE ?? 0,
    disc3: p.discounts.find((d) => d.minPeriods === 3)?.value ?? 0, disc6: p.discounts.find((d) => d.minPeriods === 6)?.value ?? 0, disc12: p.discounts.find((d) => d.minPeriods === 12)?.value ?? 0,
  };
}
