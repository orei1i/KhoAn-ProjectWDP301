/**
 * Bảng màu và khoảng cách cho app mobile.
 *
 * React Native không có Tailwind nên không dùng lại được class của Webapp, nhưng giá trị màu
 * thì lấy đúng bộ đang dùng bên web (brand = teal, ink = stone-900) để hai đầu nhìn cùng một
 * sản phẩm. Đổi màu thương hiệu thì sửa ở đây, không rải hex trong từng màn hình.
 */
import type { Tone } from '@ssm/shared';

export const C = {
  brand50: '#f0fdfa',
  brand100: '#ccfbf1',
  brand200: '#99f6e4',
  brand600: '#0d9488',
  brand700: '#0f766e',
  brand800: '#115e59',
  brand900: '#134e4a',

  ink: '#1c1917',
  text: '#292524',
  muted: '#78716c',
  faint: '#a8a29e',

  bg: '#fafaf9',
  card: '#ffffff',
  line: '#e7e5e4',
  fill: '#f5f5f4',

  green: '#047857',
  greenBg: '#ecfdf5',
  amber: '#b45309',
  amberBg: '#fffbeb',
  red: '#b91c1c',
  redBg: '#fef2f2',
  blue: '#0369a1',
  blueBg: '#f0f9ff',
  violet: '#6d28d9',
  violetBg: '#f5f3ff',
} as const;

/** Nhãn trạng thái dùng chung (labels.ts) trả về `tone`; đây là chỗ đổi tone thành màu thật. */
export const TONE: Record<Tone, { fg: string; bg: string }> = {
  gray: { fg: C.muted, bg: C.fill },
  green: { fg: C.green, bg: C.greenBg },
  blue: { fg: C.blue, bg: C.blueBg },
  amber: { fg: C.amber, bg: C.amberBg },
  red: { fg: C.red, bg: C.redBg },
  violet: { fg: C.violet, bg: C.violetBg },
  teal: { fg: C.brand800, bg: C.brand50 },
};

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const R = { sm: 8, md: 12, lg: 16, full: 999 } as const;
