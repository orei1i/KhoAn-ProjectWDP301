import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FACILITY_STATUS, vnd } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Card, EmptyState, H1, Muted, Skeleton, StatusBadge } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

export default function ExploreScreen() {
  const { catalog, reloadCatalog } = useStore();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reloadCatalog().catch(() => {});
    setRefreshing(false);
  }, [reloadCatalog]);

  if (!catalog) {
    return (
      <SafeAreaView style={st.screen} edges={['top']}>
        <View style={{ padding: S.lg, gap: S.md }}>
          <Skeleton h={28} w="50%" />
          <Skeleton h={110} />
          <Skeleton h={110} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl * 2, gap: S.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand700} />}
      >
        <H1>Thuê kho</H1>

        {catalog.facilities.length === 0 ? (
          <Card style={{ marginTop: S.md }}>
            <EmptyState icon="business-outline" title="Chưa có chi nhánh nào" description="Quay lại sau nhé." />
          </Card>
        ) : catalog.facilities.map((f) => {
          const available = f.availability.reduce((s, a) => s + a.available, 0);
          return (
            // Vào màn giới thiệu (hình ảnh, cỡ kho) trước, từ đó mới sang màn chọn ô & đặt kho.
            <Pressable key={f._id} onPress={() => router.push(`/facility/intro/${f._id}`)}>
              <Card>
                <View style={st.rowBetween}>
                  <Text style={st.name}>{f.name}</Text>
                  <StatusBadge map={FACILITY_STATUS} value={f.status} />
                </View>
                <Muted style={{ marginTop: 4 } as never}>{f.address.district}, {f.address.city}</Muted>
                <View style={{ marginTop: S.md }}>
                  <Text style={st.price}>{f.fromPrice != null ? `Từ ${vnd(f.fromPrice)}/tháng` : 'Đang cập nhật giá'}</Text>
                  <Muted style={{ marginTop: 2 } as never}>{available > 0 ? `Còn ${available} chỗ trống` : 'Hết chỗ'}</Muted>
                </View>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md },
  name: { fontSize: 16, fontWeight: '700', color: C.ink, flexShrink: 1 },
  price: { fontSize: 14, fontWeight: '700', color: C.brand800 },
});
