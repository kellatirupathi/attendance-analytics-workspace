---
name: Attendance table session columns
description: BigQuery metadata mismatch for session identity fields in the overall attendance table.
---

For `niat_students_overall_attendance_details`, use `entity_type` for the session-type label and `entity_id` as the fallback session identity. Do not query `session_type`.

**Why:** `INFORMATION_SCHEMA.COLUMNS` advertises `session_type`, but direct queries fail with `Unrecognized name: session_type`. Real rows returned through `TO_JSON_STRING` contain `entity_type` and `entity_id` instead.

**How to apply:** Attendance rollups should prefer `session_id`, then `entity_id`, then a label built from `entity_type` and the time range. Production-sequence tables can still use their genuine `session_type` column.

Validate warehouse compatibility through actual zero-row SQL projections, not schema metadata, and fail release readiness when live access cannot be verified.

**Why:** Metadata was misleading in this incident; an offline success or skipped credential check would recreate the same false confidence. Zero-row validation checks queryability without reading student records.

**How to apply:** Keep identity expressions shared between runtime queries and validation. Treat this as a schema/SQL compatibility check, not a check of attendance data quality or computed totals.