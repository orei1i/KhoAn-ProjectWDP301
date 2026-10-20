import { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { enumValues, fmtDateTime, PRIVACY_REQUEST_STATUS, PRIVACY_REQUEST_TYPE, PrivacyRequestType, type PrivacyRequest } from '@ssm/shared';
import { api } from '../../shared/api/client';
import { useStore } from '../../shared/store/store';
import { Button, Card, Chips, Field, Input, Muted, StatusBadge } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://wdp-301-webapp.vercel.app';
const TYPES = enumValues(PrivacyRequestType).map((t) => ({ value: t, label: PRIVACY_REQUEST_TYPE[t] }));

/**
 * Quyền dữ liệu cá nhân (Nghị định 13/2023): gửi yêu cầu (kể cả khi không còn hợp đồng), xem phản hồi; tải bản sao dữ liệu trên web.
 */
export function PrivacyCard() {
  const { run } = useStore();
  const [items, setItems] = useState<PrivacyRequest[]>([]);
  const [type, setType] = useState<PrivacyRequestType>('ACCESS');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<{ items: PrivacyRequest[] }>('/privacy-requests').then((r) => setItems(r.items)).catch(() => {}); }, []);
  useEffect(load, [load]);

  const send = async () => {
    setBusy(true);
    const r = await run('createPrivacyRequest', { type, note: note.trim() || undefined }, 'Đã gửi yêu cầu — KhoAn phản hồi trong 72 giờ');
    setBusy(false);
    if (r.ok) { setNote(''); load(); }
  };

  return (
    <Card style={{ marginTop: S.md }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: C.ink }}>Dữ liệu cá nhân</Text>
      <Muted style={{ marginTop: 4 } as never}>Quyền được biết, chỉnh sửa, xoá, rút lại đồng ý, phản đối xử lý (Nghị định 13/2023). KhoAn phản hồi trong 72 giờ.</Muted>
      <View style={{ marginTop: S.md, gap: S.sm }}>
        <Field label="Loại yêu cầu"><Chips options={TYPES} value={type} onChange={setType} columns={2} /></Field>
        {/* Điều kiện theo Chính sách bảo mật 1.4 mục 5 — khớp các kiểm tra của BE (privacy.service anonymizeCustomer). */}
        {type === 'DELETION' && <Muted>Xoá = ẩn danh hoá hồ sơ và xoá tài khoản đăng nhập. Chỉ làm được khi bạn không còn: hợp đồng hoặc đặt chỗ đang mở, khoản nợ chưa tất toán, hồ sơ bồi thường hay khiếu nại về thanh toán / biên bản trả kho đang xử lý, biên bản trả kho còn trong hạn khiếu nại, hoặc khoản KhoAn đang chờ chuyển trả cho bạn.</Muted>}
        <Field label="Nội dung (tuỳ chọn)">
          <Input value={note} onChangeText={setNote} multiline maxLength={2000} placeholder="VD thông tin cần chỉnh sửa…" style={{ minHeight: 64, textAlignVertical: 'top' }} />
        </Field>
        <Button title="Gửi yêu cầu" loading={busy} onPress={() => void send()} />
        <Button title="Tải bản sao dữ liệu (trên web)" variant="secondary" icon="download-outline" onPress={() => Linking.openURL(`${WEB_ORIGIN}/portal/privacy`)} />
      </View>
      {items.map((r) => (
        <View key={r._id} style={{ marginTop: S.md, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
            <Text style={{ flex: 1, fontWeight: '600', color: C.ink }}>{PRIVACY_REQUEST_TYPE[r.type]}</Text>
            <StatusBadge map={PRIVACY_REQUEST_STATUS} value={r.status} />
          </View>
          <Muted>{r.requestNumber} · {fmtDateTime(r.createdAt)}</Muted>
          <Text style={{ fontSize: 13, color: C.text }}>{r.response ?? (r.status === 'OPEN' ? `Hạn phản hồi ${fmtDateTime(r.dueAt)}` : '—')}</Text>
        </View>
      ))}
    </Card>
  );
}
