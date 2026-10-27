import { Text, View } from 'react-native';
import { C, S } from '../../shared/ui/theme';

/** Nội dung một phụ lục (bản xem trước lúc gia hạn hoặc bản đã xác nhận) — dùng ở màn Hợp đồng và màn Gia hạn. */
export function AppendixText({ clauses }: { clauses: { title: string; paragraphs: string[]; bullets: string[] }[] }) {
  return (
    <View style={{ marginTop: S.sm, backgroundColor: C.bg, borderRadius: 12, padding: S.md, gap: S.sm }}>
      {clauses.map((cl) => (
        <View key={cl.title}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.ink }}>{cl.title}</Text>
          {cl.paragraphs.map((p, i) => <Text key={`p${i}`} style={{ fontSize: 12.5, color: C.ink, lineHeight: 19, marginTop: 2 }}>{p}</Text>)}
          {cl.bullets.map((b, i) => <Text key={`b${i}`} style={{ fontSize: 12.5, color: C.ink, lineHeight: 19, marginTop: 2 }}>• {b}</Text>)}
        </View>
      ))}
    </View>
  );
}
