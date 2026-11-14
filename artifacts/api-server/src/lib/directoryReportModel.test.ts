import assert from "node:assert/strict";
import { test } from "node:test";
import { directoryOptions, directoryRows, hyphenate, shortSection, sortRows, summarize, type DirectoryStudent } from "./directoryReportModel.js";

const part = (avgPct: number, total: number) => ({ avgPct, total });
const student = (over: Partial<DirectoryStudent> & Pick<DirectoryStudent, "studentId" | "college">): DirectoryStudent => ({
  name: "Asha",
  semester: "Semester 3",
  section: "S-001",
  attendancePct: 90,
  attPresent: 90,
  attHeld: 100,
  attendanceState: "met",
  spi: 7,
  skillDebt: false,
  courses: [],
  ...over,
});

const students: DirectoryStudent[] = [
  student({
    studentId: "aaaaaaaa-0000-0000-0000-000000000001",
    college: "Alpha",
    name: "Asha",
    courses: [
      { name: "Maths", classroom: part(80, 10), module: part(60, 4), skill: part(70, 3) },
      { name: "Python", classroom: part(40, 30), module: null, skill: null },
    ],
  }),
  student({ studentId: "bbbbbbbb-0000-0000-0000-000000000002", college: "Alpha", name: "Bala", section: "S-002", attendancePct: 55, attPresent: 11, attHeld: 20, attendanceState: "not_met", spi: 3, skillDebt: true, courses: [{ name: "Maths", classroom: null, module: null, skill: null }] }),
  student({ studentId: "cccccccc-0000-0000-0000-000000000003", college: "Beta", name: "Chitra", semester: "Semester 1", attendancePct: null, attPresent: 0, attHeld: 0, attendanceState: "not_available", spi: null, courses: [{ name: "Python", classroom: part(50, 2), module: part(90, 2), skill: part(30, 1) }] }),
];

test("averages are quizzes held weighted, skill is the mean of course scores; no quiz held is null", () => {
  const rows = directoryRows(students, {});
  const asha = rows.find((r) => r.name === "Asha")!;
  assert.equal(asha.classroom, 50); // (80 × 10 + 40 × 30) ÷ 40
  assert.equal(asha.module, 60);
  assert.equal(asha.skill, 70);
  const bala = rows.find((r) => r.name === "Bala")!;
  assert.equal(bala.classroom, null);
  assert.equal(bala.module, null);
});

test("eligible is the report's attendance criterion; summary counts match", () => {
  const s = summarize(directoryRows(students, {}));
  assert.equal(s.students, 3);
  assert.equal(s.eligible, 1);
  assert.equal(s.notEligible, 2);
  // Σ present ÷ Σ held = (90 + 11) ÷ (100 + 20), cut to one decimal; the old mean of percentages gave 72.5.
  assert.equal(s.avgAttendance, 84.1);
  assert.equal(s.avgSpi, 5); // (7 + 3) ÷ 2
  assert.equal(s.skillDebt, 1);
});

test("filters: college, semester, section, subject, attendance range, search and the user's scope", () => {
  assert.equal(directoryRows(students, { college: "Alpha" }).length, 2);
  assert.equal(directoryRows(students, { semester: "Semester 1" }).length, 1);
  assert.equal(directoryRows(students, { section: "S-002" }).length, 1);
  assert.equal(directoryRows(students, { subject: "python" }).length, 2);
  assert.equal(directoryRows(students, { attMin: 60, attMax: 100 }).length, 1);
  assert.equal(directoryRows(students, { attMin: 0, attMax: 100 }).length, 3); // default range keeps students with no sessions
  assert.equal(directoryRows(students, { q: "cccccccc00" }).length, 1); // UUID search ignores hyphens
  assert.equal(directoryRows(students, { q: "bal" }).length, 1);
  assert.equal(directoryRows(students, { scopeCampuses: ["Beta"] }).length, 1);
});

test("a subject limit (filter or the user's subjects) limits the averages to those courses", () => {
  const maths = directoryRows(students, { subject: "Maths" }).find((r) => r.name === "Asha")!;
  assert.equal(maths.classroom, 80);
  const own = directoryRows(students, { scopeSubjects: ["Python"] });
  assert.equal(own.length, 2);
  assert.equal(own.find((r) => r.name === "Asha")!.classroom, 40);
  assert.equal(directoryRows(students, { scopeSubjects: ["Python"], subject: "Maths" }).length, 0); // outside the user's subjects
});

test("options stay inside the user's scope", () => {
  const o = directoryOptions(students, { scopeCampuses: ["Alpha"] });
  assert.deepEqual(o.colleges, ["Alpha"]);
  assert.deepEqual(o.subjects, ["Maths", "Python"]);
  assert.deepEqual(directoryOptions(students, { scopeSubjects: ["Python"] }).subjects, ["Python"]);
});

test("sorting puts blanks last in both directions", () => {
  const rows = directoryRows(students, {});
  for (const dir of [1, -1] as const) assert.equal(sortRows(rows, "classroom", dir).at(-1)!.classroom, null);
  assert.equal(sortRows(rows, "spi", -1)[0]!.spi, 7);
});

test("helpers", () => {
  assert.equal(shortSection("Malla Reddy Batch-1 CSE AI Data Science-S-005"), "S-005");
  assert.equal(hyphenate("baf4dbfe79954b9f9502440d1bd2fc1e"), "baf4dbfe-7995-4b9f-9502-440d1bd2fc1e");
});

// --- College › Batch › Semester filters (as on Student Attendance Stats) -------------------------------

const roster: DirectoryStudent[] = [
  student({ studentId: "a1", college: "CDU", batch: "CDU Batch -1", semester: "Semester 3", section: "S-001", ended: true }),
  student({ studentId: "a2", college: "CDU", batch: "CDU Batch -1", semester: "Semester 3", section: "S-002", ended: true }),
  student({ studentId: "b1", college: "CDU", batch: "CDU Batch -2", semester: "Semester 1", section: "S-001" }),
  student({ studentId: "c1", college: "ADYPU", batch: "ADYPU Batch-2", semester: "Semester 1", section: "S-01" }),
  student({ studentId: "x1", college: "ADYPU", semester: "Semester 1", section: "S-02" }),
];
const ids = (f: Parameters<typeof directoryRows>[1]) => directoryRows(roster, f).map((r) => r.studentId).sort();

test("batch filter keeps that college's batch only", () => {
  assert.deepEqual(ids({ batches: ["CDU\tCDU Batch -1"] }), ["a1", "a2"]);
  assert.deepEqual(ids({ batches: ["CDU\tCDU Batch -1", "ADYPU\tADYPU Batch-2"] }), ["a1", "a2", "c1"]);
});

test("running + ended = all students", () => {
  const all = ids({}).length;
  assert.equal(ids({ term: "running" }).length + ids({ term: "ended" }).length, all);
  assert.deepEqual(ids({ term: "ended" }), ["a1", "a2"]);
});

test("the same section name in two batches stays apart with a batch-scoped section", () => {
  assert.deepEqual(ids({ sections: ["CDU Batch -2\tS-001"] }), ["b1"]);
  assert.deepEqual(ids({ sections: ["S-001"] }), ["a1", "b1"], "a plain name (old links) matches every batch");
});

test("several colleges at once, and the old single college / semester (Overview links) still work", () => {
  assert.deepEqual(ids({ colleges: ["CDU", "ADYPU"] }).length, 5);
  assert.deepEqual(ids({ college: "ADYPU" }), ["c1", "x1"]);
  assert.deepEqual(ids({ semester: "Semester 3" }), ["a1", "a2"]);
});

test("a report with no batch reads as Unknown: shown, filterable, in the menu", () => {
  assert.equal(directoryRows(roster, {}).find((r) => r.studentId === "x1")!.batch, "Unknown");
  assert.deepEqual(ids({ batches: ["ADYPU\tUnknown"] }), ["x1"]);
  const opts = directoryOptions(roster, {});
  assert.deepEqual(opts.batches.map((b) => `${b.campus}|${b.batch}|${b.semester}|${b.ended}|${b.students}`), [
    "ADYPU|ADYPU Batch-2|Semester 1|false|1",
    "ADYPU|Unknown|Semester 1|false|1",
    "CDU|CDU Batch -1|Semester 3|true|2",
    "CDU|CDU Batch -2|Semester 1|false|1",
  ]);
  assert.deepEqual(opts.sections.filter((x) => x.college === "CDU").map((x) => `${x.batch}|${x.section}`), ["CDU Batch -1|S-001", "CDU Batch -1|S-002", "CDU Batch -2|S-001"]);
});

test("scope: a user limited to one college never sees another college's batches", () => {
  const opts = directoryOptions(roster, { scopeCampuses: ["ADYPU"] });
  assert.ok(opts.batches.every((b) => b.campus === "ADYPU"));
  assert.deepEqual(ids({ scopeCampuses: ["ADYPU"], batches: ["CDU\tCDU Batch -1"] }), []);
});

test("batch sorts like the other text columns", () => {
  const sorted = sortRows(directoryRows(roster, {}), "batch", 1).map((r) => r.batch);
  assert.deepEqual(sorted, ["ADYPU Batch-2", "CDU Batch -1", "CDU Batch -1", "CDU Batch -2", "Unknown"]);
});

test("group attendance is Σ present ÷ Σ held, cut to one decimal; no sessions at all gives null", () => {
  // One student 90 of 100, one 1 of 10: the mean of percentages would be 50, the sessions say 82.7.
  const two = [
    student({ studentId: "p1", college: "C", attPresent: 90, attHeld: 100 }),
    student({ studentId: "p2", college: "C", attendancePct: 10, attPresent: 1, attHeld: 10 }),
  ];
  assert.equal(summarize(directoryRows(two, {})).avgAttendance, 82.7);
  const none = [student({ studentId: "p3", college: "C", attendancePct: null, attPresent: 0, attHeld: 0 })];
  assert.equal(summarize(directoryRows(none, {})).avgAttendance, null);
  // 2 of 3 = 66.666…: cut, not rounded, as on each report.
  const third = [student({ studentId: "p4", college: "C", attPresent: 2, attHeld: 3 })];
  assert.equal(summarize(directoryRows(third, {})).avgAttendance, 66.6);
});
