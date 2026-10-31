import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updateProfile,
} from 'firebase/auth';
import type {
  AccessRequest, BusinessPolicy, DamageClaim, Facility, InspectionLog, IntakeBatch, PaymentTransaction, RentalContract, Reservation, ServiceOffering, ServiceOrder,
  StorageUnit, SupportTicket, UnitCategory, UnitSwapRequest, UnitType, User,
} from '@ssm/shared';
import { PRIVACY_VERSION, TERMS_VERSION, withPolicyDefaults } from '@ssm/shared';
import { api, ApiError, isNetworkError } from '../api/client';
import { actions, type ActionName, type Payload, type Value } from '../api/actions';
import { authErrorMessage, firebaseAuth, firebaseConfigured } from '../api/firebase';

/**
 * Cùng mô hình với Webapp: một ảnh chụp (snapshot) mọi dữ liệu khách được phép thấy, lấy qua
 * GET /bootstrap. Sau mỗi hành động thì tải lại toàn bộ thay vì tự vá state — chậm hơn một chút
 * nhưng không bao giờ lệch với server, và đó là thứ đáng giá hơn ở một app có tiền bạc.
 */

/** Lỗi tạm thời (mất mạng, máy chủ đang khởi động, 429 giới hạn tần suất) → thử lại thay vì bắt đăng nhập lại ngay. */
const isTransient = (e: unknown) => !(e instanceof ApiError) || e.status === 429 || e.status >= 500;
const SYNC_RETRY_MS = [2_000, 5_000, 12_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  db: DB;
  user: User | null;
  catalog: Catalog | null;
  busy: boolean;
  /** false khi Firebase còn đang khôi phục phiên — dùng để hiện màn chờ, đừng kết luận "chưa đăng nhập". */
  ready: boolean;
  firebaseReady: boolean;
  loginEmail: (email: string, password: string) => Promise<boolean>;
  register: (fullName: string, email: string, password: string, phone?: string) => Promise<boolean>;
  resetPassword: (email: string) => Promise<boolean>;
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
  const [toasts, setToasts] = useState<Toast[]>([]);
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

  const refresh = useCallback(async () => {
    const snap = await api.get<DB & { me: User }>('/bootstrap');
    const { me, ...rest } = snap;
    // App chỉ dành cho khách thuê — tài khoản nhân viên / quản lý / quản trị dùng trang web. Không nạp dữ liệu; lỗi không tạm thời
    // nên vòng đồng bộ bên dưới báo lỗi và đăng xuất.
    if (me.role !== 'CUSTOMER') throw new ApiError(403, 'NOT_CUSTOMER', 'Ứng dụng dành cho khách thuê — nhân viên dùng trang web');
    userRef.current = me;
    setUser(me);
    // Chính sách cũ trong DB có thể thiếu earlyTermination/abandonAfterLockedOutDays — điền mặc định để các màn không sập.
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
    toast('Đã gửi email xác minh — mở hộp thư để kích hoạt tài khoản', 'info');
  }), [wrapAuth, toast]);

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
    try {
      const fn = actions[name] as unknown as (p: Payload<K>) => Promise<Value<K>>;
      const value = await fn(payload);
      await refresh();
      void reloadCatalog(); // chỗ trống / giá công khai có thể đã đổi
      if (successText) toast(typeof successText === 'function' ? successText(value) : successText, 'success');
      onOk?.(value);
      return { ok: true, value };
    } catch (e) {
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
      setBusy(false);
    }
  }, [refresh, reloadCatalog, toast, logout]);

  return (
    <StoreContext.Provider value={{
      db, user, catalog, busy, ready, firebaseReady: firebaseConfigured,
      loginEmail, register, resetPassword, logout, refresh, reloadCatalog,
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
