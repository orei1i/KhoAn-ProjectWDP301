import { Router } from 'express';
import { z } from 'zod';
import { authenticate, verifyFirebase } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { rateLimit } from '../../shared/http/rate-limit';
import { exportMyData } from '../privacy/privacy.service';
import { validate, zIdLast4, zIdType, zPayoutAccount, zPersonName, zProfilePhone } from '../../shared/http/validate';
import { assertCurrentConsent, recordConsent, selfView, syncProfile, updateMyProfile } from '../users/user.service';
import { audit } from '../audit/audit.service';

export const authRouter = Router();

/**
 * Call once after every Firebase sign-in (email/password or Google). Creates or links the Mongo profile.
 * Giới hạn theo TÀI KHOẢN (sau khi xác minh token), trần theo IP chỉ để chặn spam: cả lớp chung một mạng mở app cùng lúc
 * không được làm nhau bị 429 (client coi lỗi đồng bộ là phải đăng nhập lại).
 */
authRouter.post('/sync', rateLimit({ windowMs: 60_000, max: 600, name: 'sync-ip' }), verifyFirebase, rateLimit({ windowMs: 60_000, max: 20, key: 'user', name: 'sync' }), validate({ body: z.object({
  // Họ tên nhập ở form đăng ký — phải là tên thật vì được in vào hợp đồng.
  fullName: zPersonName.optional(),
  phone: zProfilePhone.optional(), // form đăng ký hỏi luôn số điện thoại; trùng với tài khoản khác thì bỏ qua, khách bổ sung sau
  // BẮT BUỘC khi tạo hồ sơ mới (422 CONSENT_REQUIRED) — kể cả đăng nhập Google lần đầu; phải đúng bản hiện hành (409 CONSENT_OUTDATED).
  // Gửi kèm khi đăng nhập lại thì ghi nhận lần đồng ý gần nhất. Thời điểm / IP do server đóng dấu.
  consent: z.object({
    termsVersion: z.string().min(1).max(20),
    privacyVersion: z.string().min(1).max(20),
    method: z.enum(['SIGNUP_FORM', 'GOOGLE']),
  }).optional(),
}) }), async (req, res) => {
  const { user, created } = await syncProfile(req.firebase!, req.valid.body, req.ip ?? null);
  res.status(created ? 201 : 200).json({ user: selfView(user) });
});

/** Hồ sơ của chính mình. `consentRequired: true` → khách phải đồng ý lại bản Điều khoản / Chính sách mới (POST /auth/me/consent). */
authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: selfView(req.auth!.user) });
});

/**
 * Khách ĐỒNG Ý LẠI bản Điều khoản + Chính sách bảo mật hiện hành (khi `consentRequired`) — chỉ nhận đúng phiên bản hiện hành (409
 * CONSENT_OUTDATED). Ghi thời điểm, IP vào User.consentLatest và nhật ký.
 */
authRouter.post('/me/consent', authenticate, authorize('CUSTOMER'), validate({ body: z.object({
  termsVersion: z.string().min(1).max(20), privacyVersion: z.string().min(1).max(20),
}) }), async (req, res) => {
  const me = req.auth!.user;
  assertCurrentConsent(req.valid.body);
  const consentLatest = await recordConsent(me._id, { ...req.valid.body, ip: req.ip ?? null }, 'RECONSENT');
  await audit({ action: 'user.consent', entityType: 'User', entityId: me._id, changes: { after: { termsVersion: consentLatest.termsVersion, privacyVersion: consentLatest.privacyVersion } } });
  me.consentLatest = consentLatest;
  res.json({ user: selfView(me) });
});

/** Quyền được biết / truy cập (pháp luật về bảo vệ dữ liệu cá nhân): khách tự tải bản sao dữ liệu KhoAn đang lưu về mình (JSON). */
authRouter.get('/me/export', authenticate, authorize('CUSTOMER'), rateLimit({ windowMs: 60_000, max: 5, key: 'user', name: 'export' }), async (req, res) => {
  const data = await exportMyData(req.auth!.user);
  res.setHeader('Content-Disposition', `attachment; filename="khoan-du-lieu-ca-nhan-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

/**
 * Tự cập nhật thông tin nhận diện in vào hợp đồng / phụ lục ký về sau: họ tên, số điện thoại, (khách) loại giấy tờ + 4 số cuối.
 * Gửi trường nào sửa trường đó. Khách phải đủ cả ba mới đặt kho / ký / gia hạn được (xem profileGaps).
 */
authRouter.patch('/me', authenticate, validate({ body: z.object({
  fullName: zPersonName.optional(), phone: zProfilePhone.optional(),
  idType: zIdType.optional(), idNumberLast4: zIdLast4.optional(),
  payoutAccount: zPayoutAccount.nullable().optional(), // null = xoá tài khoản nhận tiền hoàn đã khai
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Không có thông tin nào để cập nhật')
  .refine((b) => (b.idType === undefined) === (b.idNumberLast4 === undefined), 'Loại giấy tờ và 4 số cuối phải nhập cùng nhau') }), async (req, res) => {
  res.json({ user: selfView(await updateMyProfile(req.auth!.user, req.valid.body)) });
});
