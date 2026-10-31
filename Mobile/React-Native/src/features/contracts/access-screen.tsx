import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AccessMethod, AccessRequestType } from '@ssm/shared';
import { ACCESS_METHOD, ACCESS_REQUEST_STATUS, ACCESS_REQUEST_TYPE, MAX_AUTHORIZED_PERSONS, accessFeeOf, fmtDate, fmtDateTime, isValidPhone, vnd } from '@ssm/shared';
import { api } from '../../shared/api/client';
import { byId, facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Avatar, Button, Callout, Card, Chip, Chips, Disclosure, EmptyState, Field, IconTile, Input, Muted, Screen, ScreenHeader, SectionHeader, Skeleton, StatusBadge } from '../../shared/ui';
import { C, MONO, R, S, SHADOW, T } from '../../shared/ui/theme';
import { payHref } from '../payments/pay-intent';

const TYPE_BY_METHOD: Record<AccessMethod, AccessRequestType> = { PIN: 'PIN_RESET', RFID_CARD: 'CARD_REISSUE', PHYSICAL_KEY: 'KEY_REISSUE' };
const REASONS: Record<AccessRequestType, string[]> = {
  PIN_RESET: ['Quên mật khẩu', 'Nghi lộ mật khẩu', 'Khác'],
  CARD_REISSUE: ['Làm mất thẻ', 'Thẻ hỏng', 'Khác'],
  KEY_REISSUE: ['Làm mất chìa', 'Chìa hỏng', 'Khác'],
};
const ICON: Record<AccessMethod, keyof typeof Ionicons.glyphMap> = { PIN: 'keypad-outline', RFID_CARD: 'card-outline', PHYSICAL_KEY: 'key-outline' };

interface AccessInfo { method: AccessMethod; keyTag: string | null; suspended: boolean; pin: string | null; reason: 'NOT_STORED' | 'SUSPENDED' | 'NOT_PIN' | 'ENDED' | null }

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

  const opens = [...(c.access.assistedOpens ?? [])].reverse();
  // Phí đã hoàn: chuyển khoản còn chờ KhoAn chuyển → "đang chuyển hoàn"; chỉ ghi "đã hoàn" khi khoản hoàn đã xong.
  const refundText = (id?: string | null) => {
    const p = id ? db.payments.find((x) => x._id === id) : undefined;
    if (!p) return '';
    return p.status === 'PENDING' ? ' — đang chuyển hoàn (chuyển khoản, chờ KhoAn chuyển)' : p.status === 'SUCCEEDED' ? ' — đã hoàn' : '';
  };

  return (
    <Screen>
      <ScreenHeader icon={ICON[c.access.method]} title="Mã vào kho" subtitle={`Kho ${unitLabel(db, c.unitId)} · ${facilityName(db, c.facilityId)}`} />

      {/* ---- phương tiện hiện tại: thẻ "chìa khoá số" nền đậm ---- */}
      <View style={st.keyCard}>
        <View style={st.head}>
          <View style={st.keyIcon}><Ionicons name={ICON[c.access.method]} size={22} color={C.white} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.keyTitle}>{c.access.method === 'PIN' ? 'Mật khẩu ban đầu của ổ khoá' : c.access.method === 'RFID_CARD' ? 'Thẻ khoá' : 'Chìa khoá'}</Text>
            <Text style={st.keySub}>Hình thức khoá: {ACCESS_METHOD[c.access.method]}</Text>
          </View>
          <View style={st.unitTag}><Text style={st.unitTagText}>{unitLabel(db, c.unitId)}</Text></View>
        </View>

        {error ? <Callout tone="red" style={{ marginTop: S.md }}>{error}</Callout> : null}
        {!info && !error ? <View style={{ marginTop: S.lg, gap: S.sm }} accessibilityLabel="Đang tải…"><Skeleton h={56} r={R.md} style={{ opacity: 0.4 }} /></View> : null}

        {info && c.access.method === 'PIN' && (
          <View style={{ marginTop: S.lg }}>
            {info.pin ? (
              <>
                <View style={st.pinBox}>
                  <Text style={st.pin} selectable={reveal}>{reveal ? info.pin.split('').join(' ') : '• • • • • •'}</Text>
                </View>
                <Button title={reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} variant="secondary" icon={reveal ? 'eye-off-outline' : 'eye-outline'} style={{ marginTop: S.md }} onPress={() => setReveal((v) => !v)} />
                <Text style={st.keyNote}>Mật khẩu đặt lúc bàn giao — nên tự đổi trên ổ khoá. Đổi rồi thì app không biết mật khẩu mới.</Text>
              </>
            ) : info.reason === 'SUSPENDED' ? (
              <Text style={st.keyNote}>Quyền vào kho đang bị tạm khoá do công nợ. Thanh toán công nợ để mở lại và xem mật khẩu.</Text>
            ) : info.reason === 'ENDED' ? (
              <Text style={st.keyNote}>Bạn đã bàn giao kho lại cho chi nhánh — không còn mật khẩu vào kho.</Text>
            ) : (
              <Text style={st.keyNote}>Bạn tự đặt mật khẩu trên ổ khoá; app không lưu mật khẩu này.</Text>
            )}
          </View>
        )}

        {info && c.access.method !== 'PIN' && (
          <View style={{ marginTop: S.lg }}>
            <View style={st.tagRow}>
              <Text style={st.keySub}>{c.access.method === 'RFID_CARD' ? 'Số thẻ' : 'Mã chìa'}</Text>
              <Text style={st.tag}>{info.keyTag ?? 'Chưa ghi nhận'}</Text>
            </View>
            {info.suspended && <Text style={st.keyNote}>Quyền vào kho đang bị tạm khoá do công nợ.</Text>}
            {/* Đợt 16 (B2): chi nhánh khoá thẻ cũ (trong giờ làm việc) rồi xác nhận — trước đó "đang khoá", sau đó "đã bị khoá lúc …". */}
            {c.access.lostReportedAt && (c.access.lostBlockedAt ? (
              <Callout tone="green" icon="shield-checkmark-outline" style={{ marginTop: S.md }}>
                {c.access.method === 'RFID_CARD' ? 'Thẻ' : 'Chìa'} cũ đã bị khoá lúc {fmtDateTime(c.access.lostBlockedAt)} — không ai dùng được nữa.
              </Callout>
            ) : (
              <Callout tone="amber" icon="shield-outline" style={{ marginTop: S.md }}>
                Đã báo mất lúc {fmtDateTime(c.access.lostReportedAt)} — chi nhánh đang khoá {c.access.method === 'RFID_CARD' ? 'thẻ' : 'chìa'} cũ (trong giờ làm việc) và sẽ báo lại cho bạn.
              </Callout>
            ))}
          </View>
        )}
      </View>

      <Card style={{ marginTop: S.md }}>
        <View style={st.head}>
          <IconTile icon="help-buoy-outline" tone="blue" />
          <View style={{ flex: 1 }}>
            <Text style={st.title}>{c.access.method === 'PIN' ? 'Quên mật khẩu?' : 'Cần vào kho gấp?'}</Text>
            <Muted style={{ marginTop: 2 } as never}>
              Mang giấy tờ tùy thân tới quầy chi nhánh trong giờ hoạt động — nhân viên {c.access.method === 'PIN' ? 'mở và đặt lại ổ khoá để bạn đặt mật khẩu mới' : 'mở kho giúp bạn'}.
            </Muted>
          </View>
        </View>
        {opens.length === 0 ? <Text style={[T.caption, { marginTop: S.md }]}>Chưa có lần mở hộ nào.</Text> : (
          <Disclosure title={`Lịch sử mở hộ (${opens.length})`} icon="time-outline" style={{ marginTop: S.sm }}>
            {opens.map((o) => (
              <View key={o.at} style={st.openRow}>
                <Text style={st.name}>{fmtDateTime(o.at)}</Text>
                <Muted>{o.forName ? `Mở cho ${o.forName} (được uỷ quyền) · ` : ''}Nhân viên {o.byName} · {o.reason}</Muted>
              </View>
            ))}
          </Disclosure>
        )}
      </Card>

      {/* ---- người được uỷ quyền ---- */}
      <SectionHeader title="Người được uỷ quyền" icon="people-outline" count={(c.authorizedPersons ?? []).length} description={`Được thay bạn ra vào và lấy đồ (tối đa ${MAX_AUTHORIZED_PERSONS} người). Bạn chịu trách nhiệm về việc họ làm tại ô kho.`} />
      <Card>
        {(c.authorizedPersons ?? []).length === 0 ? <Text style={T.small}>Chưa uỷ quyền cho ai.</Text> : (c.authorizedPersons ?? []).map((p, i) => (
          <View key={p._id} style={[st.personRow, i > 0 && st.lineTop]}>
            <Avatar name={p.fullName} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.name}>{p.fullName}</Text>
              <Muted>{p.phone} · giấy tờ •••• {p.idNumberLast4}</Muted>
            </View>
            <Button title="Xoá" variant="ghost" size="sm" icon="trash-outline" onPress={() => void run('removeAuthorizedPerson', { contractId: c._id, personId: p._id }, `Đã xoá uỷ quyền của ${p.fullName}`)} />
          </View>
        ))}
        {c.status !== 'CLOSED' && (c.authorizedPersons ?? []).length < MAX_AUTHORIZED_PERSONS && (
          <Disclosure title="Thêm người được uỷ quyền" icon="person-add-outline" style={{ marginTop: S.sm }}>
            <View style={{ gap: S.xs, marginTop: S.xs }}>
              <Field label="Họ tên"><Input value={person.fullName} onChangeText={(v) => setPerson({ ...person, fullName: v })} autoCapitalize="words" maxLength={100} /></Field>
              <Field label="Số điện thoại"><Input value={person.phone} onChangeText={(v) => setPerson({ ...person, phone: v })} keyboardType="phone-pad" maxLength={15} /></Field>
              <Field label="4 số cuối giấy tờ tùy thân"><Input value={person.idNumberLast4} onChangeText={(v) => setPerson({ ...person, idNumberLast4: v.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" maxLength={4} /></Field>
              <Button
                title="Thêm người được uỷ quyền" icon="person-add-outline" variant="secondary"
                disabled={!(person.fullName.trim().length >= 2 && isValidPhone(person.phone.trim()) && /^\d{4}$/.test(person.idNumberLast4))}
                onPress={() => void run('addAuthorizedPerson', { contractId: c._id, fullName: person.fullName.trim(), phone: person.phone.trim(), idNumberLast4: person.idNumberLast4 }, 'Đã thêm người được uỷ quyền', () => setPerson({ fullName: '', phone: '', idNumberLast4: '' }))}
              />
            </View>
          </Disclosure>
        )}
      </Card>

      {/* ---- xin cấp lại (thẻ / chìa) — ổ khoá mật khẩu thì khách tự đổi trên ổ khoá, không có yêu cầu ---- */}
      {c.access.method !== 'PIN' && (
      <>
        <SectionHeader title={labels.title} icon="refresh-circle-outline" />
        <Card>
          <View style={st.head}>
            <IconTile icon={ICON[c.access.method]} tone="amber" />
            <Text style={[T.small, { flex: 1 }]}>
              Yêu cầu cần <Text style={{ fontWeight: '700', color: C.ink }}>Quản lý chi nhánh xác nhận</Text>
              {type === 'PIN_RESET' ? '. Duyệt xong, mật khẩu mới hiện ngay ở trên.' : `. Duyệt xong, nhân viên chi nhánh sẽ làm và bàn giao ${labels.what} cho bạn tại quầy.`}
            </Text>
          </View>

          {!returned && (
            <>
              <View style={st.feeRow}>
                <Text style={st.feeLabel}>Phí</Text>
                <Chip tone={fee > 0 ? 'amber' : 'green'} icon={fee > 0 ? 'cash-outline' : 'gift-outline'}>{fee > 0 ? vnd(fee) : 'Miễn phí'}</Chip>
              </View>
              {fee > 0 && <Muted>Trả khi gửi yêu cầu; bị từ chối hoặc bạn huỷ trước khi hoàn tất thì được hoàn đủ.</Muted>}
            </>
          )}

          {returned ? (
            <Callout tone="gray" icon="archive-outline" style={{ marginTop: S.md }}>Bạn đã bàn giao kho lại cho chi nhánh ngày {fmtDate(c.access.revokedAt)} — {c.access.method === 'RFID_CARD' ? 'thẻ khoá' : 'chìa khoá'} của ô này đã thu hồi nên không cấp lại nữa.</Callout>
          ) : !requestable ? (
            <Callout tone="amber" icon="lock-closed-outline" style={{ marginTop: S.md }}>Hợp đồng đang bị khoá truy cập hoặc đã kết thúc — hãy liên hệ chi nhánh.</Callout>
          ) : open ? (
            <Callout tone="amber" icon="time-outline" style={{ marginTop: S.md }}>Bạn đang có một yêu cầu chưa xử lý xong ({ACCESS_REQUEST_STATUS[open.status].label}). Xem ở mục bên dưới.</Callout>
          ) : (
            <>
              <View style={{ marginTop: S.md }}>
                <Text style={st.label}>Lý do</Text>
                <Chips options={reasons.map((r) => ({ value: r, label: r }))} value={chosen} onChange={setReason} />
              </View>
              {/* Có phí: yêu cầu chỉ được gửi khi khách trả phí qua cổng thanh toán (giả lập). */}
              <Button
                title={fee > 0 ? `${labels.button} · trả ${vnd(fee)}` : labels.button}
                icon="paper-plane-outline"
                style={{ marginTop: S.lg }}
              onPress={() => (fee > 0
                ? router.push(payHref({
                  target: { kind: 'ACCESS_FEE', contractId: c._id, reason: chosen }, facilityId: c.facilityId, code: c.contractNumber,
                  purpose: `Phí ${labels.title.toLowerCase()}`, amount: fee,
                  doneNote: 'Đã gửi yêu cầu — chờ quản lý chi nhánh xác nhận. Bị từ chối hoặc huỷ thì được hoàn đủ phí.',
                  back: { label: 'Về mã vào kho', href: `/contract/access?contract=${c._id}` },
                }))
                : void run('requestAccess', { contractId: c._id, reason: chosen, expectedFee: 0 }, 'Đã gửi yêu cầu — chờ quản lý chi nhánh xác nhận'))}
              />
            </>
          )}
        </Card>
      </>
      )}

      {/* ---- lịch sử yêu cầu ---- */}
      {(c.access.method !== 'PIN' || requests.length > 0) && <SectionHeader title="Yêu cầu của tôi" icon="list-outline" count={requests.length || undefined} />}
      {c.access.method === 'PIN' && requests.length === 0 ? null : requests.length === 0 ? <Card><EmptyState icon="file-tray-outline" title="Chưa có yêu cầu nào." /></Card> : (
        <View style={{ gap: S.sm }}>
          {requests.map((r) => (
            <Card key={r._id}>
              <View style={st.rowBetween}>
                <Text style={st.name}>{ACCESS_REQUEST_TYPE[r.type].title}</Text>
                <StatusBadge map={ACCESS_REQUEST_STATUS} value={r.status} />
              </View>
              <Muted style={{ marginTop: 2 } as never}>{r.requestNumber} · {fmtDateTime(r.createdAt)}{r.reason ? ` · ${r.reason}` : ''}</Muted>
              {r.fee > 0 && <Muted>Phí {vnd(r.fee)}{refundText(r.refundPaymentId)}</Muted>}
              {r.status === 'REJECTED' && r.decisionNote ? <Text style={st.reject}>Lý do từ chối: {r.decisionNote}</Text> : null}
              {r.status === 'APPROVED' && <Callout tone="green" icon="checkmark-circle-outline" style={{ marginTop: S.sm }}>Đã được duyệt {fmtDate(r.decidedAt)} — đến quầy chi nhánh để nhận {ACCESS_REQUEST_TYPE[r.type].what}.</Callout>}
              {r.status === 'DONE' && r.newKeyTag ? <Text style={st.done}>Số mới: {r.newKeyTag}</Text> : null}
              {(r.status === 'REQUESTED' || r.status === 'APPROVED') && (
                <Button title={r.fee > 0 ? 'Huỷ yêu cầu (hoàn đủ phí)' : 'Huỷ yêu cầu'} variant="ghost" size="sm" icon="close-circle-outline" style={{ marginTop: S.sm }}
                  onPress={() => void run('cancelAccessRequest', { requestId: r._id }, r.fee > 0 ? `Đã huỷ — phí ${vnd(r.fee)} được hoàn theo cách bạn đã trả` : 'Đã huỷ yêu cầu')} />
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  keyCard: { backgroundColor: C.brand900, borderRadius: R.xl, padding: S.lg, ...SHADOW.lift },
  keyIcon: { width: 44, height: 44, borderRadius: R.md, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  keyTitle: { fontSize: 16, fontWeight: '700', color: C.white },
  keySub: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  keyNote: { fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.8)', marginTop: S.md },
  unitTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.full, backgroundColor: 'rgba(255,255,255,0.14)' },
  unitTagText: { color: C.white, fontWeight: '800', fontSize: 12 },
  title: { fontSize: 16, fontWeight: '700', color: C.ink },
  label: { fontSize: 13, fontWeight: '600', color: C.sub, marginBottom: S.sm },
  pinBox: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: R.lg, paddingVertical: S.xl, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  pin: { fontSize: 32, fontWeight: '800', color: C.white, letterSpacing: 3, fontFamily: MONO, fontVariant: ['tabular-nums'] },
  tagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: R.md, padding: S.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  tag: { fontSize: 18, fontWeight: '800', color: C.white, fontFamily: MONO },
  feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.md, marginBottom: S.xs },
  feeLabel: { fontSize: 14, color: C.muted },
  openRow: { paddingTop: S.sm, gap: 2 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  lineTop: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  name: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  reject: { marginTop: 4, fontSize: 13, color: C.red },
  done: { marginTop: 4, fontSize: 13, fontWeight: '700', color: C.green },
});
