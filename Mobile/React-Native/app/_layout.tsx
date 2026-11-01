import { Stack, useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GATEWAY_TXN_REF_RE } from '@ssm/shared';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from '../src/shared/store/store';
import { Toasts } from '../src/shared/ui';
import { BootScreen } from '../src/shared/ui/boot-screen';
import { WebFrame } from '../src/shared/ui/web-frame';
import { C } from '../src/shared/ui/theme';
import { ConsentScreen } from '../src/features/auth/consent-screen';

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
  const { ref } = useGlobalSearchParams<{ ref?: string }>();
  // Deep link khoan://pay-result?ref=… mở lúc chưa đăng nhập: giữ mã giao dịch để đăng nhập xong về đúng màn kết quả.
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === 'login';
    if (!user && !inAuth) {
      if (segments[0] === 'pay-result' && typeof ref === 'string' && GATEWAY_TXN_REF_RE.test(ref)) pendingRef.current = ref;
      router.replace('/login');
    } else if (user && inAuth && !user.consentRequired) { // còn màn đồng ý điều khoản thì chưa có Stack: đồng ý xong `user` đổi, chạy lại
      const target = pendingRef.current;
      pendingRef.current = null;
      router.replace(target ? `/pay-result?ref=${target}` as never : '/');
    }
  }, [user, ready, segments, ref, router]);

  if (!ready) return <BootScreen />;
  // Điều khoản / Chính sách bảo mật đổi phiên bản mà khách chưa đồng ý bản mới → bắt buộc đồng ý lại trước khi dùng tiếp.
  if (user?.consentRequired) return <ConsentScreen />;

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
