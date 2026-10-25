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
