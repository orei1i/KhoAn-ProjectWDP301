'use client';

import { useState } from 'react';
import {
  Banknote, CalendarDays, CalendarX, Check, CircleCheck, ClipboardCheck, Clock, Hammer, HandCoins, History, Inbox, Landmark, ListChecks, MessageSquareText,
  PackageX, Plus, RotateCcw, Scale, Search, Send, ShieldAlert, ShieldCheck, UserRound, Warehouse, X,
} from 'lucide-react';
import { CLAIM_FM_APPROVAL_LIMIT, claimCapOf, claimHoldEnd, fmtDate as fmtDay, ID_TYPE_LABEL, inventoryOf, type ClaimItem, type ClaimType, type DamageClaim } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CLAIM_STATUS, CLAIM_TYPE } from '@/shared/lib/labels';
import { byId, CLAIM_WINDOW_DAYS, claimIncidentTotal, claimLiability, claimOpsOnly, claimTotal, contractIntakeBatches, typeName, unitLabel, userName } from '@/shared/lib/domain';
import { addDays, fmtDate, todayISO, vnd } from '@/shared/lib/format';
import { Badge, Button, Card, Disclosure, EmptyState, Field, IconTile, Modal, PageHeader, StatusBadge, Table, cx, inputCls } from '@/shared/ui';
import { FacilityPicker, useFacilityScope } from '@/features/facilities/facility-picker';
import { PhotoLinks, PhotoLinksField, parsePhotoLinks } from '@/shared/ui/photo-links';
import { ClaimItemIntakeInfo, ClaimItemTag, ClaimItemsEditor, SealedPackagesWarning, claimItemsError, claimedElsewhereOf, initialClaimItems } from '@/features/claims/claim-items-editor';
import { EMPTY_PAYOUT_ID, PayoutIdFields, claimCreatorId, payoutIdPayload, payoutIdReady, type PayoutIdForm } from '@/features/claims/payout-id-fields';
import { Callout, Chip, ChipRow, Fact, FactGrid, Ledger, LedgerRow, Meta, PillFilter, QueueRow, Segmented } from '@/features/staff-ui';
import { Section, TextBlock, Timeline } from '@/features/backoffice-ui';

/** Loại sự cố → icon (chỉ để trình bày). */
const CLAIM_TYPE_ICON = { DAMAGE: Hammer, LOSS: PackageX } as const;

type Tab = 'new' | 'review' | 'approved' | 'done';
const newForm = () => ({ contractId: '', type: 'DAMAGE' as ClaimType, incidentAt: todayISO().slice(0, 10), description: '', items: [] as ClaimItem[], photos: '' });

const TAB_STATUS: Record<Tab, DamageClaim['status'][]> = {
  new: ['SUBMITTED'],
  review: ['UNDER_REVIEW'],
  approved: ['APPROVED'],
  done: ['PAID', 'REJECTED', 'WITHDRAWN'],
};

export default function ManagerClaims() {
  const { db, user, run } = useStore();
  const scope = useFacilityScope();
  const fid = scope.facilityId;
  const [tab, setTab] = useState<Tab>('new');
  const [view, setView] = useState<DamageClaim | null>(null);
  const [decision, setDecision] = useState({ amount: 0, note: '' });
  const [payMethod, setPayMethod] = useState<'BANK_TRANSFER' | 'CASH'>('BANK_TRANSFER');
  const [payId, setPayId] = useState<PayoutIdForm>(EMPTY_PAYOUT_ID);
  // Lập hồ sơ hộ khách tại quầy — hồ sơ đứng tên khách của hợp đồng.
  const [filing, setFiling] = useState(false);
  const [form, setForm] = useState(newForm);
  // Đợt 17 (C1): mở lại / duyệt mà số lượng vượt số còn đòi được (422 CLAIM_OVER_DECLARED) — giữ câu báo ngay trong hồ sơ, không chỉ toast.
  const [overDeclared, setOverDeclared] = useState<{ claimId: string; message: string } | null>(null);

  const all = db.claims.filter((c) => c.facilityId === fid);
  const rows = all.filter((c) => TAB_STATUS[tab].includes(c.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const c = view ? db.claims.find((x) => x._id === view._id) ?? null : null;

  // Điều 6: mức trách nhiệm = 10 × giá thuê tháng của ô kho; một SỰ VỤ = các hồ sơ cùng hợp đồng, cùng ngày sự cố (hoặc cùng phiếu
  // sự cố) — dùng chung helper với trang Vận hành để hai nơi cùng quy tắc với BE.
  const liability = (x: DamageClaim) => claimLiability(db, x);
  const incidentClaimed = (x: DamageClaim) => claimIncidentTotal(db, x);
  const opsOnly = (x: DamageClaim) => user?.role === 'FACILITY_MANAGER' && claimOpsOnly(db, x);
  const cap = (x: DamageClaim) => Math.min(x.claimedAmount, liability(x));
  const openClaim = (x: DamageClaim) => {
    setDecision({ amount: x.review?.approvedAmount || Math.min(cap(x), CLAIM_FM_APPROVAL_LIMIT), note: '' });
    setPayId(EMPTY_PAYOUT_ID);
    setOverDeclared((o) => (o?.claimId === x._id ? o : null));
    setView(x);
  };
  const decisionValid = c ? decision.note.trim().length >= 5 : false;
  const overMyLimit = user?.role === 'FACILITY_MANAGER' && decision.amount > CLAIM_FM_APPROVAL_LIMIT;
  const iApproved = !!c && !!user && c.review?.reviewedBy === user._id;
  const iCreated = !!c && !!user && claimCreatorId(c) === user._id; // lập hộ khách thì không tự duyệt, không tự chi tiền mặt
  // Cảnh báo cho người xét (A5, A9): món nhập sau ngày sự cố / hư lúc nhập / đồ ngoài danh sách trùng món đã khai.
  const flagged = c ? c.items.filter((it) => it.flag) : [];
  const transferPending = !!c?.settlement && !c.settlement.paidAt;
  // BE tự kiểm: hồ sơ do vận hành quyết / khoản lớn thì chỉ vận hành mở lại — bị từ chối thì run() hiện lỗi của BE.
  const reopen = async (x: DamageClaim) => {
    const res = await run('reviewClaim', { claimId: x._id }, 'Đã mở lại — hồ sơ chuyển sang xác minh');
    if (!res.ok && res.code === 'CLAIM_OVER_DECLARED') { setOverDeclared({ claimId: x._id, message: res.error }); openClaim(x); } else setOverDeclared(null);
  };
  const approve = async (x: DamageClaim) => {
    const res = await run('decideClaim', { claimId: x._id, approve: true, approvedAmount: decision.amount, note: decision.note }, `Đã duyệt ${vnd(decision.amount)} — chuyển sang chờ chi`);
    setOverDeclared(!res.ok && res.code === 'CLAIM_OVER_DECLARED' ? { claimId: x._id, message: res.error } : null);
  };

  // Hợp đồng còn mở, hoặc đã đóng (trừ thanh lý hàng bỏ lại) trong vòng 30 ngày — cùng điều kiện khách tự gửi.
  const eligible = db.contracts.filter((x) => x.facilityId === fid && x.status !== 'ABANDONED' && (x.status !== 'CLOSED' || (x.closedAt ?? '') >= addDays(todayISO(), -CLAIM_WINDOW_DAYS)))
    .sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId)));
  const fc = byId(db.contracts, form.contractId);
  const formTotal = claimTotal(form.items);
  const formCap = claimCapOf(fc, db.unitTypes, `${form.incidentAt}T00:00:00.000Z`);
  // Ngày sự cố: không trước ngày bắt đầu thuê, không quá 30 ngày, không ở tương lai (như BE).
  const minIncident = [addDays(todayISO(), -CLAIM_WINDOW_DAYS).slice(0, 10), fc?.startDate.slice(0, 10) ?? ''].sort().pop()!;
  // … và không sau ngày trả kho (A2): tối đa = min(hôm nay, ngày trả kho).
  const fcHoldEnd = fc ? claimHoldEnd(fc) : null;
  const maxIncident = [todayISO().slice(0, 10), fcHoldEnd ?? '9999-12-31'].sort()[0];
  const formPhotos = parsePhotoLinks(form.photos);
  // Đồ đang gửi của hợp đồng (đợt nhập đã xác nhận) — chọn hạng mục từ đây; đồ ngoài danh sách có nhãn, cần chứng cứ.
  const inventoryFor = (contractId: string) => (contractId ? inventoryOf(contractIntakeBatches(db, contractId)).items : []);
  const formInventory = inventoryFor(form.contractId);
  const formCtx = { incidentDay: form.incidentAt, claimedElsewhere: claimedElsewhereOf(db.claims, form.contractId) };
  const formItemsErr = claimItemsError(form.items, formInventory, formCtx);
  const formValid = !!fc && form.description.trim().length >= 10 && formTotal > 0 && formPhotos.ok && form.incidentAt >= minIncident && form.incidentAt <= maxIncident && !formItemsErr;

  return (
    <>
      <PageHeader
        title="Bồi thường hư hỏng & mất mát"
        description={(
          <span className="mt-1 flex flex-wrap gap-1.5">
            <Chip icon={<Scale />}>Tối đa 10 tháng tiền thuê của ô (Điều 6)</Chip>
            <Chip icon={<ShieldCheck />} tone="teal">Quản lý chi nhánh duyệt tới {vnd(CLAIM_FM_APPROVAL_LIMIT)}</Chip>
            <Chip icon={<UserRound />} tone="amber">Người duyệt không tự chi</Chip>
          </span>
        )}
        actions={<><FacilityPicker scope={scope} /><Button onClick={() => { setForm(newForm()); setFiling(true); }}><Plus className="size-4" />Lập hồ sơ hộ khách</Button></>}
      />

      <PillFilter value={tab} onChange={setTab} options={[
        { key: 'new', label: 'Chờ tiếp nhận', icon: <Inbox />, count: all.filter((x) => x.status === 'SUBMITTED').length },
        { key: 'review', label: 'Đang xác minh', icon: <Search />, count: all.filter((x) => x.status === 'UNDER_REVIEW').length },
        { key: 'approved', label: 'Đã duyệt, chờ chi', icon: <Banknote />, count: all.filter((x) => x.status === 'APPROVED').length },
        { key: 'done', label: 'Đã kết thúc', icon: <CircleCheck />, count: all.filter((x) => TAB_STATUS.done.includes(x.status)).length },
      ]} />

      <Card className="mt-4">
        {rows.length === 0 ? <EmptyState icon={<HandCoins className="size-6" />} title="Không có hồ sơ trong mục này" /> : (
          <ul className="divide-y divide-stone-100">
            {rows.map((x) => {
              const Icon = CLAIM_TYPE_ICON[x.type];
              return (
                <QueueRow key={x._id} onSelect={() => openClaim(x)}
                  lead={<IconTile icon={<Icon className="size-4" />} tone={x.type === 'LOSS' ? 'red' : 'amber'} />}
                  title={userName(db, x.customerId)}
                  badges={<><StatusBadge map={CLAIM_STATUS} value={x.status} /><Badge tone={x.type === 'LOSS' ? 'red' : 'amber'}>{CLAIM_TYPE[x.type]}</Badge></>}
                  meta={<>
                    <Meta mono>{x.claimNumber}</Meta>
                    <Meta icon={<Warehouse />}>Kho {unitLabel(db, x.unitId)}</Meta>
                    <Meta icon={<CalendarDays />}>{fmtDate(x.createdAt)}</Meta>
                    <Meta icon={<HandCoins />}>Yêu cầu <b className="font-semibold text-stone-700">{vnd(x.claimedAmount)}</b></Meta>
                    {x.review && <Meta icon={<Check />} className="text-emerald-700">Duyệt <b className="font-semibold">{vnd(x.review.approvedAmount)}</b></Meta>}
                  </>}
                  actions={(x.status === 'SUBMITTED' || x.status === 'APPROVED' || x.status === 'REJECTED') && <>
                    {x.status === 'SUBMITTED' && <Button size="sm" variant="secondary" onClick={() => run('reviewClaim', { claimId: x._id }, 'Đã tiếp nhận — hồ sơ chuyển sang xác minh')}><Search className="size-3.5" />Tiếp nhận</Button>}
                    {x.status === 'APPROVED' && <Button size="sm" onClick={() => openClaim(x)}><Banknote className="size-3.5" />Chi tiền</Button>}
                    {x.status === 'REJECTED' && <Button size="sm" variant="ghost" onClick={() => void reopen(x)}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>}
                  </>}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={!!c} onClose={() => setView(null)} size="lg" title={`Hồ sơ ${c?.claimNumber ?? ''}`}
        description={c ? `${userName(db, c.customerId)} · kho ${unitLabel(db, c.unitId)} · ${CLAIM_TYPE[c.type]}` : ''}>
        {c && (
          <div className="space-y-5">
            <ChipRow>
              <StatusBadge map={CLAIM_STATUS} value={c.status} />
              <Chip icon={<UserRound />}>{userName(db, c.customerId)}</Chip>
              <Chip icon={<Warehouse />}>Kho {unitLabel(db, c.unitId)}</Chip>
              <Chip icon={c.type === 'LOSS' ? <PackageX /> : <Hammer />} tone={c.type === 'LOSS' ? 'red' : 'amber'}>{CLAIM_TYPE[c.type]}</Chip>
            </ChipRow>

            <FactGrid>
              <Fact icon={<CalendarX className="size-4" />} label="Ngày sự cố">{fmtDate(c.incidentAt)}</Fact>
              <Fact icon={<Send className="size-4" />} label="Ngày gửi">{fmtDate(c.createdAt)}</Fact>
              <Fact icon={<HandCoins className="size-4" />} label="Khách yêu cầu" tone="amber">{vnd(c.claimedAmount)}</Fact>
              <Fact icon={<Scale className="size-4" />} label="Mức trách nhiệm (Điều 6)" tone="blue">{vnd(liability(c))}</Fact>
              <Fact icon={<ShieldCheck className="size-4" />} label="Trần duyệt được" tone="teal">{vnd(cap(c))}</Fact>
            </FactGrid>

            <Section icon={<MessageSquareText />} title="Khách mô tả">
              <TextBlock>{c.description}</TextBlock>
              {c.photoUrls?.length > 0 && <PhotoLinks urls={c.photoUrls} />}
            </Section>

            <Section icon={<ListChecks />} title="Hạng mục khai báo">
              {flagged.length > 0 && (
                <Callout tone={flagged.some((it) => it.flag === 'AFTER_INCIDENT') ? 'red' : 'amber'} icon={<ShieldAlert />} title={`${flagged.length} hạng mục cần xét kỹ`}>
                  {flagged.map((it, i) => (
                    <span key={i} className="block">
                      <b>{it.name}</b>: {it.flag === 'AFTER_INCIDENT' ? `nhập kho ${fmtDate(it.intakeConfirmedAt)} — sau ngày sự cố ${fmtDate(c.incidentAt)}`
                        : it.flag === 'DAMAGED_AT_INTAKE' ? 'đã hư lúc nhập kho'
                          : it.matchedItem ? `trùng món đã khai: ${it.matchedItem.name} — giá trị khai ${vnd(it.matchedItem.estValue)}` : 'trùng món đã khai'}
                    </span>
                  ))}
                </Callout>
              )}
              <SealedPackagesWarning claimId={c._id} />
              {overDeclared?.claimId === c._id && <Callout tone="red" icon={<ShieldAlert />} title="Số lượng vượt số còn đòi được">{overDeclared.message}. Hồ sơ không đổi — xem lại với khách hoặc từ chối.</Callout>}
              <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-stone-200">
                <Table rows={c.items} rowKey={(it) => `${it.name}-${it.quantity}-${it.unitValue}`} columns={[
                  { key: 'n', header: 'Tài sản', cell: (it) => <div><p className="flex flex-wrap items-center gap-1.5">{it.name}<ClaimItemTag item={it} /></p><ClaimItemIntakeInfo item={it} />{it.note && <p className="text-xs text-stone-500">{it.note}</p>}</div> },
                  { key: 'q', header: 'SL', className: 'tabular-nums', cell: (it) => it.quantity },
                  { key: 'u', header: 'Đơn giá', className: 'text-right tabular-nums', cell: (it) => vnd(it.unitValue) },
                  { key: 'v', header: 'Thành tiền', className: 'text-right tabular-nums', cell: (it) => vnd(it.quantity * it.unitValue) },
                ]} />
              </div>
            </Section>

            {c.review && (
              <Callout tone={c.review.approvedAmount > 0 ? 'green' : 'red'} icon={c.review.approvedAmount > 0 ? <Check /> : <X />}
                title={`Đã quyết định ${fmtDate(c.review.reviewedAt)} · ${userName(db, c.review.reviewedBy)}`}>
                <p className="whitespace-pre-line">{c.review.decisionNote}</p>
                <p className="mt-1.5">Duyệt <b>{vnd(c.review.approvedAmount)}</b> <span className="opacity-75">/ mức trách nhiệm {vnd(c.review.liabilityCap)}</span></p>
              </Callout>
            )}

            {/* ---- hành động theo trạng thái ---- */}
            {c.status === 'SUBMITTED' && (
              <Callout tone="teal" icon={<Search />} title="Tiếp nhận và xác minh hiện trường trước khi duyệt chi."
                action={<Button size="sm" onClick={() => run('reviewClaim', { claimId: c._id }, 'Đã chuyển sang xác minh')}><Search className="size-3.5" />Tiếp nhận xác minh</Button>} />
            )}

            {(c.status === 'UNDER_REVIEW' || c.status === 'SUBMITTED') && opsOnly(c) && (
              <Callout tone="amber" icon={<ShieldAlert />}>
                Giá trị xét {vnd(Math.min(incidentClaimed(c), liability(c)))} — trên {vnd(CLAIM_FM_APPROVAL_LIMIT)}, Quản lý vận hành duyệt.
              </Callout>
            )}

            {(c.status === 'UNDER_REVIEW' || c.status === 'SUBMITTED') && !opsOnly(c) && (
              <Section icon={<ClipboardCheck />} title="Quyết định" className="border-t border-stone-100 pt-4">
                <div className={cx('grid gap-4', c.status === 'UNDER_REVIEW' && 'sm:grid-cols-[minmax(0,13rem)_1fr]')}>
                  {c.status === 'UNDER_REVIEW' && (
                    <Field label="Số tiền duyệt (VND)" hint={`Tối đa ${vnd(cap(c))}.`}>
                      <input type="number" min={0} max={cap(c)} step={10_000} className={inputCls} value={decision.amount}
                        onChange={(e) => setDecision((d) => ({ ...d, amount: Math.max(0, Math.min(cap(c), Number(e.target.value) || 0)) }))} />
                    </Field>
                  )}
                  <Field label="Căn cứ quyết định" tip="Khách đọc được.">
                    <textarea className={inputCls} rows={3} value={decision.note} onChange={(e) => setDecision((d) => ({ ...d, note: e.target.value }))}
                      placeholder="VD: Đã kiểm tra hiện trường 12/9, trần thấm do lỗi bảo trì của kho. Duyệt 80% giá trị khai báo theo khấu hao." />
                  </Field>
                </div>
                {iCreated && <Callout tone="amber" icon={<UserRound />}>Bạn lập hồ sơ này — người khác duyệt.</Callout>}
                {overMyLimit && (
                  <Callout tone="amber" icon={<ShieldAlert />}>
                    Trên {vnd(CLAIM_FM_APPROVAL_LIMIT)} cần Quản lý vận hành duyệt; bạn vẫn duyệt được mức thấp hơn hoặc từ chối.
                  </Callout>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="danger" disabled={!decisionValid}
                    onClick={() => run('decideClaim', { claimId: c._id, approve: false, note: decision.note }, 'Đã từ chối hồ sơ')}>
                    <X className="size-4" />Từ chối
                  </Button>
                  {c.status === 'UNDER_REVIEW' && (
                    <Button disabled={!decisionValid || decision.amount <= 0 || overMyLimit || iCreated}
                      onClick={() => void approve(c)}>
                      <Check className="size-4" />Duyệt {vnd(decision.amount)}
                    </Button>
                  )}
                </div>
              </Section>
            )}

            {c.status === 'REJECTED' && (
              <div className="flex justify-end border-t border-stone-100 pt-4">
                <Button size="sm" variant="secondary" onClick={() => void reopen(c)}><RotateCcw className="size-3.5" />Mở lại xem xét</Button>
              </div>
            )}

            {c.status === 'APPROVED' && transferPending && (
              <Callout tone="amber" icon={<Clock />} title={`Đã lập lệnh chuyển khoản ${vnd(c.review?.approvedAmount ?? 0)} — chờ xác nhận đã chuyển.`}>
                {(iApproved || iCreated) && `Bạn ${iApproved ? 'đã duyệt' : 'lập'} hồ sơ — người khác phải xác nhận.`}
              </Callout>
            )}

            {c.status === 'APPROVED' && !transferPending && (
              <Section icon={<Banknote />} title="Chi tiền bồi thường" className="border-t border-stone-100 pt-4">
                <Segmented<'BANK_TRANSFER' | 'CASH'> label="Hình thức chi" value={payMethod} onChange={setPayMethod}
                  options={[{ value: 'BANK_TRANSFER', label: 'Chuyển khoản', icon: <Landmark /> }, { value: 'CASH', label: 'Tiền mặt tại quầy', icon: <Banknote /> }]} />
                {payMethod === 'CASH' && iApproved && <Callout tone="amber" icon={<UserRound />}>Bạn đã duyệt — tiền mặt do người khác chi.</Callout>}
                {payMethod === 'CASH' && !iApproved && iCreated && <Callout tone="amber" icon={<UserRound />}>Bạn lập hồ sơ này — tiền mặt do người khác chi.</Callout>}
                {payMethod === 'CASH' && !iApproved && !iCreated && <PayoutIdFields contract={byId(db.contracts, c.contractId)} customerName={userName(db, c.customerId)} value={payId} onChange={setPayId} />}
                <div className="flex justify-end">
                  <Button disabled={payMethod === 'CASH' && (iApproved || iCreated || !payoutIdReady(payId))}
                    onClick={() => run('payClaim', { claimId: c._id, method: payMethod, ...(payMethod === 'CASH' ? payoutIdPayload(payId) : {}) }, (v) => (v.pending ? `Đã lập lệnh chuyển khoản ${vnd(v.amount)} — chờ xác nhận đã chuyển` : `Đã chi ${vnd(v.amount)} cho khách`), () => setView(null))}>
                    <Banknote className="size-4" />{payMethod === 'CASH' ? `Chi ${vnd(c.review?.approvedAmount ?? 0)} tiền mặt` : `Lập lệnh chuyển khoản ${vnd(c.review?.approvedAmount ?? 0)}`}
                  </Button>
                </div>
              </Section>
            )}

            {c.settlement?.paidAt && (
              <Callout tone="green" icon={<CircleCheck />}>
                Đã chi {fmtDate(c.settlement.paidAt)} qua {c.settlement.method === 'CASH' ? 'tiền mặt tại quầy' : 'chuyển khoản'}.
                {c.settlement.recipient && (
                  <span className="mt-1 block">
                    Người nhận {c.settlement.recipient.name} · {ID_TYPE_LABEL[c.settlement.recipient.idType]}{c.settlement.recipient.idNumberLast4 ? ` …${c.settlement.recipient.idNumberLast4}` : ''} · chi bởi {userName(db, c.settlement.recipient.by)}
                  </span>
                )}
              </Callout>
            )}

            <Disclosure icon={<History className="size-4" />} title="Lịch sử xử lý" meta={`${c.statusHistory.length} bước`}>
              <Timeline items={c.statusHistory.map((h) => ({
                at: fmtDate(h.at),
                title: <>{h.from ? `${CLAIM_STATUS[h.from].label} → ` : ''}{CLAIM_STATUS[h.to].label}</>,
                note: [h.by ? userName(db, h.by) : '', h.reason ?? ''].filter(Boolean).join(' · ') || undefined,
                tone: CLAIM_STATUS[h.to].tone,
              }))} />
            </Disclosure>
          </div>
        )}
      </Modal>

      <Modal open={filing} onClose={() => setFiling(false)} size="lg" title="Lập hồ sơ bồi thường hộ khách" description={`Tổng khai báo: ${vnd(formTotal)}`}
        footer={<Button disabled={!formValid} onClick={() => void run('createClaim', {
          // Ngày thuần YYYY-MM-DD theo giờ Việt Nam — BE so theo NGÀY.
          contractId: form.contractId, type: form.type, incidentAt: form.incidentAt, description: form.description.trim(), items: form.items, photoUrls: formPhotos.urls,
        }, (x) => `Đã lập hồ sơ ${x.claimNumber}`, () => setFiling(false))}>Lập hồ sơ</Button>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hợp đồng / kho" className="sm:col-span-2">
              <select className={inputCls} value={form.contractId} onChange={(e) => { const id = e.target.value; const k = byId(db.contracts, id); const end = k ? claimHoldEnd(k) : null; setForm((f) => ({ ...f, contractId: id, incidentAt: end && end < f.incidentAt ? end : f.incidentAt, items: initialClaimItems(inventoryFor(id)) })); }}>
                <option value="">— Chọn hợp đồng —</option>
                {eligible.map((x) => <option key={x._id} value={x._id}>{unitLabel(db, x.unitId)} · {userName(db, x.customerId)} · {typeName(db, x.unitTypeId)}{x.status === 'CLOSED' ? ' · đã đóng' : ''}</option>)}
              </select>
            </Field>
            <Field label="Loại sự cố">
              <select className={inputCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ClaimType }))}>
                <option value="DAMAGE">{CLAIM_TYPE.DAMAGE}</option>
                <option value="LOSS">{CLAIM_TYPE.LOSS}</option>
              </select>
            </Field>
            <Field label="Ngày xảy ra / phát hiện" hint={fcHoldEnd ? `Kho đã trả ngày ${fmtDay(fcHoldEnd)} — chỉ nhận sự cố đến ngày này` : undefined}>
              <input type="date" className={inputCls} max={maxIncident} min={minIncident}
                value={form.incidentAt} onChange={(e) => setForm((f) => ({ ...f, incidentAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Diễn biến" hint="Tối thiểu 10 ký tự.">
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <PhotoLinksField value={form.photos} onChange={(v) => setForm((f) => ({ ...f, photos: v }))} />
          <div>
            <ClaimItemsEditor items={form.items} onChange={(items) => setForm((f) => ({ ...f, items }))} inventory={formInventory} ctx={formCtx} />
            {formItemsErr && form.items.length > 0 && <p className="mt-1 text-xs text-red-600">{formItemsErr}</p>}
            <Ledger className="mt-3">
              {formCap !== null && <LedgerRow icon={<Scale />} label="Mức trách nhiệm (Điều 6)" value={vnd(formCap)} />}
              <LedgerRow total label="Tổng khai báo" value={<span className={cx(formCap !== null && formTotal > formCap && 'text-amber-700')}>{vnd(formTotal)}</span>} />
            </Ledger>
          </div>
        </div>
      </Modal>
    </>
  );
}
