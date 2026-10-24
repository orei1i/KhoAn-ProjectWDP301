import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ContractClause, RentalPeriod } from '@ssm/shared';
import { api } from '../../shared/api/client';
import { Button, Muted } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

export interface ContractPreviewParams {
  unitTypeId: string; unitId?: string; startDate: string; rentalPeriod: RentalPeriod; periods: number; useAirConditioning: boolean;
  label: string;
}

/**
 * Toàn văn hợp đồng sẽ phát sinh nếu đặt kho này — đọc TRƯỚC khi giữ chỗ / trả tiền giữ chân (GET /reservations/contract-preview,
 * cùng nguồn với Webapp và PDF). Không giữ ô. Bản PDF để gửi pháp lý / kế toán tải trên web.
 */
export function ContractPreviewModal({ params, onClose }: { params: ContractPreviewParams | null; onClose: () => void }) {
  const [clauses, setClauses] = useState<ContractClause[] | null>(null);
  const [error, setError] = useState('');
  const qs = params ? new URLSearchParams({
    unitTypeId: params.unitTypeId, ...(params.unitId ? { unitId: params.unitId } : {}), startDate: params.startDate.slice(0, 10),
    rentalPeriod: params.rentalPeriod, periods: String(params.periods), useAirConditioning: String(params.useAirConditioning),
  }).toString() : '';

  useEffect(() => {
    if (!qs) return;
    let alive = true;
    setClauses(null); setError('');
    api.get<{ clauses: ContractClause[] }>(`/reservations/contract-preview?${qs}`)
      .then((v) => alive && setClauses(v.clauses))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [qs]);

  return (
    <Modal visible={!!params} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={st.sheet}>
        <Text style={st.title}>Xem trước hợp đồng</Text>
        <Muted style={{ marginTop: 4 } as never}>
          {params?.label} — bản xem trước, chưa có giá trị.
        </Muted>
        <ScrollView style={st.doc} contentContainerStyle={{ padding: S.md, gap: S.sm }}>
          {error ? <Text style={[st.p, { color: C.red }]}>Không dựng được bản xem trước: {error}</Text> : null}
          {!clauses && !error ? <Text style={st.p}>Đang dựng hợp đồng…</Text> : null}
          {(clauses ?? []).map((c, i) => (
            <View key={`${i}-${c.title}`}>
              <Text style={st.h}>{c.title}</Text>
              {c.paragraphs.map((p, k) => <Text key={k} style={st.p}>{p}</Text>)}
              {c.bullets.map((b, k) => <Text key={k} style={st.p}>• {b}</Text>)}
            </View>
          ))}
        </ScrollView>
        <Button title="Đã đọc" style={{ marginTop: S.md }} onPress={onClose} />
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  sheet: { flex: 1, padding: S.lg, backgroundColor: C.bg },
  title: { fontSize: 18, fontWeight: '700', color: C.ink },
  doc: { flex: 1, marginTop: S.md, borderRadius: R.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  h: { fontSize: 14, fontWeight: '700', color: C.ink, marginTop: S.sm },
  p: { fontSize: 13, lineHeight: 19, color: C.text, marginTop: 4 },
});
