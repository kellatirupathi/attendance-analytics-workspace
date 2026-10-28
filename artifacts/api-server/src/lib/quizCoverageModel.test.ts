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

test("completion, score and participation", () => {
  const k = quizKpis(model, {}, TODAY);
  // completed 5 + 0 + 0 + 4 = 9, scheduled 10 + 10 + 10 + 4 = 34
  assert.equal(k.completionRate, 26.5);
  assert.equal(k.avgScore, 18.8); // (80 × 5 + 60 × 4) ÷ 34 scheduled: a quiz not completed counts as 0
  assert.equal(k.students, 3);
  assert.equal(k.participants, 2);
  assert.equal(k.participation, 66.7);
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
  assert.equal(alpha.participationPct, 50);
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
  const withBlank = [...rows, { college: "Zeta", sections: 1, students: 1, scheduled: 0, completionPct: null, avgScore: null, participationPct: null }];
  for (const dir of [1, -1] as const) {
    const sorted = sortBy(withBlank, CAMPUS_SORT["completion"]!, dir, (r) => r.college);
    assert.equal(sorted[sorted.length - 1]!.college, "Zeta");
  }
});

test("filter options list the colleges, sections, categories and subjects in scope", () => {
  const o = quizFilterOptions(model, { scopeCampuses: ["Alpha"] });
  assert.deepEqual(o.colleges, ["Alpha"]);
  assert.deepEqual(o.sections.map((s) => s.section), ["S-01", "S-02"]);
  assert.deepEqual(o.categories, ["MATH", "TECH"]);
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
