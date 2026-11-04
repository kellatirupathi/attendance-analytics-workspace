import { pool } from "@workspace/db";

/**
 * "Raise a query" from the student report: the header row of each chat is in spi_student_queries (same columns as
 * lib/db/src/schema/studentQueries.ts). Saving and the chat itself are in queryChat.ts; this file holds the
 * categories and the table setup.
 */

/**
 * Categories and their sub-categories ("What is the problem?"), by key. The student-facing
 * wording lives in the report page (StudentReportView.tsx, QUERY_CATEGORIES); keep the keys in sync.
 * Final Skill Assessment is not offered yet (no FSA data); set `open: true` to offer it.
 */
const QUIZ_PROBLEMS = ["shows_not_attempted", "completed_count_wrong", "score_wrong", "cannot_open", "technical_problem", "something_else"];
export const QUERY_CATEGORIES: Record<string, { open: boolean; subCategories: string[] }> = {
  attendance: { open: true, subCategories: ["shows_absent", "class_missing", "percentage_wrong", "not_updated", "something_else"] },
  classroom_quiz: { open: true, subCategories: QUIZ_PROBLEMS },
  module_quiz: { open: true, subCategories: QUIZ_PROBLEMS },
  skill_assessment: {
    open: true,
    subCategories: ["score_not_showing", "completed_count_wrong", "score_wrong", "wrong_subject", "could_not_take", "something_else"],
  },
  final_skill_assessment: { open: false, subCategories: ["exam_date", "not_eligible", "could_not_take", "score_wrong", "something_else"] },
};

export const MAX_DETAILS = 2000;

let tableReady: Promise<void> | null = null;

/**
 * Creates the table, or the sub_category column (added 2026-10-29), only when missing: the
 * published app's database user may not own the table, and Postgres refuses ALTER to a non-owner.
 */
export function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'spi_student_queries'",
    );
    if (rows.length === 0) {
      await pool.query(`CREATE TABLE IF NOT EXISTS spi_student_queries (
        id serial PRIMARY KEY,
        student_id text NOT NULL,
        is_test boolean NOT NULL DEFAULT false,
        college text,
        semester text,
        section text,
        category text NOT NULL,
        sub_category text,
        subject text NOT NULL,
        details text NOT NULL,
        status text NOT NULL DEFAULT 'open',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS spi_student_queries_student_idx ON spi_student_queries (student_id, created_at)");
    } else if (!rows.some((r) => r.column_name === "sub_category")) {
      await pool.query("ALTER TABLE spi_student_queries ADD COLUMN IF NOT EXISTS sub_category text");
    }
  })().catch((err) => {
    tableReady = null;
    throw err;
  });
  return tableReady;
}
