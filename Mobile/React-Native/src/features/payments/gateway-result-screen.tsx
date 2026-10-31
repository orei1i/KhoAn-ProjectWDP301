import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { GatewayOrderKind, GatewayOrderView } from '@ssm/shared';
import { GATEWAY_REFUND_PENDING_LABEL, GATEWAY_REFUND_STATE, GATEWAY_REFUND_TRANSFERRED_LABEL, GATEWAY_TXN_REF_RE, LOST_KEY_URGENT_NOTE, fmtDateTime, vnd } from '@ssm/shared';
import { ApiError, api } from '../../shared/api/client';
import { byId, useStore } from '../../shared/store/store';
import { Button, Callout, EmptyState, IconTile, KV, Muted, Screen } from '../../shared/ui';
import { C, R, S, SHADOW, T } from '../../shared/ui/theme';
import { hasReceipt, useReceipt } from './receipt';

const POLL_MS = 3_000;
const POLL_WINDOW_MS = 90_000;

const KIND_LABEL: Record<GatewayOrderKind, string> = {
  DEPOSIT: 'Thanh toán khi đặt chỗ', BALANCE: 'Thanh toán công nợ', EXTEND: 'Gia hạn hợp đồng', SERVICE: 'Dịch vụ thêm', ACCESS_FEE: 'Phí cấp lại thẻ / chìa',
};

interface ReturnTo { href: string; label: string; note?: string }

const HOME: ReturnTo = { href: '/', label: 'Về trang chủ' };
/** Đúng các màn gốc mà 5 luồng trả tiền quay về (xem `back` ở nơi gọi `payHref`). */
const BACK_HREF_RE = /^\/(?:booking\/[0-9a-f]{24}|contract\/[0-9a-f]{24}|contract\/access\?contract=[0-9a-f]{24})$/;
const MAX_LABEL = 40;
const MAX_NOTE = 240;

/** Điểm về do chính cổng trong app truyền, theo mã giao dịch: deep link từ trình duyệt chỉ có `ref`, có thể thay tham số của màn đang mở. */
const RETURN_BY_REF = new Map<string, ReturnTo>();

/**
 * URL là đầu vào không tin cậy (app nào cũng mở được khoan://pay-result?...): `backHref` chỉ nhận các đường dẫn nội bộ đã biết — router sẽ mở cả
 * link ngoài nếu truyền thẳng. `note` chỉ hiện khi server xác nhận đã trả, và không tham số nào được dùng để kết luận kết quả.
 */
function readReturn(params: { backHref?: unknown; backLabel?: unknown; note?: unknown }, txnRef: string | null): ReturnTo | null {
  const { backHref, backLabel, note } = params;
  if (typeof backHref === 'string' && BACK_HREF_RE.test(backHref)) {
    return {
      href: backHref,
      label: typeof backLabel === 'string' && backLabel.trim() && backLabel.length <= MAX_LABEL ? backLabel : 'Quay lại',
      ...(typeof note === 'string' && note.length <= MAX_NOTE ? { note } : {}),
    };
  }
  return (txnRef && RETURN_BY_REF.get(txnRef)) || null;
}

/** Mở từ deep link khi app đã tắt (không còn tham số): suy màn gốc theo loại khoản, đúng như nơi gọi cổng. */
function backOfOrder(o: GatewayOrderView): ReturnTo {
  if (o.kind === 'DEPOSIT') return o.reservationId ? { href: `/booking/${o.reservationId}`, label: 'Về đặt chỗ' } : HOME;
  if (!o.contractId) return HOME;
  return o.kind === 'ACCESS_FEE' ? { href: `/contract/access?contract=${o.contractId}`, label: 'Về mã vào kho' } : { href: `/contract/${o.contractId}`, label: 'Về hợp đồng' };
}

/** Khách không thấy REJECTED / UNKNOWN (BE đã đổi thành SENDING; client vẫn chặn lần nữa). Hoàn qua VNPAY không được ghi là đã hoàn xong. */
function refundText(r: NonNullable<GatewayOrderView['refund']>) {
  if (r.state === 'DONE') return `${GATEWAY_REFUND_STATE.DONE.label} — tiền về tuỳ ngân hàng`;
  if (r.transferred) return GATEWAY_REFUND_TRANSFERRED_LABEL.label;
  if (r.state === 'MOVED_TO_BANK') return `${GATEWAY_REFUND_STATE.MOVED_TO_BANK.label} — KhoAn sẽ chuyển cho bạn`;
  return GATEWAY_REFUND_PENDING_LABEL.label;
}

/**
 * Kết quả thanh toán VNPAY. Chỉ tin GET /payments/gateway-orders/:txnRef — tham số trên URL không kết luận được gì.
 * Hỏi lại mỗi 3 giây trong 90 giây khi màn đang mở, và mỗi lần app quay lại từ trình duyệt (AppState về `active`).
 */
export default function GatewayResultScreen() {
  const params = useLocalSearchParams<{ ref?: string; backHref?: string; backLabel?: string; note?: string }>();
  const txnRef = typeof params.ref === 'string' && GATEWAY_TXN_REF_RE.test(params.ref) ? params.ref : null;
  return <Result key={txnRef ?? 'invalid'} txnRef={txnRef} returnTo={readReturn(params, txnRef)} />;
}

function Result({ txnRef, returnTo }: { txnRef: string | null; returnTo: ReturnTo | null }) {
  const { db, refresh, toast } = useStore();
  const router = useRouter();
  const receipt = useReceipt();
  const [order, setOrder] = useState<GatewayOrderView | null>(null);
  const [issue, setIssue] = useState<'NOT_FOUND' | 'UNREACHABLE' | null>(txnRef ? null : 'NOT_FOUND');
  const [windowKey, setWindowKey] = useState(0);
  const [windowOpen, setWindowOpen] = useState(true);
  const inFlight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (txnRef && returnTo) RETURN_BY_REF.set(txnRef, returnTo); // một lần lúc mở: `leave` xoá rồi thì lần vẽ lại không được ghi lại
    return () => { alive.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useCallback(async () => {
    if (!txnRef || inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api.get<GatewayOrderView>(`/payments/gateway-orders/${txnRef}`);
      if (alive.current) { setOrder(next); setIssue(null); }
    } catch (e) {
      // Mất mạng, server đang thức dậy, 429: chưa biết gì nên không kết luận, lượt sau hỏi lại.
      if (alive.current) setIssue(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'NOT_FOUND' : 'UNREACHABLE');
    } finally {
      inFlight.current = false;
    }
  }, [txnRef]);

  const reopenWindow = useCallback(() => {
    setWindowOpen(true);
    setWindowKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setWindowOpen(false), POLL_WINDOW_MS);
    return () => clearTimeout(t);
  }, [windowKey]);

  const pending = !order || order.status === 'PENDING';
  const polling = windowOpen && pending && issue !== 'NOT_FOUND';

  // Chỉ chạy khi màn đang ở trên cùng; deep link có thể chồng thêm một màn cùng loại lên trên.
  useFocusEffect(useCallback(() => {
    void check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { reopenWindow(); void check(); }
    });
    return () => sub.remove();
  }, [check, reopenWindow]));

  useFocusEffect(useCallback(() => {
    if (!polling) return;
    const t = setInterval(() => {
      if (AppState.currentState === 'active') void check();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [polling, check]));

  // Tiền đã vào: đặt chỗ, hợp đồng, lịch sử đều đổi.
  const settled = order?.status === 'PAID' || order?.status === 'PAID_UNAPPLIED';
  useEffect(() => {
    if (settled) refresh().catch(() => {});
  }, [settled, refresh]);

  const back = returnTo ?? (order ? backOfOrder(order) : HOME);
  const viaGateway = !!returnTo;
  const backHref = back.href;

  const leave = useCallback(() => {
    if (txnRef) RETURN_BY_REF.delete(txnRef);
    // Mở từ deep link khi app đã tắt: ngăn xếp chỉ có màn này, phải dựng lại trang chủ bên dưới để màn gốc còn nút quay lại.
    if (!router.canDismiss()) {
      router.replace('/');
      if (backHref !== '/') router.push(backHref as never);
      return;
    }
    // Đi từ cổng: màn gọi cổng (gia hạn, dịch vụ…) đã xong việc nên cũng rời ngăn xếp, như cổng hiện tại.
    if (viaGateway) router.dismiss();
    router.dismissTo(backHref as never);
  }, [router, txnRef, viaGateway, backHref]);

  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
  }, [leave]));

  const resume = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast('Không mở được trình duyệt — thử lại sau', 'error');
    }
  };

  const noSwipeBack = <Stack.Screen options={{ gestureEnabled: false }} />;

  if (issue === 'NOT_FOUND' && !order) {
    return (
      <Screen>
        {noSwipeBack}
        <EmptyState icon="search-outline" title="Không tìm thấy giao dịch" action={<Button title={back.label} variant="secondary" onPress={leave} />} />
      </Screen>
    );
  }

  const receiptIds = order?.status === 'PAID'
    ? order.paymentIds.filter((id) => {
      const p = byId(db.payments, id);
      return !p || hasReceipt(p); // chưa tải kịp thì vẫn cho mở: server tự kiểm khi xin link
    })
    : [];

  const footer = polling ? (
    <Button title={back.label} variant="secondary" onPress={leave} />
  ) : pending ? (
    <View style={{ gap: S.sm }}>
      <View style={st.footRow}>
        <Button title="Kiểm tra lại" icon="refresh" variant={order?.payUrl ? 'secondary' : 'primary'} style={{ flex: 1 }} onPress={() => { reopenWindow(); void check(); }} />
        {order?.payUrl ? <Button title="Tiếp tục thanh toán" iconRight="open-outline" style={{ flex: 1.4 }} onPress={() => void resume(order.payUrl!)} /> : null}
      </View>
      <Button title={back.label} variant="ghost" onPress={leave} />
    </View>
  ) : (
    <Button title={back.label} iconRight="arrow-forward" size="lg" onPress={leave} />
  );

  return (
    <Screen footer={footer}>
      {noSwipeBack}
      <View style={st.header}>
        <IconTile icon="shield-checkmark" tone="teal" solid size="lg" />
        <Text style={st.title}>Kết quả thanh toán</Text>
      </View>

      {polling && (
        <View style={st.result}>
          <ActivityIndicator size="large" color={C.brand700} style={{ marginVertical: S.md }} />
          <Text style={st.resultTitle}>Đang xử lý giao dịch</Text>
          <Text style={st.resultText}>Nếu chưa trả xong, hãy hoàn tất trên trang VNPAY rồi quay lại ứng dụng.</Text>
        </View>
      )}
      {!polling && pending && (
        <View style={st.result}>
          <View style={[st.halo, { backgroundColor: C.amberBg }]}><Ionicons name="time" size={60} color={C.amber} /></View>
          <Text style={[st.resultTitle, { color: C.amber }]}>{order ? 'Chưa nhận được kết quả' : 'Chưa kiểm tra được kết quả'}</Text>
          <Text style={st.resultText}>Nếu đã trả, hệ thống tự cập nhật trong vài phút.</Text>
        </View>
      )}
      {order?.status === 'PAID' && (
        <View style={st.result}>
          <View style={[st.halo, { backgroundColor: C.greenBg }]}><Ionicons name="checkmark-circle" size={60} color={C.green} /></View>
          <Text style={[st.resultTitle, { color: C.green }]}>Thanh toán thành công</Text>
          {returnTo?.note ? <Text style={st.resultText}>{returnTo.note}</Text> : null}
        </View>
      )}
      {order?.status === 'PAID_UNAPPLIED' && (
        <View style={st.result}>
          <View style={[st.halo, { backgroundColor: C.amberBg }]}><Ionicons name="alert-circle" size={60} color={C.amber} /></View>
          <Text style={[st.resultTitle, { color: C.amber }]}>KhoAn đã nhận tiền nhưng không thực hiện được</Text>
          {order.unapplied?.message ? <Text style={st.resultText}>{order.unapplied.message}</Text> : null}
          <Text style={st.resultText}>Tiền đang được hoàn.</Text>
        </View>
      )}
      {(order?.status === 'FAILED' || order?.status === 'EXPIRED' || order?.status === 'SUPERSEDED') && (
        <View style={st.result}>
          <View style={[st.halo, { backgroundColor: C.redBg }]}><Ionicons name="close-circle" size={60} color={C.red} /></View>
          <Text style={[st.resultTitle, { color: C.red }]}>Giao dịch không thành công hoặc đã hết hạn</Text>
          <Text style={st.resultText}>Bạn có thể quay lại để thử thanh toán lần nữa.</Text>
        </View>
      )}

      {order && (
        <View style={st.bill}>
          <View style={st.billTop}>
            <Text style={st.billLabel}>Số tiền</Text>
            <Text style={st.amount} numberOfLines={1} adjustsFontSizeToFit>{vnd(order.amount)}</Text>
          </View>
          <View style={{ padding: S.lg }}>
            <KV items={[
              ['Nội dung', KIND_LABEL[order.kind]],
              ['Mã tham chiếu', order.txnRef],
              ...(order.transactionNo ? [['Mã giao dịch VNPAY', order.transactionNo]] : []),
              ...(order.paidAt ? [['Thời gian', fmtDateTime(order.paidAt)]] : []),
              ...(order.refund ? [['Tiền hoàn', `${vnd(order.refund.amount)} · ${refundText(order.refund)}`]] : []),
            ] as [string, string][]} />
          </View>
        </View>
      )}

      {order?.kind === 'ACCESS_FEE' && order.status !== 'PAID' && (
        <Callout tone="amber" icon="call-outline" style={{ marginTop: S.md }}>{LOST_KEY_URGENT_NOTE}</Callout>
      )}

      {receiptIds.length > 0 && (
        <View style={{ marginTop: S.md, gap: S.sm }}>
          {receiptIds.map((id, i) => (
            <Button
              key={id} variant="secondary" icon="receipt-outline" loading={receipt.opening === id} disabled={receipt.opening !== null}
              title={receiptIds.length > 1 ? `Biên lai PDF (${i + 1})` : 'Biên lai PDF'}
              onPress={() => void receipt.open(id)}
            />
          ))}
        </View>
      )}

      {!order && !polling && issue === 'UNREACHABLE' && <Muted style={{ marginTop: S.md, textAlign: 'center' } as never}>Không kết nối được máy chủ. Kiểm tra mạng rồi bấm Kiểm tra lại.</Muted>}
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.lg },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  bill: { backgroundColor: C.card, borderRadius: R.xl, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...SHADOW.card },
  billTop: { backgroundColor: C.brand900, paddingHorizontal: S.lg, paddingVertical: S.lg },
  billLabel: { fontSize: 13, color: C.brand200, fontWeight: '600' },
  amount: { fontSize: 32, fontWeight: '800', color: C.white, marginTop: 2, ...T.tabular },
  result: { alignItems: 'center', gap: S.xs, marginBottom: S.lg },
  halo: { padding: 10, borderRadius: 50, marginBottom: S.xs },
  resultTitle: { fontSize: 19, fontWeight: '800', color: C.ink, textAlign: 'center' },
  resultText: { fontSize: 13, color: C.text, textAlign: 'center', lineHeight: 19, paddingHorizontal: S.md },
  footRow: { flexDirection: 'row', gap: S.sm },
});
