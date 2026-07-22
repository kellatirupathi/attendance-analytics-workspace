# NIAT SPI Platform

A full-stack staff dashboard and public student report portal for NIAT — tracks attendance and Skill Performance Index (SPI) from live BigQuery data.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server run seed` — seed superadmin + campuses (run once after first build)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `JWT_SECRET`, `BIGQUERY_SERVICE_ACCOUNT_JSON`, `BQ_PROJECT_ID`, `BQ_LOCATION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 at `/api` path
- Frontend: React + Vite at `/` (niat-spi-dashboard)
- DB: PostgreSQL + Drizzle ORM (users + campuses only)
- Analytics: Google BigQuery (live attendance + quiz data — read-only, never written)
- Auth: HS256 JWT in httpOnly cookie `niat_session`, 30-day expiry, tokenVersion revocation
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/brave.ts` — PostgreSQL schema (users + campuses)
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `lib/api-zod/src/generated/api.ts` — generated Zod validation schemas
- `artifacts/api-server/src/` — Express 5 backend
  - `lib/auth.ts` — JWT signing/verification, session middleware
  - `lib/bigquery.ts` — BQ REST client (no SDK, pure fetch + JWT)
  - `lib/queries.ts` — all BigQuery SQL queries for attendance/quizzes
  - `lib/rbac.ts` — roles and scope filtering
  - `routes/` — auth, attendance, dashboard, admin, bigquery, profile
- `artifacts/niat-spi-dashboard/src/` — React frontend
  - `contexts/AuthContext.tsx` — auth state via useGetMe
  - `pages/` — Landing, StaffLogin, SpiReport, Dashboard, Students, Campuses, Profile, BigQueryExplorer, AdminUsers, AdminCampuses

## Architecture decisions

- BigQuery data is always read live (with 5-min in-process cache per student); never synced to PostgreSQL. PostgreSQL is only for users and campuses.
- BQ authentication uses a hand-rolled JWT → OAuth2 flow (no @google-cloud SDK) to avoid esbuild bundling issues with native modules.
- SPI public links use HMAC-SHA256 tokens (`spi:{studentId}`) — no expiry, safe to share. Staff can also view them with a session cookie.
- Session tokenVersion in DB allows instant invalidation when role/password/active status changes.
- Scope filtering (campuses/subjects) is applied at the SQL level inside BQ queries for all non-superadmin roles.

## Product

- **Landing page** (`/`) — public marketing page explaining SPI, assessment weights, grading scale
- **Staff login** (`/staff-login`) — email/password + Google OAuth sign-in for NIAT staff
- **SPI Report** (`/spi/:studentId?t=TOKEN`) — public student attendance/quiz report accessible via shareable token link
- **Dashboard** (`/dashboard`) — overview stats, attendance charts, campus breakdown (role-scoped)
- **Students** (`/dashboard/students`) — searchable student list with SPI links
- **Campuses** (`/dashboard/campuses`) — campus/section rollup tables
- **Admin Users** (`/admin/users`) — CRUD user management
- **Admin Campuses** (`/admin/campuses`) — campus management
- **BigQuery Explorer** (`/dashboard/bigquery`) — superadmin-only raw BQ table browser
- **Profile** (`/dashboard/profile`) — name edit + password change

## Default login

- Email: `admin@niat.edu`
- Password: `Admin@123`
- Role: `superadmin` (full access to all features)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm run typecheck:libs` before leaf artifact typechecks if you change anything in `lib/`.
- After changing DB schema, run `pnpm --filter @workspace/db run push`.
- After changing `openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.
- The `seed` script needs the server to be built first (`pnpm --filter @workspace/api-server run build`).
- `lib/api-zod/src/index.ts` must export ONLY from `./generated/api` — Orval regenerates this file and does not export from `./generated/types`.
- Express 5 `req.params` returns `string | string[]` — always use `String(req.params["name"] ?? "")` to cast.
- BQ table names must be in backtick-quoted fully-qualified form: `` `project.dataset.table` ``.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
