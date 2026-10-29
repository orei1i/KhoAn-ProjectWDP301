import { Ionicons } from '@expo/vector-icons';
import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type ImageSourcePropType, type RefreshControlProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { addDays, daysBetween, fmtDate, lastDayOf, todayISO, type Tone } from '@ssm/shared';
import { C, R, S, SHADOW, T, TONE, TOUCH } from './theme';
import type { IconName } from './visuals';
import { useStore } from '../store/store';

export type { IconName } from './visuals';

/**
 * Bộ khối dựng màn hình. Tương đương Webapp/src/shared/ui/index.tsx (thẻ, chip trạng thái, ô icon, thẻ số liệu, khối thu gọn…)
 * nhưng viết cho React Native. Màu / khoảng cách / bóng / cỡ chữ lấy từ ./theme — không rải hex trong màn hình.
 */

const NATIVE_DRIVER = Platform.OS !== 'web';

// ---------------------------------------------------------------- khung màn hình

/**
 * Khung màn hình: vùng an toàn trên + nội dung cuộn. `footer` = thanh dưới cố định cho nút hành động chính (luôn nhìn thấy,
 * tự chừa vùng an toàn dưới — thanh home của iPhone, thanh điều hướng Android).
 */
export function Screen({ children, scroll = true, style, footer, refreshControl }: {
  children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; footer?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  return (
    <SafeAreaView style={st.screen} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[st.body, footer ? { paddingBottom: S.xl } : null, style]}
            keyboardShouldPersistTaps="handled"
            refreshControl={refreshControl}
          >
            {children}
          </ScrollView>
        ) : <View style={[{ flex: 1 }, style]}>{children}</View>}
        {footer ? <FooterBar>{footer}</FooterBar> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Thanh dưới cố định — dùng qua `<Screen footer>`; màn tự dựng khung thì đặt trực tiếp dưới ScrollView. */
export function FooterBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return <View style={[st.footer, { paddingBottom: Math.max(insets.bottom, S.md) }, style]}>{children}</View>;
}

/** Tiêu đề lớn của các tab chính (Kho của tôi, Thuê kho, Hỗ trợ, Tài khoản). */
export function TabHeader({ title, eyebrow, subtitle, right }: { title: string; eyebrow?: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={st.tabHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <Text style={st.eyebrow}>{eyebrow}</Text> : null}
        <Text style={st.display} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={[T.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

/**
 * Header cho màn full-page: nút back + tiêu đề + slot phải tuỳ chọn. Đặt làm children đầu tiên trong <Screen>, không phải header
 * cố định của navigator (mỗi screen tự vẽ, headerShown đã tắt toàn cục). Có `icon` thì vẽ dạng hai tầng: hàng nút ở trên,
 * ô icon + tiêu đề lớn ở dưới.
 */
export function ScreenHeader({ title, subtitle, right, icon, tone = 'teal' }: {
  title: string; subtitle?: string; right?: ReactNode; icon?: IconName; tone?: Tone;
}) {
  const router = useRouter();
  const back = (
    <Pressable
      onPress={() => router.back()} hitSlop={6} accessibilityRole="button" accessibilityLabel="Quay lại"
      style={({ pressed }) => [st.backBtn, pressed && st.pressed]}
    >
      <Ionicons name="chevron-back" size={22} color={C.ink} />
    </Pressable>
  );
  if (icon) {
    return (
      <View style={st.headerWrap}>
        <View style={st.headerTop}>
          {back}
          {right ? <View style={st.headerRight}>{right}</View> : null}
        </View>
        <View style={st.headerMain}>
          <IconTile icon={icon} tone={tone} size="lg" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.h1}>{title}</Text>
            {subtitle ? <Text style={[T.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={st.screenHeader}>
      {back}
      <View style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        <Text style={st.h1}>{title}</Text>
        {subtitle ? <Text style={[T.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={st.headerRight}>{right}</View> : null}
    </View>
  );
}

/**
 * Trang trượt lên (Modal pageSheet) có header thống nhất: ô icon + tiêu đề + nút đóng 44px, thân cuộn và thanh nút dưới cố định.
 * Android vẽ Modal tràn dưới thanh trạng thái nên tự chừa vùng an toàn trên; iOS pageSheet đã nằm dưới thanh trạng thái.
 */
export function Sheet({ visible, onClose, title, subtitle, icon, tone = 'teal', children, footer, scroll = true }: {
  visible: boolean; onClose: () => void; title: string; subtitle?: ReactNode; icon?: IconName; tone?: Tone;
  children: ReactNode; footer?: ReactNode; scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[st.sheet, Platform.OS === 'android' && { paddingTop: insets.top }]}>
        <View style={st.sheetHead}>
          {icon ? <IconTile icon={icon} tone={tone} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={T.h2}>{title}</Text>
            {subtitle ? (typeof subtitle === 'string' ? <Text style={[T.small, { marginTop: 2 }]}>{subtitle}</Text> : subtitle) : null}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" style={({ pressed }) => [st.sheetClose, pressed && st.pressed]}>
            <Ionicons name="close" size={22} color={C.sub} />
          </Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {scroll
            ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: S.lg, gap: S.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
            : <View style={{ flex: 1, padding: S.lg }}>{children}</View>}
          {footer ? <FooterBar>{footer}</FooterBar> : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- chữ

export function H1({ children }: { children: ReactNode }) {
  return <Text style={st.h1}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[T.h3, style]}>{children}</Text>;
}
export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Text style={[st.muted, style as never]}>{children}</Text>;
}

// ---------------------------------------------------------------- thẻ

/** Thẻ trắng có viền + bóng nhẹ. `tone` = thẻ nền màu (cảnh báo, ghi chú); `onPress` = cả thẻ bấm được. */
export function Card({ children, style, tone, onPress, accessibilityLabel }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; tone?: Tone; onPress?: () => void; accessibilityLabel?: string;
}) {
  const toneStyle = tone ? { backgroundColor: TONE[tone].bg, borderColor: TONE[tone].line, boxShadow: undefined } as ViewStyle : null;
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [st.card, toneStyle, style, pressed && st.cardPressed]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[st.card, toneStyle, style]}>{children}</View>;
}

/** Tiêu đề khu vực giữa các thẻ: icon nhỏ + tiêu đề + số đếm, hành động "Xem tất cả" bên phải. */
export function SectionHeader({ title, icon, count, description, actionLabel, onAction, right, style }: {
  title: string; icon?: IconName; count?: number; description?: string;
  actionLabel?: string; onAction?: () => void; right?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[st.section, style]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.sectionRow}>
          {icon ? <Ionicons name={icon} size={17} color={C.brand700} /> : null}
          <Text style={st.sectionTitle} numberOfLines={2}>{title}</Text>
          {count !== undefined ? <View style={st.countPill}><Text style={st.countText}>{count}</Text></View> : null}
        </View>
        {description ? <Text style={[T.caption, { marginTop: 2 }]}>{description}</Text> : null}
      </View>
      {right}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} style={st.sectionAction} accessibilityRole="button">
          <Text style={st.sectionActionText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={C.brand700} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- icon, chip, số liệu

const TILE = { xs: { box: 24, icon: 13, r: R.xs }, sm: { box: 32, icon: 16, r: R.sm }, md: { box: 40, icon: 20, r: R.md }, lg: { box: 48, icon: 24, r: 14 }, xl: { box: 64, icon: 30, r: R.xl } } as const;
/** Ô vuông màu chứa icon — dùng cho thẻ số liệu, lối tắt, mục danh sách, trạng thái trống. `solid` = nền đậm chữ trắng. */
export function IconTile({ icon, tone = 'teal', size = 'md', solid, dot, style }: {
  icon: IconName; tone?: Tone; size?: keyof typeof TILE; solid?: boolean; dot?: Tone; style?: StyleProp<ViewStyle>;
}) {
  const t = TONE[tone];
  const d = TILE[size];
  const bg = solid ? (tone === 'teal' ? C.brand700 : tone === 'gray' ? C.ink : t.fg) : t.bg;
  return (
    <View style={[{ width: d.box, height: d.box, borderRadius: d.r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name={icon} size={d.icon} color={solid ? C.white : t.fg} />
      {dot ? <View style={[st.tileDot, { backgroundColor: TONE[dot].dot }]} /> : null}
    </View>
  );
}

/** Chip trạng thái: nền nhạt + viền + chấm/ icon theo tông. Không bấm được — chọn lựa dùng `Chips`. */
export function Chip({ tone = 'gray', icon, dot, children, size = 'md', style }: {
  tone?: Tone; icon?: IconName; dot?: boolean; children: ReactNode; size?: 'sm' | 'md'; style?: StyleProp<ViewStyle>;
}) {
  const t = TONE[tone];
  return (
    <View style={[st.chipTag, size === 'sm' && st.chipTagSm, { backgroundColor: t.bg, borderColor: t.line }, style]}>
      {dot ? <View style={[st.chipDot, { backgroundColor: t.dot }]} /> : null}
      {icon ? <Ionicons name={icon} size={size === 'sm' ? 11 : 13} color={t.fg} /> : null}
      <Text style={[st.chipTagText, size === 'sm' && { fontSize: 11 }, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

export function Badge({ tone = 'gray', children, icon }: { tone?: Tone; children: ReactNode; icon?: IconName }) {
  return <Chip tone={tone} icon={icon}>{children}</Chip>;
}

export function StatusBadge<K extends string>({ map, value }: { map: Record<K, { label: string; tone: Tone }>; value: K }) {
  const v = map[value];
  return <Chip tone={v?.tone} dot>{v?.label ?? value}</Chip>;
}

/**
 * Thẻ số liệu có icon và vạch màu theo trạng thái — bản "nhìn là hiểu" của một con số (kho đang thuê, công nợ, kỳ tới…).
 * Truyền `onPress` để cả thẻ bấm được.
 */
export function StatCard({ label, value, sub, icon, tone = 'teal', onPress, style }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: IconName; tone?: Tone; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const body = (
    <>
      <View style={[st.statAccent, { backgroundColor: TONE[tone].dot }]} />
      <View style={st.statHead}>
        <IconTile icon={icon} tone={tone} size="sm" />
        <Text style={st.statLabel} numberOfLines={2}>{label}</Text>
        {onPress ? <Ionicons name="arrow-forward" size={14} color={C.faint} /> : null}
      </View>
      <Text style={st.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      {sub ? <Text style={st.statSub} numberOfLines={2}>{sub}</Text> : null}
    </>
  );
  return onPress
    ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [st.stat, style, pressed && st.cardPressed]}>{body}</Pressable>
    : <View style={[st.stat, style]}>{body}</View>;
}

/** Thanh tiến độ. `value` 0..1. */
export function Progress({ value, tone = 'teal', height = 6, track, style }: { value: number; tone?: Tone; height?: number; track?: string; style?: StyleProp<ViewStyle> }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <View style={[{ height, borderRadius: height, backgroundColor: track ?? '#e7e5e4b3', overflow: 'hidden' }, style]}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: height, backgroundColor: TONE[tone].dot }} />
    </View>
  );
}

/**
 * Thanh thời hạn hợp đồng: đã dùng bao nhiêu phần thời hạn, còn bao nhiêu ngày (ngày kết thúc là mốc 00:00 sau ngày cuối) —
 * như TermProgress bên web. Sắp hết hạn (≤ 7 ngày) chuyển vàng. `onDark` = đặt trên nền ảnh / nền tối.
 */
export function TermProgress({ start, end, onDark, style }: { start: string; end: string; onDark?: boolean; style?: StyleProp<ViewStyle> }) {
  const today = todayISO();
  const total = Math.max(1, daysBetween(start, end));
  const used = Math.min(total, Math.max(0, daysBetween(start, today)));
  const left = Math.max(0, daysBetween(today, end));
  const soon = left <= 7;
  return (
    <View style={style} accessibilityLabel={`Thời hạn: ${left > 0 ? `còn ${left} ngày` : 'đã hết hạn'}`}>
      <View style={st.termRow}>
        <Text style={[st.termLeft, { color: onDark ? C.white : soon ? C.amber : C.sub }]}>{left > 0 ? `Còn ${left} ngày` : 'Đã hết hạn'}</Text>
        <Text style={[T.caption, onDark && { color: 'rgba(255,255,255,0.75)' }]}>đến hết {fmtDate(lastDayOf(end))}</Text>
      </View>
      <Progress value={used / total} tone={soon ? 'amber' : 'teal'} track={onDark ? 'rgba(255,255,255,0.25)' : undefined} />
    </View>
  );
}

// ---------------------------------------------------------------- danh sách

/**
 * Một dòng danh sách: ô icon + tiêu đề + dòng phụ + phần phải (chip / số tiền) + mũi tên khi bấm được. Cao tối thiểu 56.
 * Đặt nhiều dòng trong <ListGroup> để có đường kẻ giữa các dòng.
 */
export function ListRow({ icon, tone = 'teal', leading, title, subtitle, subtitleTone, right, onPress, chevron, divider, disabled, style, accessibilityLabel }: {
  icon?: IconName; tone?: Tone; leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; subtitleTone?: Tone;
  right?: ReactNode; onPress?: () => void; chevron?: boolean; divider?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      {leading ?? (icon ? <IconTile icon={icon} tone={tone} /> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? <Text style={st.rowTitle} numberOfLines={2}>{title}</Text> : title}
        {subtitle ? (typeof subtitle === 'string'
          ? <Text style={[st.rowSub, subtitleTone && { color: TONE[subtitleTone].fg }]} numberOfLines={3}>{subtitle}</Text>
          : subtitle) : null}
      </View>
      {right}
      {(chevron ?? !!onPress) ? <Ionicons name="chevron-forward" size={18} color={C.faint} /> : null}
    </>
  );
  const base = [st.row, divider && st.rowDivider, style];
  if (!onPress) return <View style={base}>{body}</View>;
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (typeof title === 'string' ? title : undefined)}
      style={({ pressed }) => [...base, pressed && st.rowPressed, disabled && { opacity: 0.5 }]}
    >
      {body}
    </Pressable>
  );
}

/** Thẻ chứa các <ListRow> — tự kẻ đường giữa các dòng. */
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<{ divider?: boolean }>[];
  if (rows.length === 0) return null;
  return <View style={[st.card, st.group, style]}>{rows.map((r, i) => cloneElement(r, { divider: i > 0 }))}</View>;
}

/** Hàng nhãn — giá trị, dùng cho các khối thông tin hợp đồng / đặt chỗ. */
export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <View style={{ gap: 10 }}>
      {items.map(([k, v], i) => (
        <View key={i} style={st.kvRow}>
          <Text style={st.kvKey}>{k}</Text>
          <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
            {typeof v === 'string' || typeof v === 'number' ? <Text style={st.kvVal}>{v}</Text> : v}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Đường kẻ mảnh. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[st.divider, style]} />;
}

// ---------------------------------------------------------------- nội dung dài, thông báo

/**
 * Khối thu gọn cho giải thích dài (chính sách huỷ, cách tính tiền, quy trình…): mặc định chỉ hiện một dòng "Chi tiết",
 * bấm mới mở — nội dung vẫn nằm trong màn hình, không mất thông tin.
 */
export function Disclosure({ title = 'Chi tiết', icon = 'information-circle-outline', meta, defaultOpen = false, variant = 'plain', children, style }: {
  title?: string; icon?: IconName | null; meta?: string; defaultOpen?: boolean; variant?: 'plain' | 'card'; children: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={[variant === 'card' && st.discCard, style]}>
      <Pressable
        onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title}
        style={({ pressed }) => [st.discHead, variant === 'card' && { paddingHorizontal: S.md }, pressed && { opacity: 0.7 }]}
      >
        {icon ? <Ionicons name={icon} size={17} color={C.brand700} /> : null}
        <Text style={st.discTitle}>{title}</Text>
        {meta ? <Text style={st.discMeta} numberOfLines={1}>{meta}</Text> : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={C.muted} />
      </Pressable>
      {open ? <View style={[st.discBody, variant === 'card' && { paddingHorizontal: S.md, paddingBottom: S.md }]}>{wrapText(children, st.discText)}</View> : null}
    </View>
  );
}

const CALLOUT_ICON: Record<Tone, IconName> = {
  gray: 'information-circle-outline', teal: 'information-circle-outline', blue: 'information-circle-outline', green: 'checkmark-circle-outline',
  amber: 'alert-circle-outline', red: 'warning-outline', violet: 'storefront-outline',
};
/** Khối thông báo nền màu có icon (cảnh báo nợ, nhắc ký hợp đồng, ghi chú quan trọng). */
export function Callout({ tone = 'amber', icon, title, children, action, style }: {
  tone?: Tone; icon?: IconName; title?: string; children?: ReactNode; action?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const t = TONE[tone];
  return (
    <View style={[st.callout, { backgroundColor: t.bg, borderColor: t.line }, style]}>
      <View style={st.calloutRow}>
        <View style={[st.calloutIcon, { backgroundColor: C.white }]}>
          <Ionicons name={icon ?? CALLOUT_ICON[tone]} size={18} color={t.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {title ? <Text style={[st.calloutTitle, { color: t.ink }]}>{title}</Text> : null}
          {children ? wrapText(children, [st.calloutText, { color: t.ink }]) : null}
        </View>
      </View>
      {action ? <View style={{ marginTop: S.md }}>{action}</View> : null}
    </View>
  );
}

/**
 * Nội dung chữ của Callout / Disclosure / CheckRow:
 * - có chuỗi trần (kể cả xen <Text> in đậm / link) → bọc trong MỘT <Text> có kiểu, chữ chạy liền một đoạn;
 * - chỉ toàn các <Text> riêng (danh sách dòng) → mỗi <Text> một dòng, được gắn kiểu chữ mặc định (kiểu riêng của dòng vẫn thắng);
 * - có khối khác (View, Button) → để nguyên trong một View.
 */
function wrapText(children: ReactNode, style: StyleProp<TextStyle>) {
  const parts = Children.toArray(children);
  const raw = (c: unknown) => typeof c === 'string' || typeof c === 'number';
  const isText = (c: unknown): c is ReactElement<{ style?: StyleProp<TextStyle> }> => isValidElement(c) && c.type === Text;
  if (parts.some(raw) && parts.every((c) => raw(c) || isText(c))) return <Text style={style}>{children}</Text>;
  return (
    <View style={{ gap: S.xs }}>
      {parts.map((c) => (isText(c) ? cloneElement(c, { style: [style, c.props.style] }) : c))}
    </View>
  );
}

// ---------------------------------------------------------------- ảnh

/** Lớp phủ chuyển màu trên ảnh để chữ trắng đọc được. */
export function Scrim({ from = 0, to = 0.78, color = '#0b1513' }: { from?: number; to?: number; color?: string }) {
  const id = `scrim${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={from} />
            <Stop offset="1" stopColor={color} stopOpacity={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Ảnh có lớp phủ, nội dung đè ở đáy (`children`) và hai góc trên. */
export function PhotoBanner({ source, height = 160, children, topLeft, topRight, radius = 0, style, accessibilityLabel }: {
  source?: ImageSourcePropType; height?: number; children?: ReactNode; topLeft?: ReactNode; topRight?: ReactNode; radius?: number;
  style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  return (
    <View style={[{ height, borderRadius: radius, overflow: 'hidden', backgroundColor: C.brand900 }, style]}>
      {source ? <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={accessibilityLabel} /> : null}
      <Scrim from={0.05} to={0.82} />
      {topLeft ? <View style={st.bannerTL}>{topLeft}</View> : null}
      {topRight ? <View style={st.bannerTR}>{topRight}</View> : null}
      {children ? <View style={st.bannerBottom}>{children}</View> : null}
    </View>
  );
}

/** Chữ cái đầu của tên trong vòng tròn màu. */
export function Avatar({ name, size = 44 }: { name?: string; size?: number }) {
  const initial = (name ?? '').trim().split(/\s+/).at(-1)?.[0]?.toUpperCase() ?? '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.white, fontWeight: '800', fontSize: size * 0.42 }}>{initial}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- nút, ô nhập, lựa chọn

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const BTN_H = { sm: TOUCH, md: 48, lg: 54 } as const;
export function Button({
  title, onPress, variant = 'primary', icon, iconRight, disabled, loading, style, size = 'md',
}: {
  title: string; onPress?: () => void; variant?: BtnVariant; size?: keyof typeof BTN_H;
  icon?: IconName; iconRight?: IconName; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const bg = { primary: C.brand700, secondary: C.card, ghost: 'transparent', danger: C.redSolid, subtle: C.brand50 }[variant];
  const fg = variant === 'primary' || variant === 'danger' ? C.white : variant === 'subtle' || variant === 'ghost' ? C.brand800 : C.ink;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        st.btn,
        { backgroundColor: bg, height: BTN_H[size] },
        (variant === 'primary' || variant === 'danger') && !off && SHADOW.card,
        variant === 'secondary' && st.btnSecondary,
        off ? { opacity: 0.45 } : pressed && st.btnPressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={fg} />}
          <Text style={[st.btnText, size === 'sm' && { fontSize: 14 }, size === 'lg' && { fontSize: 16 }, { color: fg }]} numberOfLines={1}>{title}</Text>
          {iconRight && <Ionicons name={iconRight} size={size === 'sm' ? 16 : 18} color={fg} />}
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
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.faint}
      {...props}
      onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
      style={[st.input, props.multiline && st.inputMulti, focus && st.inputFocus, props.editable === false && st.inputOff, props.style]}
    />
  );
}

/** Ô đánh dấu + nội dung (đồng ý điều khoản, xác nhận đã đọc). Cả hàng bấm được, cao tối thiểu 44. */
export function CheckRow({ checked, onPress, disabled, children, tone, style }: {
  checked: boolean; onPress: () => void; disabled?: boolean; children: ReactNode; tone?: Tone; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !!disabled }}
      style={({ pressed }) => [st.check, tone && { backgroundColor: TONE[tone].bg, borderColor: TONE[tone].line, borderWidth: 1, paddingHorizontal: S.md }, pressed && { opacity: 0.75 }, style]}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? C.brand700 : disabled ? C.line : C.faint} />
      <View style={{ flex: 1 }}>{wrapText(children, [st.checkText, disabled && { color: C.faint }])}</View>
    </Pressable>
  );
}

/** Thẻ lựa chọn dạng radio (cách thanh toán, phương thức nhận tiền…). */
export function OptionCard({ selected, onPress, disabled, icon, title, subtitle, right, style }: {
  selected: boolean; onPress: () => void; disabled?: boolean; icon?: IconName; title: string; subtitle?: string; right?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={({ pressed }) => [st.option, selected && st.optionOn, disabled && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}
    >
      {icon ? <IconTile icon={icon} tone={selected ? 'teal' : 'gray'} size="sm" /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.optionTitle}>{title}</Text>
        {subtitle ? <Text style={[T.caption, { marginTop: 1 }]}>{subtitle}</Text> : null}
      </View>
      {right}
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? C.brand700 : C.faint} />
    </Pressable>
  );
}

/** Hàng nút chọn dạng pill — chọn số tháng, loại ticket, mức ưu tiên, loại claim, phương thức thanh toán... */
export function Chips<T extends string>({ options, value, onChange, columns }: {
  options: { value: T; label: string; icon?: IconName }[]; value: T; onChange: (v: T) => void; columns?: number;
}) {
  return (
    <View style={st.chipsRow}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={o.label}
            style={({ pressed }) => [
              st.chip,
              active ? st.chipActive : st.chipInactive,
              // `columns` chip mỗi dòng: basis nhỏ hơn 100/columns vài % để chừa chỗ cho gap (basis % không
              // tự trừ gap), flexGrow kéo giãn cho kín dòng. Basis 0 thì mọi chip dồn một dòng và bị cắt chữ.
              columns ? { flexGrow: 1, flexBasis: `${Math.floor(100 / columns) - 4}%` } as ViewStyle : { flexGrow: 0 },
              pressed && { opacity: 0.8 },
            ]}
          >
            {o.icon ? <Ionicons name={o.icon} size={15} color={active ? C.brand700 : C.muted} /> : null}
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
        <Pressable onPress={() => onChange(clamp(addDays(value, -1)))} disabled={atMin} style={({ pressed }) => [st.stepperBtn, pressed && st.pressed]} accessibilityRole="button" accessibilityLabel="Lùi một ngày">
          <Ionicons name="chevron-back" size={20} color={atMin ? C.faint : C.ink} />
        </Pressable>
        <View style={st.stepperMid}>
          <Ionicons name="calendar-outline" size={16} color={C.brand700} />
          <Text style={st.stepperDate}>{fmtDate(value)}</Text>
        </View>
        <Pressable onPress={() => onChange(clamp(addDays(value, 1)))} disabled={atMax} style={({ pressed }) => [st.stepperBtn, pressed && st.pressed]} accessibilityRole="button" accessibilityLabel="Thêm một ngày">
          <Ionicons name="chevron-forward" size={20} color={atMax ? C.faint : C.ink} />
        </Pressable>
      </View>
      {presets ? (
        <View style={[st.chipsRow, { marginTop: S.sm }]}>
          {presets.map((n) => {
            const iso = clamp(addDays(todayISO(), n));
            const active = iso === value;
            return (
              <Pressable key={n} onPress={() => onChange(iso)} accessibilityRole="radio" accessibilityState={{ checked: active }}
                style={[st.chip, active ? st.chipActive : st.chipInactive, { flexGrow: 0 }]}>
                <Text style={[st.chipText, active && st.chipTextActive]}>{n === 0 ? 'Hôm nay' : `+${n} ngày`}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- trạng thái trống / đang tải

export function EmptyState({ icon = 'file-tray-outline', title, description, action, tone = 'teal' }: {
  icon?: IconName; title: string; description?: string; action?: ReactNode; tone?: Tone;
}) {
  return (
    <View style={st.empty}>
      <View style={[st.emptyHalo, { backgroundColor: TONE[tone].bg }]}>
        <IconTile icon={icon} tone={tone} size="xl" style={{ backgroundColor: C.white, ...SHADOW.card }} />
      </View>
      <Text style={st.emptyTitle}>{title}</Text>
      {description ? <Text style={st.emptyDesc}>{description}</Text> : null}
      {action ? <View style={{ marginTop: S.md, alignSelf: 'stretch', alignItems: 'center' }}>{action}</View> : null}
    </View>
  );
}

function usePulse() {
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(v, { toValue: 0.55, duration: 650, useNativeDriver: NATIVE_DRIVER }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

/** Khối xám nhấp nháy giữ chỗ trong lúc tải, để màn hình không nhảy khi có dữ liệu. */
export function Skeleton({ h = 16, w = '100%', r = R.sm, style }: { h?: number; w?: number | `${number}%`; r?: number; style?: StyleProp<ViewStyle> }) {
  const o = usePulse();
  return <Animated.View style={[{ height: h, width: w, backgroundColor: '#e8e6e3', borderRadius: r, opacity: o }, style]} />;
}

/** Bộ khung chờ cả màn: tiêu đề, một khối lớn (ảnh / thẻ chính) và vài dòng danh sách. */
export function ScreenSkeleton({ hero = true, rows = 3 }: { hero?: boolean; rows?: number }) {
  return (
    <View style={{ gap: S.md }}>
      <Skeleton h={14} w="30%" />
      <Skeleton h={28} w="62%" />
      {hero ? <Skeleton h={180} r={R.xl} style={{ marginTop: S.sm }} /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[st.card, { flexDirection: 'row', alignItems: 'center', gap: S.md }]}>
          <Skeleton h={40} w={40} r={R.md} />
          <View style={{ flex: 1, gap: S.sm }}>
            <Skeleton h={14} w="70%" />
            <Skeleton h={12} w="45%" />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- thông báo nổi

const TOAST_ICON = { success: 'checkmark-circle', error: 'alert-circle', info: 'information-circle' } as const;
/** Thông báo nổi. Đặt một lần ở _layout gốc. */
export function Toasts() {
  const { toasts, dismiss } = useStore();
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View style={[st.toastWrap, { bottom: insets.bottom + 72 }]} pointerEvents="box-none">
      {toasts.map((t) => {
        const color = t.tone === 'success' ? '#34d399' : t.tone === 'error' ? '#f87171' : '#7dd3fc';
        return (
          <Pressable key={t.id} onPress={() => dismiss(t.id)} style={st.toast} accessibilityRole="alert">
            <Ionicons name={TOAST_ICON[t.tone]} size={20} color={color} />
            <Text style={st.toastText}>{t.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { padding: S.lg, paddingBottom: S.xxl * 2 },
  footer: {
    backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: S.lg, paddingTop: S.md, gap: S.sm,
    ...SHADOW.bar,
  },
  pressed: { opacity: 0.7 },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.lg, paddingTop: S.lg, paddingBottom: S.md, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line },
  sheetClose: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },

  tabHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: S.md, marginBottom: S.lg },
  eyebrow: { ...T.overline, color: C.brand700, marginBottom: 2 },
  display: { ...T.display },
  h1: { ...T.title },
  muted: { ...T.small },

  screenHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md, marginBottom: S.lg },
  headerWrap: { marginBottom: S.lg, gap: S.md },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  headerMain: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  headerRight: { alignItems: 'flex-end', justifyContent: 'center', minHeight: TOUCH, flexShrink: 1 },
  backBtn: {
    width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.card,
  },

  card: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.lg, ...SHADOW.card },
  cardPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  group: { paddingVertical: S.xs, paddingHorizontal: S.lg },

  section: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.xl, marginBottom: S.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  sectionTitle: { ...T.h3, fontSize: 16, flexShrink: 1 },
  countPill: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: C.brand100, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, fontWeight: '700', color: C.brand800 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: TOUCH, paddingLeft: S.sm },
  sectionActionText: { fontSize: 13, fontWeight: '700', color: C.brand700 },

  tileDot: { position: 'absolute', top: 4, right: 4, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: C.white },

  chipTag: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.full, borderWidth: 1, maxWidth: '100%' },
  chipTagSm: { paddingHorizontal: 7, paddingVertical: 1, gap: 4 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipTagText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },

  stat: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.md, paddingTop: S.md + 3, overflow: 'hidden', ...SHADOW.card },
  statAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  statLabel: { flex: 1, fontSize: 12, fontWeight: '600', color: C.sub, lineHeight: 16 },
  statValue: { ...T.h2, marginTop: S.sm, ...T.tabular },
  statSub: { ...T.caption, marginTop: 2 },

  termRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: S.sm, marginBottom: 6 },
  termLeft: { fontSize: 12, fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: 56, paddingVertical: S.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  rowPressed: { opacity: 0.6 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: C.ink, lineHeight: 20 },
  rowSub: { fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 18 },

  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: S.md },
  kvKey: { fontSize: 13, color: C.muted, lineHeight: 19, flexShrink: 0, maxWidth: '48%' },
  kvVal: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: C.ink, textAlign: 'right', ...T.tabular },
  divider: { height: 1, backgroundColor: C.lineSoft, marginVertical: S.md },

  discCard: { backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line },
  discHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: TOUCH },
  discTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: C.brand800 },
  discMeta: { fontSize: 12, color: C.muted, maxWidth: '45%' },
  discBody: { paddingTop: S.xs, gap: S.xs },
  discText: { fontSize: 13, lineHeight: 20, color: C.sub },

  callout: { borderRadius: R.lg, borderWidth: 1, padding: S.md },
  calloutRow: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  calloutIcon: { width: 32, height: 32, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center' },
  calloutTitle: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  calloutText: { fontSize: 13, lineHeight: 19 },

  bannerTL: { position: 'absolute', top: S.md, left: S.md, flexDirection: 'row', gap: S.xs },
  bannerTR: { position: 'absolute', top: S.md, right: S.md, flexDirection: 'row', gap: S.xs },
  bannerBottom: { position: 'absolute', left: S.lg, right: S.lg, bottom: S.md },

  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, paddingHorizontal: S.lg, borderRadius: R.md },
  btnSecondary: { borderWidth: 1, borderColor: C.line },
  btnPressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  btnText: { fontSize: 15, fontWeight: '700', flexShrink: 1 },

  label: { fontSize: 13, fontWeight: '600', color: C.sub, marginBottom: 6 },
  hint: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  input: { minHeight: 48, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: S.md, fontSize: 15, color: C.ink, backgroundColor: C.card },
  inputMulti: { minHeight: 96, paddingTop: S.md, paddingBottom: S.md, textAlignVertical: 'top' },
  inputFocus: { borderColor: C.brand600, borderWidth: 1.5 },
  inputOff: { backgroundColor: C.fill, color: C.muted },

  check: { flexDirection: 'row', gap: S.md, alignItems: 'flex-start', minHeight: TOUCH, paddingVertical: S.sm + 2, borderRadius: R.md },
  checkText: { fontSize: 13, lineHeight: 19, color: C.text },

  option: { flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: 56, borderWidth: 1.5, borderColor: C.line, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.sm, backgroundColor: C.card },
  optionOn: { borderColor: C.brand600, backgroundColor: C.brand50 },
  optionTitle: { fontSize: 14, fontWeight: '700', color: C.ink },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: { flexDirection: 'row', gap: 4, minHeight: TOUCH, paddingHorizontal: 14, borderRadius: R.full, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: C.brand50, borderColor: C.brand600 },
  chipInactive: { backgroundColor: C.card, borderColor: C.line },
  chipText: { fontSize: 14, fontWeight: '600', color: C.sub },
  chipTextActive: { color: C.brand800 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: 3, backgroundColor: C.card },
  stepperBtn: { width: TOUCH, height: TOUCH, borderRadius: R.sm + 2, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
  stepperMid: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperDate: { fontSize: 16, fontWeight: '700', color: C.ink, ...T.tabular },

  empty: { alignItems: 'center', paddingVertical: S.xl, paddingHorizontal: S.md, gap: 6 },
  emptyHalo: { padding: 10, borderRadius: 32, marginBottom: S.sm },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.ink, textAlign: 'center' },
  emptyDesc: { fontSize: 13, lineHeight: 19, color: C.muted, textAlign: 'center', paddingHorizontal: S.md },

  toastWrap: { position: 'absolute', left: S.lg, right: S.lg, gap: S.sm },
  toast: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, backgroundColor: C.ink, borderRadius: R.md, paddingVertical: S.md, paddingHorizontal: S.md, ...SHADOW.float },
  toastText: { flex: 1, color: C.white, fontSize: 13, lineHeight: 19, fontWeight: '500' },
});
