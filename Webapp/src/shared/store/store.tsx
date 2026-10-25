'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, EmailAuthProvider, linkWithCredential, onAuthStateChanged, reauthenticateWithPopup,
  reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut,
  updatePassword, updateProfile,
} from 'firebase/auth';
import { withPolicyDefaults, type Facility, type UnitCategory, type UnitType, type User } from '@ssm/shared';
import type { DB } from '@/shared/lib/mock-data';
import { api, ApiError } from '@/shared/api/client';
import { actions, type ActionName, type Payload, type Value } from '@/shared/api/actions';
import { authErrorMessage, firebaseAuth, firebaseConfigured, googleProvider } from '@/shared/api/firebase';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/features/legal/legal-content';

export type RunResult<V> = { ok: true; value: V } | { ok: false; error: string; code?: string };
export interface Toast { id: number; tone: 'success' | 'error' | 'info'; text: string }

export interface PublicFacility extends Facility {
  fromPrice: number | null;
  availability: { unitTypeId: string; name: string; category: UnitCategory; total: number; free: number; holds: number; available: number }[];
}
export interface Catalog { facilities: PublicFacility[]; unitTypes: UnitType[] }

/** Lỗi tạm thời (mất mạng, máy chủ đang khởi động, 429 giới hạn tần suất) → thử lại thay vì bắt đăng nhập lại ngay. */
const isTransient = (e: unknown) => !(e instanceof ApiError) || e.status === 429 || e.status >= 500;
const SYNC_RETRY_MS = [2_000, 5_000, 12_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const EMPTY_DB: DB = { users: [], facilities: [], unitTypes: [], units: [], reservations: [], contracts: [], payments: [], inspections: [], tickets: [], claims: [], swapRequests: [], services: [], serviceOrders: [], accessRequests: [], policies: [], audit: [] };
type Snapshot = DB & { me: User };

interface StoreValue {
  /** Server snapshot of everything the signed-in user may see (empty when signed out). */
  db: DB;
  user: User | null;
  /** Public catalogue (facilities, unit types, live availability) — loaded for everyone. */
  catalog: Catalog | null;
  busy: boolean;
  /** false trong lúc Firebase còn khôi phục phiên — dùng để hiện skeleton, đừng kết luận "chưa đăng nhập". */
  ready: boolean;
  firebaseReady: boolean;
  /** Các cách đăng nhập đã gắn với tài khoản Firebase: 'password' | 'google.com' | … */
  providers: string[];
  /** Gắn thêm (hoặc đổi) mật khẩu cho tài khoản hiện tại — dùng cho người đăng nhập bằng Google. */
  setPassword: (password: string) => Promise<boolean>;
  loginEmail: (email: string, password: string) => Promise<boolean>;
  loginGoogle: () => Promise<boolean>;
  register: (fullName: string, email: string, password: string, phone?: string) => Promise<boolean>;
  /** Gọi ngay trước loginGoogle để lần đăng nhập đó được tính là đã chấp thuận điều khoản. */
  markGoogleConsent: () => void;
  /** Trả true nếu đã gửi (hoặc email không tồn tại — cố ý không phân biệt, xem phần cài đặt bên dưới). */
  resetPassword: (email: string) => Promise<boolean>;
  resendVerification: () => Promise<void>;
  confirmVerification: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  reloadCatalog: () => Promise<void>;
  run: <K extends ActionName>(name: K, payload: Payload<K>, successText?: string | ((v: Value<K>) => string), onOk?: (v: Value<K>) => void) => Promise<RunResult<Value<K>>>;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [db, setDb] = useState<DB>(EMPTY_DB);
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const userRef = useRef<User | null>(null);
  const pendingName = useRef<string | undefined>(undefined);
  const pendingPhone = useRef<string | undefined>(undefined);
  /** Chấp thuận điều khoản kèm theo lần đồng bộ hồ sơ đầu tiên; server chỉ dùng khi tạo hồ sơ mới. */
  const pendingConsent = useRef<{ termsVersion: string; privacyVersion: string; method: 'SIGNUP_FORM' | 'GOOGLE' } | undefined>(undefined);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    const snap = await api.get<Snapshot>('/bootstrap');
    const { me, ...rest } = snap;
    userRef.current = me;
    setUser(me);
    // Chính sách cũ trong DB có thể thiếu earlyTermination/abandonAfterLockedOutDays — điền mặc định để các trang không sập.
    setDb({ ...EMPTY_DB, ...rest, policies: (rest.policies ?? []).map(withPolicyDefaults) });
  }, []);

  const reloadCatalog = useCallback(async () => {
    try {
      const res = await api.get<{ items: PublicFacility[]; unitTypes: UnitType[] }>('/facilities/public');
      setCatalog({ facilities: res.items, unitTypes: res.unitTypes });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được danh sách chi nhánh', 'error');
      setCatalog({ facilities: [], unitTypes: [] });
    }
  }, [toast]);

  // Firebase session → POST /auth/sync (create/link profile) → GET /bootstrap
  useEffect(() => {
    void reloadCatalog();
    if (!firebaseConfigured) { setReady(true); return; }
    return onAuthStateChanged(firebaseAuth(), async (fb) => {
      if (!fb) {
        userRef.current = null; setUser(null); setDb(EMPTY_DB); setProviders([]); setReady(true);
        return;
      }
      setProviders(fb.providerData.map((p) => p.providerId));
      // Đồng bộ hồ sơ rồi tải dữ liệu; lỗi tạm thời thì thử lại vài lần. Chỉ đăng xuất khi hết lượt thử hoặc lỗi thật
      // (token hỏng, tài khoản bị khoá, dữ liệu đăng ký không hợp lệ).
      let synced = false;
      for (let attempt = 0; ; attempt++) {
        try {
          if (!synced) {
            await api.post('/auth/sync', {
              ...(pendingName.current ? { fullName: pendingName.current } : {}),
              ...(pendingPhone.current ? { phone: pendingPhone.current } : {}),
              ...(pendingConsent.current ? { consent: pendingConsent.current } : {}),
            });
            synced = true;
            pendingName.current = undefined;
            pendingPhone.current = undefined;
            pendingConsent.current = undefined;
          }
          await refresh();
          break;
        } catch (e) {
          const sameSession = firebaseAuth().currentUser?.uid === fb.uid;
          if (sameSession && isTransient(e) && attempt < SYNC_RETRY_MS.length) { await sleep(SYNC_RETRY_MS[attempt]); continue; }
          if (sameSession) {
            toast(e instanceof Error ? e.message : 'Không đồng bộ được tài khoản', 'error');
            await signOut(firebaseAuth()).catch(() => {});
          }
          break;
        }
      }
      setReady(true);
    });
  }, [refresh, reloadCatalog, toast]);

  const wrapAuth = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); return true; } catch (e) { toast(authErrorMessage(e), 'error'); return false; } finally { setBusy(false); }
  }, [toast]);

  const loginEmail = useCallback((email: string, password: string) => wrapAuth(() => signInWithEmailAndPassword(firebaseAuth(), email.trim(), password)), [wrapAuth]);
  /**
   * CHỈ dùng popup, cố ý không có nhánh signInWithRedirect.
   *
   * Redirect bắt buộc trang xử lý (/__/auth/handler) phải nằm cùng origin với app, mà Google chỉ chấp nhận
   * redirect_uri đã đăng ký trong Google Cloud Console — dự án này không đăng ký, nên redirect sẽ chết ở
   * "Error 400: redirect_uri_mismatch". Popup thì trang xử lý vẫn ở <project>.firebaseapp.com (Google đăng ký
   * sẵn) và nói chuyện với app qua postMessage, không đụng storage, nên chạy được mọi nơi — trừ khi trình
   * duyệt chặn cửa sổ mới, lúc đó chỉ người dùng mới mở khoá được.
   */
  const loginGoogle = useCallback(() => wrapAuth(async () => {
    try {
      await signInWithPopup(firebaseAuth(), googleProvider);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? '';
      console.error('[Google sign-in]', code, e); // mã thật luôn nằm ở đây, đừng đoán từ toast
      if (code === 'auth/popup-blocked') {
        throw new Error('Trình duyệt chặn cửa sổ Google. Chrome/Edge: bấm biểu tượng cửa sổ bị chặn ở cuối thanh địa chỉ → "Luôn cho phép". Brave: bật thêm brave://settings/socialBlocking → "Allow Google login buttons on third party sites". Hoặc dùng email/mật khẩu.');
      }
      if (code === 'auth/operation-not-supported-in-this-environment') {
        throw new Error('Trình duyệt này không mở được cửa sổ đăng nhập Google (thường gặp khi mở link trong Zalo/Facebook/Messenger). Mở bằng Chrome hoặc dùng email/mật khẩu.');
      }
      throw new Error(`Đăng nhập Google thất bại (${code || 'không rõ mã'}). Mở DevTools → Console để xem chi tiết.`);
    }
  }), [wrapAuth]);
  const markGoogleConsent = useCallback(() => {
    pendingConsent.current = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, method: 'GOOGLE' };
  }, []);

  const register = useCallback((fullName: string, email: string, password: string, phone?: string) => wrapAuth(async () => {
    pendingName.current = fullName.trim();
    pendingPhone.current = phone?.trim() || undefined;
    pendingConsent.current = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, method: 'SIGNUP_FORM' };
    const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
    await updateProfile(cred.user, { displayName: fullName.trim() });
    await sendEmailVerification(cred.user);
    toast('Đã gửi email xác minh — mở hộp thư để kích hoạt tài khoản', 'info');
  }), [wrapAuth, toast]);

  /**
   * Không bao giờ để lộ email nào đã có tài khoản: `auth/user-not-found` bị nuốt và vẫn báo thành công,
   * nếu không thì trang này thành công cụ dò danh sách người dùng.
   * Email sai định dạng thì vẫn báo lỗi — đó là lỗi nhập liệu của chính họ, không phải thông tin về người khác.
   */
  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    setBusy(true);
    try {
      await sendPasswordResetEmail(firebaseAuth(), email.trim());
      return true;
    } catch (e) {
      const code = (e as { code?: string })?.code ?? '';
      if (code === 'auth/user-not-found') return true;
      toast(authErrorMessage(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const resendVerification = useCallback(async () => {
    const cu = firebaseAuth().currentUser;
    if (cu && await wrapAuth(() => sendEmailVerification(cu))) toast('Đã gửi lại email xác minh', 'success');
  }, [wrapAuth, toast]);

  /**
   * Người đăng nhập bằng Google chưa có mật khẩu. Gắn thêm provider 'password' bằng linkWithCredential
   * → từ đó đăng nhập được bằng cả hai cách, vẫn cùng một tài khoản (cùng uid, cùng hồ sơ trong Mongo).
   * Đã có mật khẩu rồi thì đây là đổi mật khẩu.
   *
   * Firebase đòi phiên "còn mới" cho thao tác nhạy cảm này; hết hạn thì xác thực lại bằng Google rồi thử lại.
   */
  const setPassword = useCallback((password: string) => wrapAuth(async () => {
    const cu = firebaseAuth().currentUser;
    if (!cu) throw new Error('Chưa đăng nhập');
    if (!cu.email) throw new Error('Tài khoản này không có email nên không đặt được mật khẩu');
    const had = cu.providerData.some((p) => p.providerId === 'password');

    const apply = async () => {
      if (had) await updatePassword(cu, password);
      else await linkWithCredential(cu, EmailAuthProvider.credential(cu.email!, password));
    };

    try {
      await apply();
    } catch (e) {
      if ((e as { code?: string })?.code !== 'auth/requires-recent-login') throw e;
      await reauthenticateWithPopup(cu, googleProvider);
      await apply();
    }

    await reload(cu);
    setProviders(cu.providerData.map((p) => p.providerId));
    toast(had ? 'Đã đổi mật khẩu' : `Đã đặt mật khẩu — từ giờ đăng nhập được bằng ${cu.email}`, 'success');
  }), [wrapAuth, toast]);

  /** After clicking the link in the email: reload Firebase user, force a fresh token (email_verified=true), re-sync. */
  const confirmVerification = useCallback(async () => {
    const cu = firebaseAuth().currentUser;
    if (!cu) return;
    await wrapAuth(async () => {
      await reload(cu);
      if (!cu.emailVerified) throw new Error('Email chưa được xác minh — hãy bấm link trong email trước');
      await cu.getIdToken(true);
      await api.post('/auth/sync', {});
      await refresh();
      toast('Tài khoản đã được kích hoạt', 'success');
    });
  }, [wrapAuth, refresh, toast]);

  const logout = useCallback(async () => { await signOut(firebaseAuth()).catch(() => {}); }, []);

  const run = useCallback(async <K extends ActionName>(name: K, payload: Payload<K>, successText?: string | ((v: Value<K>) => string), onOk?: (v: Value<K>) => void): Promise<RunResult<Value<K>>> => {
    if (!userRef.current) { toast('Vui lòng đăng nhập', 'error'); return { ok: false, error: 'UNAUTHENTICATED' }; }
    setBusy(true);
    try {
      const fn = actions[name] as unknown as (p: Payload<K>) => Promise<Value<K>>;
      const value = await fn(payload);
      await refresh();
      void reloadCatalog(); // public availability/prices may have changed
      if (successText) toast(typeof successText === 'function' ? successText(value) : successText, 'success');
      onOk?.(value);
      return { ok: true, value };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(msg, 'error');
      if (e instanceof ApiError && (e.code === 'TOKEN_REVOKED' || e.code === 'TOKEN_EXPIRED' || e.code === 'ACCOUNT_SUSPENDED')) await logout();
      else refresh().catch(() => {}); // the server may have changed state (e.g. hold expired)
      return { ok: false, error: msg, code: e instanceof ApiError ? e.code : undefined };
    } finally {
      setBusy(false);
    }
  }, [refresh, reloadCatalog, toast, logout]);

  // Cố ý KHÔNG chặn toàn bộ cây render ở đây: trang public không cần chờ Firebase, chặn hết
  // làm cả web trắng màn hình mỗi lần tải. Nơi nào cần đăng nhập thì tự đọc `ready` và hiện skeleton.

  return (
    <StoreContext.Provider value={{
      db, user, catalog, busy, ready, firebaseReady: firebaseConfigured, providers, setPassword,
      loginEmail, loginGoogle, register, markGoogleConsent, resetPassword, resendVerification, confirmVerification, logout, refresh, reloadCatalog,
      run, toast, toasts, dismiss,
    }}>
      {busy && <div className="fixed inset-x-0 top-0 z-[70] h-0.5 animate-pulse bg-brand-500" />}
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
