import { pool } from "@workspace/db";
import { getCachedPlacement, getCachedReport } from "./spiReportSync.js";
import { isTestStudent, studentKey } from "./testStudents.js";

/**
 * "Raise a query" from the student report: saves one row per submission in spi_student_queries
 * (same columns as lib/db/src/schema/studentQueries.ts). The subject must be one the student's
 * report shows; college, semester and section come from the synced report.
 */
export const QUERY_CATEGORIES = [
  "attendance",
  "classroom_quiz",
  "module_quiz",
  "skill_assessment",
  "final_skill_assessment",
] as const;
export type QueryCategory = (typeof QUERY_CATEGORIES)[number];

export const MAX_DETAILS = 2000;
/** The same query sent again within this time (double click, retry) is not saved twice. */
const DUPLICATE_WINDOW = "1 minute";

let tableReady: Promise<void> | null = null;

/** Creates the table only when missing (the published app's database user may not own existing tables). */
function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'spi_student_queries'",
    );
    if (rows.length) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS spi_student_queries (
      id serial PRIMARY KEY,
      student_id text NOT NULL,
      is_test boolean NOT NULL DEFAULT false,
      college text,
      semester text,
      section text,
      category text NOT NULL,
      subject text NOT NULL,
      details text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query("CREATE INDEX IF NOT EXISTS spi_student_queries_student_idx ON spi_student_queries (student_id, created_at)");
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
  subject: string;
  details: string;
}): Promise<SaveQueryResult> {
  const key = studentKey(input.studentId);
  const category = input.category as QueryCategory;
  const subject = input.subject.trim();
  const details = input.details.trim();
  if (!QUERY_CATEGORIES.includes(category)) return { ok: false, status: 400, error: "Choose a category" };
  if (!details) return { ok: false, status: 400, error: "Describe the issue" };
  if (details.length > MAX_DETAILS) return { ok: false, status: 400, error: `Keep the details within ${MAX_DETAILS} characters` };

  const report = (await getCachedReport(key)) as { courses?: { name?: unknown }[] } | null;
  if (!report) return { ok: false, status: 404, error: "Student not found" };
  if (!(report.courses ?? []).some((c) => c.name === subject)) return { ok: false, status: 400, error: "Choose a subject from your report" };

  await ensureTable();
  const { rows: same } = await pool.query<{ id: number }>(
    `SELECT id FROM spi_student_queries
     WHERE student_id = $1 AND category = $2 AND subject = $3 AND details = $4 AND created_at > now() - interval '${DUPLICATE_WINDOW}'
     ORDER BY id DESC LIMIT 1`,
    [key, category, subject, details],
  );
  if (same[0]) return { ok: true, id: same[0].id };

  const [placement, isTest] = await Promise.all([getCachedPlacement(key), isTestStudent(key)]);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO spi_student_queries (student_id, is_test, college, semester, section, category, subject, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [key, isTest, placement?.college ?? null, placement?.semester ?? null, placement?.section ?? null, category, subject, details],
  );
  return { ok: true, id: rows[0]!.id };
}
