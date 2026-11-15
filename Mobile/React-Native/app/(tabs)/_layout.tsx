import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, SHADOW } from '../../src/shared/ui/theme';

type Icon = keyof typeof Ionicons.glyphMap;

/**
 * Chiều cao phần nội dung của thanh tab (chưa tính vùng an toàn dưới): đệm trên 5 của nút tab + viên thuốc icon 28 + cách 2
 * + nhãn 15 + đệm dưới 5, cộng 2 cho viền trên. Để mặc định (49) thì nhãn tràn khỏi thanh — trên web (vùng an toàn = 0, khung
 * điện thoại bo góc cắt phần tràn) nhãn bị mất hẳn.
 */
const TAB_CONTENT_H = 57;
/** Đệm dưới tối thiểu khi không có vùng an toàn: web cần rộng hơn để nhãn ở hai tab ngoài không chạm góc bo của khung. */
const MIN_BOTTOM_PAD = Platform.OS === 'web' ? 12 : 6;

/** Icon tab: bản đặc khi đang mở + nền viên thuốc nhạt, bản viền khi không — nhìn là biết đang ở tab nào. */
function TabIcon({ on, off, focused, color }: { on: Icon; off: Icon; focused: boolean; color: ColorValue }) {
  return (
    <View style={[st.pill, focused && st.pillOn]}>
      <Ionicons name={focused ? on : off} size={22} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, MIN_BOTTOM_PAD);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.brand700,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.card, borderTopColor: C.line, ...SHADOW.bar,
          height: TAB_CONTENT_H + bottomPad, paddingTop: 0, paddingBottom: bottomPad,
        },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Kho của tôi', tabBarIcon: ({ color, focused }) => <TabIcon on="cube" off="cube-outline" focused={focused} color={color} /> }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: 'Thuê kho', tabBarIcon: ({ color, focused }) => <TabIcon on="search" off="search-outline" focused={focused} color={color} /> }}
      />
      <Tabs.Screen
        name="support"
        options={{ title: 'Hỗ trợ', tabBarIcon: ({ color, focused }) => <TabIcon on="chatbubbles" off="chatbubbles-outline" focused={focused} color={color} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Tài khoản', tabBarIcon: ({ color, focused }) => <TabIcon on="person-circle" off="person-circle-outline" focused={focused} color={color} /> }}
      />
    </Tabs>
  );
}

const st = StyleSheet.create({
  pill: { width: 52, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: C.brand50 },
});
