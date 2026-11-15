import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useStore } from '../../shared/store/store';
import { Button, Callout } from '../../shared/ui';
import { S } from '../../shared/ui/theme';

/**
 * Nhắc xác minh email cho tài khoản tự đăng ký (PENDING_VERIFICATION) — như banner bên web: "Gửi lại email" (chờ 60 giây giữa
 * hai lần) và "Tôi đã xác minh" (tải lại trạng thái, BE kích hoạt tài khoản ngay, không phải đăng xuất rồi vào lại).
 * Dùng ở Tài khoản và màn đặt kho. `onVerified` gọi khi tài khoản đã kích hoạt.
 */
export function VerifyEmailCallout({ style, onVerified }: { style?: StyleProp<ViewStyle>; onVerified?: () => void }) {
  const { user, resendVerification, verifyResendAt, confirmVerification } = useStore();
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);

  // Đếm ngược thời gian chờ gửi lại, mỗi giây một lần, dừng khi hết.
  useEffect(() => {
    setNow(Date.now());
    if (verifyResendAt <= Date.now()) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= verifyResendAt) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [verifyResendAt]);

  if (!user) return null;
  const wait = Math.max(0, Math.ceil((verifyResendAt - now) / 1000));

  const resend = async () => {
    setSending(true);
    await resendVerification();
    setSending(false);
  };
  const check = async () => {
    setChecking(true);
    const ok = await confirmVerification();
    setChecking(false);
    if (ok) onVerified?.();
  };

  return (
    <Callout
      tone="amber" icon="mail-unread-outline" title="Chưa xác minh email" style={style}
      action={(
        <View style={st.actions}>
          <Button title={wait > 0 ? `Gửi lại sau ${wait}s` : 'Gửi lại email'} variant="secondary" size="sm" style={st.btn}
            disabled={wait > 0 || checking} loading={sending} onPress={() => void resend()} />
          <Button title="Tôi đã xác minh" size="sm" style={st.btn} disabled={sending} loading={checking} onPress={() => void check()} />
        </View>
      )}
    >
      Bấm link trong email gửi tới {user.email}, rồi bấm “Tôi đã xác minh”. Chưa xác minh thì chưa đặt kho được.
    </Callout>
  );
}

const st = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  btn: { flexGrow: 1, flexBasis: 140 },
});
