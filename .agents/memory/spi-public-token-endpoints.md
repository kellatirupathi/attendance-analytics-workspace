---
name: SPI public token endpoints
description: Why public share-link endpoints need their auth token declared in OpenAPI
---

# Public token-authenticated endpoints

The four per-student attendance endpoints (`/attendance/students/{studentId}/{overview,subjects,recent,quizzes}`) grant access via EITHER a staff session cookie OR a `?t=<spiToken>` query param (see `checkStudentAccess` in `routes/attendance.ts`, token verified by `verifySpiToken`).

**Rule:** any endpoint that authenticates via a query-string token MUST declare that query param in `lib/api-spec/openapi.yaml`. Otherwise the generated orval client has no way to send it, and public (no-session) callers get 403 while the page shows only skeleton loaders.

**Why:** public SPI share links (`/spi/:studentId?t=TOKEN`) silently 403'd for anyone not logged in as staff, because the token was never forwarded. Staff testing with a session cookie never saw the bug.

**How to apply:** declare the token as an optional query param in the spec, regenerate (`pnpm --filter @workspace/api-spec run codegen`), then in the page read it via `new URLSearchParams(window.location.search).get("t")` and pass it as the hook's `params` arg AND into the `getXxxQueryKey(id, params)` call so tokened vs non-tokened responses are cache-separated. Server-side validation remains the real access control.
