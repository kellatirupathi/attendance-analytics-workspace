import assert from "node:assert/strict";
import { test } from "node:test";
import { latestBySessionDate } from "./queries.js";

test("latest value comes from the newest session date up to today, not MAX", () => {
  const sql = latestBySessionDate("a.batch_section_name");
  assert.ok(!/\bMAX\(/.test(sql), "must not use MAX");
  // Sessions up to today first, then newest date, then the larger value as a stable tie-break.
  assert.match(sql, /ORDER BY \(DATE\(a\.date\) <= CURRENT_DATE\('Asia\/Kolkata'\)\) DESC, DATE\(a\.date\) DESC, /);
  assert.match(sql, /IGNORE NULLS/);
  assert.match(sql, /LIMIT 1\)\[SAFE_OFFSET\(0\)\]$/);
});

test("blank values are treated as missing and the column is trimmed", () => {
  const sql = latestBySessionDate("TRIM(a.batch_name)");
  assert.match(sql, /NULLIF\(TRIM\(CAST\(TRIM\(a\.batch_name\) AS STRING\)\), ''\) IGNORE NULLS/);
});
