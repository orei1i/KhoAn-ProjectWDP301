import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CONTACT_WINDOW, ContactWindow, enumValues, isValidPhone, PHONE_MESSAGE, type RentalPeriod } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Button, Chips, Field, Input, Muted } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

export interface ConsultationContext {
  facilityId: string; facilityName: string; unitTypeIds: string[]; rentalPeriod: RentalPeriod; periods: number;
}

const NEEDS = [
  ['reviewContract', 'Pháp lý / kế toán bên tôi cần xem hợp đồng trước khi thanh toán'],
  ['vatInvoice', 'Cần xuất hoá đơn VAT cho công ty'],
  ['customContract', 'Cần hợp đồng / điều khoản riêng'],
  ['multipleUnits', 'Thuê nhiều kho hoặc kho cỡ lớn lâu dài'],
] as const;
type Needs = Record<(typeof NEEDS)[number][0], boolean>;
const WINDOWS = enumValues(ContactWindow).map((w) => ({ value: w, label: CONTACT_WINDOW[w] }));

/**
 * Yêu cầu TƯ VẤN trước khi đặt (POST /tickets/consultation) — quản lý chi nhánh gọi lại và trả lời trong mục Hỗ trợ.
 * Không giữ ô kho nào trong lúc chờ; tư vấn xong khách vẫn tự đặt và ký trên tài khoản.
 */
export function ConsultationModal({ ctx, onClose }: { ctx: ConsultationContext | null; onClose: () => void }) {
  const { user, run } = useStore();
  const router = useRouter();
  const [phone, setPhone] = useState<string | null>(null);
  const [contactWindow, setContactWindow] = useState<ContactWindow>('ANY');
  const [needs, setNeeds] = useState<Needs>({ reviewContract: true, vatInvoice: false, customContract: false, multipleUnits: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const phoneValue = (phone ?? user?.phone ?? '').trim();
  const close = () => { setPhone(null); setNote(''); onClose(); };
  const submit = async () => {
    if (!ctx) return;
    setBusy(true);
    const r = await run('requestConsultation', {
      facilityId: ctx.facilityId, unitTypeIds: ctx.unitTypeIds, rentalPeriod: ctx.rentalPeriod, periods: ctx.periods,
      phone: phoneValue, contactWindow, needs, note: note.trim() || undefined,
    }, 'Đã gửi yêu cầu tư vấn — chi nhánh sẽ gọi lại');
    setBusy(false);
    if (r.ok) { close(); router.push(`/ticket/${r.value._id}`); }
  };

  return (
    <Modal visible={!!ctx} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, gap: S.md }} keyboardShouldPersistTaps="handled">
        <Text style={st.title}>Cần tư vấn trước khi đặt?</Text>
        <Muted>
          Quản lý {ctx?.facilityName} sẽ gọi lại theo khung giờ bạn chọn. Kho không được giữ trong lúc chờ.
        </Muted>
        <Field label="Số điện thoại liên hệ" hint={phone !== null && !isValidPhone(phoneValue) ? PHONE_MESSAGE : undefined}>
          <Input value={phone ?? user?.phone ?? ''} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="0901 234 567" />
        </Field>
        <Field label="Gọi lại vào">
          <Chips options={WINDOWS} value={contactWindow} onChange={setContactWindow} columns={2} />
        </Field>
        <View>
          <Text style={st.label}>Bạn cần tư vấn về</Text>
          {NEEDS.map(([k, label]) => (
            <Pressable key={k} onPress={() => setNeeds({ ...needs, [k]: !needs[k] })} style={st.check}>
              <Ionicons name={needs[k] ? 'checkbox' : 'square-outline'} size={22} color={needs[k] ? C.brand700 : C.faint} />
              <Text style={st.checkText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Ghi chú (tuỳ chọn)">
          <Input value={note} onChangeText={setNote} multiline maxLength={2000} placeholder="VD tên công ty, mã số thuế, thời gian muốn bắt đầu thuê…" style={{ minHeight: 80, textAlignVertical: 'top' }} />
        </Field>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <Button title="Huỷ" variant="secondary" style={{ flex: 1 }} onPress={close} />
          <Button title="Gửi yêu cầu" style={{ flex: 1 }} loading={busy} disabled={!isValidPhone(phoneValue)} onPress={() => void submit()} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: C.ink },
  label: { fontSize: 13, fontWeight: '600', color: C.ink, marginBottom: S.sm },
  check: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', marginBottom: S.sm },
  checkText: { flex: 1, fontSize: 13, lineHeight: 19, color: C.text },
});
