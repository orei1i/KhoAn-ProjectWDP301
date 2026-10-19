# KhoAn — Quản lý kho tự phục vụ (WDP301)

Hệ thống cho thuê kho tự phục vụ nhiều chi nhánh: khách đặt kho và thanh toán trên web/app, nhân viên và quản lý
vận hành trên web. Monorepo npm workspaces.

| Thư mục | Là gì | Trạng thái |
|---|---|---|
| `shared/` | `@ssm/shared` — enum, kiểu dữ liệu, state machine, nhãn tiếng Việt, hàm định dạng (dùng chung cho cả 3 app) | ✅ |
| `BE/` | Express 5 + Mongoose (MongoDB Atlas) + Firebase Auth — chi tiết ở [`BE/README.md`](BE/README.md) | ✅ |
| `Webapp/` | Next.js 16 + Tailwind v4, gọi API thật — đủ 5 vai trò (khách, nhân viên, quản lý chi nhánh, vận hành, quản trị). Chi tiết ở [`Webapp/README.md`](Webapp/README.md) | ✅ |
| `Mobile/React-Native/` | Expo Router — **chỉ dành cho khách hàng** (nhân viên dùng Webapp) | 🟡 xem bên dưới |

📊 Sơ đồ dữ liệu (ERD) đầy đủ: [`erd.dbml`](erd.dbml) — dán vào [dbdiagram.io](https://dbdiagram.io) (New Diagram → Import) để xem trực quan.

**Mobile đã có:** đăng nhập / đăng ký / quên mật khẩu, kho đang thuê, mã QR nhận kho, chọn chi nhánh → đặt kho → trả cọc,
chi tiết hợp đồng (trả công nợ, gia hạn, đăng ký trả kho), phiếu hỗ trợ (nhắn tin, đóng / mở lại) và yêu cầu bồi thường.
**Chưa có:** đính kèm ảnh cho phiếu hỗ trợ / bồi thường, đăng nhập Google (khách đăng nhập Google trên web thì đặt mật
khẩu ở trang `/dat-mat-khau` rồi dùng mật khẩu đó trên app). Thanh toán luôn **giả lập** — chưa tích hợp cổng thật (biến `MOCK_PAYMENTS` trong `env.ts` hiện chưa được đọc ở đâu).

## Yêu cầu

- Node ≥ 20.12 (`.nvmrc` ghim Node 22) — BE dùng `process.loadEnvFile`, không cần `dotenv`.
- Một cluster MongoDB Atlas (M0 là đủ, vì là replica set nên chạy được transaction).
- Một project Firebase bật Authentication (Email/Password + Google). Các bước lấy khoá xem `BE/README.md` mục 1.

## Chạy thử

Chạy ở thư mục gốc.

**1. Cài đặt**
```bash
npm install          # cài mọi workspace và link @ssm/shared
```

**2. Tạo file cấu hình** — sao chép file mẫu rồi điền giá trị thật
```bash
cp BE/.env.example BE/.env
cp Webapp/.env.local.example Webapp/.env.local
cp Mobile/React-Native/.env.example Mobile/React-Native/.env
```

| File | Phải điền | Ghi chú |
|---|---|---|
| `BE/.env` | `MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Bốn giá trị lấy từ Atlas và *Firebase Console → Project settings → Service accounts*. Biến tuỳ chọn: `BE/README.md` mục 1 |
| `Webapp/.env.local` | `NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID` | `NEXT_PUBLIC_API_URL` mặc định trỏ `http://localhost:4000/api` |
| `Mobile/React-Native/.env` | `EXPO_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID` | Bỏ trống `EXPO_PUBLIC_API_URL` thì app tự suy ra từ địa chỉ máy chạy Metro (điện thoại và máy tính cùng Wi-Fi) |

Bộ `apiKey / authDomain / projectId / appId` lấy ở *Firebase Console → Project settings → General → Your apps → Web app*
— dùng chung một bộ cho Webapp và Mobile. Các file `.env` nằm trong `.gitignore`; khoá service account của Firebase
là quyền admin toàn project, tuyệt đối không commit.

**3. Nạp dữ liệu demo rồi chạy** (mỗi lệnh một cửa sổ terminal)
```bash
npm run seed         # ⚠ XOÁ database đang cấu hình, nạp dữ liệu demo + tạo tài khoản đăng nhập demo trên Firebase
npm run api          # API   → http://localhost:4000/api   (Swagger: /api/docs)
npm run web          # Web   → http://localhost:3000
npm run mobile       # Mobile → Expo dev server
```
Web và Mobile đều gọi API thật nên phải chạy `npm run api` trước. Danh sách tài khoản demo nằm trong file cục bộ `TAI-KHOAN-DEMO.txt` (không đưa lên git); mật khẩu là `SEED_PASSWORD` trong `BE/.env`.

**Debug Mobile ngay trên trình duyệt:** sau `npm run mobile` bấm phím `w` (hoặc mở `http://localhost:8081`). Web của Expo chạy
ở origin `http://localhost:8081`, nên thêm origin đó vào `CORS_ORIGINS` trong `BE/.env`
(`CORS_ORIGINS=http://localhost:3000,http://localhost:8081`) rồi khởi động lại `npm run api`, nếu không trình duyệt chặn mọi lời gọi API.
Web ở đây là app Mobile chạy bằng `react-native-web` — khác với `npm run web` (Webapp Next.js, cổng 3000).

## Các lệnh ở thư mục gốc

| Lệnh | Việc |
|---|---|
| `npm run api` | BE chế độ watch (`tsx watch`) |
| `npm run start` | BE chế độ thường — lệnh Render dùng |
| `npm run web` | Webapp (Next.js dev) |
| `npm run mobile` | Expo dev server cho Mobile |
| `npm run seed` | Xoá DB và nạp lại dữ liệu demo |
| `npm run docs` | Mở Swagger trong trình duyệt (chạy khi `npm run api` đang chạy) |
| `npm run typecheck --workspace <BE\|Webapp\|@ssm/mobile>` | Kiểm tra kiểu một workspace |

## Cấu trúc mã nguồn

Cả ba app đều chia theo **chức năng nghiệp vụ**: mỗi thư mục trong `features/` là một chức năng của app, phần dùng
chung nằm trong `shared/`. Thêm chức năng mới = thêm một thư mục trong `features/`, không rải file ra nhiều tầng
`services/`, `models/`.

```
BE/src/                            Webapp/src/
  routes.ts   bảng mount router      app/         route Next.js (chia theo vai trò)
  features/                          features/
    auth/         đăng nhập            auth/          đặt / quên mật khẩu
    users/        tài khoản, RBAC      facilities/    chi nhánh, ô kho, ước lượng cỡ
    facilities/   chi nhánh, ô kho     reservations/  QR giữ chỗ / check-in
    reservations/ giữ chỗ, check-in    payments/      chọn hình thức thanh toán
    contracts/    hợp đồng, bàn giao   tickets/       luồng trao đổi phiếu hỗ trợ
    payments/     giao dịch            legal/         điều khoản & bảo mật
    tickets/      phiếu hỗ trợ       shared/
    claims/       bồi thường           ui/            component dùng chung, biểu đồ
    policies/     chính sách & giá     layout/        app-shell, header, toast
    reports/      báo cáo              api/           client REST, Firebase, actions
    audit/        nhật ký              store/         store toàn cục
    bootstrap/    snapshot dashboard   lib/           format, labels, domain, nav, mock-data
    docs/         Swagger / OpenAPI
  shared/       config, core, db, http, utils
  jobs/ scripts/ types/
```

**Mobile.** Expo Router bắt buộc file route nằm trong `app/`, nên `app/` chỉ chứa file một dòng trỏ về màn hình thật
trong `src/features/`; hai file `_layout.tsx` ở lại `app/` vì là layout của router, không phải màn hình.

```
app/login.tsx            →  src/features/auth/login-screen.tsx
app/(tabs)/index.tsx     →  src/features/home/home-screen.tsx
app/(tabs)/explore.tsx   →  src/features/facilities/explore-screen.tsx
app/(tabs)/support.tsx   →  src/features/tickets/support-screen.tsx
app/(tabs)/account.tsx   →  src/features/account/account-screen.tsx
app/facility/[id].tsx    →  src/features/facilities/facility-detail-screen.tsx
app/booking/[id].tsx     →  src/features/payments/booking-screen.tsx
app/qr/[id].tsx          →  src/features/reservations/qr-screen.tsx
app/contract/[id].tsx    →  src/features/contracts/contract-screen.tsx
app/contract/swap.tsx    →  src/features/contracts/swap-request-screen.tsx
app/ticket/new.tsx       →  src/features/tickets/ticket-new-screen.tsx
app/ticket/[id].tsx      →  src/features/tickets/ticket-detail-screen.tsx
app/claim/new.tsx        →  src/features/claims/claim-new-screen.tsx
app/claim/[id].tsx       →  src/features/claims/claim-detail-screen.tsx
src/shared/              ui/ (component + theme) · api/ (client, firebase, actions) · store/
```

Chi tiết quy ước BE ở `BE/README.md` mục 7.

## Triển khai

BE chạy trên **Render** (gói Free), Webapp trên Vercel, DB trên MongoDB Atlas. `render.yaml` là Blueprint của BE:
chỉ cài `BE` + `shared`, chạy `npm run start --workspace BE`, healthcheck `/health`, region Singapore, một instance
(các job nền chạy trong tiến trình — xem `BE/README.md` mục 6 trước khi tăng số instance).

1. **Atlas** → Network Access: cho phép `0.0.0.0/0` (Render Free không có IP ra cố định).
2. **Render** → New → Blueprint → chọn repo này → nhập `MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY`, `CORS_ORIGINS` (domain Vercel của Webapp). Biến tuỳ chọn thêm sau ở Service → Environment.
3. **Vercel** → `NEXT_PUBLIC_API_URL=https://<tên-service>.onrender.com/api` rồi Redeploy. **Mobile** → `EXPO_PUBLIC_API_URL`
   trong `Mobile/React-Native/.env` (cùng giá trị).
4. **Giữ BE thức**: Render Free ngủ sau 15 phút không có request (gọi lại mất ~1 phút) và khi ngủ thì job tính tiền /
   no-show / nhả giữ chỗ cũng dừng. Đặt một dịch vụ ping miễn phí (UptimeRobot, cron-job.org) gọi
   `https://<tên-service>.onrender.com/health` mỗi 10 phút. 750 giờ Free/tháng đủ cho một service chạy cả tháng.

Lưu ý gói Free: chặn cổng SMTP (465/587) → gửi email hợp đồng qua `MAIL_RELAY_URL` / `MAIL_RELAY_SECRET`
(`BE/.env.example`); không có Shell nên chạy `npm run seed` từ máy local trỏ vào Atlas. `railway.json` là cấu hình cũ
khi còn dùng Railway, giữ lại để tham khảo.
