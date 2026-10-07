import { bqQuery } from "./bigquery.js";

export const ATTENDANCE_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.niat_students_overall_attendance_details`";

export const ATTENDED_SQL = `UPPER(attendance_status) = 'PRESENT'`;

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
  "entity_id",
  "entity_type",
  "session_start_end_time",
  "date",
  "semester_title",
  "is_current_semester",
] as const;

const expressions: Record<string, string> = {
  attended: ATTENDED_SQL,
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