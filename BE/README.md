# BE — Self-Storage API

Express 5 · Mongoose 8 (MongoDB Atlas) · Firebase Auth (email/password + Google) · Zod · shared types from `@ssm/shared`.

## 1. One-time setup

**MongoDB Atlas**
1. Create a cluster (M0 is fine — it is a replica set, so transactions work).
2. *Database Access* → add a user with *Read and write to any database*.
3. *Network Access* → add your IP (or `0.0.0.0/0` temporarily for dev).
4. *Connect → Drivers* → copy the `mongodb+srv://…` URI; put a database name before `?`, e.g. `/selfstorage?`.

**Firebase**
1. Create a project → *Authentication* → *Sign-in method* → enable **Email/Password** and **Google**.
2. *Project settings → Service accounts → Generate new private key* → take `project_id`, `client_email`, `private_key` from the JSON.
3. *Project settings → General → Your apps → Web app* → the web config is for Webapp/Mobile (step 3), not for BE.

**Env** — sao chép file mẫu rồi điền 4 biến bắt buộc (`MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`):
```bash
cp .env.example .env     # chạy trong BE/ ; BE/.env đã nằm trong .gitignore
```
| Biến tuỳ chọn | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `4000` | Cổng API |
| `CORS_ORIGINS` | `http://localhost:3000` | Các origin được gọi API, cách nhau bằng dấu phẩy — thêm domain Webapp đã deploy |
| `SEED_PASSWORD` | có sẵn trong `src/shared/config/env.ts` | Mật khẩu các tài khoản demo do `npm run seed` tạo (>= 8 ký tự) |
| `AUTH_DEV_BYPASS` | `false` | Chỉ để dev: nhận header `x-dev-user`. Bị bỏ qua khi `NODE_ENV=production` |
| `FIREBASE_WEB_API_KEY` | — | Có thì trang `/api` hiện ô đăng nhập lấy token (mục 3) |

> The service-account key is full admin access to your Firebase project. Keep it only in `BE/.env` (git-ignored). Never commit it or paste it anywhere.

## 2. Run
From the repo root (`WDP301/`):
```bash
npm install          # links @ssm/shared into BE
npm run seed         # ⚠ wipes the configured DB, loads the same demo data as the Webapp mock, creates Firebase demo logins
npm run api          # tsx watch — in ra sẵn các link doc
npm run docs         # mở Swagger trong trình duyệt (chạy ở cửa sổ khác)
npm run sync-indexes --workspace BE   # đồng bộ index Mongo theo schema (sau khi đổi index trong model)
```
Node ≥ 20.12 required (`process.loadEnvFile`).

## 3. API docs

Everything below is generated from the running code — there is no hand-written spec to keep in step.

`npm run api` prints the links on startup (Ctrl/Cmd-click them in VS Code's terminal):

```
  🚀  API        http://localhost:4000/api                (env=development)
  📘  Swagger    http://localhost:4000/api/docs           ← bấm vào đây để thử API
  📄  OpenAPI    http://localhost:4000/api/openapi.json   (dán vào Postman)
  📑  Tóm tắt    http://localhost:4000/api                (tiếng Việt, có ô lấy token)
  ❤   Health     http://localhost:4000/health
```

`npm run docs` (from the repo root, in a second terminal) opens Swagger in your browser. It is a separate
command on purpose: `npm run api` runs under `tsx watch` and restarts on every file save, so opening a tab
from there would spawn a new tab each time.

| Path | What |
|---|---|
| `/api/docs` | **Swagger UI** — has *Try it out*. |
| `/api/openapi.json` | OpenAPI 3.0.3, rebuilt on every request. Import into Postman/Insomnia/codegen. |
| `/api` | Compact Vietnamese reference page (searchable, no JS framework) + the token box below. |
| `/api/docs.json` | Same page's data as plain JSON. |
| `/health` | Liveness + Mongo connection state. |

Paths are relative because the docs follow whatever host served them — no base URL is configured anywhere.
`req.protocol` + `req.get('host')` build it per request, and `app.set('trust proxy', 1)` makes that resolve to
`https://…` behind Railway's proxy rather than `http://`. So the same code gives you
`http://localhost:4000/api` locally and `https://wdp301-production.up.railway.app/api` in production, and
Swagger's *Try it out* always calls the server you are actually looking at.

Swagger/OpenAPI above are the **API** contract (routes, request/response bodies). For the **data model** —
entities and how they relate (facilities → unit types → storage units → reservations → contracts, the swap-request
workflow, etc.) — see [`../erd.dbml`](../erd.dbml) at the repo root; paste it into
[dbdiagram.io](https://dbdiagram.io) for a visual ERD. It is hand-maintained, so re-check it after any schema
change under `features/*/*.model.ts`.

**Getting a token for *Try it out*.** Set `FIREBASE_WEB_API_KEY` (Firebase Console → Project settings → General → Your apps → Web app → `apiKey` — already public, it ships in the Webapp bundle) and `GET /api` grows an email/password box. The browser calls Firebase directly, so this server never sees the password; the token is stored in `localStorage` on this origin and `/api/docs` picks it up and presses Authorize for you.

**How the spec stays in sync.** `src/features/docs/openapi.ts` walks the routers listed in `src/routes.ts`
and reads what the route handlers were tagged with:

- paths + methods ← `router.stack` (`layer.route.path`)
- path/query/body params, required fields, types, enums, min/max ← the **zod schemas you already pass to `validate()`** (tagged via `SCHEMAS_TAG`)
- allowed roles ← the list you already pass to `authorize()` (tagged via `ROLES_TAG`)
- auth required? ← reference comparison against `authenticate` / `verifyFirebase`

So adding an endpoint or changing a zod schema updates Swagger on the next page load — nothing to keep in step by hand.
Only the prose descriptions come from the `API_GROUPS` table in `src/features/docs/docs.routes.ts`; a route missing from
that table still shows up in Swagger, just without a description.

Demo logins created by the seed: danh sách email nằm trong file cục bộ `TAI-KHOAN-DEMO.txt` (không đưa lên git); mật khẩu là `SEED_PASSWORD` trong `BE/.env`.

## 4. Auth flow
```
client ── Firebase signIn (email/password | Google) ──> idToken
client ── POST /api/auth/sync  (Bearer idToken) ──> creates CUSTOMER profile or links a pre-created one (verified email)
client ── any /api/*  (Bearer idToken)
BE     ── verifyIdToken(token, checkRevoked) → User by firebaseUid → role + facilityIds from Mongo → authorize → scope
```
- Role/scope live in Mongo only. Admin changes to role, branches or status call `revokeRefreshTokens`, so old tokens stop working at once.
- Staff accounts are created by ADMIN (`POST /api/users`), which creates the Firebase user and returns a password-reset link.

**Testing without a client (dev only):** set `AUTH_DEV_BYPASS=true` and send `x-dev-user: <email>` instead of a token.
```bash
curl -H "x-dev-user: <email-tai-khoan-demo>" http://localhost:4000/api/reservations?status=CONFIRMED
```

## 5. Endpoints (`/api`)
This table is prose only. The authoritative, always-current list is `GET /api/docs` (Swagger) / `GET /api/openapi.json`, generated from the route code itself.

| Method & path | Roles | Notes |
|---|---|---|
| `POST /auth/sync` · `GET /auth/me` | any signed-in | profile link / current user |
| `GET /bootstrap` | any signed-in | one scoped snapshot for the web dashboard (own data / branch data / chain data by role) |
| `GET /facilities/public` · `GET /facilities/public/:id?period=&periods=` | public | `{ items, unitTypes }` catalogue · detail với báo giá theo chu kỳ khách chọn (`period` = DAY/WEEK/MONTH) |
| `GET /facilities/public/:id/unit-types/:typeId/floor-plan` | public | sơ đồ 2D cơ bản — toàn bộ ô của loại kho kèm trạng thái, để khách bấm chọn ô còn trống lúc đặt |
| `GET /facilities` · `POST /facilities` · `PATCH /facilities/:id` | read: staff+ · write: OPS, ADMIN | scoped list for STAFF/FM |
| `GET /facilities/:id/unit-types` · `PATCH /facilities/unit-types/:id/price` | · OPS | `PATCH` body `{ rates: { DAY?, WEEK?, MONTH? } }` — sửa 1-3 giá chu kỳ |
| `GET /units?facilityId=` · `POST /units` · `PATCH /units/:id/status` | STAFF, FM, OPS · FM · STAFF, FM | manual status only AVAILABLE↔MAINTENANCE |
| `GET /reservations` · `GET /reservations/:id` | all (customers see own, staff see branch) | |
| `POST /reservations` | CUSTOMER | bắt buộc `unitId` (chọn ô cụ thể trên sơ đồ) + `rentalPeriod` + `preferredCheckInShift` (ca dự kiến nhận kho, mặc định `UNKNOWN`); CAS giữ ô ngay lập tức; `Idempotency-Key` header supported |
| `POST /reservations/batch` | CUSTOMER | đặt tối đa 10 ô một lần (giỏ hàng) trong một transaction — hoặc tất cả đều giữ được, hoặc không ô nào bị giữ |
| `POST /reservations/:id/pay-deposit` | CUSTOMER | mock gateway → CONFIRMED, tự cascade sang ALLOCATED (ô đã chọn từ lúc đặt), returns `qrPayload` |
| `POST /reservations/:id/qr` | CUSTOMER | cấp lại mã QR nhận kho cho app mobile; mỗi lần gọi vô hiệu mã đã cấp trước đó |
| `POST /reservations/:id/cancel` | owner / FM | refund per policy snapshot |
| `POST /reservations/:id/allocate` · `/unallocate` | FM | công cụ thủ công dự phòng — hiếm dùng vì ô đã chọn ngay lúc đặt |
| `GET /reservations/lookup?code=` | STAFF, FM | accepts code or `SSM:<code>:<token>` QR payload |
| `POST /reservations/:id/check-in` | STAFF, FM | creates contract + first rent (hình thức khoá lấy từ loại kho); returns PIN once |
| `GET /contracts` · `GET /contracts/:id` | all (scoped) | |
| `POST /contracts/:id/extend` | CUSTOMER | body `{ periods, method }` — cùng chu kỳ với hợp đồng đang chạy |
| `POST /contracts/:id/pay-balance` | CUSTOMER, STAFF, FM | lifts DELINQUENT/LOCKED_OUT |
| `POST /contracts/:id/lockout` · `/waive-late-fees` | FM · FM, OPS | waiver limited by policy |
| `POST /contracts/:id/move-out` · `/receive` · `/inspection` | owner/STAFF/FM · STAFF, FM · STAFF, FM | inspection settles deposit and closes contract |
| `GET /contracts/:id/swap-candidates` · `POST /contracts/:id/swap-unit` | owner/STAFF/FM · STAFF, FM | đổi NGAY sang ô cùng loại (sự cố khẩn cấp) — giá thuê và cọc giữ nguyên |
| `POST /contracts/:id/swap-requests` · `GET /contracts/:id/swap-requests` | CUSTOMER · scoped | khách GỬI YÊU CẦU đổi ô (xem `/swap-requests` bên dưới cho phần FM xét duyệt) |
| `GET /swap-requests` · `GET /swap-requests/:id` | STAFF, FM, OPS, ADMIN | hàng đợi yêu cầu đổi ô theo chi nhánh |
| `POST /swap-requests/:id/decide` | FACILITY_MANAGER | duyệt/từ chối; duyệt thì chốt phí (miễn nếu lỗi cơ sở hoặc lần đổi đầu) + hạn 7 ngày tự chuyển hoặc hẹn ngày thuê người chuyển |
| `POST /swap-requests/:id/complete` | STAFF, FM | xác nhận đã chuyển xong — lúc này mới thật sự đổi ô, hợp đồng cập nhật, thu phí nếu có |
| `POST /swap-requests/:id/cancel` | CUSTOMER | khách tự rút khi còn SUBMITTED |
| `GET /inspections?facilityId=` · `GET /payments` | scoped | |
| `GET /claims` · `GET /claims/:id` | all (customers see own, staff see branch) | `GET /claims/:id` trả kèm `liabilityCap` của hồ sơ |
| `POST /claims` | CUSTOMER, STAFF, FM | gửi hồ sơ bồi thường hư hỏng / mất mát — hạn 30 ngày từ sự cố, tối đa 3 hồ sơ đang mở mỗi hợp đồng, mức trách nhiệm tối đa 10 × tiền thuê một tháng của ô kho theo hợp đồng cho mỗi sự vụ — các hồ sơ cùng hợp đồng, cùng ngày sự cố được cộng chung (`shared/src/claim-rules.ts`) |
| `POST /claims/:id/review` · `/decide` · `/pay` · `/withdraw` | STAFF, FM, OPS · FM, OPS · STAFF, FM, OPS · CUSTOMER | tiếp nhận xác minh (mở lại hồ sơ vận hành đã quyết: chỉ OPS) · duyệt/từ chối — sự vụ có giá trị xét bồi thường trên 5.000.000 ₫ chỉ OPS quyết, người lập hồ sơ hộ khách không tự duyệt · chi: tiền mặt do người KHÁC người duyệt, chuyển khoản tạo lệnh chờ xác nhận qua `/payments/:id/confirm-payout` · khách rút hồ sơ |
| `GET/POST /tickets` · `POST /tickets/:id/assign|status|messages` | all (scoped) · FM · all | internal notes hidden from customers |
| `GET /policies` · `GET /policies/effective/:facilityId` · `POST /policies` | OPS/ADMIN/FM · any · OPS | publish = new immutable version |
| `GET/POST/PATCH /users` | ADMIN | Firebase user + revoke on privilege change; `shift` bắt buộc khi `role: STAFF` (1 trong `SHIFT_1..4` — hàng đợi nhận kho lọc theo ca), null với vai trò khác |
| `GET /audit` | ADMIN | append-only |
| `GET /reports/summary?facilityId=&months=` | FM (own), OPS, ADMIN | occupancy, revenue by month, receivables aging |

Errors: `{ "error": { "code", "message", "details" } }`. Codes include `SOLD_OUT`, `UNIT_NOT_AVAILABLE`, `INVALID_STATE_TRANSITION`, `FACILITY_SCOPE`, `OWNERSHIP`, `HOLD_EXPIRED`, `WAIVER_LIMIT`, `TOKEN_REVOKED`, `SWAP_ALREADY_OPEN`, `UNIT_STATE_MISMATCH`.

## 6. Background jobs (in-process)
- every minute: expire unpaid holds → `CANCELLED(HOLD_EXPIRED)`
- hourly billing also covers `MOVE_OUT_PENDING` contracts until staff receive the unit back (rent runs until actual handover)
- every 30 minutes: paid bookings not checked in within `noShowAfterHours` after the end of the start day → `CANCELLED(NO_SHOW)`, no refund, unit released
- hourly: issue due rent, mark `DELINQUENT` after the grace period (late fee), auto `LOCKED_OUT` after `lockoutAfterDays`

Run one API instance, or move `src/jobs` to a single worker before scaling out.

## 7. Structure

Mã nguồn chia theo **nghiệp vụ** (mỗi thư mục trong `features/` là một chức năng của app: route + service + model
của chức năng đó nằm cạnh nhau), phần dùng chung nằm trong `shared/`.

```
src/
  server.ts     bootstrap process (Mongo, jobs, listen)
  app.ts        Express app: middleware, docs, mount API_MOUNTS
  routes.ts     bảng gắn router duy nhất (prefix → router) — app.ts và openapi.ts đều đọc từ đây

  features/                     mỗi thư mục = 1 chức năng nghiệp vụ
    auth/         đăng nhập / đồng bộ hồ sơ Firebase
    users/        tài khoản & phân quyền (ADMIN)
    facilities/   chi nhánh, loại ô, ô kho, tồn kho & availability
    reservations/ đặt kho (khách chọn ô + chu kỳ trên sơ đồ), cọc, check-in
    contracts/    hợp đồng thuê, gia hạn, trả kho, biên bản bàn giao, đổi ô ngay (khẩn cấp)
    swaps/        yêu cầu đổi ô kho (khách gửi → FM duyệt → xác nhận hoàn tất)
    payments/     giao dịch thanh toán
    tickets/      phiếu hỗ trợ
    claims/       bồi thường hư hỏng / mất mát
    policies/     chính sách nghiệp vụ & bảng giá (pricing/quote)
    reports/      báo cáo lấp đầy, doanh thu, công nợ
    audit/        nhật ký thao tác (append-only)
    bootstrap/    snapshot dữ liệu đầu vào cho dashboard web
    docs/         trang tóm tắt tiếng Việt + sinh OpenAPI

  shared/                       hạ tầng dùng chung, không thuộc nghiệp vụ nào
    config/       env (zod), firebase-admin
    core/         errors, request context (AsyncLocalStorage)
    db/           connection, schema-kit, plugins (soft delete, append-only, actor stamps),
                  models.ts (barrel gom model của mọi feature), txn, apply-transition
    http/         context, authenticate (Firebase), authorize (roles), scope (facility/ownership),
                  validate (zod), tags
    utils/        dates

  jobs/         hold expiry, billing & delinquency
  scripts/      seed, sync-indexes
  types/        khai báo mở rộng Express
```

Quy ước:
- Một chức năng mới = thêm `src/features/<tên>/` gồm `<tên>.routes.ts`, `<tên>.service.ts`, `*.model.ts`,
  rồi khai báo router trong `src/routes.ts` — Swagger tự có ngay.
- `features/*` được phép import lẫn nhau (ví dụ `reservations` dùng `policies/pricing`), nhưng `shared/*`
  thì không bao giờ import ngược lên `features/*`, trừ đúng một chỗ: `shared/db/models.ts` gom model lại.
