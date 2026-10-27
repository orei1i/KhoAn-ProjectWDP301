import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requestContext } from '../core/request-context';

/** Mã yêu cầu khách gửi kèm (x-request-id) chỉ được dùng lại khi gọn và an toàn để ghi log / nhật ký; sai thì sinh mã mới. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const contextMiddleware: RequestHandler = (req, res, next) => {
  const given = req.header('x-request-id');
  const requestId = given && SAFE_REQUEST_ID.test(given) ? given : randomUUID();
  res.setHeader('x-request-id', requestId);
  req.valid = {};
  requestContext.run({ requestId, ip: req.ip, userAgent: req.header('user-agent')?.slice(0, 200) }, next);
};
