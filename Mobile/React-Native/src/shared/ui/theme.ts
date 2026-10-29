/**
 * Hệ thống thiết kế của app mobile: màu, khoảng cách, bo góc, bóng đổ, cỡ chữ, tông trạng thái.
 *
 * React Native không có Tailwind nên không dùng lại được class của Webapp, nhưng giá trị thì lấy đúng bộ đang dùng
 * bên web (Webapp/src/app/globals.css: brand = xanh ngọc, ink = gần đen ánh xanh, nền stone) để hai đầu nhìn cùng một
 * sản phẩm. Đổi màu thương hiệu thì sửa ở đây, không rải hex trong từng màn hình.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import type { Tone } from '@ssm/shared';

export const C = {
  brand50: '#effbf8',
  brand100: '#d6f4ec',
  brand200: '#aee8d9',
  brand300: '#78d4bf',
  brand400: '#3fb9a0',
  brand500: '#14a085',
  brand600: '#0e8570',
  brand700: '#0d6b5b',
  brand800: '#0e554a',
  brand900: '#0b3f37',

  ink: '#16201e',
  text: '#292524',
  sub: '#57534e',
  muted: '#78716c',
  faint: '#a8a29e',

  bg: '#f6f6f4',
  card: '#ffffff',
  line: '#e7e5e4',
  lineSoft: '#f0efed',
  fill: '#f5f5f4',
  white: '#ffffff',
  overlay: 'rgba(22, 32, 30, 0.45)',

  green: '#047857',
  greenBg: '#ecfdf5',
  greenLine: '#a7f3d0',
  amber: '#b45309',
  amberBg: '#fffbeb',
  amberLine: '#fde68a',
  amberInk: '#78350f',
  red: '#b91c1c',
  redBg: '#fef2f2',
  redLine: '#fecaca',
  redSolid: '#dc2626',
  blue: '#0369a1',
  blueBg: '#f0f9ff',
  blueLine: '#bae6fd',
  violet: '#6d28d9',
  violetBg: '#f5f3ff',
  violetLine: '#ddd6fe',
} as const;

/**
 * Nhãn trạng thái dùng chung (labels.ts) trả về `tone`; đây là chỗ đổi tone thành màu thật.
 * fg = chữ/icon, bg = nền nhạt, line = viền, dot = chấm/thanh tiến độ đậm, ink = chữ đậm trên nền nhạt (banner).
 */
export const TONE: Record<Tone, { fg: string; bg: string; line: string; dot: string; ink: string }> = {
  gray: { fg: '#44403c', bg: C.fill, line: C.line, dot: C.faint, ink: C.text },
  green: { fg: C.green, bg: C.greenBg, line: C.greenLine, dot: '#10b981', ink: '#064e3b' },
  blue: { fg: C.blue, bg: C.blueBg, line: C.blueLine, dot: '#0ea5e9', ink: '#0c4a6e' },
  amber: { fg: C.amber, bg: C.amberBg, line: C.amberLine, dot: '#f59e0b', ink: C.amberInk },
  red: { fg: C.red, bg: C.redBg, line: C.redLine, dot: '#ef4444', ink: '#7f1d1d' },
  violet: { fg: C.violet, bg: C.violetBg, line: C.violetLine, dot: '#8b5cf6', ink: '#4c1d95' },
  teal: { fg: C.brand800, bg: C.brand50, line: C.brand200, dot: C.brand500, ink: C.brand900 },
};

/** Khoảng cách theo lưới 4. */
export const S = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Bo góc. */
export const R = { xs: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, full: 999 } as const;
/** Vùng chạm tối thiểu (Apple HIG 44pt / Material 48dp). */
export const TOUCH = 44;

/**
 * Bóng đổ — RN 0.86 (kiến trúc mới) và react-native-web đều hiểu `boxShadow` dạng chuỗi CSS.
 * card: rất nhẹ cho thẻ đứng yên · lift: thẻ nổi (hero, thanh dưới) · float: toast, nút nổi.
 */
export const SHADOW = {
  none: {} as ViewStyle,
  card: { boxShadow: '0 1px 2px rgba(22, 32, 30, 0.05), 0 2px 8px rgba(22, 32, 30, 0.04)' } as ViewStyle,
  lift: { boxShadow: '0 12px 28px -14px rgba(22, 32, 30, 0.30), 0 4px 10px -6px rgba(22, 32, 30, 0.12)' } as ViewStyle,
  float: { boxShadow: '0 16px 36px -12px rgba(22, 32, 30, 0.40)' } as ViewStyle,
  bar: { boxShadow: '0 -6px 20px -10px rgba(22, 32, 30, 0.22)' } as ViewStyle,
} as const;

/** Thang chữ. Số nằm trong bảng (tiền, ngày) dùng `tabular` để các cột thẳng hàng. */
export const T = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, color: C.ink },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4, color: C.ink },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: -0.2, color: C.ink },
  h3: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: C.ink },
  body: { fontSize: 15, lineHeight: 22, color: C.text },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: C.ink },
  small: { fontSize: 13, lineHeight: 19, color: C.muted },
  smallStrong: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: C.text },
  caption: { fontSize: 12, lineHeight: 16, color: C.muted },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', color: C.muted },
  tabular: { fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

/** Phông chữ đơn cách cho mã (mã đặt chỗ, mã PIN). */
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' });
