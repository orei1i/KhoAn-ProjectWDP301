import { Fragment, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AccessMethod, PaymentType, Tone } from '@ssm/shared';
import {
  ACCESS_METHOD, ACCESS_REQUEST_STATUS, CONTRACT_NOTICE, CONTRACT_STATUS, DEPOSIT_STATUS, HANDOVER_METHOD, LEFTOVER_STATUS, NOTICE_EMAIL_STATUS, PAYMENT_TYPE, OPEN_CONTRACT_STATUSES, delinquencyAlert, fmtDateTime, isClosedContract, PERIOD_UNIT, SWAP_REQUEST_STATUS,
  billingDue, billingDueRows, canDeclareIntake, canDisputeInspection, DAMAGE_SEVERITY_LABEL, fmtDate, INSPECTION_DISPUTE_DAYS, inventoryOf, ITEM_CONDITION_LABEL, lastDayOf, vnd,
} from '@ssm/shared';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Callout, Card, Disclosure, EmptyState, IconTile, Input, KV, ListGroup, ListRow, PhotoBanner, Screen, ScreenHeader, SectionHeader, StatusBadge, TermProgress } from '../../shared/ui';
import { C, R, S, SHADOW, T } from '../../shared/ui/theme';
import { categoryPhoto } from '../../shared/ui/visuals';
import { AppendixText } from './appendix-text';
import { contractSwaps, swapEndedAt } from './swap-status';
import { payHref } from '../payments/pay-intent';

type Icon = keyof typeof Ionicons.glyphMap;
const ACCESS_ICON: Record<AccessMethod, Icon> = { PIN: 'keypad-outline', RFID_CARD: 'card-outline', PHYSICAL_KEY: 'key-outline' };
/** Một lối vào màn riêng của một thao tác; `status` là trạng thái ngắn hiện ngay dưới tên. */
interface Action { key: string; icon: Icon; title: string; status?: string; tone?: Tone; href: string; show: boolean }

export default function ContractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, run, toast } = useStore();
  const router = useRouter();
  const [dispute, setDispute] = useState('');
  const [openAppendix, setOpenAppendix] = useState<number | null>(null);

  const c = byId(db.contracts, id);
  if (!c) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title="Không tìm thấy hợp đồng"
          action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const rsv = byId(db.reservations, c.reservationId) ?? db.reservations.find((x) => x.contractId === c._id);
  const openPhoto = (url: string) => { Linking.openURL(url).catch(() => toast('Không mở được ảnh', 'error')); };
  // Hợp đồng đã đóng còn nợ: nói đúng khoản đang chờ thu (nợ sau quyết toán, phí xử lý đồ để lại…) theo các khoản thanh toán chờ.
  const debtTypes = [...new Set(db.payments.filter((p) => p.contractId === c._id && p.direction === 'CHARGE' && p.status === 'PENDING').map((p) => p.type))];
  const closedDebtText = debtTypes.length ? debtTypes.map((t) => DEBT_PART[t] ?? PAYMENT_TYPE[t].label.toLowerCase()).join(' và ') : DEBT_PART.SETTLEMENT_DEBT;

  // Gia hạn / trả kho / đổi ô / dịch vụ thêm mỗi thứ một màn riêng — ở đây chỉ là danh sách lối vào kèm trạng thái ngắn.
  // Gia hạn, đổi ô, đặt dịch vụ chỉ khi hợp đồng đang hiệu lực; việc còn dở (yêu cầu đổi ô, đơn dịch vụ chờ) thì vẫn hiện để xem / rút.
  const open = OPEN_CONTRACT_STATUSES.includes(c.status);
  const active = c.status === 'ACTIVE';
  const accessReq = db.accessRequests.find((r) => r.contractId === c._id && (r.status === 'REQUESTED' || r.status === 'APPROVED'));
  const { openSwap, recentSwap } = contractSwaps(db.swapRequests, c._id);
  const swap = openSwap ?? recentSwap;
  const pendingOrders = db.serviceOrders.filter((o) => o.contractId === c._id && o.status === 'REQUESTED').length;
  // Đồ đang gửi = các đợt nhập đã xác nhận; đợt vừa khai thì chờ nhân viên kiểm hàng tại quầy.
  const intakes = db.intakeBatches.filter((b) => b.contractId === c._id);
  const inventory = inventoryOf(intakes);
  const declaredIntakes = intakes.filter((b) => b.status === 'DECLARED').length;
  const actions: Action[] = [
    {
      key: 'access', icon: ACCESS_ICON[c.access.method], title: 'Mã vào kho', href: `/contract/access?contract=${c._id}`, show: open,
      status: accessReq ? `Yêu cầu cấp lại: ${ACCESS_REQUEST_STATUS[accessReq.status].label.toLowerCase()}` : ACCESS_METHOD[c.access.method],
      tone: accessReq ? ACCESS_REQUEST_STATUS[accessReq.status].tone : undefined,
    },
    {
      key: 'extend', icon: 'calendar-outline', title: 'Gia hạn hợp đồng', href: `/contract/extend?contract=${c._id}`, show: active,
      status: `Hết hạn ngày ${fmtDate(lastDayOf(c.endDate))}`,
    },
    {
      key: 'move-out', icon: 'exit-outline', title: active ? 'Đăng ký trả kho' : 'Trả kho', href: `/contract/move-out?contract=${c._id}`,
      show: active || c.status === 'MOVE_OUT_PENDING',
      status: c.status !== 'MOVE_OUT_PENDING' ? 'Chọn ngày bàn giao kho'
        : c.access.revokedAt ? 'Đã bàn giao — chờ kiểm tra' : `Đã đăng ký trả kho ngày ${fmtDate(c.moveOut?.scheduledFor)}`,
      tone: c.status === 'MOVE_OUT_PENDING' ? 'violet' : undefined,
    },
    {
      key: 'swap', icon: 'swap-horizontal-outline', title: 'Đổi ô kho', href: `/contract/swap?contract=${c._id}`, show: active || !!swap,
      status: openSwap?.status === 'SUBMITTED' ? 'Có yêu cầu đổi ô đang chờ duyệt'
        : swap ? `Yêu cầu ${swap.requestNumber}: ${SWAP_REQUEST_STATUS[swap.status].label.toLowerCase()}${recentSwap ? ` · ${fmtDate(swapEndedAt(recentSwap))}` : ''}`
        : 'Chuyển đồ sang ô khác',
      tone: swap ? SWAP_REQUEST_STATUS[swap.status].tone : undefined,
    },
    {
      key: 'intake', icon: 'archive-outline', title: 'Đồ đang gửi / Nhập hàng', href: `/contract/intake?contract=${c._id}`,
      show: canDeclareIntake(c) || intakes.length > 0,
      status: declaredIntakes > 0 ? `${declaredIntakes} đợt nhập chờ xác nhận`
        : inventory.items.length > 0 ? `${inventory.items.length} món · ${vnd(inventory.totalValue)}` : 'Khai đồ mỗi lần mang vào kho',
      tone: declaredIntakes > 0 ? 'amber' : undefined,
    },
    {
      key: 'services', icon: 'cube-outline', title: 'Dịch vụ thêm', href: `/contract/services?contract=${c._id}`, show: active || pendingOrders > 0,
      status: pendingOrders > 0 ? `${pendingOrders} đơn chờ thực hiện` : 'Đóng gói, vận chuyển…',
      tone: pendingOrders > 0 ? 'amber' : undefined,
    },
  ];
  const help: Action[] = [
    { key: 'ticket', icon: 'alert-circle-outline', title: 'Báo sự cố', href: `/ticket/new?contract=${c._id}`, show: open },
    { key: 'claim', icon: 'cash-outline', title: 'Yêu cầu bồi thường', href: `/claim/new?contract=${c._id}`, show: open },
  ];
  const openAction = (href: string) => router.push(href);
  const category = byId(db.unitTypes, c.unitTypeId)?.category;
  const payDebt = () => router.push(payHref({
    target: { kind: 'BALANCE', contractId: c._id }, facilityId: c.facilityId, code: c.contractNumber,
    purpose: isClosedContract(c.status) ? 'Nợ sau quyết toán' : 'Thanh toán công nợ', amount: c.balance.outstanding,
    doneNote: isClosedContract(c.status) ? 'Đã thanh toán khoản nợ sau quyết toán.' : c.status === 'LOCKED_OUT' || c.status === 'DELINQUENT' ? 'Truy cập kho được khôi phục.' : undefined,
    back: { label: 'Về hợp đồng', href: `/contract/${c._id}` },
  }));

  return (
    <Screen>
      <ScreenHeader icon="document-text-outline" title={`Hợp đồng ${c.contractNumber}`} subtitle={facilityName(db, c.facilityId)} right={<StatusBadge map={CONTRACT_STATUS} value={c.status} />} />

      <View style={st.summary}>
        <PhotoBanner source={categoryPhoto(category)} height={OPEN_CONTRACT_STATUSES.includes(c.status) ? 150 : 112} accessibilityLabel={`Ảnh minh hoạ ${typeName(db, c.unitTypeId)}`}>
          <View style={st.heroRow}>
            <View style={st.unitChip}><Text style={st.unitChipText} numberOfLines={1} adjustsFontSizeToFit>{unitLabel(db, c.unitId)}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.heroTitle} numberOfLines={1}>{typeName(db, c.unitTypeId)}</Text>
              <Text style={st.heroSub} numberOfLines={1}>{vnd(c.billing.rate)}/{PERIOD_UNIT[c.billing.rentalPeriod]}</Text>
            </View>
          </View>
          {OPEN_CONTRACT_STATUSES.includes(c.status) && <TermProgress start={c.startDate} end={c.endDate} onDark style={{ marginTop: S.md }} />}
        </PhotoBanner>
        <View style={{ padding: S.lg }}>
          <KV items={[
            ['Kho', `${unitLabel(db, c.unitId)} · ${typeName(db, c.unitTypeId)}`],
            ['Chi nhánh', facilityName(db, c.facilityId)],
            ['Thời hạn', `${fmtDate(c.startDate)} → hết ngày ${fmtDate(lastDayOf(c.endDate))}`],
            ['Tiền thuê', `${vnd(c.billing.rate)}/${PERIOD_UNIT[c.billing.rentalPeriod]}`],
            // Hợp đồng đã đóng không còn kỳ thanh toán nào — chỉ còn (nếu có) khoản nợ sau quyết toán ở dòng Công nợ.
            // Đang nợ: số đang nợ + hạn chót trước khi bị tính phí trễ (theo paidThrough, như job) — không lấy nextBillingDate, vì
            // xuất hoá đơn xong job đã đẩy nó sang kỳ sau. Kỳ tới: đúng số sẽ thu (hết cam kết thì giá chưa ưu đãi). Cùng câu với Webapp.
            ...(OPEN_CONTRACT_STATUSES.includes(c.status) ? billingDueRows(billingDue(c)) : []),
            ['Phương thức truy cập', ACCESS_METHOD[c.access.method]],
            ['Tiền giữ chân', `${vnd(c.deposit.amount)} · ${DEPOSIT_STATUS[c.deposit.status].label}`],
            ['Công nợ', c.balance.outstanding > 0
              ? <Text key="o" style={{ color: C.red, fontWeight: '700' }}>{vnd(c.balance.outstanding)}</Text>
              : 'Không có'],
          ]} />
        </View>
      </View>

      {(() => {
        const alert = delinquencyAlert(c);
        return alert ? (
          <Callout tone={alert.tone === 'red' ? 'red' : 'amber'} title={alert.title} style={{ marginTop: S.md }}>{alert.text}</Callout>
        ) : null;
      })()}

      {/* Trả online qua cổng thanh toán (giả lập) — chọn hình thức ở cổng. */}
      {c.balance.outstanding > 0 && (
        <Callout tone="red" icon="wallet-outline" style={{ marginTop: S.md }}
          title={isClosedContract(c.status) ? 'Nợ còn lại sau quyết toán' : 'Thanh toán công nợ'}
          action={<Button title={`Thanh toán ${vnd(c.balance.outstanding)}`} icon="card-outline" onPress={payDebt} />}>
          {vnd(c.balance.outstanding)}{isClosedContract(c.status) ? (c.status === 'ABANDONED' ? ' — tiền giữ chân và tiền thanh lý chưa đủ bù công nợ.' : ` — ${closedDebtText}.`) + ' Thanh toán xong mới đặt kho mới được.' : ''}
        </Callout>
      )}

      <ActionList title="Quản lý kho" icon="options-outline" items={actions} onOpen={openAction} />

      {(c.notices?.length ?? 0) > 0 && (
        <>
          <SectionHeader title="Thông báo từ KhoAn" icon="notifications-outline" count={Math.min(5, c.notices?.length ?? 0)} />
          <Card style={{ paddingVertical: S.sm }}>
            {[...(c.notices ?? [])].reverse().slice(0, 5).map((n, i) => (
              <View key={n._id} style={[st.notice, i > 0 && st.lineTop]}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <StatusBadge map={CONTRACT_NOTICE} value={n.kind} />
                  <Text style={T.caption}>{fmtDateTime(n.at)}</Text>
                </View>
                {n.kind === 'EXPIRY_30' || n.kind === 'EXPIRY_7' ? (
                  <Text style={st.body}>Hết hạn ngày {fmtDate(lastDayOf(n.endDate ?? c.endDate))} — gia hạn hoặc đăng ký trả kho.</Text>
                ) : (
                  <Text style={st.body}>
                    Dư nợ lúc gửi {vnd(n.amountDue)}
                    {n.kind === 'FINAL_NOTICE' && n.deadline ? ` · từ ngày ${fmtDate(n.deadline)} chi nhánh được xử lý đồ bỏ lại` : ''}
                    {n.kind === 'GRACE_EXPIRED' && n.deadline ? ` · khoá từ ngày ${fmtDate(n.deadline)} nếu chưa thanh toán` : ''}
                  </Text>
                )}
                {n.note ? <Text style={st.hint}>Ghi chú: {n.note}</Text> : null}
                <View style={st.mailRow}>
                  <Ionicons name="mail-outline" size={13} color={C.muted} />
                  <Text style={st.hint}>{NOTICE_EMAIL_STATUS[n.email.status].label}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {(() => {
        // Biên bản kiểm tra khi trả kho (Điều 9): khách xem chi tiết và khiếu nại trong hạn.
        const insp = db.inspections.find((i) => i.contractId === c._id && i.type === 'MOVE_OUT');
        if (!insp) return null;
        return (
          <>
            <SectionHeader title={`Biên bản trả kho · ${fmtDate(insp.performedAt)}`} icon="clipboard-outline" />
            <Card>
              <Disclosure title={`Danh mục kiểm tra (${insp.checklist.length})`} icon="list-outline">
                {insp.checklist.map((x) => <Text key={x.item} style={st.hint}>{x.item}: {ITEM_CONDITION_LABEL[x.condition]}</Text>)}
              </Disclosure>
              <View style={st.lineTop} />
              {insp.damages.length === 0
                ? <View style={st.okRow}><Ionicons name="checkmark-circle" size={18} color={C.green} /><Text style={st.body}>Không có hư hỏng.</Text></View>
                : insp.damages.map((d, k) => (
                  <View key={k} style={st.damage}>
                    <Ionicons name="alert-circle-outline" size={16} color={C.red} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={st.body}>{d.description} ({DAMAGE_SEVERITY_LABEL[d.severity]}) — {vnd(d.cost)}</Text>
                      <PhotoLinks urls={d.photoUrls} onOpen={openPhoto} style={st.hint} />
                    </View>
                  </View>
                ))}
              <PhotoLinks label="Ảnh hiện trạng: " urls={insp.photoUrls} onOpen={openPhoto} style={[st.hint, { marginTop: S.sm }]} />
              {insp.depositSettlement && (() => {
                // Tách từng khoản để khách thấy vì sao bị giữ tiền (cùng nội dung với bản web).
                const ds = insp.depositSettlement!;
                const et = ds.earlyTermination;
                return (
                  <View style={st.settle}>
                    <View style={st.settleRow}>
                      <SettleCell label="Tiền giữ chân" value={vnd(ds.depositHeld)} />
                      <SettleCell label="Giữ lại" value={vnd(ds.deductions)} color={C.red} />
                      <SettleCell label="Hoàn" value={vnd(ds.refundAmount)} color={C.green} />
                    </View>
                    <Disclosure title="Chi tiết quyết toán">
                      <Text style={st.hint}>Tiền giữ chân {vnd(ds.depositHeld)} · giữ lại {vnd(ds.deductions)} · hoàn {vnd(ds.refundAmount)}</Text>
                      {(ds.priorOutstanding ?? 0) > 0 && <Text style={st.hint}>Công nợ chưa trả trước khi trả kho: {vnd(ds.priorOutstanding ?? 0)}</Text>}
                      {et && <Text style={st.hint}>Trả kho sớm (đã dùng {et.elapsedPct}% kỳ hạn): hoàn tối đa {et.refundCapPct}% tiền giữ chân{(et.discountClawback ?? 0) > 0 ? ` · thu hồi ưu đãi ${vnd(et.discountClawback ?? 0)}` : ''}</Text>}
                      {(ds.prepaidRentRefund ?? 0) > 0 && <Text style={st.hint}>Hoàn tiền thuê trả trước chưa dùng: {vnd(ds.prepaidRentRefund ?? 0)}</Text>}
                      {(ds.shortfall ?? 0) > 0 && <Text style={[st.hint, { color: C.red }]}>Còn thiếu (nợ sau quyết toán): {vnd(ds.shortfall ?? 0)}</Text>}
                    </Disclosure>
                  </View>
                );
              })()}
              {(insp.adjustments ?? []).map((a, k) => (
                <Text key={`adj-${k}`} style={[st.hint, { color: C.green, marginTop: S.xs }]}>
                  Điều chỉnh {fmtDate(a.at)}: giảm hư hại {vnd(a.amount)}{(a.debtCut ?? 0) > 0 ? ` · nợ −${vnd(a.debtCut ?? 0)}` : ''}{(a.refund ?? 0) > 0 ? ` · hoàn ${vnd(a.refund ?? 0)}` : ''} · {a.reason}
                </Text>
              ))}
              {canDisputeInspection(insp.performedAt) ? (
                <View style={{ marginTop: S.md }}>
                  <Input value={dispute} onChangeText={setDispute} placeholder="Nội dung khiếu nại (tối thiểu 10 ký tự)" multiline />
                  <Button
                    title="Gửi khiếu nại biên bản" variant="secondary" icon="flag-outline" disabled={dispute.trim().length < 10} style={{ marginTop: S.sm }}
                    onPress={() => void run('createTicket', { facilityId: c.facilityId, category: 'BILLING', priority: 'HIGH', subject: `Khiếu nại biên bản trả kho ${c.contractNumber}`, description: dispute.trim(), contractId: c._id }, 'Đã gửi khiếu nại — theo dõi phản hồi ở mục Hỗ trợ', () => setDispute(''))}
                  />
                </View>
              ) : <Text style={[st.hint, { marginTop: S.md }]}>Đã quá hạn khiếu nại {INSPECTION_DISPUTE_DAYS} ngày kể từ ngày lập biên bản.</Text>}
            </Card>
          </>
        );
      })()}

      {/* Sau trả kho: xác nhận bàn giao và đồ để lại trong ô (giữ đến ngày nào, đã lấy / đã xử lý chưa) — cùng nội dung với web. */}
      {(c.moveOut?.handover || c.leftover) && (
        <Card style={{ marginTop: S.md, gap: S.md }}>
          {c.moveOut?.handover && (
            <View style={st.cardHead}>
              <IconTile icon="key-outline" tone="violet" size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={st.sectionTitle}>Bàn giao kho</Text>
                <Text style={st.hint}>
                  {HANDOVER_METHOD[c.moveOut.handover.method]}{c.moveOut.handover.method === 'CUSTOMER_SIGNATURE' && c.moveOut.handover.signerName ? ` · ${c.moveOut.handover.signerName}` : ''} · {fmtDateTime(c.moveOut.handover.at)}
                  {c.moveOut.handover.method === 'MANAGER_CONFIRM' && c.moveOut.handover.reason ? `\nLý do: ${c.moveOut.handover.reason}` : ''}
                </Text>
              </View>
            </View>
          )}
          {c.leftover && (
            <View style={st.cardHead}>
              <IconTile icon="archive-outline" tone="amber" size="sm" />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <Text style={st.sectionTitle}>Đồ để lại · giữ đến {fmtDate(c.leftover.holdUntil)}</Text>
                  <StatusBadge map={LEFTOVER_STATUS} value={c.leftover.status} />
                </View>
                {!!c.leftover.description && <Text style={st.body}>{c.leftover.description}</Text>}
                {c.leftover.status === 'DISPOSED' && (c.leftover.fee ?? 0) > 0 && <Text style={st.hint}>Phí xử lý đồ để lại: {vnd(c.leftover.fee ?? 0)}</Text>}
                <PhotoLinks urls={c.leftover.photoUrls} onOpen={openPhoto} style={st.hint} />
              </View>
            </View>
          )}
        </Card>
      )}

      {/* Sau khi nhận kho, màn Đặt chỗ không còn lối vào — đây là chỗ lấy lại bản hợp đồng đã ký (gửi PDF qua email). */}
      {rsv?.signature && (
        <Card style={{ marginTop: S.md }}>
          <View style={st.cardHead}>
            <IconTile icon="create-outline" tone="green" size="sm" />
            <View style={{ flex: 1 }}>
              <Text style={st.sectionTitle}>Hợp đồng đã ký</Text>
              {/* Ký giấy tại quầy: chỉ báo đã ký — bản scan tải trên web. */}
              {rsv.signature.method === 'PAPER' ? (
                <Text style={st.hint}>
                  Đã ký giấy tại quầy · {c.terms.signerName ?? rsv.signature.signerName} · {fmtDate(c.terms.signedAt ?? rsv.signature.signedAt)}.
                </Text>
              ) : (
                <Text style={st.hint}>
                  {c.terms.signerName ?? rsv.signature.signerName} ký ngày {fmtDate(c.terms.signedAt ?? rsv.signature.signedAt)}.{' '}
                  {rsv.signature.emailedAt ? `Lần gửi PDF gần nhất tới ${rsv.signature.emailedTo ?? 'email của bạn'} lúc ${fmtDateTime(rsv.signature.emailedAt)}.` : 'PDF hợp đồng chưa được gửi qua email.'}
                </Text>
              )}
            </View>
          </View>
          {rsv.signature.method !== 'PAPER' && (
            <Button
              title="Gửi lại hợp đồng qua email" variant="secondary" icon="mail-outline" size="sm" style={{ marginTop: S.md }}
              onPress={() => void run('emailContract', { reservationId: rsv._id }, (v) => `Đã gửi PDF hợp đồng tới ${v.to}`)}
            />
          )}
        </Card>
      )}

      {(c.commitments ?? []).some((s) => s.appendix) && (
        <>
          <SectionHeader title="Phụ lục hợp đồng" icon="documents-outline" />
          <Card style={{ paddingVertical: S.xs }}>
            {(c.commitments ?? []).filter((s) => s.appendix).map((s, i) => {
              const a = s.appendix!;
              const on = openAppendix === a.number;
              return (
                <View key={a.number} style={i > 0 && st.lineTop}>
                  <Pressable onPress={() => setOpenAppendix(on ? null : a.number)} accessibilityRole="button" accessibilityState={{ expanded: on }}
                    style={({ pressed }) => [st.appendixHead, pressed && { opacity: 0.7 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }}>{a.title}</Text>
                      <Text style={st.hint}>{fmtDate(s.startDate)} → hết ngày {fmtDate(lastDayOf(s.endDate))} · xác nhận {fmtDate(a.acceptedAt)} bởi {a.signerName}</Text>
                    </View>
                    <Ionicons name={on ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
                  </Pressable>
                  {on && <View style={{ paddingBottom: S.md }}><AppendixText clauses={a.clauses} /></View>}
                </View>
              );
            })}
          </Card>
        </>
      )}

      <ActionList title="Cần hỗ trợ?" icon="help-buoy-outline" items={help} onOpen={openAction} />
    </Screen>
  );
}

/** Diễn giải khoản nợ sau khi hợp đồng đã đóng — loại khác lấy theo nhãn khoản thanh toán (cùng nội dung với web). */
const DEBT_PART: Partial<Record<PaymentType, string>> = {
  SETTLEMENT_DEBT: 'chi phí hư hại và công nợ vượt tiền giữ chân',
  DISPOSAL_FEE: 'phí xử lý đồ để lại',
};

/** Danh sách lối vào các màn thao tác: biểu tượng + tên + trạng thái ngắn. Không còn dòng nào hợp lệ thì ẩn cả khối. */
function ActionList({ title, icon, items, onOpen }: { title: string; icon: Icon; items: Action[]; onOpen: (href: string) => void }) {
  const shown = items.filter((a) => a.show);
  if (shown.length === 0) return null;
  return (
    <>
      <SectionHeader title={title} icon={icon} />
      <ListGroup>
        {shown.map((a) => (
          <ListRow key={a.key} icon={a.icon} tone={a.tone ?? 'teal'} title={a.title} subtitle={a.status} subtitleTone={a.tone} onPress={() => onOpen(a.href)} />
        ))}
      </ListGroup>
    </>
  );
}

function SettleCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={st.settleCell}>
      <Text style={T.caption} numberOfLines={1}>{label}</Text>
      <Text style={[st.settleValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

/** Link "Ảnh 1, Ảnh 2…" của biên bản trả kho — mở bằng trình duyệt / ứng dụng xem ảnh của máy (như bản web). */
function PhotoLinks({ urls, label, onOpen, style }: { urls: string[]; label?: string; onOpen: (url: string) => void; style?: StyleProp<TextStyle> }) {
  if (urls.length === 0) return null;
  return (
    <Text style={style}>
      {label}
      {urls.map((u, n) => (
        <Fragment key={`${u}-${n}`}>
          {n > 0 ? '   ' : ''}
          <Text style={st.link} onPress={() => onOpen(u)} accessibilityRole="link">Ảnh {n + 1}</Text>
        </Fragment>
      ))}
    </Text>
  );
}

const st = StyleSheet.create({
  summary: { backgroundColor: C.card, borderRadius: R.xl, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...SHADOW.card },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  unitChip: { minWidth: 52, height: 52, paddingHorizontal: 6, borderRadius: R.md, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  unitChipText: { color: C.ink, fontWeight: '800', fontSize: 15 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: C.white, letterSpacing: -0.2 },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  body: { fontSize: 13, lineHeight: 19, color: C.text },
  hint: { fontSize: 13, lineHeight: 19, color: C.muted, marginTop: 2 },
  link: { color: C.brand700, fontWeight: '700', textDecorationLine: 'underline' },
  notice: { paddingVertical: S.md, gap: 4 },
  lineTop: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  mailRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingTop: S.md },
  damage: { flexDirection: 'row', gap: S.sm, paddingTop: S.md },
  settle: { marginTop: S.md, backgroundColor: C.bg, borderRadius: R.md, padding: S.md, gap: S.xs },
  settleRow: { flexDirection: 'row', gap: S.sm },
  settleCell: { flex: 1 },
  settleValue: { fontSize: 14, fontWeight: '800', color: C.ink, marginTop: 2, ...T.tabular },
  appendixHead: { flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: 56, paddingVertical: S.sm },
});