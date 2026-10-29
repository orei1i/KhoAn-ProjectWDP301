import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { C, SHADOW } from '../../src/shared/ui/theme';

type Icon = keyof typeof Ionicons.glyphMap;

/** Icon tab: bản đặc khi đang mở + nền viên thuốc nhạt, bản viền khi không — nhìn là biết đang ở tab nào. */
function TabIcon({ on, off, focused, color }: { on: Icon; off: Icon; focused: boolean; color: ColorValue }) {
  return (
    <View style={[st.pill, focused && st.pillOn]}>
      <Ionicons name={focused ? on : off} size={22} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.brand700,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: C.card, borderTopColor: C.line, ...SHADOW.bar },
        tabBarItemStyle: { paddingTop: 4 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
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
