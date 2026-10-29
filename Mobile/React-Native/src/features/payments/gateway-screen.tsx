import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import type { PaymentMethod, PaymentStatus } from '@ssm/shared';
import { COLLECTED_PAYMENT_STATUSES, PAYMENT_METHOD, dueAtBooking, fmtDateTime, vnd } from '@ssm/shared';
import { byId, useStore } from '../../shared/store/store';
import { newKey } from '../../shared/api/actions';
import { Button, EmptyState, IconTile, KV, Muted, OptionCard, Screen, SectionHeader, type IconName } from '../../shared/ui';
import { C, MONO, R, S, SHADOW, T, TOUCH } from '../../shared/ui/theme';
import { parseIntent, payTarget } from './pay-intent';
import { hasReceipt, useReceipt } from './receipt';

/** Hình thức khách tự trả online (tiền mặt chỉ thu tại quầy). */
const ONLINE_METHODS: PaymentMethod[] = ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'];
const METHODS = ONLINE_METHODS.map((v) => ({ value: v, label: PAYMENT_METHOD[v] }));
const QR_METHODS: PaymentMethod[] = ['VNPAY', 'MOMO'];
const METHOD_ICON: Partial<Record<PaymentMethod, IconName>> = { VNPAY: 'qr-code-outline', MOMO: 'wallet-outline', CARD: 'card-outline', BANK_TRANSFER: 'business-outline' };
/** Tài khoản nhận tiền / thẻ GIẢ ĐỊNH — chỉ để minh hoạ, cùng số liệu với cổng trên web. */
const DEMO_BANK = { bank: 'KhoAn Demo Bank (giả định)', account: '0123 4567 8901', holder: 'CONG TY KHOAN' };
const DEMO_CARD = { number: '4111 1111 1111 1111', holder: 'KHACH HANG THU NGHIEM', exp: '12/30' };

/** `before`: trạng thái các khoản thanh toán lúc bấm xác nhận — so lại sau khi tải để biết khoản nào vừa thu (mã giao dịch, biên lai). */
type Phase =
  | { kind: 'pay' }
  | { kind: 'processing' }
  | { kind: 'ok'; amount: number; at: string; before: Record<string, PaymentStatus> }
  | { kind: 'fail'; error: string; code?: string; before: Record<string, PaymentStatus> };

/**
 * Cổng thanh toán GIẢ LẬP dùng chung cho mọi khoản khách trả online trên app: giữ chỗ, gia hạn, dịch vụ thêm, trả công nợ, phí làm lại
 * thẻ / chìa. Chỉ là lớp giao diện — bấm xác nhận mới gọi API thật (server giả lập cổng, ghi mã giao dịch); "Huỷ" quay lại không gọi gì.
 * Trả xong: "Về …" lùi thẳng về màn gốc (dismissTo), không để lại cổng / màn trung gian trong ngăn xếp.
 */
export default function GatewayScreen() {
  const params = useLocalSearchParams<{ intent?: string }>();
  const intent = useMemo(() => parseIntent(params.intent), [params.intent]);
  const { db, user, catalog, run } = useStore();
  const router = useRouter();
  const receipt = useReceipt();
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');
  const [phase, setPhase] = useState<Phase>({ kind: 'pay' });
  // Một key cho lần trả công nợ đang mở — thử lại sau lỗi mạng không thu hai lần; số dư đổi (BALANCE_CHANGED) thì lấy key mới.
  const [payKey, setPayKey] = useState(newKey);

  // Khoản vừa ghi nhận (mới, hoặc vừa chuyển sang đã thu — tiền giữ chân / công nợ là khoản chờ có sẵn) so với lúc bấm xác nhận.
  const fresh = phase.kind === 'ok' || phase.kind === 'fail'
    ? db.payments.filter((p) => p.customerId === user?._id && p.direction === 'CHARGE' && COLLECTED_PAYMENT_STATUSES.includes(p.status) && phase.before[p._id] !== p.status)
    : [];
  // Mất mạng / quá giờ chờ nhưng sau khi tải lại thấy đã thu tiền → coi là thành công, đừng để khách bấm trả lần nữa.
  const done = phase.kind === 'ok' || (phase.kind === 'fail' && phase.code === 'NETWORK' && fresh.length > 0);
  // Đóng cổng rồi mới lùi về màn gốc: màn gọi cổng (gia hạn, dịch vụ…) đã xong việc nên cũng rời ngăn xếp — mở từ lối tắt ở trang chính
  // (màn gốc không nằm dưới) thì màn gọi được thay bằng màn gốc, không để lại màn cũ phía sau.
  const leave = () => {
    if (!intent) return;
    if (router.canDismiss()) router.dismiss();
    router.dismissTo(intent.back.href);
  };

  // Đã trả xong mà bấm nút back của máy → về thẳng màn gốc (không lùi về màn gia hạn / dịch vụ đã xong việc). Đang xử lý thì chặn back.
  useEffect(() => {
    if (!intent || !(done || phase.kind === 'processing')) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (done) leave();
      return true;
    });
    return () => sub.remove();
  }, [done, phase.kind, intent, router]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!intent) {
    return (
      <Screen>
        <EmptyState icon="card-outline" title="Không có khoản cần thanh toán" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const t = intent.target;
  // Số tiền mới nhất theo dữ liệu (công nợ / tiền giữ chỗ có thể đổi từ lúc mở cổng); không có thì theo lúc mở.
  const rsv = t.kind === 'DEPOSIT' ? byId(db.reservations, t.reservationId) : undefined;
  const live = t.kind === 'BALANCE' ? byId(db.contracts, t.contractId)?.balance.outstanding : rsv ? dueAtBooking(rsv.quote) : undefined;
  const amount = phase.kind === 'ok' ? phase.amount : done ? fresh.reduce((s, p) => s + p.amount, 0) : live || intent.amount;
  const branch = byId(db.facilities, intent.facilityId)?.name ?? catalog?.facilities.find((f) => f._id === intent.facilityId)?.name;
  const refs = fresh.map((p) => p.provider?.txnRef ?? p.provider?.counterRef).filter((x): x is string => !!x);
  const receipts = fresh.filter(hasReceipt);
  const busy = phase.kind === 'processing';
  const cancel = () => (router.canGoBack() ? router.back() : router.replace(intent.back.href));

  const confirm = async () => {
    const before = Object.fromEntries(db.payments.map((p) => [p._id, p.status])) as Record<string, PaymentStatus>;
    setPhase({ kind: 'processing' });
    const res = await payTarget(run, t, method, { amount, key: payKey });
    // Gia hạn / trả công nợ trả về số tiền đã thu; các khoản khác lấy theo số tiền đang hiện.
    if (res.ok) setPhase({ kind: 'ok', amount: typeof res.value === 'number' && res.value > 0 ? res.value : amount, at: new Date().toISOString(), before });
    else setPhase({ kind: 'fail', error: res.error, code: res.code, before });
  };

  const footer = (
    <>
      {(phase.kind === 'pay' || busy) && (
        <View style={st.footRow}>
          <Button title="Huỷ" variant="secondary" disabled={busy} style={{ flex: 1 }} onPress={cancel} />
          <Button title={QR_METHODS.includes(method) ? 'Tôi đã thanh toán' : 'Xác nhận thanh toán'} icon="lock-closed" loading={busy} style={{ flex: 2 }} onPress={() => void confirm()} />
        </View>
      )}
      {done && <Button title={intent.back.label} iconRight="arrow-forward" size="lg" onPress={leave} />}
      {phase.kind === 'fail' && !done && (
        phase.code === 'PRICE_CHANGED' ? (
          // Báo giá gia hạn đã đổi: quay lại màn gia hạn (tự tải báo giá mới) để khách xem và xác nhận lại.
          <Button title="Xem lại báo giá" icon="refresh" size="lg" onPress={cancel} />
        ) : phase.code === 'BALANCE_CHANGED' ? (
          // Đợt 15 (B5): số dư vừa đổi (phí trễ, hoá đơn kỳ mới) — dữ liệu đã tải lại, cổng hiện số mới; khách xem rồi bấm thanh toán lại.
          <Button title={`Thanh toán ${vnd(amount)}`} icon="refresh" size="lg" onPress={() => { setPayKey(newKey()); setPhase({ kind: 'pay' }); }} />
        ) : phase.code === 'NETWORK' || phase.code === 'HOLD_EXPIRED' ? (
          <View style={st.footRow}>
            {phase.code === 'NETWORK' && <Button title="Thử lại" variant="secondary" style={{ flex: 1 }} onPress={() => setPhase({ kind: 'pay' })} />}
            <Button title={intent.back.label} style={{ flex: 1.4 }} onPress={leave} />
          </View>
        ) : (
          <View style={st.footRow}>
            <Button title="Huỷ" variant="secondary" style={{ flex: 1 }} onPress={cancel} />
            <Button title="Thử lại" icon="refresh" style={{ flex: 1.4 }} onPress={() => setPhase({ kind: 'pay' })} />
          </View>
        )
      )}
    </>
  );

  return (
    <Screen footer={footer}>
      <View style={st.header}>
        <IconTile icon="shield-checkmark" tone="teal" solid size="lg" />
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Cổng thanh toán</Text>
          <View style={st.sandbox}>
            <Ionicons name="flask-outline" size={13} color={C.amber} />
            <Text style={st.sandboxText}>Môi trường thử nghiệm — không trừ tiền thật</Text>
          </View>
        </View>
        {!busy && (
          <Pressable onPress={done ? leave : cancel} accessibilityRole="button" accessibilityLabel={done ? intent.back.label : 'Huỷ thanh toán'}
            style={({ pressed }) => [st.close, pressed && { opacity: 0.6 }]}>
            <Ionicons name="close" size={22} color={C.sub} />
          </Pressable>
        )}
      </View>

      {done && (
        <View style={st.result}>
          <View style={[st.halo, { backgroundColor: C.greenBg }]}><Ionicons name="checkmark-circle" size={60} color={C.green} /></View>
          <Text style={[st.resultTitle, { color: C.green }]}>Thanh toán thành công</Text>
          {intent.doneNote ? <Text style={st.resultText}>{intent.doneNote}</Text> : null}
        </View>
      )}
      {phase.kind === 'fail' && !done && (
        <View style={st.result}>
          <View style={[st.halo, { backgroundColor: phase.code === 'NETWORK' ? C.amberBg : C.redBg }]}>
            <Ionicons name={phase.code === 'NETWORK' ? 'help-circle' : 'close-circle'} size={60} color={phase.code === 'NETWORK' ? C.amber : C.red} />
          </View>
          <Text style={[st.resultTitle, { color: phase.code === 'NETWORK' ? C.amber : C.red }]}>{phase.code === 'NETWORK' ? 'Chưa rõ kết quả' : 'Thanh toán không thành công'}</Text>
          <Text style={st.resultText}>{phase.code === 'NETWORK' ? 'Kết nối chậm. Kiểm tra trạng thái ở màn trước rồi hãy thử lại.' : phase.code === 'BALANCE_CHANGED' ? `Số tiền cần thanh toán đã đổi thành ${vnd(amount)} — kiểm tra rồi bấm thanh toán lại.` : phase.error}</Text>
        </View>
      )}

      <View style={st.bill}>
        <View style={st.billTop}>
          <Text style={st.billLabel}>Số tiền</Text>
          <Text style={st.amount} numberOfLines={1} adjustsFontSizeToFit>{vnd(amount)}</Text>
        </View>
        <View style={{ padding: S.lg }}>
          <KV items={[
            ['Người nhận', `KhoAn${branch ? ` — ${branch}` : ''}`],
            ['Nội dung', `${intent.code} · ${intent.purpose}`],
            ...(done ? [
              ['Hình thức', PAYMENT_METHOD[method]],
              ...(refs.length ? [['Mã giao dịch', refs.join(', ')]] : []),
              ['Thời gian', fmtDateTime(phase.kind === 'ok' ? phase.at : fresh[0]?.paidAt ?? null)],
            ] as [string, string][] : []),
          ]} />
        </View>
      </View>

      {(phase.kind === 'pay' || busy) && (
        <>
          <SectionHeader title="Hình thức thanh toán" icon="wallet-outline" />
          <View pointerEvents={busy ? 'none' : 'auto'} style={{ gap: S.sm }}>
            {METHODS.map((m) => (
              <OptionCard key={m.value} selected={method === m.value} onPress={() => setMethod(m.value)} icon={METHOD_ICON[m.value] ?? 'card-outline'} title={m.label} />
            ))}
          </View>
          {QR_METHODS.includes(method) && (
            <View style={st.panel}>
              <View style={st.qr}><QRCode value={`KHOAN-DEMO|${method}|${intent.code}|${amount}`} size={168} backgroundColor="#fff" color={C.ink} /></View>
              <Muted style={{ textAlign: 'center' } as never}>Mã mẫu — mở ứng dụng {PAYMENT_METHOD[method]} để quét</Muted>
            </View>
          )}
          {method === 'CARD' && (
            <View style={st.panel}>
              <View style={st.card}>
                <View style={st.cardRow}>
                  <Ionicons name="card-outline" size={22} color="#fff" />
                  <Ionicons name="wifi-outline" size={20} color={C.brand200} style={{ transform: [{ rotate: '90deg' }] }} />
                </View>
                <Text style={st.cardNumber}>{DEMO_CARD.number}</Text>
                <View style={st.cardRow}>
                  <Text style={st.cardMeta}>{DEMO_CARD.holder}</Text>
                  <Text style={st.cardMeta}>{DEMO_CARD.exp} · CVV •••</Text>
                </View>
              </View>
              <Muted style={{ textAlign: 'center' } as never}>Thẻ mẫu, chỉ để hiển thị — không nhập thẻ thật</Muted>
            </View>
          )}
          {method === 'BANK_TRANSFER' && (
            <View style={[st.panel, st.bank]}>
              <KV items={[
                ['Ngân hàng', DEMO_BANK.bank],
                ['Số tài khoản', DEMO_BANK.account],
                ['Chủ tài khoản', DEMO_BANK.holder],
                ['Nội dung CK', `${intent.code} ${intent.purpose}`.toUpperCase()],
              ]} />
            </View>
          )}
        </>
      )}

      {done && receipts.length > 0 && (
        <View style={{ marginTop: S.md, gap: S.sm }}>
          {receipts.map((p, i) => (
            <Button
              key={p._id} variant="secondary" icon="receipt-outline" loading={receipt.opening === p._id} disabled={receipt.opening !== null}
              title={receipts.length > 1 ? `Biên lai PDF (${i + 1}) · ${vnd(p.amount)}` : 'Biên lai PDF'}
              onPress={() => void receipt.open(p._id)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.lg },
  title: { fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  close: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  sandbox: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 4, backgroundColor: C.amberBg, borderRadius: R.full, paddingHorizontal: S.sm, paddingVertical: 2, borderWidth: 1, borderColor: C.amberLine },
  sandboxText: { fontSize: 12, fontWeight: '600', color: C.amber },
  bill: { backgroundColor: C.card, borderRadius: R.xl, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...SHADOW.card },
  billTop: { backgroundColor: C.brand900, paddingHorizontal: S.lg, paddingVertical: S.lg },
  billLabel: { fontSize: 13, color: C.brand200, fontWeight: '600' },
  amount: { fontSize: 32, fontWeight: '800', color: C.white, marginTop: 2, ...T.tabular },
  panel: { marginTop: S.md, alignItems: 'center', gap: S.sm },
  qr: { padding: S.md, backgroundColor: '#fff', borderRadius: R.lg, borderWidth: 1, borderColor: C.line, ...SHADOW.card },
  card: { alignSelf: 'stretch', backgroundColor: C.brand800, borderRadius: R.lg, padding: S.lg, gap: S.md, ...SHADOW.lift },
  cardNumber: { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: 2, fontFamily: MONO, ...T.tabular },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm },
  cardMeta: { fontSize: 12, fontWeight: '600', color: C.brand100 },
  bank: { alignSelf: 'stretch', alignItems: 'stretch', backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.md },
  result: { alignItems: 'center', gap: S.xs, marginBottom: S.lg },
  halo: { padding: 10, borderRadius: 50, marginBottom: S.xs },
  resultTitle: { fontSize: 19, fontWeight: '800' },
  resultText: { fontSize: 13, color: C.text, textAlign: 'center', lineHeight: 19, paddingHorizontal: S.md },
  footRow: { flexDirection: 'row', gap: S.sm },
});
