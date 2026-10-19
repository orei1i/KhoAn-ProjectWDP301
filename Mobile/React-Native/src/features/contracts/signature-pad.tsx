import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../../shared/ui';
import { C, R, S } from '../../shared/ui/theme';

/** Hệ toạ độ cố định 480×160 — cùng tỉ lệ khung ký trên web để ảnh chữ ký hiển thị giống nhau ở mọi nơi. */
const W = 480;
const H = 160;
type Pt = { x: number; y: number };

export interface SignaturePadHandle {
  /** PNG data URL (nền trong suốt) của chữ ký đã vẽ; null nếu chưa vẽ hoặc nền tảng không xuất được ảnh. */
  exportPng: () => Promise<string | null>;
}

/** Bản web của Expo không xuất được ảnh từ react-native-svg — ở đó chỉ cho ký bằng họ tên. */
export const canDrawSignature = Platform.OS !== 'web';

const toPath = (pts: Pt[]) => (pts.length === 1
  ? `M ${pts[0].x} ${pts[0].y} l 0.1 0.1`
  : pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));

/** Khung ký tay bằng ngón tay: PanResponder thu nét vẽ → react-native-svg dựng đường → xuất PNG khi cần. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onInkChange?: (hasInk: boolean) => void }>(function SignaturePad({ onInkChange }, ref) {
  const svgRef = useRef<Svg>(null);
  const size = useRef({ w: 1, h: 1 });
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const strokesRef = useRef<Pt[][]>([]);

  const commit = (next: Pt[][]) => { strokesRef.current = next; setStrokes(next); onInkChange?.(next.length > 0); };
  const point = (e: { nativeEvent: { locationX: number; locationY: number } }): Pt => ({
    x: Math.min(W, Math.max(0, (e.nativeEvent.locationX * W) / size.current.w)),
    y: Math.min(H, Math.max(0, (e.nativeEvent.locationY * H) / size.current.h)),
  });

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false, // đang ký thì không nhường cho ScrollView cuộn trang
    onPanResponderGrant: (e) => commit([...strokesRef.current, [point(e)]]),
    onPanResponderMove: (e) => {
      const cur = strokesRef.current;
      if (!cur.length) return;
      commit([...cur.slice(0, -1), [...cur[cur.length - 1], point(e)]]);
    },
  })).current;

  useImperativeHandle(ref, () => ({
    exportPng: () => new Promise((resolve) => {
      const svg = svgRef.current;
      if (!strokesRef.current.length || !svg?.toDataURL) { resolve(null); return; }
      try {
        svg.toDataURL((b64: string) => resolve(b64 ? `data:image/png;base64,${b64.replace(/\s/g, '')}` : null), { width: W, height: H });
      } catch { resolve(null); }
    }),
  }));

  return (
    <View>
      <View style={st.box} onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 }; }} {...pan.panHandlers}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
            {strokes.map((s, i) => <Path key={i} d={toPath(s)} stroke={C.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          </Svg>
        </View>
        {strokes.length === 0 && <Text style={st.hint}>Dùng ngón tay ký vào khung này</Text>}
      </View>
      <View style={st.row}>
        <Text style={st.note}>{strokes.length ? 'Đã có chữ ký' : ' '}</Text>
        <Button title="Xoá ký lại" variant="ghost" disabled={!strokes.length} onPress={() => commit([])} />
      </View>
    </View>
  );
});

const st = StyleSheet.create({
  box: { aspectRatio: W / H, backgroundColor: '#fff', borderRadius: R.md, borderWidth: 1, borderColor: C.line, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  hint: { color: C.faint, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.xs },
  note: { color: C.muted, fontSize: 12 },
});
