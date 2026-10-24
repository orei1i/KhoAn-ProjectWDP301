'use client';

import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { BusinessPolicy } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { effectivePolicy, facilityName, userName } from '@/shared/lib/domain';
import { fmtDate, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, CardHeader, Field, PageHeader, Table, cx, inputCls } from '@/shared/ui';

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

  const num = (k: keyof typeof draft, label: string, hint?: string, suffix?: string) => (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input type="number" min={0} className={cx(inputCls, suffix && 'pr-14')} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-500">{suffix}</span>}
      </div>
    </Field>
  );

  return (
    <>
      <PageHeader title="Chính sách vận hành" description="Hợp đồng đã ký giữ nguyên phiên bản lúc ký." actions={
        <select className={cx(inputCls, 'w-auto min-w-56')} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="GLOBAL">Toàn chuỗi (mặc định)</option>
          {db.facilities.filter((f) => !f.isDeleted).map((f) => <option key={f._id} value={f._id}>Riêng: {f.name}</option>)}
        </select>
      } />
      {inherits && <Card className="mb-4 border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">{facilityName(db, facilityId)} đang dùng chính sách toàn chuỗi v{current.version}.</Card>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title={`Đang áp dụng: v${current.version}`} description={`Hiệu lực từ ${fmtDate(current.effectiveFrom)}`} actions={<>
            {facilityId && !inherits && <Button variant="secondary" onClick={revert}>Bỏ chính sách riêng — dùng chính sách chung</Button>}
            <Button onClick={publish}>Phát hành phiên bản mới</Button>
          </>} />
          <div className="space-y-6 p-5">
            <section>
              <h4 className="mb-3 text-sm font-semibold">Đặt chỗ & tiền giữ chân</h4>
              <div className="grid gap-4 sm:grid-cols-3">
                {num('hold', 'Thời gian giữ chỗ', 'Chờ thanh toán tiền giữ chân', 'phút')}
                {num('depositPeriods', 'Tiền giữ chân', 'Tính theo số chu kỳ tiền thuê', 'chu kỳ')}
                {num('climatePct', 'Phụ phí điều hòa (add-on)', 'Trên giá thuê một chu kỳ', '%')}
              </div>
            </section>
            <section>
              <h4 className="mb-3 text-sm font-semibold">Quá hạn & khóa truy cập</h4>
              <div className="grid gap-4 sm:grid-cols-4">
                {num('grace', 'Thời gian ân hạn', undefined, 'ngày')}
                {num('lockout', 'Khóa truy cập sau', undefined, 'ngày')}
                {num('latePct', 'Phí trễ (sau ân hạn)', 'Trên tiền thuê tháng', '%')}
                {num('lateFixed', 'Phí cố định (khi khóa)', undefined, '₫')}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-4">
                {num('abandonAfter', 'Xử lý hàng bỏ lại sau', 'Kể từ thông báo cuối', 'ngày')}
              </div>
            </section>
            <section>
              <h4 className="mb-3 text-sm font-semibold">Hủy đặt chỗ — hoàn tiền giữ chân</h4>
              <div className="grid gap-4 sm:grid-cols-3">
                {num('refund72', 'Hủy trước ≥ 72 giờ', undefined, '%')}
                {num('refund24', 'Hủy trước ≥ 24 giờ', 'Dưới 24 giờ: không hoàn', '%')}
              </div>
            </section>
            <section>
              <h4 className="mb-3 text-sm font-semibold">Trả kho sớm khi đang thuê — hoàn tiền giữ chân</h4>
              <div className="grid gap-4 sm:grid-cols-3">
                {num('earlyRefund25', 'Đã dùng ≤ 25% kỳ hạn', undefined, '%')}
                {num('earlyRefund50', 'Đã dùng ≤ 50% kỳ hạn', undefined, '%')}
                {num('earlyRefund100', 'Đã dùng trên 50% kỳ hạn', undefined, '%')}
              </div>
            </section>
            <section>
              <h4 className="mb-3 text-sm font-semibold">Phí cấp lại phương tiện vào kho</h4>
              <p className="-mt-1 mb-3 text-xs text-stone-500">Từ chối / huỷ thì hoàn đủ. 0 = miễn phí.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                {num('feeCard', 'Làm lại thẻ khoá', undefined, '₫')}
                {num('feeKey', 'Cấp lại chìa khoá', undefined, '₫')}
              </div>
            </section>
            <section>
              <h4 className="mb-3 text-sm font-semibold">Ưu đãi thuê dài hạn</h4>
              <p className="-mt-1 mb-3 text-xs text-stone-500">Chỉ áp cho thuê theo tháng.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                {num('disc3', 'Từ 3 tháng', undefined, '%')}
                {num('disc6', 'Từ 6 tháng', undefined, '%')}
                {num('disc12', 'Từ 12 tháng (1+ năm)', undefined, '%')}
              </div>
            </section>
          </div>
        </Card>

        <Card>
          <CardHeader title="Lịch sử phiên bản" actions={<History className="size-4 text-stone-400" />} />
          <Table rows={history} rowKey={(p) => p._id} columns={[
            { key: 'v', header: 'Bản', cell: (p) => <span className="font-medium">v{p.version}</span> },
            { key: 'e', header: 'Hiệu lực', cell: (p) => <div><p>{fmtDate(p.effectiveFrom)}</p><p className="text-xs text-stone-500">{p.createdBy ? userName(db, p.createdBy) : 'Seed'}</p></div> },
            { key: 'g', header: 'Ân hạn / khóa', cell: (p) => `${p.gracePeriodDays} / ${p.lockoutAfterDays} ngày` },
            { key: 's', header: '', cell: (p) => (p.isActive ? <Badge tone="green">Đang dùng</Badge> : <Badge>Cũ</Badge>) },
          ]} />
          <p className="border-t border-stone-100 px-5 py-3 text-xs text-stone-500">Hạn mức miễn giảm: {current.waiverLimits.map((w) => `${w.role === 'FACILITY_MANAGER' ? 'QL chi nhánh' : 'QL vận hành'} ${vnd(w.maxAmount)}`).join(' · ')}</p>
        </Card>
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
