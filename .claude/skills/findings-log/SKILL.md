---
name: findings-log
description: Turn SPI dashboard / data-check work notes into a findings log (Date, Findings, Action Item, Resolution, Resolution- Date) with clear, self-explaining findings, delivered as CSV. Use when asked to add a finding, update the findings log, or produce daily findings.
---

# Findings log

Build or update a findings log for SPI dashboard, Hex and data-quality work. Every row must make sense to someone who was not in the conversation (manager, DA team, Ops) and be easy to find later.

## Columns (exact headers, this order)

`Date, Findings, Action Item, Resolution, Resolution- Date`

## Findings: always this structure

`[Area] Short title – what is wrong, where, how many, and why it matters.`

1. **[Area] tag first**, one of:
   `[Overview]`, `[Student Directory]`, `[Student Report]`, `[Assessments]`, `[SPI Record]`, `[Attendance]`, `[Student Count]`, `[Hex vs Dashboard]`, `[Master View]`, `[Quiz Data]`, `[Data Quality]`, `[Export]`, `[Request]`.
   Pick the page or data area the reader would search for. Add a new tag only if none fits.
2. **Short title** (3–8 words) that names the problem, e.g. "Attendance % mismatch with Hexacon", "Students with blank names".
3. **What / where / how many**: the page or table, the campuses affected, and the numbers on both sides (e.g. "Dashboard 16,030 vs Hex 16,015", "25 students at Malla Reddy Vishwavidyapeeth", "7,079 of 16,023 students").
4. **Cause** if known, in a few words. If not known, say "cause not confirmed".
5. **Impact** in a few words: who sees what wrong.

Keep it to 2–3 sentences. Name tables and fields exactly (e.g. niat_users_core_backend_master_db, ATTENDANCE_SLOT) so they can be searched.

### Example

Bad: `Student count came only from the attendance table (16,032).`

Good: `[Student Count] Dashboard student count too high – Overview showed 16,032 because students were counted from the attendance table only. That included 16 Program_Ops / Training Institute accounts and 1 student under two IDs, so the eligible count (niat_users_core_backend_master_db) is 16,015.`

## Other columns

- **Date**: YYYY-MM-DD when the issue was found.
- **Action Item**: owner first, then the concrete next step: "Dashboard: ...", "DA: ...", "Ops: ...", "Hex: ...", "Decide: ...". One or two sentences.
- **Resolution**: one status word, colon, short note:
  - `Fixed and merged (<commit>): ...` – add "Live after republish" if not deployed
  - `Delivered: ...` – a file, export or query was handed over (name it)
  - `Resolved: ...` – settled without a code change
  - `Closed: ...` – not a bug / no action needed, say why
  - `Partly resolved: ...` – say which part is still open
  - `Open: ...` – say who it is with or what it waits on ("with DA", "with Ops", "waiting on definition", "policy decision", "not started", "fix ready on approval")
- **Resolution- Date**: YYYY-MM-DD for Fixed / Delivered / Resolved / Closed. Empty for Open and Partly resolved.

## Writing rules

- Plain, short sentences. Numbers over adjectives.
- One finding per row. If one issue has a data part and a dashboard part, split into two rows or use "Partly resolved".
- When a row relates to another row, say so (e.g. "see [Quiz Data] Crescent Sem-1 row").
- Never invent numbers, commit hashes or dates. Unknown = say so.
- No credentials, internal URLs or personal student data beyond UIDs already shared internally.
- Sort by Date ascending; within a day keep the user's order.

## "Add finding" command

When the user says "add finding" (with or without details):
1. Use what was found in this session (queries run, numbers, commits) to write the row. Ask only for what is missing.
2. Append it to the existing log file `findings_log.csv` in the project root (create it with the header row if it does not exist). Do not rewrite other rows.
3. Show the new row and say "Added 1 finding (N total, M open)".

## Updating an existing log

1. Keep existing rows. If their Findings lack an [Area] tag or context, offer to rewrite them in this format; do it only if the user agrees.
2. Update Resolution / Resolution- Date only where the user says the status changed.
3. Append new rows at the end.
4. Say in one line how many rows were added and which changed status.

## Output

- CSV, UTF-8 with BOM (`utf-8-sig`), fields with commas or quotes quoted.
- Show the table in chat if 15 rows or fewer.
- End with one line: total rows, how many Open, and the Areas covered.
