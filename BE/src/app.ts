import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { env } from './shared/config/env';
import { errorHandler, NotFound } from './shared/core/errors';
import { contextMiddleware } from './shared/http/context';
import { docsRouter } from './features/docs/docs.routes';
import { buildOpenApi } from './features/docs/openapi';
import { API_MOUNTS } from './routes';
import { rateLimit } from './shared/http/rate-limit';

/** Swagger UI nạp asset cùng origin nhưng có inline script/style → nới CSP đúng cho nhánh /api/docs. */
const swaggerCsp: RequestHandler = (_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  next();
};

/**
 * `customJsStr` có thật trong swagger-ui-express nhưng @types/swagger-ui-express 4.1.x chưa khai báo
 * (chỉ có `customJs` — là URL, không phải mã inline). Ép kiểu đúng một chỗ ở đây thay vì nâng @types,
 * để việc nâng version không kéo theo thay đổi khác giữa lúc đang làm bài.
 */
const swaggerSetup = swaggerUi.setup as unknown as (doc: undefined, opts: Record<string, unknown>) => RequestHandler;

/**
 * Trang /api cho đăng nhập email/password rồi lưu token vào localStorage.
 * Đoạn này chạy trong Swagger UI, đọc lại token đó và gọi authActions.authorize
 * để khỏi phải dán tay. Hỏng thì im lặng — vẫn bấm Authorize thủ công được.
 */
const AUTO_AUTHORIZE = `(function () {
  var saved; try { saved = JSON.parse(localStorage.getItem('ssm_api_token') || 'null'); } catch (e) { saved = null; }
  if (!saved || !saved.token || !(saved.exp > Date.now())) return;
  var n = 0;
  var iv = setInterval(function () {
    if (++n > 150) { clearInterval(iv); return; }
    var ui = window.ui;
    if (!ui || !ui.authActions || !ui.specSelectors) return;
    var defs = ui.specSelectors.securityDefinitions && ui.specSelectors.securityDefinitions();
    if (!defs) return;
    clearInterval(iv);
    try {
      ui.authActions.authorize({ bearerAuth: { name: 'bearerAuth', schema: { type: 'http', scheme: 'bearer' }, value: saved.token } });
      console.log('[SSM] Đã tự điền token của ' + (saved.email || '') + ' — hết hạn lúc ' + new Date(saved.exp).toLocaleTimeString());
    } catch (e) { console.warn('[SSM] Không tự điền được token, bấm Authorize thủ công.', e); }
  }, 100);
})();`;

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: false, exposedHeaders: ['x-request-id'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(contextMiddleware);

  app.get('/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

  const api = express.Router();

  // --- tài liệu: trang tóm tắt tiếng Việt, spec OpenAPI, và Swagger UI có "Try it out"
  api.use(docsRouter);                       // GET /api · GET /api/docs.json
  api.get('/openapi.json', (req, res) => {   // sinh lại mỗi request → luôn khớp code đang chạy
    res.json(buildOpenApi(`${req.protocol}://${req.get('host') ?? 'localhost'}/api`));
  });
  // Không truyền spec sẵn — Swagger UI tự nạp qua swaggerOptions.url bên dưới, nên luôn khớp code đang chạy.
  api.use('/docs', swaggerCsp, swaggerUi.serve, swaggerSetup(undefined, {
    explorer: true,
    customSiteTitle: 'Self-Storage API',
    swaggerOptions: { url: '/api/openapi.json', persistAuthorization: true, docExpansion: 'none', tryItOutEnabled: true },
    // Nhận token mà trang /api vừa lấy (cùng origin → chung localStorage) và tự bấm Authorize.
    customJsStr: AUTO_AUTHORIZE,
  }));

  // --- nghiệp vụ (cùng bảng mà openapi.ts đọc để sinh spec)
  // Trần chung theo IP cho mọi API (chống dò / làm nghẽn) — các route nhạy cảm có trần riêng chặt hơn.
  api.use(rateLimit({ windowMs: 60_000, max: 1200, name: 'api' }));
  for (const m of API_MOUNTS) api.use(m.prefix, m.router);
  app.use('/api', api);

  app.use((req) => { throw NotFound(`route ${req.method} ${req.path}`); });
  app.use(errorHandler);
  return app;
}
