import { Alert, Platform } from 'react-native';

/**
 * Hỏi lại trước một thao tác khó hoàn tác (huỷ đặt chỗ đã trả tiền…). Trên iOS/Android dùng Alert hệ thống; bản web của app
 * (react-native-web) không hiện Alert.alert nên dùng window.confirm — nếu không, bấm nút trên web sẽ không có gì xảy ra.
 */
export function confirmAction(title: string, message: string, confirmText: string, onConfirm: () => void, cancelText = 'Giữ lại') {
  if (Platform.OS === 'web') {
    const w = globalThis as { confirm?: (text: string) => boolean };
    if (!w.confirm || w.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}
