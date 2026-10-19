import type { Request, RequestHandler } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseAuth } from '../config/firebase';
import { env } from '../config/env';
import { AppError, Forbidden, Unauthorized } from '../core/errors';
import { requestContext } from '../core/request-context';
import { UserModel } from '../db/models';

const bearer = (req: Request) => {
  const h = req.header('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

async function decode(token: string): Promise<DecodedIdToken> {
  try {
    // checkRevoked=true: admin role/scope changes and suspensions call revokeRefreshTokens → old tokens die immediately
    return await firebaseAuth.verifyIdToken(token, true);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/id-token-revoked') throw new AppError(401, 'TOKEN_REVOKED', 'Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại');
    if (code === 'auth/id-token-expired') throw new AppError(401, 'TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn');
    throw Unauthorized('Token không hợp lệ');
  }
}

/** Only verifies the Firebase token (no Mongo profile required). Used by POST /auth/sync. */
export const verifyFirebase: RequestHandler = async (req, _res, next) => {
  const token = bearer(req);
  if (!token) throw Unauthorized();
  req.firebase = await decode(token);
  next();
};

/** Như authenticate nhưng cho phép khách chưa đăng nhập đi qua (req.auth để trống) — dùng cho trang công khai có cá nhân hoá. */
export const optionalAuthenticate: RequestHandler = async (req, res, next) => {
  if (!bearer(req) && !(env.AUTH_DEV_BYPASS && req.header('x-dev-user'))) return next();
  return authenticate(req, res, next);
};

/** Firebase token → Mongo profile. Role and facility scope always come from Mongo, never from the client. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = bearer(req);
  let user = null;
  let decoded: DecodedIdToken | undefined;

  if (token) {
    decoded = await decode(token);
    user = await UserModel.findOne({ firebaseUid: decoded.uid });
    if (!user) throw new AppError(403, 'PROFILE_NOT_LINKED', 'Tài khoản chưa có hồ sơ trong hệ thống — gọi POST /api/auth/sync');
  } else if (env.AUTH_DEV_BYPASS && req.header('x-dev-user')) {
    user = await UserModel.findOne({ email: req.header('x-dev-user')!.toLowerCase() });
    if (!user) throw Unauthorized('x-dev-user không tồn tại');
  } else {
    throw Unauthorized();
  }

  if (user.status === 'SUSPENDED') throw Forbidden('Tài khoản đang bị tạm khóa', 'ACCOUNT_SUSPENDED');

  req.auth = { user, token: decoded };
  const ctx = requestContext.getStore();
  if (ctx) Object.assign(ctx, { userId: String(user._id), role: user.role, facilityIds: user.facilityIds.map(String) });
  next();
};
