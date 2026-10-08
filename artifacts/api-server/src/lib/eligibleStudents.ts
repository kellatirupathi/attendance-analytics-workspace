/**
 * Attendance limited to eligible NIAT students.
 *
 * The student master view already drops internal, refunded, dropped-out and
 * beta accounts. Its grain is student × section, so it is collapsed to one row
 * per student here. Students whose only master rows sit under a non-student
 * group (EXCLUDED_MASTER_GROUPS) are dropped too.
 *
 * Each attendance row takes the student's id from the master view, so a
 * student stored under two id spellings in attendance (e.g. a missing hyphen)
 * counts once.
 */
export const STUDENT_MASTER_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.niat_users_core_backend_master_db`";

/** Master-view institutes that are internal or training groups, not student campuses. Matched case-insensitively. */
export const EXCLUDED_MASTER_GROUPS = ["program_ops", "training institute"];

function sqlList(values: string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}

/** A drop-in replacement for the attendance table: same columns, eligible students only. */
export function eligibleAttendanceSource(attendanceTable: string): string {
  return `(
    SELECT attendance.* REPLACE (eligible.user_id AS student_user_id)
    FROM ${attendanceTable} attendance
    JOIN (
      SELECT
        LOWER(REPLACE(CAST(user_id AS STRING), '-', '')) AS student_key,
        ANY_VALUE(CAST(user_id AS STRING)) AS user_id
      FROM ${STUDENT_MASTER_TABLE}
      WHERE user_id IS NOT NULL
      GROUP BY student_key
      HAVING LOGICAL_OR(LOWER(TRIM(IFNULL(institute_name, ''))) NOT IN (${sqlList(EXCLUDED_MASTER_GROUPS)}))
    ) eligible
      ON LOWER(REPLACE(CAST(attendance.student_user_id AS STRING), '-', '')) = eligible.student_key
  )`;
}
