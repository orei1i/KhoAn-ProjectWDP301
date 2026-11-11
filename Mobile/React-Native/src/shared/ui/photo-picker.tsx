import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { EVIDENCE_PHOTO_MAX_BYTES } from '@ssm/shared';
import { ApiError, api } from '../api/client';
import { useStore } from '../store/store';
import { C, R, S, T } from './theme';

/**
 * ẢNH CHỨNG CỨ (RV3): khách chụp ảnh hoặc chọn trong thư viện → app tải lên POST /uploads/photos → nhận link ảnh của KhoAn. Thay cho ô
 * dán link Google Drive. Ảnh nén sẵn khi chọn (quality), quá giới hạn thì báo chọn ảnh khác.
 */
const SIZE = 76;

async function upload(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  if (!asset.base64) throw new Error('Không đọc được ảnh — chọn ảnh khác');
  if (asset.base64.length * 0.75 > EVIDENCE_PHOTO_MAX_BYTES) throw new Error(`Ảnh quá lớn (tối đa ${EVIDENCE_PHOTO_MAX_BYTES / 1024 / 1024}MB) — chọn ảnh khác`);
  const mime = asset.mimeType === 'image/png' || asset.mimeType === 'image/webp' ? asset.mimeType : 'image/jpeg';
  const { url } = await api.post<{ url: string }>('/uploads/photos', { dataUrl: `data:${mime};base64,${asset.base64}` }, undefined, 60_000);
  return url;
}

export function PhotoPicker({ urls, onChange, max = 10 }: { urls: string[]; onChange: (urls: string[]) => void; max?: number }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(0);

  const handle = async (res: ImagePicker.ImagePickerResult) => {
    if (res.canceled) return;
    const assets = res.assets.slice(0, Math.max(0, max - urls.length));
    let next = urls;
    setBusy(assets.length);
    for (const a of assets) {
      try {
        next = [...next, await upload(a)];
        onChange(next);
      } catch (e) {
        toast(e instanceof ApiError || e instanceof Error ? e.message : 'Không tải được ảnh', 'error');
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };
  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast('Cần quyền dùng camera để chụp ảnh', 'error'); return; }
    await handle(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, base64: true }));
  };
  const fromLibrary = async () => {
    await handle(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, base64: true, allowsMultipleSelection: true, selectionLimit: max - urls.length }));
  };
  // Bản web không có hộp chọn của Alert — mở thẳng hộp chọn file ảnh.
  const add = () => (Platform.OS === 'web' ? void fromLibrary() : Alert.alert('Thêm ảnh chứng cứ', undefined, [
    { text: 'Chụp ảnh', onPress: () => void fromCamera() },
    { text: 'Chọn từ thư viện', onPress: () => void fromLibrary() },
    { text: 'Huỷ', style: 'cancel' },
  ]));

  return (
    <View>
      <View style={st.grid}>
        {urls.map((u, i) => (
          <View key={`${i}-${u}`} style={st.thumb}>
            <Pressable onPress={() => void Linking.openURL(u)} accessibilityRole="imagebutton" accessibilityLabel={`Ảnh ${i + 1}`}>
              <Image source={{ uri: u }} style={st.img} />
            </Pressable>
            <Pressable onPress={() => onChange(urls.filter((_, k) => k !== i))} accessibilityRole="button" accessibilityLabel={`Bỏ ảnh ${i + 1}`} hitSlop={8} style={st.remove}>
              <Ionicons name="close" size={14} color={C.white} />
            </Pressable>
          </View>
        ))}
        {urls.length < max && (
          <Pressable onPress={add} disabled={busy > 0} accessibilityRole="button" accessibilityLabel="Thêm ảnh" style={({ pressed }) => [st.add, pressed && { opacity: 0.7 }]}>
            {busy > 0 ? <ActivityIndicator color={C.brand700} /> : <Ionicons name="camera-outline" size={22} color={C.brand700} />}
            <Text style={st.addText}>{busy > 0 ? `Đang tải ${busy}` : 'Thêm ảnh'}</Text>
          </Pressable>
        )}
      </View>
      <Text style={[T.caption, { marginTop: S.xs }]}>{urls.length}/{max} ảnh</Text>
    </View>
  );
}

/** Ảnh trong chi tiết hồ sơ — ảnh thu nhỏ, chạm để mở ảnh lớn (link cũ dạng Google Drive vẫn mở được). */
export function PhotoThumbs({ urls }: { urls?: string[] | null }) {
  if (!urls?.length) return null;
  return (
    <View style={st.grid}>
      {urls.map((u, i) => (
        <Pressable key={`${i}-${u}`} onPress={() => void Linking.openURL(u)} accessibilityRole="imagebutton" accessibilityLabel={`Ảnh ${i + 1}`} style={st.thumb}>
          <Image source={{ uri: u }} style={st.img} />
        </Pressable>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  thumb: { width: SIZE, height: SIZE, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.lineSoft, borderWidth: 1, borderColor: C.line },
  img: { width: SIZE, height: SIZE },
  remove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(22,32,30,0.7)', alignItems: 'center', justifyContent: 'center' },
  add: { width: SIZE, height: SIZE, borderRadius: R.md, borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, alignItems: 'center', justifyContent: 'center', gap: 2 },
  addText: { fontSize: 11, fontWeight: '600', color: C.brand700 },
});
