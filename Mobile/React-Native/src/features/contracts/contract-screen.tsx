import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { PaymentMethod } from '@ssm/shared';
import {
  ACCESS_METHOD, CONTRACT_NOTICE, CONTRACT_STATUS, DEPOSIT_STATUS, NOTICE_EMAIL_STATUS, OPEN_CONTRACT_STATUSES, delinquencyAlert, fmtDateTime, isClosedContract, OPEN_SWAP_STATUSES, PAYMENT_METHOD, PERIOD_UNIT, SWAP_REQUEST_STATUS,
  addDays, canDisputeInspection, contractClawback, DAMAGE_SEVERITY_LABEL, exitCommitment, fmtDate, handoverDeadline, INSPECTION_DISPUTE_DAYS, ITEM_CONDITION_LABEL, lastDayOf, MAX_MOVE_OUT_LEAD_DAYS, paymentDueDate, periodLabel, todayISO, vnd, type ExtensionQuote,
} from '@ssm/shared';
import { api } from '../../shared/api/client';
import { byId, facilityName, typeName, unitLabel, useStore } from '../../shared/store/store';
import { Badge, Button, Card, Chips, DateStepper, EmptyState, Input, KV, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

const METHODS: { value: PaymentMethod; label: string }[] = (['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'] as PaymentMethod[])
  .map((v) => ({ value: v, label: PAYMENT_METHOD[v] }));
const PERIODS: { value: '1' | '3' | '6' | '12'; label: string }[] = [
  { value: '1', label: '1 tháng' }, { value: '3', label: '3 tháng' }, { value: '6', label: '6 tháng' }, { value: '12', label: '12 tháng' },
];

export default function ContractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [payMethod, setPayMethod] = useState<PaymentMethod>('VNPAY');
  const [extendMethod, setExtendMethod] = useState<PaymentMethod>('VNPAY');
  const [periods, setPeriods] = useState<'1' | '3' | '6' | '12'>('3');
  const [moveOutDate, setMoveOutDate] = useState(addDays(todayISO(), 3));
  const [dispute, setDispute] = useState('');

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

  const periodsNum = Number(periods);
  // Báo giá gia hạn lấy từ server mỗi khi đổi số kỳ — gia hạn là cam kết mới nên giá và ưu đãi tính lại, không dùng giá cũ.
  const [ext, setExt] = useState<{ key: string; quote: ExtensionQuote | null; error: string }>({ key: '', quote: null, error: '' });
  const extKey = `${id}:${periodsNum}`;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.get<ExtensionQuote>(`/contracts/${id}/extension-quote?periods=${periodsNum}`)
      .then((quote) => alive && setExt({ key: `${id}:${periodsNum}`, quote, error: '' }))
      .catch((e) => alive && setExt({ key: `${id}:${periodsNum}`, quote: null, error: e instanceof Error ? e.message : 'Không tính được giá gia hạn' }));
    return () => { alive = false; };
  }, [id, periodsNum]);
  const extQuote = ext.key === extKey ? ext.quote : null;
  // Khách phải tick xác nhận Phụ lục gia hạn; đổi số kỳ (phụ lục khác) thì phải xác nhận lại.
  const [agree, setAgree] = useState(false);
  const [showAppendix, setShowAppendix] = useState(false);
  const [openAppendix, setOpenAppendix] = useState<number | null>(null);
  useEffect(() => { setAgree(false); }, [periodsNum, id]);
  const openSwap = db.swapRequests.find((s) => s.contractId === c._id && (OPEN_SWAP_STATUSES as readonly string[]).includes(s.status));

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
          ...(OPEN_CONTRACT_STATUSES.includes(c.status) ? ([
            ['Kỳ thanh toán tới', `${fmtDate(c.billing.nextBillingDate)} · ${vnd(c.billing.rate)}`],
            ['Hạn trả tiền kỳ tới', `${fmtDate(paymentDueDate(c.billing.nextBillingDate, c.terms.gracePeriodDays))} — quá hạn bị tính phí trễ`],
          ] as [string, string][]) : []),
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
              : insp.damages.map((d, k) => <Text key={k} style={st.hint}>• {d.description} ({DAMAGE_SEVERITY_LABEL[d.severity]}) — {vnd(d.cost)}</Text>)}
            {insp.depositSettlement && (
              <Text style={st.hint}>Tiền giữ chân {vnd(insp.depositSettlement.depositHeld)} · trừ {vnd(insp.depositSettlement.deductions)} · hoàn {vnd(insp.depositSettlement.refundAmount)}</Text>
            )}
            {(insp.adjustments ?? []).map((a, k) => <Text key={`adj-${k}`} style={[st.hint, { color: C.green }]}>Điều chỉnh {fmtDate(a.at)}: −{vnd(a.amount)} · {a.reason}</Text>)}
            {canDisputeInspection(insp.performedAt, todayISO()) ? (
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

      {c.balance.outstanding > 0 && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>{isClosedContract(c.status) ? 'Nợ còn lại sau quyết toán' : 'Thanh toán công nợ'}</Text>
          <Text style={st.hint}>{vnd(c.balance.outstanding)}{isClosedContract(c.status) ? (c.status === 'ABANDONED' ? ' — tiền giữ chân và tiền thanh lý chưa đủ bù công nợ.' : ' — chi phí hư hại và công nợ vượt tiền giữ chân.') + ' Thanh toán xong mới đặt kho mới được.' : ''}</Text>
          <Chips options={METHODS} value={payMethod} onChange={setPayMethod} columns={2} />
          <Button
            title={`Thanh toán ${vnd(c.balance.outstanding)}`}
            style={{ marginTop: S.lg }}
            onPress={() => void run('payBalance', { contractId: c._id, method: payMethod }, (v) => `Đã thanh toán ${vnd(v)}`)}
          />
        </Card>
      )}

      {(c.notices?.length ?? 0) > 0 && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Thông báo từ KhoAn</Text>
          {[...(c.notices ?? [])].reverse().slice(0, 5).map((n) => (
            <View key={n._id} style={{ marginTop: S.sm, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, gap: 4 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <StatusBadge map={CONTRACT_NOTICE} value={n.kind} />
                <Text style={st.hint}>{fmtDateTime(n.at)}</Text>
              </View>
              <Text style={[st.hint, { color: C.text }]}>
                Dư nợ lúc gửi {vnd(n.amountDue)}
                {n.kind === 'FINAL_NOTICE' && n.deadline ? ` · từ ngày ${fmtDate(n.deadline)} chi nhánh được xử lý đồ bỏ lại` : ''}
                {n.kind === 'GRACE_EXPIRED' && n.deadline ? ` · khoá từ ngày ${fmtDate(n.deadline)} nếu chưa thanh toán` : ''}
              </Text>
              {n.note ? <Text style={st.hint}>Ghi chú: {n.note}</Text> : null}
              <Text style={st.hint}>{NOTICE_EMAIL_STATUS[n.email.status].label}</Text>
            </View>
          ))}
        </Card>
      )}

      {(c.commitments ?? []).some((s) => s.appendix) && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Phụ lục hợp đồng</Text>
          <Text style={st.hint}>Các phụ lục gia hạn bạn đã xác nhận — là bộ phận không tách rời của hợp đồng.</Text>
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

      {c.status === 'ACTIVE' && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Gia hạn hợp đồng</Text>
          <Chips options={PERIODS} value={periods} onChange={setPeriods} columns={2} />
          {ext.key === extKey && ext.error ? <Text style={[st.hint, { color: C.red }]}>{ext.error}</Text> : !extQuote ? <Text style={st.hint}>Đang tính giá gia hạn…</Text> : (
            <>
              <KV items={[
                ['Kỳ gia hạn', `${fmtDate(extQuote.from)} → hết ngày ${fmtDate(lastDayOf(extQuote.newEndDate))}`],
                ['Giá niêm yết hiện hành', `${vnd(extQuote.gross)}/${PERIOD_UNIT[extQuote.rentalPeriod]}`],
                ['Ưu đãi theo thời gian gia hạn', extQuote.discountAmount > 0 ? `−${vnd(extQuote.discountAmount)}/${PERIOD_UNIT[extQuote.rentalPeriod]}` : 'không có'],
                ['Tiền thuê trong kỳ gia hạn', `${vnd(extQuote.rate)}/${PERIOD_UNIT[extQuote.rentalPeriod]}`],
              ]} />
              <Text style={st.hint}>
                Gia hạn là một cam kết mới: ưu đãi tính theo số {PERIOD_UNIT[extQuote.rentalPeriod]} gia hạn, không cộng dồn thời gian đã thuê. Bạn đang trả {vnd(extQuote.currentRate)}/{PERIOD_UNIT[extQuote.rentalPeriod]}.{' '}
                {extQuote.payNow > 0
                  ? `Trả trọn ${vnd(extQuote.payNow)} ngay khi gia hạn, không hoàn các ${PERIOD_UNIT[extQuote.rentalPeriod]} chưa dùng.`
                  : 'Không phải trả trước — tiền thuê vẫn xuất hoá đơn từng tháng. Tiền giữ chân giữ nguyên.'}
              </Text>
              {extQuote.payNow > 0 && <Chips options={METHODS} value={extendMethod} onChange={setExtendMethod} columns={2} />}
              {extQuote.appendix && (
                <View style={{ marginTop: S.md }}>
                  <Pressable onPress={() => setShowAppendix((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: C.brand700, flex: 1 }}>{showAppendix ? 'Thu gọn' : 'Đọc'} {extQuote.appendix.title}</Text>
                    <Ionicons name={showAppendix ? 'chevron-up' : 'chevron-down'} size={18} color={C.brand700} />
                  </Pressable>
                  {showAppendix && <AppendixText clauses={extQuote.appendix.clauses} />}
                  <Pressable onPress={() => setAgree((v) => !v)} style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md, alignItems: 'flex-start' }} hitSlop={6}>
                    <Ionicons name={agree ? 'checkbox' : 'square-outline'} size={22} color={agree ? C.brand700 : C.faint} />
                    <Text style={{ flex: 1, fontSize: 13, color: C.ink, lineHeight: 19 }}>Tôi đã đọc và đồng ý toàn bộ nội dung {extQuote.appendix.title}. Việc xác nhận này trên tài khoản của tôi có giá trị như chữ ký của tôi trên phụ lục.</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
          <Button
            title={extQuote && extQuote.payNow > 0 ? 'Gia hạn & thanh toán' : 'Xác nhận gia hạn'}
            style={{ marginTop: S.md }}
            disabled={!extQuote || !agree}
            onPress={() => extQuote && void run(
              'extendContract',
              { contractId: c._id, periods: periodsNum, method: extQuote.payNow > 0 ? extendMethod : undefined, acceptAppendix: agree },
              (v) => (v > 0 ? `Đã gia hạn ${periodLabel(c.billing.rentalPeriod, periodsNum)} — thanh toán ${vnd(v)}` : `Đã gia hạn ${periodLabel(c.billing.rentalPeriod, periodsNum)} — tiền thuê trả theo từng tháng`),
            )}
          />
        </Card>
      )}

      {c.status === 'ACTIVE' && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Đăng ký trả kho</Text>
          <Text style={st.hint}>Nhân viên sẽ kiểm tra kho khi bạn bàn giao chìa khóa. Tiền giữ chân hoàn sau khi trừ chi phí hư hại (nếu có).</Text>
          <Text style={st.hint}>
            Tiền thuê vẫn được tính đến ngày bạn THỰC TẾ bàn giao kho.{' '}
            {(exitCommitment(c, byId(db.reservations, c.reservationId)?.quote, todayISO())?.discountAmount ?? 0) > 0
              ? 'Kỳ cam kết hiện tại của bạn được giảm giá vì thuê dài hạn: trả kho trước hạn thì mức hoàn tiền giữ chân tính theo phần kỳ hạn đã dùng đến ngày đó — càng gần hết hạn càng được hoàn nhiều; bỏ ngang trong 25% đầu kỳ hạn có thể không được hoàn.'
              : 'Kỳ thuê hiện tại không có ưu đãi thuê dài hạn nên trả kho trước hạn vẫn được hoàn đủ tiền giữ chân.'}
          </Text>
          <DateStepper label="Ngày trả kho dự kiến" value={moveOutDate} onChange={setMoveOutDate} min={todayISO()} max={addDays(todayISO(), MAX_MOVE_OUT_LEAD_DAYS)} />
          {/* Mốc 00:00 ngày thu kỳ kế tiếp là lúc phát sinh tiền thuê kỳ mới — bàn giao trước mốc này thì không bị tính thêm kỳ. */}
          <Text style={[st.hint, moveOutDate > handoverDeadline(c) ? { color: C.amber } : null]}>
            Bàn giao kho trước hết ngày {fmtDate(handoverDeadline(c))} để không phát sinh tiền thuê kỳ mới
            {moveOutDate > handoverDeadline(c) ? ` — ngày hẹn này sau mốc đó nên kỳ thuê bắt đầu ${fmtDate(c.billing.nextBillingDate)} vẫn được tính tiền.` : '.'} Hẹn trước tối đa {MAX_MOVE_OUT_LEAD_DAYS} ngày.
          </Text>
          {(() => {
            // Thu hồi ưu đãi thuê dài hạn nếu trả vào ngày đang chọn — cùng công thức với server (shared).
            const rsv = byId(db.reservations, c.reservationId);
            const claw = contractClawback(c, rsv?.quote, db.policies, moveOutDate);
            return claw ? (
              <Text style={[st.hint, { color: C.amber }]}>
                Thu hồi ưu đãi: bạn mới dùng {claw.usedPeriods} tháng nên chỉ được giảm {vnd(claw.entitledPerPeriod)}/tháng thay vì {vnd(claw.discountPerPeriod)}/tháng — phần đã hưởng vượt {vnd(claw.amount)} sẽ trừ vào tiền giữ chân được hoàn.
              </Text>
            ) : null;
          })()}
          <Button
            title="Đăng ký trả kho"
            variant="secondary"
            style={{ marginTop: S.md }}
            onPress={() => void run('requestMoveOut', { contractId: c._id, date: moveOutDate }, 'Đã đăng ký trả kho')}
          />
        </Card>
      )}

      {c.status === 'MOVE_OUT_PENDING' && (
        <Card style={{ marginTop: S.md }}>
          <Badge tone="violet">{c.access.revokedAt ? 'Đã bàn giao — chờ kiểm tra' : `Hẹn trả kho ${fmtDate(c.moveOut?.scheduledFor)}`}</Badge>
          {!c.access.revokedAt && (
            <>
              <Text style={st.hint}>Tiền thuê vẫn được tính cho đến khi bạn bàn giao kho tại chi nhánh — bàn giao trước hết ngày {fmtDate(handoverDeadline(c))} để không phát sinh kỳ mới. Đổi ý thì rút đăng ký để tiếp tục thuê.</Text>
              <Button title="Rút đăng ký trả kho" variant="ghost" style={{ marginTop: S.sm }} onPress={() => void run('cancelMoveOut', { contractId: c._id }, 'Đã rút đăng ký trả kho — hợp đồng tiếp tục hiệu lực')} />
            </>
          )}
        </Card>
      )}

      {openSwap ? (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.sectionTitle}>Yêu cầu đổi ô {openSwap.requestNumber}</Text>
          <StatusBadge map={SWAP_REQUEST_STATUS} value={openSwap.status} />
          {openSwap.status === 'APPROVED' && openSwap.method === 'SELF' && openSwap.moveDeadline && (
            <Text style={st.hint}>Hạn tự chuyển: {fmtDate(openSwap.moveDeadline)}</Text>
          )}
          {openSwap.status === 'APPROVED' && openSwap.method === 'DELIVERY' && (
            <Text style={st.hint}>Chi nhánh chuyển ngày {fmtDate(openSwap.scheduledFor)}{openSwap.assignedStaffName ? ` — nhân viên ${openSwap.assignedStaffName}` : ''}</Text>
          )}
          {(openSwap.status === 'SUBMITTED' || openSwap.status === 'APPROVED') && (
            <Button
              title="Rút yêu cầu" variant="ghost" style={{ marginTop: S.sm }}
              onPress={() => void run('cancelSwapRequest', { swapRequestId: openSwap._id }, 'Đã rút yêu cầu đổi ô')}
            />
          )}
        </Card>
      ) : c.status === 'ACTIVE' && (
        <Card style={{ marginTop: S.md }}>
          <Button
            title="Yêu cầu đổi ô kho"
            variant="secondary"
            icon="swap-horizontal-outline"
            onPress={() => router.push(`/contract/swap?contract=${c._id}`)}
          />
        </Card>
      )}

      {c.status === 'ACTIVE' && (
        <Card style={{ marginTop: S.md }}>
          <Button
            title="Dịch vụ thêm (đóng gói, vận chuyển...)"
            variant="secondary"
            icon="cube-outline"
            onPress={() => router.push(`/contract/services?contract=${c._id}`)}
          />
        </Card>
      )}

      {OPEN_CONTRACT_STATUSES.includes(c.status) && (
        <Card style={{ marginTop: S.md }}>
          <Button
            title="Báo sự cố"
            variant="secondary"
            icon="alert-circle-outline"
            onPress={() => router.push(`/ticket/new?contract=${c._id}`)}
          />
          <Button
            title="Yêu cầu bồi thường"
            variant="secondary"
            icon="cash-outline"
            style={{ marginTop: S.sm }}
            onPress={() => router.push(`/claim/new?contract=${c._id}`)}
          />
        </Card>
      )}
    </Screen>
  );
}

/** Nội dung một phụ lục (bản xem trước lúc gia hạn hoặc bản đã xác nhận). */
function AppendixText({ clauses }: { clauses: { title: string; paragraphs: string[]; bullets: string[] }[] }) {
  return (
    <View style={{ marginTop: S.sm, backgroundColor: C.bg, borderRadius: 12, padding: S.md, gap: S.sm }}>
      {clauses.map((cl) => (
        <View key={cl.title}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.ink }}>{cl.title}</Text>
          {cl.paragraphs.map((p, i) => <Text key={`p${i}`} style={{ fontSize: 12.5, color: C.ink, lineHeight: 19, marginTop: 2 }}>{p}</Text>)}
          {cl.bullets.map((b, i) => <Text key={`b${i}`} style={{ fontSize: 12.5, color: C.ink, lineHeight: 19, marginTop: 2 }}>• {b}</Text>)}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  hint: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: S.md },
});
