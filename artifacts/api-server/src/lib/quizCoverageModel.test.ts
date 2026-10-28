import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAMPUS_SORT,
  campusRows,
  filterRows,
  quizFilterOptions,
  quizKpis,
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
  assert.equal(k.avgScore, 70); // (80 + 60) / 2: blank scores are left out
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
});

test("students: totals, search by name or UID prefix, and the subject rows", () => {
  const all = studentRows(model, {});
  assert.equal(all.length, 3);
  const asha = all.find((s) => s.uid === "u1")!;
  assert.equal(asha.scheduled, 20);
  assert.equal(asha.completed, 5);
  assert.equal(asha.completionPct, 25);
  assert.equal(asha.avgScore, 80);
  assert.deepEqual(studentRows(model, {}, "chi").map((s) => s.uid), ["u3"]);
  assert.deepEqual(studentRows(model, {}, "U2").map((s) => s.uid), ["u2"]);
  assert.equal(studentSubjectRows(model, {}, "u1").length, 2);
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
