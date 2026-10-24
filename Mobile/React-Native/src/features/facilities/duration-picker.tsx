import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RentalPeriod } from '@ssm/shared';
import { DURATION_CHOICES, RENTAL_PERIOD, applyDurationChoice, discountPctFor, durationKeyOf, type DiscountTier, type DurationKey } from '@ssm/shared';
import { Input, Muted } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

/** "Dưới 1 tháng" tối đa 29 ngày hoặc 4 tuần; còn lại theo tháng, tối đa 10 năm. */
const MAX: Record<RentalPeriod, number> = { DAY: 29, WEEK: 4, MONTH: 120 };
const clamp = (period: RentalPeriod, n: number) => Math.max(1, Math.min(MAX[period], Math.round(n) || 1));
const ROWS = [DURATION_CHOICES.slice(0, 3), DURATION_CHOICES.slice(3)];

/**
 * Bộ chọn "Bạn sẽ gửi trong bao lâu?" — cùng bố cục với web: nút 1/2/3/6 tháng, 1+ năm kèm nhãn "Tiết kiệm x%"
 * (lấy từ bậc ưu đãi của chính sách đang áp cho chi nhánh), "Dưới 1 tháng" (chọn ngày/tuần) và "Tôi chưa biết".
 */
export function DurationPicker({ period, periods, discounts, onChange, monthOnly = false }: {
  period: RentalPeriod; periods: number; discounts: readonly DiscountTier[]; onChange: (period: RentalPeriod, periods: number) => void;
  /** Đang chọn kho cỡ lớn (chỉ thuê theo tháng): làm mờ "Dưới 1 tháng" và nút Ngày / Tuần. */
  monthOnly?: boolean;
}) {
  const [unsure, setUnsure] = useState(false);
  const active = unsure ? null : durationKeyOf(period, periods);

  const choose = (key: DurationKey) => {
    setUnsure(false);
    const next = applyDurationChoice(key, { period, periods });
    onChange(next.period, next.periods);
  };
  const toggleUnsure = () => {
    const v = !unsure;
    setUnsure(v);
    if (v) onChange('MONTH', 1); // chưa chắc → bắt đầu 1 tháng, gia hạn sau
  };

  return (
    <View>
      <View style={{ gap: S.sm }}>
        {ROWS.map((row, i) => (
          <View key={i} style={st.row}>
            {row.map((c) => {
              const pct = c.months ? discountPctFor(discounts, c.months) : 0;
              const on = active === c.key;
              const off = monthOnly && c.months === null; // "Dưới 1 tháng" = thuê theo ngày / tuần
              return (
                <Pressable key={c.key} disabled={off} onPress={() => choose(c.key)} style={[st.tile, on && st.tileOn, off && { opacity: 0.45, backgroundColor: C.bg }]}>
                  <Text style={[st.tileText, on && st.tileTextOn]} numberOfLines={1}>{c.label}</Text>
                  {off && <Text style={{ fontSize: 10, color: C.muted }}>Chỉ kho nhỏ</Text>}
                  {pct > 0 && (
                    <View style={[st.badge, on && st.badgeOn]}>
                      <Text style={[st.badgeText, on && st.tileTextOn]}>Tiết kiệm {pct}%</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {unsure ? null : period === 'MONTH' ? (
        <View style={st.inline}>
          <Muted>Hoặc nhập số tháng</Muted>
          <Input style={st.num} keyboardType="number-pad" value={String(periods)} onChangeText={(t) => onChange('MONTH', clamp('MONTH', Number(t.replace(/\D/g, ''))))} />
        </View>
      ) : (
        <View style={st.inline}>
          {(['DAY', 'WEEK'] as const).map((p) => (
            <Pressable key={p} disabled={monthOnly} onPress={() => onChange(p, clamp(p, periods))} style={[st.unitBtn, period === p && st.unitBtnOn, monthOnly && { opacity: 0.45 }]}>
              <Text style={[st.unitText, period === p && st.tileTextOn]}>{RENTAL_PERIOD[p]}</Text>
            </Pressable>
          ))}
          <Input style={st.num} keyboardType="number-pad" value={String(periods)} onChangeText={(t) => onChange(period, clamp(period, Number(t.replace(/\D/g, ''))))} />
          <Muted>{period === 'WEEK' ? 'tuần (tối đa 4)' : 'ngày (tối đa 29)'}</Muted>
        </View>
      )}

      {monthOnly && <Muted style={{ marginTop: S.sm, color: C.amber } as never}>Kho cỡ lớn (L, XL) chỉ cho thuê theo tháng.</Muted>}

      <Pressable onPress={toggleUnsure} style={st.check} hitSlop={6}>
        <Ionicons name={unsure ? 'checkbox' : 'square-outline'} size={22} color={unsure ? C.brand700 : C.faint} />
        <Text style={st.checkText}>Tôi chưa biết</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', gap: S.sm },
  tile: { flex: 1, minHeight: 58, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: S.sm },
  tileOn: { backgroundColor: C.ink, borderColor: C.ink },
  tileText: { fontSize: 14, fontWeight: '700', color: C.ink },
  tileTextOn: { color: '#fff' },
  badge: { backgroundColor: C.greenBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeOn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  badgeText: { fontSize: 11, fontWeight: '700', color: C.green },
  inline: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm },
  num: { width: 64, textAlign: 'center', paddingHorizontal: 0 },
  unitBtn: { borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.md, paddingVertical: 6, backgroundColor: '#fff' },
  unitBtnOn: { backgroundColor: C.ink, borderColor: C.ink },
  unitText: { fontSize: 13, fontWeight: '600', color: C.ink },
  check: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.md },
  checkText: { fontSize: 14, color: C.text },
});
