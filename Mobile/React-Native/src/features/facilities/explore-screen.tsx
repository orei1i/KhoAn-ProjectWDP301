import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FACILITY_STATUS, UNIT_CATEGORY, vnd } from '@ssm/shared';
import { useStore } from '../../shared/store/store';
import { Card, Chip, EmptyState, PhotoBanner, Progress, ScreenSkeleton, StatusBadge, TabHeader } from '../../shared/ui';
import { C, R, S, SHADOW, T } from '../../shared/ui/theme';
import { availabilityTone, categoryIcon, facilityPhoto } from '../../shared/ui/visuals';

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
        <View style={{ padding: S.lg }}><ScreenSkeleton rows={2} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl * 2, gap: S.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand700} />}
      >
        <TabHeader eyebrow="Kho tự quản" title="Thuê kho" subtitle="Chọn chi nhánh để xem ảnh, cỡ kho và chỗ trống." />

        {catalog.facilities.length === 0 ? (
          <Card>
            <EmptyState icon="business-outline" title="Chưa có chi nhánh nào" description="Quay lại sau nhé." />
          </Card>
        ) : catalog.facilities.map((f, i) => {
          const available = f.availability.reduce((s, a) => s + a.available, 0);
          const total = f.availability.reduce((s, a) => s + a.total, 0);
          const tone = availabilityTone(available);
          const categories = [...new Set(f.availability.map((a) => a.category))];
          return (
            // Vào màn giới thiệu (hình ảnh, cỡ kho) trước, từ đó mới sang màn chọn ô & đặt kho.
            <Pressable
              key={f._id} onPress={() => router.push(`/facility/intro/${f._id}`)} accessibilityRole="button" accessibilityLabel={f.name}
              style={({ pressed }) => [st.card, pressed && { opacity: 0.94, transform: [{ scale: 0.99 }] }]}
            >
              <PhotoBanner source={facilityPhoto(i)} height={168} topRight={<StatusBadge map={FACILITY_STATUS} value={f.status} />}>
                <Text style={st.name} numberOfLines={2}>{f.name}</Text>
                <View style={st.loc}>
                  <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.9)" />
                  <Text style={st.locText} numberOfLines={1}>{f.address.district}, {f.address.city}</Text>
                </View>
              </PhotoBanner>
              <View style={st.body}>
                <View style={st.chips}>
                  <Chip tone="teal" icon="pricetag-outline">{f.fromPrice != null ? `Từ ${vnd(f.fromPrice)}/tháng` : 'Đang cập nhật giá'}</Chip>
                  <Chip tone={tone} icon="cube-outline">{available > 0 ? `Còn ${available} chỗ trống` : 'Hết chỗ'}</Chip>
                </View>
                {total > 0 && <Progress value={available / total} tone={tone} height={5} style={{ marginTop: S.md }} />}
                {categories.length > 0 && (
                  <View style={[st.chips, { marginTop: S.md }]}>
                    {categories.map((c) => <Chip key={c} size="sm" icon={categoryIcon(c)}>{UNIT_CATEGORY[c]}</Chip>)}
                  </View>
                )}
                <View style={st.cta}>
                  <Text style={st.ctaText}>Xem giới thiệu & đặt kho</Text>
                  <Ionicons name="arrow-forward" size={16} color={C.brand700} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  card: { backgroundColor: C.card, borderRadius: R.xl, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...SHADOW.lift },
  name: { fontSize: 20, fontWeight: '800', color: C.white, letterSpacing: -0.3 },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locText: { fontSize: 13, color: 'rgba(255,255,255,0.9)', flexShrink: 1 },
  body: { padding: S.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.lineSoft, minHeight: 32 },
  ctaText: { ...T.smallStrong, color: C.brand700 },
});
