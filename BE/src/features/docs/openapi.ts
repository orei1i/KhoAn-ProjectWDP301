import type { Router } from 'express';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { authenticate, verifyFirebase } from '../../shared/http/authenticate';
import type { RouteSchemas } from '../../shared/http/tags';
import { ROLES_TAG, SCHEMAS_TAG, readTag } from '../../shared/http/tags';
import { API_MOUNTS } from '../../routes';
import { API_GROUPS, ERROR_CODES } from './docs.routes';

/**
 * Sinh OpenAPI 3.0.3 TỪ CODE ĐANG CHẠY, không viết tay:
 *   - đường dẫn & method  ← đi qua router.stack của từng router trong API_MOUNTS
 *   - params/query/body   ← chính zod schema truyền vào validate() (nhãn SCHEMAS_TAG)
 *   - vai trò được phép   ← chính danh sách truyền vào authorize() (nhãn ROLES_TAG)
 *   - có cần token không  ← so sánh tham chiếu với middleware authenticate / verifyFirebase
 * Chỉ phần mô tả bằng chữ lấy từ bảng API_GROUPS trong docs.routes.ts; endpoint không có
 * mô tả vẫn xuất hiện đầy đủ trong Swagger, nên không bao giờ có route bị thiếu.
 */

// ---------------------------------------------------------------- đi qua router stack
type Handler = unknown;
interface RouteLayer { method?: string; handle?: Handler }
interface Layer { route?: { path: string | string[]; stack?: RouteLayer[] }; handle?: Handler }

interface Collected {
  method: string;
  fullPath: string;
  auth: boolean;
  roles?: string[];
  schemas?: RouteSchemas;
}

const joinPath = (prefix: string, p: string) => `${prefix}${p === '/' ? '' : p}`.replace(/\/{2,}/g, '/') || '/';

function walk(prefix: string, router: Router): Collected[] {
  const stack = (router as unknown as { stack?: Layer[] }).stack ?? [];
  const out: Collected[] = [];
  // middleware gắn ở cấp router (vd: reservationsRouter.use(authenticate)) áp cho mọi route phía sau
  let routerAuth = false;
  let routerRoles: string[] | undefined;

  for (const layer of stack) {
    if (!layer.route) {
      if (layer.handle === authenticate || layer.handle === verifyFirebase) routerAuth = true;
      const r = readTag<string[]>(layer.handle, ROLES_TAG);
      if (r) routerRoles = r;
      continue;
    }

    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    let auth = routerAuth;
    let roles = routerRoles;
    let schemas: RouteSchemas | undefined;
    const methods = new Set<string>();

    for (const sub of layer.route.stack ?? []) {
      if (sub.method) methods.add(sub.method.toLowerCase());
      if (sub.handle === authenticate || sub.handle === verifyFirebase) auth = true;
      const r = readTag<string[]>(sub.handle, ROLES_TAG);
      if (r) roles = r;
      const s = readTag<RouteSchemas>(sub.handle, SCHEMAS_TAG);
      if (s) schemas = s;
    }

    for (const p of paths) for (const m of methods) out.push({ method: m, fullPath: joinPath(prefix, p), auth, roles, schemas });
  }
  return out;
}

// ---------------------------------------------------------------- zod → JSON Schema
type Json = Record<string, unknown>;

const toSchema = (s: ZodTypeAny): Json =>
  zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' }) as Json;

function paramsOf(schema: ZodTypeAny | undefined, where: 'path' | 'query'): Json[] {
  if (!schema) return [];
  const js = toSchema(schema);
  const props = (js.properties as Record<string, Json> | undefined) ?? {};
  const required = (js.required as string[] | undefined) ?? [];
  return Object.entries(props).map(([name, sub]) => ({
    name,
    in: where,
    required: where === 'path' ? true : required.includes(name),
    ...(typeof sub.description === 'string' ? { description: sub.description } : {}),
    schema: sub,
  }));
}

// ---------------------------------------------------------------- mô tả bằng chữ (tùy chọn)
interface Prose { summary: string; notes?: string[]; tag: string }
const PROSE = new Map<string, Prose>();
for (const g of API_GROUPS) {
  for (const r of g.routes) PROSE.set(`${r.method.toUpperCase()} ${r.path}`, { summary: r.summary, notes: r.notes, tag: g.name });
}

const ERROR_MD = [
  '| HTTP | Code | Ý nghĩa |',
  '|---|---|---|',
  ...ERROR_CODES.map((e) => `| ${e.status} | \`${e.code}\` | ${e.meaning} |`),
].join('\n');

const INFO_MD = [
  'Tài liệu này **sinh trực tiếp từ code đang chạy**: đường dẫn, method, query, body, field bắt buộc, kiểu dữ liệu và vai trò được phép đều đọc từ `validate()` / `authorize()` trong các file route. Sửa schema → tải lại trang là thấy.',
  '',
  '### Đăng nhập để bấm "Try it out"',
  '1. Đăng nhập Firebase ở Webapp, lấy ID token: `await auth.currentUser.getIdToken()`',
  '2. Bấm **Authorize** ở góc phải → dán token vào `bearerAuth`',
  '3. Ở môi trường dev, nếu `AUTH_DEV_BYPASS=true` thì có thể bỏ qua Firebase: dùng `devUser` và điền email của một tài khoản đã có trong DB. Header này bị bỏ qua hoàn toàn khi `NODE_ENV=production`.',
  '',
  '### Quy ước',
  '- Mọi số tiền là **số nguyên VND**.',
  '- Ngày dạng `YYYY-MM-DD`, lưu theo ngày địa phương của chi nhánh lúc `00:00Z`.',
  '- Danh sách trả `{ items, total, page, limit }`; `page` bắt đầu từ 1.',
  '- `POST /reservations` nhận header `Idempotency-Key` để chống bấm hai lần.',
  '- Lỗi luôn có dạng `{ "error": { "code", "message", "details?" } }`, message tiếng Việt.',
  '',
  '### Mã lỗi',
  ERROR_MD,
  '',
  'Bản tóm tắt dễ đọc bằng tiếng Việt: [`GET /api`](/api) · bản JSON gọn: [`GET /api/docs.json`](/api/docs.json)',
].join('\n');

const ERR = { $ref: '#/components/responses/Error' } as const;
const opId = (m: string, p: string) => `${m}${p.replace(/[^a-zA-Z0-9]+/g, '_')}`.replace(/_+$/, '');

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Json> = {};
  const tags = new Set<string>();

  for (const { prefix, router } of API_MOUNTS) {
    for (const r of walk(prefix, router)) {
      const prose = PROSE.get(`${r.method.toUpperCase()} ${r.fullPath}`);
      const tagName = prose?.tag ?? (r.fullPath.split('/')[1] || 'khác');
      tags.add(tagName);

      const rolesLine = r.roles?.length
        ? `**Vai trò:** ${r.roles.join(', ')}`
        : r.auth ? '**Vai trò:** mọi vai trò đã đăng nhập' : '**Công khai** — không cần token';

      const description = [prose?.summary, rolesLine, ...(prose?.notes ?? []).map((n) => `- ${n}`)]
        .filter(Boolean).join('\n\n');

      // :id → {id} cho đúng cú pháp OpenAPI
      const oasPath = r.fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const parameters = [...paramsOf(r.schemas?.params, 'path'), ...paramsOf(r.schemas?.query, 'query')];

      const op: Json = {
        operationId: opId(r.method, r.fullPath),
        tags: [tagName],
        summary: prose?.summary ?? `${r.method.toUpperCase()} ${r.fullPath}`,
        description,
        ...(parameters.length ? { parameters } : {}),
        ...(r.schemas?.body ? { requestBody: { required: true, content: { 'application/json': { schema: toSchema(r.schemas.body) } } } } : {}),
        security: r.auth ? [{ bearerAuth: [] }, { devUser: [] }] : [],
        responses: {
          ...(r.method === 'post' ? { '201': { description: 'Đã tạo' } } : {}),
          '200': { description: 'Thành công' },
          '400': ERR,
          ...(r.auth ? { '401': ERR, '403': ERR } : {}),
          '404': ERR,
          '409': ERR,
          '422': ERR,
        },
      };

      (paths[oasPath] ??= {})[r.method] = op;
    }
  }

  return {
    openapi: '3.0.3',
    info: { title: 'Self-Storage Management API', version: '1.0.0', description: INFO_MD },
    servers: [{ url: serverUrl }],
    tags: [...tags].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Firebase ID token' },
        devUser: { type: 'apiKey', in: 'header', name: 'x-dev-user', description: 'Chỉ dev: email tài khoản, cần AUTH_DEV_BYPASS=true' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: [...new Set(ERROR_CODES.map((e) => e.code))] },
                message: { type: 'string' },
                details: {},
              },
            },
          },
        },
      },
      responses: {
        Error: { description: 'Lỗi — xem bảng mã lỗi ở phần mô tả', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}
