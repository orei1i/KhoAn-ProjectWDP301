import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requestContext } from '../core/request-context';

export const contextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = req.header('x-request-id') ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  req.valid = {};
  requestContext.run({ requestId, ip: req.ip, userAgent: req.header('user-agent')?.slice(0, 200) }, next);
};
