import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LEGAL_EFFECTIVE, PRIVACY_VERSION, TERMS_EFFECTIVE, TERMS_VERSION, isValidProfilePhone } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Button, Card, Field, H1, Input, Muted, Screen } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';

type Mode = 'login' | 'register' | 'forgot';

export default function LoginScreen() {
  const { loginEmail, register, resetPassword, busy, firebaseReady } = useStore();
  const [mode, setMode] = useState<Mode>('login');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit =
    mode === 'forgot' ? email.trim().length > 3
      : mode === 'login' ? email.trim().length > 3 && password.length >= 6
        : fullName.trim().length >= 2 && isValidProfilePhone(phone) && email.trim().length > 3 && password.length >= 6 && agreed;

  const submit = async () => {
    if (mode === 'login') await loginEmail(email, password);
    else if (mode === 'register') await register(fullName, email, password, phone);
    else if (await resetPassword(email)) setSent(true);
  };

  if (!firebaseReady) {
    return (
      <Screen>
        <Card style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a' }}>
          <Text style={{ color: C.amber, fontWeight: '600', marginBottom: 6 }}>Chưa cấu hình Firebase</Text>
          <Muted>Tạo file Mobile/React-Native/.env và điền các biến EXPO_PUBLIC_FIREBASE_*, rồi khởi động lại Metro.</Muted>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.logoRow}>
          <View style={st.logo}><Ionicons name="cube" size={26} color="#fff" /></View>
          <View>
            <Text style={st.brand}>KhoAn</Text>
            <Muted>Kho tự quản</Muted>
          </View>
        </View>

        <H1>
          {mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Quên mật khẩu'}
        </H1>
        <Muted style={{ marginTop: 4, marginBottom: S.lg } as never}>
          {mode === 'forgot'
            ? 'Nhập email đã đăng ký, chúng tôi gửi link đặt lại mật khẩu.'
            : 'Dùng để đặt kho, xem hợp đồng và lấy mã nhận kho.'}
        </Muted>

        {sent && mode === 'forgot' ? (
          <Card>
            <Text style={{ fontWeight: '600', color: C.green, marginBottom: 6 }}>Kiểm tra hộp thư</Text>
            <Muted>Nếu {email} có tài khoản, link đặt lại mật khẩu đã được gửi. Link có hiệu lực 1 giờ. Nhớ xem cả mục Spam.</Muted>
            <Button title="Quay lại đăng nhập" variant="secondary" style={{ marginTop: S.lg }} onPress={() => { setSent(false); setMode('login'); }} />
          </Card>
        ) : (
          <Card>
            {mode === 'register' && (
              <>
                <Field label="Họ và tên (đúng như trên giấy tờ)">
                  <Input value={fullName} onChangeText={setFullName} placeholder="Nguyễn Minh Anh" autoCapitalize="words" textContentType="name" />
                </Field>
                <Field label="Số điện thoại" hint="In vào hợp đồng và để chi nhánh liên hệ khi cần.">
                  <Input value={phone} onChangeText={setPhone} placeholder="0901 234 567" keyboardType="phone-pad" textContentType="telephoneNumber" maxLength={30} />
                </Field>
              </>
            )}

            <Field label="Email">
              <Input
                value={email} onChangeText={setEmail} placeholder="ban@email.com"
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
              />
            </Field>

            {mode !== 'forgot' && (
              <Field label="Mật khẩu" hint={mode === 'register' ? 'Ít nhất 6 ký tự' : undefined}>
                <Input
                  value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry
                  textContentType={mode === 'register' ? 'newPassword' : 'password'}
                />
              </Field>
            )}

            {mode === 'register' && (
              <Pressable onPress={() => setAgreed((v) => !v)} style={st.consent}>
                <Ionicons
                  name={agreed ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={agreed ? C.brand700 : C.faint}
                />
                <Text style={st.consentText}>
                  Tôi đã đọc và đồng ý{' '}
                  <Text style={st.link} onPress={() => Linking.openURL(`${WEB_ORIGIN}/dieu-khoan`)}>Điều khoản dịch vụ</Text>
                  {' '}và{' '}
                  <Text style={st.link} onPress={() => Linking.openURL(`${WEB_ORIGIN}/bao-mat`)}>Chính sách bảo mật</Text>
                  {' '}(Điều khoản bản {TERMS_VERSION} áp dụng từ {TERMS_EFFECTIVE}; Chính sách bảo mật bản {PRIVACY_VERSION} áp dụng từ {LEGAL_EFFECTIVE}).
                </Text>
              </Pressable>
            )}

            <Button
              title={mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Gửi link đặt lại'}
              onPress={() => void submit()}
              disabled={!canSubmit}
              loading={busy}
              style={{ marginTop: S.sm }}
            />
          </Card>
        )}

        <View style={st.links}>
          {mode !== 'login' && <Text style={st.link} onPress={() => { setMode('login'); setSent(false); }}>Đã có tài khoản? Đăng nhập</Text>}
          {mode === 'login' && <Text style={st.link} onPress={() => setMode('register')}>Chưa có tài khoản? Đăng ký</Text>}
          {mode === 'login' && <Text style={st.link} onPress={() => setMode('forgot')}>Quên mật khẩu</Text>}
        </View>

        <Card style={{ marginTop: S.lg, backgroundColor: C.brand50, borderColor: C.brand200 }}>
          <Text style={{ fontSize: 13, color: C.brand900, lineHeight: 19 }}>
            Quen đăng nhập bằng Google trên web? App chưa hỗ trợ nút Google. Vào web, đăng nhập Google rồi đặt mật khẩu ở trang
            <Text style={{ fontWeight: '700' }}> Đặt mật khẩu</Text> — vẫn là cùng một tài khoản, sau đó dùng mật khẩu đó ở đây.
          </Text>
          <Button
            title="Mở trang web"
            variant="secondary"
            icon="open-outline"
            style={{ marginTop: S.md }}
            onPress={() => Linking.openURL(`${WEB_ORIGIN}/dat-mat-khau`)}
          />
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const st = StyleSheet.create({
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.xl },
  logo: { width: 46, height: 46, borderRadius: R.md, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 19, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  consent: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', marginBottom: S.md },
  consentText: { flex: 1, fontSize: 13, lineHeight: 19, color: C.text },
  link: { color: C.brand700, fontWeight: '600', fontSize: 13 },
  links: { alignItems: 'center', gap: S.md, marginTop: S.lg },
});
