import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../api/client';
import { C, R, S, SHADOW, T } from './theme';

/**
 * Màn chờ lúc khởi động (Firebase khôi phục phiên → đồng bộ hồ sơ → tải dữ liệu).
 * Quá vài giây vẫn chưa xong thì nói thẳng app đang gọi địa chỉ nào và nên kiểm tra gì: trên điện thoại
 * không có terminal để đọc lỗi, một cái spinner quay mãi thì không ai biết bắt đầu tìm từ đâu.
 */
export function BootScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={st.screen}>
      <View style={st.logo}><Ionicons name="cube" size={34} color={C.white} /></View>
      <Text style={st.brand}>KhoAn</Text>
      <Text style={st.tag}>Kho tự quản · gửi đồ an tâm</Text>
      <ActivityIndicator color={C.brand700} style={{ marginTop: S.lg }} />
      {slow && (
        <View style={st.box}>
          <Text style={st.title}>Đang khởi động lâu hơn bình thường</Text>
          <Text style={st.line}>App đang gọi: {API_URL}</Text>
          <Text style={st.line}>• BE đã chạy chưa (npm run api)?</Text>
          <Text style={st.line}>• Điện thoại và máy tính cùng Wi-Fi chưa?</Text>
          <Text style={st.line}>• Firewall Windows có chặn cổng 4000 không? Thử mở {API_URL.replace(/\/api$/, '')}/health bằng trình duyệt trên điện thoại.</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: S.xl, gap: S.xs },
  logo: { width: 72, height: 72, borderRadius: R.xl, backgroundColor: C.brand700, alignItems: 'center', justifyContent: 'center', marginBottom: S.sm, ...SHADOW.lift },
  brand: { ...T.title, fontSize: 26 },
  tag: { ...T.small },
  box: { gap: S.xs, alignSelf: 'stretch', marginTop: S.xl, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.lg },
  title: { fontSize: 15, fontWeight: '700', color: C.ink, textAlign: 'center', marginBottom: S.sm },
  line: { fontSize: 13, lineHeight: 19, color: C.muted },
});
