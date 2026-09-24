import { pool } from "@workspace/db";

export const ATTENDANCE_STAT_COLUMNS = [
  "overallPct",
  "grainPct",
  "present",
  "scheduled",
  "sessions",
  "students",
  "absences",
  "eligible",
  "recoveryEligible",
  "atRisk",
  "ineligible",
] as const;

export type AttendanceStatColumn = (typeof ATTENDANCE_STAT_COLUMNS)[number];

export const DEFAULT_ATTENDANCE_STAT_COLUMNS: AttendanceStatColumn[] = [
  "overallPct",
  "grainPct",
  "eligible",
  "recoveryEligible",
  "atRisk",
  "ineligible",
];

const PAGE_KEY = "student-attendance-stats";

let ready: Promise<void> | null = null;

function ensureTables(): Promise<void> {
  if (!ready) {
    ready = pool
      .query(`
        CREATE TABLE IF NOT EXISTS attendance_stats_defaults (
          page_key text PRIMARY KEY,
          columns jsonb NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attendance_stats_user_columns (
          user_id uuid PRIMARY KEY,
          page_key text NOT NULL,
          columns jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `)
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

export function sanitizeColumns(value: unknown): AttendanceStatColumn[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(ATTENDANCE_STAT_COLUMNS);
  const next: AttendanceStatColumn[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) continue;
    if (!next.includes(item as AttendanceStatColumn)) {
      next.push(item as AttendanceStatColumn);
    }
  }
  if (!next.includes("overallPct")) next.unshift("overallPct");
  return next;
}

export async function getColumnSelection(userId: string): Promise<{
  columns: AttendanceStatColumn[];
  personalized: boolean;
}> {
  await ensureTables();
  const personal = await pool.query<{ columns: AttendanceStatColumn[] }>(
    `SELECT columns FROM attendance_stats_user_columns
     WHERE user_id = $1 AND page_key = $2`,
    [userId, PAGE_KEY],
  );
  if (personal.rows[0]) {
    return {
      columns: sanitizeColumns(personal.rows[0].columns) ?? DEFAULT_ATTENDANCE_STAT_COLUMNS,
      personalized: true,
    };
  }
  const shared = await pool.query<{ columns: AttendanceStatColumn[] }>(
    `SELECT columns FROM attendance_stats_defaults WHERE page_key = $1`,
    [PAGE_KEY],
  );
  return {
    columns:
      sanitizeColumns(shared.rows[0]?.columns) ?? DEFAULT_ATTENDANCE_STAT_COLUMNS,
    personalized: false,
  };
}

export async function saveUserColumns(
  userId: string,
  columns: AttendanceStatColumn[],
): Promise<void> {
  await ensureTables();
  await pool.query(
    `INSERT INTO attendance_stats_user_columns (user_id, page_key, columns)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id) DO UPDATE
     SET columns = EXCLUDED.columns, page_key = EXCLUDED.page_key, updated_at = now()`,
    [userId, PAGE_KEY, JSON.stringify(columns)],
  );
}

export async function saveDefaultColumns(
  columns: AttendanceStatColumn[],
): Promise<void> {
  await ensureTables();
  await pool.query(
    `INSERT INTO attendance_stats_defaults (page_key, columns)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (page_key) DO UPDATE SET columns = EXCLUDED.columns`,
    [PAGE_KEY, JSON.stringify(columns)],
  );
}
