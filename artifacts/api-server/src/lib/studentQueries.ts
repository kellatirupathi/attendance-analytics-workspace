import { pool } from "@workspace/db";
import { getCachedPlacement, getCachedReport } from "./spiReportSync.js";
import { isTestStudent, studentKey } from "./testStudents.js";

/**
 * "Raise a query" from the student report: saves one row per submission in spi_student_queries
 * (same columns as lib/db/src/schema/studentQueries.ts). The subject must be one the student's
 * report shows; college, semester and section come from the synced report.
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
/** The same query sent again within this time (double click, retry) is not saved twice. */
const DUPLICATE_WINDOW = "1 minute";

let tableReady: Promise<void> | null = null;

/**
 * Creates the table, or the sub_category column (added 2026-10-29), only when missing: the
 * published app's database user may not own the table, and Postgres refuses ALTER to a non-owner.
 */
function ensureTable(): Promise<void> {
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

export type SaveQueryResult =
  | { ok: true; id: number }
  | { ok: false; status: 400 | 404; error: string };

export async function saveStudentQuery(input: {
  studentId: string;
  category: string;
  subCategory: string;
  subject: string;
  details: string;
}): Promise<SaveQueryResult> {
  const key = studentKey(input.studentId);
  const category = Object.hasOwn(QUERY_CATEGORIES, input.category) ? QUERY_CATEGORIES[input.category] : undefined;
  const subject = input.subject.trim();
  const details = input.details.trim();
  if (!category?.open) return { ok: false, status: 400, error: "Choose a category" };
  if (!category.subCategories.includes(input.subCategory)) return { ok: false, status: 400, error: "Choose what the problem is" };
  if (!details) return { ok: false, status: 400, error: "Describe the issue" };
  if (details.length > MAX_DETAILS) return { ok: false, status: 400, error: `Keep the details within ${MAX_DETAILS} characters` };

  const report = (await getCachedReport(key)) as { courses?: { name?: unknown }[] } | null;
  if (!report) return { ok: false, status: 404, error: "Student not found" };
  if (!(report.courses ?? []).some((c) => c.name === subject)) return { ok: false, status: 400, error: "Choose a subject from your report" };

  await ensureTable();
  const { rows: same } = await pool.query<{ id: number }>(
    `SELECT id FROM spi_student_queries
     WHERE student_id = $1 AND category = $2 AND sub_category = $3 AND subject = $4 AND details = $5
       AND created_at > now() - interval '${DUPLICATE_WINDOW}'
     ORDER BY id DESC LIMIT 1`,
    [key, input.category, input.subCategory, subject, details],
  );
  if (same[0]) return { ok: true, id: same[0].id };

  const [placement, isTest] = await Promise.all([getCachedPlacement(key), isTestStudent(key)]);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO spi_student_queries (student_id, is_test, college, semester, section, category, sub_category, subject, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      key,
      isTest,
      placement?.college ?? null,
      placement?.semester ?? null,
      placement?.section ?? null,
      input.category,
      input.subCategory,
      subject,
      details,
    ],
  );
  return { ok: true, id: rows[0]!.id };
}
