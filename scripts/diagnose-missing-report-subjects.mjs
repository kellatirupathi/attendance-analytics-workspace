// Read-only diagnosis: why do some students' reports (/spi/:studentId) list
// fewer subjects than their campus + semester (+ section) schedule has?
//
// Usage (reads BIGQUERY_SERVICE_ACCOUNT_JSON like the API server, else the
// gitignored .secrets/bigquery-service-account.json):
//   node scripts/diagnose-missing-report-subjects.mjs ["Chaitanya Deemed-to-be University"] ["Semester 1"]
//
// Only SELECT queries are run.
import fs from "node:fs";
import { createSign } from "node:crypto";

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || "kossip-helpers";
const BQ_LOCATION = process.env.BQ_LOCATION || "asia-south1";
const sa = JSON.parse(
  process.env.BIGQUERY_SERVICE_ACCOUNT_JSON ??
    fs.readFileSync(
      process.env.BIGQUERY_SERVICE_ACCOUNT_FILE ??
        new URL("../.secrets/bigquery-service-account.json", import.meta.url),
      "utf8",
    ),
);
const CAMPUS = process.argv[2] || "Chaitanya Deemed-to-be University";
const SEMESTER = process.argv[3] || "Semester 1";

const DS = "kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace";
const ATT = `\`${DS}.niat_students_overall_attendance_details\``;
const SEQ = `\`${DS}.niat_schedule_details_as_per_prod_sequence\``;
const exclusions = JSON.parse(
  fs.readFileSync(new URL("../artifacts/api-server/config/attendance-exclusions.json", import.meta.url), "utf8"),
);
const EXCL_CATS = exclusions.excludedCategories.map((c) => c.trim().toUpperCase());
const sqlList = (items) => (items.length ? items.map((c) => `'${c.replace(/'/g, "\\'")}'`).join(", ") : "'\\u0000'");

function b64(data) {
  return Buffer.from(data).toString("base64url");
}
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${body}.${signer.sign(sa.private_key, "base64url")}`,
    }),
  });
  if (!res.ok) throw new Error(`token error ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}
const accessToken = await token();

async function q(sql, params = {}) {
  const queryParameters = Object.entries(params).map(([name, value]) => ({
    name,
    parameterType: { type: "STRING" },
    parameterValue: { value },
  }));
  let res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/queries`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 60000, location: BQ_LOCATION, parameterMode: "NAMED", queryParameters, maxResults: 100000 }),
  });
  if (!res.ok) throw new Error(`query failed ${res.status}: ${await res.text()}\n${sql}`);
  let data = await res.json();
  while (!data.jobComplete) {
    res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/queries/${data.jobReference.jobId}?location=${BQ_LOCATION}&timeoutMs=60000`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    data = await res.json();
  }
  if (!data.rows) return [];
  const cols = data.schema.fields.map((f) => f.name);
  return data.rows.map((r) => Object.fromEntries(r.f.map((c, i) => [cols[i], c.v])));
}
const print = (title, rows) => {
  console.log(`\n### ${title} (${rows.length} rows)`);
  if (rows.length) console.table(rows.slice(0, 60));
};

// ---- 0. columns actually present (so the joins below use real names) ----
for (const table of [ATT, SEQ]) {
  const [row] = await q(`SELECT * FROM ${table} LIMIT 1`);
  console.log(`\n### columns of ${table}: ${Object.keys(row ?? {}).join(", ")}`);
}

// ---- 1. what the schedule says the campus + semester should have ----
print(
  `Scheduled subjects for ${CAMPUS} / ${SEMESTER} (prod sequence, current semester)`,
  await q(
    `SELECT TRIM(course_title) AS course, TRIM(CAST(course_category AS STRING)) AS category,
            COUNT(DISTINCT section_id) AS sections, COUNT(DISTINCT session_id) AS sessions,
            COUNT(DISTINCT IF(session_status = 'COMPLETED', session_id, NULL)) AS completed,
            MIN(DATE(session_start_datetime)) AS first_date
     FROM ${SEQ}
     WHERE TRIM(institute_name) = @campus AND TRIM(semester_title) = @sem AND is_current_semester = 1
     GROUP BY course, category ORDER BY course`,
    { campus: CAMPUS, sem: SEMESTER },
  ),
);

// ---- 2. per student: what the report shows vs. what is scheduled, and where each subject is lost ----
// Mirrors courseAttendanceSql() in artifacts/api-server/src/lib/queries.ts step by step.
const perSubjectSql = `
WITH students AS (
  SELECT LOWER(REPLACE(CAST(student_user_id AS STRING), '-', '')) AS sid,
         MAX(student_name) AS student_name,
         MAX(TRIM(batch_section_name)) AS section_name,
         MAX(REPLACE(CAST(section_id AS STRING), '-', '')) AS section_key
  FROM ${ATT}
  WHERE TRIM(institute_name) = @campus AND TRIM(semester_title) = @sem AND is_current_semester = 1
  GROUP BY sid
),
scheduled AS (
  SELECT DISTINCT REPLACE(CAST(section_id AS STRING), '-', '') AS section_key,
         TRIM(course_title) AS course,
         UPPER(TRIM(CAST(course_category AS STRING))) AS category
  FROM ${SEQ}
  WHERE TRIM(institute_name) = @campus AND TRIM(semester_title) = @sem AND is_current_semester = 1
),
seqcat AS (
  SELECT DISTINCT REPLACE(CAST(session_id AS STRING), '-', '') AS session_key,
         REPLACE(CAST(section_id AS STRING), '-', '') AS section_key,
         course_category
  FROM ${SEQ} WHERE session_id IS NOT NULL AND section_id IS NOT NULL
),
att AS (
  SELECT LOWER(REPLACE(CAST(a.student_user_id AS STRING), '-', '')) AS sid,
         TRIM(a.subject_title) AS course,
         a.is_current_semester = 1 AS cur,
         UPPER(CAST(a.entity_type AS STRING)) = 'SESSION_SLOT' AS slot,
         DATE(a.date) <= CURRENT_DATE('Asia/Kolkata') AS past,
         UPPER(IFNULL(TRIM(CAST(seq.course_category AS STRING)), '')) AS category
  FROM ${ATT} a
  LEFT JOIN seqcat seq
    ON seq.session_key = REPLACE(CAST(a.session_id AS STRING), '-', '')
   AND seq.section_key = REPLACE(CAST(a.section_id AS STRING), '-', '')
  WHERE TRIM(a.institute_name) = @campus
),
att_by AS (
  SELECT sid, course,
         COUNT(*) AS any_rows,
         COUNTIF(cur) AS cur_rows,
         COUNTIF(cur AND slot) AS slot_rows,
         COUNTIF(cur AND slot AND past) AS past_rows,
         COUNTIF(cur AND slot AND past AND category NOT IN (${sqlList(EXCL_CATS)})) AS report_rows,
         STRING_AGG(DISTINCT NULLIF(category, ''), '/') AS att_categories
  FROM att GROUP BY sid, course
)
SELECT s.sid, s.student_name, s.section_name,
       COALESCE(sc.course, ab.course) AS course,
       sc.category AS scheduled_category,
       sc.course IS NOT NULL AS in_schedule,
       IFNULL(ab.any_rows, 0) AS any_rows, IFNULL(ab.cur_rows, 0) AS cur_rows,
       IFNULL(ab.slot_rows, 0) AS slot_rows, IFNULL(ab.past_rows, 0) AS past_rows,
       IFNULL(ab.report_rows, 0) AS report_rows, ab.att_categories
FROM students s
LEFT JOIN scheduled sc ON sc.section_key = s.section_key
FULL OUTER JOIN att_by ab ON ab.sid = s.sid AND ab.course = sc.course
WHERE s.sid IS NOT NULL`;

const rows = await q(perSubjectSql, { campus: CAMPUS, sem: SEMESTER });
const byStudent = new Map();
for (const r of rows) {
  const s = byStudent.get(r.sid) ?? { sid: r.sid, name: r.student_name, section: r.section_name, scheduled: new Set(), report: new Set(), rows: [] };
  if (r.in_schedule === "true" && !EXCL_CATS.includes(r.scheduled_category ?? "")) s.scheduled.add(r.course);
  if (Number(r.report_rows) > 0) s.report.add(r.course);
  s.rows.push(r);
  byStudent.set(r.sid, s);
}

function lossReason(r) {
  if (Number(r.report_rows) > 0) return "shown";
  if (Number(r.any_rows) === 0) return "no attendance rows for this student";
  if (Number(r.cur_rows) === 0) return "rows not flagged current semester";
  if (Number(r.slot_rows) === 0) return "no SESSION_SLOT rows";
  if (Number(r.past_rows) === 0) return "only future-dated rows";
  return `category excluded (${r.att_categories})`;
}

const students = [...byStudent.values()];
const dist = {};
for (const s of students) dist[`${s.report.size} shown / ${s.scheduled.size} scheduled`] = (dist[`${s.report.size} shown / ${s.scheduled.size} scheduled`] ?? 0) + 1;
print(`Students by subjects shown vs scheduled (${CAMPUS} / ${SEMESTER})`, Object.entries(dist).map(([k, n]) => ({ bucket: k, students: n })));

const reasons = {};
for (const s of students) for (const r of s.rows) {
  if (r.in_schedule !== "true" || Number(r.report_rows) > 0) continue;
  const key = `${r.course} — ${lossReason(r)}`;
  reasons[key] = (reasons[key] ?? 0) + 1;
}
print("Why scheduled subjects are missing from reports (subject — reason: students)", Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ reason: k, students: n })));

const sample = [
  ...students.filter((s) => s.report.size === 3).slice(0, 3),
  ...students.filter((s) => s.report.size >= 6).slice(0, 3),
];
for (const s of sample) {
  print(
    `Sample ${s.name} (${s.sid}) · ${s.section} · shown ${s.report.size} / scheduled ${s.scheduled.size}`,
    s.rows.map((r) => ({
      course: r.course,
      scheduled: r.in_schedule === "true" ? r.scheduled_category : "—",
      any: r.any_rows, cur: r.cur_rows, slot: r.slot_rows, past: r.past_rows, report: r.report_rows,
      result: lossReason(r),
    })),
  );
}

// ---- 3. all campuses: how many students have fewer subjects on the report than scheduled ----
const allCampus = await q(`
WITH students AS (
  SELECT LOWER(REPLACE(CAST(student_user_id AS STRING), '-', '')) AS sid,
         MAX(TRIM(institute_name)) AS campus,
         MAX(REPLACE(CAST(section_id AS STRING), '-', '')) AS section_key
  FROM ${ATT} WHERE is_current_semester = 1 GROUP BY sid
),
scheduled AS (
  SELECT REPLACE(CAST(section_id AS STRING), '-', '') AS section_key,
         COUNT(DISTINCT TRIM(course_title)) AS n
  FROM ${SEQ}
  WHERE is_current_semester = 1
    AND UPPER(IFNULL(TRIM(CAST(course_category AS STRING)), '')) NOT IN (${sqlList(EXCL_CATS)})
  GROUP BY section_key
),
seqcat AS (
  SELECT DISTINCT REPLACE(CAST(session_id AS STRING), '-', '') AS session_key,
         REPLACE(CAST(section_id AS STRING), '-', '') AS section_key, course_category
  FROM ${SEQ} WHERE session_id IS NOT NULL AND section_id IS NOT NULL
),
shown AS (
  SELECT LOWER(REPLACE(CAST(a.student_user_id AS STRING), '-', '')) AS sid,
         COUNT(DISTINCT TRIM(a.subject_title)) AS n
  FROM ${ATT} a
  LEFT JOIN seqcat seq
    ON seq.session_key = REPLACE(CAST(a.session_id AS STRING), '-', '')
   AND seq.section_key = REPLACE(CAST(a.section_id AS STRING), '-', '')
  WHERE a.is_current_semester = 1 AND UPPER(CAST(a.entity_type AS STRING)) = 'SESSION_SLOT'
    AND DATE(a.date) <= CURRENT_DATE('Asia/Kolkata')
    AND a.subject_title IS NOT NULL AND TRIM(a.subject_title) != ''
    AND UPPER(IFNULL(TRIM(CAST(seq.course_category AS STRING)), '')) NOT IN (${sqlList(EXCL_CATS)})
  GROUP BY sid
)
SELECT s.campus,
       COUNT(*) AS students,
       COUNTIF(IFNULL(sh.n, 0) < IFNULL(sc.n, 0)) AS students_missing_subjects
FROM students s
LEFT JOIN scheduled sc USING (section_key)
LEFT JOIN shown sh USING (sid)
GROUP BY s.campus ORDER BY students_missing_subjects DESC`);
print("All campuses: students whose report shows fewer subjects than their section's schedule", allCampus);
console.log(`\nTOTAL students missing subjects: ${allCampus.reduce((n, r) => n + Number(r.students_missing_subjects), 0)} of ${allCampus.reduce((n, r) => n + Number(r.students), 0)}`);
