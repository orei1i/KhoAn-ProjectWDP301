import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AccessMethod, AccessRequestType, PaymentMethod } from '@ssm/shared';
import { ACCESS_METHOD, ACCESS_REQUEST_STATUS, ACCESS_REQUEST_TYPE, MAX_AUTHORIZED_PERSONS, PAYMENT_METHOD, accessFeeOf, fmtDate, fmtDateTime, isValidPhone, vnd } from '@ssm/shared';
import { api } from '../../shared/api/client';
import { byId, facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, Chips, EmptyState, Field, Input, Muted, Screen, ScreenHeader, StatusBadge } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

const METHODS: { value: PaymentMethod; label: string }[] = (['VNPAY', 'MOMO', 'CARD', 'BANK_TRANSFER'] as PaymentMethod[])
  .map((v) => ({ value: v, label: PAYMENT_METHOD[v] }));

const TYPE_BY_METHOD: Record<AccessMethod, AccessRequestType> = { PIN: 'PIN_RESET', RFID_CARD: 'CARD_REISSUE', PHYSICAL_KEY: 'KEY_REISSUE' };
const REASONS: Record<AccessRequestType, string[]> = {
  PIN_RESET: ['Quên mật khẩu', 'Nghi lộ mật khẩu', 'Khác'],
  CARD_REISSUE: ['Làm mất thẻ', 'Thẻ hỏng', 'Khác'],
  KEY_REISSUE: ['Làm mất chìa', 'Chìa hỏng', 'Khác'],
};
const ICON: Record<AccessMethod, keyof typeof Ionicons.glyphMap> = { PIN: 'keypad-outline', RFID_CARD: 'card-outline', PHYSICAL_KEY: 'key-outline' };

interface AccessInfo { method: AccessMethod; keyTag: string | null; suspended: boolean; pin: string | null; reason: 'NOT_STORED' | 'SUSPENDED' | 'NOT_PIN' | null }

/**
 * Phương tiện vào kho của khách: xem mật khẩu (nếu khoá mật khẩu), số thẻ / mã chìa, và xin cấp lại khi quên/mất.
 * Mọi yêu cầu cấp lại cần Quản lý chi nhánh xác nhận; làm lại thẻ có phí (trả khi gửi, hoàn đủ nếu bị từ chối/huỷ).
 */
export default function AccessScreen() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { db, run } = useStore();
  const router = useRouter();
  const c = byId(db.contracts, contract);
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('VNPAY');
  // Form thêm người được uỷ quyền ra vào kho.
  const [person, setPerson] = useState({ fullName: '', phone: '', idNumberLast4: '' });

  const requests = db.accessRequests.filter((r) => r.contractId === c?._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestKey = requests[0] ? `${requests[0]._id}:${requests[0].status}` : '';

  // Tải lại khi có yêu cầu đổi trạng thái (VD vừa được duyệt → có mật khẩu mới).
  const load = useCallback(async () => {
    if (!c) return;
    try { setInfo(await api.get<AccessInfo>(`/contracts/${c._id}/access`)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không tải được thông tin vào kho'); }
  }, [c?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, latestKey]);
  // Tự ẩn mật khẩu sau 20 giây — đề phòng người khác nhìn qua vai.
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setReveal(false), 20_000);
    return () => clearTimeout(t);
  }, [reveal]);

  if (!c) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Không tìm thấy hợp đồng" action={<Button title="Quay lại" variant="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const type = TYPE_BY_METHOD[c.access.method];
  const labels = ACCESS_REQUEST_TYPE[type];
  const active = db.policies.filter((p) => p.isActive);
  const policy = active.find((p) => p.facilityId === c.facilityId) ?? active.find((p) => p.scope === 'GLOBAL');
  const fee = accessFeeOf(policy ?? {}, type);
  const open = requests.find((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
  // Đã bàn giao kho (thu hồi quyền vào kho) thì BE từ chối cấp lại (ALREADY_RETURNED) — ẩn form, nói rõ lý do.
  const returned = !!c.access.revokedAt;
  const requestable = !returned && ['ACTIVE', 'DELINQUENT', 'MOVE_OUT_PENDING'].includes(c.status);
  const reasons = REASONS[type];
  const chosen = reason ?? reasons[0];

  return (
    <Screen>
      <ScreenHeader title="Mã vào kho" subtitle={`Kho ${unitLabel(db, c.unitId)} · ${facilityName(db, c.facilityId)}`} />

      {/* ---- phương tiện hiện tại ---- */}
      <Card>
        <View style={st.head}>
          <View style={st.iconBox}><Ionicons name={ICON[c.access.method]} size={22} color={C.brand700} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.title}>{c.access.method === 'PIN' ? 'Mật khẩu ban đầu của ổ khoá' : c.access.method === 'RFID_CARD' ? 'Thẻ khoá' : 'Chìa khoá'}</Text>
            <Muted>Hình thức khoá: {ACCESS_METHOD[c.access.method]}</Muted>
          </View>
        </View>

        {error ? <Muted style={{ marginTop: S.md, color: C.red } as never}>{error}</Muted> : null}
        {!info && !error ? <Muted style={{ marginTop: S.md } as never}>Đang tải…</Muted> : null}

        {info && c.access.method === 'PIN' && (
          <View style={{ marginTop: S.md }}>
            {info.pin ? (
              <>
                <View style={st.pinBox}>
                  <Text style={st.pin} selectable={reveal}>{reveal ? info.pin.split('').join(' ') : '• • • • • •'}</Text>
                </View>
                <Button title={reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} variant="secondary" icon={reveal ? 'eye-off-outline' : 'eye-outline'} style={{ marginTop: S.sm }} onPress={() => setReveal((v) => !v)} />
                <Muted style={{ marginTop: S.sm } as never}>Đây là mật khẩu nhân viên đặt lúc bàn giao kho (tự ẩn sau 20 giây). Ổ khoá là khoá số vật lý: bạn tự đổi mật khẩu ngay trên ổ khoá và nên đổi sau lần mở đầu tiên. Sau khi bạn đổi, ứng dụng không biết mật khẩu mới — hãy tự ghi nhớ.</Muted>
              </>
            ) : info.reason === 'SUSPENDED' ? (
              <Muted>Quyền vào kho đang bị tạm khoá do công nợ. Thanh toán công nợ để mở lại và xem mật khẩu.</Muted>
            ) : (
              <Muted>Ổ khoá là khoá số vật lý, bạn tự đặt và đổi mật khẩu ngay trên ổ khoá; ứng dụng không lưu mật khẩu của ô này.</Muted>
            )}
          </View>
        )}

        {info && c.access.method !== 'PIN' && (
          <View style={{ marginTop: S.md }}>
            <View style={st.tagRow}>
              <Muted>{c.access.method === 'RFID_CARD' ? 'Số thẻ' : 'Mã chìa'}</Muted>
              <Text style={st.tag}>{info.keyTag ?? 'Chưa ghi nhận'}</Text>
            </View>
            {info.suspended && <Muted style={{ marginTop: S.sm } as never}>Quyền vào kho đang bị tạm khoá do công nợ.</Muted>}
            {c.access.lostReportedAt && (
              <View style={[st.notice, { backgroundColor: C.amberBg }]}>
                <Ionicons name="shield-outline" size={16} color={C.amber} />
                <Text style={{ flex: 1, fontSize: 13, color: C.amber }}>
                  Bạn đã báo mất lúc {fmtDateTime(c.access.lostReportedAt)}{c.access.method === 'RFID_CARD' ? ' — thẻ cũ đã bị khoá, không ai dùng được nữa.' : '.'}
                </Text>
              </View>
            )}
          </View>
        )}
      </Card>

      {(
        <Card style={{ marginTop: S.md }}>
          <Text style={st.title}>{c.access.method === 'PIN' ? 'Quên mật khẩu?' : 'Cần vào kho gấp?'}</Text>
          <Muted style={{ marginTop: 2 } as never}>
            Đến quầy chi nhánh trong giờ hoạt động, mang giấy tờ tùy thân. Nhân viên xác minh danh tính rồi {c.access.method === 'PIN' ? 'mở và đặt lại ổ khoá để bạn tự đặt mật khẩu mới' : `mở kho giúp bạn bằng ${c.access.method === 'RFID_CARD' ? 'thẻ tổng' : 'chìa tổng'} của chi nhánh`} — bạn có mặt khi mở, nhân viên không vào trong ô kho. Mỗi lần mở hộ đều được ghi lại bên dưới.
          </Muted>
          {(c.access.assistedOpens ?? []).length === 0 ? <Muted style={{ marginTop: S.sm } as never}>Chưa có lần mở hộ nào.</Muted> : [...(c.access.assistedOpens ?? [])].reverse().map((o) => (
            <View key={o.at} style={st.openRow}>
              <Text style={st.name}>{fmtDateTime(o.at)}</Text>
              <Muted>{o.forName ? `Mở cho ${o.forName} (được uỷ quyền) · ` : ''}Nhân viên {o.byName} · {o.reason}</Muted>
            </View>
          ))}
        </Card>
      )}

      {/* ---- người được uỷ quyền ---- */}
      <Card style={{ marginTop: S.md }}>
        <Text style={st.title}>Người được uỷ quyền</Text>
        <Muted style={{ marginTop: 2 } as never}>
          Người có tên dưới đây được thay bạn ra vào và lấy đồ (tối đa {MAX_AUTHORIZED_PERSONS}). Nhân viên đối chiếu họ tên và 4 số cuối giấy tờ tùy thân khi họ đến chi nhánh. Bạn chịu trách nhiệm về việc họ làm tại ô kho.
        </Muted>
        {(c.authorizedPersons ?? []).length === 0 ? <Muted style={{ marginTop: S.sm } as never}>Chưa uỷ quyền cho ai.</Muted> : (c.authorizedPersons ?? []).map((p) => (
          <View key={p._id} style={[st.openRow, st.rowBetween]}>
            <View style={{ flex: 1 }}>
              <Text style={st.name}>{p.fullName}</Text>
              <Muted>{p.phone} · giấy tờ •••• {p.idNumberLast4}</Muted>
            </View>
            <Button title="Xoá" variant="ghost" onPress={() => void run('removeAuthorizedPerson', { contractId: c._id, personId: p._id }, `Đã xoá uỷ quyền của ${p.fullName}`)} />
          </View>
        ))}
        {c.status !== 'CLOSED' && (c.authorizedPersons ?? []).length < MAX_AUTHORIZED_PERSONS && (
          <View style={{ marginTop: S.md, gap: S.sm }}>
            <Field label="Họ tên"><Input value={person.fullName} onChangeText={(v) => setPerson({ ...person, fullName: v })} autoCapitalize="words" maxLength={100} /></Field>
            <Field label="Số điện thoại"><Input value={person.phone} onChangeText={(v) => setPerson({ ...person, phone: v })} keyboardType="phone-pad" maxLength={15} /></Field>
            <Field label="4 số cuối giấy tờ tùy thân"><Input value={person.idNumberLast4} onChangeText={(v) => setPerson({ ...person, idNumberLast4: v.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" maxLength={4} /></Field>
            <Button
              title="Thêm người được uỷ quyền" icon="person-add-outline" variant="secondary"
              disabled={!(person.fullName.trim().length >= 2 && isValidPhone(person.phone.trim()) && /^\d{4}$/.test(person.idNumberLast4))}
              onPress={() => void run('addAuthorizedPerson', { contractId: c._id, fullName: person.fullName.trim(), phone: person.phone.trim(), idNumberLast4: person.idNumberLast4 }, 'Đã thêm người được uỷ quyền', () => setPerson({ fullName: '', phone: '', idNumberLast4: '' }))}
            />
          </View>
        )}
      </Card>

      {/* ---- xin cấp lại (thẻ / chìa) — ổ khoá mật khẩu thì khách tự đổi trên ổ khoá, không có yêu cầu ---- */}
      {c.access.method !== 'PIN' && (
      <Card style={{ marginTop: S.md }}>
        <Text style={st.title}>{labels.title}</Text>
        <Muted style={{ marginTop: 2 } as never}>
          Yêu cầu cần <Text style={{ fontWeight: '700' }}>Quản lý chi nhánh xác nhận</Text>
          {type === 'PIN_RESET' ? '. Duyệt xong, mật khẩu mới hiện ngay ở trên.' : `. Duyệt xong, nhân viên chi nhánh sẽ làm và bàn giao ${labels.what} cho bạn tại quầy.`}
        </Muted>

        {!returned && (
          <>
            <View style={st.feeRow}>
              <Text style={st.feeLabel}>Phí</Text>
              <Text style={[st.fee, fee === 0 && { color: C.green }]}>{fee > 0 ? vnd(fee) : 'Miễn phí'}</Text>
            </View>
            {fee > 0 && <Muted>Trả khi gửi yêu cầu; bị từ chối hoặc bạn huỷ trước khi hoàn tất thì được hoàn đủ.</Muted>}
          </>
        )}

        {returned ? (
          <Muted style={{ marginTop: S.md } as never}>Bạn đã bàn giao kho lại cho chi nhánh ngày {fmtDate(c.access.revokedAt)} — {c.access.method === 'RFID_CARD' ? 'thẻ khoá' : 'chìa khoá'} của ô này đã thu hồi nên không cấp lại nữa.</Muted>
        ) : !requestable ? (
          <Muted style={{ marginTop: S.md } as never}>Hợp đồng đang bị khoá truy cập hoặc đã kết thúc — hãy liên hệ chi nhánh.</Muted>
        ) : open ? (
          <View style={[st.notice, { backgroundColor: C.amberBg }]}>
            <Ionicons name="time-outline" size={16} color={C.amber} />
            <Text style={{ flex: 1, fontSize: 13, color: C.amber }}>Bạn đang có một yêu cầu chưa xử lý xong ({ACCESS_REQUEST_STATUS[open.status].label}). Xem ở mục bên dưới.</Text>
          </View>
        ) : (
          <>
            <View style={{ marginTop: S.md }}>
              <Muted>Lý do</Muted>
              <View style={{ marginTop: S.sm }}>
                <Chips options={reasons.map((r) => ({ value: r, label: r }))} value={chosen} onChange={setReason} />
              </View>
            </View>
            {fee > 0 && (
              <View style={{ marginTop: S.md }}>
                <Muted>Hình thức thanh toán phí</Muted>
                <View style={{ marginTop: S.sm }}><Chips options={METHODS} value={method} onChange={setMethod} /></View>
              </View>
            )}
            <Button
              title={fee > 0 ? `${labels.button} · trả ${vnd(fee)}` : labels.button}
              icon="paper-plane-outline"
              style={{ marginTop: S.lg }}
              onPress={() => void run('requestAccess', { contractId: c._id, reason: chosen, method: fee > 0 ? method : undefined }, 'Đã gửi yêu cầu — chờ quản lý chi nhánh xác nhận')}
            />
          </>
        )}
      </Card>
      )}

      {/* ---- lịch sử yêu cầu ---- */}
      {(c.access.method !== 'PIN' || requests.length > 0) && <Text style={st.section}>Yêu cầu của tôi</Text>}
      {c.access.method === 'PIN' && requests.length === 0 ? null : requests.length === 0 ? <Card><Muted>Chưa có yêu cầu nào.</Muted></Card> : requests.map((r) => (
        <Card key={r._id} style={{ marginTop: S.sm }}>
          <View style={st.rowBetween}>
            <Text style={st.name}>{ACCESS_REQUEST_TYPE[r.type].title}</Text>
            <StatusBadge map={ACCESS_REQUEST_STATUS} value={r.status} />
          </View>
          <Muted style={{ marginTop: 2 } as never}>{r.requestNumber} · {fmtDateTime(r.createdAt)}{r.reason ? ` · ${r.reason}` : ''}</Muted>
          {r.fee > 0 && <Muted>Phí {vnd(r.fee)}{r.status === 'REJECTED' || r.status === 'CANCELLED' ? ' — đã hoàn đủ' : ''}</Muted>}
          {r.status === 'REJECTED' && r.decisionNote ? <Text style={st.reject}>Lý do từ chối: {r.decisionNote}</Text> : null}
          {r.status === 'APPROVED' && <Muted style={{ marginTop: 2 } as never}>Đã được duyệt {fmtDate(r.decidedAt)} — đến quầy chi nhánh để nhận {ACCESS_REQUEST_TYPE[r.type].what}.</Muted>}
          {r.status === 'DONE' && r.newKeyTag ? <Text style={st.done}>Số mới: {r.newKeyTag}</Text> : null}
          {(r.status === 'REQUESTED' || r.status === 'APPROVED') && (
            <Button title={r.fee > 0 ? 'Huỷ yêu cầu (hoàn đủ phí)' : 'Huỷ yêu cầu'} variant="ghost" style={{ marginTop: S.sm }}
              onPress={() => void run('cancelAccessRequest', { requestId: r._id }, r.fee > 0 ? `Đã huỷ — hoàn ${vnd(r.fee)}` : 'Đã huỷ yêu cầu')} />
          )}
        </Card>
      ))}
    </Screen>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  iconBox: { width: 44, height: 44, borderRadius: R.md, backgroundColor: C.brand50, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: C.ink },
  pinBox: { backgroundColor: C.bg, borderRadius: R.md, paddingVertical: S.lg, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  pin: { fontSize: 30, fontWeight: '800', color: C.ink, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  tagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.bg, borderRadius: R.md, padding: S.md, borderWidth: 1, borderColor: C.line },
  tag: { fontSize: 16, fontWeight: '800', color: C.ink },
  feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.md, marginBottom: 2 },
  feeLabel: { fontSize: 14, color: C.muted },
  fee: { fontSize: 16, fontWeight: '800', color: C.ink },
  openRow: { marginTop: S.sm, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line },
  notice: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', padding: S.md, borderRadius: R.md, marginTop: S.md },
  section: { fontSize: 16, fontWeight: '700', color: C.ink, marginTop: S.xl },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  name: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  reject: { marginTop: 4, fontSize: 13, color: C.red },
  done: { marginTop: 4, fontSize: 13, fontWeight: '700', color: C.green },
});
