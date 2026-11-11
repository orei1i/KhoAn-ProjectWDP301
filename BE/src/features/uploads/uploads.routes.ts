import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { EVIDENCE_PHOTO_MAX_BYTES, EVIDENCE_PHOTO_TYPES, type EvidencePhotoType } from '@ssm/shared';
import { NotFound, Unprocessable } from '../../shared/core/errors';
import { authenticate } from '../../shared/http/authenticate';
import { rateLimit } from '../../shared/http/rate-limit';
import { validate } from '../../shared/http/validate';
import { EvidencePhotoModel } from './evidence-photo.model';

export const uploadsRouter = Router();

/** Chữ ký đầu file — không tin contentType người gửi khai. */
const MAGIC: Record<EvidencePhotoType, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/**
 * Xem ảnh chứng cứ — KHÔNG cần đăng nhập (link khó đoán, xem evidence-photo.model.ts) để <img> trên web và app hiển thị trực tiếp.
 * Đặt TRƯỚC authenticate. Ảnh không đổi sau khi tải lên nên cho trình duyệt giữ lâu.
 */
uploadsRouter.get('/photos/:token', rateLimit({ windowMs: 60_000, max: 300, name: 'photo-view' }), validate({ params: z.object({ token: z.string().regex(TOKEN_RE) }) }), async (req, res) => {
  const p = await EvidencePhotoModel.findOne({ token: req.valid.params.token }, { contentType: 1, data: 1 }).lean();
  if (!p) throw NotFound('ảnh');
  res.setHeader('Content-Type', p.contentType);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  // helmet() mặc định chỉ cho cùng origin — web (Vercel) và app tải ảnh từ BE (Render) là khác origin.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(Buffer.from(p.data.buffer ?? p.data));
});

uploadsRouter.use(authenticate);

/**
 * Tải lên một ảnh chứng cứ (mọi vai trò đã đăng nhập): `{ dataUrl: "data:image/jpeg;base64,…" }` — JPG / PNG / WEBP ≤ 3MB (đã nén ở máy).
 * Trả `{ url }` để gửi kèm trong `photoUrls` của hồ sơ bồi thường, biên bản trả kho, đồ khách để lại… Giới hạn 60 ảnh / 10 phút / người.
 */
uploadsRouter.post('/photos', rateLimit({ windowMs: 10 * 60_000, max: 60, key: 'user', name: 'photo-upload' }), validate({ body: z.object({
  dataUrl: z.string().max(Math.ceil(EVIDENCE_PHOTO_MAX_BYTES * 1.37) + 64),
}) }), async (req, res) => {
  const m = DATA_URL.exec(req.valid.body.dataUrl);
  if (!m) throw Unprocessable('Chỉ nhận ảnh JPG, PNG hoặc WEBP', 'FILE_TYPE');
  const contentType = m[1] as EvidencePhotoType;
  const data = Buffer.from(m[2], 'base64');
  if (!data.length) throw Unprocessable('Ảnh trống', 'FILE_TYPE');
  if (data.length > EVIDENCE_PHOTO_MAX_BYTES) throw Unprocessable(`Ảnh tối đa ${EVIDENCE_PHOTO_MAX_BYTES / 1024 / 1024}MB`, 'FILE_TOO_LARGE');
  if (!EVIDENCE_PHOTO_TYPES.includes(contentType) || !MAGIC[contentType](data)) throw Unprocessable('File không phải ảnh JPG / PNG / WEBP hợp lệ', 'FILE_TYPE');
  const token = randomBytes(24).toString('base64url');
  await EvidencePhotoModel.create({ token, contentType, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), data, uploadedBy: req.auth!.user._id });
  res.status(201).json({ url: `${req.protocol}://${req.get('host')}/api/uploads/photos/${token}` });
});
