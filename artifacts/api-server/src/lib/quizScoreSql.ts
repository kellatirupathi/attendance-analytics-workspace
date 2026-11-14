/**
 * The one Classroom / Module Quiz score rule, as SQL over the quiz summary table
 * (z_niat_students_classroom_and_module_quiz_details: one row per student × course × quiz type).
 * No imports, so the standalone SQL builders can use it too.
 *
 *   held      = total_scheduled_quizes
 *   attempted = MIN(total_attempted_quizzes, held)    (attempted = IN_PROGRESS or COMPLETED; capped so a score never passes 100%)
 *   points    = avg_best_attempt_percentage_score × attempted   (a null best counts as 0)
 *   score     = Σ points ÷ Σ held                         (a held quiz not attempted counts as 0; nothing held → null)
 *
 * Agreed with the DA team on 2026-11-14: total_completed_quizzes depends on a cut-off rule, while the best score is
 * averaged over every quiz with a score, so attempted is the count that matches it. The table only has a course
 * average, so the score stays an approximation until a per-quiz view is available.
 */

const col = (alias: string, name: string) => (alias ? `${alias}.${name}` : name);

/** Quizzes held so far. */
export const quizHeldSql = (alias = "") => `IFNULL(SAFE_CAST(${col(alias, "total_scheduled_quizes")} AS INT64), 0)`;

/** Quizzes attempted, never more than held. */
export const quizAttemptedSql = (alias = "") =>
  `LEAST(IFNULL(SAFE_CAST(${col(alias, "total_attempted_quizzes")} AS INT64), 0), ${quizHeldSql(alias)})`;

/** Score points of one row: best-attempt average × quizzes attempted. */
export const quizPointsSql = (alias = "") =>
  `IFNULL(SAFE_CAST(${col(alias, "avg_best_attempt_percentage_score")} AS FLOAT64), 0) * ${quizAttemptedSql(alias)}`;

/** Module Quiz rows; every other row is a Classroom Quiz (same split as the student report). */
export const isModuleQuizSql = (alias = "") => `IFNULL(UPPER(CAST(${col(alias, "derived_unit_type")} AS STRING)), '') LIKE '%MODULE%'`;

/** Aggregate score (0–100) of the rows matching `condition`; null when none of them has a quiz held. */
export const quizScoreSql = (alias: string, condition: string) =>
  `SAFE_DIVIDE(SUM(IF(${condition}, ${quizPointsSql(alias)}, 0)), NULLIF(SUM(IF(${condition}, ${quizHeldSql(alias)}, 0)), 0))`;

/** Classroom Quiz score of the grouped rows. */
export const classroomQuizScoreSql = (alias = "") => quizScoreSql(alias, `NOT (${isModuleQuizSql(alias)})`);

/** Module Quiz score of the grouped rows. */
export const moduleQuizScoreSql = (alias = "") => quizScoreSql(alias, isModuleQuizSql(alias));

/** The same rule in code, for rows already read from the table. */
export interface QuizScoreRow {
  held: number;
  attempted: number;
  best: number | null;
}

/** Attempted quizzes of one row, capped at held (bad or negative counts read as 0). */
export const cappedAttempted = (r: QuizScoreRow): number => {
  const held = Math.max(0, Number(r.held) || 0);
  return Math.min(Math.max(0, Number(r.attempted) || 0), held);
};

/** Σ attempted, Σ held and the score (one decimal; null when nothing is held). */
export function quizScore(rows: QuizScoreRow[]): { attempted: number; held: number; scorePct: number | null } {
  let attempted = 0;
  let held = 0;
  let points = 0;
  for (const r of rows) {
    const a = cappedAttempted(r);
    attempted += a;
    held += Math.max(0, Number(r.held) || 0);
    const best = r.best == null || !Number.isFinite(Number(r.best)) ? 0 : Number(r.best);
    points += best * a;
  }
  return { attempted, held, scorePct: held > 0 ? Math.round((points / held) * 10) / 10 : null };
}
