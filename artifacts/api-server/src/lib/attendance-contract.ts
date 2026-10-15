import { bqQuery } from "./bigquery.js";

export const ATTENDANCE_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.niat_students_overall_attendance_details`";

/**
 * Attendance counts NIAT course sessions only: SESSION_SLOT rows that belong to
 * a semester course (subject_title set) whose course category and subject are
 * not excluded in config/attendance-exclusions.json. Every page and the student
 * report use this one rule. ATTENDANCE_SLOT rows (day-level attendance with no
 * session) and session rows with no subject stay in the table so those students
 * still appear on rosters, but they are never scheduled or present.
 */
export const SESSION_SLOT_SQL = `UPPER(CAST(entity_type AS STRING)) = 'SESSION_SLOT'`;

/** Column added by niatSessionSource(): TRUE for a row that counts toward attendance. */
export const NIAT_SESSION_COLUMN = "is_niat_course_session";

/** A row that counts as one scheduled session. Needs a source wrapped by niatSessionSource(). */
export const SCHEDULED_SQL = NIAT_SESSION_COLUMN;

/** A scheduled session the student attended. */
export const ATTENDED_SQL = `(${NIAT_SESSION_COLUMN} AND UPPER(attendance_status) = 'PRESENT')`;

const sqlStrings = (values: string[]) => values.map((value) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`).join(", ");

/**
 * Wraps an attendance source with two columns: `niat_course_category` (the
 * session's course category from the prod sequence) and `is_niat_course_session`.
 * Every row is kept, so rosters are unchanged; only what counts as attendance narrows.
 * Exclusions are upper-cased, trimmed values (see attendanceExclusions.ts).
 */
export function niatSessionSource(
  source: string,
  prodSequenceTable: string,
  exclusions: { excludedCategories: string[]; excludedSubjects: string[] },
): string {
  const categoryExcluded = exclusions.excludedCategories.length
    ? `UPPER(TRIM(CAST(course_category AS STRING))) IN (${sqlStrings(exclusions.excludedCategories)})`
    : "FALSE";
  const subjectExcluded = exclusions.excludedSubjects.length
    ? `UPPER(TRIM(src.subject_title)) IN (${sqlStrings(exclusions.excludedSubjects)})`
    : "FALSE";
  return `(
    WITH niat_sequence AS (
      -- One row per session and section (UUID hyphens stripped: the two tables format them differently).
      SELECT
        REPLACE(CAST(session_id AS STRING), '-', '') AS session_key,
        REPLACE(CAST(section_id AS STRING), '-', '') AS section_key,
        MAX(NULLIF(TRIM(CAST(course_category AS STRING)), '')) AS course_category,
        LOGICAL_OR(IFNULL(${categoryExcluded}, FALSE)) AS category_excluded
      FROM ${prodSequenceTable}
      WHERE session_id IS NOT NULL AND section_id IS NOT NULL
      GROUP BY session_key, section_key
    )
    SELECT
      src.*,
      seq.course_category AS niat_course_category,
      (
        UPPER(CAST(src.entity_type AS STRING)) = 'SESSION_SLOT'
        AND src.subject_title IS NOT NULL
        AND UPPER(TRIM(src.subject_title)) NOT IN ('', 'NULL')
        AND NOT IFNULL(seq.category_excluded, FALSE)
        AND NOT IFNULL(${subjectExcluded}, FALSE)
      ) AS ${NIAT_SESSION_COLUMN}
    FROM ${source} src
    LEFT JOIN niat_sequence seq
      ON seq.session_key = REPLACE(CAST(src.session_id AS STRING), '-', '')
     AND seq.section_key = REPLACE(CAST(src.section_id AS STRING), '-', '')
  )`;
}

// Overall attendance exposes entity_type, not the session_type advertised
// by its metadata. Keep this expression shared with the live contract check.
export const SESSION_TITLE_SQL = `TRIM(CONCAT(
  COALESCE(NULLIF(CAST(entity_type AS STRING), ''), 'SESSION'),
  IF(
    session_start_end_time IS NULL OR TRIM(CAST(session_start_end_time AS STRING)) = '',
    '',
    CONCAT(' · ', CAST(session_start_end_time AS STRING))
  )
))`;

// One class, not one student×session row; scope fallback identities by
// subject and date so different classes cannot collapse into one.
export const SESSION_IDENTITY_SQL = `CONCAT(
  COALESCE(subject_title, ''),
  '|',
  COALESCE(
    NULLIF(CAST(session_id AS STRING), ''),
    NULLIF(CAST(entity_id AS STRING), ''),
    ${SESSION_TITLE_SQL}
  ),
  '|',
  COALESCE(CAST(DATE(date) AS STRING), '')
)`;

export const ATTENDANCE_ROLLUP_FIELDS = [
  "institute_name",
  "student_user_id",
  "batch_section_name",
  "subject_title",
  "attendance_status",
  "session_id",
  "section_id",
  "entity_id",
  "entity_type",
  "session_start_end_time",
  "date",
  "semester_title",
  "is_current_semester",
] as const;

// The probe reads the raw table, so it checks the warehouse columns that
// niatSessionSource() builds is_niat_course_session from.
const expressions: Record<string, string> = {
  attended: `(${SESSION_SLOT_SQL} AND UPPER(attendance_status) = 'PRESENT')`,
  scheduled: `(${SESSION_SLOT_SQL} AND TRIM(subject_title) != '')`,
  session_identity: SESSION_IDENTITY_SQL,
  current_semester: "is_current_semester = 1",
  attendance_date: "DATE(date)",
};

function probeSql(projections: string[]): string {
  // A real query, not INFORMATION_SCHEMA: BigQuery resolves every expression
  // but returns no student data and scans no attendance rows.
  return `SELECT ${projections.join(",\n")}
FROM ${ATTENDANCE_TABLE}
WHERE FALSE
LIMIT 0`;
}

export const ATTENDANCE_CONTRACT_SQL = probeSql([
  ...ATTENDANCE_ROLLUP_FIELDS,
  ...Object.entries(expressions).map(([name, sql]) => `${sql} AS ${name}`),
]);

type Query = (sql: string) => Promise<unknown>;

export async function validateAttendanceContract(
  query: Query = (sql) => bqQuery(sql),
): Promise<void> {
  try {
    await query(ATTENDANCE_CONTRACT_SQL);
  } catch (error) {
    // Isolate failures, including multiple missing columns. Only run these
    // additional zero-row probes when the single normal-path check fails.
    const failures: string[] = [];
    for (const field of ATTENDANCE_ROLLUP_FIELDS) {
      try {
        await query(probeSql([field]));
      } catch (fieldError) {
        failures.push(`field ${field}: ${String(fieldError)}`);
      }
    }
    if (failures.length === 0) {
      for (const [name, sql] of Object.entries(expressions)) {
        try {
          await query(probeSql([`${sql} AS ${name}`]));
        } catch (expressionError) {
          failures.push(`expression ${name} (${sql}): ${String(expressionError)}`);
        }
      }
    }
    throw new Error(
      `Attendance warehouse contract failed for table ${ATTENDANCE_TABLE}.\n` +
      (failures.length ? failures.join("\n") : String(error)),
      { cause: error },
    );
  }
}