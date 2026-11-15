/**
 * Runs the report's semester / date pick (latestSessionRowSql) in BigQuery over inline rows: no tables are read
 * or written. Skipped without BigQuery credentials (BIGQUERY_SERVICE_ACCOUNT_JSON).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const hasBq = Boolean(process.env["BIGQUERY_SERVICE_ACCOUNT_JSON"]);
type Row = [section: string, semester: string, start: string, end: string, date: string];

async function pick(rows: Row[]): Promise<{ section: string; semester: string; start: string; end: string }> {
  const { bqQuery } = await import("./bigquery.js");
  const { latestBySessionDate, latestSessionRowSql } = await import("./queries.js");
  const src = rows
    .map(([s, sem, sd, ed, d]) => `STRUCT('${s}' AS batch_section_name, '${sem}' AS semester_title, DATE '${sd}' AS semester_start_date, DATE '${ed}' AS semester_end_date, DATE '${d}' AS date)`)
    .join(", ");
  const [r] = await bqQuery<{ section: string; semester: string; start: string; end: string }>(
    `SELECT ${latestBySessionDate("a.batch_section_name")} AS section,
            ${latestSessionRowSql("TRIM(CAST(a.semester_title AS STRING))")} AS semester,
            ${latestSessionRowSql("CAST(DATE(a.semester_start_date) AS STRING)")} AS start,
            ${latestSessionRowSql("CAST(DATE(a.semester_end_date) AS STRING)")} AS \`end\`
     FROM UNNEST([${src}]) a`,
    {},
  );
  return r!;
}

test("moved Batch-1 (Semester 3) → Batch-2 (Semester 1): semester and dates of the latest section, not MAX", { skip: !hasBq }, async () => {
  const r = await pick([
    ["Yenepoya KA CSE AI Batch -1-S-001", "Semester 3", "2026-08-03", "2026-12-04", "2026-08-10"],
    ["Yenepoya KA CSE AI Batch -2-S-004", "Semester 1", "2026-07-27", "2026-12-04", "2026-11-14"],
  ]);
  assert.deepEqual(r, { section: "Yenepoya KA CSE AI Batch -2-S-004", semester: "Semester 1", start: "2026-07-27", end: "2026-12-04" });
});

test("dates come from the same section (no MIN start / MAX end across two sections)", { skip: !hasBq }, async () => {
  const r = await pick([
    ["JFS02", "Semester 1", "2026-01-27", "2027-01-27", "2026-11-14"],
    ["PFS06", "Semester 1", "2026-02-27", "2027-02-27", "2026-10-01"],
  ]);
  assert.deepEqual(r, { section: "JFS02", semester: "Semester 1", start: "2026-01-27", end: "2027-01-27" });
});

test("'Semester 10' is not lost to 'Semester 2' by text order: the latest section decides", { skip: !hasBq }, async () => {
  const r = await pick([
    ["B-S-01", "Semester 2", "2026-01-01", "2026-06-01", "2026-05-01"],
    ["B-S-02", "Semester 10", "2026-07-01", "2026-12-01", "2026-11-10"],
  ]);
  assert.equal(r.semester, "Semester 10");
});

test("same last date in two sections: the larger section name, for section and semester alike", { skip: !hasBq }, async () => {
  const r = await pick([
    ["S-001", "Semester 3", "2026-08-03", "2026-12-04", "2026-11-14"],
    ["S-002", "Semester 1", "2026-07-27", "2026-12-10", "2026-11-14"],
  ]);
  assert.deepEqual(r, { section: "S-002", semester: "Semester 1", start: "2026-07-27", end: "2026-12-10" });
});

test("sessions up to today beat future-only sessions", { skip: !hasBq }, async () => {
  const r = await pick([
    ["OLD", "Semester 3", "2026-08-03", "2026-12-04", "2026-11-10"],
    ["NEW", "Semester 4", "2099-01-01", "2099-06-01", "2099-01-05"],
  ]);
  assert.deepEqual(r, { section: "OLD", semester: "Semester 3", start: "2026-08-03", end: "2026-12-04" });
});
