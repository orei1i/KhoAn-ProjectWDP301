import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PERIOD_UNIT, extensionPaymentText, fmtDate, lastDayOf, periodLabel, vnd, type ExtensionQuote } from '@ssm/shared';
import { api } from '../../shared/api/client';
import { newKey } from '../../shared/api/actions';
import { byId, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, Chips, EmptyState, KV, Muted, Screen, ScreenHeader } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';
import { payHref } from '../payments/pay-intent';
import { AppendixText } from './appendix-text';

/** Hai báo giá trùng đúng các con số server đối chiếu khi gia hạn (rate, payNow, from, newEndDate). */
const quoteSig = (q: ExtensionQuote | null) => (q ? `${q.rate}|${q.payNow}|${q.from}|${q.newEndDate}` : '');
/** Số kỳ gia hạn cho chọn — nhãn theo chu kỳ thuê của hợp đồng (ngày / tuần / tháng) bằng periodLabel, như web. */
const PERIOD_CHOICES = ['1', '3', '6', '12'] as const;
type PeriodChoice = (typeof PERIOD_CHOICES)[number];

/**
 * Gia hạn hợp đồng: chọn số kỳ → báo giá mới từ server → xác nhận Phụ lục gia hạn → thanh toán qua cổng (thuê tháng: tiền thuê tháng
 * đầu của kỳ gia hạn; ngày / tuần: trọn kỳ) — cổng gọi API gia hạn khi khách xác nhận thanh toán.
 */
export default function ExtendScreen() {
  const { contract: id } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const [periods, setPeriods] = useState<PeriodChoice>('3');

  // Mọi hook phải gọi TRƯỚC lần return sớm "không tìm thấy hợp đồng" bên dưới — số hook giữa các lần render phải như nhau.
  const periodsNum = Number(periods);
  const canExtend = byId(db.contracts, id)?.status === 'ACTIVE';
  // Báo giá gia hạn lấy từ server mỗi khi đổi số kỳ — gia hạn là cam kết mới nên giá và ưu đãi tính lại, không dùng giá cũ.
  // Chỉ hỏi khi hợp đồng đang hiệu lực (chỉ lúc đó mới gia hạn được).
  // idemKey: khoá chống gửi trùng gắn với báo giá đang xem — bấm lại cùng báo giá thì server trả kết quả lần trước; báo giá mới thì khoá mới.
  const [ext, setExt] = useState<{ key: string; quote: ExtensionQuote | null; error: string; idemKey: string }>({ key: '', quote: null, error: '', idemKey: '' });
  const extKey = `${id}:${periodsNum}`;
  // Tăng để tải lại báo giá khi server báo giá đã đổi (PRICE_CHANGED) lúc bấm gia hạn.
  const [extReload, setExtReload] = useState(0);
  useEffect(() => {
    if (!id || !canExtend) return;
    let alive = true;
    const key = `${id}:${periodsNum}`;
    // Tải lại mà báo giá y hệt (quay về từ cổng thanh toán) thì giữ khoá cũ — lần gửi trước nếu đã tới server thì không gia hạn lần hai.
    api.get<ExtensionQuote>(`/contracts/${id}/extension-quote?periods=${periodsNum}`)
      .then((quote) => alive && setExt((prev) => ({ key, quote, error: '', idemKey: prev.key === key && prev.idemKey && quoteSig(prev.quote) === quoteSig(quote) ? prev.idemKey : newKey() })))
      .catch((e) => alive && setExt({ key, quote: null, error: e instanceof Error ? e.message : 'Không tính được giá gia hạn', idemKey: '' }));
    return () => { alive = false; };
  }, [id, periodsNum, canExtend, extReload]);
  // Quay lại màn này (huỷ ở cổng thanh toán, báo giá đã đổi…) → hỏi lại báo giá. Lần hiện đầu tiên đã tải ở effect trên.
  const seen = useRef(false);
  useFocusEffect(useCallback(() => {
    if (seen.current) setExtReload((n) => n + 1);
    seen.current = true;
  }, []));
  const extQuote = ext.key === extKey ? ext.quote : null;
  // Khách phải tick xác nhận Phụ lục gia hạn; báo giá khác (đổi số kỳ, giá vừa đổi) là phụ lục khác — phải xác nhận lại.
  const [agree, setAgree] = useState(false);
  const [showAppendix, setShowAppendix] = useState(false);
  const sig = quoteSig(extQuote);
  useEffect(() => { setAgree(false); }, [sig, id]);

  const c = byId(db.contracts, id);
  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const periodOptions = PERIOD_CHOICES.map((v) => ({ value: v, label: periodLabel(c.billing.rentalPeriod, Number(v)) }));

  return (
    <Screen>
      <ScreenHeader title="Gia hạn hợp đồng" subtitle={`Kho ${unitLabel(db, c.unitId)} · hết hạn ngày ${fmtDate(lastDayOf(c.endDate))}`} />

      {!canExtend ? <Card><Muted>Chỉ gia hạn được khi hợp đồng đang hiệu lực.</Muted></Card> : (
        <Card>
          <Text style={[st.hint, { marginTop: 0 }]}>Số {PERIOD_UNIT[c.billing.rentalPeriod]} gia hạn</Text>
          <Chips options={periodOptions} value={periods} onChange={setPeriods} columns={2} />
          {ext.key === extKey && ext.error ? <Text style={[st.hint, { color: C.red }]}>{ext.error}</Text> : !extQuote ? <Text style={st.hint}>Đang tính giá gia hạn…</Text> : (
            <>
              <View style={{ marginTop: S.md }}>
                <KV items={[
                  ['Kỳ gia hạn', `${fmtDate(extQuote.from)} → hết ngày ${fmtDate(lastDayOf(extQuote.newEndDate))}`],
                  ['Giá niêm yết hiện hành', `${vnd(extQuote.gross)}/${PERIOD_UNIT[extQuote.rentalPeriod]}`],
                  ['Ưu đãi theo thời gian gia hạn', extQuote.discountAmount > 0 ? `−${vnd(extQuote.discountAmount)}/${PERIOD_UNIT[extQuote.rentalPeriod]}` : 'không có'],
                  ['Tiền thuê trong kỳ gia hạn', `${vnd(extQuote.rate)}/${PERIOD_UNIT[extQuote.rentalPeriod]}`],
                ]} />
              </View>
              <Text style={st.hint}>Bạn đang trả {vnd(extQuote.currentRate)}/{PERIOD_UNIT[extQuote.rentalPeriod]}.</Text>
              {/* Thuê tháng: trả ngay tiền thuê tháng đầu của kỳ gia hạn, các tháng sau thu theo hoá đơn từng tháng; ngày / tuần: trả trọn. */}
              <Text style={st.payNow}>{extQuote.payNow > 0 ? extensionPaymentText(extQuote) : 'Không trả trước — tiền thuê vẫn thu từng tháng.'}</Text>
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
            title={extQuote && extQuote.payNow > 0 ? `Gia hạn & thanh toán ${vnd(extQuote.payNow)}` : 'Xác nhận gia hạn'}
            style={{ marginTop: S.md }}
            disabled={!extQuote || !agree}
            onPress={() => extQuote && (extQuote.payNow > 0
              // Có tiền phải trả ngay → mở cổng thanh toán; cổng gọi API gia hạn (cùng báo giá + khoá chống gửi trùng) khi khách xác nhận.
              ? router.push(payHref({
                target: { kind: 'EXTEND', contractId: c._id, periods: periodsNum, expected: { rate: extQuote.rate, payNow: extQuote.payNow, from: extQuote.from, newEndDate: extQuote.newEndDate }, idempotencyKey: ext.idemKey },
                facilityId: c.facilityId, code: c.contractNumber,
                purpose: `Gia hạn ${periodLabel(c.billing.rentalPeriod, periodsNum)}${extQuote.rentalPeriod === 'MONTH' ? ' · tháng đầu' : ''}`,
                amount: extQuote.payNow,
                doneNote: `Đã gia hạn — thuê đến hết ngày ${fmtDate(lastDayOf(extQuote.newEndDate))}.`,
                back: { label: 'Về hợp đồng', href: `/contract/${c._id}` },
              }))
              : void run(
              'extendContract',
              { contractId: c._id, periods: periodsNum, acceptAppendix: agree, expected: { rate: extQuote.rate, payNow: extQuote.payNow, from: extQuote.from, newEndDate: extQuote.newEndDate }, idempotencyKey: ext.idemKey },
              (v) => (v > 0 ? `Đã gia hạn ${periodLabel(c.billing.rentalPeriod, periodsNum)} — thanh toán ${vnd(v)}` : `Đã gia hạn ${periodLabel(c.billing.rentalPeriod, periodsNum)} — tiền thuê trả theo từng tháng`),
              // Xong thì về màn Hợp đồng (lùi về nếu đang mở bên dưới, không thì thay màn này) để thấy hạn mới.
              () => router.dismissTo(`/contract/${c._id}`),
            ).then((r) => {
              // Giá đã đổi so với báo giá đang xem → tải lại báo giá, khách xem và xác nhận lại.
              if (!r.ok && r.code === 'PRICE_CHANGED') { setAgree(false); setExtReload((n) => n + 1); }
            }))}
          />
        </Card>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: S.md },
  payNow: { fontSize: 13, fontWeight: '600', color: '#78350f', backgroundColor: C.amberBg, borderRadius: 12, padding: S.sm, lineHeight: 19, marginBottom: S.sm },
});
