---
name: Attendance table session columns
description: BigQuery metadata mismatch for session identity fields in the overall attendance table.
---

For `niat_students_overall_attendance_details`, use `entity_type` for the session-type label and `entity_id` as the fallback session identity. Do not query `session_type`.

**Why:** `INFORMATION_SCHEMA.COLUMNS` advertises `session_type`, but direct queries fail with `Unrecognized name: session_type`. Real rows returned through `TO_JSON_STRING` contain `entity_type` and `entity_id` instead.

**How to apply:** Attendance rollups should prefer `session_id`, then `entity_id`, then a label built from `entity_type` and the time range. Production-sequence tables can still use their genuine `session_type` column.