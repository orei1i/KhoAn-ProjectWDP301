import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from '../src/shared/store/store';
import { Toasts } from '../src/shared/ui';
import { BootScreen } from '../src/shared/ui/boot-screen';
import { WebFrame } from '../src/shared/ui/web-frame';
import { C } from '../src/shared/ui/theme';

/**
 * Cổng đăng nhập.
 *
 * Ba trạng thái, đừng gộp hai cái đầu: `ready` false nghĩa là Firebase CÒN ĐANG khôi phục phiên
 * từ AsyncStorage — đá về trang đăng nhập lúc này thì người đang đăng nhập cũng bị văng ra mỗi
 * lần mở app.
 */
function Gate() {
  const { user, ready } = useStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === 'login';
    if (!user && !inAuth) router.replace('/login');
    else if (user && inAuth) router.replace('/');
  }, [user, ready, segments, router]);

  if (!ready) return <BootScreen />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="qr/[id]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <WebFrame>
      <SafeAreaProvider>
        <StoreProvider>
          <StatusBar style="dark" />
          <Gate />
          <Toasts />
        </StoreProvider>
      </SafeAreaProvider>
    </WebFrame>
  );
}
