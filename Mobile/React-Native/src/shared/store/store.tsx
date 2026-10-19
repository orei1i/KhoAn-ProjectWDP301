import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updateProfile,
} from 'firebase/auth';
import type {
  AccessRequest, BusinessPolicy, DamageClaim, Facility, PaymentTransaction, RentalContract, Reservation, ServiceOffering, ServiceOrder,
  StorageUnit, SupportTicket, UnitCategory, UnitSwapRequest, UnitType, User,
} from '@ssm/shared';
import { PRIVACY_VERSION, TERMS_VERSION, withPolicyDefaults } from '@ssm/shared';
import { api, ApiError } from '../api/client';
import { actions, type ActionName, type Payload, type Value } from '../api/actions';
import { authErrorMessage, firebaseAuth, firebaseConfigured } from '../api/firebase';

/**
 * Cùng mô hình với Webapp: một ảnh chụp (snapshot) mọi dữ liệu khách được phép thấy, lấy qua
 * GET /bootstrap. Sau mỗi hành động thì tải lại toàn bộ thay vì tự vá state — chậm hơn một chút
 * nhưng không bao giờ lệch với server, và đó là thứ đáng giá hơn ở một app có tiền bạc.
 */

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
  swapRequests: UnitSwapRequest[];
  services: ServiceOffering[];
  serviceOrders: ServiceOrder[];
  accessRequests: AccessRequest[];
  policies: BusinessPolicy[];
}

const EMPTY_DB: DB = {
  users: [], facilities: [], unitTypes: [], units: [], reservations: [],
  contracts: [], payments: [], tickets: [], claims: [], swapRequests: [], services: [], serviceOrders: [], accessRequests: [], policies: [],
};

export interface PublicFacility extends Facility {
  fromPrice: number | null;
  availability: { unitTypeId: string; name: string; category: UnitCategory; total: number; free: number; holds: number; available: number }[];
}
export interface Catalog { facilities: PublicFacility[]; unitTypes: UnitType[] }

export type RunResult<V> = { ok: true; value: V } | { ok: false; error: string };
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
      try {
        await api.post('/auth/sync', {
          ...(pendingName.current ? { fullName: pendingName.current } : {}),
          ...(pendingPhone.current ? { phone: pendingPhone.current } : {}),
          ...(pendingConsent.current ? { consent: pendingConsent.current } : {}),
        });
        pendingName.current = undefined;
        pendingPhone.current = undefined;
        pendingConsent.current = undefined;
        await refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Không đồng bộ được tài khoản', 'error');
        await signOut(firebaseAuth()).catch(() => {});
      } finally {
        setReady(true);
      }
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
      toast(msg, 'error');
      if (e instanceof ApiError && (e.code === 'TOKEN_REVOKED' || e.code === 'TOKEN_EXPIRED' || e.code === 'ACCOUNT_SUSPENDED')) await logout();
      else refresh().catch(() => {}); // server có thể đã đổi trạng thái (hết giờ giữ chỗ chẳng hạn)
      return { ok: false, error: msg };
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
/**
 * Hạn mức trách nhiệm bồi thường cho một sự vụ. PHẢI khớp CLAIM_LIABILITY_CAP ở
 * BE/src/features/claims/claim-rules.ts — ở đây chỉ để hiển thị và chặn sớm trên form;
 * quyết định cuối cùng vẫn do server.
 */
export const CLAIM_LIABILITY_CAP = 20_000_000;
export const CLAIM_WINDOW_DAYS = 30;
export const claimTotal = (items: { quantity: number; unitValue: number }[]) =>
  items.reduce((sum, it) => sum + it.quantity * it.unitValue, 0);
