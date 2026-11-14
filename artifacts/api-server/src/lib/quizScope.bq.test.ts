/**
 * Runs the real scoped-rows SQL (scopedQuizRowsSql) in BigQuery over small inline fixtures: no tables are
 * read or written. Skipped when no BigQuery credentials are set (BIGQUERY_SERVICE_ACCOUNT_JSON).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { scopedQuizRowsSql } from "./quizScoreSql.js";

const hasBq = Boolean(process.env["BIGQUERY_SERVICE_ACCOUNT_JSON"]);

type QuizFixture = [user: string, course: string, semesterTitle: string, isCurrent: 0 | 1, held: number, courseTitle?: string, college?: string];
type RosterFixture = [user: string, semesterTitle: string, isCurrent: 0 | 1, date?: string, section?: string, college?: string];

const s = (v: string) => `'${v.replace(/'/g, "\\'")}'`;
const quizTable = (rows: QuizFixture[]) =>
  `(SELECT * FROM UNNEST([${rows
    .map(
      ([u, course, sem, cur, held, title, college], i) =>
        `STRUCT(${s(u)} AS user_id, ${s(college ?? "College")} AS institute_name, 'S-01' AS section_name, ${s(course)} AS course_id, 'MODULE_QUIZ' AS derived_unit_type, ${s(title ?? `Course ${course}`)} AS semester_course_title, ${s(sem)} AS semester_title, ${cur} AS is_current_semester, ${held} AS total_scheduled_quizes, ${i} AS row_no)`,
    )
    .join(", ")}]))`;
const roster = (rows: RosterFixture[]) =>
  `(SELECT * FROM UNNEST([${rows
    .map(
      ([u, sem, cur, date, section, college]) =>
        `STRUCT(${s(u)} AS student_user_id, ${s(sem)} AS semester_title, ${cur} AS is_current_semester, DATE ${s(date ?? "2026-11-01")} AS date, ${s(section ?? "Batch-1-S-01")} AS batch_section_name, ${s(college ?? "College")} AS institute_name)`,
    )
    .join(", ")}]))`;

async function kept(quiz: QuizFixture[], people: RosterFixture[]): Promise<string[]> {
  const { bqQuery } = await import("./bigquery.js");
  const rows = await bqQuery<{ k: string }>(
    `SELECT CONCAT(user_id, ':', IF(institute_name = 'College', '', CONCAT(institute_name, ':')), course_id, ':', semester_title, ':', CAST(is_current_semester AS STRING)) AS k FROM ${scopedQuizRowsSql(quizTable(quiz), roster(people), "TRUE")} ORDER BY k`,
    {},
  );
  return rows.map((r) => r.k);
}

test("Chaitanya Batch-1 from 16 Nov (roster: current Semester 4, no quiz rows yet) → no rows: not Semester 3, not Batch-2's Semester 1", { skip: !hasBq }, async () => {
  const rows = await kept(
    [
      ["cdu1", "A", "Semester 1", 1, 20], // Batch-2's current Semester 1 plan, attached to a Batch-1 student
      ["cdu1", "B", "Semester 3", 0, 30], // their Semester 3, now ended
    ],
    [["cdu1", "Semester 4", 1]],
  );
  assert.deepEqual(rows, []);
});

test("Chaitanya Batch-1 now (roster: Semester 3 ended) → only Semester 3 rows", { skip: !hasBq }, async () => {
  const rows = await kept(
    [
      ["cdu2", "A", "Semester 1", 1, 20],
      ["cdu2", "B", "Semester 3", 0, 30],
      ["cdu2", "C", "Semester 2", 0, 25],
    ],
    [["cdu2", "Semester 3", 0]],
  );
  assert.deepEqual(rows, ["cdu2:B:Semester 3:0"]);
});

test("Batch-1 student in current Semester 3 → only current Semester 3 rows (no Batch-2 'Semester 1' current rows, no old copies)", { skip: !hasBq }, async () => {
  const rows = await kept(
    [
      ["b1", "M", "Semester 3", 1, 10],
      ["b1", "M", "Semester 3", 0, 10], // last year's copy of the same course
      ["b1", "W", "Semester 1", 1, 70], // Batch-2's Semester 1 label, last year's work
    ],
    [["b1", "Semester 3", 1]],
  );
  assert.deepEqual(rows, ["b1:M:Semester 3:1"]);
});

test("Nxtwave Institute (roster: current Semester 5, quiz rows only for Semester 4) → no rows", { skip: !hasBq }, async () => {
  assert.deepEqual(await kept([["nx", "A", "Semester 4", 0, 12]], [["nx", "Semester 5", 1]]), []);
});

test("Malla Reddy (roster: Semester 3 ended) → only Semester 3 rows", { skip: !hasBq }, async () => {
  const rows = await kept(
    [
      ["mrv", "A", "Semester 3", 0, 12],
      ["mrv", "B", "Semester 1", 0, 9],
    ],
    [["mrv", "Semester 3", 0]],
  );
  assert.deepEqual(rows, ["mrv:A:Semester 3:0"]);
});

test("same course_id under two course names in the semester → one row; students not on the roster → no rows", { skip: !hasBq }, async () => {
  const rows = await kept(
    [
      ["d", "X", "Semester 3", 1, 8, "Name One"],
      ["d", "X", "Semester 3", 1, 8, "Name Two"],
      ["gone", "X", "Semester 3", 1, 8],
    ],
    [["d", "Semester 3", 1]],
  );
  assert.deepEqual(rows, ["d:X:Semester 3:1"]);
});

// One place per student: the roster lists a transferred student in two sections.
const twoSectionQuiz: QuizFixture[] = [
  ["t", "OLD", "Semester 5", 1, 30], // Batch-1 section's current Semester 5
  ["t", "NEW", "Semester 1", 1, 20], // Batch-2 section's current Semester 1
];

test("two current sections → only the latest section's semester (newest session wins)", { skip: !hasBq }, async () => {
  const rows = await kept(twoSectionQuiz, [
    ["t", "Semester 5", 1, "2026-10-01", "AURORA Batch -1-S-002"],
    ["t", "Semester 1", 1, "2026-11-10", "AURORA Batch -2-S-02"],
  ]);
  assert.deepEqual(rows, ["t:NEW:Semester 1:1"]);
});

test("two current sections, the other one newer → that section's semester instead", { skip: !hasBq }, async () => {
  const rows = await kept(twoSectionQuiz, [
    ["t", "Semester 5", 1, "2026-11-12", "AURORA Batch -1-S-002"],
    ["t", "Semester 1", 1, "2026-11-10", "AURORA Batch -2-S-02"],
  ]);
  assert.deepEqual(rows, ["t:OLD:Semester 5:1"]);
});

test("same last date in both sections → the larger section name (as Attendance Stats)", { skip: !hasBq }, async () => {
  const rows = await kept(twoSectionQuiz, [
    ["t", "Semester 5", 1, "2026-11-10", "AURORA Batch -1-S-002"],
    ["t", "Semester 1", 1, "2026-11-10", "AURORA Batch -2-S-02"],
  ]);
  assert.deepEqual(rows, ["t:NEW:Semester 1:1"]);
});

test("sessions up to today beat a section with only future sessions", { skip: !hasBq }, async () => {
  const rows = await kept(twoSectionQuiz, [
    ["t", "Semester 5", 1, "2026-11-01", "AURORA Batch -1-S-002"],
    ["t", "Semester 1", 1, "2099-01-01", "AURORA Batch -2-S-02"],
  ]);
  assert.deepEqual(rows, ["t:OLD:Semester 5:1"]);
});

test("a current place beats a newer ended place", { skip: !hasBq }, async () => {
  const rows = await kept(
    [
      ["e", "CUR", "Semester 2", 1, 10],
      ["e", "END", "Semester 3", 0, 10],
    ],
    [
      ["e", "Semester 2", 1, "2026-10-01", "B-2-S-01"],
      ["e", "Semester 3", 0, "2026-11-05", "B-1-S-01"],
    ],
  );
  assert.deepEqual(rows, ["e:CUR:Semester 2:1"]);
});

test("moved to another college in the same semester → only the latest college's rows", { skip: !hasBq }, async () => {
  const rows = await kept(
    [
      ["m", "A", "Semester 3", 1, 10, undefined, "Old College"],
      ["m", "B", "Semester 3", 1, 12, undefined, "New College"],
    ],
    [
      ["m", "Semester 3", 1, "2026-09-01", "S-01", "Old College"],
      ["m", "Semester 3", 1, "2026-11-01", "S-04", "New College"],
    ],
  );
  assert.deepEqual(rows, ["m:New College:B:Semester 3:1"]);
});
