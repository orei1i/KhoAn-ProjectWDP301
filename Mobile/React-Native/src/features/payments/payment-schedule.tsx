import { StyleSheet, Text, View } from 'react-native';
import type { PriceQuote } from '@ssm/shared';
import { buildPaymentSchedule, paymentPaidText, paymentTotalText, vnd } from '@ssm/shared';
import { C, R, S } from '../../shared/ui/theme';

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
      <Text style={st.title}>{paid ? 'Các khoản thanh toán của đặt chỗ này' : `Bạn sẽ thanh toán ${upfront} khoản trước khi dùng kho`}</Text>
      {s.steps.map((step, i) => (
        <View key={step.key} style={[st.step, step.key === 'NEXT_PERIODS' && { opacity: 0.8 }]}>
          <View style={[st.dot, i >= upfront && st.dotLight]}><Text style={[st.dotText, i >= upfront && { color: C.amber }]}>{i < upfront ? i + 1 : '…'}</Text></View>
          <View style={{ flex: 1 }}>
            <View style={st.row}>
              <View style={{ flex: 1 }}>
                <Text style={st.when}>{paid && (step.key === 'DEPOSIT' || step.key === 'FIRST_RENT_NOW') ? 'Đã trả khi đặt chỗ' : step.when}</Text>
                <Text style={st.stepTitle}>{step.title}</Text>
              </View>
              <Text style={st.amount}>{vnd(step.amount)}</Text>
            </View>
            {!compact && <Text style={st.note}>{step.note}</Text>}
          </View>
        </View>
      ))}
      <Text style={st.total}>{paid ? paymentPaidText(s) : paymentTotalText(s)}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  box: { backgroundColor: C.amberBg, borderColor: '#fde68a', borderWidth: 1, borderRadius: R.lg, padding: S.md, gap: S.sm },
  title: { fontSize: 14, fontWeight: '700', color: '#78350f' },
  step: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  dotLight: { backgroundColor: '#fde68a' },
  dotText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm },
  when: { fontSize: 11, fontWeight: '700', color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4 },
  stepTitle: { fontSize: 14, fontWeight: '600', color: C.ink },
  amount: { fontSize: 15, fontWeight: '700', color: C.ink },
  note: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 2 },
  total: { fontSize: 12, fontWeight: '600', color: '#78350f', backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: R.md, padding: S.sm, lineHeight: 17 },
});
