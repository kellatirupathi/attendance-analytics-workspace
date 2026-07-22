---
name: BigQuery quiz table shape
description: Structural facts about the live BQ quiz source that constrain what quiz features are possible.
---

# Live BigQuery quiz table

The quiz data in BigQuery is **pre-aggregated**: one row per `student × course × unit_type`.

Key constraints (verified against the live table via `/api/bigquery/preview`):
- **No date/timestamp column** and **no `is_current_semester` flag**. You cannot build quiz time-series, history, or "current semester only" filtering from this table.
- Status is **derived, not stored**: a row represents a rollup (`total_completed_quizzes` of `total_quizzes`). "Completed vs pending" is inferred, not a column.
- `derived_unit_type` distinguishes `CLASSROOM_QUIZ` vs `MODULE_QUIZ`; `avg_best_attempt_percentage_score` is nullable (treat null as 0).

**Why:** future requests to add quiz trends, per-attempt history, or date filtering will fail silently against this schema — the columns simply do not exist.

**How to apply:** the API returns quiz `status` as `"Attempted"` / `"Pending"`; the SPI frontend maps `status.toLowerCase() !== "pending"` → COMPLETED badge, else PENDING. Keep that mapping in sync if backend status strings change.
