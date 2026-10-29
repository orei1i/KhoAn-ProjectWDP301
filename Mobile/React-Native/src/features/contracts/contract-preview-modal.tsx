import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ContractClause, RentalPeriod } from '@ssm/shared';
import { api } from '../../shared/api/client';
import { Button, Callout, Sheet, Skeleton } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

export interface ContractPreviewParams {
  unitTypeId: string; unitId?: string; startDate: string; rentalPeriod: RentalPeriod; periods: number; useAirConditioning: boolean;
  label: string;
}

/**
 * Toàn văn hợp đồng sẽ phát sinh nếu đặt kho này — đọc TRƯỚC khi giữ chỗ / trả tiền giữ chân (GET /reservations/contract-preview,
 * cùng nguồn với Webapp và PDF). Không giữ ô. Bản PDF để gửi pháp lý / kế toán tải trên web.
 * `onViewed`: gọi khi toàn văn đã hiện ra — màn đặt kho đánh dấu kho này đã xem hợp đồng (bắt buộc trước khi đặt).
 */
export function ContractPreviewModal({ params, onClose, onViewed }: { params: ContractPreviewParams | null; onClose: () => void; onViewed?: () => void }) {
  const [clauses, setClauses] = useState<ContractClause[] | null>(null);
  const [error, setError] = useState('');
  const viewedRef = useRef(onViewed);
  useEffect(() => { viewedRef.current = onViewed; });
  const qs = params ? new URLSearchParams({
    unitTypeId: params.unitTypeId, ...(params.unitId ? { unitId: params.unitId } : {}), startDate: params.startDate.slice(0, 10),
    rentalPeriod: params.rentalPeriod, periods: String(params.periods), useAirConditioning: String(params.useAirConditioning),
  }).toString() : '';

  useEffect(() => {
    if (!qs) return;
    let alive = true;
    setClauses(null); setError('');
    api.get<{ clauses: ContractClause[] }>(`/reservations/contract-preview?${qs}`)
      .then((v) => { if (!alive) return; setClauses(v.clauses); viewedRef.current?.(); })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [qs]);

  return (
    <Sheet
      visible={!!params} onClose={onClose} scroll={false} icon="document-text-outline" title="Xem trước hợp đồng"
      subtitle={`${params?.label ?? ''} — bản xem trước, chưa có giá trị.`}
      footer={<Button title="Đã đọc" icon="checkmark" onPress={onClose} />}
    >
      <ScrollView style={st.doc} contentContainerStyle={{ padding: S.lg, gap: S.sm }}>
        {error ? <Callout tone="red" title="Không dựng được bản xem trước">{error}</Callout> : null}
        {!clauses && !error ? (
          <View style={{ gap: S.sm }} accessibilityLabel="Đang dựng hợp đồng…">
            <Skeleton h={16} w="55%" /><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} w="80%" />
            <Skeleton h={16} w="45%" style={{ marginTop: S.md }} /><Skeleton h={12} /><Skeleton h={12} w="70%" />
          </View>
        ) : null}
        {(clauses ?? []).map((c, i) => (
          <View key={`${i}-${c.title}`}>
            <Text style={st.h}>{c.title}</Text>
            {c.paragraphs.map((p, k) => <Text key={k} style={st.p}>{p}</Text>)}
            {c.bullets.map((b, k) => <Text key={k} style={st.p}>• {b}</Text>)}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  doc: { flex: 1, borderRadius: R.lg, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  h: { fontSize: 14, fontWeight: '700', color: C.ink, marginTop: S.sm },
  p: { fontSize: 13, lineHeight: 20, color: C.text, marginTop: 4 },
});
