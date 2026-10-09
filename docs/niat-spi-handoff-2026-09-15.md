# NIAT SPI Dashboard — Handoff Notes

Prepared 2026-09-15 for CB (Training & Capability Development, NxtWave/NIAT), to hand this project to a new Claude conversation/account. **Paste this whole file as your first message (or attach it) in the new chat** so the new session has full context before you ask it to do anything.

---

## 1. What this project is

The **NIAT SPI Dashboard Recovery System** — tracks "recovery" (makeup) classes for students below attendance thresholds, across NIAT's 17+ partner college campuses.

- Repo: `github.com/kellatirupathi/attendance-analytics-workspace` (pnpm monorepo)
- Stack: Express/TypeScript API server + React frontend + Drizzle ORM/Postgres + BigQuery (for regular attendance data)
- Local checkout: `C:\Users\NXTWAVE\Desktop\attendance-analytics-workspace` on CB's Windows machine
- Hosted/built on **Replit**, published at the custom domain **`niat-spi.nxtwave.in`**

## 2. How CB works — read this before doing anything

CB is **not technical**. Do not expect CB to run arbitrary commands or debug independently. Ground rules that worked well:

- **Git commands** (`git add`, `commit`, `push`, `pull`) only happen in CB's own **local PowerShell** window, in the path above. Always hand CB the *exact* commands to paste, one block at a time, and wait for the pasted output before assuming anything worked.
- **Database queries, `psql`, and deployment actions** (Redeploy, checking Secrets, etc.) only happen in **Replit's own Shell tab / web UI** — a completely different environment from PowerShell. `psql "$DATABASE_URL"` works there; it does not exist in PowerShell.
- When running `psql` interactively, add `-P pager=off` to avoid CB getting stuck in a pager.
- **Never conclude a step succeeded without CB pasting the actual output or a screenshot.** CB has repeatedly reported things "not working" that turned out to need a screenshot to properly diagnose — screenshots of the *whole browser window* (not cropped) have been the most useful format.
- CB communicates in short, sometimes ambiguous messages — confirm your understanding of ambiguous asks before doing large/destructive work, but don't over-block on clarifying questions for small things.

If this Claude session has a **device bridge** connected to CB's computer (tools for staging/committing files to CB's machine), the working pattern has been: edit files in a scratch/output location, then commit them straight into `C:\Users\NXTWAVE\Desktop\attendance-analytics-workspace\...`, then hand CB the `git add / commit / push` commands to run themselves.

## 3. ⚠️ UNRESOLVED — the "two databases" mystery (read this first)

This is the single biggest open problem and should be the next thing tackled.

**Symptom:** The published site `niat-spi.nxtwave.in` shows real recovery-session data (correct historical classes, plus two known test rows) — but every `psql "$DATABASE_URL"` query run in Replit's Shell against the dev workspace's database comes back showing that database is essentially **empty** (only one unrelated cancelled session existed at last check).

**What's been ruled out:**
- Not a 60-second in-memory cache issue (verified the cache TTL and code path).
- Not a stale preview vs. published-app issue in the ordinary sense — even after CB added a `DATABASE_URL` secret to the Deployment (copied from the same value that worked for `psql` in the Shell) **and** redeployed, the live site's data did not change at all.
- Tested the deployment's default `*.replit.app` URL directly (bypassing the custom domain entirely) — **it showed the exact same data**, ruling out a DNS/custom-domain misconfiguration.
- Found that a complete historical-data import already exists in the repo (see §5) and matches what the live site shows — but that import was never run against the database reachable via the Shell's `$DATABASE_URL`. So it was run against some *other* database.

**Leading theory:** The Replit **Deployment** has its own database connection that is *not* a manually-set Secret (it wasn't listed in Secrets or Configurations panels at all) — it's likely auto-injected by a native Replit "Database" integration, and that integration may be bound to a **different database instance** than whatever the dev workspace's Shell environment uses.

**Next diagnostic step (not yet done):** Ask CB to open Replit's dedicated **Database** panel (a separate icon/tab from Secrets/Deployments — often a cylinder/disk icon in the left sidebar) and screenshot it. This should reveal whether there are two separate database instances and let us query the one the live site actually uses directly.

**Do not** try deleting/importing data into the dev workspace's database again until this is resolved — we already tried that once (found only 1 row there) and it had zero effect on the live site.

## 4. What CB actually wants fixed once the database is found

Two rows on the CDU (Chaitanya Deemed-to-be University) recovery tracker need to be **deleted**: "Building a Trading Agent | Part 1" and "Part 2", instructor "Shujad abdulla", dated 13 Sept 2026, type "Campus" — CB confirmed these are their own test entries (testing the "mark complete" feature), not real data. They are **not** part of the real historical import (see §5), so deleting them is safe once you're pointed at the correct/live database.

## 5. Discovered: real historical data already imported

The repo already contains (committed, and apparently already run against the live database):
- `artifacts/api-server/src/seed/historical-recovery-sessions.ts` — hand-transcribed real recovery-class records for MRV, NRI, and CDU campuses, covering 2026-07-04 through 2026-08-11, sourced from CB's own tracking spreadsheet.
- `artifacts/api-server/src/import-historical-recovery-sessions.ts` — the importer script (dry-run by default; `--commit` to write). It resolves topic titles fuzzily against `recovery_topics`, is idempotent/safe to re-run, and has a `TITLE_OVERRIDES` map for spreadsheet-title-to-curriculum-title corrections confirmed with CB previously.

CB later uploaded a CSV ("Recovery sessions track") that turned out to be the **same source data** already in that seed file — confirmed by CB as "real data...used to be tracked manually in a sheet". **No further import is needed** — this data is already live. Do not re-run the import or treat the CSV as new work.

## 6. Work completed and pushed this session (2026-09-15)

All of the below is committed to GitHub (`main` branch, after a clean `git pull --no-edit` merge with some other remote changes). **CB still needs to confirm the Replit side**: `git pull` in Replit's Shell, restart (`kill 1`) to sanity-check the preview, then click **Redeploy** in the Deployments tab, for these to reach the live site.

1. **Shared-campus-login "mark complete" fix** (earlier this session, already confirmed deployed): a single shared instructor login per campus (e.g. `cdu.instructor@nxtwave.co.in`) can now view/mark-complete **any** session at their campus, across all subjects — not just ones tied to one specific matched instructor identity. Changed `canAccess()` in `artifacts/api-server/src/routes/recovery.ts` and the button gating in `artifacts/niat-spi-dashboard/src/pages/RecoverySubjectDetail.tsx`.

2. **Sidebar UI fixes** in `artifacts/niat-spi-dashboard/src/components/DashboardLayout.tsx`:
   - Fixed the sidebar covering/overlapping main content on horizontal overflow (`overflow-x-hidden` added at several layout levels).
   - Fixed the sidebar being able to widen (and shift main content) when an instructor's name/email is long (`min-w-0`/`flex-1` fixes on `NavItemLink` and the sidebar's flex containers). Deploy status on these two **not yet independently confirmed** by CB viewing the live site.

3. **Session Tracker table — two new columns**: "Remarks" (instructor's own notes) and "QA Report" (clickable link icon, opens in new tab), shown after the "Instructor Type" column. Required adding `remarks`/`qaReportUrls` to the `SessionTrackerRow.recoverySession` type and query in `artifacts/api-server/src/lib/queries.ts` (the `getSessionTracker` function — note there's dead/commented-out duplicate code elsewhere in that file with the same type/function names; don't edit those), and the table markup in `RecoverySubjectDetail.tsx`.

4. **QA report link made mandatory** whenever a session is reported as "Completed" or "Partially Completed" (not required for "Not Completed"). Implemented in three places:
   - Frontend: `artifacts/niat-spi-dashboard/src/pages/InstructorRecovery.tsx` (the `/instructor` page's report form).
   - Frontend: the "Mark complete" dialog inside `RecoverySubjectDetail.tsx` (a second UI that hits the same report endpoint).
   - Backend: `artifacts/api-server/src/routes/recovery.ts`, the `POST /sessions/:id/report` handler — added a manual check after the existing `studentsAttended` validation (didn't touch the auto-generated Zod schema in `lib/api-zod/src/generated/api.ts`, which appears to be stale/out of sync with the actual route handler's fields — worth investigating separately sometime, but out of scope for this fix).

## 7. Database schema quick reference

Postgres tables (Drizzle `pgTable` names — different from the camelCase TS export names):
- `recovery_topics` — master curriculum: ordered lecture list per campus+subject.
- `recovery_progress` — per-topic completion status (`pending`/`scheduled`/`completed`).
- `campus_instructors` — regular teaching roster (used to classify recovery instructors as campus/backup).
- `recovery_sessions` — one row per recovery class (`planned`/`conducted`/`partial`/`cancelled`/`no_show`), with `remarks` and `qa_report_urls` (text array) columns.
- `recovery_session_topics` — join table, topics covered in a session (`FK ON DELETE CASCADE` back to both `recovery_sessions` and `recovery_topics`).

`BIGQUERY_TO_CURRICULUM_SUBJECT` maps raw BigQuery subject strings (e.g. "AI For Finance") to canonical Postgres subject strings (CDU → "GenAI"). The live tracker status ("recovered"/"recovery_scheduled"/"needs_recovery") is computed by joining live BigQuery prod-sequence data with these Postgres tables — see `getProdSequenceSessionTracker` / `getSessionTracker` in `artifacts/api-server/src/lib/queries.ts`.

## 8. Other pending/background items

- CB has a 34-row CSV of one shared instructor login per campus to bulk-create (e.g. `cdu.instructor@nxtwave.co.in`) — pointed CB at the existing **Bulk Import Users** tool (Admin → User Access → "One instructor login per campus" button) rather than doing this directly; not yet confirmed done. CB's own campus-name spellings in that CSV may not match the system's canonical campus names (e.g. "A Dy Patil University") — worth double-checking against the app's actual campus list before import.
- No other known open bugs beyond the database mystery above.

---

**If you (new Claude session) are picking this up:** start by asking CB whether they were able to check Replit's Database panel yet (§3), since that's the actual blocker. Everything else is in a good, committed, syntax-checked state waiting on that + a Replit redeploy.
