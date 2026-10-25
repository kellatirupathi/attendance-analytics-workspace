import assert from "node:assert/strict";
import { test } from "node:test";
import {
  scopedSlots,
  summarizeAssessmentModel,
  unitWindowKey,
  type AssessmentModel,
  type AssessmentSlot,
  type ModelFilters,
  type SummarySqlRow,
} from "./assessmentSummaryModel.js";

const CQ = "CLASSROOM_QUIZ";
const MQ = "MODULE_QUIZ";

function slot(over: Partial<AssessmentSlot>): AssessmentSlot {
  return {
    campus: "Alpha", section: "A", sectionKey: "secA", subject: "Maths", studentKey: "s1",
    studentId: "s-1", studentName: "Asha", startD: "2026-07-01", endD: "2026-11-30",
    batch: "B1", periodTitle: "Year 2 - Term 1", derived: "Semester 3", termWise: false,
    periodKey: "Alpha\tB1\tSemester 3",
    cq: [4, 4, 3, 240], mq: [2, 2, 1, 50],
    ...over,
  };
}

// Two students in Alpha/Maths (same section window), one in Alpha/Physics, one in Beta/Maths.
const slots: AssessmentSlot[] = [
  slot({}),
  slot({ studentKey: "s2", studentId: "s-2", studentName: "Ravi", cq: [4, 4, 4, 360], mq: [2, 2, 2, 150] }),
  slot({ subject: "Physics", cq: [3, 2, 1, 70], mq: [0, 0, 0, 0] }),
  slot({ campus: "Beta", sectionKey: "secB", studentKey: "s3", studentId: "s-3", studentName: "Mohan", periodKey: "Beta\tB1\tSemester 3", termWise: true, cq: [5, 5, 0, 0], mq: [1, 1, 1, 90] }),
];
const units = new Map([
  [unitWindowKey("secA", "Maths", "2026-07-01", "2026-11-30"), [
    { unit: "u1", done: true, type: CQ },
    { unit: "u2", done: false, type: CQ },
    { unit: "u2", done: true, type: CQ }, // the same unit in a second session that was held
    { unit: "m1", done: true, type: MQ },
  ]],
  [unitWindowKey("secA", "Physics", "2026-07-01", "2026-11-30"), [{ unit: "u9", done: false, type: CQ }]],
  [unitWindowKey("secB", "Maths", "2026-07-01", "2026-11-30"), [{ unit: "u1", done: true, type: CQ }]],
]);
const model: AssessmentModel = { slots, units };

const none: ModelFilters = { types: [CQ], scopeCampuses: [], campuses: [], semester: "", sections: [], subjects: [], student: "" };
const find = (rows: SummarySqlRow[], gg: string, gp: string, g: string | null, p: string | null = null) =>
  rows.find((r) => r.gg === gg && r.gp === gp && r.g === g && r.p === p);

test("campus-wise: rows, overall and distinct counts", () => {
  const rows = summarizeAssessmentModel(model, "campus", none);
  const alpha = find(rows, "0", "1", "Alpha")!;
  assert.equal(alpha.students, "2", "s1 counted once across Maths and Physics");
  assert.equal(alpha.expected_attempts, String(4 + 4 + 2));
  assert.equal(alpha.attempted, String(3 + 4 + 1));
  assert.equal(alpha.scheduled, "3", "u1, u2 (Maths) and u9 (Physics)");
  assert.equal(alpha.conducted, "2", "u1, and u2 because one of its sessions was held");
  const overall = find(rows, "1", "1", null)!;
  assert.equal(overall.students, "3");
  assert.equal(overall.campuses, "2");
  assert.equal(overall.scheduled, "3", "u1 is shared by both campuses, counted once");
  assert.equal(overall.r_term_wise, true, "any term-wise campus marks the roll-up");
  assert.ok(find(rows, "0", "0", "Alpha", "Alpha\tB1\tSemester 3"), "row × semester split");
  assert.ok(find(rows, "1", "0", null, "Beta\tB1\tSemester 3"), "semester panel row");
});

test("quiz type picks its own sums and units; all adds both", () => {
  const mq = find(summarizeAssessmentModel(model, "campus", { ...none, types: [MQ] }), "0", "1", "Alpha")!;
  assert.equal(mq.expected_attempts, String(2 + 2 + 0));
  assert.equal(mq.scheduled, "1");
  const all = find(summarizeAssessmentModel(model, "campus", { ...none, types: [CQ, MQ] }), "0", "1", "Alpha")!;
  assert.equal(all.expected_attempts, String(10 + 4));
  assert.equal(all.scheduled, "4");
});

test("student-wise rows carry the student's own slots; roll-ups count units", () => {
  const rows = summarizeAssessmentModel(model, "student", none);
  const s1 = find(rows, "0", "1", "s1")!;
  assert.equal(s1.scheduled, String(4 + 3), "slots_total over Maths and Physics");
  assert.equal(s1.conducted, String(4 + 2), "expected attempts");
  assert.equal(find(rows, "1", "1", null)!.scheduled, "3");
});

test("semester-wise returns period rows tagged gp = 1 and the overall", () => {
  const rows = summarizeAssessmentModel(model, "semester", none);
  assert.equal(rows.length, 3);
  const beta = find(rows, "0", "1", "Beta\tB1\tSemester 3", "Beta\tB1\tSemester 3")!;
  assert.equal(beta.r_campus, "Beta");
  assert.equal(beta.students, "1");
});

test("scope and page filters", () => {
  const scoped = summarizeAssessmentModel(model, "campus", { ...none, scopeCampuses: ["Beta"] });
  assert.deepEqual(scoped.filter((r) => r.gg === "0" && r.gp === "1").map((r) => r.g), ["Beta"]);
  const maths = find(summarizeAssessmentModel(model, "subject", { ...none, subjects: ["Maths"] }), "1", "1", null)!;
  assert.equal(maths.students, "3");
  const search = find(summarizeAssessmentModel(model, "student", { ...none, campuses: ["Alpha"], student: "rav" }), "1", "1", null)!;
  assert.equal(search.students, "1");
  const byId = find(summarizeAssessmentModel(model, "student", { ...none, student: "S-3" }), "1", "1", null)!;
  assert.equal(byId.students, "1", "id search drops hyphens and matches the student key, as the SQL does");
  const section = find(summarizeAssessmentModel(model, "campus", { ...none, sections: ["Beta\tA"] }), "1", "1", null)!;
  assert.equal(section.students, "1");
  assert.equal(summarizeAssessmentModel(model, "campus", { ...none, semester: "Semester 9" }).length, 0);
});

test("filter options follow the campus scope only", () => {
  assert.equal(scopedSlots(model, []).length, 4);
  assert.deepEqual(scopedSlots(model, ["Alpha"]).map((s) => s.subject), ["Maths", "Maths", "Physics"]);
});

// Definitions worked example: one conducted assessment, five students, three submitted 50 / 45 / 60.
const sumOf = (rows: SummarySqlRow[]) => {
  const all = find(rows, "1", "1", null)!;
  const expected = Number(all.expected_attempts);
  const attempted = Number(all.attempted);
  const scoreSum = Number(all.score_sum);
  return {
    expected,
    attempted,
    notAttempted: expected - attempted,
    completion: expected ? (attempted / expected) * 100 : null,
    avgAttempted: attempted ? scoreSum / attempted : null,
    overall: expected ? scoreSum / expected : null,
  };
};

test("worked example: 5 students, 3 attempts (50, 45, 60), 2 absent", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const scores = [50, 45, 60, 0, 0];
  const example: AssessmentModel = {
    slots: ids.map((id, i) =>
      slot({ studentKey: id, studentId: id, studentName: id, cq: [1, 1, i < 3 ? 1 : 0, scores[i]!], mq: [0, 0, 0, 0] }),
    ),
    units: new Map([[unitWindowKey("secA", "Maths", "2026-07-01", "2026-11-30"), [{ unit: "q1", done: true, type: CQ }]]]),
  };
  const m = sumOf(summarizeAssessmentModel(example, "campus", none));
  assert.equal(m.expected, 5);
  assert.equal(m.attempted, 3);
  assert.equal(m.notAttempted, 2);
  assert.equal(m.completion, 60);
  assert.ok(Math.abs(m.avgAttempted! - 51.67) < 0.01);
  assert.equal(m.overall, 31);
});

test("a submitted zero still counts as attempted; absent does not", () => {
  const zero: AssessmentModel = {
    slots: [slot({ studentKey: "z", cq: [1, 1, 1, 0], mq: [0, 0, 0, 0] }), slot({ studentKey: "y", cq: [1, 1, 0, 0], mq: [0, 0, 0, 0] })],
    units: new Map(),
  };
  const m = sumOf(summarizeAssessmentModel(zero, "campus", none));
  assert.equal(m.attempted, 1);
  assert.equal(m.notAttempted, 1);
  assert.equal(m.avgAttempted, 0);
});

test("roll-ups add raw counts instead of averaging campus percentages", () => {
  const m = sumOf(summarizeAssessmentModel(model, "campus", none));
  // Alpha 10 expected / 8 attempted, Beta 5 expected / 0 attempted: 8 / 15, not the mean of 80% and 0%.
  assert.equal(m.expected, 15);
  assert.equal(m.attempted, 8);
  assert.ok(Math.abs(m.completion! - (8 / 15) * 100) < 1e-9);
});

test("no conducted assessments: zero denominators give null, never 0%", () => {
  const idle: AssessmentModel = { slots: [slot({ cq: [3, 0, 0, 0], mq: [0, 0, 0, 0] })], units: new Map() };
  const m = sumOf(summarizeAssessmentModel(idle, "campus", none));
  assert.equal(m.expected, 0);
  assert.equal(m.completion, null);
  assert.equal(m.overall, null);
  assert.equal(summarizeAssessmentModel({ slots: [], units: new Map() }, "campus", none).length, 0);
});

// Nxtwave regression: a campus lists conducted units for subjects the quiz table has no rows for.
// Expected attempts stay the quiz table's per-student scheduled counts; they are not students × campus-wide conducted units.
const nxSlot = (over: Partial<AssessmentSlot>) =>
  slot({ campus: "Nx", sectionKey: "secN", periodKey: "Nx\tB1\tSemester 3", mq: [0, 0, 0, 0], ...over });
const nxStudents = ["n1", "n2", "n3"];
const nxModel: AssessmentModel = {
  slots: [
    // Computer Networks has quiz rows: 4 scheduled per student, 2 attempted, best-attempt score sum 150 (75 each).
    ...nxStudents.map((id) => nxSlot({ studentKey: id, studentId: id, studentName: id, subject: "Computer Networks", cq: [4, 4, 2, 150], mq: [0, 0, 0, 0] })),
    // Python for DA has conducted units but no quiz-table rows: the student counts, expected stays 0.
    ...nxStudents.map((id) => nxSlot({ studentKey: id, studentId: id, studentName: id, subject: "Python for DA", cq: [0, 0, 0, 0] })),
    // A second campus with full coverage.
    slot({ campus: "Other", sectionKey: "secO", studentKey: "o1", studentId: "o-1", studentName: "Om", periodKey: "Other\tB1\tSemester 3", cq: [4, 4, 4, 360], mq: [0, 0, 0, 0] }),
  ],
  units: new Map([
    [unitWindowKey("secN", "Computer Networks", "2026-07-01", "2026-11-30"), [{ unit: "c1", done: true, type: CQ }, { unit: "c2", done: true, type: CQ }]],
    [unitWindowKey("secN", "Python for DA", "2026-07-01", "2026-11-30"), [{ unit: "p1", done: true, type: CQ }, { unit: "p2", done: true, type: CQ }, { unit: "p3", done: true, type: CQ }]],
    [unitWindowKey("secO", "Maths", "2026-07-01", "2026-11-30"), [{ unit: "o1", done: true, type: CQ }]],
  ]),
};

test("Nxtwave: conducted units span every subject but expected attempts come from the quiz table", () => {
  const rows = summarizeAssessmentModel(nxModel, "campus", none);
  const nx = find(rows, "0", "1", "Nx")!;
  assert.equal(nx.students, "3");
  assert.equal(nx.conducted, "5", "2 Computer Networks + 3 Python for DA units");
  assert.equal(Number(nx.expected_attempts), 3 * 4, "3 students × 4 scheduled in the covered subject");
  assert.notEqual(Number(nx.expected_attempts), Number(nx.students) * Number(nx.conducted), "not students × campus-wide conducted units");
  assert.equal(nx.attempted, "6");
});

test("filters change the raw sums, and roll-ups never average campus percentages", () => {
  const all = sumOf(summarizeAssessmentModel(nxModel, "campus", none));
  // Nx 12 expected / 6 attempted / 450 score, Other 4 / 4 / 360: completion 10 / 16, not the mean of 50% and 100%.
  assert.equal(all.expected, 16);
  assert.equal(all.attempted, 10);
  assert.equal(all.completion, 62.5);
  assert.ok(Math.abs(all.overall! - 810 / 16) < 1e-9);

  const cn = sumOf(summarizeAssessmentModel(nxModel, "campus", { ...none, subjects: ["Computer Networks"] }));
  assert.equal(cn.expected, 12);
  assert.equal(cn.completion, 50);
  assert.equal(cn.avgAttempted, 75);
  assert.equal(cn.overall, 37.5);

  const py = sumOf(summarizeAssessmentModel(nxModel, "campus", { ...none, subjects: ["Python for DA"] }));
  assert.equal(py.expected, 0, "no quiz rows: nothing is invented");
  assert.equal(py.completion, null);
  assert.equal(py.overall, null);

  const other = sumOf(summarizeAssessmentModel(nxModel, "campus", { ...none, campuses: ["Other"] }));
  assert.equal(other.completion, 100);
});

test("data coverage: subjects with quiz units but no quiz-table records are flagged, only where the filters reach them", () => {
  const rows = summarizeAssessmentModel(nxModel, "campus", none);
  const nx = find(rows, "0", "1", "Nx")!;
  assert.equal(nx.unit_subjects, "2", "Computer Networks and Python for DA both have units");
  assert.equal(nx.uncovered_subjects, "1", "Python for DA has no quiz rows");
  const other = find(rows, "0", "1", "Other")!;
  assert.equal(other.unit_subjects, "1");
  assert.equal(other.uncovered_subjects, "0", "fully covered campus is not flagged");
  assert.equal(find(rows, "1", "1", null)!.uncovered_subjects, "1");

  // Filtering to the covered subject, or to the covered campus, drops the warning.
  const covered = summarizeAssessmentModel(nxModel, "campus", { ...none, subjects: ["Computer Networks"] });
  assert.equal(find(covered, "1", "1", null)!.uncovered_subjects, "0");
  const onlyOther = summarizeAssessmentModel(nxModel, "campus", { ...none, campuses: ["Other"] });
  assert.equal(find(onlyOther, "1", "1", null)!.uncovered_subjects, "0");
  // Filtering to the uncovered subject keeps it, and its numbers stay empty rather than estimated.
  const gap = find(summarizeAssessmentModel(nxModel, "campus", { ...none, subjects: ["Python for DA"] }), "1", "1", null)!;
  assert.equal(gap.uncovered_subjects, "1");
  assert.equal(gap.expected_attempts, "0");
});

test("data coverage ignores subjects with no quiz units of the selected type", () => {
  const idle: AssessmentModel = { slots: [slot({ cq: [0, 0, 0, 0], mq: [0, 0, 0, 0] })], units: new Map() };
  const all = find(summarizeAssessmentModel(idle, "campus", none), "1", "1", null)!;
  assert.equal(all.unit_subjects, "0");
  assert.equal(all.uncovered_subjects, "0");
});
