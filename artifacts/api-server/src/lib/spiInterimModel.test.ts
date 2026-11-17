import assert from "node:assert/strict";
import { test } from "node:test";
import type { DirectoryCourse, DirectoryStudent } from "./directoryReportModel.js";
import { courseScore, levelOf, searchSpi, sortSpi, spiGroups, spiStudents, spiSummary } from "./spiInterimModel.js";

const part = (avgPct: number, total = 4) => ({ avgPct, total });
const course = (name: string, cq: number | null, mq: number | null, sa: number | null): DirectoryCourse => ({
  name, classroom: cq == null ? null : part(cq), module: mq == null ? null : part(mq), skill: sa == null ? null : part(sa),
  attendancePct: 90, present: 9, held: 10, score: null, points: null, levelF: false,
});
const student = (over: Partial<DirectoryStudent> & Pick<DirectoryStudent, "studentId" | "courses">): DirectoryStudent => ({
  name: over.studentId, college: "A", batch: "A B1", semester: "Semester 3", section: "S-001", attendancePct: 90, attPresent: 9, attHeld: 10,
  attendanceState: "met", spi: null, skillDebt: false, ...over,
});

test("course score: the parts picked and held, scaled to 100 (plain weighted average, no below-50 rule)", () => {
  const c = course("Maths", 80, 70, 90);
  assert.equal(courseScore(c, "cqmqsa"), 82); // (800 + 1050 + 2250) ÷ 50
  assert.equal(courseScore(c, "cqmq"), 74); // (800 + 1050) ÷ 25
  assert.equal(courseScore(c, "cq"), 80);
  // A part not held yet is left out: MQ 42.2, SA 86.7, no CQ → (633 + 2167.5) ÷ 40.
  assert.equal(courseScore(course("Comm", null, 42.2, 86.7), "cqmqsa"), 70);
  assert.equal(courseScore(course("Comm", null, 42.2, 86.7), "cq"), null);
  // A part with nothing held (total 0) is not a 0.
  assert.equal(courseScore({ classroom: { avgPct: 0, total: 0 }, module: part(60), skill: null }, "cqmq"), 60);
  // FSA counts only in "all"; there is none in the data yet, so "all" equals CQ + MQ + SA.
  assert.equal(courseScore({ ...c, fsa: part(40, 1) }, "all"), 61); // (4100 + 2000) ÷ 100
  assert.equal(courseScore(c, "all"), 82);
});

test("levels and points follow the policy (§3.2), boundaries included", () => {
  assert.deepEqual([90, 89.9, 80, 70, 60, 50, 49.9, 0].map((v) => levelOf(v).level), ["A+", "A", "A", "B", "C", "D", "F", "F"]);
  assert.deepEqual([90, 80, 70, 60, 50, 10].map((v) => levelOf(v).points), [10, 9, 8, 7, 6, 0]);
});

const roster: DirectoryStudent[] = [
  student({ studentId: "s1", courses: [course("Maths", 80, 70, 90), course("English", 60, 60, 60)] }), // 82, 60 → 71; points 9, 7 → 8
  student({ studentId: "s2", courses: [course("Maths", 95, 90, 92)] }), // (950 + 1350 + 2300) ÷ 50 = 92 → A+ 10
  student({ studentId: "s3", college: "B", batch: "B B1", courses: [course("Maths", null, null, null)] }), // nothing held
  student({ studentId: "s4", college: "B", batch: "B B1", section: "S-002", ended: true, courses: [course("Maths", 40, 30, 50)] }), // (400 + 450 + 1250) ÷ 50 = 42 → F 0
];

test("students: average of course scores and of course points; no scored course → no score", () => {
  const rows = spiStudents(roster, { upTo: "cqmqsa" });
  const by = Object.fromEntries(rows.map((r) => [r.studentId, r]));
  assert.equal(by["s1"]!.score, 71);
  assert.equal(by["s1"]!.spi, 8);
  assert.equal(by["s1"]!.level, "B");
  assert.equal(by["s2"]!.score, 92);
  assert.equal(by["s2"]!.spi, 10);
  assert.equal(by["s3"]!.score, null);
  assert.equal(by["s3"]!.level, null);
  assert.equal(by["s4"]!.level, "F");
  // Quiz averages are the Directory's own (Method A).
  assert.equal(by["s1"]!.classroom, 70);
});

test("score filter keeps students within the bounds (no score = left out); the summary counts ≥ 70 of all students", () => {
  const all = spiStudents(roster, { upTo: "cqmqsa" });
  const ge70 = spiStudents(roster, { upTo: "cqmqsa", scoreMin: 70 });
  assert.deepEqual(ge70.map((r) => r.studentId).sort(), ["s1", "s2"]);
  assert.deepEqual(spiStudents(roster, { upTo: "cqmqsa", scoreMax: 50 }).map((r) => r.studentId), ["s4"]);
  const s = spiSummary(ge70, all);
  assert.equal(s.students, 2);
  assert.equal(s.allStudents, 4);
  assert.equal(s.atTarget, 2);
  assert.equal(s.atTargetPct, 50);
  assert.equal(s.score, 81.5); // (71 + 92) ÷ 2
  assert.equal(s.spi, 9);
  assert.equal(s.fsaAvailable, false);
  // Other filters still apply (college, subject).
  assert.deepEqual(spiStudents(roster, { upTo: "cqmqsa", colleges: ["B"] }).map((r) => r.studentId), ["s3", "s4"]);
  assert.equal(spiStudents(roster, { upTo: "cqmqsa", subject: "English" }).find((r) => r.studentId === "s1")!.score, 60);
});

test("groups: college / batch / section rows; ended students counted; students add up", () => {
  const rows = spiStudents(roster, { upTo: "cqmqsa" });
  const colleges = spiGroups(rows, "college");
  assert.deepEqual(colleges.map((g) => [g.college, g.students, g.atTarget, g.endedStudents]).sort(), [["A", 2, 2, 0], ["B", 2, 0, 1]]);
  const a = colleges.find((g) => g.college === "A")!;
  assert.equal(a.score, 81.5);
  assert.equal(a.atTargetPct, 100);
  const b = colleges.find((g) => g.college === "B")!;
  assert.equal(b.score, 42); // s3 has no score and is left out of the average
  assert.equal(spiGroups(rows, "section").length, 3);
  assert.equal(spiGroups(rows, "batch").reduce((n, g) => n + g.students, 0), 4);
  assert.equal(spiGroups(rows, "section").find((g) => g.section === "S-002")!.semester, "Semester 3");
});

test("sort keeps blanks last both ways; search by name / UUID or group key", () => {
  const rows = spiStudents(roster, { upTo: "cqmqsa" });
  assert.deepEqual(sortSpi(rows, "score", -1, true).map((r) => r.studentId), ["s2", "s1", "s4", "s3"]);
  assert.deepEqual(sortSpi(rows, "score", 1, true).map((r) => r.studentId), ["s4", "s1", "s2", "s3"]);
  assert.deepEqual(searchSpi(rows, "s2").map((r) => r.studentId), ["s2"]);
  assert.deepEqual(searchSpi(spiGroups(rows, "college"), "b").map((g) => g.college), ["B"]);
});
