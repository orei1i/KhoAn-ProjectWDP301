import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  ID_LAST4_MESSAGE, ID_LAST4_RE, ID_TYPE_LABEL, ID_TYPES, PERSON_NAME_MESSAGE, PROFILE_PHONE_MESSAGE, isValidPersonName, isValidProfilePhone,
  identityLocked, profileGaps, type IdType,
} from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Button, Card, Chips, Field, Input, KV, Muted } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

type Form = { fullName: string; phone: string; idType: IdType; idNumberLast4: string; bankName: string; accountNumber: string; accountName: string };
const ID_OPTIONS = ID_TYPES.map((t) => ({ value: t, label: ID_TYPE_LABEL[t] }));

/**
 * Thông tin nhận diện in vào hợp đồng (PATCH /auth/me): họ tên, số điện thoại, loại giấy tờ + 4 số cuối (không bao giờ hỏi số đầy đủ).
 * Thiếu thì thẻ chuyển sang màu cảnh báo và mở sẵn ô sửa — đặt kho / ký / gia hạn bị chặn cho tới khi đủ.
 */
export function ProfileCard() {
  const { user, db, run } = useStore();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const gaps = profileGaps(user);
  // Đang có hợp đồng: họ tên + giấy tờ đã in vào hợp đồng → đổi tại quầy (khai lần đầu thì vẫn cho) — khớp quy tắc ở BE.
  const live = identityLocked(user._id, db.reservations, db.contracts);
  const nameLocked = live && isValidPersonName(user.fullName);
  const idLocked = live && !!user.customerProfile?.idNumberLast4;
  const acc = user.customerProfile?.payoutAccount;
  const editing = form !== null || gaps.length > 0;
  const f: Form = form ?? {
    fullName: isValidPersonName(user.fullName) ? user.fullName : '', phone: user.phone ?? '',
    idType: user.customerProfile?.idType ?? 'CCCD', idNumberLast4: user.customerProfile?.idNumberLast4 ?? '',
    bankName: acc?.bankName ?? '', accountNumber: acc?.accountNumber ?? '', accountName: acc?.accountName ?? '',
  };
  const set = (p: Partial<Form>) => setForm({ ...f, ...p });
  const accFilled = !!(f.bankName.trim() || f.accountNumber.trim() || f.accountName.trim());
  const accValid = !accFilled || (f.bankName.trim().length >= 2 && /^\d{6,20}$/.test(f.accountNumber.trim()) && f.accountName.trim().length >= 2);
  const valid = isValidPersonName(f.fullName) && isValidProfilePhone(f.phone) && ID_LAST4_RE.test(f.idNumberLast4.trim()) && accValid;
  const save = async () => {
    setBusy(true);
    const r = await run('updateMyProfile', {
      ...(nameLocked ? {} : { fullName: f.fullName }), phone: f.phone,
      ...(idLocked ? {} : { idType: f.idType, idNumberLast4: f.idNumberLast4.trim() }),
      payoutAccount: accFilled ? { bankName: f.bankName.trim(), accountNumber: f.accountNumber.trim(), accountName: f.accountName.trim() } : null,
    }, 'Đã cập nhật thông tin cá nhân');
    setBusy(false);
    if (r.ok) setForm(null);
  };
  const err = (show: boolean, msg: string) => (form && show ? <Text style={{ color: C.red, fontSize: 12, marginTop: 4 }}>{msg}</Text> : null);

  return (
    <Card style={[{ marginTop: S.md }, gaps.length > 0 && { backgroundColor: C.amberBg, borderColor: '#fde68a' }]}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: C.ink }}>Thông tin cá nhân</Text>
      <Muted style={{ marginTop: 4 } as never}>
        {gaps.length ? `Còn thiếu ${gaps.join(', ')} — bổ sung để đặt kho, ký và gia hạn hợp đồng.` : 'In vào hợp đồng và phụ lục bạn ký. Nhân viên đối chiếu giấy tờ bản gốc khi bàn giao kho; KhoAn chỉ lưu 4 số cuối.'}
      </Muted>
      {editing ? (
        <View style={{ marginTop: S.md, gap: S.sm }}>
          {(nameLocked || idLocked) && <Muted>Bạn đang có hợp đồng nên họ tên và giấy tờ không tự sửa được — mang giấy tờ bản gốc tới quầy chi nhánh.</Muted>}
          <Field label="Họ và tên (đúng như trên giấy tờ)">
            <Input editable={!nameLocked} value={f.fullName} onChangeText={(v) => set({ fullName: v })} placeholder="Nguyễn Minh Anh" autoCapitalize="words" textContentType="name" maxLength={100} />
            {err(!isValidPersonName(f.fullName), PERSON_NAME_MESSAGE)}
          </Field>
          <Field label="Số điện thoại">
            <Input value={f.phone} onChangeText={(v) => set({ phone: v })} placeholder="0901 234 567" keyboardType="phone-pad" textContentType="telephoneNumber" maxLength={30} />
            {err(!!f.phone.trim() && !isValidProfilePhone(f.phone), PROFILE_PHONE_MESSAGE)}
          </Field>
          <Field label="Loại giấy tờ tùy thân">
            <Chips options={ID_OPTIONS} value={f.idType} onChange={(v) => { if (!idLocked) set({ idType: v }); }} columns={2} />
          </Field>
          <Field label="4 số cuối của giấy tờ">
            <Input editable={!idLocked} value={f.idNumberLast4} onChangeText={(v) => set({ idNumberLast4: v })} placeholder="4821" autoCapitalize="characters" maxLength={4} />
            {err(!!f.idNumberLast4.trim() && !ID_LAST4_RE.test(f.idNumberLast4.trim()), ID_LAST4_MESSAGE)}
          </Field>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.ink, marginTop: S.sm }}>Tài khoản nhận tiền hoàn (tuỳ chọn)</Text>
          <Field label="Ngân hàng"><Input value={f.bankName} onChangeText={(v) => set({ bankName: v })} placeholder="Vietcombank" maxLength={80} /></Field>
          <Field label="Số tài khoản"><Input value={f.accountNumber} onChangeText={(v) => set({ accountNumber: v })} keyboardType="number-pad" maxLength={20} /></Field>
          <Field label="Chủ tài khoản">
            <Input value={f.accountName} onChangeText={(v) => set({ accountName: v })} autoCapitalize="characters" placeholder="NGUYEN MINH ANH" maxLength={100} />
            {err(!accValid, 'Nhập đủ ngân hàng, số tài khoản (6–20 chữ số), chủ tài khoản — hoặc để trống cả ba')}
          </Field>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            {gaps.length === 0 && <Button title="Huỷ" variant="secondary" style={{ flex: 1 }} onPress={() => setForm(null)} />}
            <Button title="Lưu thông tin" icon="checkmark" style={{ flex: 1 }} disabled={busy || !valid} onPress={() => void save()} />
          </View>
        </View>
      ) : (
        <>
          <View style={{ marginTop: S.md }}>
            <KV items={[
              ['Họ tên', user.fullName],
              ['Số điện thoại', user.phone ?? '—'],
              ['Giấy tờ', user.customerProfile?.idNumberLast4 ? `${ID_TYPE_LABEL[user.customerProfile.idType ?? 'CCCD']} · ••••${user.customerProfile.idNumberLast4}` : '—'],
              ['Nhận tiền hoàn', acc ? `${acc.bankName} · ••••${acc.accountNumber.slice(-4)}` : 'Chưa khai'],
            ]} />
          </View>
          <Button title="Sửa thông tin" variant="secondary" icon="create-outline" style={{ marginTop: S.md }} onPress={() => setForm(f)} />
        </>
      )}
    </Card>
  );
}
