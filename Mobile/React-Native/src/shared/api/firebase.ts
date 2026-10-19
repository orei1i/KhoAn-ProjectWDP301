import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as fbAuth from 'firebase/auth';
import { getAuth, type Auth, type Persistence } from 'firebase/auth';

/**
 * Firebase cho React Native.
 *
 * Khác Webapp ở hai điểm:
 *
 *  1. Phải gọi initializeAuth kèm getReactNativePersistence(AsyncStorage). Không có nó thì phiên
 *     đăng nhập chỉ nằm trong RAM — đóng app là mất, mở lại phải đăng nhập tiếp, kèm cảnh báo
 *     "AsyncStorage has been extracted from react-native core" ở console.
 *  2. KHÔNG có đăng nhập Google. signInWithPopup không chạy trong React Native, còn làm đúng cách
 *     thì phải tạo OAuth client trên Google Cloud Console và bỏ Expo Go để dựng development build.
 *     Khách quen đăng nhập Google vào web đặt mật khẩu ở trang /dat-mat-khau rồi dùng mật khẩu đó
 *     ở đây — cùng một tài khoản, cùng một uid.
 */

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

/**
 * getReactNativePersistence có thật lúc chạy nhưng vài bản firebase-js-sdk quên khai báo nó trong
 * file .d.ts (firebase-js-sdk#9316). Lấy qua namespace + ép kiểu để biên dịch được ở cả hai trường hợp.
 */
const getReactNativePersistence = (fbAuth as unknown as {
  getReactNativePersistence?: (storage: unknown) => Persistence;
}).getReactNativePersistence;

let authInstance: Auth | null = null;

export function firebaseAuth(): Auth {
  if (!firebaseConfigured) {
    throw new Error('Thiếu cấu hình Firebase — điền EXPO_PUBLIC_FIREBASE_* trong Mobile/React-Native/.env');
  }
  if (!authInstance) {
    const app: FirebaseApp = getApps()[0] ?? initializeApp(config);
    try {
      authInstance = getReactNativePersistence
        ? fbAuth.initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
        : getAuth(app);
    } catch {
      // initializeAuth ném lỗi nếu đã được gọi trước đó (hot reload) — lấy lại instance đang có.
      authInstance = getAuth(app);
    }
    authInstance.languageCode = 'vi';
  }
  return authInstance;
}

/** Mã lỗi Firebase → câu tiếng Việt cho form đăng nhập. Giữ khớp với Webapp/src/shared/api/firebase.ts. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng',
    'auth/invalid-email': 'Email không hợp lệ',
    'auth/user-disabled': 'Tài khoản đã bị khóa',
    'auth/too-many-requests': 'Thử quá nhiều lần, vui lòng đợi ít phút',
    'auth/email-already-in-use': 'Email đã được đăng ký',
    'auth/weak-password': 'Mật khẩu cần ít nhất 6 ký tự',
    'auth/network-request-failed': 'Không kết nối được Firebase — kiểm tra mạng',
  };
  return map[code] ?? (e instanceof Error ? e.message : 'Đăng nhập thất bại');
}
