import type { Types } from 'mongoose';
import { ID_CHECK_MAX_FAILURES, ID_CHECK_WINDOW_HOURS, idCheckLocked } from '@ssm/shared';
import { AuditLogModel, RentalContractModel, ReservationModel, type UserHydrated } from '../../shared/db/models';
import { AppError, NotFound, Unprocessable } from '../../shared/core/errors';
import { assertFacility } from '../../shared/http/scope';
import { audit } from '../audit/audit.service';
import { notifyStaff } from '../notify/staff-notify';

/**
 * NHẬP SAI GIẤY TỜ khi đối chiếu tại quầy (mở kho hộ, giao thẻ / chìa mới, nhận kho, đặt tại quầy cho khách cũ).
 *  - Mỗi lần ID_MISMATCH / ID_REQUIRED ghi một dòng nhật ký DENIED NGOÀI transaction (giao dịch rollback vẫn còn dấu vết) — chỉ ghi
 *    mã lỗi, KHÔNG ghi số đã nhập.
 *  - Hợp đồng / đặt chỗ: sai lần thứ ID_CHECK_MAX_FAILURES trong ID_CHECK_WINDOW_HOURS giờ (đếm từ nhật ký, sau lần mở khoá gần nhất) →
 *    khoá đối chiếu (`idCheck.lockedAt`), trả 423 ID_CHECK_LOCKED và báo Quản lý chi nhánh qua email. Đang khoá thì mọi lần đối chiếu
 *    bị từ chối cho tới khi quản lý mở khoá (ghi lý do) hoặc hết 24 giờ.
 *  - Khách cũ đặt tại quầy (chưa có hợp đồng / đặt chỗ để khoá): chỉ ghi nhật ký.
 */
export type IdCheckKind = 'contract' | 'reservation' | 'customer';
export interface IdCheckTarget { kind: IdCheckKind; id: Types.ObjectId | string; facilityId: Types.ObjectId | string; label: string }

const ENTITY: Record<IdCheckKind, string> = { contract: 'RentalContract', reservation: 'Reservation', customer: 'User' };
const WINDOW_MS = ID_CHECK_WINDOW_HOURS * 3_600_000;
type LockState = { idCheck?: { lockedAt?: Date | null; unlockedAt?: Date | null; passedAt?: Date | null } | null };
type Stateful = LockState & { _id: Types.ObjectId; facilityId: Types.ObjectId };
const PROJ = { facilityId: 1, idCheck: 1 } as const;
const loadState = (kind: IdCheckKind, id: unknown) => (kind === 'contract'
  ? RentalContractModel.findById(id, PROJ).lean<Stateful>()
  : ReservationModel.findById(id, PROJ).lean<Stateful>());
const saveState = (kind: IdCheckKind, id: unknown, idCheck: Record<string, unknown>) => (kind === 'contract'
  ? RentalContractModel.updateOne({ _id: id }, { $set: { idCheck } })
  : ReservationModel.updateOne({ _id: id }, { $set: { idCheck } }));

const lockedError = () => new AppError(423, 'ID_CHECK_LOCKED',
  `Đã nhập sai giấy tờ ${ID_CHECK_MAX_FAILURES} lần — tạm khoá đối chiếu giấy tờ của hồ sơ này. Quản lý chi nhánh mở khoá (ghi lý do) hoặc chờ hết ${ID_CHECK_WINDOW_HOURS} giờ`);

/** Đang khoá thì từ chối ngay (gọi SAU khi đã kiểm phạm vi chi nhánh, TRƯỚC khi so giấy tờ). */
export function assertIdCheckOpen(doc: LockState) {
  if (idCheckLocked(doc)) throw lockedError();
}

/** Số lần nhập sai trong cửa sổ 24 giờ, chỉ tính từ lần đối chiếu đúng / lần mở khoá gần nhất (sai rồi nhập đúng thì đếm lại từ đầu). */
async function failuresSince(t: IdCheckTarget, state: LockState['idCheck']) {
  const marks = [Date.now() - WINDOW_MS, state?.unlockedAt ? state.unlockedAt.getTime() + 1 : 0, state?.passedAt ? state.passedAt.getTime() + 1 : 0];
  const from = Math.max(...marks);
  return AuditLogModel.countDocuments({ entityType: ENTITY[t.kind], entityId: t.id, action: `${t.kind}.id_mismatch`, result: 'DENIED', at: { $gte: new Date(from) } });
}

/**
 * Ghi lại một lần đối chiếu thất bại (ngoài transaction) và trả lỗi trả cho người dùng: lần thứ ID_CHECK_MAX_FAILURES → khoá + 423;
 * trước đó → ID_MISMATCH kèm số lần còn lại.
 */
async function recordFailure(t: IdCheckTarget, e: AppError): Promise<AppError> {
  const action = `${t.kind}.${e.code === 'ID_REQUIRED' ? 'id_required' : 'id_mismatch'}`;
  try {
    await audit({ action, result: 'DENIED', entityType: ENTITY[t.kind], entityId: t.id, facilityId: t.facilityId, reason: e.code });
  } catch (err) { console.error('audit failed', err); return e; }
  if (e.code !== 'ID_MISMATCH' || t.kind === 'customer') return e;

  const doc = await loadState(t.kind, t.id);
  if (idCheckLocked(doc)) return lockedError(); // khoá do lượt đồng thời khác
  const n = await failuresSince(t, doc?.idCheck);
  if (n < ID_CHECK_MAX_FAILURES) {
    const left = ID_CHECK_MAX_FAILURES - n;
    return new AppError(e.status, e.code, `${e.message} (còn ${left} lần nhập trước khi bị khoá đối chiếu)`, { remaining: left });
  }
  const now = new Date();
  await saveState(t.kind, t.id, { lockedAt: now, unlockedAt: doc?.idCheck?.unlockedAt ?? null, unlockedBy: null, unlockReason: null, passedAt: doc?.idCheck?.passedAt ?? null });
  await audit({ action: `${t.kind}.id_check_locked`, result: 'DENIED', entityType: ENTITY[t.kind], entityId: t.id, facilityId: t.facilityId, reason: `${n} lần nhập sai giấy tờ trong ${ID_CHECK_WINDOW_HOURS} giờ` }).catch((err) => console.error('audit failed', err));
  void notifyStaff({ roles: ['FACILITY_MANAGER'], facilityId: t.facilityId }, `KhoAn — Khoá đối chiếu giấy tờ ${t.label}`, [
    `Nhân viên đã nhập sai giấy tờ tùy thân ${n} lần trong ${ID_CHECK_WINDOW_HOURS} giờ khi đối chiếu cho ${t.label} — hệ thống tạm khoá việc mở kho hộ / giao thẻ, chìa / nhận kho của hồ sơ này.`,
    'Kiểm tra lại với khách / nhân viên; mở khoá trong trang quản lý (ghi lý do) nếu cần tiếp tục.',
  ]);
  return lockedError();
}

/**
 * Bọc một thao tác có đối chiếu giấy tờ: lỗi ID_MISMATCH / ID_REQUIRED thì ghi nhật ký (và khoá khi đủ số lần) rồi ném lỗi phù hợp.
 * `ref.target` được thao tác gán ngay khi biết hợp đồng / đặt chỗ (sau khi kiểm phạm vi chi nhánh) — lỗi xảy ra trước đó không ghi.
 */
export async function withIdCheckLog<T>(ref: { target?: IdCheckTarget }, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (ref.target && e instanceof AppError && (e.code === 'ID_MISMATCH' || e.code === 'ID_REQUIRED')) throw await recordFailure(ref.target, e);
    throw e;
  }
}

/** Quản lý chi nhánh MỞ KHOÁ đối chiếu giấy tờ của một hợp đồng / đặt chỗ (bắt buộc lý do) — đếm lại số lần sai từ đầu. */
export async function unlockIdCheck(user: UserHydrated, kind: 'contract' | 'reservation', id: string, reason: string) {
  const doc = await loadState(kind, id);
  if (!doc) throw NotFound(kind === 'contract' ? 'hợp đồng' : 'đặt chỗ');
  await assertFacility(user, doc.facilityId, `${kind}.id_check_unlock`);
  if (!idCheckLocked(doc)) throw Unprocessable('Hồ sơ này không bị khoá đối chiếu giấy tờ', 'ID_CHECK_NOT_LOCKED');
  const now = new Date();
  const idCheck = { lockedAt: null, unlockedAt: now, unlockedBy: user._id, unlockReason: reason.trim(), passedAt: doc.idCheck?.passedAt ?? null };
  await saveState(kind, doc._id, idCheck);
  await audit({ action: `${kind}.id_check_unlock`, entityType: ENTITY[kind], entityId: doc._id, facilityId: doc.facilityId, reason: idCheck.unlockReason, changes: { before: { lockedAt: doc.idCheck?.lockedAt ?? null }, after: { lockedAt: null } } });
  return { idCheck };
}

/** Đối chiếu ĐÚNG: ghi mốc trên hợp đồng (lưu cùng transaction của thao tác) — các lần sai trước đó không còn tính vào khoá. */
export function markIdCheckPassed(doc: { set(path: string, v: unknown): unknown; idCheck?: { unlockedAt?: Date | null; unlockedBy?: unknown; unlockReason?: string | null } | null }) {
  const prev = doc.idCheck;
  doc.set('idCheck', { lockedAt: null, unlockedAt: prev?.unlockedAt ?? null, unlockedBy: prev?.unlockedBy ?? null, unlockReason: prev?.unlockReason ?? null, passedAt: new Date() });
}

/** Nhãn hiển thị trong email báo quản lý. */
export const contractLabel = (c: { contractNumber: string }) => `hợp đồng ${c.contractNumber}`;
export const reservationLabel = (r: { code: string }) => `đặt chỗ ${r.code}`;
