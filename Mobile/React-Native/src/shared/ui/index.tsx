import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { addDays, fmtDate, todayISO, type Tone } from '@ssm/shared';
import { C, R, S, TONE } from './theme';
import { useStore } from '../store/store';

/** Bộ khối dựng màn hình. Tương đương Webapp/src/shared/ui/index.tsx nhưng viết cho React Native. */

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={st.screen} edges={['top', 'left', 'right']}>
      <Body
        style={{ flex: 1 }}
        contentContainerStyle={scroll ? [{ padding: S.lg, paddingBottom: S.xxl * 2 }, style] : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </Body>
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={st.h1}>{children}</Text>;
}
export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Text style={[st.muted, style as never]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.card, style]}>{children}</View>;
}

/**
 * Header cho màn full-page mới: nút back + tiêu đề + slot phải tuỳ chọn. Đặt làm children đầu
 * tiên trong <Screen>, không phải header cố định của navigator (mỗi screen tự vẽ, headerShown
 * đã tắt toàn cục).
 */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={st.screenHeader}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={st.screenHeaderBack}>
        <Ionicons name="chevron-back" size={24} color={C.ink} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={st.h1}>{title}</Text>
        {subtitle ? <Muted style={{ marginTop: 2 } as never}>{subtitle}</Muted> : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  title, onPress, variant = 'primary', icon, disabled, loading, style,
}: {
  title: string; onPress?: () => void; variant?: BtnVariant;
  icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const bg = { primary: C.brand700, secondary: C.card, ghost: 'transparent', danger: C.red }[variant];
  const fg = variant === 'primary' || variant === 'danger' ? '#fff' : C.text;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        st.btn,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: C.line },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[st.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: S.md }}>
      <Text style={st.label}>{label}</Text>
      {children}
      {hint ? <Text style={st.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={C.faint} {...props} style={[st.input, props.style]} />;
}

/** Hàng nút chọn dạng pill — chọn số tháng, loại ticket, mức ưu tiên, loại claim, phương thức thanh toán... */
export function Chips<T extends string>({ options, value, onChange, columns }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; columns?: number;
}) {
  return (
    <View style={st.chipsRow}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[
              st.chip,
              active ? st.chipActive : st.chipInactive,
              // `columns` chip mỗi dòng: basis nhỏ hơn 100/columns vài % để chừa chỗ cho gap (basis % không
              // tự trừ gap), flexGrow kéo giãn cho kín dòng. Basis 0 thì mọi chip dồn một dòng và bị cắt chữ.
              columns ? { flexGrow: 1, flexBasis: `${Math.floor(100 / columns) - 4}%` } as ViewStyle : { flexGrow: 0 },
            ]}
          >
            <Text style={[st.chipText, active && st.chipTextActive]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Chọn một ngày bằng chevron ±1 ngày + chip nhanh, không dùng date-picker gốc (chưa cài lib đó).
 * value/min/max là ISO date string; presets là số ngày cộng thêm từ hôm nay (vd [0,3,7,30]).
 */
export function DateStepper({ value, onChange, min, max, label, presets }: {
  value: string; onChange: (iso: string) => void; min?: string; max?: string; label: string; presets?: number[];
}) {
  const clamp = (iso: string) => (min && iso < min ? min : max && iso > max ? max : iso);
  const atMin = min !== undefined && value <= min;
  const atMax = max !== undefined && value >= max;
  return (
    <View>
      <Text style={st.label}>{label}</Text>
      <View style={st.stepperRow}>
        <Pressable onPress={() => onChange(clamp(addDays(value, -1)))} disabled={atMin} hitSlop={8} style={st.stepperBtn}>
          <Ionicons name="chevron-back" size={20} color={atMin ? C.faint : C.ink} />
        </Pressable>
        <Text style={st.stepperDate}>{fmtDate(value)}</Text>
        <Pressable onPress={() => onChange(clamp(addDays(value, 1)))} disabled={atMax} hitSlop={8} style={st.stepperBtn}>
          <Ionicons name="chevron-forward" size={20} color={atMax ? C.faint : C.ink} />
        </Pressable>
      </View>
      {presets ? (
        <View style={[st.chipsRow, { marginTop: S.sm }]}>
          {presets.map((n) => {
            const iso = clamp(addDays(todayISO(), n));
            const active = iso === value;
            return (
              <Pressable key={n} onPress={() => onChange(iso)} style={[st.chip, active ? st.chipActive : st.chipInactive, { flexGrow: 0 }]}>
                <Text style={[st.chipText, active && st.chipTextActive]}>{n === 0 ? 'Hôm nay' : `+${n} ngày`}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <View style={[st.badge, { backgroundColor: t.bg }]}>
      <Text style={[st.badgeText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

export function StatusBadge<K extends string>({ map, value }: { map: Record<K, { label: string; tone: Tone }>; value: K }) {
  const v = map[value];
  return <Badge tone={v?.tone}>{v?.label ?? value}</Badge>;
}

/** Hàng nhãn — giá trị, dùng cho các khối thông tin hợp đồng / đặt chỗ. */
export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <View style={{ gap: S.sm }}>
      {items.map(([k, v], i) => (
        <View key={i} style={st.kvRow}>
          <Text style={st.kvKey}>{k}</Text>
          <View style={{ flexShrink: 1 }}>
            {typeof v === 'string' || typeof v === 'number' ? <Text style={st.kvVal}>{v}</Text> : v}
          </View>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon = 'file-tray-outline', title, description, action }: {
  icon?: keyof typeof Ionicons.glyphMap; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <View style={st.empty}>
      <Ionicons name={icon} size={36} color={C.faint} />
      <Text style={st.emptyTitle}>{title}</Text>
      {description ? <Text style={st.emptyDesc}>{description}</Text> : null}
      {action ? <View style={{ marginTop: S.md }}>{action}</View> : null}
    </View>
  );
}

/** Khối xám nhấp nháy giữ chỗ trong lúc tải, để màn hình không nhảy khi có dữ liệu. */
export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: h, width: w, backgroundColor: C.fill, borderRadius: R.sm }, style]} />;
}

/** Thông báo nổi. Đặt một lần ở _layout gốc. */
export function Toasts() {
  const { toasts, dismiss } = useStore();
  if (toasts.length === 0) return null;
  return (
    <View style={st.toastWrap} pointerEvents="box-none">
      {toasts.map((t) => {
        const tone = t.tone === 'success' ? TONE.green : t.tone === 'error' ? TONE.red : TONE.blue;
        return (
          <Pressable key={t.id} onPress={() => dismiss(t.id)} style={[st.toast, { backgroundColor: tone.bg, borderColor: tone.fg }]}>
            <Text style={{ color: tone.fg, fontSize: 13, lineHeight: 18 }}>{t.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  muted: { fontSize: 13, color: C.muted, lineHeight: 19 },
  card: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.lg },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, height: 48, paddingHorizontal: S.lg, borderRadius: R.md },
  btnText: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 6 },
  hint: { fontSize: 12, color: C.muted, marginTop: 4 },
  input: { height: 48, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: S.md, fontSize: 15, color: C.ink, backgroundColor: C.card },
  badge: { alignSelf: 'flex-start', paddingHorizontal: S.sm + 2, paddingVertical: 3, borderRadius: R.full },
  badgeText: { fontSize: 12, fontWeight: '600' },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: S.md },
  kvKey: { fontSize: 13, color: C.muted },
  kvVal: { fontSize: 13, fontWeight: '600', color: C.ink, textAlign: 'right' },
  empty: { alignItems: 'center', paddingVertical: S.xxl, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: C.ink },
  emptyDesc: { fontSize: 13, color: C.muted, textAlign: 'center', paddingHorizontal: S.xl },
  toastWrap: { position: 'absolute', left: S.lg, right: S.lg, bottom: S.xxl + S.xl, gap: S.sm },
  toast: { borderWidth: 1, borderRadius: R.md, padding: S.md },
  screenHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, marginBottom: S.lg },
  screenHeaderBack: { padding: 2, marginTop: 2 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: { paddingVertical: S.sm, paddingHorizontal: S.md, borderRadius: R.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: C.brand50, borderColor: C.brand600 },
  chipInactive: { backgroundColor: C.card, borderColor: C.line },
  chipText: { fontSize: 13, fontWeight: '600', color: C.text },
  chipTextActive: { color: C.brand700 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingVertical: S.sm, paddingHorizontal: S.md },
  stepperBtn: { padding: S.xs },
  stepperDate: { fontSize: 15, fontWeight: '700', color: C.ink },
});
