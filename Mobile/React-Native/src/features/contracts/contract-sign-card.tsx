import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContractClause, Reservation, SignatureMethod, SigningPreference } from '@ssm/shared';
import { fmtDateTime, SIGNING_PREFERENCE, signingPreferenceOf } from '@ssm/shared';
import { api, ApiError, isNetworkError } from '../../shared/api/client';
import { actions } from '../../shared/api/actions';
import { useStore } from '../../shared/store/store';
import { Badge, Button, Callout, Card, CheckRow, Chips, Field, IconTile, Input, Muted } from '../../shared/ui';
import { C, MONO, R, S, T, TOUCH } from '../../shared/ui/theme';
import { SignaturePad, canDrawSignature, type SignaturePadHandle } from './signature-pad';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';
/** Khách chỉ ký online (vẽ tay / gõ họ tên); PAPER là nhân viên tải bản ký giấy tại quầy. */
type OnlineMethod = Exclude<SignatureMethod, 'PAPER'>;
const METHODS: { value: OnlineMethod; label: string }[] = [{ value: 'DRAWN', label: 'Ký tay' }, { value: 'TYPED', label: 'Gõ họ tên' }];
/** Gửi lại mã sau chừng này giây (khớp BE: 429 OTP_COOLDOWN). */
const OTP_COOLDOWN_S = 60;
type OtpInfo = { sentTo: string; expiresAt: string; demoCode?: string };

/** Khách chọn cách ký (Điều 11) — hai cách giá trị như nhau. */
const PREFS: { value: SigningPreference; label: string }[] = [
  { value: 'ONLINE', label: SIGNING_PREFERENCE.ONLINE.choice }, { value: 'PAPER_AT_COUNTER', label: SIGNING_PREFERENCE.PAPER_AT_COUNTER.choice },
];

const signatureMethodText = (m: SignatureMethod) => (m === 'PAPER' ? 'ký giấy tại quầy' : m === 'DRAWN' ? 'ký tay' : 'ký bằng họ tên');

/**
 * Bước ký hợp đồng sau khi trả tiền giữ chân, trước khi nhận kho: đọc nội dung hợp đồng, ký tay (hoặc gõ họ tên),
 * nhập mã OTP gửi qua email rồi xác nhận. Ký xong, server tự gửi PDF hợp đồng đã ký tới email của khách; có nút gửi lại.
 * Khách có thể chọn ký giấy tại quầy khi đến nhận kho thay vì ký online — khi đó chỉ nhắc mang giấy tờ + nút đổi sang ký online.
 */
export function ContractSignCard({ reservation: r }: { reservation: Reservation }) {
  const { user, run, toast, refresh, busy } = useStore();
  const [name, setName] = useState(user?.fullName ?? '');
  const [agree, setAgree] = useState(false);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<OnlineMethod>(canDrawSignature ? 'DRAWN' : 'TYPED');
  const [hasInk, setHasInk] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);
  // Nội dung hợp đồng do SERVER dựng từ mẫu đang áp dụng (cùng nguồn với web và PDF) — không tự ghép ở app.
  const [clauses, setClauses] = useState<ContractClause[] | null>(null);
  const [loadError, setLoadError] = useState('');
  // OTP ký online: mã gửi qua email; gửi lại sau OTP_COOLDOWN_S giây.
  const [otp, setOtp] = useState('');
  const [otpInfo, setOtpInfo] = useState<OtpInfo | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const [signing, setSigning] = useState(false);
  const signed = !!r.signature;
  useEffect(() => {
    if (signed) return;
    let alive = true;
    api.get<{ clauses: ContractClause[] }>(`/reservations/${r._id}/contract`)
      .then((v) => { if (alive) { setClauses(v.clauses); setLoadError(''); } })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => { alive = false; };
  }, [r._id, signed]);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => { const n = Date.now(); setNow(n); if (n >= cooldownUntil) clearInterval(t); }, 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  if (r.signature) {
    const s = r.signature;
    // Ký giấy tại quầy: không có chữ ký online để hiện; bản scan tải trên web.
    if (s.method === 'PAPER') {
      return (
        <Card tone="green" style={{ marginTop: S.md }}>
          <View style={st.head}>
            <IconTile icon="checkmark-done-outline" tone="green" style={{ backgroundColor: C.white }} />
            <View style={{ flex: 1 }}>
              <Text style={[st.title, { color: C.green }]}>Đã ký giấy tại quầy — {s.signerName}</Text>
              <Muted style={{ marginTop: 2 } as never}>{fmtDateTime(s.signedAt)} · bản scan xem trên web</Muted>
            </View>
          </View>
        </Card>
      );
    }
    return (
      <Card tone="green" style={{ marginTop: S.md }}>
        <View style={st.head}>
          <IconTile icon="checkmark-done-outline" tone="green" style={{ backgroundColor: C.white }} />
          <View style={{ flex: 1 }}>
            <Text style={[st.title, { color: C.green }]}>Đã ký hợp đồng — {s.signerName}</Text>
            <Muted style={{ marginTop: 2 } as never}>{fmtDateTime(s.signedAt)} · {signatureMethodText(s.method)}</Muted>
          </View>
        </View>
        {s.image ? <Image source={{ uri: s.image }} resizeMode="contain" style={st.sigImg} /> : null}
        <Muted style={{ marginTop: S.sm } as never}>{s.emailedAt ? `Đã gửi PDF tới ${s.emailedTo ?? 'email của bạn'} lúc ${fmtDateTime(s.emailedAt)}.` : 'PDF hợp đồng chưa được gửi qua email.'}</Muted>
        <Button title="Gửi lại PDF qua email" variant="secondary" size="sm" icon="mail-outline" style={{ marginTop: S.sm }}
          onPress={() => void run('emailContract', { reservationId: r._id }, (v) => `Đã gửi PDF tới ${v.to}`)} />
      </Card>
    );
  }

  const waitS = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  // Chưa tải được nội dung hợp đồng thì chưa cho ký — khách phải đọc được thứ mình ký.
  const ready = name.trim().length >= 2 && agree && (method === 'TYPED' || hasInk) && !!clauses;
  const valid = ready && /^\d{6}$/.test(otp) && !!otpInfo;

  const sendOtp = async () => {
    setSending(true);
    try {
      const v = await actions.requestSignOtp({ reservationId: r._id });
      setOtpInfo(v);
      setOtp('');
      setCooldownUntil(Date.now() + OTP_COOLDOWN_S * 1000);
      setNow(Date.now());
      toast(`Đã gửi mã tới ${v.sentTo}`, 'success');
    } catch (e) {
      // Mạng chập chờn / quá thời gian chờ: mã có thể ĐÃ được gửi — mở ô nhập mã, khách kiểm tra email; chưa có thì gửi lại sau.
      if (isNetworkError(e)) {
        setOtpInfo((cur) => cur ?? { sentTo: user?.email ?? 'email của bạn', expiresAt: '' });
        setCooldownUntil(Date.now() + OTP_COOLDOWN_S * 1000); setNow(Date.now());
        toast('Kết nối chậm — mã có thể đã được gửi, hãy kiểm tra email. Chưa có thì gửi lại sau ít phút.', 'info');
        return;
      }
      if (e instanceof ApiError && e.code === 'OTP_COOLDOWN') { setCooldownUntil(Date.now() + OTP_COOLDOWN_S * 1000); setNow(Date.now()); }
      toast(e instanceof Error ? e.message : 'Không gửi được mã', 'error');
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    let image: string | null = null;
    if (method === 'DRAWN') {
      image = (await pad.current?.exportPng()) ?? null;
      if (!image) { toast('Không xuất được chữ ký tay — hãy gõ họ tên để ký', 'error'); setMethod('TYPED'); return; }
    }
    setSigning(true);
    try {
      await actions.signContract({ reservationId: r._id, signerName: name.trim(), method, image, otp });
      await refresh();
      toast('Đã ký hợp đồng — PDF được gửi tới email của bạn', 'success');
    } catch (e) {
      // Mạng chập chờn / quá thời gian chờ: server có thể đã lưu chữ ký — hỏi lại trạng thái thật thay vì báo lỗi.
      if (isNetworkError(e)) {
        const fresh = await api.get<Reservation>(`/reservations/${r._id}`).catch(() => null);
        await refresh().catch(() => {});
        toast(fresh?.signature ? 'Đã ký hợp đồng — PDF được gửi tới email của bạn' : fresh ? 'Kết nối chậm — hợp đồng CHƯA được ký, vui lòng thử lại' : 'Kết nối chậm — chưa kiểm tra được trạng thái. Mở lại màn hình này để xem đã ký chưa trước khi thử lại.', fresh?.signature ? 'success' : 'error');
        return;
      }
      const code = e instanceof ApiError ? e.code : '';
      // Mã hết hạn / bị khoá / chưa có → phải xin mã mới; sai mã → nhập lại.
      if (code === 'OTP_EXPIRED' || code === 'OTP_LOCKED' || code === 'OTP_REQUIRED') { setOtpInfo(null); setCooldownUntil(0); }
      if (code.startsWith('OTP_')) setOtp('');
      else refresh().catch(() => {});
      toast(e instanceof Error ? e.message : 'Không ký được hợp đồng', 'error');
    } finally {
      setSigning(false);
    }
  };

  const pref = signingPreferenceOf(r);
  const choose = (preference: SigningPreference) => {
    if (preference === pref) return;
    void run('setSigningPreference', { reservationId: r._id, preference },
      preference === 'PAPER_AT_COUNTER' ? 'Đã chọn ký giấy tại quầy khi nhận kho' : 'Đã chuyển sang ký online');
  };

  // Khách đã chọn ký giấy tại quầy: không nhắc "chưa ký" như lỗi — chỉ nhắc mang giấy tờ, cho đổi lại ký online.
  if (pref === 'PAPER_AT_COUNTER') {
    return (
      <Card style={{ marginTop: S.md }}>
        <View style={st.head}>
          <IconTile icon="create-outline" tone="violet" />
          <Text style={[st.title, { flex: 1 }]}>Bước 2 — Ký hợp đồng</Text>
          <Badge tone="violet">{SIGNING_PREFERENCE.PAPER_AT_COUNTER.label}</Badge>
        </View>
        <View style={{ marginTop: S.md }}>
          <Chips options={PREFS} value={pref} onChange={choose} columns={2} />
        </View>
        <Callout tone="violet" icon="storefront-outline" style={{ marginTop: S.md }}>{SIGNING_PREFERENCE.PAPER_AT_COUNTER.note}</Callout>
        <Button title="Đổi sang ký online" variant="secondary" icon="create-outline" style={{ marginTop: S.md }} loading={busy} onPress={() => choose('ONLINE')} />
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: S.md }}>
      <View style={st.head}>
        <IconTile icon="create-outline" tone="amber" />
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Bước 2 — Ký hợp đồng</Text>
          <Text style={T.caption}>Ký online ngay, hoặc chọn ký giấy tại quầy khi đến nhận kho.</Text>
        </View>
        <Badge tone="amber">Chưa ký</Badge>
      </View>
      <View style={{ marginTop: S.md }}>
        <Chips options={PREFS} value={pref} onChange={choose} columns={2} />
      </View>

      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => [st.toggle, pressed && { opacity: 0.7 }]}>
        <Ionicons name="reader-outline" size={18} color={C.brand700} />
        <Text style={st.toggleText}>{open ? 'Thu gọn nội dung hợp đồng' : 'Xem nội dung hợp đồng'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.brand700} />
      </Pressable>

      {open && (
        <View style={st.doc}>
          {loadError ? <Text style={[st.p, { color: C.red }]}>Không tải được nội dung hợp đồng: {loadError}</Text> : null}
          {!clauses && !loadError ? <Text style={st.p}>Đang tải nội dung hợp đồng…</Text> : null}
          {(clauses ?? []).map((c, i) => (
            <View key={`${i}-${c.title}`}>
              <Text style={st.h}>{c.title}</Text>
              {c.paragraphs.map((p, k) => <Text key={k} style={st.p}>{p}</Text>)}
              {c.bullets.map((b, k) => <Text key={k} style={st.p}>• {b}</Text>)}
            </View>
          ))}
          <Text style={[st.p, st.link]} onPress={() => Linking.openURL(`${WEB_ORIGIN}/dieu-khoan`)}>Xem Điều khoản thuê kho đầy đủ</Text>
        </View>
      )}

      <Text style={st.stepLabel}>Chữ ký</Text>
      {canDrawSignature && (
        <Chips options={METHODS} value={method} onChange={setMethod} columns={2} />
      )}
      {method === 'DRAWN' && <View style={{ marginTop: S.md }}><SignaturePad ref={pad} onInkChange={setHasInk} /></View>}

      <View style={{ marginTop: S.md }}>
        <Field label={method === 'DRAWN' ? 'Họ tên người ký' : 'Gõ đầy đủ họ tên để ký'}>
          <Input value={name} onChangeText={setName} autoCapitalize="words" />
        </Field>
      </View>
      <CheckRow checked={agree} onPress={() => setAgree((v) => !v)}>Tôi đã đọc và đồng ý toàn bộ nội dung hợp đồng trên.</CheckRow>

      {/* ---- mã xác nhận (OTP) gửi qua email */}
      <View style={st.otpBox}>
        <View style={st.otpHead}>
          <Ionicons name="shield-checkmark-outline" size={18} color={C.brand700} />
          <Text style={st.otpTitle}>Mã xác nhận</Text>
        </View>
        {otpInfo && <Muted>Đã gửi tới {otpInfo.sentTo}{otpInfo.expiresAt ? ` · hết hạn ${fmtDateTime(otpInfo.expiresAt)}` : ''}</Muted>}
        {otpInfo?.demoCode ? <Text style={st.demo}>Mã thử nghiệm: {otpInfo.demoCode}</Text> : null}
        {otpInfo && (
          <Input
            value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" maxLength={6} placeholder="6 số" textContentType="oneTimeCode" autoComplete="one-time-code"
            style={st.otpInput}
          />
        )}
        <Button
          title={waitS > 0 ? `Gửi lại mã sau ${waitS}s` : otpInfo ? 'Gửi lại mã' : 'Gửi mã xác nhận'}
          variant="secondary" icon="mail-outline" loading={sending} disabled={waitS > 0}
          onPress={() => void sendOtp()}
        />
      </View>

      <Button title="Ký & xác nhận hợp đồng" icon="create-outline" size="lg" style={{ marginTop: S.md }} disabled={!valid} loading={signing} onPress={() => void submit()} />
    </Card>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  title: { fontSize: 15, fontWeight: '700', color: C.ink },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.md, minHeight: TOUCH, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.brand50 },
  toggleText: { flex: 1, color: C.brand700, fontWeight: '700', fontSize: 14 },
  doc: { backgroundColor: C.bg, borderRadius: R.md, padding: S.md, gap: 4, marginTop: S.sm, borderWidth: 1, borderColor: C.lineSoft },
  h: { fontSize: 13, fontWeight: '700', color: C.ink, marginTop: S.sm },
  p: { fontSize: 13, color: C.text, lineHeight: 19 },
  link: { color: C.brand700, fontWeight: '700', marginTop: S.sm, textDecorationLine: 'underline' },
  stepLabel: { fontSize: 13, fontWeight: '600', color: C.sub, marginTop: S.lg, marginBottom: S.sm },
  otpBox: { marginTop: S.md, gap: S.sm, backgroundColor: C.bg, borderRadius: R.md, padding: S.md, borderWidth: 1, borderColor: C.lineSoft },
  otpHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  otpTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  otpInput: { fontSize: 22, fontWeight: '800', letterSpacing: 8, textAlign: 'center', fontFamily: MONO },
  demo: { fontSize: 13, fontWeight: '700', color: C.violet },
  sigImg: { width: '100%', height: 70, marginTop: S.md, backgroundColor: C.white, borderRadius: R.md },
});
