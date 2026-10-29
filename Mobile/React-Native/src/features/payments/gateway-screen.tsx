import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import type { PaymentMethod, PaymentStatus } from '@ssm/shared';
import { COLLECTED_PAYMENT_STATUSES, PAYMENT_METHOD, dueAtBooking, fmtDateTime, vnd } from '@ssm/shared';
import { byId, useStore } from '../../shared/store/store';
import { Button, Card, Chips, EmptyState, KV, Muted, Screen } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';
import { parseIntent, payTarget } from './pay-intent';
import { hasReceipt, useReceipt } from './receipt';

/** Hình thức khách tự trả online (tiền mặt chỉ thu tại quầy). */
const ONLINE_METHODS: PaymentMethod[] = ['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'];
const METHODS = ONLINE_METHODS.map((v) => ({ value: v, label: PAYMENT_METHOD[v] }));
const QR_METHODS: PaymentMethod[] = ['VNPAY', 'MOMO'];
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
    const res = await payTarget(run, t, method);
    // Gia hạn / trả công nợ trả về số tiền đã thu; các khoản khác lấy theo số tiền đang hiện.
    if (res.ok) setPhase({ kind: 'ok', amount: typeof res.value === 'number' && res.value > 0 ? res.value : amount, at: new Date().toISOString(), before });
    else setPhase({ kind: 'fail', error: res.error, code: res.code, before });
  };

  return (
    <Screen>
      <View style={st.header}>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Cổng thanh toán</Text>
          <View style={st.sandbox}>
            <Ionicons name="flask-outline" size={13} color={C.amber} />
            <Text style={st.sandboxText}>Môi trường thử nghiệm — không trừ tiền thật</Text>
          </View>
        </View>
        {!busy && (
          <Pressable onPress={done ? leave : cancel} hitSlop={12} accessibilityRole="button" accessibilityLabel={done ? intent.back.label : 'Huỷ thanh toán'}>
            <Ionicons name="close" size={26} color={C.muted} />
          </Pressable>
        )}
      </View>

      {done && (
        <View style={st.result}>
          <Ionicons name="checkmark-circle" size={56} color={C.green} />
          <Text style={[st.resultTitle, { color: C.green }]}>Thanh toán thành công</Text>
          {intent.doneNote ? <Text style={st.resultText}>{intent.doneNote}</Text> : null}
        </View>
      )}
      {phase.kind === 'fail' && !done && (
        <View style={st.result}>
          <Ionicons name={phase.code === 'NETWORK' ? 'help-circle' : 'close-circle'} size={56} color={phase.code === 'NETWORK' ? C.amber : C.red} />
          <Text style={[st.resultTitle, { color: phase.code === 'NETWORK' ? C.amber : C.red }]}>{phase.code === 'NETWORK' ? 'Chưa rõ kết quả' : 'Thanh toán không thành công'}</Text>
          <Text style={st.resultText}>{phase.code === 'NETWORK' ? 'Kết nối chậm. Kiểm tra trạng thái ở màn trước rồi hãy thử lại.' : phase.error}</Text>
        </View>
      )}

      <Card>
        <Muted>Số tiền</Muted>
        <Text style={st.amount}>{vnd(amount)}</Text>
        <View style={st.divider} />
        <KV items={[
          ['Người nhận', `KhoAn${branch ? ` — ${branch}` : ''}`],
          ['Nội dung', `${intent.code} · ${intent.purpose}`],
          ...(done ? [
            ['Hình thức', PAYMENT_METHOD[method]],
            ...(refs.length ? [['Mã giao dịch', refs.join(', ')]] : []),
            ['Thời gian', fmtDateTime(phase.kind === 'ok' ? phase.at : fresh[0]?.paidAt ?? null)],
          ] as [string, string][] : []),
        ]} />
      </Card>

      {(phase.kind === 'pay' || busy) && (
        <Card style={{ marginTop: S.md }}>
          <Text style={st.section}>Hình thức thanh toán</Text>
          <View pointerEvents={busy ? 'none' : 'auto'}>
            <Chips options={METHODS} value={method} onChange={setMethod} columns={2} />
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
                <Ionicons name="card-outline" size={22} color="#fff" />
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
        </Card>
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

      <View style={{ marginTop: S.lg, gap: S.sm }}>
        {(phase.kind === 'pay' || busy) && (
          <>
            <Button title={QR_METHODS.includes(method) ? 'Tôi đã thanh toán' : 'Xác nhận thanh toán'} loading={busy} onPress={() => void confirm()} />
            <Button title="Huỷ" variant="ghost" disabled={busy} onPress={cancel} />
          </>
        )}
        {done && <Button title={intent.back.label} icon="arrow-forward" onPress={leave} />}
        {phase.kind === 'fail' && !done && (
          phase.code === 'PRICE_CHANGED' ? (
            // Báo giá gia hạn đã đổi: quay lại màn gia hạn (tự tải báo giá mới) để khách xem và xác nhận lại.
            <Button title="Xem lại báo giá" onPress={cancel} />
          ) : phase.code === 'NETWORK' || phase.code === 'HOLD_EXPIRED' ? (
            <>
              <Button title={intent.back.label} onPress={leave} />
              {phase.code === 'NETWORK' && <Button title="Thử lại" variant="secondary" onPress={() => setPhase({ kind: 'pay' })} />}
            </>
          ) : (
            <>
              <Button title="Thử lại" onPress={() => setPhase({ kind: 'pay' })} />
              <Button title="Huỷ" variant="ghost" onPress={cancel} />
            </>
          )
        )}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, marginBottom: S.lg },
  title: { fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  sandbox: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 4, backgroundColor: C.amberBg, borderRadius: R.full, paddingHorizontal: S.sm, paddingVertical: 2 },
  sandboxText: { fontSize: 12, fontWeight: '600', color: C.amber },
  amount: { fontSize: 30, fontWeight: '800', color: C.ink, marginTop: 2, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: C.line, marginVertical: S.md },
  section: { fontSize: 15, fontWeight: '700', color: C.ink, marginBottom: S.sm },
  panel: { marginTop: S.md, alignItems: 'center', gap: S.sm },
  qr: { padding: S.md, backgroundColor: '#fff', borderRadius: R.md, borderWidth: 1, borderColor: C.line },
  card: { alignSelf: 'stretch', backgroundColor: C.brand900, borderRadius: R.lg, padding: S.lg, gap: S.md },
  cardNumber: { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: 2, fontVariant: ['tabular-nums'] },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', gap: S.sm },
  cardMeta: { fontSize: 12, fontWeight: '600', color: C.brand100 },
  bank: { alignSelf: 'stretch', alignItems: 'stretch', backgroundColor: C.bg, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.md },
  result: { alignItems: 'center', gap: S.xs, marginBottom: S.lg },
  resultTitle: { fontSize: 18, fontWeight: '700' },
  resultText: { fontSize: 13, color: C.text, textAlign: 'center', lineHeight: 19, paddingHorizontal: S.md },
});
