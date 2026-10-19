import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContractClause, Reservation, SignatureMethod } from '@ssm/shared';
import { fmtDateTime } from '@ssm/shared';
import { api } from '../../shared/api/client';
import { useStore } from '../../shared/store/store';
import { Badge, Button, Card, Chips, Field, Input, Muted } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';
import { SignaturePad, canDrawSignature, type SignaturePadHandle } from './signature-pad';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';
const METHODS: { value: SignatureMethod; label: string }[] = [{ value: 'DRAWN', label: 'Ký tay' }, { value: 'TYPED', label: 'Gõ họ tên' }];

/**
 * Bước ký hợp đồng sau khi trả tiền giữ chân, trước khi nhận kho: đọc nội dung hợp đồng rồi ký tay (hoặc gõ họ tên)
 * và đồng ý. Ký xong, server tự gửi PDF hợp đồng đã ký tới email của khách; có nút gửi lại.
 */
export function ContractSignCard({ reservation: r }: { reservation: Reservation }) {
  const { user, run, toast } = useStore();
  const [name, setName] = useState(user?.fullName ?? '');
  const [agree, setAgree] = useState(false);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<SignatureMethod>(canDrawSignature ? 'DRAWN' : 'TYPED');
  const [hasInk, setHasInk] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);
  // Nội dung hợp đồng do SERVER dựng từ mẫu đang áp dụng (cùng nguồn với web và PDF) — không tự ghép ở app.
  const [clauses, setClauses] = useState<ContractClause[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const signed = !!r.signature;
  useEffect(() => {
    if (signed) return;
    let alive = true;
    api.get<{ clauses: ContractClause[] }>(`/reservations/${r._id}/contract`)
      .then((v) => { if (alive) { setClauses(v.clauses); setLoadError(''); } })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => { alive = false; };
  }, [r._id, signed]);

  if (r.signature) {
    const s = r.signature;
    return (
      <Card style={{ marginTop: S.md, backgroundColor: C.greenBg, borderColor: C.green }}>
        <Text style={{ color: C.green, fontWeight: '700' }}>Đã ký hợp đồng — {s.signerName}</Text>
        <Muted style={{ marginTop: 2 } as never}>{fmtDateTime(s.signedAt)} · {s.method === 'DRAWN' ? 'ký tay' : 'ký bằng họ tên'}{s.onBehalf ? ' · nhân viên thao tác tại quầy' : ''}</Muted>
        {s.image ? <Image source={{ uri: s.image }} resizeMode="contain" style={st.sigImg} /> : null}
        <Muted style={{ marginTop: S.sm } as never}>{s.emailedAt ? `Đã gửi PDF hợp đồng tới ${s.emailedTo ?? 'email của bạn'} lúc ${fmtDateTime(s.emailedAt)}.` : 'PDF hợp đồng chưa được gửi qua email.'}</Muted>
        <Button title="Gửi lại PDF qua email" variant="secondary" icon="mail-outline" style={{ marginTop: S.sm }}
          onPress={() => void run('emailContract', { reservationId: r._id }, (v) => `Đã gửi PDF tới ${v.to}`)} />
      </Card>
    );
  }

  // Chưa tải được nội dung hợp đồng thì chưa cho ký — khách phải đọc được thứ mình ký.
  const valid = name.trim().length >= 2 && agree && (method === 'TYPED' || hasInk) && !!clauses;

  const submit = async () => {
    let image: string | null = null;
    if (method === 'DRAWN') {
      image = (await pad.current?.exportPng()) ?? null;
      if (!image) { toast('Không xuất được chữ ký tay — hãy gõ họ tên để ký', 'error'); setMethod('TYPED'); return; }
    }
    void run('signContract', { reservationId: r._id, signerName: name.trim(), method, image }, 'Đã ký hợp đồng — PDF được gửi tới email của bạn');
  };

  return (
    <Card style={{ marginTop: S.md }}>
      <View style={st.rowBetween}>
        <Text style={st.title}>Bước 2 — Ký hợp đồng</Text>
        <Badge tone="amber">Chưa ký</Badge>
      </View>
      <Muted style={{ marginTop: 4 } as never}>Cần ký trước khi nhận kho. Nhân viên sẽ không bàn giao kho nếu chưa ký.</Muted>

      <Pressable onPress={() => setOpen((v) => !v)} style={st.toggle}>
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

      {canDrawSignature && (
        <View style={{ marginTop: S.md }}>
          <Chips options={METHODS} value={method} onChange={setMethod} columns={2} />
        </View>
      )}
      {method === 'DRAWN' && <View style={{ marginTop: S.md }}><SignaturePad ref={pad} onInkChange={setHasInk} /></View>}

      <View style={{ marginTop: S.md }}>
        <Field label={method === 'DRAWN' ? 'Họ tên người ký' : 'Gõ đầy đủ họ tên để ký'} hint={method === 'TYPED' ? 'Họ tên gõ vào có giá trị như chữ ký xác nhận hợp đồng.' : undefined}>
          <Input value={name} onChangeText={setName} autoCapitalize="words" />
        </Field>
      </View>
      <Pressable onPress={() => setAgree((v) => !v)} style={st.consent}>
        <Ionicons name={agree ? 'checkbox' : 'square-outline'} size={22} color={agree ? C.brand700 : C.faint} />
        <Text style={st.consentText}>Tôi đã đọc và đồng ý toàn bộ nội dung hợp đồng trên.</Text>
      </Pressable>
      <Button title="Ký & xác nhận hợp đồng" icon="create-outline" style={{ marginTop: S.md }} disabled={!valid} onPress={() => void submit()} />
    </Card>
  );
}

const st = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  title: { fontSize: 15, fontWeight: '700', color: C.ink },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.md, paddingVertical: S.sm },
  toggleText: { color: C.brand700, fontWeight: '600', fontSize: 14 },
  doc: { backgroundColor: C.bg, borderRadius: R.md, padding: S.md, gap: 4 },
  h: { fontSize: 13, fontWeight: '700', color: C.ink, marginTop: S.sm },
  p: { fontSize: 13, color: C.text, lineHeight: 19 },
  link: { color: C.brand700, fontWeight: '600', marginTop: S.sm },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm },
  consentText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },
  sigImg: { width: '100%', height: 70, marginTop: S.sm, backgroundColor: '#fff', borderRadius: R.md },
});
