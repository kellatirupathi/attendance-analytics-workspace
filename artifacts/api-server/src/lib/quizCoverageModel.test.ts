import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAMPUS_SORT,
  campusRows,
  filterRows,
  quizFilterOptions,
  quizKpis,
  restrictToReportCourses,
  scopePlanToStudentColleges,
  sortBy,
  studentRows,
  studentSubjectRows,
  type PlanRow,
  type QuizCoverageModel,
  type QuizRow,
} from "./quizCoverageModel.js";

const row = (campus: string, section: string, uid: string, name: string, subject: string, category: string, scheduled: number, completed: number, avgScore: number | null): QuizRow => ({
  campus,
  section,
  studentId: uid,
  studentName: name,
  subject,
  category,
  scheduled,
  completed,
  avgScore,
});
const plan = (campus: string, sectionId: string, resourceId: string, firstDate: string, subject = "Maths"): PlanRow => ({
  campus,
  section: "S-01",
  sectionId,
  subject,
  category: "MATH",
  resourceId,
  firstDate,
});

const model: QuizCoverageModel = {
  rows: [
    row("Alpha", "S-01", "u1", "Asha", "Maths", "MATH", 10, 5, 80),
    row("Alpha", "S-01", "u1", "Asha", "Python", "TECH", 10, 0, null),
    row("Alpha", "S-02", "u2", "Bala", "Maths", "MATH", 10, 0, null),
    row("Beta", "S-01", "u3", "Chitra", "Maths", "MATH", 4, 4, 60),
  ],
  plan: [
    plan("Alpha", "sa", "q1", "2026-10-01"),
    plan("Alpha", "sa", "q2", "2026-12-01"),
    plan("Alpha", "sb", "q1", "2026-10-02"), // the same quiz in another section counts again
    plan("Beta", "sc", "q1", "2026-10-03"),
    plan("Beta", "sc", "q2", ""), // no session date yet: planned, not scheduled
  ],
};
const TODAY = "2026-10-28";

test("cards: planned quizzes count once per section; rates are sums first, divided last", () => {
  const k = quizKpis(model, {}, TODAY);
  assert.equal(k.available, 5);
  assert.equal(k.scheduledSoFar, 3);
});

test("completion, overall score and average best score", () => {
  const k = quizKpis(model, {}, TODAY);
  // completed 5 + 0 + 0 + 4 = 9, scheduled 10 + 10 + 10 + 4 = 34
  assert.equal(k.completionRate, 26.5);
  assert.equal(k.avgScore, 18.8); // (80 × 5 + 60 × 4) ÷ 34 scheduled: a quiz not completed counts as 0
  assert.equal(k.quizzesCompleted, 9);
  assert.equal(k.quizzesScheduled, 34);
  assert.equal(k.avgBestScore, 70); // (80 + 60) ÷ 2 rows with a completed quiz
  assert.deepEqual(k.counts, { campus: 2, student: 3, studentSubject: 4 });
});

test("filters: college, section, category, subject and the user's scope", () => {
  assert.equal(filterRows(model, { college: "Alpha", section: "S-02" }).length, 1);
  assert.equal(filterRows(model, { category: "tech" }).length, 1);
  assert.equal(filterRows(model, { subject: "Maths" }).length, 3);
  assert.equal(filterRows(model, { scopeCampuses: ["Beta"] }).length, 1);
  assert.equal(filterRows(model, { scopeSubjects: ["Python"] }).length, 1);
  assert.equal(quizKpis(model, { scopeCampuses: ["Beta"] }, TODAY).available, 2);
});

test("campus rows: Scheduled comes from the plan; a campus with no quiz rows is left out", () => {
  const rows = campusRows({ rows: model.rows, plan: [...model.plan, plan("Gamma", "sg", "q9", "2026-10-01")] }, {}, TODAY);
  assert.deepEqual(rows.map((r) => r.college).sort(), ["Alpha", "Beta"]);
  const alpha = rows.find((r) => r.college === "Alpha")!;
  assert.equal(alpha.scheduled, 2);
  assert.equal(alpha.sections, 2);
  assert.equal(alpha.students, 2);
  assert.equal(alpha.completionPct, 16.7);
  assert.equal(alpha.avgScore, 13.3); // 80 × 5 ÷ 30 scheduled
});

test("students: totals, search by name or UID prefix, and the subject rows", () => {
  const all = studentRows(model, {});
  assert.equal(all.length, 3);
  const asha = all.find((s) => s.uid === "u1")!;
  assert.equal(asha.scheduled, 20);
  assert.equal(asha.completed, 5);
  assert.equal(asha.completionPct, 25);
  assert.equal(asha.avgScore, 20); // 80 × 5 completed ÷ 20 scheduled
  assert.deepEqual(studentRows(model, {}, "chi").map((s) => s.uid), ["u3"]);
  assert.deepEqual(studentRows(model, {}, "U2").map((s) => s.uid), ["u2"]);
  const subjects = studentSubjectRows(model, {}, "u1");
  assert.equal(subjects.length, 2);
  assert.equal(subjects.find((s) => s.subject === "Maths")?.avgScore, 40); // 80 × 5 ÷ 10
  assert.equal(subjects.find((s) => s.subject === "Python")?.avgScore, 0); // scheduled but none completed
});

test("sorting puts blanks last in both directions", () => {
  const rows = campusRows(model, {}, TODAY);
  const withBlank = [...rows, { college: "Zeta", sections: 1, students: 1, scheduled: 0, completionPct: null, avgScore: null }];
  for (const dir of [1, -1] as const) {
    const sorted = sortBy(withBlank, CAMPUS_SORT["completion"]!, dir, (r) => r.college);
    assert.equal(sorted[sorted.length - 1]!.college, "Zeta");
  }
});

test("filter options list the colleges, sections, categories and subjects in scope", () => {
  const o = quizFilterOptions(model, { scopeCampuses: ["Alpha"] });
  assert.deepEqual(o.colleges, ["Alpha"]);
  assert.deepEqual(o.sections.map((s) => s.section), ["S-01", "S-02"]);
  assert.deepEqual(o.categories, ["APTITUDE", "ENGLISH", "MATH", "TECH"]); // the four NIAT categories are always listed
});

test("planned quizzes of colleges with no student rows are not counted", () => {
  const withOthers = [...model.plan, plan("Intensive Offline", "sx", "q1", "2026-10-01"), plan("No Rows College", "sy", "q1", "2026-10-01")];
  assert.deepEqual(scopePlanToStudentColleges(model.rows, withOthers).map((p) => p.campus).sort(), model.plan.map((p) => p.campus).sort());
});

test("only the courses on the student report stay", () => {
  const report = {
    // u1 sees Maths only (Python was removed or is planned-only); u3 sees Maths; u2 has no saved report yet
    byStudent: new Map([["u1", new Set(["maths"])], ["u3", new Set(["maths"])]]),
    campusCourses: new Set(["Alpha	maths", "Beta	maths"]),
  };
  const out = restrictToReportCourses(model, report);
  assert.deepEqual(out.rows.map((r) => `${r.studentId}:${r.subject}`).sort(), ["u1:Maths", "u2:Maths", "u3:Maths"]);
  assert.equal(out.plan.length, model.plan.filter((p) => p.subject === "Maths").length);
  // a course nobody in the college sees on the report is not counted as planned
  const none = restrictToReportCourses(model, { byStudent: new Map(), campusCourses: new Set(["Alpha	python"]) });
  assert.equal(none.plan.length, 0);
  assert.equal(none.rows.length, model.rows.length);
});

test("skill assessment rows: held once per section and course, score is the course's best score per row", () => {
  const skillRow = (uid: string, subject: string, held: number, attempted: number, best: number): QuizRow => ({
    campus: "Alpha", section: "S-01", studentId: uid, studentName: uid, subject, category: "TECH", scheduled: held, completed: attempted, avgScore: best, points: best, weight: 1,
  });
  const skill: QuizCoverageModel = {
    mode: "skill",
    plan: [],
    rows: [skillRow("u1", "Python", 3, 2, 80), skillRow("u1", "Maths", 3, 0, 0), skillRow("u2", "Python", 3, 3, 60)],
  };
  const k = quizKpis(skill, {}, TODAY);
  assert.equal(k.available, 6); // Python 3 + Maths 3 held, counted once for the section
  assert.equal(k.scheduledSoFar, 9); // student slots
  assert.equal(k.completionRate, 55.6); // 5 attempted of 9
  assert.equal(k.avgScore, 46.7); // (80 + 0 + 60) / 3 rows
  assert.equal(k.avgBestScore, 70); // (80 + 60) / 2 rows attempted
  assert.equal(campusRows(skill, {}, TODAY)[0]!.scheduled, 6);
  assert.equal(studentRows(skill, {}).find((s) => s.uid === "u1")!.avgScore, 40); // (80 + 0) / 2 courses
  assert.equal(studentSubjectRows(skill, {}, "u1").find((s) => s.subject === "Python")!.avgScore, 80);
});

test("student panel lists the report's other courses as Awaited; the full download does not", () => {
  const withReport: QuizCoverageModel = { ...model, reportCourses: new Map([["u1", ["Maths", "Python", "Constitution of India"]]]) };
  const one = studentSubjectRows(withReport, {}, "u1");
  assert.deepEqual(one.map((s) => [s.subject, Boolean(s.awaited)]).sort(), [["Constitution of India", true], ["Maths", false], ["Python", false]]);
  assert.equal(one.find((s) => s.subject === "Constitution of India")?.scheduled, 0);
  assert.equal(studentSubjectRows(withReport, {}).length, 4); // no uid: only real rows
});

// --- Batch, running / ended and batch-scoped sections (College › Batch › Semester filters) ---------

const b = (r: QuizRow, batch: string, semester: string, ended = false): QuizRow => ({ ...r, batch, semester, ended });
const batchModel: QuizCoverageModel = {
  rows: [
    b(row("CDU", "S-001", "u1", "A", "Maths", "MATH", 10, 8, 70), "CDU Batch -1", "Semester 3", true),
    b(row("CDU", "S-001", "u2", "B", "Maths", "MATH", 10, 5, 60), "CDU Batch -1", "Semester 3", true),
    b(row("CDU", "S-001", "u3", "C", "Maths", "MATH", 10, 9, 90), "CDU Batch -2", "Semester 1"),
    b(row("ADYPU", "S-01", "u4", "D", "Maths", "MATH", 10, 10, 80), "ADYPU Batch-2", "Semester 1"),
  ],
  plan: [
    { ...plan("CDU", "sec-b1", "q1", "2026-07-01"), section: "S-001", batch: "CDU Batch -1", semester: "Semester 3", ended: true },
    { ...plan("CDU", "sec-b2", "q2", "2026-09-01"), section: "S-001", batch: "CDU Batch -2", semester: "Semester 1" },
  ],
};

test("batch filter keeps that college's batch, in rows and plan", () => {
  const f = { batches: ["CDU\tCDU Batch -1"] };
  assert.deepEqual(filterRows(batchModel, f).map((r) => r.studentId), ["u1", "u2"]);
  const k = quizKpis(batchModel, f, "2026-11-14");
  assert.equal(k.available, 1);
});

test("running + ended = all students, in rows and plan", () => {
  const count = (term?: "running" | "ended") => filterRows(batchModel, { term }).length;
  assert.equal(count("running") + count("ended"), count());
  assert.equal(count("ended"), 2);
  const avail = (term?: "running" | "ended") => quizKpis(batchModel, { term }, "2026-11-14").available;
  assert.equal(avail("running") + avail("ended"), avail());
});

test("the same section name in two batches: a batch-scoped section keeps them apart", () => {
  assert.deepEqual(filterRows(batchModel, { sections: ["CDU Batch -2\tS-001"] }).map((r) => r.studentId), ["u3"]);
  // A plain name (old links) still matches every batch's S-001.
  assert.equal(filterRows(batchModel, { sections: ["S-001"] }).length, 3);
});

test("several colleges at once", () => {
  assert.equal(filterRows(batchModel, { colleges: ["CDU", "ADYPU"] }).length, 4);
  assert.equal(filterRows(batchModel, { colleges: ["ADYPU"] }).length, 1);
});

test("batch menu: main semester, ended only when every student's semester ended, unique students", () => {
  const opts = quizFilterOptions(batchModel, {});
  assert.deepEqual(opts.batches.map((x) => `${x.campus}|${x.batch}|${x.semester}|${x.ended}|${x.students}`), [
    "ADYPU|ADYPU Batch-2|Semester 1|false|1",
    "CDU|CDU Batch -1|Semester 3|true|2",
    "CDU|CDU Batch -2|Semester 1|false|1",
  ]);
  assert.deepEqual(opts.sections.filter((s) => s.college === "CDU").map((s) => `${s.batch}|${s.section}`), ["CDU Batch -1|S-001", "CDU Batch -2|S-001"]);
});

test("rows with no batch read as Unknown and still match an Unknown batch", () => {
  const m: QuizCoverageModel = { rows: [row("X", "S-1", "u9", "Z", "Maths", "MATH", 1, 1, 100)], plan: [] };
  assert.equal(filterRows(m, { batches: ["X\tUnknown"] }).length, 1);
});
