import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateAttendanceStats,
  attendanceFilterOptions,
  onePlacePerStudent,
  type AttendanceClassRow,
  type AttendanceDetailRow,
  type AttendanceFilters,
} from "./attendanceStatsAggregate.js";

type Raw = AttendanceDetailRow & { lastDate: string | null };

/** One student × subject row; present / scheduled default to 8 of 10. */
function row(o: Partial<Raw> & { studentId: string; university: string }): Raw {
  return {
    batch: "B1",
    semester: "Semester 1",
    ended: false,
    subject: "Maths",
    section: "S-01",
    unit: "",
    studentName: o.studentId,
    present: 8,
    scheduled: 10,
    lastDate: "2026-11-01",
    ...o,
  };
}

const NO_FILTERS: AttendanceFilters = { campuses: [], semesters: [], sections: [], students: [] };
const NO_CLASSES: AttendanceClassRow[] = [];
const latest = (rows: Raw[]) => onePlacePerStudent(rows, { dropEndedWhenCurrent: true });
const batchRows = (rows: AttendanceDetailRow[], f: AttendanceFilters = NO_FILTERS) =>
  aggregateAttendanceStats(rows, NO_CLASSES, "university_batch", f).rows;

// --- onePlacePerStudent -------------------------------------------------------------

test("transfer inside one college: old batch rows move to the latest batch", () => {
  const out = latest([
    row({ studentId: "parth", university: "ADYPU", batch: "AURORA Batch -2", lastDate: "2026-10-13" }),
    row({ studentId: "parth", university: "ADYPU", batch: "ADYPU Batch-2", lastDate: "2026-11-05", subject: "English" }),
  ]);
  assert.deepEqual(out.map((r) => r.batch), ["ADYPU Batch-2", "ADYPU Batch-2"]);
  const rows = batchRows(out);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.students, 1);
  // Old sessions still count (as on the student report): 16 of 20.
  assert.equal(rows[0]!.present, 16);
  assert.equal(rows[0]!.scheduled, 20);
});

test("result does not depend on row order", () => {
  const rows = [
    row({ studentId: "s", university: "C", batch: "Old", lastDate: "2026-09-01" }),
    row({ studentId: "s", university: "C", batch: "New", lastDate: "2026-11-01", subject: "English" }),
  ];
  assert.deepEqual(latest(rows).map((r) => r.batch), latest([...rows].reverse()).map((r) => r.batch).reverse());
  assert.ok(latest([...rows].reverse()).every((r) => r.batch === "New"));
});

test("same last date in two batches: the later batch name wins in either order", () => {
  const a = row({ studentId: "s", university: "C", batch: "Batch-1", lastDate: "2026-11-01" });
  const b = row({ studentId: "s", university: "C", batch: "Batch-2", lastDate: "2026-11-01", subject: "English" });
  assert.ok(latest([a, b]).every((r) => r.batch === "Batch-2"));
  assert.ok(latest([b, a]).every((r) => r.batch === "Batch-2"));
});

test("a batch never crosses colleges: rows under two colleges keep their own batches", () => {
  const out = onePlacePerStudent(
    [
      row({ studentId: "s", university: "College A", batch: "A Batch-1", lastDate: "2026-09-01" }),
      row({ studentId: "s", university: "College B", batch: "B Batch-1", lastDate: "2026-11-01" }),
    ],
    { dropEndedWhenCurrent: false },
  );
  assert.deepEqual(out.map((r) => `${r.university}|${r.batch}`), ["College A|A Batch-1", "College B|B Batch-1"]);
});

test("latest view: a student with current rows loses their ended-semester rows", () => {
  const rows = [
    row({ studentId: "s", university: "CDU", batch: "Noida Batch -2", semester: "Semester 3", ended: true, lastDate: "2026-10-01" }),
    row({ studentId: "s", university: "Noida", batch: "Noida Batch -2", semester: "Semester 1", lastDate: "2026-11-01" }),
  ];
  const out = latest(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.university, "Noida");
});

test("date range / earlier semester: ended rows are kept even when the student has current ones", () => {
  const rows = [
    row({ studentId: "s", university: "C", semester: "Semester 2", ended: true, lastDate: "2026-05-01" }),
    row({ studentId: "s", university: "C", semester: "Semester 3", lastDate: "2026-11-01" }),
  ];
  assert.equal(onePlacePerStudent(rows, { dropEndedWhenCurrent: false }).length, 2);
});

test("a student with only ended rows (batch between semesters) is kept", () => {
  const out = latest([row({ studentId: "s", university: "CDU", ended: true, semester: "Semester 3" })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ended, true);
});

test("missing batch reads as Unknown, and a missing last date loses to a real one", () => {
  const out = latest([
    row({ studentId: "s", university: "C", batch: "", lastDate: null }),
    row({ studentId: "t", university: "C", batch: "", lastDate: null }),
    row({ studentId: "t", university: "C", batch: "B2", lastDate: "2026-01-01", subject: "English" }),
  ]);
  assert.equal(out[0]!.batch, "Unknown");
  assert.ok(out.filter((r) => r.studentId === "t").every((r) => r.batch === "B2"));
});

// --- Batch-wise view ------------------------------------------------------------------

test("a few students with rows in a second semester do not split the batch", () => {
  const rows: AttendanceDetailRow[] = [
    ...["a", "b", "c"].map((id) => row({ studentId: id, university: "Yenepoya", batch: "Batch-2", semester: "Semester 3" })),
    row({ studentId: "a", university: "Yenepoya", batch: "Batch-2", semester: "Semester 1", subject: "English" }),
  ];
  const out = batchRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.semester, "Semester 3");
  assert.equal(out[0]!.students, 3);
});

test("ended label follows the batch's main semester", () => {
  const rows: AttendanceDetailRow[] = [
    ...["a", "b"].map((id) => row({ studentId: id, university: "CDU", batch: "CDU-1", semester: "Semester 3", ended: true })),
  ];
  assert.equal(batchRows(rows)[0]!.ended, true);
  const mixed = [...rows, ...["c", "d", "e"].map((id) => row({ studentId: id, university: "CDU", batch: "CDU-1", semester: "Semester 4" }))];
  const out = batchRows(mixed)[0]!;
  assert.equal(out.semester, "Semester 4");
  assert.equal(out.ended, false);
});

test("batch rows add up to the header student count (each student in one batch)", () => {
  const rows = latest([
    row({ studentId: "p", university: "ADYPU", batch: "AURORA Batch -2", lastDate: "2026-10-01" }),
    row({ studentId: "p", university: "ADYPU", batch: "ADYPU Batch-2", lastDate: "2026-11-01", subject: "English" }),
    row({ studentId: "q", university: "ADYPU", batch: "ADYPU Batch-1", semester: "Semester 3" }),
    row({ studentId: "r", university: "AMET", batch: "AMET-1" }),
    row({ studentId: "x", university: "CDU", batch: "Noida -2", semester: "Semester 3", ended: true, lastDate: "2026-10-01" }),
    row({ studentId: "x", university: "Noida", batch: "Noida -2" }),
  ]);
  const result = aggregateAttendanceStats(rows, NO_CLASSES, "university_batch", NO_FILTERS);
  assert.equal(result.summary.students, 4);
  assert.equal(result.rows.reduce((sum, r) => sum + r.students, 0), 4);
  const campus = aggregateAttendanceStats(rows, NO_CLASSES, "university", NO_FILTERS).rows;
  assert.equal(campus.reduce((sum, r) => sum + r.students, 0), 4);
});

test("the same section name in two batches stays two section rows", () => {
  const rows = [
    row({ studentId: "a", university: "C", batch: "B1", section: "S-01" }),
    row({ studentId: "b", university: "C", batch: "B2", section: "S-01" }),
  ];
  const out = aggregateAttendanceStats(rows, NO_CLASSES, "university_section", NO_FILTERS).rows;
  assert.deepEqual(out.map((r) => `${r.batch}|${r.section}|${r.students}`), ["B1|S-01|1", "B2|S-01|1"]);
});

// --- Filters ---------------------------------------------------------------------------

test("running only + ended only = all students", () => {
  const rows = latest([
    row({ studentId: "a", university: "C", batch: "B1" }),
    row({ studentId: "b", university: "C", batch: "B1" }),
    row({ studentId: "c", university: "CDU", batch: "CDU-1", ended: true, semester: "Semester 3" }),
  ]);
  const count = (status?: "running" | "ended") => aggregateAttendanceStats(rows, NO_CLASSES, "university", { ...NO_FILTERS, status }).summary.students;
  assert.equal(count("running"), 2);
  assert.equal(count("ended"), 1);
  assert.equal(count("running") + count("ended"), count());
});

test("batch filter keeps only that college's batch", () => {
  const rows = [
    row({ studentId: "a", university: "C1", batch: "Batch-1" }),
    row({ studentId: "b", university: "C2", batch: "Batch-1" }),
  ];
  const out = aggregateAttendanceStats(rows, NO_CLASSES, "university", { ...NO_FILTERS, batches: ["C1\tBatch-1"] });
  assert.equal(out.summary.students, 1);
  assert.deepEqual(out.rows.map((r) => r.university), ["C1"]);
});

test("batch menu: main semester, unique students, ended count", () => {
  const rows = latest([
    row({ studentId: "a", university: "C", batch: "B1", semester: "Semester 3" }),
    row({ studentId: "a", university: "C", batch: "B1", semester: "Semester 3", subject: "English" }),
    row({ studentId: "b", university: "C", batch: "B1", semester: "Semester 3" }),
    row({ studentId: "a", university: "C", batch: "B1", semester: "Semester 1", subject: "Tech" }),
    row({ studentId: "c", university: "CDU", batch: "CDU-1", ended: true, semester: "Semester 3" }),
  ]);
  const opts = attendanceFilterOptions(rows, { campuses: [], semesters: [] });
  assert.deepEqual(opts.batches.map((b) => `${b.campus}|${b.batch}|${b.semester}|${b.ended}|${b.students}`), [
    "C|B1|Semester 3|false|2",
    "CDU|CDU-1|Semester 3|true|1",
  ]);
  assert.deepEqual(opts.ended, { batches: 1, students: 1 });
  // Picking a college lists only its batches.
  assert.deepEqual(attendanceFilterOptions(rows, { campuses: ["C"], semesters: [] }).batches.map((b) => b.batch), ["B1"]);
});

// --- Tiers -----------------------------------------------------------------------------

test("tier comes from the saved report when it has the student; subject filter uses the rows instead", () => {
  const rows = [
    row({ studentId: "ab-cd", university: "C", subject: "Maths", present: 9, scheduled: 10 }),
    row({ studentId: "ab-cd", university: "C", subject: "English", present: 9, scheduled: 10 }),
  ];
  const report = { abcd: { pct: 40, subject: "Maths" } };
  const all = aggregateAttendanceStats(rows, NO_CLASSES, "university", NO_FILTERS, report).summary;
  assert.equal(all.ineligible, 1, "report says 40% -> Ineligible");
  const maths = aggregateAttendanceStats(rows, NO_CLASSES, "university", { ...NO_FILTERS, subjects: ["Maths"] }, report).summary;
  assert.equal(maths.eligible, 1, "Maths rows say 90% -> Eligible");
});

test("without a report the tier is the lowest subject, not the overall %", () => {
  const rows = [
    row({ studentId: "s", university: "C", subject: "Maths", present: 10, scheduled: 10 }),
    row({ studentId: "s", university: "C", subject: "English", present: 5, scheduled: 10 }),
  ];
  const sum = aggregateAttendanceStats(rows, NO_CLASSES, "university", NO_FILTERS).summary;
  assert.equal(sum.overallPct, 75);
  assert.equal(sum.atRisk, 1, "lowest subject 50% -> At risk");
});

test("a student with no scheduled sessions is counted but gets no tier", () => {
  const rows = [row({ studentId: "s", university: "C", present: 0, scheduled: 0 })];
  const sum = aggregateAttendanceStats(rows, NO_CLASSES, "university", NO_FILTERS).summary;
  assert.equal(sum.students, 1);
  assert.equal(sum.eligible + sum.recoveryEligible + sum.atRisk + sum.ineligible, 0);
  assert.equal(sum.overallPct, null);
});

// --- One section per student ------------------------------------------------------------

test("a few classes taken with another section: student stays in one section, sessions still count", () => {
  const out = latest([
    row({ studentId: "s", university: "ADYPU", section: "S-001", present: 400, scheduled: 443, lastDate: "1|2026-11-05" }),
    row({ studentId: "s", university: "ADYPU", section: "S-004", present: 5, scheduled: 6, lastDate: "1|2026-10-02", subject: "English" }),
  ]);
  assert.ok(out.every((r) => r.section === "S-001"));
  const sections = aggregateAttendanceStats(out, NO_CLASSES, "university_section", NO_FILTERS).rows;
  assert.equal(sections.length, 1);
  assert.equal(sections[0]!.students, 1);
  assert.equal(sections[0]!.scheduled, 449);
});

test("a section with only future sessions does not beat one with sessions up to today", () => {
  const out = latest([
    row({ studentId: "s", university: "C", section: "S-001", lastDate: "1|2026-11-05" }),
    row({ studentId: "s", university: "C", section: "S-009", lastDate: "0|2026-12-01", subject: "English" }),
  ]);
  assert.ok(out.every((r) => r.section === "S-001"));
});

test("section filter after the move: the section's own students only, with all their sessions", () => {
  const out = latest([
    row({ studentId: "a", university: "C", section: "S-001", lastDate: "1|2026-11-05" }),
    row({ studentId: "a", university: "C", section: "S-004", lastDate: "1|2026-10-01", subject: "English" }),
    row({ studentId: "b", university: "C", section: "S-004", lastDate: "1|2026-11-05" }),
  ]);
  const s4 = aggregateAttendanceStats(out, NO_CLASSES, "university", { ...NO_FILTERS, sections: ["C\tS-004"] }).summary;
  assert.equal(s4.students, 1);
  const secSum = aggregateAttendanceStats(out, NO_CLASSES, "university_section", NO_FILTERS).rows.reduce((n, r) => n + r.students, 0);
  assert.equal(secSum, 2);
});
