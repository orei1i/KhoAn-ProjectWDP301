'use client';

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

let authInstance: Auth | null = null;

/** Lazily initialised so SSR / missing env never crash module import. */
export function firebaseAuth(): Auth {
  if (!firebaseConfigured) throw new Error('Thiếu cấu hình Firebase — điền NEXT_PUBLIC_FIREBASE_* trong Webapp/.env.local');
  if (!authInstance) {
    const app: FirebaseApp = getApps()[0] ?? initializeApp(config);
    authInstance = getAuth(app);
    authInstance.languageCode = 'vi';
  }
  return authInstance;
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/** Firebase error codes → Vietnamese messages for the login form. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng',
    'auth/invalid-email': 'Email không hợp lệ',
    'auth/user-disabled': 'Tài khoản đã bị khóa',
    'auth/too-many-requests': 'Thử quá nhiều lần, vui lòng đợi ít phút',
    'auth/email-already-in-use': 'Email đã được đăng ký',
    'auth/weak-password': 'Mật khẩu cần ít nhất 6 ký tự',
    'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ Google',
    'auth/popup-blocked': 'Trình duyệt chặn cửa sổ Google — bấm biểu tượng bị chặn ở thanh địa chỉ để cho phép',
    'auth/account-exists-with-different-credential': 'Email này đã đăng ký bằng cách khác — hãy đăng nhập bằng email/mật khẩu',
    'auth/network-request-failed': 'Không kết nối được Firebase',
    'auth/unauthorized-domain': 'Tên miền này chưa được cho phép trong Firebase — thêm vào Authentication → Settings → Authorized domains',
  };
  return map[code] ?? (e instanceof Error ? e.message : 'Đăng nhập thất bại');
}
