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
import { Button, Card, EmptyState, Input, KV, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { C, R, S, TONE } from '../../shared/ui/theme';
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

  return (
    <Screen>
      <ScreenHeader title={`Hợp đồng ${c.contractNumber}`} right={<StatusBadge map={CONTRACT_STATUS} value={c.status} />} />

      <Card>
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
      </Card>

      {(() => {
        const alert = delinquencyAlert(c);
        return alert ? (
          <Card style={{ marginTop: S.md, backgroundColor: alert.tone === 'red' ? C.redBg : C.amberBg, borderColor: alert.tone === 'red' ? '#fecaca' : '#fde68a' }}>
            <Text style={[st.sectionTitle, { color: alert.tone === 'red' ? C.red : C.amber }]}>{alert.title}</Text>
            <Text style={[st.hint, { color: C.text }]}>{alert.text}</Text>
          </Card>
        ) : null;
      })()}

      {c.balance.outstanding > 0 && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>{isClosedContract(c.status) ? 'Nợ còn lại sau quyết toán' : 'Thanh toán công nợ'}</Text>
          <Text style={st.hint}>{vnd(c.balance.outstanding)}{isClosedContract(c.status) ? (c.status === 'ABANDONED' ? ' — tiền giữ chân và tiền thanh lý chưa đủ bù công nợ.' : ` — ${closedDebtText}.`) + ' Thanh toán xong mới đặt kho mới được.' : ''}</Text>
          {/* Trả online qua cổng thanh toán (giả lập) — chọn hình thức ở cổng. */}
          <Button
            title={`Thanh toán ${vnd(c.balance.outstanding)}`}
            onPress={() => router.push(payHref({
              target: { kind: 'BALANCE', contractId: c._id }, facilityId: c.facilityId, code: c.contractNumber,
              purpose: isClosedContract(c.status) ? 'Nợ sau quyết toán' : 'Thanh toán công nợ', amount: c.balance.outstanding,
              doneNote: isClosedContract(c.status) ? 'Đã thanh toán khoản nợ sau quyết toán.' : c.status === 'LOCKED_OUT' || c.status === 'DELINQUENT' ? 'Truy cập kho được khôi phục.' : undefined,
              back: { label: 'Về hợp đồng', href: `/contract/${c._id}` },
            }))}
          />
        </Card>
      )}

      <ActionList items={actions} onOpen={openAction} />

      {(c.notices?.length ?? 0) > 0 && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Thông báo từ KhoAn</Text>
          {[...(c.notices ?? [])].reverse().slice(0, 5).map((n) => (
            <View key={n._id} style={{ marginTop: S.sm, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, gap: 4 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <StatusBadge map={CONTRACT_NOTICE} value={n.kind} />
                <Text style={st.hint}>{fmtDateTime(n.at)}</Text>
              </View>
              {n.kind === 'EXPIRY_30' || n.kind === 'EXPIRY_7' ? (
                <Text style={[st.hint, { color: C.text }]}>Hết hạn ngày {fmtDate(lastDayOf(n.endDate ?? c.endDate))} — gia hạn hoặc đăng ký trả kho.</Text>
              ) : (
                <Text style={[st.hint, { color: C.text }]}>
                  Dư nợ lúc gửi {vnd(n.amountDue)}
                  {n.kind === 'FINAL_NOTICE' && n.deadline ? ` · từ ngày ${fmtDate(n.deadline)} chi nhánh được xử lý đồ bỏ lại` : ''}
                  {n.kind === 'GRACE_EXPIRED' && n.deadline ? ` · khoá từ ngày ${fmtDate(n.deadline)} nếu chưa thanh toán` : ''}
                </Text>
              )}
              {n.note ? <Text style={st.hint}>Ghi chú: {n.note}</Text> : null}
              <Text style={st.hint}>{NOTICE_EMAIL_STATUS[n.email.status].label}</Text>
            </View>
          ))}
        </Card>
      )}

      {(() => {
        // Biên bản kiểm tra khi trả kho (Điều 9): khách xem chi tiết và khiếu nại trong hạn.
        const insp = db.inspections.find((i) => i.contractId === c._id && i.type === 'MOVE_OUT');
        if (!insp) return null;
        return (
          <Card style={{ marginTop: S.md }}>
            <Text style={st.sectionTitle}>Biên bản trả kho · {fmtDate(insp.performedAt)}</Text>
            {insp.checklist.map((x) => <Text key={x.item} style={st.hint}>{x.item}: {ITEM_CONDITION_LABEL[x.condition]}</Text>)}
            {insp.damages.length === 0
              ? <Text style={st.hint}>Không có hư hỏng.</Text>
              : insp.damages.map((d, k) => (
                <Fragment key={k}>
                  <Text style={st.hint}>• {d.description} ({DAMAGE_SEVERITY_LABEL[d.severity]}) — {vnd(d.cost)}</Text>
                  <PhotoLinks urls={d.photoUrls} onOpen={openPhoto} style={st.photoUnder} />
                </Fragment>
              ))}
            <PhotoLinks label="Ảnh hiện trạng: " urls={insp.photoUrls} onOpen={openPhoto} style={st.hint} />
            {insp.depositSettlement && (() => {
              // Tách từng khoản để khách thấy vì sao bị giữ tiền (cùng nội dung với bản web).
              const ds = insp.depositSettlement!;
              const et = ds.earlyTermination;
              return (
                <>
                  <Text style={st.hint}>Tiền giữ chân {vnd(ds.depositHeld)} · giữ lại {vnd(ds.deductions)} · hoàn {vnd(ds.refundAmount)}</Text>
                  {(ds.priorOutstanding ?? 0) > 0 && <Text style={st.hint}>Công nợ chưa trả trước khi trả kho: {vnd(ds.priorOutstanding ?? 0)}</Text>}
                  {et && <Text style={st.hint}>Trả kho sớm (đã dùng {et.elapsedPct}% kỳ hạn): hoàn tối đa {et.refundCapPct}% tiền giữ chân{(et.discountClawback ?? 0) > 0 ? ` · thu hồi ưu đãi ${vnd(et.discountClawback ?? 0)}` : ''}</Text>}
                  {(ds.prepaidRentRefund ?? 0) > 0 && <Text style={st.hint}>Hoàn tiền thuê trả trước chưa dùng: {vnd(ds.prepaidRentRefund ?? 0)}</Text>}
                  {(ds.shortfall ?? 0) > 0 && <Text style={[st.hint, { color: C.red }]}>Còn thiếu (nợ sau quyết toán): {vnd(ds.shortfall ?? 0)}</Text>}
                </>
              );
            })()}
            {(insp.adjustments ?? []).map((a, k) => (
              <Text key={`adj-${k}`} style={[st.hint, { color: C.green }]}>
                Điều chỉnh {fmtDate(a.at)}: giảm hư hại {vnd(a.amount)}{(a.debtCut ?? 0) > 0 ? ` · nợ −${vnd(a.debtCut ?? 0)}` : ''}{(a.refund ?? 0) > 0 ? ` · hoàn ${vnd(a.refund ?? 0)}` : ''} · {a.reason}
              </Text>
            ))}
            {canDisputeInspection(insp.performedAt) ? (
              <>
                <Input value={dispute} onChangeText={setDispute} placeholder="Nội dung khiếu nại (tối thiểu 10 ký tự)" multiline style={{ marginTop: S.sm }} />
                <Button
                  title="Gửi khiếu nại biên bản" variant="secondary" disabled={dispute.trim().length < 10} style={{ marginTop: S.sm }}
                  onPress={() => void run('createTicket', { facilityId: c.facilityId, category: 'BILLING', priority: 'HIGH', subject: `Khiếu nại biên bản trả kho ${c.contractNumber}`, description: dispute.trim(), contractId: c._id }, 'Đã gửi khiếu nại — theo dõi phản hồi ở mục Hỗ trợ', () => setDispute(''))}
                />
              </>
            ) : <Text style={st.hint}>Đã quá hạn khiếu nại {INSPECTION_DISPUTE_DAYS} ngày kể từ ngày lập biên bản.</Text>}
          </Card>
        );
      })()}

      {/* Sau trả kho: xác nhận bàn giao và đồ để lại trong ô (giữ đến ngày nào, đã lấy / đã xử lý chưa) — cùng nội dung với web. */}
      {(c.moveOut?.handover || c.leftover) && (
        <Card style={{ marginTop: S.md }}>
          {c.moveOut?.handover && (
            <>
              <Text style={st.sectionTitle}>Bàn giao kho</Text>
              <Text style={st.hint}>
                {HANDOVER_METHOD[c.moveOut.handover.method]}{c.moveOut.handover.method === 'CUSTOMER_SIGNATURE' && c.moveOut.handover.signerName ? ` · ${c.moveOut.handover.signerName}` : ''} · {fmtDateTime(c.moveOut.handover.at)}
                {c.moveOut.handover.method === 'MANAGER_CONFIRM' && c.moveOut.handover.reason ? `\nLý do: ${c.moveOut.handover.reason}` : ''}
              </Text>
            </>
          )}
          {c.leftover && (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <Text style={st.sectionTitle}>Đồ để lại · giữ đến {fmtDate(c.leftover.holdUntil)}</Text>
                <StatusBadge map={LEFTOVER_STATUS} value={c.leftover.status} />
              </View>
              {!!c.leftover.description && <Text style={[st.hint, { color: C.text }]}>{c.leftover.description}</Text>}
              {c.leftover.status === 'DISPOSED' && (c.leftover.fee ?? 0) > 0 && <Text style={st.hint}>Phí xử lý đồ để lại: {vnd(c.leftover.fee ?? 0)}</Text>}
              <PhotoLinks urls={c.leftover.photoUrls} onOpen={openPhoto} style={st.hint} />
            </>
          )}
        </Card>
      )}

      {/* Sau khi nhận kho, màn Đặt chỗ không còn lối vào — đây là chỗ lấy lại bản hợp đồng đã ký (gửi PDF qua email). */}
      {rsv?.signature && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Hợp đồng đã ký</Text>
          {/* Ký giấy tại quầy: chỉ báo đã ký — bản scan tải trên web. */}
          {rsv.signature.method === 'PAPER' ? (
            <Text style={[st.hint, { marginBottom: 0 }]}>
              Đã ký giấy tại quầy · {c.terms.signerName ?? rsv.signature.signerName} · {fmtDate(c.terms.signedAt ?? rsv.signature.signedAt)}.
            </Text>
          ) : (
            <>
              <Text style={st.hint}>
                {c.terms.signerName ?? rsv.signature.signerName} ký ngày {fmtDate(c.terms.signedAt ?? rsv.signature.signedAt)}.{' '}
                {rsv.signature.emailedAt ? `Lần gửi PDF gần nhất tới ${rsv.signature.emailedTo ?? 'email của bạn'} lúc ${fmtDateTime(rsv.signature.emailedAt)}.` : 'PDF hợp đồng chưa được gửi qua email.'}
              </Text>
              <Button
                title="Gửi lại hợp đồng qua email" variant="secondary" icon="mail-outline"
                onPress={() => void run('emailContract', { reservationId: rsv._id }, (v) => `Đã gửi PDF hợp đồng tới ${v.to}`)}
              />
            </>
          )}
        </Card>
      )}

      {(c.commitments ?? []).some((s) => s.appendix) && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Phụ lục hợp đồng</Text>
          {(c.commitments ?? []).filter((s) => s.appendix).map((s) => {
            const a = s.appendix!;
            const on = openAppendix === a.number;
            return (
              <View key={a.number} style={{ marginTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
                <Pressable onPress={() => setOpenAppendix(on ? null : a.number)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }}>{a.title}</Text>
                    <Text style={st.hint}>{fmtDate(s.startDate)} → hết ngày {fmtDate(lastDayOf(s.endDate))} · xác nhận {fmtDate(a.acceptedAt)} bởi {a.signerName}</Text>
                  </View>
                  <Ionicons name={on ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
                </Pressable>
                {on && <AppendixText clauses={a.clauses} />}
              </View>
            );
          })}
        </Card>
      )}

      <ActionList items={help} onOpen={openAction} />
    </Screen>
  );
}

/** Diễn giải khoản nợ sau khi hợp đồng đã đóng — loại khác lấy theo nhãn khoản thanh toán (cùng nội dung với web). */
const DEBT_PART: Partial<Record<PaymentType, string>> = {
  SETTLEMENT_DEBT: 'chi phí hư hại và công nợ vượt tiền giữ chân',
  DISPOSAL_FEE: 'phí xử lý đồ để lại',
};

/** Danh sách lối vào các màn thao tác: biểu tượng + tên + trạng thái ngắn. Không còn dòng nào hợp lệ thì ẩn cả khối. */
function ActionList({ items, onOpen }: { items: Action[]; onOpen: (href: string) => void }) {
  const shown = items.filter((a) => a.show);
  if (shown.length === 0) return null;
  return (
    <Card style={st.actions}>
      {shown.map((a, i) => (
        <Pressable
          key={a.key} onPress={() => onOpen(a.href)} accessibilityRole="button" accessibilityLabel={a.title}
          style={({ pressed }) => [st.actionRow, i > 0 && st.actionLine, pressed && { opacity: 0.6 }]}
        >
          <View style={st.actionIcon}><Ionicons name={a.icon} size={20} color={C.brand700} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.actionTitle}>{a.title}</Text>
            {a.status ? <Text style={[st.actionStatus, a.tone && { color: TONE[a.tone].fg }]} numberOfLines={2}>{a.status}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.faint} />
        </Pressable>
      ))}
    </Card>
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
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  hint: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: S.md },
  photoUnder: { fontSize: 13, color: C.muted, marginTop: -S.sm, marginBottom: S.md, paddingLeft: S.md },
  link: { color: C.brand700, fontWeight: '600', textDecorationLine: 'underline' },
  actions: { marginTop: S.md, paddingVertical: S.xs },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md },
  actionLine: { borderTopWidth: 1, borderTopColor: C.line },
  actionIcon: { width: 40, height: 40, borderRadius: R.md, backgroundColor: C.brand50, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 15, fontWeight: '600', color: C.ink },
  actionStatus: { fontSize: 13, color: C.muted, marginTop: 2 },
});
