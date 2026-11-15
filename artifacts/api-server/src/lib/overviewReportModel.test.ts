import assert from "node:assert/strict";
import { test } from "node:test";
import { overviewOf } from "./overviewReportModel.js";
import { directoryRows, summarize, type DirectoryStudent } from "./directoryReportModel.js";

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

test("tiers are the report's tiers; students with no sessions are in none; no SPI figures", () => {
  const o = overviewOf(students, {});
  assert.deepEqual([o.summary.students, o.summary.eligible, o.summary.recovery, o.summary.atRisk, o.summary.ineligible, o.summary.noSessions], [4, 1, 0, 1, 1, 1]);
  assert.equal(o.summary.avgAttendance, 71.1); // Σ present ÷ Σ held = 121 ÷ 170 (the old mean of percentages gave 61.7)
  // The SPI waits for the Final Skill Assessment: nothing SPI-based is sent.
  assert.equal("avgSpi" in o.summary, false);
  assert.equal("spiBins" in o, false);
  assert.equal("spi" in o.colleges[0]!, false);
});

test("assessment averages: simple average of course scores (Method A)", () => {
  const o = overviewOf(students, {});
  assert.equal(o.assessment.classroom, 56.7); // (80 + 40 + 50) ÷ 3 course scores (weighted by quizzes held it was 50)
  assert.equal(o.assessment.module, 75); // (60 + 90) ÷ 2 (weighted it was 70)
  assert.equal(o.assessment.skill, 50); // mean of 70 and 30
});

test("Overview cards = Student Directory cards for the same filters", () => {
  for (const f of [{}, { colleges: ["Alpha"] }, { subject: "Python" }, { tier: "at_risk" as const }]) {
    const o = overviewOf(students, f);
    const d = summarize(directoryRows(students, f));
    assert.deepEqual([o.summary.students, o.summary.avgAttendance, o.assessment.classroom, o.assessment.module, o.assessment.skill], [d.students, d.avgAttendance, d.classroomAvg, d.moduleAvg, d.skillAvg], JSON.stringify(f));
  }
});

test("college, section and subject figures: attendance and course-score averages", () => {
  const o = overviewOf(students, {});
  const alpha = o.colleges.find((c) => c.name === "Alpha")!;
  assert.equal(alpha.attendance, 84.1); // (90 + 11) ÷ (100 + 20)
  assert.deepEqual([alpha.classroom, alpha.module, alpha.skill], [60, 60, 70]); // Asha: Maths 80 + Python 40; Bala has none
  const beta = o.colleges.find((c) => c.name === "Beta")!;
  assert.deepEqual([beta.students, beta.classroom], [2, 50]);
  assert.equal(o.sections.find((s) => s.name === "S-002")?.college, "Alpha");
  const python = o.subjects.find((s) => s.name === "Python")!;
  assert.equal(python.attendance, 64); // (44 + 20) ÷ (50 + 50)
  assert.deepEqual([python.classroom, python.module, python.skill], [45, 90, 30]); // classroom (40 + 50) ÷ 2
  assert.equal(o.subjects.find((x) => x.name === "Maths")!.attendance, 80); // (45 + 11) ÷ (50 + 20)
});

test("a section name in two colleges stays two sections", () => {
  const o = overviewOf(students, {});
  const s001 = o.sections.filter((s) => s.name === "S-001");
  assert.deepEqual(s001.map((s) => s.college).sort(), ["Alpha", "Beta"]);
  assert.equal(s001.find((s) => s.college === "Alpha")!.students, 1);
});

test("the Student Directory filters work the same here: colleges, batches, running / ended, sections", () => {
  const g: DirectoryStudent[] = [
    stu({ studentId: "a", college: "Alpha", batch: "B1", section: "S-001" }),
    stu({ studentId: "b", college: "Alpha", batch: "B2", section: "S-001", ended: true }),
    stu({ studentId: "c", college: "Beta", batch: "B1", section: "S-002" }),
  ];
  assert.equal(overviewOf(g, { colleges: ["Alpha", "Beta"] }).summary.students, 3);
  assert.equal(overviewOf(g, { batches: ["Alpha\tB2"] }).summary.students, 1);
  assert.equal(overviewOf(g, { term: "ended" }).summary.students, 1);
  assert.equal(overviewOf(g, { term: "running" }).summary.students, 2);
  assert.equal(overviewOf(g, { sections: ["B1\tS-001"] }).summary.students, 1);
});

test("attention lists, lowest attendance first, and the scope and subject limits", () => {
  const o = overviewOf(students, {});
  assert.deepEqual([o.attention.atRisk.total, o.attention.ineligible.total], [1, 1]);
  assert.equal(o.attention.ineligible.rows[0]!.name, "Chitra");
  const alpha = overviewOf(students, { scopeCampuses: ["Alpha"] });
  assert.equal(alpha.summary.students, 2);
  assert.equal(overviewOf(students, { subject: "Python" }).summary.students, 2);
  assert.equal(overviewOf(students, { tier: "at_risk" }).summary.students, 1);
  // A subject-scoped user (Capability Manager) only sees their subject's courses in the averages.
  assert.equal(overviewOf(students, { scopeSubjects: ["Python"] }).assessment.classroom, 45);
});

test("nothing held anywhere: averages are null, never 0; no students: no attendance", () => {
  const o = overviewOf([stu({ studentId: "z", college: "C", attPresent: 0, attHeld: 0, tier: null, courses: [{ name: "M", classroom: part(0, 0), module: null, skill: null, attendancePct: null, present: 0, held: 0, score: null, points: null }] })], {});
  assert.deepEqual(o.assessment, { classroom: null, module: null, skill: null });
  assert.equal(o.summary.avgAttendance, null);
  assert.equal(overviewOf([], {}).summary.avgAttendance, null);
});
