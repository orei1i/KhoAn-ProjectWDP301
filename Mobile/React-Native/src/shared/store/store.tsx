import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updateProfile,
} from 'firebase/auth';
import type {
  AccessRequest, BusinessPolicy, DamageClaim, Facility, InspectionLog, IntakeBatch, PaymentConfig, PaymentMode, PaymentTransaction, RentalContract, Reservation, ServiceOffering, ServiceOrder,
  StorageUnit, SupportTicket, UnitCategory, UnitSwapRequest, UnitType, User,
} from '@ssm/shared';
import { PRIVACY_VERSION, TERMS_VERSION, withPolicyDefaults } from '@ssm/shared';
import { api, ApiError, isNetworkError } from '../api/client';
import { actions, type ActionName, type Payload, type Value } from '../api/actions';
import { authErrorMessage, firebaseAuth, firebaseConfigured } from '../api/firebase';
import { LIVE_BACKOFF_MS, LIVE_FOCUS_MIN_GAP_MS, LIVE_MS, LIVE_TICK_MS, sameJson, shareSnapshot } from './live-sync';

/**
 * Cùng mô hình với Webapp: một ảnh chụp (snapshot) mọi dữ liệu khách được phép thấy, lấy qua
 * GET /bootstrap. Sau mỗi hành động thì tải lại toàn bộ thay vì tự vá state — chậm hơn một chút
 * nhưng không bao giờ lệch với server, và đó là thứ đáng giá hơn ở một app có tiền bạc.
 */

/** Lỗi tạm thời (mất mạng, máy chủ đang khởi động, 429 giới hạn tần suất) → thử lại thay vì bắt đăng nhập lại ngay. */
const isTransient = (e: unknown) => !(e instanceof ApiError) || e.status === 429 || e.status >= 500;
const SYNC_RETRY_MS = [2_000, 5_000, 12_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Gửi lại email xác minh: chờ 60 giây giữa hai lần (Firebase cũng chặn gửi dồn — auth/too-many-requests). */
export const VERIFY_RESEND_COOLDOWN_MS = 60_000;

export interface DB {
  users: User[];
  facilities: Facility[];
  unitTypes: UnitType[];
  units: StorageUnit[];
  reservations: Reservation[];
  contracts: RentalContract[];
  payments: PaymentTransaction[];
  tickets: SupportTicket[];
  claims: DamageClaim[];
  /** Biên bản kiểm tra khi trả kho của khách — xem và khiếu nại trong hạn (Điều 9). */
  inspections: InspectionLog[];
  swapRequests: UnitSwapRequest[];
  services: ServiceOffering[];
  serviceOrders: ServiceOrder[];
  accessRequests: AccessRequest[];
  policies: BusinessPolicy[];
  /** Các đợt nhập hàng của khách (khai / đã xác nhận / từ chối / huỷ) — đồ đang gửi = các đợt CONFIRMED (inventoryOf). */
  intakeBatches: IntakeBatch[];
}

const EMPTY_DB: DB = {
  users: [], facilities: [], unitTypes: [], units: [], reservations: [],
  contracts: [], payments: [], tickets: [], claims: [], inspections: [], swapRequests: [], services: [], serviceOrders: [], accessRequests: [], policies: [], intakeBatches: [],
};

export interface PublicFacility extends Facility {
  fromPrice: number | null;
  availability: { unitTypeId: string; name: string; category: UnitCategory; total: number; free: number; holds: number; available: number }[];
}
export interface Catalog { facilities: PublicFacility[]; unitTypes: UnitType[] }

/** `details`: phần chi tiết của lỗi server (VD ô vừa bị giữ) — màn hình dùng để xử lý tiếp, câu báo đã hiện bằng toast. */
export type RunResult<V> = { ok: true; value: V } | { ok: false; error: string; code?: string; details?: unknown };
export interface Toast { id: number; tone: 'success' | 'error' | 'info'; text: string }

interface StoreValue {
  /** Chuyển màn: tải lại nền nếu dữ liệu đã cũ hơn LIVE_FOCUS_MIN_GAP_MS (như quay lại tab trên web). */
  refreshIfStale: () => void;
  db: DB;
  user: User | null;
  catalog: Catalog | null;
  /** Đợt VNPAY: chỉ để chọn cách hiển thị cổng. Chuyển sang VNPAY hay không luôn theo phản hồi thật (202) của server. */
  paymentMode: PaymentMode;
  busy: boolean;
  /** false khi Firebase còn đang khôi phục phiên — dùng để hiện màn chờ, đừng kết luận "chưa đăng nhập". */
  ready: boolean;
  firebaseReady: boolean;
  loginEmail: (email: string, password: string) => Promise<boolean>;
  register: (fullName: string, email: string, password: string, phone?: string) => Promise<boolean>;
  resetPassword: (email: string) => Promise<boolean>;
  /** Gửi lại email xác minh (tài khoản tự đăng ký còn PENDING_VERIFICATION). */
  resendVerification: () => Promise<boolean>;
  /** Mốc (ms) được bấm "Gửi lại email" lần nữa — 0 = được ngay. */
  verifyResendAt: number;
  /** "Tôi đã xác minh": tải lại người dùng Firebase, lấy token mới rồi đồng bộ để BE kích hoạt tài khoản. true = đã kích hoạt. */
  confirmVerification: () => Promise<boolean>;
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
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('MOCK');
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [verifyResendAt, setVerifyResendAt] = useState(0);
  const userRef = useRef<User | null>(null);
  const pendingName = useRef<string | undefined>(undefined);
  const pendingPhone = useRef<string | undefined>(undefined);
  const pendingConsent = useRef<{ termsVersion: string; privacyVersion: string; method: 'SIGNUP_FORM' } | undefined>(undefined);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Góp ý 17/11 — tải nền (live-sync.ts): số thứ tự lần tải (bản cũ về sau bản mới thì bỏ), số thao tác đang chạy + "kỷ nguyên" thao tác
  // (lần tải nền chồng lên một thao tác thì bỏ kết quả), mốc tải gần nhất, đếm lỗi để giãn nhịp.
  const fetchSeq = useRef(0);
  const appliedSeq = useRef(0);
  const actionsInFlight = useRef(0);
  const actionEpoch = useRef(0);
  const liveBusy = useRef(false);
  const lastFetchAt = useRef(0);
  const liveFails = useRef(0);
  const liveRetryAt = useRef(0);

  /** Áp một ảnh chụp, giữ tham chiếu mọi phần không đổi (không đổi gì → không vẽ lại; form đang nhập không bị khởi tạo lại). */
  const applySnapshot = useCallback((snap: DB & { me: User }) => {
    const { me, ...rest } = snap;
    // App chỉ dành cho khách thuê — tài khoản nhân viên / quản lý / quản trị dùng trang web. Không nạp dữ liệu; lỗi không tạm thời
    // nên vòng đồng bộ bên dưới báo lỗi và đăng xuất.
    if (me.role !== 'CUSTOMER') throw new ApiError(403, 'NOT_CUSTOMER', 'Ứng dụng dành cho khách thuê — nhân viên dùng trang web');
    const nextUser = userRef.current && sameJson(userRef.current, me) ? userRef.current : me;
    userRef.current = nextUser;
    setUser(nextUser);
    // Chính sách cũ trong DB có thể thiếu earlyTermination/abandonAfterLockedOutDays — điền mặc định để các màn không sập.
    const next: DB = { ...EMPTY_DB, ...rest, policies: (rest.policies ?? []).map(withPolicyDefaults) };
    setDb((prev) => shareSnapshot(prev, next));
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    const snap = await api.get<DB & { me: User }>('/bootstrap');
    if (seq < appliedSeq.current) return; // một lần tải bắt đầu SAU đã áp bản mới hơn
    appliedSeq.current = seq;
    lastFetchAt.current = Date.now();
    applySnapshot(snap);
  }, [applySnapshot]);

  /**
   * Tải nền LẶNG LẼ: không toast, không đăng xuất khi lỗi. Bỏ lượt khi đang có thao tác của khách hoặc đang chờ sau lỗi; không chạy chồng.
   * Lỗi → giãn nhịp theo LIVE_BACKOFF_MS (429, Render đang khởi động, mất mạng…).
   */
  const silentRefresh = useCallback(async () => {
    if (liveBusy.current || actionsInFlight.current > 0 || !userRef.current || Date.now() < liveRetryAt.current) return;
    liveBusy.current = true;
    const epoch = actionEpoch.current;
    const uid = userRef.current._id;
    const seq = ++fetchSeq.current;
    try {
      const snap = await api.get<DB & { me: User }>('/bootstrap');
      liveFails.current = 0; liveRetryAt.current = 0;
      lastFetchAt.current = Date.now();
      if (epoch !== actionEpoch.current || !userRef.current || userRef.current._id !== uid || seq < appliedSeq.current) return;
      appliedSeq.current = seq;
      applySnapshot(snap);
    } catch {
      liveFails.current += 1;
      liveRetryAt.current = Date.now() + LIVE_BACKOFF_MS[Math.min(liveFails.current, LIVE_BACKOFF_MS.length) - 1];
    } finally {
      liveBusy.current = false;
    }
  }, [applySnapshot]);

  /**
   * Góp ý 17/11 — dữ liệu tự cập nhật: app quay lại foreground (AppState 'active') thì tải ngay; đang mở thì mỗi LIVE_MS kể từ lần tải gần
   * nhất. App ở nền: không tải.
   */
  const liveUserId = user?._id;
  useEffect(() => {
    if (!liveUserId) return;
    const tick = () => { if (AppState.currentState === 'active' && Date.now() - lastFetchAt.current >= LIVE_MS) void silentRefresh(); };
    const id = setInterval(tick, LIVE_TICK_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && Date.now() - lastFetchAt.current >= LIVE_FOCUS_MIN_GAP_MS) void silentRefresh();
    });
    return () => { clearInterval(id); sub.remove(); };
  }, [liveUserId, silentRefresh]);
  const refreshIfStale = useCallback(() => {
    if (liveUserId && AppState.currentState === 'active' && Date.now() - lastFetchAt.current >= LIVE_FOCUS_MIN_GAP_MS) void silentRefresh();
  }, [liveUserId, silentRefresh]);

  const reloadCatalog = useCallback(async () => {
    // Lỗi thì giữ giá trị đang có (lúc mở app là MOCK) — một lần mạng chập chờn không được đổi giao diện cổng.
    void api.get<PaymentConfig>('/payments/config').then((c) => setPaymentMode(c.mode)).catch(() => {});
    try {
      const res = await api.get<{ items: PublicFacility[]; unitTypes: UnitType[] }>('/facilities/public');
      setCatalog({ facilities: res.items, unitTypes: res.unitTypes });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tải được danh sách chi nhánh', 'error');
      setCatalog({ facilities: [], unitTypes: [] });
    }
  }, [toast]);

  // Phiên Firebase → POST /auth/sync (tạo/nối hồ sơ) → GET /bootstrap
  useEffect(() => {
    void reloadCatalog();
    if (!firebaseConfigured) { setReady(true); return; }
    return onAuthStateChanged(firebaseAuth(), async (fb) => {
      if (!fb) {
        userRef.current = null; setUser(null); setDb(EMPTY_DB); setReady(true);
        return;
      }
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

  const loginEmail = useCallback(
    (email: string, password: string) => wrapAuth(() => signInWithEmailAndPassword(firebaseAuth(), email.trim(), password)),
    [wrapAuth],
  );

  const register = useCallback((fullName: string, email: string, password: string, phone?: string) => wrapAuth(async () => {
    pendingName.current = fullName.trim();
    pendingPhone.current = phone?.trim() || undefined;
    pendingConsent.current = { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, method: 'SIGNUP_FORM' };
    const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
    await updateProfile(cred.user, { displayName: fullName.trim() });
    await sendEmailVerification(cred.user);
    setVerifyResendAt(Date.now() + VERIFY_RESEND_COOLDOWN_MS);
    toast('Đã gửi email xác minh — mở hộp thư để kích hoạt tài khoản', 'info');
  }), [wrapAuth, toast]);

  // Như Webapp (store.resendVerification / confirmVerification). BE chuyển PENDING_VERIFICATION → ACTIVE ở lần /auth/sync có token
  // email_verified — trước đây app chỉ đồng bộ lúc đăng nhập nên khách phải đăng xuất rồi vào lại mới đặt kho được.
  const resendVerification = useCallback(async (): Promise<boolean> => {
    const cu = firebaseConfigured ? firebaseAuth().currentUser : null;
    if (!cu) { toast('Vui lòng đăng nhập', 'error'); return false; }
    try {
      await sendEmailVerification(cu);
      setVerifyResendAt(Date.now() + VERIFY_RESEND_COOLDOWN_MS);
      toast(`Đã gửi lại email xác minh tới ${cu.email ?? 'email của bạn'}`, 'success');
      return true;
    } catch (e) {
      if (((e as { code?: string })?.code ?? '') === 'auth/too-many-requests') setVerifyResendAt(Date.now() + VERIFY_RESEND_COOLDOWN_MS);
      toast(authErrorMessage(e), 'error');
      return false;
    }
  }, [toast]);

  const confirmVerification = useCallback(async (): Promise<boolean> => {
    const cu = firebaseConfigured ? firebaseAuth().currentUser : null;
    if (!cu) { toast('Vui lòng đăng nhập', 'error'); return false; }
    try {
      await cu.reload();
      if (!cu.emailVerified) { toast('Email chưa xác minh — bấm link trong email rồi thử lại', 'error'); return false; }
      await cu.getIdToken(true); // token mới mang email_verified = true
      await api.post('/auth/sync', {});
      await refresh();
      if (userRef.current?.status !== 'ACTIVE') { toast('Chưa kích hoạt được tài khoản — thử lại sau ít phút', 'error'); return false; }
      toast('Đã xác minh email — tài khoản đã kích hoạt', 'success');
      return true;
    } catch (e) {
      toast(authErrorMessage(e), 'error');
      return false;
    }
  }, [refresh, toast]);

  // Khách bấm link xác minh trong app mail rồi quay lại app: tự kiểm tra lại (lặng lẽ — chưa xác minh thì không báo gì).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || userRef.current?.status !== 'PENDING_VERIFICATION') return;
      const cu = firebaseConfigured ? firebaseAuth().currentUser : null;
      if (!cu) return;
      void (async () => {
        try {
          await cu.reload();
          if (!cu.emailVerified) return;
          await cu.getIdToken(true);
          await api.post('/auth/sync', {});
          await refresh();
          if (userRef.current?.status === 'ACTIVE') toast('Đã xác minh email — tài khoản đã kích hoạt', 'success');
        } catch { /* lần sau bấm "Tôi đã xác minh" */ }
      })();
    });
    return () => sub.remove();
  }, [refresh, toast]);

  /** Nuốt auth/user-not-found để trang này không thành công cụ dò xem email nào đã đăng ký. */
  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    setBusy(true);
    try {
      await sendPasswordResetEmail(firebaseAuth(), email.trim());
      return true;
    } catch (e) {
      if (((e as { code?: string })?.code ?? '') === 'auth/user-not-found') return true;
      toast(authErrorMessage(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const logout = useCallback(async () => { await signOut(firebaseAuth()).catch(() => {}); }, []);

  const run = useCallback(async <K extends ActionName>(
    name: K, payload: Payload<K>, successText?: string | ((v: Value<K>) => string), onOk?: (v: Value<K>) => void,
  ): Promise<RunResult<Value<K>>> => {
    if (!userRef.current) { toast('Vui lòng đăng nhập', 'error'); return { ok: false, error: 'UNAUTHENTICATED' }; }
    setBusy(true);
    // Tải nền bỏ lượt khi đang có thao tác, và bỏ kết quả của lượt đã chạy trước khi thao tác bắt đầu.
    actionsInFlight.current += 1;
    actionEpoch.current += 1;
    try {
      const fn = actions[name] as unknown as (p: Payload<K>) => Promise<Value<K>>;
      const value = await fn(payload);
      await refresh();
      void reloadCatalog(); // chỗ trống / giá công khai có thể đã đổi
      if (successText) toast(typeof successText === 'function' ? successText(value) : successText, 'success');
      onOk?.(value);
      return { ok: true, value };
    } catch (e) {
      // Đợt VNPAY: 202 không phải lỗi và cũng chưa xong — không toast, không gọi onOk; cổng đọc `details` rồi mở trang VNPAY.
      if (e instanceof ApiError && e.code === 'GATEWAY_REDIRECT') return { ok: false, error: '', code: e.code, details: e.details };
      const msg = e instanceof Error ? e.message : String(e);
      // Mất mạng / quá thời gian chờ ở thao tác ghi: server có thể ĐÃ xử lý xong. Tải lại và để màn hình hiện theo trạng thái thật,
      // không báo "thất bại" khiến khách bấm lại.
      if (isNetworkError(e)) {
        try {
          await refresh();
          toast('Kết nối chậm — đã tải lại dữ liệu. Kiểm tra trạng thái trên màn hình trước khi thử lại.', 'info');
        } catch {
          toast(msg, 'error');
        }
        return { ok: false, error: msg, code: 'NETWORK' };
      }
      toast(msg, 'error');
      if (e instanceof ApiError && (e.code === 'TOKEN_REVOKED' || e.code === 'TOKEN_EXPIRED' || e.code === 'ACCOUNT_SUSPENDED')) await logout();
      else refresh().catch(() => {}); // server có thể đã đổi trạng thái (hết giờ giữ chỗ chẳng hạn)
      return { ok: false, error: msg, code: e instanceof ApiError ? e.code : undefined, details: e instanceof ApiError ? e.details : undefined };
    } finally {
      actionsInFlight.current -= 1;
      setBusy(false);
    }
  }, [refresh, reloadCatalog, toast, logout]);

  return (
    <StoreContext.Provider value={{
      refreshIfStale, db, user, catalog, paymentMode, busy, ready, firebaseReady: firebaseConfigured,
      loginEmail, register, resetPassword, resendVerification, verifyResendAt, confirmVerification, logout, refresh, reloadCatalog,
      run, toast, toasts, dismiss,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore phải nằm trong <StoreProvider>');
  return ctx;
}

/**
 * Góp ý 17/11 — kéo xuống để tải lại (các danh sách / màn chi tiết chính): `<ScrollView refreshControl={<RefreshControl {...pull} />}>`.
 * Lỗi mạng thì im lặng (dữ liệu cũ vẫn hiện), như Trang chủ.
 */
export function usePullRefresh() {
  const { refresh } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh().catch(() => {});
    setRefreshing(false);
  }, [refresh]);
  return { refreshing, onRefresh };
}

// ---- tiện ích tra cứu, giống Webapp/src/shared/lib/domain.ts nhưng chỉ phần khách cần
export const byId = <T extends { _id: string }>(arr: T[], id?: string | null) => (id ? arr.find((x) => x._id === id) : undefined);
export const facilityName = (db: DB, id?: string | null) => byId(db.facilities, id)?.name ?? '—';
export const unitLabel = (db: DB, id?: string | null) => byId(db.units, id)?.unitNumber ?? 'Chưa phân';
export const typeName = (db: DB, id?: string | null) => byId(db.unitTypes, id)?.name ?? '—';
export const userName = (db: DB, id?: string | null) => byId(db.users, id)?.fullName ?? '—';
/** Chính sách đang áp dụng cho chi nhánh: chính sách riêng còn hiệu lực, không có thì chính sách chung — như effectivePolicy ở Webapp. */
export function effectivePolicy(db: DB, facilityId?: string | null): BusinessPolicy | undefined {
  const f = byId(db.facilities, facilityId);
  const own = f?.policyId ? db.policies.find((p) => p._id === f.policyId && p.isActive) : undefined;
  return own ?? db.policies.find((p) => p.scope === 'GLOBAL' && p.isActive);
}
// Quy tắc bồi thường (Điều 6) dùng chung với BE / web: mức trách nhiệm theo giá thuê tháng của ô kho — xem claimCapOf ở @ssm/shared.
export { CLAIM_WINDOW_DAYS, claimTotal } from '@ssm/shared';
