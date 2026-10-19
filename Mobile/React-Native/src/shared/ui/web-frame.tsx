import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { C } from './theme';

/** Khung điện thoại khi mở app trên trình duyệt máy tính: rộng 390 (iPhone 14/15), cao tối đa 844. */
const PHONE_W = 390;
const PHONE_MAX_H = 844;
const BEZEL = 8;
/** Cửa sổ rộng hơn mức này mới vẽ khung; hẹp hơn (điện thoại thật mở bản web) thì tràn màn hình. */
const FRAME_FROM_WIDTH = 520;

/**
 * Chỉ ảnh hưởng bản WEB của app (expo start --web / expo export -p web). Trên máy tính, giao diện app được giữ
 * đúng tỉ lệ điện thoại dọc ở giữa màn hình thay vì giãn ra hết cửa sổ — dùng làm phương án dự phòng khi điện
 * thoại thật gặp sự cố lúc demo. Bản iOS/Android không đổi gì (trả lại children nguyên vẹn).
 */
export function WebFrame({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return <Framed>{children}</Framed>;
}

function Framed({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  if (width <= FRAME_FROM_WIDTH) return <View style={st.fill}>{children}</View>;

  const phoneH = Math.max(420, Math.min(PHONE_MAX_H, height - 32)); // cửa sổ thấp thì khung co lại, không tràn
  return (
    <View style={st.stage}>
      <View style={[st.phone, { width: PHONE_W + BEZEL * 2, height: phoneH + BEZEL * 2 }]}>
        <View style={st.screen}>{children}</View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d6d3d1' },
  phone: {
    backgroundColor: C.ink, borderRadius: 44, padding: BEZEL,
    boxShadow: '0 24px 60px rgba(28, 25, 23, 0.35)',
  } as ViewStyle,
  screen: { flex: 1, borderRadius: 36, overflow: 'hidden', backgroundColor: C.bg },
});
