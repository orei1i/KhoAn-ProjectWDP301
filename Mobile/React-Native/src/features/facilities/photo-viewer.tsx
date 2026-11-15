import { useRef, useState } from 'react';
import {
  Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
  type ImageSourcePropType, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, S, TOUCH } from '../../shared/ui/theme';

export interface ViewerPhoto { key: string; source?: ImageSourcePropType; caption: string }

/**
 * Xem ảnh toàn màn hình: vuốt ngang từng ảnh, nút ‹ › (trên web chuột không kéo được ảnh), số thứ tự n/N và chú thích.
 * Chỉ dựng khi đang mở (`{open && <PhotoViewer start={…} />}`); `start` = ảnh mở đầu tiên.
 */
export function PhotoViewer({ photos, start, onClose, credit }: {
  photos: ViewerPhoto[]; start: number; onClose: () => void; credit?: string;
}) {
  const insets = useSafeAreaInsets();
  const ref = useRef<ScrollView>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [idx, setIdx] = useState(start);
  const idxRef = useRef(start);
  // Trang cần cuộn tới khi khung ảnh vừa dựng xong (lúc mở, hoặc đổi cỡ cửa sổ trên web).
  const want = useRef<number | null>(start);
  const last = photos.length - 1;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w === size.w && h === size.h) return;
    if (w !== size.w) want.current = idxRef.current; // ScrollView dựng lại theo bề rộng mới (key) — giữ đúng ảnh đang xem
    setSize({ w, h });
  };
  const onContentSizeChange = (cw: number) => {
    const i = want.current;
    if (i === null || size.w <= 0 || cw < (i + 1) * size.w - 1) return;
    want.current = null;
    ref.current?.scrollTo({ x: i * size.w, animated: false });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (size.w <= 0 || want.current !== null) return;
    const i = Math.max(0, Math.min(last, Math.round(e.nativeEvent.contentOffset.x / size.w)));
    idxRef.current = i;
    setIdx(i);
  };
  const go = (i: number) => {
    const n = Math.max(0, Math.min(last, i));
    want.current = null;
    idxRef.current = n;
    setIdx(n);
    ref.current?.scrollTo({ x: n * size.w, animated: true });
  };

  const photo = photos[idx];
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={[st.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, S.md) }]}>
        <View style={st.head}>
          <Text style={st.count}>{idx + 1}/{photos.length}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" hitSlop={6}
            style={({ pressed }) => [st.roundBtn, pressed && st.pressed]}>
            <Ionicons name="close" size={24} color={C.white} />
          </Pressable>
        </View>

        <View style={st.stage} onLayout={onLayout}>
          {size.w > 0 && (
            <ScrollView
              key={size.w} ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange} style={StyleSheet.absoluteFill}
            >
              {photos.map((p) => (
                <View key={p.key} style={{ width: size.w, height: size.h }}>
                  {p.source ? <Image source={p.source} style={st.image} resizeMode="contain" accessibilityLabel={p.caption} /> : null}
                </View>
              ))}
            </ScrollView>
          )}
          <Pressable onPress={() => go(idx - 1)} disabled={idx <= 0} accessibilityRole="button" accessibilityLabel="Ảnh trước"
            style={({ pressed }) => [st.roundBtn, st.side, { left: S.md }, idx <= 0 && st.off, pressed && st.pressed]}>
            <Ionicons name="chevron-back" size={24} color={C.white} />
          </Pressable>
          <Pressable onPress={() => go(idx + 1)} disabled={idx >= last} accessibilityRole="button" accessibilityLabel="Ảnh sau"
            style={({ pressed }) => [st.roundBtn, st.side, { right: S.md }, idx >= last && st.off, pressed && st.pressed]}>
            <Ionicons name="chevron-forward" size={24} color={C.white} />
          </Pressable>
        </View>

        <View style={st.foot}>
          {photo ? <Text style={st.caption}>{photo.caption}</Text> : null}
          {credit ? <Text style={st.credit}>{credit}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1513' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: S.sm },
  count: { color: C.white, fontSize: 15, fontWeight: '700' },
  roundBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  side: { position: 'absolute', top: '50%', marginTop: -TOUCH / 2 },
  off: { opacity: 0.3 },
  pressed: { opacity: 0.7 },
  stage: { flex: 1 },
  image: { width: '100%', height: '100%' },
  foot: { paddingHorizontal: S.lg, paddingTop: S.md, gap: 4 },
  caption: { color: C.white, fontSize: 15, fontWeight: '600', lineHeight: 21, textAlign: 'center' },
  credit: { color: 'rgba(255,255,255,0.6)', fontSize: 11, textAlign: 'center' },
});
