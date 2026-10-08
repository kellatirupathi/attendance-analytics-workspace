import { excludeInstituteSql } from "./excludedInstitutes.js";

/**
 * Attendance limited to eligible NIAT students, each counted at one campus.
 *
 * The student master view already drops internal, refunded, dropped-out and
 * beta accounts. Its grain is student × section, so it is collapsed to one row
 * per student here. Students whose only master rows sit under a non-student
 * group (EXCLUDED_MASTER_GROUPS) are dropped too.
 *
 * Each attendance row takes the student's id from the master view, so a
 * student stored under two id spellings in attendance (e.g. a missing hyphen)
 * counts once.
 *
 * A student who moved campus this semester has rows at more than one campus.
 * Their current-semester rows from other campuses take the campus, section and
 * semester of their latest row at their current campus (their campus in the
 * master view), so every page counts them, and all their attendance, once.
 * Students with no attendance at their master-view campus are left as they are.
 */
export const STUDENT_MASTER_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.niat_users_core_backend_master_db`";

/** Master-view institutes that are internal or training groups, not student campuses. Matched case-insensitively. */
export const EXCLUDED_MASTER_GROUPS = ["program_ops", "training institute"];

function sqlList(values: string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}

const STUDENT_KEY = (column: string) => `LOWER(REPLACE(CAST(${column} AS STRING), '-', ''))`;

/** A drop-in replacement for the attendance table: same columns, eligible students only, one campus each. */
export function eligibleAttendanceSource(attendanceTable: string): string {
  const excludedGroups = sqlList(EXCLUDED_MASTER_GROUPS);
  return `(
    WITH eligible AS (
      SELECT
        ${STUDENT_KEY("user_id")} AS student_key,
        ANY_VALUE(CAST(user_id AS STRING)) AS user_id
      FROM ${STUDENT_MASTER_TABLE}
      WHERE user_id IS NOT NULL
      GROUP BY student_key
      HAVING LOGICAL_OR(LOWER(TRIM(IFNULL(institute_name, ''))) NOT IN (${excludedGroups}))
    ),
    master_campus AS (
      SELECT DISTINCT ${STUDENT_KEY("user_id")} AS student_key, TRIM(institute_name) AS campus
      FROM ${STUDENT_MASTER_TABLE}
      WHERE user_id IS NOT NULL
        AND institute_name IS NOT NULL AND TRIM(institute_name) != ''
        AND LOWER(TRIM(institute_name)) NOT IN (${excludedGroups})
        AND ${excludeInstituteSql("institute_name")}
    ),
    current_campus AS (
      -- The student's latest current-semester row at their master-view campus.
      SELECT student_key, institute_name, batch_section_name, semester_title
      FROM (
        SELECT
          ${STUDENT_KEY("attendance.student_user_id")} AS student_key,
          attendance.institute_name,
          attendance.batch_section_name,
          attendance.semester_title,
          ROW_NUMBER() OVER (
            PARTITION BY ${STUDENT_KEY("attendance.student_user_id")}
            ORDER BY attendance.date DESC
          ) AS latest
        FROM ${attendanceTable} attendance
        JOIN master_campus
          ON master_campus.student_key = ${STUDENT_KEY("attendance.student_user_id")}
         AND master_campus.campus = TRIM(attendance.institute_name)
        WHERE attendance.is_current_semester = 1
      )
      WHERE latest = 1
    )
    SELECT attendance.* REPLACE (
      eligible.user_id AS student_user_id,
      IFNULL(moved.institute_name, attendance.institute_name) AS institute_name,
      IF(moved.student_key IS NULL, attendance.batch_section_name, moved.batch_section_name) AS batch_section_name,
      IFNULL(moved.semester_title, attendance.semester_title) AS semester_title
    )
    FROM ${attendanceTable} attendance
    JOIN eligible
      ON ${STUDENT_KEY("attendance.student_user_id")} = eligible.student_key
    LEFT JOIN current_campus moved
      ON moved.student_key = eligible.student_key
     AND attendance.is_current_semester = 1
     AND TRIM(attendance.institute_name) != TRIM(moved.institute_name)
  )`;
}
