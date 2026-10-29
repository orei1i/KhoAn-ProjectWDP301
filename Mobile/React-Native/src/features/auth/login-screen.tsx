import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LEGAL_EFFECTIVE, PRIVACY_VERSION, TERMS_EFFECTIVE, TERMS_VERSION, isValidProfilePhone } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Button, Callout, Card, CheckRow, Chips, Disclosure, EmptyState, Field, H1, Input, Muted, PhotoBanner, Screen } from '../../shared/ui';
import { C, R, S, TOUCH } from '../../shared/ui/theme';
import { PHOTO_SOURCES } from '../../shared/ui/visuals';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';

type Mode = 'login' | 'register' | 'forgot';
const MODES: { value: Mode; label: string; icon: 'log-in-outline' | 'person-add-outline' }[] = [
  { value: 'login', label: 'Đăng nhập', icon: 'log-in-outline' }, { value: 'register', label: 'Đăng ký', icon: 'person-add-outline' },
];

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
        <Callout tone="amber" icon="construct-outline" title="Chưa cấu hình Firebase">
          Tạo file Mobile/React-Native/.env và điền các biến EXPO_PUBLIC_FIREBASE_*, rồi khởi động lại Metro.
        </Callout>
      </Screen>
    );
  }

  return (
    <Screen>
      <PhotoBanner source={PHOTO_SOURCES['mat-tien-cua-cuon']} height={176} radius={R.xl} accessibilityLabel="Dãy kho KhoAn">
        <View style={st.logoRow}>
          <View style={st.logo}><Ionicons name="cube" size={26} color="#fff" /></View>
          <View>
            <Text style={st.brand}>KhoAn</Text>
            <Text style={st.tag}>Kho tự quản · gửi đồ an tâm</Text>
          </View>
        </View>
      </PhotoBanner>

      <View style={st.titleBlock}>
        <H1>
          {mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Quên mật khẩu'}
        </H1>
        <Muted style={{ marginTop: 4 } as never}>
          {mode === 'forgot'
            ? 'Nhập email đã đăng ký, chúng tôi gửi link đặt lại mật khẩu.'
            : 'Dùng để đặt kho, xem hợp đồng và lấy mã nhận kho.'}
        </Muted>
      </View>

      {mode !== 'forgot' && (
        <View style={{ marginBottom: S.md }}>
          <Chips options={MODES} value={mode} onChange={(m) => { setMode(m); setSent(false); }} columns={2} />
        </View>
      )}

      {sent && mode === 'forgot' ? (
        <Card>
          <EmptyState icon="mail-open-outline" tone="green" title="Kiểm tra hộp thư"
            description={`Nếu ${email} có tài khoản, link đặt lại mật khẩu đã được gửi. Link có hiệu lực 1 giờ. Nhớ xem cả mục Spam.`}
            action={<Button title="Quay lại đăng nhập" variant="secondary" icon="arrow-back" onPress={() => { setSent(false); setMode('login'); }} />} />
        </Card>
      ) : (
        <Card>
          {mode === 'register' && (
            <>
              <Field label="Họ và tên (đúng như trên giấy tờ)">
                <Input value={fullName} onChangeText={setFullName} placeholder="Nguyễn Minh Anh" autoCapitalize="words" textContentType="name" />
              </Field>
              <Field label="Số điện thoại">
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
            <CheckRow checked={agreed} onPress={() => setAgreed((v) => !v)} style={{ marginBottom: S.sm }}>
              Tôi đã đọc và đồng ý{' '}
              <Text style={st.link} onPress={() => Linking.openURL(`${WEB_ORIGIN}/dieu-khoan`)}>Điều khoản dịch vụ</Text>
              {' '}và{' '}
              <Text style={st.link} onPress={() => Linking.openURL(`${WEB_ORIGIN}/bao-mat`)}>Chính sách bảo mật</Text>
              {' '}(Điều khoản bản {TERMS_VERSION} áp dụng từ {TERMS_EFFECTIVE}; Chính sách bảo mật bản {PRIVACY_VERSION} áp dụng từ {LEGAL_EFFECTIVE}).
            </CheckRow>
          )}

          <Button
            title={mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Gửi link đặt lại'}
            icon={mode === 'login' ? 'log-in-outline' : mode === 'register' ? 'person-add-outline' : 'mail-outline'}
            size="lg"
            onPress={() => void submit()}
            disabled={!canSubmit}
            loading={busy}
            style={{ marginTop: S.sm }}
          />
        </Card>
      )}

      <View style={st.links}>
        {mode === 'forgot' && (
          <Pressable onPress={() => { setMode('login'); setSent(false); }} style={st.linkBtn} accessibilityRole="button">
            <Ionicons name="arrow-back" size={16} color={C.brand700} />
            <Text style={st.link}>Đã có tài khoản? Đăng nhập</Text>
          </Pressable>
        )}
        {mode === 'login' && (
          <Pressable onPress={() => setMode('forgot')} style={st.linkBtn} accessibilityRole="button">
            <Ionicons name="help-circle-outline" size={16} color={C.brand700} />
            <Text style={st.link}>Quên mật khẩu</Text>
          </Pressable>
        )}
      </View>

      <Card style={{ marginTop: S.lg, paddingVertical: S.xs }}>
        <Disclosure title="Quen đăng nhập bằng Google trên web?" icon="logo-google">
          <Text style={{ fontSize: 13, color: C.sub, lineHeight: 19 }}>
            App chưa hỗ trợ nút Google. Vào web, đăng nhập Google rồi đặt mật khẩu ở trang
            <Text style={{ fontWeight: '700' }}> Đặt mật khẩu</Text> — vẫn là cùng một tài khoản, sau đó dùng mật khẩu đó ở đây.
          </Text>
          <Button
            title="Mở trang web"
            variant="secondary"
            size="sm"
            icon="open-outline"
            style={{ marginTop: S.sm, marginBottom: S.sm }}
            onPress={() => Linking.openURL(`${WEB_ORIGIN}/dat-mat-khau`)}
          />
        </Disclosure>
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  logo: { width: 48, height: 48, borderRadius: R.md, backgroundColor: C.brand600, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 24, fontWeight: '800', color: C.white, letterSpacing: -0.4 },
  tag: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  titleBlock: { marginTop: S.xl, marginBottom: S.lg },
  link: { color: C.brand700, fontWeight: '700', fontSize: 13 },
  links: { alignItems: 'center', gap: S.xs, marginTop: S.md },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH, paddingHorizontal: S.md },
});
