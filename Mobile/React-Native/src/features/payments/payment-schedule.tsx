import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PriceQuote } from '@ssm/shared';
import { buildPaymentSchedule, paymentPaidText, paymentTotalText, vnd } from '@ssm/shared';
import { C, R, S, T } from '../../shared/ui/theme';

/**
 * Lịch thanh toán "giữ chân + kỳ đầu": nói rõ NGAY LÚC ĐẶT khách phải trả gì, lúc nào — kho thường trả tiền giữ chân
 * hôm nay rồi trả THÊM tiền thuê kỳ đầu khi nhận kho; kho cỡ lớn trả cả hai ngay lúc đặt. Cùng nguồn số liệu với hợp đồng (shared).
 */
export function PaymentSchedule({ quotes, graceDays, compact = false, paid = false }: {
  quotes: readonly (Pick<PriceQuote, 'depositAmount' | 'firstPeriodRent' | 'rentalPeriod'> & Partial<Pick<PriceQuote, 'firstPeriodAtBooking' | 'depositPeriods'>>)[]; graceDays?: number; compact?: boolean;
  /** Khách ĐÃ trả các khoản lúc đặt chỗ — đổi lời "sẽ thanh toán / hôm nay" thành "đã trả". */
  paid?: boolean;
}) {
  if (quotes.length === 0) return null;
  const s = buildPaymentSchedule(quotes, graceDays);
  const upfront = s.steps.filter((x) => x.key !== 'NEXT_PERIODS').length;
  return (
    <View style={st.box}>
      <View style={st.head}>
        <Ionicons name={paid ? 'checkmark-done-circle-outline' : 'calendar-number-outline'} size={18} color={C.amber} />
        <Text style={st.title}>{paid ? 'Các khoản thanh toán của đặt chỗ này' : `Bạn sẽ thanh toán ${upfront} khoản trước khi dùng kho`}</Text>
      </View>
      {s.steps.map((step, i) => {
        const done = paid && (step.key === 'DEPOSIT' || step.key === 'FIRST_RENT_NOW');
        const last = i === s.steps.length - 1;
        return (
          <View key={step.key} style={[st.step, step.key === 'NEXT_PERIODS' && { opacity: 0.8 }]}>
            <View style={st.rail}>
              <View style={[st.dot, i >= upfront && st.dotLight, done && { backgroundColor: C.green }]}>
                {done ? <Ionicons name="checkmark" size={12} color={C.white} /> : <Text style={[st.dotText, i >= upfront && { color: C.amber }]}>{i < upfront ? i + 1 : '…'}</Text>}
              </View>
              {!last && <View style={st.line} />}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : S.sm }}>
              <View style={st.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[st.when, done && { color: C.green }]}>{done ? 'Đã trả khi đặt chỗ' : step.when}</Text>
                  <Text style={st.stepTitle}>{step.title}</Text>
                </View>
                <Text style={st.amount}>{vnd(step.amount)}</Text>
              </View>
              {!compact && <Text style={st.note}>{step.note}</Text>}
            </View>
          </View>
        );
      })}
      <Text style={st.total}>{paid ? paymentPaidText(s) : paymentTotalText(s)}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  box: { backgroundColor: C.amberBg, borderColor: C.amberLine, borderWidth: 1, borderRadius: R.lg, padding: S.md, gap: S.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: 2 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: C.amberInk },
  step: { flexDirection: 'row', gap: S.sm, alignItems: 'stretch' },
  rail: { alignItems: 'center', width: 22 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  dotLight: { backgroundColor: C.amberLine },
  dotText: { fontSize: 11, fontWeight: '800', color: C.white },
  line: { flex: 1, width: 2, backgroundColor: C.amberLine, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm },
  when: { fontSize: 11, fontWeight: '700', color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4 },
  stepTitle: { fontSize: 14, fontWeight: '600', color: C.ink },
  amount: { fontSize: 15, fontWeight: '800', color: C.ink, ...T.tabular },
  note: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 2 },
  total: { fontSize: 12, fontWeight: '600', color: C.amberInk, backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: R.md, padding: S.sm, lineHeight: 17 },
});
