# 📦 KhoAn — Hệ thống cho thuê kho tự phục vụ

Ứng dụng full-stack quản lý chuỗi kho tự phục vụ (self-storage) nhiều chi nhánh. Khách xem kho, chọn ô trên sơ đồ,
đặt cọc, ký hợp đồng online và nhận kho bằng mã QR; nhân viên, quản lý chi nhánh, bộ phận vận hành và quản trị viên
điều hành toàn bộ vòng đời thuê kho trên web: nhận kho, thu tiền, gia hạn, đổi ô, bồi thường, trả kho.

Đồ án môn **WDP301** — Đại học FPT.

![Node](https://img.shields.io/badge/Node-%E2%89%A520.12-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Auth-FFCA28?logo=firebase&logoColor=black)

🌐 **Web:** https://wdp-301-webapp.vercel.app · 🔌 **API:** https://khoan-api.onrender.com/api · 📚 **Swagger:** https://khoan-api.onrender.com/api/docs

> API chạy trên gói Free của Render nên có thể "ngủ" sau 15 phút không dùng — lần gọi đầu mất khoảng 1 phút.

## 📋 Mục lục

- [Tính năng](#-tính-năng)
- [Công nghệ](#️-công-nghệ)
- [Kiến trúc](#️-kiến-trúc)
- [Bắt đầu](#-bắt-đầu)
- [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
- [Tài liệu API](#-tài-liệu-api)
- [Triển khai](#-triển-khai)
- [Nhóm phát triển](#-nhóm-phát-triển)

## ✨ Tính năng

### 👤 Khách hàng (Web + Mobile)

**Tài khoản**
- Đăng ký / đăng nhập bằng email-mật khẩu hoặc Google (Firebase Authentication)
- Quên mật khẩu, đặt mật khẩu cho tài khoản Google để dùng trên app
- Hồ sơ cá nhân, tải bản sao dữ liệu, gửi yêu cầu sửa / xoá dữ liệu cá nhân

**Tìm và đặt kho**
- Xem chi nhánh, trang giới thiệu, bảng giá theo ngày / tuần / tháng
- Ước lượng cỡ kho theo đồ cần gửi
- Chọn ô cụ thể trên **sơ đồ 2D** (phân biệt ô đang chọn, còn trống, không thuê được)
- Đặt nhiều ô một lần (giỏ hàng), chọn **dịch vụ kèm** (hộp, thùng carton, vận chuyển…) — đơn riêng, thu tiền khi nhận kho
- Trả cọc, nhận **mã QR nhận kho**

**Hợp đồng**
- Xem trước và **ký hợp đồng online**, xác nhận bằng **mã OTP qua email**
- Tải hợp đồng PDF (hoặc bản scan nếu ký giấy tại quầy)
- Trả công nợ, gia hạn, yêu cầu đổi ô, đăng ký trả kho
- Báo mất chìa / thẻ, xin cấp lại mã truy cập

**Hỗ trợ**
- Phiếu hỗ trợ có nhắn tin hai chiều, đóng / mở lại
- Gửi **yêu cầu bồi thường** hư hỏng / mất mát, theo dõi trạng thái

### 🧑‍💼 Nhân viên chi nhánh

- Quét mã QR hoặc tra mã đặt chỗ để **nhận kho**: xác minh giấy tờ, **kiểm tra hàng hoá** (không có hàng cấm, dễ cháy, động vật…), giao chìa / thẻ / PIN
- **Ký hợp đồng giấy tại quầy**: in hợp đồng, tải bản scan lên hệ thống
- Thu tiền tại quầy, mở hộ kho, xử lý dịch vụ kèm
- Nhận lại kho, lập **biên bản kiểm tra** khi trả kho, quyết toán tiền cọc
- Thực hiện đổi ô, nhận việc được giao

### 🏢 Quản lý chi nhánh

- Quản lý ô kho, hợp đồng, công nợ, khoá kho khi nợ quá hạn
- Duyệt yêu cầu đổi ô, xét duyệt hồ sơ bồi thường
- Giao việc cho nhân viên, xử lý phiếu hỗ trợ
- Báo cáo công suất, doanh thu theo tháng, tuổi nợ

### ⚙️ Vận hành chuỗi

- Quản lý chi nhánh, loại kho, tồn kho, bảng giá
- Ban hành **chính sách** theo phiên bản (toàn chuỗi hoặc riêng chi nhánh): thời gian giữ chỗ, phí trễ hạn, mức khoá kho…
- Quản lý **mẫu hợp đồng**, danh mục dịch vụ kèm
- Duyệt & chi: bồi thường giá trị lớn, miễn phí trễ hạn, điều chỉnh biên bản trả kho, xoá nợ sau quyết toán, xác nhận đã chuyển khoản

### 🔐 Quản trị viên

- Tạo và phân quyền tài khoản nhân sự theo vai trò, chi nhánh, ca làm
- **Nhật ký hệ thống** (audit log, chỉ ghi thêm)
- Xử lý yêu cầu về dữ liệu cá nhân

### 🔧 Hệ thống

- **Máy trạng thái** cho đặt chỗ, hợp đồng, thanh toán, phiếu, bồi thường — chặn chuyển trạng thái sai
- **Transaction MongoDB** cho mọi thao tác tiền / ô kho; chống đặt trùng ô, chống trả tiền hai lần (idempotency key)
- **Job nền**: huỷ giữ chỗ quá hạn, huỷ khách không đến nhận kho, phát hành tiền thuê định kỳ, tính phí trễ hạn, tự khoá kho
- **Sinh hợp đồng PDF** (PDFKit) và gửi email (Nodemailer / mail relay)
- Phân quyền theo vai trò **và** theo chi nhánh trên từng API

## 🛠️ Công nghệ

**Backend** (`BE/`)
- Node.js + TypeScript, chạy bằng `tsx`
- Express 5, Helmet, CORS
- MongoDB Atlas + Mongoose 8 (replica set → transaction)
- Firebase Admin SDK (xác thực token, quản lý tài khoản)
- Zod (kiểm tra dữ liệu) + `zod-to-json-schema` → Swagger / OpenAPI tự sinh
- PDFKit (hợp đồng PDF), Nodemailer (email)

**Web** (`Webapp/`)
- Next.js 16 (App Router), React 19
- Tailwind CSS 4, Lucide icons
- Firebase Auth (client), `qrcode` (tạo mã QR), `jsQR` (quét mã QR bằng camera ở quầy)

**Mobile** (`Mobile/React-Native/`) — chỉ dành cho khách hàng
- Expo 57 + Expo Router, React Native 0.86
- `react-native-svg`, `react-native-qrcode-svg`, AsyncStorage

**Dùng chung** (`shared/` — gói `@ssm/shared`)
- Enum, kiểu dữ liệu, máy trạng thái, quy tắc nghiệp vụ (giá, cọc, phí, bồi thường…), nhãn tiếng Việt — cả BE, Web và Mobile cùng import

**Triển khai**
- API: Render · Web: Vercel · CSDL: MongoDB Atlas · Xác thực: Firebase

> Thanh toán hiện là **cổng giả lập** (VNPay / MoMo / thẻ / chuyển khoản / tiền mặt) — chưa tích hợp cổng thanh toán thật.

## 🏗️ Kiến trúc

Monorepo npm workspaces, một API REST dùng chung cho Web và Mobile:

```
┌──────────────────────────────┐      ┌──────────────────────────────┐
│   Webapp (Next.js 16)        │      │   Mobile (Expo / RN)         │
│   Khách · Nhân viên · QL     │      │   Chỉ khách hàng             │
│   Vận hành · Quản trị        │      │                              │
│   Vercel · :3000             │      │   Expo dev server · :8081    │
└──────────────┬───────────────┘      └──────────────┬───────────────┘
               │      Firebase signIn → idToken      │
               │◄──────────── Firebase Auth ────────►│
               │                                     │
               │        HTTPS / REST  (Bearer idToken)
               └──────────────────┬──────────────────┘
                                  │
               ┌──────────────────▼──────────────────┐
               │   BE — Express 5 API  (/api)        │
               │   Render · :4000                    │
               │   xác thực token → vai trò + chi    │
               │   nhánh từ MongoDB → phân quyền     │
               │                                     │
               │   features/  reservations ·         │
               │   contracts · payments · swaps ·    │
               │   claims · tickets · policies · …   │
               │   jobs/      tính tiền, huỷ quá hạn │
               └───────┬──────────────────┬──────────┘
                       │                  │
          ┌────────────▼─────────┐  ┌─────▼──────────────┐
          │  MongoDB Atlas       │  │  Email (SMTP /     │
          │  (transaction)       │  │  mail relay)       │
          └──────────────────────┘  └────────────────────┘

        shared/ (@ssm/shared) — enum, kiểu, máy trạng thái, quy tắc
        nghiệp vụ: BE, Webapp và Mobile cùng dùng một nguồn
```

📊 Sơ đồ dữ liệu (ERD) đầy đủ: [`erd.dbml`](erd.dbml) — dán vào [dbdiagram.io](https://dbdiagram.io) (New Diagram → Import) để xem.

## 🚀 Bắt đầu

### Yêu cầu

- Node.js ≥ 20.12 (`.nvmrc` ghim Node 22) — BE dùng `process.loadEnvFile`, không cần `dotenv`
- Một cluster MongoDB Atlas (gói M0 là đủ, vì là replica set nên chạy được transaction)
- Một project Firebase bật Authentication (Email/Password + Google). Cách lấy khoá xem [`BE/README.md`](BE/README.md) mục 1

### 1. Clone và cài đặt

```bash
git clone https://github.com/orei1i/KhoAn-ProjectWDP301.git
cd KhoAn-ProjectWDP301
npm install          # cài mọi workspace và link @ssm/shared
```

### 2. Tạo file cấu hình

Sao chép file mẫu rồi điền giá trị thật:

```bash
cp BE/.env.example BE/.env
cp Webapp/.env.local.example Webapp/.env.local
cp Mobile/React-Native/.env.example Mobile/React-Native/.env
```

| File | Phải điền | Ghi chú |
|---|---|---|
| `BE/.env` | `MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Lấy từ Atlas và *Firebase Console → Project settings → Service accounts*. Biến tuỳ chọn: `BE/README.md` mục 1 |
| `Webapp/.env.local` | `NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID` | `NEXT_PUBLIC_API_URL` mặc định trỏ `http://localhost:4000/api` |
| `Mobile/React-Native/.env` | `EXPO_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID` | Bỏ trống `EXPO_PUBLIC_API_URL` thì app tự suy ra từ địa chỉ máy chạy Metro (điện thoại và máy tính cùng Wi-Fi) |

Bộ `apiKey / authDomain / projectId / appId` lấy ở *Firebase Console → Project settings → General → Your apps → Web app*,
dùng chung cho Webapp và Mobile. Các file `.env` đã nằm trong `.gitignore`; khoá service account Firebase là quyền admin
toàn project, tuyệt đối không commit.

### 3. Nạp dữ liệu demo và chạy

Mỗi lệnh một cửa sổ terminal, chạy ở thư mục gốc:

```bash
npm run seed         # ⚠ XOÁ database đang cấu hình, nạp dữ liệu demo + tạo tài khoản demo trên Firebase
npm run api          # API    → http://localhost:4000/api   (Swagger: /api/docs)
npm run web          # Web    → http://localhost:3000
npm run mobile       # Mobile → Expo dev server
```

Web và Mobile đều gọi API thật nên phải chạy `npm run api` trước. Mật khẩu các tài khoản demo là `SEED_PASSWORD` trong `BE/.env`.

**Chạy Mobile trên trình duyệt:** sau `npm run mobile` bấm `w` (hoặc mở `http://localhost:8081`), và thêm origin này vào
`CORS_ORIGINS` trong `BE/.env` (`CORS_ORIGINS=http://localhost:3000,http://localhost:8081`) rồi khởi động lại API.

### Các lệnh ở thư mục gốc

| Lệnh | Việc |
|---|---|
| `npm run api` | BE chế độ watch (`tsx watch`) |
| `npm run start` | BE chế độ thường — lệnh Render dùng |
| `npm run web` | Webapp (Next.js dev) |
| `npm run mobile` | Expo dev server cho Mobile |
| `npm run seed` | Xoá DB và nạp lại dữ liệu demo |
| `npm run docs` | Mở Swagger trên trình duyệt (khi `npm run api` đang chạy) |
| `npm run typecheck --workspace <BE\|Webapp\|@ssm/mobile>` | Kiểm tra kiểu một workspace |

## 📁 Cấu trúc thư mục

Cả ba app chia theo **chức năng nghiệp vụ**: mỗi thư mục trong `features/` là một chức năng, phần dùng chung nằm trong `shared/`.

```
KhoAn-ProjectWDP301/
├── shared/                 # @ssm/shared — enum, kiểu, máy trạng thái, quy tắc nghiệp vụ
│
├── BE/                     # API — Express 5 + Mongoose
│   └── src/
│       ├── server.ts       # khởi động: Mongo, job nền, listen
│       ├── app.ts          # middleware, docs, gắn router
│       ├── routes.ts       # bảng gắn router (prefix → router)
│       ├── features/       # auth · users · facilities · reservations · contracts ·
│       │                   # payments · swaps · access · services · claims · tickets ·
│       │                   # policies · contract-templates · reports · privacy ·
│       │                   # notify · audit · bootstrap · docs
│       ├── jobs/           # job nền chạy trong tiến trình
│       ├── shared/         # config, core, db, http, utils
│       └── scripts/        # seed dữ liệu demo
│
├── Webapp/                 # Web — Next.js 16
│   └── src/
│       ├── app/
│       │   ├── (public)/   # trang chủ, chi nhánh, đặt kho, đăng nhập, điều khoản
│       │   ├── portal/     # khách hàng
│       │   ├── staff/      # nhân viên
│       │   ├── manager/    # quản lý chi nhánh
│       │   ├── ops/        # vận hành chuỗi
│       │   └── admin/      # quản trị
│       ├── features/       # component theo nghiệp vụ
│       └── shared/         # ui, layout, api client, store, lib
│
├── Mobile/React-Native/    # App khách hàng — Expo Router
│   ├── app/                # file route (trỏ về màn hình trong src/features)
│   └── src/
│       ├── features/       # auth · home · facilities · payments · reservations ·
│       │                   # contracts · tickets · claims · account
│       └── shared/         # ui, api, store
│
├── erd.dbml                # sơ đồ dữ liệu
├── render.yaml             # Blueprint triển khai BE lên Render
└── package.json            # npm workspaces
```

Quy ước chi tiết của BE ở [`BE/README.md`](BE/README.md) mục 7; luồng dữ liệu của Web ở [`Webapp/README.md`](Webapp/README.md).

## 📚 Tài liệu API

Swagger sinh tự động từ chính code route (schema Zod), nên luôn khớp với API đang chạy:

- Local: http://localhost:4000/api/docs · OpenAPI JSON: http://localhost:4000/api/openapi.json
- Online: https://khoan-api.onrender.com/api/docs

**Luồng xác thực**

```
client ── Firebase signIn (email/password | Google) ──> idToken
client ── POST /api/auth/sync   (Bearer idToken) ──> tạo / liên kết hồ sơ khách hàng
client ── mọi /api/*            (Bearer idToken)
BE     ── verifyIdToken → User trong Mongo → vai trò + chi nhánh → phân quyền
```

Lỗi trả về dạng `{ "error": { "code", "message", "details" } }`. Bảng endpoint tóm tắt và danh sách job nền: [`BE/README.md`](BE/README.md) mục 5–6.

## 🚢 Triển khai

| Thành phần | Nền tảng | Ghi chú |
|---|---|---|
| API (`BE/`) | **Render** (Free, Singapore) | `render.yaml`: chỉ cài `BE` + `shared`, healthcheck `/health`, 1 instance (job nền chạy trong tiến trình) |
| Web (`Webapp/`) | **Vercel** | `NEXT_PUBLIC_API_URL=https://<service>.onrender.com/api` |
| CSDL | **MongoDB Atlas** | Network Access cho phép `0.0.0.0/0` (Render Free không có IP cố định) |
| Mobile | Expo | `EXPO_PUBLIC_API_URL` trong `Mobile/React-Native/.env` |

Các bước:

1. **Render** → New → Blueprint → chọn repo → nhập `MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY`, `CORS_ORIGINS` (domain Vercel của Webapp).
2. **Vercel** → đặt `NEXT_PUBLIC_API_URL` rồi Redeploy.
3. **Giữ BE thức**: Render Free ngủ sau 15 phút không có request, khi ngủ thì job tính tiền / huỷ quá hạn cũng dừng.
   Đặt một dịch vụ ping miễn phí (UptimeRobot, cron-job.org) gọi `https://<service>.onrender.com/health` mỗi 10 phút.

Lưu ý gói Free: chặn cổng SMTP (465/587) → gửi email qua `MAIL_RELAY_URL` / `MAIL_RELAY_SECRET` (xem `BE/.env.example`);
không có Shell nên chạy `npm run seed` từ máy local trỏ vào Atlas. `railway.json` là cấu hình cũ khi còn dùng Railway.

## 👥 Nhóm phát triển

| Vai trò | Thành viên | Phụ trách |
|---|---|---|
| Backend | [Nguyen Thuong Hiep](https://github.com/orei1i) | Kiến trúc, cấu hình & triển khai, xác thực, tài khoản, chi nhánh, chính sách, báo cáo, nhật ký |
| Backend | [DoAnh](https://github.com/quanganh2712) | Đặt chỗ, hợp đồng, thanh toán, đổi ô, dịch vụ kèm, bồi thường, phiếu hỗ trợ, job nền |
| Frontend Web | [Lại Anh Đức](https://github.com/duclase184612-collab) | Nền tảng Webapp, trang công khai, cổng khách hàng |
| Frontend Web | [dbao3175](https://github.com/dbao3175) | Trang nhân viên, quản lý chi nhánh, vận hành, quản trị |
| Mobile | [duchocIT](https://github.com/duc2109) | App khách hàng React Native / Expo |

---

Đồ án môn WDP301 — Đại học FPT. Xây dựng bằng TypeScript, Express, MongoDB, Next.js và Expo.
