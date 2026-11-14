import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cappedAttempted,
  classroomQuizScoreSql,
  isModuleQuizSql,
  moduleQuizScoreSql,
  quizAttemptedSql,
  quizHeldSql,
  quizPointsSql,
  quizScore,
} from "./quizScoreSql.ts";

test("example: 10 held, 4 attempted, best 80 → 32%", () => {
  assert.deepEqual(quizScore([{ held: 10, attempted: 4, best: 80 }]), { attempted: 4, held: 10, scorePct: 32 });
});

test("attempted above held is capped, so the score never passes 100%", () => {
  assert.deepEqual(quizScore([{ held: 10, attempted: 12, best: 90 }]), { attempted: 10, held: 10, scorePct: 90 });
  assert.equal(quizScore([{ held: 3, attempted: 20, best: 100 }]).scorePct, 100);
});

test("attempted 0 with a best score counts as 0 (score of unscheduled quizzes is not used)", () => {
  assert.deepEqual(quizScore([{ held: 5, attempted: 0, best: 57.14 }]), { attempted: 0, held: 5, scorePct: 0 });
});

test("attempted with no best score counts as 0 but stays attempted", () => {
  assert.deepEqual(quizScore([{ held: 2, attempted: 1, best: null }]), { attempted: 1, held: 2, scorePct: 0 });
});

test("a course with nothing held adds nothing, even with attempts", () => {
  const s = quizScore([
    { held: 0, attempted: 3, best: 50 },
    { held: 10, attempted: 5, best: 80 },
  ]);
  assert.deepEqual(s, { attempted: 5, held: 10, scorePct: 40 });
});

test("nothing held at all → null score (not conducted yet), never 0", () => {
  assert.equal(quizScore([]).scorePct, null);
  assert.equal(quizScore([{ held: 0, attempted: 2, best: 70 }]).scorePct, null);
});

test("courses pool by quizzes held: Σ(best × attempted) ÷ Σ held", () => {
  // (80×5 + 60×5) ÷ (10 + 5) = 700 ÷ 15 = 46.67 → 46.7
  assert.equal(quizScore([{ held: 10, attempted: 5, best: 80 }, { held: 5, attempted: 5, best: 60 }]).scorePct, 46.7);
});

test("best 0 on an attempted quiz scores 0 and is still attempted", () => {
  assert.deepEqual(quizScore([{ held: 4, attempted: 4, best: 0 }]), { attempted: 4, held: 4, scorePct: 0 });
});

test("bad counts (negative, NaN) read as 0; NaN best reads as 0", () => {
  assert.equal(cappedAttempted({ held: -3, attempted: 2, best: 50 }), 0);
  assert.equal(cappedAttempted({ held: 5, attempted: Number.NaN, best: 50 }), 0);
  assert.deepEqual(quizScore([{ held: 5, attempted: 5, best: Number.NaN }]), { attempted: 5, held: 5, scorePct: 0 });
});

test("attempted is used, never the cut-off based completed count", () => {
  // 4 attempted, 2 of them over the cut-off: the score uses all 4.
  assert.equal(quizScore([{ held: 10, attempted: 4, best: 80 }]).scorePct, 32);
  assert.match(quizAttemptedSql("q"), /q\.total_attempted_quizzes/);
  assert.doesNotMatch(quizAttemptedSql("q") + quizPointsSql("q") + classroomQuizScoreSql("q"), /total_completed_quizzes/);
});

test("SQL: attempted capped at held, null best as 0, divide by held, null when nothing held", () => {
  assert.equal(quizHeldSql("q"), "IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0)");
  assert.equal(quizAttemptedSql(), "LEAST(IFNULL(SAFE_CAST(total_attempted_quizzes AS INT64), 0), IFNULL(SAFE_CAST(total_scheduled_quizes AS INT64), 0))");
  assert.match(quizPointsSql("q"), /^IFNULL\(SAFE_CAST\(q\.avg_best_attempt_percentage_score AS FLOAT64\), 0\) \* LEAST\(/);
  assert.match(classroomQuizScoreSql("q"), /^SAFE_DIVIDE\(SUM\(IF\(.+\)\), NULLIF\(SUM\(IF\(.+\)\), 0\)\)$/);
});

test("SQL: Module = unit type containing MODULE; everything else (null too) is Classroom, as in the report", () => {
  assert.equal(isModuleQuizSql("q"), "IFNULL(UPPER(CAST(q.derived_unit_type AS STRING)), '') LIKE '%MODULE%'");
  assert.match(moduleQuizScoreSql("q"), /SUM\(IF\(IFNULL\(UPPER/);
  assert.match(classroomQuizScoreSql("q"), /SUM\(IF\(NOT \(IFNULL\(UPPER/);
});
