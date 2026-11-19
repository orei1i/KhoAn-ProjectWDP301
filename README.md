# 📦 KhoAn — Hệ thống cho thuê kho tự phục vụ

Ứng dụng full-stack quản lý chuỗi kho tự phục vụ (self-storage) nhiều chi nhánh. Khách xem kho, chọn ô trên sơ đồ 2D
hoặc mô hình 3D, trả tiền giữ chân qua VNPAY, ký hợp đồng online bằng mã OTP và nhận kho bằng mã QR. Nhân viên, quản lý
chi nhánh, bộ phận vận hành và quản trị viên điều hành toàn bộ vòng đời thuê kho trên web: nhận kho, thu tiền, nhập hàng,
gia hạn, đổi ô, bồi thường, trả kho.

Đồ án môn **WDP301** — Đại học FPT.

![Node](https://img.shields.io/badge/Node-%E2%89%A520.12-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Auth-FFCA28?logo=firebase&logoColor=black)
![VNPAY](https://img.shields.io/badge/VNPAY-sandbox-005BAA)

🌐 **Web:** https://wdp-301-webapp.vercel.app · 🔌 **API:** https://khoan-api.onrender.com/api · 📚 **Swagger:** https://khoan-api.onrender.com/api/docs · 📱 **Mobile:** chạy bằng Expo Go

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
- Đăng ký / đăng nhập bằng email-mật khẩu (web và app) hoặc Google (chỉ web) — Firebase Authentication
- Quên mật khẩu; tài khoản Google đặt mật khẩu ở trang `/dat-mat-khau` để đăng nhập app
- Hồ sơ cá nhân, tải bản sao dữ liệu, gửi yêu cầu sửa / xoá dữ liệu cá nhân
- Đồng ý lại khi Điều khoản / Chính sách bảo mật đổi phiên bản (hiện hành: Điều khoản **1.24**, Chính sách bảo mật **1.11**)

**Tìm và đặt kho**
- Xem chi nhánh, trang giới thiệu, bảng giá theo ngày / tuần / tháng; ước lượng cỡ kho theo đồ cần gửi
- Chọn ô cụ thể trên **sơ đồ 2D** hoặc **mô hình 3D** (web) — phân biệt ô đang chọn, còn trống, không thuê được
- Đặt nhiều ô một lần (giỏ hàng, tối đa 10 ô), chọn **gói bảo vệ** đồ gửi và **dịch vụ kèm** (hộp, thùng carton, vận chuyển…)
- Trả tiền giữ chân online qua **VNPAY**, hoặc chọn trả tại quầy / khi nhận kho; nhận **mã QR nhận kho**
- Đổi ngày nhận kho (tối đa 3 lần mỗi đặt chỗ)

**Hợp đồng**
- Xem trước và **ký hợp đồng online**, xác nhận bằng **mã OTP qua email** (hoặc ký giấy tại quầy)
- Tải hợp đồng, phụ lục PDF (hoặc bản scan nếu ký giấy tại quầy)
- Khai đồ gửi theo **đợt nhập hàng**, xem danh sách đồ đang gửi
- Trả công nợ, gia hạn, đăng ký trả kho
- Yêu cầu **đổi ô / đổi cỡ kho**: tự chuyển hoặc **thuê người chuyển** — chọn danh sách đồ cần chuyển, tự dời ngày chuyển
  tối đa 2 lần, xem **biên bản chuyển đồ** sau khi chi nhánh chuyển xong
- Xem mật khẩu mở kho (PIN), báo mất chìa / thẻ, xin cấp lại; thêm người được uỷ quyền
- **Trả kho**: đọc mã OTP gửi về email để xác nhận biên bản; theo dõi khoản hoàn và khai tài khoản nhận tiền
- App: thẻ **"Kho đã thuê"** giữ lại các hợp đồng đã kết thúc

**Hỗ trợ**
- Phiếu hỗ trợ có nhắn tin hai chiều, đóng / mở lại; bấm gửi hai lần (hoặc app gửi lại khi mạng chậm) trong 60 giây
  không tạo phiếu thứ hai
- Gửi **yêu cầu bồi thường** hư hỏng / mất mát kèm ảnh: trong 30 ngày kể từ sự cố, và tới 30 ngày sau khi trả kho.
  Chưa rõ nguyên nhân thì chọn **"Khác"** — chi nhánh xác định nguyên nhân rồi mới duyệt

### 🧑‍💼 Nhân viên chi nhánh

- **Đặt chỗ tại quầy** cho khách vãng lai (xác minh email của khách bằng mã OTP)
- **Nhận kho**: quét mã QR hoặc tra mã đặt chỗ → **đối chiếu giấy tờ trước** (4 số cuối, sai 5 lần trong 24 giờ thì khoá),
  rồi mới thu tiền; giao chìa / thẻ / PIN
- **Thu tại quầy** chỉ bằng **tiền mặt** hoặc **VNPAY** (màn quầy hiện mã QR của link VNPAY để khách quét); **một biên lai**
  PDF cho cả lần thu
- **Ký hợp đồng giấy tại quầy**: in hợp đồng, tải bản scan lên — hệ thống tự gửi email hợp đồng đã ký cho khách
- Kiểm **đợt nhập hàng** theo danh mục hàng cấm (hàng cấm, chất dễ cháy nổ, động vật sống…), xác nhận hoặc từ chối
- **Trả kho, bước 1**: nhận lại ô, lập biên bản kiểm tra (danh mục kiểm, hư hại kèm ảnh, đồ khách để lại) — **không ghi
  tiền**. Sau khi quản lý duyệt, gửi mã OTP tới email khách để khách xác nhận
- Đổi ô "Thuê người chuyển": tick từng món theo danh sách, lập **biên bản chuyển đồ** (số kiện, ảnh tại ô mới)
- Mở hộ kho, cấp lại thẻ / chìa, xử lý dịch vụ kèm
- Trang việc: **Công việc của tôi** / **Đã hoàn thành**

### 🏢 Quản lý chi nhánh

- Quản lý ô kho, hợp đồng, công nợ; khoá kho khi nợ quá hạn
- **Trả kho, bước 2**: ghi phí sửa chữa từng hư hại và phí khác rồi **duyệt**, hoặc **trả lại** để nhân viên sửa biên bản;
  khách vắng mặt thì quản lý xác nhận thay (ghi lý do)
- Duyệt yêu cầu đổi ô — hộp duyệt "Thuê người chuyển" hiện trước **danh sách đồ sẽ chốt**; dời ngày chuyển
- Xét duyệt bồi thường tới 5.000.000 ₫; nguyên nhân "Khác" phải đổi sang nguyên nhân cụ thể mới duyệt được
- Trang việc: **Chờ phân công** / **Đang xử lý** / **Đã xong**; giao việc, xử lý phiếu hỗ trợ
- Báo cáo công suất, doanh thu theo tháng, tuổi nợ; nhật ký của chi nhánh

### ⚙️ Vận hành chuỗi

- Quản lý chi nhánh, loại kho, ô kho, bảng giá, danh mục dịch vụ kèm
- Ban hành **chính sách** theo phiên bản (toàn chuỗi hoặc riêng chi nhánh): thời gian giữ chỗ, phí trễ hạn, mức khoá kho, gói bảo vệ…
- Quản lý **mẫu hợp đồng** theo phiên bản
- **Duyệt & chi**: bồi thường trên 5.000.000 ₫, miễn phí trễ hạn, điều chỉnh biên bản trả kho, xoá nợ sau quyết toán,
  xác nhận đã chuyển khoản, xử lý khoản hoàn VNPAY không gửi được

### 🔐 Quản trị viên

- Tạo và phân quyền tài khoản nhân sự theo vai trò, chi nhánh, ca làm; **mỗi chi nhánh đúng một quản lý**; nhân sự nghỉ
  thì **Tạm khoá**
- **Xoá tài khoản khách** (ẩn danh hoá): hiện trước mọi ràng buộc (đang thuê, còn nợ, chờ hoàn tiền, bồi thường, khiếu nại,
  hạn khiếu nại, đồ đang giữ), bắt nhập lý do và tick xác nhận, ghi vào nhật ký. Hợp đồng và chứng từ tiền vẫn giữ
- **Nhật ký hệ thống** (audit log, chỉ ghi thêm)
- Xử lý yêu cầu về dữ liệu cá nhân

### 🔧 Hệ thống

- **Cập nhật không cần F5**: web tự tải lại dữ liệu mỗi 20 giây (khách) / 45 giây (nhân sự) và ngay khi quay lại tab;
  app tải lại mỗi 30 giây và khi mở lại app
- **Máy trạng thái** cho đặt chỗ, hợp đồng, thanh toán, phiếu, bồi thường, đợt nhập, biên bản — chặn chuyển trạng thái sai
- **Transaction MongoDB** cho mọi thao tác tiền / ô kho; chống đặt trùng ô, chống trả tiền hai lần (idempotency key)
- **Job nền**: huỷ giữ chỗ quá hạn, huỷ khách không đến nhận kho, phát hành tiền thuê định kỳ, tính phí trễ hạn, tự khoá
  kho, nhắc hết hạn, hết hạn chưa gia hạn (Điều khoản 1.24: báo ân hạn → khoá, giữ đồ), hết hạn yêu cầu đổi ô / đợt nhập,
  đối soát và hoàn tiền VNPAY, dọn dữ liệu cá nhân quá hạn lưu
- **Sinh PDF** hợp đồng, phụ lục, biên lai (PDFKit) và gửi email (Nodemailer / mail relay)
- Phân quyền theo vai trò **và** theo chi nhánh trên từng API

## 🛠️ Công nghệ

**Backend** (`BE/`)

| Thành phần | Dùng để | Vì sao |
|---|---|---|
| Node.js 22 + TypeScript, chạy bằng `tsx` | Chạy thẳng file `.ts` | Không có bước build, deploy gọn |
| Express 5, Helmet, CORS | REST API `/api`; mỗi nghiệp vụ một thư mục `features/<tên>/` (model, service, routes) | Lỗi trong handler `async` tự chuyển sang middleware lỗi — service chỉ cần `throw` |
| MongoDB Atlas + Mongoose 8 | Lưu dữ liệu; thao tác tiền và ô kho chạy trong transaction (`withTxn`) | Đặt chỗ, hợp đồng có nhiều mảng lồng, lưu gọn trong một document. Atlas M0 là replica set nên có transaction |
| Firebase Admin SDK 13 | Kiểm ID token (`verifyIdToken(token, true)`), tạo tài khoản nhân sự, thu hồi token | Không tự làm mật khẩu / session; đổi quyền là token cũ bị từ chối ngay |
| Zod 3 + `zod-to-json-schema` + `swagger-ui-express` | Kiểm dữ liệu gửi lên; sinh OpenAPI / Swagger từ chính schema của route | Tài liệu luôn khớp code, không viết tay |
| Giới hạn tần suất tự viết | Trần theo IP / theo tài khoản, vượt thì 429 `RATE_LIMITED` | Đếm trong bộ nhớ — đủ cho một instance |
| PDFKit + font DejaVu | Hợp đồng, phụ lục, biên lai PDF | In đúng tiếng Việt có dấu |
| Nodemailer (SMTP) hoặc relay Google Apps Script | Email OTP, hợp đồng, thông báo | Render Free chặn cổng SMTP → relay đi qua HTTPS |
| VNPAY (`vnpay.client.ts`) | Tạo link thanh toán ký HMAC-SHA512; nhận IPN; QueryDr, Refund | Cổng thanh toán nội địa, có sandbox |
| `node:crypto` | SHA-256 cho mã OTP và token QR; AES-256-GCM cho mật khẩu mở kho | Không lưu mã bí mật dạng rõ |

**Web** (`Webapp/`)

| Thành phần | Dùng để |
|---|---|
| Next.js 16 (App Router), React 19 | Trang chia theo vai trò (`portal/`, `staff/`, `manager/`, `ops/`, `admin/`). Gần như mọi trang là client component gọi REST API của BE; Next không có API route hay server action |
| Tailwind CSS 4, Lucide icons | Giao diện |
| Firebase JS SDK | Đăng nhập email-mật khẩu và Google; SDK tự lưu phiên và làm mới token |
| `qrcode`, `jsQR` | Vẽ mã QR; quét mã QR bằng camera ở quầy |
| three.js + `@react-three/fiber` | Mô hình 3D chi nhánh để chọn ô — chỉ tải khi khách mở chế độ 3D |

**Mobile** (`Mobile/React-Native/`) — chỉ dành cho khách hàng

| Thành phần | Dùng để |
|---|---|
| Expo SDK 57 + Expo Router, React Native 0.86 | App khách, định tuyến theo file trong `app/`; chạy bằng Expo Go |
| Firebase JS SDK + AsyncStorage | Đăng nhập email-mật khẩu, giữ phiên khi mở lại app |
| `react-native-qrcode-svg`, `expo-brightness` | Hiện mã QR nhận kho, tăng độ sáng màn hình khi quét |
| `expo-image-picker` | Chụp / chọn ảnh chứng cứ |
| Deep link `khoan://pay-result` | Quay lại app sau khi trả VNPAY trên trình duyệt |

**Dùng chung** (`shared/` — gói `@ssm/shared`)
- Package TypeScript thô: enum, kiểu dữ liệu, máy trạng thái, công thức giá, tiền giữ chân, phí, mức bồi thường, nhãn
  tiếng Việt. BE, Web và Mobile cùng import nên con số trên màn hình trùng con số BE kiểm; BE vẫn là nơi quyết định cuối

**Triển khai**
- API: Render · Web: Vercel · CSDL: MongoDB Atlas · Xác thực: Firebase · Thanh toán: VNPAY sandbox · Mobile: Expo Go

**Thanh toán**

| Kênh | Cách trả | Ghi chú |
|---|---|---|
| Khách trả online (web, app) | Chỉ **VNPAY** | Bản deploy dùng VNPAY sandbox; chạy local mặc định là chế độ **MOCK** (giả lập, `MOCK_PAYMENTS=true`) |
| Tại quầy | **Tiền mặt** hoặc **VNPAY** | Đối chiếu giấy tờ trước khi thu; một biên lai cho mỗi lần thu |
| Hoàn tiền, chi bồi thường cho khách | **Chuyển khoản ngân hàng** | Người chuyển thật trên ngân hàng rồi xác nhận kèm mã giao dịch; người lập khoản chi không tự xác nhận |

> Sandbox VNPAY trả mã **99** cho Refund và QueryDr. Vì vậy tiền chỉ được ghi nhận qua IPN, và khoản hoàn của giao dịch
> VNPAY online không tự xong: quản lý chọn "Chuyển sang chuyển khoản", rồi một người khác xác nhận đã chuyển.

**Không dùng (và dùng gì thay)**

| Không dùng | Thay bằng |
|---|---|
| WebSocket / Socket.IO | Polling `GET /bootstrap` (20 / 45 / 30 giây); màn thu VNPAY tại quầy hỏi mỗi 2,5 giây |
| Push notification (FCM) | Email + thông báo ghi trong hợp đồng, xem trong tài khoản |
| Redis, node-cron, BullMQ | Đếm giới hạn và job `setInterval` ngay trong tiến trình API (một instance) |
| Cloudinary / S3 / GridFS | Ảnh (≤ 3 MB) và bản scan (≤ 5 MB) lưu dạng Buffer trong MongoDB |
| Tự làm đăng nhập (bcrypt, JWT tự ký, cookie) | Firebase Authentication; BE chỉ kiểm ID token |
| Đăng nhập Google trên app | Khách Google đặt mật khẩu ở web rồi đăng nhập app bằng email |
| API ngân hàng | Chuyển khoản thủ công + xác nhận hai người |
| Sentry / Crashlytics, CI | Log của Render + `x-request-id`; `npm run typecheck` ở từng workspace |

## 🏗️ Kiến trúc

Monorepo npm workspaces, một API REST dùng chung cho Web và Mobile — mọi quy tắc chỉ kiểm ở một nơi:

```
┌──────────────────────────────┐      ┌──────────────────────────────┐
│   Webapp (Next.js 16)        │      │   Mobile (Expo / RN)         │
│   Khách · Nhân viên · QL     │      │   Chỉ khách hàng             │
│   Vận hành · Quản trị        │      │                              │
│   Vercel · :3000             │      │   Expo Go · Metro :8081      │
└──────────────┬───────────────┘      └──────────────┬───────────────┘
               │      Firebase signIn → idToken      │
               │◄──────────── Firebase Auth ────────►│
               │                                     │
               │        HTTPS / REST  (Bearer idToken)
               └──────────────────┬──────────────────┘
                                  │
               ┌──────────────────▼──────────────────┐
               │   BE — Express 5 API  (/api)        │
               │   Render · :4000 · 1 instance       │
               │   xác thực token → vai trò + chi    │
               │   nhánh từ MongoDB → phân quyền     │
               │                                     │
               │   features/  reservations ·         │
               │   contracts · payments · swaps ·    │
               │   intake · claims · tickets · …     │
               │   jobs/      tính tiền, huỷ quá hạn │
               │              đối soát VNPAY         │
               └──┬──────────────┬─────────────┬─────┘
                  │              │             │
   ┌──────────────▼───┐  ┌───────▼───────┐ ┌───▼───────────────┐
   │  MongoDB Atlas   │  │ Email (SMTP / │ │ VNPAY sandbox     │
   │  (transaction,   │  │ mail relay)   │ │ payUrl · IPN ·    │
   │  ảnh, bản scan)  │  │               │ │ QueryDr · Refund  │
   └──────────────────┘  └───────────────┘ └───────────────────┘

        shared/ (@ssm/shared) — enum, kiểu, máy trạng thái, quy tắc
        nghiệp vụ: BE, Webapp và Mobile cùng dùng một nguồn
```

- **Xác thực:** client đăng nhập với Firebase, gửi ID token trong header `Authorization: Bearer`. BE kiểm token (kể cả
  token đã bị thu hồi), rồi lấy vai trò và chi nhánh từ MongoDB — không tin client. STAFF và quản lý chi nhánh chỉ thấy
  dữ liệu chi nhánh mình.
- **Dữ liệu cho màn hình:** `GET /bootstrap` trả một ảnh chụp đã lọc theo vai trò và chi nhánh ở server. Mỗi thao tác gọi
  endpoint riêng, xong thì tải lại ảnh chụp; ngoài ra web và app tự tải lại theo nhịp (polling).
- **Tiền và ô kho:** chạy trong transaction; ô được giữ bằng lệnh nguyên tử (compare-and-set) nên hai khách không giữ được
  cùng một ô; bấm hai lần thì khoá idempotency trả lại kết quả cũ; giá vừa đổi thì 409 `PRICE_CHANGED`.
- **Thanh toán VNPAY:** BE tạo `payUrl` đã ký → khách trả trên trang VNPAY → Return URL đưa khách về trang web
  `/payment/return` (app: deep link) chỉ để hiển thị. Chỉ IPN hoặc QueryDr có chữ ký đúng mới ghi nhận tiền.
- **Job nền:** `setInterval` trong tiến trình API, có cờ chống chạy chồng và khoá idempotency nên chạy bù an toàn khi
  Render thức dậy. Vì vậy chỉ chạy **một instance**.

📊 Sơ đồ dữ liệu (ERD) đầy đủ: [`erd.dbml`](erd.dbml) — dán vào [dbdiagram.io](https://dbdiagram.io) (New Diagram → Import) để xem.

## 🚀 Bắt đầu

### Yêu cầu

- Node.js ≥ 20.12 (`.nvmrc` ghim Node 22) — BE dùng `process.loadEnvFile`, không cần `dotenv`
- Một cluster MongoDB Atlas (gói M0 là đủ, vì là replica set nên chạy được transaction)
- Một project Firebase bật Authentication (Email/Password + Google). Cách lấy khoá xem [`BE/README.md`](BE/README.md) mục 1
- Điện thoại cài **Expo Go** nếu muốn chạy app Mobile

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
| `BE/.env` | `MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Lấy từ Atlas và *Firebase Console → Project settings → Service accounts*. Biến tuỳ chọn (`SEED_PASSWORD`, `SEED_CUSTOMER_EMAIL`, `MOCK_PAYMENTS`, `VNPAY_*`, `MAIL_*`…): `BE/README.md` mục 1 và `BE/.env.example` |
| `Webapp/.env.local` | `NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID` | `NEXT_PUBLIC_API_URL` mặc định trỏ `http://localhost:4000/api` |
| `Mobile/React-Native/.env` | `EXPO_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID` | Bỏ trống `EXPO_PUBLIC_API_URL` thì app tự suy ra từ địa chỉ máy chạy Metro (điện thoại và máy tính cùng Wi-Fi). `EXPO_PUBLIC_WEB_URL`: trang Điều khoản / Bảo mật app mở ra |

Bộ `apiKey / authDomain / projectId / appId` lấy ở *Firebase Console → Project settings → General → Your apps → Web app*,
dùng chung cho Webapp và Mobile. Các file `.env` đã nằm trong `.gitignore`; khoá service account Firebase là quyền admin
toàn project, tuyệt đối không commit.

### 3. Nạp dữ liệu demo và chạy

> ⚠️ **`npm run seed` XOÁ SẠCH mọi collection của database trong `MONGODB_URI`** rồi nạp lại dữ liệu demo. Trỏ vào Atlas
> thì seed chỉ in cảnh báo rồi vẫn xoá; chỉ khi `NODE_ENV=production` mới đòi thêm `SEED_CONFIRM=yes`. Kiểm kỹ `MONGODB_URI`
> trước khi chạy, tốt nhất dùng một database riêng để thử.

Mỗi lệnh một cửa sổ terminal, chạy ở thư mục gốc:

```bash
npm run seed         # ⚠ XOÁ database trong MONGODB_URI, nạp dữ liệu demo + tạo tài khoản demo trên Firebase
                     #   (tương đương: cd BE && npm run seed)
npm run api          # API    → http://localhost:4000/api   (Swagger: /api/docs)
npm run web          # Web    → http://localhost:3000
npm run mobile       # Mobile → Expo dev server, mở bằng Expo Go
```

Web và Mobile đều gọi API thật nên phải chạy `npm run api` trước.

**Tài khoản demo** do seed tạo — mật khẩu mọi tài khoản là `SEED_PASSWORD` trong `BE/.env` (không đặt thì dùng mặc định
trong `BE/src/shared/config/env.ts`):

| Vai trò | Email |
|---|---|
| Khách hàng | `khach.demo@khoan.dev`, hoặc địa chỉ trong `SEED_CUSTOMER_EMAIL` nếu đặt |
| Nhân viên | `nhanvien.q7@khoan.dev`, `nhanvien.td@khoan.dev`, `nhanvien.tb@khoan.dev` |
| Quản lý chi nhánh | `quanly.q7@khoan.dev`, `quanly.td@khoan.dev`, `quanly.tb@khoan.dev` |
| Vận hành chuỗi | `vanhanh@khoan.dev` |
| Quản trị viên | `admin@khoan.dev` |

`q7` / `td` / `tb` là chi nhánh Quận 7 / Thủ Đức / Tân Bình. Địa chỉ `@khoan.dev` không có hộp thư và bị chặn gửi
(`MAIL_BLOCKED_DOMAINS`), nên mã OTP hiện ngay trên màn hình. Muốn nhận OTP và email hợp đồng thật, đặt
`SEED_CUSTOMER_EMAIL` là hộp thư của bạn rồi seed lại.

**Thanh toán khi chạy local:** `MOCK_PAYMENTS` mặc định `true` → khách trả online là giả lập và thành công ngay; thu VNPAY
tại quầy mở trang giả lập `/payment/mock`. Muốn thử VNPAY sandbox: đặt `MOCK_PAYMENTS=false` cùng `VNPAY_TMN_CODE`,
`VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` (xem [Triển khai](#-triển-khai)).

**Chạy Mobile bằng Expo Go:** `npm run mobile`, rồi quét mã QR trong terminal bằng Expo Go; điện thoại và máy tính phải
cùng Wi-Fi để app gọi được API ở `http://<IP máy tính>:4000/api`. Muốn dùng API đã deploy thì đặt
`EXPO_PUBLIC_API_URL=https://khoan-api.onrender.com/api` trong `Mobile/React-Native/.env`.

**Chạy Mobile trên trình duyệt:** sau `npm run mobile` bấm `w` (hoặc mở `http://localhost:8081`), và thêm origin này vào
`CORS_ORIGINS` trong `BE/.env` (`CORS_ORIGINS=http://localhost:3000,http://localhost:8081`) rồi khởi động lại API.

### Các lệnh ở thư mục gốc

| Lệnh | Việc |
|---|---|
| `npm run api` | BE chế độ watch (`tsx watch`) |
| `npm run start` | BE chế độ thường — lệnh Render dùng |
| `npm run web` | Webapp (Next.js dev) |
| `npm run mobile` | Expo dev server cho Mobile |
| `npm run seed` | ⚠ Xoá database trong `MONGODB_URI` và nạp lại dữ liệu demo |
| `npm run docs` | Mở Swagger trên trình duyệt (khi `npm run api` đang chạy) |
| `npm run sync-indexes --workspace BE` | Đồng bộ index MongoDB theo schema (production tắt `autoIndex`) |
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
│       ├── routes.ts       # bảng gắn router API_MOUNTS (prefix → router)
│       ├── features/       # auth · users · facilities · reservations · contracts ·
│       │                   # intake · payments · swaps · access · services · claims ·
│       │                   # tickets · uploads · policies · contract-templates ·
│       │                   # reports · privacy · notify · audit · bootstrap · docs
│       ├── jobs/           # job nền chạy trong tiến trình
│       ├── shared/         # config, core, crypto, db, geo, http, mail, utils
│       └── scripts/        # seed, sync-indexes, open-docs
│
├── Webapp/                 # Web — Next.js 16
│   └── src/
│       ├── app/
│       │   ├── (public)/   # trang chủ, chi nhánh, đặt kho, đăng nhập, điều khoản,
│       │   │               # bảo mật, kết quả thanh toán
│       │   ├── portal/     # khách hàng
│       │   ├── staff/      # nhân viên
│       │   ├── manager/    # quản lý chi nhánh
│       │   ├── ops/        # vận hành chuỗi
│       │   └── admin/      # quản trị
│       ├── features/       # component theo nghiệp vụ
│       └── shared/         # ui, layout, api client, store (live-sync), lib
│
├── Mobile/React-Native/    # App khách hàng — Expo Router
│   ├── app/                # file route (trỏ về màn hình trong src/features)
│   └── src/
│       ├── features/       # auth · home · facilities · payments · reservations ·
│       │                   # contracts · protection · tickets · claims · account
│       └── shared/         # ui, api, store
│
├── erd.dbml                # sơ đồ dữ liệu
├── render.yaml             # Blueprint triển khai BE lên Render
├── railway.json            # cấu hình cũ khi còn dùng Railway
└── package.json            # npm workspaces
```

Quy ước chi tiết của BE ở [`BE/README.md`](BE/README.md) mục 7; luồng dữ liệu của Web ở [`Webapp/README.md`](Webapp/README.md).

## 📚 Tài liệu API

Swagger sinh tự động từ chính code route (schema Zod), nên luôn khớp với API đang chạy:

| Đường dẫn | Nội dung |
|---|---|
| `/api/docs` | Swagger UI, có *Try it out* |
| `/api/openapi.json` | OpenAPI 3 — import vào Postman |
| `/api` | Trang tóm tắt tiếng Việt; có ô lấy token khi BE đặt `FIREBASE_WEB_API_KEY` |
| `/api/docs.json` | Dữ liệu của trang tóm tắt, dạng JSON |
| `/health` | Kiểm sống + trạng thái kết nối MongoDB |

- Local: http://localhost:4000/api/docs
- Online: https://khoan-api.onrender.com/api/docs · https://khoan-api.onrender.com/api/openapi.json

**Luồng xác thực**

```
client ── Firebase signIn (email/password | Google) ──> idToken
client ── POST /api/auth/sync   (Bearer idToken) ──> tạo / liên kết hồ sơ khách hàng
client ── mọi /api/*            (Bearer idToken)
BE     ── verifyIdToken → User trong Mongo → vai trò + chi nhánh → phân quyền
```

Lỗi trả về dạng `{ "error": { "code", "message", "details" } }`. Bảng endpoint tóm tắt và danh sách job nền: [`BE/README.md`](BE/README.md) mục 5–6.

## 🚢 Triển khai

| Thành phần | Nền tảng | Địa chỉ | Ghi chú |
|---|---|---|---|
| API (`BE/`) | **Render** (Free, Singapore) | https://khoan-api.onrender.com | `render.yaml`: tự deploy khi commit vào `master` đổi `BE/` / `shared/`; chỉ cài `BE` + `shared`; healthcheck `/health`; 1 instance (job nền chạy trong tiến trình) |
| Web (`Webapp/`) | **Vercel** | https://wdp-301-webapp.vercel.app | `NEXT_PUBLIC_API_URL=https://khoan-api.onrender.com/api` và bộ `NEXT_PUBLIC_FIREBASE_*` |
| CSDL | **MongoDB Atlas** | — | Network Access cho phép `0.0.0.0/0` (Render Free không có IP cố định) |
| Thanh toán | **VNPAY sandbox** | — | `MOCK_PAYMENTS=false` + khoá sandbox trên Render |
| Mobile | **Expo Go** | — | `EXPO_PUBLIC_API_URL=https://khoan-api.onrender.com/api` trong `Mobile/React-Native/.env` |

Các bước:

1. **Render** → New → Blueprint → chọn repo → nhập `MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY`, `CORS_ORIGINS` (domain Vercel của Webapp). `render.yaml` đặt sẵn `NODE_ENV=production`.
   **Nên thêm tay** ở Service → Environment: `ACCESS_CODE_SECRET` (chuỗi ngẫu nhiên ≥ 16 ký tự, VD `openssl rand -hex 32`) —
   production thiếu biến này thì BE vẫn chạy bằng khoá cũ nhưng in cảnh báo lúc khởi động. Mật khẩu mở kho đã mã hoá trước
   đó (khoá suy từ `FIREBASE_PRIVATE_KEY`) vẫn đọc được; mã hoá mới dùng khoá mới. Đặt rồi thì KHÔNG đổi (đổi là mất mật
   khẩu đã lưu).
2. **VNPAY**: trên Render đặt `MOCK_PAYMENTS=false`, `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`,
   `VNPAY_RETURN_URL=https://<web>/payment/return`; gửi VNPAY URL IPN `https://<api>/api/payments/vnpay/ipn`; chạy
   `npm run sync-indexes --workspace BE` trỏ vào Atlas.
3. **Vercel** → đặt `NEXT_PUBLIC_API_URL` và `NEXT_PUBLIC_FIREBASE_*` rồi Redeploy. Thêm domain web vào *Firebase →
   Authentication → Settings → Authorized domains*.
4. **Giữ BE thức**: Render Free ngủ sau 15 phút không có request, khi ngủ thì job tính tiền / huỷ quá hạn / đối soát cũng
   dừng. Đặt một dịch vụ ping miễn phí (UptimeRobot, cron-job.org) gọi `https://<service>.onrender.com/health` mỗi 10 phút.

Lưu ý gói Free: chặn cổng SMTP (465/587) → gửi email qua `MAIL_RELAY_URL` / `MAIL_RELAY_SECRET` (xem `BE/.env.example`);
không có Shell nên chạy `npm run seed` từ máy local trỏ vào Atlas (⚠ xoá sạch database đó). `railway.json` là cấu hình cũ
khi còn dùng Railway.

Cấu hình an toàn khi chạy thật (`NODE_ENV=production`, lệnh chạy vẫn là `npm run start`):

| Biến | Ý nghĩa |
|---|---|
| `NODE_ENV=production` | Bắt buộc khi deploy: tắt `AUTH_DEV_BYPASS`, ẩn stack lỗi, không trả mã OTP (`demoCode`) cho địa chỉ email thật — chỉ tài khoản demo `@khoan.dev` (không có hộp thư) còn nhận mã trên màn hình |
| `ACCESS_CODE_SECRET` | Nên có ở production (xem bước 1) |
| `AUTH_DEV_BYPASS` | Chỉ có hiệu lực khi KHÔNG production **và** `MONGODB_URI` trỏ mongod cục bộ (`localhost` / `127.0.0.1`); ngoài ra bị bỏ qua kèm cảnh báo |
| `MOCK_PAYMENTS` | Mặc định `true`: thanh toán online của khách là **giả lập**, thắng mọi cấu hình khoá. `false` + đủ khoá VNPAY → cổng VNPAY (bản deploy đang dùng sandbox); `false` + thiếu khoá → 501 `GATEWAY_NOT_CONFIGURED`. Thu tại quầy vẫn là tiền mặt hoặc VNPAY |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` | Khoá cổng VNPAY (đăng ký sandbox tại `https://pay.vnpaytest.vn/dev-registration`) và trang kết quả của Webapp. `VNPAY_HASH_SECRET` là khoá bí mật: chỉ đặt ở `.env` / Render. Xem thêm `BE/README.md` |
| `SEED_CONFIRM=yes` | `npm run seed` xoá sạch database — khi `NODE_ENV=production` chỉ chạy nếu có biến này; trỏ vào database không phải máy cục bộ thì in cảnh báo |

Production không tự đồng bộ index MongoDB (`autoIndex` tắt) — sau khi đổi schema chạy `npm run sync-indexes --workspace BE` trỏ vào Atlas.
Điều khoản 1.24 (trạng thái hợp đồng `EXPIRED`) đổi bộ lọc của chỉ mục duy nhất `rentalContracts.unitId_1` — chạy một lần
`npx tsx src/scripts/migrate-expiry-index.ts` trong `BE/` (database xa cần thêm `--allow-remote`, chỉ khi đã được đồng ý).

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
