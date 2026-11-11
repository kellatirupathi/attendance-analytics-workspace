// Replaces skill_assessment_course_map with the semester-wise SA course mapping file (agreed 11 Nov 2026).
//
//   node lib/db/scripts/load-sa-course-map.mjs [csv]            dry run: checks the file, writes nothing
//   node lib/db/scripts/load-sa-course-map.mjs [csv] --apply    backs up, then replaces the rows
//
// csv defaults to exports/SA_course_mapping_ALL_semesters_11Nov.csv. Uses DATABASE_URL (Replit Shell = Development).
//
// --apply, in this order:
//   1. Saves every current row to exports/sa-course-map-backup-<time>.json (restore = insert those rows back).
//   2. In ONE transaction: adds the six new columns if missing (ADD COLUMN IF NOT EXISTS; nothing dropped),
//      deletes the old rows, inserts the file rows, checks the count. Any error rolls everything back.
// Rows with an empty skill_assessment_course_name (status "No course name in SA table") are kept: the table needs a
// name and its key has no semester, so they are stored as "(no course name) <semester>". That name never appears in
// the Skill Assessment data, so they never link to a report course; they keep the record (and the note) only.
// Same columns as lib/db/src/schema/reportConfig.ts (skillAssessmentCourseMapTable).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const csvPath = args.find((a) => !a.startsWith("--")) ?? "exports/SA_course_mapping_ALL_semesters_11Nov.csv";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.");

/** RFC 4180 CSV: quoted fields, "" inside quotes, commas and newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v !== "")) rows.push(row); }
  return rows;
}

const HEADER = ["college", "batch", "semester", "is_current_semester", "skill_assessment_course_name", "report_course_name",
  "status", "main_sa_count", "students", "first_sa_date", "last_sa_date", "note"];
const [header, ...data] = parseCsv(readFileSync(csvPath, "utf8").replace(/^﻿/, ""));
if (header.join(",") !== HEADER.join(",")) throw new Error(`Unexpected header:\n${header.join(",")}\nexpected:\n${HEADER.join(",")}`);

const rec = data.map((r) => Object.fromEntries(HEADER.map((h, i) => [h, (r[i] ?? "").trim()])));
const NO_NAME = (semester) => `(no course name) ${semester}`;
const noName = rec.filter((r) => !r.skill_assessment_course_name);
const load = rec.map((r) => (r.skill_assessment_course_name ? r : { ...r, skill_assessment_course_name: NO_NAME(r.semester) }));
const plain = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
// The table key is (college, batch, skill_assessment_course_name): two semesters cannot share one course.
const seen = new Map();
for (const r of load) {
  const k = [r.college, r.batch, r.skill_assessment_course_name].map(plain).join("|");
  if (seen.has(k)) throw new Error(`Duplicate key in the file (same college, batch, SA course): ${k} in ${seen.get(k)} and ${r.semester}`);
  seen.set(k, r.semester);
}
const intOrNull = (v) => (v === "" ? null : Number.parseInt(v, 10));
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const byStatus = load.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});

console.log(`File: ${csvPath}`);
console.log(`Rows in file: ${rec.length} | empty SA course name (stored as "(no course name) <semester>"): ${noName.length} | to load: ${load.length}`);
console.log("To load by status:", byStatus);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const before = await client.query("SELECT * FROM skill_assessment_course_map ORDER BY college, batch, skill_assessment_course_name");
  console.log(`Rows in the table now: ${before.rows.length}`);
  if (!apply) {
    console.log("Dry run: nothing written. Add --apply to back up and replace the rows.");
  } else {
    mkdirSync("exports", { recursive: true });
    const backup = path.join("exports", `sa-course-map-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(backup, JSON.stringify(before.rows, null, 1));
    console.log(`Backup of ${before.rows.length} rows: ${backup}`);

    await client.query("BEGIN");
    for (const ddl of [
      "ADD COLUMN IF NOT EXISTS semester text",
      "ADD COLUMN IF NOT EXISTS is_current_semester integer",
      "ADD COLUMN IF NOT EXISTS main_sa_count integer",
      "ADD COLUMN IF NOT EXISTS students integer",
      "ADD COLUMN IF NOT EXISTS first_sa_date date",
      "ADD COLUMN IF NOT EXISTS last_sa_date date",
    ]) await client.query(`ALTER TABLE skill_assessment_course_map ${ddl}`);
    const deleted = await client.query("DELETE FROM skill_assessment_course_map");
    for (const r of load) {
      await client.query(
        `INSERT INTO skill_assessment_course_map (college, batch, skill_assessment_course_name, report_course_name, status,
           semester, is_current_semester, main_sa_count, students, first_sa_date, last_sa_date)
         VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, $7, $8, $9, $10, $11)`,
        [r.college, r.batch, r.skill_assessment_course_name, r.report_course_name, r.status, r.semester,
          intOrNull(r.is_current_semester), intOrNull(r.main_sa_count), intOrNull(r.students), dateOrNull(r.first_sa_date), dateOrNull(r.last_sa_date)],
      );
    }
    const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM skill_assessment_course_map");
    if (rows[0].n !== load.length) throw new Error(`Count check failed: ${rows[0].n} rows, expected ${load.length}`);
    await client.query("COMMIT");
    console.log(`Done: deleted ${deleted.rowCount} old rows, inserted ${load.length}.`);
  }
  const now = await client.query("SELECT status, COUNT(*)::int AS n FROM skill_assessment_course_map GROUP BY 1 ORDER BY 1");
  console.table(now.rows);
} catch (err) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Failed, nothing changed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
