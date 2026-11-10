import { bqQuery, BQ_LOCATION } from "./bigquery.js";
import { excludeInstituteSql } from "./excludedInstitutes.js";
import { EXCLUDED_MASTER_GROUPS, STUDENT_MASTER_TABLE } from "./eligibleStudents.js";

/**
 * Students who belong on the dashboard: they have a real campus in the core backend master view
 * (institute_name filled, not a Training / Program_Ops group, not an excluded college).
 * A student whose institute is blank there (dropped / moved) or who now sits under Training Institute
 * is not counted. Keys are lower-case UUIDs without hyphens, the report's student key.
 */
export async function getReportEligibleKeys(): Promise<Set<string>> {
  const groups = EXCLUDED_MASTER_GROUPS.map((g) => `'${g.replaceAll("'", "''")}'`).join(", ");
  const rows = await bqQuery<{ student_key: string }>(
    `SELECT DISTINCT LOWER(REPLACE(CAST(user_id AS STRING), '-', '')) AS student_key
     FROM ${STUDENT_MASTER_TABLE}
     WHERE user_id IS NOT NULL
       AND TRIM(IFNULL(institute_name, '')) != ''
       AND LOWER(TRIM(institute_name)) NOT IN (${groups})
       AND ${excludeInstituteSql("institute_name")}`,
    {},
    BQ_LOCATION,
  );
  return new Set(rows.map((r) => r.student_key));
}
