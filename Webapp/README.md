# Webapp

Next.js (App Router) + Tailwind v4, backed by the real API in `BE/` and Firebase Auth (email/password + Google).

## Setup
1. BE running with seeded data (`npm run seed`, `npm run api` from the repo root — see `BE/README.md`).
2. Firebase console → *Project settings → General → Your apps → Add app → Web* → copy the SDK config.
3. `cp Webapp/.env.local.example Webapp/.env.local` (git-ignored) and fill:
   - `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api`)
   - `NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID`
4. From the repo root: `npm install` then `npm run web` → http://localhost:3000

`localhost` is an authorised domain in Firebase by default; add your deployed domain under *Authentication → Settings → Authorized domains*.

## How data flows
Source lives under `src/` and is split by feature — see "Cấu trúc mã nguồn" in the root `README.md`. The pieces below are in `src/shared/`.
- `shared/api/firebase.ts` — Firebase web SDK; sign-in / sign-up / Google popup / password reset / email verification.
- `shared/api/client.ts` — `fetch` wrapper that attaches the Firebase ID token and maps `{ error: { code, message } }` to `ApiError`.
- `shared/api/actions.ts` — one function per UI action → one REST call.
- `shared/store/store.tsx` — on sign-in: `POST /auth/sync` then `GET /bootstrap` (a snapshot already filtered by role and facility on the server).
  `run(action, payload, successText?, onOk?)` calls the API, then re-fetches the snapshot. Pages read `db` from the store.
- Public pages (`/`, `/facilities`, `/facilities/[id]`) use `GET /facilities/public…` — availability and quotes are computed by the server.
- `shared/lib/domain.ts` only derives read-only numbers for dashboards (occupancy, revenue, refund preview). Every rule is enforced by BE.

`shared/lib/mock-data.ts` is no longer used by the Webapp at runtime; `BE/src/scripts/seed.ts` imports it so the database starts with the same demo data.

## Test flows
Manual checks that exercise the Firebase + API integration:
- **Sign up** (email) → verification email → banner “Tôi đã xác minh” → can book.
- **Google** → first login creates a CUSTOMER profile automatically.
- **Admin creates staff** → reset link is copied to the clipboard → staff sets a password → signs in scoped to the assigned branch.
- **Role change** by admin → the affected user's next request gets `TOKEN_REVOKED` and is signed out.
