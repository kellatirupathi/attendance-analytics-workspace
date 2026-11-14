import assert from "node:assert/strict";
import { test } from "node:test";
import { overviewOf } from "./overviewReportModel.js";
import type { DirectoryStudent } from "./directoryReportModel.js";

const part = (avgPct: number, total: number) => ({ avgPct, total });
const stu = (over: Partial<DirectoryStudent> & Pick<DirectoryStudent, "studentId" | "college">): DirectoryStudent => ({
  name: "Asha", semester: "Semester 3", section: "S-001", attendancePct: 90, attPresent: 90, attHeld: 100, attendanceState: "met", tier: "eligible", spi: 7, skillDebt: false, courses: [], ...over,
});

const students: DirectoryStudent[] = [
  stu({ studentId: "1", college: "Alpha", name: "Asha", attendancePct: 90, tier: "eligible", spi: 7,
    courses: [{ name: "Maths", classroom: part(80, 10), module: part(60, 4), skill: part(70, 3), attendancePct: 90, present: 45, held: 50, score: 75, points: 8 }, { name: "Python", classroom: part(40, 30), module: null, skill: null, attendancePct: 88, present: 44, held: 50, score: 40, points: 0, levelF: true }] }),
  stu({ studentId: "2", college: "Alpha", name: "Bala", section: "S-002", attendancePct: 55, attPresent: 11, attHeld: 20, tier: "at_risk", spi: 3, courses: [{ name: "Maths", classroom: null, module: null, skill: null, attendancePct: 55, present: 11, held: 20, score: null, points: null }] }),
  stu({ studentId: "3", college: "Beta", name: "Chitra", attendancePct: 40, attPresent: 20, attHeld: 50, tier: "ineligible", spi: 1, courses: [{ name: "Python", classroom: part(50, 2), module: part(90, 2), skill: part(30, 1), attendancePct: 40, present: 20, held: 50, score: 30, points: 0, levelF: true }] }),
  stu({ studentId: "4", college: "Beta", name: "Dev", attendancePct: null, attPresent: 0, attHeld: 0, tier: null, attendanceState: "not_available", spi: null, courses: [] }),
];

test("tiers are the report's tiers; students with no sessions are in none", () => {
  const o = overviewOf(students, {});
  assert.deepEqual([o.summary.students, o.summary.eligible, o.summary.recovery, o.summary.atRisk, o.summary.ineligible, o.summary.noSessions], [4, 1, 0, 1, 1, 1]);
  assert.equal(o.summary.avgAttendance, 71.1); // Σ present ÷ Σ held = 121 ÷ 170 (the old mean of percentages gave 61.7)
  assert.equal(o.summary.avgSpi, 3.67); // (7 + 3 + 1) ÷ 3
  assert.equal(o.summary.skillDebt, 2); // Asha and Chitra have a level-F course
});

test("assessment averages and SPI bands", () => {
  const o = overviewOf(students, {});
  assert.equal(o.assessment.classroom, 50); // (80 × 10 + 40 × 30 + 50 × 2) ÷ 42 quizzes held
  assert.equal(o.assessment.module, 70); // (60 × 4 + 90 × 2) ÷ 6
  assert.equal(o.assessment.skill, 50); // mean of 70 and 30
  assert.deepEqual(o.spiBins.map((b) => b.count), [1, 1, 0, 1, 0]);
});

test("college, section and subject figures", () => {
  const o = overviewOf(students, {});
  assert.equal(o.colleges.find((c) => c.name === "Alpha")?.attendance, 84.1); // (90 + 11) ÷ (100 + 20)
  assert.equal(o.sections.find((s) => s.name === "S-002")?.college, "Alpha");
  const python = o.subjects.find((s) => s.name === "Python")!;
  assert.equal(python.attendance, 64); // (44 + 20) ÷ (50 + 50)
  assert.equal(o.subjects.find((x) => x.name === "Maths")!.attendance, 80); // (45 + 11) ÷ (50 + 20)
  assert.equal(python.score, 35);
  assert.equal(python.debt, 2);
});

test("attention lists, lowest attendance first, and the scope and subject limits", () => {
  const o = overviewOf(students, {});
  assert.deepEqual([o.attention.atRisk.total, o.attention.ineligible.total], [1, 1]);
  assert.equal(o.attention.ineligible.rows[0]!.name, "Chitra");
  const alpha = overviewOf(students, { scopeCampuses: ["Alpha"] });
  assert.equal(alpha.summary.students, 2);
  assert.equal(overviewOf(students, { subject: "Python" }).summary.students, 2);
  assert.equal(overviewOf(students, { tier: "at_risk" }).summary.students, 1);
});
