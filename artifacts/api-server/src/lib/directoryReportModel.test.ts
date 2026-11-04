import assert from "node:assert/strict";
import { test } from "node:test";
import { directoryOptions, directoryRows, hyphenate, shortSection, sortRows, summarize, type DirectoryStudent } from "./directoryReportModel.js";

const part = (avgPct: number, total: number) => ({ avgPct, total });
const student = (over: Partial<DirectoryStudent> & Pick<DirectoryStudent, "studentId" | "college">): DirectoryStudent => ({
  name: "Asha",
  semester: "Semester 3",
  section: "S-001",
  attendancePct: 90,
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
  student({ studentId: "bbbbbbbb-0000-0000-0000-000000000002", college: "Alpha", name: "Bala", section: "S-002", attendancePct: 55, attendanceState: "not_met", spi: 3, skillDebt: true, courses: [{ name: "Maths", classroom: null, module: null, skill: null }] }),
  student({ studentId: "cccccccc-0000-0000-0000-000000000003", college: "Beta", name: "Chitra", semester: "Semester 1", attendancePct: null, attendanceState: "not_available", spi: null, courses: [{ name: "Python", classroom: part(50, 2), module: part(90, 2), skill: part(30, 1) }] }),
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
  assert.equal(s.avgAttendance, 72.5); // (90 + 55) ÷ 2, students without sessions left out
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
